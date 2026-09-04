import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';
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

  it('reports a normalization diagnostic ONCE, not once per normalize pass', () => {
    // The canvas is handed to `renderViewer`, which normalizes what it is given.
    // Narrowing the RAW input would send the same unclean values through a
    // second time, and every diagnostic about a retained issue would arrive
    // twice — a host that surfaces them shows each error doubled. Narrowing the
    // already-normalized document makes the viewer's pass a no-op instead.
    const document = documentOf({ components: [4] });
    const withBadUrl = {
      ...document,
      issues: document.issues.map((issue, index) =>
        index === 0 ? { ...issue, url: 'javascript:alert(1)' } : issue,
      ),
    };
    const result = renderScaleLadder(withBadUrl);
    assert.equal(result.ladder.tier, 'direct');
    const about = result.diagnostics.filter((line) => line.includes('url whose scheme'));
    assert.equal(about.length, 1, `diagnostics: ${JSON.stringify(result.diagnostics)}`);
    // And it is still REPORTED — deduplicating by dropping it would be worse
    // than reporting it twice.
    assert.match(about[0] ?? '', /deep link was dropped/);
  });

  it('hands the canvas only what the ladder counted', () => {
    // `keep` is built from the normalized document, so filtering the raw input
    // against it can retain an issue normalization dropped — here a duplicate
    // key, which the viewer keeps the FIRST of. The canvas would then carry a
    // node the ladder never counted.
    const document = documentOf({ components: [4] });
    const first = document.issues[0];
    assert.ok(first !== undefined);
    const withDuplicate = {
      ...document,
      issues: [...document.issues, { ...first, title: 'a second copy' }],
    };
    const result = renderScaleLadder(withDuplicate);
    assert.equal(result.ladder.nodeCount, result.ladder.canvas.issues.length);
    assert.equal(
      result.ladder.canvas.issues.filter((issue) => issue.key === first.key).length,
      1,
    );
  });

  it('reports the ladder\'s diagnostics and the canvas\'s together', () => {
    const document = documentOf({ components: [4] });
    const result = renderScaleLadder(document, {
      state: { ...INITIAL_SCALE_STATE, focus: 'gone-99' },
    });
    assert.ok(result.diagnostics.some((line) => line.includes('gone-99')));
  });
});

describe('the canvas draws the selected EDGE', () => {
  // The other half of `selected`. A workspace holds ONE selection of one of two
  // kinds, and the viewer's own `selected` renders `aria-current` on a NODE —
  // so before this option the canvas was the single zone that could not read an
  // edge selection: the inspector filtered to the edge while the graph drew it
  // as an ordinary line.
  const document = relatedDocument(10);
  const first = edgeIdentity('blocked-by', componentKey(0, 1), componentKey(0, 2));

  it('marks it with the selection halo, on the edge the reader picked', () => {
    const result = renderScaleLadder(document, { selectedEdge: first });

    assert.match(result.markup, /class="ig-overlay ig-overlay-halo"/);
    // THE STATE LANDS ON THE EDGE ITSELF, not only on a decoration beside it —
    // a halo drawn against some other line would satisfy a bare class match.
    assert.match(result.markup, /class="ig-edge"[^>]*data-ig-state="selected"/);
    const marked = [
      ...result.markup.matchAll(/<path class="ig-edge"[^>]*?data-ig-group="([^"]*)"[^>]*?data-ig-state="selected"/g),
    ].map((match) => match[1] as string);
    assert.deepEqual(marked, [first]);
    assert.deepEqual([...result.diagnostics], []);
  });

  it('ships the sheet that styles the halo, so the mark is not invisible', () => {
    // A canvas that can draw a class and a stylesheet a caller has to remember
    // separately is a mark that renders as nothing on exactly the host that did
    // everything else right.
    const result = renderScaleLadder(document, { selectedEdge: first });
    assert.match(result.styles, /\.ig-overlay-halo \{/);
  });

  it('leaves the canvas untouched when nothing is selected', () => {
    const bare = renderScaleLadder(document);
    assert.equal(/ig-overlay/.test(bare.markup), false);
    assert.equal(
      renderScaleLadder(document, { selectedEdge: null }).markup,
      bare.markup,
      'an explicit null is not the same as no selection',
    );
  });

  it('draws nothing for an identity this canvas does not draw', () => {
    // A selection is a NAME, and every zone resolves a name against the
    // document it is rendering. The document moved under it, or the ladder
    // narrowed to a component this edge is not in — either way the honest
    // render is nothing selected, and it is not a diagnostic: the canvas has
    // nothing to report about an edge it was never given.
    const absent = edgeIdentity('blocked-by', 'nowhere-1', 'nowhere-2');
    const result = renderScaleLadder(document, { selectedEdge: absent });
    assert.equal(/ig-overlay/.test(result.markup), false);
    assert.deepEqual([...result.diagnostics], []);
  });

  it('draws no halo on a tier whose canvas is a refusal', () => {
    // Past the node budget there is no canvas at all, so there is no line to
    // mark — and an overlay attached to a refusal would be a halo around
    // nothing.
    const result = renderScaleLadder(relatedDocument(GRAPH_NODE_BUDGET + 1), {
      selectedEdge: first,
    });
    assert.equal(result.ladder.tier, 'capsules');
    assert.equal(/ig-overlay/.test(result.markup), false);
  });
});

describe('the canvas draws each edge’s WRITE STATES from the store’s projection', () => {
  // The overlays module already composes `ProjectedEdge`s; the ladder is the
  // layer holding the scene they attach to. Without this option the only state
  // the canvas could draw was the selection, and a write in flight was
  // invisible on the very line it concerned.
  const document = relatedDocument(10);
  const first = edgeIdentity('blocked-by', componentKey(0, 1), componentKey(0, 2));
  const second = edgeIdentity('blocked-by', componentKey(0, 2), componentKey(0, 3));
  const pending = {
    id: first,
    kind: 'blocked-by' as const,
    from: componentKey(0, 1),
    to: componentKey(0, 2),
    states: ['pending-write' as const],
    writes: [],
  };

  it('marks a pending edge on the edge itself', () => {
    const result = renderScaleLadder(document, { projected: [pending] });
    const marked = [
      ...result.markup.matchAll(/<path class="ig-edge"[^>]*?data-ig-group="([^"]*)"[^>]*?data-ig-state="([^"]*)"/g),
    ].map((match) => [match[1], match[2]]);
    assert.deepEqual(marked, [[first, 'pending-write']]);
    assert.deepEqual([...result.diagnostics], []);
  });

  it('composes the selection halo with the write state on one edge', () => {
    // One record per identity, its states the union: a second record for the
    // same edge would replace the first rather than compose with it.
    const result = renderScaleLadder(document, { projected: [pending], selectedEdge: first });
    assert.match(result.markup, /class="ig-edge"[^>]*data-ig-state="selected pending-write"/);
    assert.match(result.markup, /class="ig-overlay ig-overlay-halo"/);
  });

  it('keeps the halo when the selected edge is not among the projected ones', () => {
    const result = renderScaleLadder(document, { projected: [pending], selectedEdge: second });
    const states = [
      ...result.markup.matchAll(/<path class="ig-edge"[^>]*?data-ig-group="([^"]*)"[^>]*?data-ig-state="([^"]*)"/g),
    ].map((match) => `${match[1] ?? ''}=${match[2] ?? ''}`);
    assert.deepEqual(states.sort(), [`${first}=pending-write`, `${second}=selected`].sort());
  });

  it('ignores an entry with no state, and one naming an edge this canvas does not draw', () => {
    const absent = { ...pending, id: edgeIdentity('blocked-by', 'nowhere-1', 'nowhere-2'), from: 'nowhere-1', to: 'nowhere-2' };
    const settled = { ...pending, states: [] };
    const result = renderScaleLadder(document, { projected: [absent, settled] });
    assert.equal(/ig-overlay/.test(result.markup), false);
    assert.equal(/data-ig-state=/.test(result.markup), false);
    assert.deepEqual([...result.diagnostics], []);
  });
});
