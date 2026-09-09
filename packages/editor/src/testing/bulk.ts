/**
 * A host vocabulary for §17e's multi-select block.
 *
 * Every entry distinct and none a substring of another, on `testing/workspace.ts`'s
 * standing rule — an assertion that finds one word must not be satisfiable by a
 * different one. AND NONE OF THEM IS THE THING IT NAMES: a fixture word has to
 * be one no renderer would write, or the pin and the hardcode are the same
 * string and the test is vacuous.
 */

import type { BulkWords } from '../firstpass/bulk-words.ts';

export const BULK_WORDS: BulkWords = {
  selected: (issues) => `${String(issues)} tickets marked`,
  gesture: 'hold shift while you point',
  offer: {
    'blocked-by': (issues) => `hold all ${String(issues)} behind one`,
    'serialize-with': (issues) => `queue all ${String(issues)} in turn`,
    'together-with': (issues) => `ship all ${String(issues)} at once`,
  },
  consequence: {
    'blocked-by': 'name the one',
    'serialize-with': 'a single queue',
    'together-with': 'a single rank',
  },
  pickTarget: 'which ticket holds them',
  review: 'work out what that costs',
  // BOTH QUANTITIES, and the anchor when there is one. The block's whole reason
  // for stating two numbers is that they differ, so a fixture that printed one
  // could not tell a correct confirm from a confirm that dropped an issue.
  writing: (writes) => `sending ${String(writes)} now`,
  confirm: (counts) =>
    counts.anchor === null
      ? `apply to ${String(counts.issues)} tickets by editing ${String(counts.writes)} bodies`
      : `apply to ${String(counts.issues)} tickets by editing ${String(counts.writes)} bodies around ${counts.anchor}`,
  cancel: 'put that back',
  notShown: (count) => `${String(count)} marked tickets are off the picture`,
  refusals: {
    'no-members': 'there is nobody else to relate it to',
    'direction-required': 'that kind must state which way it reads',
    'direction-not-applicable': 'that kind reads identically both ways',
    'anchor-cannot-carry': 'the one you named holds a single reference',
  },
  landed: (writes) => `${String(writes)} bodies were rewritten`,
  resume: (owed) => `${String(owed)} bodies were left untouched`,
  dismissRemainder: 'stop trying those',
  owedEdge: (from, to) => `${from} towards ${to}`,
};
