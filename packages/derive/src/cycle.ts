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
 * TWO DELIBERATE DIVERGENCES FROM `model.cycles`, both fail-safe:
 *
 *  1. The walk spans CLOSED nodes. `model.cycles` filters to open nodes,
 *     because a closed blocker does not block today. This guard is asked a
 *     question about the future — the edge is about to be written and will
 *     outlive the current states — and a closed issue can reopen, at which
 *     point the cycle is real and unbreakable. Refusing is the recoverable
 *     direction: a human can decline the refusal, but nobody can unstick a
 *     component after the fact.
 *  2. A target OUTSIDE the supplied node set returns false, not a refusal.
 *     PRECONDITION: both endpoints must be present for the answer to mean
 *     anything. Failing closed instead would make a paged editing surface
 *     refuse every edge to an issue it has not loaded yet. Whether to return
 *     a three-valued verdict is an open question for the paging model.
 */

import type { NodeInput } from '@issuegraph/reader';
import { nodeKey, nodeSourceRepo, refKey } from '@issuegraph/reader';

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

export function buildBlockedByAdjacency(
  issues: readonly NodeInput[],
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
      (node.data?.blockedBy ?? []).map((ref) => refKey(ref, sourceRepo, homeRepo)),
    );
  }
  return adjacency;
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
  return wouldCycleOnAdjacency(buildBlockedByAdjacency(issues, options), from, to, options);
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
  const bare = /^([0-9]+)$/.exec(key);
  if (bare !== null) return refKey({ repo: null, number: Number(bare[1]) }, null, homeRepo);
  const qualified = /^(.+)#([0-9]+)$/.exec(key);
  if (qualified === null) return key; // not a key shape; the walk simply misses
  const repo = qualified[1] as string;
  const number = Number(qualified[2]);
  if (!Number.isSafeInteger(number)) return key;
  return refKey({ repo, number }, null, homeRepo);
}

/**
 * The same predicate against a prepared adjacency, so a caller deriving the
 * whole order builds the map once instead of per probe. No memoization of
 * RESULTS — the map is a view of the input, not a cache of answers.
 *
 * `options` must carry the SAME `homeRepo` the adjacency was built with;
 * otherwise the endpoints fold differently from the keys they have to match.
 */
export function wouldCycleOnAdjacency(
  adjacency: BlockedByAdjacency,
  rawFrom: string,
  rawTo: string,
  options: WouldCycleOptions = {},
): boolean {
  const from = canonicalKey(rawFrom, options.homeRepo);
  const to = canonicalKey(rawTo, options.homeRepo);
  // Walk what `to` already depends on. Reaching `from` means the proposed edge
  // would close the loop. Iterative, so a deep chain cannot exhaust the stack.
  //
  // The self-edge case needs no separate guard: the walk starts AT `to`, so
  // `from === to` is caught on the first pop. An explicit short-circuit here
  // was unkillable by mutation — no test could distinguish it — which is the
  // signature of a redundant branch rather than a defended one.
  const seen = new Set<string>();
  const stack: string[] = [to];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}
