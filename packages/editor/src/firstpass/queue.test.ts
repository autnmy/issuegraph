import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { candidateAt, candidates } from '../testing/firstpass.ts';
import {
  type QueueState,
  currentCandidate,
  isAnswered,
  openQueue,
  queueProgress,
  queueReducer,
  skippedCandidates,
} from './queue.ts';
import type { Answer } from './queue.ts';

/** Drive a run of answers, returning the state and everything that was emitted. */
function drive(
  state: QueueState,
  answers: readonly Answer[],
): { readonly state: QueueState; readonly emitted: readonly unknown[] } {
  const emitted: unknown[] = [];
  let current = state;
  for (const answer of answers) {
    const result = queueReducer(current, { kind: 'answer', answer });
    if (result.proposal !== null) emitted.push(result.proposal);
    current = result.state;
  }
  return { state: current, emitted };
}

describe('consent is structural: nothing applies without an `apply`', () => {
  it('emits exactly the proposal the answered candidate stands for', () => {
    const queue = openQueue(candidates(3));
    const result = queueReducer(queue, { kind: 'answer', answer: 'apply' });
    assert.deepEqual(result.proposal, {
      op: 'create',
      kind: 'blocked-by',
      from: '100',
      to: '101',
    });
  });

  it('dispatches NOTHING across a whole queue driven to exhaustion without `apply`', () => {
    // The property §17e turns on, asserted over the whole surface rather than
    // one transition: "a wrong duplicate-of silently removes real work from the
    // order, so it always costs one keystroke of consent." A queue answered
    // entirely by reject and skip must produce no write at all.
    const { state, emitted } = drive(openQueue(candidates(6)), [
      'reject',
      'skip',
      'reject',
      'skip',
      'skip',
      'reject',
    ]);
    assert.deepEqual(emitted, []);
    assert.equal(queueProgress(state).finished, true);
  });

  it('emits one proposal per `apply` and no more', () => {
    // One act, one proposal — the contract the store's closed operation set is
    // built on. A second emission per answer would be a second undo entry and a
    // second order re-evaluation for one keystroke.
    const { emitted } = drive(openQueue(candidates(4)), ['apply', 'reject', 'apply', 'skip']);
    assert.equal(emitted.length, 2);
  });

  it('answers the candidate ON SCREEN, not the first one', () => {
    // A reducer that read `candidates[0]` instead of the cursor passes every
    // single-answer test. This is the one that separates them.
    const { emitted } = drive(openQueue(candidates(3)), ['skip', 'skip', 'apply']);
    assert.deepEqual(emitted, [{ op: 'create', kind: 'blocked-by', from: '300', to: '301' }]);
  });
});

describe('progress is bounded by candidates found, never by backlog size', () => {
  it('pins the denominator to the candidate count', () => {
    // §17e: "Progress is bounded by candidates found, not backlog size." The
    // reducer is never told how many issues exist, so the only number it could
    // report is this one — asserted anyway, because a future reader adding a
    // `total` field would have to break this to do it.
    const queue = openQueue(candidates(64));
    assert.equal(queueProgress(queue).found, 64);
    const { state } = drive(queue, ['apply', 'reject', 'skip']);
    assert.deepEqual(queueProgress(state), {
      answered: 3,
      found: 64,
      remaining: 61,
      finished: false,
    });
  });

  it('finishes when every candidate is answered, whatever the answers were', () => {
    const { state } = drive(openQueue(candidates(2)), ['skip', 'skip']);
    assert.equal(queueProgress(state).finished, true);
    assert.equal(currentCandidate(state), null);
  });

  it('reports an empty queue as finished with a denominator of zero', () => {
    // Zero of zero is honest: a host that found nothing has a denominator, not
    // a missing one. `view.ts` is what separates this from a completed pass.
    assert.deepEqual(queueProgress(openQueue([])), {
      answered: 0,
      found: 0,
      remaining: 0,
      finished: true,
    });
  });
});

describe('undo returns the question and reports what it took back', () => {
  it('steps back to the candidate that was just answered', () => {
    const { state } = drive(openQueue(candidates(3)), ['reject', 'reject']);
    const undone = queueReducer(state, { kind: 'undo' });
    assert.equal(currentCandidate(undone.state)?.id, 'c1');
    assert.equal(queueProgress(undone.state).answered, 1);
  });

  it('reports a withdrawn `apply` so the host can route it to the store', () => {
    // The queue cannot un-dispatch a write — that is the store's undo, over its
    // own mutation set. What it owes the host is the fact that a write was
    // withdrawn, and which one.
    const queue = openQueue(candidates(2));
    const applied = queueReducer(queue, { kind: 'answer', answer: 'apply' });
    const undone = queueReducer(applied.state, { kind: 'undo' });
    assert.equal(undone.withdrawn?.answer, 'apply');
    assert.equal(undone.withdrawn?.candidate.id, 'c0');
    // And it emits nothing of its own: an undo that fired a proposal would be
    // the worst possible reading of the key.
    assert.equal(undone.proposal, null);
  });

  it('hands the key back when there is nothing to undo', () => {
    const queue = openQueue(candidates(2));
    const result = queueReducer(queue, { kind: 'undo' });
    assert.deepEqual(result.state, queue);
    assert.equal(result.withdrawn, null);
  });

  it('undoes repeatedly, back to the start', () => {
    let state = drive(openQueue(candidates(3)), ['apply', 'skip', 'reject']).state;
    for (let i = 0; i < 3; i += 1) state = queueReducer(state, { kind: 'undo' }).state;
    assert.deepEqual(state, openQueue(candidates(3)));
  });
});

describe('answering a finished queue is a no-op', () => {
  it('neither wraps round nor throws', () => {
    // A key press racing the last answer is ordinary — the reader is going
    // fast, which is the design target. Wrapping would re-ask an answered
    // question; throwing would turn a fast reader into an error dialog.
    const { state } = drive(openQueue(candidates(1)), ['apply']);
    const extra = queueReducer(state, { kind: 'answer', answer: 'apply' });
    assert.deepEqual(extra.state, state);
    assert.equal(extra.proposal, null);
  });
});

describe('the reducer never mutates what it is given', () => {
  it('leaves the input state untouched', () => {
    const queue = openQueue(candidates(3));
    const before = structuredClone(queue);
    queueReducer(queue, { kind: 'answer', answer: 'apply' });
    assert.deepEqual(queue, before);
  });
});

describe('derived views of the answers', () => {
  it('reports the deferred candidates in the order they were deferred', () => {
    // Derived rather than accumulated, so an undo cannot leave it disagreeing
    // with the answers it summarises.
    const { state } = drive(openQueue(candidates(4)), ['skip', 'apply', 'skip', 'reject']);
    assert.deepEqual(
      skippedCandidates(state).map((candidate) => candidate.id),
      ['c0', 'c2'],
    );
  });

  it('drops a skip from the deferred set when it is undone', () => {
    const { state } = drive(openQueue(candidates(2)), ['skip', 'skip']);
    const undone = queueReducer(state, { kind: 'undo' }).state;
    assert.deepEqual(
      skippedCandidates(undone).map((candidate) => candidate.id),
      ['c0'],
    );
  });

  it('answers `isAnswered` by the host-minted id', () => {
    // Two candidates can legitimately propose the same pair on different
    // evidence, so identity is the host's and not derived from the pair.
    const twin = { ...candidateAt(0), id: 'other-detector' };
    const { state } = drive(openQueue([candidateAt(0), twin]), ['apply']);
    assert.equal(isAnswered(state, 'c0'), true);
    assert.equal(isAnswered(state, 'other-detector'), false);
  });
});
