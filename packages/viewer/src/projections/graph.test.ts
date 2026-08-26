import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';

import { type ViewerDocument, normalizeDocument } from '../document.ts';
import { fitLabel, layoutGraph, measureLabel } from '../layout.ts';
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
  return { issues, edges, order: { slots, excluded: [{ key: 'exc1', canonical: 'canon', reason: 'duplicate-of' as const }] } };
}

describe('the graph projection', () => {
  it('draws a node for every laid-out key', () => {
    // COUNTED, not matched on `data-ig-key`. This asserted its own name through
    // one attribute, and that spelling stopped being the whole answer when a
    // together unit's non-lead member began publishing its unit's LEAD through
    // `data-ig-group` — a pointer must not name an identity the keyboard cannot
    // reach. The member's node is still drawn; only the attribute it announces
    // itself with changed, so the key-only match reported a node that exists as
    // missing. The count is the property the name claims.
    const built = scene();
    const markup = renderMarkup(built.root);
    const laidOut = layoutGraph(normalizeDocument(fixtureDocument).document, defaultTheme).nodes;

    assert.equal(
      [...markup.matchAll(/class="ig-node-group"/g)].length,
      laidOut.size,
      'a laid-out key was drawn no node',
    );
    // AND EACH KEY IS ACCOUNTED FOR — the count alone would pass if one node
    // were drawn twice and another not at all.
    for (const key of laidOut.keys()) {
      const station =
        built.navigable.includes(key)
          ? key
          : (normalizeDocument(fixtureDocument).document.order.slots.find((slot) =>
              slot.members.includes(key),
            )?.lead ?? key);
      const attribute = station === key && built.navigable.includes(key) ? 'key' : 'group';
      assert.ok(
        markup.includes(`data-ig-${attribute}="${station}"`),
        `${key} was not drawn (expected data-ig-${attribute}="${station}")`,
      );
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

  it('fits a long title to its node instead of drawing it across the canvas', () => {
    // `boxWidth` clamps the rectangle to the column; an SVG `<text>` neither
    // wraps nor clips, so the overflow ran across the routing channel and the
    // neighbouring nodes, hiding the edges the graph exists to show. Long issue
    // titles are ordinary, so this was the common case.
    const long = 'A title far longer than any column this layout will ever allocate to a node';
    const built = scene({
      issues: [
        { key: 'n1', title: long, open: true, priority: 2 },
        { key: 'n2', title: 'N2', open: true, priority: 2 },
      ],
      edges: [{ field: 'blocked-by', from: 'n1', to: 'n2' }],
      order: { slots: [], excluded: [] },
    });
    const markup = renderMarkup(built.root);
    // SKIP THE `<title>` CHILD to reach the drawn text. It is emitted FIRST, so a
    // capture that simply took everything up to the next `<` read the empty
    // string — which is how the earlier version of this test passed while the
    // full title sat in a `title` ATTRIBUTE that SVG ignores entirely.
    const drawn = /<text[^>]*class="ig-node-label"[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)</.exec(
      markup,
    )?.[1];

    assert.ok(drawn !== undefined && drawn !== '', 'no canvas label was drawn');
    assert.ok(drawn.length < long.length, 'the full title was drawn at full width');
    assert.ok(drawn.endsWith('\u2026'), 'a shortened label must say it was shortened');
    assert.ok(long.startsWith(drawn.slice(0, -1)), 'the shortened label is not a prefix of the title');
    // NOTHING IS LOST — AND IT MUST BE A CHILD ELEMENT, NOT AN ATTRIBUTE. SVG
    // reads `<title>` as the tooltip and accessible description; a `title=`
    // attribute is inert, so asserting only that the string appears SOMEWHERE in
    // the markup is what let the inert version through.
    assert.match(markup, new RegExp(`<title>${long}</title>`), 'the full title is not in an SVG <title> child');
  });

  it('draws no canvas label wider than the node it belongs to', () => {
    // The invariant, checked against the GEOMETRY rather than against the
    // truncation code — measured with the layout's own metric, so this fails if
    // the renderer and the layout ever disagree about what fits.
    // The shipped fixture is enough to break it: two of its titles are longer
    // than the gutter column that clamps their boxes, so this defect was live on
    // this package's own sample data, not only on a contrived one.
    const document = normalizeDocument(fixtureDocument).document;
    const layout = layoutGraph(document, defaultTheme);
    const markup = renderMarkup(scene().root);
    const pad = defaultTheme.metrics['--ig-space'] as number;

    let checked = 0;
    for (const match of markup.matchAll(
      /<text[^>]*class="ig-node-label"[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)</g,
    )) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      const text = match[3] as string;
      // BOTH COORDINATES. A spine column puts several boxes at one `x`, so
      // matching on `x` alone picked the first of them and measured this label
      // against another node's width — which is how this test first reported a
      // failure on a label that fits perfectly well.
      const box = [...layout.nodes.values()].find(
        (node) => Math.abs(node.x + pad - x) < 0.01 && Math.abs(node.y + node.height / 2 - y) < 0.01,
      );
      assert.ok(box !== undefined, `no node box sits at (${String(x)}, ${String(y)})`);
      checked += 1;
      // MEASURED WITH THE LABEL'S OWN MODEL. This used to multiply
      // `text.length` by `--ig-char-width` — the MONO advance at the wrong font
      // size, and exactly the assumption #44 named — so the guard carried the
      // defect it was guarding against, and a UTF-16 length miscounted astral
      // characters on top. The wide-glyph test below is what pins the model
      // itself, against a number stated outside it.
      assert.ok(
        measureLabel(defaultTheme, text) + pad * 2 <= box.width + 0.01,
        `"${text}" needs ${String(measureLabel(defaultTheme, text) + pad * 2)}px in a ${String(box.width)}px node`,
      );
    }
    assert.ok(checked > 0, 'no canvas labels were drawn, so nothing was checked');
  });

  it('keeps an ALL-CAPITALS title inside its node, measured outside the model', () => {
    // The failure #44 named, and the one a single average cannot survive: a
    // title of wide capitals passed a count-based check and drew about 28% past
    // its box, across the routing channel and the neighbouring nodes.
    //
    // BOUNDED BY A NUMBER STATED HERE, not by the layout's own model — a test
    // that asked the model whether the model was right would prove nothing. A
    // capital `W` in a UI sans face at `--ig-font-size-small` (11px) runs about
    // 10px; that is the assumption, written where it can be argued with.
    const WIDEST_GLYPH_PX = 10;
    const width = 211.2;
    const pad = defaultTheme.metrics['--ig-space'] as number;
    const drawn = fitLabel(defaultTheme, 'W'.repeat(40), width);

    assert.ok(drawn.endsWith('\u2026'), 'a title far past its box was not truncated');
    assert.ok(
      [...drawn].length * WIDEST_GLYPH_PX + pad * 2 <= width,
      `${String([...drawn].length)} capitals need ${String([...drawn].length * WIDEST_GLYPH_PX + pad * 2)}px in a ${String(width)}px node`,
    );
  });

  it('keeps a FULL-WIDTH title inside its node — emoji and CJK', () => {
    // The classes are otherwise ASCII-only, so a glyph matching neither was
    // charged the plain average while it draws near the full font size.
    // Measured before the fix: 31 emoji "fitted" 187.2px of room and drew about
    // 341px. That is a REGRESSION on the character count this replaced, which
    // charged supplementary characters twice by accident of UTF-16 length — a
    // model has to earn that conservatism deliberately rather than inherit it.
    //
    // BOUNDED BY A NUMBER STATED HERE, like the capitals test: a full-width
    // glyph renders at about the font size, 11px at `--ig-font-size-small`.
    const FULL_WIDTH_PX = 11;
    const width = 211.2;
    const pad = defaultTheme.metrics['--ig-space'] as number;

    for (const [label, title] of [
      ['emoji', '\u{1F600}'.repeat(40)],
      ['CJK', '\u8AB2\u984C'.repeat(30)],
      ['fullwidth latin', '\uFF21\uFF22'.repeat(30)],
    ] as const) {
      const drawn = fitLabel(defaultTheme, title, width);
      assert.ok(drawn.endsWith('\u2026'), `${label}: a title far past its box was not truncated`);
      assert.ok(
        [...drawn].length * FULL_WIDTH_PX + pad * 2 <= width,
        `${label}: ${String([...drawn].length)} glyphs need ${String([...drawn].length * FULL_WIDTH_PX + pad * 2)}px in a ${String(width)}px node`,
      );
    }
  });

  it('never truncates between the halves of an astral character', () => {
    // `slice` counts UTF-16 code units, so a cut landing inside a surrogate
    // pair drew a lone surrogate — a replacement glyph immediately before the
    // ellipsis. Emoji and mathematical alphanumerics are the ordinary way a
    // title reaches this.
    //
    // SWEPT ACROSS WIDTHS, because a single width proves nothing: whether a
    // code-unit cut lands INSIDE a pair depends on the parity of the character
    // count it stops at, so one box size passes against the broken code by
    // luck. Verified — the first version of this test did exactly that.
    const label = 'A\u{1D5D4}'.repeat(40);
    let truncated = 0;
    for (let width = 60; width <= 320; width += 1) {
      const drawn = fitLabel(defaultTheme, label, width);
      if (drawn === '') continue;
      if (drawn.endsWith('\u2026')) truncated += 1;
      for (const glyph of drawn) {
        const code = glyph.codePointAt(0) ?? 0;
        assert.ok(
          code < 0xd800 || code > 0xdfff,
          `width ${String(width)} drew a lone surrogate: ${JSON.stringify(drawn)}`,
        );
      }
    }
    assert.ok(truncated > 100, `only ${String(truncated)} widths truncated, so the sweep proves little`);
  });

  it('leaves a title that already fits exactly as it is', () => {
    // Truncation must not fire on a title that fits — a label shortened when it
    // did not need to be is the same defect pointing the other way.
    const markup = renderMarkup(scene().root);
    // No `<title>` either: a label that fits carries nothing to recover, and one
    // echoing the visible text would announce it twice.
    assert.match(markup, /<text[^>]*class="ig-node-label"[^>]*>Rework the retry budget</);
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
    // THE ENCLOSURE NAMES THE UNIT, THE CONNECTOR NAMES THE PAIR. Both stay out
    // of the focus index — which is what this test is about — but they answer
    // the pointer with different subjects: clicking the enclosure selects the
    // unit, clicking the line between two members selects the edge joining them.
    assert.match(
      markup,
      new RegExp(`class="ig-connector"[^>]*data-ig-group="${edgeIdentity('together-with', '1', '2')}"`),
    );
    assert.equal(/class="ig-connector"[^>]*data-ig-key=/.test(markup), false);
    assert.ok(groupAt > enclosureAt);
    assert.match(markup, /data-ig-key="1"[^>]*tabindex="0"/);
  });

  it('gives each member PAIR in a unit its own connector identity', () => {
    // A three-member unit draws TWO connectors. Both used to carry the slot's
    // lead, so an overlay could not tell them apart and a click on either named
    // the unit — which is the one subject an editor cannot delete or retype.
    // THREE MEMBERS, not two, because a two-member unit has exactly one
    // connector and would pass this test with the old shared value.
    const threeWay: ViewerDocument = {
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
    };

    const markup = render(threeWay);
    const identities = [...markup.matchAll(/class="ig-connector" data-ig-group="([^"]+)"/g)].map(
      (match) => match[1] as string,
    );

    assert.deepEqual(identities, [
      edgeIdentity('together-with', '1', '2'),
      edgeIdentity('together-with', '2', '3'),
    ]);
    assert.equal(new Set(identities).size, 2, 'two connectors shared one identity');
  });

  it('derives connector endpoints from the members measured bounds', () => {
    // PINNED AGAINST THE LAYOUT, not against a screenshot and not against
    // hand-copied numbers. The kit's implementation note is that a hit target
    // is derived from measured bounds rather than an eyeballed offset, and a
    // literal would keep passing after the geometry moved under it — which is
    // exactly the drift the note exists to prevent.
    const normalized = normalizeDocument(heldTogetherDocument).document;
    const layout = layoutGraph(normalized, defaultTheme);
    const lead = layout.nodes.get('1');
    const partner = layout.nodes.get('2');
    assert.ok(lead !== undefined && partner !== undefined);

    const markup = render(heldTogetherDocument);
    const drawn = /class="ig-connector"[^>]*x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/.exec(
      markup,
    );
    assert.ok(drawn !== null, 'no connector was drawn');

    assert.deepEqual(drawn.slice(1, 5).map(Number), [
      lead.x + lead.width / 2,
      lead.y + lead.height,
      partner.x + partner.width / 2,
      partner.y,
    ]);

    // AND IT SPANS THE ROW GAP RATHER THAN CROSSING EITHER BOX. Members are
    // placed consecutively in one column, so the line runs from the bottom edge
    // of one to the top edge of the next; a connector that started anywhere
    // inside a node would be occluded by it and could not be clicked.
    assert.equal(Number(drawn[2]), lead.y + lead.height);
    assert.equal(Number(drawn[4]), partner.y);
    assert.ok(Number(drawn[4]) >= Number(drawn[2]), 'the connector runs back into the node above it');
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

  it('sits each rail row on the node it names, at the layout coordinates', () => {
    // Emitted as a sibling block, the ranks and stations rendered ABOVE the
    // drawing — so the reader had to hold the correspondence in their head,
    // which is the opposite of the design's claim that the spine IS the order.
    const document = normalizeDocument(fixtureDocument).document;
    const layout = layoutGraph(document, defaultTheme);
    const markup = render();

    assert.match(markup, /class="ig-stage"[^>]*--ig-stage-w:\d+px;--ig-stage-h:\d+px/);
    assert.ok(
      markup.indexOf('class="ig-stage"') < markup.indexOf('class="ig-list ig-rail"'),
      'the rail is not inside the stage',
    );

    // Scoped to the RAIL row. A bare key search finds the SVG node group first,
    // which carries the same key and no style — the assertion would then read a
    // different element than the one it is about.
    const railRows = new Map(
      [...markup.matchAll(/<li class="ig-slot ig-rail-row" data-ig-key="([^"]+)"[^>]*>/g)].map(
        (match) => [match[1] as string, match[0]],
      ),
    );
    assert.ok(railRows.size > 0, 'no rail rows were rendered');

    for (const slot of document.order.slots) {
      const box = layout.nodes.get(slot.lead);
      const row = railRows.get(slot.lead);
      if (box === undefined || row === undefined) continue;
      assert.match(
        row,
        new RegExp(`--ig-row-x:${String(box.x)}px;--ig-row-y:${String(box.y)}px`),
        `${slot.lead} is not positioned on its own node`,
      );
      assert.match(row, new RegExp(`--ig-row-w:${String(box.width)}px`));
    }
    // Every ranked slot has a row, so the loop above is not vacuous.
    for (const slot of document.order.slots.filter((candidate) => candidate.rank !== null)) {
      assert.ok(railRows.has(slot.lead), `no rail row for ranked slot ${slot.lead}`);
    }
  });

  it('labels a spine node once, in the rail, and a gutter node in the canvas', () => {
    // The rail row sits ON the spine node, so an SVG label there would print the
    // title twice — once selectable, once not.
    const markup = render();
    const labels = [...markup.matchAll(/<text class="ig-node-label"[^>]*>([^<]*)</g)].map(
      (match) => match[1] as string,
    );

    assert.ok(labels.includes('Publish the rate table'), 'the gutter node lost its label');
    assert.equal(labels.includes('Backfill the ledger'), false, 'a spine node is labelled twice');
  });

  it('labels a spine node the rail does not draw', () => {
    // The rail draws only the RANKED slots, so keying the SVG label on the
    // column rather than on the rail left a tracker-held slot as a blank
    // rectangle — no title, no hold reason, nothing.
    const markup = render();
    const labels = [...markup.matchAll(/<text class="ig-node-label"[^>]*>([^<]*)</g)].map(
      (match) => match[1] as string,
    );

    assert.ok(
      labels.includes('Rework the retry budget'),
      'the tracker-held slot rendered as a blank rectangle',
    );
    assert.equal(labels.includes('Backfill the ledger'), false, 'a railed node is labelled twice');
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
    const markup = render({ issues, edges, order: { slots: [], excluded: [] } });

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

  it('publishes NO control in the refusal, and names only actions this package supports', () => {
    // A control here could never finish the action it advertised — narrowing is
    // the host's, because this package draws exactly what it is given. So the
    // capsules are informational, and the instruction names the order list,
    // which really is complete at any size.
    const markup = render(crowdedDocument(GRAPH_NODE_BUDGET + 1));

    assert.match(markup, /class="ig-capsule"/);
    assert.equal(/<button/.test(markup), false, 'the refusal published a control again');
    assert.equal(
      /data-ig-group/.test(markup),
      false,
      'a refusal capsule carries a dispatch identity nothing can complete',
    );
    assert.equal(/Choose a component above/.test(markup), false);
    assert.match(markup, /The order list is complete at any size/);
  });

  it('returns the rail to ordinary flow when it refuses to draw', () => {
    // A refusal draws no nodes, so there is nothing to sit on — and a
    // fixed-height stage would clip the refusal block.
    const markup = render(crowdedDocument(GRAPH_NODE_BUDGET + 1));

    assert.equal(/class="ig-stage"/.test(markup), false);
    assert.equal(/ig-rail-row/.test(markup), false);
    assert.equal(/--ig-row-x/.test(markup), false);
  });

  it('groups the canvas rather than flattening it into one image', () => {
    // `role="img"` collapses every descendant into a single image node, which
    // would hide the node roles and labels that make gutter and held nodes
    // reachable at all.
    const markup = render();
    assert.match(markup, /<svg class="ig-canvas"[^>]*role="group"/);
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
