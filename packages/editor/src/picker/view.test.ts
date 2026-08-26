import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS, SYMMETRIC_EDGE_FIELDS, isSymmetricEdgeField } from '@issuegraph/core';
import { edgeId } from '@issuegraph/store';

import { pickerView } from './view.ts';
import { OBJECT, SUBJECT, documentWith, onlyEdge } from '../testing/picker.ts';

describe('the picker offers every kind the format has', () => {
  it('offers all five, in the format order, whatever the edge currently is', () => {
    for (const kind of EDGE_FIELDS) {
      const document = documentWith(kind);
      const view = pickerView(document, onlyEdge(document).id);
      assert.deepEqual(
        view.options.map((option) => option.kind),
        [...EDGE_FIELDS],
        kind,
      );
    }
  });

  it('marks the kind the edge already carries, and offers it anyway', () => {
    // OFFERED, NOT HIDDEN. Hiding it would be a second validity rule out here,
    // and the store already refuses the edit as `unchanged-kind` before any
    // dispatch — see `dispatch.test.ts`, which drives that path.
    const document = documentWith('blocked-by');
    const view = pickerView(document, onlyEdge(document).id);
    assert.deepEqual(
      view.options.filter((option) => option.current).map((option) => option.kind),
      ['blocked-by'],
    );
  });

  it('takes directedness from the format rather than restating it', () => {
    // The split is core's, and this asserts the picker AGREES with it rather
    // than asserting a hand-written list — a local list would pass a test that
    // repeated the same list, and fail nothing when the format grew a field.
    const document = documentWith('blocked-by');
    const view = pickerView(document, onlyEdge(document).id);
    assert.deepEqual(
      view.options.filter((option) => !option.directed).map((option) => option.kind),
      [...SYMMETRIC_EDGE_FIELDS],
    );
  });
});

describe('a directed kind states its direction; a symmetric one has none to state', () => {
  const directed = EDGE_FIELDS.filter((kind) => !isSymmetricEdgeField(kind));

  it('drives all five kinds, and the split is total', () => {
    // The five cases below are the whole vocabulary, so the test cannot silently
    // stop covering one of them.
    assert.equal(directed.length + SYMMETRIC_EDGE_FIELDS.length, EDGE_FIELDS.length);
    assert.deepEqual([...directed], ['blocked-by', 'decomposed-from', 'duplicate-of']);
  });

  for (const kind of EDGE_FIELDS) {
    const symmetric = isSymmetricEdgeField(kind);

    it(`${symmetric ? 'renders neither' : 'renders both'} for ${kind}`, () => {
      const document = documentWith(kind);
      const view = pickerView(document, onlyEdge(document).id);

      if (symmetric) {
        assert.equal(view.direction, null);
        assert.equal(view.flip, null);
        return;
      }

      assert.deepEqual(view.direction, { kind, from: SUBJECT, to: OBJECT });
      assert.deepEqual(view.flip?.reversed, { kind, from: OBJECT, to: SUBJECT });
    });
  }

  it('carries no sentence, only the pair and the kind', () => {
    // The whole of the statement's shape, asserted as a set of keys: a `text`
    // field added later would fail here rather than shipping a language choice.
    const document = documentWith('blocked-by');
    const view = pickerView(document, onlyEdge(document).id);
    assert.ok(view.direction !== null);
    assert.deepEqual(Object.keys(view.direction).sort(), ['from', 'kind', 'to']);
  });
});

describe('each affordance is exactly one proposal', () => {
  it('emits one retype per option and one flip, and never a delete plus a create', () => {
    const document = documentWith('blocked-by');
    const edge = onlyEdge(document);
    const view = pickerView(document, edge.id);

    assert.deepEqual(
      view.options.map((option) => option.proposal),
      EDGE_FIELDS.map((kind) => ({ op: 'retype', edgeId: edge.id, nextKind: kind })),
    );
    assert.deepEqual(view.flip?.proposal, { op: 'flip', edgeId: edge.id });
  });
});

describe('an edge that is no longer there is REPORTED, not drawn as an empty picker', () => {
  it('names it in a diagnostic and offers nothing', () => {
    // Reachable in ordinary use: a sibling write can land a delete while this
    // picker is open. An empty option list with no reason reads as "this edge
    // can be nothing" rather than "this edge is gone".
    const gone = edgeId('blocked-by', SUBJECT, OBJECT);
    const view = pickerView({ issues: [], edges: [] }, gone);

    assert.deepEqual([...view.options], []);
    assert.equal(view.direction, null);
    assert.equal(view.flip, null);
    assert.equal(view.diagnostics.length, 1);
    assert.ok(view.diagnostics[0]?.includes(gone));
  });
});

describe('the picker is pure', () => {
  it('leaves the document exactly as it found it', () => {
    // Compared against a SNAPSHOT rather than only run against a frozen input:
    // freezing proves a write would throw, which is vacuous for a function that
    // happens not to write today and says nothing about a nested value a freeze
    // does not reach. This asserts the document is unchanged.
    const document = documentWith('blocked-by');
    const before = structuredClone(document);

    pickerView(document, onlyEdge(document).id);

    assert.deepEqual(document, before);
  });

  it('answers the same twice, so nothing is carried between calls', () => {
    const document = documentWith('blocked-by');
    const edge = onlyEdge(document);
    assert.deepEqual(pickerView(document, edge.id), pickerView(document, edge.id));
  });
});
