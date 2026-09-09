import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { renderWorkspace } from './render.ts';
import type { WorkspaceWords } from './render.ts';
import { BULK_WORDS } from '../testing/bulk.ts';
import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';

/**
 * §17e's multi-select block, and what a SET does to the three zones.
 *
 * The one thing every test here is really asking: do the rail, the canvas and
 * the inspector agree about which issues are selected? `selection.ts`'s header
 * names two zones disagreeing as the failure the union's shape exists to
 * prevent, and cardinality is the door this change opens onto it.
 */

const WORDS: WorkspaceWords = {
  ...WORKSPACE_WORDS,
  bulk: BULK_WORDS,
  selectionMember: (position, total) => `marked ${String(position)} of ${String(total)}`,
  selectionAnchor: (total) => `heads ${String(total)} marked`,
};

/** The fixture the golden was captured from. Keep both in step. */
const GOLDEN_DOCUMENT = backlogOf(12, {
  edges: [
    ['blocked-by', 'i0003', 'i0005'],
    ['serialize-with', 'i0004', 'i0006'],
  ],
  unitOf: { i0008: 'i0007' },
});

function marked(markup: string): string[] {
  return [...markup.matchAll(/data-ig-key="([^"]+)"[^>]*data-ig-selected="true"/g)].map(
    (match) => match[1] ?? '',
  );
}

/**
 * One zone's markup.
 *
 * SCOPED, BECAUSE `aria-current` IS PER-CONTAINER. It names THE current item
 * *within a container*, and the rail and the canvas are two containers drawing
 * the same document — so both mark the anchor, correctly, and a count over the
 * whole surface would be counting across containers.
 */
function zoneOf(markup: string, name: string): string {
  const start = markup.indexOf(`data-zone="${name}"`);
  const next = markup.indexOf('<section class="ig-zone"', start + 1);
  return markup.slice(start, next === -1 ? undefined : next);
}

function railRows(markup: string): string[] {
  return [...markup.matchAll(/<li class="ig-slot" data-ig-key="([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('§17e: a singleton selection is exactly what it was', () => {
  it('renders byte-identical to a golden captured BEFORE the type widened', () => {
    // WITHOUT THE COMMITTED GOLDEN THIS COMPARES THE NEW CODE TO ITSELF. The
    // fixture beside this file was captured from `main@52589f1` — the commit
    // this branch was cut from, before `WorkspaceSelection` grew a key list —
    // so it is evidence rather than a restatement.
    const golden = readFileSync(
      new URL('../testing/fixtures/single-selection.html', import.meta.url),
      'utf8',
    );
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORKSPACE_WORDS,
      selection: { kind: 'issue', keys: ['i0003'] },
    });
    assert.equal(result.markup, golden);
  });

  it('marks no row at N=1, because aria-current already says everything', () => {
    // §17c'S RULE, APPLIED TO A THIRD DECORATION: an attribute stamped on every
    // row with one value meaning "nothing" is marking the row, not leaving it
    // alone. A single selection is fully described by layer 1's `aria-current`.
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0003'] },
    });
    assert.equal(result.markup.includes('data-ig-selected'), false);
    assert.deepEqual(result.view.bulkMembers, []);
  });
});

describe('§17e: the three zones agree about a set', () => {
  const selection = { kind: 'issue', keys: ['i0003', 'i0004', 'i0005'] } as const;

  it('marks every member, in both the rail and the canvas', () => {
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORDS,
      selection,
      // THE DIRECT TIER, so the canvas draws nodes rather than §17f's capsules.
      scale: { focus: 'i0003', query: '', isolatedOpen: false },
    });
    // Every member appears marked at least once, and nothing else does.
    assert.deepEqual([...new Set(marked(result.markup))].sort(), ['i0003', 'i0004', 'i0005']);
  });

  it('leaves ONE aria-current="true", on the anchor', () => {
    // `linear.ts` records that the rows are a plain `ol` of `li` rather than a
    // listbox — an interactive descendant inside `role="option"` is a pattern
    // violation real screen readers and axe both flag — so selection is
    // announced with `aria-current`, which names THE current item and would be
    // wrong on three rows at once.
    //
    // ASSERTED ON THE VALUE, not on the attribute's presence: layer 1 emits it
    // on every row as `'true' | 'false'`.
    const result = renderWorkspace(GOLDEN_DOCUMENT, { words: WORDS, selection });
    const current = [
      ...zoneOf(result.markup, 'rail').matchAll(/data-ig-key="([^"]+)"[^>]*aria-current="true"/g),
    ];
    assert.equal(current.length, 1);
    assert.equal(current[0]?.[1], 'i0003');
  });

  it('says the membership in each row\'s NAME, or a screen reader never hears it', () => {
    // An accessible name computed from `aria-label` WINS over descendant text,
    // so the visual mark alone is seen and not heard. Same mechanism §17c's
    // delta chip already uses on these rows.
    const result = renderWorkspace(GOLDEN_DOCUMENT, { words: WORDS, selection });
    assert.match(result.markup, /aria-label="[^"]*heads 3 marked/);
    assert.match(result.markup, /aria-label="[^"]*marked 2 of 3/);
    assert.match(result.markup, /aria-label="[^"]*marked 3 of 3/);
  });

  it('draws the block in the inspector, in place of the one-issue panel', () => {
    // A set has no single subject, so the detail panel has nothing to be detail
    // ABOUT — it would draw the anchor's relationships under a heading saying
    // three issues are selected, which is the two-zones-disagree failure with
    // both halves inside one zone.
    const result = renderWorkspace(GOLDEN_DOCUMENT, { words: WORDS, selection });
    const inspector = zoneOf(result.markup, 'inspector');
    assert.match(inspector, /class="ig-bulk"/);
    assert.match(inspector, /3 tickets marked/);
    // THE ONE-ISSUE PANEL IS GONE FROM THIS ZONE, asserted on the panel's own
    // root rather than on a word — `relationships` is also the audit panel's,
    // and a word test would report the wrong thing when that panel is drawn.
    assert.equal(inspector.includes('class="ig-inspector"'), false);
    assert.equal(inspector.includes(WORKSPACE_WORDS.nothingSelected), false);
  });

  it('carries the gesture hint, which is the only place it is named', () => {
    const result = renderWorkspace(GOLDEN_DOCUMENT, { words: WORDS, selection });
    assert.match(result.markup, /hold shift while you point/);
  });

  it('draws no block for a host with no bulk words, rather than one in ours', () => {
    const result = renderWorkspace(GOLDEN_DOCUMENT, { words: WORKSPACE_WORDS, selection });
    assert.equal(result.markup.includes('ig-bulk'), false);
    // THE SELECTION STILL HAPPENED. Only the surface is withheld, so a host
    // that supplies no vocabulary is not also denied the state.
    assert.deepEqual(result.view.selection, selection);
  });

  it('marks nothing when the host supplied no member clauses', () => {
    // A mark a reader can see and a screen reader cannot is the defect the
    // name clause exists to prevent, so the two ship together or not at all.
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: { ...WORKSPACE_WORDS, bulk: BULK_WORDS },
      selection,
    });
    assert.equal(result.markup.includes('data-ig-selected'), false);
  });
});

describe('§17e: exactly one tab stop, at any cardinality', () => {
  it('keeps one tabindex="0" whether one issue is selected or six', () => {
    // The tab stop is drawn from `focused`, which stays single-valued: §17e's
    // `⇧↓` moves focus by one and extends the set behind it. Cardinality never
    // multiplies the stop.
    const document = backlogOf(20);
    for (const keys of [['i0002'], ['i0002', 'i0003', 'i0004', 'i0005', 'i0006', 'i0007']]) {
      const [head, ...rest] = keys;
      if (head === undefined) continue;
      const result = renderWorkspace(document, {
        words: WORDS,
        selection: { kind: 'issue', keys: [head, ...rest] },
      });
      assert.equal([...result.markup.matchAll(/tabindex="0"/g)].length, 1);
    }
  });
});

describe('§17e: three counts, and the block says which it means', () => {
  it('canonicalizes a together-unit\'s partners to ONE batch member', () => {
    // The rail draws one row per slot, so this case arrives from the canvas or
    // the inspector. `i0008` is folded into the slot led by `i0007`, so a
    // selection naming both is one issue to a batch — and an edge between them
    // would be a self-edge on the unit.
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0007', 'i0008', 'i0003'] },
    });
    assert.deepEqual([...result.view.bulkMembers].sort(), ['i0003', 'i0007']);
    // THE HEADER STATES THE EFFECTIVE COUNT, because the offers act on the
    // canonicalized set: two, not the three rows the reader clicked.
    assert.match(result.markup, /2 tickets marked/);
  });

  it('states the writes separately from the issues, so neither number lies', () => {
    // §17e's frame reads "6 issues = 6 writes", exact for the directed offer.
    // A symmetric star centres on a member, so six issues are five writes —
    // and five alone under a header saying six reads as though an issue was
    // dropped, which is a reason to cancel a correct batch.
    const document = backlogOf(20);
    const result = renderWorkspace(document, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0002', 'i0003', 'i0004', 'i0005', 'i0006', 'i0007'] },
      bulk: {
        kind: 'planned',
        offer: { kind: 'serialize-with', anchorFrom: 'selection-anchor' },
        plan: {
          proposals: [
            { op: 'create', kind: 'serialize-with', from: 'i0003', to: 'i0002' },
            { op: 'create', kind: 'serialize-with', from: 'i0004', to: 'i0002' },
            { op: 'create', kind: 'serialize-with', from: 'i0005', to: 'i0002' },
            { op: 'create', kind: 'serialize-with', from: 'i0006', to: 'i0002' },
            { op: 'create', kind: 'serialize-with', from: 'i0007', to: 'i0002' },
          ],
          count: 5,
          kind: 'serialize-with',
          anchor: 'i0002',
        },
      },
    });
    assert.match(result.markup, /apply to 6 tickets by editing 5 bodies around i0002/);
  });
});

describe('§17e: the phases each draw', () => {
  const document = backlogOf(20);
  const selection = { kind: 'issue', keys: ['i0002', 'i0003', 'i0004'] } as const;

  function render(bulk: Parameters<typeof renderWorkspace>[1]['bulk']): string {
    return renderWorkspace(document, { words: WORDS, selection, bulk }).markup;
  }

  it('offers all three at idle, each with its action and its consequence', () => {
    const markup = render({ kind: 'idle' });
    assert.match(markup, /queue all 3 in turn/);
    assert.match(markup, /ship all 3 at once/);
    assert.match(markup, /hold all 3 behind one/);
    assert.match(markup, /a single queue/);
    assert.match(markup, /name the one/);
    // AND NOT THE TWO §17e REFUSES TO PUT HERE.
    assert.equal(markup.includes('fold all 3 away'), false);
    assert.equal(markup.includes('descend all 3'), false);
  });

  it('draws the target search only for the directed offer', () => {
    assert.match(
      render({ kind: 'offering', offer: { kind: 'blocked-by', anchorFrom: 'picked', direction: 'to-anchor' }, target: null }),
      /which ticket holds them/,
    );
    assert.equal(
      render({ kind: 'offering', offer: { kind: 'together-with', anchorFrom: 'selection-anchor' }, target: null })
        .includes('which ticket holds them'),
      false,
    );
  });

  it('withholds the confirm until a directed offer can be planned', () => {
    // A control that cannot complete the action it advertises is a dead
    // affordance, which is the finding the scale ladder already paid for once.
    const waiting = render({
      kind: 'offering',
      offer: { kind: 'blocked-by', anchorFrom: 'picked', direction: 'to-anchor' },
      target: null,
    });
    assert.equal(waiting.includes('work out what that costs'), false);
    const ready = render({
      kind: 'offering',
      offer: { kind: 'blocked-by', anchorFrom: 'picked', direction: 'to-anchor' },
      target: 'i0009',
    });
    assert.match(ready, /work out what that costs/);
  });

  it('draws a refusal as an alert, never as an absence', () => {
    const markup = render({
      kind: 'refused',
      offer: { kind: 'serialize-with', anchorFrom: 'selection-anchor' },
      refusal: { reason: 'no-members' },
    });
    assert.match(markup, /role="alert"/);
    assert.match(markup, /data-reason="no-members"/);
    assert.match(markup, /there is nobody else to relate it to/);
  });

  it('lists what a resume still owes, so it can be inspected before it is sent', () => {
    const markup = render({
      kind: 'partial',
      remainder: {
        proposals: [{ op: 'create', kind: 'blocked-by', from: 'i0004', to: 'i0009' }],
        count: 1,
        kind: 'blocked-by',
        anchor: 'i0009',
      },
    });
    assert.match(markup, /1 bodies were left untouched/);
    assert.match(markup, /i0004 towards i0009/);
    // AND AN EXIT, because an unlandable proposal produces the identical
    // remainder on every retry.
    assert.match(markup, /stop trying those/);
  });

  it('says a whole batch landed, rather than returning silently to the offers', () => {
    const markup = render({ kind: 'landed', writes: 5 });
    assert.match(markup, /5 bodies were rewritten/);
    assert.equal(markup.includes('queue all 3 in turn'), false);
  });
});

describe('§17e: the canvas says what it could not mark', () => {
  it('reports members with no node above the direct tier', () => {
    // §17f draws cluster capsules above 60 nodes, and they carry no key — so
    // there is nothing to stamp. Rather than let the two zones silently
    // disagree about a set, the block states the number.
    const document = backlogOf(120);
    const result = renderWorkspace(document, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0002', 'i0003', 'i0004'] },
    });
    assert.equal(marked(result.markup).length > 0, true, 'the rail still marks its rows');
    assert.match(result.markup, /3 marked tickets are off the picture/);
  });
});

describe('§17e: an unaffected row is left completely alone', () => {
  it('renders a set exactly as no selection does, except on its members', () => {
    const document = backlogOf(12);
    const none = renderWorkspace(document, { words: WORDS }).markup;
    const set = renderWorkspace(document, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0002', 'i0003'] },
    }).markup;
    // Same rows, same order. Only the two members' own markup differs.
    assert.deepEqual(railRows(set), railRows(none));
  });
});

describe('§17e: the tab stop follows FOCUS, not the anchor', () => {
  it('puts tabindex="0" on the row the caller says is focused', () => {
    // Layer 1 falls back to the SELECTION when no caller supplies a focus,
    // which on a set is the anchor — so every `⇧↓` handed the stop back to the
    // row the reader had just walked away from. Threading `focused` is what
    // keeps the one stop on the row the reader is actually standing on.
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0002', 'i0003', 'i0004'] },
      focused: 'i0004',
    });
    const rail = zoneOf(result.markup, 'rail');
    const stops = [...rail.matchAll(/data-ig-key="([^"]+)"[^>]*tabindex="0"/g)].map((m) => m[1]);
    assert.deepEqual(stops, ['i0004']);
  });

  it('keeps layer 1\'s fallback for a caller that tracks no focus', () => {
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0002', 'i0003'] },
    });
    const rail = zoneOf(result.markup, 'rail');
    assert.equal([...rail.matchAll(/tabindex="0"/g)].length, 1);
  });
});

describe('§17e: the gesture is discoverable before it has been performed', () => {
  it('carries the hint on the ONE-issue panel too', () => {
    // The block only exists at N>1, so a hint that lived only inside it would
    // reach the reader strictly after they had already found the gesture.
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0003'] },
    });
    assert.match(zoneOf(result.markup, 'inspector'), /hold shift while you point/);
  });

  it('draws no hint for a host that words no bulk path', () => {
    // A hint for a surface that will never appear is an affordance that does
    // not exist.
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORKSPACE_WORDS,
      selection: { kind: 'issue', keys: ['i0003'] },
    });
    assert.equal(result.markup.includes('ig-bulk-gesture'), false);
  });
});

describe('§17e: the set keeps a way out', () => {
  it('draws the clear control in the block, on the panel\'s own command', () => {
    // Dropping it at N>1 would make deselecting six issues a two-step
    // workaround — click a member down to a singleton, click it again —
    // precisely where one action matters most.
    const result = renderWorkspace(GOLDEN_DOCUMENT, {
      words: WORDS,
      selection: { kind: 'issue', keys: ['i0003', 'i0004'] },
    });
    const inspector = zoneOf(result.markup, 'inspector');
    assert.match(inspector, /class="ig-bulk"/);
    assert.match(inspector, /data-ig-command="clear"/);
    assert.match(inspector, new RegExp(WORKSPACE_WORDS.clearSelection));
  });
});
