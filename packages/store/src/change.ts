/**
 * The re-evaluate loop: what an edit did to the order, as data.
 *
 * The design's answer to "how does an owner see cause and effect without
 * re-scanning three hundred rows" is a one-line blast-radius summary plus a
 * delta chip on ONLY the rows that changed. This module computes both — and
 * stops there.
 *
 * Two things it deliberately does not do:
 *
 * - **It does not derive an order.** It diffs two orders it is handed. A sort
 *   in here would be the second derivation the reference packages exist to
 *   avoid having.
 * - **It does not format a sentence.** The summary's counts ship as numbers, so
 *   a host writes "3 rows moved · 1 promoted" in its own words and its own
 *   language. A package that shipped the string would ship a language choice
 *   its consumers could not theme away.
 *
 * And one thing it must never grow: a timer. The design rejects the toast
 * precisely because the only evidence the edit worked disappears before it is
 * read. `lastChange` persists until the next edit or an explicit dismissal.
 */

import type { IssueRef } from './model.ts';
import type { Mutation } from './mutation.ts';
import type { OrderRow } from './source.ts';

/** How far and which way a row moved. */
export interface RankMovement {
  readonly direction: 'up' | 'down';
  /** Positions travelled. Always positive. */
  readonly by: number;
  readonly from: number;
  readonly to: number;
}

/**
 * What happened to one row. Only rows that changed get one, and a row can have
 * changed in more than one way at once — being promoted usually moves you.
 */
export interface RankDelta {
  readonly ref: IssueRef;
  readonly movement?: RankMovement;
  /** `promoted` = held became ready. `newly-held` = the reverse. */
  readonly readiness?: 'promoted' | 'newly-held';
  /** Rows entering or leaving the order entirely (a `duplicate-of`, a closure). */
  readonly presence?: 'entered' | 'left';
}

/** The blast radius, as counts a host can render into its own sentence. */
export interface ChangeCounts {
  readonly moved: number;
  readonly promoted: number;
  readonly newlyHeld: number;
  readonly entered: number;
  readonly left: number;
}

/**
 * What the last landed edit did to the order.
 *
 * An edit that lands and moves nothing still produces one, with an empty
 * `deltas` and all-zero counts. "This edit changed nothing" is a FINDING — it
 * is the one an owner auditing an encoding most needs — and reporting it as the
 * absence of a change would hide it.
 */
export interface OrderChange {
  readonly mutation: Mutation;
  readonly deltas: readonly RankDelta[];
  readonly counts: ChangeCounts;
}

function byRef(rows: readonly OrderRow[]): ReadonlyMap<IssueRef, OrderRow> {
  return new Map(rows.map((row) => [row.ref, row]));
}

/**
 * The deltas between two orders, for the rows that changed and no others.
 *
 * Rows that did not move, did not change readiness and did not enter or leave
 * appear nowhere in the result — which is what lets a viewer leave them
 * completely alone rather than re-rendering the whole rail.
 */
export function diffOrder(
  previous: readonly OrderRow[],
  next: readonly OrderRow[],
  mutation: Mutation,
): OrderChange {
  const before = byRef(previous);
  const after = byRef(next);
  const deltas: RankDelta[] = [];

  for (const row of next) {
    const was = before.get(row.ref);
    if (was === undefined) {
      deltas.push({ ref: row.ref, presence: 'entered' });
      continue;
    }
    const movement: RankMovement | undefined =
      was.rank === row.rank
        ? undefined
        : {
            direction: row.rank < was.rank ? 'up' : 'down',
            by: Math.abs(row.rank - was.rank),
            from: was.rank,
            to: row.rank,
          };
    const readiness =
      was.ready === row.ready ? undefined : row.ready ? ('promoted' as const) : ('newly-held' as const);
    if (movement === undefined && readiness === undefined) continue;
    // Keys are omitted rather than set to `undefined`: `exactOptionalPropertyTypes`
    // is on, and a host reading `'movement' in delta` must not see a key that is
    // there but empty.
    deltas.push({
      ref: row.ref,
      ...(movement === undefined ? {} : { movement }),
      ...(readiness === undefined ? {} : { readiness }),
    });
  }

  for (const row of previous) {
    if (!after.has(row.ref)) deltas.push({ ref: row.ref, presence: 'left' });
  }

  return {
    mutation,
    deltas,
    counts: {
      moved: deltas.filter((delta) => delta.movement !== undefined).length,
      promoted: deltas.filter((delta) => delta.readiness === 'promoted').length,
      newlyHeld: deltas.filter((delta) => delta.readiness === 'newly-held').length,
      entered: deltas.filter((delta) => delta.presence === 'entered').length,
      left: deltas.filter((delta) => delta.presence === 'left').length,
    },
  };
}
