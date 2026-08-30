/**
 * The RELATION LAYER — the derivations that answer a question about ONE issue's
 * place in the graph: is it ready (§6.2), what is its serialize group (§4.3.4),
 * and what is its `together-with` unit (§4.3.7).
 *
 * WHY IT IS ITS OWN MODULE. `buildModel` answers those three as well, and did so
 * ONLY as part of building everything else: declared and effective priority,
 * the transitive promotion worklist, strongly-connected-component cycle
 * detection, and an EAGER readiness evaluation of every node in the set. A
 * scheduler asking "is this one candidate ready?" per candidate therefore paid
 * for the whole corpus, N times over.
 *
 * So the three derivations live here and `buildModel` CALLS them. That
 * direction is the point and it is the one property this split has to keep: the
 * model is a layer ON TOP of this file, never a second opinion beside it. A
 * standalone answer and the model's answer are the same code path, so they
 * cannot disagree — which is the same rule `model.ts` states for its own
 * relationship to `@issuegraph/derive`, applied one layer down.
 *
 * WHAT A SINGLE-QUESTION CALL STILL PAYS FOR, stated plainly rather than
 * implied away: the edge pass over the supplied nodes. That is not overhead
 * this design failed to remove — it is inherent. A `serialize-with` edge is
 * declared by the node that HOLDS it, so any node in the set may pull a peer
 * into your component, and no correct answer about your component is available
 * without reading every declaration. What a single question no longer pays for
 * is everything layered above that pass.
 *
 * Pure and total throughout, exactly as `model.ts` is: no fetching, no writes,
 * no clock, and no input makes any of this throw. Closure and claim state
 * arrive as `NodeInput.open` and `NodeInput.assigneeCount` — supplied by the
 * host, never read from a tracker here.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import { PRIORITY_MAX, PRIORITY_MIN } from '@issuegraph/core';

import type { Frontmatter, IssueRef } from './frontmatter.ts';

/** One issue as the model consumes it. `repo: null` means the home repo. */
export interface NodeInput {
  /**
   * The tracker's own identifier for this issue, without any `#` sigil (§4.2).
   * A STRING because a reference is one: an id and the refs pointing at it have
   * to be the same kind of thing or they cannot be compared, and the format
   * admits `ABC-123` as readily as `123`.
   */
  readonly id: string;
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
  /**
   * How completely this node's OWN declaration was read.
   *
   * REQUIRED, and that is the mechanism rather than a style choice. `data`
   * cannot express this: the parser's field-drop row returns a NON-NULL `data`
   * with a field rejected, so `blocked-by: [123, "a ref"]` yields a node
   * gated on `123` alone and `serialize-with: "a ref"` yields a node that
   * reads exactly like a body declaring no relation at all. Both are an absence
   * rendered as a value. An optional field would let a producer silently omit
   * it and restore precisely that defect — as an UNSTATED one, since the
   * omission would compile.
   *
   * Answer it with `isUnreadDeclaration` over the SAME `ParseResult` whose
   * `data` you pass here; the pair travels together or the fact is lost.
   */
  readonly declarationRead: DeclarationRead;
}

/**
 * How completely a node's issuegraph declaration was read.
 *
 * - `'read'` — nothing was lost. This covers a body with NO block at all:
 *   nothing was declared, so nothing was dropped. It also covers a node whose
 *   `data` was SYNTHESIZED rather than parsed, where there is no body to
 *   under-read.
 * - `'under-read'` — a DELIMITED block was found and something inside it could
 *   not be read, so `data` is a PARTIAL declaration and its silence about any
 *   edge is not evidence.
 *
 * THE AXIS IS `isUnreadDeclaration`, NOT `diagnostics.length > 0`. That
 * predicate's doc owns the reasoning and is cited rather than paraphrased here;
 * the consequence that matters at this seam is that the
 * `undelimited`/`unterminated` family is excluded by construction, so the
 * header-carrying bodies written without a `---` pair — the overwhelming
 * majority of hand-authored ones — stay exactly as inert as they are today and
 * none of the rules below reaches them.
 */
export type DeclarationRead = 'read' | 'under-read';

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

export interface ReadinessResult {
  readonly ready: boolean;
  /** Empty when ready; each entry names one failed §6.2 condition. */
  readonly reasons: readonly string[];
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
 * its fallback — and `P0`–`P3` is the only spelling this version understands.
 *
 * SAY WHAT THAT COSTS RATHER THAN IMPLYING A WAY OUT. An earlier draft of this
 * comment said a host with different labels "supplies its own resolved priority
 * instead of relying on this", which the API does not let it do: `NodeInput`
 * carries raw `labels` and nothing else, and `ModelOptions` has no hook. So a
 * tracker whose canonical convention is, say, a `priority:critical` label gets
 * that label ignored and the frontmatter value reported as canonical — quietly
 * inverting §4.3.5's precedence for exactly the host that needed it.
 *
 * A confident comment describing a capability that does not exist is worse than
 * no comment: it closes the question for the next reader. The hook is a small
 * additive change and belongs to its own decision, not to this port —
 * https://github.com/autnmy/issuegraph/issues/5.
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
  node: Pick<NodeInput, 'id' | 'repo'>,
  homeRepo?: string,
): string {
  if (node.repo == null) return node.id;
  const repo = node.repo.toLowerCase();
  if (homeRepo !== undefined && repo === homeRepo.toLowerCase()) return node.id;
  return `${repo}#${node.id}`;
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
  if (repo === null || (homeRepo !== undefined && repo === homeRepo)) return ref.id;
  return `${repo}#${ref.id}`;
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

export interface RelationsOptions {
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

/**
 * The resolved relation graph over one node set — the shared substrate
 * `buildModel` layers priority, promotion and cycles on top of, and the three
 * entry points below read one answer out of.
 *
 * INTERNAL TO THE PACKAGE. It is not exported from `index.ts`: it hands out
 * live mutable structures (`diagnostics` grows as readiness is evaluated, the
 * union-finds path-compress) and its shape is an implementation detail of the
 * split, not a contract. Consumers get the three functions.
 */
export interface Relations {
  readonly homeRepo: string | undefined;
  readonly byKey: ReadonlyMap<string, ModelNode>;
  readonly referenceable: ReadonlySet<string>;
  /** LIVE: `readiness` appends §5.3 surfaces as it evaluates. */
  readonly diagnostics: string[];
  readonly duplicateCanonicalOf: (key: string) => string | null;
  readonly blockersOf: ReadonlyMap<string, readonly string[]>;
  readonly serialize: UnionFind;
  readonly together: UnionFind;
  readonly componentMembers: (uf: UnionFind, key: string) => string[];
  readonly readiness: (key: string) => ReadinessResult;
}

/**
 * Resolve the relation graph over `nodes`.
 *
 * Everything except the component tables is computed eagerly, because the edge
 * pass has to see every declaration anyway (see the module header). The tables
 * materialize on first ask.
 */
export function buildRelations(
  nodes: readonly NodeInput[],
  options?: RelationsOptions,
): Relations {

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
  /**
   * Declarers whose `together-with` resolved to a CLOSED node that had itself
   * been under-read — so "it left the unit" is not a fact anyone established.
   *
   * SEPARATE FROM `unresolvedRelations` because the reference DID resolve: the
   * node is here and referenceable, and only its REDIRECT is unknown. Folding
   * the two would report a node we can see as one we cannot, which is a
   * different diagnosis with a different remedy.
   */
  const underReadTogether = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>(); // reverse of blockersOf
  const serialize = new UnionFind();
  const together = new UnionFind();

  for (const [k, n] of byKey) {
    // REPORTED BEFORE THE `data === null` GUARD BELOW, deliberately: an
    // under-read node can be either shape. A delimited block that was UNUSABLE
    // yields `data: null`, and a block that merely DROPPED A FIELD yields
    // non-null `data` — the second is the one that reads as complete, so a
    // diagnostic emitted only on the edge-bearing path would miss half the
    // population it exists to surface.
    if (n.declarationRead === 'under-read') {
      diagnostics.push(
        `${k}: its own issuegraph declaration was not fully read; its silence about an edge is not evidence (fail-safe: refusing the node and its serialize component)`,
      );
    }
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
    // ...AND NO EDGE POINTS AT ONE EITHER. The guard above is only half the
    // rule: it stops a duplicate DECLARING, while an edge naming a duplicate as
    // its TARGET still admitted it, so a canonical issue `together-with` a
    // duplicate unioned the duplicate into its unit and inherited its permanent
    // "duplicate-of another issue" unreadiness. Same harm as the outgoing half,
    // reached from the other side.
    //
    // RESOLVED THROUGH TO THE CANONICAL rather than ignored, because ignoring
    // is unsafe in one direction that matters: `blocked-by` naming a duplicate
    // would stop blocking, and the work it names is still open under another
    // number — under-blocking, which ships work in the wrong order. Resolving
    // keeps the block, and for the group edges it over-serializes at worst,
    // which is the direction this model resolves every ambiguity toward. It is
    // also what §4.3.3 means by pointing at the canonical.
    //
    // A canonical outside the node set falls through to each branch's own
    // unresolvable arm, which is correct: `blocked-by` blocks, `serialize-with`
    // contributes no linkage (§6.7), `together-with` refuses its declarer.
    const targetKey = (ref: IssueRef): string => {
      const rk = keyForRef(ref, sourceRepo, homeRepo);
      // ONLY CANONICALIZE A KEY THAT IS ALREADY REFERENCEABLE. The walk reads
      // `byKey`, which includes the declarer-only tier, so canonicalizing first
      // let a WEAK node's stale `duplicate-of` carry a reference onto a closed
      // canonical and satisfy a `blocked-by` that was blocking without it.
      // That inverts the tier's whole contract — it may add constraints and may
      // never satisfy one — and it does so by REMOVING a refusal, which is the
      // direction that ships work in the wrong order.
      //
      // Gating here rather than inside the walk, because the walk already gates
      // every hop AFTER the first on `referenceable`; the starting key was the
      // one position that had no such test, and it had none because before
      // targets were canonicalized at all it was always a full node.
      return referenceable.has(rk) ? (duplicateCanonicalOf(rk) ?? rk) : rk;
    };
    for (const ref of data.blockedBy) {
      const rk = targetKey(ref);
      if (referenceable.has(rk)) {
        blockersOf.set(k, [...(blockersOf.get(k) ?? []), rk]);
        dependentsOf.set(rk, [...(dependentsOf.get(rk) ?? []), k]);
      } else {
        unresolvedBlockers.set(k, [...(unresolvedBlockers.get(k) ?? []), rk]);
        diagnostics.push(`${k}: blocked-by ${rk} is unresolvable in this node set; treated as blocking`);
      }
    }
    if (data.serializeWith !== null) {
      const rk = targetKey(data.serializeWith);
      if (referenceable.has(rk)) serialize.union(k, rk);
      else {
        // §6.7, VERBATIM: "Unresolvable `serialize-with` references contribute
        // no linkage but are likewise surfaced." So this is a diagnostic and
        // nothing else — no union, no refusal of the declarer, and no refusal
        // of the component the declarer is in.
        //
        // It used to do all three, on the reasoning that a chain truncated past
        // the traversal horizon leaves a component whose true extent is unknown,
        // so refusing every known member keeps at most the invisible end
        // schedulable. That argument is real, and it belongs to a CONSUMER's
        // policy layer rather than to this reader: a host that fetches a partial
        // neighbourhood knows its own horizon, and can compose that refusal with
        // readiness the way §6.8 composes eligibility. Baking it in here made an
        // otherwise-ready issue invisible to selection whenever its target
        // happened not to be fetched, which is a rule the spec explicitly does
        // not have — and, unlike the blocked-by case one branch up, §6.7 spells
        // out the difference between the two rather than leaving it to be
        // inferred.
        diagnostics.push(`${k}: serialize-with ${rk} is unresolvable; contributes no linkage (§6.7)`);
      }
    }
    if (data.togetherWith !== null) {
      const rk = targetKey(data.togetherWith);
      const target = referenceable.has(rk) ? byKey.get(rk) : undefined;
      if (target === undefined) {
        unresolvedRelations.set(k, [...(unresolvedRelations.get(k) ?? []), `together-with ${rk}`]);
        diagnostics.push(`${k}: together-with ${rk} is unresolvable; fail-safe: refusing the declarer`);
      } else if (!target.open && target.declarationRead === 'under-read') {
        // "A CLOSED MEMBER HAS LEFT THE UNIT" IS READ OFF THE TARGET'S OWN
        // DECLARATION, and for this target that declaration was not fully read.
        // `targetKey` resolves the ref through the target's `duplicate-of`, so a
        // dropped one stops the edge at a closed duplicate instead of carrying
        // it to a canonical that may still be an OPEN member of the unit. The
        // union below then never happens, `readiness` never evaluates the unit,
        // and the declarer reports ready alone — a §4.3.7 atomic unit silently
        // dissolved by a field nobody could read.
        //
        // MEASURED, one field apart: with the target closed and its
        // `duplicate-of: 3` DROPPED the declarer came back
        // `{ready: true, reasons: []}` in a component of one; with the same
        // field PARSED it came back refused, in a two-member unit with #3.
        underReadTogether.set(k, [...(underReadTogether.get(k) ?? []), rk]);
        diagnostics.push(
          `${k}: together-with ${rk} resolves to a closed node whose own declaration was under-read; whether it left the unit is unknown (fail-safe: refusing the declarer)`,
        );
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
  // MATERIALIZED ON FIRST ASK, not eagerly. Each table is a scan of every key
  // plus a sort per component, and the single-question entry points below need
  // at most one of them: `resolveTogetherUnit` never touches the serialize
  // table and `resolveSerializeGroup` never touches the together one. The
  // tables are still built at most once per `buildRelations`, so `buildModel`
  // — which reads both — pays exactly what it paid before.
  let serializeMembersByRoot: Map<string, string[]> | null = null;
  let togetherMembersByRoot: Map<string, string[]> | null = null;
  const componentMembers = (uf: UnionFind, key: string): string[] => {
    let table: Map<string, string[]>;
    if (uf === serialize) {
      serializeMembersByRoot ??= membersByRoot(serialize);
      table = serializeMembersByRoot;
    } else {
      togetherMembersByRoot ??= membersByRoot(together);
      table = togetherMembersByRoot;
    }
    return table.get(uf.find(key)) ?? [key];
  };

  // ---- readiness (§6.2) ----
  // Base readiness checks items 1-4; together-unit conjunction (item 5) is
  // layered on top, with member blocked-by evaluated over BOUNDARY-CROSSING
  // edges only (§4.3.7 — internal edges are advisory, never readiness inputs).
  const baseReasons = (k: string, togetherMembers: ReadonlySet<string> | null): string[] => {
    const n = byKey.get(k) as ModelNode;
    const reasons: string[] = [];
    // A WEAK NODE IS NEVER READY, whatever its own copy says — and the refusal
    // lives HERE, in the one function every readiness path runs through, rather
    // than at the entry to `readiness`. It was at that entry first, and the
    // together-member loop calls this function directly, so a full node whose
    // unit contained a weak member read ready while the unit it would claim
    // atomically (§4.3.7) contained a node the model refuses to select. A guard
    // at one of two doors is not a guard.
    if (n.declarerOnly === true) reasons.push('declared by a weak source; not selectable');
    // THE NODE'S OWN DECLARATION WAS UNDER-READ. Every derivation below reads
    // `n.data` as though it were the whole declaration, and for this node it is
    // not — a dropped `blocked-by` item leaves a SHORT blocker list that reports
    // ready the moment the survivors close, and a dropped `duplicate-of` leaves
    // a duplicate looking canonical. Neither is recoverable from `data`, which
    // is exactly why the fact is carried on the node. Refusing here is the same
    // fail-safe the model already applies to an unresolvable ref: what could not
    // be read must not read as absent.
    //
    // ITS TOGETHER UNIT NEEDS NO SEPARATE RULE, and adding one would be a second
    // mechanism saying the same thing. `readiness` runs every open member
    // through THIS function and refuses the unit on any member that is not
    // ready, so an under-read member already refuses the whole unit — the same
    // one-function argument the weak-source line above rests on.
    if (n.declarationRead === 'under-read') {
      reasons.push('own issuegraph declaration was not fully read (fail-safe: refusing the node)');
    }
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
      else {
        // A CLOSED BLOCKER WHOSE OWN DECLARATION WAS UNDER-READ IS NOT EVIDENCE
        // OF BEING UNBLOCKED, and this is the one place the axis has to travel
        // ALONG an edge rather than stopping at the node that carries it.
        //
        // `targetKey` resolves a `blocked-by` ref THROUGH the target's
        // `duplicate-of` (`duplicateCanonicalOf(rk) ?? rk`), so which node this
        // edge actually points at is read off the target's declaration. When
        // that declaration was under-read, its `duplicate-of` may be one of the
        // dropped fields — and `duplicateCanonicalOf` then answers `null`, which
        // is indistinguishable from "not a duplicate". The edge silently stops
        // at a CLOSED duplicate instead of continuing to a canonical that may
        // still be OPEN, and this node reports ready.
        //
        // MEASURED, one field apart: with #2 closed and its `duplicate-of: 3`
        // DROPPED, the dependent came back `{ready: true, reasons: []}`; with
        // the same field PARSED it came back `blocked-by 3 is open`. Under-
        // blocking is the costly direction by this module's own design rules,
        // so an unreadable redirect must block rather than resolve.
        //
        // ONLY THE CLOSED ARM NEEDS IT: an OPEN blocker already blocks above, so
        // adding the refusal there would be a second true-but-redundant reason
        // on a node that is refused either way.
        //
        // WHICH EDGE KINDS NEED THIS, AND HOW TO TELL — the property, so a
        // future edge kind is checked rather than remembered:
        //
        //   An edge kind needs an under-read guard EXACTLY WHEN it reads the
        //   TARGET'S `open` flag to DISCHARGE the edge. "Closed" is a tracker
        //   fact, but WHICH NODE the flag is read from is a declaration fact —
        //   `targetKey` resolves the ref through the target's `duplicate-of` —
        //   so an under-read target means the flag was read off the wrong node.
        //
        // Two kinds satisfy it and both are guarded: `blocked-by` here (closed
        // ⇒ unblocks) and `together-with` in the edge loop (closed ⇒ leaves the
        // unit). `serialize-with` does NOT — it unions whatever the state, so
        // closure discharges nothing there, and its under-read targets are swept
        // by the component scan below.
        //
        // MEASURED, not reasoned: with a closed under-read target whose real
        // canonical was open and CLAIMED, the serialize declarer came back
        // refused either way, while the together declarer came back READY until
        // its guard was added. An earlier revision of this comment asserted
        // together-with was covered by `readiness`'s per-member evaluation —
        // that was FALSE, because a closed target is never unioned, so there is
        // no member for `readiness` to evaluate. It is corrected here rather
        // than deleted, because the wrong version is the easier one to re-derive.
        if (bn.declarationRead === 'under-read') {
          reasons.push(
            `blocked-by ${b} is closed but its own declaration was under-read — a dropped duplicate-of would redirect this edge to a canonical that may still be open (fail-safe: blocking)`,
          );
        }
        if (bn.closedStateReason != null && bn.closedStateReason !== 'completed') {
          // Unblocked, but flag for re-groom (§5.3) — a diagnostic, not a block.
          // NOT an `else if` on the arm above: closure reason is a TRACKER fact
          // and the read extent is a DECLARATION fact, so a blocker can carry
          // both and a chain would silently drop the §5.3 surface for exactly
          // the nodes least well understood.
          diagnostics.push(`${k}: unblocked by non-completed closure of ${b}; re-check its premise`);
        }
      }
    }
    for (const u of unresolvedBlockers.get(k) ?? []) {
      reasons.push(`blocked-by ${u} is unresolvable (fail-safe: blocking)`);
    }
    for (const u of unresolvedRelations.get(k) ?? []) {
      reasons.push(`${u} is unresolvable (fail-safe: refusing the declarer)`);
    }
    for (const u of underReadTogether.get(k) ?? []) {
      reasons.push(
        `together-with ${u} is closed but its own declaration was under-read — a dropped duplicate-of would redirect this edge to a canonical that may still be an open member (fail-safe: refusing the declarer)`,
      );
    }
    // A SERIALIZE PEER'S DECLARATION WAS UNDER-READ, so the COMPONENT'S TRUE
    // EXTENT is unknown: the peer may have declared a `serialize-with` the
    // parser dropped, which would have pulled a member into this component that
    // nothing here can see. Admitting this node means admitting it beside a
    // sibling the edge may forbid running with — the same harm §6.7's
    // unresolvable-`blocked-by` rule refuses, arriving through the component
    // rather than through a ref.
    //
    // UNCONDITIONAL over the component, unlike the claimed-member scan below:
    // `componentMembers` returns `[k]` for a node in no component, and the
    // self-skip then leaves the loop with nothing to do — so no guard is needed
    // and adding one would be a second thing to keep in step.
    //
    // TOGETHER MEMBERS ARE NOT EXCLUDED HERE, though they are from the claim
    // scan below. That exclusion exists because a unit is claimed atomically and
    // would otherwise read its own partner's assignment as a conflict — a fact
    // about CLAIMING. An under-read peer is a fact about EXTENT, which atomic
    // claiming does not resolve, so the refusal stands whoever the peer is.
    const serializeMembers = componentMembers(serialize, k);
    for (const m of serializeMembers) {
      if (m === k) continue; // the node's own refusal is recorded above
      // NO ASSERTION: the optional chain reads the same fact without one, and it
      // is TOTAL rather than merely tidier. A member somehow absent from `byKey`
      // yields `undefined`, which is not `'under-read'`, so this scan moves on
      // instead of throwing — this module's first design rule ("never throws on
      // any input"). The surrounding scans still assert; they are not this
      // change's to rewrite.
      if (byKey.get(m)?.declarationRead === 'under-read') {
        reasons.push(
          `serialize group member ${m} had an under-read declaration — the component's true extent is unknown (fail-safe)`,
        );
        break;
      }
    }
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

  return {
    homeRepo,
    byKey,
    referenceable,
    diagnostics,
    duplicateCanonicalOf,
    blockersOf,
    serialize,
    together,
    componentMembers,
    readiness,
  };
}


/**
 * The `together-with` unit containing `key` (§4.3.7), as sorted node keys.
 *
 * A unit is one piece of work, claimed atomically. Closed members have left it,
 * so the unit is derived from OPEN endpoints only — which is why the answer
 * depends on the `open` flags the caller supplied rather than on the edges
 * alone. A key in no unit, and a key the node set does not carry, both come
 * back as `[key]`: a lone issue is a unit of one.
 */
export function resolveTogetherUnit(
  nodes: readonly NodeInput[],
  key: string,
  options?: RelationsOptions,
): readonly string[] {
  const relations = buildRelations(nodes, options);
  return relations.byKey.has(key) ? relations.componentMembers(relations.together, key) : [];
}

/**
 * The serialize component containing `key` (§4.3.4), as sorted node keys.
 *
 * It ALWAYS includes `key` itself, so a node with no `serialize-with` edge
 * reads `[key]` — a component of one — and a caller can size the group without
 * a special case. Unlike a together unit this unions whatever the endpoints'
 * states, because a `serialize-with` edge is not discharged by closure (§6.7);
 * an unresolvable target contributes no linkage. An unknown key comes back
 * empty, matching `Model.serializeComponent`.
 */
export function resolveSerializeGroup(
  nodes: readonly NodeInput[],
  key: string,
  options?: RelationsOptions,
): readonly string[] {
  const relations = buildRelations(nodes, options);
  return relations.byKey.has(key) ? relations.componentMembers(relations.serialize, key) : [];
}

/**
 * Is `key` ready (§6.2), and if not, which conditions failed.
 *
 * IDENTICAL to `buildModel(nodes, options).readiness(key)` — the same function,
 * reached without building the layers readiness does not consult. Readiness is
 * a GRAPH answer: a node's OWN assignment never makes it unready (§6.8 keeps
 * claim state in the eligibility layer a selector composes on top), while an
 * open serialize PEER carrying an assignee does.
 *
 * An unknown key is refused rather than admitted, like every other ambiguity
 * here: `{ ready: false, reasons: ['unknown node'] }`.
 */
export function evaluateReadiness(
  nodes: readonly NodeInput[],
  key: string,
  options?: RelationsOptions,
): ReadinessResult {
  return buildRelations(nodes, options).readiness(key);
}

