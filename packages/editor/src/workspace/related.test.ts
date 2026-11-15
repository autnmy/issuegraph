import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { ViewerDocument } from '@issuegraph/viewer';

import { scaleLadder } from '../scale/ladder.ts';
import { backlogOf, keysOf, relatedHubEdges } from '../testing/workspace.ts';
import { inspectorGroups, inspectorView } from './inspector.ts';
import { canvasNeighbourhood } from './neighbourhood.ts';
import { type RelatedBlock, type RelatedListView, relatedListView, relatedRowKeys, shownNeighbours } from './related.ts';

/** `count` relationships on `i0001`, alternating `blocked-by` and `serialize-with`. */
const hub = (count: number): ViewerDocument => backlogOf(count + 1, { edges: relatedHubEdges(count) });
const SUBJECT = { kind: 'issue', key: 'i0001' } as const;

/** The blocks of a listing, or a failure naming what came back instead. */
function blocksOf(view: RelatedListView): readonly RelatedBlock[] {
  if (view.kind !== 'listed') throw new Error(`expected a listing, got ${view.kind}`);
  return view.blocks;
}

/** The one block of a listing around one issue. */
function onlyBlock(view: RelatedListView): RelatedBlock {
  const [block, ...rest] = blocksOf(view);
  assert.ok(block !== undefined && rest.length === 0, 'expected one block');
  return block;
}

it('#303 relatedListView groups the selection by kind at every count, as the Inspector groups it, each row the issue reached', () => {
  for (const count of [2, 8, 9, 61]) {
    const block = onlyBlock(relatedListView(hub(count), SUBJECT));
    // RULES, Graphs, Dense neighbourhoods: "at every count, since an order row doesn't name its kind".
    const groups = inspectorGroups(inspectorView(hub(count), SUBJECT).relationships);
    assert.deepEqual(
      block.groups.map((related) => related.group),
      groups,
      `${String(count)} relationships`,
    );
    assert.deepEqual(
      block.groups.map((related) => related.neighbours),
      groups.map((group) => group.relationships.map((relationship) => (relationship.from === 'i0001' ? relationship.to : relationship.from))),
    );
    // Around one issue a group's "Show N more" names the Inspector's own key, so the two open together.
    assert.deepEqual(block.groups.map((related) => related.key), groups.map((group) => group.key));
    assert.equal(block.around, 'i0001');
    assert.equal(block.total, count);
  }
});

it('#303 relatedListView says nothing is selected, and that an unrelated issue has no relationships', () => {
  assert.deepEqual(relatedListView(hub(4), { kind: 'none' }), { kind: 'no-selection' });
  assert.deepEqual(relatedListView(hub(4), { kind: 'issue', key: 'gone' }), { kind: 'no-selection' });
  const lonely = backlogOf(3, { edges: [['blocked-by', 'i0001', 'i0002']] });
  assert.deepEqual(relatedListView(lonely, { kind: 'issue', key: 'i0003' }), { kind: 'no-relationships' });
});

it('#303 q349: a selected relationship leaves the list as it was around the issue it was picked from, its row the selected row', () => {
  // "The list stays as it was, around the issue the relationship was picked from: 'Around #2290 · 17',
  // every group with its count. The relationship's row is the selected row, under the head that names
  // its kind." The selection names only the edge, so the issue is its stored `from` end.
  const document = hub(13);
  const around = onlyBlock(relatedListView(document, SUBJECT));
  const relationships = inspectorView(document, SUBJECT).relationships;
  // The seventh blocked-by, past the fold of five.
  const picked = relationships.filter((relationship) => relationship.field === 'blocked-by')[6];
  assert.ok(picked !== undefined && picked.from === 'i0001');
  const block = onlyBlock(relatedListView(document, { kind: 'edge', edgeId: picked.edgeId }));
  assert.equal(block.around, 'i0001');
  assert.equal(block.total, 13, '"Around #from 1" never shows');
  assert.deepEqual(
    block.groups.map((related) => [related.key, related.neighbours]),
    around.groups.map((related) => [related.key, related.neighbours]),
  );
  assert.deepEqual(
    block.groups.map((related) => related.selected),
    [picked.to, null],
    'the row was not selected under the head naming its kind, or another was',
  );
  // Its group draws whole, so the selected row is drawn although it sits past the fold.
  const [blocks] = block.groups;
  assert.ok(blocks !== undefined);
  assert.deepEqual(shownNeighbours(blocks, []), blocks.neighbours);
  assert.ok(relatedRowKeys(relatedListView(document, { kind: 'edge', edgeId: picked.edgeId }), []).includes(picked.to));
});

it('#303 q349: a selected row inside the fold opens nothing, so the list stays as it was', () => {
  const document = hub(13);
  const relationships = inspectorView(document, SUBJECT).relationships;
  // The second blocked-by, inside the fold of five.
  const picked = relationships.filter((relationship) => relationship.field === 'blocked-by')[1];
  assert.ok(picked !== undefined);
  const [blocks] = onlyBlock(relatedListView(document, { kind: 'edge', edgeId: picked.edgeId })).groups;
  assert.ok(blocks !== undefined && blocks.selected === picked.to);
  assert.equal(shownNeighbours(blocks, []).length, 5, 'a selected row already drawn opened its group');
  assert.ok(shownNeighbours(blocks, []).includes(picked.to));
});

it('#303 q354: a relationship picked from the issue that did not declare it reads around that issue', () => {
  const document = hub(4);
  const declaredByOther = inspectorView(document, SUBJECT).relationships.find((relationship) => relationship.from !== 'i0001');
  assert.ok(declaredByOther !== undefined);
  const block = onlyBlock(relatedListView(document, { kind: 'edge', edgeId: declaredByOther.edgeId, pickedFrom: 'i0001' }));
  assert.equal(block.around, 'i0001');
  const around = onlyBlock(relatedListView(document, SUBJECT));
  assert.deepEqual(
    block.groups.map((related) => [related.key, related.neighbours]),
    around.groups.map((related) => [related.key, related.neighbours]),
    'the list did not stay as it was around the issue it was picked from',
  );
  assert.ok(
    block.groups.some((related) => related.selected === declaredByOther.from),
    'the row was not the far end, under the head that names its kind',
  );
});

it('#303 q349: picked with nothing selected, or from an issue that is not one of its ends, a relationship reads around its stored `from` end', () => {
  const document = hub(4);
  const declaredByOther = inspectorView(document, SUBJECT).relationships.find((relationship) => relationship.from !== 'i0001');
  assert.ok(declaredByOther !== undefined);
  for (const selection of [
    { kind: 'edge', edgeId: declaredByOther.edgeId },
    { kind: 'edge', edgeId: declaredByOther.edgeId, pickedFrom: 'nowhere' },
  ] as const) {
    const block = onlyBlock(relatedListView(document, selection));
    assert.equal(block.around, declaredByOther.from);
    assert.deepEqual(block.groups.map((related) => related.selected), ['i0001']);
  }
});

/**
 * Three selected, as the board's figure: #3401 and #3402 share a blocker
 * (`i0010`) and a blocked issue each, #3104's neighbours are its own, and
 * #3401 blocks #3402 inside the set, which no block lists.
 */
const SET_KEYS = keysOf(30);
const setKey = (index: number): string => SET_KEYS[index] ?? assert.fail(`no key ${String(index)}`);
const SET = backlogOf(30, {
  edges: [
    ['blocked-by', setKey(2), setKey(1)],
    ['blocked-by', setKey(1), setKey(9)],
    ['blocked-by', setKey(1), setKey(10)],
    ['blocked-by', setKey(11), setKey(1)],
    ['blocked-by', setKey(2), setKey(9)],
    ['blocked-by', setKey(12), setKey(2)],
    ['serialize-with', setKey(20), setKey(5)],
    ['blocked-by', setKey(5), setKey(21)],
    ['blocked-by', setKey(5), setKey(22)],
    // A sub-issue of a member, the Sub-issues tree's, and a member's parent, which is listed.
    ['decomposed-from', setKey(23), setKey(5)],
    ['decomposed-from', setKey(5), setKey(24)],
  ],
});

it('#303 q350: several issues selected list one block per issue in rank order, each counting only its relationships outside the set', () => {
  // Added out of rank order: the blocks follow the order, never the order added.
  const blocks = blocksOf(relatedListView(SET, { kind: 'issues', keys: [setKey(5), setKey(2), setKey(1)] }));
  assert.deepEqual(
    blocks.map((block) => [block.around, block.total]),
    [
      [setKey(1), 3],
      [setKey(2), 2],
      [setKey(5), 4],
    ],
  );
  assert.deepEqual(
    blocks.map((block) => block.groups.map((related) => [related.group.key, related.neighbours])),
    [
      [
        ['blocked-by:outgoing', [setKey(9), setKey(10)]],
        ['blocked-by:incoming', [setKey(11)]],
      ],
      [
        ['blocked-by:outgoing', [setKey(9)]],
        ['blocked-by:incoming', [setKey(12)]],
      ],
      [
        ['blocked-by:outgoing', [setKey(21), setKey(22)]],
        ['serialize-with:none', [setKey(20)]],
        ['decomposed-from:outgoing', [setKey(24)]],
      ],
    ],
  );
  // Every block has its own "Is blocked by", so "Show N more" opens one block's group alone.
  const keys = blocks.flatMap((block) => block.groups.map((related) => related.key));
  assert.equal(new Set(keys).size, keys.length, 'two blocks share a group key');
});

it('#303 q350: an issue with nothing around it outside the set gets no block, and a set related to nothing outside lists nothing', () => {
  const inward = backlogOf(4, { edges: [['blocked-by', 'i0001', 'i0002'], ['blocked-by', 'i0003', 'i0004']] });
  const blocks = blocksOf(relatedListView(inward, { kind: 'issues', keys: ['i0001', 'i0002', 'i0003'] }));
  assert.deepEqual(blocks.map((block) => block.around), ['i0003']);
  assert.deepEqual(relatedListView(inward, { kind: 'issues', keys: ['i0001', 'i0002'] }), { kind: 'no-relationships' });
});

it('#303 q350: the ladder counts each issue around a set once and never a selected one, the issues its blocks reach', () => {
  const selection = { kind: 'issues', keys: [setKey(1), setKey(2), setKey(5)] } as const;
  const { around } = canvasNeighbourhood(SET, selection, []);
  const ladder = scaleLadder(SET, undefined, around);
  const reached = new Set(
    blocksOf(relatedListView(SET, selection)).flatMap((block) => block.groups.flatMap((related) => related.neighbours)),
  );
  // i0010 is reached from two members and counted once; the sub-issue i0024 is in neither.
  assert.equal(reached.size, 8);
  assert.equal(ladder.related, reached.size);
});

it('#303 the rows drawn fold at five per group until the reader opens one, for the list and its keyboard alike', () => {
  const view = relatedListView(hub(13), SUBJECT);
  const [blocks, serializes] = onlyBlock(view).groups;
  assert.ok(blocks !== undefined && serializes !== undefined);
  assert.equal(blocks.neighbours.length, 7);
  assert.equal(shownNeighbours(blocks, []).length, 5);
  assert.deepEqual(shownNeighbours(blocks, [blocks.key]), blocks.neighbours);
  assert.deepEqual(relatedRowKeys(view, []), [...blocks.neighbours.slice(0, 5), ...serializes.neighbours.slice(0, 5)]);
  assert.deepEqual(relatedRowKeys({ kind: 'no-selection' }, []), []);
});
