import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildModel } from '@issuegraph/reader';
import { edgeIdentity } from '@issuegraph/core';
import { KEY_ATTRIBUTE } from '@issuegraph/viewer';

import { AUDIT_SEVERITY_ATTRIBUTE } from '../audit/surface.ts';
import type { AuditGraph } from '../audit/findings.ts';
import { ZONES, renderWorkspace } from './render.ts';
import { WORKSPACE_WORDS, backlogOf, drawnKeys, zonesIn } from '../testing/workspace.ts';

/** A graph port built from the reader's own model, as a host would build it. */
function graphFor(
  refs: readonly string[],
  blockedBy: Readonly<Record<string, readonly string[]>> = {},
): AuditGraph {
  const model = buildModel(
    refs.map((ref) => ({
      id: ref,
      repo: null,
      open: true,
      labels: [],
      assigneeCount: 0,
      data: {
        blockedBy: (blockedBy[ref] ?? []).map((id) => ({ repo: null, id })),
        decomposedFrom: null,
        duplicateOf: null,
        serializeWith: null,
        togetherWith: null,
        priority: null,
        evidence: null,
      },
      declarationRead: 'read' as const,
    })),
  );
  return { cycles: model.cycles, duplicateCanonical: model.duplicateCanonical };
}

const WORDS = { words: WORKSPACE_WORDS } as const;

describe('the three zones render at their fixed positions', () => {
  it('draws rail, canvas and inspector, in that order, inside one root', () => {
    const result = renderWorkspace(backlogOf(8), WORDS);
    assert.deepEqual(zonesIn(result.markup), ['rail', 'canvas', 'inspector']);
    assert.match(result.markup, /^<div class="ig-workspace">/);
    assert.match(result.markup, /<\/div>$/);
  });

  it('draws the header only when an audit was actually run', () => {
    // ABSENT MEANS "NOT RUN", NOT "CLEAN". A zero nobody computed and a zero the
    // reader can trust are different facts, and drawing the count for the first
    // would assert the second.
    const document = backlogOf(4);
    const withAudit = renderWorkspace(document, {
      ...WORDS,
      audit: { document: { issues: [], edges: [] }, graph: graphFor([]) },
    });
    assert.deepEqual(zonesIn(withAudit.markup), [...ZONES]);
    assert.notEqual(withAudit.view.audit, null);
    assert.equal(renderWorkspace(document, WORDS).view.audit, null);
  });

  it('names every zone from the closed union, so no caller value reaches an attribute', () => {
    const drawn = new Set(
      zonesIn(
        renderWorkspace(backlogOf(4), {
          ...WORDS,
          audit: { document: { issues: [], edges: [] }, graph: graphFor([]) },
        }).markup,
      ),
    );
    // Widened to `Set<string>` deliberately: `ZONES.includes` narrows its
    // argument to the union, so the test would not compile against the very
    // thing it is checking for — a zone name that is NOT in the union.
    const known: ReadonlySet<string> = new Set(ZONES);
    assert.deepEqual([...drawn].filter((name) => !known.has(name)), []);
  });
});

describe('the rail is windowed and the canvas is not', () => {
  it('draws the window it was asked for while the model stays complete', () => {
    const result = renderWorkspace(backlogOf(312), { ...WORDS, rail: { start: 0, count: 12 } });
    assert.equal(drawnKeys(result.markup).length, 12);
    assert.equal(result.view.rail.total, 312);
    assert.ok(result.view.rail.addressOf(300) !== undefined);
  });

  it('gives the ladder the WHOLE document, so the canvas does not follow the scroll', () => {
    // Handing the ladder a windowed document would make what it draws depend on
    // where the reader had scrolled to.
    //
    // CHAINED, AND COMPARED ON THE CANVAS ITSELF. Two earlier versions of this
    // test proved nothing, in two different ways, and both are worth naming.
    // An edgeless backlog has no connected component at all, so the ladder
    // collapses every issue into its isolated-count chip and the tier is the
    // same however the document is cut — a mutation handing it `rail.document`
    // passed cleanly. And the TIER alone is too coarse even on a chained
    // document: it is one word, and it survives a canvas drawing a different
    // set of rows underneath it.
    const keys = Array.from({ length: 30 }, (_, i) => `i${String(i + 1).padStart(4, '0')}`);
    const document = backlogOf(30, {
      edges: keys.slice(1).map((key, index) => ['blocked-by', key, keys[index] ?? ''] as const),
    });

    const canvasOf = (markup: string) =>
      markup.slice(markup.indexOf('data-zone="canvas"'), markup.indexOf('data-zone="inspector"'));
    const narrow = renderWorkspace(document, { ...WORDS, rail: { start: 0, count: 5 } });
    const wide = renderWorkspace(document, { ...WORDS, rail: { start: 10, count: 20 } });

    // The rails genuinely differ, or the comparison below is trivially true.
    assert.notEqual(drawnKeys(narrow.markup).length, drawnKeys(wide.markup).length);
    assert.ok(canvasOf(narrow.markup).length > 0, 'the canvas drew nothing');
    assert.equal(canvasOf(narrow.markup), canvasOf(wide.markup));
  });
});

describe('the ambient audit marks rail rows without touching the rail', () => {
  const refs = ['i0001', 'i0002', 'i0003'];
  // A two-cycle, which gives every member a finding.
  const audit = {
    document: {
      issues: refs.map((ref) => ({ ref, title: `issue ${ref}`, state: 'open' as const })),
      edges: [
        { id: edgeIdentity('blocked-by', 'i0001', 'i0002'), kind: 'blocked-by' as const, from: 'i0001', to: 'i0002' },
        { id: edgeIdentity('blocked-by', 'i0002', 'i0001'), kind: 'blocked-by' as const, from: 'i0002', to: 'i0001' },
      ],
    },
    graph: graphFor(refs, { i0001: ['i0002'], i0002: ['i0001'] }),
  };

  it('puts the count in the header and a severity mark on the affected rows', () => {
    const result = renderWorkspace(backlogOf(3), { ...WORDS, audit });
    assert.ok((result.view.audit?.count ?? 0) > 0);
    assert.match(result.markup, /<span class="ig-audit-count">\d+<\/span>/);

    const marked = [
      ...result.markup.matchAll(
        new RegExp(`${KEY_ATTRIBUTE}="([^"]+)"[^>]*${AUDIT_SEVERITY_ATTRIBUTE}="`, 'g'),
      ),
    ].map((match) => match[1]);
    assert.deepEqual(marked.sort(), ['i0001', 'i0002']);
  });

  it('leaves a clean row completely unmarked', () => {
    const result = renderWorkspace(backlogOf(3), { ...WORDS, audit });
    const row = result.markup.match(/<li class="ig-slot" data-ig-key="i0003"[^>]*>/)?.[0];
    assert.ok(row !== undefined);
    assert.equal(row.includes(AUDIT_SEVERITY_ATTRIBUTE), false);
  });

  it('marks a unit through a member that does not lead it', () => {
    // A `together-with` unit is one row and several refs. Read off the lead
    // alone, an affected unit renders clean — the audit failing silently on
    // exactly the rows where an encoding error is hardest to see.
    const document = backlogOf(3, { unitOf: { i0002: 'i0003' } });
    const result = renderWorkspace(document, { ...WORDS, audit });
    const row = result.markup.match(/<li class="ig-slot" data-ig-key="i0003"[^>]*>/)?.[0];
    assert.ok(row !== undefined, 'the unit row was not drawn');
    assert.match(row, new RegExp(`${AUDIT_SEVERITY_ATTRIBUTE}="`));
  });

  it('shows the HEAVIEST member\'s severity on a unit, not the first one it meets', () => {
    // THE DISCRIMINATING CELL, and it took a mutation control to notice it was
    // missing: every other fixture here gives a unit's members the SAME
    // severity, where "heaviest" and "first match" agree and neither
    // implementation can be told from the other.
    //
    // So this one is built so they disagree. `overlay.rows` is sorted by `ref`,
    // lexicographically — so the lighter finding sits FIRST — and the unit's
    // lead is the member carrying it:
    //
    //   i0001  stale-blocker  weight 0   misleading    <- lexically first, the lead
    //   i0002  cycle          weight 3   blocks-work   <- the one that must win
    //
    // A first-match reading marks the row `misleading` and understates a cycle.
    const auditInput = {
      document: {
        issues: [
          { ref: 'i0001', title: 'issue i0001', state: 'open' as const },
          { ref: 'i0002', title: 'issue i0002', state: 'open' as const },
          { ref: 'i0003', title: 'issue i0003', state: 'open' as const },
          { ref: 'gone', title: 'issue gone', state: 'closed' as const },
        ],
        edges: [
          { id: edgeIdentity('blocked-by', 'i0001', 'gone'), kind: 'blocked-by' as const, from: 'i0001', to: 'gone' },
          { id: edgeIdentity('blocked-by', 'i0002', 'i0003'), kind: 'blocked-by' as const, from: 'i0002', to: 'i0003' },
          { id: edgeIdentity('blocked-by', 'i0003', 'i0002'), kind: 'blocked-by' as const, from: 'i0003', to: 'i0002' },
        ],
      },
      graph: graphFor(['i0001', 'i0002', 'i0003', 'gone'], {
        i0001: ['gone'],
        i0002: ['i0003'],
        i0003: ['i0002'],
      }),
    };

    // The premise, asserted rather than assumed: the two members really do carry
    // different severities, and the lighter one really does sort first.
    const overlay = renderWorkspace(backlogOf(3), { ...WORDS, audit: auditInput }).view.audit;
    assert.equal(overlay?.rowFor('i0001')?.severity, 'misleading');
    assert.equal(overlay?.rowFor('i0002')?.severity, 'blocks-work');
    // THE ORDERING, not the whole list: a stale-blocker names the closed issue
    // as well, so pinning every row here would make this premise break on a
    // row that has nothing to do with what is being discriminated.
    const order = (overlay?.rows ?? []).map((row) => row.ref);
    assert.ok(order.indexOf('i0001') < order.indexOf('i0002'), order.join(','));

    const document = backlogOf(3, { unitOf: { i0002: 'i0001' } });
    const result = renderWorkspace(document, { ...WORDS, audit: auditInput });
    const row = result.markup.match(/<li class="ig-slot" data-ig-key="i0001"[^>]*>/)?.[0];
    assert.ok(row !== undefined, 'the unit row was not drawn');
    assert.match(row, new RegExp(`${AUDIT_SEVERITY_ATTRIBUTE}="blocks-work"`));
  });

  it('renders identical rail rows with the audit off', () => {
    // The marks are the ONLY difference: nothing else about the rail changes
    // when an audit is supplied, which is what "ambient" has to mean.
    const document = backlogOf(3);
    const off = renderWorkspace(document, WORDS);
    const on = renderWorkspace(document, { ...WORDS, audit });
    // FROM THE RAIL ZONE TO THE END, rather than a lazy match up to the first
    // `</section>`: the rail NESTS the viewer's own `<section>`, so a
    // non-greedy slice would compare a truncated prefix and pass on almost
    // anything. The header is the only zone before the rail, and it is the only
    // thing this slice drops.
    const fromRail = (markup: string) => markup.slice(markup.indexOf('data-zone="rail"'));
    const strip = (markup: string) =>
      markup.replace(new RegExp(` ${AUDIT_SEVERITY_ATTRIBUTE}="[^"]*"`, 'g'), '');
    assert.ok(fromRail(on.markup).includes(AUDIT_SEVERITY_ATTRIBUTE), 'nothing was marked');
    assert.equal(strip(fromRail(on.markup)), fromRail(off.markup));
  });
});

describe('the rail publishes the geometry a scroll container needs', () => {
  const document = backlogOf(312);

  it('spaces the rows it did not draw, at both ends', () => {
    const result = renderWorkspace(document, { ...WORDS, rail: { start: 100, count: 12 } });
    const spacers = [
      ...result.markup.matchAll(
        /<div class="ig-rail-spacer" data-edge="([^"]+)"[^>]*style="--ig-rail-rows:(\d+)"/g,
      ),
    ].map((match) => [match[1], Number(match[2])] as const);
    // Without these the zone is exactly as tall as the drawn rows, so native
    // scrolling stops at the end of the first window and a host has no offset
    // to turn into the next `start`.
    assert.deepEqual(spacers, [
      ['before', 100],
      ['after', 200],
    ]);
  });

  it('omits a spacer with nothing to space, at either end', () => {
    const top = renderWorkspace(document, { ...WORDS, rail: { start: 0, count: 12 } });
    assert.deepEqual(
      [...top.markup.matchAll(/data-edge="(before|after)"/g)].map((match) => match[1]),
      ['after'],
    );
    const end = renderWorkspace(document, { ...WORDS, rail: { start: 300, count: 12 } });
    assert.deepEqual(
      [...end.markup.matchAll(/data-edge="(before|after)"/g)].map((match) => match[1]),
      ['before'],
    );
    const whole = renderWorkspace(backlogOf(4), WORDS);
    assert.equal(/ig-rail-spacer/.test(whole.markup), false);
  });

  it('sizes them from the theme rather than a literal height', () => {
    const result = renderWorkspace(document, { ...WORDS, rail: { start: 10, count: 5 } });
    assert.match(
      result.styles,
      /\.ig-rail-spacer\s*\{[^}]*height:\s*calc\(var\(--ig-row-height\) \* var\(--ig-rail-rows/,
    );
  });
});

describe('the audit filter is state the workspace holds, not a dead toggle', () => {
  const refs = ['i0001', 'i0002', 'i0003', 'i0004'];
  const audit = {
    document: {
      issues: refs.map((ref) => ({ ref, title: `issue ${ref}`, state: 'open' as const })),
      edges: [
        { id: edgeIdentity('blocked-by', 'i0001', 'i0002'), kind: 'blocked-by' as const, from: 'i0001', to: 'i0002' },
        { id: edgeIdentity('blocked-by', 'i0002', 'i0001'), kind: 'blocked-by' as const, from: 'i0002', to: 'i0001' },
      ],
    },
    graph: graphFor(refs, { i0001: ['i0002'], i0002: ['i0001'] }),
  };

  it('narrows the rail to the affected rows and presses the toggle', () => {
    const on = renderWorkspace(backlogOf(4), { ...WORDS, audit, auditFiltered: true });
    assert.deepEqual(drawnKeys(on.markup), ['i0001', 'i0002']);
    assert.match(on.markup, /aria-pressed="true"/);
    assert.equal(on.view.auditFiltered, true);
    assert.equal(on.view.rail.total, 2);
  });

  it('leaves every row and an unpressed toggle when it is off', () => {
    const off = renderWorkspace(backlogOf(4), { ...WORDS, audit });
    assert.deepEqual(drawnKeys(off.markup), refs);
    assert.match(off.markup, /aria-pressed="false"/);
    assert.equal(off.view.auditFiltered, false);
  });

  it('narrows BEFORE the window, so it works past the first screen', () => {
    // Filtering only what the window had already reached reads as doing nothing
    // on a long backlog — which is the whole population this control is for.
    const many = backlogOf(300);
    const on = renderWorkspace(many, { ...WORDS, audit, auditFiltered: true, rail: { count: 5 } });
    assert.deepEqual(drawnKeys(on.markup), ['i0001', 'i0002']);
  });

  it('keeps a unit whose affected member does not lead it', () => {
    const document = backlogOf(4, { unitOf: { i0002: 'i0003' } });
    const on = renderWorkspace(document, { ...WORDS, audit, auditFiltered: true });
    assert.ok(drawnKeys(on.markup).includes('i0003'), 'the unit row was filtered out');
  });

  it('is ignored with no audit to filter by', () => {
    const none = renderWorkspace(backlogOf(4), { ...WORDS, auditFiltered: true });
    assert.equal(none.view.auditFiltered, false);
    assert.deepEqual(drawnKeys(none.markup), refs);
  });
});

describe('selection crosses the zones from one value', () => {
  const document = backlogOf(4, { edges: [['blocked-by', 'i0001', 'i0002']] });

  it('marks the selected issue current in the rail and details it in the inspector', () => {
    const result = renderWorkspace(document, {
      ...WORDS,
      selection: { kind: 'issue', key: 'i0002' },
    });
    // ON THE VALUE, not the attribute: layer 1 writes `aria-current` on every
    // row and answers `false` for the ones that are not current, so matching the
    // attribute name alone passes on any rail at all.
    assert.match(result.markup, /data-ig-key="i0002"[^>]*aria-current="true"/);
    assert.match(result.markup, /data-subject="issue"/);
    assert.match(result.markup, /<span class="ig-inspector-key">i0002<\/span>/);
  });

  it('filters the inspector on an edge selection and marks no row current', () => {
    const edgeId = edgeIdentity('blocked-by', 'i0001', 'i0002');
    const result = renderWorkspace(document, { ...WORDS, selection: { kind: 'edge', edgeId } });
    assert.match(result.markup, /data-subject="edge"/);
    assert.match(result.markup, /data-filtered="true"/);
    assert.equal(result.view.inspector.relationships.length, 1);
    // An edge is not a node, so no row is current. Asserted on the VALUE: layer
    // 1 writes `aria-current` on every row and answers `false` for the ones that
    // are not, so a test for the attribute's presence passes on any rail at all.
    assert.equal(/aria-current="true"/.test(result.markup), false);
  });

  it('marks the selected issue current on the CANVAS too, from the same value', () => {
    // The canvas is one of the three zones. Left untold, it drew the selected
    // issue as ordinary while the rail marked it current — the single selection
    // this surface advertises disagreeing with itself between two zones.
    const result = renderWorkspace(document, {
      ...WORDS,
      selection: { kind: 'issue', key: 'i0002' },
    });
    const canvas = result.markup.slice(
      result.markup.indexOf('data-zone="canvas"'),
      result.markup.indexOf('data-zone="inspector"'),
    );
    assert.match(canvas, /data-ig-key="i0002"[^>]*aria-current="true"/);
    // ONE KEY, NOT ONE OCCURRENCE. The graph projection draws each issue twice
    // — an SVG node group and a row in its own mini-rail — and both carry the
    // state, so counting occurrences asserts a layout detail rather than the
    // property. What must be true is that exactly one ISSUE reads as current.
    const current = new Set(
      [...canvas.matchAll(/data-ig-key="([^"]+)"[^>]*aria-current="true"/g)].map(
        (match) => match[1],
      ),
    );
    assert.deepEqual([...current], ['i0002']);
  });

  it('publishes what a control does as data, and wires nothing', () => {
    const result = renderWorkspace(document, {
      ...WORDS,
      selection: { kind: 'issue', key: 'i0001' },
    });
    assert.match(
      result.markup,
      new RegExp(
        `data-ig-command="select-edge" data-ig-target="${edgeIdentity('blocked-by', 'i0001', 'i0002')}"`,
      ),
    );
  });
});

describe('every published command is operable by keyboard', () => {
  it('puts each data-ig-command on a button, across every zone', () => {
    // A PROPERTY OVER THE WHOLE SURFACE, not a check on the row that was wrong.
    // A plain element carrying a command has no tab stop and no native
    // Enter/Space activation, so the action is reachable by pointer and by
    // nothing else — and a host wiring the published attributes cannot repair
    // that without rebuilding semantics this package owes it. Written this way
    // so the NEXT control to publish a command is covered too.
    const document = backlogOf(4, {
      edges: [
        ['blocked-by', 'i0001', 'i0002'],
        ['duplicate-of', 'i0003', 'i0004'],
      ],
    });
    const markups = [
      renderWorkspace(document, { ...WORDS, selection: { kind: 'issue', key: 'i0001' } }).markup,
      renderWorkspace(document, {
        ...WORDS,
        selection: { kind: 'edge', edgeId: edgeIdentity('blocked-by', 'i0001', 'i0002') },
      }).markup,
      renderWorkspace(document, {
        ...WORDS,
        audit: { document: { issues: [], edges: [] }, graph: graphFor([]) },
      }).markup,
    ];

    const carriers = markups.flatMap((markup) =>
      [...markup.matchAll(/<([a-z]+)[^>]*\sdata-ig-command="/g)].map((match) => match[1]),
    );
    // Pin the denominator: a regex that matched nothing would pass vacuously.
    assert.ok(carriers.length >= 3, `only ${String(carriers.length)} commands were emitted`);
    assert.deepEqual([...new Set(carriers)], ['button']);
  });
});

describe('the surface renders words it was given and invents none', () => {
  it('renders the host\'s empty-state sentence', () => {
    const result = renderWorkspace(backlogOf(3), WORDS);
    assert.match(result.markup, /pick a row to inspect it/);
  });

  it('renders the clear control only while a filter is narrowing the list', () => {
    const document = backlogOf(3, { edges: [['blocked-by', 'i0001', 'i0002']] });
    const filtered = renderWorkspace(document, {
      ...WORDS,
      selection: { kind: 'edge', edgeId: edgeIdentity('blocked-by', 'i0001', 'i0002') },
    });
    assert.match(filtered.markup, /show every relationship/);
    assert.equal(/show every relationship/.test(renderWorkspace(document, WORDS).markup), false);
  });
});

describe('the styles are installed once, and every token resolves', () => {
  it('writes the theme rule exactly once, however many leaves want it', () => {
    // Both composed leaves emit their own copy of the viewer stylesheet and the
    // theme rule. Taking either wholesale would install the custom properties
    // two or three times over — harmless to render and impossible to debug when
    // a host overrides one.
    const styles = renderWorkspace(backlogOf(3), {
      ...WORDS,
      audit: { document: { issues: [], edges: [] }, graph: graphFor([]) },
    }).styles;
    assert.equal(styles.match(/--ig-bg:/g)?.length, 1);
  });

  it('writes the theme onto the selector it was given', () => {
    const styles = renderWorkspace(backlogOf(3), { ...WORDS, themeSelector: '.host' }).styles;
    assert.match(styles, /\.host \{/);
  });

  it('installs every sheet its zones need, and the audit\'s only when there is one', () => {
    // A zone whose stylesheet was left out is unstyled on a host that installs
    // what this hands back — which is the whole contract of returning `styles`.
    const document = backlogOf(3);
    const bare = renderWorkspace(document, WORDS).styles;
    for (const marker of ['.ig-workspace', '.ig-ladder', '.ig-viewer']) {
      assert.ok(bare.includes(marker), marker);
    }
    // KEYED ON THE HEADER'S OWN CLASS, not on the severity attribute: the
    // left-bar rule belongs to THIS stylesheet and ships unconditionally, so a
    // test written against the attribute asserts nothing about which sheets
    // were installed and fails on a correct render.
    assert.equal(bare.includes('.ig-audit-count'), false);

    const audited = renderWorkspace(document, {
      ...WORDS,
      audit: { document: { issues: [], edges: [] }, graph: graphFor([]) },
    }).styles;
    assert.ok(audited.includes('.ig-audit-count'));
  });
});

describe('the workspace reports what it drew and hides nothing', () => {
  it('carries both composed leaves\' diagnostics', () => {
    const result = renderWorkspace(backlogOf(6), WORDS);
    assert.deepEqual([...result.diagnostics], []);
  });

  it('emits no diagnostic for a windowed-out together-with, and counts it instead', () => {
    // The viewer would otherwise report a connector it could not draw — about a
    // row nobody asked to see. Reported as a property of the WINDOW.
    const document = backlogOf(20, {
      unitOf: { i0004: 'i0003' },
      edges: [['together-with', 'i0003', 'i0004']],
    });
    const result = renderWorkspace(document, { ...WORDS, rail: { start: 10, count: 4 } });
    assert.deepEqual([...result.diagnostics], []);
    assert.equal(result.view.rail.undrawn, 1);
  });

  it('reports a defect both zones can see exactly once', () => {
    // The rail's render and the ladder's independently normalize the same
    // document, so a defect visible in both is diagnosed twice — and nothing
    // here carries zone attribution, so a host counting these would simply
    // overstate the failures.
    const document = backlogOf(4, { edges: [['blocked-by', 'i0001', 'i0001']] });
    const result = renderWorkspace(document, WORDS);

    // The premise: the defect really is reported, and really is one the rail's
    // window keeps. A fixture whose diagnostic only ever came from one zone
    // would pass whatever the composition did.
    assert.ok(result.diagnostics.length > 0, 'the fixture produced no diagnostic at all');
    for (const diagnostic of result.diagnostics) {
      assert.equal(
        result.diagnostics.filter((other) => other === diagnostic).length,
        1,
        diagnostic,
      );
    }
    assert.ok(result.diagnostics.some((one) => one.includes('self-edge')), 'wrong diagnostic');
  });

  it('is pure: the same inputs twice give the same markup', () => {
    const document = backlogOf(30, { edges: [['blocked-by', 'i0001', 'i0002']] });
    const once = renderWorkspace(document, { ...WORDS, rail: { start: 3, count: 9 } });
    const twice = renderWorkspace(document, { ...WORDS, rail: { start: 3, count: 9 } });
    assert.equal(once.markup, twice.markup);
  });
});
