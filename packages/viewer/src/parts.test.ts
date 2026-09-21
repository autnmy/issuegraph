import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RankProvenance, ViewerSlot } from './document.ts';
import { provenanceClause, provenanceLine, slotPosition } from './parts.ts';
import { renderMarkup } from './element.ts';

/**
 * The three arms the design fixes, one fixture each.
 *
 * `promotion` appears twice on purpose: `promotedBy` empty is a real state —
 * the host knows the notation but named no dependent — and it is the one arm
 * whose clause is built conditionally, so it is the one most able to diverge
 * between the two callers.
 */
const ARMS: readonly (readonly [string, RankProvenance])[] = [
  ['matched-query', { kind: 'matched-query', index: 1, label: 'label:P0' }],
  ['declared-tier', { kind: 'declared-tier', priority: 2 }],
  ['promotion', { kind: 'promotion', notation: 'P3 → 0', promotedBy: ['512'] }],
  ['promotion, nothing named', { kind: 'promotion', notation: 'P3 → 0', promotedBy: [] }],
];

describe('provenanceClause', () => {
  it('carries no turnstile — that is the line, not the sentence', () => {
    for (const [name, provenance] of ARMS) {
      const markup = renderMarkup(provenanceClause(provenance)!);
      assert.ok(
        !markup.includes('ig-turn'),
        `${name}: the clause pulled §16's rail turnstile into the sentence`,
      );
      assert.ok(!markup.includes('↳'), `${name}: the clause carries a turnstile glyph`);
    }
  });

  it('answers null for absent provenance, as the line does', () => {
    assert.equal(provenanceClause(undefined), null);
    assert.equal(provenanceLine(undefined), null);
  });
});

describe('provenanceLine', () => {
  /**
   * THE PIN THAT MATTERS. §17a's inspector states the same provenance sentence
   * the §16 rail row states, and the whole reason `provenanceClause` was split
   * out is that ONE function should produce both — a second wording in layer 2
   * would be free to drift from this one, and a reader comparing the rail with
   * the panel would be told two things about one fact.
   *
   * Asserting the line CONTAINS the clause verbatim is what makes that
   * structural rather than aspirational: reword either half alone and this
   * fails.
   */
  it('is the turnstile plus exactly the clause, in every arm', () => {
    for (const [name, provenance] of ARMS) {
      const line = provenanceLine(provenance);
      assert.ok(line !== null, `${name}: no line`);
      assert.equal(line.tag, 'p');
      assert.equal(line.attrs?.['class'], 'ig-provenance');

      const children = line.children ?? [];
      assert.equal(children.length, 2, `${name}: expected the turnstile and the clause`);

      const [turnstile, clause] = children;
      assert.ok(
        turnstile !== undefined && turnstile !== null && typeof turnstile !== 'string',
        `${name}: the first child is not an element`,
      );
      assert.equal(turnstile.attrs?.['class'], 'ig-turn');
      assert.equal(
        turnstile.attrs?.['aria-hidden'],
        'true',
        `${name}: the turnstile is decoration and must stay out of the accessible name`,
      );

      assert.deepEqual(
        clause,
        provenanceClause(provenance),
        `${name}: the line's sentence is no longer the clause — one fact has two wordings`,
      );
    }
  });
});

/**
 * `slotPosition` is the one place "where does this sit, and may it start"
 * becomes a spoken phrase, and it is the function that used to infer HELD from
 * the ABSENCE OF A RANK. The projections' own tests reject that old expression,
 * but only over the cases a derived document produces — and `ViewerDocument` is
 * a public port, so the table below is the whole cross-product of the two
 * fields rather than the corner `@issuegraph/derive` happens to emit.
 *
 * TWO CASES HERE EXIST TO FAIL A PLAUSIBLE WRONG FIX, which is the point of a
 * regression test:
 *
 *  - `ready: true, rank: null`. A predicate spelled `!ready || rank === null`
 *    reads this as held and passes every projection test, because neither
 *    fixture contains it. `@issuegraph/derive` cannot emit it; a host composing
 *    a document by hand can, and it is not held — it is placed nowhere.
 *  - a numeric rank beside a `wouldBeRank`. The two are exclusive by
 *    construction upstream, so nothing downstream proves the phrase drops the
 *    would-be number when a real one exists. A host that supplies both must
 *    hear the rank it actually has, once.
 */
describe('slotPosition', () => {
  const slot = (
    ready: boolean,
    rank: number | null,
    wouldBeRank?: number | null,
  ): ViewerSlot => ({
    rank,
    lead: 'a',
    members: ['a'],
    ready,
    holds: ready ? [] : [{ family: 'graph', reason: 'blocked by b, which is open' }],
    ...(wouldBeRank === undefined ? {} : { wouldBeRank }),
  });

  const CASES: readonly (readonly [string, ViewerSlot, string])[] = [
    ['ready and placed', slot(true, 1), 'rank 1'],
    ['HELD and placed — §1 s first arm', slot(false, 2), 'held, rank 2'],
    ['held and unplaced', slot(false, null), 'held, no rank'],
    ['held and unplaced, would-be known', slot(false, null, 4), 'held, no rank, would be rank 4'],
    // READY AND UNPLACED: not held. The case a one-field predicate gets wrong.
    ['ready and unplaced', slot(true, null), 'no rank'],
    ['ready and unplaced, would-be known', slot(true, null, 4), 'no rank, would be rank 4'],
    // A NUMERIC RANK WINS OUTRIGHT: the would-be number is not appended to it.
    ['placed, would-be also supplied', slot(true, 1, 9), 'rank 1'],
    ['held, placed, would-be also supplied', slot(false, 2, 9), 'held, rank 2'],
    // An explicit null would-be is the same as none at all.
    ['held and unplaced, would-be explicitly null', slot(false, null, null), 'held, no rank'],
  ];

  for (const [name, value, expected] of CASES) {
    it(`says "${expected}" for a slot that is ${name}`, () => {
      assert.equal(slotPosition(value), expected);
    });
  }

  it('never announces a ready slot as held, however it is placed', () => {
    for (const rank of [null, 1, 7]) {
      assert.equal(
        slotPosition(slot(true, rank)).includes('held'),
        false,
        `a ready slot with rank ${String(rank)} was announced as held`,
      );
    }
  });

  it('always announces a held slot as held, however it is placed', () => {
    for (const rank of [null, 1, 7]) {
      assert.match(
        slotPosition(slot(false, rank)),
        /^held\b/,
        `a held slot with rank ${String(rank)} did not lead with held`,
      );
    }
  });
});
