/**
 * What a first-pass candidate IS, and the port it arrives through.
 *
 * §17e describes the adoption moment: a mature backlog arrives with 312 issues
 * and zero relationships. "A blank canvas is the wrong tool: the owner doesn't
 * want to draw 60 edges, they want to answer 60 questions." So the first pass
 * is a review QUEUE — one proposed relationship at a time, with the evidence
 * that suggested it, answerable in two seconds.
 *
 * ## The package ships no scanner, and that is a boundary rather than a gap
 *
 * The evidence §17e names — "both bodies reference `src/auth/session.ts`",
 * "#455 is linked from a comment on #512" — is not derivable from a
 * `GraphDocument`. It needs issue BODIES, COMMENTS and the host's own index,
 * which is the tracker's world and precisely what `@issuegraph/store` refuses
 * to fetch. A heuristic living in here would be an un-themeable product opinion
 * shipped inside a published package: every host would get one vendor's idea of
 * what "looks like a duplicate" means, with no way to replace it and no way to
 * tune it against their own backlog.
 *
 * So candidates come IN, with their evidence already attached, exactly as
 * `StoreConfig.derive` takes an order rather than inventing one. The port below
 * is the declared shape of that crossing; nothing here implements it.
 *
 * ## Evidence carries the host's WORDS, not ours
 *
 * The same rule `reevaluate/words.ts` records, arriving through a different
 * door. A sentence explaining why two issues might be duplicates is a claim
 * about the host's tracker in the host's language, so this package cannot write
 * one — and unlike the re-evaluate summary there is not even a fixed vocabulary
 * to word, because the SET of reasons a host can offer is the host's to grow.
 *
 * What this package supplies instead is the {@link CandidateEvidence.token}: a
 * machine-readable handle a host can style and a test can assert on, carried
 * beside the prose rather than derived from it. That keeps the rendered surface
 * testable without this package ever reading, parsing or authoring the text.
 */

import type { EdgeKind, IssueRef } from '@issuegraph/store';

/**
 * A candidate's identity, stable across a queue's life.
 *
 * OPAQUE TO THIS PACKAGE, and deliberately not derived from the relationship it
 * proposes. Two candidates can legitimately propose the same pair with the same
 * kind on different evidence — a host running two detectors will produce
 * exactly that — and an identity computed from `from`/`to`/`kind` would silently
 * collapse them, losing one detector's evidence and one of the owner's answers.
 *
 * The host mints it because the host knows what it means for two of its own
 * findings to be the same finding.
 */
export type CandidateId = string;

/**
 * One reason a candidate was proposed.
 *
 * `text` is the host's sentence and this package renders it verbatim: it never
 * reads it, never parses it, and never writes one of its own.
 */
export interface CandidateEvidence {
  /**
   * A machine-readable handle for this KIND of reason — `shared-path`,
   * `linked-from-comment`, whatever the host's detectors are called.
   *
   * It reaches the markup as a data attribute, so a host styles one class of
   * evidence differently and a test asserts a candidate carried the reason it
   * should have, both without matching on prose. This package assigns it no
   * meaning and holds no list of legal values — a closed set here would be the
   * scanner opinion the module header refuses, one layer down.
   */
  readonly token: string;
  /** The host's own words. Rendered as given. */
  readonly text: string;
}

/**
 * One proposed relationship, and why.
 *
 * It is shaped as the `create` proposal it would become — `kind`, `from`, `to`
 * — rather than as a looser "these two look related". A candidate that cannot
 * name the relationship it is proposing is not answerable in two seconds, which
 * is the whole design target; the owner would have to open the picker for every
 * one, and the queue would be the canvas again with extra steps.
 */
export interface Candidate {
  readonly id: CandidateId;
  /** Which relationship is being proposed. */
  readonly kind: EdgeKind;
  /** The issue the relationship would be created FROM. */
  readonly from: IssueRef;
  /** The issue it would be created TO. */
  readonly to: IssueRef;
  /**
   * Why the host thinks so. At least one, by construction of a useful queue —
   * but not enforced here, because a host with a detector that genuinely cannot
   * explain itself should be able to say so by sending none rather than by
   * inventing a sentence.
   */
  readonly evidence: readonly CandidateEvidence[];
}

/**
 * The port. A host implements it; this package calls it and ships no default.
 *
 * ASYNC because finding candidates means reading the tracker — bodies,
 * comments, an index — and every honest implementation of that is a network
 * round trip. Modelling it as synchronous would force hosts to pre-compute the
 * whole set before the surface could open, which at §17f's sizes is the wrong
 * shape.
 *
 * NO DEFAULT IMPLEMENTATION, on the same reasoning `StoreConfig.derive` carries:
 * a default would be a second implementation of the thing the host was asked to
 * supply, and the first one anybody hit a limitation with would be impossible to
 * replace because it was already load-bearing.
 *
 * The queue itself takes a resolved `readonly Candidate[]` rather than this
 * port, so the reducer stays pure and synchronously testable. The port is what
 * the SHELL holds; the queue is what the shell drives with the answer.
 */
export interface CandidateSource {
  /**
   * Every candidate the host can find for this document, with its evidence.
   *
   * "Every" is the host's to bound. §17e fixes what this package does with the
   * count rather than what the count should be: progress is measured against
   * candidates FOUND, so a host that returns its best 40 gets a queue with an
   * end at 40, and one that returns 600 gets a queue with an end at 600.
   * Neither is a truncation this package can detect or should report.
   */
  readonly findCandidates: () => Promise<readonly Candidate[]>;
}
