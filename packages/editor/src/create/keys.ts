/**
 * The keyboard path, as a pure key map.
 *
 * §17b fixes the loop — `R` → `1`–`5` → search → `⏎`, with `⌫` deleting a
 * selected edge and `T` retyping it — and fixes what it is FOR in four words:
 * "full loop, no pointer". An owner encoding a backlog can reach every edit
 * without touching a pointing device, which is what makes the first pass fast.
 *
 * No DOM, no events, no side-effects: a key NAME and a context in, an intent
 * out. Exactly the shape `viewer/navigation.ts` chose, and for the same payoff
 * — the whole map is exhaustively testable on a runtime with no DOM at all, and
 * the shell is left with nothing to get wrong except wiring.
 *
 * ## The digits are read from the format, never listed
 *
 * `1`–`5` select a kind BY ITS POSITION IN `EDGE_FIELDS`, taken from
 * `@issuegraph/core`. A local `['blocked-by', …]` out here is the drifting
 * second implementation the package family removes everywhere it appears:
 * `picker/view.ts` records the same decision for directedness, and the failure
 * it prevents is specific — a sixth field added to the format would leave the
 * list silently wrong, with nothing failing to say so. Built from the vocabulary
 * itself, a sixth field gets a `6` for free and the picker and the keyboard
 * cannot disagree about which digit means what.
 *
 * ## Retype opens the picker; it does not emit a retype
 *
 * `T` answers with the edge to open {@link ../picker/view.ts pickerView} on,
 * whose options already carry one `retype` proposal each. Emitting one from out
 * here would be a second retype emitter, and the two would be free to disagree
 * about what a retype IS — which is the whole reason that module exists.
 *
 * ## An unbound key is `none`, never a swallowed key
 *
 * The same contract `NavigationCommand`'s `none` carries: this map claims only
 * the keys §17b gives it, and everything else is the host's to handle. A map
 * that returned "handled" for an unbound key would silently eat the host's own
 * shortcuts.
 */

import { EDGE_FIELDS } from '@issuegraph/core';
import type { EdgeId, EdgeKind, IssueRef, Proposal } from '@issuegraph/store';

import type { CreateCommand } from './draft.ts';

/**
 * What the shell knows when a key arrives.
 *
 * Every field is nullable because every one of them is genuinely absent
 * sometimes — nothing focused, a search matching nothing, no edge selected —
 * and a key whose subject is missing resolves to {@link KeyIntent} `none`
 * rather than to a guess.
 */
export interface KeyboardContext {
  /**
   * The issue holding the tab stop. The SOURCE a new relationship starts from.
   *
   * The viewer's roving tab stop is the natural supply for this: its
   * `NavigationState.focused` is exactly "the issue the reader is standing on".
   */
  readonly focused: IssueRef | null;
  /**
   * What the target search currently resolves to, or `null`.
   *
   * The SEARCH ITSELF IS THE HOST'S. Matching a query against a backlog needs
   * the backlog — and at the sizes §17f describes, an index the host already
   * has — so this module takes the answer rather than the question. It also
   * keeps the create path indifferent to *how* a target was named: the same
   * `⏎` works over a fuzzy match, a pasted reference or a picked list row.
   */
  readonly match: IssueRef | null;
  /**
   * The selected edge, or `null` when the selection is an issue or empty.
   *
   * A `together-with` CONNECTOR ARRIVES HERE LIKE ANY OTHER EDGE, and that is
   * why neither `⌫` nor `T` carries a special case for it. The viewer gives the
   * connector its own edge identity (`GROUP_ATTRIBUTE`) precisely so that an
   * enclosure — which has no line to click — is still individually selectable,
   * so by the time a selection reaches this module it is already just an edge
   * id. §17b asks that such an edge be selectable, retypeable and deletable;
   * it is, through the ordinary path, with nothing here to keep in step.
   */
  readonly selectedEdge: EdgeId | null;
}

/**
 * What a key means. `none` leaves the key to the host.
 *
 * `create` carries a {@link CreateCommand } for {@link ./draft.ts createReducer},
 * so the keyboard path feeds the same reducer the other two do rather than
 * building proposals of its own.
 */
export type KeyIntent =
  | { readonly kind: 'none' }
  | { readonly kind: 'create'; readonly command: CreateCommand }
  | { readonly kind: 'propose'; readonly proposal: Proposal }
  /** Open the type picker on this edge; its options carry the proposals. */
  | { readonly kind: 'retype'; readonly edgeId: EdgeId };

/** What a bound key does, before a context has been consulted. */
type Binding =
  | { readonly kind: 'relate' }
  | { readonly kind: 'choose-type'; readonly edgeKind: EdgeKind }
  | { readonly kind: 'commit-target' }
  | { readonly kind: 'delete-edge' }
  | { readonly kind: 'retype-edge' }
  | { readonly kind: 'cancel' };

/**
 * The vocabulary, as data.
 *
 * THE KIND TRAVELS IN THE BINDING, not an index into `EDGE_FIELDS`. Storing a
 * position would put an array lookup on the resolve path, whose miss is
 * `undefined` — a case that cannot happen and would still have to be answered,
 * in a language where answering it wrongly means a cast. Reading the vocabulary
 * once, here, closes it.
 */
const BINDINGS: ReadonlyMap<string, Binding> = new Map<string, Binding>([
  ['r', { kind: 'relate' }],
  ...EDGE_FIELDS.map((edgeKind, index): readonly [string, Binding] => [
    String(index + 1),
    { kind: 'choose-type', edgeKind },
  ]),
  ['enter', { kind: 'commit-target' }],
  // BOTH SPELLINGS OF THE DELETE KEY. §17b writes it `⌫`, which is `Backspace`
  // on the keyboards that have it and `Delete` on those that do not — most
  // notably Apple's, where the key in that position reports `Backspace` and the
  // key labelled `Delete` is the forward one. Binding one of the two would make
  // "no pointer" false on whichever hardware got the other.
  ['backspace', { kind: 'delete-edge' }],
  ['delete', { kind: 'delete-edge' }],
  ['t', { kind: 'retype-edge' }],
  ['escape', { kind: 'cancel' }],
]);

const NONE: KeyIntent = Object.freeze({ kind: 'none' });

/**
 * Fold a `KeyboardEvent.key` into the table's spelling.
 *
 * Lower-casing is what makes `R` and `r` the same key, which matters because
 * §17b names the bindings in capitals while a keyboard reports the shifted and
 * unshifted forms differently. `toLowerCase` also folds `Enter`, `Backspace`,
 * `Delete` and `Escape` onto their entries above, so one rule covers both
 * families and there is no second spelling table to keep aligned.
 */
function normalize(key: string): string {
  return key.toLowerCase();
}

/**
 * What one key press means, given what the shell currently holds.
 *
 * Total and pure. The branching is one exhaustive switch over a discriminated
 * union — the boundary rule's permitted shape — and every arm is a single
 * expression, because the decision was already made by the table.
 */
export function keyIntent(key: string, context: KeyboardContext): KeyIntent {
  const binding = BINDINGS.get(normalize(key));
  if (binding === undefined) return NONE;

  switch (binding.kind) {
    case 'relate':
      // Nothing focused is nothing to relate FROM. Answering `none` hands the
      // key back rather than opening a draft with a hole in it.
      return context.focused === null
        ? NONE
        : { kind: 'create', command: { kind: 'begin', source: context.focused } };
    case 'choose-type':
      // NO CONTEXT NEEDED, and deliberately usable before a target exists: the
      // keyboard path gathers kind before target, and the draft is a set, so a
      // kind chosen early is simply a filled slot.
      return { kind: 'create', command: { kind: 'type', edgeKind: binding.edgeKind } };
    case 'commit-target':
      return context.match === null
        ? NONE
        : { kind: 'create', command: { kind: 'target', ref: context.match } };
    case 'delete-edge':
      return context.selectedEdge === null
        ? NONE
        : { kind: 'propose', proposal: { op: 'delete', edgeId: context.selectedEdge } };
    case 'retype-edge':
      return context.selectedEdge === null ? NONE : { kind: 'retype', edgeId: context.selectedEdge };
    case 'cancel':
      // ALWAYS AVAILABLE. Escape withdraws whatever is open, and a draft the
      // reader cannot abandon is worse than one they cannot start.
      return { kind: 'create', command: { kind: 'cancel' } };
  }
}
