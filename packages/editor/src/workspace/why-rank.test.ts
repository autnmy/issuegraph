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

/** The Position sentence as a reader hears it: its text, tags stripped. */
function sentenceOf(markup: string): string {
  const sentence = /<p class="ig-why-rank-sentence">([\s\S]*?)<\/p>/.exec(markup)?.[1] ?? '';
  return sentence.replace(/<[^>]+>/g, '');
}

function inspectorMarkupFor(document: ViewerDocument, key: string): string {
  const result = renderWorkspace(document, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', key },
  });
  const zone = /<section class="ig-zone" data-zone="inspector"[^>]*>([\s\S]*)$/.exec(result.markup);
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
    // RULES (#308): the heading is "Position" alone, and the rank opens the sentence.
    assert.match(markup, /class="ig-why-rank-heading">why rank</);
    assert.match(markup, /data-held="false"/);
    assert.equal(sentenceOf(markup), '2 of 3. Matched ordering query 1, label:P0.');

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
   * THE EM DASH IS FOR A SLOT THE ORDER CANNOT PLACE, not for every held one.
   * `RULINGS.md` §1 keeps the rank when the blocker is inside the previewed
   * order, so PR #126's ruling now applies to the other arm — a host that
   * states `rank: null` has said the position is unknown, and the heading is
   * the only place a reader learns that.
   */
  it('states the hold instead of a rank when the order placed the slot nowhere', () => {
    const markup = inspectorMarkupFor(HELD_IN_A_UNIT, 'i0002');

    assert.match(markup, /class="ig-why-rank-heading">why held</);
    assert.match(markup, /data-held="true"/);
    assert.equal(
      /class="ig-why-rank-heading">why rank/.test(markup),
      false,
      'an unplaced slot was given a rank it does not have',
    );
    assert.match(markup, /class="ig-inspector-holds"/, 'an issue held and placed nowhere lost what it waits on');
  });

  /**
   * FRAME 17a's OWN PAIR, drawable for the first time: `#512` at rank 2 AND
   * "Held until #488 closes". `RULINGS.md` §1 (2026-09-20) ranks a held slot
   * whose blocker is inside the previewed order, so the host can state both —
   * the heading reads the rank, `data-held` reads the holds, and the list
   * beneath still carries the blocker as a control.
   */
  it('names the rank AND the hold when the order still placed the held slot', () => {
    const document = withProvenance(HELD_IN_A_UNIT, 'i0002');
    // The same document with #512's slot placed: the host has decided its
    // blocker is one of these rows, so the slot keeps the position it sits at
    // and everything below it moves down by one.
    let rank = 0;
    const placed: ViewerDocument = {
      ...document,
      order: {
        ...document.order,
        // Its graph hold names the blocker the sentence names, as a derived one does.
        slots: document.order.slots.map((slot) => ({
          ...slot,
          rank: (rank += 1),
          holds: slot.holds.map((hold) => ({ ...hold, subject: 'i0001' })),
        })),
      },
    };

    const markup = inspectorMarkupFor(placed, 'i0002');
    assert.match(markup, /class="ig-why-rank-heading">why rank</);
    // RULES' sentence: the rank, the query, then the unit and what it waits on,
    // each clause ending on its stop and one space between (#308: the clauses
    // ran together as "...P0worked together with...").
    assert.equal(
      sentenceOf(markup),
      '2 of 3. Matched ordering query 1, label:P0. Worked with i0003 as one unit, after i0001 closes.',
    );
    assert.match(markup, /data-held="true"/, 'a held slot was drawn as unheld');
    // A placed issue's sentence names what it waits on, and the board draws no
    // hold list under it (review-219, PR 320): the list is "Why it is held" only.
    assert.equal(/class="ig-inspector-holds"/.test(markup), false, 'a placed issue repeated its blocker in a hold list');

    // A hold the sentence does not state still draws (review-219 and review-41
    // on PR 321): a tracker hold on the same placed slot.
    const claimed: ViewerDocument = {
      ...placed,
      order: {
        ...placed.order,
        slots: placed.order.slots.map((slot) =>
          slot.lead === 'i0002' ? { ...slot, holds: [...slot.holds, { family: 'tracker' as const, reason: 'claimed by a run' }] } : slot,
        ),
      },
    };
    const kept = inspectorMarkupFor(claimed, 'i0002');
    assert.match(kept, /class="ig-inspector-holds"/, 'a placed slot lost a hold its sentence does not state');
    assert.ok(kept.includes('claimed by a run'));
    const list = /<ul class="ig-inspector-holds">([\s\S]*?)<\/ul>/.exec(kept)?.[1] ?? '';
    assert.equal(list.includes('a blocker is open'), false, 'the graph hold the sentence states was repeated');

    // A graph hold on something the sentence never names (a serialized peer
    // being worked) stays (review-41, PR 324).
    const peer: ViewerDocument = {
      ...placed,
      order: {
        ...placed.order,
        slots: placed.order.slots.map((slot) =>
          slot.lead === 'i0002'
            ? { ...slot, holds: [...slot.holds, { family: 'graph' as const, reason: 'its serialized peer is being worked', subject: 'i0004' }] }
            : slot,
        ),
      },
    };
    assert.ok(inspectorMarkupFor(peer, 'i0002').includes('its serialized peer is being worked'), 'an unstated graph hold was dropped');
  });

  /**
   * THE CASE A ONE-FIELD PREDICATE GETS FLATLY WRONG. The heading read
   * `rank === null ? whyHeld : ...`, so a slot with no rank was told "why
   * held" — with no hold to show, because it has none. `@issuegraph/derive`
   * cannot emit `ready: true, rank: null`, but `ViewerDocument` is a public
   * port and a host composes one by hand, so it is reachable from outside this
   * repo. Held is read from `ready` now, and the heading says what is actually
   * missing: a number.
   */
  it('never says held for a slot that is READY but placed nowhere', () => {
    const document = withProvenance(backlogOf(3), 'i0002');
    const unplaced: ViewerDocument = {
      ...document,
      order: {
        ...document.order,
        // Ready, with no hold, and no position stated for it.
        slots: document.order.slots.map((slot) =>
          slot.lead === 'i0002' ? { ...slot, rank: null, ready: true, holds: [] } : slot,
        ),
      },
    };

    const markup = inspectorMarkupFor(unplaced, 'i0002');
    assert.match(markup, /data-held="false"/, 'a ready slot was drawn as held');
    assert.equal(
      /class="ig-why-rank-heading">why held</.test(markup),
      false,
      'a ready slot was told it is held, with no hold to show for it',
    );
    assert.match(markup, /class="ig-why-rank-heading">why rank</);
    assert.equal(sentenceOf(markup), 'Matched ordering query 1, label:P0.', 'a slot placed nowhere was given a rank');
    assert.equal(
      /class="ig-inspector-holds"/.test(markup),
      false,
      'a hold list was drawn for a slot holding nothing',
    );
  });

  it('renders the hold’s own reason verbatim, with its cause on the markup', () => {
    const view = inspectorView(HELD_IN_A_UNIT, { kind: 'issue', key: 'i0002' });
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
    const sentence = sentenceOf(inspectorMarkupFor(HELD_IN_A_UNIT, 'i0002'));
    assert.ok(sentence.includes('Worked with i0003 as one unit'), 'the unit partner is not named');
    assert.equal(sentence.includes('i0002'), false, 'the subject was named as its own partner');
  });

  it('draws no unit clause for an ordinary slot', () => {
    const markup = inspectorMarkupFor(backlogOf(3), 'i0002');
    assert.equal(sentenceOf(markup).includes('as one unit'), false);
  });

  it('#308 ends on the open issues it waits on, counted past one', () => {
    const blocked = withProvenance(
      backlogOf(4, { edges: [['blocked-by', 'i0004', 'i0001'], ['blocked-by', 'i0004', 'i0002']] }),
      'i0004',
    );
    assert.equal(
      sentenceOf(inspectorMarkupFor(blocked, 'i0004')),
      '4 of 4. Matched ordering query 1, label:P0. After the 2 issues that block it close.',
    );
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
    const view = inspectorView(excluded, { kind: 'issue', key: 'i0003' });
    assert.equal(view.subject.kind, 'issue');
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.whyRank, null);
    assert.equal(/class="ig-why-rank"/.test(inspectorMarkupFor(excluded, 'i0003')), false);
  });
});
