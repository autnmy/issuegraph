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
    assert.deepEqual(keyIntent({ key: 'r' }, context({ focused: SUBJECT })), {
      kind: 'create',
      command: { kind: 'begin', source: SUBJECT },
    });
  });

  it('⏎ commits whatever the search resolved to', () => {
    assert.deepEqual(keyIntent({ key: 'Enter' }, context({ match: OBJECT })), {
      kind: 'create',
      command: { kind: 'target', ref: OBJECT },
    });
  });

  it('T opens the picker on the selected edge rather than emitting a retype', () => {
    // The discriminating assertion. A `propose` here would mean a SECOND retype
    // emitter, free to disagree with `pickerView` about what a retype is.
    const edgeId = edgeIdFor('blocked-by');
    assert.deepEqual(keyIntent({ key: 't' }, context({ selectedEdge: edgeId })), { kind: 'retype', edgeId });
  });

  it('Escape withdraws the draft, with no context needed', () => {
    assert.deepEqual(keyIntent({ key: 'Escape' }, EMPTY), {
      kind: 'create',
      command: { kind: 'cancel' },
    });
  });

  it('drives R → 1 → ⏎ end to end with no pointer step', () => {
    const steps = [
      keyIntent({ key: 'r' }, context({ focused: SUBJECT })),
      keyIntent({ key: '1' }, EMPTY),
      keyIntent({ key: 'Enter' }, context({ match: OBJECT })),
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
      assert.deepEqual(keyIntent({ key: String(index + 1) }, EMPTY), {
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
    assert.deepEqual(keyIntent({ key: String(EDGE_FIELDS.length + 1) }, EMPTY), { kind: 'none' });
    assert.deepEqual(keyIntent({ key: '0' }, EMPTY), { kind: 'none' });
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
      assert.deepEqual(keyIntent({ key: 'Backspace' }, context({ selectedEdge: edgeId })), {
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
      keyIntent({ key: 'Delete' }, context({ selectedEdge: edgeId })),
      keyIntent({ key: 'Backspace' }, context({ selectedEdge: edgeId })),
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
      assert.deepEqual(keyIntent({ key }, EMPTY), { kind: 'none' });
    });
  }

  it('leaves unbound keys entirely alone', () => {
    for (const key of ['a', 'Tab', 'ArrowDown', ' ', 'F1', '']) {
      assert.deepEqual(keyIntent({ key }, context({ focused: SUBJECT, match: OBJECT })), {
        kind: 'none',
      });
    }
  });
});

describe('a modified chord belongs to the platform, not to this map', () => {
  // The failure this prevents, concretely: a shell that forwards the event and
  // calls `preventDefault()` for any non-`none` intent would otherwise swallow
  // reload, new-tab and tab-selection — and could not recover the distinction,
  // because a bare key name has already discarded it.
  const chords = [
    { name: 'Cmd+R (reload)', press: { key: 'r', metaKey: true }, context: { focused: SUBJECT } },
    { name: 'Ctrl+R (reload)', press: { key: 'r', ctrlKey: true }, context: { focused: SUBJECT } },
    { name: 'Cmd+T (new tab)', press: { key: 't', metaKey: true }, context: {} },
    { name: 'Ctrl+T (new tab)', press: { key: 't', ctrlKey: true }, context: {} },
    { name: 'Cmd+1 (tab select)', press: { key: '1', metaKey: true }, context: {} },
    { name: 'Alt+1', press: { key: '1', altKey: true }, context: {} },
    { name: 'Cmd+Backspace', press: { key: 'Backspace', metaKey: true }, context: {} },
    { name: 'Cmd+Enter', press: { key: 'Enter', metaKey: true }, context: { match: OBJECT } },
  ] as const;

  for (const { name, press, context: over } of chords) {
    it(`leaves ${name} unbound`, () => {
      // Given a context in which the UNMODIFIED key WOULD bind — otherwise this
      // would pass for the wrong reason, on a missing subject rather than the
      // modifier.
      const withEdge = { ...context(over), selectedEdge: edgeIdFor('blocked-by') };
      assert.deepEqual(keyIntent(press, withEdge), { kind: 'none' });
      assert.notDeepEqual(keyIntent({ key: press.key }, withEdge), { kind: 'none' });
    });
  }

  it('treats an explicitly unmodified press as ordinary', () => {
    assert.deepEqual(
      keyIntent({ key: 'r', ctrlKey: false, metaKey: false, altKey: false }, context({ focused: SUBJECT })),
      keyIntent({ key: 'r' }, context({ focused: SUBJECT })),
    );
  });
});

describe('shifted and unshifted are the same key', () => {
  it('does NOT treat shift as a modifier, because §17b names its keys in capitals', () => {
    // The discriminating case: shift must fold, while ctrl/meta/alt must block.
    // A `chorded` that reached for `shiftKey` would unbind the whole design.
    //
    // Bound to a variable rather than passed as a literal — and NOT cast. A
    // `KeyboardEvent` carries `shiftKey` and every other event field, so this is
    // exactly the shape a host passes in; excess-property checking applies only
    // to direct literals, which is what makes structural typing work here.
    const shifted = { key: 'R', shiftKey: true };
    assert.deepEqual(keyIntent(shifted, context({ focused: SUBJECT })), {
      kind: 'create',
      command: { kind: 'begin', source: SUBJECT },
    });
  });

  it('reads R and r alike', () => {
    assert.deepEqual(
      keyIntent({ key: 'R' }, context({ focused: SUBJECT })),
      keyIntent({ key: 'r' }, context({ focused: SUBJECT })),
    );
  });

  it('reads T and t alike', () => {
    const selectedEdge = edgeIdFor('blocked-by');
    assert.deepEqual(
      keyIntent({ key: 'T' }, context({ selectedEdge })),
      keyIntent({ key: 't' }, context({ selectedEdge })),
    );
  });
});
