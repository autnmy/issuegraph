/**
 * The Issuegraph model — pure derivations over parsed nodes, implementing the
 * specification's reading rules (§6) plus the scalar carrier precedence
 * (§4.3.5).
 *
 * DESIGN RULES:
 *
 *   - Pure and total: `buildModel` never throws on any input; every anomaly
 *     becomes a diagnostic instead (§5.4's grooming obligations are what a
 *     consumer does with them).
 *   - Derived data lives HERE and is never written back (§2: progress roll-ups
 *     are queries, not data).
 *   - Fail-safe in one direction throughout: an unresolvable `blocked-by`
 *     BLOCKS (§6.7); a `duplicate-of` chain that cannot be resolved still marks
 *     the node a duplicate; an accidental component merge over-serializes. The
 *     costs are not symmetric — over-blocking delays work, under-blocking ships
 *     it in the wrong order — so every ambiguity resolves toward refusing.
 *
 * ── WHAT THIS MODULE NO LONGER OWNS ─────────────────────────────────────────
 *
 * Readiness, the serialize component and the `together-with` unit live in
 * `relations.ts` and this module CALLS them. It does not restate them: a
 * standalone `evaluateReadiness` and `Model.readiness` are one code path, which
 * is what makes them unable to disagree.
 *
 * WHAT IS STILL ONLY HERE is everything that needs the WHOLE set rather than
 * one node's neighbourhood — declared and effective priority, the transitive
 * promotion worklist, and §6.6 cycle detection over schedulable units — plus
 * the eager evaluation that makes every accessor a map read.
 *
 * The node types, the key helpers and `ModelOptions` are re-exported from here
 * unchanged, so this module's public surface is exactly what it was.
 */

import { DEFAULT_PRIORITY } from '@issuegraph/core';

import type { ModelNode, NodeInput, ReadinessResult, RelationsOptions } from './relations.ts';
import { UNKNOWN_NODE_READINESS, buildRelations, priorityLabelValue } from './relations.ts';

export type {
  DeclarationRead,
  DeclarerOnlyNode,
  ModelNode,
  NodeInput,
  ReadinessHold,
  ReadinessHoldCode,
  ReadinessResult,
} from './relations.ts';
export {
  declarerOnlyNode,
  evaluateReadiness,
  nodeKey,
  nodeSourceRepo,
  priorityLabelValue,
  refKey,
  resolveSerializeGroup,
  resolveTogetherUnit,
} from './relations.ts';

/**
 * Options for {@link buildModel}.
 *
 * The SAME options the relation layer takes — an alias rather than a second
 * interface, so a field added for one is never missing from the other.
 */
export type ModelOptions = RelationsOptions;


export interface DeclaredPriority {
  /** 0-3, resolved label-first (§4.3.5); 2 when neither carrier speaks. */
  readonly value: number;
  readonly source: 'label' | 'frontmatter' | 'default';
  readonly labelValue: number | null;
  readonly frontmatterValue: number | null;
  /** Both carriers present and disagreeing — a §5.4 grooming surface. */
  readonly disagreement: boolean;
}

export interface Model {
  /**
   * The SELECTABLE candidates, as canonical node keys: `"N"` for a home-repo
   * node, `"owner/repo#N"` otherwise.
   *
   * DECLARER-ONLY NODES ARE NOT HERE, and that is the tier's contract rather
   * than a filter over it: a weak node may add constraints and may never
   * satisfy one, so a scheduler enumerating this set must not be able to
   * dispatch work whose only evidence is an eventually-consistent copy. They
   * remain visible to every keyed accessor — ask `readiness` about one and it
   * says what it is — because a caller holding such a key already knows where
   * it came from. What they must never do is arrive by enumeration.
   */
  readonly keys: readonly string[];
  readonly declaredPriority: (key: string) => DeclaredPriority;
  /**
   * Effective priority (§6.3): the numerically lowest declared priority among
   * the node and every OPEN node transitively depending on it via blocked-by.
   * Closed nodes report their declared priority unchanged.
   */
  readonly effectivePriority: (key: string) => number;
  /**
   * The OPEN nodes that inherit `key`'s priority under §6.3, as sorted
   * canonical keys, excluding the key itself: the transitive closure over the
   * SAME relation `effectivePriority` relaxes — open `blocked-by` targets and
   * the other members of the together unit — so the two cannot disagree about
   * which nodes carry a key's urgency.
   *
   * It answers "this candidate is unready — what should the tier work
   * instead?", and it is a CLOSURE rather than a one-hop neighbourhood on
   * purpose: a one-hop answer offers the tier a blocker that is itself
   * unready and stops there, so the tier advances past the work that actually
   * inherits the urgency. Two prose derivations of this set were each short in
   * a different place.
   *
   * DECLARER-ONLY NODES ARE TRAVERSED THROUGH BUT NEVER RETURNED, and
   * DUPLICATES ARE NEVER RETURNED, on `keys`' and `readiness`' own tests: this
   * set names work a scheduler may pick up, and neither kind is that. Serialize
   * edges are NOT walked — §6.7 makes them a sequencing constraint, not a
   * relaxation.
   *
   * Empty for a key the model does not hold, and equally for one that nothing
   * inherits from — including any CLOSED key, which propagates no urgency.
   * Conflating unknown with empty is safe HERE, unlike in `readiness`, because
   * both genuinely mean "this model has no alternative work to offer".
   */
  readonly priorityInheritors: (key: string) => readonly string[];
  readonly readiness: (key: string) => ReadinessResult;
  /** Serialize component (§4.3.4) containing the key, as sorted keys. */
  readonly serializeComponent: (key: string) => readonly string[];
  /** Together component (§4.3.7) containing the key, as sorted keys. */
  readonly togetherComponent: (key: string) => readonly string[];
  /**
   * Whether this key's serialize component reaches PAST THE CALLER'S HORIZON —
   * some member declared a `serialize-with` this node set could not resolve,
   * so the component's true extent is unknown.
   *
   * NOT FOLDED INTO {@link readiness}, and that separation is the point. §6.7
   * is explicit that "unresolvable `serialize-with` references contribute no
   * linkage but are likewise surfaced" — unlike `blocked-by`, which blocks —
   * so a reader that refused on this would be inventing a rule the spec does
   * not have. The refusal is still real; it belongs to a CONSUMER that fetches
   * a partial neighbourhood and knows its own traversal depth, and can compose
   * it with readiness the way §6.8 composes eligibility. This model cannot,
   * because it cannot tell "not fetched yet" from "does not exist".
   *
   * Reports a MEMBER's truncation, not only the key's own declaration: the
   * unknown extent belongs to the component, so every known member is
   * affected. False for a key the model does not hold.
   */
  readonly serializeHorizonTruncated: (key: string) => boolean;
  /** Transitive duplicate-of canonical, or null when the node is canonical. */
  readonly duplicateCanonical: (key: string) => string | null;
  /** blocked-by cycles among open nodes (§6.6), each as sorted keys. */
  readonly cycles: readonly (readonly string[])[];
  /**
   * Model-level anomalies (§5.4 grooming surfaces): unresolvable refs,
   * carrier disagreements, non-completed-closure unblocks, duplicate chains
   * ending nowhere, cycles.
   */
  readonly diagnostics: readonly string[];
  /**
   * Every key whose own declaration was under-read, sorted. Empty is the
   * ordinary case and means every declaration in the set was fully read.
   *
   * WHY THIS IS ON THE SURFACE AND NOT JUST A DIAGNOSTIC — it is the seam for
   * the one thing this model provably CANNOT do for you.
   *
   * The refusals elsewhere protect nodes the model can NAME: the under-read
   * node itself, its serialize component, and anything whose edge resolved to
   * it. They cannot protect a node it cannot name. When the DROPPED FIELD IS
   * ITSELF AN EDGE — `#1` declares `together-with: 2` and the parser rejects
   * that line — the relationship never enters edge collection, so `#2` is an
   * ordinary ready singleton, indistinguishable from any other node in the set.
   * Measured, one field apart: with the edge SURVIVING the parse, `#2` came
   * back refused ("together member 1 is not ready"); with the edge DROPPED it
   * came back `{ready: true, reasons: []}` in a component of one.
   *
   * No refusal this model could compute closes that. The peer's IDENTITY is
   * what the parse destroyed, so the only sound refusal would be "refuse every
   * node while any declaration is under-read" — a global stall on one malformed
   * body, which is not a rule any consumer would want imposed.
   *
   * SO THE POLICY IS THE HOST'S, and this field is what makes it expressible.
   * A host wanting the strict §4.3.7 guarantee holds selection while this is
   * non-empty; one with a looser bar reads it for triage and grooming. That is
   * the same split `isUnreadDeclaration` already draws one layer down — the
   * QUESTION factors, the POLICY does not — and the same shape §6.7 leaves to a
   * consumer for an unresolvable `serialize-with`.
   *
   * READ IT STRUCTURALLY; DO NOT MATCH THE DIAGNOSTIC PROSE. The diagnostics
   * carry the same fact as a sentence, and a reworded sentence silently stops
   * matching and fails OPEN — the exact failure this package refuses elsewhere.
   *
   * DECLARER-ONLY NODES ARE INCLUDED, unlike `keys`. A weak node may add
   * constraints, and an under-read weak node is a constraint that could not be
   * read; a host composing the strict policy needs to know that as much as it
   * needs the full-node case.
   */
  readonly underReadKeys: readonly string[];
}


export function buildModel(
  nodes: readonly NodeInput[],
  options?: ModelOptions,
): Model {
  // THE RELATION LAYER FIRST — it owns the key map, the duplicate closure, the
  // edges and readiness. `diagnostics` is its live array: the eager readiness
  // pass below appends the §5.3 surfaces to it as it runs.
  const relations = buildRelations(nodes, options);
  const {
    byKey,
    diagnostics,
    duplicateCanonicalOf,
    blockersOf,
    serialize,
    together,
    componentMembers,
    readiness,
    unresolvedSerializeDeclarers,
  } = relations;
  /**
   * DIAGNOSTIC ORDER IS PRESERVED ACROSS THE EXTRACTION, and it takes three
   * sinks to do it. `Model.diagnostics` is consumer-visible — `deriveIssueOrder`
   * copies the array unchanged and the CLI prints it as JSON — so a reader
   * processing it sequentially, or a snapshot asserting it, must not see this
   * refactor at all.
   *
   * The original single pass emitted in phase order: declared priority, then the
   * edges, then cycles, then the eager readiness evaluation. Hoisting the
   * relation layer to the top of this function moved the EDGE phase in front of
   * the PRIORITY phase, because the edges are now resolved before this function
   * body runs. So the phases are collected separately and concatenated in the
   * original order below, rather than appended to one array in call order.
   *
   * `relations.diagnostics` is LIVE — the eager readiness pass appends the §5.3
   * surfaces to it — which is why the edge phase is snapshotted HERE, before
   * anything else runs, and the readiness phase is taken as the tail it grew.
   */
  const edgeDiagnostics = [...diagnostics];
  const priorityDiagnostics: string[] = [];
  const cycleDiagnostics: string[] = [];

  // ---- declared priority (label-first, §4.3.5) ----
  const declared = new Map<string, DeclaredPriority>();
  for (const [k, n] of byKey) {
    const labelValue = priorityLabelValue(n.labels);
    const frontmatterValue = n.data?.priority ?? null;
    const disagreement =
      labelValue !== null && frontmatterValue !== null && labelValue !== frontmatterValue;
    if (disagreement) {
      priorityDiagnostics.push(`${k}: priority label p${labelValue} disagrees with frontmatter ${frontmatterValue}`);
    }
    declared.set(k, {
      value: labelValue ?? frontmatterValue ?? DEFAULT_PRIORITY,
      source: labelValue !== null ? 'label' : frontmatterValue !== null ? 'frontmatter' : 'default',
      labelValue,
      frontmatterValue,
      disagreement,
    });
  }


  // ---- effective priority (§6.3): relax minima along blocked-by AND together ----
  // THE UNDER-READ AXIS DELIBERATELY DOES NOT REACH HERE, and the choice is
  // recorded rather than left to look like an oversight. An under-read node may
  // have declared a `blocked-by` the parser dropped, so a blocker somewhere does
  // not inherit this node's urgency. That UNDER-reports urgency — a blocker
  // ranks lower than it should — which can only reorder work, never admit any.
  // Every other site of this rule refuses something; this one has nothing to
  // refuse, and inventing a refusal here would trade a ranking imprecision for a
  // stall.
  const effective = new Map<string, number>();
  for (const [k] of byKey) effective.set(k, (declared.get(k) as DeclaredPriority).value);

  // THE §6.3 RELAXATION RELATION, DEFINED ONCE. The open nodes that inherit
  // `k`'s priority in one step: its open `blocked-by` targets, and the other
  // members of its together component.
  //
  // Its whole job is to have exactly ONE definition. Both the fold below and
  // `priorityInheritorsOf` further down are §6.3 walks over the same edges, and
  // if each stated the relation itself the second could silently keep
  // returning the old closure after a change to the first — the very drift the
  // accessor exists to remove, reintroduced one level down. Adding, removing
  // or re-guarding an edge is a change here, and both walks follow.
  //
  // The `open` filter on the blocked-by arm is the fold's own: a closed blocker
  // keeps its declared value. There is NO CLOSED-MEMBER GUARD on the together
  // arm, and its absence is the point rather than an omission: the union
  // admits a together edge only when BOTH endpoints are open, so a closed node
  // is never in another node's component and an open node's component is open
  // throughout. A guard here would be a second statement of that rule which no
  // input can reach — a mutation probe that deleted it broke nothing — and a
  // defence nothing can falsify reads as evidence that its population exists.
  // The rule lives at the union. The relation is only ever asked about an OPEN
  // key (both callers test that first), which is what keeps "yields only open
  // nodes" true without a guard.
  const relaxationSuccessors = (k: string): string[] => {
    const out: string[] = [];
    for (const blocker of blockersOf.get(k) ?? []) {
      const blockerNode = byKey.get(blocker) as ModelNode;
      if (!blockerNode.open) continue;
      out.push(blocker);
    }
    // A together unit is ONE unit of work, so its members share the highest
    // priority among them. Symmetric, unlike the blocked-by arm: no member is
    // upstream of another, so the relaxation runs in both directions and the
    // worklist settles the component on its minimum.
    for (const member of componentMembers(together, k)) {
      if (member !== k) out.push(member);
    }
    return out;
  };

  // Two relaxations, run in ONE worklist rather than in sequence, because each
  // feeds the other: §6.3 says both that importance flows backward along
  // blocking edges and that "a together group's effective priority is the
  // highest over its members". A P0 together with a P3 raises the P3 member,
  // and that member's own blockers must then inherit the unit's urgency —
  // which a blocked-by pass that had already finished would never see. The
  // relation above yields both kinds of successor, so one loop covers both.
  //
  // Values only ever decrease and are bounded below by 0, so this terminates on
  // any graph, cycles included, whichever edge did the lowering.
  const work: string[] = [...byKey.keys()];
  while (work.length > 0) {
    const k = work.pop() as string;
    const node = byKey.get(k) as ModelNode;
    if (!node.open) continue; // closed dependents do not propagate urgency
    const ep = effective.get(k) as number;
    for (const next of relaxationSuccessors(k)) {
      if ((effective.get(next) as number) > ep) {
        effective.set(next, ep);
        work.push(next);
      }
    }
  }

  // ---- priority inheritors (§6.3), the SAME relation the fold above relaxes ----
  // It consumes `relaxationSuccessors`, the one definition the fold consumes
  // too, so a change to what §6.3 relaxes over reaches both walks or neither.
  //
  // TRANSITIVE, via a worklist, for the same reason the fold is: relaxation
  // re-enqueues, so urgency reaches down a chain of any length. A one-hop
  // answer offers the tier a node that is itself unready and stops there.
  //
  // Terminates on any graph including §6.6 cycles: `seen` admits each key once,
  // so the work list is bounded by the node count. A cycle's members surface as
  // one another's inheritors, which is what the fold does too — they settle on
  // a shared minimum, and every one of them is real work the tier may take.
  const priorityInheritorsOf = (key: string): string[] => {
    const start = byKey.get(key);
    // A closed node propagates nothing (the fold's `if (!node.open) continue`),
    // and an unheld key has no edges to walk. Both answer empty.
    if (start === undefined || !start.open) return [];
    const seen = new Set<string>([key]);
    const pending: string[] = [key];
    const inheritors: string[] = [];
    // ADMISSION IS NOT DECIDED HERE — `relaxationSuccessors` owns it. What is
    // left is the EMISSION rule, which is this walk's alone: the fold relaxes
    // through node kinds a scheduler may not be handed, so traversal and
    // emission genuinely differ and only the second belongs here.
    //
    // THE DUPLICATE TEST IS `readiness`' OWN, not a second opinion about what a
    // duplicate is: it refuses a node on `duplicateCanonicalOf(k) !== null`, so
    // reusing that predicate makes this set agree with readiness by
    // construction. `targetKey` normalizes an ordinary ref to its canonical
    // before the edge is ever recorded, so on a resolvable chain no duplicate
    // reaches here at all — but a chain that CYCLES or leaves the node set has
    // no canonical, and `duplicateCanonicalOf` then answers with another
    // still-duplicate key. `10 blocked-by 1`, `1 duplicate-of 2`,
    // `2 duplicate-of 1` would return `["2"]` without this: one alternative,
    // permanently unready, and the only thing the tier was offered. Emitting it
    // is worse than emitting nothing, because it reads as work that exists.
    while (pending.length > 0) {
      const k = pending.pop() as string;
      for (const next of relaxationSuccessors(k)) {
        if (seen.has(next)) continue;
        seen.add(next);
        pending.push(next);
        const node = byKey.get(next);
        if (node !== undefined && node.declarerOnly !== true && duplicateCanonicalOf(next) === null) {
          inheritors.push(next);
        }
      }
    }
    return inheritors.sort();
  };


  // ---- cycles among open nodes (§6.6), over SCHEDULABLE UNITS ----
  const cycles: (readonly string[])[] = [];
  {
    // SPEC §6.6: a "stuck group" is a strongly connected component of the
    // open blocked-by graph. THE VERTEX IS THE UNIT, NOT THE ISSUE, because
    // §4.3.7 makes a together group one schedulable unit — ready as a unit or
    // not at all. Running the search over raw issues therefore missed a whole
    // class of real deadlock: `#1 blocked-by #2`, `#3 blocked-by #1`, and
    // `#2 together-with #3` is permanently stuck (#2 waits on #3 as its unit
    // partner, #3 waits on #1, #1 waits on #2) and reported NOWHERE — `cycles`
    // empty, `diagnostics` empty, and three readiness sentences each naming an
    // ordinary open blocker. §6.6's entire argument for detect-on-read is that
    // a groomer can see a cycle; that argument fails for a cycle with no
    // surface. Contracting each unit to one vertex is what the readiness rule
    // above already does in its own way, so the two now read the same graph.
    // Iterative Tarjan — total on any graph size, and complete over
    // OVERLAPPING cycles, which a back-edge walk misses when a shared node was
    // finished by another branch.
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const sccStack: string[] = [];
    let counter = 0;
    // A unit is named by its union-find root — an opaque, stable id. It is
    // never reported: the emission below expands every unit back to its member
    // KEYS, because a groomer needs issues it can open, not a vertex name.
    const unitOf = (k: string): string => together.find(k);
    const openMembersCache = new Map<string, string[]>();
    const openMembers = (u: string): string[] => {
      const cached = openMembersCache.get(u);
      if (cached !== undefined) return cached;
      const computed = componentMembers(together, u).filter(
        (m) => (byKey.get(m) as ModelNode | undefined)?.open === true,
      );
      openMembersCache.set(u, computed);
      return computed;
    };
    const unitBlockersCache = new Map<string, string[]>();
    const unitBlockers = (u: string): string[] => {
      const cached = unitBlockersCache.get(u);
      if (cached !== undefined) return cached;
      const members = openMembers(u);
      const out = new Set<string>();
      for (const member of members) {
        for (const b of blockersOf.get(member) ?? []) {
          // Open blockers only, exactly as before: a closed blocker does not
          // block today, and §6.6 scopes the search to open nodes.
          if ((byKey.get(b) as ModelNode | undefined)?.open !== true) continue;
          const blockerUnit = unitOf(b);
          // §4.3.7: an INTERNAL blocked-by edge (member blocking member) is
          // advisory and never a readiness input — it "would deadlock the
          // group against itself" — so it must not become a self-loop here
          // either, or every unit carrying its own advisory ordering would be
          // reported as stuck.
          // `b !== member` IS THE WHOLE CONDITION, and it is the SAME ONE
          // readiness applies at `b !== k` below. An edge from an issue to
          // ITSELF is not "advisory ordering between two members" — readiness
          // treats it as load-bearing and refuses the whole unit for it — so
          // exempting it here reported nothing while both issues were
          // permanently unready. That is the exact invisible deadlock this
          // block exists to end, reintroduced one case over: `#1 blocked-by #1`
          // with `#1 together-with #2` gave empty `cycles`, empty
          // `diagnostics`, and two issues that can never start.
          // A UNIT SIZE TEST CANNOT EXPRESS THIS. Keying on "the unit has more
          // than one member" drops a member's self-loop the moment it acquires
          // a partner; keying on the EDGE is what distinguishes the two shapes,
          // and it makes a singleton's self-loop fall out rather than needing
          // its own clause.
          if (blockerUnit === u && b !== member) continue;
          out.add(blockerUnit);
        }
      }
      const computed = [...out];
      unitBlockersCache.set(u, computed);
      return computed;
    };
    for (const [rootKey, rootNode] of byKey) {
      if (!rootNode.open) continue;
      const rootUnit = unitOf(rootKey);
      if (index.has(rootUnit)) continue;
      const frames: { key: string; nextEdge: number }[] = [{ key: rootUnit, nextEdge: 0 }];
      while (frames.length > 0) {
        const frame = frames[frames.length - 1] as { key: string; nextEdge: number };
        if (frame.nextEdge === 0) {
          index.set(frame.key, counter);
          low.set(frame.key, counter);
          counter++;
          sccStack.push(frame.key);
          onStack.add(frame.key);
        }
        const edges = unitBlockers(frame.key);
        if (frame.nextEdge < edges.length) {
          const b = edges[frame.nextEdge] as string;
          frame.nextEdge++;
          if (!index.has(b)) {
            frames.push({ key: b, nextEdge: 0 });
          } else if (onStack.has(b)) {
            low.set(frame.key, Math.min(low.get(frame.key) as number, index.get(b) as number));
          }
          continue;
        }
        // Frame complete: pop, propagate lowlink, emit an SCC root's component.
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent !== undefined) {
          low.set(parent.key, Math.min(low.get(parent.key) as number, low.get(frame.key) as number));
        }
        if (low.get(frame.key) === index.get(frame.key)) {
          const units: string[] = [];
          for (;;) {
            const m = sccStack.pop() as string;
            onStack.delete(m);
            units.push(m);
            if (m === frame.key) break;
          }
          const selfLoop =
            units.length === 1 && unitBlockers(units[0] as string).includes(units[0] as string);
          if (units.length > 1 || selfLoop) {
            // EXPANDED TO MEMBER KEYS. A stuck group of two units is a stuck
            // group of every open issue in them — each is equally unable to
            // start — and naming the units instead would hand a groomer an id
            // that appears on no issue.
            const sorted = [...new Set(units.flatMap(openMembers))].sort();
            cycles.push(sorted);
            cycleDiagnostics.push(`blocked-by cycle: ${sorted.join(" -> ")}`);
          }
        }
      }
    }
  }


  // ---- eager evaluation ----
  // The helpers above append diagnostics as they discover anomalies, so every
  // derivation runs ONCE here and the exposed API reads precomputed maps —
  // keeping the model pure (calling it never mutates or duplicates
  // diagnostics) and total over unknown keys.
  const canonicalMap = new Map<string, string | null>();
  for (const k of byKey.keys()) canonicalMap.set(k, duplicateCanonicalOf(k));
  const readinessMap = new Map<string, ReadinessResult>();
  for (const k of byKey.keys()) readinessMap.set(k, readiness(k));
  // The serialize components that reach past the horizon, keyed by union-find
  // root. One `find` per declarer here, one per ask below — a consumer that
  // composes the horizon policy for every candidate in a large component would
  // otherwise rescan that component once per member (raised in review).
  const truncatedSerializeRoots = new Set<string>();
  for (const k of unresolvedSerializeDeclarers) truncatedSerializeRoots.add(serialize.find(k));
  // The tail `relations.diagnostics` grew while the eager passes above ran —
  // the §5.3 non-completed-closure surfaces readiness emits.
  const readinessDiagnostics = diagnostics.slice(edgeDiagnostics.length);
  const uniqueDiagnostics = [
    ...new Set([
      ...priorityDiagnostics,
      ...edgeDiagnostics,
      ...cycleDiagnostics,
      ...readinessDiagnostics,
    ]),
  ];

  return {
    keys: [...byKey.keys()].filter((k) => (byKey.get(k) as ModelNode).declarerOnly !== true),
    declaredPriority: (key) =>
      declared.get(key) ?? {
        value: DEFAULT_PRIORITY,
        source: 'default',
        labelValue: null,
        frontmatterValue: null,
        disagreement: false,
      },
    effectivePriority: (key) => effective.get(key) ?? DEFAULT_PRIORITY,
    priorityInheritors: (key) => priorityInheritorsOf(key),
    readiness: (key) => readinessMap.get(key) ?? UNKNOWN_NODE_READINESS,
    serializeComponent: (key) => (byKey.has(key) ? componentMembers(serialize, key) : []),
    togetherComponent: (key) => (byKey.has(key) ? componentMembers(together, key) : []),
    // Widened from the declarer to its whole serialize component by ROOT: the
    // fact belongs to the component, so every member's answer is the same, and
    // the set of truncated roots above is what makes each ask a single find
    // rather than a rescan of the component. `byKey.has` first, so an unknown
    // key reads false rather than being assigned a root it never had.
    serializeHorizonTruncated: (key) => byKey.has(key) && truncatedSerializeRoots.has(serialize.find(key)),
    duplicateCanonical: (key) => canonicalMap.get(key) ?? null,
    cycles,
    diagnostics: uniqueDiagnostics,
    // SORTED, so the value is stable across node-input order and a host may
    // compare two builds without normalizing first. Over `byKey`, which holds
    // the declarer-only tier too — see the field's doc for why that is
    // deliberate rather than an oversight.
    underReadKeys: [...byKey.entries()]
      .filter(([, n]) => n.declarationRead === 'under-read')
      .map(([k]) => k)
      .sort(),
  };
}
