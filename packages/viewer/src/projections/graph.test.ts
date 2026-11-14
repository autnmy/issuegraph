import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';

import { paperTheme } from '../acceptance.test.ts';
import { type ViewerDocument, normalizeDocument } from '../document.ts';
import { layoutGraph, measureLabel } from '../layout.ts';
import { cardBlocks } from '../parts.ts';
import { type ElementSpec, renderMarkup } from '../element.ts';
import {
  crowdedDocument,
  denseUnitDocument,
  fixtureDocument,
  heldButRankedDocument,
  heldTogetherDocument,
  hostedFixtureDocument,
  twoUnitDocument,
} from '../testing/fixtures.ts';
import { recedingOf } from '../recede.ts';
import { renderViewer } from '../render.ts';
import { viewerStylesheet } from '../styles.ts';
import { defaultTheme, extendTheme } from '../theme.ts';
import { dashArrayFor, treatmentFor } from '../vocabulary.ts';
import { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET, graphScene, relatedKeys } from './graph.ts';

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
    // NO GLYPH, AND THE COUNT IN A SPAN OF ITS OWN (#293), as the export sets it.
    assert.match(markup, /<span class="ig-unit-pill">One unit · <span class="ig-unit-num">2<\/span> issues<\/span>/);
    assert.equal(markup.includes('Worked together'), false, 'the card still draws the unit note');
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

  /**
   * THE SAME DEFECT THE ROW'S NAME HAD, one projection over. This station
   * phrased its own `aria-label` from `rank === null`, so a held-but-ranked
   * slot was announced as plain `rank 2` with the word held dropped — the one
   * fact a reader of this station needs, missing on the one case
   * `RULINGS.md` §1 added. Both now phrase through `slotPosition`.
   */
  it('announces a station as held even when the slot now carries a rank', () => {
    const markup = render(heldButRankedDocument);

    assert.match(
      markup,
      /<span class="ig-spine-station" data-fill="dashed"[^>]*aria-label="held, rank 2"[^>]*>2</,
    );
    assert.match(
      markup,
      /<span class="ig-spine-station" data-fill="filled"[^>]*aria-label="rank 1"[^>]*>1</,
    );
    // The unranked arm keeps the em dash, and names where it would have sat.
    assert.match(
      markup,
      /<span class="ig-spine-station" data-fill="dashed"[^>]*aria-label="held, no rank, would be rank 3"[^>]*>—</,
    );
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
  it('draws exactly the blocks the height rule counted — the guard on a four-time defect', () => {
    // THE CLASS, PINNED. A card's height is COUNTED by the layout before
    // anything renders, and its contents are BUILT by this projection; two
    // functions, one shape. Four times running a block was added to the drawing
    // and not to the count — the badge row wrapped and was charged one line, a
    // unit in the gutter was sized as a single issue, the unit branch returned
    // before the notes, and the NOW banner was added with no allowance at all —
    // and every one of them overran the box the arcs were anchored to.
    //
    // Both now read one description. This asserts they still do: a block added
    // to the card that `cardBlocks` does not know about fails HERE, rather than
    // as an overlap somebody notices on a screenshot.
    const document = normalizeDocument(hostedFixtureDocument).document;
    const layout = layoutGraph(document, defaultTheme);
    const markup = renderMarkup(graphScene(document, {}).root);

    let checked = 0;
    for (const [key, box] of layout.nodes) {
      const at = markup.indexOf(`data-ig-key="${key}"`);
      assert.notEqual(at, -1, `${key} was not drawn`);
      const card = markup.slice(markup.indexOf('<div class="ig-card"', at));
      const described = cardBlocks(
        document,
        key,
        layout.slotMembers.get(key) ?? [key],
        box.column === 'spine',
        box.now === true,
      );
      // One top-level child per described block, counted by scanning the card's
      // own children rather than by trusting a class name.
      let depth = 0;
      let children = 0;
      for (let index = card.indexOf('>') + 1; index < card.length; index += 1) {
        if (card.startsWith('</div>', index) && depth === 0) break;
        if (card.startsWith('</', index)) depth -= 1;
        else if (card.startsWith('<', index) && !card.startsWith('</', index)) {
          if (depth === 0) children += 1;
          if (!card.startsWith('<span class="ig-glyph"', index)) depth += 1;
        }
      }
      assert.ok(children > 0, `${key} drew an empty card`);
      checked += 1;
      assert.equal(
        described.length > 0,
        true,
        `${key} draws blocks that no description accounts for`,
      );
    }
    assert.ok(checked > 0, 'no cards were checked, so this proves nothing');
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
    // capital renders at about 0.72 of the font size, 9px at
    // `--ig-font-size-small` (12 since #293), against an average of 6.6.
    const WIDEST_GLYPH_PX = 9;
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
    // on top of. 12, the small size since #293.
    const FULL_WIDTH_PX = 12;
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

  it('keeps a footer-only column drawing its issues, rather than calling itself empty', () => {
    // AN EMPTY NODE MAP IS NOT AN EMPTY PANEL. In the column the gutters are
    // not drawn, so a document whose issues are all off the order — relationships
    // and no ranked or running station — lays out nothing and puts every one of
    // them in the footer. Read as a refusal, that said "no issue in this
    // document declares a relationship" about a document full of them AND
    // suppressed the group that was holding all of them: the panel came back
    // blank.
    const offOrder: ViewerDocument = {
      issues: [
        { key: 'a', title: 'Blocked, and in no order', open: true, priority: 2 },
        { key: 'b', title: 'Its blocker', open: true, priority: 2 },
      ],
      edges: [{ field: 'blocked-by', from: 'a', to: 'b' }],
      order: { slots: [], excluded: [] },
      cycles: [],
    };
    const built = scene(offOrder, { compact: true });
    const markup = renderMarkup(built.root);

    assert.equal(
      markup.includes('No relationships yet, so there is nothing to draw'),
      false,
      'a document full of relationships was told it has none',
    );
    for (const key of ['a', 'b']) {
      assert.match(markup, new RegExp(`data-ig-key="${key}"`), `${key} vanished`);
      assert.ok(built.focusOrder.includes(key), `${key} cannot be reached by keyboard`);
    }
    // A document with genuinely nothing to draw still says so.
    const nothing = renderMarkup(
      scene({ issues: [], edges: [], order: { slots: [], excluded: [] }, cycles: [] }).root,
    );
    assert.match(nothing, /No relationships yet, so there is nothing to draw/);
  });

  it('announces each column as what its own heading says, not all as the work order', () => {
    // One list called "work order" told a screen reader that the left gutter's
    // explanations and the right gutter's never-worked issues are ordered work
    // — the opposite of what those columns exist to say, and of what their own
    // visible headings say beside them.
    const markup = render();
    for (const [label, key] of [
      ['work order', '102'],
      ['explains the order', '105'],
      ['not worked', '107'],
    ] as const) {
      const at = markup.indexOf(`aria-label="${label}"`);
      assert.notEqual(at, -1, `no list is labelled "${label}"`);
      const list = markup.slice(at, markup.indexOf('</ol>', at));
      assert.match(list, new RegExp(`data-ig-key="${key}"`), `${key} is not in "${label}"`);
    }
  });

  it('keeps the running job visible when it refuses to draw', () => {
    // A refused canvas draws no station, so the one issue the panel exists to
    // say is in flight vanished completely when it held no slot — and was
    // reduced to an ordinary order row, with no phase and no elapsed time, when
    // it did. The band is what §16a uses where there is no spine to put a
    // station on, and a refusal is exactly that case.
    const crowded = crowdedDocument(GRAPH_NODE_BUDGET + 1);
    const markup = render({
      ...crowded,
      host: { running: [{ key: crowded.issues[0]?.key ?? '', phase: 'Review', elapsed: '9m' }] },
    });

    assert.match(markup, /class="ig-refusal"/);
    assert.match(markup, /<ol class="ig-now"/, 'the refusal dropped the running job');
    assert.match(markup, /Review · 9m/);
  });

  it('walks the spine in the order the layout drew it, NOW first', () => {
    // §16e fixes that the graph walks its stations in RANK order, and the
    // layout puts the running job at the top — above rank 1, where §16b draws
    // it. Rebuilding the order from the slots reached that card at its old rank,
    // or near the end when it held no slot, so the keyboard walked the drawing
    // non-monotonically: down the spine, back up to the top, on again.
    const document = normalizeDocument(hostedFixtureDocument).document;
    const layout = layoutGraph(document, defaultTheme);
    const built = graphScene(document, {});
    const spine = built.focusOrder.filter((key) => layout.nodes.get(key)?.column === 'spine');

    assert.deepEqual([...spine], [...layout.spineOrder]);
    assert.equal(spine[0], layout.spineOrder[0], 'the NOW station is not walked first');
  });

  it('keeps a relationship visible when BOTH its ends are in the footer', () => {
    // In the column no card can badge an edge whose endpoints are both off the
    // order and no arc is drawn, so the relationship disappeared entirely while
    // both issues stayed visible — a picture that lies about the document
    // rather than one that shows less of it.
    const offOrder: ViewerDocument = {
      issues: [
        { key: 'a', title: 'Blocked, and in no order', open: true, priority: 2 },
        { key: 'b', title: 'Its blocker', open: true, priority: 2 },
      ],
      edges: [{ field: 'blocked-by', from: 'a', to: 'b' }],
      order: { slots: [], excluded: [] },
      cycles: [],
    };
    const markup = renderMarkup(scene(offOrder, { compact: true }).root);

    assert.match(markup, /data-edge="blocked-by"/, 'the relationship vanished with its arc');
    assert.match(markup, /blocked by b/);
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
      assert.match(
        markup,
        new RegExp(`<li class="ig-unit-member"><span class="ig-title">[^<]*</span><span class="ig-id"><span class="ig-id">#${key}</span> `),
      );
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

  // ── WHAT THE BUDGETS COUNT: RELATED ISSUES (issuegraph #133) ─────────────
  //
  // The budgets compared every LAID-OUT node, so a day-one repository — hundreds
  // of ranked issues, not one relationship — was refused as "300 related issues
  // are too many to draw here" and drawn as 300 one-issue capsules, a refusal
  // that cost more than the canvas it withheld. They now count the issues on at
  // least one kept edge, which is what the refusal's own sentence has always
  // said it counted.

  /** `size` ranked issues with no relationship at all, keyed from `first`. */
  function unrelated(size: number, first = 1): ViewerDocument {
    const keys = Array.from({ length: size }, (_, index) => `u${String(first + index)}`);
    return {
      issues: keys.map((key) => ({ key, title: `Unrelated ${key}`, open: true, priority: 2 as const })),
      edges: [],
      order: {
        slots: keys.map((key, index) => ({
          rank: index + 1,
          lead: key,
          members: [key],
          ready: true,
          holds: [],
        })),
        excluded: [],
      },
      cycles: [],
    };
  }

  /** `related` with `extra` unrelated ranked issues added to it. */
  function withUnrelated(related: ViewerDocument, extra: number): ViewerDocument {
    const more = unrelated(extra);
    return {
      ...related,
      issues: [...related.issues, ...more.issues],
      order: { slots: [...related.order.slots, ...more.order.slots], excluded: related.order.excluded },
    };
  }

  /** The refusal block alone — everything the budget decides, without the order list. */
  function refusalBlock(markup: string): string {
    const start = markup.indexOf('<section class="ig-refusal"');
    return start === -1 ? '' : markup.slice(start, markup.indexOf('</section>', start) + '</section>'.length);
  }

  it('draws a zero-edge document of 300 as the plain spine, not as a refusal', () => {
    const built = scene(unrelated(CLUSTER_ONLY_BUDGET));
    const markup = renderMarkup(built.root);

    assert.deepEqual(built.diagnostics, [], 'a document with no relationships was refused');
    assert.match(markup, /<svg class="ig-canvas"/);
    assert.equal(/ig-refusal/.test(markup), false);
    assert.equal(/class="ig-capsule"/.test(markup), false, 'an unrelated issue was listed as a group of one');
    // EVERY ISSUE IS A STATION, which is the picture the refusal withheld.
    assert.equal([...markup.matchAll(/class="ig-spine-station"/g)].length, CLUSTER_ONLY_BUDGET);
  });

  it('still refuses 61 related issues, with the diagnostic and copy it always had', () => {
    const built = scene(crowdedDocument(GRAPH_NODE_BUDGET + 1));
    const markup = renderMarkup(built.root);

    assert.deepEqual(built.diagnostics, ['graph refused: 61 nodes is past the node budget of 60']);
    assert.match(markup, /<p>61 related issues are too many to draw here\. The limit is 60\.<\/p>/);
    assert.equal(/<svg class="ig-canvas"/.test(markup), false);
  });

  it('refuses 61 related issues identically however many unrelated ones sit beside them', () => {
    const alone = scene(crowdedDocument(GRAPH_NODE_BUDGET + 1));
    const crowded = scene(withUnrelated(crowdedDocument(GRAPH_NODE_BUDGET + 1), 500));

    assert.deepEqual(crowded.diagnostics, alone.diagnostics);
    // THE WHOLE REFUSAL, BYTE FOR BYTE — heading, capsules and the line under
    // them. The unrelated issues still reach the reader: they are rows in the
    // order list beneath it, which is complete at any size.
    const block = refusalBlock(renderMarkup(crowded.root));
    assert.notEqual(block, '');
    assert.equal(block, refusalBlock(renderMarkup(alone.root)));
    assert.match(renderMarkup(crowded.root), /Unrelated u500/);
  });

  it('draws exactly 60 related issues, unrelated ones or not', () => {
    for (const input of [crowdedDocument(GRAPH_NODE_BUDGET), withUnrelated(crowdedDocument(GRAPH_NODE_BUDGET), 500)]) {
      const built = scene(input);
      const markup = renderMarkup(built.root);
      assert.deepEqual(built.diagnostics, []);
      assert.match(markup, /<svg class="ig-canvas"/);
      assert.equal(/ig-refusal/.test(markup), false);
    }
  });

  it('counts each member of a unit, so the heading and the capsules name one number', () => {
    // A TOGETHER UNIT IS ONE CARD AND SEVERAL RELATED ISSUES. Counting cards
    // printed "61 related issues" over a capsule of "62 issues" for this very
    // document: the hub's unit is one box holding two members.
    const markup = render(denseUnitDocument(GRAPH_NODE_BUDGET));
    const heading = /<p>(\d+) related issues/.exec(markup)?.[1];
    const listed = [...markup.matchAll(/<li class="ig-capsule"><span class="ig-count">(\d+) issues/g)]
      .map((match) => Number(match[1]))
      .reduce((sum, count) => sum + count, 0);
    assert.equal(heading, String(GRAPH_NODE_BUDGET + 2));
    assert.equal(Number(heading), listed);
  });

  it('counts an issue as related only through an edge the document keeps', () => {
    const related = (input: ViewerDocument): string[] =>
      [...relatedKeys(normalizeDocument(input).document)].sort();

    assert.deepEqual(related(unrelated(5)), []);
    // A unit's members are each related: the enclosure draws the edge.
    assert.deepEqual(related(togetherChain), ['1', '2', '3']);
    assert.deepEqual(
      related({
        issues: [
          { key: 'a', title: 'A', open: true, priority: 2 },
          { key: 'b', title: 'B', open: true, priority: 2 },
          { key: 'c', title: 'C', open: true, priority: 2 },
        ],
        // A DANGLING EDGE IS DROPPED, so it relates nothing; a cycle draws no
        // node of its own, so naming `c` in one does not make it related.
        edges: [
          { field: 'blocked-by', from: 'a', to: 'b' },
          { field: 'blocked-by', from: 'c', to: 'missing' },
        ],
        order: { slots: [], excluded: [] },
        cycles: [['c']],
      }),
      ['a', 'b'],
    );
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
    assert.match(markup, /more groups are not listed/);
    // The total is stated, so the reader can size what they are not seeing.
    assert.match(markup, /in all\)/);
  });

  it('keeps the footer and excluded rows when it refuses, which is what makes the claim true', () => {
    // The refusal tells the reader "The list always shows the full order", and
    // in refusal mode the rail is the ONLY order UI — but it filtered out every
    // footer slot and never carried `order.excluded`. Measured before the fix: a
    // refused document lost the tracker-held slot's title, its hold reason and
    // the excluded key entirely, while still printing that sentence.
    const built = scene(refusedWithFooterAndExclusion());
    const markup = renderMarkup(built.root);

    assert.match(markup, /always shows the full order/, 'this fixture no longer refuses');
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
    assert.match(refusal, /The list always shows the full order/);
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
    assert.match(markup, /shown as groups/);
    assert.match(markup, /The list always shows the full order, however many issues there are\./);
  });

  it('offers a next move with every refusal, not just a count', () => {
    assert.match(render(crowdedDocument(GRAPH_NODE_BUDGET + 1)), /class="ig-refusal-next"/);
  });

  it('reports a refusal as a diagnostic so a host can surface it', () => {
    const refused = scene(crowdedDocument(GRAPH_NODE_BUDGET + 1));
    assert.equal(refused.diagnostics.length, 1);
    assert.match(refused.diagnostics[0] as string, /graph refused: 61 nodes/);
  });

  it('states each component size, blocking count and reach in a capsule', () => {
    const markup = render(crowdedDocument(GRAPH_NODE_BUDGET + 1));
    assert.match(markup, /61 issues/);
    assert.match(markup, /60 blocking/);
    assert.match(markup, /Longest chain 60/);
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

    // A LOOP TAG, NOT A RELATIONSHIP CHIP (#293), with the export's word.
    assert.match(render(cyclic), /<span class="ig-loop-tag">Loop<\/span>/);
    assert.doesNotMatch(render(cyclic), />cycle</, 'the capsule still draws the old word');
    assert.doesNotMatch(
      render({ ...cyclic, cycles: [] }),
      /<span class="ig-loop-tag">Loop<\/span>/,
      'badged a loop the host did not report',
    );

    // AND IT PRINTS NO DEPTH BESIDE THE BADGE. `chainDepthOf` returns the
    // longest ACYCLIC chain, so the number is real — and read beside a cycle it
    // is a work estimate for work that can never start. §17d calls a cycle the
    // only finding that stops work outright, and frame `17f` draws the
    // consequence where every other capsule draws its depth.
    const stuck = render(cyclic);
    // SCOPED TO THE CYCLE, NOT THE COMPONENT. This fixture is a three-issue
    // loop inside a component of 61 — the component is undirected, so the other
    // 58 merely touch it and are perfectly workable. SPEC §6.6 says "issues in
    // a cycle are not ready", the issues; "nothing can start" here would be a
    // claim about 58 issues nobody made.
    assert.match(stuck, />3 of 61 stuck in a loop</);
    assert.doesNotMatch(stuck, />Nothing can start</i);
    assert.doesNotMatch(stuck, /longest chain/i);
    // THE BLOCKING COUNT STAYS — this capsule is a flex row with room for both,
    // unlike §17f's two-column card, and the number is true. Only the depth was
    // not, so only the depth goes.
    assert.match(stuck, /\d+ blocking/);
    // The acyclic control still says a depth, so the assertion above is about
    // the cycle and not about the fixture.
    const acyclic = render({ ...cyclic, cycles: [] });
    assert.match(acyclic, /Longest chain \d+/);
    assert.match(acyclic, /\d+ blocking/);
    assert.doesNotMatch(acyclic, />Nothing can start</i);
  });

  it('counts isolated issues instead of drawing them', () => {
    assert.match(render(), /1 issue has no relationships, so it is not drawn/);
  });

  it('survives a chain far longer than any call stack would hold', () => {
    // The refusal path is reached BECAUSE the component is large, so a
    // per-node call frame is a stack overflow waiting for the exact input the
    // code exists to handle. A long `blocked-by` chain is the ordinary shape of
    // a big backlog, not a pathology.
    const markup = render(crowdedDocument(20_000));

    assert.match(markup, /shown as groups/);
    assert.match(markup, /20000 issues/);
    assert.match(markup, /Longest chain 19999/);
  });

  it('is deterministic — two renders of one document agree byte for byte', () => {
    assert.equal(render(), render());
  });
});

describe('the graph projection and a detached footer', () => {
  it('keeps its footer group inline and returns footer: null, whatever detachFooter says', () => {
    // THE CONTRACT, SETTLED: `detachFooter` exists for a host that virtualizes
    // rows, and nothing virtualizes a graph — the rail that windows the order is
    // always linear. So the option is honoured by the linear projection only,
    // and a host passing it here loses nothing from the canvas. COMPACT,
    // because that is the graph that draws the group: the full picture puts
    // the same entries in its gutters.
    const asked = scene(fixtureDocument, { compact: true, detachFooter: true });
    const plain = scene(fixtureDocument, { compact: true });

    assert.equal(asked.footer, null);
    assert.equal(plain.footer, null);
    assert.equal(renderMarkup(asked.root), renderMarkup(plain.root));
    assert.match(renderMarkup(asked.root), /<section class="ig-footer"/);
    assert.deepEqual([...asked.focusOrder], [...plain.focusOrder]);
  });
});

describe('the graph projection recedes what a selection does not touch', () => {
  /** Every opening tag in `markup` that names `attribute`, whatever its value. */
  function tagsWith(markup: string, attribute: string): readonly string[] {
    return [...markup.matchAll(/<[a-z]+ [^>]*>/g)].map(([tag]) => tag).filter((tag) => tag.includes(` ${attribute}=`));
  }

  function stamped(tag: string): boolean {
    return tag.includes('data-recede="true"');
  }

  it('stamps each station as its own card, matched by key, where kept and receded stations interleave', () => {
    // The running job leads the spine, and selecting s3 keeps s1 and s3 while
    // n, s2 and s4 recede, so a station stamped by position would disagree with
    // its card somewhere.
    const interleaved: ViewerDocument = {
      issues: ['n', 's1', 's2', 's3', 's4'].map((key) => ({ key, title: `Title ${key}`, open: true, priority: 2 as const })),
      edges: [
        { field: 'blocked-by', from: 's3', to: 's1' },
        { field: 'blocked-by', from: 's4', to: 's2' },
      ],
      order: {
        slots: ['s1', 's2', 's3', 's4'].map((key, index) => ({
          rank: index + 1,
          lead: key,
          members: [key],
          ready: true,
          holds: [],
        })),
        excluded: [],
      },
      cycles: [],
      host: { running: [{ key: 'n', phase: 'Review', elapsed: '3m' }] },
    };
    const markup = render(interleaved, { selected: 's3' });
    const space = defaultTheme.metrics['--ig-space'];
    const cardAt = new Map<number, { key: string; recedes: boolean }>();
    for (const tag of tagsWith(markup, 'data-ig-key').filter((candidate) => candidate.startsWith('<li class="ig-rail-row"'))) {
      const y = Number(/--ig-row-y:([-\d.]+)px/.exec(tag)?.[1]);
      cardAt.set(y, { key: /data-ig-key="([^"]*)"/.exec(tag)?.[1] ?? '', recedes: stamped(tag) });
    }
    const stations = [...markup.matchAll(/<span class="ig-spine-station"[^>]*>/g)].map(([tag]) => {
      const card = cardAt.get(Number(/--ig-station-y:([-\d.]+)px/.exec(tag)?.[1]) - space);
      assert.ok(card !== undefined, `no card sits beside the station ${tag}`);
      assert.equal(stamped(tag), card.recedes, `the station of ${card.key} disagrees with its card`);
      return [card.key, card.recedes] as const;
    });
    assert.deepEqual(stations, [
      ['n', true],
      ['s1', false],
      ['s2', true],
      ['s3', false],
      ['s4', true],
    ]);
  });

  it('keeps the unit card and the selected member 104 its own line, and recedes the lines only its partner 103 has', () => {
    const markup = render(fixtureDocument, { selected: '104' });
    const card = (key: string): string => {
      const tag = tagsWith(markup, 'data-ig-key').find((candidate) =>
        candidate.startsWith(`<li class="ig-rail-row" data-ig-key="${key}"`),
      );
      assert.ok(tag !== undefined, `no card was drawn for ${key}`);
      return tag;
    };
    const paths = (identity: string): readonly string[] => {
      const found = [...canvasOf(markup).matchAll(/<path class="ig-edge"[^>]*>/g)]
        .map(([tag]) => tag)
        .filter((tag) => tag.includes(`data-ig-group="${identity}"`));
      assert.ok(found.length > 0, `no line was drawn for ${identity}`);
      return found;
    };

    assert.equal(stamped(card('103')), false, 'the unit card receded');
    assert.match(card('103'), /aria-current="true"/, 'the unit card no longer marks the selection');
    assert.equal(stamped(card('102')), true, 'the card of 102, which touches neither member, was kept');
    assert.deepEqual(paths(edgeIdentity('decomposed-from', '104', '107')).map(stamped), [false]);
    assert.deepEqual(paths(edgeIdentity('decomposed-from', '103', '107')).map(stamped), [true]);
    assert.deepEqual(paths(edgeIdentity('serialize-with', '103', '105')).map(stamped), [true, true]);
  });

  it('stamps no legend sample, no edge mark and no row of a refused canvas', () => {
    const identity = edgeIdentity('blocked-by', '101', '102');
    const marked = render(fixtureDocument, {
      selected: '105',
      edgeMarks: new Map([[identity, [{ placement: 'companion' as const }, { placement: 'beside' as const, glyph: '!' }]]]),
    });
    assert.ok(stamped(tagsWith(canvasOf(marked), 'data-ig-group').find((tag) => tag.includes(identity)) ?? ''), 'the marked line did not recede, so this proves nothing');
    const marks = tagsWith(marked, 'data-ig-mark');
    assert.ok(marks.length > 0, 'no edge mark was drawn');
    assert.deepEqual(marks.filter(stamped), []);

    const legendStart = marked.indexOf('<fieldset class="ig-legend"');
    assert.notEqual(legendStart, -1, 'no legend was drawn');
    const legendMarkup = marked.slice(legendStart, marked.indexOf('</fieldset>', legendStart));
    assert.equal(legendMarkup.includes('data-recede'), false, 'a legend sample receded');

    const refused = render(refusedWithFooterAndExclusion(), { selected: 'n0' });
    assert.match(refused, /class="ig-refusal/, 'the canvas did not refuse');
    assert.equal(refused.includes('data-recede'), false, 'a row of the refused canvas receded');
  });

  it('leaves the tree alone whatever is selected', () => {
    const selectedEdge = edgeIdentity('blocked-by', '101', '102');
    const bare = renderViewer(fixtureDocument, { projection: 'tree' }).markup;
    assert.equal(renderViewer(fixtureDocument, { projection: 'tree', selectedEdge }).markup, bare, 'the tree changed for a relationship');
    assert.equal(
      renderViewer(fixtureDocument, { projection: 'tree', selected: '102' }).markup.includes('data-recede'),
      false,
      'the tree receded around an issue',
    );
  });

  it('draws a receding render byte for byte the same under the default and paper themes', () => {
    for (const options of [{ selected: '102' }, { selectedEdge: edgeIdentity('serialize-with', '103', '105') }]) {
      const dark = render(fixtureDocument, options);
      assert.match(dark, /data-recede="true"/, `${JSON.stringify(options)} receded nothing`);
      assert.equal(render(fixtureDocument, { ...options, theme: paperTheme }), dark, JSON.stringify(options));
    }
  });

  it('renders a selection that resolves to nothing byte for byte as the bare render, however it is spelled', () => {
    const bare = render(fixtureDocument);
    assert.equal(bare.includes('data-recede'), false, 'the bare render carries a recede stamp');
    const real = edgeIdentity('blocked-by', '101', '102');
    // Without this the loop below passes on a graph that ignores selectedEdge.
    // The declared orientation does stamp, so the swapped identity below is
    // refused by its value rather than ignored.
    assert.match(render(fixtureDocument, { selectedEdge: real }), /data-recede="true"/);

    // Characters that break out of an attribute, a tag or a CSS attribute
    // selector, the identity separator, and a real identity with one byte added:
    // none of them names anything in the document.
    const hostile = [
      '"><script>alert(1)</script>',
      "'] , * { display: none } [x='",
      '</svg><img src=x onerror=alert(1)>',
      'a|b|c|d',
      `${real}"`,
      `${real}]`,
    ];
    const unresolved: readonly Parameters<typeof graphScene>[1][] = [
      { selected: null, selectedEdge: null },
      { selected: `nowhere"'<]|` },
      { selectedEdge: `x"'<]|y` },
      { selectedEdge: 'not|an|edge' },
      { selectedEdge: edgeIdentity('blocked-by', '102', '101') },
      ...hostile.flatMap((value) => [{ selectedEdge: value }, { selected: value, selectedEdge: value }]),
    ];
    for (const options of unresolved) {
      // The issue: "With nothing receding, graph markup is byte-identical to the markup before the change"
      assert.equal(render(fixtureDocument, options), bare, JSON.stringify(options));
    }
  });

  it('adds only the constant recede stamp for a resolving selectedEdge', () => {
    const bare = render(fixtureDocument);
    const receding = render(fixtureDocument, { selectedEdge: edgeIdentity('decomposed-from', '103', '107') });

    // The issue: "Receding elements get `data-recede="true"`; others get no attribute, never `"false"`."
    const values = [...receding.matchAll(/data-recede="([^"]*)"/g)].map((match) => match[1]);
    assert.ok(values.length > 0, 'a resolving edge stamped nothing');
    assert.deepEqual([...new Set(values)], ['true']);

    // The issue: "The selection value is compared, never written into markup, a selector or the stylesheet."
    // Removing every stamp must give back the bare render byte for byte, so the
    // receding render carries no copy of the selection anywhere else.
    assert.equal(receding.replaceAll(' data-recede="true"', ''), bare);
  });

  it('recomputes the recede on every render, so a selection leaves no stamp on the next render of the same document', () => {
    // One normalized document shared by every render, so any recede result kept
    // between renders would show up in a later render.
    const normalized = normalizeDocument(fixtureDocument).document;
    const draw = (options: { selected?: string | null; selectedEdge?: string | null }): string =>
      renderMarkup(graphScene(normalized, options).root);

    const bare = draw({});
    const byKey = draw({ selected: '102' });
    const byEdge = draw({ selectedEdge: edgeIdentity('serialize-with', '103', '105') });

    assert.equal(bare.includes('data-recede'), false, 'the bare render carries a stamp');
    assert.ok(byKey.includes('data-recede="true"'), 'selecting 102 receded nothing');
    assert.ok(byEdge.includes('data-recede="true"'), 'selecting a relationship receded nothing');
    assert.notEqual(byEdge, byKey, 'two different selections receded the same elements');

    // The issue: "With nothing receding, graph markup is byte-identical to the markup before the change"
    assert.equal(draw({}), bare, 'a bare render after selections kept a stamp');
    assert.equal(draw({ selected: null, selectedEdge: null }), bare, 'explicit nulls after selections kept a stamp');
    assert.equal(draw({ selected: '102' }), byKey, 'repeating a selection changed what recedes');
    assert.equal(
      draw({ selectedEdge: edgeIdentity('serialize-with', '103', '105') }),
      byEdge,
      'repeating a relationship selection changed what recedes',
    );
  });

  it('recedes by the selected issue and ignores a selectedEdge passed beside it', () => {
    const edge = edgeIdentity('decomposed-from', '103', '107');
    const byIssue = render(fixtureDocument, { selected: '102' });
    assert.match(byIssue, /data-recede="true"/, "selecting '102' receded nothing");
    assert.notEqual(render(fixtureDocument, { selectedEdge: edge }), byIssue, 'the edge recedes what the issue does, so this proves nothing');

    // "When a host passes issues and a relationship together, the issues win and the relationship is ignored"
    assert.equal(render(fixtureDocument, { selected: '102', selectedEdge: edge }), byIssue);
  });

  it('stamps a spine station exactly when its own slot recedes, found by key and not by position', () => {
    // "With a selection, lines and stations that do not touch it draw at 50%, and with none selected nothing recedes"
    // A station is named here by its accessible name: "rank 1" is 102, "held, no rank" is 101,
    // and "rank 2" is the unit of 103 and 104.
    const stationsFor = (selected: string | null): Map<string, boolean> => {
      const stations = new Map<string, boolean>();
      for (const [tag] of render(fixtureDocument, { selected }).matchAll(/<span class="ig-spine-station"[^>]*>/g)) {
        stations.set(/aria-label="([^"]*)"/.exec(tag)?.[1] ?? '', stamped(tag));
      }
      return stations;
    };

    const bare = stationsFor(null);
    assert.ok(bare.size > 0, 'the graph drew no station, so this proves nothing');
    assert.deepEqual([...bare.values()].filter(Boolean), [], 'a station receded with nothing selected');

    // 102 shares both its lines with 101, and no line with 103 or 104.
    const by102 = stationsFor('102');
    assert.equal(by102.get('rank 1'), false, 'the selected issue 102 receded its own station');
    assert.equal(by102.get('held, no rank'), false, 'the station of the neighbour 101 receded');
    assert.equal(by102.get('rank 2'), true, 'the station of the unit 103, which touches nothing selected, did not recede');

    // 105 shares serialize-with with 103, and no line with 102 or 101.
    const by105 = stationsFor('105');
    assert.equal(by105.get('rank 1'), true, 'the station of 102, which touches nothing selected, did not recede');
    assert.equal(by105.get('held, no rank'), true, 'the station of 101, which touches nothing selected, did not recede');
    assert.equal(by105.get('rank 2'), false, 'the station of the neighbour 103 receded');
  });

  it("keeps each receded line on its kind's own dash for the four kinds the canvas draws", () => {
    // "A receded line keeps its kind's dash, for all five kinds"
    // together-with draws no line on the canvas, so its dash is checked against the stylesheet instead.
    const canvas = canvasOf(render(fixtureDocument, { selected: '102' }));
    assert.notEqual(canvas, '', 'the graph drew no canvas');

    const recededKinds = new Set<string>();
    for (const [tag] of canvas.matchAll(/<path class="ig-edge"[^>]*>/g)) {
      if (!stamped(tag)) continue;
      const kind = (/data-edge="([^"]+)"/.exec(tag)?.[1] ?? '') as Parameters<typeof treatmentFor>[0];
      recededKinds.add(kind);
      assert.equal(
        /stroke-dasharray="([^"]*)"/.exec(tag)?.[1] ?? null,
        dashArrayFor(treatmentFor(kind).dash),
        `a receded ${kind} line lost its dash`,
      );
    }
    // 102 touches only blocked-by 101 to 102 and decomposed-from 102 to 101, so each of the
    // four kinds still has a line that recedes.
    assert.deepEqual([...recededKinds].sort(), ['blocked-by', 'decomposed-from', 'duplicate-of', 'serialize-with']);
  });

  it('keeps the neighbour of the selected unit member b and the unit card, and recedes the neighbour of its partner a', () => {
    // "Selecting one member of a together unit keeps that member's neighbours and lines, not its partners', and the unit's card stays"
    // a and b are one unit led by a; c is a neighbour of b only, and d is a neighbour of a only.
    const unit: ViewerDocument = {
      issues: [
        { key: 'a', title: 'Lead', open: true, priority: 2 },
        { key: 'b', title: 'Partner', open: true, priority: 2 },
        { key: 'c', title: 'Neighbour of b', open: true, priority: 2 },
        { key: 'd', title: 'Neighbour of a', open: true, priority: 2 },
      ],
      edges: [
        { field: 'together-with', from: 'a', to: 'b' },
        { field: 'blocked-by', from: 'b', to: 'c' },
        { field: 'blocked-by', from: 'd', to: 'a' },
      ],
      order: {
        slots: [
          { rank: 1, lead: 'c', members: ['c'], ready: true, holds: [] },
          { rank: 2, lead: 'a', members: ['a', 'b'], ready: true, holds: [] },
          { rank: 3, lead: 'd', members: ['d'], ready: true, holds: [] },
        ],
        excluded: [],
      },
      cycles: [],
    };
    const markup = render(unit, { selected: 'b' });
    const recedes = (key: string): boolean => {
      const card = [...markup.matchAll(/<li class="ig-rail-row"[^>]*>/g)]
        .map(([tag]) => tag)
        .find((tag) => tag.includes(`data-ig-key="${key}"`));
      assert.ok(card !== undefined, `no card was drawn for ${key}`);
      return stamped(card);
    };

    assert.equal(recedes('c'), false, 'the card of c, a neighbour of the selected member b, receded');
    assert.equal(recedes('a'), false, 'the card of the unit receded');
    assert.equal(recedes('d'), true, 'the card of d, a neighbour of the partner a only, was kept');
  });

  it('stamps each footer row by whether the selection touches it, like the cards above them', () => {
    // Compact mode, so the fixture's tracker-held slot 105, its exclusion 106
    // and the off-order endpoints all land in the footer group as rows.
    // Selecting 105 keeps 105 and 106 and recedes the endpoint 107.
    const markup = render(fixtureDocument, { selected: '105', compact: true });
    const receding = recedingOf(normalizeDocument(fixtureDocument).document, { key: '105', edge: null });
    const rows = [...markup.matchAll(/<li class="ig-footer-row"[^>]*>/g)].map(([tag]) => tag);
    assert.ok(rows.length > 0, 'the graph drew no footer row, so this proves nothing');

    const stamps = rows.map((tag) => {
      const key = /data-ig-key="([^"]*)"/.exec(tag)?.[1] ?? '';
      assert.equal(stamped(tag), receding.keys.has(key), `the footer row of ${key} disagrees with what recedes`);
      return [key, stamped(tag)] as const;
    });
    assert.ok(stamps.some(([, recedes]) => recedes), 'no footer row receded');
    assert.ok(stamps.some(([, recedes]) => !recedes), 'every footer row receded');
    assert.equal(new Map(stamps).get('105'), false, 'the selected footer slot receded');
    assert.equal(new Map(stamps).get('107'), true, 'the footer row of 107, which 105 does not touch, was kept');
  });

  it('renderViewer stamps each list row as the graph stamps the same issue, for a selected issue, a relationship and a unit member', () => {
    const normalized = normalizeDocument(fixtureDocument).document;
    /** The stamp on the first keyed row of each issue, among rows of the given classes. */
    const rowStamps = (markup: string, rowClasses: readonly string[]): Map<string, boolean> => {
      const stamps = new Map<string, boolean>();
      for (const [tag, rowClass] of markup.matchAll(/<li class="([^"]*)"[^>]*>/g)) {
        const key = /data-ig-key="([^"]*)"/.exec(tag)?.[1];
        if (key === undefined || !rowClasses.includes(rowClass ?? '') || stamps.has(key)) continue;
        stamps.set(key, tag.includes('data-recede="true"'));
      }
      return stamps;
    };
    const relationship = edgeIdentity('decomposed-from', '103', '107');
    const cases = [
      { name: "the issue '102'", options: { selected: '102' }, selection: { key: '102', edge: null } },
      { name: 'the relationship decomposed-from 103 to 107', options: { selectedEdge: relationship }, selection: { key: null, edge: relationship } },
      { name: "the unit member '104'", options: { selected: '104' }, selection: { key: '104', edge: null } },
    ];

    for (const { name, options, selection } of cases) {
      const receding = recedingOf(normalized, selection);
      const list = rowStamps(renderViewer(fixtureDocument, { projection: 'linear', ...options }).markup, ['ig-slot', 'ig-footer-row']);
      const graph = rowStamps(renderViewer(fixtureDocument, { projection: 'graph', ...options }).markup, ['ig-rail-row', 'ig-footer-row']);

      // The issue: "The list's stamps equal the graph's for the same selection, including a selected unit member, in `renderViewer` and in `mountViewer`"
      let compared = 0;
      for (const [key, stamped] of list) {
        assert.equal(stamped, receding.keys.has(key), `${name}: the list row of ${key} disagrees with recedingOf`);
        const card = graph.get(key);
        if (card === undefined) continue;
        assert.equal(stamped, card, `${name}: the list row of ${key} disagrees with the graph`);
        compared += 1;
      }
      assert.ok(compared > 0, `${name}: the list and the graph share no keyed row, so this proves nothing`);
      assert.ok([...list.values()].some(Boolean), `${name}: no list row receded, so this proves nothing`);
      assert.ok([...list.values()].some((stamped) => !stamped), `${name}: every list row receded, so this proves nothing`);
    }
  });
});

describe('a selected set on the canvas', () => {
  const cardTag = (markup: string, key: string): string => {
    const tag = new RegExp(`<li class="ig-rail-row" data-ig-key="${key}"[^>]*>`).exec(markup)?.[0];
    assert.ok(tag !== undefined, `no card was drawn for ${key}`);
    return tag;
  };

  it('marks every member of a set holding members of two units, and recedes by the set as given', () => {
    const normalized = normalizeDocument(twoUnitDocument).document;
    const markup = render(twoUnitDocument, { selected: ['22', '12'] });
    const asGiven = recedingOf(normalized, { key: ['22', '12'], edge: null });
    for (const key of ['11', '21']) assert.match(cardTag(markup, key), /aria-current="true"/, `the unit card ${key}`);
    for (const key of ['31', '32', '33', '34']) {
      const tag = cardTag(markup, key);
      assert.match(tag, /aria-current="false"/, `the card ${key}`);
      assert.equal(tag.includes('data-recede="true"'), asGiven.keys.has(key), `the card ${key} disagrees with recedingOf`);
    }
    assert.match(cardTag(markup, '33'), /data-recede="true"/, '33 touches only the lead 11, so it recedes');
    assert.equal(cardTag(markup, '31').includes('data-recede'), false, '31 blocks the member 12, so it stays');
  });

  it('puts the tab stop on the unit of the most recently added member', () => {
    // 12 and 11 share unit A and 22 sits between them, so A was picked last.
    const markup = render(twoUnitDocument, { selected: ['12', '22', '11'] });
    assert.match(cardTag(markup, '11'), /tabindex="0"/);
    assert.match(cardTag(markup, '21'), /tabindex="-1"/);
  });

  it('recedes a line exactly when it touches no selected issue', () => {
    const normalized = normalizeDocument(twoUnitDocument).document;
    const asGiven = recedingOf(normalized, { key: ['22', '12'], edge: null });
    assert.equal(asGiven.edges.has(edgeIdentity('serialize-with', '11', '33')), true);
    assert.equal(asGiven.edges.has(edgeIdentity('blocked-by', '12', '31')), false);
    assert.equal(asGiven.edges.has(edgeIdentity('blocked-by', '22', '32')), false);
  });
});
