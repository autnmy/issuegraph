/**
 * The first-pass review queue: one candidate, one keystroke, one answer.
 *
 * §17e's loop is `Y` / `N` / `S` with `⌫` to undo, over candidates the host
 * found. This module is the whole of that as a reducer — the same shape
 * `create/draft.ts` and `scale/commands.ts` already use here, so a host
 * reducing one reduces this without learning a second protocol.
 *
 * ## Nothing is applied without a keystroke, and the shape is what guarantees it
 *
 * §17e gives the reason and it is worth quoting rather than paraphrasing: "A
 * wrong `duplicate-of` silently removes real work from the order, so it always
 * costs one keystroke of consent."
 *
 * A `duplicate-of` excludes an issue from the order ENTIRELY. Applied without
 * consent, that is work vanishing from the backlog while looking handled — the
 * dead-duplicate audit class arriving through automation instead of decay.
 *
 * So consent is structural rather than promised: the ONLY thing in this module
 * that returns a non-null proposal is the `answer` command carrying
 * {@link Answer} `apply`, and nothing else here constructs one at all. Advancing
 * the queue, loading it, rendering it and undoing all emit `null` because there
 * is no code path on which they could emit anything else. `queue.test.ts` pins
 * it from the other side — a whole queue driven to exhaustion by `reject` and
 * `skip` dispatches nothing — and `render.test.ts` pins the surface: drawing a
 * candidate is not answering it.
 *
 * ## Progress is bounded by CANDIDATES, and never by backlog size
 *
 * "Progress is bounded by candidates found, not backlog size, so first pass has
 * an end. 100% encoded is never the goal and the workspace never implies it is
 * — most issues legitimately have no relationships."
 *
 * The denominator is therefore {@link QueueState.candidates}`.length` and this
 * module is never told how many issues exist — it cannot compute the wrong
 * denominator because it does not hold the number that would be wrong. An owner
 * with 248 legitimately-isolated issues is not shown "20% done"; they are shown
 * a queue of 64 questions with an end, which is the difference between a
 * surface that gets finished and one that gets abandoned.
 *
 * ## Undo returns the QUESTION; it does not retract the WRITE
 *
 * `⌫` steps the cursor back and un-answers the candidate. What it cannot do is
 * un-dispatch a proposal that already went to the store — that is the store's
 * undo, over its own mutation set, and a second retraction path out here would
 * be free to disagree with it about what undoing a create means.
 *
 * So an undo that withdraws an `apply` REPORTS the withdrawal
 * ({@link QueueResult.withdrawn}) and the host routes it to the store. The
 * queue's own state is honest either way: the candidate is unanswered again,
 * which is what the reader just asked for.
 */

import type { Proposal } from '@issuegraph/store';

import type { Candidate, CandidateId } from './candidates.ts';

/**
 * What an owner said about a candidate.
 *
 * Three, closed by §17e, and named for the DECISION rather than for the key —
 * `apply` rather than `yes`, because the keyboard spelling belongs to
 * {@link ./keys.ts} and a rebinding must not have to reach in here.
 *
 * - `apply` — yes, create it. The one answer that emits.
 * - `reject` — no, this is not a relationship. Answered, and gone.
 * - `skip` — not now. Answered for the purpose of PROGRESS, because the owner
 *   did the work of looking; deferring it into a second pass would make the
 *   progress bar a lie in the direction that matters, by never letting a queue
 *   with hard cases in it end.
 */
export type Answer = 'apply' | 'reject' | 'skip';

/** A candidate, and what was said about it. */
export interface Answered {
  readonly candidate: Candidate;
  readonly answer: Answer;
}

/**
 * The queue.
 *
 * `cursor` indexes {@link candidates} and is the number of answers given, which
 * is not a coincidence to be maintained but the reason there is no second
 * field: answers are given in order and undone in order, so the two cannot
 * drift. `answers[i]` is the answer to `candidates[i]`.
 */
export interface QueueState {
  /** Everything the host found. The denominator, and never anything else. */
  readonly candidates: readonly Candidate[];
  /** How far in. Equal to `answers.length`; past the end means finished. */
  readonly cursor: number;
  /** What was said, oldest first. */
  readonly answers: readonly Answered[];
}

/** A queue over the candidates a host supplied, with nothing answered yet. */
export function openQueue(candidates: readonly Candidate[]): QueueState {
  return { candidates, cursor: 0, answers: [] };
}

/**
 * One act.
 *
 * `answer` carries the DECISION and not the candidate: the queue shows exactly
 * one candidate, so which one is being answered is the queue's own state rather
 * than something a caller can get wrong. A command naming a candidate would
 * admit answering one that is not on screen, which is consent for a question
 * nobody was asked.
 */
export type QueueCommand =
  | { readonly kind: 'answer'; readonly answer: Answer }
  | { readonly kind: 'undo' };

/**
 * The next queue, what this transition emitted, and what it took back.
 *
 * Three fields rather than a union because a host wires all three once —
 * `state` always, `proposal` to the store, `withdrawn` to the store's undo —
 * and a union would make the ordinary reduction a switch over cases that mostly
 * do the same thing. Same reasoning `CreateResult` records for its pair.
 */
export interface QueueResult {
  readonly state: QueueState;
  /** Non-null on exactly one transition: an `apply`. */
  readonly proposal: Proposal | null;
  /**
   * The answer an `undo` took back, or `null`.
   *
   * A withdrawn `apply` is the one the host must act on — its proposal is
   * already at the store. A withdrawn `reject` or `skip` dispatched nothing, so
   * there is nothing to undo beyond the queue position, and it is reported
   * anyway so the host has one code path rather than two.
   */
  readonly withdrawn: Answered | null;
}

/** Progress, as §17e defines it. */
export interface QueueProgress {
  /** Answers given. */
  readonly answered: number;
  /**
   * Candidates FOUND. The denominator, and the whole point of this type.
   *
   * Named `found` rather than `total` deliberately: `total` is the word that
   * invites a reader to reach for the backlog size, and this number is not
   * that. See the module header.
   */
  readonly found: number;
  /** Still to answer. */
  readonly remaining: number;
  /** Nothing left. A queue over no candidates is finished immediately. */
  readonly finished: boolean;
}

export function queueProgress(state: QueueState): QueueProgress {
  const found = state.candidates.length;
  const answered = state.answers.length;
  return { answered, found, remaining: found - answered, finished: answered >= found };
}

/**
 * The candidate on screen, or `null` when the queue is finished.
 *
 * `null` rather than a sentinel candidate: "there is nothing to answer" is a
 * genuinely different state from "here is a question", and a placeholder would
 * be answerable.
 */
export function currentCandidate(state: QueueState): Candidate | null {
  return state.candidates[state.cursor] ?? null;
}

const NOTHING: Omit<QueueResult, 'state'> = Object.freeze({ proposal: null, withdrawn: null });

/**
 * The proposal an `apply` stands for.
 *
 * ITS OWN FUNCTION, so the module has exactly one place that builds a
 * `Proposal` and the consent claim in the header is checkable by reading rather
 * than by trusting. It is also the only reason `Proposal` is imported at all.
 */
function proposalFor(candidate: Candidate): Proposal {
  return { op: 'create', kind: candidate.kind, from: candidate.from, to: candidate.to };
}

/**
 * Apply one command. Total, pure, and never mutates what it is given.
 *
 * An exhaustive switch over a discriminated union — the one branching form
 * `AGENTS.md`'s boundary rule leaves open, and the shape every reducer in this
 * package already uses. Adding a command without a case fails the build.
 */
export function queueReducer(state: QueueState, command: QueueCommand): QueueResult {
  switch (command.kind) {
    case 'answer': {
      const candidate = currentCandidate(state);
      // ANSWERING A FINISHED QUEUE IS A NO-OP, not an error and not a wrap-round.
      // A key press racing the last answer is ordinary — the reader is going
      // fast, which is the design target — and the alternatives are both worse
      // than doing nothing: throwing turns a fast reader into an error dialog,
      // and wrapping re-asks a question they already answered.
      if (candidate === null) return { state, ...NOTHING };
      const answered: Answered = { candidate, answer: command.answer };
      const next: QueueState = {
        ...state,
        cursor: state.cursor + 1,
        answers: [...state.answers, answered],
      };
      // THE ONLY EMISSION IN THIS MODULE. `reject` and `skip` advance and say
      // nothing, which is what makes "no candidate is applied without a
      // keystroke" a property of the shape rather than a promise.
      return {
        state: next,
        proposal: command.answer === 'apply' ? proposalFor(candidate) : null,
        withdrawn: null,
      };
    }
    case 'undo': {
      const last = state.answers[state.answers.length - 1];
      // Nothing answered is nothing to undo. Same reasoning as above: the key
      // is handed back rather than made into an error.
      if (last === undefined) return { state, ...NOTHING };
      return {
        state: {
          ...state,
          cursor: state.cursor - 1,
          answers: state.answers.slice(0, -1),
        },
        proposal: null,
        withdrawn: last,
      };
    }
  }
}

/**
 * The candidates an owner deferred, in the order they were deferred.
 *
 * §17e's `S` is "not now" rather than "no", so the deferred set is the thing a
 * second pass is built from — and it is DERIVED here rather than accumulated in
 * {@link QueueState}, so an undo cannot leave it disagreeing with the answers
 * it summarises. That is the same reason `queueProgress` derives its counts:
 * two fields recording one fact is one fact that can be wrong.
 */
export function skippedCandidates(state: QueueState): readonly Candidate[] {
  return state.answers
    .filter((answered): boolean => answered.answer === 'skip')
    .map((answered): Candidate => answered.candidate);
}

/**
 * Whether a candidate has already been answered in this queue.
 *
 * For a host merging a fresh candidate set into an open queue — a second
 * detector finishing late, say. It asks by {@link CandidateId} because that is
 * the identity the HOST minted, for exactly the reason `candidates.ts` records:
 * two findings about the same pair are not necessarily the same finding.
 */
export function isAnswered(state: QueueState, id: CandidateId): boolean {
  return state.answers.some((answered): boolean => answered.candidate.id === id);
}
