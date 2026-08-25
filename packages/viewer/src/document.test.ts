import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ViewerDocument, normalizeDocument } from './document.ts';
import { doublePlacedDocument, fixtureDocument } from './testing/fixtures.ts';

const emptyOrder = { slots: [], excluded: [] };

function issue(key: string, extra: Partial<ViewerDocument['issues'][number]> = {}) {
  return { key, title: `Issue ${key}`, open: true, priority: 2, ...extra };
}

describe('normalizeDocument', () => {
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
      order: emptyOrder,
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
      order: emptyOrder,
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
      order: emptyOrder,
    });

    assert.equal(document.edges.length, 2);
  });

  it('keeps a well-formed document intact and diagnoses nothing', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1'), issue('2')],
      edges: [{ field: 'blocked-by', from: '1', to: '2' }],
      order: emptyOrder,
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
      order: emptyOrder,
    });

    assert.equal(document.edges.length, 0);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0] as string, /names 99/);
  });

  it('remembers a decomposed-from origin outside the set rather than losing it', () => {
    const { document } = normalizeDocument({
      issues: [issue('1')],
      edges: [{ field: 'decomposed-from', from: '1', to: '900' }],
      order: emptyOrder,
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
      order: emptyOrder,
    });

    assert.equal(document.edges.length, 0);
    assert.match(diagnostics[0] as string, /unknown field/);
  });

  it('drops a self-edge', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1')],
      edges: [{ field: 'blocked-by', from: '1', to: '1' }],
      order: emptyOrder,
    });

    assert.equal(document.edges.length, 0);
    assert.match(diagnostics[0] as string, /self-edge/);
  });

  it('keeps the first of two issues sharing a key and diagnoses the second', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [issue('1', { title: 'first' }), issue('1', { title: 'second' })],
      edges: [],
      order: emptyOrder,
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
        order: emptyOrder,
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
        order: emptyOrder,
      });

      assert.equal(document.byKey.get('1')?.url, url);
      assert.deepEqual(diagnostics, [], url);
    }
  });

  it('normalizes an empty document without diagnostics', () => {
    const { document, diagnostics } = normalizeDocument({
      issues: [],
      edges: [],
      order: emptyOrder,
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
