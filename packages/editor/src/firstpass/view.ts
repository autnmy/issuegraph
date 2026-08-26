/**
 * The queue as a view model: one question, its evidence, and where you are.
 *
 * Everything a shell needs to draw the first pass, and nothing about how. Same
 * split `picker/view.ts` and `reevaluate/view.ts` keep — the model is
 * exhaustively testable on a runtime with no DOM, and `render.ts` is left with
 * nothing to get wrong except markup.
 *
 * ## The three states are a union, not a candidate plus two flags
 *
 * A queue is showing a question, or it has finished, or the host found nothing
 * to ask about. Modelled as one nullable candidate beside a `finished` boolean,
 * two of the four combinations would be unreachable and a renderer would still
 * have to answer for them. As a union each state carries exactly the fields it
 * has, and §17e's insistence that an empty queue and a completed queue read
 * DIFFERENTLY becomes something the type enforces rather than something a
 * renderer remembers.
 *
 * ## Progress rides on every state
 *
 * Including `finished` — an owner who just answered the last question wants to
 * see the 64 they answered, not a bare congratulation. And including `empty`,
 * where it is honestly zero of zero: §17e's rule is that the denominator is
 * candidates found, and a host that found none has a denominator, not a missing
 * one.
 */

import type { Candidate } from './candidates.ts';
import { type QueueProgress, type QueueState, currentCandidate, queueProgress } from './queue.ts';

/**
 * The question on screen.
 *
 * It restates the candidate's own fields rather than nesting it, so a renderer
 * reads `view.subject` instead of `view.candidate.from` — and so the ordered
 * pair is named for what it MEANS in the sentence being asked. Nothing here
 * chooses a word order; that is `render.ts`'s default and a host may bypass it,
 * exactly as the picker's statement is bypassable.
 */
export interface FirstPassQuestion {
  readonly candidate: Candidate;
  /** The issue the proposed relationship starts from. */
  readonly subject: string;
  /** The issue it points at. */
  readonly object: string;
  /** Which relationship is proposed. */
  readonly kind: string;
  /** Why the host proposed it. May be empty — see `candidates.ts`. */
  readonly evidence: readonly { readonly token: string; readonly text: string }[];
}

/**
 * What the surface is showing.
 *
 * `asking` carries the question; the other two carry none, because there is
 * none. A discriminated union so a renderer's switch is exhaustive and a fourth
 * state — were the design ever to grow one — is a compile error rather than a
 * blank panel.
 */
export type FirstPassView =
  | { readonly state: 'asking'; readonly question: FirstPassQuestion; readonly progress: QueueProgress }
  | { readonly state: 'finished'; readonly progress: QueueProgress }
  | { readonly state: 'empty'; readonly progress: QueueProgress };

/**
 * The view for a queue. Total and pure.
 *
 * `empty` is decided by the DENOMINATOR rather than by the cursor, which is the
 * one subtlety here: a queue of zero candidates is finished the moment it
 * opens, so a test on `finished` alone would report the misconfigured-detector
 * case as a completed first pass. §17e's two facts stay separate because the
 * question asked to tell them apart is "did the host find anything?", not "is
 * there anything left?".
 */
export function firstPassView(state: QueueState): FirstPassView {
  const progress = queueProgress(state);
  if (progress.found === 0) return { state: 'empty', progress };

  const candidate = currentCandidate(state);
  if (candidate === null) return { state: 'finished', progress };

  return {
    state: 'asking',
    progress,
    question: {
      candidate,
      subject: candidate.from,
      object: candidate.to,
      kind: candidate.kind,
      // COPIED RATHER THAN PASSED THROUGH, so the view model is a plain value a
      // host can serialise, compare or snapshot without carrying a reference
      // into the candidate set it came from.
      evidence: candidate.evidence.map((item) => ({ token: item.token, text: item.text })),
    },
  };
}
