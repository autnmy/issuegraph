import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GraphDocument, Mutation, WriteRecord } from '@issuegraph/store';
import { createScriptedSource, createStore, makeEdge } from '@issuegraph/store';

import { type WriteLogContext, writeLog } from './log.ts';

test('writeLog gives a refused edit between two dispatched writes no entry', async () => {
  const existing = makeEdge('blocked-by', '1', '2');
  const seed: GraphDocument = {
    issues: [
      { ref: '1', title: 'Issue 1', state: 'open' },
      { ref: '2', title: 'Issue 2', state: 'open' },
      { ref: '3', title: 'Issue 3', state: 'open' },
    ],
    edges: [existing],
  };
  const applyCreate = (document: GraphDocument, mutation: Mutation): GraphDocument =>
    mutation.op === 'create'
      ? { ...document, edges: [...document.edges, makeEdge(mutation.kind, mutation.from, mutation.to)] }
      : document;
  const source = createScriptedSource(seed, applyCreate);
  const store = createStore({
    source,
    derive: (document) => document.issues.map((issue, rank) => ({ ref: issue.ref, rank, ready: true, holdReasons: [] })),
  });
  await store.hydrate();

  const failed = store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '1' });
  await source.whenPending(failed.mutationId);
  source.settleNext({ outcome: 'rejected', reason: 'locked' });
  await failed.settled;
  // Retyping an edge to the kind it already has is refused before any dispatch.
  const refused = store.propose({ op: 'retype', edgeId: existing.id, nextKind: 'blocked-by' });
  await refused.settled;
  const pending = store.propose({ op: 'create', kind: 'duplicate-of', from: '3', to: '2' });
  await source.whenPending(pending.mutationId);

  const snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.writes.map((record) => record.state).sort(),
    ['failed', 'invalid', 'pending'],
    'the ledger does not hold one failed, one refused and one pending write',
  );

  const entries = writeLog(snapshot.writes, {
    landed: { issues: snapshot.issues, edges: snapshot.landed },
    carriers: new Map(),
    markedBy: new Map(),
    refreshFailedFor: null,
    hydrationError: null,
  });
  // The issue: "A write that was not saved stays in the log, whether or not its issue is selected, with Retry and "Discard my edit"."
  assert.equal(entries.length, 2, 'a refused edit, which was never dispatched, was listed as a write');

  source.settleNext('applied');
  await pending.settled;
});

// A LEDGER WRITTEN OUT BY HAND, because `writeLog` is pure over it: every state
// can be staged at once without driving a source through each settle.
const LANDED_EDGE = makeEdge('blocked-by', '1', '2');
const LANDED: GraphDocument = {
  issues: [
    { ref: '1', title: 'Issue 1', state: 'open' },
    { ref: '2', title: 'Issue 2', state: 'open' },
    { ref: '3', title: 'Issue 3', state: 'open' },
  ],
  edges: [LANDED_EDGE],
};

function logContext(overrides: Partial<WriteLogContext> = {}): WriteLogContext {
  return {
    landed: LANDED,
    carriers: new Map(),
    markedBy: new Map(),
    refreshFailedFor: null,
    hydrationError: null,
    ...overrides,
  };
}

function conflictRecord(mutationId: string): WriteRecord {
  return {
    mutationId,
    mutation: { op: 'create', kind: 'blocked-by', from: '3', to: '1', mutationId },
    state: 'conflict',
    upstream: LANDED,
  };
}

test('writeLog keeps a failed write whose carrier is null as a recovery entry', () => {
  const record: WriteRecord = {
    mutationId: 'm-nowhere',
    mutation: { op: 'create', kind: 'blocked-by', from: 'gone', to: 'alsogone', mutationId: 'm-nowhere' },
    state: 'failed',
    reason: 'the tracker was unreachable',
  };
  const entries = writeLog([record], logContext({ carriers: new Map([['m-nowhere', null]]) }));
  assert.deepEqual(entries, [
    {
      kind: 'failed',
      mutationId: 'm-nowhere',
      edgeId: makeEdge('blocked-by', 'gone', 'alsogone').id,
      carrier: null,
      reason: 'the tracker was unreachable',
    },
  ]);
});

test('writeLog lists pending, failed and conflicted writes in ledger order and skips a refused one', () => {
  const records: WriteRecord[] = [
    conflictRecord('m-conflict'),
    {
      mutationId: 'm-refused',
      mutation: { op: 'retype', edgeId: LANDED_EDGE.id, nextKind: 'blocked-by', mutationId: 'm-refused' },
      state: 'invalid',
      reason: { code: 'unchanged-kind', message: 'it already has that kind' },
    },
    {
      mutationId: 'm-pending',
      mutation: { op: 'create', kind: 'duplicate-of', from: '3', to: '2', mutationId: 'm-pending' },
      state: 'pending',
    },
    {
      mutationId: 'm-failed',
      mutation: { op: 'delete', edgeId: LANDED_EDGE.id, mutationId: 'm-failed' },
      state: 'failed',
      reason: 'locked',
    },
  ];
  const entries = writeLog(records, logContext({ carriers: new Map([['m-failed', '1']]) }));
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.mutationId]),
    [
      ['conflict', 'm-conflict'],
      ['pending', 'm-pending'],
      ['failed', 'm-failed'],
    ],
  );
  const pending = entries[1];
  assert.deepEqual(pending, {
    kind: 'pending',
    mutationId: 'm-pending',
    write: { op: 'create', edge: makeEdge('duplicate-of', '3', '2') },
  });
});

test('writeLog puts a failed read on the conflict whose redo pressed it, and on no other', () => {
  const entries = writeLog(
    [conflictRecord('m-pressed'), conflictRecord('m-untouched')],
    logContext({ refreshFailedFor: 'm-pressed', hydrationError: 'the tracker did not answer' }),
  );
  assert.deepEqual(
    entries.map((entry) => (entry.kind === 'conflict' ? [entry.mutationId, entry.refreshError] : null)),
    [
      ['m-pressed', 'the tracker did not answer'],
      ['m-untouched', null],
    ],
  );
});

test('writeLog names a saving delete by its raw edge id when the landed document lacks the edge', () => {
  const gone = makeEdge('blocked-by', '3', '1').id;
  const entries = writeLog(
    [
      { mutationId: 'm-gone', mutation: { op: 'delete', edgeId: gone, mutationId: 'm-gone' }, state: 'pending' },
      {
        mutationId: 'm-here',
        mutation: { op: 'delete', edgeId: LANDED_EDGE.id, mutationId: 'm-here' },
        state: 'pending',
      },
    ],
    logContext(),
  );
  assert.deepEqual(
    entries.map((entry) => (entry.kind === 'pending' ? entry.write : null)),
    [
      { op: 'delete', edge: gone },
      { op: 'delete', edge: LANDED_EDGE },
    ],
    'the delete is not named by its raw id, or the landed edge is not looked up',
  );
});
