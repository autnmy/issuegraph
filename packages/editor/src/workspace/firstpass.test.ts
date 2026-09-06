/**
 * The first pass's lifecycle, driven with no DOM.
 *
 * What is proven here is the half `firstpass/queue.ts` deliberately does not
 * hold: opening, scanning, failing, closing, and what survives a close. The
 * review loop itself is already pinned beside that reducer; nothing here
 * re-tests it, and the one thing this file asserts ABOUT it is that the queue's
 * own result passes through unchanged.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { candidates } from '../testing/firstpass.ts';
import {
  type FirstPassState,
  INITIAL_FIRST_PASS,
  firstPassReducer,
  openQueueOf,
} from './firstpass.ts';

/** Open, and run the scan the reducer asked for. */
function opened(from: FirstPassState = INITIAL_FIRST_PASS, count = 3): FirstPassState {
  const started = firstPassReducer(from, { kind: 'open' });
  assert.notEqual(started.scanning, null, 'opening did not ask for a scan');
  const scan = started.scanning ?? -1;
  return firstPassReducer(started.state, { kind: 'candidates', scan, candidates: candidates(count) })
    .state;
}

/** Answer the candidate on screen. */
function answer(state: FirstPassState, given: 'apply' | 'reject' | 'skip'): FirstPassState {
  return firstPassReducer(state, { kind: 'queue', command: { kind: 'answer', answer: given } })
    .state;
}

describe('opening asks for exactly one scan', () => {
  it('reports the generation to scan under, and holds nothing else', () => {
    const result = firstPassReducer(INITIAL_FIRST_PASS, { kind: 'open' });
    assert.equal(result.state.phase.kind, 'scanning');
    assert.equal(result.scanning, 1);
    assert.equal(result.result, null);
  });

  it('does not scan again while a scan is out', () => {
    const first = firstPassReducer(INITIAL_FIRST_PASS, { kind: 'open' });
    const second = firstPassReducer(first.state, { kind: 'open' });
    assert.equal(second.scanning, null, 'a second press issued a second scan');
    assert.deepEqual(second.state, first.state);
  });

  it('does not scan again while a queue is up', () => {
    const again = firstPassReducer(opened(), { kind: 'open' });
    assert.equal(again.scanning, null);
  });
});

describe('a scan answer is admitted only by its own generation', () => {
  it('opens the queue on the answer to the current scan', () => {
    const state = opened(INITIAL_FIRST_PASS, 4);
    assert.equal(state.phase.kind, 'open');
    assert.equal(openQueueOf(state)?.candidates.length, 4);
  });

  it('drops an answer whose generation has been superseded', () => {
    // The shape this guards: open, close, open again — two scans in flight, and
    // the SLOWER one is the one taken before the reader's writes.
    const first = firstPassReducer(INITIAL_FIRST_PASS, { kind: 'open' });
    const stale = first.scanning ?? -1;
    const closed = firstPassReducer(first.state, { kind: 'close' }).state;
    const second = firstPassReducer(closed, { kind: 'open' });
    const fresh = second.scanning ?? -1;
    assert.notEqual(stale, fresh, 'the two scans shared a generation');

    const late = firstPassReducer(second.state, {
      kind: 'candidates',
      scan: stale,
      candidates: candidates(9),
    });
    assert.equal(late.state.phase.kind, 'scanning', 'the stale scan opened the queue');

    const now = firstPassReducer(late.state, {
      kind: 'candidates',
      scan: fresh,
      candidates: candidates(2),
    });
    assert.equal(openQueueOf(now.state)?.candidates.length, 2);
  });

  it('drops an answer that arrives when no scan is out', () => {
    const after = firstPassReducer(INITIAL_FIRST_PASS, {
      kind: 'candidates',
      scan: 0,
      candidates: candidates(3),
    });
    assert.equal(after.state.phase.kind, 'closed');
  });
});

describe('a failed scan is its own state, not an empty one', () => {
  it('reaches `failed`, and never reports the backlog as empty', () => {
    const started = firstPassReducer(INITIAL_FIRST_PASS, { kind: 'open' });
    const failed = firstPassReducer(started.state, {
      kind: 'scan-failed',
      scan: started.scanning ?? -1,
    });
    assert.equal(failed.state.phase.kind, 'failed');
    // The distinction the phase exists for: `empty` is a claim about the
    // backlog, and a scan that never answered licenses none.
    assert.equal(openQueueOf(failed.state), null);
  });

  it('drops a failure whose generation has been superseded', () => {
    const state = opened();
    const late = firstPassReducer(state, { kind: 'scan-failed', scan: 1 });
    assert.equal(late.state.phase.kind, 'open', 'a stale failure closed a live queue');
  });
});

describe('a queue command only reaches a queue', () => {
  it('changes nothing when the surface is shut', () => {
    const after = firstPassReducer(INITIAL_FIRST_PASS, {
      kind: 'queue',
      command: { kind: 'answer', answer: 'apply' },
    });
    assert.deepEqual(after.state, INITIAL_FIRST_PASS);
    assert.equal(after.result, null);
  });

  it('passes the queue’s own result through unchanged', () => {
    const state = opened();
    const applied = firstPassReducer(state, {
      kind: 'queue',
      command: { kind: 'answer', answer: 'apply' },
    });
    // The candidates fixture keys each pair on its index, so a wrong candidate
    // is a visible digit rather than a plausible one.
    assert.deepEqual(applied.result?.proposal, {
      op: 'create',
      kind: 'blocked-by',
      from: '100',
      to: '101',
    });
    const undone = firstPassReducer(applied.state, {
      kind: 'queue',
      command: { kind: 'undo' },
    });
    assert.equal(undone.result?.withdrawn?.answer, 'apply');
    assert.equal(undone.result?.withdrawn?.candidate.id, 'c0');
  });
});

describe('a close drops the queue and keeps the decisions', () => {
  it('re-scans rather than resuming', () => {
    const state = firstPassReducer(answer(opened(), 'skip'), { kind: 'close' });
    assert.equal(state.state.phase.kind, 'closed');
    assert.equal(openQueueOf(state.state), null);
    assert.notEqual(firstPassReducer(state.state, { kind: 'open' }).scanning, null);
  });

  it('does not re-ask a candidate the reader decided', () => {
    // §17e's queue has to have an end across sessions, and a host's scanner is
    // never told what was answered — so the filtering is this reducer's.
    let state = opened(INITIAL_FIRST_PASS, 3);
    state = answer(state, 'apply');
    state = answer(state, 'reject');
    state = firstPassReducer(state, { kind: 'close' }).state;
    assert.deepEqual([...state.decided], ['c0', 'c1']);

    const again = opened(state, 3);
    assert.deepEqual(
      openQueueOf(again)?.candidates.map((candidate) => candidate.id),
      ['c2'],
      'a decided candidate came back',
    );
  });

  it('does re-ask a candidate the reader skipped', () => {
    // `S` is "not now", and `skippedCandidates` exists because the deferred set
    // is what a second pass is built from. Filtering skips would delete that.
    let state = opened(INITIAL_FIRST_PASS, 2);
    state = answer(state, 'skip');
    state = answer(state, 'apply');
    state = firstPassReducer(state, { kind: 'close' }).state;
    assert.deepEqual([...state.decided], ['c1']);

    const again = opened(state, 2);
    assert.deepEqual(openQueueOf(again)?.candidates.map((candidate) => candidate.id), ['c0']);
  });

  it('forgets the decisions on a reset, which a close does not', () => {
    // A different scanner is a different first pass: `CandidateId` is the host's
    // and promised stable only for a queue's life, so one detector's ids say
    // nothing about another's.
    let state = opened(INITIAL_FIRST_PASS, 2);
    state = answer(state, 'reject');
    assert.deepEqual([...firstPassReducer(state, { kind: 'close' }).state.decided], ['c0']);
    assert.deepEqual([...firstPassReducer(state, { kind: 'reset' }).state.decided], []);
    assert.equal(firstPassReducer(state, { kind: 'reset' }).state.phase.kind, 'closed');
  });

  it('takes a decision back when its answer is undone', () => {
    let state = opened(INITIAL_FIRST_PASS, 2);
    state = answer(state, 'reject');
    assert.deepEqual([...state.decided], ['c0']);
    state = firstPassReducer(state, { kind: 'queue', command: { kind: 'undo' } }).state;
    assert.deepEqual([...state.decided], [], 'an undone rejection stayed decided');
  });

  it('counts the queue it actually asks, not the set it was handed', () => {
    // The denominator §17e bounds progress by is what is on screen. Filtering
    // after the queue was built would report "0 of 3" for a queue of one.
    let state = opened(INITIAL_FIRST_PASS, 3);
    state = answer(state, 'apply');
    state = firstPassReducer(state, { kind: 'close' }).state;
    assert.equal(openQueueOf(opened(state, 3))?.candidates.length, 2);
  });
});
