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

import { DEFAULT_CONCURRENCY_CAP, type ExplainedRow, slotCount } from './order.ts';

/**
 * The job the scenario's runner is on — a scenario fact, like its holds.
 *
 * NAMED, NOT DERIVED FROM THE HOLDS. The comp marks two issues actively
 * claimed (§6.2 rule 4 needs the claim), and only one of them is the frame's
 * `now` row; a rule that read every active claim as running would draw two.
 * The hold table says what the graph must exclude; this says what the runner
 * is doing, which is a different fact even when it names the same issue.
 */
export interface RunningWork {
  readonly ref: IssueRef;
  /** The runner's phase word: `Review`. */
  readonly phase: string;
  /** How long the job had been running when the page mounted. The clock counts on from there. */
  readonly runningForMs: number;
}

/** The running job at one moment: the scenario's fact anchored to a start time. */
export interface RunningSince {
  readonly key: IssueRef;
  readonly phase: string;
  readonly startedAt: Date;
}

/** The job's start, fixed when the page mounts so a mirror read never winds the elapsed time back. */
export function runningSince(work: RunningWork, mountedAt: Date): RunningSince {
  return { key: work.ref, phase: work.phase, startedAt: new Date(mountedAt.getTime() - work.runningForMs) };
}

export interface HostFactsInput {
  readonly rows: readonly ExplainedRow[];
  /** When the mirror was last read — the `as of` stamp. */
  readonly observedAt: Date;
  /** The clock, for the age and the elapsed time. */
  readonly now: Date;
  readonly running?: RunningSince | undefined;
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
 * demo. Every spine slot is ranked, held or not: a graph-held row keeps its
 * position and prints `—` where the number would go, which is a rank the
 * design counts (`6 ranked · 4 ready now`). `held` spans both families,
 * because the design's header counts what is not running whatever the cause;
 * the footer is where the families part. The RUNNING issue is neither: it is
 * drawn in the NOW row, not the footer, so it is not a held slot.
 */
export function orderCounts(rows: readonly ExplainedRow[], running: ReadonlySet<IssueRef> = new Set()): OrderCounts {
  const spine = rows.filter((row) => row.placement === 'spine');
  const footerHeld = rows.filter(
    (row) =>
      row.placement === 'footer' &&
      !running.has(row.issue.ref) &&
      row.holds.some((hold) => hold.family === 'executor' && hold.blocking !== false),
  );
  return {
    ranked: slotCount(spine),
    readyNow: slotCount(spine.filter((row) => row.ready)),
    held: slotCount(spine.filter((row) => !row.ready)) + slotCount(footerHeld),
  };
}

/** The NOW row's job, with the elapsed time the runner would print. */
export function runningJobs(running: RunningSince | undefined, now: Date): readonly RunningJob[] {
  if (running === undefined) return [];
  return [{ key: running.key, phase: running.phase, elapsed: elapsedBetween(running.startedAt, now) }];
}

export function hostFacts(input: HostFactsInput): HostFacts {
  const age = input.now.getTime() - input.observedAt.getTime();
  const running = runningJobs(input.running, input.now);
  return {
    concurrencyCap: input.concurrencyCap ?? DEFAULT_CONCURRENCY_CAP,
    counts: orderCounts(input.rows, new Set(running.map((job) => job.key))),
    running,
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
