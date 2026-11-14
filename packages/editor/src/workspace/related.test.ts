import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { ViewerDocument } from '@issuegraph/viewer';

import { backlogOf, relatedHubEdges } from '../testing/workspace.ts';
import { inspectorGroups, inspectorView } from './inspector.ts';
import { relatedListView, relatedRowKeys, shownNeighbours } from './related.ts';

/** `count` relationships on `i0001`, alternating `blocked-by` and `serialize-with`. */
const hub = (count: number): ViewerDocument => backlogOf(count + 1, { edges: relatedHubEdges(count) });
const SUBJECT = { kind: 'issue', key: 'i0001' } as const;

it('#303 relatedListView groups the selection by kind at every count, as the Inspector groups it, each row the issue reached', () => {
  for (const count of [2, 8, 9, 61]) {
    const view = relatedListView(hub(count), SUBJECT);
    if (view.kind !== 'listed') throw new Error('expected a listing');
    // RULES, Graphs, Dense neighbourhoods: "at every count, since an order row doesn't name its kind".
    const groups = inspectorGroups(inspectorView(hub(count), SUBJECT).relationships);
    assert.deepEqual(
      view.groups.map((related) => related.group),
      groups,
      `${String(count)} relationships`,
    );
    assert.deepEqual(
      view.groups.map((related) => related.neighbours),
      groups.map((group) => group.relationships.map((relationship) => (relationship.from === 'i0001' ? relationship.to : relationship.from))),
    );
    assert.equal(view.around, 'i0001');
    assert.equal(view.total, count);
  }
});

it('#303 relatedListView says nothing is selected, and that an unrelated issue has no relationships', () => {
  assert.deepEqual(relatedListView(hub(4), { kind: 'none' }), { kind: 'no-selection' });
  assert.deepEqual(relatedListView(hub(4), { kind: 'issue', key: 'gone' }), { kind: 'no-selection' });
  const lonely = backlogOf(3, { edges: [['blocked-by', 'i0001', 'i0002']] });
  assert.deepEqual(relatedListView(lonely, { kind: 'issue', key: 'i0003' }), { kind: 'no-relationships' });
});

it('#303 relatedListView reads a selected relationship from its stored `from` end, so its head says what the one row is to it', () => {
  // The Inspector shows a selected relationship alone with no head; an order row names no kind,
  // so here the head stays, read from the end the stored order phrases it from.
  const document = hub(12);
  const [first] = inspectorView(document, SUBJECT).relationships;
  assert.ok(first !== undefined);
  const view = relatedListView(document, { kind: 'edge', edgeId: first.edgeId });
  if (view.kind !== 'listed') throw new Error('expected a listing');
  assert.equal(view.around, first.from);
  assert.deepEqual(
    view.groups.map((related) => [related.group.key, related.neighbours]),
    [[`${first.field}:outgoing`, [first.to]]],
  );
  assert.equal(view.total, 1);
});

it('#303 relatedListView lists a set’s neighbours by kind, read from the member each touches, and nothing between two members', () => {
  const document = backlogOf(5, {
    edges: [
      ['blocked-by', 'i0001', 'i0002'],
      ['blocked-by', 'i0003', 'i0001'],
      ['blocked-by', 'i0004', 'i0002'],
      ['blocked-by', 'i0001', 'i0004'],
    ],
  });
  const view = relatedListView(document, { kind: 'issues', keys: ['i0001', 'i0002'] });
  if (view.kind !== 'listed') throw new Error('expected a listing');
  assert.equal(view.around, null, 'a set has no one issue for the head to name');
  assert.deepEqual(
    view.groups.map((related) => [related.group.key, related.neighbours]),
    [
      ['blocked-by:outgoing', ['i0004']],
      ['blocked-by:incoming', ['i0003', 'i0004']],
    ],
  );
  assert.equal(view.total, 3);
});

it('#303 the rows drawn fold at five per group until the reader opens one, for the list and its keyboard alike', () => {
  const view = relatedListView(hub(13), SUBJECT);
  if (view.kind !== 'listed') throw new Error('expected a listing');
  const [blocks, serializes] = view.groups;
  assert.ok(blocks !== undefined && serializes !== undefined);
  assert.equal(blocks.neighbours.length, 7);
  assert.equal(shownNeighbours(blocks, []).length, 5);
  assert.deepEqual(shownNeighbours(blocks, [blocks.group.key]), blocks.neighbours);
  assert.deepEqual(relatedRowKeys(view, []), [...blocks.neighbours.slice(0, 5), ...serializes.neighbours.slice(0, 5)]);
  assert.deepEqual(relatedRowKeys({ kind: 'no-selection' }, []), []);
});
