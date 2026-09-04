/**
 * The host reducer: every decision the mount makes, driven with no DOM.
 *
 * The three create paths are the load-bearing tests. §17b says they are
 * EQUIVALENT — canvas, inspector and keyboard gather the same three facts in
 * different orders and one emitter proposes — so each is driven to the same
 * proposal here, and a fourth test proves the emitter is the only one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import { keyIntent } from '../create/keys.ts';
import {
  type HostCommand,
  type HostEffect,
  type HostState,
  INITIAL_HOST_STATE,
  RAIL_SLACK,
  railWindowTarget,
  reconcileHost,
  reduceHost,
  targetMatches,
} from './host.ts';

const document: GraphDocument = {
  issues: [
    { ref: '1', title: 'Publish the first release', state: 'open', priority: 0 },
    { ref: '2', title: 'Write the release notes', state: 'open', priority: 3 },
    { ref: '3', title: 'Cut the changelog', state: 'open', priority: 3 },
    { ref: '4', title: 'Rename the config flag', state: 'open' },
  ],
  edges: [makeEdge('blocked-by', '1', '2'), makeEdge('serialize-with', '3', '4')],
};

const blockedBy = document.edges[0];
const serialize = document.edges[1];
assert.ok(blockedBy !== undefined && serialize !== undefined);

function drive(commands: readonly HostCommand[], from: HostState = INITIAL_HOST_STATE) {
  let state = from;
  const effects: HostEffect[] = [];
  for (const command of commands) {
    const result = reduceHost(state, command, document);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const CREATED: HostEffect = {
  kind: 'propose',
  proposal: { op: 'create', kind: 'blocked-by', from: '2', to: '3' },
};

describe('selection is one value the zones share', () => {
  it('selects an issue on a point, and toggles it off on the same point', () => {
    const once = drive([{ kind: 'point', key: '2' }]);
    assert.deepEqual(once.state.selection, { kind: 'issue', key: '2' });
    const twice = drive([{ kind: 'point', key: '2' }], once.state);
    assert.deepEqual(twice.state.selection, { kind: 'none' });
  });

  it('resolves a group mark to the edge it names, or to the slot lead it names', () => {
    assert.deepEqual(drive([{ kind: 'group', id: blockedBy.id }]).state.selection, {
      kind: 'edge',
      edgeId: blockedBy.id,
    });
    assert.deepEqual(drive([{ kind: 'group', id: '3' }]).state.selection, { kind: 'issue', key: '3' });
  });

  it('routes the inspector’s select-issue control — a hold’s holder — through the pointer path', () => {
    const { state } = drive([{ kind: 'control', name: 'select-issue', target: '3' }]);
    assert.deepEqual(state.selection, { kind: 'issue', key: '3' });
    const { effects } = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
      { kind: 'control', name: 'select-issue', target: '3' },
    ]);
    assert.deepEqual(effects, [CREATED], 'while a target is wanted, the holder IS the target');
    assert.deepEqual(drive([{ kind: 'control', name: 'select-issue' }]).state, INITIAL_HOST_STATE);
  });

  it('ignores a group mark naming neither a landed edge nor an issue — a pending edge’s mark', () => {
    // The canvas draws an edge from the moment it is proposed, so its mark
    // is clickable while the landed document does not carry it yet.
    const pending = makeEdge('blocked-by', '2', '3').id;
    assert.deepEqual(drive([{ kind: 'group', id: pending }]).state, INITIAL_HOST_STATE);
    const choosing = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
    ]).state;
    const mid = drive([{ kind: 'group', id: pending }], choosing);
    assert.equal(mid.effects.length, 0, 'the mark must not become the draft’s target');
    assert.equal(mid.state.draft.target, null);
  });

  it('clears the selection AND the draft on the inspector’s clear', () => {
    const { state } = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'clear' },
    ]);
    assert.deepEqual(state.selection, { kind: 'none' });
    assert.equal(state.draft.source, null);
  });
});

describe('the three create paths reach one proposal', () => {
  it('inspector: select → add → kind → search → target', () => {
    const { state, effects } = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
      { kind: 'control', name: 'target-query', value: 'changelog' },
      { kind: 'control', name: 'target', target: '3' },
    ]);
    assert.deepEqual(effects, [CREATED]);
    assert.equal(state.draft.source, null, 'the draft is idle again');
    assert.equal(state.targetQuery, '', 'the search is cleared');
  });

  it('keyboard: R → 1 → search → ⏎, through the package’s own key map', () => {
    const selected = drive([{ kind: 'point', key: '2' }]).state;
    const press = (key: string, match: string | null = null) =>
      keyIntent({ key }, { focused: '2', match, selectedEdge: null, interaction: 'canvas' });
    const { effects } = drive(
      [
        { kind: 'intent', intent: press('r') },
        { kind: 'intent', intent: press('1') },
        { kind: 'control', name: 'target-query', value: '3' },
        { kind: 'intent', intent: press('Enter', '3') },
      ],
      selected,
    );
    assert.deepEqual(effects, [CREATED]);
  });

  it('canvas: drag from one node, drop on another, then choose the kind at the drop point', () => {
    const dropped = drive([
      { kind: 'drag-start', key: '2' },
      { kind: 'drop', key: '3', at: { x: 40, y: 50 } },
    ]);
    assert.equal(dropped.effects.length, 0, 'a drop gathers facts; it proposes nothing yet');
    assert.deepEqual(dropped.state.drop, { x: 40, y: 50 });
    assert.equal(dropped.state.draft.source, '2');
    assert.equal(dropped.state.draft.target, '3');
    assert.deepEqual(dropped.state.selection, { kind: 'issue', key: '2' });
    const chosen = drive([{ kind: 'control', name: 'kind', value: 'blocked-by' }], dropped.state);
    assert.deepEqual(chosen.effects, [CREATED]);
    assert.equal(chosen.state.drop, null, 'the chooser is dismissed with the proposal');
  });

  it('beginning a draft selects its source, so a selected edge’s picker cannot hide it', () => {
    const edgeSelected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    const relate = keyIntent({ key: 'r' }, { focused: '2', match: null, selectedEdge: blockedBy.id, interaction: 'canvas' });
    const { state } = drive([{ kind: 'intent', intent: relate }], edgeSelected);
    assert.equal(state.draft.source, '2');
    assert.deepEqual(state.selection, { kind: 'issue', key: '2' });
  });

  it('a pointer on a row while a target is wanted IS the target', () => {
    const { effects } = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
      { kind: 'point', key: '3' },
    ]);
    assert.deepEqual(effects, [CREATED]);
  });

  it('a drop on the source, or on nothing, gathers nothing', () => {
    for (const key of ['2', null]) {
      const { state, effects } = drive([{ kind: 'drag-start', key: '2' }, { kind: 'drop', key, at: { x: 0, y: 0 } }]);
      assert.equal(effects.length, 0);
      assert.equal(state.draft.source, null);
      assert.equal(state.drag, null);
    }
  });

  it('cancel and Escape both return the draft to idle without proposing', () => {
    const begun = drive([{ kind: 'point', key: '2' }, { kind: 'control', name: 'add' }]).state;
    assert.equal(begun.draft.source, '2');
    assert.equal(drive([{ kind: 'control', name: 'cancel' }], begun).state.draft.source, null);
    const escape = keyIntent({ key: 'Escape' }, { focused: '2', match: null, selectedEdge: null, interaction: 'canvas' });
    const escaped = drive([{ kind: 'intent', intent: escape }], begun);
    assert.equal(escaped.state.draft.source, null);
    assert.equal(escaped.effects.length, 0);
  });

  it('Escape clears the drop point and the query along with the draft', () => {
    const mid = drive([
      { kind: 'drag-start', key: '2' },
      { kind: 'drop', key: '3', at: { x: 40, y: 50 } },
      { kind: 'control', name: 'target-query', value: 'stale' },
    ]).state;
    assert.deepEqual(mid.drop, { x: 40, y: 50 });
    const escape = keyIntent({ key: 'Escape' }, { focused: '2', match: null, selectedEdge: null, interaction: 'canvas' });
    const { state } = drive([{ kind: 'intent', intent: escape }], mid);
    assert.equal(state.drop, null);
    assert.equal(state.targetQuery, '');
    assert.equal(state.draft.source, null);
  });
});

describe('edits on a selected edge come from the picker’s own view', () => {
  it('retype proposes the picker’s option, and refuses the current kind', () => {
    const selected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    const retyped = drive([{ kind: 'control', name: 'retype', value: 'duplicate-of' }], selected);
    assert.deepEqual(retyped.effects, [
      { kind: 'propose', proposal: { op: 'retype', edgeId: blockedBy.id, nextKind: 'duplicate-of' } },
    ]);
    assert.equal(drive([{ kind: 'control', name: 'retype', value: 'blocked-by' }], selected).effects.length, 0);
  });

  it('flip proposes on a directed edge and does nothing on a symmetric one', () => {
    const directed = drive([{ kind: 'group', id: blockedBy.id }, { kind: 'control', name: 'flip' }]);
    assert.deepEqual(directed.effects, [{ kind: 'propose', proposal: { op: 'flip', edgeId: blockedBy.id } }]);
    const symmetric = drive([{ kind: 'group', id: serialize.id }, { kind: 'control', name: 'flip' }]);
    assert.equal(symmetric.effects.length, 0);
  });

  it('delete proposes from the button and from ⌫ alike', () => {
    const selected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    const expected: HostEffect = { kind: 'propose', proposal: { op: 'delete', edgeId: blockedBy.id } };
    assert.deepEqual(drive([{ kind: 'control', name: 'delete' }], selected).effects, [expected]);
    const backspace = keyIntent(
      { key: 'Backspace' },
      { focused: null, match: null, selectedEdge: blockedBy.id, interaction: 'canvas' },
    );
    assert.deepEqual(drive([{ kind: 'intent', intent: backspace }], selected).effects, [expected]);
  });

  it('nothing edits when no edge is selected', () => {
    for (const name of ['retype', 'flip', 'delete']) {
      assert.equal(drive([{ kind: 'control', name, value: 'duplicate-of' }]).effects.length, 0, name);
    }
  });
});

describe('the rest of the chrome', () => {
  it('routes the ladder’s commands to the scale reducer', () => {
    const { state } = drive([
      { kind: 'control', name: 'focus', target: '1' },
      { kind: 'control', name: 'search', value: 'rel' },
      { kind: 'control', name: 'open-isolated' },
    ]);
    assert.deepEqual(state.scale, { focus: '1', query: 'rel', isolatedOpen: true });
    assert.equal(drive([{ kind: 'control', name: 'clear-focus' }], state).state.scale.focus, null);
  });

  it('toggles the audit filter', () => {
    const once = drive([{ kind: 'control', name: 'audit-filter' }]).state;
    assert.equal(once.auditFiltered, true);
    assert.equal(drive([{ kind: 'control', name: 'audit-filter' }], once).state.auditFiltered, false);
  });

  it('turns retry, discard and dismiss into effects and changes no state', () => {
    const { state, effects } = drive([
      { kind: 'control', name: 'retry', target: 'm1' },
      { kind: 'control', name: 'discard', target: 'm2' },
      { kind: 'control', name: 'dismiss-change' },
    ]);
    assert.deepEqual(effects, [
      { kind: 'retry', mutationId: 'm1' },
      { kind: 'discard', mutationId: 'm2' },
      { kind: 'dismiss-change' },
    ]);
    assert.deepEqual(state, INITIAL_HOST_STATE);
  });

  it('clamps the rail window to a non-negative row offset', () => {
    assert.equal(drive([{ kind: 'scroll', start: -3 }]).state.railStart, 0);
    assert.equal(drive([{ kind: 'scroll', start: 12.9 }]).state.railStart, 12);
  });

  it('ignores a command it does not know, so a host’s own chrome can share the attribute', () => {
    for (const name of ['launch', 'theme', 'canvas', 'reset', 'arm']) {
      assert.deepEqual(drive([{ kind: 'control', name, value: 'paper' }]).state, INITIAL_HOST_STATE, name);
    }
  });
});

describe('targetMatches searches by reference and title, never offering the source', () => {
  it('matches case-insensitively on either field', () => {
    assert.deepEqual(targetMatches(document.issues, 'CHANGE', '2').map((each) => each.ref), ['3']);
    assert.deepEqual(targetMatches(document.issues, '4', '2').map((each) => each.ref), ['4']);
  });

  it('never returns the source, and returns nothing for an empty query', () => {
    assert.ok(!targetMatches(document.issues, 'release', '2').some((each) => each.ref === '2'));
    assert.deepEqual(targetMatches(document.issues, '   ', '2'), []);
  });

  it('bounds the list', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      ref: String(100 + index),
      title: 'Same title',
      state: 'open' as const,
    }));
    assert.equal(targetMatches(many, 'same', null, 5).length, 5);
  });
});

describe('reconcileHost agrees with a document that moved', () => {
  it('drops an edge selection the document no longer carries, and keeps one it does', () => {
    const selected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    assert.equal(reconcileHost(selected, document), selected, 'a live selection is returned as-is');
    const retyped: GraphDocument = { issues: document.issues, edges: [serialize] };
    assert.deepEqual(reconcileHost(selected, retyped).selection, { kind: 'none' });
  });

  it('drops an issue selection and a draft aimed at an issue that vanished', () => {
    const drafted = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
      { kind: 'control', name: 'target-query', value: 'x' },
    ]).state;
    const without2: GraphDocument = { issues: document.issues.filter((issue) => issue.ref !== '2'), edges: [] };
    const reconciled = reconcileHost(drafted, without2);
    assert.deepEqual(reconciled.selection, { kind: 'none' });
    assert.equal(reconciled.draft.source, null);
    assert.equal(reconciled.targetQuery, '');
    assert.equal(reconcileHost(drafted, document), drafted, 'nothing moved, nothing changes');
  });
});

describe('railWindowTarget decides the rail window’s re-cut, and refuses a no-op', () => {
  it('stays put inside the window’s slack band', () => {
    assert.equal(railWindowTarget(0, 0, 80, 300), null);
    assert.equal(railWindowTarget(80 - RAIL_SLACK * 2, 0, 80, 300), null);
  });

  it('re-cuts the window RAIL_SLACK rows above the reader once they scroll past the band', () => {
    assert.equal(railWindowTarget(41, 0, 80, 300), 21);
    assert.equal(railWindowTarget(5, 40, 80, 300), 0, 'scrolling back up above the window');
  });

  it('answers null when the clamp lands on the current start — the pinned last window', () => {
    // At the end of a long order the window is pinned to its last start and
    // the reader is deep inside it; every scroll there clamps back to the same
    // start. Dispatching it would redraw, restore the offset, and scroll again.
    const lastStart = 300 - 80;
    assert.equal(railWindowTarget(290, lastStart, 80, 300), null);
    assert.equal(railWindowTarget(299, lastStart, 80, 300), null);
    assert.equal(railWindowTarget(0, 0, 80, 10), null, 'an order shorter than the window never re-cuts');
  });
});
