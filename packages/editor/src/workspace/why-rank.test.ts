import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RankProvenance, ViewerDocument } from '@issuegraph/viewer';
import { provenanceClause, renderMarkup } from '@issuegraph/viewer';

import { inspectorView } from './inspector.ts';
import { renderWorkspace } from './render.ts';
import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';

/**
 * §17a's inspector case, which the demo's own comp document also draws:
 * `#512` is held by an open `blocked-by #488` and shares a together unit with
 * `#514`. Keys are the fixture's, the shape is the frame's.
 */
const HELD_IN_A_UNIT: ViewerDocument = backlogOf(4, {
  held: ['i0002'],
  unitOf: { i0003: 'i0002' },
  edges: [['blocked-by', 'i0002', 'i0001']],
});

const MATCHED: RankProvenance = { kind: 'matched-query', index: 1, label: 'label:P0' };

/** The same backlog with provenance on one issue — `backlogOf` states none. */
function withProvenance(document: ViewerDocument, key: string): ViewerDocument {
  return {
    ...document,
    issues: document.issues.map((issue) =>
      issue.key === key ? { ...issue, provenance: MATCHED } : issue,
    ),
  };
}

function inspectorMarkupFor(document: ViewerDocument, key: string): string {
  const result = renderWorkspace(document, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', keys: [key] },
  });
  const zone = /<section class="ig-zone" data-zone="inspector">([\s\S]*)$/.exec(result.markup);
  assert.ok(zone !== null, 'no inspector zone');
  return zone[1] ?? '';
}

describe('the inspector states why the issue sits where it does', () => {
  /**
   * THE SYMPTOM #122 LEADS WITH. Before this the panel showed raw tokens and no
   * sentence, "even though the package already carries the function that
   * composes provenance".
   */
  it('names the rank, and composes the provenance layer 1 already words', () => {
    const document = withProvenance(backlogOf(3), 'i0002');
    const markup = inspectorMarkupFor(document, 'i0002');

    assert.match(markup, /class="ig-why-rank"/, 'no why-rank block at all');
    assert.match(markup, /class="ig-why-rank-heading">why rank 2</, 'the heading names no rank');
    assert.match(markup, /data-held="false"/);

    // AE3: the clause is layer 1's, byte for byte. A second wording in this
    // package would pass a "mentions the query" assertion and still drift from
    // the §16 rail row that states the same fact.
    const clause = renderMarkup(provenanceClause(MATCHED)!);
    assert.ok(
      markup.includes(clause),
      'the sentence is not layer 1’s provenance clause — one fact has two wordings',
    );
  });

  /**
   * A RANK AND A HOLD ARE EXCLUSIVE, so the heading has to say which it is.
   * `@issuegraph/derive` assigns `ready ? (rank += 1) : null`, and PR #126
   * already ruled for §16 that a held unit prints the em dash rather than a
   * number — frame 17a draws `#512` at rank 2 AND "Held until #488 closes",
   * which the model cannot represent.
   */
  it('states the hold instead of a rank when the slot is held', () => {
    const markup = inspectorMarkupFor(HELD_IN_A_UNIT, 'i0002');

    assert.match(markup, /class="ig-why-rank-heading">why held</);
    assert.match(markup, /data-held="true"/);
    assert.equal(
      /class="ig-why-rank-heading">why rank/.test(markup),
      false,
      'a held slot was given a rank it does not have',
    );
  });

  it('renders the hold’s own reason verbatim, with its cause on the markup', () => {
    const view = inspectorView(HELD_IN_A_UNIT, { kind: 'issue', keys: ['i0002'] });
    assert.equal(view.subject.kind, 'issue');
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    const holds = view.subject.whyRank?.holds ?? [];
    assert.ok(holds.length > 0, 'the fixture holds nothing');

    const markup = inspectorMarkupFor(HELD_IN_A_UNIT, 'i0002');
    for (const hold of holds) {
      // Verbatim, exactly as layer 1's `holdLine` renders it: the reason is
      // host-authored, and rewording it here would put this package in charge
      // of a vocabulary that belongs to whatever produced the hold.
      assert.ok(markup.includes(hold.reason), `the hold reason ${hold.reason} was reworded`);
    }
  });

  /**
   * The clause the frame ends on: *"then worked with #514 as one unit"*. A
   * together unit is ONE slot with several members and one rank, so the other
   * members are the only place that fact can come from.
   */
  it('names the rest of a together unit, and never the subject itself', () => {
    const markup = inspectorMarkupFor(HELD_IN_A_UNIT, 'i0002');
    const unit = /class="ig-why-rank-unit">([\s\S]*?)<\/span><\/p>/.exec(markup)?.[1] ?? '';
    assert.ok(unit.includes('i0003'), 'the unit partner is not named');
    assert.equal(unit.includes('i0002'), false, 'the subject was named as its own partner');
  });

  it('draws no unit clause for an ordinary slot', () => {
    const markup = inspectorMarkupFor(backlogOf(3), 'i0002');
    assert.equal(/class="ig-why-rank-unit"/.test(markup), false);
  });

  /**
   * AN EXCLUDED ISSUE HAS NO POSITION, so it gets no explanation. Inventing one
   * would explain a rank the issue does not hold — `inspectorView` already
   * answers `position: null` for it, and this keeps the block in step.
   */
  it('explains nothing for an issue the order places nowhere', () => {
    const base = backlogOf(3);
    const excluded: ViewerDocument = {
      ...base,
      order: {
        slots: base.order.slots.filter((slot) => slot.lead !== 'i0003'),
        excluded: [{ key: 'i0003', reason: 'duplicate-of', canonical: 'i0001' }],
      },
    };
    const view = inspectorView(excluded, { kind: 'issue', keys: ['i0003'] });
    assert.equal(view.subject.kind, 'issue');
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.whyRank, null);
    assert.equal(/class="ig-why-rank"/.test(inspectorMarkupFor(excluded, 'i0003')), false);
  });
});
