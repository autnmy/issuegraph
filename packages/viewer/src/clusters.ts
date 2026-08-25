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
 * direction — while the depth and cycle questions are asked of `blocked-by`
 * alone, because that is the only field that orders anything.
 */

import type { NormalizedDocument } from './document.ts';

export interface Cluster {
  /** Members in the document's own key order, so the output is deterministic. */
  readonly members: readonly string[];
  readonly blockedByEdges: number;
  readonly hasCycle: boolean;
  /** The longest `blocked-by` chain, in edges. `0` when nothing blocks. */
  readonly chainDepth: number;
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
 * The longest `blocked-by` chain inside one component, and whether that
 * component contains a cycle.
 *
 * A cycle makes "longest chain" undefined, so the walk reports the depth it
 * reached over the acyclic part and says a cycle exists rather than looping or
 * inventing a number. Both facts are useful to a reader; a hang is not.
 */
function depthAndCycle(
  members: readonly string[],
  blockedBy: ReadonlyMap<string, readonly string[]>,
): { depth: number; hasCycle: boolean } {
  const memo = new Map<string, number>();
  const onPath = new Set<string>();
  let hasCycle = false;
  // The edges the discovery pass refused to follow, keyed `from\u0000to` so a
  // cycle through one member does not suppress that member's other edges.
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
            hasCycle = true;
            // REMEMBER WHICH EDGE CLOSED THE CYCLE, not just that one did. The
            // collecting pass below walks the same adjacency and has no other
            // way to tell a back-edge from an ordinary one, so it counted this
            // edge against a memo that was never written — `?? 0` — and every
            // cycle came out one edge too long. Measured: a two-node cycle
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
  return { depth, hasCycle };
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
    const { depth, hasCycle } = depthAndCycle(members, blockedBy);
    return { members, blockedByEdges, hasCycle, chainDepth: depth };
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
