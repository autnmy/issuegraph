/**
 * Every word §17e's multi-select block puts on screen.
 *
 * Same contract as `firstpass/words.ts` and `reevaluate/words.ts`: the package
 * decides WHAT to say and the host decides HOW, so nothing here is a default
 * and nothing in the renderer is a literal. A surface with no `BulkWords` draws
 * no block at all rather than drawing one in the package's English — the rule
 * `render.ts` already applies to the change summary.
 *
 * ## The offer sentences are the host's, and `treatmentFor` cannot supply them
 *
 * Layer 1's `treatmentFor` answers the FORMAT's label for a field — `blocked
 * by`, `serialized with` — and §17e draws something else: an action with its
 * consequence, `serialize all 6 together` above `one group`. Those are two
 * different registers, and the second is not derivable from the first. So the
 * glyph comes from `treatmentFor` (it is the grammar, and the grammar is layer
 * 1's) and the sentence comes from here.
 *
 * ## Counts are passed as numbers, never interpolated by the renderer
 *
 * `offer(count)` and `confirm(...)` take the numbers and return the sentence,
 * so the block never joins a number to a word — which is what keeps the count
 * a fact the plan supplies rather than one the markup recomputes, and keeps
 * pluralisation the host's problem in the host's language.
 */

import type { BulkOfferKind } from '../workspace/bulk.ts';

import type { BatchRefusal } from './batch.ts';

/**
 * The counts a confirm states, together.
 *
 * TWO NUMBERS, BECAUSE THEY DIFFER AND A READER WHO SEES ONLY ONE CANCELS.
 * §17e's frame reads "6 issues = 6 writes", which is exact for the directed
 * offer — six selected members all pointing at a seventh target. For a
 * symmetric offer the anchor comes from INSIDE the selection, so six issues are
 * one anchor and five members: five writes. Stating five alone under a header
 * saying six reads as though an issue was dropped, and the rational response to
 * that is to abandon a correct batch.
 *
 * `#140`'s rule is intact and is the reason `writes` exists as its own field:
 * the only number ABOUT WRITES is `BatchPlan.count`, read off the plan and
 * never recounted at the render site.
 */
export interface BulkCounts {
  /** Issues the batch is about, after canonicalizing to slot leads. */
  readonly issues: number;
  /** `BatchPlan.count`. Issue bodies this batch will edit. */
  readonly writes: number;
  /**
   * The anchor, for the two symmetric offers.
   *
   * NAMED RATHER THAN LEFT TO CLICK ORDER. `batch.ts` argues exactly this for
   * its own API — the anchor "is TAKEN rather than guessed … the owner's pick"
   * — and a symmetric star leaves one issue unedited, so which one it is has to
   * be a stated fact rather than an artifact of which row was clicked first.
   *
   * `null` for the directed offer, where the anchor is a target the reader
   * searched for and the confirm names it in its own right.
   */
  readonly anchor: string | null;
}

export interface BulkWords {
  /** The block's heading. Takes the EFFECTIVE issue count. */
  readonly selected: (issues: number) => string;
  /** §17e's `shift-click or ⇧↓`. Also carried on the single-selection panel. */
  readonly gesture: string;
  /** The action, per offer. Takes the effective issue count. */
  readonly offer: Readonly<Record<BulkOfferKind, (issues: number) => string>>;
  /** The consequence hint under each action — `one group`, `one rank`, `pick 1`. */
  readonly consequence: Readonly<Record<BulkOfferKind, string>>;
  /** The label on the directed offer's target search. */
  readonly pickTarget: string;
  /**
   * The control that turns a chosen offer into a plan.
   *
   * ITS OWN WORD, and deliberately not the confirm's. A reader who has chosen
   * an offer has not yet been told how many writes it is — `planBatch` has not
   * run — so a control labelled with a count here would either be lying or be
   * a second place the count is computed.
   */
  readonly review: string;
  /** The proposals are out and nothing has come back. */
  readonly writing: (writes: number) => string;
  /** The confirm. Names both counts and, for a symmetric offer, the anchor. */
  readonly confirm: (counts: BulkCounts) => string;
  /** Abandon the offer and go back to the plain selection. */
  readonly cancel: string;
  /** How many selected issues the canvas could not mark. Zero is not drawn. */
  readonly notShown: (count: number) => string;
  /** One sentence per refusal reason. */
  readonly refusals: Readonly<Record<BatchRefusal['reason'], string>>;
  /** A batch that landed whole. Takes the number of writes that landed. */
  readonly landed: (writes: number) => string;
  /** A batch that partly failed, and what resuming would send. */
  readonly resume: (owed: number) => string;
  /** Give up on the remainder. See `bulk.ts` — a permanent refusal needs an exit. */
  readonly dismissRemainder: string;
  /** Names one proposal still owed, so a resume can be inspected before it is sent. */
  readonly owedEdge: (from: string, to: string) => string;
}
