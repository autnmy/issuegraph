import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type WorkspaceSelection,
  INITIAL_SELECTION,
  selectedKey,
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
