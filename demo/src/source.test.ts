/**
 * The mutation states, driven through the real store.
 *
 * This is the half a seed cannot cover: `pending-write`, `failed` and `conflict`
 * are things that HAPPEN, not things a document contains. Each one is induced
 * here the same way the page induces it — by arming the demo source — so a
 * passing test is evidence about what a visitor can actually reach rather than
 * about a fixture.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EDGE_STATES, type EdgeState, createStore, makeEdge } from '@issuegraph/store';

import { createDeriver } from './order.ts';
import { seedDocument, seedHolds } from './seed.ts';
import { createDemoSource } from './source.ts';

function harness() {
  const source = createDemoSource(seedDocument());
  const store = createStore({ source, derive: createDeriver(seedHolds()) });
  return { source, store };
}

/** Every state on the board, which is what the coverage claim is about. */
function statesOn(store: ReturnType<typeof createStore>): Set<EdgeState> {
  return new Set(store.getSnapshot().projected.flatMap((edge) => edge.states));
}

test('an edit renders before it lands, and the order refuses to move until it has', async () => {
  const { store } = harness();
  await store.hydrate();
  const before = store.getSnapshot().order.rows;

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' });
  const midflight = store.getSnapshot();
  assert.ok(statesOn(store).has('pending-write'), 'the edge is not drawn optimistically');
  assert.equal(midflight.order.status, 'held', 'the order re-evaluated before the write landed');
  assert.deepEqual(midflight.order.rows, before, 'the rows moved while a write was in flight');

  await handle.settled;
  const after = store.getSnapshot();
  assert.equal(after.order.status, 'settled');
  assert.notDeepEqual(after.order.rows, before, 'the order never re-derived after the write landed');
});

test('an armed rejection marks the edge failed and leaves the work on the canvas', async () => {
  const { source, store } = harness();
  await store.hydrate();
  source.arm('reject');

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' });
  await handle.settled;

  const snapshot = store.getSnapshot();
  assert.ok(statesOn(store).has('failed'), 'a rejected write did not mark its edge');
  // Marked, never reverted: the edge the visitor drew is still there.
  assert.ok(
    snapshot.projected.some((edge) => edge.from === '4' && edge.to === '3'),
    'a rejected write silently reverted the visitor’s edit',
  );
  const record = snapshot.writes.find((write) => write.mutationId === handle.mutationId);
  assert.equal(record?.state, 'failed');
});

test('a retry after a rejection lands, because the arming fires once', async () => {
  const { source, store } = harness();
  await store.hydrate();
  source.arm('reject');
  await store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' }).settled;
  assert.equal(source.armed(), 'apply', 'the arming did not disarm itself');

  const failed = store.getSnapshot().writes[0];
  assert.ok(failed);
  await store.retry(failed.mutationId).settled;

  assert.equal(store.getSnapshot().writes.length, 0, 'the retry did not clear the failed record');
  assert.ok(
    store.getSnapshot().landed.some((edge) => edge.from === '4' && edge.to === '3'),
    'the retried edit never landed',
  );
});

test('an armed conflict holds both versions and adopts neither', async () => {
  const { source, store } = harness();
  await store.hydrate();
  const landedBefore = store.getSnapshot().landed;
  source.arm('conflict');

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' });
  await handle.settled;

  const snapshot = store.getSnapshot();
  assert.ok(statesOn(store).has('conflict'), 'a conflicting write did not mark its edge');
  const record = snapshot.writes.find((write) => write.mutationId === handle.mutationId);
  assert.equal(record?.state, 'conflict');
  assert.ok(record.state === 'conflict' && record.upstream.edges.length > landedBefore.length,
    'the upstream document is not actually different, so a diff would show nothing');
  // Held for display, never merged: what landed is untouched.
  assert.deepEqual(snapshot.landed, landedBefore, 'the upstream document was adopted');
});

test('discarding mine is the only thing that removes an optimistic edit', async () => {
  const { source, store } = harness();
  await store.hydrate();
  source.arm('conflict');
  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' });
  await handle.settled;
  assert.ok(statesOn(store).has('conflict'));

  store.discardMine(handle.mutationId);

  assert.equal(store.getSnapshot().writes.length, 0);
  assert.ok(
    !store.getSnapshot().projected.some((edge) => edge.from === '4' && edge.to === '3'),
    'discardMine left the overlay behind',
  );
});

test('a refusal never reaches the adapter at all', async () => {
  const { store } = harness();
  await store.hydrate();
  // A self-edge is refused by the store before any write: the demo source is
  // never asked, which is what `invalid` means as distinct from `failed`.
  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '4' });
  await handle.settled;

  assert.ok(statesOn(store).has('invalid'), 'a structural refusal was not marked');
  const record = store.getSnapshot().writes[0];
  assert.equal(record?.state, 'invalid');
});

test('every mutation state is reachable from the demo, together', async () => {
  const { source, store } = harness();
  await store.hydrate();

  source.arm('reject');
  const failed = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' });
  await failed.settled;

  source.arm('conflict');
  const conflicted = store.propose({ op: 'create', kind: 'serialize-with', from: '4', to: '2' });
  await conflicted.settled;

  store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '2' });
  const pending = store.propose({ op: 'create', kind: 'together-with', from: '3', to: '2' });
  store.select([store.getSnapshot().projected[0]?.id ?? '']);

  const reached = statesOn(store);
  // Enumerated from the vocabulary rather than listed by hand, so a sixth state
  // added to the package fails here instead of going undemonstrated.
  for (const state of EDGE_STATES) {
    assert.ok(reached.has(state), `the demo cannot reach the ${state} state`);
  }
  await pending.settled;
});

test('an armed conflict always has something to show, even after that edge exists', () => {
  // The reviewer's scenario: land the edge the fabricated upstream used to
  // hardcode, then arm a conflict. A source that reached for one fixed pair
  // returned the document UNCHANGED and still reported a conflict, so the
  // "view diff" half of the choice had nothing in it.
  return (async () => {
    const { source, store } = harness();
    await store.hydrate();
    await store.propose({ op: 'create', kind: 'serialize-with', from: '1', to: '2' }).settled;

    const landed = store.getSnapshot().landed;
    source.arm('conflict');
    const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' });
    await handle.settled;

    const record = store.getSnapshot().writes.find((write) => write.mutationId === handle.mutationId);
    assert.equal(record?.state, 'conflict', 'the armed conflict did not fire');
    assert.ok(record.state === 'conflict');
    assert.ok(
      record.upstream.edges.length > landed.length,
      'the upstream document is identical to what landed, so a diff would show nothing',
    );
  })();
});

test('an armed conflict never fabricates the visitor\'s own edit as the upstream one', async () => {
  // If the search lands on the very edge being dispatched, upstream and local
  // express the SAME intended change — which is `unchanged`, not two competing
  // versions. On the seed this is the first absent edge for the first pair.
  const { source, store } = harness();
  await store.hydrate();
  source.arm('conflict');
  const handle = store.propose({ op: 'create', kind: 'decomposed-from', from: '1', to: '2' });
  await handle.settled;

  const record = store.getSnapshot().writes.find((write) => write.mutationId === handle.mutationId);
  assert.equal(record?.state, 'conflict');
  assert.ok(record.state === 'conflict');
  const mine = makeEdge('decomposed-from', '1', '2');
  const landed = store.getSnapshot().landed;
  const fabricated = record.upstream.edges.filter(
    (edge) => !landed.some((existing) => existing.id === edge.id),
  );
  assert.ok(fabricated.length > 0, 'the upstream document has nothing to show');
  assert.ok(
    !fabricated.some((edge) => edge.id === mine.id),
    'the upstream change IS the visitor\'s own edit, so the two do not compete',
  );
});
