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

function connectedComponents(document: NormalizedDocument): string[][] {
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
    if (seen.has(issue.key) || !adjacency.has(issue.key)) continue;
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
            continue;
          }
          if (!memo.has(next)) stack.push({ key: next, expanded: false });
        }
        continue;
      }
      let best = 0;
      for (const next of blockedBy.get(frame.key) ?? []) {
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
export function clustersOf(document: NormalizedDocument): readonly Cluster[] {
  const blockedBy = new Map<string, string[]>();
  for (const edge of document.edges) {
    if (edge.field !== 'blocked-by') continue;
    const existing = blockedBy.get(edge.from);
    if (existing === undefined) blockedBy.set(edge.from, [edge.to]);
    else existing.push(edge.to);
  }

  const clusters = connectedComponents(document).map((members) => {
    const membership = new Set(members);
    const blockedByEdges = document.edges.filter(
      (edge) => edge.field === 'blocked-by' && membership.has(edge.from),
    ).length;
    const { depth, hasCycle } = depthAndCycle(members, blockedBy);
    return { members, blockedByEdges, hasCycle, chainDepth: depth };
  });

  return clusters.sort((a, b) => {
    if (a.members.length !== b.members.length) return b.members.length - a.members.length;
    return (a.members[0] ?? '').localeCompare(b.members[0] ?? '');
  });
}
