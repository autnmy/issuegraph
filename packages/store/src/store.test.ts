import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type GraphDocument, type StoredEdge, edgeId, makeEdge } from './model.ts';
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

  await source.whenPending(first.mutationId);
  source.settle(first.mutationId, 'applied');
  await first.settled;
  assert.equal(store.getSnapshot().order.status, 'held', 'one landed, one still queued');

  await source.whenPending(second.mutationId);
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

  await source.whenPending(first.mutationId);
  source.settle(first.mutationId, { outcome: 'rejected', reason: 'locked' });
  await first.settled;
  await source.whenPending(second.mutationId);

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
  // An edit that FAILED is unsettled but not in flight, so it does not hold the
  // queue — which is the only shape this scenario can now take, because a
  // rehydrate waits behind anything actually dispatched.
  let document: GraphDocument = threeOpenIssues();
  const scripted = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(document),
      dispatch: (mutation) => scripted.dispatch(mutation),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await scripted.whenPending(handle.mutationId);
  scripted.settleNext({ outcome: 'rejected', reason: 'locked' });
  await handle.settled;

  document = withEdge(threeOpenIssues(), 'duplicate-of', '3', '1');
  await store.rehydrate();

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.landed.length, 1, 'the refreshed document landed');
  assert.equal(snapshot.projected.length, 2, 'the failed edit is still drawn');
  assert.ok(snapshot.projected.some((edge) => edge.states.includes('failed')));
  assert.equal(snapshot.order.status, 'settled');
});

test('a refresh queued behind a write runs only once that write settles', async () => {
  // The ordering guarantee, stated directly: this is what stops a dispatch
  // answer that predates the refresh from overwriting it.
  const scripted = createScriptedSource(threeOpenIssues(), applyEdit);
  let reads = 0;
  const store = createStore({
    source: {
      hydrate: () => {
        reads += 1;
        return Promise.resolve(threeOpenIssues());
      },
      dispatch: (mutation) => scripted.dispatch(mutation),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();
  assert.equal(reads, 1);

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await scripted.whenPending(handle.mutationId);
  const refresh = store.rehydrate();
  await Promise.resolve();
  assert.equal(reads, 1, 'the refresh has not run while the write is in flight');

  scripted.settleNext('applied');
  await handle.settled;
  await refresh;
  assert.equal(reads, 2, 'and it runs as soon as the write settles');
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
  // Twice: once for the immediate verdict a proposal needs, once at dispatch
  // because `landed` may have moved while the edit waited. Asking a pure
  // function twice is cheaper than keeping bookkeeping about when to ask.
  assert.deepEqual(seen, [
    { current: 0, next: 1 },
    { current: 0, next: 1 },
  ]);
});

test('mutation identities are deterministic within a store', async () => {
  const store = createStore({ source: createScriptedSource(threeOpenIssues(), applyEdit), derive: simpleDeriver });
  await store.hydrate();
  assert.equal(store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }).mutationId, 'm1');
  assert.equal(store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' }).mutationId, 'm2');
});

test('an out-of-order applied response cannot roll the document backward', async () => {
  // Two edits in flight, the SECOND answering first with the fuller snapshot.
  // Adopting the delayed first answer afterwards would remove the second edit's
  // edge from `landed` even though it is upstream — a ranking derived from a
  // document missing a real relationship.
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  const second = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });

  // Only one dispatch may be outstanding: two unversioned authoritative
  // snapshots in flight cannot be ordered by anything the port carries.
  assert.deepEqual(
    source.pending().map((entry) => entry.mutationId),
    [first.mutationId],
  );

  await source.whenPending(first.mutationId);
  source.settleNext('applied');
  await first.settled;
  await source.whenPending(second.mutationId);
  source.settleNext('applied');
  await second.settled;

  assert.deepEqual(
    [...store.getSnapshot().landed].map((edge) => edge.id).sort(),
    [edgeId('blocked-by', '1', '2'), edgeId('duplicate-of', '3', '1')].sort(),
  );
});

test('a conflict resolution never adopts a snapshot older than what has landed', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const conflicted = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await source.whenPending(conflicted.mutationId);
  source.settleNext({ outcome: 'conflict', upstream: threeOpenIssues() });
  await conflicted.settled;

  // A later edit lands. `landed` is now NEWER than the conflict's snapshot,
  // and — because `applied` is a full authoritative answer — strictly better
  // informed than it.
  const later = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });
  await source.whenPending(later.mutationId);
  source.settleNext('applied');
  await later.settled;
  assert.deepEqual(store.getSnapshot().landed.map((edge) => edge.id), [edgeId('duplicate-of', '3', '1')]);

  store.discardMine(conflicted.mutationId);
  assert.deepEqual(
    store.getSnapshot().landed.map((edge) => edge.id),
    [edgeId('duplicate-of', '3', '1')],
    'discarding the conflicted edit must not roll back the edit that landed after it',
  );
});

test('a same-identity refusal marks the edge instead of erasing it', async () => {
  // A retype to the kind the edge already has, and a flip of a symmetric edge,
  // both "produce" the edge they name. Hiding the original while drawing the
  // replacement would remove a real, landed relationship from the canvas
  // because the user made a no-op edit.
  for (const [seedKind, proposal] of [
    ['blocked-by', { op: 'retype' as const, nextKind: 'blocked-by' as const }],
    ['serialize-with', { op: 'flip' as const }],
  ] as const) {
    const id = edgeId(seedKind, '1', '2');
    const store = createStore({
      source: createMemorySource(withEdge(threeOpenIssues(), seedKind, '1', '2')),
      derive: simpleDeriver,
    });
    await store.hydrate();
    await store.propose({ ...proposal, edgeId: id }).settled;

    const snapshot = store.getSnapshot();
    assert.equal(snapshot.projected.length, 1, `${seedKind}: the relationship must still be drawn`);
    assert.equal(snapshot.projected[0]?.id, id);
    assert.deepEqual(snapshot.projected[0]?.states, ['invalid']);
    assert.deepEqual(snapshot.landed.map((edge) => edge.id), [id], 'and nothing landed');
  }
});

test('a symmetric edge whose carrier reversed upstream is adopted, not kept stale', async () => {
  // The two spellings share a content-derived identity, but the stored pair is
  // what an editor deletes and what a retype to a directed kind inherits — so
  // keeping the stale carrier would write the opposite direction.
  let document = withEdge(threeOpenIssues(), 'serialize-with', '1', '2');
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(document),
      dispatch: () => Promise.resolve({ outcome: 'unchanged' as const, document }),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();
  assert.deepEqual(store.getSnapshot().landed.map((edge) => [edge.from, edge.to]), [['1', '2']]);

  document = withEdge(threeOpenIssues(), 'serialize-with', '2', '1');
  await store.rehydrate();
  assert.deepEqual(
    store.getSnapshot().landed.map((edge) => [edge.from, edge.to]),
    [['2', '1']],
    'the carrier the tracker actually holds is the one to keep',
  );
});

test('starting a new edit clears the previous edit’s change summary', async () => {
  // The summary is evidence for ONE edit. Left standing through the next one, a
  // UI attributes the previous edit's blast radius to the current one.
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await source.whenPending(first.mutationId);
  source.settleNext('applied');
  await first.settled;
  assert.ok(store.getSnapshot().lastChange !== undefined);

  const second = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });
  assert.equal(store.getSnapshot().lastChange, undefined, 'cleared the moment the next edit starts');

  await source.whenPending(second.mutationId);
  source.settleNext({ outcome: 'rejected', reason: 'no' });
  await second.settled;
});

test('a guard that throws refuses the edit rather than stranding the queue', async () => {
  // The guard is HOST code required by the port, so it throwing is ordinary —
  // and the store already reads a throwing ADAPTER as a rejection. Left
  // unhandled it would escape `drain`, leaving this edit pending for ever, the
  // order held for ever, and every queued edit behind it undispatched.
  let dispatches = 0;
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
    guard: () => {
      throw new Error('the guard fell over');
    },
  });
  await store.hydrate();

  const refused = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await refused.settled;

  const record = store.getSnapshot().writes[0];
  assert.equal(record?.state, 'invalid', 'an unknown verdict fails closed');
  if (record?.state === 'invalid') assert.match(record.reason.message, /fell over/);
  assert.equal(dispatches, 0, 'and nothing was dispatched on a verdict nobody reached');
  assert.equal(store.getSnapshot().order.status, 'settled');

  // The queue is still usable.
  const next = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });
  await next.settled;
  assert.equal(store.getSnapshot().writes.length, 2);
});

test('a deriver that throws does not strand the write behind it', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  let explode = false;
  const store = createStore({
    source,
    derive: (document) => {
      if (explode) throw new Error('the deriver fell over');
      return simpleDeriver(document);
    },
  });
  await store.hydrate();

  explode = true;
  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  const second = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });
  await source.whenPending(first.mutationId);
  source.settleNext('applied');
  await first.settled;

  // The edit landed; only the ORDER could not be recomputed, which is a state
  // the rail can label — not a reason to stop the pipeline behind it.
  assert.equal(store.getSnapshot().landed.length, 1);
  await source.whenPending(second.mutationId);
  source.settleNext('applied');
  await second.settled;
  assert.equal(store.getSnapshot().landed.length, 2, 'the queue kept moving');
});

test('a refresh cannot be overwritten by a dispatch answer that predates it', async () => {
  // Serialising dispatches orders writes against each other; it says nothing
  // about a rehydrate landing between one going out and its answer coming back.
  // The answer is an authoritative snapshot too, so adopting it afterwards
  // removes whatever the refresh brought in.
  const scripted = createScriptedSource(threeOpenIssues(), applyEdit);
  let refreshed = threeOpenIssues();
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(refreshed),
      dispatch: (mutation) => scripted.dispatch(mutation),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  const mine = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await scripted.whenPending(mine.mutationId);

  // Somebody else adds an edge, and the host refreshes.
  refreshed = withEdge(threeOpenIssues(), 'duplicate-of', '3', '1');
  const refresh = store.rehydrate();

  // The dispatch answers with the adapter's own view, which never saw it.
  scripted.settleNext('applied');
  await mine.settled;
  await refresh;

  assert.ok(
    store.getSnapshot().landed.some((edge) => edge.id === edgeId('duplicate-of', '3', '1')),
    'the refreshed edge must survive the dispatch answer that predates it',
  );
});

test('recovering a stale order does not attribute the lost edit’s movement to the next one', async () => {
  // While `orderError` stands, the published rows are from before the edit that
  // broke the deriver. Diffing the next successful derivation against them
  // credits BOTH edits' movement to the second mutation.
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  let explode = true;
  const store = createStore({
    source,
    derive: (document) => {
      if (explode) throw new Error('the deriver fell over');
      return simpleDeriver(document);
    },
  });
  explode = false;
  await store.hydrate();

  explode = true;
  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await source.whenPending(first.mutationId);
  source.settleNext('applied');
  await first.settled;
  assert.ok(store.getSnapshot().orderError !== undefined, 'the order is stale');

  explode = false;
  const second = store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '2' });
  await source.whenPending(second.mutationId);
  source.settleNext('applied');
  await second.settled;

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.orderError, undefined, 'the order recovered');
  assert.deepEqual(refs(snapshot.order.rows), ['2', '1', '3']);
  assert.equal(
    snapshot.lastChange,
    undefined,
    'no summary, because the baseline it would diff against was never published as current',
  );
});

test('a reversed symmetric carrier reaches the projection, not just the landed set', async () => {
  // `landed` adopts the new carrier; if the projection is reused because the
  // ids match, the two slices of one snapshot disagree — and it is the
  // projection a viewer draws and an editor deletes through.
  let document = withEdge(threeOpenIssues(), 'serialize-with', '1', '2');
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(document),
      dispatch: () => Promise.resolve({ outcome: 'unchanged' as const, document }),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  document = withEdge(threeOpenIssues(), 'serialize-with', '2', '1');
  await store.rehydrate();

  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.landed.map((edge) => [edge.from, edge.to]), [['2', '1']]);
  assert.deepEqual(
    snapshot.projected.map((edge) => [edge.from, edge.to]),
    [['2', '1']],
    'the projection must not still be showing the carrier the landed set replaced',
  );
});

test('a refusal whose reason changed is republished, not reused', async () => {
  // The record keeps its identity and its `invalid` state; only the reason
  // moves. A host reading the reason inline beside the ghost edge would keep
  // showing the old explanation.
  let document = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(document),
      dispatch: () => Promise.resolve({ outcome: 'unchanged' as const, document }),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  const id = edgeId('blocked-by', '1', '2');
  const handle = store.propose({ op: 'retype', edgeId: id, nextKind: 'blocked-by' });
  await handle.settled;
  const first = store.getSnapshot().writes[0];
  assert.equal(first?.state === 'invalid' ? first.reason.code : undefined, 'unchanged-kind');

  // The edge goes away upstream, so the same retype is now refused for a
  // different reason entirely.
  document = threeOpenIssues();
  await store.rehydrate();
  await store.retry(handle.mutationId).settled;

  const second = store.getSnapshot().writes[0];
  assert.equal(second?.state, 'invalid');
  assert.equal(
    second?.state === 'invalid' ? second.reason.code : undefined,
    'unknown-edge',
    'the published reason must be the current one',
  );
});

test('issue updates are not lost when a conflict is resolved after another edit lands', async () => {
  // `applied` used to answer with edges alone while `conflict` answered with a
  // whole document, so "landed is newer" was true of edges and false of issues:
  // skipping a stale conflict snapshot threw away the only copy of the issue
  // updates it carried, and a closed issue reads as open until a rehydrate.
  const upstream: GraphDocument = {
    issues: [
      { ref: '1', title: 'Issue 1', state: 'closed' },
      { ref: '2', title: 'Issue 2', state: 'open' },
      { ref: '3', title: 'Issue 3', state: 'open' },
    ],
    edges: [],
  };
  let answer: 'conflict' | 'applied' = 'conflict';
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(threeOpenIssues()),
      dispatch: () =>
        answer === 'conflict'
          ? Promise.resolve({ outcome: 'conflict' as const, upstream })
          : Promise.resolve({
              outcome: 'applied' as const,
              // The adapter answers with what it holds — issues included.
              document: { issues: upstream.issues, edges: [makeEdge('duplicate-of', '3', '1')] },
            }),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  const conflicted = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await conflicted.settled;
  assert.equal(store.getSnapshot().writes[0]?.state, 'conflict');

  answer = 'applied';
  const later = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });
  await later.settled;

  store.discardMine(conflicted.mutationId);

  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.issues.find((issue) => issue.ref === '1')?.state,
    'closed',
    'the issue update must survive, whichever answer carried it',
  );
  assert.deepEqual(
    snapshot.landed.map((edge) => edge.id),
    [edgeId('duplicate-of', '3', '1')],
    'and the later edit is still landed',
  );
});

test('a settling edit does not republish its summary once a newer edit has started', async () => {
  // The contract is that a summary lasts until the NEXT edit. Two edits
  // proposed before the first settles means the first's summary is written
  // after the second began, so a host shows the previous edit's blast radius
  // beside the current one.
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  const second = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });

  await source.whenPending(first.mutationId);
  source.settleNext('applied');
  await first.settled;

  assert.equal(
    store.getSnapshot().lastChange,
    undefined,
    'the first edit is no longer the current one, so its summary is not published',
  );

  await source.whenPending(second.mutationId);
  source.settleNext('applied');
  await second.settled;
  assert.equal(
    store.getSnapshot().lastChange?.mutation.mutationId,
    second.mutationId,
    'the summary belongs to the edit that is current when it lands',
  );
});

test('a subscriber that proposes during notification cannot overtake the edit it saw', async () => {
  // `publish()` runs subscribers synchronously, so a subscriber proposing a
  // follow-up re-enters `start()`. Publishing before enqueueing let the nested
  // edit reach the queue first and go out first — user order reversed, and for
  // two edits on the same edge the second can invalidate the first.
  const scripted = createScriptedSource(threeOpenIssues(), applyEdit);
  const dispatched: string[] = [];
  const store = createStore({
    source: {
      hydrate: () => scripted.hydrate(),
      dispatch: (mutation) => {
        dispatched.push(mutation.mutationId);
        return scripted.dispatch(mutation);
      },
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  let followedUp = false;
  store.subscribe(() => {
    if (followedUp) return;
    if (!store.getSnapshot().writes.some((record) => record.state === 'pending')) return;
    followedUp = true;
    store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' });
  });

  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  assert.ok(followedUp, 'the subscriber ran during the first proposal');

  // Drained without naming either edit, so this reads whichever order the store
  // actually chose rather than assuming one and hanging when it guessed wrong.
  await scripted.whenPending();
  scripted.settleNext('applied');
  await scripted.whenPending();
  scripted.settleNext('applied');
  await first.settled;

  assert.deepEqual(dispatched, ['m1', 'm2'], 'the edits go out in the order the user made them');
});

test('EVERY array the snapshot exposes is frozen, including ones added later', async () => {
  // The arrays the snapshot hands out ARE the store's state — `landed` and
  // `issues` come straight from the adapter and `order.rows` from the deriver,
  // and `Object.freeze` on the snapshot wrapper protects none of them. A
  // consumer calling `.sort()` on one (the common slip; `[...a].sort()` is the
  // careful form) would change store state with no dispatch, no generation
  // bump, no re-derivation and no notification.
  //
  // Driven off the snapshot's own keys rather than a written list, so an array
  // added to the shape later is covered without editing this.
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  store.select([edgeId('blocked-by', '1', '2')]);
  await source.whenPending(handle.mutationId);
  source.settleNext({ outcome: 'rejected', reason: 'so a write record is exposed too' });
  await handle.settled;

  // WALKED RECURSIVELY, not one level. The first version of this test read the
  // snapshot's own keys and stopped, which left `writes[].upstream.edges`,
  // `projected[].states` and `order.rows[].holdReasons` unchecked — the same
  // finding one level down. The predicate is "every array REACHABLE from the
  // snapshot", so the walk has to be too.
  function everyArray(value: unknown, path: string, found: [string, readonly unknown[]][] = []) {
    if (Array.isArray(value)) {
      found.push([path, value]);
      value.forEach((item, index) => everyArray(item, `${path}[${index}]`, found));
      return found;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, nested] of Object.entries(value)) everyArray(nested, `${path}.${key}`, found);
    }
    return found;
  }

  const snapshot = store.getSnapshot();
  const arrays = everyArray(snapshot, 'snapshot');

  // The shapes this test is about must actually be present, or it would pass by
  // having found nothing to check. Nested ones included, since those are the
  // ones the one-level version missed.
  for (const expected of [
    'snapshot.issues',
    'snapshot.landed',
    'snapshot.projected',
    'snapshot.selection',
    'snapshot.writes',
    'snapshot.order.rows',
    'snapshot.projected[0].states',
    'snapshot.projected[0].writes',
    'snapshot.order.rows[0].holdReasons',
  ]) {
    assert.ok(
      arrays.some(([path]) => path === expected),
      `the walk never reached ${expected}`,
    );
  }

  for (const [path, value] of arrays) {
    assert.ok(Object.isFrozen(value), `${path} is not frozen`);
    assert.throws(() => (value as unknown[]).push('x'), TypeError, `${path} accepted a push`);
  }

  // And the store is unchanged by the attempts above.
  assert.deepEqual(store.getSnapshot().issues.map((issue) => issue.ref), ['1', '2', '3']);
  assert.deepEqual(store.getSnapshot().landed, []);
});

test('freezing what the store publishes does not reach into the adapter’s own arrays', async () => {
  // The store copies before freezing, so an adapter that keeps and reuses its
  // arrays is not frozen out of its own storage by handing one over.
  const source = createMemorySource(threeOpenIssues());
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  assert.ok(!Object.isFrozen(source.current().edges), 'the adapter still owns a mutable array');
  await store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }).settled;
  assert.ok(!Object.isFrozen(source.current().edges));
  assert.equal(source.current().edges.length, 1);
});

test('a conflict snapshot a consumer reached through cannot be edited into the store', async () => {
  // `record.upstream` is adapter-owned and is exposed through `snapshot.writes`,
  // then adopted as authoritative by `retryOnLatest` / `discardMine`. Splicing
  // it would change the ranking with no adapter operation at all.
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await source.whenPending(handle.mutationId);
  source.settleNext({ outcome: 'conflict', upstream: withEdge(threeOpenIssues(), 'duplicate-of', '3', '1') });
  await handle.settled;

  const record = store.getSnapshot().writes[0];
  assert.equal(record?.state, 'conflict');
  if (record?.state !== 'conflict') return;

  assert.ok(Object.isFrozen(record.upstream.edges), 'the retained conflict document is frozen');
  assert.throws(() => (record.upstream.edges as StoredEdge[]).pop(), TypeError);

  // It is retained for display and never adopted, so even an editable copy
  // could not have reached `landed` — the freeze is defence in depth on a door
  // that is now closed anyway.
  store.discardMine(handle.mutationId);
  assert.deepEqual(store.getSnapshot().landed, []);
});

test('a refresh confirming the document supersedes a conflict snapshot taken before it', async () => {
  // The counter bumped only when adopting CHANGED the document, so an
  // authoritative read returning what the store already held left it untouched
  // — and a conflict snapshot recorded before that read still looked current.
  // Resurrecting it puts back a change the tracker no longer has.
  let served: GraphDocument = threeOpenIssues();
  const scripted = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(served),
      dispatch: (mutation) => scripted.dispatch(mutation),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await scripted.whenPending(handle.mutationId);
  // Somebody else's change, which the store never adopts.
  scripted.settleNext({ outcome: 'conflict', upstream: withEdge(threeOpenIssues(), 'duplicate-of', '3', '1') });
  await handle.settled;

  // ...and then it is reverted, so a refresh authoritatively returns the
  // original document. Nothing about `landed` changes.
  await store.rehydrate();
  assert.deepEqual(store.getSnapshot().landed, []);

  store.discardMine(handle.mutationId);
  assert.deepEqual(
    store.getSnapshot().landed,
    [],
    'a snapshot older than the last authoritative read must never be resurrected',
  );
});

test('the two calls a host composes retry-on-latest from are each single-step', async () => {
  // This is what replaced the store's own `retryOnLatest`, which had an `await`
  // between reading the conflict and acting on it and produced a P1 in three
  // consecutive review rounds. `retry` and `discardMine` read the record and
  // act on it with nothing in between, so neither can be overtaken.
  //
  // The two races that killed the composite are the ones asserted here, and
  // both are the HOST's to sequence now — which it can, because it holds the
  // await and can look again.
  const scripted = createScriptedSource(threeOpenIssues(), applyEdit);
  let refreshFails = false;
  let dispatches = 0;
  const store = createStore({
    source: {
      hydrate: () =>
        refreshFails ? Promise.reject(new Error('the tracker is down')) : Promise.resolve(threeOpenIssues()),
      dispatch: (mutation) => {
        dispatches += 1;
        return scripted.dispatch(mutation);
      },
    },
    derive: simpleDeriver,
  });
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await scripted.whenPending(handle.mutationId);
  scripted.settleNext({ outcome: 'conflict', upstream: withEdge(threeOpenIssues(), 'duplicate-of', '3', '1') });
  await handle.settled;
  assert.equal(dispatches, 1);

  // RACE 1 — the refresh fails. The host sees it and does not retry.
  refreshFails = true;
  await store.rehydrate();
  assert.equal(store.getSnapshot().hydrationError, 'the tracker is down');
  assert.equal(dispatches, 1, 'a host that checks does not dispatch against an unconfirmed document');
  assert.equal(store.getSnapshot().writes[0]?.state, 'conflict', 'and the conflict is left to try again');

  // RACE 2 — the edit is discarded while the refresh is in flight. The host
  // looks again afterwards and finds nothing to retry.
  refreshFails = false;
  const refresh = store.rehydrate();
  store.discardMine(handle.mutationId);
  await refresh;
  assert.equal(
    store.getSnapshot().writes.find((record) => record.mutationId === handle.mutationId),
    undefined,
    'the discard took effect immediately — it has no await to be overtaken across',
  );
  assert.equal(dispatches, 1, 'and nothing the user discarded was dispatched');
});


test('an unchanged answer about a document the store has not got still lands it', async () => {
  // `unchanged` is an authoritative statement — "the document already says what
  // you asked for" — and the store could not act on it because it carried no
  // document. When another client had already created the same edge, the store
  // dropped the overlay and ended up WITHOUT an edge that genuinely exists,
  // ranking the backlog on a document missing a real relationship.
  const upstream = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const store = createStore({
    source: {
      hydrate: () => Promise.resolve(threeOpenIssues()),
      // The adapter already holds the edge, so there is nothing to apply.
      dispatch: () => Promise.resolve({ outcome: 'unchanged' as const, document: upstream }),
    },
    derive: simpleDeriver,
  });
  await store.hydrate();
  assert.deepEqual(refs(store.getSnapshot().order.rows), ['1', '2', '3']);

  await store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }).settled;

  const snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.landed.map((edge) => edge.id),
    [edgeId('blocked-by', '1', '2')],
    'the edge the adapter says exists is in the store',
  );
  assert.deepEqual(refs(snapshot.order.rows), ['2', '3', '1'], 'and the order reflects it');
  assert.deepEqual(snapshot.writes, [], 'the edit is settled');
  assert.equal(
    snapshot.lastChange,
    undefined,
    'but no summary: the movement was somebody else’s, not this edit’s',
  );
});

test('an unchanged answer about a document the store already has changes nothing at all', async () => {
  const source = createMemorySource(threeOpenIssues());
  const store = createStore({ source, derive: simpleDeriver });
  await store.hydrate();

  const before = store.getSnapshot();
  await store.propose({ op: 'delete', edgeId: edgeId('blocked-by', '1', '2') }).settled;

  const after = store.getSnapshot();
  assert.equal(after.landed, before.landed, 'nothing adopted');
  assert.equal(after.order.rows, before.order.rows, 'nothing re-derived');
  assert.equal(after.lastChange, undefined);
});
