import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { ViewerDocument } from '@issuegraph/viewer';

import { relatedListView } from './related.ts';

it('R13: a related query of (, [* or .* matches as literal text, never as a pattern', () => {
  // The issue: "Past 300, and inside an open group holding more than 60, a search field filters by key or title through a `related-query` control, held in `HostState` like `targetQuery`."
  // The query is text the reader types. Built into a pattern, `(` and `[*` throw and `.*`
  // matches every relationship; as literal text each finds only the title that holds it.
  const keys = [...Array.from({ length: 301 }, (_, n) => `TASK-${String(1000 + n)}`), 'TASK-1'];
  const document: ViewerDocument = {
    issues: ['HUB', ...keys].map((key) => ({
      key,
      title: key === 'TASK-1150' ? 'Fix the (parser) [*] crash' : 'Same title',
      open: true,
      priority: 2,
    })),
    edges: keys.map((to) => ({ field: 'blocked-by' as const, from: 'HUB', to })),
    order: {
      slots: ['HUB', ...keys].map((key, n) => ({ rank: n + 1, lead: key, members: [key], ready: true, holds: [] })),
      excluded: [],
    },
    cycles: [],
  };
  const drawnEnds = (query: string): readonly string[] => {
    const view = relatedListView(document, { kind: 'issue', key: 'HUB' }, { group: null, query });
    assert.equal(view.kind, 'grouped', `302 relationships did not group for ${query}`);
    if (view.kind !== 'grouped') return [];
    assert.equal(view.search, 'all', `302 relationships drew no search for ${query}`);
    return view.rows.map((row) => row.to);
  };
  assert.deepEqual(drawnEnds('('), ['TASK-1150']);
  assert.deepEqual(drawnEnds('[*'), ['TASK-1150']);
  assert.deepEqual(drawnEnds('.*'), []);
});

import type { EdgeField } from '@issuegraph/core';
import { backlogOf, keysOf, relatedHubEdges } from '../testing/workspace.ts';
it('R13 relatedListView draws 60 relationships flat and groups 61 by kind with their counts', () => {
  const hub = (n: number): ViewerDocument =>
    backlogOf(n + 1, {
      edges: keysOf(n + 1)
        .slice(1)
        .map((key, index): readonly [EdgeField, string, string] =>
          index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
        ),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;

  const sixty = relatedListView(hub(60), subject, { group: null, query: '' });
  // The issue: "Up to 60 relationships draw flat."
  assert.equal(sixty.kind, 'flat');
  if (sixty.kind !== 'flat') throw new Error('expected a flat list');
  assert.equal(sixty.rows.length, 60);

  const sixtyOne = relatedListView(hub(61), subject, { group: null, query: '' });
  // The issue: "Past 60 they draw one group per kind with its count, opened by a `related-group` control."
  assert.equal(sixtyOne.kind, 'grouped');
  if (sixtyOne.kind !== 'grouped') throw new Error('expected groups');
  const counted = sixtyOne.groups.filter((group) => group.count > 0);
  assert.equal(counted.length, 2, 'a kind is listed more than once');
  assert.deepEqual(Object.fromEntries(counted.map((group) => [group.field, group.count])), {
    'blocked-by': 31,
    'serialize-with': 30,
  });
  assert.ok(sixtyOne.groups.every((group) => !group.open), 'a group opened by itself');
  assert.deepEqual(sixtyOne.rows, []);
  assert.equal(sixtyOne.search, 'none');
});

it('R13 relatedListView offers a search over all relationships at 301 and not at 300', () => {
  const hub = (n: number): ViewerDocument =>
    backlogOf(n + 1, {
      edges: keysOf(n + 1)
        .slice(1)
        .map((key, index): readonly [EdgeField, string, string] =>
          index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
        ),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;

  // The issue: "Past 300, and inside an open group holding more than 60, a search field filters by key or title through a `related-query` control, held in `HostState` like `targetQuery`."
  const at300 = relatedListView(hub(300), subject, { group: null, query: '' });
  assert.equal(at300.kind, 'grouped');
  if (at300.kind !== 'grouped') throw new Error('expected groups');
  assert.equal(at300.search, 'none');

  const at301 = relatedListView(hub(301), subject, { group: null, query: '' });
  assert.equal(at301.kind, 'grouped');
  if (at301.kind !== 'grouped') throw new Error('expected groups');
  assert.equal(at301.search, 'all');
  // An empty query leaves the groups closed: the field alone draws no rows.
  assert.deepEqual(at301.rows, []);
});

it('R12 an open group of 61 draws 60 rows and a search, and an open group of 60 draws all 60 with none', () => {
  const hub = (n: number): ViewerDocument =>
    backlogOf(n + 1, {
      edges: keysOf(n + 1)
        .slice(1)
        .map((key, index): readonly [EdgeField, string, string] =>
          index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
        ),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;

  // 122 relationships split 61 blocked-by and 61 serialize-with.
  const big = relatedListView(hub(122), subject, { group: 'blocked-by', query: '' });
  assert.equal(big.kind, 'grouped');
  if (big.kind !== 'grouped') throw new Error('expected groups');
  assert.deepEqual(big.groups.filter((group) => group.open).map((group) => group.field), ['blocked-by']);
  // The issue: "Past 300, and inside an open group holding more than 60, a search field filters by key or title through a `related-query` control, held in `HostState` like `targetQuery`."
  assert.equal(big.search, 'group');
  // The issue: "Past 60 relationships the list shows one group per kind that opens to its rows, and past 300 a search, so a relationship beyond the first 60 or 300 can be reached, and no render draws more than 60 rows"
  assert.equal(big.rows.length, 60);
  assert.equal(big.omitted, 1);
  assert.ok(big.rows.every((row) => row.field === 'blocked-by'), 'the open group drew another kind');

  // 120 relationships split 60 and 60: the open group fits and needs no search.
  const even = relatedListView(hub(120), subject, { group: 'blocked-by', query: '' });
  assert.equal(even.kind, 'grouped');
  if (even.kind !== 'grouped') throw new Error('expected groups');
  assert.equal(even.search, 'none');
  assert.equal(even.rows.length, 60);
  assert.equal(even.omitted, 0);
});

it('R14 a relationship past the first 60 of an open group is reached by its key, and the search stays inside the group', () => {
  const hub = (n: number): ViewerDocument =>
    backlogOf(n + 1, {
      edges: keysOf(n + 1)
        .slice(1)
        .map((key, index): readonly [EdgeField, string, string] =>
          index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
        ),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;
  const drawnEnd = (row: { readonly from: string; readonly to: string }): string =>
    row.from === 'i0001' ? row.to : row.from;

  // i0122 is the 61st blocked-by relationship of this hub.
  const found = relatedListView(hub(122), subject, { group: 'blocked-by', query: 'i0122' });
  assert.equal(found.kind, 'grouped');
  if (found.kind !== 'grouped') throw new Error('expected groups');
  // The issue: "Test opening a relationship past the first 60, and finding one past 300 by search."
  assert.deepEqual(found.rows.map(drawnEnd), ['i0122']);

  // i0123 is a serialize-with relationship, outside the open group.
  const outside = relatedListView(hub(122), subject, { group: 'blocked-by', query: 'i0123' });
  assert.equal(outside.kind, 'grouped');
  if (outside.kind !== 'grouped') throw new Error('expected groups');
  assert.deepEqual(outside.rows, []);
});

it('R14 a relationship past the first 300 is found by search', () => {
  const hub = (n: number): ViewerDocument =>
    backlogOf(n + 1, {
      edges: keysOf(n + 1)
        .slice(1)
        .map((key, index): readonly [EdgeField, string, string] =>
          index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
        ),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;
  const drawnEnd = (row: { readonly from: string; readonly to: string }): string =>
    row.from === 'i0001' ? row.to : row.from;

  // i0302 is the 301st relationship of this hub.
  const view = relatedListView(hub(301), subject, { group: null, query: 'i0302' });
  assert.equal(view.kind, 'grouped');
  if (view.kind !== 'grouped') throw new Error('expected groups');
  // The issue: "Test opening a relationship past the first 60, and finding one past 300 by search."
  assert.deepEqual(view.rows.map(drawnEnd), ['i0302']);
});

it('R14 the query task-1 on the 302-row same-title hub draws TASK-1 first, in 60 rows', () => {
  // Every other key contains `TASK-1` and every title is the same, so only an
  // exact key match put first can reach `TASK-1`, the last relationship.
  const keys = [...Array.from({ length: 301 }, (_, n) => `TASK-${String(1000 + n)}`), 'TASK-1'];
  const document: ViewerDocument = {
    issues: ['HUB', ...keys].map((key) => ({ key, title: 'Same title', open: true, priority: 2 })),
    edges: keys.map((to) => ({ field: 'blocked-by' as const, from: 'HUB', to })),
    order: {
      slots: ['HUB', ...keys].map((key, n) => ({ rank: n + 1, lead: key, members: [key], ready: true, holds: [] })),
      excluded: [],
    },
    cycles: [],
  };
  const drawnEnd = (row: { readonly from: string; readonly to: string }): string =>
    row.from === 'HUB' ? row.to : row.from;

  const view = relatedListView(document, { kind: 'issue', key: 'HUB' }, { group: null, query: 'task-1' });
  assert.equal(view.kind, 'grouped');
  if (view.kind !== 'grouped') throw new Error('expected groups');
  assert.equal(view.search, 'all');
  // The issue: "Past 60 relationships the list shows one group per kind that opens to its rows, and past 300 a search, so a relationship beyond the first 60 or 300 can be reached, and no render draws more than 60 rows"
  assert.equal(view.rows.length, 60);
  assert.equal(view.omitted, 242);
  const first = view.rows[0];
  assert.ok(first !== undefined);
  assert.equal(drawnEnd(first), 'TASK-1');
  assert.equal(view.rows.filter((row) => drawnEnd(row) === 'TASK-1').length, 1, 'TASK-1 is drawn twice');
});

it('R12 a query matching all 301 relationships still draws 60 distinct rows and counts the rest', () => {
  const hub = (n: number): ViewerDocument =>
    backlogOf(n + 1, {
      edges: keysOf(n + 1)
        .slice(1)
        .map((key, index): readonly [EdgeField, string, string] =>
          index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
        ),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;
  const drawnEnd = (row: { readonly from: string; readonly to: string }): string =>
    row.from === 'i0001' ? row.to : row.from;

  // Every title is `Issue <key>`, so this upper-case query matches every row.
  const view = relatedListView(hub(301), subject, { group: null, query: 'ISSUE' });
  assert.equal(view.kind, 'grouped');
  if (view.kind !== 'grouped') throw new Error('expected groups');
  // The issue: "Past 60 relationships the list shows one group per kind that opens to its rows, and past 300 a search, so a relationship beyond the first 60 or 300 can be reached, and no render draws more than 60 rows"
  assert.equal(view.rows.length, 60);
  assert.equal(view.omitted, 241);
  assert.equal(new Set(view.rows.map(drawnEnd)).size, 60, 'a relationship is drawn twice');
});

it('R13 a query with no search field drawn changes nothing', () => {
  const hub = (n: number): ViewerDocument =>
    backlogOf(n + 1, {
      edges: keysOf(n + 1)
        .slice(1)
        .map((key, index): readonly [EdgeField, string, string] =>
          index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
        ),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;

  // The issue: "Past 300, and inside an open group holding more than 60, a search field filters by key or title through a `related-query` control, held in `HostState` like `targetQuery`."
  // A query left over from a wider list must not filter a list that draws no field to change it.
  for (const n of [60, 61, 300]) {
    const document = hub(n);
    assert.deepEqual(
      relatedListView(document, subject, { group: null, query: 'i0004' }),
      relatedListView(document, subject, { group: null, query: '' }),
      `${String(n)} relationships`,
    );
  }
  const fits = hub(120);
  assert.deepEqual(
    relatedListView(fits, subject, { group: 'blocked-by', query: 'i0004' }),
    relatedListView(fits, subject, { group: 'blocked-by', query: '' }),
    'an open group of 60',
  );
});

it('R13 an open group naming a kind the list lacks draws every group closed', () => {
  const hub = (n: number): ViewerDocument =>
    backlogOf(n + 1, {
      edges: keysOf(n + 1)
        .slice(1)
        .map((key, index): readonly [EdgeField, string, string] =>
          index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
        ),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;

  // This hub holds only blocked-by and serialize-with relationships.
  const view = relatedListView(hub(61), subject, { group: 'duplicate-of', query: '' });
  assert.equal(view.kind, 'grouped');
  if (view.kind !== 'grouped') throw new Error('expected groups');
  assert.ok(view.groups.every((group) => !group.open), 'a group opened for a kind the list lacks');
  assert.deepEqual(view, relatedListView(hub(61), subject, { group: null, query: '' }));
});

it('R9 relatedListView answers no-selection with nothing selected and no-relationships for an unrelated issue', () => {
  const document = backlogOf(3, { edges: [['blocked-by', 'i0001', 'i0002']] });
  // The issue: "Related groups lists the selection's relationships in the Inspector's words, with a sentence when nothing is selected"
  assert.deepEqual(relatedListView(document, { kind: 'none' }, { group: null, query: '' }), {
    kind: 'no-selection',
  });
  assert.deepEqual(relatedListView(document, { kind: 'issue', key: 'i0003' }, { group: null, query: '' }), {
    kind: 'no-relationships',
  });
});

it('R12 two relationships to one issue draw as two rows', () => {
  const document = backlogOf(2, {
    edges: [
      ['blocked-by', 'i0001', 'i0002'],
      ['serialize-with', 'i0001', 'i0002'],
    ],
  });
  const view = relatedListView(document, { kind: 'issue', key: 'i0001' }, { group: null, query: '' });
  assert.equal(view.kind, 'flat');
  if (view.kind !== 'flat') throw new Error('expected a flat list');
  // The list counts relationships, not the issues at their other end.
  assert.deepEqual(view.rows.map((row) => row.field).sort(), ['blocked-by', 'serialize-with']);
});

it('R12 KTD6 relatedListView: on the same-title hub the query task-1 draws TASK-1 first, inside the 60-row cut', () => {
  // TASK-1 is listed last, and its key is a substring of the 301 keys before it, all with one title.
  const keys = [...Array.from({ length: 301 }, (_, n) => `TASK-${String(1000 + n)}`), 'TASK-1'];
  const hub: ViewerDocument = {
    issues: ['HUB', ...keys].map((key) => ({ key, title: 'Same title', open: true, priority: 2 })),
    edges: keys.map((to) => ({ field: 'blocked-by' as const, from: 'HUB', to })),
    order: {
      slots: ['HUB', ...keys].map((key, n) => ({ rank: n + 1, lead: key, members: [key], ready: true, holds: [] })),
      excluded: [],
    },
    cycles: [],
  };
  const view = relatedListView(hub, { kind: 'issue', key: 'HUB' }, { group: null, query: 'task-1' });
  // "Past 60 relationships the list shows one group per kind that opens to its rows, and past 300 a search, so a relationship beyond the first 60 or 300 can be reached, and no render draws more than 60 rows"
  assert.ok(view.kind === 'grouped', `expected the grouped list, got ${view.kind}`);
  assert.equal(view.search, 'all');
  assert.equal(view.rows.length, 60);
  assert.equal(view.rows[0]?.to, 'TASK-1', 'the exact key match was cut off behind 60 substring matches');
  assert.equal(view.omitted, 302 - 60);
});

it('R13 KTD6 relatedListView: a query holding pattern characters matches literally, and the subject\'s own key matches no row', () => {
  // 301 relationships, so the top-level search is drawn; one end's title holds the characters a pattern would read.
  const keys = Array.from({ length: 301 }, (_, n) => `TASK-${String(1000 + n)}`);
  const odd = 'TASK-1150';
  const hub: ViewerDocument = {
    issues: ['HUB', ...keys].map((key) => ({
      key,
      title: key === odd ? 'Fix the parser (again) [*]' : 'Same title',
      open: true,
      priority: 2,
    })),
    edges: keys.map((to) => ({ field: 'blocked-by' as const, from: 'HUB', to })),
    order: {
      slots: ['HUB', ...keys].map((key, n) => ({ rank: n + 1, lead: key, members: [key], ready: true, holds: [] })),
      excluded: [],
    },
    cycles: [],
  };
  const drawn = (query: string): string[] => {
    const view = relatedListView(hub, { kind: 'issue', key: 'HUB' }, { group: null, query });
    assert.ok(view.kind === 'grouped', `expected the grouped list for ${query}, got ${view.kind}`);
    assert.equal(view.search, 'all', query);
    return view.rows.map((row) => row.to);
  };
  // "Past 300, and inside an open group holding more than 60, a search field filters by key or title through a `related-query` control, held in `HostState` like `targetQuery`."
  assert.deepEqual(drawn('('), [odd]);
  assert.deepEqual(drawn('[*'), [odd]);
  // As a pattern, .* matches every row; as text, no key or title holds it.
  assert.deepEqual(drawn('.*'), []);
  // Every row names the subject at one end, so a match on the subject's key would draw all 301.
  assert.deepEqual(drawn('HUB'), []);
  assert.deepEqual(drawn('hub'), []);
});

it('R12 KTD5 relatedListView: a broad query inside an open group past 60 filters only that group and still draws at most 60 rows', () => {
  // 242 relationships alternate over two kinds, 121 each: past 60 in the open group, and under 300 in total.
  const hub: ViewerDocument = backlogOf(243, {
    edges: keysOf(243)
      .slice(1)
      .map((key, index) => (index % 2 === 0 ? (['blocked-by', 'i0001', key] as const) : (['serialize-with', key, 'i0001'] as const))),
  });
  // Every title is `Issue <key>`, so this query matches all 242 relationships.
  const view = relatedListView(hub, { kind: 'issue', key: 'i0001' }, { group: 'blocked-by', query: 'ISSUE' });
  assert.ok(view.kind === 'grouped', `expected the grouped list, got ${view.kind}`);
  assert.equal(view.search, 'group');
  // "Past 60 relationships the list shows one group per kind that opens to its rows, and past 300 a search, so a relationship beyond the first 60 or 300 can be reached, and no render draws more than 60 rows"
  assert.equal(view.rows.length, 60);
  assert.ok(view.rows.every((row) => row.field === 'blocked-by'), 'the group\'s query reached rows of another kind');
  assert.equal(view.omitted, 121 - 60, 'the omitted count is not the open group\'s');
  assert.deepEqual(
    view.groups.map((group) => [group.field, group.count, group.open]),
    [
      ['blocked-by', 121, true],
      ['serialize-with', 121, false],
    ],
  );
});

it('R13 KTD5 relatedListView: a query left over where no search field is drawn changes nothing', () => {
  const hubOf = (count: number): ViewerDocument =>
    backlogOf(count + 1, {
      edges: keysOf(count + 1)
        .slice(1)
        .map((key, index) => (index % 2 === 0 ? (['blocked-by', 'i0001', key] as const) : (['serialize-with', key, 'i0001'] as const))),
    });
  const subject = { kind: 'issue', key: 'i0001' } as const;
  // "Past 300, and inside an open group holding more than 60, a search field filters by key or title through a `related-query` control, held in `HostState` like `targetQuery`."
  // A reader cannot see or clear a query with no field, so it must not hide rows.

  // 61 relationships, every group closed: no field is drawn.
  const closed = hubOf(61);
  assert.deepEqual(
    relatedListView(closed, subject, { group: null, query: 'i0002' }),
    relatedListView(closed, subject, { group: null, query: '' }),
  );

  // 100 relationships, 50 per kind: the open group holds no more than 60, so no field is drawn.
  const small = hubOf(100);
  const filtered = relatedListView(small, subject, { group: 'blocked-by', query: 'zzz' });
  const plain = relatedListView(small, subject, { group: 'blocked-by', query: '' });
  assert.deepEqual(filtered, plain);
  assert.ok(filtered.kind === 'grouped', `expected the grouped list, got ${filtered.kind}`);
  assert.equal(filtered.search, 'none');
  assert.equal(filtered.rows.length, 50, 'the open group did not draw its rows');
});

it('R13 KTD8 relatedListView: a group naming a kind the list lacks leaves every group closed', () => {
  // The stored group can outlive its kind: a landed write removes the last relationship of that kind.
  const hub: ViewerDocument = backlogOf(62, {
    edges: keysOf(62)
      .slice(1)
      .map((key, index) => (index % 2 === 0 ? (['blocked-by', 'i0001', key] as const) : (['serialize-with', key, 'i0001'] as const))),
  });
  const subject = { kind: 'issue', key: 'i0001' } as const;
  const stale = relatedListView(hub, subject, { group: 'duplicate-of', query: '' });
  assert.ok(stale.kind === 'grouped', `expected the grouped list, got ${stale.kind}`);
  assert.ok(stale.groups.every((group) => !group.open), 'a group opened for a kind the list does not hold');
  assert.deepEqual(stale.rows, []);
  assert.deepEqual(stale, relatedListView(hub, subject, { group: null, query: '' }));
});

it('R13 relatedListView: two relationships to one issue count as two, so 61 relationships over 60 issues group', () => {
  // 60 other issues, and i0003 holds two kinds of relationship to the subject: 61 relationships.
  const hub: ViewerDocument = backlogOf(61, {
    edges: [
      ...keysOf(61)
        .slice(1)
        .map((key, index) => (index % 2 === 0 ? (['blocked-by', 'i0001', key] as const) : (['serialize-with', key, 'i0001'] as const))),
      ['blocked-by', 'i0001', 'i0003'] as const,
    ],
  });
  const view = relatedListView(hub, { kind: 'issue', key: 'i0001' }, { group: null, query: '' });
  // "Up to 60 relationships draw flat. Past 60 they draw one group per kind with its count, opened by a `related-group` control."
  assert.ok(view.kind === 'grouped', `61 relationships to 60 issues drew ${view.kind}, counting issues rather than relationships`);
  assert.equal(
    view.groups.reduce((sum, group) => sum + group.count, 0),
    61,
  );
  assert.deepEqual(view.rows, []);
});

it('R12 relatedListView: a query matching 120 rows of an open group draws 60 and counts 60 omitted', () => {
  // 240 relationships, 120 of each kind, so the open group passes 60 and draws its search.
  const hub = backlogOf(241, { edges: relatedHubEdges(240) });
  const view = relatedListView(hub, { kind: 'issue', key: 'i0001' }, { group: 'serialize-with', query: 'issue' });
  assert.ok(view.kind === 'grouped', `expected the grouped list, got ${view.kind}`);
  assert.equal(view.search, 'group');
  assert.equal(view.rows.length, 60);
  assert.equal(view.omitted, 60);
});

it('R13 relatedListView: an end whose title is empty is still found by its key', () => {
  const base = backlogOf(302, { edges: relatedHubEdges(301) });
  const hub: ViewerDocument = {
    ...base,
    issues: base.issues.map((issue) => (issue.key === 'i0200' ? { ...issue, title: '' } : issue)),
  };
  const view = relatedListView(hub, { kind: 'issue', key: 'i0001' }, { group: null, query: 'I0200' });
  assert.ok(view.kind === 'grouped', `expected the grouped list, got ${view.kind}`);
  assert.deepEqual(view.rows.map((row) => (row.from === 'i0001' ? row.to : row.from)), ['i0200']);
});
