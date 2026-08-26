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

  it('is pure: the same inputs twice give the same markup', () => {
    const document = backlogOf(30, { edges: [['blocked-by', 'i0001', 'i0002']] });
    const once = renderWorkspace(document, { ...WORDS, rail: { start: 3, count: 9 } });
    const twice = renderWorkspace(document, { ...WORDS, rail: { start: 3, count: 9 } });
    assert.equal(once.markup, twice.markup);
  });
});
