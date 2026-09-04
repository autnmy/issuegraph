/**
 * The projection onto the viewer's document — the host's half of the seam.
 *
 * `@issuegraph/viewer` takes a plain `{issues, edges, order}` and draws it. It
 * derives nothing: the order, the holds, the provenance and the exclusions are
 * all inputs, "because knowing a tracker's URL shape is exactly the knowledge
 * this layer must not carry" — and the same goes for knowing which executor
 * holds what. So this file maps what `order.ts` already explained onto the
 * shape the viewer reads, and adds nothing the derivation did not say.
 *
 * The rows come from `explainDocument`, which is the SAME `@issuegraph/derive`
 * call the store's deriver runs. A second derivation here — even a cheap one,
 * such as re-walking `duplicate-of` to find a canonical — would be a second
 * opinion about the order, free to disagree with the one the store holds. So
 * the model the rows were built from is handed across too, and the audit reads
 * its cycles and its duplicate resolution off that.
 */

import { DEFAULT_PRIORITY } from '@issuegraph/core';
import type { AuditInput } from '@issuegraph/editor';
import type { GraphDocument } from '@issuegraph/store';
import type {
  RankProvenance,
  ViewerDocument,
  ViewerExclusion,
  ViewerHold,
  ViewerIssue,
  ViewerSlot,
} from '@issuegraph/viewer';

import type { ExplainedDocument, ExplainedRow, Hold } from './order.ts';

/** The viewer's input plus the audit's, from one explained document. */
export interface Projection {
  readonly viewer: ViewerDocument;
  readonly audit: AuditInput;
}

/** The demo's hold families, in the viewer's vocabulary. */
function familyOf(hold: Hold): ViewerHold['family'] {
  return hold.family === 'executor' ? 'tracker' : 'graph';
}

/** A note that does not hold (`blocking: false`) is not a readiness failure. */
function blocks(hold: Hold): boolean {
  return hold.blocking !== false;
}

function provenanceOf(explained: ExplainedDocument, row: ExplainedRow): RankProvenance {
  const view = explained.order.priority.get(row.issue.ref);
  if (view !== undefined && view.promoted && view.promotedBy.length > 0) {
    return { kind: 'promotion', notation: view.notation, promotedBy: view.promotedBy };
  }
  const declared = row.provenance.form === 'promoted' ? row.provenance.declared : row.provenance.priority;
  return { kind: 'declared-tier', priority: declared };
}

function issueOf(explained: ExplainedDocument, row: ExplainedRow): ViewerIssue {
  return {
    key: row.issue.ref,
    title: row.issue.title,
    open: row.issue.state === 'open',
    priority: row.issue.priority ?? DEFAULT_PRIORITY,
    provenance: provenanceOf(explained, row),
  };
}

/** Whether a row is the derivation's duplicate exclusion rather than a slot. */
function isDuplicate(row: ExplainedRow): boolean {
  return row.holds.some((hold) => hold.label === 'duplicate');
}

/**
 * Group the rows into the viewer's slots.
 *
 * `explainOrder` places every issue at a rank and a placement: spine rows
 * hold ranks in derivation order, executor-held slots and the remainder land
 * in the footer. The viewer wants one slot per rank with its members — a
 * together unit is ONE slot — and it decides the footer itself, from the hold
 * family, so what crosses here is the rank grouping and the holds.
 *
 * Viewer ranks are 1-based over READY slots only, with a held slot keeping
 * its position at `null`: "printing one would claim work is queued that
 * nothing can start". `readyAfterRank` names one of those ready ranks, so the
 * placement rank it was expressed in is translated through the same table.
 */
function slotsOf(explained: ExplainedDocument): {
  readonly slots: readonly ViewerSlot[];
  readonly excluded: readonly ViewerExclusion[];
} {
  const byRank = new Map<number, ExplainedRow[]>();
  const excluded: ViewerExclusion[] = [];
  for (const row of explained.rows) {
    if (row.issue.state !== 'open') continue;
    if (isDuplicate(row)) {
      excluded.push({
        key: row.issue.ref,
        canonical: explained.model.duplicateCanonical(row.issue.ref) ?? row.issue.ref,
        reason: 'duplicate-of',
      });
      continue;
    }
    const members = byRank.get(row.rank);
    if (members === undefined) byRank.set(row.rank, [row]);
    else members.push(row);
  }

  // The rank table: placement rank -> viewer rank, for the ready slots.
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const viewerRank = new Map<number, number>();
  let next = 1;
  for (const rank of ranks) {
    const lead = byRank.get(rank)?.[0];
    if (lead?.ready === true) {
      viewerRank.set(rank, next);
      next += 1;
    }
  }

  const slots = ranks.flatMap((rank): ViewerSlot[] => {
    const rows = byRank.get(rank) ?? [];
    const lead = rows[0];
    if (lead === undefined) return [];
    const ready = lead.ready;
    const holds: ViewerHold[] = ready
      ? []
      : rows
          .flatMap((row) => row.holds)
          .filter(blocks)
          .map((hold) => ({ family: familyOf(hold), reason: hold.detail }));
    const readyAfter =
      lead.readyAfterRank === undefined ? null : (viewerRank.get(lead.readyAfterRank) ?? null);
    return [
      {
        rank: viewerRank.get(rank) ?? null,
        lead: lead.issue.ref,
        members: rows.map((row) => row.issue.ref),
        ready,
        holds: dedupe(holds),
        readyAfterRank: readyAfter,
      },
    ];
  });

  return { slots, excluded };
}

/**
 * A together unit's members each carry the unit's shared holds, prefixed by
 * `holdsFor` with the member that owns them — so one reason arrives once per
 * member. The viewer renders each entry it is given, so the copies collapse
 * here, by reason text, keeping the first family that stated it.
 */
function dedupe(holds: readonly ViewerHold[]): readonly ViewerHold[] {
  const seen = new Set<string>();
  return holds.filter((hold) => {
    if (seen.has(hold.reason)) return false;
    seen.add(hold.reason);
    return true;
  });
}

/** Project one explained document, and the landed document it explains, for the viewer and the audit. */
export function projectDocument(explained: ExplainedDocument, landed: GraphDocument): Projection {
  const { slots, excluded } = slotsOf(explained);
  return {
    viewer: {
      issues: explained.rows.map((row) => issueOf(explained, row)),
      edges: landed.edges.map((edge) => ({ field: edge.kind, from: edge.from, to: edge.to })),
      order: { slots, excluded },
      // THE SAME ARRAY THE AUDIT READS BELOW. The viewer's cycle badge and the
      // audit's cycle finding are two renderings of one reader answer, so they
      // cannot disagree about a component while both are on one screen.
      cycles: explained.model.cycles,
    },
    audit: {
      document: landed,
      graph: {
        cycles: explained.model.cycles,
        duplicateCanonical: explained.model.duplicateCanonical,
      },
    },
  };
}
