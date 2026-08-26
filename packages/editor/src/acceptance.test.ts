import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS, isSymmetricEdgeField } from '@issuegraph/core';
import { createScriptedSource, createStore, diffOrder, nextDocument } from '@issuegraph/store';
import { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET } from '@issuegraph/viewer';

import * as surface from './index.ts';
import { componentKey, componentsSumming, documentOf } from './testing/documents.ts';
import { OBJECT, PICKER_WORDS, SUBJECT, documentWith, onlyEdge } from './testing/picker.ts';
import { WORDS, editOf, orderOf, railOf, railRow, ranks } from './testing/reevaluate.ts';

/**
 * The scale ladder's "done when", executable.
 *
 * Everything below goes through the PUBLIC surface only — no reach into
 * `./scale/…` — because the acceptance criterion is about what a consumer gets,
 * and a test importing past the exports would pass on a package nobody can use.
 * It is the same rule the viewer's acceptance suite states, and it is the one
 * this package's seam exists to keep.
 */
const { INITIAL_SCALE_STATE, renderScaleLadder, scaleLadder, scaleReducer } = surface;

const related = (total: number, cap = 20) =>
  documentOf({ components: componentsSumming(total, cap) });

describe('done when: the three tiers render, driven by the viewer\'s exported budgets', () => {
  const cases = [
    { tier: 'direct', document: related(GRAPH_NODE_BUDGET) },
    { tier: 'capsules', document: related(GRAPH_NODE_BUDGET + 1) },
    { tier: 'clusters', document: related(CLUSTER_ONLY_BUDGET + 1, 5) },
  ] as const;

  for (const { tier, document } of cases) {
    it(`renders the ${tier} tier`, () => {
      const result = renderScaleLadder(document);
      assert.equal(result.ladder.tier, tier);
      assert.match(result.markup, new RegExp(`data-tier="${tier}"`));
      assert.deepEqual([...result.diagnostics], []);
    });
  }

  it('takes the thresholds from the viewer rather than restating them', () => {
    assert.deepEqual(scaleLadder(related(10)).budgets, {
      node: GRAPH_NODE_BUDGET,
      clusterOnly: CLUSTER_ONLY_BUDGET,
    });
  });
});

describe('done when: capsules carry count, block count, cycle flag and chain depth', () => {
  it('carries all four, from the viewer\'s component pass rather than a second one', () => {
    const capsule = scaleLadder(documentOf({ components: [40, 30], cycleIn: 0 })).capsules[0];
    assert.ok(capsule !== undefined);
    assert.equal(capsule.size, 40);
    assert.equal(capsule.blockedByEdges, 40);
    assert.equal(capsule.chainDepth, 39);
    assert.equal(capsule.hasCycle, true);
  });
});

describe('done when: isolated issues collapse to one count chip that opens a LIST', () => {
  const document = documentOf({ components: [4], isolated: 248 });

  it('collapses to a single chip carrying the count', () => {
    const result = renderScaleLadder(document);
    assert.equal(result.ladder.isolated.count, 248);
    assert.equal(result.markup.match(/class="ig-chip"/g)?.length, 1);
    assert.match(result.markup, /248 isolated issues/);
  });

  it('opens them as a list, and the canvas is untouched', () => {
    const opened = scaleReducer(INITIAL_SCALE_STATE, { kind: 'open-isolated' });
    const result = renderScaleLadder(document, { state: opened });
    assert.match(result.markup, /<ol class="ig-isolated-list"/);
    assert.equal(result.ladder.isolated.issues.length, 248);
    assert.equal(result.ladder.canvas.issues.length, 4);
  });
});

describe('done when: every refusal names its reason and offers a route forward', () => {
  it('holds for every tier that refuses, and the routes reach the markup', () => {
    for (const document of [related(GRAPH_NODE_BUDGET + 1), related(CLUSTER_ONLY_BUDGET + 1, 5)]) {
      const result = renderScaleLadder(document);
      const refusal = result.ladder.refusal;
      assert.ok(refusal !== null);
      assert.match(refusal.reason, /budget/);
      assert.ok(refusal.routes.length > 0);
      for (const route of refusal.routes) assert.ok(result.markup.includes(route.label));
    }
  });
});

describe('done when: search-to-focus works above the cluster-only budget', () => {
  it('searches, focuses the match\'s component, and draws it', () => {
    const document = documentOf({
      components: componentsSumming(CLUSTER_ONLY_BUDGET + 1, 5),
      titles: { [componentKey(0, 2)]: 'Backfill the ledger' },
    });
    assert.equal(scaleLadder(document).tier, 'clusters');

    const searched = scaleReducer(INITIAL_SCALE_STATE, { kind: 'search', query: 'backfill' });
    const match = scaleLadder(document, searched).search?.matches[0];
    assert.ok(match !== undefined);
    assert.equal(match.key, componentKey(0, 2));

    const focused = scaleReducer(searched, { kind: 'focus', key: match.lead });
    const result = renderScaleLadder(document, { state: focused });
    assert.equal(result.ladder.tier, 'direct');
    assert.match(result.markup, /data-projection="graph"/);
    assert.ok(result.ladder.canvas.issues.some((issue) => issue.key === match.key));
  });
});

/**
 * The re-evaluate surface's "done when", executable — same rule as above: the
 * public surface only.
 *
 * The changes are built with the STORE'S own `diffOrder`, so what a consumer
 * gets is exercised against the computation this leaf presents rather than
 * against a fixture that could outlive it.
 */
const { renderReevaluate, reevaluateStylesheet } = surface;

describe('done when: a summary renders from the counts, and a chip from each delta', () => {
  it('words the counts from the host and chips only the rows that moved', () => {
    const change = diffOrder(
      orderOf(['a', 'b', 'c']),
      orderOf(['b', 'a', 'c']),
      editOf(),
    );
    const result = renderReevaluate(railOf(['b', 'a', 'c']), {
      words: WORDS,
      change,
    });

    assert.match(result.markup, /data-facet="moved"[^>]*><span class="ig-change-count">2</);
    assert.match(result.markup, /class="ig-change-word">rows moved</);
    assert.deepEqual(
      [...result.markup.matchAll(/<li class="ig-delta-chip" data-ig-key="([^"]+)"/g)]
        .map((match) => match[1])
        .sort(),
      ['a', 'b'],
    );
    assert.deepEqual([...result.diagnostics], []);
  });
});

describe('done when: unaffected rows are left completely alone', () => {
  it('renders their markup unchanged across an edit', () => {
    const before = renderReevaluate(railOf(['a', 'b', 'c', 'd']), {
      words: WORDS,
    });
    const after = renderReevaluate(railOf(['b', 'a', 'c', 'd']), {
      words: WORDS,
      change: diffOrder(orderOf(['a', 'b', 'c', 'd']), orderOf(['b', 'a', 'c', 'd']), editOf()),
    });

    for (const key of ['c', 'd']) {
      assert.equal(railRow(after.markup, key), railRow(before.markup, key), key);
    }
    assert.notEqual(railRow(after.markup, 'a'), railRow(before.markup, 'a'));
  });
});

describe('done when: the all-zero change renders a visible "changed nothing" summary', () => {
  it('draws it in the summary\'s own place rather than drawing nothing', () => {
    const same = orderOf(['a', 'b']);
    const result = renderReevaluate(railOf(['a', 'b']), {
      words: WORDS,
      change: diffOrder(same, orderOf(['a', 'b']), editOf()),
    });

    assert.equal(result.view.summary?.unchanged, true);
    assert.match(result.markup, /<p class="ig-change-unchanged">this edit changed nothing<\/p>/);
  });
});

describe('done when: the computing state shows the previous order, greyed and labelled', () => {
  const held = renderReevaluate(railOf(['a', 'b', 'c']), {
    words: WORDS,
    status: 'held',
    change: diffOrder(orderOf(['a', 'b', 'c']), orderOf(['c', 'a', 'b']), editOf()),
  });

  it('labels the surface and greys the rail through the stylesheet', () => {
    assert.match(held.markup, /data-order="held"/);
    assert.match(held.markup, /write landed, order computing/);
    // A subtree-wide `filter`, not a colour: the viewer sets colours directly on
    // its own descendants, and a specified value beats an inherited one — so a
    // `color` here would leave the stale order in its normal palette.
    assert.match(
      reevaluateStylesheet,
      /\[data-order='held'\][^{]*\.ig-viewer\s*\{[^}]*filter:\s*grayscale/,
    );
  });

  it('renders no rank that came from the partially-derived order', () => {
    // The rail still prints the ranks the caller vouched for. `c` is the row
    // the pending change moves to the front, and it still renders 3.
    assert.deepEqual(ranks(held.markup), ['1', '2', '3']);
  });
});

describe('done when: no timer, and no dismissal that is not user-initiated', () => {
  it('publishes dismissal as a command and schedules nothing', () => {
    const timers = ['setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame'];
    const saved = new Map(
      timers.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const),
    );
    const scheduled: string[] = [];
    for (const name of timers) {
      Object.defineProperty(globalThis, name, {
        value: () => {
          scheduled.push(name);
        },
        configurable: true,
        writable: true,
      });
    }

    let markup = '';
    try {
      markup = renderReevaluate(railOf(['b', 'a']), {
        words: WORDS,
        change: diffOrder(orderOf(['a', 'b']), orderOf(['b', 'a']), editOf()),
      }).markup;
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
        else Object.defineProperty(globalThis, name, descriptor);
      }
    }

    assert.deepEqual(scheduled, []);
    assert.match(markup, /data-ig-command="dismiss-change"/);
  });
});

/**
 * The type picker's "done when", executable — same rule as above: the public
 * surface only.
 *
 * The kind vocabulary comes from `@issuegraph/core` rather than from a list
 * written here, so a field added to the format widens these cases instead of
 * leaving them quietly partial.
 */
const { pickerView, renderPicker } = surface;

describe('done when: a picker emits Proposals and never touches a DataSource', () => {
  it('takes a document and an edge, and hands back one proposal per affordance', () => {
    const document = documentWith('blocked-by');
    const edge = onlyEdge(document);
    const view = pickerView(document, edge.id);

    assert.deepEqual(
      view.options.map((option) => option.proposal),
      EDGE_FIELDS.map((kind) => ({ op: 'retype', edgeId: edge.id, nextKind: kind })),
    );
    assert.deepEqual(view.flip?.proposal, { op: 'flip', edgeId: edge.id });
  });
});

describe('done when: directed kinds state a direction and offer a flip; symmetric kinds do neither', () => {
  for (const kind of EDGE_FIELDS) {
    const symmetric = isSymmetricEdgeField(kind);

    it(`drives ${kind}`, () => {
      const document = documentWith(kind);
      const { view, markup } = renderPicker(document, onlyEdge(document).id, {
        words: PICKER_WORDS,
      });

      assert.equal(view.direction === null, symmetric);
      assert.equal(view.flip === null, symmetric);
      assert.equal(markup.includes('class="ig-picker-direction"'), !symmetric);
      assert.equal(markup.includes('data-ig-command="flip"'), !symmetric);
    });
  }
});

describe('done when: no English sentence is constructed inside the package', () => {
  it('hands out the pair and the kind, and renders only the host\'s words', () => {
    const document = documentWith('blocked-by');
    const view = pickerView(document, onlyEdge(document).id);
    assert.deepEqual(view.direction, { kind: 'blocked-by', from: SUBJECT, to: OBJECT });

    const { markup } = renderPicker(document, onlyEdge(document).id, { words: PICKER_WORDS });
    const allowed = new Set([
      ...Object.values(PICKER_WORDS.kinds),
      PICKER_WORDS.heading,
      PICKER_WORDS.flip,
      PICKER_WORDS.current,
      SUBJECT,
      OBJECT,
    ]);
    const readable = [...markup.matchAll(/>([^<>]*)</g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((text) => text !== '');
    assert.ok(readable.length > 0);
    assert.deepEqual(readable.filter((text) => !allowed.has(text)), []);
  });
});

describe('done when: an invalid proposal is refused by the store, before any dispatch', () => {
  it('offers the current kind and lets the store refuse it', async () => {
    // The picker grows no second validity rule: it offers every kind, and
    // `structuralRefusal` answers `unchanged-kind` without reaching the source.
    const seed = documentWith('blocked-by');
    const source = createScriptedSource(seed, nextDocument);
    const store = createStore({
      source,
      derive: (document) =>
        document.issues.map((issue, rank) => ({
          ref: issue.ref,
          rank,
          ready: true,
          holdReasons: [],
        })),
    });
    await store.hydrate();

    const current = pickerView(seed, onlyEdge(seed).id).options.find((option) => option.current);
    assert.ok(current !== undefined);
    await store.propose(current.proposal).settled;

    assert.deepEqual([...source.pending()], []);
    const record = store.getSnapshot().writes[0];
    assert.ok(record !== undefined);
    // Narrowed rather than asserted: `reason` is a structured refusal on an
    // `invalid` record and a plain string on a `failed` one, so reading a code
    // without establishing which state produced it would read a message's
    // characters on the day the two got confused.
    if (record.state !== 'invalid') throw new Error(`expected a refusal, got ${record.state}`);
    assert.equal(record.reason.code, 'unchanged-kind');
  });
});
