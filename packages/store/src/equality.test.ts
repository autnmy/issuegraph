import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sameList, sameValue } from './equality.ts';
import { makeEdge } from './model.ts';
import type { WriteRecord } from './write.ts';
import { threeOpenIssues } from './testing/fixtures.ts';

test('a reference match short-circuits, and NaN equals itself', () => {
  const value = { a: 1 };
  assert.ok(sameValue(value, value));
  // A rank is a number, and a deriver producing NaN must not make every
  // snapshot differ from the last one for ever.
  assert.ok(sameValue(Number.NaN, Number.NaN));
  assert.ok(sameValue({ rank: Number.NaN }, { rank: Number.NaN }));
  // `Object.is` separates the signed zeros, so these report as different. No
  // rank is ever -0, and the cost if one were is a redundant publish.
  assert.ok(!sameValue(0, -0));
});

test('primitives, nulls and mixed shapes compare as you would expect', () => {
  assert.ok(sameValue('a', 'a'));
  assert.ok(!sameValue('a', 'b'));
  assert.ok(sameValue(null, null));
  assert.ok(!sameValue(null, {}));
  assert.ok(!sameValue({}, null));
  assert.ok(!sameValue(1, '1'));
  assert.ok(!sameValue([], {}));
  assert.ok(!sameValue({ a: 1 }, [1]));
});

test('arrays compare in order, and length is not the only test', () => {
  assert.ok(sameList([1, 2, 3], [1, 2, 3]));
  assert.ok(!sameList([1, 2, 3], [3, 2, 1]));
  assert.ok(!sameList([1, 2], [1, 2, 3]));
  assert.ok(sameList([], []));
});

test('a key present on one side only is a difference, both ways round', () => {
  // Counting one side alone would let an added key through whenever every
  // shared key happened to match.
  assert.ok(!sameValue({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!sameValue({ a: 1, b: 2 }, { a: 1 }));
  // An explicit `undefined` is a key, and a missing one is not.
  assert.ok(!sameValue({ a: undefined }, {}));
});

test('nesting is compared all the way down, not one level', () => {
  assert.ok(sameValue({ a: { b: { c: [1, { d: 2 }] } } }, { a: { b: { c: [1, { d: 2 }] } } }));
  assert.ok(!sameValue({ a: { b: { c: [1, { d: 2 }] } } }, { a: { b: { c: [1, { d: 3 }] } } }));
});

test('a structure deeper than the bound reports a difference rather than looping', () => {
  // The bound guards a value the store did not build — a row from an injected
  // deriver — and fails in the safe direction: a redundant publish, never a
  // hung process.
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  const other: Record<string, unknown> = {};
  other['self'] = other;
  assert.equal(sameValue(cyclic, other), false);
});

/**
 * The point of the whole module, as a test: a field added to one of these
 * shapes is compared without anybody remembering to add it here.
 *
 * Each case is driven by `Object.keys` of the value itself rather than by a
 * list written down, so it grows with the shape. This is what makes the class
 * gone rather than the two instances fixed — the two that shipped were a
 * projected edge whose carrier had reversed and a write record whose refusal
 * reason had changed, and both were fields nobody had listed.
 */
test('EVERY field of every reused shape participates, including ones added later', () => {
  const edge = makeEdge('serialize-with', '1', '2');
  const record: WriteRecord = {
    mutationId: 'm1',
    mutation: { op: 'delete', edgeId: edge.id, mutationId: 'm1' },
    state: 'invalid',
    reason: { code: 'unknown-edge', message: 'gone' },
  };

  const shapes: readonly { readonly what: string; readonly value: Record<string, unknown> }[] = [
    { what: 'a projected edge', value: { ...edge, states: ['invalid'], writes: ['m1'] } },
    { what: 'a write record', value: { ...record } },
    { what: 'an order row', value: { ref: '1', rank: 0, ready: true, holdReasons: [] } },
    { what: 'an issue', value: { ...threeOpenIssues().issues[0] } },
  ];

  for (const { what, value } of shapes) {
    const keys = Object.keys(value);
    assert.ok(keys.length > 0, `${what} has no fields to compare`);
    assert.ok(sameValue(value, { ...value }), `${what} should equal its own copy`);

    for (const key of keys) {
      // Perturb exactly one field, whatever it happens to be.
      const current = value[key];
      const changed = Array.isArray(current)
        ? [...current, 'extra']
        : typeof current === 'string'
          ? `${current}!`
          : typeof current === 'number'
            ? current + 1
            : typeof current === 'boolean'
              ? !current
              : { ...(current as Record<string, unknown>), perturbed: true };
      assert.ok(
        !sameValue(value, { ...value, [key]: changed }),
        `${what}: a change to "${key}" went unnoticed`,
      );
    }
  }
});
