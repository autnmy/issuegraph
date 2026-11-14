import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type WorkspaceSelection,
  INITIAL_SELECTION,
  selectedKey,
  selectedKeys,
  selectionReducer,
} from './selection.ts';

describe('the workspace holds one selection, and cannot hold two', () => {
  it('replaces rather than accumulates, whichever way the reader moves', () => {
    // THE PROPERTY, not an example of it: from every starting state, every
    // command lands on a selection whose `kind` names exactly one thing. A
    // two-nullable-field shape would let `select-edge` leave a stale issue
    // selection standing beside the new edge one, and the three zones would then
    // be free to disagree about which was current.
    const states: readonly WorkspaceSelection[] = [
      INITIAL_SELECTION,
      { kind: 'issue', key: 'a' },
      { kind: 'edge', edgeId: 'blocked-by|a|b' },
    ];
    for (const state of states) {
      assert.deepEqual(selectionReducer(state, { kind: 'select-issue', key: 'z' }), {
        kind: 'issue',
        key: 'z',
      });
      assert.deepEqual(selectionReducer(state, { kind: 'select-edge', edgeId: 'e' }), {
        kind: 'edge',
        edgeId: 'e',
      });
      assert.deepEqual(selectionReducer(state, { kind: 'clear' }), INITIAL_SELECTION);
    }
  });

  it('toggles: selecting what is already selected clears it', () => {
    const onIssue = selectionReducer(INITIAL_SELECTION, { kind: 'select-issue', key: 'a' });
    assert.deepEqual(selectionReducer(onIssue, { kind: 'select-issue', key: 'a' }), INITIAL_SELECTION);

    const onEdge = selectionReducer(INITIAL_SELECTION, { kind: 'select-edge', edgeId: 'e' });
    assert.deepEqual(selectionReducer(onEdge, { kind: 'select-edge', edgeId: 'e' }), INITIAL_SELECTION);
  });

  it('does not toggle across kinds that happen to share a name', () => {
    // An edge id and an issue key are different name spaces, so an edge
    // selection whose id equals the selected key must REPLACE rather than clear.
    // A toggle written against the payload alone would clear here.
    const onIssue: WorkspaceSelection = { kind: 'issue', key: 'x' };
    assert.deepEqual(selectionReducer(onIssue, { kind: 'select-edge', edgeId: 'x' }), {
      kind: 'edge',
      edgeId: 'x',
    });
  });

  it('is pure: the same state and command twice give the same answer', () => {
    const once = selectionReducer(INITIAL_SELECTION, { kind: 'select-issue', key: 'a' });
    const twice = selectionReducer(INITIAL_SELECTION, { kind: 'select-issue', key: 'a' });
    assert.deepEqual(once, twice);
    assert.deepEqual(INITIAL_SELECTION, { kind: 'none' });
  });
});

describe('only an issue selection reaches the viewer as a selected key', () => {
  it('resolves an issue, and refuses to hand an edge id to a node lookup', () => {
    assert.equal(selectedKey({ kind: 'issue', key: 'a' }), 'a');
    // The viewer's `selected` renders `aria-current` on a NODE. An edge id sent
    // there either matches nothing — quietly — or matches an issue whose key
    // collides with it, which is worse.
    assert.equal(selectedKey({ kind: 'edge', edgeId: 'blocked-by|a|b' }), null);
    assert.equal(selectedKey(INITIAL_SELECTION), null);
  });
});

describe('reveal-issue is the directed move, and does not toggle', () => {
  it('lands on the issue even when it is the one already selected', () => {
    // THE PAIR IS THE TEST. `select-issue` on what is already selected CLEARS —
    // correct for a row click, which is ambivalent — and a control that says
    // "go and look at this finding" is not ambivalent. Under the toggle it
    // answered by emptying the panel it had sent the reader to.
    const on = { kind: 'issue', key: 'a' } as const;
    assert.deepEqual(selectionReducer(on, { kind: 'select-issue', key: 'a' }), INITIAL_SELECTION);
    assert.deepEqual(selectionReducer(on, { kind: 'reveal-issue', key: 'a' }), on);
  });

  it('replaces any other selection, exactly as select-issue does', () => {
    assert.deepEqual(selectionReducer(INITIAL_SELECTION, { kind: 'reveal-issue', key: 'b' }), {
      kind: 'issue',
      key: 'b',
    });
    assert.deepEqual(
      selectionReducer({ kind: 'issue', key: 'a' }, { kind: 'reveal-issue', key: 'b' }),
      { kind: 'issue', key: 'b' },
    );
    assert.deepEqual(
      selectionReducer({ kind: 'edge', edgeId: 'e' }, { kind: 'reveal-issue', key: 'b' }),
      { kind: 'issue', key: 'b' },
    );
  });
});

describe('a set of issues', () => {
  const ORDER = ['e', 'b', 'f', 'a', 'd', 'c'];
  const set = (...keys: string[]): WorkspaceSelection => ({ kind: 'issues', keys });

  it('starts from a plain select and adds and drops with toggle, by exact value and in addition order', () => {
    let selection = selectionReducer(INITIAL_SELECTION, { kind: 'select-issue', key: 'a' });
    assert.deepEqual(selection, { kind: 'issue', key: 'a' });
    selection = selectionReducer(selection, { kind: 'toggle-issue', key: 'c' });
    assert.deepEqual(selection, set('a', 'c'));
    selection = selectionReducer(selection, { kind: 'toggle-issue', key: 'b' });
    assert.deepEqual(selection, set('a', 'c', 'b'));
    selection = selectionReducer(selection, { kind: 'toggle-issue', key: 'a' });
    assert.deepEqual(selection, set('c', 'b'));
    selection = selectionReducer(selection, { kind: 'toggle-issue', key: 'c' });
    assert.deepEqual(selection, { kind: 'issue', key: 'b' }, 'one issue left is `issue`, never a one-key set');
    assert.deepEqual(selectionReducer(selection, { kind: 'toggle-issue', key: 'b' }), INITIAL_SELECTION);
  });

  it('ranges over the whole rank order from the most recently added issue, the clicked one last', () => {
    // Anchor b (rank 2), click d (rank 5): f and a lie between.
    assert.deepEqual(selectionReducer(set('c', 'b'), { kind: 'range-issue', key: 'd', order: ORDER }), set('c', 'b', 'f', 'a', 'd'));
    // Upward from d: a, f, then b.
    assert.deepEqual(selectionReducer({ kind: 'issue', key: 'd' }, { kind: 'range-issue', key: 'b', order: ORDER }), set('d', 'a', 'f', 'b'));
    // With no issue to extend from, a range is a replace.
    assert.deepEqual(selectionReducer(INITIAL_SELECTION, { kind: 'range-issue', key: 'b', order: ORDER }), { kind: 'issue', key: 'b' });
  });

  it('lets a relationship replace a set, and an issue toggled over a relationship start a new one', () => {
    assert.deepEqual(selectionReducer(set('a', 'b'), { kind: 'select-edge', edgeId: 'x' }), { kind: 'edge', edgeId: 'x' });
    assert.deepEqual(selectionReducer({ kind: 'edge', edgeId: 'x' }, { kind: 'toggle-issue', key: 'a' }), { kind: 'issue', key: 'a' });
  });

  it('limits a set to its most recently added issue, and clears it', () => {
    assert.deepEqual(selectionReducer(set('c', 'a', 'b'), { kind: 'limit-to-one' }), { kind: 'issue', key: 'b' });
    assert.deepEqual(selectionReducer({ kind: 'edge', edgeId: 'x' }, { kind: 'limit-to-one' }), { kind: 'edge', edgeId: 'x' });
    assert.deepEqual(selectionReducer(set('a', 'b'), { kind: 'clear' }), INITIAL_SELECTION);
  });

  it('replaces the set with the issue on a plain click on one of its members', () => {
    assert.deepEqual(selectionReducer(set('a', 'b', 'c'), { kind: 'select-issue', key: 'b' }), { kind: 'issue', key: 'b' });
  });

  it('answers selectedKey with null for a set, and selectedKeys with every member in order', () => {
    assert.equal(selectedKey(set('a', 'b')), null);
    assert.deepEqual(selectedKeys(set('a', 'b')), ['a', 'b']);
    assert.deepEqual(selectedKeys({ kind: 'issue', key: 'a' }), ['a']);
    assert.deepEqual(selectedKeys({ kind: 'edge', edgeId: 'x' }), []);
    assert.deepEqual(selectedKeys(INITIAL_SELECTION), []);
  });
});
