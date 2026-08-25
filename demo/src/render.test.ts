/**
 * The one rendering decision that is not a matter of taste.
 *
 * `render.ts` is DOM code and the demo carries no DOM harness on purpose — a
 * page whose whole claim is "runs from a clean checkout with no credentials"
 * should not pull jsdom in to look at itself. So what is tested here is the
 * PREDICATE the rendering branches on, extracted for exactly that reason, and
 * it is pinned against the STORE'S ACTUAL BEHAVIOUR rather than against a
 * reading of the store's source: the point is that the page never offers a
 * control the store will refuse, and only the store can say what it refuses.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DataSource, DispatchResult, GraphDocument, Mutation } from '@issuegraph/store';
import { createStore, makeEdge } from '@issuegraph/store';

import { createDeriver } from './order.ts';
import { offersDelete } from './render.ts';
import { seedDocument, seedHolds } from './seed.ts';

/**
 * A source that answers however the test tells it to, and nothing else.
 *
 * `held` never settles, which is what makes the PENDING window observable: the
 * store dispatches one authoritative operation at a time and holds the write in
 * `pending` until the adapter answers, so a source that resolves immediately
 * cannot exercise the state at all.
 */
function source(outcome: 'applied' | 'rejected' | 'held'): DataSource {
  const document: GraphDocument = seedDocument();
  return {
    hydrate: () => Promise.resolve(document),
    dispatch: (mutation: Mutation): Promise<DispatchResult> => {
      if (outcome === 'held') return new Promise<DispatchResult>(() => {});
      if (outcome === 'rejected') {
        return Promise.resolve({ outcome: 'rejected', reason: 'the tracker refused this write' });
      }
      // Only the shapes these tests actually exercise; anything else would be a
      // fixture pretending to be an adapter.
      assert.equal(mutation.op, 'delete');
      return Promise.resolve({ outcome: 'applied', document });
    },
  };
}

async function hydrated(outcome: 'applied' | 'rejected' | 'held') {
  const store = createStore({ source: source(outcome), derive: createDeriver(seedHolds()) });
  await store.hydrate();
  return store;
}

function projected(store: Awaited<ReturnType<typeof hydrated>>, id: string) {
  const found = store.getSnapshot().projected.find((edge) => edge.id === id);
  assert.ok(found !== undefined, `no projected edge ${id}`);
  return found;
}

test('a landed edge offers delete', () => {
  // The ordinary case, asserted so the guard cannot pass by suppressing
  // everything — a predicate that always returns false would satisfy the
  // negative test below on its own.
  return hydrated('applied').then((store) => {
    const landed = seedDocument().edges[0];
    assert.ok(landed !== undefined);
    assert.equal(offersDelete(projected(store, landed.id), store.getSnapshot()), true);
  });
});

test('an edge that exists only as an overlay does NOT offer delete', async () => {
  const store = await hydrated('rejected');
  const edge = makeEdge('blocked-by', '4', '5');
  await store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '5' }).settled;

  const snapshot = store.getSnapshot();
  assert.ok(
    snapshot.projected.some((each) => each.id === edge.id),
    'the failed create is not drawn at all, so this test proves nothing',
  );
  assert.ok(
    !snapshot.landed.some((each) => each.id === edge.id),
    'the refused create landed, so this fixture is not exercising an overlay',
  );
  assert.equal(offersDelete(projected(store, edge.id), snapshot), false);
});

test('THE PIN: the store refuses exactly what the predicate declines to offer', async () => {
  // The load-bearing test. The two facts have to agree, and asserting the
  // predicate alone would only re-state this file's own reading of the store —
  // which is what let the unconditional button ship in the first place. So the
  // refusal is OBSERVED: propose the delete the page used to offer, and read
  // what came back.
  const store = await hydrated('rejected');
  const edge = makeEdge('blocked-by', '4', '5');
  await store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '5' }).settled;

  assert.equal(offersDelete(projected(store, edge.id), store.getSnapshot()), false);

  const handle = store.propose({ op: 'delete', edgeId: edge.id });
  await handle.settled;
  const record = store
    .getSnapshot()
    .writes.find((write) => write.mutationId === handle.mutationId);
  assert.ok(record?.state === 'invalid', 'the store accepted a delete of an unlanded edge');
  assert.equal(record.reason.code, 'unknown-edge');
});

test('an edge with an edit IN FLIGHT does not offer another delete', async () => {
  // A pending DELETE leaves its edge in `landed` until it settles, so the landed
  // test alone kept the button up for the whole dispatch — and the second click
  // it invited was refused `unknown-edge` once the first landed. The landed
  // answer is stale while an edit is in flight, which is what this asserts.
  const store = await hydrated('held');
  const landed = seedDocument().edges[0];
  assert.ok(landed !== undefined);

  // CONTROL FIRST, on the same edge and the same store: before the write it IS
  // offered, so the assertion below cannot pass against a predicate that has
  // simply stopped offering anything.
  assert.equal(offersDelete(projected(store, landed.id), store.getSnapshot()), true);

  store.propose({ op: 'delete', edgeId: landed.id });   // never settles: `held`
  const snapshot = store.getSnapshot();
  const edge = projected(store, landed.id);
  assert.ok(
    edge.states.includes('pending-write'),
    'the fixture is not exercising a pending write at all',
  );
  assert.ok(
    snapshot.landed.some((each) => each.id === landed.id),
    'the edge left `landed` on its own, so this test is not covering the stale-landed case',
  );
  assert.equal(offersDelete(edge, snapshot), false);
});

test('a RETYPE in flight is refused by the LANDED test, not the pending one', async () => {
  // Pinned because it is the fact that keeps the two clauses honest about their
  // jobs. An edge's identity is derived from its kind and endpoints, so a retype
  // in flight removes the old id from the projection ENTIRELY and draws the new
  // kind instead — which is not in `landed`, so the landed test refuses it and
  // the pending clause never sees it. Delete is the one operation that keeps its
  // id and stays landed while in flight.
  //
  // Without this, a later reader could "simplify" the landed test away on the
  // belief that the pending clause covers every in-flight edit. It does not.
  const store = await hydrated('held');
  const landed = seedDocument().edges[0];
  assert.ok(landed !== undefined);
  store.propose({ op: 'retype', edgeId: landed.id, nextKind: 'serialize-with' });

  const snapshot = store.getSnapshot();
  assert.ok(
    !snapshot.projected.some((each) => each.id === landed.id),
    'the retyped edge kept its id, so this test no longer describes the mechanism',
  );
  const retyped = snapshot.projected.find(
    (each) => each.kind === 'serialize-with' && each.from === landed.from && each.to === landed.to,
  );
  assert.ok(retyped !== undefined, 'the retype overlay is not drawn at all');
  assert.equal(offersDelete(retyped, snapshot), false);
});
