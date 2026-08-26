import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildModel } from '@issuegraph/reader';
import type { EdgeKind, GraphDocument } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';
import { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET } from '@issuegraph/viewer';

import * as surface from './index.ts';
import { componentKey, componentsSumming, documentOf } from './testing/documents.ts';

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
 * The ambient audit's "done when", executable, through the same public surface.
 *
 * The graph port is built from `@issuegraph/reader`'s own model, which is what
 * a host does: the audit composes the read-time answer rather than deriving a
 * second one, and a fixture that stubbed the port would prove nothing about
 * that composition.
 */
const {
  AUDIT_CLASSES,
  AUDIT_CLASS_SPECS,
  AUDIT_SEVERITY_ATTRIBUTE,
  auditDocument,
  auditOverlay,
  auditRowAttributes,
  auditStylesheet,
  renderAuditHeader,
} = surface;

function backlog(
  issues: readonly (readonly [string, 'open' | 'closed'])[],
  edges: readonly (readonly [EdgeKind, string, string])[],
): GraphDocument {
  return {
    issues: issues.map(([ref, state]) => ({ ref, title: `issue ${ref}`, state })),
    edges: edges.map(([kind, from, to]) => makeEdge(kind, from, to)),
  };
}

function graphFor(document: GraphDocument): surface.AuditGraph {
  const model = buildModel(
    document.issues.map((issue) => ({
      id: issue.ref,
      repo: null,
      open: issue.state === 'open',
      labels: [],
      assigneeCount: 0,
      data: {
        blockedBy: document.edges
          .filter((edge) => edge.kind === 'blocked-by' && edge.from === issue.ref)
          .map((edge) => ({ repo: null, id: edge.to })),
        decomposedFrom: null,
        duplicateOf:
          document.edges
            .filter((edge) => edge.kind === 'duplicate-of' && edge.from === issue.ref)
            .map((edge) => ({ repo: null, id: edge.to }))[0] ?? null,
        serializeWith: null,
        togetherWith:
          document.edges
            .filter((edge) => edge.kind === 'together-with' && edge.from === issue.ref)
            .map((edge) => ({ repo: null, id: edge.to }))[0] ?? null,
        priority: null,
        evidence: null,
      },
      declarationRead: 'read' as const,
    })),
  );
  return { cycles: model.cycles, duplicateCanonical: model.duplicateCanonical };
}

describe('done when: a pure function returns the four finding classes from a document', () => {
  // One document carrying all four at once, including a cycle LONGER THAN THREE
  // — a detector that recognised only a mutual pair or a triangle would pass a
  // per-class fixture and fail here.
  const document = backlog(
    [
      ['a', 'open'],
      ['b', 'open'],
      ['c', 'open'],
      ['d', 'open'],
      ['e', 'open'],
      ['gone', 'closed'],
      ['dead', 'closed'],
    ],
    [
      ['blocked-by', 'a', 'b'],
      ['blocked-by', 'b', 'c'],
      ['blocked-by', 'c', 'd'],
      ['blocked-by', 'd', 'a'],
      ['blocked-by', 'e', 'gone'],
      ['duplicate-of', 'e', 'dead'],
    ],
  );
  const findings = auditDocument({
    document,
    graph: graphFor(document),
    encodingRefused: [{ ref: 'c', diagnostic: 'no `---` pair delimits the block' }],
  });

  it('returns all four, and the cycle names every one of its four members', () => {
    assert.deepEqual([...new Set(findings.map((found) => found.kind))].sort(), [
      ...AUDIT_CLASSES,
    ].sort());
    const cycle = findings.find((found) => found.kind === 'cycle');
    assert.deepEqual(cycle?.members, ['a', 'b', 'c', 'd']);
  });

  it('covers the encoding refusal, which no parsed document could carry', () => {
    const refused = findings.find((found) => found.kind === 'encoding-refused');
    assert.deepEqual(refused?.members, ['c']);
  });

  it('is pure: the same document twice gives the same findings', () => {
    assert.deepEqual(auditDocument({ document, graph: graphFor(document) }), [
      ...auditDocument({ document, graph: graphFor(document) }),
    ]);
  });
});

describe('done when: cycle detection composes the reader rather than re-deriving it', () => {
  it('reports nothing the model reports nothing for', () => {
    // A walk of its own would find the three-cycle below whatever the port said.
    const document = backlog(
      [
        ['a', 'open'],
        ['b', 'open'],
        ['c', 'open'],
      ],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
        ['blocked-by', 'c', 'a'],
      ],
    );
    const silent = { cycles: [], duplicateCanonical: () => null };
    const found = auditDocument({ document, graph: silent }).filter(
      (one) => one.kind === 'cycle',
    );
    assert.deepEqual(found, []);
  });

  it('inherits §6.6 exactly: a together group\'s own ordering is not stuck', () => {
    const document = backlog(
      [
        ['a', 'open'],
        ['b', 'open'],
      ],
      [
        ['together-with', 'a', 'b'],
        ['blocked-by', 'a', 'b'],
      ],
    );
    const found = auditDocument({ document, graph: graphFor(document) });
    assert.deepEqual(found.filter((one) => one.kind === 'cycle'), []);
  });
});

describe('done when: severity is data on the finding, not a colour at the render site', () => {
  it('carries the class table onto every finding', () => {
    const document = backlog(
      [
        ['a', 'open'],
        ['gone', 'closed'],
      ],
      [['blocked-by', 'a', 'gone']],
    );
    for (const found of auditDocument({ document, graph: graphFor(document) })) {
      assert.equal(found.severity, AUDIT_CLASS_SPECS[found.kind].severity);
    }
  });

  it('offers "keep as history" on stale blocker and on nothing else', () => {
    assert.deepEqual(
      AUDIT_CLASSES.filter((kind) => AUDIT_CLASS_SPECS[kind].keepAsHistory),
      ['stale-blocker'],
    );
  });
});

describe('done when: the header count and the row left-bar render, and nothing else does', () => {
  const document = backlog(
    [
      ['a', 'open'],
      ['gone', 'closed'],
    ],
    [['blocked-by', 'a', 'gone']],
  );
  const overlay = auditOverlay(auditDocument({ document, graph: graphFor(document) }));

  it('renders the count', () => {
    assert.equal(overlay.count, 1);
    assert.match(renderAuditHeader(overlay), /<span class="ig-audit-count">1<\/span>/);
  });

  it('marks the affected row, and the stylesheet draws a bar from that mark', () => {
    assert.deepEqual(auditRowAttributes(overlay, 'a'), {
      [AUDIT_SEVERITY_ATTRIBUTE]: 'misleading',
    });
    assert.match(auditStylesheet, new RegExp(`\\[${AUDIT_SEVERITY_ATTRIBUTE}\\][^}]*box-shadow`));
  });

  it('has no modal, no auto-fix affordance and no animation hook', () => {
    for (const text of [renderAuditHeader(overlay), auditStylesheet]) {
      assert.equal(/dialog|aria-modal|\bmodal\b/i.test(text), false, 'a modal');
      assert.equal(/auto-?fix|\bfix\b|\brepair\b/i.test(text), false, 'an auto-fix');
      assert.equal(/@keyframes|animation|animate|transition/i.test(text), false, 'an animation');
    }
  });
});
