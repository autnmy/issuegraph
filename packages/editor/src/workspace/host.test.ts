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

import { edgeIdentity } from '@issuegraph/core';
import type { GraphDocument } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import { keyIntent } from '../create/keys.ts';
import { candidates } from '../testing/firstpass.ts';
import {
  type HostCommand,
  type HostEffect,
  type HostState,
  INITIAL_HOST_STATE,
  RAIL_SLACK,
  railRowAt,
  railSlackFor,
  railWindowTarget,
  editCarrier,
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
  // THE PANEL THE REFUSAL WOULD BE STATED ON, RIDING WITH THE WRITE. It is
  // decided here, once, and the shell records it against the mutation the store
  // mints — see `editCarrier`. Every create path below reaches this same value,
  // which is what makes them one emitter rather than three that agree.
  carrier: '2',
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
      { kind: 'propose', proposal: { op: 'retype', edgeId: blockedBy.id, nextKind: 'duplicate-of' }, carrier: '1' },
    ]);
    assert.equal(drive([{ kind: 'control', name: 'retype', value: 'blocked-by' }], selected).effects.length, 0);
  });

  it('flip proposes on a directed edge and does nothing on a symmetric one', () => {
    const directed = drive([{ kind: 'group', id: blockedBy.id }, { kind: 'control', name: 'flip' }]);
    assert.deepEqual(directed.effects, [
      { kind: 'propose', proposal: { op: 'flip', edgeId: blockedBy.id }, carrier: '1' },
    ]);
    const symmetric = drive([{ kind: 'group', id: serialize.id }, { kind: 'control', name: 'flip' }]);
    assert.equal(symmetric.effects.length, 0);
  });

  it('delete proposes from the button and from ⌫ alike', () => {
    const selected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    const expected: HostEffect = { kind: 'propose', proposal: { op: 'delete', edgeId: blockedBy.id }, carrier: '1' };
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

  it('deletes the edge the CONTROL names, whatever is selected', () => {
    // AE4, AND THE ONLY PLACE IT CAN BE ASSERTED. §17a puts a remove control on
    // every relationship row, and this arm read the selection and ignored the
    // target — which was sound for exactly as long as the one delete button
    // lived inside `if (edgeId !== null)`.
    //
    // TWO FAILURES, AND THIS COVERS BOTH. With an ISSUE selected there is no
    // selected edge at all, so every row's remove was a silent no-op. With
    // ANOTHER edge selected the arm proposed a delete of the selected one —
    // a control that removes a different relationship from the one it sits on,
    // which is worse than one that does nothing.
    const onIssue = drive(
      [{ kind: 'control', name: 'delete', target: serialize.id }],
      drive([{ kind: 'point', key: '1' }]).state,
    );
    assert.deepEqual(onIssue.effects, [
      { kind: 'propose', proposal: { op: 'delete', edgeId: serialize.id }, carrier: '3' },
    ]);

    const onAnotherEdge = drive(
      [{ kind: 'control', name: 'delete', target: serialize.id }],
      drive([{ kind: 'group', id: blockedBy.id }]).state,
    );
    assert.deepEqual(onAnotherEdge.effects, [
      { kind: 'propose', proposal: { op: 'delete', edgeId: serialize.id }, carrier: '3' },
    ]);
  });
});

describe('a create begins from the issue the control NAMES', () => {
  it('prefers the control\u2019s target over the raw selection', () => {
    // §17a's panel is worded from the CANONICAL subject — `inspectorView` folds
    // a together-unit member onto its slot's lead and lists the lead's
    // relationships — while this arm read `selectedKey`, the raw key. So
    // selecting a partner drew a panel headed by the lead, with a `+ add`
    // under it that began a relationship from the partner: one control
    // disagreeing with every other line of its own panel about which issue it
    // was about. The panel publishes the canonical key; the arm takes it.
    const canonical = drive(
      [{ kind: 'control', name: 'add', target: '1' }],
      drive([{ kind: 'point', key: '4' }]).state,
    );
    assert.equal(canonical.state.draft.source, '1');
    assert.deepEqual(canonical.effects, []);
  });

  it('still falls back to the selection for a control that names no subject', () => {
    // The keyboard's own create path names no target — it has only a selection
    // — so the fallback is the same one rule the `delete` arm states, not a
    // second one.
    const fallback = drive(
      [{ kind: 'control', name: 'add' }],
      drive([{ kind: 'point', key: '2' }]).state,
    );
    assert.equal(fallback.state.draft.source, '2');
    // And with nothing selected and nothing named there is no source at all,
    // so the draft stays idle rather than beginning from `undefined`.
    assert.equal(drive([{ kind: 'control', name: 'add' }]).state.draft.source, null);
  });
});

describe('an edit names the issue it is about, and the panel goes there', () => {
  // THE ONE DERIVATION. A refusal is stated on its carrier's panel, so the
  // panel has to BE the carrier's at the moment the edit goes out — rather
  // than becoming it later by a route that happens to agree. Two routes did
  // not agree, and each cost a review round: a retype whose projection hid the
  // edge the panel was filtered to, and a draft completed after the reader had
  // clicked somewhere else.

  it('reads a create\u2019s carrier off the proposal, and falls back to the far end', () => {
    assert.equal(editCarrier(document, { op: 'create', kind: 'blocked-by', from: '2', to: '3' }), '2');
    // AN UNKNOWN SOURCE STILL HAS A PANEL — the target's. `unknown-issue` is
    // exactly the refusal where one end is not in the backlog, and stating it
    // on the only end that IS beats stating it nowhere.
    assert.equal(editCarrier(document, { op: 'create', kind: 'blocked-by', from: 'nope', to: '3' }), '3');
    // AND NEITHER END KNOWN IS `null`, not a guess: there is no panel for an
    // issue this document does not hold.
    assert.equal(editCarrier(document, { op: 'create', kind: 'blocked-by', from: 'nope', to: 'gone' }), null);
  });

  it('reads an edit’s carrier off the edge, and names either end when it is gone', () => {
    assert.equal(editCarrier(document, { op: 'delete', edgeId: blockedBy.id }), '1');
    assert.equal(editCarrier(document, { op: 'retype', edgeId: serialize.id, nextKind: 'blocked-by' }), '3');
    // THE `unknown-edge` CLASS: the reader acted on a relationship a landed
    // write had already removed, so the identity is the only record of its
    // ends left — and it is read through `@issuegraph/core`, which owns the
    // encoding. A reference carrying a `#` or a `/` is escaped into the
    // identity, so a split on `|` here would answer for `1` and fail for every
    // reference the format actually admits.
    const qualified: GraphDocument = {
      issues: [{ ref: 'owner/repo#9', title: 'Qualified', state: 'open' }],
      edges: [],
    };
    const gone = edgeIdentity('blocked-by', 'owner/repo#9', 'owner/repo#8');
    assert.ok(gone.includes('owner%2Frepo%239'), gone);
    assert.equal(editCarrier(qualified, { op: 'delete', edgeId: gone }), 'owner/repo#9');
    // EITHER END ANSWERS, and the identity is not consulted about which. The
    // one issue this backlog holds is the only panel a reader could be standing
    // on, whichever end of the pair it sat on.
    const far = edgeIdentity('blocked-by', 'owner/repo#8', 'owner/repo#9');
    assert.equal(editCarrier(qualified, { op: 'delete', edgeId: far }), 'owner/repo#9');
  });

  it('cannot recover a symmetric edge’s carrier once the edge is gone', () => {
    // MECHANISM A, PINNED AS THE LIMIT IT IS — not as an answer worth having.
    // `edgeIdentity` SORTS a symmetric pair, so this relationship is declared
    // from `z` and its identity leads with `a`. Asked of a document that still
    // holds the edge, the carrier is `z`: the issue whose own block declares it
    // (§4.3), which is the panel the reader made the edit from. Asked once the
    // edge is gone, no order survives in the identity to be read, so the answer
    // is the first end this backlog lists — `a`, the other panel entirely.
    //
    // THIS IS WHY THE ANSWER IS TAKEN AT EMIT AND KEPT. A revision read the
    // identity's first segment as the declaring end and called that the
    // carrier; it produced `a` here and stated the refusal on a panel the
    // reader was not on. Ranking the segments cannot be made correct — the fact
    // is not in the string — so nothing ranks them any more, and `mount.ts`
    // records the answer while the edge is still there. Driven end to end in
    // `mount.test.ts`.
    const symmetric = makeEdge('serialize-with', 'z', 'a');
    assert.equal(symmetric.from, 'z', 'a stored edge keeps the pair as declared');
    assert.ok(symmetric.id.startsWith('serialize-with|a|'), symmetric.id);
    const issues = [
      { ref: 'a', title: 'Sorts first', state: 'open' as const },
      { ref: 'z', title: 'Declares it', state: 'open' as const },
    ];
    assert.equal(editCarrier({ issues, edges: [symmetric] }, { op: 'delete', edgeId: symmetric.id }), 'z');
    assert.equal(editCarrier({ issues, edges: [] }, { op: 'delete', edgeId: symmetric.id }), 'a');
  });

  it('returns the panel to the create\u2019s source when the reader moved it mid-draft', () => {
    // THE DIVERGENCE THIS CLOSES. `pointed` only diverts a click to the draft
    // once a KIND has been chosen, so a click at the kind step moves the
    // selection and leaves the draft's source behind. The write then goes out
    // from one issue while the panel is headed by another — and a refusal
    // about the first is stated on no panel the reader is looking at.
    const { state, effects } = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'point', key: '1' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
      { kind: 'control', name: 'target', target: '3' },
    ]);
    assert.deepEqual(effects, [CREATED], 'the write still goes out from the draft\u2019s source');
    assert.deepEqual(state.selection, { kind: 'issue', key: '2' });
  });

  it('leaves the panel where it was on the routes that already agreed', () => {
    // THE CHECK THAT THIS IS NOT A BEHAVIOUR CHANGE SMUGGLED IN BESIDE A FIX.
    // Beginning a draft already selects its source and a drop already selects
    // the node it started on, so the undiverted create paths write back the
    // selection that was already there.
    const inspector = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
      { kind: 'control', name: 'target', target: '3' },
    ]);
    assert.deepEqual(inspector.state.selection, { kind: 'issue', key: '2' });
    const canvas = drive([
      { kind: 'drag-start', key: '2' },
      { kind: 'drop', key: '3', at: { x: 0, y: 0 } },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
    ]);
    assert.deepEqual(canvas.state.selection, { kind: 'issue', key: '2' });
  });

  it('puts the panel on the carrier for every edit made on a selected edge', () => {
    // A RETYPE OR A FLIP GIVES THE EDGE A NEW IDENTITY AND THE PROJECTION HIDES
    // THE OLD ONE, so a panel still filtered to the edge resolves to nothing
    // selected and can state no reason at all. The carrier's panel is a subject
    // that exists whether the produced edge landed or is a phantom.
    const selected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    for (const command of [
      { kind: 'control' as const, name: 'retype', value: 'duplicate-of' },
      { kind: 'control' as const, name: 'flip' },
      { kind: 'control' as const, name: 'delete' },
    ]) {
      const { state, effects } = drive([command], selected);
      assert.equal(effects.length, 1, command.name);
      assert.deepEqual(state.selection, { kind: 'issue', key: '1' }, command.name);
    }
    // A CONTROL THAT PROPOSES NOTHING MOVES NOTHING — the picker refuses a
    // retype to the kind the edge already has, and the panel stays on the edge.
    assert.deepEqual(
      drive([{ kind: 'control', name: 'retype', value: 'blocked-by' }], selected).state.selection,
      { kind: 'edge', edgeId: blockedBy.id },
    );
  });

  it('deletes from a row without taking the reader off the panel the row is on', () => {
    // The remove control on a relationship row sits on its carrier's own panel
    // already, so this route writes back the selection it found.
    const onIssue = drive(
      [{ kind: 'control', name: 'delete', target: blockedBy.id }],
      drive([{ kind: 'point', key: '1' }]).state,
    );
    assert.deepEqual(onIssue.state.selection, { kind: 'issue', key: '1' });
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
  /** Nothing is hidden: the state a store with no unsettled edit is in. */
  const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

  it('drops an edge selection the document no longer carries, and keeps one it does', () => {
    const selected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    assert.equal(
      reconcileHost(selected, document, NOTHING_HIDDEN),
      selected,
      'a live selection is returned as-is',
    );
    const retyped: GraphDocument = { issues: document.issues, edges: [serialize] };
    assert.deepEqual(reconcileHost(selected, retyped, NOTHING_HIDDEN).selection, { kind: 'none' });
  });

  it('returns an edge selection the store is hiding to the edge’s carrier', () => {
    // THE LANDED DOCUMENT CANNOT SEE THIS. An unsettled retype lands nothing,
    // so the edge is still in `document` and the check above passes — while the
    // store has already hidden it and the workspace has already stopped drawing
    // it. Cleared to `none`, the panel says nothing is selected and the reason
    // the edit was refused has no subject to be drawn under; on the carrier's
    // panel, the produced edge is one of the relationships listed.
    const selected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    const reconciled = reconcileHost(selected, document, new Set([blockedBy.id]));
    assert.deepEqual(reconciled.selection, { kind: 'issue', key: blockedBy.from });
    // AND ONLY THE SELECTED ONE. Hiding some other edge is not about the panel.
    assert.equal(reconcileHost(selected, document, new Set([serialize.id])), selected);
  });

  it('clears rather than inventing a carrier the document does not list', () => {
    const selected = drive([{ kind: 'group', id: blockedBy.id }]).state;
    const orphaned: GraphDocument = {
      issues: document.issues.filter((issue) => issue.ref !== blockedBy.from),
      edges: document.edges,
    };
    assert.deepEqual(
      reconcileHost(selected, orphaned, new Set([blockedBy.id])).selection,
      { kind: 'none' },
    );
  });

  it('drops an issue selection and a draft aimed at an issue that vanished', () => {
    const drafted = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
      { kind: 'control', name: 'target-query', value: 'x' },
    ]).state;
    const without2: GraphDocument = { issues: document.issues.filter((issue) => issue.ref !== '2'), edges: [] };
    const reconciled = reconcileHost(drafted, without2, NOTHING_HIDDEN);
    assert.deepEqual(reconciled.selection, { kind: 'none' });
    assert.equal(reconciled.draft.source, null);
    assert.equal(reconciled.targetQuery, '');
    assert.equal(
      reconcileHost(drafted, document, NOTHING_HIDDEN),
      drafted,
      'nothing moved, nothing changes',
    );
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

  it('scales the slack to the window, so a small window can still advance', () => {
    assert.equal(railSlackFor(80), RAIL_SLACK);
    assert.equal(railSlackFor(21), 5);
    assert.equal(railSlackFor(3), 1);
    // A 21-row window whose reader is on its last row re-cuts forward rather
    // than back onto its own start.
    const next = railWindowTarget(20, 0, 21, 60);
    assert.ok(next !== null && next > 0, `expected a forward re-cut, got ${String(next)}`);
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

describe('railRowAt', () => {
  it('subtracts the chrome above the rows before dividing by the pitch', () => {
    // 50px pitch; 130px of legend, header and NOW list above the rows. An
    // offset still inside the chrome is row 0; the first row's own pitch
    // begins where the chrome ends.
    assert.equal(railRowAt(0, 130, 50), 0);
    assert.equal(railRowAt(129, 130, 50), 0);
    assert.equal(railRowAt(130, 130, 50), 0);
    assert.equal(railRowAt(180, 130, 50), 1);
    assert.equal(railRowAt(1130, 130, 50), 20);
    // With no chrome it is the plain division it always was.
    assert.equal(railRowAt(250, 0, 50), 5);
  });
});

describe('the first pass reaches the store only through consent', () => {
  /** Open the surface and land a scan of `count` candidates. */
  function queued(count = 3): { state: HostState; effects: HostEffect[] } {
    const opened = drive([{ kind: 'control', name: 'first-pass' }]);
    const asked = opened.effects.find((effect) => effect.kind === 'find-candidates');
    assert.ok(asked !== undefined && asked.kind === 'find-candidates', 'no scan was asked for');
    return drive(
      [{ kind: 'first-pass', command: { kind: 'candidates', scan: asked.scan, candidates: candidates(count) } }],
      opened.state,
    );
  }

  it('asks the shell for a scan, and proposes nothing on the way', () => {
    const opened = drive([{ kind: 'control', name: 'first-pass' }]);
    assert.deepEqual(opened.effects, [{ kind: 'find-candidates', scan: 1 }]);
  });

  it('proposes nothing for a queue that is merely drawn', () => {
    // §17e's consent rule, at the reducer: a candidate on screen is a question,
    // not an answer.
    assert.deepEqual(queued().effects, []);
  });

  it('proposes the candidate’s own pair on `apply`, and nothing on the others', () => {
    const { state } = queued();
    assert.deepEqual(
      drive([{ kind: 'control', name: 'first-pass-answer', value: 'apply' }], state).effects,
      [
        {
          kind: 'first-pass-apply',
          // THE CANDIDATE'S ID RIDES WITH THE WRITE. The create's own fields do
          // not identify it: two detectors may propose the same pair, and
          // `candidates.ts` keeps those two questions apart on purpose.
          candidateId: 'c0',
          proposal: { op: 'create', kind: 'blocked-by', from: '100', to: '101' },
          // AND THE CARRIER, WHICH THIS ROUTE USED TO OMIT BY BUILDING ITS OWN
          // EFFECT. `null` because the fixture's candidates name issues this
          // document does not hold, which is the honest answer — there is no
          // panel for them. The case where it is a real key is driven below.
          carrier: null,
        },
      ],
    );
    for (const value of ['reject', 'skip']) {
      assert.deepEqual(
        drive([{ kind: 'control', name: 'first-pass-answer', value }], state).effects,
        [],
        `${value} emitted something`,
      );
    }
  });

  it('puts the panel on an applied candidate’s carrier, from nothing selected', () => {
    // MECHANISM B, AT THE REDUCER. This route built its own `first-pass-apply`
    // effect and never reached the emit funnel, so the selection stayed exactly
    // where the reader left it when they opened the queue. Opened with nothing
    // selected — the ordinary case, since the entry is in the host header —
    // that is `none`, and `none` states no refusal at all: a structurally
    // refused answer closed the overlay onto a panel that could say nothing
    // about it. The panel now belongs to the create the reader consented to.
    const known = [
      { id: 'k0', kind: 'blocked-by' as const, from: '2', to: '3', evidence: [] },
      { id: 'k1', kind: 'blocked-by' as const, from: '3', to: '4', evidence: [] },
    ];
    const opened = drive([{ kind: 'control', name: 'first-pass' }]);
    assert.deepEqual(opened.state.selection, { kind: 'none' }, 'the queue opened with a selection');
    const asked = opened.effects.find((effect) => effect.kind === 'find-candidates');
    assert.ok(asked !== undefined && asked.kind === 'find-candidates');
    const queue = drive(
      [{ kind: 'first-pass', command: { kind: 'candidates', scan: asked.scan, candidates: known } }],
      opened.state,
    );
    assert.deepEqual(queue.state.selection, { kind: 'none' }, 'drawing a queue moved the panel');
    const applied = drive([{ kind: 'control', name: 'first-pass-answer', value: 'apply' }], queue.state);
    assert.deepEqual(applied.effects, [
      {
        kind: 'first-pass-apply',
        candidateId: 'k0',
        proposal: { op: 'create', kind: 'blocked-by', from: '2', to: '3' },
        carrier: '2',
      },
    ]);
    assert.deepEqual(applied.state.selection, { kind: 'issue', key: '2' });
    // A REJECTION MOVES NOTHING, which is what keeps the move a property of
    // emitting rather than of answering: only a write has a panel.
    const rejected = drive([{ kind: 'control', name: 'first-pass-answer', value: 'reject' }], queue.state);
    assert.deepEqual(rejected.state.selection, { kind: 'none' });
  });

  it('ignores an answer that is not one of the three', () => {
    const { state } = queued();
    const after = drive([{ kind: 'control', name: 'first-pass-answer', value: 'maybe' }], state);
    assert.deepEqual(after.effects, []);
    assert.deepEqual(after.state.firstPass, state.firstPass);
  });

  it('reports a withdrawal to the shell only when an `apply` was taken back', () => {
    const { state } = queued();
    const applied = drive([{ kind: 'control', name: 'first-pass-answer', value: 'apply' }], state);
    const undone = drive([{ kind: 'control', name: 'undo' }], applied.state);
    assert.deepEqual(undone.effects, [{ kind: 'first-pass-withdraw', candidateId: 'c0' }]);

    const rejected = drive([{ kind: 'control', name: 'first-pass-answer', value: 'reject' }], state);
    // A rejection dispatched nothing, so there is nothing out there to take back.
    assert.deepEqual(drive([{ kind: 'control', name: 'undo' }], rejected.state).effects, []);
  });

  it('names the answering candidate, even when two propose the same pair', () => {
    // The case a structural match on the create's fields could not tell apart.
    const twins = [
      { id: 'left', kind: 'blocked-by' as const, from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by' as const, from: '1', to: '2', evidence: [] },
    ];
    const opened = drive([{ kind: 'control', name: 'first-pass' }]);
    const asked = opened.effects.find((effect) => effect.kind === 'find-candidates');
    assert.ok(asked !== undefined && asked.kind === 'find-candidates');
    const queue = drive(
      [{ kind: 'first-pass', command: { kind: 'candidates', scan: asked.scan, candidates: twins } }],
      opened.state,
    );
    const first = drive([{ kind: 'control', name: 'first-pass-answer', value: 'apply' }], queue.state);
    const second = drive([{ kind: 'control', name: 'first-pass-answer', value: 'apply' }], first.state);
    assert.deepEqual(
      [...first.effects, ...second.effects].map((effect) =>
        effect.kind === 'first-pass-apply' ? effect.candidateId : effect.kind,
      ),
      ['left', 'right'],
    );
    // And an undo names the one it took back, not the one that looks like it.
    const undone = drive([{ kind: 'control', name: 'undo' }], second.state);
    assert.deepEqual(undone.effects, [{ kind: 'first-pass-withdraw', candidateId: 'right' }]);
  });

  it('changes nothing when a first-pass control arrives with the surface shut', () => {
    for (const name of ['first-pass-answer', 'undo', 'first-pass-close']) {
      const after = drive([{ kind: 'control', name, value: 'apply' }]);
      assert.deepEqual(after.effects, [], `${name} emitted something`);
      assert.deepEqual(after.state.firstPass, INITIAL_HOST_STATE.firstPass, name);
    }
  });

  it('leaves a live draft alone — cancelling an open is the shell’s call', () => {
    // This reducer cannot tell an open that will SCAN from one the shell is
    // about to refuse for want of a source, so it clears nothing; `mount.ts`
    // dispatches the cancel at the point it knows. Driven through the mount in
    // `mount.test.ts`, both routes and the refusal.
    const drafting = drive([
      { kind: 'point', key: '2' },
      { kind: 'control', name: 'add' },
      { kind: 'control', name: 'kind', value: 'blocked-by' },
      { kind: 'control', name: 'target-query', value: 'chang' },
    ]);
    assert.equal(drafting.state.draft.source, '2');
    const opened = drive([{ kind: 'first-pass', command: { kind: 'open' } }], drafting.state);
    assert.equal(opened.state.draft.source, '2');
    assert.equal(opened.state.targetQuery, 'chang');
  });
});
