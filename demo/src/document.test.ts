/**
 * The projection onto the viewer's document — the seam, and nothing else.
 *
 * `explainOrder` is tested in `order.test.ts`; the viewer normalises and draws
 * in its own package. What is this file's is the mapping between them: that a
 * rank, a hold, a duplicate and a provenance arrive on the viewer's side
 * meaning what the derivation meant. The load-bearing pin is the one on
 * `holds` in both directions, the same one `order.test.ts` keeps for the old
 * chips: a slot the derivation holds must say why on the viewer's side, and a
 * slot the viewer draws as held must be one the derivation held.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Priority } from '@issuegraph/core';
import type { GraphDocument, StoredEdge, StoredIssue } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';
import { auditDocument } from '@issuegraph/editor';
import { clustersOf, normalizeDocument } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import { type ExecutorHold, explainDocument } from './order.ts';
import { coverageSeed, seedDocument, seedHolds } from './seed.ts';

function project(document: GraphDocument, holds: readonly ExecutorHold[] = seedHolds()) {
  return projectDocument(explainDocument(document, holds), document);
}

function issue(ref: string, priority?: Priority, state: StoredIssue['state'] = 'open'): StoredIssue {
  return priority === undefined ? { ref, title: `Issue ${ref}`, state } : { ref, title: `Issue ${ref}`, state, priority };
}

describe('the coverage seed projects onto the viewer without loss', () => {
  const document = coverageSeed();
  const { viewer } = project(document);
  const rows = explainDocument(document, seedHolds()).rows;

  it('normalises with no diagnostics beyond the deliberately unresolvable reference', () => {
    const { diagnostics } = normalizeDocument(viewer);
    assert.deepEqual(
      diagnostics.filter((line) => !line.includes('404')),
      [],
      diagnostics.join('\n'),
    );
  });

  it('carries every issue, open and closed, and every landed edge', () => {
    assert.deepEqual(
      viewer.issues.map((each) => each.key).sort(),
      document.issues.map((each) => each.ref).sort(),
    );
    assert.equal(viewer.issues.find((each) => each.key === '8')?.open, false);
    assert.equal(viewer.edges.length, document.edges.length);
  });

  it('holds a slot on the viewer side exactly when the derivation held it', () => {
    for (const slot of viewer.order.slots) {
      const row = rows.find((each) => each.issue.ref === slot.lead);
      assert.ok(row !== undefined, slot.lead);
      assert.equal(slot.ready, row.ready, `#${slot.lead} ready`);
      if (slot.ready) {
        assert.deepEqual(slot.holds, [], `#${slot.lead} is ready and says it is held`);
        assert.ok(slot.rank !== null, `#${slot.lead} is ready with no rank`);
      } else {
        assert.ok(slot.holds.length > 0, `#${slot.lead} is held and says why nowhere`);
        assert.equal(slot.rank, null, `#${slot.lead} is held with a rank`);
      }
    }
  });

  it('numbers ready slots 1..n in order and names readyAfterRank in the same numbering', () => {
    const ranks = viewer.order.slots.flatMap((slot) => (slot.rank === null ? [] : [slot.rank]));
    assert.deepEqual(ranks, ranks.map((_, index) => index + 1));
    const beyond = viewer.order.slots.filter((slot) => slot.readyAfterRank != null);
    assert.ok(beyond.length > 0, 'nothing is ready beyond the concurrency cap');
    for (const slot of beyond) assert.ok(ranks.includes(slot.readyAfterRank ?? -1), `#${slot.lead}`);
  });

  it('maps the two hold families onto the viewer’s two, and never one onto the other', () => {
    const five = viewer.order.slots.find((slot) => slot.lead === '5');
    const six = viewer.order.slots.find((slot) => slot.lead === '6');
    assert.deepEqual(five?.holds.map((hold) => hold.family), ['graph']);
    assert.deepEqual(six?.holds.map((hold) => hold.family), ['tracker']);
  });

  it('keeps a together unit as ONE slot with both members', () => {
    const unit = viewer.order.slots.find((slot) => slot.members.includes('7'));
    assert.deepEqual([...(unit?.members ?? [])].sort(), ['7', '9']);
    assert.equal(viewer.order.slots.filter((slot) => slot.members.includes('9')).length, 1);
  });

  it('excludes a duplicate rather than slotting it, naming its canonical', () => {
    assert.deepEqual(viewer.order.excluded, [{ key: '10', canonical: '4', reason: 'duplicate-of' }]);
    assert.ok(!viewer.order.slots.some((slot) => slot.members.includes('10')));
  });

  it('gives a closed issue no slot', () => {
    assert.ok(!viewer.order.slots.some((slot) => slot.members.includes('8')));
  });

  it('writes provenance in the viewer’s three-form vocabulary', () => {
    const forms = new Set(viewer.issues.map((each) => each.provenance?.kind));
    assert.ok(forms.has('declared-tier'));
    assert.ok(forms.has('promotion'));
    const promoted = viewer.issues.find((each) => each.provenance?.kind === 'promotion');
    assert.ok(promoted?.provenance?.kind === 'promotion');
    assert.match(promoted.provenance.notation, /P\d.*\d/);
    assert.ok(promoted.provenance.promotedBy.length > 0);
  });
});

describe('one cycle answer, across every surface that draws it', () => {
  it('reports a blocked-by cycle through a together unit the same way in the viewer and the audit', () => {
    // THE SHAPE THE WORKSPACE WAS WRONG ABOUT ONCE. `#1 blocked-by #2`,
    // `#3 blocked-by #1` and `#2 together-with #3` is permanently stuck — the
    // unit {2,3} waits on #1, which waits on the unit — but it closes no cycle
    // over raw edges, so a walk that does not contract the unit sees none. The
    // reader's `Model.cycles` contracts it. Every cycle badge on the screen is
    // now that one array, relayed: the viewer's capsule reads it through
    // `ViewerDocument.cycles`, the audit through `AuditGraph.cycles`, and the
    // demo passes the same reference to both.
    const issues = [issue('1', 1), issue('2', 1), issue('3', 1)];
    const edges: StoredEdge[] = [
      makeEdge('blocked-by', '1', '2'),
      makeEdge('blocked-by', '3', '1'),
      makeEdge('together-with', '2', '3'),
    ];
    const { viewer, audit } = project({ issues, edges }, []);

    const stuck = audit.graph.cycles.find((cycle) => cycle.includes('1'));
    assert.deepEqual(stuck, ['1', '2', '3'], 'the reader did not report the stuck group');
    assert.equal(viewer.cycles, audit.graph.cycles, 'the viewer was handed a different array');

    const { document, diagnostics } = normalizeDocument(viewer);
    assert.deepEqual(diagnostics, [], diagnostics.join('\n'));
    const capsule = clustersOf(document).find((cluster) => cluster.members.includes('1'));
    assert.equal(capsule?.hasCycle, true, 'the viewer capsule did not carry the cycle');
    assert.deepEqual(capsule?.members, ['1', '2', '3']);

    const finding = auditDocument(audit).find((each) => each.kind === 'cycle');
    assert.ok(finding !== undefined, 'the audit did not raise the cycle finding');
    assert.deepEqual([...finding.members].sort(), ['1', '2', '3']);
  });

  it('draws no cycle badge for a raw loop the reader does not report', () => {
    // A loop through a CLOSED issue is not a stuck group — a closed blocker does
    // not block today — and the viewer used to badge it anyway off its own
    // edges. It no longer has an opinion.
    const issues = [issue('1', 1), issue('2', 1, 'closed')];
    const edges: StoredEdge[] = [makeEdge('blocked-by', '1', '2'), makeEdge('blocked-by', '2', '1')];
    const { viewer, audit } = project({ issues, edges }, []);

    assert.deepEqual(audit.graph.cycles, []);
    const capsule = clustersOf(normalizeDocument(viewer).document).find((cluster) =>
      cluster.members.includes('1'),
    );
    assert.equal(capsule?.hasCycle, false);
  });
});

describe('the audit input is the derivation’s own reader answer', () => {
  it('hands across the model’s cycles and duplicate resolution in the store’s spelling', () => {
    const document = coverageSeed();
    const { audit } = project(document);
    assert.equal(audit.document, document);
    assert.ok(audit.graph.cycles.some((cycle) => cycle.includes('12') && cycle.includes('13')));
    assert.equal(audit.graph.duplicateCanonical('10'), '4');
    assert.equal(audit.graph.duplicateCanonical('4'), null);
  });
});

describe('edge cases the seed does not carry', () => {
  it('dedupes a together unit’s shared holds so one reason arrives once', () => {
    const issues = [issue('1', 1), issue('2', 1), issue('3', 1)];
    const edges: StoredEdge[] = [makeEdge('together-with', '1', '2'), makeEdge('blocked-by', '2', '3')];
    const { viewer } = project({ issues, edges }, []);
    const unit = viewer.order.slots.find((slot) => slot.members.includes('1'));
    assert.ok(unit !== undefined && !unit.ready);
    const reasons = unit.holds.map((hold) => hold.reason);
    assert.equal(new Set(reasons).size, reasons.length, reasons.join(' | '));
  });

  it('projects an empty document to an empty viewer document', () => {
    const { viewer } = project({ issues: [], edges: [] }, []);
    assert.deepEqual(viewer, { issues: [], edges: [], order: { slots: [], excluded: [] }, cycles: [] });
  });

  it('projects the whole seed, which is what the page draws', () => {
    const document = seedDocument();
    const { viewer } = project(document);
    assert.equal(viewer.issues.length, document.issues.length);
    const open = document.issues.filter((each) => each.state === 'open').length;
    const slotted = viewer.order.slots.reduce((sum, slot) => sum + slot.members.length, 0);
    assert.equal(slotted + viewer.order.excluded.length, open);
  });
});
