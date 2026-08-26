/**
 * One edge of a chosen kind, and a vocabulary to word it with.
 *
 * The picker's whole subject is the difference between the kinds, so every test
 * here runs the same document over all five of them — and building the document
 * from the kind rather than hand-writing five keeps the arithmetic of "which
 * pair is which way round" in one place. A fixture whose pair disagrees with the
 * statement under test proves nothing, and that is invisible when the two are
 * written out separately in each assertion.
 */

import {
  type EdgeKind,
  type GraphDocument,
  type StoredEdge,
  makeEdge,
} from '@issuegraph/store';

import type { PickerWords } from '../picker/words.ts';

/** The subject of a directed statement. */
export const SUBJECT = '530';
/** Its object. Distinct digits, so a reversed pair is visible in an assertion. */
export const OBJECT = '602';

/**
 * A vocabulary, in English because the test reader is reading English.
 *
 * Nothing in the package may produce any of these strings on its own — that is
 * exactly what `render.test.ts` asserts — so their content is a test's choice
 * and not a default this file is smuggling in.
 */
export const PICKER_WORDS: PickerWords = Object.freeze({
  kinds: Object.freeze({
    'blocked-by': 'is blocked by',
    'decomposed-from': 'is part of',
    'duplicate-of': 'duplicates',
    'serialize-with': 'is serialized with',
    'together-with': 'travels with',
  }),
  heading: 'Relationship',
  flip: 'Flip',
  current: 'current',
});

/** A two-issue document carrying exactly one edge, of the kind asked for. */
export function documentWith(kind: EdgeKind): GraphDocument {
  return {
    issues: [
      { ref: SUBJECT, title: 'The subject', state: 'open' },
      { ref: OBJECT, title: 'The object', state: 'open' },
    ],
    edges: [makeEdge(kind, SUBJECT, OBJECT)],
  };
}

/** The one edge such a document holds. Throws rather than returning undefined. */
export function onlyEdge(document: GraphDocument): StoredEdge {
  const edge = document.edges[0];
  if (edge === undefined) throw new Error('the fixture document holds no edge');
  return edge;
}
