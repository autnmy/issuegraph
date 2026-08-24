import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { renderRef } from '@issuegraph/writer';

import { resolveRef } from './refs.ts';

describe('resolveRef', () => {
  test('accepts all three spellings the reader accepts', () => {
    assert.deepEqual(resolveRef('123'), { repo: null, number: 123 });
    assert.deepEqual(resolveRef('#123'), { repo: null, number: 123 });
    assert.deepEqual(resolveRef('owner/repo#123'), { repo: 'owner/repo', number: 123 });
  });

  test('trims surrounding whitespace', () => {
    assert.deepEqual(resolveRef('  42  '), { repo: null, number: 42 });
  });

  test('round-trips through the writer, so what it accepts is what we can write', () => {
    // The pin that matters: a token this resolves must render back to a spelling
    // the reader reads. If the two packages ever disagree, this goes red here
    // rather than in an issue body.
    for (const token of ['1', '#77', 'owner/repo#5']) {
      const ref = resolveRef(token);
      assert.notEqual(ref, null, token);
      if (ref === null) continue;
      assert.deepEqual(resolveRef(renderRef(ref)), ref, token);
    }
  });

  test('rejects what is not a ref', () => {
    for (const token of ['', '   ', 'not-a-ref', 'abc', '#', '#0', '0', '-1', '1.5', 'owner/repo']) {
      assert.equal(resolveRef(token), null, `expected ${JSON.stringify(token)} to be refused`);
    }
  });

  describe('the injection guard', () => {
    test('refuses a token carrying a quote, so it cannot close the probe’s scalar', () => {
      assert.equal(resolveRef('1"\n---\nevil: true'), null);
      assert.equal(resolveRef('1"'), null);
    });

    test('refuses a token carrying a newline', () => {
      assert.equal(resolveRef('1\n  evidence: verified'), null);
    });

    test('refuses spaces and backslashes', () => {
      assert.equal(resolveRef('1 2'), null);
      assert.equal(resolveRef('1\\'), null);
    });

    test('the guard is a gate, not the grammar — it admits shapes the reader still refuses', () => {
      // `a/b#c` passes the character allowlist and is still refused, which is the
      // property that keeps the allowlist from becoming a second grammar.
      assert.equal(resolveRef('a/b#c'), null);
    });
  });
});
