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
import { CANVAS_KINDS, SWITCHABLE_KINDS, canvasNeighbourhood, drawnKinds } from './neighbourhood.ts';
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

describe('which kinds draw', () => {
  it('draws blocked-by first past 8 relationships, every kind the canvas draws at 8 or fewer, and never decomposed-from', () => {
    assert.equal(DENSE_RELATIONSHIPS, 8);
    assert.deepEqual([...drawnKinds(held({ 'blocked-by': 5, 'serialize-with': 4 }), [])], ['blocked-by', 'together-with']);
    assert.deepEqual([...drawnKinds(held({ 'blocked-by': 4, 'serialize-with': 4 }), [])], [...CANVAS_KINDS]);
    assert.equal(CANVAS_KINDS.includes('decomposed-from'), false);
  });

  it('opens on the first kind the selection has in the legend’s order when it has no blocked-by, never on none', () => {
    // RULES, Graphs, Dense neighbourhoods: "or when the selection has none, the first kind it
    // has in the legend's order, so the graph never opens on '0 of 17 drawn'".
    assert.deepEqual([...drawnKinds(held({ 'serialize-with': 3, 'duplicate-of': 6 }), [])], ['serialize-with', 'together-with']);
    assert.deepEqual([...drawnKinds(held({ 'duplicate-of': 6, 'decomposed-from': 3 }), [])], ['together-with', 'duplicate-of']);
    // A kind it lacks is never where it opens, even one before it in the legend.
    assert.equal(drawnKinds(held({ 'duplicate-of': 9 }), []).has('serialize-with'), false);
  });

  it('flips a kind the reader switched, from where this selection started, and only past 8, where a switch is drawn', () => {
    const board = held({ 'blocked-by': 12, 'serialize-with': 4, 'decomposed-from': 1 });
    assert.deepEqual([...drawnKinds(board, ['serialize-with'])], ['blocked-by', 'serialize-with', 'together-with']);
    assert.deepEqual([...drawnKinds(board, ['blocked-by'])], ['together-with']);
    const noBlocks = held({ 'serialize-with': 3, 'duplicate-of': 6 });
    assert.deepEqual([...drawnKinds(noBlocks, ['serialize-with', 'duplicate-of'])], ['together-with', 'duplicate-of']);
    assert.deepEqual([...drawnKinds(held({ 'blocked-by': 8 }), ['serialize-with'])], [...CANVAS_KINDS]);
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
      kinds: [
        { field: 'blocked-by', count: 12, on: true, switchable: true },
        { field: 'serialize-with', count: 4, on: false, switchable: true },
        { field: 'decomposed-from', count: 1, on: false, switchable: false },
      ],
      drawn: 12,
      total: 17,
    });
    assert.deepEqual(around?.centre, [SELECTED]);
    assert.equal(around?.edges.length, 12);
    // WHAT DECIDES WHETHER THE GRAPH DRAWS is every kind it could draw: 16, not decomposed-from.
    assert.equal(around?.reach.length, 16);
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
      ['none', 'no control', 'was decomposed from 1'],
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

  it('at 8 or fewer: every kind but decomposed-from draws, under the static key', () => {
    const canvas = canvasOf(renderWorkspace(SPARSE, { words: WORKSPACE_WORDS, selection: ISSUE }).markup);
    assert.deepEqual(new Set(drawnLines(canvas)), new Set(['blocked-by', 'serialize-with', 'duplicate-of']));
    // "Decomposed-from lives in Sub-issues."
    assert.equal(drawnLines(canvas).includes('decomposed-from'), false, 'decomposed-from drew on the canvas');
    assert.equal(canvas.includes('i0005"'), false, 'the decomposed-from end was drawn');
    assert.match(canvas, /<fieldset class="ig-legend" aria-label="Relationships">/);
    assert.equal(canvas.includes('data-switch="true"'), false, 'a switch under 9 relationships');
    assert.deepEqual(captionCounts(canvas), ['4', '8']);
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
