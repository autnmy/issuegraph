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
    { repo: null, number: 12 },
    { repo: 'acme/widgets', number: 7 },
  ],
  decomposedFrom: { repo: null, number: 3 },
  duplicateOf: null,
  serializeWith: { repo: null, number: 44 },
  togetherWith: { repo: 'acme/widgets', number: 9 },
  priority: 1,
  evidence: 'verified',
};

describe('renderFrontmatter', () => {
  it('round-trips the full field set through the reader (fence-wrapped default)', () => {
    const block = renderFrontmatter(FULL);
    assert.notEqual(block, null);
    // The ARMOR ITSELF is the assertion the round-trip cannot make: the parser
    // sees through both forms (§4.1), so only this shape pin notices a dropped
    // fence — and a dropped fence is exactly the broken markdown rendering the
    // default exists to prevent.
    assert.ok((block as string).startsWith('```\n---'));
    assert.ok((block as string).endsWith('---\n```'));
    const parsed = parseFrontmatter(`${block as string}\n\nThe issue body.\n`);
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.data, expectedParseOfRender(FULL));
  });

  it('round-trips the bare (unfenced) form for hosts that render frontmatter natively', () => {
    const block = renderFrontmatter(FULL, { fenceWrapped: false });
    assert.ok((block as string).startsWith('---'));
    const parsed = parseFrontmatter(`${block as string}\n\nBody.\n`);
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.data, expectedParseOfRender(FULL));
  });

  it('round-trips a minimal single-field input', () => {
    const input: RenderInput = { blockedBy: [{ repo: null, number: 5 }] };
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
      { blockedBy: [{ repo: 'acme/widgets', number: 7 }] },
      { decomposedFrom: { repo: null, number: 3 } },
      { duplicateOf: { repo: 'acme/widgets', number: 4 } },
      { serializeWith: { repo: null, number: 44 } },
      { togetherWith: { repo: 'acme/widgets', number: 9 } },
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
    assert.throws(() => renderFrontmatter({ blockedBy: [{ repo: null, number: 0 }] }), /positive integer/);
    assert.throws(() => renderFrontmatter({ blockedBy: [{ repo: 'not a repo', number: 1 }] }), /owner\/repo/);
    assert.throws(() => renderFrontmatter({ priority: 5 }), /0-3/);
    assert.throws(() => renderFrontmatter({ evidence: 'guessed' as 'asserted' }), /asserted\|verified/);
  });

  it('survives a body whose OWN content contains --- lines after the block', () => {
    const block = renderFrontmatter(FULL) as string;
    const parsed = parseFrontmatter(`${block}\n\nIntro\n\n---\n\nMore body.\n`);
    assert.deepEqual(parsed.data, expectedParseOfRender(FULL));
  });
});
