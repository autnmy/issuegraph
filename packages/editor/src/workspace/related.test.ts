import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { ViewerDocument } from '@issuegraph/viewer';

import { backlogOf, relatedHubEdges } from '../testing/workspace.ts';
import { inspectorListing, inspectorView } from './inspector.ts';
import { relatedListView } from './related.ts';

/** `count` relationships on `i0001`, alternating `blocked-by` and `serialize-with`. */
const hub = (count: number): ViewerDocument => backlogOf(count + 1, { edges: relatedHubEdges(count) });
const SUBJECT = { kind: 'issue', key: 'i0001' } as const;

it('#303 relatedListView lists the selection as the Inspector does: flat up to 8, by kind past 8', () => {
  for (const count of [2, 8, 9, 61]) {
    const view = relatedListView(hub(count), SUBJECT);
    // RULES, Graphs, Dense neighbourhoods: "Under 640 the list does the same."
    assert.deepEqual(view, {
      kind: 'listed',
      listing: inspectorListing(inspectorView(hub(count), SUBJECT).relationships),
      total: count,
    });
    if (view.kind !== 'listed') throw new Error('expected a listing');
    assert.equal(view.listing.kind, count > 8 ? 'grouped' : 'flat', `${String(count)} relationships`);
  }
});

it('#303 relatedListView says nothing is selected, and that an unrelated issue has no relationships', () => {
  assert.deepEqual(relatedListView(hub(4), { kind: 'none' }), { kind: 'no-selection' });
  assert.deepEqual(relatedListView(hub(4), { kind: 'issue', key: 'gone' }), { kind: 'no-selection' });
  const lonely = backlogOf(3, { edges: [['blocked-by', 'i0001', 'i0002']] });
  assert.deepEqual(relatedListView(lonely, { kind: 'issue', key: 'i0003' }), { kind: 'no-relationships' });
});

it('#303 relatedListView lists a selected relationship alone, with no head', () => {
  const document = hub(12);
  const [first] = inspectorView(document, SUBJECT).relationships;
  assert.ok(first !== undefined);
  const selection = { kind: 'edge', edgeId: first.edgeId } as const;
  const [edge] = inspectorView(document, selection).relationships;
  assert.ok(edge !== undefined);
  assert.deepEqual(relatedListView(document, selection), {
    kind: 'listed',
    listing: { kind: 'flat', relationships: [edge] },
    total: 1,
  });
});
