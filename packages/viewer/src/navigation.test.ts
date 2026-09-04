import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeDocument } from './document.ts';
import { initialNavigationState, navigate, reconcile } from './navigation.ts';
import { graphScene } from './projections/graph.ts';
import { linearScene } from './projections/linear.ts';
import { treeScene } from './projections/tree.ts';
import { renderMarkup } from './element.ts';
import type { SceneOptions } from './projections/linear.ts';
import type { Scene } from './scene.ts';
import { fixtureDocument } from './testing/fixtures.ts';

const linear = (): Scene => linearScene(normalizeDocument(fixtureDocument).document);
const graph = (): Scene => graphScene(normalizeDocument(fixtureDocument).document);
const tree = (): Scene => treeScene(normalizeDocument(fixtureDocument).document);

const at = (key: string | null) => ({ focused: key, selected: null });

function buildWith(projection: Scene['projection'], options: SceneOptions): Scene {
  const document = normalizeDocument(fixtureDocument).document;
  if (projection === 'linear') return linearScene(document, options);
  if (projection === 'graph') return graphScene(document, options);
  return treeScene(document, options);
}

describe('navigate', () => {
  it('moves down and up the published order', () => {
    const scene = linear();
    const down = navigate(scene, at('102'), 'ArrowDown');

    assert.deepEqual(down.command, { kind: 'focus', key: '101' });
    assert.equal(navigate(scene, down.state, 'ArrowUp').command.kind, 'focus');
    assert.equal(navigate(scene, at('101'), 'ArrowUp').state.focused, '102');
  });

  it('stops at both ends rather than wrapping', () => {
    // The ends of the order are the ends of the work. A list that teleports to
    // the top reads as a jump, not as a boundary.
    const scene = linear();
    const last = scene.focusOrder[scene.focusOrder.length - 1] as string;

    assert.deepEqual(navigate(scene, at('102'), 'ArrowUp').command, { kind: 'none' });
    assert.deepEqual(navigate(scene, at(last), 'ArrowDown').command, { kind: 'none' });
  });

  it('starts at the first item when nothing is focused yet', () => {
    assert.deepEqual(navigate(linear(), at(null), 'ArrowDown').command, {
      kind: 'focus',
      key: '102',
    });
  });

  it('walks the graph in RANK order, not in the order boxes were laid out', () => {
    // The design's rule, made falsifiable: the layout places 104 immediately
    // after 103, and rank order skips it because a together unit is ONE station.
    const scene = graph();
    assert.deepEqual([...scene.focusOrder], ['102', '101', '103', '105', '106']);
    assert.equal(navigate(scene, at('103'), 'ArrowDown').state.focused, '105');
    assert.equal(scene.focusOrder.includes('104'), false);
  });

  it('traverses to a gutter neighbour and reports none when there is not one', () => {
    const scene = graph();
    assert.deepEqual(navigate(scene, at('105'), 'ArrowLeft').command, {
      kind: 'focus',
      key: 'other/repo#7',
    });
    assert.deepEqual(navigate(scene, at('102'), 'ArrowLeft').command, { kind: 'none' });
  });

  it('has no lateral axis in the linear or tree projections', () => {
    assert.deepEqual(navigate(linear(), at('102'), 'ArrowRight').command, { kind: 'none' });
    assert.deepEqual(navigate(tree(), at('101'), 'ArrowLeft').command, { kind: 'none' });
  });

  it('selects the focused key on Enter and on Space', () => {
    for (const key of ['Enter', ' ']) {
      const result = navigate(linear(), at('101'), key);
      assert.deepEqual(result.command, { kind: 'select', key: '101' });
      assert.equal(result.state.selected, '101');
    }
  });

  it('selects the first item when Enter arrives with nothing focused', () => {
    assert.deepEqual(navigate(linear(), at(null), 'Enter').command, { kind: 'select', key: '102' });
  });

  it('jumps to the ends on Home and End', () => {
    const scene = linear();
    assert.equal(navigate(scene, at('103'), 'Home').state.focused, '102');
    assert.equal(navigate(scene, at('103'), 'End').state.focused, '106');
    assert.deepEqual(navigate(scene, at('102'), 'Home').command, { kind: 'none' });
  });

  it('returns the state untouched for a key it does not claim', () => {
    // A host keeps every shortcut this package does not handle.
    const state = at('101');
    const result = navigate(linear(), state, 'g');

    assert.deepEqual(result.command, { kind: 'none' });
    assert.equal(result.state, state);
  });

  it('does nothing on an empty scene', () => {
    const empty = linearScene(
      normalizeDocument({ issues: [], edges: [], order: { slots: [], excluded: [] }, cycles: [] }).document,
    );
    assert.deepEqual(navigate(empty, initialNavigationState, 'ArrowDown').command, { kind: 'none' });
  });

  it('reaches a held slot, which has a position even without a rank', () => {
    assert.ok(linear().focusOrder.includes('101'));
    assert.ok(linear().focusOrder.includes('105'));
  });
});

describe('reconcile', () => {
  it('carries a selection across a projection change', () => {
    // A switch changes representation, never subject.
    const state = { focused: '103', selected: '103' };
    assert.deepEqual(reconcile(tree(), state), { focused: '103', selected: '103' });
  });

  it('names a selection the way the new projection names it', () => {
    // `104` is a together unit's partner: the linear projection draws it inside
    // `103`'s row and lists only `103`. This USED to assert the defect — it kept
    // `selected: '104'` and let focus fall to `'102'`, an unrelated issue at the
    // top of the order, and called that "reachable". It is a state no keyboard
    // can produce and no click produces either.
    // CARRYING THE SUBJECT IS EXACTLY WHAT THIS DOES. The unit is the subject;
    // `103` is this projection's name for it. Reporting the partner instead is
    // what LOST the subject, because nothing downstream could act on it.
    const next = reconcile(linear(), { focused: '104', selected: '104' });

    assert.equal(next.selected, '103');
    assert.equal(next.focused, '103');
  });

  it('still keeps a selection nothing in the new projection represents', () => {
    // The other half, and the property the test above was reaching for: `107`
    // is in the document, is not in the linear order, and no station stands in
    // for it. There is no better name to give it, so it is carried whole and
    // focus falls back — which is the original rule, still intact.
    const next = reconcile(linear(), { focused: '107', selected: '107' });

    assert.equal(next.selected, '107');
    assert.equal(next.focused, '102', 'focus did not fall back to something reachable');
  });

  it('follows the selection with focus when focus is unreachable', () => {
    const next = reconcile(linear(), { focused: 'nope', selected: '103' });
    assert.equal(next.focused, '103');
  });

  it('falls to the first item when nothing is set', () => {
    assert.deepEqual(reconcile(linear(), initialNavigationState), {
      focused: '102',
      selected: null,
    });
  });

  it('agrees with what the projection rendered a tab stop on', () => {
    // The two answers have to be the same one. `reconcile` decides what
    // `handle.state.focused` reports and the projection decides which element
    // carries `tabindex="0"`; when they diverged, a stale key rendered NO tab
    // stop while the state named a valid fallback, and the viewer could not be
    // entered from the keyboard at all.
    for (const state of [
      { focused: 'gone', selected: '103' },
      { focused: 'gone', selected: 'also-gone' },
      { focused: null, selected: '105' },
      { focused: '101', selected: '103' },
    ]) {
      for (const build of [linear, graph, tree]) {
        const scene = build();
        const reconciled = reconcile(scene, state);
        const markup = renderMarkup(
          buildWith(scene.projection, { selected: state.selected, focused: state.focused }).root,
        );
        const stops = [...markup.matchAll(/data-ig-key="([^"]+)"[^>]*tabindex="0"/g)].map(
          (match) => match[1],
        );

        assert.deepEqual(
          stops,
          reconciled.focused === null ? [] : [reconciled.focused],
          `${scene.projection}: markup and reconciled state disagree`,
        );
      }
    }
  });

  it('reports null focus for a scene with nothing in it', () => {
    const empty = linearScene(
      normalizeDocument({ issues: [], edges: [], order: { slots: [], excluded: [] }, cycles: [] }).document,
    );
    assert.deepEqual(reconcile(empty, initialNavigationState), { focused: null, selected: null });
  });
});
