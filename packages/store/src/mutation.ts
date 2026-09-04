/**
 * What an edit IS, and the states an edge can be drawn in while one is in
 * flight.
 *
 * The two live together because they are the same design decision seen from two
 * sides: the mutation set is closed so that one user act is one round trip, and
 * the state set is *orthogonal to edge type* so that a pending `blocked-by` is
 * still recognisably a `blocked-by`.
 */

import type { EdgeId, EdgeKind, IssueRef } from './model.ts';

/**
 * The states an edge can carry, from the workspace design's §17b.
 *
 * They are orthogonal to each other and to the edge's kind: an edge keeps its
 * type identity and gains a state as an OVERLAY, so combinations need no new
 * symbols and a viewer can draw `selected` on top of `pending-write` without a
 * fifteenth case. A projected edge therefore carries a *list* of states, never
 * one.
 *
 * - `selected` — the only state that is not about a write.
 * - `pending-write` — drawn optimistically; the order has not re-evaluated yet.
 * - `invalid` — refused before any write. Never dispatched.
 * - `failed` — the write was rejected; nothing changed upstream.
 * - `conflict` — the issue changed upstream mid-edit; both versions are held.
 */
export const EDGE_STATES = Object.freeze([
  'selected',
  'pending-write',
  'invalid',
  'failed',
  'conflict',
] as const);

/** One of the five edge states. */
export type EdgeState = (typeof EDGE_STATES)[number];

const EDGE_STATE_SET: ReadonlySet<string> = new Set<string>(EDGE_STATES);

/** Narrow an arbitrary string to an edge state. */
export function isEdgeState(value: string): value is EdgeState {
  return EDGE_STATE_SET.has(value);
}

/** Correlates a dispatch with its settlement. Unique within one store. */
export type MutationId = string;

/**
 * An edit, before the store has minted an identity for it.
 *
 * Four operations and no more. `retype` and `flip` are their own operations
 * rather than a delete followed by a create, because the design requires a
 * retype to be one operation, one round trip and one undo entry — and a flip is
 * the same argument applied to direction. Composing them would make one user
 * act produce two dispatches and two order re-evaluations.
 */
export type Proposal =
  | { readonly op: 'create'; readonly kind: EdgeKind; readonly from: IssueRef; readonly to: IssueRef }
  | { readonly op: 'delete'; readonly edgeId: EdgeId }
  | { readonly op: 'retype'; readonly edgeId: EdgeId; readonly nextKind: EdgeKind }
  | { readonly op: 'flip'; readonly edgeId: EdgeId };

/** A proposal the store has accepted responsibility for, with its identity. */
export type Mutation = Proposal & { readonly mutationId: MutationId };

/** Why an edit was refused before any write was attempted. */
export interface InvalidReason {
  /** A stable machine-readable code. A host may key a message off it. */
  readonly code: InvalidCode;
  /** A plain sentence, safe to show as the inline reason beside the ghost edge. */
  readonly message: string;
}

/**
 * The refusals this package can reach.
 *
 * `would-cycle` is listed here but is never produced by this package: it is what
 * an injected guard returns, and it is named so hosts and guards agree on one
 * code rather than inventing two.
 *
 * `guard-failed` is the opposite case — the guard threw, so no verdict was
 * reached at all. It refuses rather than proceeding, because an unknown verdict
 * is not permission to write.
 *
 * `cardinality` is a rule of the FORMAT rather than of the store's own
 * structure: every relationship field but `blocked-by` holds one reference
 * (§4.3, `EDGE_CARDINALITY`). It is refused here all the same, because it is
 * visible from the edit and the document alone — the same test that puts
 * `duplicate-edge` here rather than in a guard. Left to hosts, the rule was
 * enforced once per host on one route to a write each, and an adapter that
 * enforced it reported a format rule as an upstream rejection on a write that
 * never left the client (issue #11).
 */
export const INVALID_CODES = Object.freeze([
  'self-edge',
  'unknown-issue',
  'unknown-edge',
  'duplicate-edge',
  'unchanged-kind',
  'symmetric-edge',
  'cardinality',
  'would-cycle',
  'guard-failed',
] as const);

/** A refusal code. */
export type InvalidCode = (typeof INVALID_CODES)[number];
