/**
 * §17e's multi-select bulk path as a slice of the workspace's state.
 *
 * `firstpass/batch.ts` is the batch itself — `planBatch` turns a selection into
 * the star of writes it stands for, `resumeBatch` answers "resumable if some
 * fail" — and it knows nothing about being offered, confirmed or retried.
 * Between them sits a lifecycle nobody owned: an offer is chosen, a target may
 * still be needed, a plan is confirmed, writes go out, and some of them come
 * back failed. That lifecycle is this file, in the shape `selectionReducer`,
 * `scaleReducer`, `createReducer` and `firstPassReducer` already use here — so
 * `host.ts` composes a fifth reducer rather than growing a fifth set of rules.
 *
 * ## The phase is a union, and the two least obvious arms are the load-bearing ones
 *
 * `offering` holds the directed offer between the click and the pick. Without
 * it there is nowhere for the chosen kind or the in-progress target search to
 * live, and the block's central interaction — choose an offer, name a target,
 * confirm — has no state at all.
 *
 * `landed` is a finished batch, and it is NOT `idle`. Returning a successful
 * six-write confirm to the screen the reader started from gives them no way to
 * tell the write happened, and re-offering the same button is the one thing a
 * bulk write must not do.
 *
 * ## `partial` has an exit, and that is not a nicety
 *
 * `resumeBatch` keeps every proposal that did not LAND, which is deliberately
 * fail-safe: an unmentioned proposal is still owed. The cost is that a member
 * the store will refuse forever — a key the document no longer carries, a
 * self-edge on a canonicalized unit — produces the identical remainder on every
 * retry. Without `dismiss` the block would offer that resume for ever, so the
 * exit is what keeps the fail-safe direction from becoming a trap.
 *
 * ## It plans, it never writes
 *
 * `confirm` produces a plan and the phase that holds it; the proposals reach
 * the store as `host.ts` effects, exactly as every other edit in this package
 * does. Nothing here fetches, mutates or awaits.
 */

import {
  type BatchDirection,
  type BatchOutcome,
  type BatchPlan,
  type BatchRefusal,
  type BatchSettlement,
  planBatch,
  resumeBatch,
} from '../firstpass/batch.ts';
import type { EdgeKind, IssueRef } from '@issuegraph/store';

/**
 * Where a batch's anchor comes from.
 *
 * TWO SOURCES, BECAUSE §17e HAS TWO PICKS AND THEY ARE NOT THE SAME PICK. The
 * frame's `pick 1` names a TARGET — the seventh issue the six are all blocked
 * by — while `batch.ts`'s module header says of its own API that "the 'one
 * pick' a directed type needs is DIRECTION, not the anchor" and that "both
 * kinds take an anchor". So a symmetric offer's anchor is the selection's own
 * lead, and a directed offer's is a searched issue outside it. Conflating them
 * attaches `blocked-by` to whichever row happened to be clicked first.
 */
export type AnchorSource = 'selection-anchor' | 'picked';

/** One of §17e's three offers, as data. */
export interface BulkOffer {
  readonly kind: EdgeKind;
  readonly anchorFrom: AnchorSource;
  /**
   * Refused for a symmetric kind and required for a directed one, which is
   * `planBatch`'s contract rather than this table's opinion — see
   * `direction-not-applicable` and `direction-required`.
   */
  readonly direction?: BatchDirection | undefined;
}

/**
 * §17e's three offers, in the order the frame draws them.
 *
 * THE SET IS FIXED AND DOES NOT SELF-EXTEND FROM `EdgeKind`, which is the one
 * place in this package family where reading the vocabulary would be the WRONG
 * move. `duplicate-of` and `decomposed-from` are exactly the kinds SPEC refuses
 * to put on a one-keystroke bulk path — "a wrong `duplicate-of` silently
 * removes real work from the order" — so a list that grew a row whenever core
 * learned a new field would be a feature, not a safeguard.
 *
 * What IS read from the vocabulary is whether a kind is symmetric:
 * `isSymmetricEdgeField` decides whether a direction may be sent at all, inside
 * `planBatch`. `direction` is stated here only because `planBatch` refuses a
 * directed request without one, and the offer's own wording — `all blocked by …`
 * — is what fixes it to `to-anchor`.
 */
export const BULK_OFFERS = Object.freeze([
  Object.freeze({ kind: 'serialize-with', anchorFrom: 'selection-anchor' } as const),
  Object.freeze({ kind: 'together-with', anchorFrom: 'selection-anchor' } as const),
  Object.freeze({ kind: 'blocked-by', anchorFrom: 'picked', direction: 'to-anchor' } as const),
]) satisfies readonly BulkOffer[];

/**
 * The three kinds §17e offers, narrowed from the table itself.
 *
 * DERIVED FROM `BULK_OFFERS` so the list and the type cannot drift — the same
 * shape `CHANGE_FACETS` uses one module over. Typing a host's offer words over
 * the whole `EdgeKind` union instead would demand sentences for
 * `duplicate-of` and `decomposed-from`, which this surface deliberately does
 * not offer: words nothing can render, and a host left to guess whether
 * supplying them changes anything.
 */
export type BulkOfferKind = (typeof BULK_OFFERS)[number]['kind'];

/** The offer for a kind, or `undefined` for a kind §17e does not offer. */
export function offerFor(kind: string): BulkOffer | undefined {
  return BULK_OFFERS.find((offer) => offer.kind === kind);
}

/** What the block is doing. Exactly one of these, always. */
export type BulkPhase =
  /** No offer chosen. The three offers are the whole surface. */
  | { readonly kind: 'idle' }
  /** An offer is chosen; a directed one is still waiting for its target. */
  | { readonly kind: 'offering'; readonly offer: BulkOffer; readonly target: string | null }
  /** A plan is on screen and the confirm states its count. */
  | { readonly kind: 'planned'; readonly offer: BulkOffer; readonly plan: BatchPlan; readonly members: Members }
  /** `planBatch` said no. Drawn, never thrown. */
  | { readonly kind: 'refused'; readonly offer: BulkOffer; readonly refusal: BatchRefusal }
  /** The proposals are out. Nothing may be re-confirmed from here. */
  | { readonly kind: 'writing'; readonly plan: BatchPlan; readonly members: Members }
  /** Some writes failed. `remainder` is what a resume would send. */
  | { readonly kind: 'partial'; readonly remainder: BatchPlan; readonly members: Members }
  /** Every write landed. Its own phase, not a return to `idle`. */
  | { readonly kind: 'landed'; readonly writes: number; readonly members: Members };

/**
 * The issues a phase is ABOUT, carried by every phase that has planned or sent.
 *
 * A PHASE SPEAKS FOR THE SET THAT PRODUCED IT, not for whatever is selected
 * when it is drawn. Two failures made this necessary and they are the same one:
 *
 *   * a plan built over six issues stayed sendable after the ORDER regrouped
 *     one of them into a `together-with` unit — the raw selection never moved,
 *     so nothing invalidated, while the effective membership the plan was built
 *     from had changed under it;
 *   * and a batch sent for A/B/C, left `partial`, was still holding its
 *     remainder when the reader went on to select D/E/F — so the block drew
 *     D/E/F's header above a Resume control that would have written A/B/C.
 *
 * Both are "the raw selection is not the batch's membership". Carrying the
 * membership on the phase is what lets a renderer state which set it is talking
 * about, and lets {@link staleAgainst} answer whether an unsent plan still
 * stands, without either of them re-deriving a grouping they do not own.
 */
export type Members = readonly IssueRef[];

/** The issues a phase is about, or `null` for one that has not planned yet. */
export function phaseMembers(phase: BulkPhase): Members | null {
  switch (phase.kind) {
    case 'idle':
    case 'offering':
    case 'refused':
      return null;
    case 'planned':
    case 'writing':
    case 'partial':
    case 'landed':
      return phase.members;
  }
}

/**
 * Whether an UNSENT plan no longer matches the membership on screen.
 *
 * ASKED OF THE EFFECTIVE SET, which is why it is asked by the renderer rather
 * than by the reducer: canonicalizing a selected key onto its slot's lead is a
 * fact about the ORDER, and the reducer is handed a document that carries
 * issues and edges and no slots.
 *
 * `false` for a phase that has already dispatched — those are not re-sendable,
 * and they speak for their own membership rather than for the one on screen.
 */
export function staleAgainst(phase: BulkPhase, members: Members): boolean {
  if (phase.kind !== 'planned') return false;
  return (
    phase.members.length !== members.length ||
    phase.members.some((member, index) => member !== members[index])
  );
}

export interface BulkState {
  readonly phase: BulkPhase;
}

export const INITIAL_BULK: BulkState = Object.freeze({
  phase: Object.freeze({ kind: 'idle' as const }),
});

/** One act on the block. */
export type BulkCommand =
  | { readonly kind: 'choose-offer'; readonly offer: BulkOffer }
  /** The directed offer's target search. `null` clears it. */
  | { readonly kind: 'set-target'; readonly target: string | null }
  /**
   * Build the plan from the current offer and this membership.
   *
   * THE MEMBERS ARRIVE WITH THE COMMAND rather than being held in this state.
   * The selection is `selectionReducer`'s, the canonicalization to slot leads
   * is the document's, and both move under this block between the click and
   * the confirm. A copy kept here would be the second place the membership
   * lives, and the one that goes stale.
   */
  | { readonly kind: 'confirm'; readonly members: readonly IssueRef[] }
  /** Every write in the batch has settled. */
  | { readonly kind: 'settle'; readonly settlements: readonly BatchSettlement[] }
  /** Abandon the offer, or give up on a remainder. */
  | { readonly kind: 'dismiss' };

export interface BulkResult {
  readonly state: BulkState;
  /**
   * The proposals a `confirm` produced, for the host to dispatch.
   *
   * Empty for every other command AND for a refused confirm, so a caller that
   * dispatches this list unconditionally cannot send a partial batch.
   */
  readonly proposals: BatchPlan['proposals'];
}

const NOTHING: BatchPlan['proposals'] = Object.freeze([]);

function settledAt(phase: BulkPhase): BulkResult {
  return { state: { phase }, proposals: NOTHING };
}

/**
 * The next phase.
 *
 * Pure and total. A command that does not belong to the current phase leaves it
 * alone rather than throwing — the same answer `selectionReducer` gives, and
 * for the same reason: a control can outlive the state that drew it by one
 * render, and a reducer is not the place to adjudicate that.
 */
export function bulkReducer(state: BulkState, command: BulkCommand): BulkResult {
  switch (command.kind) {
    case 'choose-offer':
      return settledAt({ kind: 'offering', offer: command.offer, target: null });
    case 'set-target':
      // ONLY FROM `offering` AND `refused`, which are the two phases that have
      // an offer to attach a target to. A `refused` offer keeps its search
      // open on purpose: `no-members` is corrected by changing the SELECTION,
      // but a target typo is corrected right here, and dropping the reader back
      // to the three offers to fix one word is a worse surface than the refusal
      // it is reporting.
      return state.phase.kind === 'offering'
        ? settledAt({ ...state.phase, target: command.target })
        : state.phase.kind === 'refused'
          ? settledAt({ kind: 'offering', offer: state.phase.offer, target: command.target })
          : settledAt(state.phase);
    case 'confirm':
      return state.phase.kind === 'offering' ? confirm(state.phase, command.members) : settledAt(state.phase);
    case 'settle':
      return state.phase.kind === 'writing'
        ? settle(state.phase.plan, state.phase.members, command.settlements)
        : settledAt(state.phase);
    case 'dismiss':
      return settledAt({ kind: 'idle' });
  }
}

/**
 * Turn the chosen offer and this membership into a plan, or into a refusal.
 *
 * THE ANCHOR IS NOT A MEMBER OF ITS OWN STAR. For a symmetric offer the anchor
 * comes from inside the selection, so it is taken OUT of the members before the
 * request is built — otherwise `planBatch` would build an edge from the anchor
 * to itself, which `structuralRefusal` then rejects one arm at a time after the
 * others have already gone out. Six selected issues therefore produce five
 * writes, and `BulkCounts` is where that difference is stated to the reader.
 */
function confirm(
  phase: Extract<BulkPhase, { kind: 'offering' }>,
  members: readonly IssueRef[],
): BulkResult {
  const anchor = anchorFor(phase, members);
  if (anchor === null) {
    // A DIRECTED OFFER WITH NO TARGET IS NOT A REFUSAL TO DRAW, it is a step
    // the reader has not taken. Left in `offering` so the search stays open.
    return settledAt(phase);
  }
  // FILTERED ON BOTH ROUTES, not only the symmetric one. A reader can type a
  // target that is IN the selection — `all blocked by #512` with #512 among the
  // six is an ordinary thing to reach for — and leaving it in builds an edge
  // from the anchor to itself, which `structuralRefusal` then rejects one arm
  // at a time after the others have already gone out. Filtering here keeps
  // `BatchPlan.count` honest at plan time, which is when the confirm reads it.
  const star = members.filter((member) => member !== anchor);
  const outcome: BatchOutcome = planBatch({
    anchor,
    members: star,
    kind: phase.offer.kind,
    ...(phase.offer.direction === undefined ? {} : { direction: phase.offer.direction }),
  });
  return outcome.ok
    ? {
        state: { phase: { kind: 'planned', offer: phase.offer, plan: outcome.plan, members } },
        proposals: NOTHING,
      }
    : settledAt({ kind: 'refused', offer: phase.offer, refusal: outcome.refusal });
}

function anchorFor(
  phase: Extract<BulkPhase, { kind: 'offering' }>,
  members: readonly IssueRef[],
): IssueRef | null {
  return phase.offer.anchorFrom === 'picked' ? phase.target : (members[0] ?? null);
}

/**
 * Send the plan a `planned` phase holds.
 *
 * Its own function rather than a `send` command arm, because the proposals and
 * the phase change are one act: a caller that could reach `writing` without
 * receiving the proposals would leave a batch nothing ever dispatches, and one
 * that could receive them twice would double every write.
 */
export function sendBatch(state: BulkState): BulkResult {
  return state.phase.kind === 'planned'
    ? {
        state: { phase: { kind: 'writing', plan: state.phase.plan, members: state.phase.members } },
        proposals: state.phase.plan.proposals,
      }
    : { state, proposals: NOTHING };
}

function settle(
  plan: BatchPlan,
  members: Members,
  settlements: readonly BatchSettlement[],
): BulkResult {
  const remainder = resumeBatch(plan, settlements);
  // `null` MEANS FINISHED, WHICH IS NOT THE SAME AS AN EMPTY PLAN — that
  // distinction is `resumeBatch`'s own, and `landed` is where it lands here.
  return settledAt(
    remainder === null
      ? { kind: 'landed', writes: plan.count, members }
      : { kind: 'partial', remainder, members },
  );
}

/**
 * Resume a partly-failed batch: send the remainder, and wait on it again.
 *
 * The remainder becomes the plan, so a second partial failure narrows again
 * rather than re-sending the original — `resumeBatch` is applied to what is
 * still owed, which is what makes the resume terminate.
 */
export function resumeSend(state: BulkState): BulkResult {
  return state.phase.kind === 'partial'
    ? {
        state: { phase: { kind: 'writing', plan: state.phase.remainder, members: state.phase.members } },
        proposals: state.phase.remainder.proposals,
      }
    : { state, proposals: NOTHING };
}
