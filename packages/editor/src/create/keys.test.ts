import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS } from '@issuegraph/core';
import { makeEdge } from '@issuegraph/store';

import { type KeyboardContext, keyIntent } from './keys.ts';
import { OBJECT, SUBJECT } from '../testing/picker.ts';

const EMPTY: KeyboardContext = Object.freeze({ focused: null, match: null, selectedEdge: null });

const context = (over: Partial<KeyboardContext>): KeyboardContext => ({ ...EMPTY, ...over });

/** The id the store derives for an edge of this kind between the fixtures. */
const edgeIdFor = (kind: (typeof EDGE_FIELDS)[number]): string =>
  makeEdge(kind, SUBJECT, OBJECT).id;

describe('the loop is complete, and every step is reachable without a pointer', () => {
  it('R starts a relate from the focused issue', () => {
    assert.deepEqual(keyIntent('r', context({ focused: SUBJECT })), {
      kind: 'create',
      command: { kind: 'begin', source: SUBJECT },
    });
  });

  it('⏎ commits whatever the search resolved to', () => {
    assert.deepEqual(keyIntent('Enter', context({ match: OBJECT })), {
      kind: 'create',
      command: { kind: 'target', ref: OBJECT },
    });
  });

  it('T opens the picker on the selected edge rather than emitting a retype', () => {
    // The discriminating assertion. A `propose` here would mean a SECOND retype
    // emitter, free to disagree with `pickerView` about what a retype is.
    const edgeId = edgeIdFor('blocked-by');
    assert.deepEqual(keyIntent('t', context({ selectedEdge: edgeId })), { kind: 'retype', edgeId });
  });

  it('Escape withdraws the draft, with no context needed', () => {
    assert.deepEqual(keyIntent('Escape', EMPTY), {
      kind: 'create',
      command: { kind: 'cancel' },
    });
  });

  it('drives R → 1 → ⏎ end to end with no pointer step', () => {
    const steps = [
      keyIntent('r', context({ focused: SUBJECT })),
      keyIntent('1', EMPTY),
      keyIntent('Enter', context({ match: OBJECT })),
    ];
    assert.deepEqual(
      steps.map((step) => (step.kind === 'create' ? step.command.kind : step.kind)),
      ['begin', 'type', 'target'],
    );
  });
});

describe('the digits are the format\'s vocabulary, not a list kept here', () => {
  for (const [index, kind] of EDGE_FIELDS.entries()) {
    it(`${index + 1} selects ${kind}`, () => {
      assert.deepEqual(keyIntent(String(index + 1), EMPTY), {
        kind: 'create',
        command: { kind: 'type', edgeKind: kind },
      });
    });
  }

  it('binds exactly as many digits as the format has fields', () => {
    // The control that makes the loop above mean something: one digit PAST the
    // vocabulary is unbound. Were the table hand-written to five entries this
    // would still pass — but paired with the per-field loop it pins the table's
    // length to `EDGE_FIELDS` rather than to the number five.
    assert.deepEqual(keyIntent(String(EDGE_FIELDS.length + 1), EMPTY), { kind: 'none' });
    assert.deepEqual(keyIntent('0', EMPTY), { kind: 'none' });
  });
});

describe('⌫ deletes the selected edge, whatever kind of edge it is', () => {
  // §17b requires a `together-with` edge to be selectable and deletable, and the
  // viewer gives its connector an EDGE identity for exactly that reason. So this
  // runs every kind through the same key and asserts there is no special case:
  // a connector arrives here as an ordinary edge id.
  for (const kind of EDGE_FIELDS) {
    it(`emits one delete for a selected ${kind} edge`, () => {
      const edgeId = edgeIdFor(kind);
      assert.deepEqual(keyIntent('Backspace', context({ selectedEdge: edgeId })), {
        kind: 'propose',
        proposal: { op: 'delete', edgeId },
      });
    });
  }

  it('accepts both spellings of the delete key', () => {
    // `⌫` reports as `Backspace` on keyboards that have it and `Delete` on those
    // that do not. Binding one would make "no pointer" false on the other.
    const edgeId = edgeIdFor('together-with');
    assert.deepEqual(
      keyIntent('Delete', context({ selectedEdge: edgeId })),
      keyIntent('Backspace', context({ selectedEdge: edgeId })),
    );
  });
});

describe('a key whose subject is missing hands the key back', () => {
  const missing = [
    { key: 'r', why: 'nothing focused to relate from' },
    { key: 'Enter', why: 'the search resolved to nothing' },
    { key: 'Backspace', why: 'no edge is selected' },
    { key: 'Delete', why: 'no edge is selected' },
    { key: 't', why: 'no edge is selected' },
  ] as const;

  for (const { key, why } of missing) {
    it(`${key} is none when ${why}`, () => {
      assert.deepEqual(keyIntent(key, EMPTY), { kind: 'none' });
    });
  }

  it('leaves unbound keys entirely alone', () => {
    for (const key of ['a', 'Tab', 'ArrowDown', ' ', 'F1', '']) {
      assert.deepEqual(keyIntent(key, context({ focused: SUBJECT, match: OBJECT })), {
        kind: 'none',
      });
    }
  });
});

describe('shifted and unshifted are the same key', () => {
  it('reads R and r alike', () => {
    assert.deepEqual(
      keyIntent('R', context({ focused: SUBJECT })),
      keyIntent('r', context({ focused: SUBJECT })),
    );
  });

  it('reads T and t alike', () => {
    const selectedEdge = edgeIdFor('blocked-by');
    assert.deepEqual(
      keyIntent('T', context({ selectedEdge })),
      keyIntent('t', context({ selectedEdge })),
    );
  });
});
