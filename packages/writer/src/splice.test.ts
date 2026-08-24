/**
 * The surgical in-place refresh. The location authority is the reader's own
 * scan, and SURGICAL is the contract: only the owned entries' lines move —
 * unrecognized fields, sibling top-level YAML, and every other byte survive.
 *
 * Every case re-parses the result through `@issuegraph/reader`, because the
 * only thing that makes a splice correct is that the parser still reads what
 * the caller meant to write.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseFrontmatter } from '@issuegraph/reader';

import { renderFrontmatter } from './render.ts';
import { spliceGeneratedEdges, type GeneratedEdges } from './splice.ts';

const NEW_EDGES: GeneratedEdges = {
  blockedBy: [{ repo: null, number: 12 }],
  serializeWith: { repo: null, number: 3 },
  decomposedFrom: null,
};

describe('spliceGeneratedEdges', () => {
  it('updates the owned fields in place, preserving prefix, remainder, and armor', () => {
    const block = renderFrontmatter({ blockedBy: [{ repo: null, number: 7 }], priority: 2 }) as string;
    const body = `Banner line.\n\n${block}\n\nThe brief body.\n\n---\n\nA rule-bearing tail.`;
    const next = spliceGeneratedEdges(body, NEW_EDGES);
    assert.notEqual(next, null);
    assert.ok((next as string).includes('Banner line.\n\n```'));
    assert.ok((next as string).includes('\n\nThe brief body.\n\n---\n\nA rule-bearing tail.'));
    const data = parseFrontmatter(next as string).data;
    assert.deepEqual(data?.blockedBy, [{ repo: null, number: 12 }]);
    assert.deepEqual(data?.serializeWith, { repo: null, number: 3 });
    // The un-owned field survived UNTOUCHED — the splice never re-renders it.
    assert.equal(data?.priority, 2);
    assert.equal((next as string).match(/^```$/gm)?.length, 2);
  });

  it('preserves an unrecognized future field under issuegraph AND a sibling top-level key', () => {
    const body = [
      '```',
      '---',
      'issuegraph:',
      '  blocked-by:',
      '    - 7',
      '  risk-class: high',
      'labels-hint: platform',
      '---',
      '```',
      '',
      'The brief body.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;
    // Author metadata the parser tolerates survives byte-for-byte.
    assert.ok(next.includes('  risk-class: high'));
    assert.ok(next.includes('labels-hint: platform'));
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.blockedBy, [{ repo: null, number: 12 }]);
    assert.deepEqual(data?.serializeWith, { repo: null, number: 3 });
    assert.ok(next.includes('The brief body.'));
  });

  it('removes indentationless sequence items with their owned key', () => {
    // YAML permits items at the key's OWN indent and the parser accepts them;
    // the splice must carry them inside the owned span — an orphaned dash line
    // would structurally invalidate the whole section.
    const body = ['---', 'issuegraph:', '  blocked-by:', '  - 7', '  - 8', '  priority: 1', '---', '', 'Body.'].join(
      '\n',
    );
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;
    assert.ok(!next.includes('- 7'));
    assert.ok(!next.includes('- 8'));
    const parsed = parseFrontmatter(next);
    assert.deepEqual(parsed.data?.blockedBy, [{ repo: null, number: 12 }]);
    assert.deepEqual(parsed.data?.serializeWith, { repo: null, number: 3 });
    assert.equal(parsed.data?.priority, 1);
  });

  it("adopts the section's own child indent instead of imposing the canonical one", () => {
    const body = ['---', 'issuegraph:', '    blocked-by:', '      - 7', '---'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;
    assert.ok(next.includes('    blocked-by:\n      - 12'));
    assert.deepEqual(parseFrontmatter(next).data?.blockedBy, [{ repo: null, number: 12 }]);
  });

  it('locates a QUOTED section header, exactly as the parser does', () => {
    // The header predicate is the reader's, so a spelling the parser reads must
    // not be one the splice cannot see. Answering this question twice is how a
    // splice used to return null on a block the parser read perfectly well.
    const body = ['---', '"issuegraph":', '  blocked-by:', '    - 7', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES);
    assert.notEqual(next, null);
    assert.deepEqual(parseFrontmatter(next as string).data?.blockedBy, [{ repo: null, number: 12 }]);
  });

  it('recognises a QUOTED owned entry as its own rather than duplicating it', () => {
    const body = ['---', 'issuegraph:', '  "blocked-by":', '    - 7', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;
    assert.equal((next.match(/blocked-by/g) ?? []).length, 1);
    assert.deepEqual(parseFrontmatter(next).data?.blockedBy, [{ repo: null, number: 12 }]);
  });

  it('refuses a block whose header carries an inline value, which the parser rejects', () => {
    const body = ['---', 'issuegraph: { blocked-by: [7] }', '---', '', 'Body.'].join('\n');
    assert.equal(spliceGeneratedEdges(body, NEW_EDGES), null);
  });

  it('refuses a child the parser will refuse, rather than writing a body that parses to nothing', () => {
    const body = ['---', 'issuegraph:', '  blocked-by:[1]', '---', '', 'Body.'].join('\n');
    assert.equal(spliceGeneratedEdges(body, NEW_EDGES), null);
  });

  it('leaves an existing decomposed-from untouched when the input passes null', () => {
    const block = renderFrontmatter({
      decomposedFrom: { repo: null, number: 9 },
      blockedBy: [{ repo: null, number: 7 }],
    }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, NEW_EDGES) as string;
    assert.deepEqual(parseFrontmatter(next).data?.decomposedFrom, { repo: null, number: 9 });
  });

  it('sets decomposed-from when the input carries one', () => {
    const block = renderFrontmatter({ blockedBy: [{ repo: null, number: 7 }] }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      ...NEW_EDGES,
      decomposedFrom: { repo: null, number: 42 },
    }) as string;
    assert.deepEqual(parseFrontmatter(next).data?.decomposedFrom, { repo: null, number: 42 });
  });

  it('removes the whole block (armor and trailing blank included) when nothing remains', () => {
    const block = renderFrontmatter({ blockedBy: [{ repo: null, number: 7 }] }) as string;
    assert.equal(
      spliceGeneratedEdges(`${block}\n\nThe brief body.`, {
        blockedBy: [],
        serializeWith: null,
        decomposedFrom: null,
      }),
      'The brief body.',
    );
  });

  it('drops only the bare issuegraph header when siblings keep the block alive', () => {
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - 7', 'labels-hint: platform', '---', '', 'Body.'].join(
      '\n',
    );
    const next = spliceGeneratedEdges(body, {
      blockedBy: [],
      serializeWith: null,
      decomposedFrom: null,
    }) as string;
    assert.ok(next.includes('labels-hint: platform'));
    assert.ok(!next.includes('issuegraph:'));
    assert.ok(!next.includes('blocked-by'));
    assert.ok(next.includes('Body.'));
  });

  it('returns null when the body carries no keyed block (caller prepends instead)', () => {
    assert.equal(spliceGeneratedEdges('Just a body.\n\n---\n\nWith a rule.', NEW_EDGES), null);
  });

  it('inserts duplicate-of when the input carries one and the block lacks the key', () => {
    const block = renderFrontmatter({ blockedBy: [{ repo: null, number: 7 }], priority: 2 }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      ...NEW_EDGES,
      duplicateOf: { repo: null, number: 99 },
    }) as string;
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.duplicateOf, { repo: null, number: 99 });
    // Un-owned neighbour untouched; owned fields refreshed as usual.
    assert.equal(data?.priority, 2);
    assert.deepEqual(data?.blockedBy, [{ repo: null, number: 12 }]);
  });

  it('replaces an existing duplicate-of when the input carries a different ref', () => {
    const block = renderFrontmatter({
      duplicateOf: { repo: null, number: 5 },
      blockedBy: [{ repo: null, number: 7 }],
    }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      ...NEW_EDGES,
      duplicateOf: { repo: 'acme/widgets', number: 6 },
    }) as string;
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.duplicateOf, { repo: 'acme/widgets', number: 6 });
    // Exactly one duplicate-of line survives — replace, never stack.
    assert.equal((next.match(/duplicate-of:/g) ?? []).length, 1);
  });

  it('leaves an existing duplicate-of untouched when the input omits or nulls the field', () => {
    const block = renderFrontmatter({
      duplicateOf: { repo: null, number: 9 },
      blockedBy: [{ repo: null, number: 7 }],
    }) as string;
    const body = `${block}\n\nBody.`;
    const omitted = spliceGeneratedEdges(body, NEW_EDGES) as string;
    assert.deepEqual(parseFrontmatter(omitted).data?.duplicateOf, { repo: null, number: 9 });
    const nulled = spliceGeneratedEdges(body, { ...NEW_EDGES, duplicateOf: null }) as string;
    assert.deepEqual(parseFrontmatter(nulled).data?.duplicateOf, { repo: null, number: 9 });
  });

  it('leaves blocked-by and serialize-with byte-untouched when omitted from the input', () => {
    // Per-field opt-in ownership: a writer that owns only ONE field — a groomer
    // writing duplicate-of on an issue whose scheduling edges belong to other
    // writers — must be able to leave the rest BYTE-untouched. Round-tripping
    // parsed values back through a splice would silently launder away
    // unparseable items and exotic spellings the parser tolerates with a
    // diagnostic; omission is the honest "not mine" signal.
    const body = [
      '```',
      '---',
      'issuegraph:',
      '  blocked-by:',
      "    - '#7'",
      '    - not-a-ref',
      '  serialize-with: 44',
      '---',
      '```',
      '',
      'Body.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, { duplicateOf: { repo: null, number: 99 } }) as string;
    // The exotic spelling AND the unparseable item both survive byte-for-byte —
    // proof the entries were never re-rendered.
    assert.ok(next.includes("    - '#7'"));
    assert.ok(next.includes('    - not-a-ref'));
    assert.ok(next.includes('  serialize-with: 44'));
    assert.deepEqual(parseFrontmatter(next).data?.duplicateOf, { repo: null, number: 99 });
  });

  it('still treats an explicit empty set / null as owned-remove', () => {
    const block = renderFrontmatter({
      blockedBy: [{ repo: null, number: 7 }],
      serializeWith: { repo: null, number: 4 },
      priority: 1,
    }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      blockedBy: [],
      serializeWith: null,
      decomposedFrom: null,
    }) as string;
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.blockedBy, []);
    assert.equal(data?.serializeWith, null);
    assert.equal(data?.priority, 1);
  });
});
