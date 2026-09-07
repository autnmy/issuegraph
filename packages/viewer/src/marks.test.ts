import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ElementSpec, renderMarkup } from './element.ts';
import type { EdgeGeometry, Point } from './layout.ts';
import {
  EDGE_MARK_CLASS,
  MARK_PLACEMENT_ATTRIBUTE,
  type EdgeDrawing,
  type EdgeMark,
  edgeMarkSpecs,
} from './marks.ts';
import { defaultTheme } from './theme.ts';

const IDENTITY = 'blocked-by|a|b';

/** A solid, single-stroke relationship — the ordinary case. */
const SOLID: EdgeDrawing = { doubled: false, dashArray: null, hueToken: '--ig-edge-blocked-by' };
const DOUBLED: EdgeDrawing = { ...SOLID, doubled: true };
const DOTTED: EdgeDrawing = { ...SOLID, dashArray: '1 3' };

/**
 * A geometry whose chord is VERTICAL, which is the case the companion has to
 * survive: two boxes in one column share an x, so this is the ordinary shape of
 * a spine-to-spine edge rather than a corner case.
 */
function verticalGeometry(): EdgeGeometry {
  const start: Point = { x: 400, y: 300 };
  const end: Point = { x: 400, y: 100 };
  const control: Point = { x: 320, y: 200 };
  return {
    d: 'M 400.00 300.00 Q 320.00 200.00 400.00 100.00',
    start,
    end,
    control,
    endAngle: Math.atan2(end.y - control.y, end.x - control.x),
  };
}

function attrsOf(spec: ElementSpec): Readonly<Record<string, unknown>> {
  return spec.attrs ?? {};
}

function marked(placement: EdgeMark['placement'], glyph: string | null = '✕'): EdgeMark {
  return { placement, glyph, label: null, tone: null };
}

describe('a mark is placed by the layer that computed the layout', () => {
  it('draws one mark at each end for both-ends, and only one for the rest', () => {
    const geometry = verticalGeometry();
    const both = edgeMarkSpecs([marked('both-ends')], geometry, defaultTheme, IDENTITY, SOLID);
    const beside = edgeMarkSpecs([marked('beside')], geometry, defaultTheme, IDENTITY, SOLID);

    // §17b: "writing… chip on BOTH nodes". One chip reads as a property of
    // whichever end happened to get it, which is the opposite of what an edit
    // in flight between two issues means.
    assert.equal(both.length, 2);
    assert.equal(beside.length, 1);
  });

  it('publishes the placement and the edge identity on every mark', () => {
    const specs = edgeMarkSpecs(
      [marked('both-ends'), marked('terminal'), marked('beside'), marked('companion', null)],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.ok(specs.length > 0);
    for (const spec of specs) {
      const attrs = attrsOf(spec);
      // The identity is a POINTER identity, and a mark sitting on its own edge
      // that resolved to nothing would read as the click having missed — the
      // defect the terminal marker's own identity was added to fix.
      assert.equal(attrs['data-ig-group'], IDENTITY);
      assert.ok(String(attrs['class']).includes(EDGE_MARK_CLASS));
      assert.ok(typeof attrs[MARK_PLACEMENT_ATTRIBUTE] === 'string');
    }
  });

  it('offsets a mark PERPENDICULAR to a vertical chord, never along it', () => {
    // THE REGRESSION THE DESIGN RECORD ENDS ON, pinned. Four review rounds each
    // found a different way a companion drawn without the geometry goes wrong,
    // and the last was an offset that slid ALONG a line that happened to run
    // vertically — drawing the second version on top of the first, which is the
    // one thing a second version must not do.
    //
    // A vertical chord has a HORIZONTAL normal, so the check is that the shift
    // has an x and no y.
    const [companion] = edgeMarkSpecs(
      [marked('companion', null)],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.ok(companion !== undefined);
    const transform = String(attrsOf(companion)['transform']);
    const match = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(transform);
    assert.ok(match !== null, `no translate in ${transform}`);
    assert.notEqual(Number(match[1]), 0, 'a vertical chord must be cleared sideways');
    assert.equal(Number(match[2]), 0, 'a shift along the line draws one version on the other');
  });

  it('draws as many companion strokes as the relationship draws originals', () => {
    // A doubled relationship is two paths. A single companion beside that pair
    // is a THIRD line, which is neither of the two things a reader is being
    // asked to compare — and the design record names exactly that as one of the
    // rounds it already paid for.
    const geometry = verticalGeometry();
    const single = edgeMarkSpecs([marked('companion', null)], geometry, defaultTheme, IDENTITY, SOLID);
    const doubled = edgeMarkSpecs([marked('companion', null)], geometry, defaultTheme, IDENTITY, DOUBLED);
    assert.equal(single.length, 1);
    assert.equal(doubled.length, 2);
  });

  it('keeps the companion the same shape as the line it doubles', () => {
    // A TRANSLATION, not a re-solved curve: a translated quadratic is congruent
    // to its original, so the two versions are the same line twice — which is
    // what "two versions" has to mean.
    const geometry = verticalGeometry();
    const [companion] = edgeMarkSpecs(
      [marked('companion', null)],
      geometry,
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.ok(companion !== undefined);
    assert.equal(attrsOf(companion)['d'], geometry.d);
  });

  it('steps a terminal mark clear of the arrowhead on BOTH axes', () => {
    // The terminal marker is one of the four redundant channels the type
    // identity rests on — the one that survives without colour — so a mark may
    // sit beside it and must never sit on it.
    //
    // Stepping back along the tangent alone did not achieve that, measurably: a
    // glyph is centred on its point and has a width of its own, and this layer
    // renders to a string and can never measure one. So the sideways step is
    // what does the work, and this pins that it exists.
    const geometry = verticalGeometry();
    const [cross] = edgeMarkSpecs([marked('terminal')], geometry, defaultTheme, IDENTITY, SOLID);
    assert.ok(cross !== undefined);
    const attrs = attrsOf(cross);
    const x = Number(attrs['x']);
    const y = Number(attrs['y']);
    assert.notEqual(x, geometry.end.x, 'a mark on the terminal occludes it');
    assert.notEqual(y, geometry.end.y);
    // Clear by more than the marker's own width, so the two cannot meet
    // whatever the glyph turns out to be.
    const away = Math.hypot(x - geometry.end.x, y - geometry.end.y);
    assert.ok(
      away > defaultTheme.metrics['--ig-terminal-width'],
      `only ${String(away)} from the terminal`,
    );
  });

  it('grows a worded chip AWAY from the line rather than centring it', () => {
    // A centred box half as wide as the word reaches back across the line the
    // sideways offset moved it off, which is how the chip kept landing on the
    // arrowhead. Anchoring the near edge makes it grow outward at any length
    // and in any font — the only fix available to a layer that cannot measure.
    const [chip] = edgeMarkSpecs(
      [{ placement: 'both-ends', glyph: 'writing…', label: null, tone: null }],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.ok(chip !== undefined);
    assert.notEqual(attrsOf(chip)['text-anchor'], 'middle');
  });

  it('takes the tone as a token NAME and never as a colour', () => {
    // The same contract the edge hues already use: a host that rethemes moves
    // the mark and the stroke together, and nothing here holds a value.
    const [chip] = edgeMarkSpecs(
      [{ placement: 'beside', glyph: '!', label: null, tone: '--ig-state-invalid' }],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.ok(chip !== undefined);
    assert.equal(attrsOf(chip)['fill'], 'var(--ig-state-invalid)');
  });

  it('draws nothing for a mark with no glyph but a glyph placement', () => {
    // `companion`'s whole form is the line, so it carries no glyph. The three
    // point placements carry one, and a caller that supplies none gets nothing
    // rather than an empty element that styles as a gap.
    const specs = edgeMarkSpecs(
      [marked('beside', null), marked('terminal', null), marked('both-ends', null)],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.deepEqual(specs, []);
  });

  it('stays out of the accessibility tree unless a host names the mark', () => {
    // The canvas is `aria-hidden` and the rail beside it carries every name, so
    // an unlabelled mark that announced itself would be a second, flattened
    // description of something already said properly.
    const [quiet] = edgeMarkSpecs([marked('beside', '!')], verticalGeometry(), defaultTheme, IDENTITY, SOLID);
    assert.ok(quiet !== undefined);
    assert.equal(attrsOf(quiet)['aria-hidden'], 'true');
    assert.equal(attrsOf(quiet)['aria-label'], undefined);

    const [named] = edgeMarkSpecs(
      [{ placement: 'beside', glyph: '!', label: 'refused', tone: null }],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.ok(named !== undefined);
    assert.equal(attrsOf(named)['aria-label'], 'refused');
    assert.equal(attrsOf(named)['aria-hidden'], undefined);
  });

  it('carries the relationship’s own dash onto every companion stroke', () => {
    // A companion drops `class` like every mark, so `.ig-edge[data-edge=…]` no
    // longer patterns it. Left alone, a SOLID second version draws beside a
    // dotted `duplicate-of` — which is not the same line twice, it is a
    // different relationship drawn next to the first, with the dash channel
    // silently spent exactly where a reader is comparing two versions.
    const geometry = verticalGeometry();
    for (const drawing of [DOTTED, { ...DOTTED, doubled: true }]) {
      const specs = edgeMarkSpecs([marked('companion', null)], geometry, defaultTheme, IDENTITY, drawing);
      assert.ok(specs.length > 0);
      for (const spec of specs) {
        assert.equal(attrsOf(spec)['stroke-dasharray'], DOTTED.dashArray);
      }
    }
    // And a solid relationship stays solid rather than gaining a pattern.
    const [solid] = edgeMarkSpecs([marked('companion', null)], geometry, defaultTheme, IDENTITY, SOLID);
    assert.ok(solid !== undefined);
    assert.equal(attrsOf(solid)['stroke-dasharray'], null);
  });

  it('paints a mark with no tone in the RELATIONSHIP’s hue, never currentColor', () => {
    // A mark is a SIBLING of the edge, not a descendant, so it inherits the
    // viewer's body text rather than the hue `.ig-edge[data-edge=…]` gives the
    // line. `currentColor` therefore renders a `pending-write` chip grey beside
    // the red line it belongs to, dropping the channel that says WHICH
    // relationship is being written.
    //
    // `overlay/render.ts` states its dashed clone's stroke inline for exactly
    // this reason, in a comment about exactly this trap — one element over.
    const specs = edgeMarkSpecs(
      [marked('beside', '!'), marked('companion', null)],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.ok(specs.length > 0);
    for (const spec of specs) {
      const attrs = attrsOf(spec);
      // A glyph paints with `fill` and a line with `stroke` — the companion sets
      // `fill: none` deliberately, so read the one that carries the colour for
      // this element rather than the first that happens to be set.
      const painted = spec.tag === 'text' ? attrs['fill'] : attrs['stroke'];
      assert.equal(painted, `var(${SOLID.hueToken})`, `${String(spec.tag)} painted ${String(painted)}`);
    }
  });

  it('lets a state that HAS a hue override the relationship’s', () => {
    const [spec] = edgeMarkSpecs(
      [{ placement: 'beside', glyph: '!', label: null, tone: '--ig-state-invalid' }],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      SOLID,
    );
    assert.ok(spec !== undefined);
    assert.equal(attrsOf(spec)['fill'], 'var(--ig-state-invalid)');
  });

  it('names no write state anywhere in what it draws', () => {
    // THE PROPERTY THAT KEEPS THIS LAYER EDIT-UNAWARE, checked on the output
    // rather than asserted in the module note. The vocabulary that crosses is
    // positional — `companion`, never `conflict` — so a state word appearing in
    // this markup means the seam has moved, whatever the types still say.
    //
    // The glyph and tone are excluded from the check by being supplied here as
    // neutral values: they are the host's opaque content, and a host that puts
    // its own word in one has not made this module aware of anything.
    const markup = edgeMarkSpecs(
      [marked('both-ends', '·'), marked('terminal', '·'), marked('beside', '·'), marked('companion', null)],
      verticalGeometry(),
      defaultTheme,
      IDENTITY,
      DOUBLED,
    )
      .map((spec) => renderMarkup(spec))
      .join('');
    for (const state of ['pending-write', 'invalid', 'failed', 'conflict', 'selected']) {
      assert.equal(markup.includes(state), false, `the drawing names ${state}`);
    }
  });
});
