/**
 * Connected components, for the graph's refusal mode.
 *
 * Above the node budget the canvas declines to draw a hairball and shows the
 * shape instead: how many components there are, how big each is, how many
 * `blocked-by` edges it carries, whether it contains a cycle, and how deep its
 * longest blocking chain runs. A refusal with a route forward reads as
 * competence; a hairball reads as a bug.
 *
 * Components are undirected — every relationship connects, whatever its
 * direction — while the depth question is asked of `blocked-by` alone, because
 * that is the only field that orders anything.
 *
 * THE CYCLE QUESTION IS NOT ASKED HERE AT ALL. It is answered by the host —
 * `ViewerDocument.cycles`, the reader's own §6.6 stuck groups — and this module
 * only reads which components those cycles touch. It used to walk the edges for
 * the answer itself, and that walk disagreed with the host's on a cycle running
 * through a together unit: the reader contracts a unit to one vertex and this
 * document does not even carry every together edge, so the two were bound to
 * differ, and both were on one screen. One answer, given, is the rule this
 * package already applies to the order; the cycle badge follows it.
 */

import type { NormalizedDocument } from './document.ts';

export interface Cluster {
  /** Members in the document's own key order, so the output is deterministic. */
  readonly members: readonly string[];
  readonly blockedByEdges: number;
  /**
   * Whether the host's `cycles` name any member of this component. The host's
   * answer, relayed — never derived from the edges here.
   */
  readonly hasCycle: boolean;
  /**
   * How many members the host names in a cycle — never the whole component.
   *
   * A COMPONENT IS UNDIRECTED AND A CYCLE IS NOT. `connectedComponents` joins
   * members across EVERY relationship, so a component holding a two-issue cycle
   * can also hold fifty issues that merely touch it, and SPEC §6.6 is narrow
   * about the consequence: "Issues in a cycle are not ready" — the issues, not
   * the component. `hasCycle` alone cannot tell "three of three are stuck" from
   * "two of fifty-two are", and a surface reading it as the former says
   * something false about the other fifty.
   */
  readonly stuckMembers: number;
  /** The longest `blocked-by` chain, in edges. `0` when nothing blocks. */
  readonly chainDepth: number;
}

/**
 * What a component says about how the work inside it runs — the ONE fact a
 * capsule prints under its name, resolved here so every surface prints the
 * same one.
 *
 * IT IS A UNION BECAUSE THE THREE CASES ARE NOT VARIANTS OF ONE SENTENCE, and
 * a capsule that could hold two of them printed something untrue. `chainDepth`
 * is the longest ACYCLIC chain (`chainDepthOf` says so, and a prior round fixed
 * it to be exactly that), so on a component the host reports as stuck the
 * number is right about its own question and wrong about the reader's: a small
 * finite depth beside a `cycle` badge reads as a work estimate — *four issues,
 * two deep, get going* — when none of the members can ever be ready at all.
 * §17d calls a cycle "the only finding that stops work outright", and frame
 * `17f` draws the consequence where every other capsule draws its depth.
 *
 * So the depth is not suppressed at the point of drawing, which would leave two
 * renderers each remembering to. There is no value to suppress: a stuck
 * component has no `depth` field to print.
 */
export type ClusterReach =
  /**
   * The host reports a cycle through this component.
   *
   * BOTH NUMBERS, because "how much of this is a loop" is the question and the
   * two answers read completely differently: `held === of` is a component that
   * is entirely a loop and can never produce anything, while `held < of` is a
   * loop sitting inside a larger component. Saying the first about the second is
   * the overreach SPEC §6.6 rules out.
   *
   * NEITHER NUMBER IS A READINESS COUNT, and `held` in particular is not "how
   * many cannot start". An issue blocked by a cycle member never becomes ready
   * either, so the stuck set is the cycle plus everything transitively behind
   * it — and deriving that here would be deriving readiness inside a package
   * that takes the host's answer for it. `clusterReachLabel` words the
   * `held < of` arm accordingly: what the component contains, not what can run.
   */
  | { readonly kind: 'stuck'; readonly held: number; readonly of: number }
  /** The longest `blocked-by` chain, in edges. At least one. */
  | { readonly kind: 'chain'; readonly depth: number }
  /**
   * It carries `blocked-by` edges, and none of them orders anything: every one
   * closes a loop the host did not report, so the chain walk steps over all of
   * them and finds no chain at all.
   *
   * UNREACHABLE THROUGH `normalizeDocument`, WHICH DROPS A SELF-EDGE, and
   * encoded anyway. A loop of two or more always leaves at least one edge the
   * walk can follow, so the only way every edge is a back-edge is a self-loop —
   * and `clustersOf` is a public export taking a plain `NormalizedDocument` a
   * consumer can build by hand. The case is here because the alternative was
   * `unblocked` covering it, which is a claim about a component with a blocking
   * count printed beside it.
   */
  | { readonly kind: 'looped'; readonly edges: number }
  /** No `blocked-by` edge at all, so nothing in the component waits on anything. */
  | { readonly kind: 'unblocked' };

/**
 * The reach of one component.
 *
 * Derived rather than stored, so `Cluster` keeps carrying both raw facts for a
 * caller asking a different question, and the two cannot disagree.
 */
export function clusterReach(cluster: Cluster): ClusterReach {
  if (cluster.stuckMembers > 0) {
    return { kind: 'stuck', held: cluster.stuckMembers, of: cluster.members.length };
  }
  // ASKED OF THE EDGES, NOT OF THE WALK'S ANSWER. `chainDepth === 0` and "has
  // no blocking edge" agree on every document `normalizeDocument` can produce,
  // and they are not the same claim: the depth is what the walk COULD FOLLOW,
  // and it skips a back-edge. Reading `unblocked` off it would render "no
  // blocking chain" beside a non-zero blocking count on the same card — the
  // exact shape of contradiction `ClusterReach` exists to make unrepresentable,
  // rebuilt one predicate down.
  if (cluster.blockedByEdges === 0) return { kind: 'unblocked' };
  if (cluster.chainDepth === 0) return { kind: 'looped', edges: cluster.blockedByEdges };
  return { kind: 'chain', depth: cluster.chainDepth };
}

/**
 * The reach as the capsule prints it — frame `17f`'s own words.
 *
 * THE WORDING LIVES BESIDE THE FACT, for the reason `why-rank` already
 * establishes on this surface: two renderers drawing one fact must not each
 * hold their own sentence for it, or the §16 capsule and the §17f capsule
 * describe the same component differently on one screen.
 *
 * Total over the union, so a fourth case cannot be added without a compiler
 * error here.
 */
export function clusterReachLabel(reach: ClusterReach): string {
  switch (reach.kind) {
    // ONE ARM MAKES A READINESS CLAIM, AND ONLY BECAUSE IT CANNOT BE WRONG.
    //
    // `held === of` is a component that is entirely a loop: SPEC §6.6 says
    // issues in a cycle are not ready, so "nothing can start" follows for every
    // member with nothing to derive. That is the frame's own capsule — three
    // issues, all of them the loop — and its words are kept.
    //
    // `held < of` says what the component CONTAINS and stops there. The obvious
    // reading, "the other members are fine", is false: an issue blocked by a
    // cycle member never becomes ready either, so the truly-stuck set is the
    // cycle plus everything transitively behind it. Computing that here would
    // mean deriving READINESS inside the viewer — the one thing this package
    // refuses, because the host's model already answers it and two answers to
    // one question on one screen is the defect the cycle badge itself was
    // rewritten to remove. The rail beside this canvas is the surface that
    // holds that answer, and it is complete at any size.
    //
    // NEITHER ARM PRINTS A DEPTH. A partly-stuck component has a real chain
    // among its reachable members, but this slot answers "what is in here that
    // changes how it runs", and a loop outranks how deep the rest goes.
    case 'stuck':
      return reach.held === reach.of
        ? 'nothing can start'
        : `${String(reach.held)} of ${String(reach.of)} in a cycle`;
    case 'chain':
      return `deepest chain ${String(reach.depth)}`;
    // NAMES THE EDGES, so the sentence cannot contradict the count drawn beside
    // it: something blocks, and none of it puts the work in an order.
    case 'looped':
      return `${String(reach.edges)} blocking ${reach.edges === 1 ? 'edge' : 'edges'}, none ordering`;
    case 'unblocked':
      return 'no blocking chain';
  }
}

function connectedComponents(
  document: NormalizedDocument,
  drawn: ReadonlySet<string> | undefined,
): string[][] {
  const adjacency = new Map<string, string[]>();
  const touch = (key: string): string[] => {
    const existing = adjacency.get(key);
    if (existing !== undefined) return existing;
    const created: string[] = [];
    adjacency.set(key, created);
    return created;
  };
  for (const edge of document.edges) {
    touch(edge.from).push(edge.to);
    touch(edge.to).push(edge.from);
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  // Walk in the document's issue order so the component list is stable.
  for (const issue of document.issues) {
    if (seen.has(issue.key)) continue;
    // AN EDGE-FREE NODE IS A COMPONENT OF ONE, and dropping it broke the only
    // promise the refusal makes. The refusal fires on how many nodes the canvas
    // would DRAW, but the component list was built from nodes that have an
    // EDGE — so an over-budget document with no relationships in it refused to
    // draw and then listed nothing, under a sentence pointing at the list.
    // A partition of the drawn set cannot disagree with the count that
    // triggered it, whatever the document contains.
    if (!adjacency.has(issue.key)) {
      if (drawn !== undefined && drawn.has(issue.key)) components.push([issue.key]);
      continue;
    }
    // AN EDGE ENDPOINT THE CANVAS DOES NOT DRAW IS STILL NOT DRAWN. `drawn`
    // bounds both arms or it bounds neither, and bounding only the singletons
    // would trade an under-count for an over-count.
    if (drawn !== undefined && !drawn.has(issue.key)) continue;
    const members: string[] = [];
    const stack = [issue.key];
    seen.add(issue.key);
    while (stack.length > 0) {
      const key = stack.pop() as string;
      members.push(key);
      for (const next of adjacency.get(key) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    members.sort();
    components.push(members);
  }
  return components;
}

/**
 * The longest `blocked-by` chain inside one component, in edges.
 *
 * A cycle makes "longest chain" undefined, so the walk reports the depth it
 * reached over the acyclic part rather than looping or inventing a number.
 *
 * IT MEETS BACK-EDGES AND PUBLISHES NOTHING ABOUT THEM. Skipping the edge that
 * closes a loop is what makes this walk TERMINATE and its number finite; it is
 * not a cycle answer, and it must not be read as one — whether a component
 * contains a cycle is the host's `cycles`, read in `clustersOf` below. A raw
 * loop this walk steps over (through a closed issue, say) can be one the
 * reader does not report, and a stuck unit the reader does report can be one
 * this walk cannot see. Two answers to one question is the defect this module
 * was rewritten to remove.
 */
function chainDepthOf(
  members: readonly string[],
  blockedBy: ReadonlyMap<string, readonly string[]>,
): number {
  const memo = new Map<string, number>();
  const onPath = new Set<string>();
  // The edges the discovery pass refused to follow, keyed `from\u0000to` so a
  // loop through one member does not suppress that member's other edges.
  const backEdges = new Set<string>();

  // ITERATIVE, NOT RECURSIVE. This runs on the graph's REFUSAL path, which is
  // reached precisely because the component is large — so a per-node call frame
  // is a stack overflow waiting for the input the code exists to handle. A long
  // `blocked-by` chain is the ordinary shape of a big backlog, not a pathology.
  for (const start of members) {
    if (memo.has(start)) continue;
    const stack: { key: string; expanded: boolean }[] = [{ key: start, expanded: false }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { key: string; expanded: boolean };
      if (memo.has(frame.key)) {
        stack.pop();
        continue;
      }
      if (!frame.expanded) {
        frame.expanded = true;
        onPath.add(frame.key);
        for (const next of blockedBy.get(frame.key) ?? []) {
          if (onPath.has(next)) {
            // REMEMBER WHICH EDGE CLOSED THE LOOP. The collecting pass below
            // walks the same adjacency and has no other way to tell a back-edge
            // from an ordinary one, so it counted this edge against a memo that
            // was never written — `?? 0` — and every loop came out one edge too
            // long. Measured: a two-node cycle
            // published `chainDepth: 2` beside its cycle badge when the longest
            // acyclic chain through it is one edge, and a three-node cycle
            // published 3 for a chain of two.
            backEdges.add(`${frame.key}\u0000${next}`);
            continue;
          }
          if (!memo.has(next)) stack.push({ key: next, expanded: false });
        }
        continue;
      }
      let best = 0;
      for (const next of blockedBy.get(frame.key) ?? []) {
        // SKIPPED, WHICH ALSO MAKES THE FALLBACK BELOW UNREACHABLE. Every other
        // child was either pushed and memoized or was memoized already, so
        // `?? 0` now covers nothing — it stays only because a missing memo must
        // never silently become a depth of zero if this walk ever changes.
        if (backEdges.has(`${frame.key}\u0000${next}`)) continue;
        best = Math.max(best, 1 + (memo.get(next) ?? 0));
      }
      memo.set(frame.key, best);
      onPath.delete(frame.key);
      stack.pop();
    }
  }

  let depth = 0;
  for (const member of members) depth = Math.max(depth, memo.get(member) ?? 0);
  return depth;
}

/** Every component the document declares, largest first, then by first member. */
export function clustersOf(
  document: NormalizedDocument,
  /**
   * The keys the canvas would actually draw — `layout.nodes`' key set.
   *
   * Passing it makes the returned components a PARTITION of exactly the nodes
   * the refusal counted, which is the property the refusal's own text depends
   * on. Omitting it keeps the older edge-derived reading for callers that are
   * describing a document rather than explaining a refusal.
   */
  drawn?: ReadonlySet<string>,
): readonly Cluster[] {
  const blockedBy = new Map<string, string[]>();
  for (const edge of document.edges) {
    if (edge.field !== 'blocked-by') continue;
    const existing = blockedBy.get(edge.from);
    if (existing === undefined) blockedBy.set(edge.from, [edge.to]);
    else existing.push(edge.to);
  }

  // Every issue the host reports as inside a `blocked-by` cycle. Read off the
  // document, which already narrowed the host's cycles to the keys it carries.
  const stuck = new Set<string>();
  for (const cycle of document.cycles) for (const member of cycle) stuck.add(member);

  const clusters = connectedComponents(document, drawn).map((members) => {
    // SUMMED OFF THE ADJACENCY ABOVE, NOT RE-FILTERED PER COMPONENT. This used to
    // scan the WHOLE edge array once per component, which is quadratic in exactly
    // the shape that reaches it: refusal mode exists for documents too big to
    // draw, and a fragmented one is the worst case — 10,000 disconnected pairs
    // means 10,000 components each scanning 10,000 edges, ~100 million checks to
    // produce a SUMMARY. The refusal would then freeze the browser it was added
    // to protect.
    // The value is identical, not an approximation: `blockedBy` maps each origin
    // to its `blocked-by` targets, members are distinct, and the filter counted
    // exactly the edges whose origin is a member — so summing each member's list
    // length counts the same edges once each. Linear in members, so the whole
    // pass is linear in nodes plus edges.
    let blockedByEdges = 0;
    for (const member of members) blockedByEdges += blockedBy.get(member)?.length ?? 0;
    // THE HOST'S ANSWER, LOOKED UP — never re-derived. A cycle the reader
    // found touches this component when any member of it is a member here; the
    // set is built once above, so the whole pass stays linear.
    // COUNTED, NOT JUST TESTED. `some` answers whether the component touches a
    // cycle; how MUCH of it the cycle holds is a different question, and the
    // one a reader acts on. Same single pass over the members either way.
    let stuckMembers = 0;
    for (const member of members) if (stuck.has(member)) stuckMembers += 1;
    return {
      members,
      blockedByEdges,
      hasCycle: stuckMembers > 0,
      stuckMembers,
      chainDepth: chainDepthOf(members, blockedBy),
    };
  });

  // CODE UNITS, NOT `localeCompare`. This package promises deterministic
  // rendering, and `localeCompare` without an explicit locale uses the RUNTIME's
  // default — so a server and a reader's browser can order two equal-sized
  // components differently and produce markup that does not match, which is a
  // hydration mismatch rather than a cosmetic one. The comparison is the same
  // one `document.ts` already uses to canonicalize a symmetric edge's endpoint
  // pair, so the package has one ordering rule rather than two.
  return clusters.sort((a, b) => {
    if (a.members.length !== b.members.length) return b.members.length - a.members.length;
    const left = a.members[0] ?? '';
    const right = b.members[0] ?? '';
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
