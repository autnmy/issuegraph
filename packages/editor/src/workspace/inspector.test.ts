import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS, edgeIdentity, isSymmetricEdgeField } from '@issuegraph/core';

import { INSPECTOR_GROUP_SHOWN, inspectorGroups, inspectorView } from './inspector.ts';
import { INITIAL_SELECTION } from './selection.ts';
import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';
import { renderWorkspace } from './render.ts';

const DOCUMENT = backlogOf(6, {
  held: ['i0005'],
  edges: [
    ['blocked-by', 'i0001', 'i0002'],
    ['blocked-by', 'i0003', 'i0001'],
    ['duplicate-of', 'i0004', 'i0006'],
  ],
});

describe('the inspector is a projection of the one selection', () => {
  it('shows nothing when nothing is selected', () => {
    const view = inspectorView(DOCUMENT, INITIAL_SELECTION);
    assert.deepEqual(view.subject, { kind: 'none' });
    assert.deepEqual(view.relationships, []);
    assert.equal(view.filtered, false);
  });

  it('shows an issue with its position, and only the edges that touch it', () => {
    const view = inspectorView(DOCUMENT, { kind: 'issue', key: 'i0001' });
    assert.equal(view.subject.kind, 'issue');
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.issue.key, 'i0001');
    assert.deepEqual(view.subject.position, { rank: 1, ready: true, holds: [] });

    // Both directions, and nothing else: `duplicate-of i0004 -> i0006` names
    // neither end of this subject.
    assert.deepEqual(
      view.relationships.map((one) => [one.field, one.direction]),
      [
        ['blocked-by', 'outgoing'],
        ['blocked-by', 'incoming'],
      ],
    );
    assert.equal(view.filtered, false);
  });

  it('carries a held slot\'s rank as null rather than a number', () => {
    const view = inspectorView(DOCUMENT, { kind: 'issue', key: 'i0005' });
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.position?.rank, null);
    assert.equal(view.subject.position?.ready, false);
    assert.equal(view.subject.position?.holds.length, 1);
  });
});

describe('an edge selection FILTERS the list rather than opening another panel', () => {
  const edgeId = edgeIdentity('blocked-by', 'i0001', 'i0002');

  it('narrows to the one edge, from the same one value', () => {
    const view = inspectorView(DOCUMENT, { kind: 'edge', edgeId });
    assert.equal(view.subject.kind, 'edge');
    assert.equal(view.relationships.length, 1);
    assert.equal(view.relationships[0]?.edgeId, edgeId);
    assert.equal(view.filtered, true);
  });

  it('states no direction for an edge selection, because there is no subject to be relative to', () => {
    const view = inspectorView(DOCUMENT, { kind: 'edge', edgeId });
    assert.equal(view.relationships[0]?.direction, null);
  });

  it('names edges by the identity core derives, for every field the format has', () => {
    // The identity is the one the picker, the overlays and the store already
    // use. A second spelling out here is how a host comes to hold two ids for
    // one edge — which is why this drives EVERY field rather than one.
    //
    // `together-with` GETS ITS OWN FIXTURE, and that is the normalization this
    // view now shares with the zones rather than a special case: layer 1 draws
    // that edge as an enclosure around ONE slot's members, so an edge whose
    // endpoints sit in separate slots has nothing to draw it and is dropped.
    // A fixture that ignored this passed only while the inspector was reading
    // raw edges — that is, only while it was listing relationships no other
    // zone had drawn.
    for (const field of EDGE_FIELDS) {
      const document =
        field === 'together-with'
          ? backlogOf(2, { unitOf: { i0002: 'i0001' }, edges: [[field, 'i0001', 'i0002']] })
          : backlogOf(2, { edges: [[field, 'i0001', 'i0002']] });
      const view = inspectorView(document, { kind: 'issue', key: 'i0001' });
      assert.equal(view.relationships[0]?.edgeId, edgeIdentity(field, 'i0001', 'i0002'), field);
    }
  });

  it('states no direction for a SYMMETRIC field, and still lists it', () => {
    // Both halves, because fixing the first broke the second and the suite
    // caught it: the issue branch used to filter on `direction !== null`, so
    // the moment a symmetric field correctly reported none, the relationship
    // vanished from the panel altogether. "Touches my subject" and "which end
    // is my subject on" are different questions.
    //
    // The rule is the FORMAT's, not a rendering choice — `edgeIdentity`
    // normalizes symmetric endpoints for the same reason — and `picker/view.ts`
    // already refuses a direction for these two kinds.
    //
    // DRIVEN FROM BOTH ENDS, which is what makes the symmetric half mean
    // anything. Read from `i0001` — the `from` — a rule that answered
    // `null` only when the subject is the `from` is indistinguishable from the
    // correct one, and that is the whole shape of the defect: a direction read
    // off the stored order for a kind that has none. `i0002` is the end where
    // the two answers differ.
    for (const field of EDGE_FIELDS) {
      const document =
        field === 'together-with'
          ? backlogOf(2, { unitOf: { i0002: 'i0001' }, edges: [[field, 'i0001', 'i0002']] })
          : backlogOf(2, { edges: [[field, 'i0001', 'i0002']] });
      for (const [key, directed] of [
        ['i0001', 'outgoing'],
        ['i0002', 'incoming'],
      ] as const) {
        const view = inspectorView(document, { kind: 'issue', key });
        assert.equal(view.relationships.length, 1, `${field} was dropped from ${key}'s list`);
        assert.equal(
          view.relationships[0]?.direction,
          isSymmetricEdgeField(field) ? null : directed,
          `${field} at ${key}`,
        );
      }
    }
  });

  it('lists nothing layer 1 dropped, so the zones cannot disagree about what exists', () => {
    // A dangling edge, a self-edge and a duplicate placement all survive in a
    // raw ViewerDocument and are dropped by every zone that draws one. Listing
    // them published a live `select-edge` command for an edge that exists on no
    // other surface.
    const document = {
      ...backlogOf(2),
      edges: [
        { field: 'blocked-by' as const, from: 'i0001', to: 'ghost' },
        { field: 'blocked-by' as const, from: 'i0001', to: 'i0001' },
        { field: 'blocked-by' as const, from: 'i0001', to: 'i0002' },
      ],
    };
    const view = inspectorView(document, { kind: 'issue', key: 'i0001' });
    assert.deepEqual(
      view.relationships.map((one) => [one.from, one.to]),
      [['i0001', 'i0002']],
    );
  });
});

describe('a selection naming a unit MEMBER resolves to the row that speaks for it', () => {
  // A together unit is ONE row and layer 1 has already decided which member
  // speaks for it: `ViewerSlot.lead` is documented as "the detail surface's
  // subject", and both projections run their options through `atStations`
  // before drawing. Reading the raw key here made the rail and the canvas mark
  // the lead current while this panel showed the partner.
  const unit = backlogOf(4, {
    unitOf: { i0002: 'i0001' },
    edges: [['blocked-by', 'i0001', 'i0003']],
  });

  it('inspects the lead when the partner is selected', () => {
    const partner = inspectorView(unit, { kind: 'issue', key: 'i0002' });
    const lead = inspectorView(unit, { kind: 'issue', key: 'i0001' });
    if (partner.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(partner.subject.issue.key, 'i0001');
    assert.deepEqual(partner, lead, 'the two selections disagree about the unit');
  });

  it('lists the LEAD\'s relationships, not the partner\'s', () => {
    const partner = inspectorView(unit, { kind: 'issue', key: 'i0002' });
    assert.deepEqual(
      partner.relationships.map((one) => [one.from, one.to]),
      [['i0001', 'i0003']],
    );
  });

  it('leaves an issue the order does not place as its own subject', () => {
    // No slot means no lead to defer to. An excluded or unplaced issue speaks
    // for itself.
    const loose = { ...unit, order: { slots: [], excluded: [] } };
    const view = inspectorView(loose, { kind: 'issue', key: 'i0002' });
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.issue.key, 'i0002');
  });
});

describe('an unresolvable selection renders as nothing, never as last render\'s answer', () => {
  it('empties for an issue the document no longer carries', () => {
    // A write lands and the order recomputes; a selection naming a row that has
    // gone is ordinary, not an error a reader can act on. Holding a resolved
    // issue ON the selection is what would make this render stale detail.
    assert.deepEqual(inspectorView(DOCUMENT, { kind: 'issue', key: 'gone' }).subject, {
      kind: 'none',
    });
  });

  it('empties for an edge the document no longer carries', () => {
    assert.deepEqual(
      inspectorView(DOCUMENT, { kind: 'edge', edgeId: 'blocked-by|nope|nope2' }).subject,
      { kind: 'none' },
    );
    assert.equal(inspectorView(DOCUMENT, { kind: 'edge', edgeId: 'x' }).filtered, false);
  });

  it('gives no position to an issue the order does not place', () => {
    // An excluded issue genuinely has no position. `rank: null, ready: false`
    // would read as a HOLD, which is a different fact with a different remedy.
    const document = {
      ...DOCUMENT,
      order: { slots: [], excluded: [] },
      cycles: [],
    };
    const view = inspectorView(document, { kind: 'issue', key: 'i0001' });
    if (view.subject.kind !== 'issue') throw new Error('expected an issue subject');
    assert.equal(view.subject.position, null);
  });
});

describe('the inspector with a set of issues selected', () => {
  it('lists exactly the selected issues in the order they were added, with no relationships', () => {
    for (const keys of [['i0003', 'i0001'], ['i0005', 'i0002', 'i0004']]) {
      const view = inspectorView(DOCUMENT, { kind: 'issues', keys });
      assert.equal(view.subject.kind, 'issues');
      if (view.subject.kind !== 'issues') continue;
      assert.deepEqual(view.subject.issues.map((issue) => issue.key), keys);
      assert.deepEqual(view.relationships, []);
      assert.equal(view.filtered, false);
    }
  });

  it('lists only the members the document carries, and is one issue when one is left', () => {
    const one = inspectorView(DOCUMENT, { kind: 'issues', keys: ['i0002', 'gone'] });
    assert.equal(one.subject.kind, 'issue');
    assert.deepEqual(inspectorView(DOCUMENT, { kind: 'issues', keys: ['gone', 'also-gone'] }).subject, { kind: 'none' });
  });
});

describe('the inspector drawing a set', () => {
  /** The inspector's set region, as markup. */
  function setRegion(markup: string): string {
    const start = markup.indexOf('<div class="ig-inspector-issues">');
    assert.ok(start !== -1, 'no set region was drawn');
    const end = markup.indexOf('</ul></div>', start);
    return markup.slice(start, end + '</ul></div>'.length);
  }

  it('says how many for 2 and 3, lists exactly the selected issues, and holds no control', () => {
    for (const keys of [['i0004', 'i0001'], ['i0002', 'i0006', 'i0003']]) {
      const { markup } = renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, selection: { kind: 'issues', keys } });
      const region = setRegion(markup);
      assert.ok(region.includes(`${String(keys.length)} issues selected`), region);
      const listed = [...region.matchAll(/<span class="ig-id">([^<]*)<\/span>/g)].map((match) => match[1]);
      assert.deepEqual(listed, keys);
      assert.doesNotMatch(region, /<button|<a |data-ig-command|data-ig-key|tabindex/);
      // No `+ add` and no relationship list for a set, anywhere in the panel.
      assert.doesNotMatch(markup, /data-ig-command="add"/);
      assert.doesNotMatch(markup, /class="ig-inspector-relationships"/);
    }
  });

  it('draws a title holding markup characters as text', () => {
    const hostile = {
      ...DOCUMENT,
      issues: DOCUMENT.issues.map((issue) =>
        issue.key === 'i0002' ? { ...issue, title: '<b>"Tom" & <i>Jerry</i></b>' } : issue,
      ),
    };
    const { markup } = renderWorkspace(hostile, { words: WORKSPACE_WORDS, selection: { kind: 'issues', keys: ['i0002', 'i0003'] } });
    const region = setRegion(markup);
    // Quotes are safe in a text node, so only the markup characters are escaped.
    assert.ok(region.includes('&lt;b&gt;"Tom" &amp; &lt;i&gt;Jerry&lt;/i&gt;&lt;/b&gt;'), region);
    assert.doesNotMatch(region, /<b>|<i>/);
  });
});

describe('the Inspector groups the selection\u2019s relationships by kind (#303)', () => {
  // RULES, Graphs, Dense neighbourhoods: "The Inspector groups the selection's
  // relationships by kind, each with its count, five each before the rest fold
  // under 'Show 4 more'."
  const hub = backlogOf(14, {
    edges: [
      ...['i0002', 'i0003', 'i0004', 'i0005', 'i0006', 'i0007', 'i0008'].map(
        (to) => ['blocked-by', 'i0001', to] as const,
      ),
      ['blocked-by', 'i0009', 'i0001'],
      ['blocked-by', 'i0010', 'i0001'],
      ['serialize-with', 'i0001', 'i0011'],
      ['duplicate-of', 'i0012', 'i0001'],
    ],
  });
  const groups = inspectorGroups(inspectorView(hub, { kind: 'issue', key: 'i0001' }).relationships);

  it('heads a field read from each end apart, in the legend\u2019s order, outgoing first', () => {
    assert.deepEqual(
      groups.map((group) => [group.key, group.relationships.length]),
      [
        ['blocked-by:outgoing', 7],
        ['blocked-by:incoming', 2],
        ['serialize-with:none', 1],
        ['duplicate-of:incoming', 1],
      ],
    );
  });

  it('keeps every relationship once: the groups hold exactly what the Inspector lists', () => {
    assert.equal(groups.reduce((total, group) => total + group.relationships.length, 0), 11);
    assert.equal(INSPECTOR_GROUP_SHOWN, 5);
  });
});
