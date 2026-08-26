import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_SCALE_STATE, type ScaleCommand, scaleReducer } from './commands.ts';

describe('the ladder reducer', () => {
  it('starts nowhere: every component, no query, the isolated list closed', () => {
    assert.deepEqual(INITIAL_SCALE_STATE, { focus: null, query: '', isolatedOpen: false });
  });

  it('applies each command to its own field and leaves the others alone', () => {
    const cases: { command: ScaleCommand; expected: Partial<typeof INITIAL_SCALE_STATE> }[] = [
      { command: { kind: 'focus', key: 'c0-1' }, expected: { focus: 'c0-1' } },
      { command: { kind: 'clear-focus' }, expected: { focus: null } },
      { command: { kind: 'search', query: 'ledger' }, expected: { query: 'ledger' } },
      { command: { kind: 'open-isolated' }, expected: { isolatedOpen: true } },
      { command: { kind: 'close-isolated' }, expected: { isolatedOpen: false } },
    ];
    // Started from a state where every field is already SET to something other
    // than the initial value, so "left the others alone" is falsifiable: from
    // the initial state a transition that wrongly reset a field would look
    // identical to one that did nothing.
    const busy = { focus: 'c9-9', query: 'existing', isolatedOpen: true };
    for (const { command, expected } of cases) {
      assert.deepEqual(scaleReducer(busy, command), { ...busy, ...expected }, command.kind);
    }
  });

  it('never mutates the state it was given', () => {
    const before = { ...INITIAL_SCALE_STATE };
    const after = scaleReducer(before, { kind: 'focus', key: 'c0-1' });
    assert.deepEqual(before, INITIAL_SCALE_STATE);
    assert.notEqual(after, before);
  });

  it('takes any member as a focus, not only a component lead', () => {
    // Search-to-focus hands back the issue the reader searched for. Requiring a
    // lead here would push component resolution onto every caller.
    assert.equal(scaleReducer(INITIAL_SCALE_STATE, { kind: 'focus', key: 'c0-7' }).focus, 'c0-7');
  });
});
