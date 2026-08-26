/**
 * What the last edit did to the order, as a view model.
 *
 * `@issuegraph/store` already computes the change — `diffOrder` ships
 * {@link OrderChange}, and it deliberately stops at COUNTS rather than a
 * sentence so a host writes "3 rows moved · 1 promoted" in its own words. This
 * module keeps that property. It turns the counts into the parts a summary is
 * built from, and it decides which rendered row each delta belongs to. It
 * writes no sentence and holds no state.
 *
 * ## Placement, and why it is asked of the scene rather than of the document
 *
 * A {@link RankDelta} names an ISSUE. A row is keyed by its slot's LEAD, and a
 * `together-with` unit is one row whose partners get none — so a delta about a
 * partner has no row of its own to sit on. `Scene.stationOf` is exactly the
 * "key -> the key that represents it in this projection" map, and
 * `Scene.navigable` is every key the projection actually drew. Asking the scene
 * means the answer comes from the render that just happened, rather than from a
 * second walk over the document that could disagree with it.
 *
 * ## A delta that reaches no row is REPORTED, never dropped
 *
 * With one exception, and it is the interesting one: a delta whose `presence`
 * is `left` describes a row that has gone from the order, so its absence from
 * the rail is the fact it is reporting rather than a failure to place it. Its
 * count still reaches the summary, which is where the reader learns it
 * happened. Everything else that fails to place is a diagnostic — an absence
 * rendered as a value licenses a false conclusion, and the false conclusion
 * here would be "nothing happened to that issue".
 */

import type { ChangeCounts, Mutation, MutationId, OrderChange, OrderStatus, RankDelta } from '@issuegraph/store';
import type { Scene } from '@issuegraph/viewer';

/**
 * The facets a change can have, in the order a summary reads them.
 *
 * Declared as the tuple and narrowed from it, so the list and the type cannot
 * drift: adding a facet here is what makes {@link COUNT_OF} and a host's
 * {@link ./words.ts ChangeWords} fail to compile until both carry it.
 */
export const CHANGE_FACETS = Object.freeze([
  'moved',
  'promoted',
  'newly-held',
  'entered',
  'left',
] as const);

export type ChangeFacet = (typeof CHANGE_FACETS)[number];

/**
 * Where each facet's number lives on {@link ChangeCounts}.
 *
 * A table rather than a switch, and rather than a name transform: `newly-held`
 * and `newlyHeld` are the same fact spelled for two different readers — one a
 * DOM attribute, one a TypeScript field — and deriving either from the other
 * would put a string manipulation between the count and the thing it counts.
 * `Record<ChangeFacet, …>` is what makes the table exhaustive at compile time.
 */
const COUNT_OF: Readonly<Record<ChangeFacet, (counts: ChangeCounts) => number>> = Object.freeze({
  moved: (counts) => counts.moved,
  promoted: (counts) => counts.promoted,
  'newly-held': (counts) => counts.newlyHeld,
  entered: (counts) => counts.entered,
  left: (counts) => counts.left,
});

/** One facet that actually happened. Never carries a zero. */
export interface SummaryPart {
  readonly facet: ChangeFacet;
  readonly count: number;
}

/** The blast radius of one landed edit, ready to be worded by a host. */
export interface ChangeSummary {
  readonly mutationId: MutationId;
  /** Which edit this was. The host names it; this only says which kind. */
  readonly op: Mutation['op'];
  /** Every facet with a non-zero count, in {@link CHANGE_FACETS} order. */
  readonly parts: readonly SummaryPart[];
  /**
   * The edit landed and moved nothing.
   *
   * Named rather than left to `parts.length === 0`, because it is a FINDING —
   * the one an owner auditing an encoding most needs — and a renderer that
   * reads it as an empty list draws nothing at all. `change.ts` says the same
   * thing from the other end: reporting it as the absence of a change would
   * hide it.
   */
  readonly unchanged: boolean;
}

/**
 * One rendered row, and everything that changed on it.
 *
 * `deltas` IS A LIST BECAUSE A ROW CAN BE MORE THAN ONE ISSUE. A `together-with`
 * unit is a single row keyed by its lead, while the store's order carries a row
 * per REF — so when a unit moves, every member produces its own delta and all of
 * them resolve to that one key. One chip per delta would put two chips on one
 * row, stacked on top of each other by any mount that positions them by key.
 * Grouping here means the collision cannot be built rather than being left for a
 * host to notice.
 */
export interface PlacedChip {
  /** The key the rail drew, which is a slot's lead — not always a delta's ref. */
  readonly key: string;
  /** In the order the change reported them. Never empty. */
  readonly deltas: readonly RankDelta[];
}

export interface ReevaluateView {
  /** `null` when no edit has landed since the last dismissal. */
  readonly summary: ChangeSummary | null;
  /** Only rows that changed, and only ones the rail actually drew. */
  readonly chips: readonly PlacedChip[];
  /** A write is in flight, so the order shown is the one from before it. */
  readonly held: boolean;
  readonly diagnostics: readonly string[];
}

/** The parts of a change, largest structure first: counts in, zeroes out. */
export function summaryOf(change: OrderChange): ChangeSummary {
  const parts = CHANGE_FACETS.map((facet) => ({
    facet,
    count: COUNT_OF[facet](change.counts),
  })).filter((part) => part.count > 0);

  return {
    mutationId: change.mutation.mutationId,
    op: change.mutation.op,
    parts,
    unchanged: parts.length === 0,
  };
}

/**
 * The whole re-evaluate view for one render.
 *
 * `change` is the store's `lastChange`, which is absent until an edit lands and
 * again once `dismissChange()` is called. Absent means there is nothing to
 * report — NOT that nothing happened, which is what {@link ChangeSummary.unchanged}
 * says.
 */
export function reevaluateView(
  change: OrderChange | null | undefined,
  scene: Scene,
  status: OrderStatus,
): ReevaluateView {
  const held = status === 'held';
  if (change === null || change === undefined) {
    return { summary: null, chips: [], held, diagnostics: [] };
  }

  const drawn = new Set(scene.navigable);
  // Insertion-ordered, so the chips come out in the order the change reported
  // them and a row that changed twice still appears once, where it first did.
  const byKey = new Map<string, RankDelta[]>();
  const diagnostics: string[] = [];

  for (const delta of change.deltas) {
    const key = scene.stationOf.get(delta.ref) ?? delta.ref;
    if (drawn.has(key)) {
      const group = byKey.get(key);
      if (group === undefined) byKey.set(key, [delta]);
      else group.push(delta);
      continue;
    }
    // A row that LEFT the order is expected to be missing from the rail that
    // renders the order it left. Its count still reaches the summary.
    if (delta.presence === 'left') continue;
    diagnostics.push(`${delta.ref} changed, but no row draws it; its chip has nowhere to attach`);
  }

  const chips = [...byKey].map(([key, deltas]) => ({ key, deltas }));
  return { summary: summaryOf(change), chips, held, diagnostics };
}
