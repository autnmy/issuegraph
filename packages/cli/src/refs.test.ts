import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { renderRef } from '@issuegraph/writer';

import { parseFrontmatter } from '@issuegraph/reader';
import { resolveRef } from './refs.ts';

describe('resolveRef', () => {
  test('accepts all three spellings the reader accepts', () => {
    assert.deepEqual(resolveRef('123'), { repo: null, id: '123' });
    assert.deepEqual(resolveRef('#123'), { repo: null, id: '123' });
    assert.deepEqual(resolveRef('owner/repo#123'), { repo: 'owner/repo', id: '123' });
  });

  test('trims surrounding whitespace', () => {
    assert.deepEqual(resolveRef('  42  '), { repo: null, id: '42' });
  });

  test('round-trips through the writer, so what it accepts is what we can write', () => {
    // The pin that matters: a token this resolves must render back to a spelling
    // the reader reads. If the two packages ever disagree, this goes red here
    // rather than in an issue body.
    //
    // ROUND-TRIPPED THROUGH THE READER, NOT BACK THROUGH `resolveRef`.
    // `renderRef` emits a YAML SCALAR — `"#1"`, quotes included — because §4.2
    // requires a `#`-sigil reference to be quoted. That is a spelling for a
    // BLOCK, not a token for a command line, so feeding it back to a token
    // parser would double-quote it and prove nothing. Placing it where the
    // writer would place it is the assertion that actually matters.
    for (const token of ['1', '#77', 'owner/repo#5', 'ABC-123']) {
      const ref = resolveRef(token);
      assert.notEqual(ref, null, token);
      if (ref === null) continue;
      const block = ['---', 'issuegraph:', '  blocked-by:', `    - ${renderRef(ref)}`, '---', ''].join('\n');
      const parse = parseFrontmatter(block);
      assert.deepEqual(parse.diagnostics, [], token);
      assert.deepEqual(parse.data?.blockedBy, [ref], token);
    }
  });

  test('rejects what is not a ref', () => {
    // NARROWED DELIBERATELY. A reference is now an opaque tracker-scoped
    // identifier (SPEC 4.2), so `not-a-ref`, `abc` and `1.5` are perfectly good
    // identifiers — that widening is the point of the format change, not a
    // regression here. What is still refused is what no tracker can name: an
    // empty token, a bare sigil, a non-canonical or non-positive number, and a
    // qualifier with no issue after it.
    for (const token of ['', '   ', '#', '#0', '0', '-1', 'owner/repo']) {
      assert.equal(resolveRef(token), null, `expected ${JSON.stringify(token)} to be refused`);
    }
  });

  test('accepts the opaque identifiers SPEC 4.2 admits', () => {
    // The other half, so the narrowing above cannot quietly become "accepts
    // everything": these are the shapes the widening exists for.
    for (const token of ['ABC-123', 'ENG-456', 'not-a-ref', 'abc']) {
      assert.notEqual(resolveRef(token), null, `expected ${JSON.stringify(token)} to resolve`);
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
      // `owner/repo` passes the character allowlist — every character in it is
      // legal — and is still refused, because a qualifier with no issue after
      // it names nothing. That is the property keeping the allowlist from
      // becoming a second grammar.
      //
      // `a/b#c` was this example until SPEC 4.2 widened identifiers: `c` is now
      // a perfectly good opaque id, so the pair resolves. Swapped rather than
      // deleted, because the property is still worth pinning.
      assert.equal(resolveRef('owner/repo'), null);
      assert.notEqual(resolveRef('a/b#c'), null, 'an opaque id after a qualifier now resolves');
    });
  });
});
