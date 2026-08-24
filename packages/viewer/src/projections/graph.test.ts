import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ViewerDocument, normalizeDocument } from '../document.ts';
import { renderMarkup } from '../element.ts';
import { crowdedDocument, fixtureDocument, heldTogetherDocument } from '../testing/fixtures.ts';
import { viewerStylesheet } from '../styles.ts';
import { defaultTheme, extendTheme } from '../theme.ts';
import { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET, graphScene } from './graph.ts';

function scene(input: ViewerDocument = fixtureDocument, options = {}) {
  return graphScene(normalizeDocument(input).document, options);
}

function render(input: ViewerDocument = fixtureDocument, options = {}): string {
  return renderMarkup(scene(input, options).root);
}

describe('the graph projection', () => {
  it('draws a node for every laid-out key', () => {
    const markup = render();
    for (const key of ['101', '102', '103', '104', '105', '106', '107', 'other/repo#7']) {
      assert.ok(markup.includes(`data-ig-key="${key}"`), `${key} was not drawn`);
    }
  });

  it('draws each relationship with its own dash and hue channel', () => {
    const markup = render();
    assert.match(markup, /class="ig-edge" data-edge="blocked-by"/);
    assert.match(markup, /data-edge="duplicate-of"[^>]*stroke-dasharray="1 3"/);
    assert.match(markup, /data-edge="decomposed-from"[^>]*stroke-dasharray="6 4"/);
  });

  it('separates decomposed-from and duplicate-of on their terminal markers', () => {
    // The pair whose only non-colour separator is the terminal. A marker missing
    // here silently drops the encoding from four channels to three.
    const markup = render();
    assert.match(markup, /<circle class="ig-terminal" data-edge="duplicate-of"/);
    assert.match(markup, /<path class="ig-terminal" data-edge="decomposed-from"/);
    assert.match(markup, /<path class="ig-terminal" data-edge="blocked-by"[^>]*fill="currentColor"/);
  });

  it('draws serialize-with as two parallel strokes rather than one dashed line', () => {
    const markup = render();
    const strokes = [...markup.matchAll(/class="ig-edge" data-edge="serialize-with"/g)];
    assert.equal(strokes.length, 2);
  });

  it('draws a together unit as an enclosure AND its connector', () => {
    // The one declared seam crossing: the connector has to live in this layer
    // because a click target cannot be added from outside.
    const markup = render();
    assert.match(markup, /class="ig-enclosure"[^>]*stroke-dasharray="3 3"/);
    assert.match(markup, /class="ig-connector"/);
    assert.match(markup, /aria-label="103 and 104 share one rank"/);
  });

  it('draws no arc for together-with, which orders nothing', () => {
    assert.equal(/class="ig-edge" data-edge="together-with"/.test(render()), false);
  });

  it('keeps the spine rail in rank order with its stations', () => {
    const markup = render();
    const rail = markup.slice(markup.indexOf('aria-label="work order"'));
    assert.ok(rail.indexOf('data-ig-key="102"') < rail.indexOf('data-ig-key="101"'));
    assert.match(rail, /data-fill="filled"/);
    assert.match(rail, /class="ig-rank"[^>]*>—</);
  });

  it('publishes a focus order matching the linear projection, so selection survives a toggle', () => {
    assert.deepEqual([...scene().focusOrder], ['102', '101', '103', '105', '106']);
  });

  it('offers lateral neighbours from the layout columns', () => {
    const lateral = scene().lateral;
    assert.equal(lateral.get('105')?.left, 'other/repo#7');
    assert.equal(lateral.get('105')?.right, '106');
  });

  it('reaches a neighbour that only a non-lead member touches', () => {
    // A together unit is one station with one focus key, so a gutter node
    // hanging off its SECOND member would be unreachable by keyboard if the
    // lateral map read the lead's edges alone.
    const lateral = scene({
      issues: [
        { key: '1', title: 'Lead', open: true, priority: 2 },
        { key: '2', title: 'Partner', open: true, priority: 2 },
        { key: '3', title: 'Blocker', open: true, priority: 2 },
      ],
      edges: [
        { field: 'together-with', from: '1', to: '2' },
        { field: 'blocked-by', from: '2', to: '3' },
      ],
      order: {
        slots: [{ rank: 1, lead: '1', members: ['1', '2'], ready: true, holds: [] }],
        excluded: [],
      },
    }).lateral;

    assert.equal(lateral.get('1')?.left, '3');
  });

  it('traverses to a gutter node AND back', () => {
    // A one-way mapping is not a traversal: focus went out to the gutter and the
    // opposite arrow answered `none`, so the documented path "from the spine and
    // back" only went one way.
    const lateral = scene().lateral;

    assert.equal(lateral.get('105')?.left, 'other/repo#7');
    assert.equal(lateral.get('other/repo#7')?.right, '105', 'the gutter cannot get back');
    assert.equal(lateral.get('105')?.right, '106');
    assert.equal(lateral.get('106')?.left, '105', 'the gutter cannot get back');
  });

  it('publishes nothing beyond the rail when it refuses to draw', () => {
    // A refusal replaces the WHOLE canvas, so every canvas-owned key stops
    // existing. Publishing them anyway let `reconcile` keep one and navigation
    // target it with no element behind it.
    const refused = scene(crowdedDocument(GRAPH_NODE_BUDGET + 1));

    assert.deepEqual([...refused.focusOrder], [], 'a refusal published order keys it does not draw');
    assert.deepEqual([...refused.navigable], []);
    assert.equal(refused.lateral.size, 0);
  });

  it('keeps the canvas node addressable when an enclosure shares its slot', () => {
    // The enclosure is painted BEFORE the nodes so it sits behind them, and the
    // mount index keeps the first element per key — so sharing the key sent
    // focus to a non-tabbable rect instead of the node group.
    const markup = render(heldTogetherDocument);
    const enclosureAt = markup.indexOf('class="ig-enclosure"');
    const groupAt = markup.indexOf('data-ig-key="1"');

    assert.notEqual(enclosureAt, -1);
    assert.equal(/class="ig-enclosure"[^>]*data-ig-key=/.test(markup), false);
    assert.match(markup, /class="ig-enclosure"[^>]*data-ig-group="1"/);
    assert.match(markup, /class="ig-connector"[^>]*data-ig-group="1"/);
    assert.ok(groupAt > enclosureAt);
    assert.match(markup, /data-ig-key="1"[^>]*tabindex="0"/);
  });

  it('gives every terminal marker its own hue, not the inherited text colour', () => {
    // `currentColor` on a marker resolves to the inherited COLOR, and the edge
    // path sets `stroke`. Without an explicit rule every terminal rendered in
    // body text and the fourth channel quietly collapsed.
    for (const field of ['blocked-by', 'duplicate-of', 'decomposed-from']) {
      assert.match(
        viewerStylesheet,
        new RegExp(`\\.ig-terminal\\[data-edge='${field}'\\] \\{ color: var\\(--ig-edge-${field}\\); \\}`),
      );
    }
  });

  it('takes every SVG dimension from the theme, so retheming moves the drawing', () => {
    const bigger = extendTheme(defaultTheme, {
      metrics: { '--ig-radius': 99, '--ig-terminal-length': 31, '--ig-terminal-width': 37 },
    });
    const markup = render(fixtureDocument, { theme: bigger });

    assert.match(markup, /rx="99"/);
    assert.match(markup, /d="M 0 0 L -31 -18.5 L -31 18.5 Z"/);
    assert.match(markup, /r="18.5"/);
  });

  it('makes every published navigation target focusable, exactly once', () => {
    // The rail draws only the ranked slots, so a tracker-held slot, a duplicate
    // and every gutter node exist ONLY as an SVG group. A group with no
    // `tabindex` cannot take focus, so navigating to one called `focus()` on
    // nothing and the visible tab stop vanished.
    const built = scene();
    const markup = renderMarkup(built.root);

    const focusable = new Set(
      [...markup.matchAll(/data-ig-key="([^"]+)"[^>]*tabindex="(?:0|-1)"/g)].map(
        (match) => match[1] as string,
      ),
    );
    for (const key of built.focusOrder) {
      assert.ok(focusable.has(key), `${key} is published as a target but is not focusable`);
    }
    for (const neighbours of built.lateral.values()) {
      for (const key of [neighbours.left, neighbours.right]) {
        if (key === undefined) continue;
        assert.ok(focusable.has(key), `lateral target ${key} is not focusable`);
      }
    }

    // The scene says so too: `navigable` is the membership question and leads
    // with `focusOrder`, so the first entry is the same under either.
    assert.deepEqual([...built.navigable].slice(0, built.focusOrder.length), [...built.focusOrder]);
    for (const key of built.navigable) assert.ok(focusable.has(key));
    assert.ok(built.navigable.length > built.focusOrder.length, 'no sideways-only key in the fixture');

    // Exactly one tab stop, and it is the resolved focus — a second element for
    // the same issue would be worse than none.
    const stops = [...markup.matchAll(/data-ig-key="([^"]+)"[^>]*tabindex="0"/g)];
    assert.equal(stops.length, 1);
    assert.equal(stops[0]?.[1], built.focusOrder[0]);
  });

  it('names every focusable graph node so a screen reader can announce it', () => {
    const markup = render();
    assert.match(markup, /data-ig-key="106"[^>]*aria-label="[^"]+"[^>]*tabindex=/);
  });

  it('uses plain list semantics on the spine rail too', () => {
    const markup = render();
    assert.equal(/role="listbox"/.test(markup), false);
    assert.equal(/role="option"/.test(markup), false);
    assert.match(markup, /aria-current="/);
  });

  it('renders the empty spine rather than refusing when there is nothing to draw', () => {
    // An involuntary view change reads as a bug, so zero nodes is an empty
    // canvas and never a switch to another projection.
    const markup = render({ issues: [], edges: [], order: { slots: [], excluded: [] } });
    assert.match(markup, /class="ig-empty"/);
    assert.equal(/ig-refusal/.test(markup), false);
  });

  it('draws at the node budget and refuses one node past it', () => {
    const atBudget = render(crowdedDocument(GRAPH_NODE_BUDGET));
    assert.match(atBudget, /<svg class="ig-canvas"/);
    assert.equal(/ig-refusal/.test(atBudget), false);

    const overBudget = render(crowdedDocument(GRAPH_NODE_BUDGET + 1));
    assert.match(overBudget, /class="ig-refusal"/);
    assert.match(overBudget, /class="ig-capsule"/);
    assert.equal(/<svg class="ig-canvas"/.test(overBudget), false);
  });

  it('refuses with clusters only past the second threshold', () => {
    const markup = render(crowdedDocument(CLUSTER_ONLY_BUDGET + 1));
    assert.match(markup, /showing clusters only/);
    assert.match(markup, /Search for an issue to focus its neighbourhood/);
  });

  it('offers a next move with every refusal, not just a count', () => {
    assert.match(render(crowdedDocument(GRAPH_NODE_BUDGET + 1)), /class="ig-refusal-next"/);
  });

  it('reports a refusal as a diagnostic so a host can surface it', () => {
    const refused = scene(crowdedDocument(GRAPH_NODE_BUDGET + 1));
    assert.equal(refused.diagnostics.length, 1);
    assert.match(refused.diagnostics[0] as string, /graph refused: 61 nodes/);
  });

  it('states each component size, blocking count and chain depth in a capsule', () => {
    const markup = render(crowdedDocument(GRAPH_NODE_BUDGET + 1));
    assert.match(markup, /61 issues/);
    assert.match(markup, /60 blocking/);
    assert.match(markup, /depth 60/);
  });

  it('flags a cycle in a capsule rather than hanging on it', () => {
    const cyclic: ViewerDocument = {
      issues: Array.from({ length: GRAPH_NODE_BUDGET + 1 }, (_, index) => ({
        key: String(index + 1),
        title: `Issue ${String(index + 1)}`,
        open: true,
        priority: 2,
      })),
      edges: [
        { field: 'blocked-by', from: '1', to: '2' },
        { field: 'blocked-by', from: '2', to: '3' },
        { field: 'blocked-by', from: '3', to: '1' },
        ...Array.from({ length: GRAPH_NODE_BUDGET - 2 }, (_, index) => ({
          field: 'blocked-by' as const,
          from: String(index + 3),
          to: String(index + 4),
        })),
      ],
      order: { slots: [], excluded: [] },
    };

    assert.match(render(cyclic), /<span class="ig-badge" data-edge="blocked-by">cycle<\/span>/);
  });

  it('counts isolated issues instead of drawing them', () => {
    assert.match(render(), /1 isolated issue not drawn/);
  });

  it('survives a chain far longer than any call stack would hold', () => {
    // The refusal path is reached BECAUSE the component is large, so a
    // per-node call frame is a stack overflow waiting for the exact input the
    // code exists to handle. A long `blocked-by` chain is the ordinary shape of
    // a big backlog, not a pathology.
    const markup = render(crowdedDocument(20_000));

    assert.match(markup, /showing clusters only/);
    assert.match(markup, /20000 issues/);
    assert.match(markup, /depth 19999/);
  });

  it('is deterministic — two renders of one document agree byte for byte', () => {
    assert.equal(render(), render());
  });
});
