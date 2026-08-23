import assert from 'node:assert/strict';
import { test } from 'node:test';

import { edgeId } from '../model.ts';
import type { Mutation, Proposal } from '../mutation.ts';
import { createMemorySource } from './memory.ts';
import { threeOpenIssues, withEdge } from '../testing/fixtures.ts';

function edit(proposal: Proposal, mutationId = 'm1'): Mutation {
  return { ...proposal, mutationId };
}

test('it hydrates the seed unchanged', async () => {
  const seed = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const source = createMemorySource(seed);
  const document = await source.hydrate();
  assert.deepEqual(
    document.issues.map((issue) => issue.ref),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    document.edges.map((edge) => edge.id),
    [edgeId('blocked-by', '1', '2')],
  );
});

test('a create applies, and a later hydrate reflects it', async () => {
  const source = createMemorySource(threeOpenIssues());
  const result = await source.dispatch(edit({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }));
  assert.equal(result.outcome, 'applied');

  const document = await source.hydrate();
  assert.deepEqual(
    document.edges.map((edge) => edge.id),
    [edgeId('blocked-by', '1', '2')],
  );
});

test('deleting an edge it does not hold is unchanged, not applied', async () => {
  const source = createMemorySource(threeOpenIssues());
  const result = await source.dispatch(edit({ op: 'delete', edgeId: edgeId('blocked-by', '1', '2') }));
  assert.equal(result.outcome, 'unchanged');
});

test('creating an edge it already holds is unchanged', async () => {
  const source = createMemorySource(withEdge(threeOpenIssues(), 'blocked-by', '1', '2'));
  const result = await source.dispatch(edit({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }));
  assert.equal(result.outcome, 'unchanged');
});

test('a symmetric edge written the other way round is one edge, and the second is unchanged', async () => {
  const source = createMemorySource(threeOpenIssues());
  assert.equal(
    (await source.dispatch(edit({ op: 'create', kind: 'serialize-with', from: '1', to: '2' }))).outcome,
    'applied',
  );
  assert.equal(
    (await source.dispatch(edit({ op: 'create', kind: 'serialize-with', from: '2', to: '1' }))).outcome,
    'unchanged',
  );
  assert.equal(source.current().edges.length, 1);
});

test('an applied result carries the whole edge set, not a patch', async () => {
  const source = createMemorySource(withEdge(threeOpenIssues(), 'blocked-by', '1', '2'));
  const result = await source.dispatch(edit({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' }));
  assert.equal(result.outcome, 'applied');
  if (result.outcome !== 'applied') return;
  assert.deepEqual(
    [...result.edges].map((edge) => edge.kind).sort(),
    ['blocked-by', 'duplicate-of'],
  );
});

test('a retype replaces the edge rather than adding beside it', async () => {
  const source = createMemorySource(withEdge(threeOpenIssues(), 'blocked-by', '1', '2'));
  await source.dispatch(
    edit({ op: 'retype', edgeId: edgeId('blocked-by', '1', '2'), nextKind: 'duplicate-of' }),
  );
  assert.deepEqual(
    source.current().edges.map((edge) => edge.kind),
    ['duplicate-of'],
  );
});

test('a flip swaps the endpoints of a directed edge', async () => {
  const source = createMemorySource(withEdge(threeOpenIssues(), 'blocked-by', '1', '2'));
  await source.dispatch(edit({ op: 'flip', edgeId: edgeId('blocked-by', '1', '2') }));
  assert.deepEqual(
    source.current().edges.map((edge) => [edge.from, edge.to]),
    [['2', '1']],
  );
});

test('it never fails, which is the whole reason a second adapter exists', async () => {
  const source = createMemorySource(threeOpenIssues());
  const outcomes = new Set<string>();
  for (const mutation of [
    edit({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }),
    edit({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }),
    edit({ op: 'delete', edgeId: edgeId('blocked-by', '1', '2') }),
  ]) {
    outcomes.add((await source.dispatch(mutation)).outcome);
  }
  assert.deepEqual([...outcomes].sort(), ['applied', 'unchanged']);
});
