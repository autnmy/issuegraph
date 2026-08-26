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
 * ## What gets windowed
 *
 * Slots are sliced, and the issues and edges are cut down to exactly what the
 * drawn rows need — a drawn slot's members, an exclusion's key, and the
 * endpoints of any edge a drawn row owes a badge for.
 *
 * KEEPING THE WHOLE ISSUE LIST WAS THE OBVIOUS THING AND IT WAS WRONG. See the
 * note at the filter itself for what it cost: the linear projection renders a
 * count of the keys that appear in no slot and on no edge, so every edgeless
 * issue outside the window was reported to the reader as isolated — the rail
 * describing the reader's scroll position as though it were the document.
 *
 * `together-with` keeps its own rule, and it is layer 1's rather than a choice
 * made here: that edge draws as an ENCLOSURE around one slot's members, so the
 * viewer drops — and reports — any whose members no longer share a drawn slot.
 * Those edges are left out of the windowed document and counted on
 * {@link RailWindow.undrawn} instead, so the fact is reported as a property of
 * the WINDOW rather than leaking out as a document defect.
 */

import { edgeIdentity } from '@issuegraph/core';
import type { ViewerDocument, ViewerSlot } from '@issuegraph/viewer';
import { normalizeDocument } from '@issuegraph/viewer';

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
  /** The document to hand the viewer: the windowed slots, and what they need. */
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
  raw: ViewerDocument,
  options: RailWindowOptions = {},
): RailWindow {
  // IT NORMALIZES ITS OWN INPUT, like `inspectorView` and `renderWorkspace`.
  // Every exported function in this module that takes a `ViewerDocument` now
  // does, and that is the point: the reasoning was applied to one sibling and
  // not the other, which left two public helpers with different contracts for
  // the same argument.
  //
  // Slicing RAW slots is scroll-dependent on a malformed document. Layer 1
  // keeps the FIRST placement of a key and drops the later one, so a duplicate
  // straddling the window boundary became the valid placement whenever its
  // earlier copy fell outside the slice — the visible order changing with the
  // reader's position. `renderWorkspace` normalizing first fixed that for the
  // workspace path and for nothing else; a direct caller of this still saw it.
  //
  // Idempotent, so the workspace normalizing first costs a pass and changes
  // nothing. `total` therefore counts the slots the rail can actually show,
  // which is the number a caller is asking about.
  const input = normalizeDocument(raw).document;
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

  // EVERY KEY THAT RENDERS A ROW, WHICH IS NOT THE SAME AS EVERY SLOT MEMBER.
  // Exclusions are carried whole, and layer 1 draws each one as a footer row
  // that calls `edgeBadges` for its own key — so an excluded row owes badges
  // exactly like a slot does. Built from the slots alone, an excluded issue
  // related only to an out-of-window slot lost its badge as the reader
  // scrolled, on a row that never left the screen.
  const drawnMember = new Set([
    ...rows.flatMap((slot) => slot.members),
    ...input.order.excluded.map((exclusion) => exclusion.key),
  ]);

  // AN EDGE IS KEPT WHEN A DRAWN ROW OWES A BADGE FOR IT — one endpoint on
  // screen is enough, because that row draws the badge and the other end is
  // named as text. `together-with` keeps its own rule: layer 1 draws it as an
  // ENCLOSURE around one slot's members, so an edge whose members no longer
  // share a drawn slot has nothing to draw it, and the viewer would report that
  // as a document defect rather than as a fact about the window.
  const drawable = (edge: ViewerDocument['edges'][number]): boolean =>
    edge.field === 'together-with'
      ? drawnLead.get(edge.from) !== undefined && drawnLead.get(edge.from) === drawnLead.get(edge.to)
      : drawnMember.has(edge.from) || drawnMember.has(edge.to);

  const edges = input.edges.filter(drawable);

  // ISSUES ARE WINDOWED TOO, AND AN EARLIER VERSION OF THIS GOT IT WRONG in a
  // way worth recording, because the reasoning that produced it was nearly
  // right. It kept the WHOLE issue list, justified on the grounds that
  // `normalizeDocument` reports a slot member that is not an issue and never
  // the reverse — which is true, and is about DIAGNOSTICS. It is not about what
  // gets DRAWN: the linear projection also renders a footer counting the keys
  // that appear "in no slot and on no edge", so every edgeless issue outside
  // the window was reported to the reader as an isolated issue. Windowing made
  // the rail state a falsehood about the document, quietly, with no diagnostic
  // anywhere — a justification that covered the surface it named and not the
  // one that mattered.
  //
  // So the set is exactly what the drawn rows need, and nothing beyond it:
  //
  //   - a member of a drawn slot, or
  //   - an exclusion's key, since an exclusion is a position too and the viewer
  //     drops one whose key it cannot find, or
  //   - an endpoint of a kept edge, so a badge pointing out of the window still
  //     resolves rather than being dropped with a diagnostic.
  //
  // Every issue that survives is therefore placed, excluded, or on an edge —
  // so windowing adds nothing to `isolated` and the footer goes back to
  // describing the document rather than the scroll position.
  const keep = new Set([
    ...drawnMember,
    ...input.order.excluded.map((exclusion) => exclusion.key),
    ...edges.flatMap((edge) => [edge.from, edge.to]),
  ]);

  // EXCLUSIONS ARE CARRIED WHOLE, and that is a stated bound rather than an
  // oversight. An excluded issue is one the order deliberately never works, so
  // it holds no rank — and the window slices the SEQUENCE, which exclusions are
  // not part of. Windowing them would need a second window with its own
  // coordinate, for a population that is duplicates and is small by
  // construction. A host that needs them bounded filters before calling.
  const document: ViewerDocument = {
    issues: input.issues.filter((issue) => keep.has(issue.key)),
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
