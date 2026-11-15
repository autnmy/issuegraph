/**
 * What the canvas draws around a selection, and the legend's switch (#303,
 * RULES, Graphs, Dense neighbourhoods), on the board's own numbers: #2290
 * selected among 41 issues, with 17 relationships — blocked-by 12 (9 block it,
 * it blocks 3), serialize-with 4, decomposed-from 1.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EdgeField } from '@issuegraph/core';
import { DENSE_RELATIONSHIPS, LEGEND_ORDER } from '@issuegraph/viewer';
import { JSDOM } from 'jsdom';

import { WORKSPACE_WORDS, backlogOf, keysOf } from '../testing/workspace.ts';
import { SWITCHABLE_KINDS, canvasNeighbourhood, drawnKinds } from './neighbourhood.ts';
import { renderWorkspace } from './render.ts';

const KEYS = keysOf(41);
const SELECTED = 'i0001';
const key = (index: number): string => KEYS[index] ?? assert.fail(`no key ${String(index)}`);

/** `count` keys from `from`, as edges of one kind built by `edge`. */
function edges(
  from: number,
  count: number,
  edge: (other: string) => readonly [EdgeField, string, string],
): (readonly [EdgeField, string, string])[] {
  return Array.from({ length: count }, (_, offset) => edge(key(from + offset)));
}

const BOARD = backlogOf(41, {
  edges: [
    ...edges(1, 9, (other) => ['blocked-by', SELECTED, other]),
    ...edges(10, 3, (other) => ['blocked-by', other, SELECTED]),
    // The format lets an issue declare one serialize-with, so the four declare it.
    ...edges(13, 4, (other) => ['serialize-with', other, SELECTED]),
    ...edges(17, 1, (other) => ['decomposed-from', SELECTED, other]),
    // A line between two neighbours, which waits until one of them is selected.
    ['blocked-by', key(1), key(2)],
  ],
});

const SPARSE = backlogOf(8, {
  edges: [
    ['blocked-by', SELECTED, 'i0002'],
    ['serialize-with', SELECTED, 'i0003'],
    ['duplicate-of', 'i0004', SELECTED],
    ['decomposed-from', SELECTED, 'i0005'],
  ],
});

const ISSUE = { kind: 'issue', key: SELECTED } as const;

function canvasOf(markup: string): string {
  const at = markup.indexOf('data-zone="canvas"');
  return markup.slice(at, markup.indexOf('data-zone="inspector"'));
}

/**
 * The kind of each relationship the canvas draws, once per relationship:
 * legend samples excluded, and a double-stroked kind counted once.
 */
function drawnLines(canvas: string): readonly string[] {
  const start = canvas.indexOf('<svg class="ig-canvas"');
  const svg = canvas.slice(start, canvas.indexOf('</svg>', start));
  const byGroup = new Map<string, string>();
  for (const [tag] of svg.matchAll(/<path class="ig-edge"[^>]*>/g)) {
    const group = /data-ig-group="([^"]+)"/.exec(tag)?.[1];
    const field = /data-edge="([^"]+)"/.exec(tag)?.[1];
    if (group !== undefined && field !== undefined) byGroup.set(group, field);
  }
  return [...byGroup.values()];
}

function captionCounts(canvas: string): readonly string[] {
  const caption = /<p class="ig-canvas-caption">([\s\S]*?)<\/p>/.exec(canvas)?.[1] ?? '';
  return [...caption.matchAll(/<span class="ig-canvas-count">(\d+)<\/span>/g)].map((match) => match[1] ?? '');
}

/** One field per relationship: `count` of each kind, as `drawnKinds` reads a selection. */
function held(counts: Partial<Record<EdgeField, number>>): readonly EdgeField[] {
  return LEGEND_ORDER.flatMap((field) => Array.from({ length: counts[field] ?? 0 }, () => field));
}

describe('a unit draws whole (#308)', () => {
  // i0002 goes together with i0001 (one slot, i0001 the lead) and is blocked
  // by i0004; i0001 is blocked by i0003.
  const unitDocument = backlogOf(5, {
    unitOf: { i0002: 'i0001' },
    edges: [['blocked-by', 'i0002', 'i0004'], ['blocked-by', 'i0001', 'i0003']],
  });
  const drawnAround = (key: string): readonly string[] =>
    (canvasNeighbourhood(unitDocument, { kind: 'issue', key }, []).around?.edges ?? []).map(
      (edge) => `${edge.field} ${edge.from} ${edge.to}`,
    );

  it('draws every member\u2019s lines when the unit, its lead, is selected', () => {
    const drawn = drawnAround('i0001');
    assert.ok(drawn.includes('blocked-by i0002 i0004'), `the partner's line went undrawn (${drawn.join(', ')})`);
    assert.ok(drawn.includes('blocked-by i0001 i0003'), "the lead's line went undrawn");
  });

  it('draws one member\u2019s own lines when that member is selected, as the viewer recedes them (review-41, PR 326)', () => {
    const drawn = drawnAround('i0002');
    assert.ok(drawn.includes('blocked-by i0002 i0004'), "the member's line went undrawn");
    assert.equal(drawn.includes('blocked-by i0001 i0003'), false, "a line only the lead has was counted for a member");
  });

  it('agrees with the canvas the viewer draws, for the lead and for a member', () => {
    const canvasOf = (key: string): string =>
      renderWorkspace(unitDocument, { words: WORKSPACE_WORDS, selection: { kind: 'issue', key } }).markup;
    const lineOf = (from: string, to: string): RegExp => new RegExp(`<path class="ig-edge"[^>]*data-ig-group="blocked-by\\|${from}\\|${to}"`);
    assert.match(canvasOf('i0001'), lineOf('i0002', 'i0004'), "the unit's partner line was not drawn");
    assert.match(canvasOf('i0001'), lineOf('i0001', 'i0003'));
    assert.match(canvasOf('i0002'), lineOf('i0002', 'i0004'));
    assert.doesNotMatch(canvasOf('i0002'), lineOf('i0001', 'i0003'), 'a member drew a line only the lead has');
  });
});

describe('which kinds draw', () => {
  it('draws blocked-by first past 8 relationships, and every kind, decomposed-from too, at 8 or fewer', () => {
    assert.equal(DENSE_RELATIONSHIPS, 8);
    assert.deepEqual([...drawnKinds(held({ 'blocked-by': 5, 'serialize-with': 4 }), [])], ['blocked-by', 'together-with']);
    assert.deepEqual([...drawnKinds(held({ 'blocked-by': 4, 'serialize-with': 4 }), [])], [...LEGEND_ORDER]);
  });

  it('switches was decomposed from, off at first, as the last kind in the legend’s order (Design q351)', () => {
    // "The graph opens on the first kind that switches, in the legend's order: blocked-by,
    // serializes-with, is a duplicate of, was decomposed from."
    assert.deepEqual(SWITCHABLE_KINDS, ['blocked-by', 'serialize-with', 'duplicate-of', 'decomposed-from']);
    const board = held({ 'together-with': 3, 'duplicate-of': 7, 'decomposed-from': 1 });
    assert.deepEqual([...drawnKinds(board, [])], ['together-with', 'duplicate-of']);
    assert.deepEqual([...drawnKinds(board, ['decomposed-from'])], ['together-with', 'duplicate-of', 'decomposed-from']);
  });

  it('draws every kind with fewer than two kinds that switch: there is nothing to choose (Design q351)', () => {
    // "That covers together-with alone, together-with with duplicate-of only, or any single kind."
    for (const counts of [{ 'together-with': 9 }, { 'together-with': 3, 'duplicate-of': 7 }, { 'duplicate-of': 9 }, { 'decomposed-from': 9 }]) {
      assert.deepEqual([...drawnKinds(held(counts), [])], [...LEGEND_ORDER], JSON.stringify(counts));
      // A press has nothing to flip where no switch is drawn.
      assert.deepEqual([...drawnKinds(held(counts), ['duplicate-of'])], [...LEGEND_ORDER], JSON.stringify(counts));
    }
  });

  it('opens on the first kind the selection has in the legend’s order when it has no blocked-by, never on none', () => {
    // RULES, Graphs, Dense neighbourhoods: "or when the selection has none, the first kind it
    // has in the legend's order, so the graph never opens on '0 of 17 drawn'".
    assert.deepEqual([...drawnKinds(held({ 'serialize-with': 3, 'duplicate-of': 6 }), [])], ['serialize-with', 'together-with']);
    assert.deepEqual([...drawnKinds(held({ 'duplicate-of': 6, 'decomposed-from': 3 }), [])], ['together-with', 'duplicate-of']);
    // A kind it lacks is never where it opens, even one before it in the legend.
    assert.equal(drawnKinds(held({ 'duplicate-of': 6, 'decomposed-from': 3 }), []).has('serialize-with'), false);
  });

  it('flips a kind the reader switched, from where this selection started, and only past 8, where a switch is drawn', () => {
    const board = held({ 'blocked-by': 12, 'serialize-with': 4, 'decomposed-from': 1 });
    assert.deepEqual([...drawnKinds(board, ['serialize-with'])], ['blocked-by', 'serialize-with', 'together-with']);
    assert.deepEqual([...drawnKinds(board, ['blocked-by'])], ['together-with']);
    const noBlocks = held({ 'serialize-with': 3, 'duplicate-of': 6 });
    assert.deepEqual([...drawnKinds(noBlocks, ['serialize-with', 'duplicate-of'])], ['together-with', 'duplicate-of']);
    assert.deepEqual([...drawnKinds(held({ 'blocked-by': 8 }), ['serialize-with'])], [...LEGEND_ORDER]);
  });

  it('never switches together-with off: the unit’s region always draws', () => {
    const many = held({ 'together-with': 3, 'duplicate-of': 9 });
    assert.equal(drawnKinds(many, ['together-with']).has('together-with'), true);
    assert.equal(SWITCHABLE_KINDS.includes('together-with'), false);
  });
});

describe('the canvas around a selection', () => {
  it('counts each kind the selection holds, in the legend order, and what draws of them', () => {
    const { around, kinds } = canvasNeighbourhood(BOARD, ISSUE, []);
    assert.deepEqual(kinds, {
      switches: true,
      kinds: [
        { field: 'blocked-by', count: 12, on: true, switchable: true },
        { field: 'serialize-with', count: 4, on: false, switchable: true },
        { field: 'decomposed-from', count: 1, on: false, switchable: true },
      ],
      drawn: 12,
      total: 17,
    });
    assert.deepEqual(around?.centre, [SELECTED]);
    assert.equal(around?.edges.length, 12);
    // WHAT DECIDES WHETHER THE GRAPH DRAWS is every relationship it could draw, decomposed-from too.
    assert.equal(around?.reach.length, 17);
  });

  it('draws nothing around nothing selected, and a selected relationship whatever its kind', () => {
    assert.deepEqual(canvasNeighbourhood(BOARD, { kind: 'none' }, []), { around: null, kinds: null });
    const edgeId = `decomposed-from|${SELECTED}|${key(17)}`;
    const { around, kinds } = canvasNeighbourhood(BOARD, { kind: 'edge', edgeId }, []);
    const edge = { field: 'decomposed-from', from: SELECTED, to: key(17) };
    assert.deepEqual(around, { centre: [SELECTED, key(17)], edges: [edge], reach: [edge] });
    assert.equal(kinds, null);
  });

  it('past 8: the selection and its blocked-by neighbours, the legend a switch with counts, ending in the drawn figure', () => {
    const canvas = canvasOf(renderWorkspace(BOARD, { words: WORKSPACE_WORDS, selection: ISSUE }).markup);
    // "With only blocked-by switched on the header says 'Selected: #2290 · 13 of 41 shown'".
    assert.deepEqual(captionCounts(canvas), ['13', '41']);
    assert.deepEqual(new Set(drawnLines(canvas)), new Set(['blocked-by']));
    assert.equal(drawnLines(canvas).length, 12, 'a line between two neighbours was drawn');
    const legend = canvas.slice(canvas.indexOf('<div class="ig-legend" data-switch="true"'));
    assert.match(legend, new RegExp(`^<div class="ig-legend" data-switch="true" role="group" aria-label="${WORKSPACE_WORDS.relationshipsToDraw}">`));
    const parsed = new JSDOM(`<!doctype html><body>${canvas}</body>`).window.document;
    const switches = [...parsed.querySelectorAll('.ig-legend[data-switch="true"] .ig-legend-switch')].map((item) => [
      item.getAttribute('data-ig-value') ?? 'none',
      item.getAttribute('aria-pressed') ?? 'no control',
      item.textContent,
    ]);
    // "the legend becomes a switch for each kind with its count ('is blocked by 12'), ending '12 of 17 drawn'".
    assert.deepEqual(switches, [
      ['blocked-by', 'true', 'is blocked by 12'],
      ['serialize-with', 'false', 'serializes with 4'],
      ['decomposed-from', 'false', 'was decomposed from 1'],
    ]);
    assert.match(legend, new RegExp(`<span class="ig-legend-drawn">${WORKSPACE_WORDS.relationshipsDrawn(12, 17)}</span></div>`));
  });

  it('past 8 with serialize-with switched on: its lines and its four neighbours join', () => {
    const canvas = canvasOf(
      renderWorkspace(BOARD, { words: WORKSPACE_WORDS, selection: ISSUE, switchedKinds: ['serialize-with'] }).markup,
    );
    // "with serialize-with switched on too, '17 of 41 shown'".
    assert.deepEqual(captionCounts(canvas), ['17', '41']);
    assert.equal(drawnLines(canvas).filter((field) => field === 'serialize-with').length, 4);
    assert.ok(canvas.includes(WORKSPACE_WORDS.relationshipsDrawn(16, 17)));
    assert.match(canvas, /aria-pressed="true" data-ig-command="legend-kind" data-ig-value="serialize-with"/);
  });

  it('at 8 or fewer: every kind draws, decomposed-from too, under the static key', () => {
    const canvas = canvasOf(renderWorkspace(SPARSE, { words: WORKSPACE_WORDS, selection: ISSUE }).markup);
    assert.deepEqual(new Set(drawnLines(canvas)), new Set(['blocked-by', 'serialize-with', 'duplicate-of', 'decomposed-from']));
    assert.match(canvas, /<fieldset class="ig-legend" aria-label="Relationships">/);
    assert.equal(canvas.includes('data-switch="true"'), false, 'a switch under 9 relationships');
    assert.equal(canvas.includes('ig-legend-count'), false, 'the static key counted its kinds');
    assert.deepEqual(captionCounts(canvas), ['5', '8']);
  });

  it('past 8 with was decomposed from switched on: its line and the parent join', () => {
    const canvas = canvasOf(
      renderWorkspace(BOARD, { words: WORKSPACE_WORDS, selection: ISSUE, switchedKinds: ['decomposed-from'] }).markup,
    );
    assert.deepEqual(captionCounts(canvas), ['14', '41']);
    assert.equal(drawnLines(canvas).filter((field) => field === 'decomposed-from').length, 1);
    assert.ok(canvas.includes(`data-ig-key="${key(17)}"`), 'the parent was not drawn');
    assert.ok(canvas.includes(WORKSPACE_WORDS.relationshipsDrawn(13, 17)));
    assert.match(canvas, /aria-pressed="true" data-ig-command="legend-kind" data-ig-value="decomposed-from"/);
  });
});

/**
 * Past 8 with no blocked-by (#303 part 3, Design q342): #2290's neighbour i0001
 * serializes with 6 issues, goes together with 2 and has 3 duplicates, 11 in all.
 */
const NO_BLOCKS = backlogOf(41, {
  edges: [
    ...edges(1, 6, (other) => ['serialize-with', other, SELECTED]),
    // One together-with per declaring issue, as for serialize-with, so the second partner declares it.
    ['together-with', SELECTED, key(7)],
    ['together-with', key(8), SELECTED],
    ...edges(9, 3, (other) => ['duplicate-of', other, SELECTED]),
  ],
  unitOf: { [key(7)]: SELECTED, [key(8)]: SELECTED },
});

describe('past 8 with no blocked-by', () => {
  it('opens on serialize-with, never "0 of 11 drawn", and counts together-with as drawn', () => {
    const { kinds } = canvasNeighbourhood(NO_BLOCKS, ISSUE, []);
    assert.deepEqual(kinds, {
      switches: true,
      kinds: [
        { field: 'serialize-with', count: 6, on: true, switchable: true },
        { field: 'together-with', count: 2, on: true, switchable: false },
        { field: 'duplicate-of', count: 3, on: false, switchable: true },
      ],
      // "Together-with ... counts as drawn": 6 + 2.
      drawn: 8,
      total: 11,
    });
  });

  it('draws the legend’s together-with entry plain, with its count and no pressed state, and the drawn figure includes it', () => {
    const canvas = canvasOf(renderWorkspace(NO_BLOCKS, { words: WORKSPACE_WORDS, selection: ISSUE }).markup);
    const parsed = new JSDOM(`<!doctype html><body>${canvas}</body>`).window.document;
    const entries = [...parsed.querySelectorAll('.ig-legend[data-switch="true"] .ig-legend-switch')].map((item) => [
      item.tagName.toLowerCase(),
      item.getAttribute('aria-pressed') ?? 'no control',
      item.getAttribute('data-drawn') ?? 'none',
      item.textContent,
    ]);
    assert.deepEqual(entries, [
      ['button', 'true', 'true', 'serializes with 6'],
      ['span', 'no control', 'true', 'goes together with 2'],
      ['button', 'false', 'false', 'is a duplicate of 3'],
    ]);
    assert.ok(canvas.includes(WORKSPACE_WORDS.relationshipsDrawn(8, 11)), 'the figure left together-with out');
    assert.equal(drawnLines(canvas).filter((field) => field === 'serialize-with').length, 6);
    assert.equal(drawnLines(canvas).includes('duplicate-of'), false, 'a kind switched off drew');
  });

  it('switches duplicate-of on from there, and serialize-with off', () => {
    const { kinds } = canvasNeighbourhood(NO_BLOCKS, ISSUE, ['serialize-with', 'duplicate-of']);
    assert.deepEqual(
      kinds?.kinds.map((kind) => [kind.field, kind.on]),
      [['serialize-with', false], ['together-with', true], ['duplicate-of', true]],
    );
    assert.equal(kinds?.drawn, 5);
  });
});

/**
 * The board's two legend figures for Design q351: together-with 3, is a
 * duplicate of 7 and was decomposed from 1 (two kinds switch, so a switch);
 * and together-with 3 with is a duplicate of 7 alone (one kind switches, so
 * plain).
 */
const BOARD_SWITCH = backlogOf(41, {
  edges: [
    ['together-with', SELECTED, key(1)],
    ['together-with', key(2), SELECTED],
    ['together-with', key(3), SELECTED],
    ...edges(4, 7, (other) => ['duplicate-of', other, SELECTED]),
    ['decomposed-from', SELECTED, key(11)],
  ],
  unitOf: { [key(1)]: SELECTED, [key(2)]: SELECTED, [key(3)]: SELECTED },
});

const BOARD_PLAIN = backlogOf(41, {
  edges: [
    ['together-with', SELECTED, key(1)],
    ['together-with', key(2), SELECTED],
    ['together-with', key(3), SELECTED],
    ...edges(4, 7, (other) => ['duplicate-of', other, SELECTED]),
  ],
  unitOf: { [key(1)]: SELECTED, [key(2)]: SELECTED, [key(3)]: SELECTED },
});

describe('the legend past 8, by how many kinds switch (Design q351)', () => {
  /** Each legend entry: its tag, its pressed state, and its words with the count. */
  function entries(canvas: string, selector: string): readonly (readonly string[])[] {
    const parsed = new JSDOM(`<!doctype html><body>${canvas}</body>`).window.document;
    return [...parsed.querySelectorAll(selector)].map((item) => [
      item.tagName.toLowerCase(),
      item.getAttribute('aria-pressed') ?? 'no control',
      item.textContent.trim(),
    ]);
  }

  it('draws "goes together with 3" plain, "is a duplicate of 7" on and "was decomposed from 1" off, "10 of 11 drawn"', () => {
    const canvas = canvasOf(renderWorkspace(BOARD_SWITCH, { words: WORKSPACE_WORDS, selection: ISSUE }).markup);
    assert.deepEqual(entries(canvas, '.ig-legend[data-switch="true"] .ig-legend-switch'), [
      ['span', 'no control', 'goes together with 3'],
      ['button', 'true', 'is a duplicate of 7'],
      ['button', 'false', 'was decomposed from 1'],
    ]);
    assert.ok(canvas.includes(WORKSPACE_WORDS.relationshipsDrawn(10, 11)));
    assert.equal(drawnLines(canvas).includes('decomposed-from'), false, 'a kind off at first drew');
  });

  it('stays plain with fewer than two kinds that switch: each kind with its count, every kind drawn, no switch, figure or group', () => {
    const { kinds } = canvasNeighbourhood(BOARD_PLAIN, ISSUE, []);
    assert.equal(kinds?.switches, false);
    const canvas = canvasOf(renderWorkspace(BOARD_PLAIN, { words: WORKSPACE_WORDS, selection: ISSUE }).markup);
    assert.equal(canvas.includes('data-switch="true"'), false, 'a switch with nothing to choose');
    assert.equal(canvas.includes(WORKSPACE_WORDS.relationshipsToDraw), false, 'the switch’s group was named');
    assert.equal(canvas.includes('ig-legend-drawn'), false, 'a drawn figure with nothing to choose');
    assert.equal(canvas.includes('ig-legend-keys'), false, 'the readiness key came back');
    assert.match(canvas, /<fieldset class="ig-legend" aria-label="Relationships">/);
    // The board's plain entry: swatch, words and count, as a switch draws them, with no glyph.
    assert.deepEqual(entries(canvas, 'fieldset.ig-legend .ig-legend-item'), [
      ['span', 'no control', 'goes together with 3'],
      ['span', 'no control', 'is a duplicate of 7'],
    ]);
    assert.equal(drawnLines(canvas).filter((field) => field === 'duplicate-of').length, 7, 'a kind did not draw');
  });
});
