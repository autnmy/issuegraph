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
import { type ElementSpec, element } from '../element.ts';
import { edgeBadges, emptyState, identity, legend, provenanceLine } from '../parts.ts';
import { type LateralNeighbours, type Scene } from '../scene.ts';
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
  const parentOf = new Map<string, string>();
  for (const edge of document.edges) {
    if (edge.field !== 'decomposed-from') continue;
    if (parentOf.has(edge.from)) {
      diagnostics.push(
        `${edge.from} declares more than one decomposed-from origin; ${String(parentOf.get(edge.from))} is used and ${edge.to} is ignored`,
      );
      continue;
    }
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
        diagnostics.push(
          `decomposed-from cycle through ${path.join(' -> ')}; each member is drawn once as a root`,
        );
        for (const member of path) {
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

/** Depth-first order — what `Tab` and the vertical keys walk. */
function collectOrder(forest: Forest, key: string, into: string[]): void {
  into.push(key);
  for (const child of forest.childrenOf.get(key) ?? []) collectOrder(forest, child, into);
}

function treeItem(
  document: NormalizedDocument,
  key: string,
  level: number,
  forest: Forest,
  options: SceneOptions,
  focused: string | null,
): ElementSpec {
  const issue = document.byKey.get(key);
  const children = forest.childrenOf.get(key) ?? [];
  const outOfSet = document.outOfSetOrigins.get(key);

  return element(
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
      edgeBadges(document, key),
      provenanceLine(issue?.provenance),
      outOfSet === undefined
        ? null
        : element('p', { class: 'ig-provenance' }, [
            `decomposed from ${outOfSet}, which is outside this document`,
          ]),
      children.length === 0
        ? null
        : element(
            'ul',
            { class: 'ig-list' },
            children.map((child) => treeItem(document, child, level + 1, forest, options, focused)),
          ),
    ],
  );
}

export function treeScene(document: NormalizedDocument, options: SceneOptions = {}): Scene {
  const forest = buildForest(document);
  const focusOrder: string[] = [];
  for (const rootKey of forest.roots) collectOrder(forest, rootKey, focusOrder);

  // A focus the caller supplied wins, but only when it is a key this projection
  // actually draws; otherwise the roving tab stop would land nowhere and the
  // whole tree would be unreachable by keyboard.
  const focused =
    options.focused !== undefined &&
    options.focused !== null &&
    focusOrder.includes(options.focused)
      ? options.focused
      : (focusOrder[0] ?? null);

  const body =
    forest.roots.length === 0
      ? emptyState('This document declares no issues, so there is nothing to trace.')
      : element(
          'ul',
          { class: 'ig-tree ig-list', 'aria-label': 'decomposition' },
          forest.roots.map((rootKey) => treeItem(document, rootKey, 1, forest, options, focused)),
        );

  const root = element(
    'section',
    { class: 'ig-viewer ig-tree-view', 'data-projection': 'tree', 'aria-label': 'issue decomposition' },
    [legend(), body],
  );

  // A tree's lateral axis is its nesting, which the vertical keys already walk,
  // so there is nothing beside a node to move to.
  const lateral: ReadonlyMap<string, LateralNeighbours> = new Map();

  return { projection: 'tree', root, focusOrder, lateral, diagnostics: forest.diagnostics };
}
