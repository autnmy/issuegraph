/**
 * The one place a write state becomes a position.
 *
 * ## What this module is for
 *
 * `attachEdgeOverlays` draws everything an overlay can say by reusing the path's
 * own position — a halo is the path stroked wider, a ghost is the path dashed
 * differently. What it cannot draw is the half that needs a NEW position: a chip
 * on the two nodes, a cross beside the terminal, a reason beside the line, and a
 * conflict's second version on the line's perpendicular. Those travel as
 * {@link EdgeOverlay.marks}, declared here rather than half-drawn there.
 *
 * Layer 1 places them, because it is the layer that computed the layout. This
 * module is the translation that lets it do so without learning anything: it
 * turns each declared mark into an {@link EdgeMark} whose vocabulary is
 * POSITIONAL, so the viewer receives `companion` and never `conflict`.
 *
 * ## The mapping is the seam, so it lives on one table
 *
 * One entry per mark the grammar can declare, and the table is exhaustive over
 * that union rather than a switch with a default — a fifth mark added to the
 * grammar should fail to compile here, not silently stop being drawn. That is
 * the failure this whole area has had twice: a channel declared in a table and
 * rendered by nothing.
 *
 * ## The words stay on this side
 *
 * `writing…` and `✕` are this package's vocabulary — the same strings
 * `renderOverlayMark` puts in the host-facing slot — and they are handed over as
 * opaque content. A host that translates translates one vocabulary, and the
 * viewer never holds a word it could be asked to translate.
 *
 * The hue travels as a token NAME, read from the treatment table rather than
 * copied, so a retheme moves the mark and the stroke together. Where a state has
 * no hue of its own this asks for NONE, and layer 1 fills in the relationship's.
 *
 * That last clause used to say the mark "inherits the relationship's — which is
 * the same rule the dashed clone follows", and both halves were wrong. A mark is
 * a SIBLING of the edge, so it inherits the viewer's body text and not the hue
 * `.ig-edge[data-edge=…]` gives the line; and the dashed clone does not inherit
 * either — `render.ts` states its stroke inline for exactly that reason, in a
 * comment about exactly this trap. A `pending-write` chip therefore rendered
 * grey beside the red line it belonged to.
 *
 * So "no tone" is a REQUEST for the kind's hue rather than a decision to have
 * none, and the layer that owns the relationship vocabulary is the one that
 * resolves it.
 */

import type { ProjectedEdge } from '@issuegraph/store';
import type { EdgeMark, EdgeMarkPlacement } from '@issuegraph/viewer';

import {
  type EdgeOverlay,
  type OverlayMark,
  OVERLAY_TREATMENTS,
  overlayFor,
} from './grammar.ts';

/**
 * Where each declared mark goes, and what it says when it gets there.
 *
 * `glyph` is `null` for a mark whose whole form is the line — a companion is not
 * a symbol, it is the relationship drawn a second time.
 */
const MARK_PLACEMENTS: Readonly<
  Record<OverlayMark, { readonly placement: EdgeMarkPlacement; readonly glyph: string | null }>
> = Object.freeze({
  // §17b: "writing… chip on both nodes". Both, not one — an optimistic edit is
  // in flight at both ends of what it joins, and a single chip reads as a
  // property of whichever end happened to get it.
  'node-chip': { placement: 'both-ends', glyph: 'writing…' },
  // A glyph rather than a word, for the reason the edge vocabulary uses glyphs:
  // it is the non-colour channel, and it needs no translation. `marks.ts` steps
  // it clear of the terminal marker rather than over it.
  'terminal-cross': { placement: 'terminal', glyph: '✕' },
  // THE SENTENCE IS STILL THE HOST'S. What goes on the canvas is the symbol that
  // says a reason exists and where it belongs; the reason itself is keyed off
  // the store's `InvalidCode` in the panel, exactly as `renderOverlayMark`'s
  // slot does. Putting prose on a canvas would also put it outside the rail that
  // carries every readable thing about this document.
  'inline-reason': { placement: 'beside', glyph: '!' },
  'second-version': { placement: 'companion', glyph: null },
});

/**
 * The marks one overlay asks layer 1 to draw.
 *
 * Empty for an overlay with no marks, which is most of them: `selected` declares
 * none at all, and its halo is drawn from the path's own position.
 */
export function marksFor(overlay: EdgeOverlay): readonly EdgeMark[] {
  const marks: EdgeMark[] = [];

  for (const mark of overlay.marks) {
    const spec = MARK_PLACEMENTS[mark];
    // THE HUE OF THE STATE THAT DECLARED THIS MARK, not of the overlay as a
    // whole. An edge can be `selected` and `conflict` at once, and the overlay's
    // own `line` carries whichever won on precedence — so reading the tone from
    // there would paint a conflict's companion in the focus colour the moment a
    // reader clicked it.
    const owner = overlay.states.find((state) => {
      // Widened at the read, because each entry's `marks` is a literal tuple —
      // `selected`'s is empty, so an unwidened `includes` takes `never` and the
      // lookup does not compile.
      const declared: readonly OverlayMark[] = OVERLAY_TREATMENTS[state].marks;
      return declared.includes(mark);
    });
    const tone = owner === undefined ? null : OVERLAY_TREATMENTS[owner].hueToken;
    // NO ACCESSIBLE NAME, and there is no longer a field for one. The canvas is
    // `aria-hidden`, so nothing inside it can carry a name however it is marked
    // up — and the state is already announced once, on the edge's own
    // `aria-label`, by `attachEdgeOverlays`. Saying it twice is what the hidden
    // canvas exists to prevent.
    marks.push({ placement: spec.placement, glyph: spec.glyph, tone });
  }

  return marks;
}

/**
 * Every overlay's marks, keyed the way layer 1 keys its edges.
 *
 * `ProjectedEdge.id` is `edgeIdentity(field, from, to)` — the same string the
 * viewer publishes on `data-ig-group` — so the two sides agree with no
 * reconstruction and nothing to keep in step.
 *
 * An overlay with no marks is left OUT rather than mapped to an empty list: the
 * absence of a key and a key with nothing under it should not be two ways of
 * saying the same thing to a reader of this map.
 */
export function edgeMarkRequests(
  edges: readonly ProjectedEdge[],
): ReadonlyMap<string, readonly EdgeMark[]> {
  const requests = new Map<string, readonly EdgeMark[]>();
  // Folded through `overlayFor`, the same function `attachEdgeOverlays` uses, so
  // the marks drawn and the states announced cannot come from two readings of
  // one projection.
  for (const edge of edges) {
    const marks = marksFor(overlayFor(edge));
    if (marks.length === 0) continue;
    requests.set(edge.id, marks);
  }
  return requests;
}
