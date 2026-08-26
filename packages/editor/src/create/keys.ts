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
 * back is simply the platform working.
 *
 * ## Why this asks about OUR interaction rather than about other owners
 *
 * Four review rounds each found a different owner this map had failed to
 * anticipate: the platform's `Cmd+R`, the target search's digits, an input
 * method's `⏎`, and then an unrelated editable control's `Escape`. Each fix was
 * correct and each invited the next, because they were all answers to an
 * unanswerable question — *who else might own this press?* That list is an
 * inventory of the HOST's widgets, and this package cannot see it, cannot bound
 * it, and gets one more entry every time a host grows a control.
 *
 * So the question is inverted. {@link CreateInteraction} enumerates OUR OWN
 * interaction, which §17b fixes at three states, and the host says which one it
 * is in. A fifth widget adds no code here: the host reports `elsewhere` and the
 * map is silent. What was an open-ended list of other people's claims became a
 * closed description of this design's own flow.
 *
 * Two press-level facts remain, and they are bounded in a way the widget list
 * never was — a modifier set and a composition flag are fields on the event
 * itself, not things a host invents. See {@link KeyPress}.
 *
 * That leaves the contract: an unbound key is `none`; a press some other part
 * of the host owns is `none`; everything else is this vocabulary's.
 *
 * Which bindings reach the target search is DATA on the binding table, so no
 * call site decides it and a sixth binding cannot be added without answering.
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
   * Which of this design's own interactions the keyboard is in.
   *
   * REQUIRED, NOT OPTIONAL. Every default is wrong for some host, and the
   * plausible one — "assume the canvas" — is the one that steals keystrokes; a
   * host that has not thought about it should get a compile error, not silence.
   *
   * The host answers it because the host is the only one who can: this package
   * has no DOM, and which control holds focus is visible only to the shell.
   * Crucially, answering it needs no knowledge of THIS package — a host maps
   * its own world onto three states it already understands.
   */
  readonly interaction: CreateInteraction;
}

/**
 * Where the keyboard is, in terms of the create flow §17b specifies.
 *
 * Three states, and the set is closed by the DESIGN rather than by the host's
 * inventory of controls — which is the whole reason it replaced a growing list
 * of other owners.
 *
 * - `canvas` — the create vocabulary is live. Every binding reaches it.
 * - `target-search` — the create flow's OWN search box has focus. Only the
 *   bindings that must survive it reach: `⏎` commits the target and `Escape`
 *   withdraws, which is precisely the middle of `R → digit → search → ⏎`. Its
 *   printable keys belong to the box — most issue references carry a digit, so
 *   a map that claimed `1`–`5` here would eat nearly every query — and `⌫`
 *   deletes a CHARACTER rather than the reader's selected edge.
 * - `elsewhere` — something else owns the keyboard entirely: an inline title,
 *   a filter box, a modal, a control this package has never heard of. NOTHING
 *   reaches, `Escape` included, because that control needs `Escape` to cancel
 *   its own edit.
 *
 * `elsewhere` is what makes the set closed. It is the state for everything not
 * named, so a host growing a fifth control changes nothing here.
 */
export type CreateInteraction = 'canvas' | 'target-search' | 'elsewhere';

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
type Binding = BindingAction & { readonly reachesTargetSearch: boolean };

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
  ['r', { kind: 'relate', reachesTargetSearch: false }],
  ...EDGE_FIELDS.map((edgeKind, index): readonly [string, Binding] => [
    String(index + 1),
    { kind: 'choose-type', edgeKind, reachesTargetSearch: false },
  ]),
  // `⏎` and `Escape` SURVIVE, and they are the reason this is a per-binding flag
  // rather than one "printable" test: the flow §17b specifies is
  // `R → digit → search → ⏎`, so the search box is focused at precisely the
  // moment `⏎` has to commit the target. A rule that silenced the whole map
  // while editing would break the loop it exists to deliver. `Escape` survives
  // for the same reason it is always available: a draft you cannot abandon is
  // worse than one you cannot start.
  ['enter', { kind: 'commit-target', reachesTargetSearch: true }],
  // BOTH SPELLINGS OF THE DELETE KEY. §17b writes it `⌫`, which is `Backspace`
  // on the keyboards that have it and `Delete` on those that do not — most
  // notably Apple's, where the key in that position reports `Backspace` and the
  // key labelled `Delete` is the forward one. Binding one of the two would make
  // "no pointer" false on whichever hardware got the other.
  // NOT SURVIVING EDITING is the non-obvious half: in a focused text box `⌫`
  // deletes a CHARACTER, and a map that claimed it would delete the reader's
  // selected edge while they were correcting a typo in the search.
  ['backspace', { kind: 'delete-edge', reachesTargetSearch: false }],
  ['delete', { kind: 'delete-edge', reachesTargetSearch: false }],
  ['t', { kind: 'retype-edge', reachesTargetSearch: false }],
  ['escape', { kind: 'cancel', reachesTargetSearch: true }],
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
  /**
   * `KeyboardEvent.isComposing` — whether an input method is mid-composition.
   *
   * The two keys this protects are exactly the two that survive editable focus.
   * While an IME is composing, `⏎` CONFIRMS the candidate and `Escape` CANCELS
   * the composition; both belong to the input method, and claiming them commits
   * a stale target or discards the draft while the reader is still spelling the
   * word they meant to search for. Anyone entering CJK text hits it on the
   * ordinary path, which is why it is not an exotic case.
   */
  readonly isComposing?: boolean;
  /**
   * `KeyboardEvent.repeat` — whether the OS generated this event by auto-repeat
   * rather than the reader pressing the key again.
   *
   * EVERY BINDING IN THIS VOCABULARY IS A ONE-SHOT COMMAND, so a repeat is not
   * a second act: holding `⌫` past the repeat delay is one decision to delete
   * one edge, and emitting a proposal per event breaks the one-act/one-proposal
   * contract `draft.ts` and the store are both built on. The store makes it
   * visible rather than harmless — a pending delete keeps its edge drawn and
   * selection is client state, so the queued proposals settle into
   * `unknown-edge` records after the first one lands.
   *
   * It is blanket rather than a per-binding flag because there is no repeatable
   * binding here to distinguish: `R`, `1`–`5`, `⏎`, `⌫` and `T` are all
   * discrete commands, none of them a continuous motion like an arrow key. Add
   * one that genuinely repeats and that is when this earns a column on the
   * table — not before.
   */
  readonly repeat?: boolean;
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
 * Whether an input method is mid-composition, and therefore owns this press.
 *
 * Its own predicate rather than another clause inside {@link chorded}: a chord
 * is a fact about which MODIFIERS are held, composition is a fact about the
 * INPUT METHOD's state, and folding them together would make the name lie about
 * half of what it tests. They are asked in the same breath below because the
 * question they answer is the same one.
 */
function composing(press: KeyPress): boolean {
  return press.isComposing === true;
}

/**
 * Whether the OS generated this press by auto-repeat.
 *
 * A DIFFERENT QUESTION FROM THE OTHER TWO, which is why it is not folded into
 * either. Those ask who OWNS the press; this one asks whether it is a fresh ACT
 * at all. The reader holding a key means one decision, however many events the
 * repeat delay produces.
 */
function repeated(press: KeyPress): boolean {
  return press.repeat === true;
}

/**
 * Whether a binding is live in the interaction the host reports.
 *
 * A DECISION TABLE OVER THE THREE STATES, exhaustive so a fourth interaction —
 * were the design ever to grow one — is a compile error here rather than a
 * silently permissive default. `elsewhere` returning `false` for EVERY binding
 * is the whole of the fix for an unrelated control's `Escape`: that control
 * needs `Escape` to cancel its own edit, and a create draft it knows nothing
 * about must not consume it.
 */
function reaches(binding: Binding, interaction: CreateInteraction): boolean {
  switch (interaction) {
    case 'canvas':
      return true;
    case 'target-search':
      return binding.reachesTargetSearch;
    case 'elsewhere':
      return false;
  }
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
  // THE PRESS ITSELF DISQUALIFIES IT, before any lookup — none of these is a
  // miss to be looked up. All three read a field off the event, so none is the
  // open-ended widget question `CreateInteraction` replaced: `KeyboardEvent`'s
  // shape is fixed by the platform rather than by how many controls a host has.
  // TWO QUESTIONS, NOT ONE. The first two ask who OWNS the press — the platform
  // holds `Cmd+R`, an input method holds `⏎` while composing. The third asks
  // whether it is a fresh ACT at all, which is a different thing and the reason
  // it is its own predicate.
  // COMPOSITION BITES THE TWO BINDINGS THAT REACH THE TARGET SEARCH, which is
  // why it cannot be folded into `reachesTargetSearch`: `⏎` and `Escape` are
  // exactly the two that reach a focused search box, and exactly the two an IME
  // needs while composing.
  if (chorded(press) || composing(press) || repeated(press)) return NONE;

  const binding = BINDINGS.get(normalize(press.key));
  if (binding === undefined) return NONE;

  if (!reaches(binding, context.interaction)) return NONE;

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
