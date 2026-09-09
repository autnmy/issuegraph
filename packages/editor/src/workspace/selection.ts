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

/**
 * The issues one selection names: at least one, ordered, and the first is the
 * ANCHOR.
 *
 * A NON-EMPTY TUPLE RATHER THAN AN ARRAY, so `{ kind: 'issue' }` naming no
 * issue cannot be constructed. That is the same guarantee the union below is
 * chosen for — the impossible combination stops existing at the type — and it
 * is what lets {@link selectedKey} answer a `string` for an issue selection
 * without a length check standing behind it.
 *
 * THE ANCHOR IS POSITIONAL rather than a field of its own. The obvious shape is
 * `{ anchor: string; members: readonly string[] }`, and it is wrong the same way
 * the two-nullable-fields shape below is wrong: it can represent an anchor that
 * is not in its own members, so every reader needs a rule for that cell and the
 * three zones are free to pick different ones. `keys[0]` has no such cell.
 */
export type SelectedIssues = readonly [string, ...(readonly string[])];

/**
 * What the reader has selected. Exactly one KIND of thing, or nothing.
 *
 * CARDINALITY IS NOT AMBIGUITY, which is why the issue arm holds a list without
 * reopening the failure the module header describes. That failure is a shape
 * admitting an issue AND an edge at once — two different kinds, so "what is
 * selected?" has two answers and each zone may pick a different one. A list of
 * issues admits no second kind: there is still one answer and one payload, and
 * the only thing that varies is how many issues that one answer names.
 */
export type WorkspaceSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'issue'; readonly keys: SelectedIssues }
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
  | { readonly kind: 'reveal-issue'; readonly key: string }
  /**
   * §17e's `shift-click or ⇧↓`: add this issue to the set, or take it out.
   *
   * THE ONLY COMMAND THAT DOES NOT REPLACE, and the exception is exactly what
   * the set is for. It is still not a second selection: it edits the ONE issue
   * selection's key list, so no reader gains a state where two kinds are
   * selected at once.
   *
   * A TOGGLE RATHER THAN AN ADD, because a reader who over-shoots a set of six
   * has no other way back — and a separate `unextend` would be two commands for
   * one act with no way for a caller to know which it wants without first
   * reading the state. Extending from `none` or from an EDGE starts a set of
   * one: an edge and an issue are different kinds, and extending an edge
   * selection with an issue means the reader has left the edge behind.
   */
  | { readonly kind: 'extend-issue'; readonly key: string }
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
    case 'select-issue':
      // COMPARED AGAINST THE WHOLE SET, not against its anchor. A plain click
      // on a member of a set of six REPLACES it with that one issue — which is
      // how a reader leaves a set without hunting for a control — and only a
      // click on an already-singleton selection of that key clears it. Reading
      // `keys[0]` here instead would clear the set whenever the anchor was
      // re-clicked, losing five selections to a gesture that means "just this
      // one".
      return isOnly(selection, command.key)
        ? INITIAL_SELECTION
        : { kind: 'issue', keys: [command.key] };
    case 'reveal-issue':
      return { kind: 'issue', keys: [command.key] };
    case 'extend-issue':
      return extend(selection, command.key);
    case 'select-edge':
      return selection.kind === 'edge' && selection.edgeId === command.edgeId
        ? INITIAL_SELECTION
        : { kind: 'edge', edgeId: command.edgeId };
    case 'clear':
      return INITIAL_SELECTION;
  }
}

/** Whether this selection is exactly this one issue and nothing else. */
function isOnly(selection: WorkspaceSelection, key: string): boolean {
  return selection.kind === 'issue' && selection.keys.length === 1 && selection.keys[0] === key;
}

/**
 * The set with `key` added, or removed if it was already there.
 *
 * THE REMOVAL ARM REBUILDS THE TUPLE BY NARROWING, NEVER BY A CAST. `filter`
 * answers a plain `readonly string[]`, which is not assignable to
 * {@link SelectedIssues}, and the obvious repair — asserting it back — is the
 * one this repository bans outright (`markRail` records the same rule for the
 * same reason). Destructuring asks the compiler the question instead: `head`
 * is `string | undefined`, and narrowing it is what proves the tuple non-empty.
 * The "removing the last member empties the selection" case then FALLS OUT of
 * that narrowing rather than being a length check someone could forget.
 *
 * Removing the anchor promotes the next member, which is the only answer
 * consistent with the anchor being positional: the set is still a set, and
 * something has to lead it.
 */
function extend(selection: WorkspaceSelection, key: string): WorkspaceSelection {
  if (selection.kind !== 'issue') return { kind: 'issue', keys: [key] };
  if (!selection.keys.includes(key)) return { kind: 'issue', keys: [...selection.keys, key] };
  const [head, ...rest] = selection.keys.filter((member) => member !== key);
  return head === undefined ? INITIAL_SELECTION : { kind: 'issue', keys: [head, ...rest] };
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
  // THE ANCHOR, AND THE SIGNATURE IS UNCHANGED ON PURPOSE. `aria-current` names
  // THE current item in a container, so a set still has exactly one — and every
  // reader that goes through this accessor keeps behaving identically at N=1,
  // which is what makes the widening above a widening rather than a rewrite.
  // A reader that needs the whole set asks {@link selectedKeys}.
  return selection.kind === 'issue' ? selection.keys[0] : null;
}

/**
 * Every issue the selection names, in the order the reader built it.
 *
 * Empty for `none` AND for an edge, for the reason {@link selectedKey} gives
 * about the other direction: an edge id is a different name space, and handing
 * it back here would let a caller count it as an issue.
 */
export function selectedKeys(selection: WorkspaceSelection): readonly string[] {
  return selection.kind === 'issue' ? selection.keys : [];
}

/**
 * Whether the selection names more than one issue.
 *
 * Its own function rather than `selectedKeys(...).length > 1` at each call
 * site, because it is the condition that decides which surface the inspector
 * draws and which rows the rail marks — one spelling, so the zones cannot
 * disagree about whether a set exists.
 */
export function isMultiSelection(selection: WorkspaceSelection): boolean {
  return selection.kind === 'issue' && selection.keys.length > 1;
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
