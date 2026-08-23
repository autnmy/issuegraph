import assert from 'node:assert/strict';
import { test } from 'node:test';

import { edgeId, makeEdge } from './model.ts';
import type { Mutation } from './mutation.ts';
import { type WriteRecord, anyPending, edgeStateOf, project } from './write.ts';
import { sameValue } from './equality.ts';
import { threeOpenIssues, withEdge } from './testing/fixtures.ts';

const NOTHING_SELECTED = new Set<string>();

function pending(mutation: Mutation): WriteRecord {
  return { mutationId: mutation.mutationId, mutation, state: 'pending' };
}

test('each record state maps to the edge state the design draws', () => {
  const mutation: Mutation = { op: 'delete', edgeId: 'x', mutationId: 'm1' };
  assert.equal(edgeStateOf({ mutationId: 'm1', mutation, state: 'pending' }), 'pending-write');
  assert.equal(
    edgeStateOf({ mutationId: 'm1', mutation, state: 'invalid', reason: { code: 'self-edge', message: 'x' } }),
    'invalid',
  );
  assert.equal(edgeStateOf({ mutationId: 'm1', mutation, state: 'failed', reason: 'x' }), 'failed');
  assert.equal(
    edgeStateOf({ mutationId: 'm1', mutation, state: 'conflict', upstream: threeOpenIssues(), landedAt: 0 }),
    'conflict',
  );
});

test('anyPending is what holds the order still', () => {
  const mutation: Mutation = { op: 'delete', edgeId: 'x', mutationId: 'm1' };
  assert.ok(!anyPending([]));
  assert.ok(anyPending([pending(mutation)]));
  assert.ok(!anyPending([{ mutationId: 'm1', mutation, state: 'failed', reason: 'no' }]));
});

test('a pending create is drawn, and the landed document is untouched', () => {
  const landed = threeOpenIssues();
  const mutation: Mutation = { op: 'create', kind: 'blocked-by', from: '1', to: '2', mutationId: 'm1' };
  const projected = project(landed, [pending(mutation)], NOTHING_SELECTED);

  assert.equal(projected.length, 1);
  assert.deepEqual(projected[0]?.states, ['pending-write']);
  assert.deepEqual(projected[0]?.writes, ['m1']);
  assert.deepEqual(landed.edges, []);
});

test('a pending delete leaves the edge on the canvas, marked', () => {
  const landed = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const id = edgeId('blocked-by', '1', '2');
  const mutation: Mutation = { op: 'delete', edgeId: id, mutationId: 'm1' };
  const projected = project(landed, [pending(mutation)], NOTHING_SELECTED);

  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.id, id);
  assert.deepEqual(projected[0]?.states, ['pending-write']);
});

test('a pending retype draws the new kind in place of the old', () => {
  const landed = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const mutation: Mutation = {
    op: 'retype',
    edgeId: edgeId('blocked-by', '1', '2'),
    nextKind: 'duplicate-of',
    mutationId: 'm1',
  };
  const projected = project(landed, [pending(mutation)], NOTHING_SELECTED);

  assert.deepEqual(
    projected.map((edge) => edge.kind),
    ['duplicate-of'],
  );
  assert.deepEqual(projected[0]?.states, ['pending-write']);
});

test('states are orthogonal: an edge can be selected AND pending at once', () => {
  const landed = threeOpenIssues();
  const mutation: Mutation = { op: 'create', kind: 'blocked-by', from: '1', to: '2', mutationId: 'm1' };
  const id = edgeId('blocked-by', '1', '2');
  const projected = project(landed, [pending(mutation)], new Set([id]));

  // In the canonical order of EDGE_STATES, so a viewer's memoisation is not
  // defeated by set iteration order.
  assert.deepEqual(projected[0]?.states, ['selected', 'pending-write']);
  assert.equal(projected[0]?.kind, 'blocked-by', 'the edge keeps its type identity');
});

test('a landed edge with no record carries no state and no writes', () => {
  const landed = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const projected = project(landed, [], NOTHING_SELECTED);
  assert.deepEqual(projected[0]?.states, []);
  assert.deepEqual(projected[0]?.writes, []);
});

test('two records touching one edge both mark it', () => {
  const landed = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const id = edgeId('blocked-by', '1', '2');
  const first: Mutation = { op: 'delete', edgeId: id, mutationId: 'm1' };
  const second: Mutation = { op: 'delete', edgeId: id, mutationId: 'm2' };
  const projected = project(
    landed,
    [{ mutationId: 'm1', mutation: first, state: 'failed', reason: 'no' }, pending(second)],
    NOTHING_SELECTED,
  );
  assert.deepEqual(projected[0]?.states, ['pending-write', 'failed']);
  assert.deepEqual(projected[0]?.writes, ['m1', 'm2']);
});

test('an invalid create is still DRAWN — it is a ghost, not an absence', () => {
  const landed = threeOpenIssues();
  const mutation: Mutation = { op: 'create', kind: 'blocked-by', from: '1', to: '1', mutationId: 'm1' };
  const projected = project(
    landed,
    [{ mutationId: 'm1', mutation, state: 'invalid', reason: { code: 'self-edge', message: 'no' } }],
    NOTHING_SELECTED,
  );
  assert.deepEqual(projected.map((edge) => edge.states), [['invalid']]);
});

test('a projection comparison notices a state change on an otherwise identical edge', () => {
  const landed = threeOpenIssues();
  const mutation: Mutation = { op: 'create', kind: 'blocked-by', from: '1', to: '2', mutationId: 'm1' };
  const bare = project(landed, [], NOTHING_SELECTED);
  const marked = project(landed, [pending(mutation)], NOTHING_SELECTED);

  assert.ok(sameValue(bare, project(landed, [], NOTHING_SELECTED)));
  assert.ok(sameValue(marked, project(landed, [pending(mutation)], NOTHING_SELECTED)));
  assert.ok(!sameValue(bare, marked));

  const selected = project(landed, [pending(mutation)], new Set([edgeId('blocked-by', '1', '2')]));
  assert.ok(!sameValue(marked, selected));
});

test('a record comparison notices state AND the fields only one state carries', () => {
  const mutation: Mutation = { op: 'delete', edgeId: 'x', mutationId: 'm1' };
  const before: readonly WriteRecord[] = [pending(mutation)];
  const after: readonly WriteRecord[] = [{ mutationId: 'm1', mutation, state: 'failed', reason: 'no' }];
  assert.ok(sameValue(before, [pending(mutation)]));
  assert.ok(!sameValue(before, after));
  assert.ok(!sameValue(before, []));

  // Identity and state unchanged, only the reason moved — the shape that
  // shipped a stale refusal on the canvas.
  const one: readonly WriteRecord[] = [
    { mutationId: 'm1', mutation, state: 'invalid', reason: { code: 'unchanged-kind', message: 'a' } },
  ];
  const other: readonly WriteRecord[] = [
    { mutationId: 'm1', mutation, state: 'invalid', reason: { code: 'unknown-edge', message: 'b' } },
  ];
  assert.ok(!sameValue(one, other));
});

test('a drawn edge is not duplicated when the landed document already holds it', () => {
  // Reachable when a sibling write landed the same relationship while this one
  // was still in flight.
  const landed = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const mutation: Mutation = { op: 'create', kind: 'blocked-by', from: '1', to: '2', mutationId: 'm1' };
  const projected = project(landed, [pending(mutation)], NOTHING_SELECTED);
  assert.equal(projected.length, 1);
  assert.deepEqual(projected[0], {
    ...makeEdge('blocked-by', '1', '2'),
    states: ['pending-write'],
    writes: ['m1'],
  });
});
