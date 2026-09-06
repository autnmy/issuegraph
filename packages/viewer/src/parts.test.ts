import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RankProvenance } from './document.ts';
import { provenanceClause, provenanceLine } from './parts.ts';
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
