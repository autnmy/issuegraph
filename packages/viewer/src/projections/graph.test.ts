import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';

import { type ViewerDocument, normalizeDocument } from '../document.ts';
import { layoutGraph, measureLabel } from '../layout.ts';
import { type ElementSpec, renderMarkup } from '../element.ts';
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

/**
 * Just the drawn canvas.
 *
 * THE LEGEND DRAWS REAL EDGES NOW — the same stroke, dash and terminal the
 * canvas uses, because a legend of five outlined chips shows neither the dash
 * nor the terminal channel and the colour-blind-safety claim rests on all four.
 * So a count over the whole markup reads each sample as a drawn relationship.
 */
function canvasOf(markup: string): string {
  const start = markup.indexOf('<svg class="ig-canvas"');
  if (start === -1) return '';
  return markup.slice(start, markup.indexOf('</svg>', start) + 6);
}

// A refused graph that also carries a tracker-held FOOTER slot and an exclusion —
// the two row kinds the refusal's rail used to drop. Sized past the node budget
// so the refusal is what renders.
function refusedWithFooterAndExclusion(): ViewerDocument {
  const issues = [];
  const edges = [];
  const slots = [];
  for (let i = 0; i < 62; i += 1) {
    issues.push({ key: `n${i}`, title: `Title n${i}`, open: true, priority: 2 as const });
  }
  for (let i = 0; i < 61; i += 1) {
    edges.push({ field: 'blocked-by' as const, from: `n${i}`, to: `n${i + 1}` });
  }
  for (let i = 0; i < 60; i += 1) {
    slots.push({ lead: `n${i}`, members: [`n${i}`], rank: i + 1, ready: true, holds: [] });
  }
  slots.push({
    lead: 'n60',
    members: ['n60'],
    rank: null,
    ready: false,
    holds: [{ family: 'tracker' as const, reason: 'claimed by another run' }],
  });
  issues.push(
    { key: 'exc1', title: 'Excluded one', open: true, priority: 2 as const },
    { key: 'canon', title: 'Canonical', open: true, priority: 2 as const },
  );
  return { issues, edges, order: { slots, excluded: [{ key: 'exc1', canonical: 'canon', reason: 'duplicate-of' as const }] }, cycles: [] };
}

// A together unit written as a CHAIN — 1–2, 2–3 — which is what a pairwise walk
// over the member list happens to reproduce.
const togetherChain: ViewerDocument = {
  issues: [
    { key: '1', title: 'Lead', open: true, priority: 2 },
    { key: '2', title: 'Partner', open: true, priority: 2 },
    { key: '3', title: 'Third', open: true, priority: 2 },
  ],
  edges: [
    { field: 'together-with', from: '1', to: '2' },
    { field: 'together-with', from: '2', to: '3' },
  ],
  order: {
    slots: [{ rank: 1, lead: '1', members: ['1', '2', '3'], ready: true, holds: [] }],
    excluded: [],
  },
  cycles: [],
};

// The SAME unit written as a STAR — 2–1, 3–1. §4.3.7 makes the two equivalent,
// and only this one exposes an identity inferred from adjacency.
const togetherStar: ViewerDocument = {
  ...togetherChain,
  edges: [
    { field: 'together-with', from: '2', to: '1' },
    { field: 'together-with', from: '3', to: '1' },
  ],
};

describe('the graph projection', () => {
  it('draws a card for every laid-out key, exactly once', () => {
    // ONE KIND OF NODE. There used to be two — a rail row for a ranked slot and
    // an SVG group for everything else — and three rounds of review found the
    // same class of defect at the seam: a key published as a navigation target
    // with no focusable element behind it. A card per laid-out key cannot have
    // that seam, and the count is what proves none was drawn twice.
    const markup = renderMarkup(scene().root);
    const laidOut = layoutGraph(normalizeDocument(fixtureDocument).document, defaultTheme).nodes;

    assert.equal(
      [...markup.matchAll(/class="ig-rail-row"/g)].length,
      laidOut.size,
      'a laid-out key was drawn no card',
    );
    for (const key of laidOut.keys()) {
      const drawn = markup.match(new RegExp(`data-ig-key="${key}"`, 'g')) ?? [];
      assert.equal(drawn.length, 1, `${key} was drawn ${String(drawn.length)} times`);
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
    // ON THE CANVAS, not in the legend. The legend draws a SAMPLE of each edge
    // now — the real line at the real dash — so a count over the whole markup
    // reads the sample as a second pair of strokes.
    const strokes = [...canvasOf(render()).matchAll(/class="ig-edge" data-edge="serialize-with"/g)];
    assert.equal(strokes.length, 2);
  });
  it('draws a together unit as ONE card listing its members, not two boxes in a lasso', () => {
    // §16b draws the unit as one card with the members inside it, and the
    // frame's own vocabulary table calls the enclosure "distinct issues forming
    // one unit of work". Two boxes joined by a connector says something weaker
    // AND costs the spine a station: the unit occupied two rows of a column
    // whose vertical position IS the rank, so two boxes claimed two ranks for
    // one.
    const markup = render();
    assert.match(markup, /<div class="ig-card"[^>]*data-unit="true"/);
    assert.match(markup, /<span class="ig-unit-pill">⧉ one unit · 2 issues<\/span>/);
    assert.match(markup, /aria-label="one unit of 2 issues"/);
    assert.equal(markup.includes('class="ig-connector"'), false, 'the canvas still draws a connector');
    // The enclosure survives in ONE place: the legend's sample, which is where a
    // reader learns what the card's inner outline means.
    assert.equal(canvasOf(markup).includes('class="ig-enclosure"'), false);
    assert.match(markup, /<rect class="ig-enclosure" data-edge="together-with"/);
  });
  it('draws no arc for together-with, which orders nothing', () => {
    assert.equal(/class="ig-edge" data-edge="together-with"/.test(render()), false);
  });

  it('gives every ordinary edge the same pointer identity the connector has', () => {
    // THE INPUT HALF OF AN EDGE SELECTION. A `together-with` connector has
    // carried `edgeIdentity(...)` since it became a click target; every other
    // relationship was a bare path with no identity, so `keyAt` walked straight
    // past it — a click on a `blocked-by` line resolved to an ancestor or to
    // nothing. Four of the five relationships could not be pointed at.
    //
    // ASSERTED OVER EVERY NON-`together-with` EDGE THE DOCUMENT DECLARES rather
    // than over a chosen one, so a kind that stops carrying it cannot hide
    // behind a sibling that still does.
    //
    // ATTRIBUTES ARE READ OUT AND COMPARED AS STRINGS. `edgeIdentity` joins
    // with `|`, which is ALTERNATION in a RegExp — see `connectors` above for
    // what interpolating one into a pattern does.
    const normalized = normalizeDocument(fixtureDocument).document;
    const markup = render();
    const drawn = new Set(
      [...markup.matchAll(/<path class="ig-edge"[^>]*?data-ig-group="([^"]*)"/g)].map(
        (match) => match[1] as string,
      ),
    );

    const expected = normalized.edges
      .filter((edge) => edge.field !== 'together-with')
      .map((edge) => edgeIdentity(edge.field, edge.from, edge.to));
    assert.ok(expected.length > 0, 'the fixture declares no ordinary edge, so this proves nothing');
    for (const identity of expected) {
      assert.ok(drawn.has(identity), `no edge path publishes ${identity}`);
    }
  });

  it('gives a terminal marker the identity of the edge it caps', () => {
    // The arrowhead is part of the line a reader sees, so a click on it has to
    // name the same edge. Without this the mark at the end of a selectable line
    // resolves to nothing, and the click reads as having missed.
    const markup = render();
    const terminals = new Set(
      [...markup.matchAll(/<(?:path|circle) class="ig-terminal"[^>]*?data-ig-group="([^"]*)"/g)].map(
        (match) => match[1] as string,
      ),
    );
    assert.ok(terminals.size > 0, 'no terminal publishes an identity');

    const declared = new Set(
      normalizeDocument(fixtureDocument)
        .document.edges.map((edge) => edgeIdentity(edge.field, edge.from, edge.to)),
    );
    for (const identity of terminals) {
      assert.ok(declared.has(identity), `a terminal names ${identity}, which is no declared edge`);
    }
  });

  it('keeps an edge identity OUT of the focus index', () => {
    // `data-ig-GROUP`, never `data-ig-key`. `navigable` lists issues, so an
    // edge is not a keyboard target — and an identity in the focus index would
    // make `focus()` land on a path no browser will focus, which is the exact
    // defect the two attributes were separated to end.
    const built = scene();
    const markup = renderMarkup(built.root);
    const keys = new Set(
      [...markup.matchAll(/data-ig-key="([^"]*)"/g)].map((match) => match[1] as string),
    );
    for (const edge of normalizeDocument(fixtureDocument).document.edges) {
      const identity = edgeIdentity(edge.field, edge.from, edge.to);
      assert.equal(keys.has(identity), false, `${identity} entered the focus index`);
      assert.equal(built.navigable.includes(identity), false, `${identity} is navigable`);
    }
  });

  it('keeps the cards in rank order, with a station on the spine for each', () => {
    const markup = render();
    const rail = markup.slice(markup.indexOf('aria-label="work order"'));
    assert.ok(rail.indexOf('data-ig-key="102"') < rail.indexOf('data-ig-key="101"'));
    // THE STATION IS ON THE SPINE, NOT IN THE CARD. §16c's argument turns on
    // sequence having a channel of its own — one vertical line to read down —
    // and a rank number inside a box is not on a line.
    assert.match(markup, /<span class="ig-spine-station" data-fill="filled"[^>]*aria-label="rank 1"[^>]*>1</);
    assert.match(markup, /<span class="ig-spine-station" data-fill="dashed"[^>]*aria-label="held, no rank"[^>]*>—</);
    assert.match(markup, /--ig-station-x:[-\d.]+px;--ig-station-y:[-\d.]+px/);
    // And the line itself, spanning the stations.
    assert.match(markup, /<line class="ig-spine"/);
  });

  it('heads each column with what it is for', () => {
    // Without them the gutters read as two more piles of issues rather than as
    // the two answers the spine deliberately keeps off itself.
    const markup = render();
    assert.match(markup, /<span class="ig-column-head" data-column="left"[^>]*>Explains the order</);
    assert.match(markup, /<span class="ig-column-head" data-column="spine"[^>]*>The work order ↓</);
    assert.match(markup, /<span class="ig-column-head" data-column="right"[^>]*>Not worked</);
  });
  it('reaches every subject the linear projection does, so selection survives a toggle', () => {
    // NOT AN IDENTICAL ORDER, and the difference is the point: the graph DRAWS
    // things the list does not — a gutter card for an open blocker outside the
    // order — and a key it draws with no way to reach it by keyboard is the
    // defect three rounds of review kept re-finding. So the list's subjects are
    // a SUBSET, and the extras are the ones only this projection has.
    const graph = new Set(scene().focusOrder);
    for (const key of ['102', '101', '103', '105', '106']) {
      assert.ok(graph.has(key), `${key} is in the list's order and not in the graph's`);
    }
    assert.ok(graph.has('other/repo#7'), 'the gutter card is unreachable by keyboard');
  });
  it('carries a hold reason the rail does not draw', () => {
    // The rail draws only the non-footer slots, so a TRACKER-HELD slot is
    // filtered out of it — and the reason put on the rail row therefore never
    // reached the graph for exactly those slots, while `ViewerHold` says the
    // viewer renders it verbatim. Measured on the fixture before the fix:
    // `claimed by another run` appeared nowhere in graph markup.
    const document = normalizeDocument(fixtureDocument).document;
    const markup = renderMarkup(scene().root);

    for (const slot of document.order.slots) {
      for (const hold of slot.holds) {
        assert.ok(
          markup.includes(hold.reason),
          `${slot.lead} is held and the graph never says why: ${hold.reason}`,
        );
      }
    }
  });

  it('gives a canvas with no ordered slots a keyboard entry at all', () => {
    // Every list is empty when nothing is ordered, so the canvas rendered keyed
    // nodes a pointer could select and not one `tabindex` — no keyboard entry
    // whatsoever.
    const built = scene({
      issues: [
        { key: 'a', title: 'A', open: true, priority: 2 },
        { key: 'b', title: 'B', open: true, priority: 2 },
      ],
      edges: [{ field: 'blocked-by', from: 'a', to: 'b' }],
      order: { slots: [], excluded: [] },
      cycles: [],
    });
    const markup = renderMarkup(built.root);

    assert.deepEqual([...built.navigable].sort(), ['a', 'b']);
    assert.match(markup, /tabindex="0"/);
    for (const key of ['a', 'b']) {
      assert.ok(built.navigable.includes(key), `${key} is drawn and keyed but unreachable by keyboard`);
    }
  });

  it('leaves nothing a POINTER can name unreachable by keyboard', () => {
    // The same invariant two earlier rounds already asserted — and it missed
    // this, because both of those scanned `data-ig-key` alone. A pointer
    // resolves through EITHER attribute, so a key published only as a group was
    // invisible to them: a together unit's non-lead member carried its own
    // `data-ig-key`, and clicking it emitted a key `navigable` does not hold.
    // Measured before the fix: selection went to `104` and focus to `102` — not
    // even the unit that was clicked — because `resolveFocusKey` found neither
    // the selection nor the requested key in the order and fell back to its
    // first entry. Scanning both attributes is what makes the invariant match
    // what `keyAt` actually does.
    // OVER BOTH SURFACES, because the canvas and the refusal draw different
    // things and this class has now appeared on each of them.
    // THE INVARIANT IS ABOUT ISSUES, and saying so is the change rather than a
    // relaxation. A `together-with` connector publishes an EDGE identity, which
    // `navigable` will never hold because `navigable` lists issues — so a flat
    // "everything pointable is navigable" would forbid the connector from
    // being a hit target at all, which the design fixes as its one declared
    // layer-1 crossing. The harm the original invariant caught was focus
    // landing on an unrelated ISSUE, and that is now prevented directly:
    // `emitSelect` moves focus only for a key the document carries, pinned by
    // 'leaves focus where it was when a connector is selected' in mount.test.
    // NOTHING IS LET THROUGH UNCHECKED. A non-issue identity has to be an edge
    // THIS DOCUMENT DECLARES, reconstructed with the same function the markup
    // was built from — so a stray attribute, a typo, or an identity for an edge
    // that is not there still fails, exactly as before.
    for (const [label, input] of [
      ['the canvas', fixtureDocument],
      ['the refusal', refusedWithFooterAndExclusion()],
    ] as const) {
      const normalized = normalizeDocument(input).document;
      const built = graphScene(normalized, {});
      const markup = renderMarkup(built.root);
      const pointable = new Set(
        [...markup.matchAll(/data-ig-(?:key|group)="([^"]+)"/g)].map((match) => match[1] as string),
      );
      const declaredEdges = new Set(
        normalized.edges.map((edge) => edgeIdentity(edge.field, edge.from, edge.to)),
      );

      assert.ok(pointable.size > 0, `${label} published nothing pointable, so this proves nothing`);
      for (const key of pointable) {
        if (normalized.byKey.has(key)) {
          assert.ok(
            built.navigable.includes(key),
            `${label}: a pointer resolves to issue ${key}, which no keyboard can reach`,
          );
          continue;
        }
        assert.ok(
          declaredEdges.has(key),
          `${label}: a pointer resolves to ${key}, which is neither an issue nor an edge this document declares`,
        );
      }
    }
  });

  it('does NOT give a together unit a second station while doing so', () => {
    // The unit is ONE station with one focus key, so its non-lead members are
    // absent from the order deliberately — they are represented by their lead,
    // not unreachable. An earlier version of the fix above appended `104` and
    // split the unit, which is why the test is membership-aware rather than
    // "anything not in a list".
    const built = scene();

    assert.equal(built.focusOrder.includes('104'), false, 'the together unit was split into two stations');
    assert.ok(built.focusOrder.includes('103'), 'the unit lost the station that represents it');
  });

  it('carries a held slot’s reason, which ViewerHold says is rendered verbatim', () => {
    // The row rendered rank, station and title, so a graph reader was told THAT
    // a slot is held and never WHY — while the linear projection rendered the
    // same host-authored sentence in full. `data-held` styles the row, so the
    // holding was visible on both channels and the reason on neither.
    const built = scene();
    const markup = renderMarkup(built.root);
    const railed = normalizeDocument(fixtureDocument).document.order.slots.filter(
      (slot) => slot.holds.length > 0 && slot.rank === null && slot.lead === '101',
    );
    assert.ok(railed.length > 0, 'the fixture no longer has a railed held slot');

    for (const slot of railed) {
      for (const hold of slot.holds) {
        assert.ok(
          markup.includes(hold.reason),
          `${slot.lead} is held and the graph never says why: ${hold.reason}`,
        );
      }
    }
  });

  it('leaves a ready slot no tooltip to explain', () => {
    // The reason rides `title`, so a slot with no holds must not acquire an
    // empty one — an empty tooltip is a hover target that says nothing.
    const markup = renderMarkup(scene().root);
    assert.equal(/title=""/.test(markup), false, 'a slot with no holds got an empty tooltip');
  });

  it('draws a long title in full, wrapped, rather than fitting it to a box', () => {
    // THE ACCEPTANCE CRITERION, and the defect this pass exists to remove: an
    // SVG label neither wraps nor clips, so every title was run through a width
    // fit and came out as "Retype the ca…". An HTML card wraps, so nothing
    // truncates — by construction, not by choosing a wider box.
    const long = 'A title far longer than any column this layout will ever allocate to a node';
    const markup = renderMarkup(
      scene({
        issues: [
          { key: 'n1', title: long, open: true, priority: 2 },
          { key: 'n2', title: 'N2', open: true, priority: 2 },
        ],
        edges: [{ field: 'blocked-by', from: 'n1', to: 'n2' }],
        order: { slots: [], excluded: [] },
        cycles: [],
      }).root,
    );

    assert.match(markup, new RegExp(`<span class="ig-title">${long}</span>`));
    assert.equal(markup.includes('\u2026'), false, 'something was still truncated');
  });
  it('gives every card room for the title it draws, so nothing overlaps the next rank', () => {
    // The invariant, checked against the GEOMETRY rather than against the
    // markup: a card that reserves too little height is overlapped by the row
    // beneath it, and the row beneath it is the next rank.
    const document = normalizeDocument(fixtureDocument).document;
    const layout = layoutGraph(document, defaultTheme);
    const line = defaultTheme.metrics['--ig-card-line'];
    const inset = defaultTheme.metrics['--ig-space'];

    for (const [key, box] of layout.nodes) {
      const title = document.byKey.get(key)?.title ?? key;
      const lines = Math.max(1, Math.ceil(measureLabel(defaultTheme, title) / (box.width - inset * 2)));
      assert.ok(
        box.height >= inset * 2 + lines * line,
        `${key} has ${String(box.height)}px for ${String(lines)} lines of title`,
      );
    }

    // And no two boxes in one column overlap.
    for (const column of ['left', 'spine', 'right'] as const) {
      const stacked = [...layout.nodes.values()]
        .filter((box) => box.column === column)
        .sort((a, b) => a.y - b.y);
      for (let at = 1; at < stacked.length; at += 1) {
        const above = stacked[at - 1] as (typeof stacked)[number];
        const below = stacked[at] as (typeof stacked)[number];
        assert.ok(above.y + above.height <= below.y, `${above.key} overlaps ${below.key}`);
      }
    }
  });
  it('charges a wide glyph more than the average, measured outside the model', () => {
    // THE MODEL, NOT THE TRUNCATOR. Nothing truncates now — a card wraps — but
    // the per-character-class width model is still what gives a card its
    // height, and under-charging wide glyphs reserves too few lines and puts
    // the next rank on top of this one. Bounded by a number stated HERE: a
    // capital renders at about 0.72 of the font size, 8px at
    // `--ig-font-size-small`, against an average of 6.
    const WIDEST_GLYPH_PX = 8;
    const capitals = 'W'.repeat(40);
    assert.ok(
      measureLabel(defaultTheme, capitals) >= capitals.length * WIDEST_GLYPH_PX,
      `40 capitals measured ${String(measureLabel(defaultTheme, capitals))}px, under ${String(40 * WIDEST_GLYPH_PX)}px`,
    );
  });
  it('charges a FULL-WIDTH glyph the full font size — emoji and CJK', () => {
    // The classes are otherwise ASCII-only, so a glyph matching neither was
    // charged the plain average while it draws near the full font size.
    // Measured before the fix: 31 emoji "fitted" 187.2px of room and drew about
    // 341px. A card sized from that under-measure is a card the next rank sits
    // on top of.
    const FULL_WIDTH_PX = 11;
    for (const [label, title] of [
      ['emoji', '\u{1F600}'.repeat(40)],
      ['CJK', '\u8AB2\u984C'.repeat(30)],
      ['fullwidth latin', '\uFF21\uFF22'.repeat(30)],
    ] as const) {
      const glyphs = [...title].length;
      assert.ok(
        measureLabel(defaultTheme, title) >= glyphs * FULL_WIDTH_PX,
        `${label}: ${String(glyphs)} glyphs measured ${String(measureLabel(defaultTheme, title))}px`,
      );
    }
  });

  it('draws a short title exactly as it is', () => {
    assert.match(renderMarkup(scene().root), /<span class="ig-title">Rework the retry budget</);
  });
  it('draws every key the column could not, so nothing is published unreachable', () => {
    // THE CLASS THIS PROJECTION HAS RE-FOUND THREE TIMES: a key published as a
    // navigation target with no focusable element behind it. Compact mode drops
    // the gutters, so what would have sat in them joins the footer group — and
    // a group built from SLOTS alone drew none of the exclusions, which are not
    // slots, while the focus index still named them.
    const built = scene(fixtureDocument, { compact: true });
    const markup = renderMarkup(built.root);
    const focusable = new Set(
      [...markup.matchAll(/data-ig-key="([^"]+)"[^>]*tabindex="(?:0|-1)"/g)].map(
        (match) => match[1] as string,
      ),
    );
    for (const key of built.focusOrder) {
      assert.ok(focusable.has(key), `${key} is published as a target but is not drawn`);
    }
    for (const key of built.navigable) {
      assert.ok(focusable.has(key), `${key} is navigable but is not drawn`);
    }
    // The three kinds of key the column cannot draw, and each used to go missing
    // by its own route: a runner-held slot, a duplicate, and — the one two
    // partial rules both skipped — an ordinary off-order relationship endpoint,
    // which is neither a slot nor an exclusion.
    for (const key of ['105', '106', 'other/repo#7', '107']) {
      assert.ok(focusable.has(key), `${key} is drawn nowhere in the column`);
      assert.ok(built.focusOrder.includes(key), `${key} cannot be reached by keyboard`);
    }
  });

  it('offers lateral neighbours from the SPINE outward', () => {
    // §16f gives the lateral keys one job: leave the sequence for the gutter
    // card that explains this rank, and come back. `103` is the fixture's rank
    // 2; `105` is the runner-held slot that serializes with it, and `107` the
    // closed origin it was split from.
    const lateral = scene().lateral;
    assert.equal(lateral.get('103')?.left, '105');
    assert.equal(lateral.get('103')?.right, '107');
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
      cycles: [],
    }).lateral;

    assert.equal(lateral.get('1')?.left, '3');
  });

  it('traverses to a gutter node AND back', () => {
    // A one-way mapping is not a traversal: focus went out to the gutter and the
    // opposite arrow answered `none`, so the documented path "from the spine and
    // back" only went one way.
    const lateral = scene().lateral;

    assert.equal(lateral.get('103')?.left, '105');
    assert.equal(lateral.get('105')?.right, '103', 'the gutter cannot get back');
    assert.equal(lateral.get('103')?.right, '107');
    assert.equal(lateral.get('107')?.left, '103', 'the gutter cannot get back');
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

  it('gives a unit ONE addressable card, keyed by its lead', () => {
    // The enclosure used to be painted BEFORE the nodes and the mount index
    // keeps the first element per key, so sharing the key sent focus to a
    // non-tabbable rect instead of the node it decorated. One card cannot have
    // that problem: there is nothing behind it to compete with.
    const markup = render(heldTogetherDocument);

    assert.equal(canvasOf(markup).includes('class="ig-enclosure"'), false);
    assert.equal((markup.match(/data-ig-key="1"/g) ?? []).length, 1);
    assert.equal(markup.includes('data-ig-key="2"'), false, 'the partner took a card of its own');
    assert.match(markup, /data-ig-key="1"[^>]*tabindex="0"/);
  });
  it('names a unit\u2019s members on its card, and its edges from the declaration', () => {
    // WHAT THE CONNECTOR TESTS WERE REALLY HOLDING. A three-member unit used to
    // draw two connectors, and the property worth keeping was never the line —
    // it was that the unit is read from the DECLARED edges rather than from
    // member adjacency, so nothing is invented and nothing is missed. One card
    // listing its members states the same thing, and `edgeBadges` publishes each
    // declared edge's own identity on the badge that names it.
    const markup = render(togetherChain);
    for (const key of ['1', '2', '3']) {
      assert.match(markup, new RegExp(`<li class="ig-unit-member"><span class="ig-title">[^<]*</span><span class="ig-id">${key} `));
    }
    const declared = normalizeDocument(togetherChain)
      .document.edges.filter((edge) => edge.field === 'together-with')
      .map((edge) => edgeIdentity(edge.field, edge.from, edge.to));
    const published = new Set(
      [...markup.matchAll(/data-edge="together-with" data-ig-group="([^"]*)"/g)].map(
        (match) => match[1] as string,
      ),
    );
    assert.deepEqual([...published].sort(), [...declared].sort());
  });
  it('draws a STAR group from its declared edges, not from adjacent members', () => {
    // A writer joins a group by pointing at any existing member (§4.3.7), so a
    // star is ordinary rather than exotic — and it is the shape a chain fixture
    // cannot catch. An identity inferred from adjacency published
    // `together-with|2|3`, a relationship this document does not contain, while
    // the real `1`\u2013`3` edge got none. Checked in BOTH directions: nothing
    // invented, nothing missed.
    const normalized = normalizeDocument(togetherStar).document;
    const markup = renderMarkup(graphScene(normalized, {}).root);
    const drawn = [...markup.matchAll(/data-edge="together-with" data-ig-group="([^"]*)"/g)].map(
      (match) => match[1] as string,
    );
    const declared = normalized.edges
      .filter((edge) => edge.field === 'together-with')
      .map((edge) => edgeIdentity(edge.field, edge.from, edge.to));

    assert.deepEqual([...drawn].sort(), [...declared].sort());
    assert.ok(
      !drawn.includes(edgeIdentity('together-with', '2', '3')),
      'a relationship the document never declared was published',
    );
  });


  it('builds every legend sample in the SVG namespace, so a MOUNT draws it', () => {
    // IT WORKED BY ACCIDENT THROUGH `renderViewer`, whose output a host parses
    // as HTML. `mountViewer` materializes the same spec with `createElement`,
    // which builds an HTML `<svg>` and HTML `<line>` children that draw nothing
    // at all — so a mounted viewer showed five blank boxes where the legend's
    // samples are, which is the whole of what the samples were added for.
    const svgTags = new Set(['svg', 'line', 'path', 'circle', 'rect']);
    const walk = (spec: ElementSpec): void => {
      if (svgTags.has(spec.tag)) {
        assert.equal(spec.ns, 'svg', `<${spec.tag}> is not in the SVG namespace`);
      }
      for (const child of spec.children ?? []) {
        if (child !== null && child !== undefined && typeof child !== 'string') walk(child);
      }
    };
    walk(scene().root);
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
      metrics: { '--ig-terminal-length': 31, '--ig-terminal-width': 37 },
    });
    const markup = canvasOf(render(fixtureDocument, { theme: bigger }));

    assert.match(markup, /d="M 0 0 L -31 -18.5 L -31 18.5 Z"/);
    assert.match(markup, /r="18.5"/);
  });
  it('makes every published navigation target focusable, exactly once', () => {
    // One kind of node means one kind of tab stop, but the property is the same
    // one three rounds of review kept re-finding: a key published as a
    // navigation target with no focusable element behind it.
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

  it('sits each card on the coordinates the layout computed for it', () => {
    // Emitted as a sibling block, the cards would render ABOVE the drawing — so
    // the reader would have to hold the correspondence in their head, which is
    // the opposite of the design's claim that the spine IS the order.
    const document = normalizeDocument(fixtureDocument).document;
    const layout = layoutGraph(document, defaultTheme);
    const markup = render();

    assert.match(markup, /class="ig-stage"[^>]*--ig-stage-w:\d+px;--ig-stage-h:\d+px/);
    assert.ok(
      markup.indexOf('class="ig-stage"') < markup.indexOf('class="ig-rail"'),
      'the rail is not inside the stage',
    );

    const cards = new Map(
      [...markup.matchAll(/<li class="ig-rail-row" data-ig-key="([^"]+)"[^>]*>/g)].map(
        (match) => [match[1] as string, match[0]],
      ),
    );
    assert.equal(cards.size, layout.nodes.size, 'a laid-out key has no card');

    for (const [key, box] of layout.nodes) {
      const card = cards.get(key);
      assert.ok(card !== undefined, `no card for ${key}`);
      assert.match(
        card,
        new RegExp(`--ig-row-x:${String(box.x)}px;--ig-row-y:${String(box.y)}px`),
        `${key} is not positioned on its own box`,
      );
      assert.match(card, new RegExp(`--ig-row-w:${String(box.width)}px`));
    }
  });
  it('labels every node once, in its card, and never in the canvas', () => {
    // TEXT IN SVG NEITHER WRAPS NOR CLIPS, which is what forced every title
    // through a width fit and out the other side truncated. The canvas draws no
    // text at all now — it is the spine and the arcs — and every name is on a
    // card that wraps.
    const markup = render();

    assert.equal(canvasOf(markup).includes('ig-node-label'), false, 'the canvas still draws text');
    for (const title of ['Publish the rate table', 'Backfill the ledger', 'Rework the retry budget']) {
      const drawn = markup.match(new RegExp(`<span class="ig-title">${title}<`, 'g')) ?? [];
      assert.equal(drawn.length, 1, `"${title}" was drawn ${String(drawn.length)} times`);
    }
  });

  it('lists a component for every node it refused to draw, even with no edges at all', () => {
    // The refusal counts LAID-OUT nodes while the component list was built
    // from nodes carrying an EDGE, so an over-budget document with no
    // relationships refused to draw and then listed nothing — under a
    // sentence pointing at the list. A partition cannot disagree with the
    // count that triggered it.
    const size = GRAPH_NODE_BUDGET + 1;
    const edgeless: ViewerDocument = {
      issues: Array.from({ length: size }, (_, index) => ({
        key: String(index + 1),
        title: `Issue ${String(index + 1)}`,
        open: true,
        priority: 2,
      })),
      edges: [],
      order: {
        slots: Array.from({ length: size }, (_, index) => ({
          rank: index + 1,
          lead: String(index + 1),
          members: [String(index + 1)],
          ready: true,
          holds: [],
        })),
        excluded: [],
      },
      cycles: [],
    };
    const markup = render(edgeless);

    assert.match(markup, /class="ig-refusal"/);
    const capsules = [...markup.matchAll(/class="ig-capsule"/g)].length;
    assert.equal(capsules, size, `refused ${String(size)} nodes but listed ${String(capsules)}`);
  });

  it('says how many components it did not list, rather than truncating in silence', () => {
    // The cluster mode shows at most twelve. A silent slice left a reader
    // looking at twelve under a heading announcing the shape, with no way to
    // tell a complete list from a truncated one.
    // EVEN, and comfortably past the cluster-only budget: every issue must be an
    // edge endpoint to become a layout node, so an odd leftover would not be
    // counted and the document would fall back into capsule mode.
    const size = CLUSTER_ONLY_BUDGET + 20;
    const issues = Array.from({ length: size }, (_, index) => ({
      key: String(index + 1),
      title: `Issue ${String(index + 1)}`,
      open: true,
      priority: 2,
    }));
    // Two-node components, so there are far more than twelve of them.
    const edges = [];
    for (let index = 0; index + 1 < size; index += 2) {
      edges.push({
        field: 'blocked-by',
        from: String(index + 1),
        to: String(index + 2),
      } as ViewerDocument['edges'][number]);
    }
    const markup = render({ issues, edges, order: { slots: [], excluded: [] }, cycles: [] });

    const listed = [...markup.matchAll(/class="ig-capsule"/g)].length;
    assert.equal(listed, 12, `listed ${String(listed)} capsules, expected the cluster cap of 12`);
    assert.match(markup, /further components are not listed/);
    // The total is stated, so the reader can size what they are not seeing.
    assert.match(markup, /were found in total/);
  });

  it('keeps the footer and excluded rows when it refuses, which is what makes the claim true', () => {
    // The refusal tells the reader "The order list is complete at any size", and
    // in refusal mode the rail is the ONLY order UI — but it filtered out every
    // footer slot and never carried `order.excluded`. Measured before the fix: a
    // refused document lost the tracker-held slot's title, its hold reason and
    // the excluded key entirely, while still printing that sentence.
    const built = scene(refusedWithFooterAndExclusion());
    const markup = renderMarkup(built.root);

    assert.match(markup, /complete at any size/, 'this fixture no longer refuses');
    assert.ok(markup.includes('Title n60'), 'the footer slot is missing from the refusal');
    assert.ok(markup.includes('claimed by another run'), 'its hold reason is missing');
    assert.match(markup, /data-ig-key="exc1"/, 'the excluded row is missing');
  });

  it('leaves nothing it drew in the refusal unreachable', () => {
    // The same invariant the canvas carries, applied where the fix could break
    // it — and it DID, on the first attempt: widening the rail without widening
    // the focus index left the footer slot and the exclusion drawn with
    // `data-ig-key` and absent from `navigable`.
    const built = scene(refusedWithFooterAndExclusion());
    const drawn = new Set(
      [...renderMarkup(built.root).matchAll(/data-ig-key="([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    );

    for (const key of drawn) {
      assert.ok(built.navigable.includes(key), `${key} is drawn in the refusal but unreachable`);
    }
  });

  it('does NOT move a footer slot into the rail when the canvas is drawn', () => {
    // The other half, and the reason the rule is conditional rather than simply
    // widened: in ordinary graph mode a footer slot IS drawn, as a canvas node,
    // so carrying it in the rail too would render one slot twice.
    const markup = renderMarkup(scene().root);
    const appearances = [...markup.matchAll(/data-ig-key="105"/g)].length;

    assert.equal(appearances, 1, 'the footer slot is drawn twice in ordinary graph mode');
  });

  it('still publishes no focus targets when it refuses', () => {
    // One focus index, one element per key — a refusal draws no nodes, so it
    // has no navigation targets to publish and must not invent any.
    assert.deepEqual([...scene(crowdedDocument(GRAPH_NODE_BUDGET + 1)).focusOrder], []);
  });

  it('publishes no control INSIDE the refusal, and names only actions this package supports', () => {
    // A control here could never finish the action it advertised — narrowing is
    // the host's, because this package draws exactly what it is given. So the
    // capsules are informational, and the instruction names the order list,
    // which really is complete at any size. The panel HEADER still carries its
    // own controls: those are commands the viewer publishes and the host
    // completes, and they are not claims about this document's size.
    const markup = render(crowdedDocument(GRAPH_NODE_BUDGET + 1));
    const refusal = markup.slice(markup.indexOf('class="ig-refusal"'));

    assert.match(refusal, /class="ig-capsule"/);
    assert.equal(/<button/.test(refusal), false, 'the refusal published a control again');
    assert.equal(
      /data-ig-group/.test(refusal),
      false,
      'a refusal capsule carries a dispatch identity nothing can complete',
    );
    assert.equal(/Choose a component above/.test(refusal), false);
    assert.match(refusal, /The order list is complete at any size/);
  });
  it('returns the rail to ordinary flow when it refuses to draw', () => {
    // A refusal draws no nodes, so there is nothing to sit on — and a
    // fixed-height stage would clip the refusal block.
    const markup = render(crowdedDocument(GRAPH_NODE_BUDGET + 1));

    assert.equal(/class="ig-stage"/.test(markup), false);
    assert.equal(/ig-rail-row/.test(markup), false);
    assert.equal(/--ig-row-x/.test(markup), false);
  });

  it('hides the canvas from assistive technology, because the cards carry every name', () => {
    // The picture is decoration over an HTML rail that carries every node, every
    // name and every tab stop. `role="group"` with a label would put a second,
    // flattened description of the same nodes into the accessibility tree —
    // which is the mirror of the defect `role="img"` used to cause, and just as
    // confusing to hear.
    const markup = render();
    assert.match(markup, /<svg class="ig-canvas"[^>]*aria-hidden="true"/);
    assert.equal(/<svg class="ig-canvas"[^>]*role="img"/.test(markup), false);
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
    const markup = render({ issues: [], edges: [], order: { slots: [], excluded: [] }, cycles: [] });
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
    assert.match(markup, /Narrow the document to one neighbourhood and render again/);
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

  it('flags the host’s cycle in a capsule rather than deriving one, and does not hang on the loop', () => {
    // The badge is `cycles` relayed; the edges below close the same loop only
    // so the depth walk has a back-edge to step over without hanging.
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
      cycles: [['1', '2', '3']],
    };

    assert.match(render(cyclic), /<span class="ig-badge" data-edge="blocked-by">cycle<\/span>/);
    assert.doesNotMatch(
      render({ ...cyclic, cycles: [] }),
      /<span class="ig-badge" data-edge="blocked-by">cycle<\/span>/,
      'badged a loop the host did not report',
    );
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
