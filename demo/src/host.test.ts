/**
 * The host reducer: every decision the shell makes, driven with no DOM.
 *
 * The three create paths are the load-bearing tests. §17b says they are
 * EQUIVALENT — canvas, inspector and keyboard gather the same three facts in
 * different orders and one emitter proposes — so each is driven to the same
 * proposal here, and a fourth test proves the emitter is the only one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { keyIntent } from '@issuegraph/editor';
import type { GraphDocument } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import {
  type HostCommand,
  type HostEffect,
  type HostState,
  INITIAL_HOST_STATE,
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

  it('toggles the audit filter, the theme and the canvas, refusing unknown values', () => {
    const { state } = drive([
      { kind: 'control', name: 'audit-filter' },
      { kind: 'control', name: 'theme', value: 'paper' },
      { kind: 'control', name: 'canvas', value: 'tree' },
      { kind: 'control', name: 'theme', value: 'neon' },
    ]);
    assert.equal(state.auditFiltered, true);
    assert.equal(state.theme, 'paper');
    assert.equal(state.canvas, 'tree');
  });

  it('turns retry, discard, dismiss and arm into effects and changes no state', () => {
    const { state, effects } = drive([
      { kind: 'control', name: 'retry', target: 'm1' },
      { kind: 'control', name: 'discard', target: 'm2' },
      { kind: 'control', name: 'dismiss-change' },
      { kind: 'control', name: 'arm', value: 'conflict' },
      { kind: 'control', name: 'arm', value: 'explode' },
    ]);
    assert.deepEqual(effects, [
      { kind: 'retry', mutationId: 'm1' },
      { kind: 'discard', mutationId: 'm2' },
      { kind: 'dismiss-change' },
      { kind: 'arm', outcome: 'conflict' },
    ]);
    assert.deepEqual(state, INITIAL_HOST_STATE);
  });

  it('reset keeps the theme and the canvas mode and drops everything else', () => {
    const busy = drive([
      { kind: 'control', name: 'theme', value: 'paper' },
      { kind: 'point', key: '2' },
      { kind: 'scroll', start: 40 },
    ]).state;
    const { state, effects } = drive([{ kind: 'control', name: 'reset' }], busy);
    assert.deepEqual(effects, [{ kind: 'reset' }]);
    assert.deepEqual(state, { ...INITIAL_HOST_STATE, theme: 'paper' });
  });

  it('clamps the rail window to a non-negative row offset', () => {
    assert.equal(drive([{ kind: 'scroll', start: -3 }]).state.railStart, 0);
    assert.equal(drive([{ kind: 'scroll', start: 12.9 }]).state.railStart, 12);
  });

  it('ignores a command it does not know', () => {
    assert.deepEqual(drive([{ kind: 'control', name: 'launch' }]).state, INITIAL_HOST_STATE);
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
