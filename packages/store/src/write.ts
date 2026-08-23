/**
 * The write ledger and the projection built from it — the functional core of
 * the write loop. The store (the imperative shell) holds these values, performs
 * the IO, and notifies; every decision about what a record becomes is made
 * here, where it can be tested without a clock or an adapter.
 *
 * The rule that shapes the whole file: **a failed write is marked, never
 * reverted.** The user's work stays on the canvas carrying a state, and the
 * only call that removes it is one the user makes.
 */

import type { EdgeId, GraphDocument, StoredEdge } from './model.ts';
import type { EdgeState, InvalidReason, Mutation, MutationId } from './mutation.ts';
import { EDGE_STATES } from './mutation.ts';
import { edgeChangeFor } from './validity.ts';

/**
 * An edit the store is still carrying.
 *
 * A record that lands is REMOVED, not marked `applied`: the landed document is
 * then the evidence, and a settled-successful record would be a second copy of
 * a fact that can go stale against it.
 */
export type WriteRecord =
  | { readonly mutationId: MutationId; readonly mutation: Mutation; readonly state: 'pending' }
  | {
      readonly mutationId: MutationId;
      readonly mutation: Mutation;
      readonly state: 'invalid';
      readonly reason: InvalidReason;
    }
  | {
      readonly mutationId: MutationId;
      readonly mutation: Mutation;
      readonly state: 'failed';
      readonly reason: string;
    }
  | {
      readonly mutationId: MutationId;
      readonly mutation: Mutation;
      readonly state: 'conflict';
      /** The authoritative document as it stood when the conflict was reported. Held, never merged. */
      /**
       * The document as the adapter reported it at the moment of the conflict.
       *
       * FOR DISPLAY — the "view diff" half of the choice the design offers, and
       * never adopted. Adopting it would mean answering "is this snapshot still
       * current?", which the store cannot do: the adapter is the authority on
       * the current document, so a host that wants it calls `rehydrate`.
       */
      readonly upstream: GraphDocument;
    };

/** The state a record contributes to the edges it marks. */
export function edgeStateOf(record: WriteRecord): EdgeState {
  switch (record.state) {
    case 'pending':
      return 'pending-write';
    case 'invalid':
      return 'invalid';
    case 'failed':
      return 'failed';
    case 'conflict':
      return 'conflict';
  }
}

/** A landed or optimistic edge, with whatever states currently apply to it. */
export interface ProjectedEdge extends StoredEdge {
  /**
   * Every state this edge carries, in the canonical order of `EDGE_STATES`.
   *
   * A list rather than one value because the states are orthogonal: an edge can
   * be `selected` while it is `pending-write`, and a viewer draws the selection
   * halo on top of the marching dash rather than choosing between them.
   */
  readonly states: readonly EdgeState[];
  /**
   * The unsettled edits marking this edge. A host reads the reason, and calls
   * `retry` / `discardMine`, through these identifiers.
   */
  readonly writes: readonly MutationId[];
}

/** Whether any edit is still in flight, which is what holds the order still. */
export function anyPending(records: readonly WriteRecord[]): boolean {
  return records.some((record) => record.state === 'pending');
}

/**
 * The edges a viewer should draw: the landed document plus every unsettled
 * edit's overlay, each carrying its state.
 *
 * Overlays apply in proposal order, so two edits touching one edge compose in
 * the order the user made them.
 *
 * This is the ONLY place optimistic edges exist. The selection order is derived
 * from the landed edges alone, which is what makes "optimistic rendering yes,
 * optimistic re-ordering no" a property of the structure rather than a rule
 * someone has to remember.
 */
export function project(
  landed: GraphDocument,
  records: readonly WriteRecord[],
  selection: ReadonlySet<EdgeId>,
): readonly ProjectedEdge[] {
  const hidden = new Set<EdgeId>();
  const drawn: StoredEdge[] = [];
  const states = new Map<EdgeId, Set<EdgeState>>();
  const writes = new Map<EdgeId, MutationId[]>();

  for (const record of records) {
    const change = edgeChangeFor(landed, record.mutation);
    for (const id of change.hidden) hidden.add(id);
    for (const edge of change.drawn) drawn.push(edge);
    for (const id of change.marked) {
      const forEdge = states.get(id) ?? new Set<EdgeState>();
      forEdge.add(edgeStateOf(record));
      states.set(id, forEdge);
      writes.set(id, [...(writes.get(id) ?? []), record.mutationId]);
    }
  }

  const seen = new Set<EdgeId>();
  const visible: StoredEdge[] = [];
  for (const edge of [...landed.edges, ...drawn]) {
    if (hidden.has(edge.id) || seen.has(edge.id)) continue;
    seen.add(edge.id);
    visible.push(edge);
  }

  return visible.map((edge) => {
    // Copied rather than mutated in place: `states` is the map built above, and
    // adding to its entry here would make the projection depend on how many
    // times it had been walked.
    const applied = new Set<EdgeState>(states.get(edge.id));
    if (selection.has(edge.id)) applied.add('selected');
    return {
      ...edge,
      // Canonical order, so two projections of the same state compare equal and
      // a viewer's memoisation is not defeated by set iteration order.
      states: EDGE_STATES.filter((state) => applied.has(state)),
      writes: writes.get(edge.id) ?? [],
    };
  });
}
