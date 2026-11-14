/**
 * The write ledger, turned into the log the workspace draws under its head.
 *
 * ONE DERIVATION FOR BOTH PLACEMENTS. The log lists every write that is still
 * saving or did not save, and the Inspector draws the failed and conflicted
 * ones its panel states. Both read the entries made here, so the two cannot
 * disagree about which writes exist or what each one offers.
 *
 * NOT FILTERED BY SELECTION OR BY CARRIER. A write that did not save is the
 * reader's to retry or discard whichever issue is selected, and a write about
 * issues this backlog does not hold has nowhere else to offer either.
 *
 * Pure: the mount owns the maps it is handed and the snapshot they came from.
 */

import { edgeIdentity } from '@issuegraph/core';
import type { EdgeId, GraphDocument, Mutation, MutationId, WriteRecord } from '@issuegraph/store';
import { findEdge, makeEdge } from '@issuegraph/store';

import { conflictDiff } from './recovery.ts';
import type { WorkspaceLogEntry, WorkspaceLoggedEdge, WorkspaceLoggedWrite } from './render.ts';

/** What the ledger alone cannot say about a write, read off the mount and the snapshot. */
export interface WriteLogContext {
  /**
   * What the source has confirmed. By the ledger's rule it does not hold a
   * write that failed, so a conflict's own side is rebuilt from its mutation.
   */
  readonly landed: GraphDocument;
  /** Which issue's panel states each write, recorded when the edit was made. */
  readonly carriers: ReadonlyMap<MutationId, string | null>;
  /** The edge the projection marks for each write, when it marks one. */
  readonly markedBy: ReadonlyMap<MutationId, EdgeId>;
  /** The write whose redo on the latest version pressed a read that failed, if any. */
  readonly refreshFailedFor: MutationId | null;
  /** Why the store's last read failed, or `null`. */
  readonly hydrationError: string | null;
}

/** The log's entries, one per saving, failed or conflicted write, in ledger order. */
export function writeLog(
  writes: readonly WriteRecord[],
  context: WriteLogContext,
): readonly WorkspaceLogEntry[] {
  return writes.flatMap((record) => entryFor(record, context));
}

/**
 * One record's entry, or none for a refused edit.
 *
 * A REFUSED EDIT HAS NO ENTRY because the store refuses it before any write is
 * attempted: nothing was saving and nothing failed to save. Its capsule stays
 * on the relationship it refused.
 */
function entryFor(record: WriteRecord, context: WriteLogContext): readonly WorkspaceLogEntry[] {
  switch (record.state) {
    case 'pending':
      return [{ kind: 'pending', mutationId: record.mutationId, write: loggedWrite(record.mutation, context.landed) }];
    case 'invalid':
      return [];
    case 'failed':
      return [{ kind: 'failed', ...cardFacts(record, context), reason: record.reason }];
    case 'conflict':
      return [
        {
          kind: 'conflict',
          ...cardFacts(record, context),
          // AGAINST `landed`, WHICH CANNOT HOLD THE EDIT — that is the point.
          // `conflictDiff` rebuilds the reader's own side from the mutation, so
          // the card names the relationship it is about rather than depending
          // on a document that by contract omits it.
          diff: conflictDiff(context.landed, record.upstream, record.mutation),
          // ONLY ON THE CARD WHOSE READ FAILED. A hydration error with no press
          // behind it belongs to no card, and a press whose read succeeded
          // leaves no error to draw.
          refreshError: context.refreshFailedFor === record.mutationId ? context.hydrationError : null,
        },
      ];
  }
}

/** The facts every recovery card carries: which write, which edge, and whose panel. */
function cardFacts(
  record: WriteRecord,
  context: WriteLogContext,
): { readonly mutationId: MutationId; readonly edgeId: EdgeId; readonly carrier: string | null } {
  return {
    mutationId: record.mutationId,
    // THE PROJECTION'S EDGE, AND THE EDIT'S OWN AS THE FALLBACK: a write about
    // an edge the document no longer carries marks nothing, and its mutation
    // still names the edge it was about.
    edgeId: context.markedBy.get(record.mutationId) ?? mutationEdgeId(record.mutation),
    carrier: context.carriers.get(record.mutationId) ?? null,
  };
}

/** The edge a mutation is about, by identity. */
function mutationEdgeId(mutation: Mutation): EdgeId {
  return mutation.op === 'create' ? edgeIdentity(mutation.kind, mutation.from, mutation.to) : mutation.edgeId;
}

/** What a saving write does, with the edge it is about looked up in the landed document. */
function loggedWrite(mutation: Mutation, landed: GraphDocument): WorkspaceLoggedWrite {
  switch (mutation.op) {
    case 'create':
      return { op: 'create', edge: makeEdge(mutation.kind, mutation.from, mutation.to) };
    case 'delete':
    case 'flip':
      return { op: mutation.op, edge: landedEdge(landed, mutation.edgeId) };
    case 'retype':
      return { op: 'retype', edge: landedEdge(landed, mutation.edgeId), nextKind: mutation.nextKind };
  }
}

/** The edge as the landed document holds it, or its raw id when the document no longer does. */
function landedEdge(landed: GraphDocument, edgeId: EdgeId): WorkspaceLoggedEdge {
  return findEdge(landed, edgeId) ?? edgeId;
}
