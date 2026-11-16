/**
 * The batch Inspector: one change to every issue in a selected set (#249).
 *
 * The design's rules for several issues at once: with two or more issues
 * selected, the Inspector offers "Serialize all 3", "Make all 3 one unit" and
 * "All 3 are blocked by…", the last asking for the one issue; an offer the plan
 * refuses is disabled with its reason under it; a change asks first, in a
 * dialog stating the number of writes; and a partial failure says how many
 * saved and offers to retry the rest or discard it. Removing and changing the
 * kind stay one relationship at a time, so nothing here removes or retypes.
 *
 * THE WRITES ARE `planBatch`'S (`firstpass/batch.ts`), never built here. This
 * module maps each offer to a `BatchRequest` and keeps the reader's place in
 * the ask: idle, choosing the one issue, or confirming a plan. The reducer is
 * pure; the shell sends the plan's proposals and remembers their mutation ids,
 * which only it ever sees.
 */

import type { IssueRef } from '@issuegraph/store';

import { type BatchOutcome, type BatchPlan, type BatchRefusal, planBatch } from '../firstpass/batch.ts';

/** The three offers, in the order the Inspector draws them. */
export const BATCH_OFFERS = Object.freeze(['serialize', 'unit', 'blocked-by'] as const);
export type BatchOffer = (typeof BATCH_OFFERS)[number];

/** Whether a string names an offer: a `data-ig-value` is a string from the DOM. */
export function isBatchOffer(value: string): value is BatchOffer {
  return BATCH_OFFERS.some((offer) => offer === value);
}

/** Where the reader is in a batch ask. */
export type BatchAsk =
  | { readonly step: 'idle' }
  /** "All N are blocked by…": choosing the one issue, by a search in the Inspector. */
  | { readonly step: 'target'; readonly query: string }
  /** The confirm: the plan whose count the dialog states. */
  | { readonly step: 'confirm'; readonly offer: BatchOffer; readonly plan: BatchPlan };

export const IDLE_BATCH: BatchAsk = Object.freeze({ step: 'idle' });

/**
 * What an offer asks `planBatch` for, given the set in the order it was built.
 *
 * The two symmetric offers are a star from the first issue the reader added, so
 * a set of N is N - 1 writes; "blocked by" is every member pointing at the one
 * issue, so it is N writes, and that issue is left out of the members when it
 * is one of them. The dialog states the plan's count, never N.
 */
export function offerPlan(offer: BatchOffer, keys: readonly IssueRef[], blocker?: IssueRef): BatchOutcome {
  const [first, ...rest] = keys;
  if (offer === 'blocked-by') {
    return planBatch({
      anchor: blocker ?? '',
      members: blocker === undefined ? [] : keys.filter((key) => key !== blocker),
      kind: 'blocked-by',
      direction: 'to-anchor',
    });
  }
  return planBatch({ anchor: first ?? '', members: rest, kind: offer === 'serialize' ? 'serialize-with' : 'together-with' });
}

/**
 * Each offer, and why `planBatch` refuses it, for the Inspector to draw.
 *
 * "Blocked by" is asked with a stand-in for the one issue, because the issue is
 * not picked yet and what is asked of the plan is whether the SET can take the
 * change: the stand-in is no member, so the members are the whole set.
 */
export function offerRefusals(keys: readonly IssueRef[]): ReadonlyMap<BatchOffer, BatchRefusal> {
  const refused = new Map<BatchOffer, BatchRefusal>();
  for (const offer of BATCH_OFFERS) {
    const outcome = offerPlan(offer, keys, offer === 'blocked-by' ? STAND_IN : undefined);
    if (!outcome.ok) refused.set(offer, outcome.refusal);
  }
  return refused;
}

/** No issue key is empty, so the stand-in can never be a member. */
const STAND_IN = '';

/** The result of a batch command: the next ask, and the plan to send when confirmed. */
export interface BatchStep {
  readonly batch: BatchAsk;
  readonly send: BatchPlan | null;
}

/**
 * A batch command, or `null` when the name is not one.
 *
 * `keys` is the selected set; with fewer than two there is no batch to ask
 * about, and every command leaves the ask idle.
 */
export function batchControlled(
  batch: BatchAsk,
  name: string,
  target: string | undefined,
  value: string | undefined,
  keys: readonly IssueRef[],
): BatchStep | null {
  if (!BATCH_COMMANDS.has(name)) return null;
  if (keys.length < 2) return { batch: IDLE_BATCH, send: null };
  switch (name) {
    case 'batch-offer': {
      if (value === undefined || !isBatchOffer(value)) return { batch, send: null };
      if (value === 'blocked-by') return { batch: { step: 'target', query: '' }, send: null };
      return confirming(value, offerPlan(value, keys), batch);
    }
    case 'batch-query':
      return batch.step === 'target' ? { batch: { step: 'target', query: value ?? '' }, send: null } : { batch, send: null };
    case 'batch-target':
      return batch.step === 'target' && target !== undefined
        ? confirming('blocked-by', offerPlan('blocked-by', keys, target), batch)
        : { batch, send: null };
    case 'batch-confirm':
      return batch.step === 'confirm' ? { batch: IDLE_BATCH, send: batch.plan } : { batch, send: null };
    default:
      // `batch-cancel`: Cancel, and Escape through the shell.
      return { batch: IDLE_BATCH, send: null };
  }
}

/** A refused plan leaves the ask where it was: the offer was drawn disabled. */
function confirming(offer: BatchOffer, outcome: BatchOutcome, batch: BatchAsk): BatchStep {
  return outcome.ok ? { batch: { step: 'confirm', offer, plan: outcome.plan }, send: null } : { batch, send: null };
}

const BATCH_COMMANDS: ReadonlySet<string> = new Set(['batch-offer', 'batch-query', 'batch-target', 'batch-confirm', 'batch-cancel']);
