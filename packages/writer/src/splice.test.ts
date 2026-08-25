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
import {
  isSpliceOwnedField,
  SPLICE_FIELD_OWNERSHIP,
  SPLICE_OWNED_FIELDS,
  spliceGeneratedEdges,
  type GeneratedEdges,
} from './splice.ts';

const NEW_EDGES: GeneratedEdges = {
  blockedBy: [{ repo: null, id: '12' }],
  serializeWith: { repo: null, id: '3' },
  decomposedFrom: null,
};

describe('spliceGeneratedEdges', () => {
  it('updates the owned fields in place, preserving prefix, remainder, and armor', () => {
    // Fence-wrapped ON PURPOSE: this case is about preserving the ARMOR, which
    // is no longer the render default (§4.1's exception, still supported).
    const block = renderFrontmatter({ blockedBy: [{ repo: null, id: '7' }], priority: 2 }, { fenceWrapped: true }) as string;
    const body = `Banner line.\n\n${block}\n\nThe brief body.\n\n---\n\nA rule-bearing tail.`;
    const next = spliceGeneratedEdges(body, NEW_EDGES);
    assert.notEqual(next, null);
    assert.ok((next as string).includes('Banner line.\n\n```'));
    assert.ok((next as string).includes('\n\nThe brief body.\n\n---\n\nA rule-bearing tail.'));
    const data = parseFrontmatter(next as string).data;
    assert.deepEqual(data?.blockedBy, [{ repo: null, id: '12' }]);
    assert.deepEqual(data?.serializeWith, { repo: null, id: '3' });
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
    assert.deepEqual(data?.blockedBy, [{ repo: null, id: '12' }]);
    assert.deepEqual(data?.serializeWith, { repo: null, id: '3' });
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
    assert.deepEqual(parsed.data?.blockedBy, [{ repo: null, id: '12' }]);
    assert.deepEqual(parsed.data?.serializeWith, { repo: null, id: '3' });
    assert.equal(parsed.data?.priority, 1);
  });

  it("adopts the section's own child indent instead of imposing the canonical one", () => {
    const body = ['---', 'issuegraph:', '    blocked-by:', '      - 7', '---'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;
    assert.ok(next.includes('    blocked-by:\n      - "#12"'));
    assert.deepEqual(parseFrontmatter(next).data?.blockedBy, [{ repo: null, id: '12' }]);
  });

  it('locates a QUOTED section header, exactly as the parser does', () => {
    // The header predicate is the reader's, so a spelling the parser reads must
    // not be one the splice cannot see. Answering this question twice is how a
    // splice used to return null on a block the parser read perfectly well.
    const body = ['---', '"issuegraph":', '  blocked-by:', '    - 7', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES);
    assert.notEqual(next, null);
    assert.deepEqual(parseFrontmatter(next as string).data?.blockedBy, [{ repo: null, id: '12' }]);
  });

  it('recognises a QUOTED owned entry as its own rather than duplicating it', () => {
    const body = ['---', 'issuegraph:', '  "blocked-by":', '    - 7', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;
    assert.equal((next.match(/blocked-by/g) ?? []).length, 1);
    assert.deepEqual(parseFrontmatter(next).data?.blockedBy, [{ repo: null, id: '12' }]);
  });

  it('THROWS on a readable block it cannot line-edit, rather than losing its fields', () => {
    // THIS TEST'S PREMISE WENT STALE TWICE, and the correction is recorded
    // rather than swapped. It used to assert `null` "because the parser rejects
    // an inline value" — the parser now READS a flow mapping (it is what a YAML
    // serializer emits in flow style), so that reason is simply false.
    //
    // And `null` turned out to be the wrong answer anyway. It is the caller's
    // signal to PREPEND a fresh block, and under §4.1's first-block rule the
    // prepended block becomes canonical while the original is demoted — so
    // every field this call does not own silently disappears. Measured on this
    // exact body: `priority` and `together-with` gone, zero diagnostics.
    //
    // A writer that would file a graph that lies fails loudly instead. That is
    // this package's own stated discipline, applied to a loss that was wearing
    // a `null`.
    const body = [
      '---',
      '{issuegraph: {blocked-by: ["#7"], priority: 1, together-with: "#5"}}',
      '---',
      '',
      'Body.',
    ].join('\n');
    assert.throws(() => spliceGeneratedEdges(body, NEW_EDGES), /not line-editable/);
  });

  it('THROWS for a flow section carrying only an UNRECOGNISED extension', () => {
    // The guard used to count the recognised `Frontmatter`, which omits
    // extension fields by design — so a section carrying only `future-edge`
    // reported "nothing to lose" and the prepend demoted it in silence. §4.1
    // makes an unrecognised field inert to the READER; it never makes it
    // disposable by a WRITER. The count now comes from the section's own
    // entries.
    const body = ['---', '{issuegraph: {future-edge: "#5", note: "keep me"}}', '---', '', 'Body.'].join('\n');
    assert.throws(() => spliceGeneratedEdges(body, NEW_EDGES), /not line-editable/);
  });

  it('but still returns null when the uneditable block has NOTHING to lose', () => {
    // The throw is a data-loss guard, not a shape guard, so it must not fire
    // where prepending costs the author nothing. Each of these is readable (or
    // not) but carries no field, so `null` — and the caller's prepend — stays
    // correct.
    for (const body of [
      ['---', '{issuegraph: {}}', '---', '', 'Body.'].join('\n'),
      ['---', 'issuegraph: null', 'other: x', '---'].join('\n'),
      ['---', 'issuegraph:', '  priority: 0', '  priority: 1', '---'].join('\n'),
      'Just prose, no block at all.',
    ]) {
      assert.equal(spliceGeneratedEdges(body, NEW_EDGES), null, body);
    }
  });

  it('refuses a child the parser will refuse, rather than writing a body that parses to nothing', () => {
    const body = ['---', 'issuegraph:', '  blocked-by:[1]', '---', '', 'Body.'].join('\n');
    assert.equal(spliceGeneratedEdges(body, NEW_EDGES), null);
  });

  it('leaves an existing decomposed-from untouched when the input passes null', () => {
    const block = renderFrontmatter({
      decomposedFrom: { repo: null, id: '9' },
      blockedBy: [{ repo: null, id: '7' }],
    }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, NEW_EDGES) as string;
    assert.deepEqual(parseFrontmatter(next).data?.decomposedFrom, { repo: null, id: '9' });
  });

  it('sets decomposed-from when the input carries one', () => {
    const block = renderFrontmatter({ blockedBy: [{ repo: null, id: '7' }] }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      ...NEW_EDGES,
      decomposedFrom: { repo: null, id: '42' },
    }) as string;
    assert.deepEqual(parseFrontmatter(next).data?.decomposedFrom, { repo: null, id: '42' });
  });

  it('removes the whole block (armor and trailing blank included) when nothing remains', () => {
    const block = renderFrontmatter({ blockedBy: [{ repo: null, id: '7' }] }) as string;
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
    const block = renderFrontmatter({ blockedBy: [{ repo: null, id: '7' }], priority: 2 }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      ...NEW_EDGES,
      duplicateOf: { repo: null, id: '99' },
    }) as string;
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.duplicateOf, { repo: null, id: '99' });
    // Un-owned neighbour untouched; owned fields refreshed as usual.
    assert.equal(data?.priority, 2);
    assert.deepEqual(data?.blockedBy, [{ repo: null, id: '12' }]);
  });

  it('replaces an existing duplicate-of when the input carries a different ref', () => {
    const block = renderFrontmatter({
      duplicateOf: { repo: null, id: '5' },
      blockedBy: [{ repo: null, id: '7' }],
    }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      ...NEW_EDGES,
      duplicateOf: { repo: 'acme/widgets', id: '6' },
    }) as string;
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.duplicateOf, { repo: 'acme/widgets', id: '6' });
    // Exactly one duplicate-of line survives — replace, never stack.
    assert.equal((next.match(/duplicate-of:/g) ?? []).length, 1);
  });

  it('leaves an existing duplicate-of untouched when the input omits or nulls the field', () => {
    const block = renderFrontmatter({
      duplicateOf: { repo: null, id: '9' },
      blockedBy: [{ repo: null, id: '7' }],
    }) as string;
    const body = `${block}\n\nBody.`;
    const omitted = spliceGeneratedEdges(body, NEW_EDGES) as string;
    assert.deepEqual(parseFrontmatter(omitted).data?.duplicateOf, { repo: null, id: '9' });
    const nulled = spliceGeneratedEdges(body, { ...NEW_EDGES, duplicateOf: null }) as string;
    assert.deepEqual(parseFrontmatter(nulled).data?.duplicateOf, { repo: null, id: '9' });
  });

  it('leaves blocked-by and serialize-with byte-untouched when omitted from the input', () => {
    // Per-field opt-in ownership: a writer that owns only ONE field — a groomer
    // writing duplicate-of on an issue whose scheduling edges belong to other
    // writers — must be able to leave the rest BYTE-untouched. Round-tripping
    // parsed values back through a splice would silently launder away
    // unparseable items and exotic spellings the parser tolerates with a
    // diagnostic; omission is the honest "not mine" signal.
    //
    // The unreadable item carries WHITESPACE: a bare `not-a-ref` is a perfectly
    // good opaque tracker id now (SPEC 4.2), so it would prove nothing here.
    const body = [
      '```',
      '---',
      'issuegraph:',
      '  blocked-by:',
      "    - '#7'",
      '    - "not a ref"',
      '  serialize-with: 44',
      '---',
      '```',
      '',
      'Body.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, { duplicateOf: { repo: null, id: '99' } }) as string;
    // The exotic spelling AND the unparseable item both survive byte-for-byte —
    // proof the entries were never re-rendered.
    assert.ok(next.includes("    - '#7'"));
    assert.ok(next.includes('    - "not a ref"'));
    assert.ok(next.includes('  serialize-with: 44'));
    assert.deepEqual(parseFrontmatter(next).data?.duplicateOf, { repo: null, id: '99' });
  });

  it('still treats an explicit empty set / null as owned-remove', () => {
    const block = renderFrontmatter({
      blockedBy: [{ repo: null, id: '7' }],
      serializeWith: { repo: null, id: '4' },
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

describe('spliceGeneratedEdges on a CRLF body', () => {
  it('leaves the block readable, and states the one thing it does not promise', () => {
    // The splice preserves the lines it does not touch, terminators included —
    // it slices a `\n` split, so a `\r` stays on the end of every line it keeps.
    // What it does NOT do is match the surrounding terminator on the lines it
    // INSERTS: those are written bare, so a CRLF body comes back with LF-ended
    // inserted lines. The parser splits on `\r?\n`, so the result reads
    // correctly either way, and the byte-for-byte promise was only ever about
    // the lines it leaves alone. This pins both halves so neither can regress
    // into the other.
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - 7', '  priority: 1', '---', '', 'Body.'].join('\r\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;

    assert.notEqual(next, null);
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.blockedBy, [{ repo: null, id: '12' }]);
    assert.equal(data?.priority, 1);
    // The untouched neighbour keeps its carriage return.
    assert.ok(next.includes('  priority: 1\r\n'));
    // The prose after the block is untouched, CRLF and all.
    assert.ok(next.endsWith('\r\n\r\nBody.'));
  });
});

describe('YAML comments inside the block', () => {
  it('edits a section carrying a comment child instead of refusing the whole block', () => {
    // A comment child reached `readMappingEntry`, came back null, and — since an
    // unreadable child is structural — the splice refused a block the parser
    // reads perfectly well. The caller then followed the documented `null`
    // fallback and PREPENDED a fresh block, which demotes the author's original
    // to a later claimant: no longer canonical, so its unowned fields go
    // silently invisible. The refusal is the visible half; that is the harm.
    const body = ['---', 'issuegraph:', '  # why this is blocked', '  blocked-by:', '    - 7', '  priority: 1', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES);

    assert.notEqual(next, null, 'a comment child must not make the splice refuse');
    // The comment survives byte-for-byte — stripping is classification only.
    assert.ok((next as string).includes('  # why this is blocked'));
    const data = parseFrontmatter(next as string).data;
    assert.deepEqual(data?.blockedBy, [{ repo: null, id: '12' }]);
    assert.deepEqual(data?.serializeWith, { repo: null, id: '3' });
    assert.equal(data?.priority, 1, 'the unowned neighbour is still there');
  });

  it('does not let a column-zero comment close the section early', () => {
    // The parser strips the comment to nothing and keeps walking. A splice that
    // did not strip read it as an indent-0 line, closed the section on it, and
    // every entry below stopped being editable — so an owned `blocked-by` after
    // the comment was left stale while the call reported success.
    const body = ['---', 'issuegraph:', '# a column-zero note', '  blocked-by:', '    - 7', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;

    assert.notEqual(next, null);
    assert.ok(next.includes('# a column-zero note'));
    assert.deepEqual(parseFrontmatter(next).data?.blockedBy, [{ repo: null, id: '12' }]);
  });

  it('still refuses a child the parser refuses, now that comments are stripped', () => {
    // The control for the fix above: stripping must not widen what is accepted.
    // `blocked-by:[1]` carries no comment, so it is still not a mapping entry.
    const body = ['---', 'issuegraph:', '  # a note', '  blocked-by:[1]', '---', '', 'Body.'].join('\n');
    assert.equal(spliceGeneratedEdges(body, NEW_EDGES), null);
  });

  it('reads an entry whose value carries a trailing comment as that entry', () => {
    const body = ['---', 'issuegraph:', '  blocked-by: [7]  # stale', '  priority: 1', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES) as string;
    // The owned entry was recognised and replaced — the trailing comment went
    // with the line it annotated, and no second `blocked-by` was inserted.
    assert.equal((next.match(/blocked-by/g) ?? []).length, 1);
    assert.deepEqual(parseFrontmatter(next).data?.blockedBy, [{ repo: null, id: '12' }]);
    assert.equal(parseFrontmatter(next).data?.priority, 1);
  });
});

describe('an explicit null does NOT clear provenance or a verdict', () => {
  it('is the documented asymmetry, and a live caller depends on it', () => {
    // `blockedBy` / `serializeWith` treat a present value as an owned removal.
    // `decomposedFrom` / `duplicateOf` do not, because the established caller
    // shape is "write it when the block lacks one, never clobber one that is
    // already there" — it passes `null` to mean LEAVE IT ALONE. Making `null`
    // remove would delete provenance on every refresh of a block that has it.
    // Pinned here because it reads like an inconsistency and is not one.
    const block = renderFrontmatter({
      blockedBy: [{ repo: null, id: '7' }],
      serializeWith: { repo: null, id: '4' },
      decomposedFrom: { repo: null, id: '9' },
      duplicateOf: { repo: null, id: '5' },
    }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      blockedBy: [],
      serializeWith: null,
      decomposedFrom: null,
      duplicateOf: null,
    }) as string;
    const data = parseFrontmatter(next).data;
    // Scheduling edges: a present value removes.
    assert.deepEqual(data?.blockedBy, []);
    assert.equal(data?.serializeWith, null);
    // Provenance and verdict: null leaves them exactly where they were.
    assert.deepEqual(data?.decomposedFrom, { repo: null, id: '9' });
    assert.deepEqual(data?.duplicateOf, { repo: null, id: '5' });
  });
});

describe('the splice verifies its own output', () => {
  // The walk models the parser's rules and will always model only SOME of them.
  // For every rule it misses, it classified the lines happily, inserted the
  // owned entry, and returned a NON-NULL body the parser reads as `data: null` —
  // so the caller skipped the documented fallback and persisted a body in which
  // the gate it just wrote is unreadable. Asking the parser removes the class
  // instead of adding an arm per rule.
  const structurallyInvalid: readonly (readonly [string, string])[] = [
    ['a tab in the indentation', ['---', 'issuegraph:', '\t priority: 1', '---', '', 'Body.'].join('\n')],
    [
      'a dedented child that does not align with the section',
      ['---', 'issuegraph:', '    owner-note: x', '  priority: 1', '---', '', 'Body.'].join('\n'),
    ],
    [
      'a sequence where the section expects a mapping',
      ['---', 'issuegraph:', '  - 12', '  - 34', '---', '', 'Body.'].join('\n'),
    ],
  ];

  for (const [name, body] of structurallyInvalid) {
    it(`refuses rather than half-writing into a block with ${name}`, () => {
      // The premise: the parser cannot read this block to begin with.
      assert.equal(parseFrontmatter(body).data, null, 'fixture must be unreadable to start with');
      assert.equal(
        spliceGeneratedEdges(body, NEW_EDGES),
        null,
        'a body whose block stays unreadable must take the null fallback, not be persisted',
      );
    });
  }

  it('CONTROL: a readable block is still spliced, so the check refuses nothing valid', () => {
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - 7', '  priority: 1', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, NEW_EDGES);
    assert.notEqual(next, null);
    assert.deepEqual(parseFrontmatter(next as string).data?.blockedBy, [{ repo: null, id: '12' }]);
  });

  it('CONTROL: an unparseable ITEM the splice preserved is not a refusal', () => {
    // The check keys on `data === null` WITH a diagnostic, not on diagnostics
    // alone. A body carrying an unowned unreadable item this splice preserved
    // byte-for-byte parses with NON-NULL data and a diagnostic, and refusing
    // there would destroy the preservation guarantee one field over.
    //
    // The item carries WHITESPACE: `not-a-ref` used to be the unparseable
    // example and is now a perfectly good opaque tracker id (§4.2).
    const body = [
      '---',
      'issuegraph:',
      '  blocked-by:',
      '    - "not a ref"',
      '---',
      '',
      'Body.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, { duplicateOf: { repo: null, id: '99' } }) as string;
    assert.notEqual(next, null);
    assert.ok(next.includes('    - "not a ref"'), 'preserved byte-for-byte');
    const parse = parseFrontmatter(next);
    assert.notEqual(parse.data, null);
    assert.ok(parse.diagnostics.length > 0, 'and it still reports the drop');
  });

  it('CONTROL: whole-block removal is a success, not an unreadable result', () => {
    // Removal leaves a body with NO block, which parses to `data: null` with NO
    // diagnostic. Keying the check on `data === null` alone would refuse it.
    const block = renderFrontmatter({ blockedBy: [{ repo: null, id: '7' }] }) as string;
    assert.equal(
      spliceGeneratedEdges(`${block}\n\nThe brief body.`, {
        blockedBy: [],
        serializeWith: null,
        decomposedFrom: null,
      }),
      'The brief body.',
    );
  });
});

describe('the positive control is comparative, not just a shape test', () => {
  it('refuses a splice that DESTROYS a readable declaration, even silently', () => {
    // THE HOLE THIS CLOSES. The control used to ask only about the RESULT:
    // `data === null` WITH a diagnostic. A body whose block the edit wrecked so
    // thoroughly that it is no longer discoverable parses as `data: null` with
    // NO diagnostic — absence is silent by design — so it slipped straight
    // through and the caller was handed a NON-NULL body and told it succeeded.
    //
    // Measured on this input before the fix: the requested edge was not
    // written, `priority` was gone, and the reader reported no declaration at
    // all. That is the silent half-write this module's contract says it makes
    // impossible, arriving through the control meant to prevent it.
    const body = ['---', '? issuegraph', ':', '  priority: 1', '---', '', 'Body.'].join('\n');
    assert.notEqual(parseFrontmatter(body).data, null, 'the reader can read this before the splice');

    const next = spliceGeneratedEdges(body, { blockedBy: [{ repo: null, id: '9' }] });
    assert.equal(next, null, 'so a splice that would destroy it must refuse rather than hand back wreckage');
  });

  it('CONTROL: whole-block REMOVAL still succeeds, which is why intent is passed in', () => {
    // Removal legitimately ends with no declaration. Inferring "the block
    // vanished, so the edit failed" would refuse the one success whose correct
    // outcome is an absent block — so the intent is threaded rather than
    // guessed from the result.
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - "#1"', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, { blockedBy: [] });
    assert.notEqual(next, null);
    assert.equal(parseFrontmatter(next as string).data, null, 'the block is gone, which is the point');
    assert.deepEqual(parseFrontmatter(next as string).diagnostics, []);
  });

  it('CONTROL: an ordinary edit still round-trips', () => {
    // The comparative check must not refuse the common path.
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - "#1"', '  priority: 1', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, { blockedBy: [{ repo: null, id: '9' }] }) as string;
    const parse = parseFrontmatter(next);
    assert.deepEqual(parse.data?.blockedBy, [{ repo: null, id: '9' }]);
    assert.equal(parse.data?.priority, 1, 'the unowned field survived');
    assert.deepEqual(parse.diagnostics, []);
  });
});

describe('an empty section takes its child indent from the header', () => {
  it('writes the edge INSIDE an indented section, not beside it', () => {
    // An empty section has no child to measure, and the fallback used to assume
    // column 2 — the header's own column when the block itself is indented. So
    // `  blocked-by:` landed as a SIBLING of `issuegraph:` rather than a child.
    // The body still parsed, so the post-edit readability check passed, and the
    // caller was told the write succeeded while the blocker it asked for was
    // never written. Silent under-blocking: the issue reads unblocked when the
    // writer meant to block it.
    const body = ['---', '  issuegraph:', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, { blockedBy: [{ repo: null, id: '9' }] }) as string;
    assert.notEqual(next, null);
    assert.deepEqual(
      parseFrontmatter(next).data?.blockedBy,
      [{ repo: null, id: '9' }],
      'the requested edge must actually be readable afterwards',
    );
  });

  it('CONTROL: a flush section still uses two spaces', () => {
    // The fallback must key on the header's column, not add a fixed offset to
    // whatever it finds — a flush header keeps the canonical indent.
    const body = ['---', 'issuegraph:', 'other: x', '---'].join('\n');
    const next = spliceGeneratedEdges(body, { blockedBy: [{ repo: null, id: '9' }] }) as string;
    assert.ok(next.includes('\n  blocked-by:'), 'two spaces for a flush header');
    assert.deepEqual(parseFrontmatter(next).data?.blockedBy, [{ repo: null, id: '9' }]);
  });

  it("CONTROL: a NON-empty section still adopts its own children's indent", () => {
    // The fallback only applies when there is nothing to measure; an author's
    // existing style still wins where one exists.
    const body = ['---', '  issuegraph:', '    priority: 1', '---'].join('\n');
    const next = spliceGeneratedEdges(body, { blockedBy: [{ repo: null, id: '9' }] }) as string;
    assert.ok(next.includes('\n    blocked-by:'), "four spaces, from the section's own child");
    const parse = parseFrontmatter(next);
    assert.deepEqual(parse.data?.blockedBy, [{ repo: null, id: '9' }]);
    assert.equal(parse.data?.priority, 1, 'and the unowned field survived');
  });
});

/**
 * The ownership domain, exported so consumers ask instead of re-deriving.
 *
 * THE DERIVATION PIN AT THE BOTTOM IS THE ONE THAT MATTERS. Everything above it
 * checks the table's shape, which a wrong-but-well-formed table would pass. The
 * last case checks that the table AGREES WITH THE SPLICE — which is what makes
 * publishing it safe, because `owns` reads the same rows.
 */
describe('the splice ownership domain', () => {
  it('lists exactly the fields the splice can own', () => {
    assert.deepEqual([...SPLICE_OWNED_FIELDS], [
      'blocked-by',
      'serialize-with',
      'decomposed-from',
      'duplicate-of',
    ]);
  });

  it('has a row for every listed field, and lists every row — in both directions', () => {
    // `satisfies` pins this at compile time; asserting it at runtime as well is
    // what catches a table whose TYPE is satisfied by a value built some other
    // way (a spread, a merge) than the literal the compiler checked.
    assert.deepEqual(Object.keys(SPLICE_FIELD_OWNERSHIP).sort(), [...SPLICE_OWNED_FIELDS].sort());
  });

  it('maps each field to a distinct GeneratedEdges property', () => {
    const properties = SPLICE_OWNED_FIELDS.map((f) => SPLICE_FIELD_OWNERSHIP[f].property);
    assert.equal(new Set(properties).size, properties.length, 'two fields share one property');
    assert.deepEqual(properties, ['blockedBy', 'serializeWith', 'decomposedFrom', 'duplicateOf']);
  });

  it('records scheduling edges as clearable and provenance as not', () => {
    assert.equal(SPLICE_FIELD_OWNERSHIP['blocked-by'].clearable, true);
    assert.equal(SPLICE_FIELD_OWNERSHIP['serialize-with'].clearable, true);
    assert.equal(SPLICE_FIELD_OWNERSHIP['decomposed-from'].clearable, false);
    assert.equal(SPLICE_FIELD_OWNERSHIP['duplicate-of'].clearable, false);
  });

  it('is frozen, table and rows alike', () => {
    assert.ok(Object.isFrozen(SPLICE_FIELD_OWNERSHIP));
    assert.ok(Object.isFrozen(SPLICE_OWNED_FIELDS));
    for (const field of SPLICE_OWNED_FIELDS) {
      assert.ok(Object.isFrozen(SPLICE_FIELD_OWNERSHIP[field]), field);
    }
  });

  describe('isSpliceOwnedField', () => {
    it('accepts every owned field', () => {
      for (const field of SPLICE_OWNED_FIELDS) assert.equal(isSpliceOwnedField(field), true, field);
    });

    it('REFUSES together-with — the field the splice genuinely cannot write', () => {
      // The one a consumer is most likely to assume is spliceable, because it is
      // an edge field like the other four. It is absent from the domain rather
      // than present-and-false, and this is what makes that absence answerable.
      assert.equal(isSpliceOwnedField('together-with'), false);
      assert.equal(isSpliceOwnedField('priority'), false);
      assert.equal(isSpliceOwnedField('evidence'), false);
    });

    it('does not coerce a non-string', () => {
      for (const value of [undefined, null, 42, true, {}, ['blocked-by']]) {
        assert.equal(isSpliceOwnedField(value), false, String(value));
      }
    });
  });

  it('THE DERIVATION PIN: clearable says what an empty value actually does', () => {
    // For each owned field, splice an explicit empty value into a block that
    // HAS that entry, and assert the entry is gone iff the table says clearable.
    // This is what stops the exported table from being a description that can
    // drift: `owns` reads these same rows, so a wrong row is a wrong splice.
    const ref = { repo: null, id: '9' };
    const empties: Readonly<Record<string, GeneratedEdges>> = {
      'blocked-by': { blockedBy: [] },
      'serialize-with': { serializeWith: null },
      'decomposed-from': { decomposedFrom: null },
      'duplicate-of': { duplicateOf: null },
    };
    for (const field of SPLICE_OWNED_FIELDS) {
      const { property, clearable } = SPLICE_FIELD_OWNERSHIP[field];
      const seeded =
        property === 'blockedBy'
          ? renderFrontmatter({ blockedBy: [ref], priority: 1 })
          : renderFrontmatter({ blockedBy: [ref], priority: 1, [property]: ref });
      const body = `${seeded as string}\n\nTail.`;
      const next = spliceGeneratedEdges(body, empties[field] as GeneratedEdges);
      assert.notEqual(next, null, field);
      const data = parseFrontmatter(next as string).data;
      const present = property === 'blockedBy'
        ? (data?.blockedBy.length ?? 0) > 0
        : data?.[property as 'serializeWith' | 'decomposedFrom' | 'duplicateOf'] != null;
      assert.equal(
        present,
        !clearable,
        `${field}: clearable=${clearable} but the entry is ${present ? 'still present' : 'gone'}`,
      );
      // The un-owned neighbour survives either way — the splice is surgical.
      assert.equal(data?.priority, 1, field);
    }
  });
});
