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
 */

/** What the reader has selected. Exactly one thing, or nothing. */
export type WorkspaceSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'issue'; readonly key: string }
  | { readonly kind: 'edge'; readonly edgeId: string };

/** Nothing selected. The state a freshly-loaded workspace is in. */
export const INITIAL_SELECTION: WorkspaceSelection = { kind: 'none' };

/**
 * What a zone can ask for.
 *
 * `select-issue` and `select-edge` REPLACE rather than add, which is the
 * reducer half of the union above: there is no command that could put the
 * workspace in two selections at once, so no reader has to handle one.
 */
export type SelectionCommand =
  | { readonly kind: 'select-issue'; readonly key: string }
  | { readonly kind: 'select-edge'; readonly edgeId: string }
  | { readonly kind: 'clear' };

/**
 * The next selection.
 *
 * Pure and total, like `scaleReducer` beside it: a host reads a
 * `data-ig-command` off a control, calls this, and renders again. Selecting
 * what is already selected CLEARS it — a second click on the same row is how a
 * reader gets back to the whole document without hunting for a control, and it
 * is the behaviour the canvas and the rail both need.
 */
export function selectionReducer(
  selection: WorkspaceSelection,
  command: SelectionCommand,
): WorkspaceSelection {
  switch (command.kind) {
    case 'select-issue':
      return selection.kind === 'issue' && selection.key === command.key
        ? INITIAL_SELECTION
        : { kind: 'issue', key: command.key };
    case 'select-edge':
      return selection.kind === 'edge' && selection.edgeId === command.edgeId
        ? INITIAL_SELECTION
        : { kind: 'edge', edgeId: command.edgeId };
    case 'clear':
      return INITIAL_SELECTION;
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
