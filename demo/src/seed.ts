/**
 * The seeded backlog.
 *
 * Two layers, and they answer different questions.
 *
 * THE COMP (#455–#602) is the scenario the design's §16 frames were drawn
 * against, row for row: the same issues, numbers, priorities, relationships and
 * holds as `Descant Dashboard.dc.html` §16a and §16b in the design kit. It is
 * the LANDING STATE, because fidelity to a frame can only be judged against the
 * frame's own scenario — beside a generic backlog every difference is arguable,
 * and beside the comp "does this match" is a glance. It is also the coverage
 * seed: every edge type, both hold families, all three readiness stations and
 * all three rank-provenance forms are reachable in it without the visitor
 * editing anything first. `order.test.ts` and `source.test.ts` pin that
 * coverage, and `seed.test.ts` pins the frames' rows.
 *
 * THE DENSE SEED (#100 onward) is generated, deterministically, so the page is
 * a sandbox for the packages at the size they are built for rather than a toy.
 * The editor's canvas refuses past `GRAPH_NODE_BUDGET` and lists components as
 * capsules; the rail is windowed; the audit has a cycle, a dead duplicate and a
 * stale blocker to find. None of that is reachable from fifteen issues, and a
 * defect that only shows at three hundred is exactly the kind an embedding host
 * would otherwise be the first to meet. It LOADS ON DEMAND — the first paint
 * used to be the stress test, which is the wrong front door — and
 * `seed.test.ts` pins what it has to contain for those surfaces to be
 * exercised.
 *
 * TWO OF THE FIVE EDGE TYPES HAVE NEVER BEEN USED IN ANGER. Across the backlog
 * this specification was written against there are zero `together-with` and
 * zero `duplicate-of` declarations, so this seed is the first place either is
 * exercised at all — treat what it renders as a real test of them rather than
 * as decoration.
 *
 * References are numbered the way a tracker numbers them. The dense layer's
 * BASE RANKING reads as §6.4's "newest first"; the comp's is the frames' own
 * pick order, written down (`COMP_ORDER`). Both are host inputs to
 * `@issuegraph/derive`, which takes a tracker's own ordering and never computes
 * one — see `order.ts`.
 */

import type { Priority } from '@issuegraph/core';
import type { EdgeKind, GraphDocument, IssueRef, StoredEdge, StoredIssue } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';
import { type BaseRanking, type ExecutorHold, rankedFirst } from './order.ts';

/**
 * The §16a rows, in the frames' own order, top to bottom.
 *
 * Every title, number and priority is read off the frame — the frame is the
 * specification and this file is not a paraphrase of it. Where the frame draws
 * a state this host cannot express, the nearest host input is used and the
 * gap is named in `demo/README.md` rather than papered over here.
 */
const compIssues: readonly StoredIssue[] = [
  // The frame's `now` row: a worker has it, "Review · 12m". The viewer has no
  // "now" station, so it is an ACTIVE claim and lands in the footer group. No
  // priority, because the frame draws none on it — nor on any footer row.
  { ref: '499', title: 'Fix flaky auth integration test', state: 'open' },
  // Rank 1, `P3 → 0`: declared P3, promoted by the P0 it blocks. `✓ verified`
  // in the frame; the store carries no evidence field, so that chip is not
  // drawn — a package gap, not a seed one.
  { ref: '488', title: 'Extract session store adapter', state: 'open', priority: 3 },
  // Rank 2: one unit of two P0s, blocked by #488 — "ready once #488 closes".
  { ref: '512', title: 'Token refresh drops the session on 401', state: 'open', priority: 0 },
  { ref: '514', title: 'Add refresh-token rotation', state: 'open', priority: 0 },
  // Ranks 3 and 4: a serialize group of three, nobody claimed, so both are
  // ready and the concurrency cap decides who goes first.
  { ref: '501', title: 'Rate-limit backoff on the poller', state: 'open', priority: 1 },
  { ref: '503', title: 'Poller: jittered retry window', state: 'open', priority: 1 },
  // `—`, would be rank 4: a graph-derived hold, inline, blocked by an open
  // issue the order never reaches.
  { ref: '530', title: 'Session cookie SameSite fix', state: 'open', priority: 1 },
  // Rank 5: no declared priority, so the spec's default tier (§4.3.5).
  { ref: '520', title: 'Audit log pagination', state: 'open' },
  // Rank 6: the frame ranks this by the unlabeled tail because its ordered
  // query (`involves:@me`) cannot be evaluated locally. This host has no
  // ordered queries, so it is undeclared and placed last by `COMP_ORDER`.
  { ref: '487', title: 'Copy tweaks on the settings page', state: 'open' },
  // The serialize group's THIRD member. The frame says "group of 3" and draws
  // only #501 and #503; §16b says "19 more ranked · scroll", so the third sits
  // below the drawn rows. Groups are computed, never written down (§6.1), so a
  // count of three needs a third issue to exist. P3 so it ranks last, below
  // the two default-tier rows the frame does draw.
  { ref: '505', title: 'Poller: coalesce overlapping polls', state: 'open', priority: 3 },
  // The footer group, "held by the runner, not the graph".
  { ref: '533', title: 'Retry storm on webhook replay', state: 'open' },
  { ref: '541', title: 'Decide on cookie domain strategy', state: 'open' },
  // The one duplicate: excluded from the order, canonical still open.
  { ref: '455', title: 'Login expires randomly', state: 'open' },
  // The left gutter's "open · not eligible": the blocker that explains #530's
  // hold, outside the order because no pick-order query reaches it.
  { ref: '602', title: 'Vendor SDK upgrade v3', state: 'open' },
  // The right gutter's "closed · split origin".
  { ref: '470', title: 'Add usage-based billing', state: 'closed' },
];

const compEdges: readonly StoredEdge[] = [
  // blocked-by ⊘ — strict and directed. The unit waits on #488, which is what
  // promotes #488 to the unit's P0 (§6.3) and puts it at rank 1.
  makeEdge('blocked-by', '512', '488'),
  // ...and #530 waits on an open issue the order never works: inline, `—`.
  makeEdge('blocked-by', '530', '602'),

  // together-with ⧉ — ONE rank for two issues, ready as a unit or not at all.
  makeEdge('together-with', '514', '512'),

  // serialize-with ⇄ — symmetric, no order, exclusive; a writer joins by
  // pointing at any one member (§4.3.4), so the group of three is two edges.
  makeEdge('serialize-with', '503', '501'),
  makeEdge('serialize-with', '505', '501'),

  // duplicate-of ≡ — never worked; the frame's "≡ 1 duplicate" on the unit.
  makeEdge('duplicate-of', '455', '512'),

  // decomposed-from ⑃ — provenance only, to a CLOSED origin: "⑃ from #470".
  makeEdge('decomposed-from', '488', '470'),
];

/**
 * §16a's own order, top to bottom, then the rest of the frame.
 *
 * A product's ordered queries produce a complete ranking before the
 * relationship layer touches it, and the frames were drawn against one this
 * host cannot run. So the order the frames show is written down and handed to
 * the derivation as the host's own `ORDER BY`: within a tier the derivation
 * sorts by this position, which is what keeps #488 — promoted into the unit's
 * tier — at rank 1 ahead of the unit, and #520 ahead of #487 in the default
 * tier. The derivation still decides everything a base ranking cannot: the
 * promotion itself, the unit's single slot, and the two holds. `seed.test.ts`
 * pins that it lands on the frames' ranks.
 */
export const COMP_ORDER: readonly IssueRef[] = Object.freeze([
  '488', '512', '514', '501', '503', '530', '520', '487', '505',
  '499', '533', '541', '602', '455', '470',
]);

/**
 * A reference no seeded issue carries. §6.7: an unresolvable `blocked-by` is
 * treated as BLOCKING, because unknown state is not "closed", and reading it
 * as closed would start work whose dependency nobody can see. The dense layer
 * ships one so the `unresolvable` chip stays reachable on the page.
 */
export const UNRESOLVABLE_REF: IssueRef = '404';

/**
 * The first reference the dense layer uses; it runs upward from here past
 * three hundred. The comp's numbers are the frames' own (#455–#602) and sit
 * above that range, so no reference is shared — `seed.test.ts` pins it.
 */
export const DENSE_FIRST_REF = 100;

/**
 * How many edge-free issues the dense layer carries.
 *
 * The majority, on purpose: the design's own sample was 248 of 312, and the
 * scale ladder's isolated chip exists because that is what a real backlog
 * looks like. They also make the rail longer than one window, so the
 * virtualised rail has something to virtualise.
 */
export const DENSE_ISOLATED_COUNT = 150;

/**
 * The size of the largest connected component.
 *
 * Above the viewer's `GRAPH_NODE_BUDGET` (60) on its own, so focusing it from
 * a capsule still refuses — the ladder's "the component you focused is itself
 * past this canvas's budget" arm, which no smaller seed can reach.
 */
export const DENSE_LARGEST_COMPONENT = 72;

const VERBS = [
  'Retire', 'Backfill', 'Measure', 'Publish', 'Refuse', 'Pin', 'Wire', 'Split',
  'Record', 'Bound', 'Name', 'Derive', 'Extract', 'Verify', 'Arm', 'Retype',
] as const;

const OBJECTS = [
  'the reconcile watermark', 'the claim reservation', 'the cadence tick',
  'the shadow compare', 'the write fence', 'the audit count', 'the rail window',
  'the deploy refresh', 'the spend ceiling', 'the mirror ingest', 'the order preview',
  'the label mapper', 'the session lease', 'the beacon push', 'the queue verdict',
  'the release stamp', 'the provenance walk', 'the capsule route', 'the search lead',
  'the theme tokens',
] as const;

/**
 * A tiny deterministic generator, so the seed is the same on every load and
 * in every test. `Math.random` would make the page a different document each
 * time, and a screenshot nobody can reproduce is not a bug report.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** The four tiers, as the format's own type, so a generated priority is never a bare number. */
const TIERS: readonly Priority[] = [0, 1, 2, 3];

function pick<T>(next: () => number, from: readonly T[]): T {
  const chosen = from[Math.floor(next() * from.length)];
  if (chosen === undefined) throw new Error('pick from an empty list');
  return chosen;
}

interface Dense {
  readonly issues: StoredIssue[];
  readonly edges: StoredEdge[];
}

/** Allocates references in order, so the numbering reads like a tracker's. */
function allocator(dense: Dense, next: () => number): (title: string, options?: Partial<StoredIssue>) => string {
  let counter = DENSE_FIRST_REF;
  return (title, options = {}) => {
    const ref = String(counter);
    counter += 1;
    const priority = options.priority ?? pick(next, TIERS);
    dense.issues.push({ ref, title, state: options.state ?? 'open', priority, ...options });
    return ref;
  };
}

function edge(dense: Dense, kind: EdgeKind, from: string, to: string): void {
  dense.edges.push(makeEdge(kind, from, to));
}

function title(next: () => number): string {
  return `${pick(next, VERBS)} ${pick(next, OBJECTS)}`;
}

/**
 * The generated layer, fresh each call.
 *
 * Each block below is one thing a surface needs to be reachable, named in its
 * comment. The order the blocks run in is the order references are issued in,
 * which is why the largest component comes last: it is the newest work, so the
 * base ranking puts it first, and the rail's first window is where the refusal
 * and the capsules are most likely to be looked at.
 */
export function denseSeed(): GraphDocument {
  const next = lcg(0x1554);
  const dense: Dense = { issues: [], edges: [] };
  const issue = allocator(dense, next);

  // A decomposition tree under a CLOSED origin, three deep. The tree
  // projection's whole subject, and `decomposed-from` provenance that the
  // reader can resolve rather than diagnose.
  const origin = issue('Ship the grooming workspace', { state: 'closed', priority: 0 });
  const branches = ['the rail', 'the canvas', 'the inspector', 'the audit'].map((zone) =>
    issue(`Workspace: ${zone}`, { priority: 1 }),
  );
  for (const branch of branches) {
    edge(dense, 'decomposed-from', branch, origin);
    const leaves = [issue(title(next)), issue(title(next)), issue(title(next))];
    for (const leaf of leaves) edge(dense, 'decomposed-from', leaf, branch);
    // The leaves are worked in order, so the branch waits on its last leaf.
    edge(dense, 'blocked-by', leaves[1] ?? branch, leaves[0] ?? branch);
    edge(dense, 'blocked-by', leaves[2] ?? branch, leaves[1] ?? branch);
    edge(dense, 'blocked-by', branch, leaves[2] ?? branch);
  }

  // A long `blocked-by` chain with a P0 at the far end: effective priority
  // walks the whole chain (§6.3), so twenty rows carry a promotion.
  const chain = Array.from({ length: 20 }, (_, index) =>
    issue(title(next), { priority: index === 19 ? 0 : pick(next, [2, 3] as const) }),
  );
  for (let index = 19; index > 0; index -= 1) {
    edge(dense, 'blocked-by', chain[index] ?? '', chain[index - 1] ?? '');
  }

  // A serialize ring: five issues, one exclusive group, none claimed — so the
  // whole group is ready and the concurrency cap decides who goes first.
  const ring = Array.from({ length: 5 }, () => issue(title(next), { priority: 1 }));
  for (let index = 0; index < ring.length; index += 1) {
    edge(dense, 'serialize-with', ring[index] ?? '', ring[(index + 1) % ring.length] ?? '');
  }

  // Two `together-with` units of three. A unit is ONE slot with several
  // members, and the audit's row severity reads across members, not the lead.
  for (const unitIndex of [0, 1]) {
    const members = [issue(title(next)), issue(title(next)), issue(title(next))];
    edge(dense, 'together-with', members[1] ?? '', members[0] ?? '');
    edge(dense, 'together-with', members[2] ?? '', members[0] ?? '');
    if (unitIndex === 1) {
      // A `blocked-by` cycle running THROUGH a unit: the deadlock #43 records
      // as the one divergence between the old hand-rolled deriver and the
      // published one. Left in so the gap stays visible on the page.
      const outside = issue(title(next));
      edge(dense, 'blocked-by', outside, members[0] ?? '');
      edge(dense, 'blocked-by', members[2] ?? '', outside);
    }
  }

  // A transitive duplicate chain ending at a CLOSED canonical: both `a` and
  // `b` are dead references, and the audit has to resolve through `b` to say
  // so — the case the editor README names for `dead-duplicate-ref`.
  const canonical = issue('Choose one write path', { state: 'closed', priority: 1 });
  const middle = issue('Choose one write path (again)');
  const first = issue('Pick a write path');
  edge(dense, 'duplicate-of', first, middle);
  edge(dense, 'duplicate-of', middle, canonical);
  // And a LIVE duplicate: excluded from the order, canonical still open.
  const live = issue('Record the audit count');
  const liveCanonical = issue('Record the audit count once', { priority: 1 });
  edge(dense, 'duplicate-of', live, liveCanonical);

  // A STALE blocker — a `blocked-by` naming a closed issue — which satisfies
  // readiness and is bookkeeping the audit's fourth class exists to surface.
  const done = issue('Land the schema migration', { state: 'closed', priority: 1 });
  const after = issue('Backfill after the migration', { priority: 1 });
  edge(dense, 'blocked-by', after, done);

  // An UNRESOLVABLE reference, held as blocking (§6.7) and surfaced for
  // grooming rather than dropped — the one hold no picker can create.
  edge(dense, 'blocked-by', issue('Verify the release stamp', { priority: 2 }), UNRESOLVABLE_REF);

  // A plain three-cycle, so the cycle capsule flag and the audit's
  // `blocks-work` class both have a member. The comp ships no cycle — the
  // frames draw none — so this layer is where a visitor meets one.
  const cycle = [issue(title(next)), issue(title(next)), issue(title(next))];
  edge(dense, 'blocked-by', cycle[0] ?? '', cycle[1] ?? '');
  edge(dense, 'blocked-by', cycle[1] ?? '', cycle[2] ?? '');
  edge(dense, 'blocked-by', cycle[2] ?? '', cycle[0] ?? '');

  // The edge-free majority.
  for (let index = 0; index < DENSE_ISOLATED_COUNT; index += 1) issue(title(next));

  // The largest component: a layered DAG past the canvas budget on its own.
  // Layered rather than random so it is acyclic by construction — a cycle
  // here would be an accident, and the cycles above are deliberate.
  const layers: string[][] = [];
  let remaining = DENSE_LARGEST_COMPONENT;
  while (remaining > 0) {
    const width = Math.min(remaining, 6 + Math.floor(next() * 6));
    layers.push(Array.from({ length: width }, () => issue(title(next))));
    remaining -= width;
  }
  for (let depth = 1; depth < layers.length; depth += 1) {
    const above = layers[depth - 1] ?? [];
    for (const node of layers[depth] ?? []) {
      // Every node depends on at least one above it, so the layers form ONE
      // component rather than several.
      const links = 1 + Math.floor(next() * 2);
      for (let link = 0; link < links; link += 1) {
        const target = pick(next, above);
        if (!dense.edges.some((e) => e.kind === 'blocked-by' && e.from === node && e.to === target)) {
          edge(dense, 'blocked-by', node, target);
        }
      }
    }
  }

  return { issues: dense.issues, edges: dense.edges };
}

/** The comp alone — the §16a scenario, fresh each call so the reset button gets a clean one. */
export function compSeed(): GraphDocument {
  return { issues: [...compIssues], edges: [...compEdges] };
}

/** The big backlog — the comp with the dense layer beneath it. */
export function backlogSeed(): GraphDocument {
  const comp = compSeed();
  const dense = denseSeed();
  return { issues: [...comp.issues, ...dense.issues], edges: [...comp.edges, ...dense.edges] };
}

/**
 * The executor's own holds (§6.8) — the second hold family — as the frames
 * draw them: the `now` row, and the footer group "held by the runner, not the
 * graph".
 *
 * They live here rather than on the issues because the format never learns why
 * an executor declines ready work: hold semantics MUST NOT be encoded as format
 * fields. A host knows its own holds, and this table is the host's. The dense
 * layer declares none, so the backlog scenario shares this table.
 */
export function compHolds(): readonly ExecutorHold[] {
  return [
    // ACTIVE: a worker is running these right now, so a serialize group of
    // theirs would be excluded (§6.2 rule 4). Neither is in one.
    { ref: '499', label: 'working', detail: 'a worker has this issue: Review · 12m', active: true },
    { ref: '533', label: 'claimed', detail: 'another worker holds this issue', active: true },
    // NOT active: parked work is not running, so it excludes nobody. Reading
    // every hold as a claim is what held a serialize group over an issue that
    // nothing was working.
    { ref: '541', label: 'parked', detail: 'parked for a decision a person has to make · needs-human' },
    // Not a runner hold but the host's own knowledge all the same: the frame's
    // "open · not eligible" is an issue no pick-order query reaches, so it is
    // outside the order while its blocked-by still holds #530 in place.
    { ref: '602', label: 'not eligible', detail: 'matches none of the ordered queries, so the pick order never reaches it' },
  ];
}

/** The two documents the page can hold, by name. */
export const SCENARIO_NAMES = Object.freeze(['comp', 'backlog'] as const);
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/**
 * One state the page can load: a document, the host inputs that go with it,
 * and a phrase for the control that loads it.
 *
 * The document is a thunk because the store mutates what it is handed and the
 * reset button wants a clean one; the holds and the ranking are values, since
 * nothing writes to either.
 */
export interface Scenario {
  /** The control's label — host chrome, so the page's own words. */
  readonly label: string;
  readonly document: () => GraphDocument;
  readonly holds: readonly ExecutorHold[];
  readonly ranking: BaseRanking;
}

/**
 * The comp's base ranking, and the backlog's.
 *
 * One function serves both: the frames' rows keep their order at the top of
 * each tier, and the dense layer falls in behind them newest first — which is
 * the dense layer's own rule (`newestFirstRanking`), applied to what the comp
 * did not list.
 */
const compRanking: BaseRanking = rankedFirst(COMP_ORDER);

/** What the page lands on. The comp, by decision: the frames are the fidelity reference, so they are the front door. */
export const DEFAULT_SCENARIO: ScenarioName = 'comp';

export const SCENARIOS: Readonly<Record<ScenarioName, Scenario>> = Object.freeze({
  comp: {
    label: 'the §16 comp',
    document: compSeed,
    holds: compHolds(),
    ranking: compRanking,
  },
  backlog: {
    label: 'the big backlog',
    document: backlogSeed,
    holds: compHolds(),
    ranking: compRanking,
  },
});
