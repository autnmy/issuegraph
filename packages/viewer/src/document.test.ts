import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ViewerDocument, normalizeDocument } from './document.ts';
import { doublePlacedDocument, fixtureDocument } from './testing/fixtures.ts';

const emptyOrder = { slots: [], excluded: [] };

// ONE SLOT CARRYING EVERY MEMBER. `together-with` is drawn as an enclosure around
// a slot's members, so an edge the order does not group is dropped as undrawable
// — which means a cardinality test written with `together-with` and no order at
// all is testing an input the reader rejects for a different reason first.
function groupedOrder(...members: readonly string[]) {
  return {
    slots: [{ lead: members[0] as string, members: [...members], rank: 1, ready: true, holds: [] }],
    excluded: [],
  };
}

function issue(key: string, extra: Partial<ViewerDocument['issues'][number]> = {}) {
  return { key, title: `Issue ${key}`, open: true, priority: 2, ...extra };
}

describe('normalizeDocument', () => {
  it('keeps one declaration per single-reference field, not just decomposed-from', () => {
    // The format calls FOUR fields single-reference and this reader enforced
    // exactly one of them, so two `duplicate-of` edges from one issue both
    // survived — two badges for one relationship and two graph paths, where the
    // format promises one fact and this reader promises a diagnostic.
    for (const field of ['duplicate-of', 'serialize-with', 'together-with'] as const) {
      const { document, diagnostics } = normalizeDocument({
        issues: [issue('1'), issue('2'), issue('3')],
        edges: [
          { field, from: '1', to: '2' },
          { field, from: '1', to: '3' },
        ],
        // Grouped for every field, not only the one that needs it: a
        // `together-with` the order does not carry is dropped as undrawable
        // before cardinality is ever reached, and the other fields do not care.
        order: groupedOrder('1', '2', '3'), cycles: [],
      });

      assert.equal(document.edges.length, 1, `${field} kept both declarations`);
      assert.equal(document.edges[0]?.to, '2', `${field} did not keep the FIRST declaration`);
      assert.ok(
        diagnostics.some((line) => line.includes(`more than one ${field}`)),
        `${field} dropped an edge without saying so`,
      );
    }
  });

  it('still lets both endpoints of a symmetric edge declare it', () => {
    // The cardinality rule above counts DECLARATIONS PER ISSUE, and it has to,
    // because `A together-with B` plus `B together-with A` is one undirected
    // fact written the way the format asks — each endpoint declaring once. A
    // rule keyed on the endpoint pair would read the reverse as a repeat and
    // report a perfectly ordinary document as malformed.
    const both = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [
        { field: 'together-with', from: '1', to: '2' },
        { field: 'together-with', from: '2', to: '1' },
      ],
      order: groupedOrder('1', '2'), cycles: [],
    });

    assert.equal(both.document.edges.length, 1);
    assert.equal(
      both.diagnostics.filter((line) => line.includes('more than one')).length,
      0,
      'the reverse declaration was reported as a cardinality violation',
    );

    // And a three-member group, where two members both point at the third, is
    // two legitimate declarations — not one issue declaring twice.
    const group = normalizeDocument({
      issues: [issue('1'), issue('2'), issue('3')],
      edges: [
        { field: 'together-with', from: '2', to: '1' },
        { field: 'together-with', from: '3', to: '1' },
      ],
      order: groupedOrder('1', '2', '3'), cycles: [],
    });

    assert.equal(group.document.edges.length, 2);
    assert.equal(
      group.diagnostics.filter((line) => line.includes('more than one')).length,
      0,
      'a group formed by two members pointing at one was rejected',
    );
  });

  it('counts a symmetric declaration the dedupe later collapses', () => {
    // ORDER OF THE TWO RULES, made falsifiable. The dedupe drops `2 -> 1` as a
    // repeat of one fact, so counted AFTER it that declaration would spend
    // nothing and `2 -> 3` would read as issue 2's first — when it is really its
    // second. Every declaration an author WROTE is counted, whatever the reader
    // later collapses.
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2'), issue('3')],
      edges: [
        { field: 'serialize-with', from: '1', to: '2' },
        { field: 'serialize-with', from: '2', to: '1' },
        { field: 'serialize-with', from: '2', to: '3' },
      ],
      order: emptyOrder, cycles: [],
    });

    assert.equal(document.edges.length, 1, 'issue 2 got a second serialize-with edge');
    assert.ok(diagnostics.some((line) => line.includes('more than one serialize-with')));
  });

  it('collapses an exact repeat of a directed edge, and keeps its reverse', () => {
    // The dedupe covered symmetric fields only, so `A blocked-by B` listed twice
    // survived as two edges — two identical graph paths, two badges, and a
    // blocking count in the refusal summary inflated past what the canvas holds.
    const twice = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [
        { field: 'blocked-by', from: '1', to: '2' },
        { field: 'blocked-by', from: '1', to: '2' },
      ],
      order: emptyOrder, cycles: [],
    });
    assert.equal(twice.document.edges.length, 1, 'an exact repeat survived as two edges');

    // THE HALF THAT MUST NOT BE LOST: a directed field's reverse is a DIFFERENT
    // claim, so it stays. Collapsing it would be the symmetric rule applied to a
    // field that has no such equivalence.
    const both = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [
        { field: 'blocked-by', from: '1', to: '2' },
        { field: 'blocked-by', from: '2', to: '1' },
      ],
      order: emptyOrder, cycles: [],
    });
    assert.equal(both.document.edges.length, 2, 'the distinct reverse edge was collapsed away');
  });

  it('drops a together-with the order does not group, and says why', () => {
    // It is drawn as an ENCLOSURE around one slot's members, never as an arc, and
    // the enclosures come from the slot table — so an edge whose endpoints sit in
    // different slots, or in none, produced no mark anywhere while still counting
    // toward the relationship total the legend prints. Measured before the fix: a
    // document with one such edge said "2 relationships" and drew one.
    for (const [label, order] of [
      ['different slots', { slots: [
        { lead: '1', members: ['1'], rank: 1, ready: true, holds: [] },
        { lead: '2', members: ['2'], rank: 2, ready: true, holds: [] },
      ], excluded: [] }],
      ['no slots at all', emptyOrder],
    ] as const) {
      const { document, diagnostics } = normalizeDocument({
        issues: [issue('1'), issue('2')],
        edges: [{ field: 'together-with', from: '1', to: '2' }],
        order,
        cycles: [],
      });

      assert.equal(document.edges.length, 0, `${label}: an undrawable edge was kept`);
      assert.ok(
        diagnostics.some((line) => /together-with edge 1 -> 2 is not carried by any one order slot/.test(line)),
        `${label}: it was dropped in silence`,
      );
    }
  });

  it('keeps a together-with the order does carry', () => {
    // The other half — the rule must not reject the ordinary grouped case.
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [{ field: 'together-with', from: '1', to: '2' }],
      order: groupedOrder('1', '2'), cycles: [],
    });

    assert.equal(document.edges.length, 1);
    assert.equal(
      diagnostics.filter((line) => line.includes('not carried by any one order slot')).length,
      0,
    );
  });

  it('collapses a symmetric edge declared from both ends into one undirected fact', () => {
    // Both endpoints declaring `serialize-with` is how the format asks an
    // author to write one undirected relationship down, so keeping both drew
    // the same fact twice — two badges, two paths, and an edge count that no
    // reader could reconcile with the drawing.
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [
        { field: 'serialize-with', from: '1', to: '2' },
        { field: 'serialize-with', from: '2', to: '1' },
      ],
      order: emptyOrder, cycles: [],
    });

    assert.equal(document.edges.length, 1);
    assert.equal(document.edgesOf.get('1')?.length, 1);
    assert.equal(document.edgesOf.get('2')?.length, 1);
    // Nothing is WRONG with the document, so it earns no diagnostic — a
    // reader trained to ignore these stops reading the ones that matter.
    assert.deepEqual(diagnostics, []);
  });

  it('collapses a repeat of the same symmetric direction too', () => {
    // The identity of an undirected edge is its endpoint SET, so a repeat and
    // a reverse are the same duplicate wearing different clothes.
    const { document } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [
        { field: 'together-with', from: '1', to: '2' },
        { field: 'together-with', from: '1', to: '2' },
      ],
      order: groupedOrder('1', '2'), cycles: [],
    });

    assert.equal(document.edges.length, 1);
  });

  it('does NOT collapse a directed edge declared in both directions', () => {
    // `blocked-by` is directed, so `1 -> 2` and `2 -> 1` are two different
    // claims — a mutual block, which is a cycle the reader must be shown.
    const { document } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [
        { field: 'blocked-by', from: '1', to: '2' },
        { field: 'blocked-by', from: '2', to: '1' },
      ],
      order: emptyOrder, cycles: [],
    });

    assert.equal(document.edges.length, 2);
  });

  it('keeps a well-formed document intact and diagnoses nothing', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [{ field: 'blocked-by', from: '1', to: '2' }],
      order: emptyOrder, cycles: [],
    });

    assert.deepEqual(diagnostics, []);
    assert.equal(document.issues.length, 2);
    assert.equal(document.edges.length, 1);
    assert.equal(document.byKey.get('1')?.title, 'Issue 1');
  });

  it('drops an edge naming an unknown end, and says which end', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1')],
      edges: [{ field: 'blocked-by', from: '1', to: '99' }],
      order: emptyOrder, cycles: [],
    });

    assert.equal(document.edges.length, 0);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0] as string, /names 99/);
  });

  it('remembers a decomposed-from origin outside the set rather than losing it', () => {
    const { document } = normalizeDocument({
      issues: [issue('1')],
      edges: [{ field: 'decomposed-from', from: '1', to: '900' }],
      order: emptyOrder, cycles: [],
    });

    // The edge cannot be drawn, but the FACT that a provenance was declared has
    // to survive, or the tree reports "no origin" for an issue that has one.
    assert.equal(document.edges.length, 0);
    assert.equal(document.outOfSetOrigins.get('1'), '900');
  });

  it('drops an unrecognised field', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      // A hand-built document is untrusted input; the field is checked against
      // the format's own vocabulary rather than trusted from the type.
      edges: [{ field: 'relates-to', from: '1', to: '2' } as never],
      order: emptyOrder, cycles: [],
    });

    assert.equal(document.edges.length, 0);
    assert.match(diagnostics[0] as string, /unknown field/);
  });

  it('drops a self-edge', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1')],
      edges: [{ field: 'blocked-by', from: '1', to: '1' }],
      order: emptyOrder, cycles: [],
    });

    assert.equal(document.edges.length, 0);
    assert.match(diagnostics[0] as string, /self-edge/);
  });

  it('keeps the first of two issues sharing a key and diagnoses the second', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1', { title: 'first' }), issue('1', { title: 'second' })],
      edges: [],
      order: emptyOrder, cycles: [],
    });

    assert.equal(document.issues.length, 1);
    assert.equal(document.byKey.get('1')?.title, 'first');
    assert.match(diagnostics[0] as string, /duplicate issue key/);
  });

  it('drops a slot member the document does not carry, and the slot when none survive', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1')],
      edges: [],
      order: {
        slots: [
          { rank: 1, lead: '1', members: ['1', '99'], ready: true, holds: [] },
          { rank: 2, lead: '98', members: ['98'], ready: true, holds: [] },
        ],
        excluded: [],
      },
      cycles: [],
    });

    assert.equal(document.order.slots.length, 1);
    assert.deepEqual([...(document.order.slots[0]?.members ?? [])], ['1']);
    assert.ok(diagnostics.some((line) => /has no known member/.test(line)));
  });

  it('re-leads a slot whose declared lead is not among its members', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [],
      order: {
        slots: [{ rank: 1, lead: '99', members: ['1', '2'], ready: true, holds: [] }],
        excluded: [],
      },
      cycles: [],
    });

    assert.equal(document.order.slots[0]?.lead, '1');
    assert.ok(diagnostics.some((line) => /leads instead/.test(line)));
  });

  it('places an issue once, however many slots name it', () => {
    // Two placements publish the key twice: two rows render `tabindex="0"` for
    // one focused key, while `indexOf` and the mount index address only the
    // first — roving focus breaks and the later row is unreachable.
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [],
      order: {
        slots: [
          { rank: 1, lead: '1', members: ['1'], ready: true, holds: [] },
          { rank: 2, lead: '2', members: ['2', '1'], ready: true, holds: [] },
        ],
        excluded: [],
      },
      cycles: [],
    });

    assert.deepEqual(
      document.order.slots.map((slot) => [...slot.members]),
      [['1'], ['2']],
    );
    assert.ok(diagnostics.some((line) => /already placed in an earlier slot/.test(line)));
  });

  it('drops a slot whose every member is already placed', () => {
    const { document } = normalizeDocument({
      issues: [issue('1')],
      edges: [],
      order: {
        slots: [
          { rank: 1, lead: '1', members: ['1'], ready: true, holds: [] },
          { rank: 2, lead: '1', members: ['1'], ready: true, holds: [] },
        ],
        excluded: [],
      },
      cycles: [],
    });

    assert.equal(document.order.slots.length, 1);
  });

  it('places an issue once across slots AND exclusions', () => {
    // One issue, one position — and the rule has to cover both fields, because
    // the projections publish them into one focus order. A key in a slot and in
    // `excluded`, or twice in `excluded`, published twice: `ArrowDown` from the
    // first resolved to the same key and answered `none`.
    const { document, diagnostics } = normalizeDocument(doublePlacedDocument);

    assert.deepEqual(
      document.order.excluded.map((exclusion) => exclusion.key),
      ['y'],
    );
    assert.ok(diagnostics.some((line) => /x already holds a position in the order/.test(line)));
    assert.ok(diagnostics.some((line) => /y already holds a position in the order/.test(line)));
  });

  it('reports as isolated only issues in no slot and on no edge', () => {
    const { document } = normalizeDocument({
      issues: [issue('1'), issue('2'), issue('3')],
      edges: [{ field: 'blocked-by', from: '1', to: '2' }],
      order: {
        slots: [{ rank: 1, lead: '1', members: ['1'], ready: true, holds: [] }],
        excluded: [],
      },
      cycles: [],
    });

    assert.deepEqual([...document.isolated], ['3']);
  });

  it('drops a deep link whose scheme it will not render, and says so', () => {
    // A document is untrusted input, and `url` is the one field that becomes an
    // executable surface in the DOM. Escaping the attribute does not stop
    // `javascript:` — the value has to be refused.
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      '\u0001javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      // EMBEDDED controls, not just leading ones. The URL parser removes every
      // ASCII tab and newline from ANYWHERE in the input before it reads the
      // scheme, so each of these reaches the browser as `javascript:` while a
      // raw scan finds no scheme at all and reads the value as relative.
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java\rscript:alert(1)',
      'j\ta\nv\ra\tscript:alert(1)',
      ' \tjavascript:alert(1)',
      'da\tta:text/html,<script>alert(1)</script>',
    ]) {
      const { document, diagnostics } = normalizeDocument({
        issues: [issue('1', { url })],
        edges: [],
        order: emptyOrder, cycles: [],
      });

      assert.equal(document.byKey.get('1')?.url, undefined, url);
      assert.ok(
        diagnostics.some((line) => /scheme the viewer will not link/.test(line)),
        `no diagnostic for ${url}`,
      );
    }
  });

  it('keeps the schemes a deep link legitimately uses', () => {
    for (const url of [
      'https://example.test/issues/1',
      'http://example.test/issues/1',
      'mailto:someone@example.test',
      '/issues/1',
      './1',
      '//example.test/issues/1',
    ]) {
      const { document, diagnostics } = normalizeDocument({
        issues: [issue('1', { url })],
        edges: [],
        order: emptyOrder, cycles: [],
      });

      assert.equal(document.byKey.get('1')?.url, url);
      assert.deepEqual(diagnostics, [], url);
    }
  });

  it('normalizes an empty document without diagnostics', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [],
      edges: [],
      order: emptyOrder, cycles: [],
    });

    assert.deepEqual(diagnostics, []);
    assert.equal(document.issues.length, 0);
    assert.equal(document.isolated.length, 0);
  });

  it('is deterministic — two runs over one input agree', () => {
    const first = normalizeDocument(fixtureDocument);
    const second = normalizeDocument(fixtureDocument);

    assert.deepEqual(first.diagnostics, second.diagnostics);
    assert.deepEqual([...first.document.issues], [...second.document.issues]);
    assert.deepEqual([...first.document.edges], [...second.document.edges]);
  });

  it('freezes what it returns', () => {
    const { document } = normalizeDocument(fixtureDocument);

    // A shared vocabulary a consumer can mutate is a vocabulary that disagrees
    // with itself in the next render.
    assert.ok(Object.isFrozen(document));
    assert.ok(Object.isFrozen(document.issues));
    assert.throws(() => {
      (document.issues as unknown as string[]).push('nope');
    });
  });

  it('never throws on the fixture, which carries one of everything', () => {
    const { document, diagnostics } = normalizeDocument(fixtureDocument);

    assert.deepEqual(diagnostics, []);
    assert.equal(document.order.slots.length, 4);
    assert.equal(document.order.excluded.length, 1);
  });
});

describe('normalizeDocument: the host’s cycles', () => {
  it('relays a cycle whose members it carries, in the host’s order', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2'), issue('3')],
      edges: [],
      order: emptyOrder,
      cycles: [['3', '1']],
    });
    assert.deepEqual(document.cycles, [['3', '1']]);
    assert.deepEqual(diagnostics, []);
  });

  it('drops a member this document does not carry, and says so', () => {
    // The host's reader saw the whole graph; this document may be a slice of
    // it. The cycle is still the reader's answer for the members that are here.
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [],
      order: emptyOrder,
      cycles: [['1', '9']],
    });
    assert.deepEqual(document.cycles, [['1']]);
    assert.ok(diagnostics.some((line) => line.includes('cycle member 9')), diagnostics.join('\n'));
  });

  it('drops a cycle none of whose members it carries, and says so', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1')],
      edges: [],
      order: emptyOrder,
      cycles: [['8', '9'], ['1']],
    });
    assert.deepEqual(document.cycles, [['1']]);
    assert.ok(diagnostics.some((line) => line.includes('cycle at index 0')), diagnostics.join('\n'));
  });

  it('reports an empty cycle as the host’s, not as a slice that lost it', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1')],
      edges: [],
      order: emptyOrder,
      cycles: [[]],
    });
    assert.deepEqual(document.cycles, []);
    assert.deepEqual(diagnostics, ['cycle at index 0 is empty and was dropped']);
  });

  it('reports a repeated unknown member once', () => {
    const { diagnostics } = normalizeDocument({
      issues: [issue('1')],
      edges: [],
      order: emptyOrder,
      cycles: [['1', '9', '9']],
    });
    assert.equal(diagnostics.filter((line) => line.includes('is not an issue')).length, 1);
  });

  it('names a member once per cycle, and says so', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [],
      order: emptyOrder,
      cycles: [['1', '2', '1']],
    });
    assert.deepEqual(document.cycles, [['1', '2']]);
    assert.deepEqual(diagnostics, ['cycle member 1 is named twice in one cycle; the repeat was dropped']);
  });

  it('does not check a cycle against the edges it draws', () => {
    // A cycle the reader found can run through an edge the host chose not to
    // draw, and the badge must not depend on that choice — it is the reason
    // the answer is an input at all.
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [{ field: 'blocked-by', from: '1', to: '2' }],
      order: emptyOrder,
      cycles: [['1', '2']],
    });
    assert.deepEqual(document.cycles, [['1', '2']]);
    assert.deepEqual(diagnostics, []);
  });
});
