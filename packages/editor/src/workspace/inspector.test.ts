import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS, edgeIdentity } from '@issuegraph/core';

import { inspectorView } from './inspector.ts';
import { INITIAL_SELECTION } from './selection.ts';
import { backlogOf } from '../testing/workspace.ts';

const DOCUMENT = backlogOf(6, {
  held: ['i0005'],
  edges: [
    ['blocked-by', 'i0001', 'i0002'],
    ['blocked-by', 'i0003', 'i0001'],
    ['duplicate-of', 'i0004', 'i0006'],
  ],
});

describe('the inspector is a projection of the one selection', () => {
  it('shows nothing when nothing is selected', () => {
    const view = inspectorView(DOCUMENT, INITIAL_SELECTION);
    assert.deepEqual(view.subject, { kind: 'none' });
    assert.deepEqual(view.relationships, []);
    assert.equal(view.filtered, false);
  });

  it('shows an issue with its position, and only the edges that touch it', () => {
    const view = inspectorView(DOCUMENT, { kind: 'issue', key: 'i0001' });
    assert.equal(view.subject.kind, 'issue');
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.issue.key, 'i0001');
    assert.deepEqual(view.subject.position, { rank: 1, ready: true, holds: [] });

    // Both directions, and nothing else: `duplicate-of i0004 -> i0006` names
    // neither end of this subject.
    assert.deepEqual(
      view.relationships.map((one) => [one.field, one.direction]),
      [
        ['blocked-by', 'outgoing'],
        ['blocked-by', 'incoming'],
      ],
    );
    assert.equal(view.filtered, false);
  });

  it('carries a held slot\'s rank as null rather than a number', () => {
    const view = inspectorView(DOCUMENT, { kind: 'issue', key: 'i0005' });
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.position?.rank, null);
    assert.equal(view.subject.position?.ready, false);
    assert.equal(view.subject.position?.holds.length, 1);
  });
});

describe('an edge selection FILTERS the list rather than opening another panel', () => {
  const edgeId = edgeIdentity('blocked-by', 'i0001', 'i0002');

  it('narrows to the one edge, from the same one value', () => {
    const view = inspectorView(DOCUMENT, { kind: 'edge', edgeId });
    assert.equal(view.subject.kind, 'edge');
    assert.equal(view.relationships.length, 1);
    assert.equal(view.relationships[0]?.edgeId, edgeId);
    assert.equal(view.filtered, true);
  });

  it('states no direction for an edge selection, because there is no subject to be relative to', () => {
    const view = inspectorView(DOCUMENT, { kind: 'edge', edgeId });
    assert.equal(view.relationships[0]?.direction, null);
  });

  it('names edges by the identity core derives, for every field the format has', () => {
    // The identity is the one the picker, the overlays and the store already
    // use. A second spelling out here is how a host comes to hold two ids for
    // one edge — which is why this drives EVERY field rather than one.
    for (const field of EDGE_FIELDS) {
      const document = backlogOf(2, { edges: [[field, 'i0001', 'i0002']] });
      const view = inspectorView(document, { kind: 'issue', key: 'i0001' });
      assert.equal(view.relationships[0]?.edgeId, edgeIdentity(field, 'i0001', 'i0002'), field);
    }
  });
});

describe('an unresolvable selection renders as nothing, never as last render\'s answer', () => {
  it('empties for an issue the document no longer carries', () => {
    // A write lands and the order recomputes; a selection naming a row that has
    // gone is ordinary, not an error a reader can act on. Holding a resolved
    // issue ON the selection is what would make this render stale detail.
    assert.deepEqual(inspectorView(DOCUMENT, { kind: 'issue', key: 'gone' }).subject, {
      kind: 'none',
    });
  });

  it('empties for an edge the document no longer carries', () => {
    assert.deepEqual(
      inspectorView(DOCUMENT, { kind: 'edge', edgeId: 'blocked-by|nope|nope2' }).subject,
      { kind: 'none' },
    );
    assert.equal(inspectorView(DOCUMENT, { kind: 'edge', edgeId: 'x' }).filtered, false);
  });

  it('gives no position to an issue the order does not place', () => {
    // An excluded issue genuinely has no position. `rank: null, ready: false`
    // would read as a HOLD, which is a different fact with a different remedy.
    const document = {
      ...DOCUMENT,
      order: { slots: [], excluded: [] },
    };
    const view = inspectorView(document, { kind: 'issue', key: 'i0001' });
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.position, null);
  });
});
