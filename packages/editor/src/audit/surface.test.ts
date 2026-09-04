import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildModel } from '@issuegraph/reader';
import type { NodeInput } from '@issuegraph/reader';
import { makeEdge } from '@issuegraph/store';
import type { EdgeKind, GraphDocument, IssueRef, StoredIssue } from '@issuegraph/store';

import type { AuditGraph } from './findings.ts';
import {
  AUDIT_COUNT_ATTRIBUTE,
  AUDIT_FILTER_ATTRIBUTE,
  AUDIT_SEVERITY_ATTRIBUTE,
  auditFilterKeeps,
  auditOverlay,
  auditRowAttributes,
  renderAuditHeader,
} from './surface.ts';
import { auditStylesheet } from './styles.ts';

function issue(ref: IssueRef, state: StoredIssue['state'] = 'open'): StoredIssue {
  return { ref, title: `issue ${ref}`, state };
}

function documentOf(
  issues: readonly StoredIssue[],
  edges: readonly (readonly [EdgeKind, IssueRef, IssueRef])[],
): GraphDocument {
  return { issues, edges: edges.map(([kind, from, to]) => makeEdge(kind, from, to)) };
}

function graphOf(document: GraphDocument): AuditGraph {
  const nodes: readonly NodeInput[] = document.issues.map((held) => ({
    id: held.ref,
    repo: null,
    open: held.state === 'open',
    labels: [],
    assigneeCount: 0,
    data: {
      blockedBy: document.edges
        .filter((edge) => edge.kind === 'blocked-by' && edge.from === held.ref)
        .map((edge) => ({ repo: null, id: edge.to })),
      decomposedFrom: null,
      duplicateOf:
        document.edges
          .filter((edge) => edge.kind === 'duplicate-of' && edge.from === held.ref)
          .map((edge) => ({ repo: null, id: edge.to }))[0] ?? null,
      serializeWith: null,
      togetherWith: null,
      priority: null,
      evidence: null,
    },
    declarationRead: 'read' as const,
  }));
  const model = buildModel(nodes);
  return { cycles: model.cycles, duplicateCanonical: model.duplicateCanonical };
}

/** An overlay over a real document, which is now the only way to make one. */
function overlayOf(
  issues: readonly StoredIssue[],
  edges: readonly (readonly [EdgeKind, IssueRef, IssueRef])[],
  encodingRefused: readonly { readonly ref: IssueRef }[] = [],
) {
  const document = documentOf(issues, edges);
  return auditOverlay({ document, graph: graphOf(document), encodingRefused });
}

/** A three-issue cycle: one finding naming three rows. */
const CYCLE = {
  issues: [issue('a'), issue('b'), issue('c')],
  edges: [
    ['blocked-by', 'a', 'b'],
    ['blocked-by', 'b', 'c'],
    ['blocked-by', 'c', 'a'],
  ],
} as const;

describe('the overlay', () => {
  it('counts findings, not affected rows', () => {
    // One cycle across three issues is ONE judgment call. Counting rows would
    // report it as three pieces of work while the list behind the count has one.
    const overlay = overlayOf(CYCLE.issues, CYCLE.edges);
    assert.equal(overlay.count, 1);
    assert.equal(overlay.rows.length, 3);
  });

  it('lets the heaviest finding speak for a row carrying several', () => {
    // `a` is in the cycle AND carries a stale blocker, so two findings name it.
    const overlay = overlayOf(
      [...CYCLE.issues, issue('gone', 'closed')],
      [...CYCLE.edges, ['blocked-by', 'a', 'gone']],
    );
    const row = overlay.rowFor('a');
    assert.equal(row?.severity, 'blocks-work');
    assert.deepEqual(row?.kinds, ['cycle', 'stale-blocker']);
    assert.equal(row?.count, 2);
  });

  it('orders rows deterministically', () => {
    const overlay = overlayOf(CYCLE.issues, CYCLE.edges);
    assert.deepEqual(
      overlay.rows.map((row) => row.ref),
      ['a', 'b', 'c'],
    );
  });

  it('has a count and no rows when nothing was found', () => {
    const overlay = overlayOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    assert.equal(overlay.count, 0);
    assert.deepEqual(overlay.rows, []);
    assert.equal(overlay.rowFor('a'), undefined);
  });

  it('hands out nothing a consumer can mutate', () => {
    // `ReadonlyMap` was a TypeScript restriction and nothing more: handing out
    // the live index let a JavaScript consumer clear it, after which the
    // lookups disagreed with `rows`, `findings` and `count`. The index is a
    // closure now, so there is nothing to reach.
    const overlay = overlayOf(CYCLE.issues, CYCLE.edges);
    assert.equal(Object.isFrozen(overlay), true);
    assert.equal(Object.isFrozen(overlay.rows), true);
    assert.equal(Object.isFrozen(overlay.rows[0]), true);
    assert.equal(Object.isFrozen(overlay.rows[0]?.kinds), true);
    assert.equal(Object.isFrozen(overlay.findings), true);
    assert.equal(Object.isFrozen(overlay.findings[0]), true);
    assert.equal(Object.isFrozen(overlay.findings[0]?.members), true);
    assert.equal(typeof overlay.rowFor, 'function');
  });

  it('gives no row to a ref the document does not carry', () => {
    // A refusal may name an issue outside a paged document, and the detector
    // keeps that finding on purpose. But a ROW is a rail row, so one for an
    // unloaded ref advertises an entry that does not exist — a consumer
    // iterating `rows` to filter or navigate would offer an unreachable issue.
    // The finding and the count keep it; the index does not.
    const overlay = overlayOf([issue('a')], [], [{ ref: 'unloaded' }, { ref: 'a' }]);
    assert.equal(overlay.count, 2);
    assert.deepEqual(
      overlay.rows.map((row) => row.ref),
      ['a'],
    );
    assert.equal(overlay.rowFor('unloaded'), undefined);
    assert.equal(auditFilterKeeps(overlay, 'unloaded'), false);
    assert.deepEqual(auditRowAttributes(overlay, 'unloaded'), {});
  });

  it('marks the closed canonical a dead duplicate ref resolves to under another spelling', () => {
    // `a duplicate-of acme/app#2` with the issue carried as `2`: the host keys
    // both as `2`, the finding fires, and the closed target — the row the
    // finding is centrally about — must carry a bar. It did not while the
    // members named only the edge's two ends, because `acme/app#2` is not a
    // ref the document carries and was dropped here.
    const document = documentOf(
      [issue('a'), issue('2', 'closed')],
      [['duplicate-of', 'a', 'acme/app#2']],
    );
    const node = (id: string, open: boolean, duplicateOf: { repo: string; id: string } | null): NodeInput => ({
      id,
      repo: 'acme/app',
      open,
      labels: [],
      assigneeCount: 0,
      data: {
        blockedBy: [],
        decomposedFrom: null,
        duplicateOf,
        serializeWith: null,
        togetherWith: null,
        priority: null,
        evidence: null,
      },
      declarationRead: 'read',
    });
    const model = buildModel(
      [node('a', true, { repo: 'acme/app', id: '2' }), node('2', false, null)],
      { homeRepo: 'acme/app' },
    );
    const overlay = auditOverlay({
      document,
      graph: { cycles: model.cycles, duplicateCanonical: model.duplicateCanonical },
    });
    assert.equal(overlay.count, 1);
    assert.equal(auditFilterKeeps(overlay, '2'), true);
    assert.deepEqual(overlay.rowFor('2')?.kinds, ['dead-duplicate-ref']);
    assert.deepEqual(
      overlay.rows.map((row) => row.ref),
      ['2', 'a'],
    );
  });

  it('indexes exactly the rows it lists', () => {
    // The lookup and the list are two views of one answer, so a lookup that
    // disagreed with the rail would draw a bar on a row the list calls clean.
    const overlay = overlayOf(
      [...CYCLE.issues, issue('gone', 'closed'), issue('d'), issue('untouched')],
      [...CYCLE.edges, ['blocked-by', 'd', 'gone']],
    );
    for (const row of overlay.rows) assert.equal(overlay.rowFor(row.ref), row);
    // `gone` IS named — it is half of the stale-blocker finding — so the clean
    // ref has to be one no finding mentions at all.
    assert.notEqual(overlay.rowFor('gone'), undefined);
    assert.equal(overlay.rowFor('untouched'), undefined);
  });

  it('names no row twice, however a finding was built', () => {
    // A self-blocking edge hands the detector the same ref twice; members are a
    // SET, so the row is counted once. `['a','a']` is a valid `readonly
    // string[]`, so no type test would have caught this.
    const overlay = overlayOf([issue('a', 'closed')], []);
    assert.deepEqual(overlay.rows, []);
    const selfBlocked = overlayOf([issue('a'), issue('gone', 'closed')], [['blocked-by', 'a', 'gone']]);
    assert.deepEqual(
      selfBlocked.rows.map((row) => [row.ref, row.count]),
      [
        ['a', 1],
        ['gone', 1],
      ],
    );
  });
});

describe('the row left-bar', () => {
  it('gives an affected row the severity attribute the stylesheet draws from', () => {
    const overlay = overlayOf([issue('a'), issue('canonical', 'closed')], [['duplicate-of', 'a', 'canonical']]);
    assert.deepEqual(auditRowAttributes(overlay, 'a'), {
      [AUDIT_SEVERITY_ATTRIBUTE]: 'dangerous',
    });
  });

  it('gives a clean row an empty record, never an undefined value', () => {
    // A caller spreads this unconditionally. Returning `undefined` for a clean
    // row is one `if` away from stamping the STRING "undefined" into the DOM.
    const overlay = overlayOf(CYCLE.issues, CYCLE.edges);
    assert.deepEqual(auditRowAttributes(overlay, 'untouched'), {});
  });

  it('is drawn by the stylesheet from that attribute', () => {
    // The attribute is the only handle between the two, so this is what makes
    // `auditRowAttributes` and the stylesheet one mechanism rather than two
    // that happen to agree today.
    assert.match(auditStylesheet, new RegExp(`\\[${AUDIT_SEVERITY_ATTRIBUTE}\\]`));
    assert.match(auditStylesheet, /box-shadow:\s*inset var\(--ig-stroke\)/);
    assert.match(auditStylesheet, /var\(--ig-edge-serialize-with\)/);
  });

  it('draws the bar with a shadow, not a border, so no row moves when one appears', () => {
    // §17d asks for a count that never moves. A border changes the row's box,
    // so every affected row would shift by the bar's width the moment a finding
    // arrived — the same broken promise one element over.
    const rule = /\[data-ig-audit\]\s*\{([^}]*)\}/.exec(auditStylesheet);
    assert.ok(rule !== null, 'the stylesheet draws no bar');
    assert.equal(/border/.test(rule[1] ?? ''), false);
  });

  it('keeps the audit filter to the rows a finding names', () => {
    const overlay = overlayOf(CYCLE.issues, CYCLE.edges);
    assert.equal(auditFilterKeeps(overlay, 'a'), true);
    assert.equal(auditFilterKeeps(overlay, 'untouched'), false);
  });
});

describe('the header count', () => {
  it('renders the count', () => {
    const markup = renderAuditHeader(overlayOf(CYCLE.issues, CYCLE.edges));
    assert.match(markup, new RegExp(`${AUDIT_COUNT_ATTRIBUTE}="1"`));
    assert.match(markup, /<span class="ig-audit-count">1<\/span>/);
  });

  it('is still drawn, and still clickable, at zero', () => {
    // "Always the same click" (§17d). A control that appears only when there is
    // bad news is a control the eye has to re-find, and audit is a FILTER, not
    // a mode you enter (§17a).
    const markup = renderAuditHeader(overlayOf([issue('a')], []));
    assert.match(markup, new RegExp(`${AUDIT_COUNT_ATTRIBUTE}="0"`));
    assert.match(markup, /<button type="button"/);
    assert.match(markup, new RegExp(AUDIT_FILTER_ATTRIBUTE));
    assert.equal(/disabled/.test(markup), false);
    assert.equal(/hidden/.test(markup), false);
  });

  it('freezes what it hands out, so a render site cannot edit a finding', () => {
    const overlay = overlayOf(CYCLE.issues, CYCLE.edges);
    assert.equal(Object.isFrozen(overlay), true);
    assert.equal(Object.isFrozen(overlay.rows), true);
    assert.equal(Object.isFrozen(overlay.rows[0]?.kinds), true);
  });

  it('says whether the filter is on, so a screen reader can too', () => {
    const overlay = overlayOf(CYCLE.issues, CYCLE.edges);
    assert.match(renderAuditHeader(overlay), /aria-pressed="false"/);
    assert.match(renderAuditHeader(overlay, { filtered: true }), /aria-pressed="true"/);
  });

  it('renders no host-supplied text at all', () => {
    // The boundary that means this module needs no escaper: the only value that
    // reaches the markup is a number. A finding's `detail` is prose about
    // issues a host supplied, and whatever lists it owns its escaping.
    const markup = renderAuditHeader(
      overlayOf(
        [issue('<script>alert(1)</script>'), issue('b')],
        [
          ['blocked-by', '<script>alert(1)</script>', 'b'],
          ['blocked-by', 'b', '<script>alert(1)</script>'],
        ],
      ),
    );
    assert.equal(markup.includes('<script>'), false);
    assert.equal(markup.includes('alert'), false);
  });
});

describe('what the ambient surface may never be', () => {
  // §17d, as an assertion over the bytes rather than a sentence in a doc
  // comment: no modals, toasts, red banners, badge animation, blocking the edit
  // loop, or auto-fix.
  const surfaces: readonly (readonly [string, string])[] = [
    ['the header markup', renderAuditHeader(overlayOf(CYCLE.issues, CYCLE.edges))],
    ['the stylesheet', auditStylesheet],
  ];

  for (const [name, text] of surfaces) {
    it(`${name} carries no modal`, () => {
      assert.equal(/dialog|aria-modal|\bmodal\b|showModal/i.test(text), false);
    });

    it(`${name} carries no auto-fix affordance`, () => {
      // Every finding is a judgment call, so the surface offers navigation and
      // never a remedy.
      assert.equal(/auto-?fix|\bfix\b|\brepair\b|\bresolve\b/i.test(text), false);
    });

    it(`${name} carries no animation hook`, () => {
      assert.equal(/@keyframes|animation|animate|transition/i.test(text), false);
    });

    it(`${name} carries no toast or banner`, () => {
      assert.equal(/\btoast\b|\bbanner\b|\balert\b/i.test(text), false);
    });
  }
});
