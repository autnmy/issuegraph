import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Mutation } from './mutation.ts';
import type { OrderRow } from './source.ts';
import { diffOrder } from './change.ts';
import { sameValue } from './equality.ts';

const cause: Mutation = { op: 'create', kind: 'blocked-by', from: '1', to: '2', mutationId: 'm1' };

function order(...rows: readonly (readonly [string, boolean])[]): readonly OrderRow[] {
  return rows.map(([ref, ready], rank) => ({
    ref,
    rank,
    ready,
    holdReasons: ready ? [] : [`blocked by something`],
  }));
}

test('an edit that pushes one row down reports that row, and no others', () => {
  const before = order(['1', true], ['2', true], ['3', true]);
  const after = order(['2', true], ['3', true], ['1', false]);
  const change = diffOrder(before, after, cause);

  assert.deepEqual(
    change.deltas.map((delta) => delta.ref).sort(),
    ['1', '2', '3'],
  );
  const one = change.deltas.find((delta) => delta.ref === '1');
  assert.deepEqual(one?.movement, { direction: 'down', by: 2, from: 0, to: 2 });
  assert.equal(one?.readiness, 'newly-held');
  assert.equal(change.counts.newlyHeld, 1);
  assert.equal(change.counts.moved, 3);
});

test('rows that did not change appear in no delta at all', () => {
  const before = order(['1', true], ['2', true], ['3', true]);
  const after = order(['1', true], ['3', true], ['2', false]);
  const change = diffOrder(before, after, cause);
  assert.deepEqual(
    change.deltas.map((delta) => delta.ref).sort(),
    ['2', '3'],
  );
  assert.equal(
    change.deltas.some((delta) => delta.ref === '1'),
    false,
  );
});

test('a row that becomes ready is promoted', () => {
  const before = order(['1', true], ['2', false]);
  const after = order(['1', true], ['2', true]);
  const change = diffOrder(before, after, cause);
  assert.deepEqual(change.deltas, [{ ref: '2', readiness: 'promoted' }]);
  assert.equal(change.counts.promoted, 1);
  assert.equal(change.counts.moved, 0);
});

test('rows entering and leaving the order are reported as presence', () => {
  const before = order(['1', true], ['2', true]);
  const after = order(['1', true], ['3', true]);
  const change = diffOrder(before, after, cause);
  assert.deepEqual(
    change.deltas.filter((delta) => delta.presence === 'entered').map((delta) => delta.ref),
    ['3'],
  );
  assert.deepEqual(
    change.deltas.filter((delta) => delta.presence === 'left').map((delta) => delta.ref),
    ['2'],
  );
  assert.equal(change.counts.entered, 1);
  assert.equal(change.counts.left, 1);
});

test('an edit that lands and moves nothing reports an empty change, not no change', () => {
  // "This edit changed nothing" is a finding — it is the one an owner auditing
  // an encoding most needs — so it must be reportable rather than absent.
  const rows = order(['1', true], ['2', true]);
  const change = diffOrder(rows, rows, cause);
  assert.deepEqual(change.deltas, []);
  assert.deepEqual(change.counts, { moved: 0, promoted: 0, newlyHeld: 0, entered: 0, left: 0 });
  assert.equal(change.mutation, cause);
});

test('the change carries counts, never a formatted sentence', () => {
  const change = diffOrder(order(['1', true], ['2', true]), order(['2', true], ['1', true]), cause);
  const serialised = JSON.stringify(change);
  assert.ok(!/rows moved|·|promoted\b.*\bheld/.test(serialised), serialised);
  assert.equal(typeof change.counts.moved, 'number');
});

test('an omitted delta field is absent, not present-and-undefined', () => {
  // `exactOptionalPropertyTypes` is on and a host may test `'movement' in delta`,
  // so a key that is there but empty would read as a movement of nothing.
  const change = diffOrder(order(['1', true], ['2', false]), order(['1', true], ['2', true]), cause);
  const delta = change.deltas[0];
  assert.ok(delta !== undefined);
  assert.equal('movement' in delta, false);
  assert.equal('presence' in delta, false);
});

test('an order comparison notices a rank, a readiness or a hold reason moving', () => {
  const rows = order(['1', true], ['2', false]);
  assert.ok(sameValue(rows, order(['1', true], ['2', false])));
  assert.ok(!sameValue(rows, order(['2', false], ['1', true])));
  assert.ok(!sameValue(rows, order(['1', true])));
  const reworded = rows.map((row) => (row.ready ? row : { ...row, holdReasons: ['blocked by 9'] }));
  assert.ok(!sameValue(rows, reworded));
});
