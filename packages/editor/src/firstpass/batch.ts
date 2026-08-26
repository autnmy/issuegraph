/**
 * Multi-select: the other bulk path, for structure the owner already knows.
 *
 * The queue is for structure the owner has to be SHOWN. This is for the case
 * §17e names beside it — the owner already knows these six issues are one
 * serialized group, and answering six questions about a fact they arrived
 * holding is worse than stating it once.
 *
 * §17e fixes three things about it, and each is load-bearing here:
 *
 *   "symmetric types apply to a whole selection at once; directed types need
 *    one pick. N issues = N writes; the confirm states the count and the batch
 *    is resumable if some fail."
 *
 * ## Directedness is read from the FORMAT, never listed here
 *
 * `isSymmetricEdgeField` in `@issuegraph/core` owns the split, for the reason
 * `picker/view.ts` and `create/keys.ts` both record: a local list out here is
 * the drifting second implementation the package family removes everywhere it
 * appears, and a sixth field added to the format would leave it silently wrong
 * with nothing failing to say so. A new symmetric field applies to a whole
 * selection here the day core learns about it, with no edit to this file.
 *
 * ## Why a STAR, and why the anchor is stated rather than inferred
 *
 * N selected issues do not name N-1 edges on their own; some shape has to be
 * chosen, and the choice is an opinion whichever way it goes. A clique is
 * N(N-1)/2 writes for a fact the owner stated once — quadratic in the thing
 * §17e is trying to make cheap. A chain is N-1 writes but imposes an ORDER the
 * selection never carried, and for a symmetric field an invented order is
 * exactly the wrong kind of invention.
 *
 * A star is N-1 writes and imposes one fact: which issue is the anchor. So that
 * fact is TAKEN rather than guessed — {@link BatchRequest.anchor} — and it is
 * the owner's pick, which is what makes the shape honest instead of arbitrary.
 * For a symmetric kind the star still describes the whole component core means
 * by these fields: every member is connected, which is the property, and the
 * anchor is not privileged by the format afterwards.
 *
 * ## The "one pick" a directed type needs is DIRECTION, not the anchor
 *
 * Both kinds take an anchor, so that is not the thing that distinguishes them.
 * What a directed kind additionally needs is which way the edges point — an
 * anchor that BLOCKS the others and one that is BLOCKED BY them are opposite
 * facts about the same six issues, and nothing about the selection implies
 * either. So {@link BatchRequest.direction} is required for a directed kind and
 * REFUSED for a symmetric one, rather than accepted and ignored: a host that
 * sends one for `together-with` has misunderstood something, and silently
 * dropping it would let a UI grow a direction control that does nothing.
 *
 * ## A refusal is a value, not a throw
 *
 * The same call `structuralRefusal` makes in the store, and for the same
 * reason: these are things a person can do, so they get a surface to be drawn
 * on rather than an exception to be caught. Nothing here adjudicates whether
 * the resulting EDGES are legal — self-edges, duplicates and unknown issues are
 * `structuralRefusal`'s, and a second validity rule out here is a second place
 * for the answer to drift. This module refuses only what it alone can see:
 * whether the REQUEST names a batch at all.
 */

import { isSymmetricEdgeField } from '@issuegraph/core';
import type { EdgeKind, IssueRef, Proposal } from '@issuegraph/store';

/**
 * Which way a directed batch points, relative to the anchor.
 *
 * Named for the anchor rather than for a field's own phrasing (`blocks` /
 * `blocked-by`) because it has to read the same for all three directed fields,
 * and only the anchor is common to them.
 */
export type BatchDirection = 'from-anchor' | 'to-anchor';

/** What the owner selected and asked for. */
export interface BatchRequest {
  /**
   * The anchor. Every edge in the batch touches it.
   *
   * It is not required to be a member of {@link members}, and deliberately so:
   * "these five all block the release issue" is the ordinary shape, and the
   * release issue is not one of the five.
   */
  readonly anchor: IssueRef;
  /** The rest of the selection. Each one gets an edge to or from the anchor. */
  readonly members: readonly IssueRef[];
  readonly kind: EdgeKind;
  /**
   * Required for a directed kind, and refused for a symmetric one. See the
   * module header — this is the "one pick", and it is not the anchor.
   */
  readonly direction?: BatchDirection | undefined;
}

/**
 * Why a request does not name a batch.
 *
 * A closed union rather than a message, so a host words it — the same reason
 * `reevaluate/words.ts` gives — and so a test asserts the reason rather than
 * matching prose.
 */
export type BatchRefusal =
  /** Fewer than one member: there is no edge to write. */
  | { readonly reason: 'no-members' }
  /** A directed kind arrived without its direction pick. */
  | { readonly reason: 'direction-required'; readonly kind: EdgeKind }
  /** A symmetric kind arrived with a direction, which means something is wrong. */
  | { readonly reason: 'direction-not-applicable'; readonly kind: EdgeKind };

/**
 * THERE IS NO `unknown-kind` REFUSAL, and its absence is deliberate.
 *
 * An earlier revision carried one, guarding `isSymmetricEdgeField` — which
 * takes an `EdgeField` rather than a bare string precisely so it is never asked
 * about a typo. But {@link BatchRequest.kind} is already `EdgeKind`, the closed
 * union, so the case the guard answered cannot be constructed: the compiler
 * rejected the very test written to exercise it.
 *
 * That is the shape `create/draft.ts` records a mutation control catching in
 * this package once already — a branch asserting its own necessity that no test
 * can reach. Deleting it is also what the family's validity rule says to do
 * anyway: `structuralRefusal` owns whether an edge is legal, and a second
 * validity rule out here is a second place for the answer to drift.
 */

/**
 * A batch ready to confirm.
 *
 * `count` is `proposals.length` and exists so the confirm cannot state a
 * different number from the one it is about to write. §17e requires the confirm
 * to state the count; deriving it at the render site would be the second place
 * that number lives.
 */
export interface BatchPlan {
  readonly proposals: readonly Proposal[];
  /** What the confirm states. Always `proposals.length`. */
  readonly count: number;
  readonly kind: EdgeKind;
  readonly anchor: IssueRef;
}

export type BatchOutcome =
  | { readonly ok: true; readonly plan: BatchPlan }
  | { readonly ok: false; readonly refusal: BatchRefusal };

/** One edge of the star, in the direction the request asked for. */
function edgeFor(
  anchor: IssueRef,
  member: IssueRef,
  kind: EdgeKind,
  direction: BatchDirection,
): Proposal {
  // A SYMMETRIC KIND STILL LANDS AS AN ORDERED PAIR, which is not a
  // contradiction: `create/draft.ts` records why the store keeps the pair for
  // symmetric kinds too — an editor has to know which issue carries the field.
  // `from-anchor` is the arm a symmetric request takes, so the anchor holds it,
  // which is the arrangement an owner who picked the anchor would expect.
  return direction === 'from-anchor'
    ? { op: 'create', kind, from: anchor, to: member }
    : { op: 'create', kind, from: member, to: anchor };
}

/**
 * Turn a selection into the writes it stands for, or say why it is not a batch.
 *
 * Total and pure. Every refusal is checked before any proposal is built, so a
 * refused request produces no partial plan for a caller to mistake for one.
 */
export function planBatch(request: BatchRequest): BatchOutcome {
  const { anchor, members, kind, direction } = request;

  if (members.length === 0) return { ok: false, refusal: { reason: 'no-members' } };

  const symmetric = isSymmetricEdgeField(kind);
  if (symmetric && direction !== undefined) {
    return { ok: false, refusal: { reason: 'direction-not-applicable', kind } };
  }
  if (!symmetric && direction === undefined) {
    return { ok: false, refusal: { reason: 'direction-required', kind } };
  }

  // `direction ?? 'from-anchor'` rather than a non-null assertion: the checks
  // above make the fallback unreachable for a directed kind, and it is the
  // arm a symmetric kind takes anyway — so the expression is total without a
  // cast, which the strict-TypeScript rule forbids.
  const pointing: BatchDirection = direction ?? 'from-anchor';
  const proposals = members.map((member): Proposal => edgeFor(anchor, member, kind, pointing));
  return { ok: true, plan: { proposals, count: proposals.length, kind, anchor } };
}

/**
 * How one proposal of a batch settled.
 *
 * `landed` and `failed` only. A proposal still IN FLIGHT is deliberately not a
 * third value: resuming while writes are outstanding would re-send them, which
 * is the duplicate-write failure the store's closed operation set exists to
 * prevent. A host resumes once the batch has settled, and a proposal it has no
 * outcome for is treated as still owed — see {@link resumeBatch}.
 */
export interface BatchSettlement {
  readonly proposal: Proposal;
  readonly settled: 'landed' | 'failed';
}

/**
 * What a partially-failed batch still owes.
 *
 * §17e: "the batch is resumable if some fail." Resumability is a real
 * requirement rather than a nicety — a bulk write at §17f's sizes crosses a
 * network N times, and a batch that has to be redone from the start after one
 * timeout is a batch an owner will not retry.
 *
 * Returns a plan over the proposals that did NOT land, or `null` when nothing
 * is owed. `null` rather than an empty plan: "the batch is finished" is a
 * different state from "here is a batch of nothing to confirm", and an empty
 * plan would render a confirm stating a count of zero.
 *
 * ## Unmentioned proposals are still owed, and that is the fail-safe direction
 *
 * A settlement list that is missing entries — a host that lost track, a session
 * that died mid-batch — leaves those proposals in the resumed plan. Re-offering
 * a write that actually landed costs the owner one refusal from the store's own
 * duplicate rule; dropping a write that never landed loses a relationship
 * silently, and nothing downstream would ever surface it.
 */
export function resumeBatch(
  plan: BatchPlan,
  settlements: readonly BatchSettlement[],
): BatchPlan | null {
  const landed = settlements.filter((s): boolean => s.settled === 'landed').map((s) => s.proposal);
  // COMPARED STRUCTURALLY, not by identity. A settlement comes back from the
  // host — across a dispatch, possibly across a serialization boundary — so the
  // object is not the one this module handed out, and `includes` would report
  // every write as still owed.
  const owed = plan.proposals.filter(
    (proposal): boolean => !landed.some((done): boolean => sameProposal(proposal, done)),
  );
  if (owed.length === 0) return null;
  return { ...plan, proposals: owed, count: owed.length };
}

/**
 * Whether two proposals stand for the same write.
 *
 * ONLY `create` IS COMPARED IN FULL, because only `create` can be in a batch —
 * {@link planBatch} builds nothing else. The other three arms are answered by
 * the `op` mismatch above them, and an exhaustive comparison of operations this
 * module cannot produce would be untestable code asserting its own necessity.
 */
function sameProposal(left: Proposal, right: Proposal): boolean {
  if (left.op !== 'create' || right.op !== 'create') return false;
  return left.kind === right.kind && left.from === right.from && left.to === right.to;
}
