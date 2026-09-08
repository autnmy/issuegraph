import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildModel } from '@issuegraph/reader';
import type { NodeInput } from '@issuegraph/reader';
import { makeEdge } from '@issuegraph/store';
import type { EdgeKind, GraphDocument, IssueRef, StoredIssue } from '@issuegraph/store';
import { renderMarkup } from '@issuegraph/viewer';

import { AUDIT_CLASSES } from './findings.ts';
import type { AuditClass, AuditGraph } from './findings.ts';
import { AUDIT_KIND_ATTRIBUTE, renderAuditPanel } from './panel.ts';
import type { AuditWords } from './panel.ts';
import { AUDIT_SEVERITY_ATTRIBUTE, auditOverlay } from './surface.ts';
import { auditStylesheet } from './styles.ts';

/**
 * Words no renderer would write.
 *
 * The fixture rule `testing/workspace.ts` records: a word that reads like the
 * one the package would have hard-coded makes its own pin vacuous, because the
 * fixture and the hardcode are the same string.
 */
const WORDS: AuditWords = {
  heading: 'things wrong with the encoding',
  classes: {
    cycle: 'a loop',
    'stale-blocker': 'closed blocker',
    'dead-duplicate-ref': 'dead canonical',
    'encoding-refused': 'unreadable',
  },
  titles: {
    cycle: 'these wait on each other for ever',
    'stale-blocker': 'this waits on something finished',
    'dead-duplicate-ref': 'this is filed against something gone',
    'encoding-refused': 'this declaration could not be read',
  },
  show: 'go and look',
};

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

function overlayOf(
  issues: readonly StoredIssue[],
  edges: readonly (readonly [EdgeKind, IssueRef, IssueRef])[],
  encodingRefused: readonly { readonly ref: IssueRef; readonly diagnostic?: string }[] = [],
) {
  const document = documentOf(issues, edges);
  return auditOverlay({ document, graph: graphOf(document), encodingRefused });
}

/**
 * `known` defaults to every issue in the fixture — the ordinary case, where the
 * surface draws what it audited. The tests that care pass their own.
 */
function markupOf(
  issues: readonly StoredIssue[],
  edges: readonly (readonly [EdgeKind, IssueRef, IssueRef])[],
  encodingRefused: readonly { readonly ref: IssueRef; readonly diagnostic?: string }[] = [],
  known: ReadonlySet<string> = new Set(issues.map((held) => held.ref)),
): string {
  const spec = renderAuditPanel(overlayOf(issues, edges, encodingRefused), {
    words: WORDS,
    known,
  });
  assert.ok(spec !== null, 'the fixture produced no findings, so this proves nothing');
  return renderMarkup(spec);
}

/**
 * One document carrying every class at once.
 *
 * `a → b → c → a` is the cycle; `d` waits on a closed issue; `e` duplicates a
 * closed canonical; `f` is refused. Built as one document rather than four so
 * the ORDER assertion below has something to order.
 */
const EVERY_CLASS = {
  issues: [
    issue('a'),
    issue('b'),
    issue('c'),
    issue('d'),
    issue('e'),
    issue('f'),
    issue('shut', 'closed'),
    issue('canon', 'closed'),
  ],
  edges: [
    ['blocked-by', 'a', 'b'],
    ['blocked-by', 'b', 'c'],
    ['blocked-by', 'c', 'a'],
    ['blocked-by', 'd', 'shut'],
    ['duplicate-of', 'e', 'canon'],
  ],
} as const;

describe('the findings panel', () => {
  it('draws one card per finding, in the class table’s order', () => {
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const kinds = [...markup.matchAll(/<li class="ig-audit-card" data-ig-audit-kind="([^"]+)"/g)].map(
      (match) => match[1] as AuditClass,
    );
    // EVERY class, so a class that stopped being drawn is a failure here rather
    // than a quiet absence in a capture nobody re-reads.
    assert.deepEqual([...kinds].sort(), [...AUDIT_CLASSES].sort());
    // THE TABLE'S ORDER, WHICH `auditOverlay` ALREADY FIXED. Re-sorting in the
    // panel would be a second opinion about severity beside `AUDIT_CLASS_SPECS`.
    const rank = (kind: AuditClass) => AUDIT_CLASSES.indexOf(kind);
    assert.deepEqual(
      kinds,
      [...kinds].sort((left, right) => rank(left) - rank(right)),
      kinds.join(','),
    );
  });

  it('never puts the rail’s severity attribute on a chip', () => {
    // `audit/styles.ts` ends with an UNQUALIFIED `[data-ig-audit]` rule, on
    // purpose — it lands on a row the viewer rendered and this layer may not
    // rewrite that row's class. So a chip wearing the same attribute would draw
    // the rail's 2px gold left-bar whatever hue its class was given, and all
    // four chips would agree in gold. This is the pin for that.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    for (const chip of markup.matchAll(/<span class="ig-audit-chip"[^>]*>/g)) {
      // THE `=` IS PART OF THE NEEDLE, and it has to be: `data-ig-audit-kind`
      // CONTAINS `data-ig-audit`, so a bare substring test passes on the very
      // attribute the chip is supposed to carry and proves nothing either way.
      assert.equal(
        (chip[0] as string).includes(`${AUDIT_SEVERITY_ATTRIBUTE}="`),
        false,
        `a chip carries ${AUDIT_SEVERITY_ATTRIBUTE}: ${chip[0] as string}`,
      );
      assert.match(chip[0] as string, new RegExp(AUDIT_KIND_ATTRIBUTE));
    }
    // AND THE STYLESHEET HUES WHAT THE CHIP ACTUALLY CARRIES. A rule keyed on an
    // attribute the markup stopped writing is green about a string.
    for (const kind of AUDIT_CLASSES) {
      assert.match(
        auditStylesheet,
        new RegExp(`\\.ig-audit-chip\\[${AUDIT_KIND_ATTRIBUTE}='${kind}'\\]`),
        `no chip rule for ${kind}`,
      );
    }
  });

  it('escapes host text rather than trusting it', () => {
    // THE WHOLE CHANGE TURNS ON HOST TEXT REACHING MARKUP. `surface.ts` may
    // concatenate by hand because only a COUNT reaches it; a `detail` is prose
    // about issues a host supplied, and the ref inside it is a host value too.
    // Proven on both, and proven by rendering — not by asserting that the
    // renderer escapes.
    const hostile = '"><script>alert(1)</script>';
    const markup = markupOf(
      [issue(hostile), issue('shut', 'closed')],
      [['blocked-by', hostile, 'shut']],
    );
    // THE RAW STRING NOWHERE, in text or in an attribute value. Testing for
    // `"><` instead would be worthless: an attribute closing a tag before a
    // child element spells that in every well-formed document this draws.
    assert.equal(markup.includes(hostile), false, markup);
    assert.equal(markup.includes('<script'), false, markup);
    assert.match(markup, /&lt;script&gt;/, 'the detail was not escaped');
    assert.match(markup, /data-ig-target="&quot;&gt;&lt;script&gt;/, 'the target was not escaped');
  });

  it('gives every card a keyboard-reachable way to the issue it is about', () => {
    // §17d's rule, from `surface.ts`: "the surface offers navigation and never a
    // remedy". A `button` rather than a styled span, because the a11y baseline's
    // universal rule reads the TAB ORDER and a `tabindex="-1"` control does not
    // pass as reachable. `reveal-issue` rather than `select-issue`, because the
    // latter is a pointer and a pointer mid-draft WRITES — pinned in
    // `workspace/host.test.ts` against the control that does create.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const cards = markup.match(/<li class="ig-audit-card"/g) ?? [];
    // MATCHED ON THE WHOLE TAG rather than on an attribute ADJACENCY: an
    // assertion spelling attributes in one fixed order fails the next time one
    // is added between them, which says nothing about the behaviour it pins.
    const shows = [
      ...markup.matchAll(/<button[^>]*class="ig-audit-show"[^>]*>/g),
    ].map((tag) => {
      const whole = tag[0] as string;
      assert.match(whole, /data-ig-command="reveal-issue"/, whole);
      return /data-ig-target="([^"]+)"/.exec(whole)?.[1];
    });
    // EVERY CARD, because every member of this fixture IS loaded. The one case
    // where a card legitimately has no control has its own test below, so this
    // equality stays an equality rather than softening to "at least one".
    assert.equal(shows.length, cards.length, 'a card has no way out');
    const overlay = overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    // THE TARGET IS THE FINDING'S OWN, not merely some issue in the document —
    // a control that navigated to an unrelated row would satisfy a presence
    // check and mislead every reader who pressed it.
    shows.forEach((target, index) => {
      const finding = overlay.findings[index];
      assert.ok(finding !== undefined);
      assert.ok(
        target !== undefined && finding.members.includes(target as IssueRef),
        `${String(target)} is not a member of the ${finding.kind} finding`,
      );
    });
  });

  it('names each navigation button distinctly, whatever two findings share', () => {
    // THE MODE THAT STRIPS THE CARD. A screen reader's button list shows names
    // and nothing around them, so the name is all a reader has; the ref in
    // `data-ig-target` is not exposed to assistive technology at all.
    //
    // THREE COLLISION SHAPES IN ONE FIXTURE, and the list is the point rather
    // than the count. Three revisions each summarised a finding into its name
    // and each summary collided on a shape the last had not met, so this
    // asserts over ALL of them at once:
    //
    //   1. several findings at all       — the host's word alone collides
    //   2. one issue, two CLASSES        — `a` in the cycle and refused
    //   3. two findings, one class AND one target — `a blocked-by y` and
    //      `a blocked-by z`, two closed blockers on one issue
    //
    // Shape 3 is what defeats "class plus ref", and nothing short of the
    // finding's own sentence separates it.
    const markup = markupOf(
      [
        issue('a'),
        issue('b'),
        issue('c'),
        issue('y', 'closed'),
        issue('z', 'closed'),
      ],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
        ['blocked-by', 'c', 'a'],
        ['blocked-by', 'a', 'y'],
        ['blocked-by', 'a', 'z'],
      ],
      [{ ref: 'a' }],
    );
    const names = [...markup.matchAll(/class="ig-audit-show"[^>]*aria-label="([^"]+)"/g)].map(
      (match) => match[1] as string,
    );
    const targets = [...markup.matchAll(/class="ig-audit-show"[^>]*data-ig-target="([^"]+)"/g)].map(
      (match) => match[1] as string,
    );
    const kinds = [...markup.matchAll(/<li class="ig-audit-card" data-ig-audit-kind="([^"]+)"/g)].map(
      (match) => match[1] as string,
    );
    assert.ok(names.length > 2, 'too few buttons to collide');

    // THE PREMISES, ASSERTED RATHER THAN HOPED FOR. Without these the fixture
    // could stop producing the collisions and this test would go on passing
    // while proving nothing — which is exactly how the ref-only name shipped.
    assert.ok(new Set(targets).size < targets.length, `no shared target: ${targets.join(' | ')}`);
    const pairs = kinds.map((kind, index) => `${kind}\u0000${targets[index] ?? ''}`);
    assert.ok(
      new Set(pairs).size < pairs.length,
      `no two findings share a class AND a target: ${pairs.join(' | ')}`,
    );

    assert.equal(new Set(names).size, names.length, names.join('\n'));
    // THE HOST'S WORD LEADS EVERY ONE, so this cannot pass by dropping the
    // label for a bare sentence the package wrote.
    for (const name of names) assert.ok(name.startsWith(WORDS.show), name);
    // AND THE VISIBLE TEXT IS STILL THE SHORT WORD: the sentence is announced,
    // not drawn twice.
    assert.match(markup, new RegExp(`>${WORDS.show}</button>`));
  });

  it('says how many, in the host’s word, beside the ambient mark', () => {
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const overlay = overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    assert.match(markup, new RegExp(`<span class="ig-audit-panel-count">${overlay.count}</span>`));
    // `h2` BECAUSE THE PANEL IS THE INSPECTOR'S PEER, not its child: it is a
    // sibling in the zone and is drawn FIRST, so an `h3` would announce a level
    // three ahead of the level two it claimed to sit under.
    assert.match(markup, new RegExp(`<h2 class="ig-audit-panel-heading">${WORDS.heading}</h2>`));
    // AND THE SECTION IS NAMED. An unnamed `section` carries no landmark role at
    // all, so a reader navigating by landmark cannot reach the panel.
    assert.match(markup, new RegExp(`<section class="ig-audit-panel" aria-label="${WORDS.heading}"`));
    // THE MARK IS DECORATION. The count and the heading beside it say the same
    // thing in words, so a reader who cannot see the glyph loses nothing and a
    // reader who hears it twice gains nothing.
    assert.match(markup, /<span class="ig-audit-mark" aria-hidden="true">◆<\/span>/);
  });

  it('invents no English of its own', () => {
    // Every drawn word is one of the fixture's. Anything else in the markup's
    // text is a string this package wrote, which is the thing `AuditWords`
    // exists to prevent.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const supplied = new Set<string>([
      WORDS.heading,
      WORDS.show,
      ...Object.values(WORDS.classes),
      ...Object.values(WORDS.titles),
    ]);
    const drawn = [...markup.matchAll(/>([^<>]+)</g)]
      .map((match) => (match[1] as string).trim())
      .filter((text) => text !== '' && text !== '◆' && !/^\d+$/.test(text));
    const overlay = overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    // A `detail` is the DETECTOR's sentence, composed from package values, and
    // it is package-owned prose by decision — recorded in `panel.ts` rather than
    // left as a gap. So it is allowed here explicitly rather than by accident.
    for (const finding of overlay.findings) supplied.add(finding.detail);
    for (const text of drawn) {
      assert.ok(supplied.has(text), `the package wrote "${text}"`);
    }
  });

  it('publishes no navigation for a finding naming no loaded issue', () => {
    // THE PAGING CASE `findings.ts` SUPPORTS ON PURPOSE. A refusal is a fact the
    // HOST asserted about an issue it read, so a finding may name a ref outside
    // the loaded document — `findings.test.ts` pins that it is kept rather than
    // filtered away, "the quiet direction". The FINDING is still worth reading;
    // a button targeting a ref with no rail row is not, because the mount
    // reconciles the unknown selection straight back away and the control
    // advertises a move it cannot make.
    const markup = markupOf([issue('a')], [], [{ ref: 'unloaded' }]);
    assert.match(markup, /ig-audit-card/, 'the finding itself was dropped');
    assert.match(markup, new RegExp(WORDS.classes['encoding-refused']));
    assert.equal(markup.includes('ig-audit-show'), false, markup);
    // THE CONTROL, so this cannot pass by drawing no button anywhere: a refusal
    // on a ref the document DOES carry keeps its way out.
    const loaded = markupOf([issue('a')], [], [{ ref: 'a' }]);
    const tag = /<button[^>]*class="ig-audit-show"[^>]*>/.exec(loaded)?.[0];
    assert.ok(tag !== undefined, loaded);
    assert.match(tag, /data-ig-command="reveal-issue"/);
    assert.match(tag, /data-ig-target="a"/);
  });

  it('publishes no navigation for a ref the DRAWN surface does not carry', () => {
    // AUDITED IS NOT DRAWN. A host audits the repository it holds and renders a
    // page of it — the demo's own projection audits `held` while drawing
    // `landed`, which can be empty — so a ref can be in `AuditInput.document`,
    // have an overlay row, and still reach a view with nothing in it. The
    // overlay cannot see that difference; the caller can, and says so.
    const issues = [issue('a'), issue('b'), issue('c')];
    const edges = [
      ['blocked-by', 'a', 'b'],
      ['blocked-by', 'b', 'c'],
      ['blocked-by', 'c', 'a'],
    ] as const;
    const overlay = overlayOf(issues, edges);
    // THE PREMISE: the overlay DOES carry rows for these refs, so this test is
    // about `known` rather than about an empty audit.
    assert.ok(overlay.rowFor('a') !== undefined, 'the overlay has no row to withhold');
    const drawnNone = markupOf(issues, edges, [], new Set());
    assert.match(drawnNone, /ig-audit-card/, 'the finding itself was dropped');
    assert.equal(drawnNone.includes('ig-audit-show'), false, drawnNone);
    // THE CONTROL, so this cannot pass by drawing no button ever.
    assert.ok(markupOf(issues, edges, [], new Set(['b'])).includes('data-ig-target="b"'));
  });

  it('draws nothing at all when the audit found nothing', () => {
    // UNLIKE THE HEADER COUNT, which is drawn at zero because it IS the control.
    // A list of nothing is a heading over an empty region in a column whose
    // space belongs to the selection.
    const overlay = overlayOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    assert.equal(overlay.count, 0);
    assert.equal(renderAuditPanel(overlay, { words: WORDS, known: new Set(['a', 'b']) }), null);
  });

  it('carries no script, no inline handler and nothing that animates', () => {
    // §17d's ban, in one place: no modal, no toast, no banner, no badge
    // animation. The stylesheet half is asserted here as well as in
    // `styles.test.ts`, because the panel is what would have wanted a
    // transition and the rule has to hold over the sheet as it now stands.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    assert.equal(/<script/i.test(markup), false);
    assert.equal(/\son[a-z]+=/i.test(markup), false, 'an inline handler');
    for (const source of [markup, auditStylesheet]) {
      assert.equal(/@keyframes|animation:|transition:/.test(source), false);
    }
  });
});
