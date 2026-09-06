/**
 * The first pass as a slice of the workspace's state — no DOM, no promises.
 *
 * `firstpass/queue.ts` is the review loop itself and knows nothing about being
 * opened or closed; `firstpass/candidates.ts` declares a port whose one method
 * is asynchronous by construction. Between them sits a lifecycle nobody owned:
 * the surface is shut, then a scan is out, then a queue is up, and a scan can
 * fail. That lifecycle is this file, in the shape `selectionReducer`,
 * `scaleReducer` and `createReducer` already use here — so `host.ts` composes a
 * fourth reducer rather than growing a fourth set of rules.
 *
 * ## The phase is a union, and `decided` sits outside it
 *
 * Everything the phase carries belongs to one phase only, so it is a
 * discriminated union for the reason `firstpass/view.ts` records about its own
 * three states: the impossible combinations stop existing.
 *
 * {@link FirstPassState.decided} is deliberately NOT in the union, because it
 * is the one fact that has to outlive every phase. See below.
 *
 * ## A re-open re-scans, and `decided` is what makes that honest
 *
 * Closing drops the queue rather than resuming it: a queue held across a close
 * carries a candidate set taken before the writes the reader just made, so it
 * would go on asking about relationships that now exist.
 *
 * But a re-scan on its own would re-ask every question the reader already
 * answered — `queue.ts` defines `reject` as "no, this is not a relationship.
 * Answered, and gone", and a host's `findCandidates` is never told what was
 * decided, so it cannot filter them out on the reader's behalf. Forty rejections
 * would come back on the next open, which is a worse outcome than the resume
 * this refuses and defeats §17e's "first pass has an end" across sessions.
 *
 * So the decided ids ride outside the phase and filter the next scan.
 *
 * **`skip` is not decided, and that is the design rather than an omission.**
 * §17e's `S` is "not now", and `queue.ts` ships `skippedCandidates` precisely
 * because "the deferred set is the thing a second pass is built from". A skipped
 * candidate coming back in the next pass is what deferring it meant.
 *
 * ## Scans carry a generation, or the newest answer can lose
 *
 * A reader who closes during a slow scan and opens again has two scans in
 * flight. Discriminating on the phase alone cannot tell their answers apart, so
 * the STALE set — taken before the reader's writes — would open the queue while
 * the fresh one arrived on `open` and was dropped. That is the exact failure the
 * re-scan rule exists to prevent, arriving through the door the rule opened.
 *
 * {@link FirstPassState.scan} is a monotonic counter. Every scan is issued under
 * it, every answer carries the number it was issued under, and an answer whose
 * number is not the current one is dropped.
 */

import type { Candidate, CandidateId } from '../firstpass/candidates.ts';
import {
  type Answered,
  type QueueCommand,
  type QueueResult,
  type QueueState,
  openQueue,
  queueReducer,
} from '../firstpass/queue.ts';

/** What the surface is doing. Exactly one of these, always. */
export type FirstPassPhase =
  /** Shut. The header's entry is the only way in. */
  | { readonly kind: 'closed' }
  /** A scan is out. The generation is {@link FirstPassState.scan}. */
  | { readonly kind: 'scanning' }
  /**
   * The host's scan rejected.
   *
   * ITS OWN PHASE rather than an empty queue: `empty` means the host found
   * nothing to encode, which is a claim about the backlog that a failed scan
   * does not license — the vacuity `firstpass/view.ts` separates its own two
   * end states to avoid. And its own phase rather than a silent return to
   * `closed`, which made a broken port indistinguishable from a dead button.
   *
   * It carries no payload: the reason is the host's and this package does not
   * read it. A shell draws its own sentence and its own way out.
   */
  | { readonly kind: 'failed' }
  | { readonly kind: 'open'; readonly queue: QueueState };

export interface FirstPassState {
  readonly phase: FirstPassPhase;
  /**
   * The candidates DECIDED in this state's lifetime — `apply` and `reject`.
   *
   * Filters the next scan, so a re-open does not re-ask a decided question. Held
   * as ids rather than candidates because that is what a scan can be compared
   * against, and because {@link CandidateId} is the identity the HOST minted:
   * `firstpass/candidates.ts` is explicit that two findings about the same pair
   * are not necessarily the same finding, so nothing here derives an identity of
   * its own.
   */
  readonly decided: readonly CandidateId[];
  /** The generation the newest scan was issued under. Monotonic. */
  readonly scan: number;
}

export const INITIAL_FIRST_PASS: FirstPassState = Object.freeze({
  phase: Object.freeze({ kind: 'closed' as const }),
  decided: Object.freeze([]),
  scan: 0,
});

/**
 * One act on the surface.
 *
 * `candidates` and `scan-failed` are the two answers a scan can have, and both
 * carry the generation they were issued under — see the module header.
 */
export type FirstPassCommand =
  | { readonly kind: 'open' }
  | {
      readonly kind: 'candidates';
      readonly scan: number;
      readonly candidates: readonly Candidate[];
    }
  | { readonly kind: 'scan-failed'; readonly scan: number }
  | { readonly kind: 'queue'; readonly command: QueueCommand }
  | { readonly kind: 'close' }
  /**
   * Close, and forget the decisions too.
   *
   * A DIFFERENT SCANNER IS A DIFFERENT FIRST PASS. {@link CandidateId} is
   * opaque and host-minted, and `candidates.ts` promises only that it is stable
   * for a queue's life — so two independently written detectors may reuse the
   * same id for entirely different findings. Carrying one scanner's decisions
   * into another's scan would silently drop the next detector's question on an
   * id collision, which is the one failure a first pass cannot afford: a
   * question nobody was asked looks exactly like a question already answered.
   */
  | { readonly kind: 'reset' };

export interface FirstPassOutcome {
  readonly state: FirstPassState;
  /**
   * The queue transition, when one happened.
   *
   * Passed through UNCHANGED rather than interpreted: `QueueResult` already
   * carries the proposal an `apply` stands for and the answer an `undo` took
   * back, and re-deriving either here would be a second opinion about what the
   * queue just did.
   */
  readonly result: QueueResult | null;
  /**
   * The generation of a scan the caller must now run, or `null`.
   *
   * REPORTED RATHER THAN PERFORMED, because `findCandidates` returns a promise
   * and this reducer is pure. The caller runs the scan and sends the answer back
   * as `candidates` or `scan-failed` carrying this number.
   */
  readonly scanning: number | null;
}

function still(state: FirstPassState): FirstPassOutcome {
  return { state, result: null, scanning: null };
}

/**
 * The decided set after one queue transition.
 *
 * An added `apply` or `reject` joins it; an `undo` takes its candidate back out.
 * Neither case can collide with an id carried in from an earlier pass, because
 * the queue was built by filtering those ids out — so the set stays a set
 * without this function ever having to ask which pass an id came from.
 */
function decidedAfter(
  decided: readonly CandidateId[],
  before: QueueState,
  after: QueueState,
): readonly CandidateId[] {
  if (after.answers.length > before.answers.length) {
    const given: Answered | undefined = after.answers[after.answers.length - 1];
    if (given === undefined || given.answer === 'skip') return decided;
    return [...decided, given.candidate.id];
  }
  if (after.answers.length < before.answers.length) {
    const taken: Answered | undefined = before.answers[before.answers.length - 1];
    if (taken === undefined || taken.answer === 'skip') return decided;
    return decided.filter((id): boolean => id !== taken.candidate.id);
  }
  return decided;
}

/**
 * Apply one command. Total, pure, and never mutates what it is given.
 *
 * Every arm guards on the phase, and a command that does not belong to the
 * current phase changes nothing — the same call `queueReducer` makes about
 * answering a finished queue, and for the same reason: these arrive from a
 * reader going fast and from a promise settling late, so neither is an error.
 */
export function firstPassReducer(
  state: FirstPassState,
  command: FirstPassCommand,
): FirstPassOutcome {
  switch (command.kind) {
    case 'open': {
      // ONLY FROM `closed`. A second press while a scan is out must not issue a
      // second scan, and neither `open` nor `failed` is re-openable in place:
      // both draw a way out, and the way back in is through `closed`.
      if (state.phase.kind !== 'closed') return still(state);
      const scan = state.scan + 1;
      return {
        state: { ...state, phase: { kind: 'scanning' }, scan },
        result: null,
        scanning: scan,
      };
    }
    case 'candidates': {
      if (state.phase.kind !== 'scanning' || command.scan !== state.scan) return still(state);
      const decided = new Set(state.decided);
      // THE DECIDED ARE DROPPED BEFORE THE QUEUE IS BUILT, not hidden after, so
      // the denominator §17e bounds progress by counts what is actually being
      // asked. A queue of five that silently skips four would report "0 of 5".
      const fresh = command.candidates.filter((candidate) => !decided.has(candidate.id));
      return still({ ...state, phase: { kind: 'open', queue: openQueue(fresh) } });
    }
    case 'scan-failed': {
      if (state.phase.kind !== 'scanning' || command.scan !== state.scan) return still(state);
      return still({ ...state, phase: { kind: 'failed' } });
    }
    case 'queue': {
      if (state.phase.kind !== 'open') return still(state);
      const before = state.phase.queue;
      const result = queueReducer(before, command.command);
      return {
        state: {
          ...state,
          phase: { kind: 'open', queue: result.state },
          decided: decidedAfter(state.decided, before, result.state),
        },
        result,
        scanning: null,
      };
    }
    case 'close':
      // THE QUEUE GOES, `decided` STAYS. See the module header: dropping the
      // queue is what keeps a re-open fresh, and keeping the decisions is what
      // keeps it from re-asking. That holds for the SAME scanner; see `reset`.
      return still({ ...state, phase: { kind: 'closed' } });
    case 'reset':
      return still({ ...state, phase: { kind: 'closed' }, decided: [] });
  }
}

/** The queue on screen, or `null` when none is. For a shell deciding what to draw. */
export function openQueueOf(state: FirstPassState): QueueState | null {
  return state.phase.kind === 'open' ? state.phase.queue : null;
}
