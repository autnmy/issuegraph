/**
 * The one piece of state that crosses all three zones.
 *
 * §17b: `selected` is the only edge state that also filters the inspector. So
 * the workspace owns exactly one cross-zone value, and it owns it as ONE value
 * rather than three synchronised copies — the rail, the canvas and the
 * inspector all read this, and none of them mints a second.
 *
 * ## Why a union rather than two nullable fields
 *
 * The obvious shape is `{ issue: string | null; edge: string | null }`, and it
 * is wrong in a way that is invisible until it bites: it can represent
 * "an issue AND an edge are both selected", which is not a state this design
 * has. Every reader would then need a rule for it, the three zones would be
 * free to pick different rules, and the bug would show up as two zones
 * disagreeing about what is selected rather than as a type error.
 *
 * A discriminated union has no such cell. `kind` answers what is selected, and
 * the payload that belongs to that answer is the only payload in scope.
 *
 * ## It carries no document
 *
 * A selection names a key or an edge id and nothing else. It is deliberately
 * not a resolved issue or a resolved edge: the document changes under it — a
 * write lands, the order recomputes — and a selection holding a snapshot of the
 * thing it names would go stale silently. Every zone resolves the name against
 * the document it is rendering, so a selection that no longer resolves renders
 * as nothing selected rather than as last render's answer.
 *
 * ## A set of issues is one value too
 *
 * Two or more issues are `issues`, in the order they were added; one issue
 * stays `issue`, so every single-issue reader and literal keeps working. A set
 * and an edge are still never selected together. The gesture rules for a set
 * are the viewer's (`nextSelection` in `@issuegraph/viewer`): this reducer
 * maps its union onto `ViewerSelection` and back and writes no rule of its own.
 */

import { type SelectionGesture, type ViewerSelection, nextSelection } from '@issuegraph/viewer';

/**
 * What the reader has selected: nothing, one relationship, one issue, or a set
 * of two or more issues in the order they were added — never issues and a
 * relationship at once.
 */
export type WorkspaceSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'issue'; readonly key: string }
  /** Two or more issues, in addition order. One issue is always `issue`. */
  | { readonly kind: 'issues'; readonly keys: readonly string[] }
  | { readonly kind: 'edge'; readonly edgeId: string };

/** Nothing selected. The state a freshly-loaded workspace is in. */
export const INITIAL_SELECTION: WorkspaceSelection = { kind: 'none' };

/**
 * What a zone can ask for.
 *
 * `select-issue` and `select-edge` REPLACE rather than add, which is the
 * reducer half of the union above: there is no command that could put an
 * issue set and a relationship in one selection, so no reader has to handle
 * one. `toggle-issue` adds or drops one issue, `range-issue` adds a range over
 * `order` — the WHOLE rank order, never the rail window — and `limit-to-one`
 * keeps the most recently added issue.
 */
export type SelectionCommand =
  | { readonly kind: 'select-issue'; readonly key: string }
  | { readonly kind: 'reveal-issue'; readonly key: string }
  | { readonly kind: 'select-edge'; readonly edgeId: string }
  | { readonly kind: 'toggle-issue'; readonly key: string }
  | { readonly kind: 'range-issue'; readonly key: string; readonly order: readonly string[] }
  | { readonly kind: 'limit-to-one' }
  | { readonly kind: 'clear' };

/** This selection as the viewer's set rules read it. */
export function toViewerSelection(selection: WorkspaceSelection): ViewerSelection {
  switch (selection.kind) {
    case 'none': return { kind: 'none' };
    case 'issue': return { kind: 'issues', keys: [selection.key] };
    case 'issues': return { kind: 'issues', keys: selection.keys };
    case 'edge': return { kind: 'edge', edgeId: selection.edgeId };
  }
}

/** A viewer selection as this workspace holds it: one issue is `issue`, two or more `issues`. */
export function fromViewerSelection(selection: ViewerSelection): WorkspaceSelection {
  switch (selection.kind) {
    case 'none': return INITIAL_SELECTION;
    case 'edge': return { kind: 'edge', edgeId: selection.edgeId };
    case 'issues': return issuesSelection(selection.keys);
  }
}

/** None, one `issue`, or an `issues` set of two or more, from keys in addition order. */
export function issuesSelection(keys: readonly string[]): WorkspaceSelection {
  const [first] = keys;
  if (first === undefined) return INITIAL_SELECTION;
  return keys.length === 1 ? { kind: 'issue', key: first } : { kind: 'issues', keys: Object.freeze([...keys]) };
}

/** The selection after a gesture, by the viewer's set rules. */
function gestured(
  selection: WorkspaceSelection,
  gesture: SelectionGesture,
  order: readonly string[],
): WorkspaceSelection {
  return fromViewerSelection(nextSelection(toViewerSelection(selection), gesture, order));
}

/**
 * The next selection.
 *
 * Pure and total, like `scaleReducer` beside it: a host reads a
 * `data-ig-command` off a control, calls this, and renders again. Selecting
 * what is already selected CLEARS it — a second click on the same row is how a
 * reader gets back to the whole document without hunting for a control, and it
 * is the behaviour the canvas and the rail both need.
 *
 * `reveal-issue` IS THAT SAME MOVE WITHOUT THE TOGGLE, and the pair is why it
 * is a command rather than a flag. A row click is ambivalent — the reader is
 * pointing at something and may be pointing away from it — but a control that
 * says "go and look at this finding" is DIRECTED: it names where to arrive, so
 * landing on the issue already selected must leave the reader there. Under the
 * toggle it emptied the panel instead, which is the one outcome that control
 * cannot mean.
 */
export function selectionReducer(
  selection: WorkspaceSelection,
  command: SelectionCommand,
): WorkspaceSelection {
  switch (command.kind) {
    // THE TOGGLE CLEARS ONLY A SOLE SELECTION. A plain click on a member of a
    // set of two or more replaces the set with that issue.
    case 'select-issue':
      return selection.kind === 'issue' && selection.key === command.key
        ? INITIAL_SELECTION
        : { kind: 'issue', key: command.key };
    case 'reveal-issue':
      return { kind: 'issue', key: command.key };
    case 'select-edge':
      return selection.kind === 'edge' && selection.edgeId === command.edgeId
        ? INITIAL_SELECTION
        : { kind: 'edge', edgeId: command.edgeId };
    case 'toggle-issue':
      return gestured(selection, { kind: 'toggle', key: command.key }, []);
    case 'range-issue':
      return gestured(selection, { kind: 'range', key: command.key }, command.order);
    case 'limit-to-one':
      return gestured(selection, { kind: 'limit-to-one' }, []);
    case 'clear':
      return INITIAL_SELECTION;
  }
}

/**
 * Every issue key the rail and the canvas should draw as selected, in addition
 * order: one for an issue, all of a set, none for an edge or nothing.
 */
export function selectedKeys(selection: WorkspaceSelection): readonly string[] {
  switch (selection.kind) {
    case 'issue': return [selection.key];
    case 'issues': return selection.keys;
    case 'none':
    case 'edge':
      return [];
  }
}

/**
 * The key the VIEWER should draw as selected, if any.
 *
 * An edge selection resolves to no key on purpose: the viewer's `selected`
 * renders `aria-current` on a NODE, and an edge is not a node. Handing it an
 * edge id would either match nothing — the quiet failure — or, worse, match an
 * issue whose key happened to collide with an edge id.
 */
export function selectedKey(selection: WorkspaceSelection): string | null {
  return selection.kind === 'issue' ? selection.key : null;
}

/**
 * The edge identity the CANVAS should draw as selected, if any.
 *
 * The mirror of {@link selectedKey}, and it exists for the same reason that one
 * does: the union has two payloads and a zone reads exactly the one that
 * belongs to it. `selectedKey` answers the viewer's `aria-current`, which is a
 * NODE question; this answers the canvas's selection overlay, which is an EDGE
 * question. Neither zone gets to ask the other's.
 *
 * An issue selection resolves to no edge for the same reason the other returns
 * no key: an issue key and an edge identity are different name spaces, and
 * handing one to the reader of the other either matches nothing — the quiet
 * failure — or matches the wrong thing.
 */
export function selectedEdgeId(selection: WorkspaceSelection): string | null {
  return selection.kind === 'edge' ? selection.edgeId : null;
}
