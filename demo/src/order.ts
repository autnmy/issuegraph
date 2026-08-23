/**
 * The demo's order deriver — the `OrderDeriver` the store requires and
 * deliberately does not supply.
 *
 * `@issuegraph/store` takes the deriver as a port with NO default, because the
 * selection order is its own concern: a default there would be a second
 * implementation of it. This file is what a host writes on the other side of
 * that port, and the demo is a host. It reads SPEC.md §6.2 (the ready set),
 * §6.3 (effective priority) and §6.4 (selection) directly.
 *
 * IT IS NOT THE REFERENCE DERIVATION, and nothing should grow to make it look
 * like one. The reference engine is a package of its own, still to be
 * published; when it exists this file is deleted and the demo imports it. Until
 * then the demo needs SOME deriver to be a demo at all, and a small honest one
 * that names its spec sections beats waiting.
 *
 * Two outputs from one computation. {@link explainOrder} is the rich form the
 * demo renders — station, holds, rank provenance — and {@link createDeriver}
 * projects it onto the store's `OrderRow`. Computing them separately would let
 * the rail and the rendering disagree about the same document.
 */

import { DEFAULT_PRIORITY, type Priority } from '@issuegraph/core';
import type {
  EdgeKind,
  GraphDocument,
  IssueRef,
  OrderDeriver,
  OrderRow,
  StoredEdge,
  StoredIssue,
} from '@issuegraph/store';

/**
 * A hold the EXECUTOR applies, not the graph (§6.8).
 *
 * It reaches the deriver through this table rather than through the document,
 * because §6.8 forbids encoding hold semantics as format fields: the format
 * never learns why an executor declines ready work. A host knows its own holds;
 * that is exactly the asymmetry this table expresses.
 */
export interface ExecutorHold {
  readonly ref: IssueRef;
  /** One word for the badge — `claimed`, `parked`. */
  readonly label: string;
  /** The sentence shown beside it. */
  readonly detail: string;
  /**
   * Whether this hold means the issue is ACTIVELY BEING WORKED.
   *
   * §6.2 rule 4 admits a serialize group on "no actively-claimed member" — a
   * claim, not a hold in general. Reading every executor hold as a claim holds
   * a whole group because one member is *parked*, which is the opposite of what
   * a width-1 semaphore is for: nothing is running, so nothing is excluded.
   */
  readonly active?: boolean;
}

/**
 * How many ready stations may run at once.
 *
 * An EXECUTOR's number, not the graph's: §6.5 is explicit that ready issues are
 * safe to run concurrently by construction and that how many to dispatch is
 * scheduler policy, out of the specification's scope. It lives here for the
 * same reason the executor holds do — the host knows it and the format never
 * learns it — and it is what makes a hollow station mean anything.
 */
export const DEFAULT_CONCURRENCY_CAP = 2;

/** Which family a hold belongs to. The two are never given one treatment. */
export type HoldFamily = 'graph' | 'executor';

/** One reason an issue may not start, and which family it came from. */
export interface Hold {
  readonly family: HoldFamily;
  readonly label: string;
  readonly detail: string;
}

/**
 * How a station is drawn. The three forms answer ONE question — can this start
 * now? — and they are about PARALLELISM, not about the graph:
 *
 * - `filled` — ready, and inside the concurrency cap. Glance-count these
 *   against the cap and you have the answer to "how much can run right now".
 * - `hollow` — ready, but beyond the cap: it starts after a NAMED rank frees a
 *   slot. A sequencing statement, never a hold.
 * - `dashed` — held. Every hold lands here, both families alike; what differs
 *   between the families is WHERE the row is drawn, not how its station reads.
 */
export type Station = 'filled' | 'hollow' | 'dashed';

/**
 * Where a row's rank came from. Three forms, from the workspace design's §16d.
 *
 * The design's first form is a host's own ordered query (`label:P1`), which is
 * chrome this demo has no equivalent of — it ranks the whole document. The
 * `declared` form stands in its place: the issue's own declared priority
 * (§4.3.5) is what put it here.
 */
export type Provenance =
  | { readonly form: 'declared'; readonly priority: Priority }
  | { readonly form: 'default-tier'; readonly priority: Priority }
  | {
      readonly form: 'promoted';
      readonly declared: Priority;
      readonly effective: Priority;
      /** The dependent whose urgency it inherited (§6.3). */
      readonly from: IssueRef;
    };

/** A row as the demo renders it. A superset of the store's `OrderRow`. */
export interface ExplainedRow {
  readonly issue: StoredIssue;
  readonly rank: number;
  /**
   * Whether the rank is shown. Graph-derived holds sit inline at their would-be
   * rank and show `—`; the executor-held and duplicates sit in a collapsed
   * footer group and earn no rank slot at all.
   */
  readonly showRank: boolean;
  /** Whether the row belongs to the spine or the collapsed footer group. */
  readonly placement: 'spine' | 'footer';
  readonly ready: boolean;
  readonly station: Station;
  /** For a hollow station: the rank whose completion frees this row's slot. */
  readonly readyAfterRank?: number;
  readonly holds: readonly Hold[];
  readonly provenance: Provenance;
  readonly effectivePriority: Priority;
  /**
   * How many issues share this row's `serialize-with` or `together-with`
   * component. Groups are never written down (§6.1), so this is computed.
   */
  readonly serializeGroupSize: number;
  readonly togetherGroupSize: number;
}

/** The declared priority of an issue, with §4.3.5's default applied. */
function declaredPriority(issue: StoredIssue): Priority {
  return issue.priority ?? DEFAULT_PRIORITY;
}

/** Disjoint-set over the two symmetric kinds, which is how §6.1 says to build them. */
function components(edges: readonly StoredEdge[], kind: EdgeKind): Map<IssueRef, Set<IssueRef>> {
  const parent = new Map<IssueRef, IssueRef>();
  const find = (ref: IssueRef): IssueRef => {
    const seen = parent.get(ref);
    if (seen === undefined || seen === ref) return ref;
    const root = find(seen);
    parent.set(ref, root);
    return root;
  };
  const union = (a: IssueRef, b: IssueRef): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  for (const edge of edges) {
    if (edge.kind !== kind) continue;
    if (!parent.has(edge.from)) parent.set(edge.from, edge.from);
    if (!parent.has(edge.to)) parent.set(edge.to, edge.to);
    union(edge.from, edge.to);
  }
  const grouped = new Map<IssueRef, Set<IssueRef>>();
  for (const ref of parent.keys()) {
    const root = find(ref);
    const members = grouped.get(root) ?? new Set<IssueRef>();
    members.add(ref);
    grouped.set(root, members);
  }
  const byMember = new Map<IssueRef, Set<IssueRef>>();
  for (const members of grouped.values()) {
    for (const ref of members) byMember.set(ref, members);
  }
  return byMember;
}

/**
 * The duplicate-to-CANONICAL map (§6.1), not merely the set of refs to ignore.
 *
 * The mapping is the part that matters and the part that is easy to drop. A set
 * of "issues that are duplicates" answers §6.2 rule 2 and nothing else, so a
 * reference POINTING AT a duplicate stays attached to it: an issue blocked by a
 * duplicate never inherits the canonical's fate, the canonical never inherits
 * the dependent's urgency, and closing the canonical does not unblock anything.
 * The reader rules say references resolve, so they have to actually resolve.
 *
 * Followed to a fixed point, because a duplicate of a duplicate is a duplicate
 * of the same canonical — and guarded against a `duplicate-of` cycle, which is
 * malformed rather than impossible: a ref that returns to where it started
 * stops there rather than looping.
 */
function duplicateCanonicals(edges: readonly StoredEdge[]): Map<IssueRef, IssueRef> {
  const target = new Map<IssueRef, IssueRef>();
  for (const edge of edges) {
    if (edge.kind === 'duplicate-of') target.set(edge.from, edge.to);
  }
  const canonical = new Map<IssueRef, IssueRef>();
  for (const from of target.keys()) {
    const walked = new Set<IssueRef>([from]);
    let at = target.get(from);
    while (at !== undefined && !walked.has(at)) {
      walked.add(at);
      const next = target.get(at);
      if (next === undefined) break;
      at = next;
    }
    if (at !== undefined && at !== from) canonical.set(from, at);
  }
  return canonical;
}

/**
 * The issues caught in a `blocked-by` cycle, which are never ready (§6.6).
 *
 * Detected on read, exactly as §6.6 requires, and deliberately not prevented at
 * write time: "write-time rejection pushes writers into describing the
 * dependency in prose instead, which is strictly worse than a cycle a groomer
 * can see."
 */
function cyclic(blockers: ReadonlyMap<IssueRef, readonly IssueRef[]>): Set<IssueRef> {
  const found = new Set<IssueRef>();
  const state = new Map<IssueRef, 'visiting' | 'done'>();
  const stack: IssueRef[] = [];
  const walk = (ref: IssueRef): void => {
    const seen = state.get(ref);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      // Everything from this reference to the top of the stack is on the cycle.
      const from = stack.indexOf(ref);
      for (const member of stack.slice(from === -1 ? 0 : from)) found.add(member);
      return;
    }
    state.set(ref, 'visiting');
    stack.push(ref);
    for (const next of blockers.get(ref) ?? []) walk(next);
    stack.pop();
    state.set(ref, 'done');
  };
  for (const ref of blockers.keys()) walk(ref);
  return found;
}

/** Everything the readiness and priority rules need, computed once. */
interface Index {
  readonly byRef: ReadonlyMap<IssueRef, StoredIssue>;
  /** ref → the issues it declares itself blocked by. */
  readonly blockers: ReadonlyMap<IssueRef, readonly IssueRef[]>;
  /** ref → the issues that declare themselves blocked by it. §6.3 walks this way. */
  readonly dependents: ReadonlyMap<IssueRef, readonly IssueRef[]>;
  readonly duplicate: ReadonlySet<IssueRef>;
  /** duplicate → the canonical it resolves to (§6.1). */
  readonly canonical: ReadonlyMap<IssueRef, IssueRef>;
  readonly cycle: ReadonlySet<IssueRef>;
  readonly serialize: ReadonlyMap<IssueRef, ReadonlySet<IssueRef>>;
  readonly together: ReadonlyMap<IssueRef, ReadonlySet<IssueRef>>;
  readonly held: ReadonlyMap<IssueRef, ExecutorHold>;
  /**
   * The issues an executor is ACTIVELY working, expanded across together
   * components — claiming one member claims the whole unit atomically
   * (§4.3.7), so serialize admission has to see the unit, not the member.
   */
  readonly claimed: ReadonlySet<IssueRef>;
}

function push(map: Map<IssueRef, IssueRef[]>, key: IssueRef, value: IssueRef): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

/**
 * THE dependency graph — one construction, used by everything that asks a
 * dependency question.
 *
 * Readiness, cycle detection and the host's write guard were each building
 * their own view of `blocked-by`, and they disagreed in two ways that a
 * visitor could reach: cycle detection walked edges that readiness had already
 * excluded as together-internal, so a group kept a `cycle` hold the rules say
 * is advisory; and the guard walked RAW endpoints, so a cycle that exists only
 * after duplicate resolution was accepted. Both are the same defect — a second
 * reading of one graph — so there is now one reading and no second to drift.
 *
 * Two filters, both from the spec rather than from convenience:
 *
 * - **Duplicate resolution (§6.1).** Every endpoint resolves to its canonical,
 *   and an edge whose ends collapse together is dropped rather than becoming a
 *   self-edge.
 * - **Together-internal edges (§4.3.7).** Blocking inside one unit is advisory:
 *   a group is claimed and worked as a whole, so its members cannot be waiting
 *   on each other for the purpose of deciding whether the unit may start.
 */
function dependencyGraph(
  document: GraphDocument,
  resolve: (ref: IssueRef) => IssueRef,
  together: ReadonlyMap<IssueRef, ReadonlySet<IssueRef>>,
): { blockers: Map<IssueRef, IssueRef[]>; dependents: Map<IssueRef, IssueRef[]> } {
  const blockers = new Map<IssueRef, IssueRef[]>();
  const dependents = new Map<IssueRef, IssueRef[]>();
  for (const issue of document.issues) {
    blockers.set(issue.ref, []);
    dependents.set(issue.ref, []);
  }
  for (const edge of document.edges) {
    if (edge.kind !== 'blocked-by') continue;
    const from = resolve(edge.from);
    const to = resolve(edge.to);
    if (from === to) continue;
    const unit = together.get(from);
    if (unit !== undefined && unit.has(to)) continue;
    push(blockers, from, to);
    push(dependents, to, from);
  }

  // CONTRACT EACH TOGETHER UNIT INTO ONE NODE. Excluding internal edges stops a
  // unit blocking itself; it does NOT make the unit a single node, and the
  // difference is a cycle that hides. With group {7,9}, `#9 blocked-by #4` and
  // `#4 blocked-by #7` is `{7,9} → 4 → {7,9}` — three issues deadlocked — but a
  // member-level walk cannot cross from #7 to #9, so neither cycle detection
  // nor the write guard sees it.
  //
  // Contracting by UNIONING each unit's edges onto all of its members keeps the
  // maps member-keyed, so every reader downstream is unchanged, while the walk
  // behaves as though the unit were one vertex — which, for the purpose of
  // deciding whether work can start, it is.
  const contracted = (side: Map<IssueRef, IssueRef[]>): void => {
    for (const members of new Set(together.values())) {
      const union = new Set<IssueRef>();
      for (const member of members) {
        for (const other of side.get(member) ?? []) {
          // An edge into the unit from one of its own members is internal, and
          // stays excluded after contraction exactly as it was before it.
          if (!members.has(other)) union.add(other);
        }
      }
      for (const member of members) side.set(member, [...union]);
    }
  };
  contracted(blockers);
  contracted(dependents);

  return { blockers, dependents };
}

/**
 * Whether creating `from blocked-by to` would close a cycle.
 *
 * Exported because it is the host's `EdgeGuard` question, and answering it
 * anywhere but here is how the guard and the index came to disagree. §6.6 is
 * deliberate that an EXISTING cycle is surfaced rather than refused — this
 * refuses only the edit that would create one.
 */
export function wouldCloseCycle(
  document: GraphDocument,
  from: IssueRef,
  to: IssueRef,
): boolean {
  const canonical = duplicateCanonicals(document.edges);
  const resolve = (ref: IssueRef): IssueRef => canonical.get(ref) ?? ref;
  const canonicalEdges = document.edges.map((edge) => ({
    ...edge,
    from: resolve(edge.from),
    to: resolve(edge.to),
  }));
  const together = components(canonicalEdges, 'together-with');
  const { blockers } = dependencyGraph(document, resolve, together);

  // THE WALK COMPARES UNITS, NOT REFERENCES, and that is the whole of the
  // contraction rather than one direction of it. Copying a unit's adjacency
  // onto its members makes every member the same SOURCE of an edge; it does
  // not make every member the same DESTINATION, so an exact-reference test
  // still missed a path that arrives at a different member than the one the
  // new edge names — the same cycle, approached from the other end.
  //
  // A directed edge has exactly two ends, so answering both here closes the
  // question rather than adding a case: `sameUnit` is applied to the arrival
  // test and to the self-edge test alike.
  const start = resolve(from);
  const end = resolve(to);
  const sameUnit = (a: IssueRef, b: IssueRef): boolean =>
    a === b || (together.get(a)?.has(b) ?? false);

  // A member editing its own groupmate is an internal edge — advisory under
  // §4.3.7, refused structurally as a self-edge would be, and never a cycle.
  if (sameUnit(start, end)) return false;

  const seen = new Set<IssueRef>();
  const reaches = (at: IssueRef): boolean => {
    if (sameUnit(at, start)) return true;
    if (seen.has(at)) return false;
    seen.add(at);
    return (blockers.get(at) ?? []).some(reaches);
  };
  return reaches(end);
}

function index(document: GraphDocument, holds: readonly ExecutorHold[]): Index {
  const byRef = new Map(document.issues.map((issue) => [issue.ref, issue] as const));
  const canonical = duplicateCanonicals(document.edges);
  // EVERY graph reference resolves through the duplicate mapping before it is
  // indexed, so a relationship written against a duplicate lands on the issue
  // that will actually be worked. A ref with no mapping is its own canonical.
  const resolve = (ref: IssueRef): IssueRef => canonical.get(ref) ?? ref;

  const canonicalEdges = document.edges.map((edge) => ({
    ...edge,
    from: resolve(edge.from),
    to: resolve(edge.to),
  }));
  // Built BEFORE the dependency graph, which needs it to drop the edges §4.3.7
  // makes advisory.
  const together = components(canonicalEdges, 'together-with');
  const { blockers, dependents } = dependencyGraph(document, resolve, together);

  // An ACTIVE claim, expanded across the claimed issue's together unit. A hold
  // that is not a claim — `parked` — excludes nobody, because nothing is
  // running.
  const claimed = new Set<IssueRef>();
  for (const hold of holds) {
    if (hold.active !== true) continue;
    const ref = resolve(hold.ref);
    claimed.add(ref);
    for (const member of together.get(ref) ?? []) claimed.add(member);
  }

  return {
    byRef,
    blockers,
    dependents,
    duplicate: new Set(canonical.keys()),
    canonical,
    cycle: cyclic(blockers),
    serialize: components(canonicalEdges, 'serialize-with'),
    together,
    held: new Map(holds.map((hold) => [hold.ref, hold] as const)),
    claimed,
  };
}

/**
 * The reasons this issue alone may not start — everything in §6.2 except rule
 * 5, which is about the rest of a together group and would recurse for ever if
 * it were asked here.
 *
 * An unresolvable reference is BLOCKING, never ignored (§6.7): unknown state is
 * not "closed", and reading it as closed would let a scheduler start work whose
 * dependency nobody can see.
 */
function ownHolds(ref: IssueRef, at: Index): Hold[] {
  const found: Hold[] = [];
  const issue = at.byRef.get(ref);
  if (issue === undefined) return found;

  if (issue.state === 'closed') {
    found.push({ family: 'graph', label: 'closed', detail: 'the issue is closed' });
  }
  if (at.duplicate.has(ref)) {
    found.push({ family: 'executor', label: 'duplicate', detail: 'a duplicate is never worked' });
  }
  if (at.cycle.has(ref)) {
    found.push({
      family: 'graph',
      label: 'cycle',
      detail: 'in a blocked-by cycle, which is stuck until a groomer breaks it',
    });
  }
  // The blockers here are ALREADY boundary-crossing and canonical — see
  // `dependencyGraph`. Filtering again at read time is what let cycle detection
  // and readiness disagree about the same edges.
  for (const blocker of at.blockers.get(ref) ?? []) {
    const target = at.byRef.get(blocker);
    if (target === undefined) {
      found.push({
        family: 'graph',
        label: 'unresolvable',
        detail: `blocked-by ${blocker}, which this document cannot resolve — treated as blocking`,
      });
      continue;
    }
    if (target.state === 'open') {
      found.push({ family: 'graph', label: 'blocked', detail: `blocked by ${blocker}` });
    }
  }
  const serialize = at.serialize.get(ref);
  if (serialize !== undefined) {
    for (const member of serialize) {
      if (member === ref) continue;
      // §6.2 rule 4: admission turns on an ACTIVELY-CLAIMED member. `at.claimed`
      // already carries the together expansion, so claiming one member of a
      // unit excludes the group through any of them.
      if (!at.claimed.has(member)) continue;
      if (at.byRef.get(member)?.state !== 'open') continue;
      found.push({
        family: 'graph',
        label: 'serialized',
        detail: `serialize group member ${member} is actively claimed`,
      });
    }
  }
  const executor = at.held.get(ref);
  if (executor !== undefined) {
    found.push({ family: 'executor', label: executor.label, detail: executor.detail });
  }
  return found;
}

/**
 * Every reason an issue may not start, §6.2 rule 5 included: a together group is
 * ready as a unit or not at all, so a groupmate's hold is this issue's hold.
 */
function holdsFor(ref: IssueRef, at: Index): readonly Hold[] {
  const own = ownHolds(ref, at);
  const together = at.together.get(ref);
  if (together === undefined) return own;
  const shared: Hold[] = [...own];
  for (const member of together) {
    if (member === ref) continue;
    if (at.byRef.get(member)?.state !== 'open') continue;
    for (const hold of ownHolds(member, at)) {
      // `blocked` is skipped because the graph is CONTRACTED: every member
      // already carries the unit's blockers directly, so propagating them here
      // would report one dependency twice, once in its own words and once in a
      // groupmate's. Everything else — an executor hold, a cycle, an
      // unresolvable ref, a serialize exclusion — is genuinely the groupmate's
      // and is what §6.2 rule 5 is about.
      if (hold.label === 'blocked') continue;
      shared.push({
        family: hold.family,
        label: hold.label,
        detail: `${member}, in this together group, is held: ${hold.detail}`,
      });
    }
  }
  return shared;
}

/** An effective priority, and the dependent that supplied it when it was inherited. */
interface Effective {
  readonly priority: Priority;
  readonly from?: IssueRef;
}

/**
 * Effective priority (§6.3): the highest declared priority among the issue
 * itself and every OPEN issue that transitively depends on it through
 * `blocked-by`, composed with §4.3.7's rule that a together group's is the
 * highest over its members.
 *
 * "Importance flows backward along blocking edges. If a minor issue blocks an
 * urgent one, it is not minor — it is the most urgent thing in the system."
 * Computed regardless of holds (§6.8), so a held issue that blocks urgent work
 * still propagates that urgency, which is what surfaces the case where the most
 * urgent thing in the system is waiting on a hold nobody is looking at.
 *
 * A FIXED POINT, not a memoised depth-first walk, and the two composition
 * failures that bought the rewrite are worth recording rather than rediscovering:
 *
 * - **Group priority has to participate in the flow, not be applied after it.**
 *   Taking the group maximum as a post-processing pass left the BLOCKERS of a
 *   low-priority member at their own priority, even though that member's group
 *   is a P0 schedulable unit — so the real critical path could sort behind
 *   unrelated work, which is the exact inversion §6.3 exists to prevent.
 * - **A cycle made the answer depend on traversal order.** The re-entry
 *   fallback returned a member's declared priority and then CACHED it, so
 *   whichever member the walk reached first kept the wrong value while the
 *   other was promoted — and both transitively depend on the same urgent
 *   dependent. Iterating instead means every member of a strongly connected
 *   component ends at the same answer, whatever order they are visited in.
 *
 * It terminates because every write strictly LOWERS a value drawn from
 * {0,1,2,3} and nothing ever raises one, so the total descent is bounded.
 */
function effectivePriorities(at: Index): Map<IssueRef, Effective> {
  const resolved = new Map<IssueRef, Effective>();
  for (const [ref, issue] of at.byRef) resolved.set(ref, { priority: declaredPriority(issue) });

  /** Adopt a more urgent value, reporting whether anything moved. */
  const raiseUrgency = (ref: IssueRef, candidate: Effective): boolean => {
    const current = resolved.get(ref);
    if (current === undefined || candidate.priority >= current.priority) return false;
    resolved.set(ref, candidate);
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;

    // Backward along blocking edges: a blocker inherits its dependents' urgency.
    for (const ref of at.byRef.keys()) {
      for (const dependent of at.dependents.get(ref) ?? []) {
        if (at.byRef.get(dependent)?.state !== 'open') continue;
        const inherited = resolved.get(dependent);
        if (inherited === undefined) continue;
        if (raiseUrgency(ref, { priority: inherited.priority, from: dependent })) changed = true;
      }
    }

    // Sideways across a together component: the group is one candidate, so its
    // members share the highest priority among them. Closed members are skipped
    // — a group closes member by member (§4.3.7), and one that has closed is no
    // longer part of the schedulable unit.
    for (const [ref, members] of at.together) {
      if (at.byRef.get(ref)?.state !== 'open') continue;
      for (const member of members) {
        if (member === ref) continue;
        if (at.byRef.get(member)?.state !== 'open') continue;
        const value = resolved.get(member);
        if (value === undefined) continue;
        if (raiseUrgency(ref, { priority: value.priority, from: member })) changed = true;
      }
    }
  }
  return resolved;
}

/**
 * The demo's tiebreak, standing in for §6.4's "newest first".
 *
 * `StoredIssue` carries no timestamp — the store holds what a relationship
 * surface renders and nothing else — so the demo orders on the reference
 * itself, descending. Its seed numbers issues the way a tracker does, so a
 * higher number is a newer issue and this reads as newest-first. §6.4 permits a
 * substituted tiebreak where the domain argues for one and requires only that
 * it be DETERMINISTIC, which comparing references is.
 */
function newestFirst(a: IssueRef, b: IssueRef): number {
  const numeric = Number(b) - Number(a);
  if (Number.isFinite(numeric) && numeric !== 0) return numeric;
  return b.localeCompare(a);
}

/**
 * The whole order, in the form the demo renders.
 *
 * One pass: the store's rows are projected from this rather than computed
 * beside it, so the rail and the page can never disagree about one document.
 */
export function explainOrder(
  document: GraphDocument,
  holds: readonly ExecutorHold[] = [],
  concurrencyCap = DEFAULT_CONCURRENCY_CAP,
): readonly ExplainedRow[] {
  const at = index(document, holds);
  const effective = effectivePriorities(at);

  const holdsOf = new Map<IssueRef, readonly Hold[]>();
  for (const issue of document.issues) holdsOf.set(issue.ref, holdsFor(issue.ref, at));

  // PLACEMENT IS DECIDED BY THE HOLD'S FAMILY, not by a per-issue test of the
  // things that usually produce one. The design's rule is about the family —
  // graph-derived holds render inline, executor-derived ones and duplicates
  // collapse into the footer — and asking about the family directly is what
  // makes a together group land in ONE place.
  //
  // The per-issue test this replaces read `at.held.has(ref) || duplicate`, which
  // splits a schedulable unit: `holdsFor` propagates a parked member's hold to
  // its groupmates (§6.2 rule 5), so the groupmate stayed in the spine carrying
  // an executor-derived hold rendered inline — the exact distinction the demo
  // states it never blurs. A group is ready as a unit or not at all, so it is
  // placed as a unit too.
  //
  // `closed` stays a property of the ISSUE rather than of the unit, and that is
  // not an oversight: a together group closes member by member (§4.3.7), so one
  // closed member is not a statement about the rest.
  const spineRefs: IssueRef[] = [];
  const footerRefs: IssueRef[] = [];
  for (const issue of document.issues) {
    const footer =
      issue.state === 'closed' ||
      (holdsOf.get(issue.ref) ?? []).some((hold) => hold.family === 'executor');
    (footer ? footerRefs : spineRefs).push(issue.ref);
  }

  const priorityOf = (ref: IssueRef): Priority =>
    effective.get(ref)?.priority ?? DEFAULT_PRIORITY;

  // THE UNIT OF SELECTION IS THE TOGETHER COMPONENT, NOT THE ISSUE (§4.3.7:
  // "together groups enter selection as single units: one candidate, one claim,
  // group effective priority"). Sorting issues and then handing the group its
  // first member's rank is what produced ranks that jump BACKWARD later in the
  // array: two equally-prioritised members separated by another reference under
  // the tiebreak each keep their own position while sharing one rank, and
  // `OrderRow.rank` is documented as a position rendered in ascending order. So
  // the component is grouped BEFORE the sort, and the rows come back in unit
  // order — which makes the array monotonic by construction rather than by a
  // rule every consumer has to remember.
  const inSpine = new Set(spineRefs);
  const units: IssueRef[][] = [];
  const claimed = new Set<IssueRef>();
  for (const ref of spineRefs) {
    if (claimed.has(ref)) continue;
    const members = [...(at.together.get(ref) ?? [ref])].filter((member) => inSpine.has(member));
    if (members.length === 0) members.push(ref);
    for (const member of members) claimed.add(member);
    // Newest first WITHIN the unit too, so a group renders in the same order
    // its members would have held individually.
    members.sort(newestFirst);
    units.push(members);
  }

  // A unit's effective priority is the highest over its members, and its
  // tiebreak is its newest member — both the group reading of the rules a
  // single issue gets for free.
  const unitPriority = (members: readonly IssueRef[]): Priority =>
    members.reduce<Priority>((best, ref) => (priorityOf(ref) < best ? priorityOf(ref) : best), 3);
  const unitNewest = (members: readonly IssueRef[]): IssueRef => members[0] ?? '';
  units.sort(
    (a, b) => unitPriority(a) - unitPriority(b) || newestFirst(unitNewest(a), unitNewest(b)),
  );

  const rankOf = new Map<IssueRef, number>();
  const ordered: IssueRef[] = [];
  let next = 0;
  for (const members of units) {
    const rank = next;
    next += 1;
    for (const member of members) {
      rankOf.set(member, rank);
      ordered.push(member);
    }
  }
  footerRefs.sort((a, b) => priorityOf(a) - priorityOf(b) || newestFirst(a, b));
  for (const ref of footerRefs) {
    rankOf.set(ref, next);
    next += 1;
  }

  // The ready STATIONS, in rank order and deduplicated: a together group is one
  // candidate, so it consumes one slot rather than one per member. This is what
  // the cap is counted against.
  const readySlots: number[] = [];
  for (const ref of ordered) {
    if ((holdsOf.get(ref) ?? []).length > 0) continue;
    const rank = rankOf.get(ref) ?? 0;
    if (!readySlots.includes(rank)) readySlots.push(rank);
  }
  readySlots.sort((a, b) => a - b);

  const rows: ExplainedRow[] = [];
  for (const ref of [...ordered, ...footerRefs]) {
    const issue = at.byRef.get(ref);
    if (issue === undefined) continue;
    const spine = inSpine.has(ref);
    const holdsHere = holdsOf.get(ref) ?? [];
    const ready = holdsHere.length === 0;

    // A ready row inside the cap can start now; one beyond it starts when the
    // slot `concurrencyCap` places earlier is finished, which is the rank the
    // hollow station names. Anything held is dashed, whichever family held it.
    const slot = ready && spine ? readySlots.indexOf(rankOf.get(ref) ?? 0) : -1;
    const beyondCap = slot >= concurrencyCap;
    const readyAfter = beyondCap ? readySlots[slot - concurrencyCap] : undefined;
    const station: Station = !ready ? 'dashed' : beyondCap ? 'hollow' : 'filled';

    const declared = declaredPriority(issue);
    const inherited = effective.get(ref) ?? { priority: declared };
    const provenance: Provenance =
      inherited.from !== undefined && inherited.priority < declared
        ? {
            form: 'promoted',
            declared,
            effective: inherited.priority,
            from: inherited.from,
          }
        : issue.priority === undefined
          ? { form: 'default-tier', priority: declared }
          : { form: 'declared', priority: declared };

    rows.push({
      issue,
      rank: rankOf.get(ref) ?? 0,
      // Graph-derived holds sit inline at their would-be rank and show `—`; the
      // footer group earns no rank slot, because those are not facts about the
      // work.
      showRank: spine && ready,
      placement: spine ? 'spine' : 'footer',
      ready,
      station,
      ...(readyAfter === undefined ? {} : { readyAfterRank: readyAfter }),
      holds: holdsHere,
      provenance,
      effectivePriority: inherited.priority,
      serializeGroupSize: at.serialize.get(ref)?.size ?? 0,
      togetherGroupSize: at.together.get(ref)?.size ?? 0,
    });
  }
  return rows;
}

/**
 * How many scheduler SLOTS a set of rows occupies.
 *
 * A together group is one candidate holding one rank (§4.3.7), so counting its
 * members would report more work running than the concurrency cap allows — a
 * header contradicting the stations drawn directly beneath it. Deduplicating by
 * rank is what makes a count mean the same thing a station does.
 *
 * It lives here rather than in the rendering because it is a fact about the
 * ORDER, and because a number that has to agree with the stations should be
 * computed where the stations are — and where a test can reach it.
 */
export function slotCount(rows: readonly ExplainedRow[]): number {
  return new Set(rows.map((row) => row.rank)).size;
}

/**
 * The `OrderDeriver` the store takes, projected from {@link explainOrder}.
 *
 * The executor holds are closed over rather than passed through the document,
 * for §6.8's reason: the format never learns why an executor declines ready
 * work, so they cannot travel with it.
 */
export function createDeriver(holds: readonly ExecutorHold[] = []): OrderDeriver {
  return (document: GraphDocument): readonly OrderRow[] =>
    explainOrder(document, holds)
      // FOOTER ROWS ARE NOT IN THE ORDER — that is what the footer means, and
      // the store computes `entered` and `left` by comparing one order against
      // the next. Handing it rows that were never candidates made an issue
      // LEAVING the order (a visitor marking it a duplicate) look like a move
      // to its footer rank instead, so the change summary reported a blast
      // radius that never happened.
      //
      // `explainOrder` still returns them, because the PAGE draws them: the
      // collapsed group is how a visitor sees what was excluded and why. The
      // two readers want different sets, and this is the seam between them.
      .filter((row) => row.placement === 'spine')
      .map(
        (row): OrderRow => ({
          ref: row.issue.ref,
          rank: row.rank,
          ready: row.ready,
          holdReasons: row.holds.map((hold) => hold.detail),
        }),
      );
}
