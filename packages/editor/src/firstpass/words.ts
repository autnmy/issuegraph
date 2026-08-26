/**
 * The words. Supplied by the host, never by this package.
 *
 * Same contract `reevaluate/words.ts` and `picker/words.ts` already carry here,
 * and this surface has the strongest claim on it of the three: what is being
 * worded is a QUESTION about a relationship, asked of an owner who is about to
 * answer sixty of them at speed. A phrase written in would be an English clause
 * in the one place the design says the reader most needs to be sure what they
 * are agreeing to.
 *
 * REQUIRED, NOT DEFAULTED, on the same reasoning `StoreConfig.derive` is
 * required: a default vocabulary is a second implementation of the thing the
 * host was asked to supply, and a language choice this package is not entitled
 * to make. A host that ships a default gets one it cannot theme away and cannot
 * translate.
 *
 * ## Progress is worded by the host too, and that is not an oversight
 *
 * §17e is emphatic that "100% encoded is never the goal and the workspace never
 * implies it is". The number is safe — {@link ./queue.ts queueProgress} cannot
 * compute the wrong denominator — but the SENTENCE around it is where the
 * implication would creep back in: "12 of 64 complete" reads as a target where
 * "12 of 64 answered" reads as an activity. That is a wording decision with a
 * design consequence, which is exactly the kind this package hands over rather
 * than makes.
 */

import type { Answer } from './queue.ts';

export interface FirstPassWords {
  /**
   * One label per answer.
   *
   * `Record<Answer, string>` rather than a partial map: an answer with no word
   * would render a bare control, and the reader would be one keystroke from
   * consenting to something unlabelled. Adding an answer fails a host's build
   * here, which is where it can be fixed.
   */
  readonly answers: Readonly<Record<Answer, string>>;
  /**
   * Names the group of answer controls, for assistive technology.
   *
   * ITS OWN ENTRY rather than reusing {@link evidence}, which an earlier
   * revision did: a group of buttons labelled "Why" tells a screen-reader user
   * that the three controls are the evidence, which is the opposite of what
   * they are. The two blocks sit next to each other and name different things,
   * so they need different words — and a shared one is the sort of label that
   * looks fine in markup and is wrong only when read aloud.
   */
  readonly answersLabel: string;
  /** The undo control. */
  readonly undo: string;
  /**
   * Names the evidence block — what the host calls the reasons it offered.
   *
   * The evidence ITEMS are the host's own sentences already
   * ({@link ./candidates.ts CandidateEvidence}); this words the container they
   * sit in, which is the only part of that block this package draws.
   */
  readonly evidence: string;
  /**
   * Words the progress indicator, given the two numbers.
   *
   * A FUNCTION rather than a template string, because the grammar around a
   * count is not substitutable across languages — plural forms, number
   * agreement and word order all depend on the values themselves. A
   * `"{answered} of {found}"` field would work in English and quietly produce
   * wrong grammar everywhere else, which is the failure this package hands the
   * whole decision over to avoid.
   */
  readonly progress: (answered: number, found: number) => string;
  /**
   * Shown when every candidate has been answered.
   *
   * NOT AN EMPTY STATE — the finding, in the sense `reevaluate/words.ts` uses
   * the distinction. A finished first pass is the design's success condition,
   * and §17e insists it be reachable rather than asymptotic.
   */
  readonly finished: string;
  /**
   * Shown when the host found no candidates at all.
   *
   * DISTINCT FROM {@link finished}, and the distinction matters more than it
   * looks: "there was nothing to encode" and "you encoded everything" are
   * different facts about the backlog, and collapsing them would tell an owner
   * whose detector is misconfigured that they were done.
   */
  readonly noCandidates: string;
}
