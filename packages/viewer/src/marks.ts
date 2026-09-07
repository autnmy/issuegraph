/**
 * Marks a host asks to have drawn on an edge, in a vocabulary of POSITIONS.
 *
 * ## Why this lives in layer 1 at all
 *
 * An editor draws mutation states as overlays on these edges, and most of that
 * needs no help: a halo is the path stroked wider, a ghost is the path dashed
 * differently. Neither moves, so a layer that never interprets the geometry can
 * clone a solved path and be right.
 *
 * The marks are the half that cannot work that way. A chip sits ON a node, a
 * cross sits BESIDE a terminal, a reason sits BESIDE the line, and a conflict's
 * second version sits on the line's PERPENDICULAR. Each needs a position that
 * is not the path's own, and the only layer that has one is the layer that
 * computed the layout.
 *
 * The kit says the same thing in the one crossing it declares: the together
 * connector must live here "because a click target can't be added from outside
 * without the viewer knowing where members are". The remedy there is to move the
 * DRAWING in, not to publish the coordinates out — and the same answer applies
 * for the same reason.
 *
 * ## What keeps this from making the viewer edit-aware
 *
 * The vocabulary is positional and nothing else. {@link EdgeMarkPlacement} says
 * `terminal`, never `failed`; `companion`, never `conflict`. The host maps its
 * own states onto these four, and the mapping never travels — so this module
 * cannot name a mutation state, and a reader of it cannot learn that the
 * package has an editor.
 *
 * That is the property to protect if this file grows. A placement named for
 * what it MEANS rather than where it GOES is the point at which layer 1 has
 * quietly learned layer 2's vocabulary.
 *
 * ## Content is opaque, and the tone is a token NAME
 *
 * A mark carries a glyph and an accessible label the host supplies verbatim,
 * because "✕" and "writing…" belong to whoever knows what they mean. Colour
 * travels as the NAME of a theme custom property rather than a value, which is
 * the contract the edge vocabulary already uses for its own hues: a host that
 * rethemes moves both at once, and nothing here holds a colour.
 *
 * ## The offset is derived, never chosen
 *
 * Every distance below is read from the theme, for the reason the layout module
 * states about its own geometry: a literal stays put while a host scales the
 * type around it. The companion in particular separates by the same stroke
 * width the doubled edge treatment already uses, so the two versions read as a
 * pair at any scale — the property that treatment's own comment exists to keep.
 */

import { type ElementSpec, svg } from './element.ts';
import type { EdgeGeometry, Point } from './layout.ts';
import type { Theme } from './theme.ts';

/**
 * Where a mark goes. POSITIONS, not meanings — see the module note.
 *
 * - `both-ends` — one mark at each endpoint, on the boxes the edge joins.
 * - `terminal` — beside the arriving end, stepped clear of the terminal marker.
 * - `beside` — off the curve's midpoint, on its perpendicular.
 * - `companion` — the whole line again, offset onto its perpendicular.
 */
export type EdgeMarkPlacement = 'both-ends' | 'terminal' | 'beside' | 'companion';

export interface EdgeMark {
  readonly placement: EdgeMarkPlacement;
  /** Drawn verbatim. Absent for a placement whose whole form is the line. */
  readonly glyph?: string | null;
  /** The accessible name for this mark, if it should have one of its own. */
  readonly label?: string | null;
  /** A theme custom-property NAME, e.g. `--ig-state-failed`. Never a value. */
  readonly tone?: string | null;
}

/** The class every mark carries, so a host can find them and a sheet can style them. */
export const EDGE_MARK_CLASS = 'ig-edge-mark';

/** The attribute a mark publishes its placement on. */
export const MARK_PLACEMENT_ATTRIBUTE = 'data-ig-mark';

/**
 * The unit perpendicular to the edge, at its midpoint.
 *
 * THE TANGENT OF A QUADRATIC AT ITS MIDPOINT IS ITS CHORD, exactly: differentiate
 * `(1-t)²P₀ + 2(1-t)tC + t²P₂` at `t = ½` and the control point cancels, leaving
 * `P₂ - P₀`. So "beside the line" is decided by the two endpoints alone, and the
 * channel the curve bows through cannot tilt it.
 *
 * That is what makes this safe on the case that has bitten before. Two boxes in
 * one column share an x, so the chord is VERTICAL — and a companion offset by a
 * fixed vertical step would slide ALONG such a line rather than beside it,
 * drawing a second version on top of the first. Here a vertical chord yields a
 * horizontal normal, by construction rather than by a special case.
 *
 * A zero-length chord cannot happen — `edgeGeometry` answers `null` when both
 * ends resolve to one box — but it is guarded anyway, because the alternative to
 * a guard is a `NaN` that reaches the markup as a silently undrawn mark.
 */
function normalAt(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0 };
  return { x: -dy / length, y: dx / length };
}

/** The point on the curve at `t = ½`. The control point is a quarter of it. */
function midpointOf(geometry: EdgeGeometry): Point {
  const { start, control, end } = geometry;
  return {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
  };
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * The colour a mark paints with.
 *
 * A mark that declares no tone takes the RELATIONSHIP's, never `currentColor`.
 * The two are not the same thing here: a mark is a sibling of the edge, so it
 * inherits the viewer's body text rather than the hue `.ig-edge[data-edge=…]`
 * gives the line — which would render a `pending-write` chip grey beside the
 * red line it belongs to, silently dropping the one channel that says which
 * relationship is being written.
 *
 * "No tone" therefore means "the kind's", which is what a state with no hue of
 * its own is asking for; a state that has one overrides it here.
 */
function toneOf(mark: EdgeMark, drawing: EdgeDrawing): string {
  const token = mark.tone === undefined || mark.tone === null ? drawing.hueToken : mark.tone;
  return `var(${token})`;
}

/**
 * One glyph, placed.
 *
 * `aria-hidden` unless the host gave it a label. The canvas as a whole is
 * already hidden from the accessibility tree — every node, name and tab stop is
 * carried by the HTML rail beside it — so a mark that announced itself would be
 * a second, flattened description of something already said properly. A host
 * that wants one says so by supplying a label.
 */
function glyphMark(
  at: Point,
  mark: EdgeMark,
  placement: EdgeMarkPlacement,
  identity: string,
  drawing: EdgeDrawing,
  /**
   * Which end of the glyph sits on `at`.
   *
   * `middle` centres it, which is right for a single symbol. A WORD needs
   * `start` or `end` instead, because a centred box half as wide as the word
   * reaches back over whatever the sideways offset was meant to clear — and this
   * layer renders to a string, so it can never measure a word to compensate.
   * Anchoring the near edge makes the glyph grow AWAY from the line, at any
   * length and in any font.
   */
  anchor: 'middle' | 'start' | 'end' = 'middle',
): ElementSpec | null {
  if (mark.glyph === undefined || mark.glyph === null || mark.glyph === '') return null;
  const labelled = mark.label !== undefined && mark.label !== null && mark.label !== '';
  return svg(
    'text',
    {
      class: EDGE_MARK_CLASS,
      [MARK_PLACEMENT_ATTRIBUTE]: placement,
      // THE SAME POINTER IDENTITY THE STROKE CARRIES. A mark sitting on its own
      // edge that resolved to nothing would read as the click having missed —
      // the defect the terminal marker's own identity was added to fix.
      'data-ig-group': identity,
      x: round(at.x),
      y: round(at.y),
      // Centred on the point it was given, so a caller reasons about ONE
      // position rather than about a glyph's own box.
      'text-anchor': anchor,
      'dominant-baseline': 'middle',
      fill: toneOf(mark, drawing),
      ...(labelled ? { role: 'img', 'aria-label': mark.label } : { 'aria-hidden': 'true' }),
    },
    [mark.glyph],
  );
}

/**
 * How the edge this mark decorates is DRAWN.
 *
 * Passed in rather than re-derived, because the relationship vocabulary belongs
 * to `vocabulary.ts` and a second reading of it here is the drifting copy this
 * package family objects to everywhere else.
 */
export interface EdgeDrawing {
  /** Whether the kind draws its line twice. */
  readonly doubled: boolean;
  /** The kind's own dash array, or `null` for a solid line. */
  readonly dashArray: string | null;
  /**
   * The kind's hue token, used by a mark that declares none of its own.
   *
   * A MARK CANNOT INHERIT IT, which is the whole reason this is here. Marks are
   * siblings of the edge rather than its descendants, and the hue reaches the
   * line through `.ig-edge[data-edge=…]` — a selector no mark matches — so a
   * mark left on `currentColor` resolves to the viewer's body text and not to
   * the relationship at all. `overlay/render.ts` states the hue inline on its
   * dashed clone for exactly this reason; the same trap is one element over.
   */
  readonly hueToken: string;
}

/**
 * The line again, offset onto its perpendicular.
 *
 * ONE PER STROKE THE KIND ALREADY DRAWS, and that is the correctness of it
 * rather than a nicety. A doubled relationship is two paths separated by a
 * stroke width; a single companion beside that pair is a third line, which is
 * neither of the two things a reader is being asked to compare. The doubling is
 * re-applied here from the same theme metric the edge treatment spends, so the
 * companion is the same SHAPE as the thing it doubles.
 *
 * The offset is a translation of the whole path rather than a re-solved curve:
 * a translated quadratic is congruent to its original, so the two versions are
 * the same line twice, which is what "two versions" has to mean.
 */
function companionPaths(
  geometry: EdgeGeometry,
  mark: EdgeMark,
  theme: Theme,
  identity: string,
  drawing: EdgeDrawing,
): readonly ElementSpec[] {
  const normal = normalAt(geometry.start, geometry.end);
  const stroke = theme.metrics['--ig-stroke'];
  // Clear of the original by more than the original's own doubling, or the two
  // versions merge into one thicker line at exactly the width the doubling uses.
  const gap = stroke * (drawing.doubled ? 4 : 3);
  const base = {
    class: `${EDGE_MARK_CLASS} ig-edge-companion`,
    [MARK_PLACEMENT_ATTRIBUTE]: 'companion',
    'data-ig-group': identity,
    d: geometry.d,
    fill: 'none',
    stroke: toneOf(mark, drawing),
    // THE KIND'S OWN DASH, CARRIED. A companion drops `class` like every other
    // mark, so `.ig-edge[data-edge=…]` no longer patterns it — and a SOLID
    // second version beside a dotted `duplicate-of` is not the same line twice,
    // it is a different relationship drawn beside the first. The dash is one of
    // the four redundant channels the type identity rests on, and losing it on
    // the companion loses it exactly where a reader is being asked to compare.
    'stroke-dasharray': drawing.dashArray,
    // Decoration over a rail that already carries every name.
    'aria-hidden': 'true',
  } as const;

  /** A shift of `distance` along the chord's normal, as a transform. */
  const along = (distance: number): string =>
    `translate(${round(normal.x * distance)} ${round(normal.y * distance)})`;

  if (!drawing.doubled) return [svg('path', { ...base, transform: along(gap) })];

  // THE DOUBLING RIDES THE NORMAL TOO, and the first version of this did not.
  //
  // It separated the pair with `translate(0 ±stroke)` — copied from the edge
  // treatment, which doubles on the global y-axis. That is right for the shapes
  // the viewer happens to draw and wrong here for the same reason the whole
  // module exists: on a VERTICAL chord the y-axis runs ALONG the line, so the
  // two companion strokes slid over each other and drew as one.
  //
  // A vertical chord is the ordinary same-column case, not a corner, so this was
  // the recorded round-4 failure reintroduced inside the change that claims to
  // retire it — and it survived a test asserting the pair's COUNT, because two
  // strokes were emitted and they simply coincided.
  return [
    svg('path', { ...base, transform: along(gap - stroke) }),
    svg('path', { ...base, transform: along(gap + stroke) }),
  ];
}

/**
 * Draw the marks a host asked for on one edge.
 *
 * Takes the geometry the projection already solved, so this adds no layout pass
 * and cannot disagree with the line it decorates.
 */
export function edgeMarkSpecs(
  marks: readonly EdgeMark[],
  geometry: EdgeGeometry,
  theme: Theme,
  identity: string,
  drawing: EdgeDrawing,
): readonly ElementSpec[] {
  const specs: ElementSpec[] = [];

  for (const mark of marks) {
    switch (mark.placement) {
      case 'both-ends': {
        // OFF THE LINE, at both ends, and the offset is not decoration.
        //
        // An endpoint is a point on a node's bound, which is also exactly where
        // the terminal marker sits at the arriving end — so a chip drawn ON the
        // endpoint lands on the arrowhead. Measured before this offset existed:
        // five pixels between their centres, which is a collision, on the one
        // channel that carries the relationship's type without colour.
        //
        // Pushed onto the chord's perpendicular, both chips clear the line and
        // the marker at once, and the pair stays symmetric — the same sideways
        // step at each end, so the two read as one state rather than as two
        // marks that happen to share a colour.
        const normal = normalAt(geometry.start, geometry.end);
        const aside = theme.metrics['--ig-terminal-width'] + theme.metrics['--ig-stroke'] * 4;
        const shift = (point: Point): Point => ({
          x: point.x + normal.x * aside,
          y: point.y + normal.y * aside,
        });
        // Grown outward from the line rather than centred on the offset point.
        // The chip is a WORD, and a centred word reaches back across the line it
        // was moved off — which is how it kept landing on the arrowhead.
        const anchor = normal.x >= 0 ? 'start' : 'end';
        const at = glyphMark(shift(geometry.start), mark, 'both-ends', identity, drawing, anchor);
        const to = glyphMark(shift(geometry.end), mark, 'both-ends', identity, drawing, anchor);
        if (at !== null) specs.push(at);
        if (to !== null) specs.push(to);
        break;
      }
      case 'terminal': {
        // BESIDE THE TERMINAL, AND THE SIDEWAYS STEP IS THE PART THAT WORKS.
        //
        // The arrowhead is one of the four redundant channels the type identity
        // rests on — the one that carries the type without colour — so a mark
        // may sit next to it and must never sit on it.
        //
        // Stepping BACK along the tangent alone does not achieve that, and it
        // measurably did not: a glyph is centred on the point it is given and
        // has a width of its own, so backing off by the marker's own length put
        // the glyph's box over the marker's tail. This layer renders to a string
        // and can never measure a glyph, so any clearance derived from the
        // glyph's size would be a guess.
        //
        // The perpendicular is what actually separates them: offset sideways by
        // more than the marker's full width and the glyph clears it whatever its
        // own width turns out to be, because the two no longer share a line. The
        // step back stays, so the mark still reads as belonging to the arrowhead
        // rather than floating past the tip.
        //
        // Both distances are theme data, and the perpendicular is the one at the
        // END — the tangent there — rather than the chord's, because this mark
        // is about the arrival and not about the line as a whole.
        const stroke = theme.metrics['--ig-stroke'];
        const back = theme.metrics['--ig-terminal-length'] + stroke;
        const aside = theme.metrics['--ig-terminal-width'] + stroke * 4;
        const cos = Math.cos(geometry.endAngle);
        const sin = Math.sin(geometry.endAngle);
        const at: Point = {
          x: geometry.end.x - cos * back - sin * aside,
          y: geometry.end.y - sin * back + cos * aside,
        };
        const spec = glyphMark(at, mark, 'terminal', identity, drawing);
        if (spec !== null) specs.push(spec);
        break;
      }
      case 'beside': {
        const normal = normalAt(geometry.start, geometry.end);
        const gap = theme.metrics['--ig-stroke'] * 3;
        const mid = midpointOf(geometry);
        const spec = glyphMark(
          { x: mid.x + normal.x * gap, y: mid.y + normal.y * gap },
          mark,
          'beside',
          identity,
          drawing,
        );
        if (spec !== null) specs.push(spec);
        break;
      }
      case 'companion':
        specs.push(...companionPaths(geometry, mark, theme, identity, drawing));
        break;
    }
  }

  return specs;
}
