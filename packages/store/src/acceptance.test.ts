/**
 * The acceptance suite. Read this file first.
 *
 * It is written against the milestone's own "done when" sentence, clause by
 * clause: *two adapters drive the same store — one in-memory, one stubbed-async
 * with induced failures and conflicts — and every mutation state is reachable
 * from the stub. Induce a real failure rather than asserting the state exists,
 * and confirm the order does not move when a write fails.*
 *
 * Every state below is reached by CAUSING it. Nothing writes a state into the
 * store directly, because a test that does proves only that the field can hold
 * the value.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type GraphDocument, edgeId } from './model.ts';
import { EDGE_STATES, type EdgeState } from './mutation.ts';
import type { DataSource, OrderRow } from './source.ts';
import { type Store, createStore } from './store.ts';
import { createMemorySource } from './adapters/memory.ts';
import { createScriptedSource } from './adapters/scripted.ts';
import { applyEdit, simpleDeriver, threeOpenIssues, withEdge } from './testing/fixtures.ts';

const refs = (rows: readonly OrderRow[]): readonly string[] => rows.map((row) => row.ref);

/** One store factory, so "the same store" is a fact rather than a claim. */
function storeOver(source: DataSource): Store {
  return createStore({ source, derive: simpleDeriver });
}

/**
 * The scenario both adapters run: create, retype, flip, delete, back to empty.
 *
 * `settle` is what differs — the in-memory source needs nothing, and the
 * scripted one has to be told (after awaiting the hand-off: the store
 * serialises its dispatches, so an edit reaches the adapter some time after it
 * is proposed). Everything else, including every assertion, is shared, so an
 * adapter that diverges from the port fails here rather than quietly working
 * only in its own test.
 */
async function runTheWholeLoop(store: Store, settle: () => Promise<void>): Promise<void> {
  await store.hydrate();
  assert.equal(store.getSnapshot().status, 'ready');
  assert.deepEqual(refs(store.getSnapshot().order.rows), ['1', '2', '3']);

  const created = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  assert.equal(store.getSnapshot().order.status, 'held', 'the order holds the moment an edit is in flight');
  await settle();
  await created.settled;

  const blockedBy = edgeId('blocked-by', '1', '2');
  assert.deepEqual(store.getSnapshot().landed.map((edge) => edge.id), [blockedBy]);
  assert.deepEqual(refs(store.getSnapshot().order.rows), ['2', '3', '1'], 'the landed edit moved the order');
  assert.equal(store.getSnapshot().lastChange?.counts.newlyHeld, 1);

  const retyped = store.propose({ op: 'retype', edgeId: blockedBy, nextKind: 'duplicate-of' });
  await settle();
  await retyped.settled;
  const duplicateOf = edgeId('duplicate-of', '1', '2');
  assert.deepEqual(store.getSnapshot().landed.map((edge) => edge.id), [duplicateOf]);

  const flipped = store.propose({ op: 'flip', edgeId: duplicateOf });
  await settle();
  await flipped.settled;
  assert.deepEqual(
    store.getSnapshot().landed.map((edge) => [edge.from, edge.to]),
    [['2', '1']],
  );

  const deleted = store.propose({ op: 'delete', edgeId: edgeId('duplicate-of', '2', '1') });
  await settle();
  await deleted.settled;
  assert.deepEqual(store.getSnapshot().landed, []);
  assert.deepEqual(store.getSnapshot().writes, [], 'nothing is left carrying a state');
  assert.equal(store.getSnapshot().order.status, 'settled');
}

test('DONE WHEN: the in-memory adapter drives the whole loop', async () => {
  await runTheWholeLoop(storeOver(createMemorySource(threeOpenIssues())), () => Promise.resolve());
});

test('DONE WHEN: the scripted adapter drives the SAME loop', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  await runTheWholeLoop(storeOver(source), async () => {
    await source.whenPending();
    source.settleNext('applied');
  });
});

test('DONE WHEN: every edge state is reachable, and reached by CAUSING it', async () => {
  const reached = new Set<EdgeState>();

  // pending-write — an edit in flight against an adapter that has not answered.
  {
    const source = createScriptedSource(threeOpenIssues(), applyEdit);
    const store = storeOver(source);
    await store.hydrate();
    const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
    assert.deepEqual(store.getSnapshot().projected[0]?.states, ['pending-write']);
    reached.add('pending-write');

    // selected — orthogonal, and it does not displace the write state.
    store.select([edgeId('blocked-by', '1', '2')]);
    assert.deepEqual(store.getSnapshot().projected[0]?.states, ['selected', 'pending-write']);
    assert.equal(store.getSnapshot().projected[0]?.kind, 'blocked-by', 'the edge keeps its type identity');
    reached.add('selected');

    source.settleNext('applied');
    await handle.settled;
  }

  // invalid — refused before any write, and the adapter is never called.
  {
    let dispatches = 0;
    const memory = createMemorySource(threeOpenIssues());
    const store = storeOver({
      hydrate: () => memory.hydrate(),
      dispatch: (mutation) => {
        dispatches += 1;
        return memory.dispatch(mutation);
      },
    });
    await store.hydrate();
    await store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '1' }).settled;
    assert.equal(dispatches, 0);
    assert.deepEqual(store.getSnapshot().projected[0]?.states, ['invalid']);
    reached.add('invalid');
  }

  // failed — induced by a rejection, not by writing the state in.
  {
    const source = createScriptedSource(threeOpenIssues(), applyEdit);
    const store = storeOver(source);
    await store.hydrate();
    const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
    source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
    await handle.settled;
    assert.deepEqual(store.getSnapshot().projected[0]?.states, ['failed']);
    reached.add('failed');
  }

  // conflict — induced by an upstream document that moved mid-edit.
  {
    const source = createScriptedSource(threeOpenIssues(), applyEdit);
    const store = storeOver(source);
    await store.hydrate();
    const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
    source.settleNext({ outcome: 'conflict', upstream: withEdge(threeOpenIssues(), 'duplicate-of', '3', '1') });
    await handle.settled;
    assert.ok(store.getSnapshot().projected.some((edge) => edge.states.includes('conflict')));
    reached.add('conflict');
  }

  // The coverage claim itself: adding a sixth state without a way to cause it
  // must fail here rather than shipping as an unreachable case.
  assert.deepEqual([...reached].sort(), [...EDGE_STATES].sort());
});

test('DONE WHEN: a REJECTED write leaves the order exactly where it was', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = storeOver(source);
  await store.hydrate();

  const before = store.getSnapshot().order.rows;
  assert.deepEqual(refs(before), ['1', '2', '3']);

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  assert.equal(store.getSnapshot().order.rows, before, 'unmoved while pending');

  source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
  await handle.settled;

  const after = store.getSnapshot();
  assert.equal(after.order.rows, before, 'unmoved after the rejection');
  assert.equal(after.order.status, 'settled');
  assert.deepEqual(after.landed, [], 'nothing landed');
  assert.equal(after.lastChange, undefined, 'nothing landed, so nothing was re-evaluated');
  assert.deepEqual(after.projected.map((edge) => edge.states), [['failed']], 'and the work is still on the canvas');
});

test('a failed write is retried by the user, and lands', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = storeOver(source);
  await store.hydrate();

  const first = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  source.settleNext({ outcome: 'rejected', reason: 'a blip' });
  await first.settled;

  const retried = store.retry(first.mutationId);
  await source.whenPending(retried.mutationId);
  source.settleNext('applied');
  await retried.settled;

  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.landed.map((edge) => edge.id), [edgeId('blocked-by', '1', '2')]);
  assert.deepEqual(snapshot.writes, []);
  assert.deepEqual(snapshot.projected.map((edge) => edge.states), [[]]);
});

test('a conflict holds BOTH versions and merges neither', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = storeOver(source);
  await store.hydrate();

  const upstream: GraphDocument = withEdge(threeOpenIssues(), 'duplicate-of', '3', '1');
  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  source.settleNext({ outcome: 'conflict', upstream });
  await handle.settled;

  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.landed, [], 'the upstream is NOT adopted behind the user’s back');
  const record = snapshot.writes[0];
  assert.equal(record?.state, 'conflict');
  if (record?.state === 'conflict') {
    assert.deepEqual(record.upstream.edges.map((edge) => edge.id), [edgeId('duplicate-of', '3', '1')]);
  }
  assert.deepEqual(
    snapshot.projected.map((edge) => edge.states),
    [['conflict']],
    'the user’s version is still drawn, marked',
  );
});

test('retry on latest refreshes, then re-dispatches, as one operation', async () => {
  // The store owns the composition: the read and the re-dispatch are one
  // queued task, and the edit is reserved before the read starts.
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = storeOver(source);
  await store.hydrate();

  // A sibling edits the tracker directly. The store never sees it, which is
  // exactly the situation a conflict reports.
  const sibling = source.dispatch({ op: 'create', kind: 'duplicate-of', from: '3', to: '1', mutationId: 'sibling' });
  source.settle('sibling', 'applied');
  await sibling;

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await source.whenPending(handle.mutationId);
  source.settleNext({ outcome: 'conflict', upstream: source.current() });
  await handle.settled;

  const resolved = store.retryOnLatest(handle.mutationId);
  assert.equal(
    store.getSnapshot().writes.find((record) => record.mutationId === handle.mutationId)?.state,
    'pending',
    'reserved before the refresh',
  );

  await source.whenPending(resolved.mutationId);
  assert.deepEqual(
    store.getSnapshot().landed.map((edge) => edge.id),
    [edgeId('duplicate-of', '3', '1')],
    'the refresh landed before anything was re-dispatched',
  );
  source.settleNext('applied');
  await resolved.settled;

  const snapshot = store.getSnapshot();
  assert.deepEqual(
    [...snapshot.landed].map((edge) => edge.id).sort(),
    [edgeId('blocked-by', '1', '2'), edgeId('duplicate-of', '3', '1')].sort(),
    'the sibling’s edge and the user’s both stand — nothing was merged away',
  );
  assert.deepEqual(snapshot.writes, []);
});

test('discard mine is the only call that removes the user’s work', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = storeOver(source);
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  await source.whenPending(handle.mutationId);
  source.settleNext({ outcome: 'conflict', upstream: withEdge(threeOpenIssues(), 'duplicate-of', '3', '1') });
  await handle.settled;
  assert.equal(store.getSnapshot().projected.length, 1);

  store.discardMine(handle.mutationId);
  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.projected, [], 'the user’s edge is gone');
  assert.deepEqual(snapshot.writes, []);
  // And the conflict's recorded document is NOT adopted in its place: it is a
  // reading of the past, and the store keeps no way to tell how far past.
  assert.deepEqual(snapshot.landed, []);
});

test('an in-flight write cannot be discarded out from under itself', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = storeOver(source);
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  store.discardMine(handle.mutationId);
  assert.equal(store.getSnapshot().writes[0]?.state, 'pending');

  source.settleNext('applied');
  await handle.settled;
});

test('an adapter that throws surfaces as failed, not as a hang and not as success', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = storeOver(source);
  await store.hydrate();

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  source.throwNext(new Error('the adapter fell over'));
  await handle.settled;

  const record = store.getSnapshot().writes[0];
  assert.equal(record?.state, 'failed');
  if (record?.state === 'failed') assert.match(record.reason, /fell over/);
  assert.deepEqual(store.getSnapshot().landed, []);
});

test('an UNCHANGED result about the document the store has moves nothing', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const store = storeOver(source);
  await store.hydrate();

  const landedBefore = store.getSnapshot().landed;
  const rowsBefore = store.getSnapshot().order.rows;

  const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
  source.settleNext('unchanged');
  await handle.settled;

  const snapshot = store.getSnapshot();
  // `unchanged` carries an authoritative document and the store adopts it — but
  // when it says what the store already holds, adopting is a no-op and the
  // ranking keeps its identity. (The case where it does NOT is covered by `an
  // unchanged answer about a document the store has not got still lands it`.)
  assert.equal(snapshot.landed, landedBefore, 'nothing adopted');
  assert.equal(snapshot.order.rows, rowsBefore, 'the ranking did not move');
  assert.equal(snapshot.lastChange, undefined, 'no change summary for a write that changed nothing');
  assert.deepEqual(snapshot.projected, [], 'the settled overlay is gone');
});

test('the change summary persists until the next edit or an explicit dismissal', async () => {
  const source = createMemorySource(threeOpenIssues());
  const store = storeOver(source);
  await store.hydrate();

  await store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' }).settled;
  const change = store.getSnapshot().lastChange;
  assert.ok(change !== undefined);
  assert.equal(change.counts.newlyHeld, 1);

  // Reads do not clear it, and neither does time — there is no timer here.
  store.select([]);
  assert.equal(store.getSnapshot().lastChange, change);

  store.dismissChange();
  assert.equal(store.getSnapshot().lastChange, undefined);
});

test('this package contains no timer', async () => {
  // §17c rejects the toast because the only evidence the edit worked disappears
  // before it is read. A timer below the seam would reintroduce it somewhere a
  // host could not remove it, so its absence is asserted rather than intended.
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const root = fileURLToPath(new URL('.', import.meta.url));

  function walk(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return walk(path);
      return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
    });
  }

  const shipped = walk(root);
  assert.ok(shipped.length > 0, 'found no shipped source to scan');
  for (const path of shipped) {
    const text = readFileSync(path, 'utf8');
    assert.ok(!/\bsetTimeout\b|\bsetInterval\b/.test(text), `${path} sets a timer`);
  }
});
