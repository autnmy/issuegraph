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

function harness(settleDelayMs = 0) {
  // Zero by default so the suite stays fast. The DEFAULT is deliberately not
  // zero — see `DemoSourceOptions.settleDelayMs`, and the last test here, which
  // pins why.
  const source = createDemoSource(seedDocument(), { settleDelayMs });
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

test('the pending state survives a turn of the event loop, so it can paint', async () => {
  // Every dispatch path here can answer immediately, and an already-settled
  // promise resolves on the MICROTASK checkpoint — which drains before the
  // browser renders. The optimistic edge and the held order would then be
  // created and cleared without ever painting: observable to a test, invisible
  // to a visitor, with the tests still green.
  const { store } = harness(30);
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' });

  // A MACROTASK boundary — the one the browser paints on. Draining the
  // microtask queue instead (`await Promise.resolve()`) is exactly what does
  // NOT prove this, because that is the checkpoint the defect hid behind.
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  const midflight = store.getSnapshot();
  assert.ok(
    midflight.projected.some((edge) => edge.states.includes('pending-write')),
    'the optimistic edge did not survive a macrotask, so a visitor can never see it',
  );
  assert.equal(midflight.order.status, 'held', 'the held order did not survive a macrotask');

  await handle.settled;
  assert.equal(store.getSnapshot().order.status, 'settled');
});

test('retrying after a conflict keeps the upstream change as well as mine', async () => {
  // The conflict shows an upstream edit and offers `retry`. If that edit lived
  // only in the returned snapshot, the retry — dispatched against this adapter
  // — would apply to the pre-conflict document and silently drop it: the
  // visitor resolves a conflict and watches the other side's change vanish.
  const { source, store } = harness();
  await store.hydrate();
  source.arm('conflict');
  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' });
  await handle.settled;

  const record = store.getSnapshot().writes.find((write) => write.mutationId === handle.mutationId);
  assert.ok(record?.state === 'conflict');
  const shown = record.upstream.edges.filter(
    (edge) => !store.getSnapshot().landed.some((existing) => existing.id === edge.id),
  );
  assert.equal(shown.length, 1, 'the conflict should display exactly one upstream change');
  const upstream = shown[0];
  assert.ok(upstream);

  await store.retry(handle.mutationId).settled;

  const landed = store.getSnapshot().landed;
  assert.ok(
    landed.some((edge) => edge.id === upstream.id),
    'the retry discarded the upstream change the conflict had just shown',
  );
  assert.ok(
    landed.some((edge) => edge.from === '4' && edge.to === '3'),
    'the retry did not land the visitor edit',
  );
});

test('the source announces its disarm, because a redraw happens too early', async () => {
  // The store notifies subscribers when the write is PROPOSED, which is before
  // the dispatch reaches the adapter and disarms. A page that syncs its control
  // on redraw therefore keeps displaying an outcome the adapter has already
  // spent, for the whole of the settle window.
  const announced: string[] = [];
  const source = createDemoSource(seedDocument(), {
    settleDelayMs: 0,
    onArmedChange: (armed) => announced.push(armed),
  });
  const store = createStore({ source, derive: createDeriver(seedHolds()) });
  await store.hydrate();

  source.arm('reject');
  assert.deepEqual(announced, ['reject'], 'arming was not announced');

  await store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '3' }).settled;

  assert.deepEqual(announced, ['reject', 'apply'], 'the disarm was not announced');
  assert.equal(source.armed(), 'apply');
});

test('announcing is idempotent: arming the same outcome twice says nothing new', async () => {
  const announced: string[] = [];
  const source = createDemoSource(seedDocument(), {
    settleDelayMs: 0,
    onArmedChange: (armed) => announced.push(armed),
  });
  source.arm('conflict');
  source.arm('conflict');
  assert.deepEqual(announced, ['conflict'], 'a no-op arm produced a notification');
  await Promise.resolve();
});
