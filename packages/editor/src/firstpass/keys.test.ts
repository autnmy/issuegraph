import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type FirstPassContext, firstPassIntent } from './keys.ts';

/** The ordinary case: the queue has the keyboard and a question on screen. */
const LIVE: FirstPassContext = Object.freeze({
  interaction: 'queue',
  hasCandidate: true,
  canUndo: true,
});

describe('the loop is reachable with no pointer', () => {
  it('maps every answer key to its decision', () => {
    // Named for the DECISION rather than the key, so a host rebinding for a
    // non-English keyboard never reaches into queue.ts.
    for (const [key, answer] of [
      ['y', 'apply'],
      ['n', 'reject'],
      ['s', 'skip'],
    ] as const) {
      assert.deepEqual(firstPassIntent({ key }, LIVE), {
        kind: 'queue',
        command: { kind: 'answer', answer },
      });
    }
  });

  it('accepts the capital spelling the design names', () => {
    // §17e writes the bindings in capitals, and `Y` is what a keyboard reports
    // when shift is held — which is why `shiftKey` is not a field on `KeyPress`
    // at all. Treating it as a modifier would unbind the very keys the design
    // specifies; folding the case is what makes one entry cover both.
    for (const key of ['Y', 'N', 'S']) {
      assert.notDeepEqual(firstPassIntent({ key }, LIVE), { kind: 'none' }, key);
    }
  });

  it('maps BOTH spellings of the delete key to undo', () => {
    // Binding one of the two would make "no pointer" false on whichever
    // hardware reported the other.
    for (const key of ['Backspace', 'Delete']) {
      assert.deepEqual(firstPassIntent({ key }, LIVE), {
        kind: 'queue',
        command: { kind: 'undo' },
      });
    }
  });

  it('leaves an unbound key alone', () => {
    for (const key of ['a', 'Enter', 'ArrowDown', 'Escape', '1']) {
      assert.deepEqual(firstPassIntent({ key }, LIVE), { kind: 'none' }, key);
    }
  });
});

describe('a press somebody else owns is handed back', () => {
  it('refuses a platform chord', () => {
    // A shell forwarding `event.key` and calling preventDefault() on any
    // non-`none` intent would otherwise hijack the platform's own shortcuts.
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      assert.deepEqual(firstPassIntent({ key: 'y', [modifier]: true }, LIVE), { kind: 'none' });
    }
  });

  it('refuses every key while an input method is composing', () => {
    // All three answers are letters, so every one of them belongs to the IME
    // mid-composition. Anyone entering CJK text hits this on the ordinary path.
    for (const key of ['y', 'n', 's', 'Backspace']) {
      assert.deepEqual(firstPassIntent({ key, isComposing: true }, LIVE), { kind: 'none' }, key);
    }
  });

  it('refuses an auto-repeat, because it is not a fresh act', () => {
    // Holding `Y` past the repeat delay is one answer to one question, not a
    // proposal per event.
    assert.deepEqual(firstPassIntent({ key: 'y', repeat: true }, LIVE), { kind: 'none' });
    assert.deepEqual(firstPassIntent({ key: 'Backspace', repeat: true }, LIVE), { kind: 'none' });
  });

  it('claims NOTHING while another control has the keyboard', () => {
    // `elsewhere` is what closes the set: a host growing a fifth widget adds no
    // code here. Asserted over every binding, so a future exemption has to
    // break this to exist.
    for (const key of ['y', 'n', 's', 'Backspace', 'Delete']) {
      assert.deepEqual(
        firstPassIntent({ key }, { ...LIVE, interaction: 'elsewhere' }),
        { kind: 'none' },
        key,
      );
    }
  });
});

describe('a key whose subject is missing resolves to none', () => {
  it('refuses an answer with no candidate on screen', () => {
    // So the host does not preventDefault() a key it did not consume.
    const finished: FirstPassContext = { ...LIVE, hasCandidate: false };
    for (const key of ['y', 'n', 's']) {
      assert.deepEqual(firstPassIntent({ key }, finished), { kind: 'none' }, key);
    }
  });

  it('still allows undo on a finished queue', () => {
    // The one asymmetry, and it is the point of separating the two flags: an
    // owner who answered the last question wrongly must be able to take it back.
    assert.deepEqual(firstPassIntent({ key: 'Backspace' }, { ...LIVE, hasCandidate: false }), {
      kind: 'queue',
      command: { kind: 'undo' },
    });
  });

  it('refuses undo with nothing answered', () => {
    assert.deepEqual(firstPassIntent({ key: 'Backspace' }, { ...LIVE, canUndo: false }), {
      kind: 'none',
    });
  });
});
