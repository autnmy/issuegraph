import assert from 'node:assert/strict';
import { it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';

import { normalizeDocument } from './document.ts';
import { recedingOf } from './recede.ts';
import { fixtureDocument } from './testing/fixtures.ts';

it('recedingOf recedes nothing and does not throw for malformed, prototype-named and near-miss selections', () => {
  const { document } = normalizeDocument(fixtureDocument);
  const real = edgeIdentity('blocked-by', '101', '102');
  // A selection comes from a host or from a click, so these are the values a
  // careless or hostile caller can hand in: names an object lookup would find on
  // its prototype, separator-only strings, and a real identity padded or cased
  // so that only a parser, never an exact comparison, would match it.
  const selections = [
    {},
    { key: null, edge: null },
    { key: 'nowhere' },
    { key: [] },
    { key: ['nowhere', '__proto__'] },
    { key: '__proto__' },
    { key: 'constructor' },
    { key: 'hasOwnProperty' },
    { key: '' },
    { edge: 'not|an|edge' },
    { edge: '__proto__' },
    { edge: '' },
    { edge: '|||' },
    { edge: `${real}|` },
    { edge: ` ${real}` },
    { edge: real.toUpperCase() },
    { edge: edgeIdentity('blocked-by', '102', '101') },
    { key: '', edge: '' },
    { key: [], edge: null },
    // An edge identity is not an issue key, so passed as a key with no edge beside it, it selects nothing.
    { key: real },
  ];
  for (const selection of selections) {
    const label = JSON.stringify(selection);
    let result: ReturnType<typeof recedingOf> | undefined;
    assert.doesNotThrow(() => {
      result = recedingOf(document, selection);
    }, `${label} threw`);
    assert.ok(result !== undefined);
    // The issue: "No selection, or one that does not resolve, recedes nothing."
    assert.deepEqual([...result.keys], [], `${label} receded issues`);
    assert.deepEqual([...result.edges], [], `${label} receded lines`);
  }
});

it('recedingOf keeps an edge selection when an edge identity is smuggled in as the key', () => {
  const { document } = normalizeDocument(fixtureDocument);
  const selected = edgeIdentity('blocked-by', '101', '102');
  const otherEdges = fixtureDocument.edges
    .map((edge) => edgeIdentity(edge.field, edge.from, edge.to))
    .filter((identity) => identity !== selected);

  // The issue: "So an edge identity passed as `key` never switches off an edge selection."
  // An identity is not an issue key, so it must not resolve as one and win over
  // the relationship the host actually selected.
  const result = recedingOf(document, { key: selected, edge: selected });

  // The issue: "For an edge selection, that edge and its two ends stay."
  assert.deepEqual(
    [...result.keys].sort(),
    ['103', '104', '105', '106', '107', '110', 'other/repo#7'],
  );
  assert.deepEqual([...result.edges].sort(), [...otherEdges].sort());
});

it('recedingOf gives the same sets when called again after other selections, and leaves the document unchanged', () => {
  const { document } = normalizeDocument(fixtureDocument);
  const edgesBefore = document.edges.map((edge) => edgeIdentity(edge.field, edge.from, edge.to));
  const keysBefore = [...document.byKey.keys()];

  const first = recedingOf(document, { key: '102' });
  // Other selections in between must leave nothing behind for the next call.
  recedingOf(document, { key: '103' });
  recedingOf(document, { edge: edgeIdentity('blocked-by', '101', '102') });
  recedingOf(document, { key: ['102', '105'] });
  const repeated = recedingOf(document, { key: '102' });

  assert.deepEqual(repeated, first, 'a repeated selection gave a different result');

  // The issue: "Kept issues are the selected issues plus every issue on an edge of any kind, in either direction, that has a selected issue at one end; kept edges are those with a selected issue at an end."
  assert.equal(first.keys.has('101'), false, 'a neighbour of the selection receded');
  assert.equal(first.keys.has('105'), true, 'an issue that touches no selected issue did not recede');
  assert.equal(first.edges.has(edgeIdentity('blocked-by', '101', '102')), false, 'a line touching the selection receded');
  assert.equal(
    first.edges.has(edgeIdentity('blocked-by', '105', 'other/repo#7')),
    true,
    'a line touching no selected issue did not recede',
  );

  assert.deepEqual(
    document.edges.map((edge) => edgeIdentity(edge.field, edge.from, edge.to)),
    edgesBefore,
    'recedingOf changed the document edges',
  );
  assert.deepEqual([...document.byKey.keys()], keysBefore, 'recedingOf changed the document issues');
});

it('recedingOf over the set 102 and 105 recedes what touches no selected issue, and leaves the set and the document unchanged', () => {
  const document = normalizeDocument(fixtureDocument).document;
  // Frozen, so a function that sorts or trims the set in place throws here.
  const selection = Object.freeze(['102', '105']);
  const edgesBefore = document.edges.map((edge) => ({ ...edge }));

  const result = recedingOf(document, { key: selection });

  // "`recedingOf` accepts one issue key or a set of keys, and over a set an issue recedes when it is not in the set and touches no selected issue, and a line recedes when it touches no selected issue"
  // 104 touches no selected issue, but it shares one card with 103, which touches 105: "Because a unit is one card, no member of a unit with a kept member is in the receding keys."
  const stays = new Set(['101', '102', '103', '104', '105', '106', 'other/repo#7']);
  assert.deepEqual(result.keys, new Set([...document.byKey.keys()].filter((key) => !stays.has(key))));
  assert.equal(result.keys.has('107'), true);
  assert.deepEqual(
    result.edges,
    new Set([
      edgeIdentity('together-with', '103', '104'),
      edgeIdentity('decomposed-from', '103', '107'),
      edgeIdentity('decomposed-from', '104', '107'),
    ]),
  );
  assert.deepEqual(selection, ['102', '105']);
  assert.deepEqual(document.edges.map((edge) => ({ ...edge })), edgesBefore);
});

it('recedingOf reads one key, a one-key set, a repeated key and a set with an unknown key alike', () => {
  const document = normalizeDocument(fixtureDocument).document;
  const single = recedingOf(document, { key: '102' });
  assert.ok(single.keys.size > 0 && single.edges.size > 0, 'key 102 receded nothing, so this proves nothing');

  // "`recedingOf` accepts one issue key or a set of keys, and over a set an issue recedes when it is not in the set and touches no selected issue, and a line recedes when it touches no selected issue"
  assert.deepEqual(recedingOf(document, { key: ['102'] }), single);
  assert.deepEqual(recedingOf(document, { key: ['102', '102'] }), single);
  // "A key resolves when the document names it (in `byKey` or as an edge end), and keys that do not resolve are ignored."
  assert.deepEqual(recedingOf(document, { key: ['not-an-issue', '102'] }), single);
});

it('recedingOf recedes by the relationship when no selected key resolves, including an empty set and an empty string', () => {
  const document = normalizeDocument(fixtureDocument).document;
  const edge = edgeIdentity('blocked-by', '101', '102');
  const byEdge = recedingOf(document, { edge });

  // "For an edge selection, that edge and its two ends stay."
  assert.deepEqual(byEdge.keys, new Set([...document.byKey.keys()].filter((key) => key !== '101' && key !== '102')));
  assert.deepEqual(
    byEdge.edges,
    new Set(
      document.edges
        .map((declared) => edgeIdentity(declared.field, declared.from, declared.to))
        .filter((identity) => identity !== edge),
    ),
  );

  // "A key resolves when the document names it (in `byKey` or as an edge end), and keys that do not resolve are ignored."
  // "When any key resolves, the issues win and `edge` is ignored; packages/viewer/README.md says so."
  // So with no key resolving, the edge decides: "Otherwise the edge resolves when `edgeIdentity(edge.field, edge.from, edge.to)` from `@issuegraph/core`, over `document.edges` in declared orientation, equals it."
  for (const key of [null, '', [], ['not-an-issue'], ['nowhere', 'also-nowhere']] as const) {
    assert.deepEqual(recedingOf(document, { key, edge }), byEdge, `key ${JSON.stringify(key)}`);
  }
});

it('recedingOf keeps the whole together unit when a selected relationship ends on one member', () => {
  const document = normalizeDocument(fixtureDocument).document;
  const edge = edgeIdentity('serialize-with', '103', '105');

  const result = recedingOf(document, { edge });

  // "For an edge selection, that edge and its two ends stay. A together unit's card stays when any member stays."
  const stays = new Set(['103', '104', '105']);
  assert.deepEqual(result.keys, new Set([...document.byKey.keys()].filter((key) => !stays.has(key))));
  assert.equal(result.keys.has('104'), false);
  assert.deepEqual(
    result.edges,
    new Set(
      document.edges
        .map((declared) => edgeIdentity(declared.field, declared.from, declared.to))
        .filter((identity) => identity !== edge),
    ),
  );
  assert.equal(result.edges.has(edgeIdentity('together-with', '103', '104')), true);
});

it('recedingOf ignores a resolving edge when a key resolves, in single and set form', () => {
  const { document } = normalizeDocument(fixtureDocument);
  const sorted = (values: ReadonlySet<string>): string[] => [...values].sort();
  const edge = edgeIdentity('decomposed-from', '103', '107');
  const byIssue = recedingOf(document, { key: '102' });
  const byEdge = recedingOf(document, { edge });
  assert.notDeepEqual(sorted(byEdge.keys), sorted(byIssue.keys), 'the edge recedes what the issue does, so this proves nothing');

  // "When a host passes issues and a relationship together, the issues win and the relationship is ignored"
  const single = recedingOf(document, { key: '102', edge });
  assert.deepEqual(sorted(single.keys), sorted(byIssue.keys));
  assert.deepEqual(sorted(single.edges), sorted(byIssue.edges));
  const set = recedingOf(document, { key: ['102'], edge });
  assert.deepEqual(sorted(set.keys), sorted(byIssue.keys));
  assert.deepEqual(sorted(set.edges), sorted(byIssue.edges));
  // "A key resolves when the document names it (in `byKey` or as an edge end), and keys that do not resolve are ignored."
  const mixed = recedingOf(document, { key: ['nowhere', '102'], edge });
  assert.deepEqual(sorted(mixed.keys), sorted(byIssue.keys));
  assert.deepEqual(sorted(mixed.edges), sorted(byIssue.edges));
});

it("recedingOf for member '104' keeps its unit card and recedes its partner 103's other lines", () => {
  const { document } = normalizeDocument(fixtureDocument);
  const result = recedingOf(document, { key: '104' });

  // "Selecting one member of a together unit keeps that member's neighbours and lines, not its partners', and the unit's card stays"
  for (const kept of ['103', '104', '107']) {
    assert.equal(result.keys.has(kept), false, `${kept} receded`);
  }
  assert.equal(result.keys.has('105'), true, 'the partner 103 kept its own neighbour 105');
  assert.equal(result.keys.has('101'), true, '101 touches no selected issue and stayed');
  assert.equal(result.edges.has(edgeIdentity('decomposed-from', '104', '107')), false, "the member's own line receded");
  assert.equal(result.edges.has(edgeIdentity('serialize-with', '103', '105')), true, "the partner's line stayed");
  assert.equal(result.edges.has(edgeIdentity('decomposed-from', '103', '107')), true, "the partner's line stayed");
});

it("recedingOf for key '103' keeps its unit partner and neighbours, and recedes the partner's decomposed-from 104 to 107", () => {
  const { document } = normalizeDocument(fixtureDocument);
  const result = recedingOf(document, { key: '103' });

  assert.deepEqual(result.keys, new Set(['101', '102', '106', 'other/repo#7', '110']));
  assert.deepEqual(
    result.edges,
    new Set([
      edgeIdentity('blocked-by', '101', '102'),
      edgeIdentity('blocked-by', '105', 'other/repo#7'),
      edgeIdentity('duplicate-of', '106', '105'),
      edgeIdentity('decomposed-from', '104', '107'),
      edgeIdentity('decomposed-from', '102', '101'),
    ]),
  );
});

it('recedingOf gives each member of a together unit its own result when only one member has an origin', () => {
  const { document } = normalizeDocument({
    issues: [
      { key: '103', title: 'Split the invoice writer', open: true },
      { key: '104', title: 'Split the invoice reader', open: true },
      { key: '107', title: 'Audit the invoice pipeline', open: false },
    ],
    edges: [
      { field: 'together-with', from: '103', to: '104' },
      { field: 'decomposed-from', from: '104', to: '107' },
    ],
    order: {
      slots: [{ rank: 1, lead: '103', members: ['103', '104'], ready: true, holds: [] }],
      excluded: [],
    },
    cycles: [],
  });

  const byLead = recedingOf(document, { key: '103' });
  assert.deepEqual(byLead.keys, new Set(['107']));
  assert.deepEqual(byLead.edges, new Set([edgeIdentity('decomposed-from', '104', '107')]));

  const byMember = recedingOf(document, { key: '104' });
  assert.deepEqual(byMember.keys, new Set());
  assert.deepEqual(byMember.edges, new Set());
});
