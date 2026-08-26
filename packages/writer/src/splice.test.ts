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
  spliceGeneratedEdges as spliceResult,
  type GeneratedEdges,
} from './splice.ts';

/**
 * The pre-#27 `string | null` shape.
 *
 * These assertions were written against that contract and they pin BEHAVIOUR —
 * which body comes out, and when none does. Rewriting forty-one call sites to
 * carry an outcome they do not test would churn the diff without strengthening
 * anything, and would make the real question harder to see. So the old shape is
 * reconstructed here in one place, and the OUTCOMES get their own tests at the
 * foot of this file, where the distinction is the subject rather than noise.
 */
function spliceGeneratedEdges(body: string, edges: GeneratedEdges): string | null {
  const result = spliceResult(body, edges);
  return result.outcome === 'spliced' ? result.body : null;
}

/**
 * A refresh a scheduling writer would make: it owns the two scheduling edges
 * and names NEITHER provenance field.
 *
 * `decomposedFrom: null` used to sit here meaning *leave it alone*. #18 gave
 * removal its own spelling, so absence carries that meaning by itself and a
 * present value can only ever be a write — see the `#18` describe block below.
 */
const NEW_EDGES: GeneratedEdges = {
  blockedBy: { set: [{ repo: null, id: '12' }] },
  serializeWith: { set: { repo: null, id: '3' } },
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
    assert.equal(spliceResult(body, NEW_EDGES).outcome, 'uneditable-block');
  });

  it('THROWS for a flow section carrying only an UNRECOGNISED extension', () => {
    // The guard used to count the recognised `Frontmatter`, which omits
    // extension fields by design — so a section carrying only `future-edge`
    // reported "nothing to lose" and the prepend demoted it in silence. §4.1
    // makes an unrecognised field inert to the READER; it never makes it
    // disposable by a WRITER. The count now comes from the section's own
    // entries.
    const body = ['---', '{issuegraph: {future-edge: "#5", note: "keep me"}}', '---', '', 'Body.'].join('\n');
    assert.equal(spliceResult(body, NEW_EDGES).outcome, 'uneditable-block');
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

  it('leaves an existing decomposed-from untouched when the input omits it', () => {
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
      decomposedFrom: { set: { repo: null, id: '42' } },
    }) as string;
    assert.deepEqual(parseFrontmatter(next).data?.decomposedFrom, { repo: null, id: '42' });
  });

  it('removes the whole block (armor and trailing blank included) when nothing remains', () => {
    const block = renderFrontmatter({ blockedBy: [{ repo: null, id: '7' }] }) as string;
    assert.equal(
      spliceGeneratedEdges(`${block}\n\nThe brief body.`, {
        blockedBy: { clear: true },
        serializeWith: { clear: true },
        decomposedFrom: { clear: true },
      }),
      'The brief body.',
    );
  });

  it('drops only the bare issuegraph header when siblings keep the block alive', () => {
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - 7', 'labels-hint: platform', '---', '', 'Body.'].join(
      '\n',
    );
    const next = spliceGeneratedEdges(body, {
      blockedBy: { clear: true },
      serializeWith: { clear: true },
      decomposedFrom: { clear: true },
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
      duplicateOf: { set: { repo: null, id: '99' } },
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
      duplicateOf: { set: { repo: 'acme/widgets', id: '6' } },
    }) as string;
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.duplicateOf, { repo: 'acme/widgets', id: '6' });
    // Exactly one duplicate-of line survives — replace, never stack.
    assert.equal((next.match(/duplicate-of:/g) ?? []).length, 1);
  });

  it('leaves an existing duplicate-of untouched when the input OMITS the field', () => {
    // It used to assert this for a present `null` as well. That arm is gone
    // with the overload: `null` is not an `EdgeWrite` at all now, and the guard
    // throws on it rather than reading it as either meaning — see the
    // malformed-value suite. Omission is the only way to say "not mine", which
    // is exactly what makes it unambiguous.
    const block = renderFrontmatter({
      duplicateOf: { repo: null, id: '9' },
      blockedBy: [{ repo: null, id: '7' }],
    }) as string;
    const omitted = spliceGeneratedEdges(`${block}\n\nBody.`, NEW_EDGES) as string;
    assert.deepEqual(parseFrontmatter(omitted).data?.duplicateOf, { repo: null, id: '9' });
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
    const next = spliceGeneratedEdges(body, { duplicateOf: { set: { repo: null, id: '99' } } }) as string;
    // The exotic spelling AND the unparseable item both survive byte-for-byte —
    // proof the entries were never re-rendered.
    assert.ok(next.includes("    - '#7'"));
    assert.ok(next.includes('    - "not a ref"'));
    assert.ok(next.includes('  serialize-with: 44'));
    assert.deepEqual(parseFrontmatter(next).data?.duplicateOf, { repo: null, id: '99' });
  });

  it('treats an explicit clear as an owned remove', () => {
    const block = renderFrontmatter({
      blockedBy: [{ repo: null, id: '7' }],
      serializeWith: { repo: null, id: '4' },
      priority: 1,
    }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nBody.`, {
      blockedBy: { clear: true },
      serializeWith: { clear: true },
      decomposedFrom: { clear: true },
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

describe('every owned field clears the same way, and OMISSION is what leaves one alone (#18)', () => {
  // WHAT THIS BLOCK REPLACED. It used to pin the opposite: that a present
  // `null` removed `blocked-by` and `serialize-with` but LEFT `decomposed-from`
  // and `duplicate-of` exactly where they were. That asymmetry was correct, and
  // it was the whole of #18 — the established caller shape for provenance is
  // "write it when the block lacks one, never clobber one that is already
  // there", and such a caller passes `null` to mean LEAVE IT ALONE, so reading
  // `null` as a removal would have deleted provenance on every refresh. The
  // cost was that those two fields could be set and replaced but never cleared.
  //
  // `{ clear: true }` gives removal its own spelling, so absence now carries
  // the whole "leave alone" meaning by itself. BOTH halves are pinned below,
  // because the second one used to come for free and no longer does.
  const SEEDED = renderFrontmatter({
    blockedBy: [{ repo: null, id: '7' }],
    serializeWith: { repo: null, id: '4' },
    decomposedFrom: { repo: null, id: '9' },
    duplicateOf: { repo: null, id: '5' },
  }) as string;

  it('a clear removes every owned field, provenance and verdict included', () => {
    const next = spliceGeneratedEdges(`${SEEDED}\n\nBody.`, {
      blockedBy: { clear: true },
      serializeWith: { clear: true },
      decomposedFrom: { clear: true },
      duplicateOf: { clear: true },
    });
    // Nothing owned survives, so nothing holds the block open either.
    assert.equal(next, 'Body.');
  });

  it('clears ONE field and leaves the other three exactly where they were', () => {
    // The retraction #18 was filed for: a groomer that decided an issue is NOT
    // a duplicate after all, without disturbing edges other writers own.
    const next = spliceGeneratedEdges(`${SEEDED}\n\nBody.`, {
      duplicateOf: { clear: true },
    }) as string;
    const data = parseFrontmatter(next).data;
    assert.equal(data?.duplicateOf, null, 'the verdict is retracted');
    assert.deepEqual(data?.decomposedFrom, { repo: null, id: '9' });
    assert.deepEqual(data?.blockedBy, [{ repo: null, id: '7' }]);
    assert.deepEqual(data?.serializeWith, { repo: null, id: '4' });
  });

  it('THE REGRESSION #18 EXISTS TO PREVENT: a refresh that omits provenance does not delete it', () => {
    // The failure mode that made `null`-as-removal unsafe, restated against the
    // shape that replaced it. A writer refreshing only its own edges names
    // `blockedBy` and nothing else; both provenance fields must come through
    // byte-identical every time, or the retraction above has bought a silent
    // data loss on the commonest path there is.
    //
    // VERIFIED BY NEUTERING: make `owns` treat an absent property as owned and
    // this fails with `decomposedFrom: null`. Without running that, the
    // assertion proves only that the code did nothing unusual today.
    const next = spliceGeneratedEdges(`${SEEDED}\n\nBody.`, {
      blockedBy: { set: [{ repo: null, id: '12' }] },
    }) as string;
    const data = parseFrontmatter(next).data;
    assert.deepEqual(data?.blockedBy, [{ repo: null, id: '12' }], 'the owned field was refreshed');
    assert.deepEqual(data?.decomposedFrom, { repo: null, id: '9' }, 'provenance survived the refresh');
    assert.deepEqual(data?.duplicateOf, { repo: null, id: '5' }, 'the verdict survived the refresh');
    assert.deepEqual(data?.serializeWith, { repo: null, id: '4' }, 'and so did the unowned scheduling edge');
  });

  it('an empty `set` and a `clear` are the same edit on a list field', () => {
    // A list with no entries renders no lines, so the two spellings cannot
    // differ. Pinned so the equivalence cannot drift into a difference a caller
    // would have to learn — the insert builder says the same thing in a comment.
    const body = `${SEEDED}\n\nBody.`;
    assert.equal(
      spliceGeneratedEdges(body, { blockedBy: { set: [] } }),
      spliceGeneratedEdges(body, { blockedBy: { clear: true } }),
    );
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
    const next = spliceGeneratedEdges(body, { duplicateOf: { set: { repo: null, id: '99' } } }) as string;
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
        blockedBy: { clear: true },
        serializeWith: { clear: true },
        decomposedFrom: { clear: true },
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

    const next = spliceGeneratedEdges(body, { blockedBy: { set: [{ repo: null, id: '9' }] } });
    assert.equal(next, null, 'so a splice that would destroy it must refuse rather than hand back wreckage');
  });

  it('CONTROL: whole-block REMOVAL still succeeds, which is why intent is passed in', () => {
    // Removal legitimately ends with no declaration. Inferring "the block
    // vanished, so the edit failed" would refuse the one success whose correct
    // outcome is an absent block — so the intent is threaded rather than
    // guessed from the result.
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - "#1"', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, { blockedBy: { clear: true } });
    assert.notEqual(next, null);
    assert.equal(parseFrontmatter(next as string).data, null, 'the block is gone, which is the point');
    assert.deepEqual(parseFrontmatter(next as string).diagnostics, []);
  });

  it('CONTROL: an ordinary edit still round-trips', () => {
    // The comparative check must not refuse the common path.
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - "#1"', '  priority: 1', '---', '', 'Body.'].join('\n');
    const next = spliceGeneratedEdges(body, { blockedBy: { set: [{ repo: null, id: '9' }] } }) as string;
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
    const next = spliceGeneratedEdges(body, { blockedBy: { set: [{ repo: null, id: '9' }] } }) as string;
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
    const next = spliceGeneratedEdges(body, { blockedBy: { set: [{ repo: null, id: '9' }] } }) as string;
    assert.ok(next.includes('\n  blocked-by:'), 'two spaces for a flush header');
    assert.deepEqual(parseFrontmatter(next).data?.blockedBy, [{ repo: null, id: '9' }]);
  });

  it("CONTROL: a NON-empty section still adopts its own children's indent", () => {
    // The fallback only applies when there is nothing to measure; an author's
    // existing style still wins where one exists.
    const body = ['---', '  issuegraph:', '    priority: 1', '---'].join('\n');
    const next = spliceGeneratedEdges(body, { blockedBy: { set: [{ repo: null, id: '9' }] } }) as string;
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

  it('carries NO clearable flag — #18 left that question with no cases', () => {
    // The flag answered "does an explicit empty value remove this entry", and
    // `{ clear: true }` removes every field, so there is nothing left to ask.
    // Asserted as ABSENCE rather than as `true` on four rows: a well-meaning
    // restoration of the flag fails here, instead of quietly re-splitting the
    // fields into two classes the rest of the package would have to learn about
    // all over again.
    for (const field of SPLICE_OWNED_FIELDS) {
      assert.deepEqual(Object.keys(SPLICE_FIELD_OWNERSHIP[field]), ['property'], field);
    }
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

  it('THE DERIVATION PIN: every row in the table actually clears through the splice', () => {
    // For each owned field, splice a clear into a block that HAS that entry and
    // assert the entry is gone. This is what stops the exported table from
    // being a description that can drift: `owns` reads these same rows, so a
    // wrong row is a wrong splice.
    //
    // It used to assert "gone IFF the table says clearable". #18 removed the
    // flag and the conditional with it, so the expectation is unconditional
    // across all four now — which is the change, stated as a test rather than
    // as a sentence in a doc comment.
    const ref = { repo: null, id: '9' };
    const clears: Readonly<Record<string, GeneratedEdges>> = {
      'blocked-by': { blockedBy: { clear: true } },
      'serialize-with': { serializeWith: { clear: true } },
      'decomposed-from': { decomposedFrom: { clear: true } },
      'duplicate-of': { duplicateOf: { clear: true } },
    };
    for (const field of SPLICE_OWNED_FIELDS) {
      const { property } = SPLICE_FIELD_OWNERSHIP[field];
      const seeded =
        property === 'blockedBy'
          ? renderFrontmatter({ blockedBy: [ref], priority: 1 })
          : renderFrontmatter({ blockedBy: [ref], priority: 1, [property]: ref });
      const body = `${seeded as string}\n\nTail.`;
      const next = spliceGeneratedEdges(body, clears[field] as GeneratedEdges);
      assert.notEqual(next, null, field);
      const data = parseFrontmatter(next as string).data;
      const present = property === 'blockedBy'
        ? (data?.blockedBy.length ?? 0) > 0
        : data?.[property as 'serializeWith' | 'decomposedFrom' | 'duplicateOf'] != null;
      assert.equal(present, false, `${field}: the clear did not remove the entry`);
      // The un-owned neighbour survives either way — the splice is surgical.
      assert.equal(data?.priority, 1, field);
    }
  });
});

describe('the splice result is distinguished (#27) and verified (#28)', () => {
  const WANT: GeneratedEdges = { blockedBy: { set: [{ repo: null, id: '9' }] } };

  it('no-block is the ONLY outcome that licenses the prepend', () => {
    // The conflation this union exists to end: `null` meant both "there is no
    // block, prepend one" — lossless — and "I could not edit the block that is
    // there", where prepending demotes the canonical block under §4.1 and every
    // field the call does not own goes with it.
    assert.equal(spliceResult('Just prose, no block.\n', WANT).outcome, 'no-block');
  });

  it('uneditable-block hands back the parsed value, so the caller can re-render', () => {
    // A flow mapping carrying an entry this call does not own. Before #27 this
    // THREW, which removed the silence and left a caller nothing to branch on
    // but an exception message.
    const body = '---\nissuegraph: { priority: 1 }\n---\n\nProse.';
    const result = spliceResult(body, WANT);

    assert.equal(result.outcome, 'uneditable-block');
    // THE VALUE IS THE USEFUL PART: re-rendering the block from it plus the
    // call's own edges is the one correct repair.
    assert.equal(result.outcome === 'uneditable-block' ? result.data.priority : null, 1);
  });

  it('spliced carries the body', () => {
    const body = '---\nissuegraph:\n  priority: 1\n---\n\nProse.';
    const result = spliceResult(body, WANT);

    assert.equal(result.outcome, 'spliced');
    assert.ok(result.outcome === 'spliced' && result.body.includes('"#9"'));
  });

  it('every spliced result actually CONTAINS what was asked for', () => {
    // #28's invariant, as a property over shapes rather than one case per bug.
    // Readability is not the same question: a body can parse perfectly while
    // containing none of the edit. Measured on the historical fixed-child-indent
    // defect — `blocked-by` written as a SIBLING of `issuegraph:` — the result
    // parsed, the call reported success, and `blockedBy` came back `[]`. Every
    // shape below went through that door.
    const SHAPES: readonly (readonly [string, string])[] = [
      ['empty section alone', '---\nissuegraph:\n---'],
      ['empty section, sibling after', '---\nissuegraph:\nother: 1\n---'],
      ['empty section, sibling before', '---\nother: 1\nissuegraph:\n---'],
      ['two-space children', '---\nissuegraph:\n  priority: 1\n---'],
      ['four-space children', '---\nissuegraph:\n    priority: 1\n---'],
      ['eight-space children', '---\nissuegraph:\n        priority: 1\n---'],
      ['existing blocked-by, block style', '---\nissuegraph:\n  blocked-by:\n    - "#1"\n---'],
      ['existing blocked-by, flow style', '---\nissuegraph:\n  blocked-by: ["#1"]\n---'],
      ['quoted owned key', '---\nissuegraph:\n  "blocked-by":\n    - "#1"\n---'],
      ['quoted section header', '---\n"issuegraph":\n  priority: 1\n---'],
      ['unrecognised sibling field', '---\nissuegraph:\n  future-edge: "#5"\n---'],
      ['CRLF endings', '---\r\nissuegraph:\r\n  priority: 1\r\n---'],
    ];

    let spliced = 0;
    for (const [label, body] of SHAPES) {
      const result = spliceResult(body, WANT);
      if (result.outcome !== 'spliced') continue;
      spliced += 1;
      const after = parseFrontmatter(result.body).data;
      assert.deepEqual(
        after?.blockedBy,
        [{ repo: null, id: '9' }],
        `${label}: reported spliced, but the edge is not in the declaration`,
      );
    }
    // Without this the test would pass for a splice that refused everything.
    assert.ok(spliced >= SHAPES.length - 2, `only ${spliced} of ${SHAPES.length} shapes spliced at all`);
  });

  it('clearing to [] leaves no refs behind, which is the same check inverted', () => {
    const body = '---\nissuegraph:\n  blocked-by:\n    - "#1"\n    - "#2"\n  priority: 1\n---';
    const result = spliceResult(body, { blockedBy: { set: [] } });

    assert.equal(result.outcome, 'spliced');
    const after = result.outcome === 'spliced' ? parseFrontmatter(result.body).data : null;
    assert.deepEqual(after?.blockedBy, []);
    assert.equal(after?.priority, 1, 'an unowned field was not preserved');
  });
});

describe('whole-block removal takes only its OWN armor', () => {
  /**
   * NEWLY REACHABLE BECAUSE OF #18, which is why it is fixed here rather than
   * filed. Before this change a block carrying only `duplicate-of` could not be
   * emptied at all — provenance had no clear — so the whole-block removal path
   * was unreachable for it. `--no-duplicate-of` reaches it now.
   *
   * The armor test used to read the two neighbouring lines in isolation, and a
   * BARE ``` matches `FENCE_OPEN` and `FENCE_CLOSE` alike. So a block sitting
   * between the close of an earlier code block and the open of a later one read
   * as armored. Measured: both fence lines were deleted and the two unrelated
   * code blocks MERGED INTO ONE — structural corruption of the body, in the one
   * package whose entire contract is byte preservation.
   */
  const CLEAR_IT: GeneratedEdges = { duplicateOf: { clear: true } };

  it('does not eat fences belonging to the code blocks around it', () => {
    const body = [
      '```',
      'an earlier code block',
      '```',
      '---',
      'issuegraph:',
      '  duplicate-of: "#42"',
      '---',
      '```',
      'a later code block',
      '```',
      '',
      'Tail.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, CLEAR_IT) as string;
    assert.notEqual(next, null);
    // Four fence lines in, four fence lines out. Counting them is the whole
    // assertion: losing any pair silently merges two code blocks.
    assert.equal((next.match(/```/g) ?? []).length, 4, next);
    assert.ok(next.includes('an earlier code block'), next);
    assert.ok(next.includes('a later code block'), next);
    assert.ok(!next.includes('issuegraph:'), 'the block itself must still go');
  });

  it('CONTROL: it still eats its OWN armor', () => {
    // Without this control the test above would pass for a splice that had
    // simply stopped removing fences at all, leaving an empty ``` ``` pair.
    const block = renderFrontmatter({ duplicateOf: { repo: null, id: '42' } }, { fenceWrapped: true }) as string;
    const next = spliceGeneratedEdges(`${block}\n\nTail.`, CLEAR_IT);
    assert.equal(next, 'Tail.');
  });

  it('a LONGER fence containing a fence-shaped content line is still one block', () => {
    // RAISED IN REVIEW, on the parity check itself. A four-backtick block may
    // legitimately contain a three-backtick line — it is how you document a
    // fence — and that line closes nothing. Counting every fence-SHAPED line
    // made the parity wrong by one, so the closer below read as an opener and
    // the removal ate it together with the next block's opener.
    //
    // Measured before the fix: 5 fence lines in, 3 out, and the two unrelated
    // code blocks merged — exactly the corruption the parity check was added to
    // prevent, reintroduced by the check itself.
    //
    // ODD is what breaks it: an even number of miscounted content lines cancels
    // out and the wrong model looks right, which is why the first attempt at
    // this test passed against the broken code.
    const body = [
      '````',
      '```',
      '````',
      '---',
      'issuegraph:',
      '  duplicate-of: "#42"',
      '---',
      '```',
      'a later code block',
      '```',
      '',
      'Tail.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, CLEAR_IT) as string;
    assert.notEqual(next, null);
    assert.equal((next.match(/^`{3,}/gm) ?? []).length, 5, next);
    assert.ok(next.includes('a later code block'), next);
    assert.ok(!next.includes('issuegraph:'), 'the block itself must still go');
  });

  it('an INFO-STRING line inside a longer fence closes nothing either', () => {
    // The other half of the same finding. A closer carries no info string, so
    // ```` ```js ```` is content wherever it appears — but it matches the
    // OPEN pattern, so a shape-only test counts it.
    const body = [
      '````',
      '```js',
      '````',
      '---',
      'issuegraph:',
      '  duplicate-of: "#42"',
      '---',
      '```',
      'a later code block',
      '```',
      '',
      'Tail.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, CLEAR_IT) as string;
    assert.equal((next.match(/^`{3,}/gm) ?? []).length, 5, next);
    assert.ok(next.includes('a later code block'), next);
  });

  it('CONTROL: a SHORTER run inside a longer fence does not close it', () => {
    // A closer must be at least as long as its opener. Three backticks cannot
    // close a four-backtick block, which is the rule that makes the two tests
    // above true rather than a special case about content.
    const body = [
      '````',
      '```',
      'still inside the four-backtick block',
      '````',
      '',
      'Tail.',
    ].join('\n');
    // No block at all here — the point is only that the fence model agrees the
    // four-backtick block is still open across the three-backtick line, which
    // `no-block` demonstrates without depending on the removal path.
    assert.equal(spliceGeneratedEdges(body, CLEAR_IT), null);
  });

  it('KEEPS its armor when the body carries any other fence — the deliberate trade', () => {
    // THIS TEST ASSERTED THE OPPOSITE UNTIL ROUND 3, and the inversion is the
    // change rather than a regression. Deciding whether a given fence line
    // opens or closes means deciding Markdown block structure, and every
    // version of that heuristic died to a construct it had not modelled — a
    // fence-shaped content line, then an info string containing a space, with
    // `~~~` fences and indented fences behind them. So the removal stopped
    // deciding: it deletes the pair only when those two are the ONLY
    // fence-shaped lines in the body, where they can only be each other's
    // partner.
    //
    // The cost is here: an armored block sharing a body with a code block keeps
    // an empty ``` ``` pair. That is cosmetic. Getting it wrong the other way
    // merges two unrelated code blocks, which is structural corruption in the
    // package whose whole contract is byte preservation.
    const body = [
      '```js',
      'const x = 1;',
      '```',
      '',
      '```yaml',
      '---',
      'issuegraph:',
      '  duplicate-of: "#42"',
      '---',
      '```',
      '',
      'Tail.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, CLEAR_IT) as string;
    assert.notEqual(next, null);
    assert.ok(!next.includes('issuegraph:'), 'the block itself still goes');
    assert.ok(next.includes('const x = 1;'), 'the unrelated code block is untouched');
    assert.equal((next.match(/^`{3,}/gm) ?? []).length, 4, `all four fence lines survive: ${next}`);
  });

  it('an INFO STRING WITH A SPACE does not fool it — the round-3 finding', () => {
    // The reader's `FENCE_OPEN` accepts one alphanumeric token, so
    // ```` ```js title="x" ```` reads to it as ordinary prose. The fence-state
    // walk therefore skipped that opener and treated the bare closer above the
    // block as an opener. Measured before the fix: 4 fence lines in, 2 out, and
    // the two unrelated blocks merged.
    const body = [
      '```js title="x"',
      'const x = 1;',
      '```',
      '---',
      'issuegraph:',
      '  duplicate-of: "#42"',
      '---',
      '```',
      'a later code block',
      '```',
      '',
      'Tail.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, CLEAR_IT) as string;
    assert.notEqual(next, null);
    assert.equal((next.match(/^`{3,}/gm) ?? []).length, 4, next);
    assert.ok(next.includes('a later code block'), next);
    assert.ok(!next.includes('issuegraph:'), 'the block itself still goes');
  });

  it('a TILDE fence counts too, though no reader pattern matches one', () => {
    // The next construct queued behind the info string: `~~~` is a CommonMark
    // fence and neither reader pattern accepts it. Counting uses a looser test
    // than the reader's precisely so "is anything else here fence-shaped?"
    // cannot be answered wrongly in the direction that deletes.
    const body = [
      '~~~js',
      'const x = 1;',
      '~~~',
      '---',
      'issuegraph:',
      '  duplicate-of: "#42"',
      '---',
      '```',
      'a later code block',
      '```',
      '',
      'Tail.',
    ].join('\n');
    const next = spliceGeneratedEdges(body, CLEAR_IT) as string;
    assert.notEqual(next, null);
    assert.equal((next.match(/^(?:`{3,}|~{3,})/gm) ?? []).length, 4, next);
    assert.ok(next.includes('a later code block'), next);
  });
});

describe('a malformed edge value throws before anything is written (#18)', () => {
  /**
   * WHY THIS SUITE IS THE OTHER HALF OF #18. Replacing a bare value with
   * {@link EdgeWrite} makes the old shape a COMPILE ERROR, which closes the
   * break for TypeScript callers and does nothing at all for the others — a
   * published package's type annotation is a promise to a compiler, exactly as
   * `@issuegraph/core`'s predicates were corrected on.
   *
   * The reachable population is therefore plain-JavaScript callers still
   * holding `decomposedFrom: null`, and for them the ONLY unacceptable outcome
   * is that it be read as a clear: that is the precise silent data loss #18 was
   * filed to prevent, arriving through the fix for it. So the writer throws,
   * which is this package's stated discipline — a writer takes its caller's own
   * control-plane data, so a contract violation is a programmer error.
   *
   * MEASURED BEFORE THE GUARD EXISTED, and the two rows that matter are the
   * silent ones: `{ blockedBy: [ref] }` — the old list spelling — read as a
   * CLEAR and removed every blocker the caller was trying to set, and
   * `{ set, clear }` together silently took the clear. The rest surfaced as a
   * `TypeError` from inside `renderRef` or a property read on `null`, naming
   * neither the field nor the value.
   */
  const REF = { repo: null, id: '5' } as const;
  const BODY = '---\nissuegraph:\n  blocked-by:\n    - "#1"\n  duplicate-of: "#2"\n  priority: 1\n---\n\nBody.';

  /**
   * EACH ROW CARRIES THE REASON IT MUST REPORT, not just "it threw".
   *
   * Asserting only that a prefixed `TypeError` escaped would pass for a guard
   * whose four reason branches had all been garbled into one — the message is
   * the entire value of refusing here rather than crashing somewhere downstream,
   * so the message is what the test pins. Raised in review.
   */
  const MALFORMED: readonly (readonly [label: string, edges: unknown, reason: string])[] = [
    ['the old provenance spelling: null', { decomposedFrom: null }, 'not a plain object'],
    ['the old single spelling: a bare ref', { duplicateOf: REF }, 'names neither'],
    ['the old list spelling: a bare array', { blockedBy: [REF] }, 'not a plain object'],
    ['neither key', { serializeWith: {} }, 'names neither'],
    ['a misspelled key', { duplicateOf: { st: REF } }, 'names neither'],
    ['clear: false — a third meaning nobody needs', { duplicateOf: { clear: false } }, 'only ever `true`'],
    ['both arms at once', { duplicateOf: { set: REF, clear: true } }, 'names both'],
    ['a number', { duplicateOf: 42 }, 'not a plain object'],
    ['an array', { duplicateOf: [] }, 'not a plain object'],
    ['set with no value', { duplicateOf: { set: undefined } }, 'names neither'],

    // THE ROW THIS SUITE WAS MISSING, and the only one whose old behaviour was
    // SILENT. `{ set: null }` is the naive mechanical wrap of the pre-#18
    // spelling — a caller migrating `decomposedFrom: null` by adding `set:`
    // around it — and it removed the entry and reported success. That is the
    // exact data loss #18 exists to prevent, arriving through the fix for it.
    // Found by two independent reviewers on different models.
    ['set: null on a single — the naive wrap of the old spelling', { decomposedFrom: { set: null } }, 'carries no value'],
    ['set: null on the verdict', { duplicateOf: { set: null } }, 'carries no value'],
    ['set: null on a scheduling edge', { serializeWith: { set: null } }, 'carries no value'],
    ['set: null on the list', { blockedBy: { set: null } }, 'carries no value'],

    // A PAYLOAD OF THE WRONG SHAPE is named by the field rather than escaping
    // from inside `renderRef`. `{ set: "#9" }` — a ref spelled as a string
    // instead of an `IssueRef` — is a plausible caller mistake that used to
    // report `ref id undefined is not a valid tracker identifier`.
    ['a single set to a string', { duplicateOf: { set: '#9' } }, 'is a ref'],
    ['a single set to a number', { duplicateOf: { set: 42 } }, 'is a ref'],
    ['a single set to an array', { duplicateOf: { set: [] } }, 'is a ref'],
    ['a list set to a number', { blockedBy: { set: 42 } }, 'is an array'],
    ['a list set to a bare ref', { blockedBy: { set: REF } }, 'is an array'],
  ];

  for (const [label, edges, reason] of MALFORMED) {
    it(`throws on ${label}`, () => {
      assert.throws(
        () => spliceResult(BODY, edges as GeneratedEdges),
        (error: unknown) =>
          error instanceof TypeError &&
          /issuegraph splice:/.test(String(error)) &&
          String(error).includes(reason),
        `${label} — expected the message to say ${JSON.stringify(reason)}`,
      );
    });
  }

  it('THE SNAPSHOT: a value that CHANGES between reads cannot make the call lie', () => {
    // A stateful getter returned a valid ref while the guard looked, then
    // `null` when the insert builder and the verifier looked. Measured before
    // the fix: the property was read THREE times, the existing entry was
    // removed, `ownedFieldMismatch` compared null against null and agreed, and
    // the call returned `spliced` — reporting success for the exact opposite of
    // what it was asked to do. No refusal, no crash, a persisted wrong body.
    //
    // The fix is not another check: each owned property is read ONCE into a
    // snapshot, and ownership, insertion and verification all read that. A
    // value that changes afterwards cannot be seen to change, which is why this
    // test asserts an OUTCOME rather than a read count.
    const seeded = '---\nissuegraph:\n  duplicate-of: "#42"\n  priority: 1\n---\n\nBody.';
    let reads = 0;
    const stateful = {
      get set(): typeof REF | null {
        return reads++ === 0 ? REF : null;
      },
    };
    const result = spliceResult(seeded, { duplicateOf: stateful } as unknown as GeneratedEdges);

    // Either outcome is defensible — refuse it, or honour the first read. What
    // is NOT defensible is `spliced` with the entry gone, which is what the
    // caller never asked for and was told had succeeded.
    if (result.outcome === 'spliced') {
      const data = parseFrontmatter(result.body).data;
      assert.deepEqual(
        data?.duplicateOf,
        REF,
        'reported success while REMOVING the entry the call asked it to set',
      );
      assert.equal(data?.priority, 1, 'and the unowned neighbour must survive either way');
    }
  });

  it('a getter on the OUTER property is snapshotted too', () => {
    // The same hole one level up: `edges.duplicateOf` itself is a getter. The
    // guard reads the property to validate it and every later site reads it
    // again, so a snapshot taken only of the INNER wrapper would still let this
    // one through.
    const seeded = '---\nissuegraph:\n  duplicate-of: "#42"\n  priority: 1\n---\n\nBody.';
    let reads = 0;
    const edges = {
      get duplicateOf(): unknown {
        return reads++ === 0 ? { set: REF } : { clear: true };
      },
    };
    const result = spliceResult(seeded, edges as unknown as GeneratedEdges);
    if (result.outcome === 'spliced') {
      assert.deepEqual(
        parseFrontmatter(result.body).data?.duplicateOf,
        REF,
        'reported success while REMOVING the entry the call asked it to set',
      );
    }
  });

  it('runs AHEAD of locateBlock, so a malformed request is not answered `no-block`', () => {
    // THE ORDERING, TESTED WHERE IT IS ACTUALLY OBSERVABLE. "The body was not
    // modified" cannot fail here — a body is a string, and this function
    // returns a new one rather than mutating its argument — so an assertion
    // about the input would pass against any ordering whatsoever.
    //
    // A body with NO BLOCK is where the difference shows. Guard first: the
    // malformed value throws. Guard after `locateBlock`: the call returns
    // `no-block`, the caller takes the documented prepend, and a request that
    // was malformed is answered as though it were fine. Verified by neutering —
    // moving the call below the `no-block` return makes this the only failure.
    assert.throws(
      () => spliceResult('Just prose, no block.\n', { duplicateOf: null } as unknown as GeneratedEdges),
      TypeError,
    );
  });

  it('checks EVERY named field, not just the first one it finds', () => {
    // A guard that returned at the first well-formed field would wave the
    // malformed one through, which is the shape the loop makes impossible.
    assert.throws(
      () =>
        spliceResult(BODY, {
          blockedBy: { set: [REF] },
          serializeWith: { set: REF },
          duplicateOf: null,
        } as unknown as GeneratedEdges),
      (error: unknown) => String(error).includes('duplicate-of'),
    );
  });

  it('names the field and the value, and does not throw while doing it', () => {
    // THE #53 LESSON, one package over: `JSON.stringify` throws on a bigint and
    // on a cyclic structure, and this formatter runs on data a DIRECT caller
    // supplied — so a naive message builder enters its rejection branch
    // correctly and then escapes with a TypeError from inside the message. The
    // very defect the guard was added for, one line later.
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    // A FUNCTION CARRYING A THROWING `toString`, which is the case this test
    // MISSED. It used a plain arrow function — whose `toString` is perfectly
    // safe — so it passed against a formatter that fell straight through to
    // `String(value)` for anything `typeof`-tagged `'function'`. Measured: the
    // call escaped with this function's own `Error: gotcha` instead of the
    // `TypeError` naming the field. Raised in review.
    const hostile = (): undefined => undefined;
    (hostile as unknown as Record<string, unknown>)['toString'] = (): never => {
      throw new Error('gotcha');
    };
    // An object with the same hostility, which was already safe: objects are
    // described with `Object.keys`, never with `String`. Kept so the two paths
    // cannot silently swap which of them is the covered one.
    const hostileObject: Record<string, unknown> = { set: undefined };
    hostileObject['toString'] = (): never => {
      throw new Error('gotcha');
    };

    const HOSTILE: readonly (readonly [label: string, value: unknown])[] = [
      ['a bigint', 1n],
      ['a cyclic object', cyclic],
      ['a symbol', Symbol('s')],
      ['a plain function (the CONTROL that used to be the whole test)', () => undefined],
      ['a function with a throwing toString', hostile],
      ['an object with a throwing toString', hostileObject],
    ];

    for (const [label, value] of HOSTILE) {
      let caught: unknown;
      try {
        spliceResult(BODY, { duplicateOf: value } as unknown as GeneratedEdges);
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof TypeError, `${label}: escaped with ${String(caught)}`);
      assert.ok(String(caught).includes('duplicate-of'), `${label}: ${String(caught)}`);
      assert.ok(
        String(caught).includes('issuegraph splice:'),
        `${label}: the message is not this package's — ${String(caught)}`,
      );
    }
  });

  it('CONTROL: an explicitly-undefined field is absent, not malformed', () => {
    // Absent and explicitly-undefined mean the same thing everywhere else in
    // this codebase, so refusing one of them would be a rule with no defect
    // behind it — and `exactOptionalPropertyTypes` already stops TypeScript
    // callers writing it.
    // Cast, because `exactOptionalPropertyTypes` means a TypeScript caller
    // cannot write this at all — which is the point: the shape is reachable
    // only from JavaScript, and it must be treated as absent there too.
    const next = spliceResult(BODY, {
      blockedBy: { set: [REF] },
      duplicateOf: undefined,
    } as unknown as GeneratedEdges);
    assert.equal(next.outcome, 'spliced');
    const data = next.outcome === 'spliced' ? parseFrontmatter(next.body).data : null;
    assert.deepEqual(data?.duplicateOf, { repo: null, id: '2' }, 'the untouched field survived');
  });

  it('CONTROL: every well-formed shape still passes the guard', () => {
    const WELL_FORMED: readonly GeneratedEdges[] = [
      { blockedBy: { set: [REF] } },
      { blockedBy: { set: [] } },
      { blockedBy: { clear: true } },
      { serializeWith: { set: REF } },
      { serializeWith: { clear: true } },
      { decomposedFrom: { set: REF } },
      { decomposedFrom: { clear: true } },
      { duplicateOf: { set: REF } },
      { duplicateOf: { clear: true } },
    ];
    for (const edges of WELL_FORMED) {
      assert.doesNotThrow(() => spliceResult(BODY, edges), JSON.stringify(edges));
    }
  });
});
