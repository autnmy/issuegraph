import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS } from '@issuegraph/core';

import { EDGE_TREATMENTS, dashArrayFor, treatmentFor } from './vocabulary.ts';

describe('the edge vocabulary', () => {
  it('treats every relationship the format declares', () => {
    // Iterating the FORMAT's list rather than this table's own keys is the
    // point: a field added upstream must fail here, not render untreated.
    for (const field of EDGE_FIELDS) {
      assert.ok(treatmentFor(field), `${field} has no treatment`);
    }
    assert.equal(Object.keys(EDGE_TREATMENTS).length, EDGE_FIELDS.length);
  });

  it('keeps all five distinguishable with hue removed entirely', () => {
    // The colour-blind-safety claim, asserted as a property of the table: strip
    // the hue token and the remaining three channels must still separate every
    // pair. A collision here silently drops the encoding to three channels.
    const withoutHue = EDGE_FIELDS.map((field) => {
      const treatment = treatmentFor(field);
      return `${treatment.dash}|${treatment.terminal}|${treatment.glyph}`;
    });

    assert.equal(new Set(withoutHue).size, EDGE_FIELDS.length, withoutHue.join(' , '));
  });

  it('gives each relationship its own hue token as well', () => {
    const hues = EDGE_FIELDS.map((field) => treatmentFor(field).hueToken);
    assert.equal(new Set(hues).size, EDGE_FIELDS.length);
  });

  it('names a hue token, never a literal colour', () => {
    for (const field of EDGE_FIELDS) {
      assert.match(treatmentFor(field).hueToken, /^--ig-/);
    }
  });

  it('marks exactly the direction-free fields symmetric', () => {
    const symmetric = EDGE_FIELDS.filter((field) => treatmentFor(field).symmetric);
    assert.deepEqual(symmetric.sort(), ['serialize-with', 'together-with']);
  });

  it('separates decomposed-from and duplicate-of on their terminals', () => {
    // The pair the design calls out: the terminal is the only channel that
    // separates a tee from a hollow circle once colour is gone.
    assert.equal(treatmentFor('decomposed-from').terminal, 'tee');
    assert.equal(treatmentFor('duplicate-of').terminal, 'hollow-circle');
  });

  it('reports a dash array only for the patterns that are one', () => {
    assert.equal(dashArrayFor('solid'), null);
    assert.equal(dashArrayFor('double'), null);
    assert.equal(dashArrayFor('dotted'), '1 3');
    assert.equal(dashArrayFor('dashed'), '6 4');
    assert.equal(dashArrayFor('enclosure'), '3 3');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(EDGE_TREATMENTS));
  });
});
