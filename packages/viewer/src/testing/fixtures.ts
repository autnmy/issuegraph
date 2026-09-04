/**
 * The one shared fixture.
 *
 * Every projection is asserted against THIS document, because "all three
 * projections render from one fixture" is the acceptance criterion and three
 * bespoke fixtures would satisfy the letter of it while proving nothing about
 * the shared normalisation underneath.
 *
 * It carries one of everything the grammar has to draw: a ready slot, a
 * graph-held slot that keeps its position, a tracker-held slot that does not, a
 * together unit of two, a serialize pair, a duplicate, a three-deep
 * decomposition chain, an effective-priority promotion, and an isolated issue.
 */

import type { ViewerDocument } from '../document.ts';

export const fixtureDocument: ViewerDocument = {
  issues: [
    {
      key: '101',
      title: 'Ship the settlement reconciler',
      url: 'https://example.test/issues/101',
      open: true,
      priority: 1,
      provenance: { kind: 'matched-query', index: 1, label: 'label:P1' },
    },
    {
      key: '102',
      title: 'Backfill the ledger',
      url: 'https://example.test/issues/102',
      open: true,
      priority: 3,
      // Promoted because 101 depends on it: the one case where the rank and the
      // declared priority disagree, and the reader has to be told why.
      provenance: { kind: 'promotion', notation: 'P3 -> 0', promotedBy: ['101'] },
    },
    {
      key: '103',
      title: 'Split the invoice writer',
      open: true,
      priority: 2,
      provenance: { kind: 'declared-tier', priority: 2 },
    },
    {
      key: '104',
      title: 'Split the invoice reader',
      open: true,
      priority: 2,
      provenance: { kind: 'declared-tier', priority: 2 },
    },
    {
      key: '105',
      title: 'Rework the retry budget',
      open: true,
      priority: 2,
      provenance: { kind: 'declared-tier', priority: 2 },
    },
    {
      key: '106',
      title: 'Rework the retry budget, again',
      open: true,
      priority: 2,
    },
    {
      key: '107',
      title: 'Audit the invoice pipeline',
      open: false,
      priority: 1,
    },
    {
      key: 'other/repo#7',
      title: 'Publish the rate table',
      url: 'https://example.test/other/7',
      open: true,
      priority: 1,
    },
    {
      key: '110',
      title: 'Tidy the changelog',
      open: true,
      priority: 3,
      provenance: { kind: 'declared-tier', priority: 3 },
    },
  ],
  edges: [
    { field: 'blocked-by', from: '101', to: '102' },
    { field: 'blocked-by', from: '105', to: 'other/repo#7' },
    { field: 'together-with', from: '103', to: '104' },
    { field: 'serialize-with', from: '103', to: '105' },
    { field: 'duplicate-of', from: '106', to: '105' },
    { field: 'decomposed-from', from: '103', to: '107' },
    { field: 'decomposed-from', from: '104', to: '107' },
    { field: 'decomposed-from', from: '102', to: '101' },
  ],
  order: {
    slots: [
      { rank: 1, lead: '102', members: ['102'], ready: true, holds: [] },
      {
        rank: null,
        lead: '101',
        members: ['101'],
        ready: false,
        holds: [{ family: 'graph', reason: 'blocked by 102, which is open' }],
      },
      {
        rank: 2,
        lead: '103',
        members: ['103', '104'],
        ready: true,
        holds: [],
        readyAfterRank: 1,
      },
      {
        rank: null,
        lead: '105',
        members: ['105'],
        ready: false,
        holds: [{ family: 'tracker', reason: 'claimed by another run' }],
      },
    ],
    excluded: [{ key: '106', canonical: '105', reason: 'duplicate-of' }],
  },
  cycles: [],
};

/**
 * A together unit that the tracker holds — so its lead gets no rail row and the
 * canvas owns its tab stop, which is the one shape where the enclosure and the
 * node group compete for the same key.
 */
export const heldTogetherDocument: ViewerDocument = {
  issues: [
    { key: '1', title: 'Lead', open: true, priority: 2 },
    { key: '2', title: 'Partner', open: true, priority: 2 },
    { key: '3', title: 'Blocker', open: true, priority: 2 },
  ],
  edges: [
    { field: 'together-with', from: '1', to: '2' },
    { field: 'blocked-by', from: '2', to: '3' },
  ],
  order: {
    slots: [
      {
        rank: null,
        lead: '1',
        members: ['1', '2'],
        ready: false,
        holds: [{ family: 'tracker', reason: 'claimed by another run' }],
      },
    ],
    excluded: [],
  },
  cycles: [],
};

/**
 * ONE gutter node related to TWO spine slots — the shape where a node's single
 * neighbour-per-side cannot point back to both, so only a pair whose reverse
 * survives may be published.
 */
export const sharedGutterDocument: ViewerDocument = {
  issues: [
    { key: 'a', title: 'First', open: true, priority: 2 },
    { key: 'b', title: 'Second', open: true, priority: 2 },
    { key: 'g', title: 'Shared blocker', open: true, priority: 1 },
  ],
  edges: [
    { field: 'blocked-by', from: 'a', to: 'g' },
    { field: 'blocked-by', from: 'b', to: 'g' },
  ],
  order: {
    slots: [
      { rank: 1, lead: 'a', members: ['a'], ready: true, holds: [] },
      { rank: 2, lead: 'b', members: ['b'], ready: true, holds: [] },
    ],
    excluded: [],
  },
  cycles: [],
};

/**
 * A hand-built document that names one issue in TWO positions — a slot AND an
 * exclusion — and another twice in `excluded`. Both publish a key more than
 * once, which strands everything after the first occurrence.
 */
export const doublePlacedDocument: ViewerDocument = {
  issues: [
    { key: 'x', title: 'Placed and excluded', open: true, priority: 2 },
    { key: 'y', title: 'Excluded twice', open: true, priority: 2 },
    { key: 'z', title: 'Canonical', open: true, priority: 1 },
  ],
  edges: [{ field: 'duplicate-of', from: 'y', to: 'z' }],
  order: {
    slots: [
      { rank: 1, lead: 'z', members: ['z'], ready: true, holds: [] },
      { rank: 2, lead: 'x', members: ['x'], ready: true, holds: [] },
    ],
    excluded: [
      { key: 'x', canonical: 'z', reason: 'duplicate-of' },
      { key: 'y', canonical: 'z', reason: 'duplicate-of' },
      { key: 'y', canonical: 'z', reason: 'duplicate-of' },
    ],
  },
  cycles: [],
};

/** A document whose graph deliberately exceeds a budget, for the refusal path. */
export function crowdedDocument(nodeCount: number): ViewerDocument {
  const issues = Array.from({ length: nodeCount }, (_, index) => ({
    key: String(index + 1),
    title: `Issue ${String(index + 1)}`,
    open: true,
    priority: 2,
  }));
  // A chain, so every node is on an edge and therefore gets a box — the
  // refusal is about how many nodes the canvas would have to draw, so the
  // fixture has to actually produce that many.
  const edges = issues.slice(1).map((issue, index) => ({
    field: 'blocked-by' as const,
    from: issue.key,
    to: String(index + 1),
  }));
  return { issues, edges, order: { slots: [], excluded: [] }, cycles: [] };
}

/**
 * One hub blocked by `count` others, every issue ranked, for the badge budget.
 *
 * The hub also carries one `decomposed-from`, declared FIRST so that a cut in
 * declaration order would keep it and a cut in the format's field order —
 * `blocked-by` before `decomposed-from` — drops it. Declared last it would be
 * dropped by either rule and the assertion could not tell them apart.
 */
export function denseRowDocument(count: number): ViewerDocument {
  const others = Array.from({ length: count }, (_, index) => String(index + 1));
  const issues = [
    { key: 'hub', title: 'The hub', open: true, priority: 1 },
    ...others.map((key) => ({ key, title: `Issue ${key}`, open: true, priority: 2 })),
  ];
  const edges = [
    { field: 'decomposed-from' as const, from: 'hub', to: '1' },
    ...others.map((key) => ({ field: 'blocked-by' as const, from: 'hub', to: key })),
  ];
  const slots = [
    { rank: 1, lead: 'hub', members: ['hub'], ready: true, holds: [] },
    ...others.map((key, index) => ({ rank: index + 2, lead: key, members: [key], ready: true, holds: [] })),
  ];
  return { issues, edges, order: { slots, excluded: [] }, cycles: [] };
}

/**
 * `denseRowDocument`, with the hub made a together unit of two.
 *
 * The partner declares the unit edge and one `blocked-by` of its own, so the
 * row's key set is two keys and the intra-unit edge sits in BOTH members'
 * `edgesOf` entries. That is the shape where counting before the dedupe would
 * report the one edge as two omissions.
 */
export function denseUnitDocument(count: number): ViewerDocument {
  const base = denseRowDocument(count);
  const [hubSlot, ...rest] = base.order.slots;
  return {
    issues: [...base.issues, { key: 'partner', title: 'The partner', open: true, priority: 1 }],
    edges: [
      ...base.edges,
      { field: 'together-with' as const, from: 'partner', to: 'hub' },
      { field: 'blocked-by' as const, from: 'partner', to: '1' },
    ],
    order: {
      slots: [{ ...(hubSlot as ViewerSlotLike), members: ['hub', 'partner'] }, ...rest],
      excluded: [],
    },
    cycles: [],
  };
}

type ViewerSlotLike = ViewerDocument['order']['slots'][number];
