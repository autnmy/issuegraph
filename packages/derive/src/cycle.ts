/**
 * Pre-write cycle refusal for `blocked-by`.
 *
 * An editing surface lets a human add a `blocked-by` edge, and an edge that
 * closes a cycle produces a component no member of which can ever be ready
 * (SPEC §6.6). Refusing it BEFORE the write is what keeps the refusal free:
 * the check runs over the node set the surface already holds, so a refusal
 * costs ZERO round-trips — no fetch, no write, no rollback.
 *
 * This is the one graph walk the model does not already have. `Model` reports
 * the cycles a graph ALREADY contains (`model.cycles`, over the open
 * blocked-by graph); it cannot answer "would THIS edge create one", which is a
 * reachability question about an edge that does not exist yet.
 *
 * Semantics: adding `from blocked-by to` cycles exactly when `from === to`, or
 * when `to` already depends on `from` transitively through `blocked-by` —
 * because the new edge would close that path back on itself.
 *
 * Total on any input: unresolvable refs contribute no edge and therefore
 * cannot close a cycle, an already-cyclic input terminates on the seen-set,
 * and an unknown key simply has no outgoing edges.
 *
 * DUPLICATES ARE RESOLVED THE MODEL'S WAY, THROUGH THE MODEL'S OWN ANSWER.
 * §4.3.3 makes an edge naming a duplicate name its CANONICAL instead, and
 * `buildModel` applies that to every `blocked-by` target it reads. A walk over
 * RAW targets therefore misses a path the model can see: with `#30` duplicating
 * `#10`, the model reads "#20 blocked-by #30" as "#20 blocked-by #10", so
 * adding "#10 blocked-by #20" closes a cycle that a raw walk never finds. That
 * is a guard failing OPEN on a write nobody can undo. The canonical comes from
 * `Model.duplicateCanonical` rather than from a second duplicate-chain walk
 * here — restating the rule is how the two drift apart.
 *
 * THREE DELIBERATE DIVERGENCES FROM `model.cycles`, all fail-safe:
 *
 *  1. The walk spans CLOSED nodes. `model.cycles` filters to open nodes,
 *     because a closed blocker does not block today. This guard is asked a
 *     question about the future — the edge is about to be written and will
 *     outlive the current states — and a closed issue can reopen, at which
 *     point the cycle is real and unbreakable. Refusing is the recoverable
 *     direction: a human can decline the refusal, but nobody can unstick a
 *     component after the fact.
 *  2. A PROBED TARGET outside the supplied node set returns false, not a
 *     refusal. PRECONDITION: the probe's own endpoints must be present for the
 *     answer to mean anything. Failing closed instead would make a paged
 *     editing surface refuse every edge to an issue it has not loaded yet.
 *     Whether to return a three-valued verdict is an open question for the
 *     paging model.
 *
 *     THIS IS NOT A RULE ABOUT EXISTING EDGES, and reading it as one inverts
 *     it. An unresolvable `blocked-by` already in the data is recorded and
 *     TREATED AS BLOCKING by the model (`model.ts:485-486`, consumed by
 *     readiness at `:699`), so it stays in the adjacency and a proposed edge
 *     back to its declarer really does close a loop. Filtering unresolved
 *     targets out would drop that refusal — the fail-open this file exists to
 *     prevent — and it is pinned by a test in both directions.
 *  3. A TOGETHER UNIT IS ONE VERTEX, and its membership is built HERE rather
 *     than taken from `Model.togetherComponent`. §4.3.7
 *     makes a together group one schedulable unit, so a blocker on any member
 *     blocks every member — and without that contraction this guard admitted a
 *     permanent deadlock: with `#1 blocked-by #2` and `#2 together-with #3`,
 *     adding `#3 blocked-by #1` returned false while producing a component no
 *     member of which can ever start. Two halves are needed and neither works
 *     alone: `from` is matched against its WHOLE unit (reaching any member
 *     reaches the unit), and the walk traverses every unit sibling's blockers
 *     (a dependency can leave the unit through a member other than the one it
 *     entered by).
 *
 *     THE MEMBERSHIP SPANS CLOSED NODES, which is divergence 1 applied to the
 *     other axis and the reason the model's own answer cannot be reused. The
 *     model unions only OPEN endpoints — correctly, because "a closed member has
 *     left the unit" is true of readiness TODAY — so a unit with a closed member
 *     is invisible to it. This guard is asked about the future: with
 *     `#1 blocked-by #2` and a CLOSED `#2 together-with #3`, the model reports
 *     `#3` in a unit of one, the guard admitted `#3 blocked-by #1`, and
 *     reopening `#2` then contracts `{2,3}` into exactly the permanent cycle
 *     this file exists to refuse — with the edge already written and nobody able
 *     to unstick it. Measured both halves.
 *
 *     So `buildTogetherComponents` walks the raw declarations, the same shape
 *     `buildBlockedByAdjacency` already uses for the other edge kind and for the
 *     same reason. It still resolves targets through `canonicalOf`, so §4.3.3 is
 *     not restated here either.
 *
 *     INTERNAL EDGES ARE NOT EXEMPTED HERE, and that is a deliberate divergence
 *     from `model.cycles`, which drops them per §4.3.7. This guard already
 *     refused a circular internal pair before units were understood at all —
 *     the raw walk found it — so exempting them now would REMOVE a refusal,
 *     and every other choice in this file points the other way. §4.3.7 calls
 *     circular internal ordering a smell for grooming to surface; refusing it
 *     at the write is the recoverable direction, and a human can decline.
 *
 *  4. An edge declared BY a duplicate is KEPT. `buildModel` drops a duplicate's
 *     own edges entirely, and matching it here would be the one place copying
 *     the model makes this guard WEAKER: dropping an edge removes reachability,
 *     and a groomer who clears the `duplicate-of` brings it back with the cycle
 *     already written. Note the asymmetry with the resolution above — resolving
 *     a target ADDS reachability and is adopted; filtering a declarer REMOVES
 *     it and is not. Both choices point the same way.
 */

import type { Model, NodeInput } from '@issuegraph/reader';
import { buildModel, nodeKey, nodeSourceRepo, refKey } from '@issuegraph/reader';

export interface WouldCycleOptions {
  /** The home repository (`owner/repo`), as the model spells it. */
  readonly homeRepo?: string | undefined;
}

/**
 * `key -> the keys it is blocked by`, normalized through the model's OWN ref
 * spelling so a cross-repo edge written `owner/repo#N` and a home-repo edge
 * written `N` resolve to the same node.
 */
export type BlockedByAdjacency = ReadonlyMap<string, readonly string[]>;

/**
 * The model's transitive `duplicate-of` answer for a key — `Model.duplicateCanonical`.
 *
 * Taken as a PARAMETER rather than recomputed, and required rather than
 * defaulted. A default would be a second duplicate-chain walk beside the
 * model's, which is the mirror-whose-input-space-drifts shape this package
 * exists to avoid; and an OPTIONAL parameter would let a call site silently
 * omit it and quietly restore the raw walk, which is the defect itself. A
 * required positional argument is a compile error at every call site instead.
 */
export type CanonicalOf = (key: string) => string | null;

/**
 * The model's `together-with` component for a key — `Model.togetherComponent`.
 *
 * Taken as a PARAMETER for the same reason `CanonicalOf` is, and required for
 * the same reason: a default would be a second component walk beside the
 * model's, and an OPTIONAL one would let a call site omit it and silently
 * restore the un-contracted walk — which is the defect itself. A required
 * positional argument is a compile error at every call site instead.
 *
 * `Model.togetherComponent` answers `[]` for a key it does not hold; callers
 * here read that as "a unit of one", which is what an unknown key is.
 */
export type TogetherOf = (key: string) => readonly string[];

export function buildBlockedByAdjacency(
  issues: readonly NodeInput[],
  canonicalOf: CanonicalOf,
  options: WouldCycleOptions = {},
): BlockedByAdjacency {
  const homeRepo = options.homeRepo;
  const adjacency = new Map<string, string[]>();
  for (const node of issues) {
    const key = nodeKey(node, homeRepo);
    if (adjacency.has(key)) continue; // first occurrence wins, like the model
    const sourceRepo = nodeSourceRepo(node, homeRepo);
    adjacency.set(
      key,
      (node.data?.blockedBy ?? []).map((ref) => {
        const target = refKey(ref, sourceRepo, homeRepo);
        // A key the model does not hold answers `null` and falls through
        // unchanged, which is the same outcome the model's own
        // `referenceable` gate produces for it — so no second gate is written
        // here to say it twice.
        return canonicalOf(target) ?? target;
      }),
    );
  }
  return adjacency;
}

/**
 * `key -> every key in its together unit`, over the RAW declarations and
 * spanning closed nodes — see divergence 3.
 *
 * A key with no `together-with` anywhere answers a unit of one, which is what
 * an unlinked issue is.
 */
export function buildTogetherComponents(
  issues: readonly NodeInput[],
  canonicalOf: CanonicalOf,
  options: WouldCycleOptions = {},
): TogetherOf {
  const homeRepo = options.homeRepo;
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    for (;;) {
      const next = parent.get(root);
      if (next === undefined || next === root) return root;
      root = next;
    }
  };
  const add = (key: string): void => {
    if (!parent.has(key)) parent.set(key, key);
  };
  const seen = new Set<string>();
  for (const node of issues) {
    const key = nodeKey(node, homeRepo);
    if (seen.has(key)) continue; // first occurrence wins, like the model
    seen.add(key);
    add(key);
    const target = node.data?.togetherWith;
    if (target === null || target === undefined) continue;
    const raw = refKey(target, nodeSourceRepo(node, homeRepo), homeRepo);
    // §4.3.3 through the model's own answer, exactly as the blocked-by
    // adjacency does it — an edge naming a duplicate names its canonical.
    const resolved = canonicalOf(raw) ?? raw;
    add(resolved);
    const [a, b] = [find(key), find(resolved)];
    if (a !== b) parent.set(a, b);
  }
  const members = new Map<string, string[]>();
  for (const key of parent.keys()) {
    const root = find(key);
    const existing = members.get(root);
    if (existing === undefined) members.set(root, [key]);
    else existing.push(key);
  }
  for (const group of members.values()) group.sort();
  return (key) => members.get(find(key)) ?? [key];
}

/**
 * Would adding `from blocked-by to` create a `blocked-by` cycle?
 *
 * Synchronous by signature — it takes no client, handle, or promise — which is
 * what makes "zero round-trips" a property of the contract rather than of an
 * optimization.
 */
export function wouldCycleOnBlockedBy(
  issues: readonly NodeInput[],
  from: string,
  to: string,
  options: WouldCycleOptions = {},
): boolean {
  // Builds a model for the duplicate answer alone. That is real work, and it is
  // the honest price of not restating §4.3.3: the alternative is a second
  // duplicate-chain walk. It costs no ROUND-TRIP, which is what this guard
  // promises — a caller already deriving an order pays nothing extra, because
  // `deriveIssueOrder` hands its own model's resolver to the adjacency builder.
  const model: Model = buildModel(
    issues,
    options.homeRepo === undefined ? {} : { homeRepo: options.homeRepo },
  );
  return wouldCycleOnAdjacency(
    buildBlockedByAdjacency(issues, model.duplicateCanonical, options),
    model.duplicateCanonical,
    buildTogetherComponents(issues, model.duplicateCanonical, options),
    from,
    to,
    options,
  );
}

/**
 * A caller-supplied key in the adjacency's own spelling.
 *
 * Lowercasing the repo half is NOT enough. Adjacency keys come from `nodeKey`,
 * which also FOLDS a home-repo-qualified node to its bare number — SPEC §4.2
 * lets a surface spell the same issue either way. A key arriving as
 * `owner/repo#N` when `owner/repo` IS the home repo therefore names a node the
 * adjacency stores as `N`, the walk starts nowhere, and the guard returns
 * false: it FAILS OPEN and the cycle-creating edge is written.
 *
 * Routed through `refKey` rather than folded here, because a second statement
 * of the folding rule is what produced this bug in the first place.
 */
function canonicalKey(key: string, homeRepo?: string): string {
  // A key is `<id>` or `<owner/repo>#<id>`, and an id is an OPAQUE tracker
  // token (§4.2) — so the split is on the LAST `#`, not on a digit run. Keying
  // on digits used to be equivalent and is not any more: `ABC-123` and
  // `owner/repo#ABC-123` are ordinary keys, and a digits-only test would send
  // both down the "not a key shape" arm, where the walk silently misses and
  // the guard FAILS OPEN — the exact failure this function's own doc describes.
  const hash = key.lastIndexOf('#');
  if (hash === -1) return refKey({ repo: null, id: key }, null, homeRepo);
  const repo = key.slice(0, hash);
  const id = key.slice(hash + 1);
  if (repo.length === 0 || id.length === 0) return key; // not a key shape; the walk simply misses
  return refKey({ repo, id }, null, homeRepo);
}

/**
 * Every spelling of a caller-supplied endpoint the adjacency could hold it
 * under: the folded key, plus its canonical when it duplicates something.
 *
 * BOTH, never just the canonical, and this is the half that is easy to get
 * wrong. Canonicalizing the stored targets while leaving the two ARGUMENTS
 * folded-only puts them in different key spaces, and the probe then fails open
 * on its own inputs — `#20 blocked-by #30`, where `#30` duplicates `#20`, is
 * a self-dependency the model will read and a raw walk never finds.
 *
 * But replacing the raw spelling would REMOVE refusals rather than add them.
 * Divergence 3 keeps a duplicate's own outgoing edges, so a duplicate key
 * still has edges under its raw name; seeding only at the canonical would
 * start the walk somewhere those edges are not, and admit a cycle the older,
 * unresolved code already refused. Keeping both is monotone — it can only ever
 * refuse more — which is the direction every choice in this file points.
 */
function endpointSpellings(
  raw: string,
  canonicalOf: CanonicalOf,
  homeRepo?: string,
): readonly string[] {
  const key = canonicalKey(raw, homeRepo);
  const canonical = canonicalOf(key);
  return canonical === null || canonical === key ? [key] : [key, canonical];
}

/**
 * The same predicate against a prepared adjacency, so a caller deriving the
 * whole order builds the map once instead of per probe. No memoization of
 * RESULTS — the map is a view of the input, not a cache of answers.
 *
 * `canonicalOf` must be the SAME resolver the adjacency was built with, and
 * `options` the same `homeRepo`; otherwise the endpoints land in a different
 * key space from the keys they have to match, which is the fail-open this
 * argument exists to close.
 */
export function wouldCycleOnAdjacency(
  adjacency: BlockedByAdjacency,
  canonicalOf: CanonicalOf,
  togetherOf: TogetherOf,
  rawFrom: string,
  rawTo: string,
  options: WouldCycleOptions = {},
): boolean {
  // A unit of one for a key the model does not hold — `togetherComponent`
  // answers `[]` there, and an empty membership would make the node traverse
  // nothing at all, silently dropping its own edges from the walk.
  const unit = (key: string): readonly string[] => {
    const members = togetherOf(key);
    return members.length === 0 ? [key] : members;
  };
  // `from` IS ITS WHOLE UNIT. §4.3.7 makes the group one schedulable unit, so
  // a path that reaches any member has reached `from` for scheduling purposes
  // — and it is precisely this half that was missing: with `#1 blocked-by #2`
  // and `#2 together-with #3`, the walk for `#3 blocked-by #1` reaches `#2`
  // and stops, because `#2` is not `#3` by name.
  const from = new Set(
    endpointSpellings(rawFrom, canonicalOf, options.homeRepo).flatMap((spelling) => [
      spelling,
      ...unit(spelling),
    ]),
  );
  // Walk what `to` already depends on, from every spelling of it. Reaching any
  // spelling of `from` means the proposed edge would close the loop. Iterative,
  // so a deep chain cannot exhaust the stack.
  //
  // The self-edge case needs no separate guard: the walk starts AT `to`, so
  // `from === to` is caught on the first pop. An explicit short-circuit here
  // was unkillable by mutation — no test could distinguish it — which is the
  // signature of a redundant branch rather than a defended one.
  const seen = new Set<string>();
  const stack: string[] = [...endpointSpellings(rawTo, canonicalOf, options.homeRepo)];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (from.has(current)) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    // EVERY UNIT SIBLING'S BLOCKERS, not just this node's. The other half of
    // the contraction: a dependency can leave the unit through a member other
    // than the one the walk entered by, and following only `current` would
    // stop at the doorway.
    for (const member of unit(current)) {
      for (const next of adjacency.get(member) ?? []) stack.push(next);
    }
  }
  return false;
}
