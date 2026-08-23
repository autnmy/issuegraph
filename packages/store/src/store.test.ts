import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type GraphDocument, edgeId } from './model.ts';
import type { EdgeGuard, OrderDeriver, OrderRow } from './source.ts';
import { createStore } from './store.ts';
import { createMemorySource } from './adapters/memory.ts';
import { createScriptedSource } from './adapters/scripted.ts';
import { applyEdit, simpleDeriver, threeOpenIssues, withEdge } from './testing/fixtures.ts';

/** A deriver that counts its calls, so "the order was not re-derived" is testable. */
function countingDeriver(): { derive: OrderDeriver; calls: () => number; sawEdges: () => readonly string[][] } {
  let calls = 0;
  const seen: string[][] = [];
  return {
    derive(document) {
      calls += 1;
      seen.push(document.edges.map((edge) => edge.id));
      return simpleDeriver(document);
    },
    calls: () => calls,
    sawEdges: () => seen,
  };
}

const refs = (rows: readonly OrderRow[]): readonly string[] => rows.map((row) => row.ref);

test('hydration walks idle to hydrating to ready, and lands the document', async () => {
  const store = createStore({
    source: createMemorySource(withEdge(threeOpenIssues(), 'blocked-by', '1', '2')),
    derive: simpleDeriver,
  });
  const seen: string[] = [];
  store.subscribe(() => seen.push(store.getSnapshot().status));

  assert.equal(store.getSnapshot().status, 'idle');
  await store.hydrate();

  assert.deepEqual(seen, ['hydrating', 'ready']);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.status, 'ready');
  assert.deepEqual(
    snapshot.issues.map((issue) => issue.ref),
    ['1', '2', '3'],
  );
  assert.deepEqual(snapshot.landed.map((edge) => edge.id), [edgeId('blocked-by', '1', '2')]);
  assert.deepEqual(refs(snapshot.order.rows), ['2', '3', '1']);
  assert.equal(snapshot.order.status, 'settled');
});

test('a hydrate that rejects is a state, not a thrown error', async () => {
  const store = createStore({
    source: {
      hydrate: () => Promise.reject(new Error('the tracker is down')),
      dispatch: () => Promise.reject(new Error('unused')),
    },
    derive: simpleDeriver,
  });

  await store.hydrate();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.hydrationError, 'the tracker is down');
});

test('a failed REHYDRATE keeps the last good document and stays ready', async () => {
  let fail = false;
  const memory = createMemorySource(withEdge(threeOpenIssues(), 'blocked-by', '1', '2'));
  const store = createStore({
    source: {
      hydrate: () => (fail ? Promise.reject(new Error('blip')) : memory.hydrate()),
      dispatch: (mutation) => memory.dispatch(mutation),
    },
    derive: simpleDeriver,
  });

  await store.hydrate();
  fail = true;
  await store.rehydrate();

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.status, 'ready', 'a refresh blip must not report the store as unloaded');
  assert.equal(snapshot.hydrationError, 'blip');
  assert.equal(snapshot.landed.length, 1);
});

test('unsubscribing stops the notifications', async () => {
  const store = createStore({ source: createMemorySource(threeOpenIssues()), derive: simpleDeriver });
  let count = 0;
  const stop = store.subscribe(() => {
    count += 1;
  });
  await store.hydrate();
  const afterHydrate = count;
  assert.ok(afterHydrate > 0);

  stop();
  store.select([edgeId('blocked-by', '1', '2')]);
  assert.equal(count, afterHydrate);
});

test('two reads with nothing in between return the identical snapshot', async () => {
  const store = createStore({ source: createMemorySource(threeOpenIssues()), derive: simpleDeriver });
  await store.hydrate();
  assert.equal(store.getSnapshot(), store.getSnapshot());

  // And a call that changes nothing does not mint a new one either.
  store.select([]);
  const before = store.getSnapshot();
  store.select([]);
  assert.equal(store.getSnapshot(), before);
});

test('the deriver is handed the LANDED edges and nothing else', async () => {
  const counting = countingDeriver();
  const store = createStore({
    source: createScriptedSource(threeOpenIssues(), applyEdit),
    derive: counting.derive,
  });
  await store.hydrate();
  assert.deepEqual(counting.sawEdges(), [[]]);

  store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  assert.equal(counting.calls(), 1, 'a pending edit must not reach the deriver');
  assert.deepEqual(counting.sawEdges(), [[]]);
});

test('the fixture deriver can actually move, so the next test is not vacuous', () => {
  // "The order does not move while a write is pending" proves nothing against a
  // deriver that never moves. This pins the fixture's capacity to move, right
  // beside the claim that rests on it.
  assert.deepEqual(refs(simpleDeriver(threeOpenIssues())), ['1', '2', '3']);
  assert.deepEqual(refs(simpleDeriver(withEdge(threeOpenIssues(), 'blocked-by', '1', '2'))), ['2', '3', '1']);
});

test('THE ORDER DOES NOT MOVE WHILE A WRITE IS PENDING', async () => {
  // The fixture deriver would put issue 1 last if the pending `blocked-by`
  // counted — pinned by its own test — so this fails if the gate is removed.
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const before = store.getSnapshot().order;
  assert.deepEqual(refs(before.rows), ['1', '2', '3']);

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  const pending = store.getSnapshot();
  assert.equal(pending.order.rows, before.rows, 'the rows must be the SAME array, held still');
  assert.equal(pending.order.status, 'held');
  assert.deepEqual(pending.projected.map((edge) => edge.states), [['pending-write']]);
  assert.deepEqual(pending.landed, []);

  source.settleNext('applied');
  await handle.settled;

  // And it DOES move once the write lands, so the assertion above is not passing
  // because the order can never move at all.
  const after = store.getSnapshot();
  assert.deepEqual(refs(after.order.rows), ['2', '3', '1']);
  assert.equal(after.order.status, 'settled');
});

test('the order stays held until EVERY in-flight write settles', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  const second = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });

  source.settle(first.mutationId, 'applied');
  await first.settled;
  assert.equal(store.getSnapshot().order.status, 'held', 'one landed, one still in flight');

  source.settle(second.mutationId, { outcome: 'rejected', reason: 'no' });
  await second.settled;
  assert.equal(store.getSnapshot().order.status, 'settled');
});

test("one write failing does not discard another write's overlay", async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  const second = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });

  source.settle(first.mutationId, { outcome: 'rejected', reason: 'locked' });
  await first.settled;

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.projected.length, 2, 'both edits are still drawn');
  assert.deepEqual(
    snapshot.projected.map((edge) => edge.states.join('+')).sort(),
    ['failed', 'pending-write'],
  );
  assert.deepEqual(
    snapshot.writes.map((record) => record.state).sort(),
    ['failed', 'pending'],
  );

  source.settle(second.mutationId, 'applied');
  await second.settled;
});

test('rehydrate replaces the landed document and keeps unsettled edits', async () => {
  let document: GraphDocument = threeOpenIssues();
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(document),
      dispatch: (mutation) => source.dispatch(mutation),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  document = withEdge(threeOpenIssues(), 'duplicate-of', '3', '1');
  await store.rehydrate();

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.landed.length, 1, 'the refreshed document landed');
  assert.equal(snapshot.projected.length, 2, 'the pending edit is still drawn');
  assert.equal(snapshot.order.status, 'held');

  source.settleNext('applied');
  await handle.settled;
});

test('selection is client state and writes nothing', async () => {
  const source = createMemorySource(withEdge(threeOpenIssues(), 'blocked-by', '1', '2'));
  const id = edgeId('blocked-by', '1', '2');
  let dispatches = 0;
  const store = createStore({
    source: {
      hydrate: () => source.hydrate(),
      dispatch: (mutation) => {
        dispatches += 1;
        return source.dispatch(mutation);
      },
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  store.select([id]);
  assert.deepEqual(store.getSnapshot().projected[0]?.states, ['selected']);
  assert.equal(dispatches, 0);

  store.select([]);
  assert.deepEqual(store.getSnapshot().projected[0]?.states, []);
});

test('an injected guard refuses, and the adapter is never called', async () => {
  let dispatches = 0;
  const noBlockedBy: EdgeGuard = ({ mutation }) =>
    mutation.op === 'create' && mutation.kind === 'blocked-by'
      ? { code: 'would-cycle', message: 'that would close a loop' }
      : undefined;
  const memory = createMemorySource(threeOpenIssues());
  const store = createStore({
    source: {
      hydrate: () => memory.hydrate(),
      dispatch: (mutation) => {
        dispatches += 1;
        return memory.dispatch(mutation);
      },
    },
    derive: simpleDeriver,
    guard: noBlockedBy,
  });
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await handle.settled;

  assert.equal(dispatches, 0, 'refused before any write means the adapter is not called');
  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.projected.map((edge) => edge.states), [['invalid']]);
  const record = snapshot.writes[0];
  assert.equal(record?.state, 'invalid');
  if (record?.state === 'invalid') assert.equal(record.reason.code, 'would-cycle');
  assert.equal(snapshot.order.status, 'settled', 'a refusal was never in flight');
});

test('the guard is shown both documents', async () => {
  const seen: { current: number; next: number }[] = [];
  const store = createStore({
    source: createMemorySource(threeOpenIssues()),
    derive: simpleDeriver,
    guard: ({ current, next }) => {
      seen.push({ current: current.edges.length, next: next.edges.length });
      return undefined;
    },
  });
  await store.hydrate();
  await store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }).settled;
  assert.deepEqual(seen, [{ current: 0, next: 1 }]);
});

test('mutation identities are deterministic within a store', async () => {
  const store = createStore({ source: createScriptedSource(threeOpenIssues(), applyEdit), derive: simpleDeriver });
  await store.hydrate();
  assert.equal(store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }).mutationId, 'm1');
  assert.equal(store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' }).mutationId, 'm2');
});
