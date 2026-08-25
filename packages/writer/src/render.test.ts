/**
 * THE ROUND-TRIP PIN, ACROSS THE PACKAGE BOUNDARY.
 *
 * The renderer is the parser's exact inverse, and every spelling decision —
 * bare integers, unquoted `owner/repo#N`, field order, the fence armor — is
 * pinned here by feeding the rendered block straight back through
 * `@issuegraph/reader`'s `parseFrontmatter`, the same reader every conforming
 * consumer runs.
 *
 * IT MATTERS THAT THE READER IS IMPORTED RATHER THAN RESTATED. While both
 * halves lived in one package a local test could pin them by construction;
 * shipped separately they can be released apart, and only an assertion that
 * crosses the boundary notices when one moves. That is what this file is.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseFrontmatter } from '@issuegraph/reader';

import { expectedParseOfRender, renderFrontmatter, type RenderInput } from './render.ts';

const FULL: RenderInput = {
  blockedBy: [
    { repo: null, id: '12' },
    { repo: 'acme/widgets', id: '7' },
  ],
  decomposedFrom: { repo: null, id: '3' },
  duplicateOf: null,
  serializeWith: { repo: null, id: '44' },
  togetherWith: { repo: 'acme/widgets', id: '9' },
  priority: 1,
  evidence: 'verified',
};

describe('renderFrontmatter', () => {
  it('round-trips the full field set through the reader (bare default)', () => {
    const block = renderFrontmatter(FULL);
    assert.notEqual(block, null);
    // THE SHAPE ITSELF is an assertion the round-trip cannot make: the parser
    // sees through both forms (§4.1), so only a shape pin notices the default
    // moving. Two things are pinned, and both are what makes the bare form
    // render correctly AND auto-link on a markdown tracker.
    assert.ok((block as string).startsWith('---\nissuegraph:'), 'no fence by default');
    assert.ok(
      (block as string).endsWith('\n\n---'),
      'a BLANK line before the closing delimiter, or the renderer reads it as a setext heading',
    );
    assert.ok(!(block as string).includes('```'));
    const parsed = parseFrontmatter(`${block as string}\n\nThe issue body.\n`);
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.data, expectedParseOfRender(FULL));
  });

  it('every same-repo ref is written with a QUOTED # sigil', () => {
    // Not style. Measured: an unquoted `#` in a flow sequence is a PARSE ERROR,
    // and in a block sequence it parses to nulls SILENTLY — so an unquoted
    // sigil would emit a block declaring no edges at all. The sigil is what
    // makes the tracker auto-link the reference and stamp the reverse
    // cross-reference that §4.3.1 has no field for.
    const block = renderFrontmatter({ blockedBy: [{ repo: null, id: '7' }, { repo: 'acme/widgets', id: '9' }] }) as string;
    assert.ok(block.includes('- "#7"'));
    assert.ok(block.includes('- "acme/widgets#9"'));
  });

  it('round-trips the fence-wrapped form, which §4.1 still permits', () => {
    // The exception stays for a host whose renderer mangles bare frontmatter;
    // it is no longer the default, and it must still parse.
    const block = renderFrontmatter(FULL, { fenceWrapped: true });
    assert.ok((block as string).startsWith('```\n---'));
    assert.ok((block as string).endsWith('---\n```'));
    const parsed = parseFrontmatter(`${block as string}\n\nBody.\n`);
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.data, expectedParseOfRender(FULL));
  });

  it('round-trips a minimal single-field input', () => {
    const input: RenderInput = { blockedBy: [{ repo: null, id: '5' }] };
    const parsed = parseFrontmatter(`${renderFrontmatter(input) as string}\n`);
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.data, expectedParseOfRender(input));
  });

  it('round-trips EVERY field on its own, so no spelling is pinned only in company', () => {
    // The full-set case above renders every field into one block, where a
    // field whose own spelling is wrong can still be read correctly because a
    // neighbour supplied the structure around it. One field at a time is the
    // control for that.
    const singles: RenderInput[] = [
      { blockedBy: [{ repo: 'acme/widgets', id: '7' }] },
      { decomposedFrom: { repo: null, id: '3' } },
      { duplicateOf: { repo: 'acme/widgets', id: '4' } },
      { serializeWith: { repo: null, id: '44' } },
      { togetherWith: { repo: 'acme/widgets', id: '9' } },
      { priority: 0 },
      { evidence: 'asserted' },
    ];
    for (const input of singles) {
      const parsed = parseFrontmatter(`${renderFrontmatter(input) as string}\n\nBody.\n`);
      assert.deepEqual(parsed.diagnostics, [], `diagnostics for ${JSON.stringify(input)}`);
      assert.deepEqual(parsed.data, expectedParseOfRender(input), `round-trip for ${JSON.stringify(input)}`);
    }
  });

  it('renders NO block for an empty input — never an empty issuegraph stub', () => {
    assert.equal(renderFrontmatter({}), null);
    assert.equal(renderFrontmatter({ blockedBy: [], duplicateOf: null }), null);
  });

  it('THROWS on contract violations rather than degrading — a writer that drops an edge lies', () => {
    assert.throws(() => renderFrontmatter({ blockedBy: [{ repo: null, id: '0' }] }), /not a valid tracker identifier/);
    // A NON-STRING id from a JavaScript caller. The type annotation is a
    // promise to TypeScript and nothing to the JS callers a published package
    // has — and the failure was silent rather than loud: `#undefined` rendered,
    // parsed back as a valid reference with zero diagnostics, and left the
    // issue permanently unready with nothing reporting why.
    for (const id of [undefined, null, true, 123]) {
      assert.throws(
        () => renderFrontmatter({ blockedBy: [{ repo: null, id: id as unknown as string }] }),
        /not a valid tracker identifier/,
        `render must refuse ${String(id)}`,
      );
    }
    assert.throws(() => renderFrontmatter({ blockedBy: [{ repo: null, id: 'a ref' }] }), /not a valid tracker identifier/);
    assert.throws(() => renderFrontmatter({ blockedBy: [{ repo: 'not a repo', id: '1' }] }), /owner\/repo/);
    assert.throws(() => renderFrontmatter({ priority: 5 }), /0-3/);
    assert.throws(() => renderFrontmatter({ evidence: 'guessed' as 'asserted' }), /asserted\|verified/);
  });

  it('survives a body whose OWN content contains --- lines after the block', () => {
    const block = renderFrontmatter(FULL) as string;
    const parsed = parseFrontmatter(`${block}\n\nIntro\n\n---\n\nMore body.\n`);
    assert.deepEqual(parsed.data, expectedParseOfRender(FULL));
  });
});

describe('a rendered ref is one the reader can read back', () => {
  it('refuses an integer outside the range the parser accepts', () => {
    // `Number.isInteger` is not the bound that matters — the READER'S is.
    // Rendering `9007199254740992` or `1e21` emits a line the parser drops with
    // a diagnostic instead of reading, so the edge silently does not exist:
    // fail-loud broken and the round-trip guarantee broken together.
    for (const n of [9007199254740992, 1e21, Number.MAX_VALUE]) {
      assert.throws(
        () => renderFrontmatter({ blockedBy: [{ repo: null, id: String(n) }] }),
        /not a valid tracker identifier/,
        `render must refuse ${String(n)}`,
      );
    }
  });

  it('accepts the largest ref the parser accepts, so the bound is not too tight', () => {
    // The control in the other direction: a refusal that also refused valid
    // input would satisfy the test above just as well.
    const max = Number.MAX_SAFE_INTEGER;
    const parsed = parseFrontmatter(`${renderFrontmatter({ blockedBy: [{ repo: null, id: String(max) }] }) as string}\n`);
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.data?.blockedBy, [{ repo: null, id: String(max) }]);
  });

  it('every ref render ACCEPTS survives the round-trip with no diagnostic', () => {
    // The property the two cases above are instances of, asserted directly.
    for (const n of [1, 2, 42, 231, 999999, Number.MAX_SAFE_INTEGER]) {
      for (const repo of [null, 'acme/widgets']) {
        const input = { blockedBy: [{ repo, id: String(n) }] };
        const parsed = parseFrontmatter(`${renderFrontmatter(input) as string}\n`);
        assert.deepEqual(parsed.diagnostics, [], `diagnostics for ${String(repo)}#${String(n)}`);
        assert.deepEqual(parsed.data?.blockedBy, [{ repo, id: String(n) }], `round-trip for ${String(repo)}#${String(n)}`);
      }
    }
  });
});
