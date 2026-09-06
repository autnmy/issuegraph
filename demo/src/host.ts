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
import type {
  Adoption,
  Disagreement,
  HostFacts,
  OrderCounts,
  PreviewOnly,
  RunningJob,
  ViewerCondition,
} from '@issuegraph/viewer';

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
  /** Which of the sandbox's states the panel is being drawn in. */
  readonly state?: DemoStateName | undefined;
  /** How much of this host's backlog declares relationships, and what to say about it. */
  readonly adoption?: Adoption | undefined;
  /** What backlog this is. §17a's header prints it; the viewer never invents one. */
  readonly identity?: string | undefined;
  /**
   * The word on §17a's way into the first pass, or nothing.
   *
   * OMITTED WHEN THERE IS NOTHING TO RUN, which is a host decision and not a
   * rendering one: whether a backlog has a first pass worth opening is something
   * only the host's own detector can answer, so an entry is drawn only when this
   * host has candidates to offer.
   */
  readonly firstPass?: string | undefined;
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

/**
 * The states the sandbox can draw its panel in.
 *
 * ORTHOGONAL TO THE DOCUMENT, because that is what they are: a repository can
 * be importing, be unreadable, or have nothing eligible whatever its backlog
 * looks like. Folding them into the document control would multiply four states
 * across every scenario and turn a list into a matrix.
 *
 * THREE OF THEM MAP ONTO A CONDITION AND ONE DOES NOT. `stale` is not a
 * condition at all — it is the freshness stamp past its threshold — so it is
 * produced by moving the clock rather than by setting a flag, which keeps the
 * stamp a function of the clock the way every other reading of it is.
 */
export const DEMO_STATE_NAMES = Object.freeze(['live', 'importing', 'empty', 'error', 'stale'] as const);
export type DemoStateName = (typeof DEMO_STATE_NAMES)[number];

/** The control's label for each state — host chrome, so the page's own words. */
export const DEMO_STATE_LABELS: Readonly<Record<DemoStateName, string>> = Object.freeze({
  live: 'live',
  importing: 'first import',
  empty: 'nothing eligible',
  error: 'index unreadable',
  stale: 'stale mirror',
});

/**
 * How far back each state's last successful read was.
 *
 * NOT ONLY `stale`. An order the panel calls "the last one that could be read"
 * is by definition not current, and an import that has not finished has not
 * finished reading — so a fresh `as of` stamp beside either sentence would have
 * the two halves of the panel disagreeing about whether anything was read.
 */
const OBSERVED_SHIFT_MS: Readonly<Record<DemoStateName, number>> = Object.freeze({
  live: 0,
  importing: 2 * MINUTE,
  empty: 0,
  error: 5 * HOUR,
  stale: STALE_AFTER_MS + 7 * MINUTE,
});

/**
 * The sentences each state prints, in the host's own words.
 *
 * EVERY ONE OF THEM IS THE HOST'S, and that is not a style choice: the package
 * may not name a product, and more to the point these are claims about THIS
 * host's runner — that it stays armed, that it carries on from its last known
 * order. A rendering package has no standing to make them.
 */
const DEMO_CONDITIONS: Readonly<Record<DemoStateName, ViewerCondition | undefined>> = Object.freeze({
  live: undefined,
  importing: Object.freeze({
    kind: 'importing',
    headline: 'Building the local index',
    caution: 'The order below is real but incomplete — ranks will change as the rest arrive.',
    progress: '412 of ~1,200 issues · relationships resolve last',
    // ◔ RATHER THAN THE FRAME'S ◐, and the reason is a collision the frame does
    // not have: ◐ already means `preview-only` in this package's badge
    // vocabulary, and a glyph that means two things is a glyph that means
    // neither. The quarter-filled circle reads the same way and is unspoken for.
    glyph: '◔',
  }),
  empty: Object.freeze({
    kind: 'empty',
    headline: 'Nothing is eligible right now',
    reason: 'No open issue matches your pick order.',
    assurance: 'The pipeline stays armed and will take the first one that does.',
    action: Object.freeze({ label: 'Review pick order' }),
  }),
  error: Object.freeze({
    kind: 'error',
    headline: 'The index could not be read',
    assurance: 'Your settings are safe, and the pipeline continues on its last known order.',
    retry: 'Retry',
    glyph: '▲',
  }),
  stale: undefined,
});

/**
 * Whether this state has an order to show at all.
 *
 * `empty` IS THE ONE STATE THAT IS NOT ORTHOGONAL TO THE DOCUMENT. `importing`
 * and `error` both leave a real order standing and say something about it;
 * `empty` asserts there is none. Drawing its sentence over a populated order is
 * a panel contradicting itself — which `normalizeDocument` now reports out loud
 * — so a host that says nothing is eligible shows nothing, which is also what
 * the frame draws.
 */
export function showsOrder(state: DemoStateName | undefined): boolean {
  return state !== 'empty';
}

/**
 * Whether a landed read refutes what this state claims.
 *
 * ONE RULE OVER THE TABLE ABOVE, rather than a lift per state. `importing`,
 * `error` and `stale` all say something about READING — the index is still
 * being read, could not be read, was last read a while ago — and each backdates
 * the stamp to say it. So the states a successful read contradicts are exactly
 * the states that backdate it, which the table already knows; `live` and
 * `empty` claim nothing about a read and are not lifted by one.
 *
 * Written as a rule because the alternative was arriving one state at a time:
 * `stale` was lifted, then `error` was found still holding a five-hour-old
 * stamp over a read that had just succeeded, and `importing` was next.
 */
export function liftedByARead(state: DemoStateName): boolean {
  return OBSERVED_SHIFT_MS[state] > 0;
}

/** The moment this state's mirror was last read, from the page's own clock. */
export function observedFor(state: DemoStateName | undefined, observedAt: Date): Date {
  return state === undefined || OBSERVED_SHIFT_MS[state] === 0
    ? observedAt
    : new Date(observedAt.getTime() - OBSERVED_SHIFT_MS[state]);
}

export function hostFacts(input: HostFactsInput): HostFacts {
  // THE STATE MOVES THE READ, NOT THE FLAG. `stale` is what the stamp says when
  // the last successful read is old enough, so the state supplies the read and
  // the same comparison that has always produced the word produces it here.
  const observedAt = observedFor(input.state, input.observedAt);
  const age = input.now.getTime() - observedAt.getTime();
  const running = runningJobs(input.running, input.now);
  const condition = input.state === undefined ? undefined : DEMO_CONDITIONS[input.state];
  return {
    concurrencyCap: input.concurrencyCap ?? DEFAULT_CONCURRENCY_CAP,
    counts: orderCounts(input.rows, new Set(running.map((job) => job.key))),
    running,
    freshness: {
      asOf: stampOf(observedAt),
      age: ageBetween(observedAt, input.now),
      stale: age > STALE_AFTER_MS,
      refresh: 'refresh',
    },
    ...(condition === undefined ? {} : { condition }),
    ...(input.adoption === undefined ? {} : { adoption: input.adoption }),
    ...(input.identity === undefined ? {} : { identity: input.identity }),
    ...(input.firstPass === undefined ? {} : { firstPass: input.firstPass }),
  };
}

/** The per-row facts a host knows about its own ordering engine. */
export interface IssueCaveats {
  readonly previewOnly?: PreviewOnly;
  readonly disagreement?: Disagreement;
  /**
   * Which ordered query put this row where it is — the engine's own answer.
   *
   * A HOST FACT, AND IT BELONGS BESIDE THE OTHER TWO. `order.ts` says in
   * writing that this demo has no ordered-query chrome and stands `declared` in
   * its place, so a row's rank reads `ranked in tier P2`. §16h's day-one panel
   * is the one place that reading is wrong: its whole claim is that the CONFIG
   * layer explains the order on its own, and the frame's rows say so
   * (`matched ordered query 1 · label:P0`). Which query matched is exactly the
   * kind of thing this table already carries — what the engine knows about its
   * own rows — so it is stated here rather than derived from a ranking that
   * deliberately does not record it.
   *
   * A PROMOTION STILL WINS. The relationship layer MODIFIES the config layer
   * and never replaces it, so a row whose urgency was inherited says so.
   */
  readonly matchedQuery?: { readonly index: number; readonly label: string };
}
