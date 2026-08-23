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
 *   - Fail-safe in one direction throughout: an unresolvable `blocked-by` ref
 *     BLOCKS (§6.7); a `duplicate-of` chain that cannot be resolved still marks
 *     the node a duplicate; an accidental component merge over-serializes. The
 *     costs are not symmetric — over-blocking delays work, under-blocking ships
 *     it in the wrong order — so every ambiguity resolves toward refusing.
 */

import { DEFAULT_PRIORITY, PRIORITY_MAX, PRIORITY_MIN } from '@issuegraph/core';

import type { Frontmatter, IssueRef } from './frontmatter.ts';

/** One issue as the model consumes it. `repo: null` means the home repo. */
export interface NodeInput {
  readonly number: number;
  readonly repo?: string | null;
  /**
   * NEVER SET ON A FULL NODE — typed `undefined` so that
   * {@link DeclarerOnlyNode} is NOT assignable to this interface.
   * That non-assignability is the whole mechanism: a declarer-only node cannot
   * reach `buildModel`'s reference-resolving `nodes` argument by any
   * widening, spread or cast-free assignment, so "a weak node answered
   * somebody's pending reference" is a compile error rather than a rule a
   * reviewer has to notice.
   */
  readonly declarerOnly?: undefined;
  readonly open: boolean;
  /**
   * GitHub's stateReason for closed nodes when known ("completed" |
   * "not_planned" | "duplicate" | null). Only consumed for the §5.3 surface:
   * a dependent unblocked by a NON-completed closure is flagged for re-groom.
   */
  readonly closedStateReason?: string | null;
  readonly labels: readonly string[];
  /**
   * Consumed ONLY for serialize-group admission (§6.2 item 4): an open member
   * with any assignee marks its component actively claimed. A node's OWN
   * assignment does NOT make it unready — claim state is the §6.8 ELIGIBILITY
   * layer, composed by selection (`ready AND eligible`), never folded into
   * graph readiness. (Folding it in would break post-claim blocker
   * re-verification and together-unit claiming, where a unit's own members
   * are assigned as the unit is taken.)
   */
  readonly assigneeCount: number;
  readonly data: Frontmatter | null;
}

/**
 * A node that may DECLARE but may never ANSWER.
 *
 * WHAT IT MEANS, EXACTLY. The model reads two things off a node: the edges its
 * own frontmatter declares, and its existence as the TARGET of somebody else's
 * `blocked-by` / `serialize-with` / `together-with` / `duplicate-of`. A
 * declarer-only node keeps the first and loses the second. Its own edges union
 * components, add blockers and carry its claim into the components it names;
 * no other node's reference ever resolves to it, so every reference that was
 * unresolvable without it stays unresolvable with it.
 *
 * WHY THE DISTINCTION EXISTS. Some node sources are
 * eventually consistent — the local issue mirror is the first, and can be a
 * quarter of an hour behind. The model's fail-safe rules turn "I could not see
 * that issue" into a REFUSAL: an unresolvable `serialize-with` refuses its
 * declarer and poisons the whole known component. Letting a behind copy supply
 * the missing node converts that refusal into an ADMISSION — which is the same
 * shape as believing a behind copy about CLOSURE, at a different site. A weak
 * source may therefore add constraints and may never satisfy one, and this
 * type is how that is enforced rather than remembered.
 *
 * It is not assignable to {@link NodeInput} (see `declarerOnly`
 * there), so it can only be passed through
 * {@link ModelOptions.declarerOnlyNodes}.
 */
export interface DeclarerOnlyNode extends Omit<NodeInput, 'declarerOnly'> {
  readonly declarerOnly: true;
}

/** The only constructor for a {@link DeclarerOnlyNode}. */
export function declarerOnlyNode(
  node: NodeInput,
): DeclarerOnlyNode {
  return { ...node, declarerOnly: true };
}

/** Either kind, for the reads that do not care which. */
export type ModelNode = NodeInput | DeclarerOnlyNode;

export interface DeclaredPriority {
  /** 0-3, resolved label-first (§4.3.5); 2 when neither carrier speaks. */
  readonly value: number;
  readonly source: 'label' | 'frontmatter' | 'default';
  readonly labelValue: number | null;
  readonly frontmatterValue: number | null;
  /** Both carriers present and disagreeing — a §5.4 grooming surface. */
  readonly disagreement: boolean;
}

export interface ReadinessResult {
  readonly ready: boolean;
  /** Empty when ready; each entry names one failed §6.2 condition. */
  readonly reasons: readonly string[];
}

export interface Model {
  /** Canonical node key: "N" for home-repo, "owner/repo#N" otherwise. */
  readonly keys: readonly string[];
  readonly declaredPriority: (key: string) => DeclaredPriority;
  /**
   * Effective priority (§6.3): the numerically lowest declared priority among
   * the node and every OPEN node transitively depending on it via blocked-by.
   * Closed nodes report their declared priority unchanged.
   */
  readonly effectivePriority: (key: string) => number;
  readonly readiness: (key: string) => ReadinessResult;
  /** Serialize component (§4.3.4) containing the key, as sorted keys. */
  readonly serializeComponent: (key: string) => readonly string[];
  /** Together component (§4.3.7) containing the key, as sorted keys. */
  readonly togetherComponent: (key: string) => readonly string[];
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
}

/**
 * The mapped-label spelling this model understands, built from the
 * specification's own priority bounds so the two cannot drift apart. A
 * character class works because both bounds are single digits; widening the
 * range past 9 needs a different construction, which is why the assertion
 * below fails loudly rather than silently matching nothing.
 *
 * The MAPPING is a tracker convention rather than a rule of the format —
 * §4.3.5 makes a tracker's own convention canonical and the frontmatter field
 * its fallback — so a host whose labels are spelled some other way supplies its
 * own resolved priority instead of relying on this.
 */
const PRIORITY_LABEL = new RegExp(`^p([${PRIORITY_MIN}-${PRIORITY_MAX}])$`, 'i');

/**
 * The mapped-label priority carried by a label set, or null when no label
 * speaks. Several priority labels resolve to the LOWEST (most urgent).
 *
 * EXPORTED because consumers that resolve the §4.3.5 carriers themselves — the
 * ordering preview reads the RAW carriers off unnormalized nodes, so it cannot
 * go through `declaredPriority` — would otherwise restate this grammar. A
 * second copy drifts the moment the label vocabulary widens.
 */
export function priorityLabelValue(labels: readonly string[]): number | null {
  let best: number | null = null;
  for (const label of labels) {
    const matched = PRIORITY_LABEL.exec(label);
    if (matched === null) continue;
    const value = Number(matched[1]);
    best = best === null ? value : Math.min(best, value);
  }
  return best;
}

/**
 * The repo a node's OWN refs resolve against: its lowercased repo, or null when
 * the node is home-repo data (unqualified, or qualified WITH the home repo —
 * SPEC §4.2 allows either spelling, so a qualified home node's bare refs must
 * still key bare).
 *
 * EXPORTED for the same reason as `priorityLabelValue`: a consumer
 * that resolves refs alongside this model has to normalize identically or its
 * keys silently miss, and a restated copy drifts. Self-normalizing on
 * `homeRepo` like `refKey`, so a caller passing a raw mixed-case repo
 * gets the same answer the model does.
 */
export function nodeSourceRepo(
  node: Pick<NodeInput, 'repo'>,
  homeRepo?: string,
): string | null {
  const rawRepo = node.repo == null ? null : node.repo.toLowerCase();
  if (rawRepo === null) return null;
  return rawRepo === homeRepo?.toLowerCase() ? null : rawRepo;
}

export function nodeKey(
  // Only the two identity fields are read, and both kinds of node carry them —
  // spelled as a `Pick` so the declarer-only tier can be keyed without the
  // signature implying it is a full node.
  node: Pick<NodeInput, 'number' | 'repo'>,
  homeRepo?: string,
): string {
  if (node.repo == null) return String(node.number);
  const repo = node.repo.toLowerCase();
  if (homeRepo !== undefined && repo === homeRepo.toLowerCase()) return String(node.number);
  return `${repo}#${node.number}`;
}

/**
 * The canonical key a ref resolves to in one model build — EXPORTED so a
 * consumer deciding whether some other node's edges are INCIDENT to a
 * candidate can ask with the model's own normalization rather than with a
 * re-derivation that could drift.
 */
export function refKey(
  ref: IssueRef,
  sourceRepo: string | null,
  homeRepo?: string,
): string {
  // SELF-NORMALIZING, like `nodeKey` above: the model
  // lowercases `homeRepo` once at its own entry, but an exported helper
  // cannot rely on callers repeating that — a raw mixed-case home repo made
  // a qualified home ref key as `owner/repo#10` while the candidate keyed
  // as `10`, and the incidence scan silently missed.
  return keyForRef(ref, sourceRepo, homeRepo?.toLowerCase());
}

function keyForRef(ref: IssueRef, sourceRepo: string | null, homeRepo?: string): string {
  const repo = (ref.repo ?? sourceRepo)?.toLowerCase() ?? null;
  if (repo === null || (homeRepo !== undefined && repo === homeRepo)) return String(ref.number);
  return `${repo}#${ref.number}`;
}

/** Minimal union-find over string keys. */
class UnionFind {
  private readonly parent = new Map<string, string>();
  find(k: string): string {
    let root = k;
    while (this.parent.get(root) !== undefined && this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    // Path compression.
    let cur = k;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    if (this.parent.get(root) === undefined) this.parent.set(root, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface ModelOptions {
  /**
   * The model's home repository (`owner/repo`). A ref or node QUALIFIED with
   * this identity normalizes to the same bare key as unqualified home data —
   * `blocked-by: home-owner/home-repo#5` and `blocked-by: 5` are the same
   * edge (SPEC §4.2 allows either spelling). Case-insensitive.
   */
  readonly homeRepo?: string;
  /**
   * Nodes from an EVENTUALLY-CONSISTENT source: they declare, they never
   * answer. See {@link DeclarerOnlyNode} for what that buys.
   *
   * They are also merged into the key map AFTER `nodes`, so "weakest source
   * loses every dedupe" stops being a property of the caller's array order and
   * becomes a property of which argument they arrived in.
   */
  readonly declarerOnlyNodes?: readonly DeclarerOnlyNode[];
}

export function buildModel(
  nodes: readonly NodeInput[],
  options?: ModelOptions,
): Model {
  const homeRepo = options?.homeRepo?.toLowerCase();
  const byKey = new Map<string, ModelNode>();
  // THE KEYS A REFERENCE MAY RESOLVE TO. Built here and consulted at every one
  // of the four ref-resolution sites below (`blocked-by`, `serialize-with`,
  // `together-with`, the `duplicate-of` chain) — never `byKey.has`, which also
  // holds the declarer-only tier.
  const referenceable = new Set<string>();
  for (const n of nodes) {
    const k = nodeKey(n, homeRepo);
    if (!byKey.has(k)) {
      byKey.set(k, n); // first occurrence wins; dupes inert
      referenceable.add(k);
    }
  }
  // AFTER the full nodes, unconditionally: a declarer-only node can only ever
  // occupy a key no full node claimed, and even then it does not become
  // referenceable.
  for (const n of options?.declarerOnlyNodes ?? []) {
    const k = nodeKey(n, homeRepo);
    if (!byKey.has(k)) byKey.set(k, n);
  }
  const diagnostics: string[] = [];

  // ---- declared priority (label-first, §4.3.5) ----
  const declared = new Map<string, DeclaredPriority>();
  for (const [k, n] of byKey) {
    const labelValue = priorityLabelValue(n.labels);
    const frontmatterValue = n.data?.priority ?? null;
    const disagreement =
      labelValue !== null && frontmatterValue !== null && labelValue !== frontmatterValue;
    if (disagreement) {
      diagnostics.push(`${k}: priority label p${labelValue} disagrees with frontmatter ${frontmatterValue}`);
    }
    declared.set(k, {
      value: labelValue ?? frontmatterValue ?? DEFAULT_PRIORITY,
      source: labelValue !== null ? 'label' : frontmatterValue !== null ? 'frontmatter' : 'default',
      labelValue,
      frontmatterValue,
      disagreement,
    });
  }

  // ---- duplicate closure (§4.3.3) ----
  const canonicalCache = new Map<string, string | null>();
  const duplicateCanonicalOf = (key: string): string | null => {
    const cached = canonicalCache.get(key);
    if (cached !== undefined) return cached;
    const seen = new Set<string>([key]);
    const path: string[] = [key];
    let cur = byKey.get(key);
    let curKey = key;
    let hops = 0;
    let result: string | null = null;
    while (cur?.data?.duplicateOf != null) {
      const nextKey = keyForRef(cur.data.duplicateOf, nodeSourceRepo(cur, homeRepo), homeRepo);
      hops++;
      if (seen.has(nextKey)) {
        diagnostics.push(`${key}: duplicate-of chain cycles at ${nextKey}`);
        result = nextKey;
        break;
      }
      seen.add(nextKey);
      const next = referenceable.has(nextKey) ? byKey.get(nextKey) : undefined;
      if (next === undefined) {
        // Canonical outside the supplied node set: still a duplicate, and a
        // grooming/seeding signal — the neighborhood is missing the target.
        diagnostics.push(`${key}: duplicate-of chain leaves the node set at ${nextKey}`);
        result = nextKey;
        break;
      }
      const nextCached = canonicalCache.get(nextKey);
      if (nextCached !== undefined) {
        result = nextCached ?? nextKey;
        break;
      }
      path.push(nextKey);
      curKey = nextKey;
      cur = next;
    }
    if (hops === 0) {
      canonicalCache.set(key, null);
      return null;
    }
    if (result === null) {
      // Walk ended on an in-set canonical: it caches null; the rest cache it.
      result = curKey;
      for (const k of path) canonicalCache.set(k, k === result ? null : result);
      return key === result ? null : result;
    }
    // Cycle or set-exit: NO member may cache null (a cycle has no canonical,
    // and null reads as "canonical" downstream). The member equal to the walk
    // result points at its own duplicate-of target instead — non-null even for
    // a self-reference, so every cycle member stays a duplicate.
    for (const k of path) {
      if (k === result) {
        const kn = byKey.get(k);
        const target =
          kn?.data?.duplicateOf != null
            ? keyForRef(kn.data.duplicateOf, nodeSourceRepo(kn, homeRepo), homeRepo)
            : result;
        canonicalCache.set(k, target);
      } else {
        canonicalCache.set(k, result);
      }
    }
    if (!canonicalCache.has(key)) canonicalCache.set(key, result);
    return canonicalCache.get(key) as string | null;
  };

  // ---- edges ----
  // blockersOf[k] = keys k is blocked by (resolved refs only; unresolved refs
  // recorded separately and treated as blocking, §6.7).
  const blockersOf = new Map<string, string[]>();
  const unresolvedBlockers = new Map<string, string[]>();
  // Unresolved SERIALIZE/TOGETHER targets refuse their declarer —
  // "no linkage" admitted a candidate beside the very sibling the edge
  // forbids (the sibling was simply unfetchable this walk: budget, fault,
  // 404). Same fail-safe family as unresolved blocked-by.
  const unresolvedRelations = new Map<string, string[]>();
  // Tracked SEPARATELY from the map above, and not derived from it by reading
  // the label text. The component-extent rule below is about the SERIALIZE
  // component's boundary, so only an unresolved serialize link may trigger it;
  // an unresolved together link says the declarer's UNIT extends past the
  // horizon, which is already why that declarer alone is refused. Keeping both
  // kinds in one map made an unresolved together link on B refuse B's serialize
  // peer A indefinitely, for a reason that was never about A.
  const unresolvedSerialize = new Set<string>();
  const dependentsOf = new Map<string, string[]>(); // reverse of blockersOf
  const serialize = new UnionFind();
  const together = new UnionFind();

  for (const [k, n] of byKey) {
    const data = n.data;
    if (data === null) continue;
    // A DUPLICATE CONTRIBUTES NO RELATIONSHIP EDGES. §4.3.3 says a duplicate is
    // ignored in favour of its canonical, and an issue nobody may work cannot
    // block one, cannot hold a serialize component, and cannot be half of a
    // unit of work. Reading its edges anyway let STALE METADATA ON AN IGNORED
    // ISSUE refuse live work: a duplicate carrying `together-with: 3` unioned
    // itself with #3, and its own permanent "duplicate-of another issue"
    // unreadiness then made #3 unready too — canonical work unselectable
    // because of a field on an issue the spec says to ignore.
    //
    // Its `duplicate-of` is still read: the closure above walks it directly off
    // `data`, which is why that closure had to move ahead of this loop rather
    // than the guard being written the other way round.
    if (duplicateCanonicalOf(k) !== null) continue;
    const sourceRepo = nodeSourceRepo(n, homeRepo);
    for (const ref of data.blockedBy) {
      const rk = keyForRef(ref, sourceRepo, homeRepo);
      if (referenceable.has(rk)) {
        blockersOf.set(k, [...(blockersOf.get(k) ?? []), rk]);
        dependentsOf.set(rk, [...(dependentsOf.get(rk) ?? []), k]);
      } else {
        unresolvedBlockers.set(k, [...(unresolvedBlockers.get(k) ?? []), rk]);
        diagnostics.push(`${k}: blocked-by ${rk} is unresolvable in this node set; treated as blocking`);
      }
    }
    if (data.serializeWith !== null) {
      const rk = keyForRef(data.serializeWith, sourceRepo, homeRepo);
      if (referenceable.has(rk)) serialize.union(k, rk);
      else {
        unresolvedRelations.set(k, [...(unresolvedRelations.get(k) ?? []), `serialize-with ${rk}`]);
        unresolvedSerialize.add(k);
        diagnostics.push(`${k}: serialize-with ${rk} is unresolvable; fail-safe: refusing the declarer`);
      }
    }
    if (data.togetherWith !== null) {
      const rk = keyForRef(data.togetherWith, sourceRepo, homeRepo);
      const target = referenceable.has(rk) ? byKey.get(rk) : undefined;
      if (target === undefined) {
        unresolvedRelations.set(k, [...(unresolvedRelations.get(k) ?? []), `together-with ${rk}`]);
        diagnostics.push(`${k}: together-with ${rk} is unresolvable; fail-safe: refusing the declarer`);
      } else if (n.open && target.open) {
        // Only OPEN endpoints union: a closed member has left the unit and
        // must not bridge two open members into one active component.
        together.union(k, rk);
      }
    }
  }

  const membersByRoot = (uf: UnionFind): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const k of byKey.keys()) {
      const root = uf.find(k);
      const arr = m.get(root);
      if (arr === undefined) m.set(root, [k]);
      else arr.push(k);
    }
    for (const arr of m.values()) arr.sort();
    return m;
  };
  const serializeMembersByRoot = membersByRoot(serialize);
  const togetherMembersByRoot = membersByRoot(together);
  const componentMembers = (uf: UnionFind, key: string): string[] => {
    const table = uf === serialize ? serializeMembersByRoot : togetherMembersByRoot;
    return table.get(uf.find(key)) ?? [key];
  };


  // ---- effective priority (§6.3): relax minima along blocked-by AND together ----
  const effective = new Map<string, number>();
  for (const [k] of byKey) effective.set(k, (declared.get(k) as DeclaredPriority).value);
  // Two relaxations, run in ONE worklist rather than in sequence, because each
  // feeds the other: §6.3 says both that importance flows backward along
  // blocking edges and that "a together group's effective priority is the
  // highest over its members". A P0 together with a P3 raises the P3 member,
  // and that member's own blockers must then inherit the unit's urgency —
  // which a blocked-by pass that had already finished would never see.
  //
  // Values only ever decrease and are bounded below by 0, so this terminates on
  // any graph, cycles included, whichever edge did the lowering.
  const work: string[] = [...byKey.keys()];
  while (work.length > 0) {
    const k = work.pop() as string;
    const node = byKey.get(k) as ModelNode;
    if (!node.open) continue; // closed dependents do not propagate urgency
    const ep = effective.get(k) as number;
    for (const blocker of blockersOf.get(k) ?? []) {
      const blockerNode = byKey.get(blocker) as ModelNode;
      if (!blockerNode.open) continue; // closed blockers keep their declared value
      if ((effective.get(blocker) as number) > ep) {
        effective.set(blocker, ep);
        work.push(blocker);
      }
    }
    // A together unit is ONE unit of work, so its members share the highest
    // priority among them. Symmetric, unlike the blocked-by arm: no member is
    // upstream of another, so the relaxation runs in both directions and the
    // worklist settles the component on its minimum.
    //
    // NO CLOSED-MEMBER GUARD HERE, and its absence is the point rather than an
    // omission: the union above admits a together edge only when BOTH endpoints
    // are open, so a closed node is never in another node's component and an
    // open node's component is open throughout. A guard here would be a second
    // statement of that rule which no input can reach — a mutation probe that
    // deleted it broke nothing — and a defence nothing can falsify reads as
    // evidence that its population exists. The rule lives at the union.
    for (const member of componentMembers(together, k)) {
      if (member === k) continue;
      if ((effective.get(member) as number) > ep) {
        effective.set(member, ep);
        work.push(member);
      }
    }
  }

  // ---- cycles among open nodes (§6.6) ----
  const cycles: (readonly string[])[] = [];
  {
    // SPEC §6.6: a "stuck group" is a strongly connected component of the
    // open blocked-by graph (size > 1, or a self-loop). Iterative Tarjan —
    // total on any graph size, and complete over OVERLAPPING cycles, which a
    // back-edge walk misses when a shared node was finished by another branch.
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const sccStack: string[] = [];
    let counter = 0;
    const openBlockersCache = new Map<string, string[]>();
    const openBlockers = (k: string): string[] => {
      const cached = openBlockersCache.get(k);
      if (cached !== undefined) return cached;
      const computed = (blockersOf.get(k) ?? []).filter(
        (b) => (byKey.get(b) as ModelNode).open,
      );
      openBlockersCache.set(k, computed);
      return computed;
    };
    for (const [rootKey, rootNode] of byKey) {
      if (!rootNode.open || index.has(rootKey)) continue;
      const frames: { key: string; nextEdge: number }[] = [{ key: rootKey, nextEdge: 0 }];
      while (frames.length > 0) {
        const frame = frames[frames.length - 1] as { key: string; nextEdge: number };
        if (frame.nextEdge === 0) {
          index.set(frame.key, counter);
          low.set(frame.key, counter);
          counter++;
          sccStack.push(frame.key);
          onStack.add(frame.key);
        }
        const edges = openBlockers(frame.key);
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
          const members: string[] = [];
          for (;;) {
            const m = sccStack.pop() as string;
            onStack.delete(m);
            members.push(m);
            if (m === frame.key) break;
          }
          const selfLoop =
            members.length === 1 && openBlockers(members[0] as string).includes(members[0] as string);
          if (members.length > 1 || selfLoop) {
            const sorted = [...members].sort();
            cycles.push(sorted);
            diagnostics.push(`blocked-by cycle: ${sorted.join(" -> ")}`);
          }
        }
      }
    }
  }

  // ---- readiness (§6.2) ----
  // Base readiness checks items 1-4; together-unit conjunction (item 5) is
  // layered on top, with member blocked-by evaluated over BOUNDARY-CROSSING
  // edges only (§4.3.7 — internal edges are advisory, never readiness inputs).
  const baseReasons = (k: string, togetherMembers: ReadonlySet<string> | null): string[] => {
    const n = byKey.get(k) as ModelNode;
    const reasons: string[] = [];
    if (!n.open) reasons.push('closed');
    if (duplicateCanonicalOf(k) !== null) reasons.push('duplicate-of another issue');
    for (const b of blockersOf.get(k) ?? []) {
      // INTERNAL EDGE (§4.3.7) — advisory, not a readiness input. `b !== k` is
      // load-bearing: a node blocked by ITSELF is a groomed-graph defect, not
      // an internal edge, and exempting it would let merely JOINING a together
      // component (which any declarer naming this node can cause) turn a
      // self-block into readiness. The exemption is for edges between two
      // members, never for a member's edge to itself.
      if (b !== k && togetherMembers?.has(b) === true) continue;
      const bn = byKey.get(b) as ModelNode;
      if (bn.open) reasons.push(`blocked-by ${b} is open`);
      else if (
        bn.closedStateReason != null &&
        bn.closedStateReason !== 'completed'
      ) {
        // Unblocked, but flag for re-groom (§5.3) — a diagnostic, not a block.
        diagnostics.push(`${k}: unblocked by non-completed closure of ${b}; re-check its premise`);
      }
    }
    for (const u of unresolvedBlockers.get(k) ?? []) {
      reasons.push(`blocked-by ${u} is unresolvable (fail-safe: blocking)`);
    }
    for (const u of unresolvedRelations.get(k) ?? []) {
      reasons.push(`${u} is unresolvable (fail-safe: refusing the declarer)`);
    }
    // An unresolved serialize/together link poisons the WHOLE
    // known component, not only its declarer. A chain truncated past the
    // traversal horizon (10 - 20 - 30 - [unfetched 40] - 11) otherwise
    // splits into a refused declarer (30), still-admitted members (10, 20)
    // and an invisible far end (11) — and a batch tick can seed BOTH ends
    // of one serialize chain concurrently. Refusing every known member
    // keeps at most the invisible end seedable: one member, serialization
    // preserved. The refusal clears when the link resolves (deeper
    // traversal or the target entering the walk).
    for (const m of componentMembers(serialize, k)) {
      const memberUnresolved = unresolvedSerialize.has(m) ? unresolvedRelations.get(m) : undefined;
      if (m !== k && memberUnresolved !== undefined && memberUnresolved.length > 0) {
        reasons.push(
          `serialize component member ${m} has an unresolvable link (${memberUnresolved[0]}) — the component's true extent is unknown (fail-safe)`,
        );
        break;
      }
    }
    const serializeMembers = componentMembers(serialize, k);
    if (serializeMembers.length > 1 || (byKey.get(k) as ModelNode).data?.serializeWith != null) {
      for (const m of serializeMembers) {
        // SELF-EXCLUDED: a node's own claim is the claim
        // protocol's concern (assignment gating, recovery exemptions), never
        // its own serialize refusal — counting self made a recovery-paged
        // bot-assigned candidate refuse its own component. OTHER members'
        // claims are exactly what the edge forbids running beside.
        //
        // THE WHOLE TOGETHER UNIT IS EXCLUDED FOR THE SAME REASON, not just
        // this node. A together unit is claimed ATOMICALLY (§4.3.7), so its
        // members are assigned as the unit is taken — and where a unit also
        // shares a serialize component, each member would then read its own
        // partner's assignment as a conflicting claim and the unit would go
        // unready the instant it was claimed, breaking post-claim
        // re-verification. `NodeInput.assigneeCount` already names this case as
        // the reason self-exclusion exists; the exclusion was simply narrower
        // than its own rationale. The blocked-by arm above draws the same
        // boundary with the same member set.
        if (m === k || togetherMembers?.has(m) === true) continue;
        const mn = byKey.get(m) as ModelNode;
        if (mn.open && mn.assigneeCount > 0) {
          reasons.push(`serialize group member ${m} is actively claimed`);
          break;
        }
      }
    }
    return reasons;
  };

  const readiness = (key: string): ReadinessResult => {
    if (!byKey.has(key)) return { ready: false, reasons: ['unknown node'] };
    const togetherMembers = componentMembers(together, key);
    if (togetherMembers.length <= 1) {
      const reasons = baseReasons(key, null);
      return { ready: reasons.length === 0, reasons };
    }
    const memberSet = new Set(togetherMembers.filter((m) => (byKey.get(m) as ModelNode).open));
    const reasons = baseReasons(key, memberSet);
    for (const m of togetherMembers) {
      if (m === key) continue;
      const mn = byKey.get(m) as ModelNode;
      if (!mn.open) continue; // closed members leave the unit (§4.3.7)
      const mReasons = baseReasons(m, memberSet);
      if (mReasons.length > 0) {
        reasons.push(`together member ${m} is not ready (${mReasons[0]})`);
      }
    }
    return { ready: reasons.length === 0, reasons };
  };

  // ---- eager evaluation ----
  // The helpers above append diagnostics as they discover anomalies, so every
  // derivation runs ONCE here and the exposed API reads precomputed maps —
  // keeping the model pure (calling it never mutates or duplicates
  // diagnostics) and total over unknown keys.
  const canonicalMap = new Map<string, string | null>();
  for (const k of byKey.keys()) canonicalMap.set(k, duplicateCanonicalOf(k));
  const readinessMap = new Map<string, ReadinessResult>();
  for (const k of byKey.keys()) readinessMap.set(k, readiness(k));
  const uniqueDiagnostics = [...new Set(diagnostics)];

  return {
    keys: [...byKey.keys()],
    declaredPriority: (key) =>
      declared.get(key) ?? {
        value: DEFAULT_PRIORITY,
        source: 'default',
        labelValue: null,
        frontmatterValue: null,
        disagreement: false,
      },
    effectivePriority: (key) => effective.get(key) ?? DEFAULT_PRIORITY,
    readiness: (key) => readinessMap.get(key) ?? { ready: false, reasons: ['unknown node'] },
    serializeComponent: (key) => (byKey.has(key) ? componentMembers(serialize, key) : []),
    togetherComponent: (key) => (byKey.has(key) ? componentMembers(together, key) : []),
    duplicateCanonical: (key) => canonicalMap.get(key) ?? null,
    cycles,
    diagnostics: uniqueDiagnostics,
  };
}
