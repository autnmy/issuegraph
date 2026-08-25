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

/** A source that answers however the test tells it to, and nothing else. */
function source(outcome: 'applied' | 'rejected'): DataSource {
  const document: GraphDocument = seedDocument();
  return {
    hydrate: () => Promise.resolve(document),
    dispatch: (mutation: Mutation): Promise<DispatchResult> => {
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

async function hydrated(outcome: 'applied' | 'rejected') {
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
