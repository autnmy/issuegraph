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
import type { AuditInput, EncodingRefusal } from '@issuegraph/editor';
import type { GraphDocument } from '@issuegraph/store';
import type { IssueRef } from '@issuegraph/store';
import type {
  HostFacts,
  RankProvenance,
  ViewerDocument,
  ViewerExclusion,
  ViewerHold,
  ViewerIssue,
  ViewerSlot,
} from '@issuegraph/viewer';

import type { IssueCaveats } from './host.ts';
import type { ExplainedDocument, ExplainedRow, Hold } from './order.ts';

/** The viewer's input plus the audit's, from one explained document. */
export interface Projection {
  readonly viewer: ViewerDocument;
  readonly audit: AuditInput;
}

/**
 * The demo's hold, in the viewer's vocabulary.
 *
 * The executor's word — `claimed`, `parked`, `duplicate` — rides the tracker
 * arm's `label`, which is the one place the union lets a label live: the
 * design's footer names each runner hold by that word beside its sentence,
 * and a graph hold has no word of its own to carry.
 */
function holdOf(hold: Hold): ViewerHold {
  return hold.family === 'executor'
    ? { family: 'tracker', reason: hold.detail, label: hold.label }
    : { family: 'graph', reason: hold.detail };
}

/** A note that does not hold (`blocking: false`) is not a readiness failure. */
function blocks(hold: Hold): boolean {
  return hold.blocking !== false;
}

/**
 * Where this row's rank came from, in the viewer's own three forms.
 *
 * THE ORDER OF THE ARMS IS THE DESIGN'S RECONCILIATION RULE, not a preference.
 * The config layer produces a complete ranking on its own and the relationship
 * layer MODIFIES it — so a promotion, which is the relationship layer speaking,
 * is what a row says when it has one. Below that sits whichever ordered query
 * the host's engine matched, and below that the tier the issue declares.
 */
function provenanceOf(
  explained: ExplainedDocument,
  row: ExplainedRow,
  caveats: ReadonlyMap<IssueRef, IssueCaveats>,
): RankProvenance {
  const view = explained.order.priority.get(row.issue.ref);
  if (view !== undefined && view.promoted && view.promotedBy.length > 0) {
    return { kind: 'promotion', notation: view.notation, promotedBy: view.promotedBy };
  }
  const matched = caveats.get(row.issue.ref)?.matchedQuery;
  if (matched !== undefined) return { kind: 'matched-query', index: matched.index, label: matched.label };
  const declared = row.provenance.form === 'promoted' ? row.provenance.declared : row.provenance.priority;
  return { kind: 'declared-tier', priority: declared };
}

/** The two caveats the viewer's issue actually carries, and nothing else from the table. */
function previewAndDisagreement(caveats: IssueCaveats | undefined): Partial<ViewerIssue> {
  if (caveats === undefined) return {};
  return {
    ...(caveats.previewOnly === undefined ? {} : { previewOnly: caveats.previewOnly }),
    ...(caveats.disagreement === undefined ? {} : { disagreement: caveats.disagreement }),
  };
}

function issueOf(
  explained: ExplainedDocument,
  row: ExplainedRow,
  caveats: ReadonlyMap<IssueRef, IssueCaveats>,
): ViewerIssue {
  return {
    key: row.issue.ref,
    title: row.issue.title,
    open: row.issue.state === 'open',
    priority: row.issue.priority ?? DEFAULT_PRIORITY,
    provenance: provenanceOf(explained, row, caveats),
    // The host's caveats about its own engine, from the scenario's table.
    // `matchedQuery` is deliberately NOT spread onto the issue: it is an input
    // to the provenance above, not a field the viewer's document carries.
    ...previewAndDisagreement(caveats.get(row.issue.ref)),
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
function slotsOf(
  explained: ExplainedDocument,
  running: ReadonlySet<IssueRef>,
): {
  readonly slots: readonly ViewerSlot[];
  readonly excluded: readonly ViewerExclusion[];
} {
  const byRank = new Map<number, ExplainedRow[]>();
  const excluded: ViewerExclusion[] = [];
  for (const row of explained.rows) {
    if (row.issue.state !== 'open') continue;
    // THE RUNNING ISSUE IS DRAWN ONCE, in the NOW row. The derivation holds it
    // as an active claim — correctly, so its serialize group is excluded — and
    // that hold would put a footer row under it too. The design draws the job
    // above the order and the footer without it, and this host agrees: a row
    // that says "working" beneath a row that says "now" is one fact twice.
    if (running.has(row.issue.ref)) continue;
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
          .map(holdOf);
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

/**
 * Project one explained document, and the landed document it explains, for the
 * viewer and the audit. `host` is what the runner knows and the graph does not
 * (`host.ts`), and `caveats` what the host's engine knows about its own rows;
 * absent, the viewer draws the pure-graph view.
 */
/**
 * The document an audit reads, and the reading of it — ONE PAIR, never two
 * halves.
 *
 * `AuditInput` carries a document and the graph probes over it, and those are
 * two views of one thing: the cycles and the duplicate resolution are answers
 * ABOUT that document. Supplying them from different sources is the defect this
 * type exists to make unrepresentable — the audited document was corrected once
 * while its probes stayed derived from the blanked projection, so the backlog's
 * cycle finding vanished and every canonical-dependent finding was computed
 * against a graph that was not the one being audited.
 */
export interface Audited {
  readonly document: GraphDocument;
  readonly explained: ExplainedDocument;
  /**
   * Declarations the reader REFUSED, which no pair above can supply.
   *
   * A THIRD MEMBER, AND THE ONE-PAIR RULE IS EXTENDED KNOWINGLY RATHER THAN
   * BROKEN. That rule is about a document and the reading of it disagreeing;
   * this is neither. A refusal is a fact about a RAW BODY — by the time an
   * `ExplainedDocument` exists the body is gone — so it cannot be derived from
   * either half and has to be stated beside them.
   *
   * IN THIS DEMO IT IS A FIXTURE, NOT A READING. The demo parses no bodies: it
   * builds its backlog from seed data, so nothing here can refuse anything.
   * The value below is authored so §17d's fourth surface has something to draw,
   * and a real host supplies its reader's own answer instead.
   */
  readonly encodingRefused?: readonly EncodingRefusal[] | undefined;
}

/**
 * @param landed   what this panel DRAWS. The empty state deliberately blanks it.
 * @param audited  what the repository HOLDS, and the reading of it. Defaults to
 *   the drawn pair and differs only where the two genuinely differ: an audit is
 *   a reading of the backlog's relationships, and a panel saying nothing is
 *   eligible has not changed one of them. Passing the blanked document made the
 *   workspace's audit report zero findings and its filter drop every affected
 *   row the moment eligibility changed — a fact about the ORDER erasing facts
 *   about the GRAPH.
 */
export function projectDocument(
  explained: ExplainedDocument,
  landed: GraphDocument,
  host?: HostFacts,
  caveats: ReadonlyMap<IssueRef, IssueCaveats> = new Map(),
  audited: Audited = { document: landed, explained },
): Projection {
  const running = new Set((host?.running ?? []).map((job) => job.key));
  const { slots, excluded } = slotsOf(explained, running);
  return {
    viewer: {
      issues: explained.rows.map((row) => issueOf(explained, row, caveats)),
      edges: landed.edges.map((edge) => ({ field: edge.kind, from: edge.from, to: edge.to })),
      order: { slots, excluded },
      ...(host === undefined ? {} : { host }),
      // THE SAME ARRAY THE AUDIT READS BELOW. The viewer's cycle badge and the
      // audit's cycle finding are two renderings of one reader answer, so they
      // cannot disagree about a component while both are on one screen.
      cycles: explained.model.cycles,
    },
    // EVERY HALF FROM ONE SOURCE. The probes are answers ABOUT the audited
    // document, so they come from its own reading — taking them from the drawn
    // projection audited one graph with another graph's answers.
    audit: {
      document: audited.document,
      graph: {
        cycles: audited.explained.model.cycles,
        duplicateCanonical: audited.explained.model.duplicateCanonical,
      },
      // FROM THE SAME `Audited` VALUE AS THE OTHER TWO, so a caller cannot pair
      // one backlog's refusals with another backlog's reading — the defect the
      // type exists to make unrepresentable, asked of the third member too.
      encodingRefused: audited.encodingRefused ?? [],
    },
  };
}
