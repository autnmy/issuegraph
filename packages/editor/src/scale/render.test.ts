import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET } from '@issuegraph/viewer';

import { componentKey, componentsSumming, documentOf } from '../testing/documents.ts';
import { INITIAL_SCALE_STATE } from './commands.ts';
import { renderScaleLadder } from './render.ts';

const relatedDocument = (total: number, cap = 20) =>
  documentOf({ components: componentsSumming(total, cap) });

describe('the three tiers render', () => {
  it('draws the canvas at or under the node budget, and nothing else claims to', () => {
    const result = renderScaleLadder(relatedDocument(GRAPH_NODE_BUDGET));
    assert.match(result.markup, /data-projection="graph"/);
    assert.match(result.markup, /data-tier="direct"/);
    assert.equal(/class="ig-refusal"/.test(result.markup), false);
  });

  it('draws capsules and NO canvas past the node budget', () => {
    const result = renderScaleLadder(relatedDocument(GRAPH_NODE_BUDGET + 1));
    assert.match(result.markup, /data-tier="capsules"/);
    assert.match(result.markup, /class="ig-capsule"/);
    // ONE REFUSAL, NOT TWO. Handing the over-budget document to the viewer would
    // make it draw its own — routeless — refusal beside this one.
    assert.equal(/data-projection="graph"/.test(result.markup), false);
    assert.equal(result.markup.match(/class="ig-refusal"/g)?.length, 1);
  });

  it('leads with search past the cluster-only budget', () => {
    const result = renderScaleLadder(relatedDocument(CLUSTER_ONLY_BUDGET + 1, 5));
    assert.match(result.markup, /data-tier="clusters"/);
    assert.match(result.markup, /data-ig-command="search"/);
  });
});

describe('the ladder and the canvas agree about the count', () => {
  it('draws without the viewer refusing underneath it, on a mostly-isolated backlog', () => {
    // The ladder counts the nodes it will HAND the viewer; the viewer counts the
    // nodes it lays out. If those two ever diverge, a `direct` tier would render
    // the viewer's own — routeless — refusal inside it, and every assertion
    // about tier would still pass. The viewer says "graph refused" in its
    // diagnostics when it declines, so an empty diagnostic list is the check.
    const document = documentOf({ components: componentsSumming(GRAPH_NODE_BUDGET, 5), isolated: 500 });
    const result = renderScaleLadder(document);
    assert.equal(result.ladder.tier, 'direct');
    assert.equal(result.ladder.nodeCount, GRAPH_NODE_BUDGET);
    assert.deepEqual([...result.diagnostics], []);
    assert.equal(/class="ig-refusal"/.test(result.markup), false);
  });
});

describe('the refusal, as a reader sees it', () => {
  it('states the reason and lists at least one labelled route', () => {
    const result = renderScaleLadder(relatedDocument(GRAPH_NODE_BUDGET + 1));
    const refusal = result.ladder.refusal;
    assert.ok(refusal !== null);
    assert.ok(result.markup.includes(refusal.reason));
    assert.match(result.markup, /class="ig-ladder-routes"/);
    for (const route of refusal.routes) {
      assert.ok(result.markup.includes(route.label), `route ${route.kind} was not rendered`);
    }
  });

  it('publishes each capsule as an actionable focus target', () => {
    const result = renderScaleLadder(relatedDocument(GRAPH_NODE_BUDGET + 1));
    const capsule = result.ladder.capsules[0];
    assert.ok(capsule !== undefined);
    assert.match(
      result.markup,
      new RegExp(`data-ig-command="focus" data-ig-target="${capsule.lead}"`),
    );
    // The counts the design asks a capsule to carry.
    assert.match(result.markup, new RegExp(`${String(capsule.size)} issues`));
    assert.match(result.markup, new RegExp(`${String(capsule.blockedByEdges)} blocking`));
    assert.match(result.markup, new RegExp(`depth ${String(capsule.chainDepth)}`));
  });

  it('shows the cycle badge only for a component that has one', () => {
    const clean = renderScaleLadder(documentOf({ components: [40, 30] }));
    assert.equal(/>cycle</.test(clean.markup), false);
    const cyclic = renderScaleLadder(documentOf({ components: [40, 30], cycleIn: 1 }));
    assert.match(cyclic.markup, />cycle</);
  });

  it('offers a way back out of a focused component', () => {
    const document = documentOf({ components: [40, 30] });
    const result = renderScaleLadder(document, {
      state: { ...INITIAL_SCALE_STATE, focus: componentKey(1, 1) },
    });
    assert.match(result.markup, /data-ig-command="clear-focus"/);
  });
});

describe('the isolated chip opens a LIST', () => {
  const document = documentOf({ components: [4], isolated: 3 });

  it('renders a collapsed chip that says what it holds', () => {
    const result = renderScaleLadder(document);
    assert.match(result.markup, /aria-expanded="false"/);
    assert.match(result.markup, /data-ig-command="open-isolated"/);
    assert.equal(/class="ig-isolated-list"/.test(result.markup), false);
  });

  it('opens an ordered list — never a canvas — and offers to close again', () => {
    const result = renderScaleLadder(document, {
      state: { ...INITIAL_SCALE_STATE, isolatedOpen: true },
    });
    assert.match(result.markup, /aria-expanded="true"/);
    assert.match(result.markup, /<ol class="ig-isolated-list"/);
    assert.match(result.markup, /data-ig-command="close-isolated"/);
    // The list is issues, not nodes: the canvas is still the four related ones.
    assert.equal(result.ladder.canvas.issues.length, 4);
  });

  it('draws nothing at all when no issue is isolated', () => {
    const result = renderScaleLadder(documentOf({ components: [4] }));
    assert.equal(/ig-chip/.test(result.markup), false);
  });
});

describe('search-to-focus, as a reader sees it', () => {
  const searchable = documentOf({
    components: componentsSumming(CLUSTER_ONLY_BUDGET + 1, 5),
    titles: { [componentKey(0, 2)]: 'Backfill the ledger' },
  });

  it('renders the box with the query it was given and the matches it found', () => {
    const result = renderScaleLadder(searchable, {
      state: { ...INITIAL_SCALE_STATE, query: 'backfill' },
    });
    assert.match(result.markup, /value="backfill"/);
    assert.match(result.markup, /Backfill the ledger/);
    assert.match(result.markup, /class="ig-ladder-match"/);
  });

  it('renders the box even before anything is typed', () => {
    const result = renderScaleLadder(searchable);
    assert.match(result.markup, /data-ig-command="search"/);
    assert.equal(/class="ig-ladder-match"/.test(result.markup), false);
  });
});

describe('the output is safe and complete', () => {
  it('escapes issue text rather than trusting the document', () => {
    // A DOCUMENT IS UNTRUSTED INPUT. Every byte of this markup comes from the
    // viewer's renderer, which is what makes that true without a second
    // escaper out here — this test is the assertion that nothing bypassed it.
    const hostile = documentOf({
      components: [4],
      isolated: 1,
      titles: {},
    });
    const injected = {
      ...hostile,
      issues: hostile.issues.map((issue, index) =>
        index === hostile.issues.length - 1
          ? { ...issue, title: '<script>alert(1)</script>' }
          : issue,
      ),
    };
    const result = renderScaleLadder(injected, {
      state: { ...INITIAL_SCALE_STATE, isolatedOpen: true },
    });
    assert.equal(/<script>/.test(result.markup), false);
    assert.match(result.markup, /&lt;script&gt;/);
  });

  it('ships the viewer stylesheet, the theme and the chrome\'s own', () => {
    const result = renderScaleLadder(relatedDocument(10));
    assert.match(result.styles, /\.ig-viewer \{/);
    assert.match(result.styles, /--ig-bg:/);
    assert.match(result.styles, /\.ig-ladder \{/);
  });

  it('reports the ladder\'s diagnostics and the canvas\'s together', () => {
    const document = documentOf({ components: [4] });
    const result = renderScaleLadder(document, {
      state: { ...INITIAL_SCALE_STATE, focus: 'gone-99' },
    });
    assert.ok(result.diagnostics.some((line) => line.includes('gone-99')));
  });
});
