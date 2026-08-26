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
 * ## `none` means SOMEONE ELSE OWNS THIS PRESS
 *
 * The same contract `NavigationCommand`'s `none` carries, and the single idea
 * this module keeps getting asked about. A host's whole wiring is "reduce a
 * non-`none` intent, and `preventDefault()` it" — so every press this map
 * claims wrongly is a keystroke stolen from its real owner, and one it hands
 * back is simply the platform working. There are three owners:
 *
 *   - THE HOST, for a key §17b never bound. An unbound key is `none`.
 *   - THE PLATFORM, for a modified chord — `Cmd+R` is reload, not relate. See
 *     {@link KeyPress}.
 *   - AN EDITABLE CONTROL, for a printable key while it has focus. `1` typed
 *     into the target search is the character `1`, not a kind selection.
 *
 * The last two arrived as review findings on consecutive rounds, which is what
 * moved them from special cases to a stated rule: both are "does someone else
 * own this press", asked before the binding's own meaning is consulted. A
 * fourth owner, if one appears, belongs beside them rather than inside an arm
 * of the switch.
 *
 * Ownership is DATA on the binding table — `survivesEditing` — so no call site
 * decides it and a new binding cannot be added without answering the question.
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
  /**
   * Whether an editable control — the target search, an inline title — owns
   * text entry right now.
   *
   * REQUIRED, NOT OPTIONAL, and that is deliberate. An omitted flag would
   * default to "nothing is being edited", which is the answer that silently
   * steals the reader's keystrokes; making it required turns a host that has
   * not thought about it into a compile error instead. It is the one direction
   * a default could not fail safely in.
   *
   * The host answers it — this package has no DOM, and "is an editable control
   * focused" is a question only the shell can see (`document.activeElement`,
   * a `contenteditable`, its own search's state).
   */
  readonly editableFocus: boolean;
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
type BindingAction =
  | { readonly kind: 'relate' }
  | { readonly kind: 'choose-type'; readonly edgeKind: EdgeKind }
  | { readonly kind: 'commit-target' }
  | { readonly kind: 'delete-edge' }
  | { readonly kind: 'retype-edge' }
  | { readonly kind: 'cancel' };

/**
 * An action, plus whether it still applies while a text control owns the key.
 *
 * DATA ON THE TABLE, NOT A TEST AT THE CALL SITE — the same shape
 * `audit/findings.ts` uses for severity, and for the same payoff: no site picks
 * the answer, and a sixth binding is a compile error until the table says
 * whether an editable control owns it. Written as an intersection so the
 * discriminated union still narrows in the switch below.
 */
type Binding = BindingAction & { readonly survivesEditing: boolean };

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
  // `r`, the digits and `t` are PRINTABLE. While a text control has focus they
  // are that control's characters, so they do not survive editing.
  ['r', { kind: 'relate', survivesEditing: false }],
  ...EDGE_FIELDS.map((edgeKind, index): readonly [string, Binding] => [
    String(index + 1),
    { kind: 'choose-type', edgeKind, survivesEditing: false },
  ]),
  // `⏎` and `Escape` SURVIVE, and they are the reason this is a per-binding flag
  // rather than one "printable" test: the flow §17b specifies is
  // `R → digit → search → ⏎`, so the search box is focused at precisely the
  // moment `⏎` has to commit the target. A rule that silenced the whole map
  // while editing would break the loop it exists to deliver. `Escape` survives
  // for the same reason it is always available: a draft you cannot abandon is
  // worse than one you cannot start.
  ['enter', { kind: 'commit-target', survivesEditing: true }],
  // BOTH SPELLINGS OF THE DELETE KEY. §17b writes it `⌫`, which is `Backspace`
  // on the keyboards that have it and `Delete` on those that do not — most
  // notably Apple's, where the key in that position reports `Backspace` and the
  // key labelled `Delete` is the forward one. Binding one of the two would make
  // "no pointer" false on whichever hardware got the other.
  // NOT SURVIVING EDITING is the non-obvious half: in a focused text box `⌫`
  // deletes a CHARACTER, and a map that claimed it would delete the reader's
  // selected edge while they were correcting a typo in the search.
  ['backspace', { kind: 'delete-edge', survivesEditing: false }],
  ['delete', { kind: 'delete-edge', survivesEditing: false }],
  ['t', { kind: 'retype-edge', survivesEditing: false }],
  ['escape', { kind: 'cancel', survivesEditing: true }],
]);

const NONE: KeyIntent = Object.freeze({ kind: 'none' });

/**
 * One key press. Structurally a subset of the DOM's `KeyboardEvent`, so a host
 * passes the event straight in rather than unpacking it.
 *
 * TAKING THE PRESS RATHER THAN THE KEY NAME IS THE POINT. An earlier revision
 * took a bare `key: string`, which cannot tell `R` from `Cmd+R` — so a shell
 * that forwarded `event.key` and called `preventDefault()` for any non-`none`
 * intent would hijack reload, new-tab and tab-selection, and no amount of care
 * on the host's part could recover the distinction this function had already
 * discarded. The modifiers are part of what a press IS; asking for them is the
 * only way this map can honestly answer "not mine".
 *
 * The three that BLOCK are optional so `{ key: 'r' }` still means an
 * unmodified press, which is what a test writes and what a synthetic press from
 * a non-DOM shell has.
 */
export interface KeyPress {
  /** The `KeyboardEvent.key` value. */
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

/**
 * Whether this press is a chord that belongs to the platform, not to us.
 *
 * `shiftKey` IS DELIBERATELY ABSENT. §17b names its bindings in capitals, and
 * `Shift+r` is how a keyboard reports `R` — so treating shift as a modifier
 * would unbind the very keys the design specifies. Shift changes which key was
 * pressed and is folded by `normalize`; Ctrl, Meta and Alt change whose
 * shortcut it is, which is a different question and the one that matters here.
 */
function chorded(press: KeyPress): boolean {
  return press.ctrlKey === true || press.metaKey === true || press.altKey === true;
}

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
export function keyIntent(press: KeyPress, context: KeyboardContext): KeyIntent {
  // BEFORE THE TABLE, because a chord is not a miss to be looked up — it is a
  // press this map has no claim on at all. Answering `none` is what lets a host
  // call `preventDefault()` on everything else without stealing the platform's
  // own shortcuts.
  if (chorded(press)) return NONE;

  const binding = BINDINGS.get(normalize(press.key));
  if (binding === undefined) return NONE;

  // THE SECOND OWNER. A chord belongs to the platform; a printable key belongs
  // to whatever text control has focus. Both are the same question — does
  // someone else own this press — which is why they sit together here rather
  // than being answered per binding further down.
  if (context.editableFocus && !binding.survivesEditing) return NONE;

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
