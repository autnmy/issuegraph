/**
 * Graph geometry, computed — never eyeballed.
 *
 * Three columns, three jobs: the LEFT GUTTER holds open issues outside the
 * order that explain a hold, the CENTRE SPINE is the work order itself, and the
 * RIGHT GUTTER holds issues the order never works. Sequence is vertical
 * position on the spine; dependency is everything off it.
 *
 * Two rules carry most of the weight, and both come from the design's
 * implementation note rather than from taste:
 *
 *  - **Every edge endpoint is derived from a node's computed bounds.** An edge
 *    terminates ON a bound, never at a remembered offset, so a node that
 *    changes size moves its edges with it.
 *  - **Arcs stay out of the occupied x-ranges** and out of the station band.
 *    The colour-blind-safety claim rests on four redundant channels, and the
 *    terminal marker is the one that separates `decomposed-from` from
 *    `duplicate-of` — a marker hidden under an opaque card silently drops the
 *    encoding to three.
 *
 * Deterministic by construction: no measurement, no randomness, no clock. The
 * same document always produces the same coordinates, which is what lets a
 * panel whose job is to be authoritative be trusted between refreshes.
 */

import type { NormalizedDocument, ViewerEdge } from './document.ts';
import type { MetricToken, Theme } from './theme.ts';

/**
 * Custom properties carrying LAYOUT OUTPUT rather than theme input.
 *
 * A theme token is a value a host chooses; these are values this module
 * COMPUTES and writes onto individual elements, so the rail can sit on the node
 * it names without either side hard-coding a coordinate. They are declared here
 * so `styles.test.ts` can tell the two kinds apart — a `var()` naming neither a
 * theme token nor one of these is still a defect, and still fails.
 */
export const LAYOUT_PROPERTIES: readonly string[] = Object.freeze([
  '--ig-stage-w',
  '--ig-stage-h',
  '--ig-row-x',
  '--ig-row-y',
  '--ig-row-w',
  '--ig-row-h',
]);

/** Which column a node sits in. */
export type Column = 'left' | 'spine' | 'right';

export interface NodeBox {
  readonly key: string;
  readonly column: Column;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The slot this node belongs to, when it is on the spine. */
  readonly rank: number | null;
  readonly held: boolean;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface GraphLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: ReadonlyMap<string, NodeBox>;
  /** Spine keys in RANK order — the order navigation walks. */
  readonly spineOrder: readonly string[];
  /** Slot lead -> the members drawn under it, in document order. */
  readonly slotMembers: ReadonlyMap<string, readonly string[]>;
  /** The free vertical channels arcs route through. */
  readonly leftChannel: number;
  readonly rightChannel: number;
}

function metric(theme: Theme, token: MetricToken): number {
  return theme.metrics[token];
}

/**
 * A node's width follows its own contents rather than the column, so an edge
 * terminating on its bound lands where the reader sees the box end. Clamped to
 * the column so the channels stay free.
 */
function boxWidth(theme: Theme, label: string, columnWidth: number): number {
  const padding = metric(theme, '--ig-space') * 2;
  const measured = label.length * metric(theme, '--ig-char-width') + padding;
  return Math.min(columnWidth, Math.max(columnWidth / 2, measured));
}

/**
 * Assign every key that needs a box to a column.
 *
 * Totality is the requirement, not a nicety: every kept edge's endpoints must
 * have bounds or its geometry is undefined, and `normalizeDocument` has already
 * dropped the edges whose ends this document does not carry. Anything touched
 * by an edge and not on the spine therefore lands in a gutter — the right one
 * when the order deliberately never works it, the left one when it is an open
 * issue standing in the way.
 */
function assignColumns(document: NormalizedDocument): {
  spine: string[];
  left: string[];
  right: string[];
  slotMembers: Map<string, readonly string[]>;
} {
  const spine: string[] = [];
  const slotMembers = new Map<string, readonly string[]>();
  const placed = new Set<string>();
  for (const slot of document.order.slots) {
    slotMembers.set(slot.lead, slot.members);
    for (const member of slot.members) {
      if (placed.has(member)) continue;
      placed.add(member);
      spine.push(member);
    }
  }

  const neverWorked = new Set(document.order.excluded.map((exclusion) => exclusion.key));
  for (const edge of document.edges) {
    if (edge.field !== 'decomposed-from') continue;
    const origin = document.byKey.get(edge.to);
    if (origin !== undefined && !origin.open && !placed.has(edge.to)) neverWorked.add(edge.to);
  }

  const left: string[] = [];
  const right: string[] = [];
  const seen = new Set(placed);
  for (const edge of document.edges) {
    for (const end of [edge.from, edge.to]) {
      if (seen.has(end)) continue;
      seen.add(end);
      (neverWorked.has(end) ? right : left).push(end);
    }
  }
  for (const key of neverWorked) {
    if (seen.has(key)) continue;
    seen.add(key);
    right.push(key);
  }

  return { spine, left, right, slotMembers };
}

/** Lay a document out. Pure: coordinates depend only on the document and the theme. */
export function layoutGraph(document: NormalizedDocument, theme: Theme): GraphLayout {
  const rowHeight = metric(theme, '--ig-row-height');
  const gap = metric(theme, '--ig-space');
  const gutterWidth = metric(theme, '--ig-gutter-width');
  const spineWidth = metric(theme, '--ig-spine-width');
  const channelWidth = metric(theme, '--ig-gutter-width') / 2;
  // THE CANVAS RESERVES WHAT THE ENCLOSURE NEEDS. A `together-with` enclosure
  // pads clear of its members' bounds, so a unit on the first or last row drew
  // at a negative coordinate or past the bottom edge — outside the viewBox, and
  // outside the stage, which hides its overflow. Laying the whole drawing out
  // inside that margin costs nothing and removes the clip everywhere at once,
  // rather than special-casing the two rows where it happens to bite.
  const pad = metric(theme, '--ig-space-tight');

  const { spine, left, right, slotMembers } = assignColumns(document);

  const leftX = pad;
  const spineX = pad + gutterWidth + channelWidth;
  const rightX = spineX + spineWidth + channelWidth;
  const width = rightX + gutterWidth + pad;

  // The channels sit between the columns, so no arc routed through one can
  // cross an occupied x-range.
  const leftChannel = pad + gutterWidth + channelWidth / 2;
  const rightChannel = spineX + spineWidth + channelWidth / 2;

  const rankOf = new Map<string, number | null>();
  const heldOf = new Map<string, boolean>();
  for (const slot of document.order.slots) {
    for (const member of slot.members) {
      rankOf.set(member, slot.rank);
      heldOf.set(member, !slot.ready);
    }
  }

  const nodes = new Map<string, NodeBox>();
  const place = (keys: readonly string[], column: Column, x: number, columnWidth: number): void => {
    keys.forEach((key, index) => {
      const label = document.byKey.get(key)?.title ?? key;
      nodes.set(key, {
        key,
        column,
        x,
        y: pad + index * (rowHeight + gap),
        width: boxWidth(theme, label, columnWidth),
        height: rowHeight,
        rank: rankOf.get(key) ?? null,
        held: heldOf.get(key) ?? false,
      });
    });
  };

  place(spine, 'spine', spineX, spineWidth);
  place(left, 'left', leftX, gutterWidth);
  place(right, 'right', rightX, gutterWidth);

  const rows = Math.max(spine.length, left.length, right.length);
  const height = rows === 0 ? 0 : rows * (rowHeight + gap) - gap + pad * 2;

  return {
    width,
    height,
    nodes,
    spineOrder: spine,
    slotMembers,
    leftChannel,
    rightChannel,
  };
}

export interface EdgeGeometry {
  /** The SVG path. Always a quadratic through one of the free channels. */
  readonly d: string;
  readonly start: Point;
  readonly end: Point;
  /** Radians. Orients the terminal marker along the path's own tangent. */
  readonly endAngle: number;
}

/**
 * Where an edge leaves and enters, in the fraction of a box's height it uses.
 *
 * Departures leave low and arrivals enter high, so a path never runs along the
 * centre line where the readiness station sits. That is the design's
 * station-collision rule expressed as two numbers instead of a special case.
 */
const DEPART_FRACTION = 0.75;
const ARRIVE_FRACTION = 0.25;

/**
 * Which bound of `box` the edge should leave from or arrive at.
 *
 * PAIRWISE, NOT PER-COLUMN, and the difference is the whole correctness of the
 * drawing. Deciding from a box's own column alone made every spine endpoint the
 * LEFT bound — so an arc to the right gutter left the spine on its far side and
 * had to cross the node to reach its own terminal, occluding exactly the marker
 * the colour-blind-safety claim depends on.
 *
 * ON A TIE, FACE THE CHANNEL. Two nodes in the same column have the same x, so
 * "face the other" says nothing — and defaulting LEFT was right for the spine
 * only by coincidence: the left channel happens to sit left of it. For two
 * left-gutter nodes the same channel is on their RIGHT, so the default sent
 * both endpoints out of the canvas and dragged the path back across the boxes.
 * Facing the channel is the rule the spine case was an instance of, so it keeps
 * "arcs bow left of the spine" while fixing the gutter.
 */
function facingSide(box: NodeBox, other: NodeBox, channelX: number): 'left' | 'right' {
  const centre = box.x + box.width / 2;
  const otherCentre = other.x + other.width / 2;
  if (otherCentre !== centre) return otherCentre > centre ? 'right' : 'left';
  return channelX > centre ? 'right' : 'left';
}

function anchor(box: NodeBox, fraction: number, side: 'left' | 'right'): Point {
  return {
    x: side === 'left' ? box.x : box.x + box.width,
    y: box.y + box.height * fraction,
  };
}

/**
 * The geometry for one edge, derived entirely from the two boxes' bounds.
 *
 * Returns `null` when either end has no box — which `normalizeDocument` has
 * already made impossible for a kept edge, so a `null` here means a caller
 * built a layout from a different document than the edge came from. Refusing is
 * better than drawing at coordinates nobody computed.
 */
export function edgeGeometry(
  layout: GraphLayout,
  edge: ViewerEdge,
): EdgeGeometry | null {
  const from = layout.nodes.get(edge.from);
  const to = layout.nodes.get(edge.to);
  if (from === undefined || to === undefined) return null;

  // The channel is chosen FIRST, because on a same-column tie it is what
  // decides which bound each endpoint uses. A pair of spine nodes bows LEFT, as
  // the design fixes; anything touching the right gutter uses the right channel
  // so the two families never tangle.
  const usesRight = from.column === 'right' || to.column === 'right';
  const controlX = usesRight ? layout.rightChannel : layout.leftChannel;

  const start = anchor(from, DEPART_FRACTION, facingSide(from, to, controlX));
  const end = anchor(to, ARRIVE_FRACTION, facingSide(to, from, controlX));
  const controlY = (start.y + end.y) / 2;

  const round = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);
  const d = `M ${round(start.x)} ${round(start.y)} Q ${round(controlX)} ${round(controlY)} ${round(end.x)} ${round(end.y)}`;

  return {
    d,
    start,
    end,
    endAngle: Math.atan2(end.y - controlY, end.x - controlX),
  };
}

/** The box enclosing a together unit's members, padded clear of their bounds. */
export function enclosureBounds(
  layout: GraphLayout,
  members: readonly string[],
  theme: Theme,
): { x: number; y: number; width: number; height: number } | null {
  const boxes = members
    .map((member) => layout.nodes.get(member))
    .filter((box): box is NodeBox => box !== undefined);
  if (boxes.length < 2) return null;
  const pad = metric(theme, '--ig-space-tight');
  const x = Math.min(...boxes.map((box) => box.x)) - pad;
  const y = Math.min(...boxes.map((box) => box.y)) - pad;
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + pad;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + pad;
  return { x, y, width: right - x, height: bottom - y };
}
