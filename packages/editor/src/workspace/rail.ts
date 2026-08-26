/**
 * The order rail: always present, always complete, and virtualised.
 *
 * ## The asymmetry with the canvas is the design, not an inconsistency
 *
 * §17f gives the two centre zones opposite obligations. The canvas answers
 * "what surrounds this issue" and REFUSES above its budget — that is #10343's
 * scale ladder, and it is correct. The rail answers "what gets worked next" for
 * the whole backlog and must NEVER refuse. Assembling them must not average the
 * two: a rail that paginates has stopped answering its question, and a canvas
 * that tries to keep up with the rail has stopped honouring its budget.
 *
 * So virtualisation here is a requirement rather than an optimisation, and it
 * is the resolution of what reads at first like a contradiction — "complete"
 * and "windowed" at once.
 *
 * **The MODEL is complete; the WINDOW is bounded.** Every slot the host handed
 * over is held, and {@link RailWindow.addressOf} answers for every rank in the
 * order whether or not it is drawn. What is bounded is only how many rows are
 * rendered at a time. Nothing is dropped, nothing is refused, and a host that
 * scrolls asks for a different window over the same complete model.
 *
 * That is what "every rank is addressable" means, and it is the property the
 * acceptance suite drives at 312 rows.
 *
 * ## `addressOf` is a closure over a private index
 *
 * The same shape — and the same reasoning — as `AuditOverlay.rowFor`. Handing
 * out the index itself would let a JavaScript consumer mutate it, after which
 * the lookups and `total` would disagree about what the order contains, which
 * is the inconsistency this value exists to prevent. A closure cannot be
 * reached at all, and still answers in constant time.
 *
 * ## What gets windowed, and the one edge this has to drop
 *
 * Slots are sliced. ISSUES ARE NOT: `normalizeDocument` reports a slot member
 * that is not an issue, and never the reverse, so keeping the whole issue list
 * costs no diagnostic and keeps every edge on a drawn row resolvable.
 *
 * `together-with` is the exception, and it is layer 1's rule rather than a
 * choice made here: that edge draws as an ENCLOSURE around one slot's members,
 * so the viewer drops — and reports — any whose members no longer share a
 * drawn slot. Windowing can put a unit outside the window, which would emit a
 * diagnostic about a row nobody asked to see. Those edges are therefore left
 * out of the windowed document and counted on {@link RailWindow.undrawn}
 * instead, so the fact is reported as a property of the WINDOW rather than
 * leaking out as a document defect.
 */

import { edgeIdentity } from '@issuegraph/core';
import type { ViewerDocument, ViewerSlot } from '@issuegraph/viewer';

/**
 * How many rows a window holds when the host does not say.
 *
 * A round number rather than a measured one: this package has no mount and
 * therefore no viewport to measure, so any default here is a guess. It is
 * published so a host can see what it is overriding, and generous enough that
 * a first paint fills an ordinary screen.
 */
export const RAIL_WINDOW = 50;

export interface RailWindowOptions {
  /**
   * The first row to draw, as a 0-BASED offset into the order's slots.
   *
   * An offset, deliberately, and not a rank: a held slot has `rank === null`,
   * so ranks are not a coordinate you can slice on. Out-of-range values are
   * clamped rather than refused — a host that scrolls past the end gets the
   * last window, which is what a scroll container does anyway.
   */
  readonly start?: number | undefined;
  /** How many rows to draw. Defaults to {@link RAIL_WINDOW}. */
  readonly count?: number | undefined;
}

export interface RailWindow {
  /** Every slot in the order, drawn or not. The completeness claim, as a number. */
  readonly total: number;
  /** The 0-based offset of the first drawn row, after clamping. */
  readonly start: number;
  /** How many rows are drawn. Fewer than asked for at the end of the order. */
  readonly count: number;
  /** Slots before the window. A host sizes its leading spacer from this. */
  readonly before: number;
  /** Slots after the window. A host sizes its trailing spacer from this. */
  readonly after: number;
  /** The drawn slots, in order. */
  readonly rows: readonly ViewerSlot[];
  /** The document to hand the viewer: every issue, the windowed slots. */
  readonly document: ViewerDocument;
  /**
   * `together-with` edges left out because their unit is outside the window.
   *
   * Reported rather than silent: it is the one thing windowing costs, and a
   * host drawing a connector count of its own needs to know the window is not
   * the whole story.
   */
  readonly undrawn: number;
  /**
   * The slot at a rank — ANY rank in the order, drawn or not.
   *
   * This is the completeness property, and it is why the rail can be windowed
   * without ceasing to answer its question: a reader asking "what is at 287?"
   * gets an answer from a rail showing rows 1–50.
   *
   * Ranks are 1-BASED, matching what the rail renders and what a reader sees.
   * A held slot has no rank at all and is unreachable this way by construction
   * — it has no position in the sequence, which is precisely what `rank: null`
   * says.
   */
  readonly addressOf: (rank: number) => ViewerSlot | undefined;
  /** The 0-based offset of a slot's lead key, for a host scrolling to it. */
  readonly offsetOf: (key: string) => number | undefined;
}

/**
 * A finite integer, or the fallback.
 *
 * `NaN` is the one input that survives a clamp: `Math.max(0, Math.min(NaN, n))`
 * is `NaN`, so it would flow into `slice` — which yields an empty window — and
 * into `before`/`after`, which would then not sum to `total`. That is the rail
 * silently reporting an order it cannot account for, on the zone whose whole
 * contract is that it accounts for everything. `Infinity` clamps correctly and
 * is admitted; only a non-number is replaced.
 */
function finite(value: number | undefined, fallback: number): number {
  const asked = value ?? fallback;
  return Number.isNaN(asked) ? fallback : Math.trunc(asked);
}

/** Clamp a window onto an order of `total` slots. */
function clampWindow(total: number, options: RailWindowOptions): { start: number; count: number } {
  // Fractions and negatives are clamped rather than refused: this reads a
  // scroll position, and a host computing one from a measured height will hand
  // over a float sooner or later. Refusing would take the rail down over a
  // rounding error, which is the one thing it may never do.
  const count = Math.max(0, Math.min(finite(options.count, RAIL_WINDOW), total));
  const start = Math.max(0, Math.min(finite(options.start, 0), total - count));
  return { start, count };
}

/**
 * Window an order without narrowing it.
 *
 * Pure, and total over any document: there is no input that makes this throw or
 * refuse, because the rail is the zone that is not allowed to.
 */
export function railWindow(
  input: ViewerDocument,
  options: RailWindowOptions = {},
): RailWindow {
  const slots = input.order.slots;
  const total = slots.length;
  const { start, count } = clampWindow(total, options);
  const rows = slots.slice(start, start + count);

  // BUILT OVER EVERY SLOT, not the window. These are the indexes behind the two
  // lookups, and narrowing them to the window is exactly the completeness bug
  // this module exists to avoid.
  const byRank = new Map<number, ViewerSlot>();
  const offsetByKey = new Map<string, number>();
  for (const [offset, slot] of slots.entries()) {
    if (slot.rank !== null) byRank.set(slot.rank, slot);
    // FIRST WINS, matching `normalizeDocument`'s own rule for a key placed
    // twice: it keeps the earlier slot and drops the later placement. A last-
    // wins index here would send a host scrolling to a row the viewer never
    // drew.
    for (const member of slot.members) if (!offsetByKey.has(member)) offsetByKey.set(member, offset);
  }

  // Which leads are drawn, so the `together-with` rule below can ask whether a
  // unit survived the window.
  const drawnLead = new Map<string, string>();
  for (const slot of rows) for (const member of slot.members) drawnLead.set(member, slot.lead);

  const drawable = (edge: ViewerDocument['edges'][number]): boolean =>
    edge.field !== 'together-with' ||
    (drawnLead.get(edge.from) !== undefined && drawnLead.get(edge.from) === drawnLead.get(edge.to));

  const edges = input.edges.filter(drawable);

  // EXCLUSIONS ARE CARRIED WHOLE, and that is a stated bound rather than an
  // oversight. An excluded issue is one the order deliberately never works, so
  // it holds no rank — and the window slices the SEQUENCE, which exclusions are
  // not part of. Windowing them would need a second window with its own
  // coordinate, for a population that is duplicates and is small by
  // construction. A host that needs them bounded filters before calling.
  const document: ViewerDocument = {
    issues: input.issues,
    edges,
    order: { slots: rows, excluded: input.order.excluded },
  };

  // BY IDENTITY, so a document carrying the same connector twice reports one
  // drop rather than two — and counted over the edges that did NOT survive,
  // which is one pass rather than two set builds and a subtraction.
  const undrawn = new Set(
    input.edges
      .filter((edge) => edge.field === 'together-with' && !drawable(edge))
      .map((edge) => edgeIdentity(edge.field, edge.from, edge.to)),
  ).size;

  return {
    total,
    start,
    count: rows.length,
    before: start,
    after: total - start - rows.length,
    rows,
    document,
    undrawn,
    addressOf: (rank) => byRank.get(rank),
    offsetOf: (key) => offsetByKey.get(key),
  };
}
