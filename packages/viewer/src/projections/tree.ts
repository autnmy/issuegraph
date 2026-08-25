/**
 * The tree projection: `decomposed-from` provenance, drawn as a hierarchy.
 *
 * `decomposed-from` is the one field that describes a hierarchy and orders
 * nothing — which is exactly why it deserves its own projection rather than a
 * badge. "Where did this piece of work come from" is a different question from
 * "what runs next", and answering it on the spine would imply an ordering the
 * format explicitly denies.
 *
 * Nothing here assumes graph-theory literacy of the reader: it is a nested
 * list, announced as one, with each level stating what it is.
 */

import type { NormalizedDocument } from '../document.ts';
import { type ElementSpec, type SpecChild, element } from '../element.ts';
import { edgeBadges, emptyState, identity, legend, provenanceLine } from '../parts.ts';
import { type LateralNeighbours, type Scene, resolveFocusKey } from '../scene.ts';
import type { SceneOptions } from './linear.ts';

interface Forest {
  readonly roots: readonly string[];
  readonly childrenOf: ReadonlyMap<string, readonly string[]>;
  readonly diagnostics: readonly string[];
}

/**
 * Build the forest.
 *
 * `decomposed-from` points from the derived issue TO its origin, so the parent
 * of `A` is the `to` of `A`'s own edge. An issue with several declared origins
 * keeps the first — the format's own single-cardinality rule — and the rest are
 * diagnosed rather than silently merged.
 */
function buildForest(document: NormalizedDocument): Forest {
  const diagnostics: string[] = [];
  // NO CARDINALITY CHECK HERE ANY MORE. `normalizeDocument` applies the
  // format's single-origin rule where the edges are read, so a second origin
  // cannot reach this map — and a branch that can never fire, carrying a
  // diagnostic nothing can trigger, reads as a guard while guarding nothing.
  const parentOf = new Map<string, string>();
  for (const edge of document.edges) {
    if (edge.field !== 'decomposed-from') continue;
    parentOf.set(edge.from, edge.to);
  }

  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const issue of document.issues) {
    const parent = parentOf.get(issue.key);
    if (parent === undefined) {
      roots.push(issue.key);
      continue;
    }
    const existing = childrenOf.get(parent);
    if (existing === undefined) childrenOf.set(parent, [issue.key]);
    else existing.push(issue.key);
  }

  // `decomposed-from` cannot form a cycle by specification, but a document
  // assembled by hand can. Detect it, promote the members to roots so every
  // issue is still reachable, and say so — recursing would hang, and dropping
  // them would lose issues the reader can see elsewhere.
  const rooted = new Set(roots);
  const settled = new Set(roots);
  for (const issue of document.issues) {
    if (settled.has(issue.key)) continue;
    const path: string[] = [];
    const walking = new Set<string>();
    let cursor: string | undefined = issue.key;
    while (cursor !== undefined && !settled.has(cursor)) {
      if (walking.has(cursor)) {
        // PROMOTE THE CYCLE, NOT THE WALK THAT REACHED IT. `path` is everything
        // this walk touched, so when an acyclic TAIL leads into a cycle — `A ->
        // B` with `B -> C -> B` — it holds `A` as well. Promoting all of it
        // rooted `A` and deleted its perfectly valid `A -> B` edge, so a
        // malformed cycle two levels up silently erased a decomposition that
        // was never part of it. Slicing at the repeated node is what makes the
        // blast radius the cycle itself.
        const cycle = path.slice(path.indexOf(cursor));
        diagnostics.push(
          `decomposed-from cycle through ${cycle.join(' -> ')}; each member is drawn once as a root`,
        );
        for (const member of cycle) {
          if (!rooted.has(member)) {
            rooted.add(member);
            roots.push(member);
          }
          const parent = parentOf.get(member);
          if (parent !== undefined) {
            const siblings = childrenOf.get(parent);
            if (siblings !== undefined) {
              childrenOf.set(
                parent,
                siblings.filter((sibling) => sibling !== member),
              );
            }
          }
        }
        break;
      }
      walking.add(cursor);
      path.push(cursor);
      cursor = parentOf.get(cursor);
    }
    for (const member of path) settled.add(member);
  }

  return { roots, childrenOf, diagnostics };
}

/**
 * Depth-first order — what `Tab` and the vertical keys walk.
 *
 * ITERATIVE, like the element build below and like the cluster walk. Nothing
 * bounds how deep a host's `decomposed-from` chain runs, and `renderViewer`
 * documents itself as TOTAL — a document that makes it throw falsifies that
 * claim, whatever the depth was.
 */
function collectOrder(forest: Forest, roots: readonly string[]): string[] {
  const order: string[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const key = stack.pop() as string;
    order.push(key);
    const children = forest.childrenOf.get(key) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index] as string);
    }
  }
  return order;
}

/** The row for one issue, without its children — those are attached below. */
function treeRow(
  document: NormalizedDocument,
  key: string,
  level: number,
  hasChildren: boolean,
  options: SceneOptions,
  focused: string | null,
): { spec: ElementSpec; children: SpecChild[] } {
  const issue = document.byKey.get(key);
  const outOfSet = document.outOfSetOrigins.get(key);
  const children: SpecChild[] = [];

  const spec = element(
    'li',
    {
      class: 'ig-tree-item',
      'data-ig-key': key,
      // NESTED LISTS, NOT `role="tree"`. Every item carries a deep-link chip,
      // and `role="treeitem"` forbids a focusable descendant — a violation axe
      // reports as `nested-interactive` and real screen readers act on. A
      // nested list is announced with its depth natively, needs no ARIA to say
      // so, and leaves the link legal. `data-level` is for styling and tests.
      'data-level': level,
      'aria-current': options.selected === key ? 'true' : 'false',
      'aria-label': `${issue?.title ?? key} — ${key}`,
      tabindex: focused === key ? 0 : -1,
    },
    [
      element('span', { class: 'ig-title' }, [issue?.title ?? key]),
      issue === undefined ? null : identity(issue),
      edgeBadges(document, [key]),
      provenanceLine(issue?.provenance),
      outOfSet === undefined
        ? null
        : element('p', { class: 'ig-provenance' }, [
            `decomposed from ${outOfSet}, which is outside this document`,
          ]),
      // A SPEC LITERAL, not `element()`. That helper FILTERS its children, which
      // copies the array — so the list this row hands back would no longer be
      // the one the `<ul>` holds, and every child appended afterwards would
      // land in a detached array. The whole iterative build turns on this
      // array's identity surviving.
      hasChildren ? { tag: 'ul', attrs: { class: 'ig-list' }, children } : null,
    ],
  );
  return { spec, children };
}

/**
 * Build the whole forest iteratively.
 *
 * The obvious shape is one recursive call per level, and it is the shape that
 * exhausts the call stack on a chain nothing bounds. Each row is built with an
 * EMPTY children array that the row's own `<ul>` already holds by reference, so
 * a child appended later lands inside its parent without the parent's builder
 * still being on the stack.
 */
function buildForestElements(
  document: NormalizedDocument,
  forest: Forest,
  options: SceneOptions,
  focused: string | null,
): ElementSpec[] {
  const roots: ElementSpec[] = [];
  const pending: { key: string; level: number; into: SpecChild[] }[] = [];
  for (let index = forest.roots.length - 1; index >= 0; index -= 1) {
    pending.push({ key: forest.roots[index] as string, level: 1, into: roots });
  }

  while (pending.length > 0) {
    const { key, level, into } = pending.pop() as {
      key: string;
      level: number;
      into: SpecChild[];
    };
    const children = forest.childrenOf.get(key) ?? [];
    const row = treeRow(document, key, level, children.length > 0, options, focused);
    into.push(row.spec);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ key: children[index] as string, level: level + 1, into: row.children });
    }
  }
  return roots;
}

export function treeScene(document: NormalizedDocument, options: SceneOptions = {}): Scene {
  const forest = buildForest(document);
  const focusOrder = collectOrder(forest, forest.roots);

  // A focus the caller supplied wins, but only when it is a key this projection
  // actually draws; otherwise the roving tab stop would land nowhere and the
  // whole tree would be unreachable by keyboard. The rule is shared with
  // `reconcile` so the markup and the reported state cannot disagree.
  const focused = resolveFocusKey(focusOrder, options.focused, options.selected);

  const body =
    forest.roots.length === 0
      ? emptyState('This document declares no issues, so there is nothing to trace.')
      : element(
          'ul',
          { class: 'ig-tree ig-list', 'aria-label': 'decomposition' },
          buildForestElements(document, forest, options, focused),
        );

  const root = element(
    'section',
    { class: 'ig-viewer ig-tree-view', 'data-projection': 'tree', 'aria-label': 'issue decomposition' },
    [legend(), body],
  );

  // A tree's lateral axis is its nesting, which the vertical keys already walk,
  // so there is nothing beside a node to move to.
  const lateral: ReadonlyMap<string, LateralNeighbours> = new Map();

  return {
    projection: 'tree',
    root,
    focusOrder,
    navigable: focusOrder,
    lateral,
    // EMPTY, AND NOT AN OVERSIGHT. The tree draws every key its own row, so a
    // together unit's partner is its own subject here and stands in for
    // nobody. Publishing the linear and graph stations would make selecting a
    // partner in the tree jump to its lead — a row the reader did not click.
    stationOf: new Map(),
    diagnostics: forest.diagnostics,
  };
}
