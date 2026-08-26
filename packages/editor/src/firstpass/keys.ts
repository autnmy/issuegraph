/**
 * The first pass, as a pure key map: `Y` / `N` / `S`, and `⌫` to undo.
 *
 * §17e is explicit that the queue is keyboard-first, and about why: each answer
 * has to take two seconds, and reaching for a pointer between questions is most
 * of the two seconds. "Keyboard-first" here means the pointer is optional
 * rather than assisted — the whole loop is reachable without one.
 *
 * ## It is `create/keys.ts`'s shape, deliberately and for its scar tissue
 *
 * That module took four review rounds to arrive at asking about OUR OWN
 * interaction instead of trying to enumerate the host's other widgets, and it
 * records the reasoning at length. This map inherits the conclusion rather than
 * re-deriving it: a `KeyPress` carrying the modifier and composition facts, an
 * interaction state supplied by the host, and `none` for everything else.
 *
 * What is NOT inherited is the interaction vocabulary. `CreateInteraction`'s
 * `target-search` is a state of the CREATE flow, and this surface has no search
 * box — so reusing that type would ask a host to answer a question about a flow
 * it is not in. See {@link FirstPassInteraction}.
 *
 * ## `Y`, `N` and `S` are printable, which decides the whole table
 *
 * All three answers are letters. In any focused text control they are that
 * control's characters, so none of them survives editing — and unlike the
 * create flow there is no `⏎`-shaped exception, because nothing in this loop
 * requires typing. That makes the table simpler than `create/keys.ts`'s and the
 * simplicity is a fact about the design rather than a saving: a queue you
 * answer by typing would not be a two-second queue.
 */

import type { KeyPress } from '../create/keys.ts';
import type { Answer, QueueCommand } from './queue.ts';

/**
 * Where the keyboard is, in terms of THIS surface.
 *
 * - `queue` — the queue has the keyboard. Every binding reaches it.
 * - `elsewhere` — anything else at all: an inline edit, a filter box, the
 *   canvas, a modal, a control this package has never heard of. Nothing
 *   reaches.
 *
 * TWO STATES, NOT THREE, and the missing one is the point. `create/keys.ts`
 * needs `target-search` because its own flow contains a text box that two of
 * its bindings must survive. This flow contains none, so a third state would be
 * a distinction with no binding on either side of it — and every state a host
 * has to map its world onto is a chance to map it wrongly.
 */
export type FirstPassInteraction = 'queue' | 'elsewhere';

/** What the shell knows when a key arrives. */
export interface FirstPassContext {
  /**
   * Which of this surface's interactions the keyboard is in.
   *
   * REQUIRED, NOT OPTIONAL, on the same reasoning `KeyboardContext.interaction`
   * records: every default is wrong for some host, and the plausible default —
   * "assume the queue" — is the one that steals keystrokes from a host that has
   * not thought about it.
   */
  readonly interaction: FirstPassInteraction;
  /**
   * Whether a candidate is on screen.
   *
   * An answer with nothing to answer is `none` rather than a command the
   * reducer would discard, so the host does not `preventDefault()` a key it did
   * not consume. The reducer treats the same case as a no-op independently —
   * two guards for one property, which is right here because they protect
   * different things: this one protects the KEY, that one protects the STATE.
   */
  readonly hasCandidate: boolean;
  /**
   * Whether anything has been answered, i.e. whether `⌫` has work.
   *
   * Same reasoning: an undo with an empty history hands the key back.
   */
  readonly canUndo: boolean;
}

/** What a key means. `none` leaves the key to the host. */
export type FirstPassIntent =
  | { readonly kind: 'none' }
  | { readonly kind: 'queue'; readonly command: QueueCommand };

/** What a bound key does, before a context has been consulted. */
type Binding =
  | { readonly action: 'answer'; readonly answer: Answer }
  | { readonly action: 'undo' };

/**
 * The vocabulary, as data.
 *
 * §17e names the keys `Y` / `N` / `S` and `⌫`. The letters are mnemonics in
 * English, which is a real limitation and one this package cannot fix from
 * here: a rebinding belongs to the host, and the reducer takes {@link Answer}
 * values rather than key names precisely so a host can bind whatever its
 * readers' keyboards spell without reaching into {@link ./queue.ts}.
 */
const BINDINGS: ReadonlyMap<string, Binding> = new Map<string, Binding>([
  ['y', { action: 'answer', answer: 'apply' }],
  ['n', { action: 'answer', answer: 'reject' }],
  ['s', { action: 'answer', answer: 'skip' }],
  // BOTH SPELLINGS OF THE DELETE KEY, for the reason `create/keys.ts` records:
  // §17e writes it `⌫`, which is `Backspace` on the keyboards that have it and
  // `Delete` on those that do not — most notably Apple's. Binding one of the
  // two would make "no pointer" false on whichever hardware got the other.
  ['backspace', { action: 'undo' }],
  ['delete', { action: 'undo' }],
]);

const NONE: FirstPassIntent = Object.freeze({ kind: 'none' });

/**
 * The press type is `create/keys.ts`'s, imported rather than redeclared.
 *
 * A KEY PRESS IS A PLATFORM FACT, not a fact about either flow: the fields are
 * `KeyboardEvent`'s, fixed by the DOM, and identical here for reasons that are
 * identical too — a bare key name cannot tell `Y` from `Cmd+Y`, an input method
 * owns every printable key while composing, and an auto-repeat is not a second
 * act. Two structurally identical declarations of it would be the drifting
 * second implementation this package family removes everywhere it appears, and
 * they would drift in the worst possible place: the day the DOM grows a field
 * one flow must honour, only one of the two would learn about it.
 *
 * So the shared definition is imported across, and the package's surface keeps
 * exporting it exactly once, from where it is declared — a host wiring both
 * surfaces holds one `KeyPress` and forwards the same event to either map.
 */

/**
 * Whether this press is a chord that belongs to the platform.
 *
 * `shiftKey` IS DELIBERATELY ABSENT — §17e names its bindings in capitals, and
 * `Shift+y` is how a keyboard reports `Y`, so treating shift as a modifier
 * would unbind the very keys the design specifies. Folded by {@link normalize}.
 */
function chorded(press: KeyPress): boolean {
  return press.ctrlKey === true || press.metaKey === true || press.altKey === true;
}

/** Fold `KeyboardEvent.key` into the table's spelling — see `create/keys.ts`. */
function normalize(key: string): string {
  return key.toLowerCase();
}

/**
 * What one key press means, given what the shell currently holds.
 *
 * Total and pure. One exhaustive switch over a discriminated union, every arm a
 * single expression, because the decision was already made by the table.
 */
export function firstPassIntent(press: KeyPress, context: FirstPassContext): FirstPassIntent {
  // THE PRESS ITSELF DISQUALIFIES IT, before any lookup. A chord and a
  // composition belong to someone else; a repeat is not a fresh act at all.
  if (chorded(press) || press.isComposing === true || press.repeat === true) return NONE;

  // NOTHING REACHES FROM `elsewhere`. Written as an early return rather than a
  // decision table on the binding because — unlike the create map — no binding
  // here survives another control's focus, so a per-binding column would have
  // one value in every row. `create/keys.ts` earns its table; this would be
  // ceremony asserting a distinction the design does not make.
  if (context.interaction !== 'queue') return NONE;

  const binding = BINDINGS.get(normalize(press.key));
  if (binding === undefined) return NONE;

  switch (binding.action) {
    case 'answer':
      return context.hasCandidate
        ? { kind: 'queue', command: { kind: 'answer', answer: binding.answer } }
        : NONE;
    case 'undo':
      return context.canUndo ? { kind: 'queue', command: { kind: 'undo' } } : NONE;
  }
}
