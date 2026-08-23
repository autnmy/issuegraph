/**
 * The document algebra, and the half of `invalid` that needs no graph walk.
 *
 * Pure and synchronous throughout: everything here answers "what would this
 * edit produce" or "why can it not happen", and neither question has any
 * business touching a network, a clock or the store's state.
 *
 * The split with {@link ../source.ts EdgeGuard} is by what the answer NEEDS TO
 * SEE. A self-edge, an unknown reference and a duplicate are visible in the
 * edit itself; a cycle is only visible by walking the graph, and the walk
 * belongs with the derivation so the package family has one of it. Both halves
 * produce the same refusal, and neither ever reaches `dispatch`.
 */

import { isSymmetricEdgeField } from '@issuegraph/core';

import {
  type EdgeId,
  type GraphDocument,
  type StoredEdge,
  findEdge,
  hasIssue,
  makeEdge,
} from './model.ts';
import type { InvalidReason, Mutation } from './mutation.ts';

/**
 * What an edit does to the projection: which landed edges it replaces, which
 * edges it introduces, and which of them carry its state.
 *
 * A `delete` draws nothing and hides nothing — it MARKS the edge it is removing
 * and leaves it visible. That is deliberate rather than a missing case: the
 * design draws `failed` as a ghost with a ✕ terminal, and there is no ghost to
 * draw if an optimistic delete has already taken the edge off the canvas. The
 * edge leaves the document when the write lands, not when it is proposed.
 */
export interface EdgeChange {
  readonly hidden: readonly EdgeId[];
  readonly drawn: readonly StoredEdge[];
  readonly marked: readonly EdgeId[];
}

/** The edge an edit produces, or `undefined` for one that produces none. */
export function resultingEdge(document: GraphDocument, mutation: Mutation): StoredEdge | undefined {
  switch (mutation.op) {
    case 'create':
      return makeEdge(mutation.kind, mutation.from, mutation.to);
    case 'delete':
      return undefined;
    case 'retype': {
      const edge = findEdge(document, mutation.edgeId);
      return edge === undefined ? undefined : makeEdge(mutation.nextKind, edge.from, edge.to);
    }
    case 'flip': {
      const edge = findEdge(document, mutation.edgeId);
      return edge === undefined ? undefined : makeEdge(edge.kind, edge.to, edge.from);
    }
  }
}

/** How an edit shows up in the projection while it is unlanded. */
export function edgeChangeFor(document: GraphDocument, mutation: Mutation): EdgeChange {
  if (mutation.op === 'create') {
    const created = makeEdge(mutation.kind, mutation.from, mutation.to);
    return { hidden: [], drawn: [created], marked: [created.id] };
  }
  if (mutation.op === 'delete') {
    return { hidden: [], drawn: [], marked: [mutation.edgeId] };
  }
  // retype and flip replace one edge with another, which is why they are single
  // operations: one round trip, one undo entry, one order re-evaluation.
  //
  // The empty change IS reachable: a sibling write can land a delete of this
  // edge while this one is still in flight, and an overlay on an edge that is
  // no longer there draws nothing rather than resurrecting it.
  const produced = resultingEdge(document, mutation);
  if (produced === undefined) return { hidden: [], drawn: [], marked: [] };
  // A REPLACEMENT THAT PRODUCES THE SAME IDENTITY IS A MARK, NOT A SWAP. A
  // retype to the kind the edge already has, and a flip of a symmetric edge,
  // both name the edge they started from — so hiding the original while drawing
  // the replacement would hide and redraw one identity, and the projection
  // (which filters hidden ids out of BOTH sources) would erase a real, landed
  // relationship because the user made a no-op edit. Both are refused anyway;
  // this is what lets the refusal be SHOWN on the edge it is about.
  if (produced.id === mutation.edgeId) {
    return { hidden: [], drawn: [], marked: [mutation.edgeId] };
  }
  return { hidden: [mutation.edgeId], drawn: [produced], marked: [produced.id] };
}

/** The document an edit would produce, if it landed exactly as proposed. */
export function nextDocument(document: GraphDocument, mutation: Mutation): GraphDocument {
  const change = edgeChangeFor(document, mutation);
  const removed = new Set<EdgeId>([
    ...change.hidden,
    ...(mutation.op === 'delete' ? [mutation.edgeId] : []),
  ]);
  const kept = document.edges.filter((edge) => !removed.has(edge.id));
  const added = change.drawn.filter((edge) => !kept.some((existing) => existing.id === edge.id));
  return { issues: document.issues, edges: [...kept, ...added] };
}

function refuse(code: InvalidReason['code'], message: string): InvalidReason {
  return { code, message };
}

/**
 * Why this edit cannot happen, from the edit and the document alone.
 *
 * Returns `undefined` when nothing structural stands in the way — which is not
 * the same as "valid": an injected guard runs afterwards and may still refuse.
 */
export function structuralRefusal(
  document: GraphDocument,
  mutation: Mutation,
): InvalidReason | undefined {
  if (mutation.op === 'create') {
    if (mutation.from === mutation.to) {
      return refuse('self-edge', 'An issue cannot carry a relationship to itself.');
    }
    for (const ref of [mutation.from, mutation.to]) {
      if (!hasIssue(document, ref)) {
        return refuse('unknown-issue', `This document holds no issue ${ref}.`);
      }
    }
    const produced = makeEdge(mutation.kind, mutation.from, mutation.to);
    if (findEdge(document, produced.id) !== undefined) {
      return refuse('duplicate-edge', `${mutation.from} is already ${mutation.kind} ${mutation.to}.`);
    }
    return undefined;
  }

  const edge = findEdge(document, mutation.edgeId);
  if (edge === undefined) {
    return refuse('unknown-edge', 'That relationship is no longer in this document.');
  }
  if (mutation.op === 'delete') return undefined;

  if (mutation.op === 'retype' && mutation.nextKind === edge.kind) {
    return refuse('unchanged-kind', `That relationship is already ${edge.kind}.`);
  }
  if (mutation.op === 'flip') {
    if (isSymmetricEdgeField(edge.kind)) {
      return refuse('symmetric-edge', `${edge.kind} carries no direction, so there is nothing to flip.`);
    }
    if (edge.from === edge.to) {
      return refuse('self-edge', 'A relationship from an issue to itself has no direction to flip.');
    }
  }

  const produced = resultingEdge(document, mutation);
  // `produced` cannot be undefined here — the edge was found above and neither
  // remaining operation deletes. Narrowed rather than asserted so a future
  // operation added to the union has to say what it produces.
  if (produced !== undefined && produced.id !== edge.id && findEdge(document, produced.id) !== undefined) {
    return refuse('duplicate-edge', `${produced.from} is already ${produced.kind} ${produced.to}.`);
  }
  return undefined;
}
