import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildModel } from '@issuegraph/reader';
import { EDGE_FIELDS, type EdgeField, edgeIdentity, isSymmetricEdgeField } from '@issuegraph/core';
import { KEY_ATTRIBUTE, type ViewerHold, labelFrom, treatmentFor } from '@issuegraph/viewer';

import { AUDIT_SEVERITY_ATTRIBUTE } from '../audit/surface.ts';
import { treatmentForState } from '../overlay/grammar.ts';
import type { AuditGraph } from '../audit/findings.ts';
import { type WorkspaceRecovery, ZONES, renderWorkspace } from './render.ts';
import type { ViewerDocument } from '@issuegraph/viewer';
import { selectionReducer } from './selection.ts';
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

/** The inspector zone alone — it is the last of the four, so it runs to the end. */
function inspectorOf(markup: string): string {
  return markup.slice(markup.indexOf('data-zone="inspector"'));
}

/** The relationship list alone, so a `data-edge` on a kind-list entry cannot answer for a row. */
function listOf(panel: string): string {
  const at = panel.indexOf('<ul class="ig-relationship-list">');
  return at === -1 ? '' : panel.slice(at, panel.indexOf('</ul>', at));
}

/**
 * One ORDINARY row of the relationship list, by the kind it draws.
 *
 * Matched on the whole opening tag rather than on `data-edge` alone, because a
 * refusal capsule carries that attribute too — so the looser match handed this
 * back a capsule for a refused edge and the assertion about the surviving row
 * was made against the wrong element. No `li` nests inside another.
 */
function rowFor(panel: string, field: string): string {
  const list = listOf(panel);
  const at = list.indexOf(`<li class="ig-relationship" data-edge="${field}"`);
  assert.notEqual(at, -1, `no ${field} row`);
  return list.slice(at, list.indexOf('</li>', at) + '</li>'.length);
}

describe('the three zones render at their fixed positions', () => {
  it('draws header, rail, canvas and inspector, in that order, inside one root', () => {
    const result = renderWorkspace(backlogOf(8), WORDS);
    // THE HEADER IS UNCONDITIONAL SINCE #122. It was emitted only when an audit
    // overlay existed, which made the header BE the audit header; §17a's header
    // carries five facts and the audit count is one of them.
    assert.deepEqual(zonesIn(result.markup), [...ZONES]);
    assert.match(result.markup, /^<div class="ig-workspace">/);
    assert.match(result.markup, /<\/div>$/);
  });

  it('draws the audit COUNT only when an audit was actually run', () => {
    // ABSENT MEANS "NOT RUN", NOT "CLEAN". A zero nobody computed and a zero the
    // reader can trust are different facts, and drawing the count for the first
    // would assert the second.
    //
    // The ZONE is unconditional since #122 and the count is not: the header is
    // where §17a puts five facts, and each is omitted on its own terms. This is
    // the count's terms.
    const document = backlogOf(4);
    const withAudit = renderWorkspace(document, {
      ...WORDS,
      audit: { document: { issues: [], edges: [] }, graph: graphFor([]) },
    });
    assert.deepEqual(zonesIn(withAudit.markup), [...ZONES]);
    assert.notEqual(withAudit.view.audit, null);
    assert.match(withAudit.markup, /class="ig-audit"/);

    const without = renderWorkspace(document, WORDS);
    assert.equal(without.view.audit, null);
    assert.deepEqual(zonesIn(without.markup), [...ZONES], 'the zone is not conditional');
    assert.equal(/class="ig-audit"/.test(without.markup), false, 'a count nobody computed');
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
    // THE SHEET IS INSTALLED AND THE RULE IS THEME-DRIVEN — the exact
    // expression is `styles.test.ts`'s to pin, and it does, including that the
    // pitch carries the row gap. Restating the shape here made this fail on a
    // correct change to it, which is a test asserting a spelling rather than a
    // property.
    const result = renderWorkspace(document, { ...WORDS, rail: { start: 10, count: 5 } });
    const rule = result.styles.match(/\.ig-rail-spacer\s*\{([^}]*)\}/)?.[1];
    assert.ok(rule !== undefined, 'the spacer rule was not installed');
    assert.match(rule, /height:\s*calc\(/);
    assert.match(rule, /var\(--ig-rail-rows/);
    assert.equal(/\b\d+(\.\d+)?(px|rem|em|pt)\b/.test(rule), false, 'a literal length');
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
    // LAYER 1's IDENTITY CHIP, not a span of this package's own: `identity`
    // decides whether the qualified reference links, and that rule — knowing a
    // tracker's URL shape — is precisely what layer 1 exists not to duplicate.
    // This fixture supplies no `url`, so the chip is the plain form.
    assert.match(result.markup, /<span class="ig-id">i0002<\/span>/);
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

  it('marks the selected EDGE on the canvas, from that same one value', () => {
    // THE OTHER HALF OF THE ZONE THAT WAS BEHIND. The issue half was closed
    // when the canvas was handed `selectedKey`; the edge half stayed open,
    // because `selectedKey` answers `null` for an edge by design — the viewer's
    // `selected` renders `aria-current` on a NODE. So the inspector filtered to
    // the edge while the canvas drew it as an ordinary line, which is the same
    // disagreement, on the other kind.
    const edgeId = edgeIdentity('blocked-by', 'i0001', 'i0002');
    const result = renderWorkspace(document, { ...WORDS, selection: { kind: 'edge', edgeId } });
    const canvas = result.markup.slice(
      result.markup.indexOf('data-zone="canvas"'),
      result.markup.indexOf('data-zone="inspector"'),
    );

    // THE STATE IS ON THE EDGE ITSELF, and it is THAT edge. A bare
    // `ig-overlay-halo` match would pass on a halo drawn around any line, which
    // is exactly the failure this zone had.
    // ATTRIBUTES READ OUT AND COMPARED AS STRINGS: `edgeIdentity` joins with
    // `|`, which is alternation inside a RegExp.
    const marked = [
      ...canvas.matchAll(/<path class="ig-edge"[^>]*?data-ig-group="([^"]*)"[^>]*?data-ig-state="selected"/g),
    ].map((match) => match[1] as string);
    assert.deepEqual(marked, [edgeId]);
    assert.match(canvas, /class="ig-overlay ig-overlay-halo"/);

    // AND THE SHEET THAT STYLES IT, or the mark renders as nothing on a host
    // that installed exactly what this function returned.
    assert.match(result.styles, /\.ig-overlay-halo \{/);

    // The rail is untouched: an edge is not a node, so no row is current.
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
    // COMPARED AS A STRING, NOT AS A PATTERN, for the reason the remove
    // control's own assertion records further down: `edgeIdentity` joins with
    // `|`, which is ALTERNATION inside a RegExp, so this written as
    // `new RegExp(...)` decomposes and passes on its shortest branch. It was
    // written that way, and it was near-vacuous the whole time.
    assert.ok(
      result.markup.includes(
        `data-ig-command="select-edge" data-ig-target="${edgeIdentity('blocked-by', 'i0001', 'i0002')}"`,
      ),
      result.markup,
    );
  });
});

describe('the workspace derives from the normalized document, like the zones do', () => {
  it('shows the same order at every scroll position, on a document that places one issue twice', () => {
    // THE CLASS ROUND 3 FOUND, and the reason this normalizes once rather than
    // patching four places. Layer 1 keeps the FIRST placement of a key and
    // drops the later one. Slicing the RAW slots handed the viewer a window in
    // which only the later copy appeared — so it became the valid one, and the
    // visible order changed with the reader's scroll position.
    const base = backlogOf(6);
    const document = {
      ...base,
      order: {
        ...base.order,
        slots: [
          ...base.order.slots,
          { rank: 7, lead: 'i0001', members: ['i0001'], ready: true, holds: [] },
        ],
      },
      cycles: [],
    };
    // The duplicate is the LAST slot, so a window at the tail is exactly where
    // the earlier copy is out of sight.
    const tail = renderWorkspace(document, { ...WORDS, rail: { start: 5, count: 2 } });
    assert.equal(drawnKeys(tail.markup).includes('i0001'), false);
    // And the workspace says so once, from the one pass that dropped it.
    assert.ok(tail.diagnostics.some((one) => one.includes('already placed')));
  });

  it('does not offer the inspector an edge no zone drew', () => {
    const base = backlogOf(3);
    const document = {
      ...base,
      edges: [
        { field: 'blocked-by' as const, from: 'i0001', to: 'ghost' },
        { field: 'blocked-by' as const, from: 'i0001', to: 'i0002' },
      ],
    };
    const result = renderWorkspace(document, {
      ...WORDS,
      selection: { kind: 'issue', key: 'i0001' },
    });
    assert.equal(result.view.inspector.relationships.length, 1);
    assert.equal(/ghost/.test(result.markup), false);
  });
});

describe('an excluded row is a row, and the audit treats it like one', () => {
  // A `dead-duplicate-ref` names the DUPLICATE, and a duplicate is exactly what
  // puts a key in `excluded` — so this is the class most associated with an
  // exclusion, on the surface that was ignoring exclusions.
  const audit = {
    document: {
      issues: [
        { ref: 'i0001', title: 'issue i0001', state: 'open' as const },
        { ref: 'i0002', title: 'issue i0002', state: 'open' as const },
        { ref: 'i0003', title: 'issue i0003', state: 'closed' as const },
      ],
      edges: [
        { id: edgeIdentity('duplicate-of', 'i0002', 'i0003'), kind: 'duplicate-of' as const, from: 'i0002', to: 'i0003' },
      ],
    },
    graph: graphFor(['i0001', 'i0002', 'i0003']),
  };

  const base = backlogOf(3);
  const withExclusion = {
    ...base,
    order: {
      slots: base.order.slots.filter((slot) => slot.lead !== 'i0002'),
      excluded: [{ key: 'i0002', canonical: 'i0001', reason: 'duplicate-of' as const }],
    },
    cycles: [],
  };

  it('marks the excluded row when the audit has a finding for it', () => {
    const result = renderWorkspace(withExclusion, { ...WORDS, audit });
    assert.ok(result.view.audit?.rowFor('i0002') !== undefined, 'the fixture found nothing on i0002');
    const row = result.markup.match(/data-ig-key="i0002"[^>]*>/)?.[0];
    assert.ok(row !== undefined, 'the excluded row was not drawn');
    assert.match(row, new RegExp(`${AUDIT_SEVERITY_ATTRIBUTE}="`));
  });

  it('hides a CLEAN excluded row when the filter is on', () => {
    // Filtering only the slots left clean exclusion rows on screen while the
    // header said the filter was active — the toggle narrowing part of the rail
    // and claiming to have narrowed it.
    // `i0004` CARRIES NO FINDING, which is the whole point and took a failed
    // run to get right: a `dead-duplicate-ref` names BOTH ends — the duplicate
    // and the dead ref it points at — so the obvious candidates for a "clean"
    // excluded row were both dirty, and the test would have asserted the filter
    // hides a row it is supposed to keep.
    const four = backlogOf(4);
    const clean = {
      ...four,
      order: {
        slots: four.order.slots.filter((slot) => slot.lead !== 'i0004'),
        excluded: [{ key: 'i0004', canonical: 'i0001', reason: 'duplicate-of' as const }],
      },
      cycles: [],
    };
    const on = renderWorkspace(clean, { ...WORDS, audit, auditFiltered: true });
    assert.equal(on.view.audit?.rowFor('i0004'), undefined, 'the fixture made i0004 dirty');
    assert.equal(/data-ig-key="i0004"/.test(on.markup), false);
    // An affected row is still there, or the filter narrowed to nothing and
    // this would pass on a rail showing no rows at all.
    assert.match(on.markup, /data-ig-key="i0002"/);
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

  it('clears to nothing selected, which is what the control now says it does', () => {
    // THE CORRECTED CONTRACT, MADE EXECUTABLE. The module doc used to promise
    // that clearing "widens the list back", the word field was called
    // `clearFilter`, and the fixture duly labelled the button "show every
    // relationship" — three statements of a behaviour the design does not have,
    // on a button that empties the panel. §17b makes the inspector a projection
    // of the SELECTION, and `none` has no subject to list relationships for.
    const document = backlogOf(3, { edges: [['blocked-by', 'i0001', 'i0002']] });
    const edgeId = edgeIdentity('blocked-by', 'i0001', 'i0002');
    const cleared = selectionReducer({ kind: 'edge', edgeId }, { kind: 'clear' });
    const result = renderWorkspace(document, { ...WORDS, selection: cleared });

    assert.deepEqual(result.view.inspector.subject, { kind: 'none' });
    assert.deepEqual(result.view.inspector.relationships, []);
    assert.match(result.markup, /pick a row to inspect it/);
  });

  it('renders the clear control whenever there is a selection to clear', () => {
    // THE CONDITION IT ALWAYS WANTED. It was drawn only while `view.filtered`
    // was true — an EDGE selection — so a reader who had selected an issue had
    // no way back to nothing selected, on a control whose own doc says it
    // "returns to nothing selected" and whose command is `clear`. Both
    // selections are a selection; only `none` is not.
    const document = backlogOf(3, { edges: [['blocked-by', 'i0001', 'i0002']] });
    const filtered = renderWorkspace(document, {
      ...WORDS,
      selection: { kind: 'edge', edgeId: edgeIdentity('blocked-by', 'i0001', 'i0002') },
    });
    const issue = renderWorkspace(document, { ...WORDS, selection: { kind: 'issue', key: 'i0001' } });
    assert.match(filtered.markup, /clear the selection/);
    assert.match(issue.markup, /clear the selection/);
    // And absent where pressing it would do nothing: `INITIAL_SELECTION` is
    // already `none`, so a clear there is a control that cannot complete the
    // act it advertises.
    assert.equal(/clear the selection/.test(renderWorkspace(document, WORDS).markup), false);
  });

  it('names the panel, whatever is selected', () => {
    // UNCONDITIONAL. The zone used to open with whatever the selection resolved
    // to, so a reader who had selected nothing met a bare sentence in an
    // unnamed column.
    const document = backlogOf(3, { edges: [['blocked-by', 'i0001', 'i0002']] });
    for (const selection of [
      undefined,
      { kind: 'issue', key: 'i0001' } as const,
      { kind: 'edge', edgeId: edgeIdentity('blocked-by', 'i0001', 'i0002') } as const,
    ]) {
      // READ OFF THE FIXTURE, NEVER SPELLED HERE. The words object is the
      // whole subject of the assertion — that the panel draws what it was
      // GIVEN — so a literal here would pass on a renderer that ignored the
      // input and wrote the same string itself, which is exactly what a
      // fixture reading `inspector: 'inspector'` made undetectable.
      assert.ok(
        inspectorOf(renderWorkspace(document, { ...WORDS, selection }).markup).includes(
          `<h2 class="ig-inspector-name">${WORKSPACE_WORDS.inspector}</h2>`,
        ),
        String(selection?.kind),
      );
    }
  });
});

describe('a relationship row says what it is, and which way round', () => {
  // AE1's three shapes on one subject: an OUTGOING directed edge, a SYMMETRIC
  // one, and an INCOMING directed edge. `together-with` needs its members in one
  // slot or layer 1 drops the edge as undrawable, which is why `i0003` is folded
  // into `i0001`'s unit rather than left as its own row.
  const document = backlogOf(5, {
    unitOf: { i0003: 'i0001' },
    edges: [
      ['blocked-by', 'i0001', 'i0002'],
      ['together-with', 'i0001', 'i0003'],
      ['duplicate-of', 'i0004', 'i0001'],
    ],
  });
  const panel = inspectorOf(
    renderWorkspace(document, { ...WORDS, selection: { kind: 'issue', key: 'i0001' } }).markup,
  );

  it('words an outgoing edge from the subject\u2019s end, and draws the other end', () => {
    const row = rowFor(panel, 'blocked-by');
    assert.match(row, /data-direction="outgoing"/);
    assert.match(row, /<span class="ig-glyph" aria-hidden="true">\u2298<\/span><span>blocked by<\/span>/);
    assert.match(row, /<span class="ig-relationship-ref">i0002<\/span>/);
    // AND NOT THE SUBJECT BACK. The row used to draw the field's machine name
    // and BOTH endpoints, one of which is the issue whose panel this is.
    assert.equal(/ig-relationship-ref">i0001</.test(row), false, 'the row draws the subject back');
  });

  it('words an INCOMING edge with the reverse verb, never the forward one', () => {
    // THE DISCRIMINATING ASSERTION OF THE WHOLE ROW. `duplicate-of` from #i0004
    // to #i0001 means i0001 is the DUPLICATED one; a row that drew the forward
    // label here would assert the exact opposite of the relationship, and
    // `data-direction` — which is published and was drawn by nothing — is not a
    // fix a reader can apply in their head.
    const row = rowFor(panel, 'duplicate-of');
    assert.match(row, /data-direction="incoming"/);
    assert.match(row, /<span class="ig-glyph" aria-hidden="true">\u2261<\/span><span>duplicated by<\/span>/);
    assert.match(row, /<span class="ig-relationship-ref">i0004<\/span>/);
    assert.equal(/>duplicate of</.test(row), false, 'the inbound row took the forward label');
  });

  it('claims no direction for a symmetric kind, at either end', () => {
    // `together-with` states one fact whichever way round it is stored, so
    // there is no reverse verb to take and no direction to publish.
    const row = rowFor(panel, 'together-with');
    assert.equal(/data-direction/.test(row), false, 'a symmetric edge claimed a direction');
    assert.match(row, /<span class="ig-glyph" aria-hidden="true">\u29c9<\/span><span>together with<\/span>/);
    assert.match(row, /<span class="ig-relationship-ref">i0003<\/span>/);

    // BOTH ENDS, AND THE FIXTURE HAS TO ALLOW TWO. "At either end" was asserted
    // above against `together-with`, whose members must share ONE slot or layer
    // 1 drops the edge — so the second subject was a unit PARTNER, which
    // `inspectorView` canonicalizes back to the lead. Both renders were the
    // identical panel, and the assertion could not fail however the `to` end
    // was worded. `serialize-with` is symmetric and needs no unit folding, so
    // `i0002` is a genuinely different subject: its row draws the other
    // reference, and a direction read off the stored order would surface here
    // as `data-direction` and as an `inbound` marker in place of the remove.
    const pair = backlogOf(4, { edges: [['serialize-with', 'i0001', 'i0002']] });
    const ends = ['i0001', 'i0002'].map((key) =>
      rowFor(
        inspectorOf(renderWorkspace(pair, { ...WORDS, selection: { kind: 'issue', key } }).markup),
        'serialize-with',
      ),
    );
    const [fromEnd = '', toEnd = ''] = ends;
    assert.match(fromEnd, /<span class="ig-relationship-ref">i0002<\/span>/);
    assert.match(toEnd, /<span class="ig-relationship-ref">i0001<\/span>/, 'the two ends render one panel');
    for (const end of ends) {
      assert.equal(/data-direction/.test(end), false, end);
      assert.match(end, /<span class="ig-glyph" aria-hidden="true">\u21c4<\/span><span>serialized with<\/span>/);
      // NO DIRECTION MEANS NO INBOUND SLOT EITHER. A symmetric edge read as
      // incoming loses its remove control, which is the visible half of the
      // same defect and the half a reader would report.
      assert.match(end, /class="ig-relationship-remove"/, end);
    }
  });

  it('gives an inbound row no remove control, and every other row one', () => {
    // AN INBOUND EDGE'S FIELD IS IN THE OTHER ISSUE'S BODY, so this panel's
    // subject cannot declare it away. The slot carries the word instead.
    const inbound = rowFor(panel, 'duplicate-of');
    assert.equal(/ig-relationship-remove/.test(inbound), false, 'an inbound row offers a remove');
    assert.match(inbound, /<span class="ig-relationship-inbound">declared elsewhere<\/span>/);

    for (const field of ['blocked-by', 'together-with']) {
      assert.match(rowFor(panel, field), /class="ig-relationship-remove"/, field);
    }
  });

  it('addresses the remove control at its OWN row, and names it as an attribute', () => {
    // THE GLYPH CARRIES NO NAME. `✕` announces as whatever a screen reader's
    // character table calls it, so it is hidden and the host's word is the
    // button's `aria-label` — on the BUTTON, because a span takes the generic
    // role and ARIA prohibits naming one.
    const row = rowFor(panel, 'together-with');
    // COMPARED AS A STRING, NOT AS A PATTERN. `edgeIdentity` joins with `|`,
    // which is ALTERNATION inside a RegExp — so the same assertion written as
    // `new RegExp(...)` decomposes into several alternatives and passes on the
    // shortest of them. A mutation test caught it: dropping `aria-hidden` from
    // the glyph left the pattern version green. This file already records the
    // same trap once, on the canvas's edge ids.
    assert.ok(
      row.includes(
        `<button type="button" class="ig-relationship-remove" data-ig-command="delete" data-ig-target="${edgeIdentity('together-with', 'i0001', 'i0003')}" aria-label="unlink this row"><span class="ig-glyph" aria-hidden="true">\u2715</span></button>`,
      ),
      row,
    );
    // EACH ROW NAMES A DIFFERENT EDGE, which is the property a per-row control
    // needs and the one a selection-addressed delete cannot have.
    const targets = [
      ...listOf(panel).matchAll(/data-ig-command="delete" data-ig-target="([^"]+)"/g),
    ].map((match) => match[1]);
    assert.deepEqual(targets, [
      edgeIdentity('blocked-by', 'i0001', 'i0002'),
      edgeIdentity('together-with', 'i0001', 'i0003'),
    ]);
  });

  it('marks the selected row as selected, and gives it no remove', () => {
    // The package's own state name, from `treatmentForState` — the same word the
    // canvas's halo is announced with. A `selected` on the words object would be
    // a second spelling of one the overlay grammar already publishes.
    const selected = inspectorOf(
      renderWorkspace(document, {
        ...WORDS,
        selection: { kind: 'edge', edgeId: edgeIdentity('blocked-by', 'i0001', 'i0002') },
      }).markup,
    );
    const row = rowFor(selected, 'blocked-by');
    assert.match(row, /<span class="ig-relationship-state" data-ig-state="selected">selected<\/span>/);
    assert.equal(/ig-relationship-remove/.test(row), false);
    // WITH NO ISSUE SUBJECT THERE IS NO "OTHER END", so both are drawn and the
    // kind takes its plain forward wording.
    //
    // AND EACH END IS NAMED. Order alone would leave which reference is which
    // to be inferred, which is exactly what §17b's statement exists to stop —
    // `directionSpec` published these two roles before the statement became
    // this row, and the row publishes them now.
    assert.match(row, /<span>blocked by<\/span><\/span><span class="ig-relationship-ref" data-ig-role="from">i0001<\/span><span class="ig-relationship-ref" data-ig-role="to">i0002<\/span>/);
  });

  it('states an empty list rather than drawing none', () => {
    // AE5. The heading with nothing under it reads as a list that failed to
    // load, rather than as an issue that is genuinely related to nothing.
    const alone = inspectorOf(
      renderWorkspace(backlogOf(3), { ...WORDS, selection: { kind: 'issue', key: 'i0002' } }).markup,
    );
    assert.match(alone, /<p class="ig-inspector-none">nothing is related to this<\/p>/);
    assert.equal(/ig-relationship-list/.test(alone), false, 'an empty list was still drawn');
    // AND NOT TWICE OVER. With nothing selected the panel already says so once,
    // in its own words; adding "nothing is related to this" under it would state
    // one absence in two registers on the render where nothing has been asked.
    const nothing = inspectorOf(renderWorkspace(backlogOf(3), WORDS).markup);
    assert.match(nothing, /pick a row to inspect it/);
    assert.equal(/ig-inspector-none/.test(nothing), false);
  });
});

describe('the create path begins in the panel, and its digits are the keyboard\u2019s', () => {
  const document = backlogOf(4, { edges: [['blocked-by', 'i0001', 'i0002']] });
  const selection = { kind: 'issue', key: 'i0001' } as const;
  const draft = { source: 'i0001', target: null, kind: null } as const;

  it('draws + add for an issue, and nothing to add from with no subject', () => {
    // THE CONTROL PUBLISHES ITS SUBJECT, exactly as a row's remove control
    // does. `reduceHost`'s `add` arm read the raw selection while the panel
    // around it is worded from the slot LEAD, so a together-unit partner drew
    // one issue's panel and began a relationship from another.
    assert.ok(
      inspectorOf(renderWorkspace(document, { ...WORDS, selection }).markup).includes(
        '<button type="button" class="ig-inspector-addbutton" data-ig-command="add" data-ig-target="i0001">begin a relationship</button>',
      ),
      inspectorOf(renderWorkspace(document, { ...WORDS, selection }).markup),
    );
    // `reduceHost`'s `add` reads `selectedKey`, which answers `null` for an edge
    // selection and for none — so the control would publish an act that cannot
    // complete.
    for (const without of [
      undefined,
      { kind: 'edge', edgeId: edgeIdentity('blocked-by', 'i0001', 'i0002') } as const,
    ]) {
      assert.equal(
        /data-ig-command="add"/.test(renderWorkspace(document, { ...WORDS, selection: without }).markup),
        false,
      );
    }
  });

  it('numbers the kind list from the table the keyboard reads', () => {
    // AE2, OVER THE MARKUP. Both expectations are derived from `EDGE_FIELDS`,
    // never from `KIND_KEYS` — a comparison against the table the renderer walks
    // would be true however that table was built.
    const panel = inspectorOf(renderWorkspace(document, { ...WORDS, selection, draft }).markup);
    const digits = [...panel.matchAll(/<span class="ig-kind-digit">([^<]*)<\/span>/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(digits, EDGE_FIELDS.map((_, index) => String(index + 1)));
    const kinds = [...panel.matchAll(/data-ig-command="kind" data-ig-value="([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(kinds, [...EDGE_FIELDS]);
    // AND THE ENTRY IS WORDED BY THE EDGE VOCABULARY, so an entry and the row it
    // becomes read the same. The picker's `kinds` record is a different
    // register — worded to sit inside a clause — and using it here would put two
    // wordings of one kind on one screen.
    assert.match(panel, /<span class="ig-kind-digit">1<\/span><span class="ig-glyph" aria-hidden="true">\u2298<\/span><span>blocked by<\/span>/);
  });

  it('shows one step at a time, and none of it while a canvas drop is in flight', () => {
    const stepped = inspectorOf(renderWorkspace(document, { ...WORDS, selection, draft }).markup);
    // `+ add` BEGINS a draft, and `create/draft.ts` makes `begin` reset the kind
    // and the target — so a reader mid-draft offered it again would silently
    // discard the slot they had just filled.
    assert.equal(/data-ig-command="add"/.test(stepped), false, 'add is drawn beside its own list');

    // TWO CHOOSERS WRITING TO ONE DRAFT is what the shell's own drop guard
    // prevented while it drew both of them; the panel now restates it for the
    // half it draws.
    const dropped = inspectorOf(
      renderWorkspace(document, { ...WORDS, selection, draft, drop: { x: 40, y: 50 } }).markup,
    );
    assert.equal(/ig-kind-list/.test(dropped), false, 'the panel list appeared beside a floating one');

    // The target step is the shell's — a live input over the reader's query,
    // which a markup-only renderer cannot be.
    const typed = inspectorOf(
      renderWorkspace(document, {
        ...WORDS,
        selection,
        draft: { source: 'i0001', target: null, kind: 'blocked-by' },
      }).markup,
    );
    assert.equal(/ig-kind-list/.test(typed), false);
    assert.equal(/data-ig-command="add"/.test(typed), false);
  });

  it('draws the kind step under a panel that is NOT its source, and says whose it is', () => {
    // THE DEFECT THIS PINS, AND IT WAS INTRODUCED BY THE FIX ABOVE IT. `pointed`
    // diverts a click to the draft only once a KIND has been chosen, so at the
    // kind step a click anywhere else moves the selection and leaves
    // `draft.source` where it was — and `R` on a together unit's non-lead member
    // begins a draft from the member while the panel is canonicalized onto the
    // slot's lead, so the two diverge with no click at all. Withholding the list
    // there left the reader a LIVE draft with no pointer route to it: no
    // choices, and no cancel, because the cancel sits with the list. The shell
    // draws no chooser at this step either — its floating one needs a drop and
    // its target search needs a kind — so "the shell's cancel still reaches it"
    // was false.
    const diverged = inspectorOf(
      renderWorkspace(document, {
        ...WORDS,
        selection: { kind: 'issue', key: 'i0004' },
        draft,
      }).markup,
    );
    assert.match(diverged, /ig-kind-list/, 'the reader cannot see the choices');
    assert.match(
      diverged,
      /<button type="button" class="ig-inspector-cancel" data-ig-command="cancel">abandon the draft<\/button>/,
      'the reader cannot abandon the draft with a pointer',
    );

    // AND IT NAMES THE SOURCE, which is what makes drawing it honest: the panel
    // is headed by `i0004` and the write would go out from `i0001`. The phrase
    // is the host's and the reference is the package's, as the why-rank
    // sentence's unit clause already is.
    assert.match(
      diverged,
      /<p class="ig-inspector-source">the draft starts at <span class="ig-id">i0001<\/span><\/p>/,
    );

    // `+ add` IS NOT DRAWN BESIDE IT. It does not cancel a draft, it RESETS one
    // — `begin` clears the kind and the target — so on a panel that is not the
    // source it silently moves the write to whatever the reader is looking at.
    assert.equal(/data-ig-command="add"/.test(diverged), false, 'a reset wearing the label of a start');
  });

  it('keeps a live draft cancellable on a panel with no subject at all', () => {
    // `reconcileHost` REACHES THIS. It clears a selection whose issue a landed
    // write removed and leaves a draft begun from a DIFFERENT issue standing,
    // because that draft's own references are all still in the document — so
    // the panel resolves to `none` with a live draft under it. Guarding the
    // whole create step on `subject.kind === 'issue'` took the choices and the
    // cancel away there too.
    const orphaned = inspectorOf(renderWorkspace(document, { ...WORDS, draft }).markup);
    assert.match(orphaned, /ig-kind-list/);
    assert.match(orphaned, /data-ig-command="cancel"/);
    assert.match(
      orphaned,
      /<p class="ig-inspector-source">the draft starts at <span class="ig-id">i0001<\/span><\/p>/,
    );
    // `+ add` IS STILL WITHHELD, and for its own reason rather than this one:
    // `reduceHost`'s `add` arm answers `null` with nothing selected, so the
    // control could not complete the act it advertises.
    assert.equal(/data-ig-command="add"/.test(orphaned), false);
  });

  it('offers a way out of the draft it opened, and names no source on its own panel', () => {
    // A DRAFT THE READER CANNOT ABANDON is worse than one they cannot start —
    // `create/keys.ts` says so for the keyboard, and the pointer path lost its
    // own cancel when the step moved out of the shell's chooser.
    const own = inspectorOf(renderWorkspace(document, { ...WORDS, selection, draft }).markup);
    assert.match(
      own,
      /<button type="button" class="ig-inspector-cancel" data-ig-command="cancel">abandon the draft<\/button>/,
    );
    // THE SOURCE LINE IS ONLY FOR THE DIVERGED CASE. On the source's own panel
    // it would name the issue whose heading is directly above it — the same
    // fact twice, in two registers.
    assert.equal(/ig-inspector-source/.test(own), false, 'the panel names its own subject back');
  });
});

describe('a refused relationship is drawn where the reader was building it', () => {
  const document = backlogOf(4, {
    edges: [
      ['blocked-by', 'i0001', 'i0002'],
      ['blocked-by', 'i0001', 'i0003'],
    ],
  });
  const refused = edgeIdentity('blocked-by', 'i0001', 'i0002');

  it('draws the store\u2019s code and the host\u2019s word, and keeps the other rows', () => {
    // AE3. `would-cycle` is the refusal this package family cannot detect for
    // itself — it comes from the host's guard — so it arrives only after the
    // reader has committed to the relationship, and before this the panel they
    // had just used said nothing about it at all.
    const panel = inspectorOf(
      renderWorkspace(document, {
        ...WORDS,
        selection: { kind: 'issue', key: 'i0001' },
        refusals: [{ edgeId: refused, code: 'would-cycle', carrier: 'i0001', phantom: true }],
      }).markup,
    );
    const capsule = panel.slice(
      panel.indexOf('<li class="ig-relationship-refused"'),
      panel.indexOf('</li>', panel.indexOf('<li class="ig-relationship-refused"')),
    );
    // THE CODE IS THE STORE'S VOCABULARY VERBATIM, so a host styles or counts
    // refusals without matching a sentence.
    assert.match(capsule, /data-ig-code="would-cycle"/);
    assert.match(capsule, /<span class="ig-relationship-reason">that would close a loop<\/span>/);
    // THE WORD IS KEYED OFF THE CODE, not one message for every refusal.
    assert.equal(/that field holds one reference/.test(capsule), false);
    // The relationship it was about is still named, so the reader knows which
    // edit was refused — as a DESCRIPTION, not as a control. See the suite
    // below for the control half.
    assert.match(
      capsule,
      /<span class="ig-relationship-name"><span class="ig-relationship-kind"><span class="ig-glyph" aria-hidden="true">⊘<\/span><span>blocked by<\/span><\/span><span class="ig-relationship-ref">i0002<\/span><\/span>/,
    );

    // AND IT IS NOT ALSO AN ORDINARY ROW. A refused edit is not a relationship:
    // listing it beside the real ones would assert one the document does not
    // have, with a `✕` offering to remove something that was never added.
    assert.equal(
      panel.includes(
        `<li class="ig-relationship" data-edge="blocked-by" data-direction="outgoing"><button type="button" class="ig-relationship-select" data-ig-command="select-edge" data-ig-target="${refused}"`,
      ),
      false,
      'the refused edge is listed as an ordinary row as well',
    );
    // The subject's other relationship is untouched.
    const survivor = rowFor(panel, 'blocked-by');
    assert.ok(
      survivor.includes(`data-ig-target="${edgeIdentity('blocked-by', 'i0001', 'i0003')}"`),
      survivor,
    );
  });

  it('draws no capsule when nothing was refused', () => {
    const panel = inspectorOf(
      renderWorkspace(document, { ...WORDS, selection: { kind: 'issue', key: 'i0001' } }).markup,
    );
    assert.equal(/ig-relationship-refused/.test(panel), false);
    assert.equal(/data-ig-code/.test(panel), false);
  });

  it('still says so for a refusal the host\u2019s document does not carry', () => {
    // §17b's rule has two halves — never snapped back, and never silently
    // dropped — and the second one fails quietly. The store draws a refused
    // create as a phantom so a surface can mark it, but that reaches the
    // renderer only through the HOST's projection: a host projecting landed
    // edges alone hands us a code and nothing to word it against.
    const panel = inspectorOf(
      renderWorkspace(backlogOf(4), {
        ...WORDS,
        selection: { kind: 'issue', key: 'i0001' },
        refusals: [{ edgeId: edgeIdentity('blocked-by', 'i0001', 'i0009'), code: 'unknown-issue', carrier: 'i0001', phantom: true }],
      }).markup,
    );
    assert.match(panel, /<li class="ig-relationship-refused" data-ig-code="unknown-issue">/);
    assert.match(panel, /that issue is not in this backlog/);
  });

  it('draws a refusal about another pair on nobody\u2019s panel but its own', () => {
    // THE OTHER HALF OF "NEVER SILENTLY DROPPED", and the one it was traded
    // for. `refusals` is one list for the whole surface, and an unmatched
    // refusal was appended to EVERY panel — so a `would-cycle` between two
    // issues the reader is not looking at was stated under the heading of one
    // that has nothing to do with it.
    //
    // THE FIXTURE HAS EDGES, WHICH THE FIRST VERSION OF THIS TEST DID NOT. A
    // document with no relationships cannot tell "the panel drew nothing
    // because the refusal was filtered" from "the panel drew nothing because
    // there was nothing to draw"; `i0001` here has a row of its own, so the
    // capsule's absence is about the capsule.
    const elsewhere = edgeIdentity('blocked-by', 'i0005', 'i0006');
    const panel = inspectorOf(
      renderWorkspace(
        backlogOf(6, {
          edges: [
            ['blocked-by', 'i0001', 'i0002'],
            ['blocked-by', 'i0005', 'i0006'],
          ],
        }),
        {
          ...WORDS,
          selection: { kind: 'issue', key: 'i0001' },
          refusals: [{ edgeId: elsewhere, code: 'would-cycle', carrier: 'i0005', phantom: true }],
        },
      ).markup,
    );
    assert.equal(/ig-relationship-refused/.test(panel), false, 'another pair\u2019s refusal');
    assert.equal(/that would close a loop/.test(panel), false);
    // The subject's own row is still there, so the filter narrowed rather than
    // emptied.
    assert.ok(rowFor(panel, 'blocked-by').includes(edgeIdentity('blocked-by', 'i0001', 'i0002')));
  });

  it('states a refusal carried by a together unit\u2019s PARTNER on the unit\u2019s panel', () => {
    // THE DIVERGENCE THE PANEL CANNOT SEE FROM AN EDGE. `inspectorView` folds a
    // together unit onto its slot's LEAD and words the whole panel from it, so
    // a reader working from a PARTNER — `R` on a non-lead member begins a draft
    // from that member — makes an edit whose edge names the partner while the
    // panel around them is headed by the lead. Asked "does this edge name my
    // subject", the answer is no, and the reason the edit was refused was
    // stated on no panel at all.
    //
    // THE REFUSED EDGE NAMES NEITHER END OF THE PANEL'S SUBJECT, deliberately:
    // this pins the carrier rather than a coincidence of endpoints. The unit's
    // members are what the panel speaks for, and `unitPartners` is
    // `inspectorView`'s own record of them.
    const unit = backlogOf(6, {
      edges: [['blocked-by', 'i0001', 'i0004']],
      unitOf: { i0002: 'i0001' },
    });
    const partnerEdge = edgeIdentity('blocked-by', 'i0002', 'i0003');
    const options = {
      ...WORDS,
      refusals: [{ edgeId: partnerEdge, code: 'would-cycle' as const, carrier: 'i0002', phantom: true }],
    };
    for (const key of ['i0001', 'i0002']) {
      // EITHER SELECTION, ONE PANEL. Both canonicalize onto the lead, so this
      // is the same render twice — which is exactly the point: the reader who
      // selected the partner and the reader who selected the lead are looking
      // at one panel, and the refusal belongs on it whichever way they got there.
      const panel = inspectorOf(
        renderWorkspace(unit, { ...options, selection: { kind: 'issue', key } }).markup,
      );
      assert.match(panel, /<li class="ig-relationship-refused" data-ig-code="would-cycle"/, key);
      assert.match(panel, /that would close a loop/, key);
    }
    // AND NOWHERE ELSE. `i0004` is at the other end of the lead's own
    // relationship, so its panel lists a row and is not empty for a reason
    // unrelated to the filter.
    const elsewhere = inspectorOf(
      renderWorkspace(unit, { ...options, selection: { kind: 'issue', key: 'i0004' } }).markup,
    );
    assert.equal(/ig-relationship-refused/.test(elsewhere), false, 'a partner\u2019s refusal on another panel');
    assert.ok(rowFor(elsewhere, 'blocked-by').includes(edgeIdentity('blocked-by', 'i0001', 'i0004')));
  });

  it('reports the LAST refusal on an edge, in the order the list arrives', () => {
    // ONE ROW STATES ONE REASON, and the reader can be refused twice on one
    // relationship. The last is the one they just caused; the first is one they
    // have read and moved past. The collapse is `Map`'s repeated-key rule over
    // this list, so the list's ORDER is load-bearing — which is why the option
    // is a list and not a map a caller has already collapsed.
    const document_ = backlogOf(4, { edges: [['blocked-by', 'i0001', 'i0002']] });
    const landed_ = edgeIdentity('blocked-by', 'i0001', 'i0002');
    const both = [
      { edgeId: landed_, code: 'unknown-edge' as const, carrier: 'i0001', phantom: false },
      { edgeId: landed_, code: 'duplicate-edge' as const, carrier: 'i0001', phantom: false },
    ];
    const panel = inspectorOf(
      renderWorkspace(document_, {
        ...WORDS,
        selection: { kind: 'issue', key: 'i0001' },
        refusals: both,
      }).markup,
    );
    const row = rowFor(panel, 'blocked-by');
    assert.match(row, /data-ig-code="duplicate-edge"/);
    assert.match(row, /that relationship is already declared/);
    assert.equal(/that relationship is already gone/.test(panel), false, 'the older reason');
    // REVERSED, THE OTHER ONE WINS — so this measures the rule rather than the
    // fixture's happening to end on the code being asserted.
    const reversed = inspectorOf(
      renderWorkspace(document_, {
        ...WORDS,
        selection: { kind: 'issue', key: 'i0001' },
        refusals: [...both].reverse(),
      }).markup,
    );
    assert.match(rowFor(reversed, 'blocked-by'), /data-ig-code="unknown-edge"/);
  });

  it('draws no capsule at all where there is no subject to draw one for', () => {
    // WITH NOTHING SELECTED THE PANEL SAYS SO, AND SAYS NOTHING ELSE. An
    // unfiltered append put the capsule under "pick a row to inspect it" — and
    // because the list was then non-empty, it also suppressed the stated empty
    // line that renders exactly when there is nothing to list.
    const document = backlogOf(4, { edges: [['blocked-by', 'i0001', 'i0002']] });
    const refusals = [
      { edgeId: edgeIdentity('blocked-by', 'i0001', 'i0002'), code: 'would-cycle' as const, carrier: 'i0001', phantom: true },
    ];
    const nothing = inspectorOf(renderWorkspace(document, { ...WORDS, refusals }).markup);
    assert.equal(/ig-relationship-refused/.test(nothing), false, 'a capsule with nothing selected');
    assert.match(nothing, /pick a row to inspect it/);

    // AND NOT FOR AN EDGE SELECTION EITHER, unless the refusal is about the one
    // edge on show: the panel is one relationship, and a refusal about a
    // different one is not part of it.
    const otherEdge = inspectorOf(
      renderWorkspace(backlogOf(6, {
        edges: [
          ['blocked-by', 'i0001', 'i0002'],
          ['blocked-by', 'i0005', 'i0006'],
        ],
      }), {
        ...WORDS,
        selection: { kind: 'edge', edgeId: edgeIdentity('blocked-by', 'i0001', 'i0002') },
        refusals: [
          { edgeId: edgeIdentity('blocked-by', 'i0005', 'i0006'), code: 'would-cycle' as const, carrier: 'i0005', phantom: true },
        ],
      }).markup,
    );
    assert.equal(/ig-relationship-refused/.test(otherEdge), false);
  });
});

describe('a refusal about a relationship that EXISTS keeps the relationship', () => {
  // The codes that mark a landed edge — `duplicate-edge`, `unchanged-kind`,
  // `symmetric-edge` — refuse an edit ABOUT an edge rather than an edge into
  // being. `store/validity.ts` marks the original for a retype or flip whose
  // result has the identity it started from, and `project` folds a refused
  // duplicate create onto the edge it duplicates.
  const document = backlogOf(4, { edges: [['blocked-by', 'i0001', 'i0002']] });
  const landed = edgeIdentity('blocked-by', 'i0001', 'i0002');
  const panel = inspectorOf(
    renderWorkspace(document, {
      ...WORDS,
      selection: { kind: 'issue', key: 'i0001' },
      refusals: [{ edgeId: landed, code: 'duplicate-edge', carrier: 'i0001', phantom: false }],
    }).markup,
  );

  it('keeps the row, its selector and its remove control', () => {
    // THE DEFECT THIS PINS. With the capsule replacing the row for every code,
    // "that relationship is already declared" took the declared relationship
    // off the panel — so the reader was told about an edge and left with no
    // control on any surface that could remove it.
    const row = rowFor(panel, 'blocked-by');
    assert.ok(row.includes(`data-ig-command="select-edge" data-ig-target="${landed}"`), row);
    assert.ok(
      row.includes(`class="ig-relationship-remove" data-ig-command="delete" data-ig-target="${landed}"`),
      row,
    );
    assert.equal(/ig-relationship-refused/.test(panel), false, 'the row was replaced by a capsule');
  });

  it('attaches the reason and the store\u2019s code to that row', () => {
    const row = rowFor(panel, 'blocked-by');
    assert.match(row, /<li class="ig-relationship" data-edge="blocked-by" data-direction="outgoing" data-ig-code="duplicate-edge">/);
    assert.match(row, /<span class="ig-relationship-reason">that relationship is already declared<\/span>/);
  });

  it('still replaces the row for a refusal about an edge that does not exist', () => {
    // The other half of the same question, on one fixture, so the two answers
    // cannot drift: `phantom` is what separates them and nothing else is.
    const phantom = inspectorOf(
      renderWorkspace(document, {
        ...WORDS,
        selection: { kind: 'issue', key: 'i0001' },
        refusals: [{ edgeId: landed, code: 'would-cycle', carrier: 'i0001', phantom: true }],
      }).markup,
    );
    assert.match(phantom, /<li class="ig-relationship-refused" data-ig-code="would-cycle"/);
    assert.equal(
      /class="ig-relationship-remove"/.test(phantom),
      false,
      'a remove control for an edge that was never added',
    );
  });

  it('gives a phantom capsule no select-edge, while the landed refusal keeps one', () => {
    // THE OTHER CONTROL ON THE SAME CAPSULE. `phantom` withheld the `✕` from the
    // start and the capsule went on reusing the row's HEAD, which is itself a
    // `select-edge` — so a refused create whose phantom survives normalization
    // published a live selector for an edge the LANDED document does not carry.
    // Under `mountWorkspace` that click selects the phantom and the next
    // render's `reconcileHost` drops the selection again, so the control closes
    // the inspector instead of inspecting anything.
    //
    // ONE FIXTURE, BOTH ANSWERS, so `phantom` stays the only thing separating
    // them: the same edge, the same subject, the same list.
    const phantom = inspectorOf(
      renderWorkspace(document, {
        ...WORDS,
        selection: { kind: 'issue', key: 'i0001' },
        refusals: [{ edgeId: landed, code: 'would-cycle', carrier: 'i0001', phantom: true }],
      }).markup,
    );
    assert.equal(
      /data-ig-command="select-edge"/.test(phantom),
      false,
      'a selector for an edge the document does not carry',
    );
    // AND THE DESCRIPTION SURVIVES, so this withheld the control rather than the
    // fact: a capsule that names no relationship tells the reader nothing about
    // which edit was refused.
    assert.match(phantom, /<span class="ig-relationship-name">/);
    assert.match(phantom, /<span class="ig-relationship-ref">i0002<\/span>/);
    // The landed half is unchanged on the very same fixture.
    assert.ok(
      rowFor(panel, 'blocked-by').includes(
        `data-ig-command="select-edge" data-ig-target="${landed}"`,
      ),
    );
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

  it('reports every occurrence, and the zones add nothing', () => {
    // BOTH HALVES, because they are what replaced a dedupe that was correct
    // when it was added and wrong two commits later.
    //
    // Half one: a single pass emits one diagnostic PER OCCURRENCE, so two
    // identical self-edges are two facts about how malformed the input is —
    // a count a host acts on, and one a `Set` silently halved.
    const twice = {
      ...backlogOf(4),
      edges: [
        { field: 'blocked-by' as const, from: 'i0001', to: 'i0001' },
        { field: 'blocked-by' as const, from: 'i0001', to: 'i0001' },
      ],
    };
    const result = renderWorkspace(twice, WORDS);
    assert.equal(
      result.diagnostics.filter((one) => one.includes('self-edge')).length,
      2,
      result.diagnostics.join(' | '),
    );

    // Half two, and it is what makes dropping the dedupe safe rather than a
    // regression: the zones receive an already-normalized document, so they
    // contribute nothing and there is no cross-zone duplication left to guard
    // against. Asserted as EQUALITY with the one pass that drops things.
    const single = {
      ...backlogOf(4),
      edges: [{ field: 'blocked-by' as const, from: 'i0001', to: 'ghost' }],
    };
    const one = renderWorkspace(single, WORDS);
    assert.equal(one.diagnostics.length, 1, one.diagnostics.join(' | '));
    assert.match(one.diagnostics[0] ?? '', /ghost/);
  });

  it('is pure: the same inputs twice give the same markup', () => {
    const document = backlogOf(30, { edges: [['blocked-by', 'i0001', 'i0002']] });
    const once = renderWorkspace(document, { ...WORDS, rail: { start: 3, count: 9 } });
    const twice = renderWorkspace(document, { ...WORDS, rail: { start: 3, count: 9 } });
    assert.equal(once.markup, twice.markup);
  });
});

describe('a hold in the inspector carries its cause, and its subject is a control', () => {
  const withHold = (hold: Omit<ViewerHold, 'family'>): ViewerDocument => {
    const base = backlogOf(3, { held: ['i0002'] });
    return {
      ...base,
      order: {
        ...base.order,
        slots: base.order.slots.map((slot) =>
          slot.lead === 'i0002' ? { ...slot, holds: [{ family: 'graph' as const, ...hold }] } : slot,
        ),
      },
      cycles: [],
    };
  };
  const select = selectionReducer({ kind: 'none' }, { kind: 'select-issue', key: 'i0002' });

  it('publishes data-code and data-subject, and a select-issue control naming the holder', () => {
    const { markup } = renderWorkspace(
      withHold({ reason: 'blocked-by i0001 is open', code: 'blocked-by-open', subject: 'i0001' }),
      { words: WORKSPACE_WORDS, selection: select },
    );
    assert.match(
      markup,
      /<li class="ig-inspector-hold" data-family="graph" data-code="blocked-by-open" data-subject="i0001">blocked-by i0001 is open<button type="button" class="ig-inspector-hold-subject" data-ig-command="select-issue" data-ig-target="i0001">i0001<\/button><\/li>/,
    );
  });

  it('omits both attributes and the control when the host stated no cause', () => {
    const { markup } = renderWorkspace(withHold({ reason: 'a blocker is open' }), {
      words: WORKSPACE_WORDS,
      selection: select,
    });
    assert.match(markup, /<li class="ig-inspector-hold" data-family="graph">a blocker is open<\/li>/);
    assert.doesNotMatch(markup, /ig-inspector-hold-subject/);
    assert.doesNotMatch(markup, /data-code=/);
  });

  it('publishes the attribute but no control for a subject the document does not carry', () => {
    const { markup } = renderWorkspace(
      withHold({
        reason: 'blocked-by 99 is unresolvable (fail-safe: blocking)',
        code: 'blocked-by-unresolvable',
        subject: '99',
      }),
      { words: WORKSPACE_WORDS, selection: select },
    );
    assert.match(
      markup,
      /<li class="ig-inspector-hold" data-family="graph" data-code="blocked-by-unresolvable" data-subject="99">blocked-by 99 is unresolvable \(fail-safe: blocking\)<\/li>/,
    );
    assert.doesNotMatch(markup, /ig-inspector-hold-subject/);
  });

  it('publishes the attribute but no control when the subject is the inspected issue itself', () => {
    // A self-block is a groomed-graph defect the reader still reports; the
    // reducer would toggle a re-selection to none, closing the inspector.
    const { markup } = renderWorkspace(
      withHold({ reason: 'blocked-by i0002 is open', code: 'blocked-by-open', subject: 'i0002' }),
      { words: WORKSPACE_WORDS, selection: select },
    );
    assert.match(
      markup,
      /<li class="ig-inspector-hold" data-family="graph" data-code="blocked-by-open" data-subject="i0002">blocked-by i0002 is open<\/li>/,
    );
    assert.doesNotMatch(markup, /ig-inspector-hold-subject/);
  });

  it('publishes the attribute but no control for a partner in the inspected together unit', () => {
    // `inspectorView` canonicalizes a member to its lead, so a control naming
    // the partner would change nothing visible, then clear the selection.
    const base = backlogOf(3, { held: ['i0002'], unitOf: { i0003: 'i0002' } });
    const unit = {
      ...base,
      order: {
        ...base.order,
        slots: base.order.slots.map((slot) =>
          slot.lead === 'i0002'
            ? {
                ...slot,
                holds: [
                  {
                    family: 'graph' as const,
                    reason: 'together member i0003 is not ready (blocked-by i0001 is open)',
                    code: 'together-member-unready',
                    subject: 'i0003',
                  },
                ],
              }
            : slot,
        ),
      },
      cycles: [],
    };
    const { markup } = renderWorkspace(unit, { words: WORKSPACE_WORDS, selection: select });
    assert.match(markup, /data-code="together-member-unready" data-subject="i0003"/);
    assert.doesNotMatch(markup, /ig-inspector-hold-subject/);
  });

  it('the control reduces to the subject being selected, through the shared reducer', () => {
    assert.deepEqual(selectionReducer(select, { kind: 'select-issue', key: 'i0001' }), {
      kind: 'issue',
      key: 'i0001',
    });
  });
});

describe('§17a\'s header names the backlog, whatever else it knows', () => {
  it('renders the zone with no host facts and no audit at all', () => {
    // THE DEFECT THIS CLOSES. The zone used to be `overlay === null ? "" :
    // zone("header", …)`, so the header WAS the audit header and a workspace
    // with no audit input had none — while §17a's header carries five facts of
    // which the audit count is one.
    const result = renderWorkspace(backlogOf(4), WORDS);
    assert.match(result.markup, /data-zone="header"/);
    assert.match(result.markup, /class="ig-workspace-header"/);
  });

  it('omits each fact the host did not state, rather than inventing one', () => {
    const result = renderWorkspace(backlogOf(4), WORDS);
    assert.equal(/ig-workspace-identity/.test(result.markup), false);
    assert.equal(/ig-workspace-firstpass/.test(result.markup), false);
    assert.equal(/class="ig-audit"/.test(result.markup), false);
  });

  it('names the backlog and offers the first pass when the host states them', () => {
    const document: ViewerDocument = {
      ...backlogOf(4),
      host: { identity: 'acme/widgets', firstPass: 'First pass' },
    };
    const result = renderWorkspace(document, WORDS);
    assert.match(result.markup, /<span class="ig-workspace-identity">acme\/widgets<\/span>/);
    // PUBLISHED AND NOT WIRED, like `refresh` beside it: whether a backlog has a
    // first pass to run is the host's answer, and running it is the host's job.
    assert.match(result.markup, /data-ig-command="first-pass"/);
  });

  it('drops an empty string as absent, so no chip is drawn with nothing in it', () => {
    const document: ViewerDocument = {
      ...backlogOf(4),
      host: { identity: '', firstPass: '' },
    };
    const result = renderWorkspace(document, WORDS);
    assert.equal(/ig-workspace-identity/.test(result.markup), false);
    assert.equal(/ig-workspace-firstpass/.test(result.markup), false);
  });
});

describe('the workspace draws the host facts in the rail', () => {
  it('renders the summary line and the NOW row from the projection the host supplied', () => {
    const document: ViewerDocument = {
      ...backlogOf(8),
      host: {
        concurrencyCap: 2,
        counts: { ranked: 8, readyNow: 8, held: 0 },
        running: [{ key: 'i0003', phase: 'Review', elapsed: '12m' }],
        freshness: { asOf: '14:32', age: '2m ago', refresh: 'refresh' },
      },
    };
    const result = renderWorkspace(document, WORDS);
    const railAt = result.markup.indexOf('data-zone="rail"');
    const canvasAt = result.markup.indexOf('data-zone="canvas"');
    assert.ok(railAt !== -1 && canvasAt > railAt, 'the rail zone does not precede the canvas');
    const rail = result.markup.slice(railAt, canvasAt);
    assert.match(rail, /<span class="ig-count-chip" data-count="ready">8 ready now · cap 2<\/span>/);
    assert.match(rail, /<li class="ig-now-row" data-ig-group="i0003"/);
    assert.match(rail, /data-ig-command="refresh"/);
    // Once in the workspace: the canvas draws no header of its own.
    assert.equal((result.markup.match(/class="ig-header"/g) ?? []).length, 1);
  });
});

/**
 * The recovery card's rules that only the RENDERER can be asked about.
 *
 * Each of these was measured surviving the mount suite: a mutation that broke
 * it left all 883 tests green, so the behaviour was shipped on the strength of
 * a comment. They are pinned here rather than in `mount.test.ts` because each
 * is a property of what `renderWorkspace` draws from a given input.
 */
describe('§17b: the recovery card narrows, discloses and never doubles', () => {
  const CONFLICT: WorkspaceRecovery = {
    kind: 'conflict',
    mutationId: 'm1',
    edgeId: 'blocked-by|i0001|i0002',
    carrier: 'i0001',
    refreshError: null,
    diff: {
      // ONE SIDE ON THIS PANEL AND ONE FAR AWAY. Without the far one, dropping
      // the narrowing entirely changes nothing an assertion could see.
      upstreamOnly: [
        { id: 'blocked-by|i0001|i0003', kind: 'blocked-by', from: 'i0001', to: 'i0003' },
        { id: 'blocked-by|i0005|i0006', kind: 'blocked-by', from: 'i0005', to: 'i0006' },
      ],
      mineOnly: [],
      mineRemoved: [],
      issuesChanged: [],
      carrierReversed: [],
    },
  };

  // SIX ISSUES WITH THE PANEL'S EDGE AMONG THEM, so a narrowing assertion has
  // both a near reference and a far one to tell apart.
  const BACKLOG = backlogOf(6, {
    edges: [
      ['blocked-by', 'i0001', 'i0002'],
      ['blocked-by', 'i0005', 'i0006'],
    ],
  });

  const drawn = (options: Parameters<typeof renderWorkspace>[1]): string =>
    renderWorkspace(BACKLOG, options).markup;

  it('shows only the part of a difference this panel is entitled to', () => {
    // MEASURED: dropping `diffWithin` at the call site left every test green,
    // and a panel then drew upstream changes about issues elsewhere in the
    // backlog — which also makes `diffEmpty` meaningless, since it can only be
    // true of a NARROWED difference.
    const markup = drawn({
      words: WORKSPACE_WORDS,
      selection: { kind: 'issue', key: 'i0001' },
      diffOpen: 'm1',
      recoveries: [CONFLICT],
    });
    // READ OFF THE DIFF REGION, NOT THE WHOLE SURFACE. `i0005` is also a rail
    // row on this backlog, so a document-wide search finds it either way and
    // the assertion would be vacuous in the direction that matters.
    const region = /<div class="ig-recovery-diff"[\s\S]*?<\/div><\/li>/.exec(markup)?.[0];
    assert.ok(region !== undefined, 'the difference region was not drawn');
    assert.ok(region.includes('i0003'), 'the panel’s own upstream change is missing');
    assert.equal(
      region.includes('i0005'),
      false,
      'a change about an issue this panel does not speak for was drawn',
    );
  });

  it('discloses the difference as a region, not as a pressed button', () => {
    // `aria-pressed` announces a two-state button and says nothing about the
    // region that appeared; a disclosure needs `aria-expanded` and a control
    // that names what it opened.
    const shut = drawn({
      words: WORKSPACE_WORDS,
      selection: { kind: 'issue', key: 'i0001' },
      recoveries: [CONFLICT],
    });
    assert.match(shut, /data-ig-command="view-diff"[^>]*aria-expanded="false"/);
    assert.equal(shut.includes('aria-pressed'), false, 'a disclosure announced as a toggle');

    const open = drawn({
      words: WORKSPACE_WORDS,
      selection: { kind: 'issue', key: 'i0001' },
      diffOpen: 'm1',
      recoveries: [CONFLICT],
    });
    assert.match(open, /aria-expanded="true"/);
    // THE CONTROL NAMES THE REGION, and the region carries that id — an
    // `aria-controls` pointing at nothing is worse than none at all.
    const controls = /aria-controls="([^"]+)"/.exec(open)?.[1];
    assert.ok(controls !== undefined, 'the control names no region');
    assert.ok(open.includes(`id="${controls}"`), 'the region it names is not there');
  });

  it('draws a carrier-less write once, even on the panel filtered to its edge', () => {
    // MEASURED: two identical cards, two tab stops, and two buttons carrying
    // one write's id. `statedHere`'s EDGE arm matches on `edgeId` and ignores
    // the carrier, so the unplaced region drew it a second time.
    const markup = drawn({
      words: WORKSPACE_WORDS,
      selection: { kind: 'edge', edgeId: 'blocked-by|i0001|i0002' },
      recoveries: [
        {
          kind: 'failed',
          mutationId: 'm2',
          edgeId: 'blocked-by|i0001|i0002',
          carrier: null,
          reason: 'the tracker was unreachable',
        },
      ],
    });
    assert.equal((markup.match(/class="ig-recovery"/g) ?? []).length, 1);
    assert.equal((markup.match(/data-ig-target="m2"/g) ?? []).length, 2, 'retry and discard, once each');
  });

  it('draws a carrier-less write in the unplaced region when no panel states it', () => {
    // THE REGION ITSELF HAD NO TEST: deleting it left every test green, and it
    // is the one the code calls Done-when 1 failing where it matters most.
    const markup = drawn({
      words: WORKSPACE_WORDS,
      selection: { kind: 'issue', key: 'i0001' },
      recoveries: [
        {
          kind: 'failed',
          mutationId: 'm3',
          edgeId: 'blocked-by|gone|alsogone',
          carrier: null,
          reason: 'the tracker was unreachable',
        },
      ],
    });
    assert.ok(markup.includes(WORKSPACE_WORDS.recovery.unplaced), 'the unplaced heading is missing');
    assert.equal((markup.match(/class="ig-recovery"/g) ?? []).length, 1);
    // AND IT KEEPS ITS CONTROLS, which is the whole reason it is drawn at all.
    assert.equal((markup.match(/data-ig-target="m3"/g) ?? []).length, 2);
  });

  it('says a conflicted delete removes something, rather than that nothing differs', () => {
    const markup = drawn({
      words: WORKSPACE_WORDS,
      selection: { kind: 'issue', key: 'i0001' },
      diffOpen: 'm4',
      recoveries: [
        {
          kind: 'conflict',
          mutationId: 'm4',
          edgeId: 'blocked-by|i0001|i0002',
          carrier: 'i0001',
          refreshError: null,
          diff: {
            upstreamOnly: [],
            mineOnly: [],
            mineRemoved: [
              { id: 'blocked-by|i0001|i0002', kind: 'blocked-by', from: 'i0001', to: 'i0002' },
            ],
            issuesChanged: [],
            carrierReversed: [],
          },
        },
      ],
    });
    assert.ok(markup.includes(WORKSPACE_WORDS.recovery.mineRemoved));
    assert.equal(
      markup.includes(WORKSPACE_WORDS.recovery.diffEmpty),
      false,
      'the card claimed nothing differs about an edit that removes a relationship',
    );
  });
});

/**
 * §17b's flip, on the published surface rather than only on the mount.
 *
 * THE STATEMENT IS NOT UNDER TEST HERE, and that is the finding this block was
 * written after. `relationshipDescription`'s `subject === null` arm already
 * draws the kind and both references in stored order for an edge selection, so
 * the sentence §17b asks for has shipped since the panel had rows at all. What
 * had not shipped is the control beside it: `renderPicker` drew the flip, the
 * mount composed the picker, and a host wiring `renderWorkspace`'s published
 * attributes got nothing. These cases pin the control and leave the sentence to
 * the row tests above, so the panel keeps ONE statement.
 */
describe("§17b's flip control is published markup, not mount chrome", () => {
  /**
   * A backlog whose one edge is of the kind under test.
   *
   * `together-with` NEEDS THE UNIT, and the exception is layer 1's rather than
   * this suite's: `normalizeDocument` drops a `together-with` the order does not
   * group, because no row could draw it. Without the unit the fixture hands
   * every case a document whose edge does not survive normalization, the
   * selection resolves to `none`, and the symmetric cases pass by the panel
   * being empty rather than by the control being withheld.
   */
  const edgeOf = (field: EdgeField) =>
    backlogOf(4, {
      edges: [[field, 'i0001', 'i0002']],
      ...(field === 'together-with' ? { unitOf: { i0002: 'i0001' } } : {}),
    });
  const selectionOf = (field: EdgeField) => ({
    kind: 'edge' as const,
    edgeId: edgeIdentity(field, 'i0001', 'i0002'),
  });

  /**
   * THE WHOLE VOCABULARY, so a sixth field gets a case for free. The split is
   * read off the format rather than listed here, which is the same rule the
   * picker's own suite states: a local list of directed kinds would be the
   * second implementation that goes quietly wrong when the format grows.
   */
  for (const field of EDGE_FIELDS) {
    const directed = !isSymmetricEdgeField(field);

    it(`${directed ? 'offers' : 'withholds'} the flip for ${field}`, () => {
      const panel = inspectorOf(
        renderWorkspace(edgeOf(field), { ...WORDS, selection: selectionOf(field) }).markup,
      );
      assert.equal(
        panel.includes('data-ig-command="flip"'),
        directed,
        directed
          ? 'a directed selection published no flip'
          : 'a symmetric selection published a flip there is no direction to reverse',
      );
      // THE SENTENCE IS PRESENT EITHER WAY. A symmetric kind loses the control
      // and keeps the statement — the absence is of an act, never of the fact.
      assert.match(panel, new RegExp(`>${labelFrom(treatmentFor(field), true)}<`));
    });
  }

  it('puts the flip in the selected row, beside the statement it reverses', () => {
    const panel = inspectorOf(
      renderWorkspace(edgeOf('blocked-by'), {
        ...WORDS,
        selection: selectionOf('blocked-by'),
      }).markup,
    );
    const row = rowFor(panel, 'blocked-by');
    // IN THE ROW, not beside the list. Frame 17b draws the control at the end
    // of the statement's own line; a control one element away from the sentence
    // it acts on is the ambiguity §17b exists to remove.
    assert.match(row, /data-ig-command="flip"/);
    // AND AT THE ROW'S END, which membership alone does not say. The frame puts
    // `⇅ flip` last on the statement's line, and the flip reaches that position
    // by being drawn last rather than by a margin — so the position IS the
    // draw order, and this is the assertion that sees it move.
    assert.match(row, /<button type="button" class="ig-relationship-flip" data-ig-command="flip">[^<]*<\/button><\/li>$/);
    // The statement it reverses names both its ends, so "which way round" is
    // read rather than inferred from their order.
    assert.match(row, /data-ig-role="from">i0001</);
    assert.match(row, /data-ig-role="to">i0002</);
    // ON A BUTTON. A span carries no tab stop and no native activation, so a
    // command on one is reachable by pointer and by nothing else.
    assert.match(row, /<button type="button" class="ig-relationship-flip" data-ig-command="flip">/);
    // THE STATE MARKER KEEPS ITS PLACE. It names the state the canvas is
    // drawing a halo for; dropping it for directed kinds would leave the
    // marker appearing only on symmetric selections.
    assert.match(row, /data-ig-state="selected"/);
  });

  it('still offers the flip on a selected row a refusal landed on', () => {
    // A REACHABLE COMPOSITION NOTHING ELSE COVERS: one `li` carrying the head,
    // a stated refusal, the `selected` marker AND the flip. `duplicate-edge`,
    // `unchanged-kind` and `symmetric-edge` all mark an edge that is still
    // LANDED, so a refused retype of the very edge the reader has selected puts
    // all four in one row.
    //
    // THE FLIP MUST SURVIVE IT, and stay last. The refusal is about an edit
    // that did not happen; the relationship is still there and still reversible,
    // and withdrawing the corrective act at the moment an edit was refused is
    // exactly when a reader most needs it.
    const edgeId = edgeIdentity('blocked-by', 'i0001', 'i0002');
    const panel = inspectorOf(
      renderWorkspace(edgeOf('blocked-by'), {
        ...WORDS,
        selection: selectionOf('blocked-by'),
        refusals: [{ edgeId, code: 'unchanged-kind', carrier: 'i0001', phantom: false }],
      }).markup,
    );
    const row = rowFor(panel, 'blocked-by');
    assert.match(row, /ig-relationship-reason/, 'the refusal was not stated on the row');
    assert.match(row, /data-ig-state="selected"/);
    assert.match(row, /<button type="button" class="ig-relationship-flip" data-ig-command="flip">[^<]*<\/button><\/li>$/);
  });

  it('draws no flip on a row the reader has not selected', () => {
    // THE REDUCER TAKES ITS EDGE FROM THE SELECTION, so a flip on an unselected
    // row would publish a command about a different edge — or, with an issue
    // selected, about none at all. A control that cannot complete the act it
    // advertises is not drawn.
    const panel = inspectorOf(
      renderWorkspace(edgeOf('blocked-by'), {
        ...WORDS,
        selection: { kind: 'issue', key: 'i0001' },
      }).markup,
    );
    assert.equal(/data-ig-command="flip"/.test(panel), false);
  });

  it('states the relationship once, and words every readable byte from the vocabulary', () => {
    const panel = inspectorOf(
      renderWorkspace(edgeOf('blocked-by'), {
        ...WORDS,
        selection: selectionOf('blocked-by'),
      }).markup,
    );
    // ONE STATEMENT. This is the assertion that fails if a second direction
    // sentence is ever added beside the row — the defect this issue exists to
    // remove, reintroduced by its own fix.
    assert.equal(panel.match(/class="ig-relationship-kind"/g)?.length, 1);

    const treatment = treatmentFor('blocked-by');
    const allowed = new Set([
      treatment.glyph,
      labelFrom(treatment, true),
      'i0001',
      'i0002',
      treatmentForState('selected').label,
      WORKSPACE_WORDS.flip,
    ]);
    const readable = [...rowFor(panel, 'blocked-by').matchAll(/>([^<>]*)</g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((text) => text !== '');
    assert.ok(readable.length > 0, 'the row rendered no readable text at all');
    assert.deepEqual(
      readable.filter((text) => !allowed.has(text)),
      [],
      'the row rendered a word neither the host nor the vocabulary supplied',
    );
    // AND THE HOST'S WORD IS ACTUALLY THERE, so the total claim above cannot
    // pass by the control being absent.
    assert.ok(readable.includes(WORKSPACE_WORDS.flip));
  });

  it('reads directedness from one source, not two', () => {
    // KTD4. The control's EXISTENCE and the row's WORDING both hang off
    // `treatmentFor(field)`; `picker/view.ts` hangs its own answer off
    // `isSymmetricEdgeField`. Nothing else in the repository pins the two to
    // agree, and a package whose stated objection is "not a wrong answer, a
    // second answer" should not have two oracles for one question unpinned.
    for (const field of EDGE_FIELDS) {
      assert.equal(
        treatmentFor(field).symmetric,
        isSymmetricEdgeField(field),
        `the vocabulary and the format disagree about whether ${field} is symmetric`,
      );
    }
  });
});
