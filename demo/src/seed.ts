/**
 * The seeded backlog.
 *
 * Two layers, and they answer different questions.
 *
 * THE COVERAGE SEED (#1–#14) is hand-written so that every edge type, both hold
 * families, all three readiness stations and all three rank-provenance forms
 * are reachable without the visitor editing anything first. A demo whose
 * interesting states are three clicks away is a demo whose interesting states
 * nobody sees. `order.test.ts` and `source.test.ts` pin that coverage.
 *
 * THE DENSE SEED (#100 onward) is generated, deterministically, so the page is
 * a sandbox for the packages at the size they are built for rather than a toy.
 * The editor's canvas refuses past `GRAPH_NODE_BUDGET` and lists components as
 * capsules; the rail is windowed; the audit has a cycle, a dead duplicate and a
 * stale blocker to find. None of that is reachable from fourteen issues, and a
 * defect that only shows at three hundred is exactly the kind an embedding host
 * would otherwise be the first to meet. `seed.test.ts` pins what the dense
 * layer has to contain for those surfaces to be exercised.
 *
 * TWO OF THE FIVE EDGE TYPES HAVE NEVER BEEN USED IN ANGER. Across the backlog
 * this specification was written against there are zero `together-with` and
 * zero `duplicate-of` declarations, so this seed is the first place either is
 * exercised at all — treat what it renders as a real test of them rather than
 * as decoration.
 *
 * References are numbered the way a tracker numbers them, which is what lets
 * the demo's BASE RANKING read as §6.4's "newest first". That ranking is a host
 * input to `@issuegraph/derive`, which takes a tracker's own ordering and never
 * computes one — see `order.ts`.
 */

import type { Priority } from '@issuegraph/core';
import type { EdgeKind, GraphDocument, StoredEdge, StoredIssue } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';
import type { ExecutorHold } from './order.ts';

const coverageIssues: readonly StoredIssue[] = [
  { ref: '1', title: 'Publish the first release', state: 'open', priority: 0 },
  { ref: '2', title: 'Write the release notes', state: 'open', priority: 3 },
  { ref: '3', title: 'Cut the changelog', state: 'open', priority: 3 },
  // No declared priority: the spec's default tier applies (§4.3.5).
  { ref: '4', title: 'Rename the config flag', state: 'open' },
  { ref: '5', title: 'Migrate the store schema', state: 'open', priority: 1 },
  { ref: '6', title: 'Backfill the store schema', state: 'open', priority: 1 },
  { ref: '7', title: 'Split: the reading half', state: 'open', priority: 2 },
  { ref: '8', title: 'Support two halves of one format', state: 'closed', priority: 2 },
  { ref: '9', title: 'Split: the writing half', state: 'open', priority: 2 },
  { ref: '10', title: 'Rename the flag in the config file', state: 'open', priority: 2 },
  { ref: '11', title: 'Choose a name for the public package', state: 'open', priority: 1 },
  { ref: '12', title: 'Load the manifest before the plugins', state: 'open', priority: 2 },
  { ref: '13', title: 'Load the plugins before the manifest', state: 'open', priority: 2 },
  { ref: '14', title: 'Adopt the shared linter preset', state: 'open', priority: 2 },
];

const coverageEdges: readonly StoredEdge[] = [
  // blocked-by ⊘ — strict and directed. #1 waits on two open issues that both
  // hold ranks, which is what a HOLLOW station means: ready after a named rank.
  makeEdge('blocked-by', '1', '2'),
  makeEdge('blocked-by', '1', '3'),

  // serialize-with ⇄ — symmetric, no order, exclusive. #6 is claimed, so #5 is
  // held by the GRAPH while #6 is held by the EXECUTOR: one relationship, two
  // hold families, two treatments.
  makeEdge('serialize-with', '5', '6'),

  // together-with ⧉ — the group shares ONE rank and is ready as a unit or not
  // at all (§4.3.7).
  makeEdge('together-with', '7', '9'),

  // decomposed-from ⑃ — provenance, with no ordering effect whatsoever. The
  // parent is closed and never worked again.
  makeEdge('decomposed-from', '7', '8'),
  makeEdge('decomposed-from', '9', '8'),

  // duplicate-of ≡ — never worked, and the closure is transitive (§6.1).
  makeEdge('duplicate-of', '10', '4'),

  // A blocked-by CYCLE. Detected on read and surfaced as stuck (§6.6) rather
  // than refused at write time, because a cycle a groomer can see beats a
  // dependency described in prose.
  makeEdge('blocked-by', '12', '13'),
  makeEdge('blocked-by', '13', '12'),

  // An UNRESOLVABLE reference. Treated as blocking (§6.7): unknown state is not
  // "closed", and reading it as closed would start work whose dependency
  // nobody can see.
  makeEdge('blocked-by', '14', '404'),
];

/** The first reference the dense layer uses. Everything below it is hand-written. */
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

  // A three-cycle of its own, beside the coverage seed's two-cycle, so the
  // cycle capsule flag and the audit's `blocks-work` class both have a member
  // in the dense layer.
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

/** The coverage seed alone — the fourteen hand-written issues and their edges. */
export function coverageSeed(): GraphDocument {
  return { issues: [...coverageIssues], edges: [...coverageEdges] };
}

/** The seeded document — coverage plus the dense layer — fresh each call so the reset button gets a clean one. */
export function seedDocument(): GraphDocument {
  const coverage = coverageSeed();
  const dense = denseSeed();
  return { issues: [...coverage.issues, ...dense.issues], edges: [...coverage.edges, ...dense.edges] };
}

/**
 * The executor's own holds (§6.8) — the second hold family.
 *
 * They live here rather than on the issues because the format never learns why
 * an executor declines ready work: hold semantics MUST NOT be encoded as format
 * fields. A host knows its own holds, and this table is the host's.
 */
export function seedHolds(): readonly ExecutorHold[] {
  return [
    // ACTIVE: a worker is running this right now, so its serialize group is
    // excluded (§6.2 rule 4).
    { ref: '6', label: 'claimed', detail: 'another worker holds this issue', active: true },
    // NOT active: parked work is not running, so it excludes nobody. Reading
    // every hold as a claim is what held a serialize group over an issue that
    // nothing was working.
    { ref: '11', label: 'parked', detail: 'parked for a decision a person has to make' },
  ];
}
