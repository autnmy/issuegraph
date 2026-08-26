import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { candidates } from '../testing/firstpass.ts';
import { openQueue, queueReducer } from './queue.ts';
import { firstPassView } from './view.ts';

describe('the view shows one question at a time', () => {
  it('carries the proposed relationship and its evidence', () => {
    const view = firstPassView(openQueue(candidates(3)));
    assert.equal(view.state, 'asking');
    if (view.state !== 'asking') return;
    assert.equal(view.question.subject, '100');
    assert.equal(view.question.object, '101');
    assert.equal(view.question.kind, 'blocked-by');
    assert.deepEqual(view.question.evidence, [
      { token: 'shared-path', text: 'both bodies reference file 0' },
    ]);
  });

  it('advances to the next candidate as answers are given', () => {
    const answered = queueReducer(openQueue(candidates(3)), {
      kind: 'answer',
      answer: 'skip',
    }).state;
    const view = firstPassView(answered);
    assert.equal(view.state === 'asking' && view.question.subject, '200');
  });

  it('carries progress in every state', () => {
    // An owner who just answered the last question wants to see the count they
    // answered, not a bare congratulation — so progress rides on `finished`
    // too, and honestly on `empty`.
    assert.equal(firstPassView(openQueue(candidates(2))).progress.found, 2);
    assert.equal(firstPassView(openQueue([])).progress.found, 0);
  });
});

describe('an empty queue and a completed one are different findings', () => {
  it('reports a host that found nothing as `empty`', () => {
    // §17e's two facts. Collapsing them would tell an owner whose detector is
    // misconfigured that they were done.
    assert.equal(firstPassView(openQueue([])).state, 'empty');
  });

  it('reports an exhausted queue as `finished`', () => {
    let state = openQueue(candidates(2));
    for (let i = 0; i < 2; i += 1) {
      state = queueReducer(state, { kind: 'answer', answer: 'reject' }).state;
    }
    assert.equal(firstPassView(state).state, 'finished');
  });

  it('decides `empty` by the denominator, not by the cursor', () => {
    // Both states have nothing left to answer, so a test on "is there a current
    // candidate" alone reports them identically. This is the discriminator.
    const empty = firstPassView(openQueue([]));
    assert.equal(empty.state, 'empty');
    assert.equal(empty.progress.finished, true);
  });
});

describe('the view model is a plain value', () => {
  it('copies the evidence rather than sharing the candidate set', () => {
    const queue = openQueue(candidates(1));
    const view = firstPassView(queue);
    assert.equal(view.state, 'asking');
    if (view.state !== 'asking') return;
    assert.notEqual(view.question.evidence[0], queue.candidates[0]?.evidence[0]);
    assert.deepEqual(view.question.evidence[0], queue.candidates[0]?.evidence[0]);
  });
});
