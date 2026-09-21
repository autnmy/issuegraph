import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RankProvenance, ViewerHold, ViewerSlot } from './document.ts';
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
 * FOUR CASES HERE EXIST TO FAIL A PLAUSIBLE WRONG FIX, which is the point of a
 * regression test — it has to fail for the next person, not pass for the one
 * who wrote it. Each names the spelling it is here to kill:
 *
 *  - `ready: true, rank: null` kills `rank === null` and `!ready || rank ===
 *    null`. Both read it as held, and both pass every projection test, because
 *    no projection fixture contains it. `@issuegraph/derive` cannot emit it; a
 *    host composing a `ViewerDocument` by hand can, and it is not held — it is
 *    placed nowhere.
 *  - `ready: false, holds: []` and `ready: true, holds: [hold]` kill
 *    `holds.length > 0`. That spelling ignores the authoritative field
 *    altogether and agreed with every other case in this table, because the
 *    convenience fixture moves `holds` with `ready`. See `slot` below.
 *  - a numeric rank beside a `wouldBeRank`. The two are exclusive by
 *    construction upstream, so nothing downstream proves the phrase drops the
 *    would-be number when a real one exists. A host that supplies both must
 *    hear the rank it actually has, once.
 */
describe('slotPosition', () => {
  const HOLD: ViewerHold = { family: 'graph', reason: 'blocked by b, which is open' };

  /**
   * A slot whose `holds` FOLLOW its `ready`, for convenience — which is the
   * ordinary case and a coupling this table has to break on purpose.
   *
   * WHILE THE TWO MOVE TOGETHER, NO CASE HERE CAN TELL THEM APART, and a
   * predicate spelled `holds.length > 0` passes every one of them while
   * ignoring the authoritative field entirely. `ViewerSlot` is explicit about
   * which is which: `ready` is the VERDICT and `holds` are the EXPLANATION, so
   * a host may legally state a held slot that explains nothing. `decoupled`
   * below builds exactly that, and the two cases using it are the only inputs
   * that separate "held" from "has holds" — do not fold them back into `slot`.
   */
  const slot = (
    ready: boolean,
    rank: number | null,
    wouldBeRank?: number | null,
  ): ViewerSlot => ({
    rank,
    lead: 'a',
    members: ['a'],
    ready,
    holds: ready ? [] : [HOLD],
    ...(wouldBeRank === undefined ? {} : { wouldBeRank }),
  });

  /** A slot whose `holds` CONTRADICT its `ready`. Only `ready` may decide. */
  const decoupled = (ready: boolean, rank: number | null, holds: readonly ViewerHold[]): ViewerSlot => ({
    rank,
    lead: 'a',
    members: ['a'],
    ready,
    holds,
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
    // ── THE TWO THAT BREAK THE FIXTURE'S OWN COUPLING ───────────────────────
    //
    // Everything above moves `holds` with `ready`, so `holds.length > 0` is
    // indistinguishable from `!ready` across all of it — and that spelling is
    // the defect this whole change removed, reachable again with nothing to
    // object. These two are the separating inputs, one per direction.
    //
    // A HELD SLOT THAT EXPLAINS NOTHING. `holds.length > 0` returns `rank 2`
    // here and drops the word held, which is precisely the bug.
    ['held with an EMPTY holds array', decoupled(false, 2, []), 'held, rank 2'],
    // And the inverse: a hold listed on a slot its host says is ready. The
    // explanation does not get to overrule the verdict either.
    ['ready despite a hold being listed', decoupled(true, 2, [HOLD]), 'rank 2'],
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
