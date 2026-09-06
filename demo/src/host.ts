/**
 * The host facts — the half of the design the graph cannot derive, supplied
 * by the one host this repository ships: this demo.
 *
 * `@issuegraph/viewer` takes them through `ViewerDocument.host` and prints
 * them verbatim; it has no cap, no clock and no runner of its own, so every
 * value here is the demo's. That is the seam the port exists to prove: if the
 * demo can fill it with no tracker and no backend, a real host can.
 *
 * THE CLOCK IS INJECTED. A `new Date()` inside this module would make every
 * stamp and every elapsed time a function of when the test ran; taking the
 * clock as an argument makes `hostFacts` a pure function of its inputs, and
 * the page passes the real one. Stamps are UTC — the demo has no timezone to
 * be in, and a local-time stamp is green on one machine and red on CI.
 *
 * THE COUNTS ARE TALLIED HERE, OVER THE WHOLE ORDER, because the viewer will
 * not: the document it holds may be a window (the editor's rail slices the
 * slots), and a count over a window states the reader's scroll position as a
 * fact about the order. The demo has the whole explained order, so it counts.
 */

import type { IssueRef } from '@issuegraph/store';
import type { Disagreement, HostFacts, OrderCounts, PreviewOnly, RunningJob } from '@issuegraph/viewer';

import { DEFAULT_CONCURRENCY_CAP, type ExecutorHold, type ExplainedRow, slotCount } from './order.ts';

/** The runner's job, as the demo's runner would know it. */
export interface RunningWork {
  /** The runner's phase word: `Review`. */
  readonly phase: string;
  readonly startedAt: Date;
}

export interface HostFactsInput {
  readonly rows: readonly ExplainedRow[];
  readonly holds: readonly ExecutorHold[];
  /** When the mirror was last read — the `as of` stamp. */
  readonly observedAt: Date;
  /** The clock, for the age and the elapsed time. */
  readonly now: Date;
  readonly job: RunningWork;
  readonly concurrencyCap?: number;
}

/** Past this the demo's stamp reads `stale`. A host threshold, not the package's. */
export const STALE_AFTER_MS = 10 * 60_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** `HH:MM`, in UTC, so the same clock stamps the same string everywhere. */
export function stampOf(at: Date): string {
  return at.toISOString().slice(11, 16);
}

/** `Ns` under a minute, `Nm` under an hour, `Nh Nm` beyond — the runner's own elapsed format. */
export function elapsedBetween(from: Date, to: Date): string {
  const ms = Math.max(0, to.getTime() - from.getTime());
  if (ms < MINUTE) return `${String(Math.floor(ms / 1000))}s`;
  if (ms < HOUR) return `${String(Math.floor(ms / MINUTE))}m`;
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
}

/** The relative age the stamp carries: `just now`, or `<elapsed> ago`. */
export function ageBetween(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();
  return ms < 5_000 ? 'just now' : `${elapsedBetween(from, to)} ago`;
}

/**
 * The whole-order tally the header prints.
 *
 * Counted in SLOTS, not rows: a together unit is one rank (§4.3.7), so two
 * members are one ranked thing — `slotCount` already makes that rule for the
 * demo. `held` spans both families, because the design's header counts what
 * is not running whatever the cause; the footer is where the families part.
 */
export function orderCounts(rows: readonly ExplainedRow[]): OrderCounts {
  const spine = rows.filter((row) => row.placement === 'spine');
  const footerHeld = rows.filter(
    (row) => row.placement === 'footer' && row.holds.some((hold) => hold.family === 'executor' && hold.blocking !== false),
  );
  return {
    // EVERY SPINE SLOT IS RANKED, held or not: a graph-held row keeps its
    // position and prints `—` where the number would go, which is a rank the
    // design counts (`6 ranked · 4 ready now`). Only the footer earns none.
    ranked: slotCount(spine),
    readyNow: slotCount(spine.filter((row) => row.ready)),
    held: slotCount(spine.filter((row) => !row.ready)) + slotCount(footerHeld),
  };
}

/** The one job the demo's runner is working: the executor hold marked active. */
export function runningJobs(holds: readonly ExecutorHold[], job: RunningWork, now: Date): readonly RunningJob[] {
  return holds
    .filter((hold) => hold.active === true)
    .map((hold) => ({ key: hold.ref, phase: job.phase, elapsed: elapsedBetween(job.startedAt, now) }));
}

export function hostFacts(input: HostFactsInput): HostFacts {
  const age = input.now.getTime() - input.observedAt.getTime();
  return {
    concurrencyCap: input.concurrencyCap ?? DEFAULT_CONCURRENCY_CAP,
    counts: orderCounts(input.rows),
    running: runningJobs(input.holds, input.job, input.now),
    freshness: {
      asOf: stampOf(input.observedAt),
      age: ageBetween(input.observedAt, input.now),
      stale: age > STALE_AFTER_MS,
      refresh: 'refresh',
    },
  };
}

/** The per-row facts a host knows about its own ordering engine. */
export interface IssueCaveats {
  readonly previewOnly?: PreviewOnly;
  readonly disagreement?: Disagreement;
}

/**
 * The demo's caveats, keyed by reference — a host's table, not a field on the
 * stored issue, because the store's schema is the format's and these facts
 * are the engine's. #4 declares no priority, which is the row the design gives
 * its preview-only fallback to; #14 is the row two signals disagree about.
 */
export const CAVEATS: ReadonlyMap<IssueRef, IssueCaveats> = new Map<IssueRef, IssueCaveats>([
  [
    '4',
    {
      previewOnly: {
        note: "query 3 (involves:@me) can't be evaluated in this sandbox — ranked by the unlabeled tail instead",
      },
    },
  ],
  [
    '14',
    {
      disagreement: {
        used: 'P2 (declared)',
        ignored: { carrier: 'frontmatter', value: 'priority: 3' },
      },
    },
  ],
]);
