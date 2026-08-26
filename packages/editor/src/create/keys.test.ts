import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS } from '@issuegraph/core';
import { makeEdge } from '@issuegraph/store';

import { type KeyboardContext, keyIntent } from './keys.ts';
import { OBJECT, SUBJECT } from '../testing/picker.ts';

const EMPTY: KeyboardContext = Object.freeze({
  focused: null,
  match: null,
  selectedEdge: null,
  interaction: 'canvas',
});

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

describe('the target search owns its printable keys', () => {
  // The flow §17b specifies is `R → digit → search → ⏎`, so the search box is
  // focused for the whole middle of it. A map that claimed printable keys there
  // would eat the reader's own query — and since most issue references contain
  // a digit, that breaks the loop for nearly every target.
  const editing = (over: Partial<KeyboardContext> = {}): KeyboardContext => ({
    ...context(over),
    interaction: 'target-search',
  });

  const surrendered = [
    { key: 'r', why: 'a letter in the query' },
    { key: '1', why: 'a digit in an issue reference' },
    { key: '3', why: 'a digit in an issue reference' },
    { key: '5', why: 'a digit in an issue reference' },
    { key: 't', why: 'a letter in the query' },
    { key: 'Backspace', why: 'correcting a typo deletes a CHARACTER, not an edge' },
    { key: 'Delete', why: 'correcting a typo deletes a CHARACTER, not an edge' },
  ] as const;

  for (const { key, why } of surrendered) {
    it(`hands ${key} back while editing — ${why}`, () => {
      const ctx = editing({ focused: SUBJECT, match: OBJECT, selectedEdge: edgeIdFor('blocked-by') });
      assert.deepEqual(keyIntent({ key }, ctx), { kind: 'none' });
      // The control: the SAME key in the SAME context binds when nothing is
      // being edited. Without it this would pass on a missing subject rather
      // than on the editable focus.
      assert.notDeepEqual(keyIntent({ key }, { ...ctx, interaction: 'canvas' }), { kind: 'none' });
    });
  }

  it('still commits the target on ⏎, which is the whole point of the flow', () => {
    // The discriminating case for a per-binding flag over a blanket "silence
    // everything while editing": the search box is focused exactly when `⏎`
    // has to work.
    assert.deepEqual(keyIntent({ key: 'Enter' }, editing({ match: OBJECT })), {
      kind: 'create',
      command: { kind: 'target', ref: OBJECT },
    });
  });

  it('still withdraws on Escape while editing', () => {
    assert.deepEqual(keyIntent({ key: 'Escape' }, editing()), {
      kind: 'create',
      command: { kind: 'cancel' },
    });
  });

  it('drives the full R → digit → search → ⏎ loop across the focus change', () => {
    // `R` and the digit are pressed on the canvas; the search box then takes
    // focus and `⏎` commits. End to end, with the focus moving mid-flow.
    const steps = [
      keyIntent({ key: 'r' }, context({ focused: SUBJECT })),
      keyIntent({ key: '1' }, context({})),
      keyIntent({ key: 'Enter' }, editing({ match: OBJECT })),
    ];
    assert.deepEqual(
      steps.map((step) => (step.kind === 'create' ? step.command.kind : step.kind)),
      ['begin', 'type', 'target'],
    );
  });
});

describe('a control this package never heard of owns the keyboard entirely', () => {
  // `elsewhere` is what closed the enumeration. Four review rounds each named a
  // different owner — the platform, the target search, an input method, then an
  // unrelated editable control — because the map was answering "who ELSE might
  // own this press", which is an inventory of the host's widgets and cannot be
  // bounded from in here. This state is every one of them that is not our own
  // search box, so a fifth control needs no new code.
  const elsewhere = (over: Partial<KeyboardContext> = {}): KeyboardContext => ({
    ...context(over),
    interaction: 'elsewhere',
  });

  const everyBinding = ['r', '1', '2', '3', '4', '5', 't', 'Backspace', 'Delete', 'Enter', 'Escape'];

  for (const key of everyBinding) {
    it(`hands ${key} back`, () => {
      const ctx = elsewhere({
        focused: SUBJECT,
        match: OBJECT,
        selectedEdge: edgeIdFor('blocked-by'),
      });
      assert.deepEqual(keyIntent({ key }, ctx), { kind: 'none' });
      // The control: the same key, the same subjects, on the canvas. Without it
      // every assertion above could pass on a missing subject instead.
      assert.notDeepEqual(keyIntent({ key }, { ...ctx, interaction: 'canvas' }), { kind: 'none' });
    });
  }

  it('surrenders Escape in particular, which the target search keeps', () => {
    // The finding that produced this state. An inline title, a filter box or a
    // modal needs `Escape` to cancel ITS OWN edit — and the documented handler
    // calls `preventDefault()` on anything non-`none`, so claiming it makes the
    // control uncancellable even when no create draft exists.
    // The discriminating pair: `elsewhere` surrenders it, `target-search` does
    // not, so this cannot pass by the map having gone silent everywhere.
    assert.deepEqual(keyIntent({ key: 'Escape' }, elsewhere()), { kind: 'none' });
    assert.deepEqual(
      keyIntent({ key: 'Escape' }, { ...context({}), interaction: 'target-search' }),
      { kind: 'create', command: { kind: 'cancel' } },
    );
  });
});

describe('an input method owns ⏎ and Escape while it is composing', () => {
  // The trap this covers: the IME owns exactly the two keys that SURVIVE
  // editable focus, so `survivesEditing` can never express it — those two are
  // only reachable in a focused box, which is also the only place composition
  // happens. Anyone entering CJK text hits this on the ordinary path.
  const composing = (over: Partial<KeyboardContext> = {}): KeyboardContext => ({
    ...context(over),
    interaction: 'target-search',
  });

  const owned = [
    { key: 'Enter', why: 'confirms the IME candidate, not the target' },
    { key: 'Escape', why: 'cancels the composition, not the draft' },
  ] as const;

  for (const { key, why } of owned) {
    it(`hands ${key} back while composing — it ${why}`, () => {
      const ctx = composing({ focused: SUBJECT, match: OBJECT });
      assert.deepEqual(keyIntent({ key, isComposing: true }, ctx), { kind: 'none' });
      // The control, and it is the whole point of this suite: the SAME key in
      // the SAME context binds when nothing is composing. These two survive
      // editable focus, so without this the assertion above could pass for the
      // `target-search` reason rather than the composition one.
      assert.notDeepEqual(keyIntent({ key }, ctx), { kind: 'none' });
      assert.notDeepEqual(keyIntent({ key, isComposing: false }, ctx), { kind: 'none' });
    });
  }

  it('holds on the canvas too, not only in a focused box', () => {
    // `isComposing` is a fact about the press, so it does not depend on this
    // package's view of focus.
    assert.deepEqual(
      keyIntent({ key: 'Enter', isComposing: true }, context({ match: OBJECT })),
      { kind: 'none' },
    );
  });

  it('surrenders a composing press whatever the key', () => {
    for (const key of ['r', '1', 't', 'Backspace', 'Enter', 'Escape']) {
      assert.deepEqual(
        keyIntent({ key, isComposing: true }, composing({ focused: SUBJECT, match: OBJECT, selectedEdge: edgeIdFor('blocked-by') })),
        { kind: 'none' },
      );
    }
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
