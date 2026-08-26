/**
 * Candidates and a vocabulary for the first-pass tests.
 *
 * Built from a numeric seed rather than hand-written, for the reason
 * `testing/picker.ts` records about its own fixture: the queue's whole subject
 * is POSITION — which candidate is on screen, how many have been answered, what
 * an undo steps back to — and a fixture whose references are hand-typed makes
 * an off-by-one look like a passing test. Distinct digits per candidate mean a
 * wrong position is visible in the assertion rather than plausible.
 */

import type { EdgeKind } from '@issuegraph/store';

import type { Candidate } from '../firstpass/candidates.ts';
import type { FirstPassWords } from '../firstpass/words.ts';

/**
 * A vocabulary, in English because the test reader is reading English.
 *
 * Nothing in the package may produce any of these strings on its own, so their
 * content is a test's choice and not a default this file is smuggling in.
 */
export const FIRST_PASS_WORDS: FirstPassWords = Object.freeze({
  label: 'First pass',
  answers: Object.freeze({ apply: 'Yes', reject: 'No', skip: 'Later' }),
  answersLabel: 'Your answer',
  undo: 'Undo',
  evidence: 'Why',
  progress: (answered: number, found: number): string => `${String(answered)} of ${String(found)}`,
  finished: 'First pass complete',
  noCandidates: 'Nothing to encode',
});

/**
 * One candidate, keyed on an index.
 *
 * The pair is `<n>00` / `<n>01`, so both members of a candidate carry its index
 * and no two candidates share a reference. That makes "the queue emitted the
 * wrong candidate's proposal" a visible digit rather than a coincidence.
 */
export function candidateAt(index: number, kind: EdgeKind = 'blocked-by'): Candidate {
  const base = (index + 1) * 100;
  return {
    id: `c${String(index)}`,
    kind,
    from: String(base),
    to: String(base + 1),
    evidence: [{ token: 'shared-path', text: `both bodies reference file ${String(index)}` }],
  };
}

/** `count` candidates, in order. */
export function candidates(count: number, kind: EdgeKind = 'blocked-by'): readonly Candidate[] {
  return Array.from({ length: count }, (_unused, index) => candidateAt(index, kind));
}
