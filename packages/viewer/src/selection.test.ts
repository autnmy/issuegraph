import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';

import { normalizeDocument } from './document.ts';
import {
  type ViewerSelection,
  isNarrowBox,
  nextSelection,
  sameSelection,
  storedSelectionOf,
  viewerSelectionOf,
} from './selection.ts';
import { fixtureDocument } from './testing/fixtures.ts';

const none: ViewerSelection = { kind: 'none' };
const keys = (...members: string[]): ViewerSelection => ({ kind: 'issues', keys: members });

// A rank order that differs from key order and from document order, so a range
// that walked either of those instead would add the wrong keys.
const RANK = ['e', 'b', 'f', 'a', 'd', 'c'];

describe('nextSelection', () => {
  it('replaces with one issue whatever was selected', () => {
    assert.deepEqual(nextSelection(keys('a', 'b'), { kind: 'replace', key: 'c' }, RANK), keys('c'));
    assert.deepEqual(nextSelection({ kind: 'edge', edgeId: 'x' }, { kind: 'replace', key: 'c' }, RANK), keys('c'));
  });

  it('toggles an issue in and out by exact value, and the last drop gives none', () => {
    const added = nextSelection(keys('a'), { kind: 'toggle', key: 'b' }, RANK);
    assert.deepEqual(added, keys('a', 'b'));
    const dropped = nextSelection(added, { kind: 'toggle', key: 'a' }, RANK);
    assert.deepEqual(dropped, keys('b'));
    assert.deepEqual(nextSelection(dropped, { kind: 'toggle', key: 'b' }, RANK), none);
    // A near miss is a different key, added, never matched.
    assert.deepEqual(nextSelection(keys('a'), { kind: 'toggle', key: 'a ' }, RANK), keys('a', 'a '));
  });

  it('toggling an issue while a relationship is selected gives that one issue', () => {
    assert.deepEqual(nextSelection({ kind: 'edge', edgeId: 'x' }, { kind: 'toggle', key: 'a' }, RANK), keys('a'));
  });

  it('ranges downward in rank order from the most recently added key, the clicked key last', () => {
    // Anchor b (rank 2), click d (rank 5): f and a lie between.
    assert.deepEqual(nextSelection(keys('c', 'b'), { kind: 'range', key: 'd' }, RANK), keys('c', 'b', 'f', 'a', 'd'));
  });

  it('ranges upward walking from the anchor, so the nearer keys are added first', () => {
    // Anchor d (rank 5), click b (rank 2): a then f, then b last.
    assert.deepEqual(nextSelection(keys('d'), { kind: 'range', key: 'b' }, RANK), keys('d', 'a', 'f', 'b'));
  });

  it('leaves keys already present in place and moves the clicked key to the end', () => {
    // a is between and already present; b is clicked and already present.
    assert.deepEqual(
      nextSelection(keys('b', 'a', 'e'), { kind: 'range', key: 'b' }, RANK),
      keys('a', 'e', 'b'),
    );
    assert.deepEqual(
      nextSelection(keys('a', 'b', 'd'), { kind: 'range', key: 'f' }, ['b', 'a', 'c', 'f', 'd']),
      keys('a', 'b', 'd', 'f'),
    );
  });

  it('acts as a replace with no issue to extend from', () => {
    assert.deepEqual(nextSelection(none, { kind: 'range', key: 'a' }, RANK), keys('a'));
    assert.deepEqual(nextSelection({ kind: 'edge', edgeId: 'x' }, { kind: 'range', key: 'a' }, RANK), keys('a'));
  });

  it('adds the clicked key alone when either end has no rank', () => {
    assert.deepEqual(nextSelection(keys('a', 'unranked'), { kind: 'range', key: 'b' }, RANK), keys('a', 'unranked', 'b'));
    assert.deepEqual(nextSelection(keys('a'), { kind: 'range', key: 'footer' }, RANK), keys('a', 'footer'));
  });

  it('keeps no issue key for a relationship, and clears to none', () => {
    assert.deepEqual(nextSelection(keys('a', 'b'), { kind: 'edge', edgeId: 'x' }, RANK), { kind: 'edge', edgeId: 'x' });
    assert.deepEqual(nextSelection(keys('a', 'b'), { kind: 'clear' }, RANK), none);
  });

  it('limits a set to its most recently added issue', () => {
    assert.deepEqual(nextSelection(keys('c', 'a', 'b'), { kind: 'limit-to-one' }, RANK), keys('b'));
    assert.deepEqual(nextSelection(none, { kind: 'limit-to-one' }, RANK), none);
    assert.deepEqual(nextSelection({ kind: 'edge', edgeId: 'x' }, { kind: 'limit-to-one' }, RANK), { kind: 'edge', edgeId: 'x' });
  });

  it('never changes the selection it was given', () => {
    const current = keys('a', 'b');
    nextSelection(current, { kind: 'toggle', key: 'c' }, RANK);
    nextSelection(current, { kind: 'range', key: 'e' }, RANK);
    assert.deepEqual(current, keys('a', 'b'));
  });
});

describe('the stored form', () => {
  const { document } = normalizeDocument(fixtureDocument);
  const edge = edgeIdentity('blocked-by', '101', '102');

  it('stores none as null, one issue or a relationship as a string, and a set as a frozen array', () => {
    assert.equal(storedSelectionOf(none), null);
    assert.equal(storedSelectionOf(keys('101')), '101');
    assert.equal(storedSelectionOf({ kind: 'edge', edgeId: edge }), edge);
    const set = storedSelectionOf(keys('102', '101'));
    assert.deepEqual(set, ['102', '101']);
    assert.equal(Object.isFrozen(set), true);
  });

  it('never stores an empty or a one-key array', () => {
    for (const selection of [none, keys(), keys('101'), keys('101', '102'), { kind: 'edge', edgeId: edge } as const]) {
      const stored = storedSelectionOf(selection);
      if (Array.isArray(stored)) assert.ok(stored.length >= 2, `stored ${JSON.stringify(stored)}`);
    }
  });

  it('tags a stored string by the document and round-trips', () => {
    assert.deepEqual(viewerSelectionOf(document, edge), { kind: 'edge', edgeId: edge });
    assert.deepEqual(viewerSelectionOf(document, '101'), keys('101'));
    assert.deepEqual(viewerSelectionOf(document, null), none);
    assert.deepEqual(viewerSelectionOf(document, []), none);
    for (const selection of [none, keys('101'), keys('102', '101', '103'), { kind: 'edge', edgeId: edge } as const]) {
      assert.deepEqual(viewerSelectionOf(document, storedSelectionOf(selection)), selection);
    }
  });

  it('compares by value and in addition order, never by identity', () => {
    assert.equal(sameSelection(keys('a', 'b'), keys('a', 'b')), true);
    assert.equal(sameSelection(keys('a', 'b'), keys('b', 'a')), false);
    assert.equal(sameSelection(keys('a'), keys('a', 'b')), false);
    assert.equal(sameSelection(none, { kind: 'none' }), true);
    assert.equal(sameSelection({ kind: 'edge', edgeId: 'x' }, { kind: 'edge', edgeId: 'x' }), true);
    assert.equal(sameSelection({ kind: 'edge', edgeId: 'x' }, keys('x')), false);
  });
});

describe('isNarrowBox', () => {
  it('is narrow under 640, not at 640, and not for the all-zero box', () => {
    assert.equal(isNarrowBox({ width: 639, height: 400 }), true);
    assert.equal(isNarrowBox({ width: 640, height: 400 }), false);
    assert.equal(isNarrowBox({ width: 0, height: 0 }), false);
    assert.equal(isNarrowBox({ width: 0, height: 10 }), true);
  });
});
