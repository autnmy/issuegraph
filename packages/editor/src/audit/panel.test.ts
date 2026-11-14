import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';
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
  heading: { one: 'thing wrong with the encoding', other: 'things wrong with the encoding' },
  titles: {
    cycle: 'these wait on each other for ever',
    'stale-blocker': 'this waits on something finished',
    'dead-duplicate-ref': 'this is filed against something gone',
    'encoding-refused': 'this declaration could not be read',
  },
  filter: 'narrow the list',
  refusedOpen: 'see it upstream',
  remedies: {
    pickEdge: 'choose an edge',
    removeEdge: 'drop it',
    keepAsHistory: 'leave it be',
    repoint: 'point it somewhere',
  },
  refusedRewrite: 'fix it here',
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
  // THE READER'S OWN ANSWER, not a hand-written walk. The panel's whole claim
  // is that it draws what §6.6 decided, so a fixture that invented the ordering
  // would pass while the port was wrong.
  return {
    cycles: model.cycles,
    duplicateCanonical: model.duplicateCanonical,
    cycleWalk: model.cycleWalk,
  };
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
    edges: new Set(edges.map(([field, from, to]) => edgeIdentity(field, from, to))),
    // The same refusals the audit counted, drawn as notes in the panel (#296).
    refusals: encodingRefused,
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

/**
 * The ids of every edge `EVERY_CLASS` declares, as a drawn surface would hold
 * them — minted with `edgeIdentity`, which is what the finding carries and what
 * the host looks one up by. A second spelling here would agree with itself and
 * disagree with both.
 */
const EVERY_EDGE_IDS: ReadonlySet<string> = new Set(
  EVERY_CLASS.edges.map(([field, from, to]) => edgeIdentity(field, from, to)),
);


describe('the findings panel', () => {
  it('draws one card per finding, in the class table’s order', () => {
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const kinds = [...markup.matchAll(/<li class="ig-audit-card" data-ig-audit-kind="([^"]+)"/g)].map(
      (match) => match[1] as AuditClass,
    );
    // EVERY LISTED class, so a class that stopped being drawn is a failure here
    // rather than a quiet absence in a capture nobody re-reads. `encoding-refused`
    // is deliberately not among them: §17d draws it OUTSIDE this panel, because
    // a refusal is surfaced on the issue itself rather than as one entry in a
    // list of relationship problems. `refused.ts` owns it, and `refused.test.ts`
    // pins that it is drawn — so the class cannot fall between the two.
    // EVERY CLASS SINCE #296, the unreadable one included: it is a note in
    // this panel now, as the export draws it, not a block beside it.
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

  it('never puts the rail’s severity attribute on a card', () => {
    // `audit/styles.ts` ends with an UNQUALIFIED `[data-ig-audit]` rule, on
    // purpose — it lands on a row the viewer rendered and this layer may not
    // rewrite that row's class. So a card wearing the same attribute would draw
    // the rail's 2px gold left-bar whatever state it was drawn in.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const cards = [...markup.matchAll(/<li class="ig-audit-card"[^>]*>/g)];
    assert.ok(cards.length > 0, 'no cards were drawn, so this proves nothing');
    for (const card of cards) {
      // THE `=` IS PART OF THE NEEDLE: `data-ig-audit-kind` CONTAINS
      // `data-ig-audit`, so a bare substring test proves nothing either way.
      assert.equal((card[0] as string).includes(`${AUDIT_SEVERITY_ATTRIBUTE}="`), false, card[0] as string);
      assert.match(card[0] as string, new RegExp(AUDIT_KIND_ATTRIBUTE));
    }
  });

  it('draws each finding as the export’s note: a state, a title, a sentence and its remedies (#296)', () => {
    // NO CLASS CHIP, NO WALK LINE AND NO SHOW BUTTON. The export draws each
    // problem as a note in its state, and the state follows the export's rules:
    // a loop is error, a duplicate of a closed issue attention, a closed
    // blocker neutral.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    for (const gone of ['ig-audit-chip', 'ig-audit-walk', 'ig-audit-show']) {
      assert.equal(markup.includes(gone), false, `a note still draws ${gone}`);
    }
    const states = Object.fromEntries(
      [...markup.matchAll(/<li class="ig-audit-card" data-ig-audit-kind="([^"]+)"[^>]*\sdata-s="([^"]+)"/g)].map(
        (match) => [match[1] as string, match[2] as string],
      ),
    );
    assert.deepEqual(states, {
      cycle: 'error',
      'stale-blocker': 'neutral',
      'dead-duplicate-ref': 'attention',
      'encoding-refused': 'attention',
    });
    // AND EACH RELATIONSHIP NOTE IS EXACTLY ITS PARTS, IN ORDER: its state's
    // icon, then the title, the sentence and the remedies. The unreadable note
    // carries its ref and reason where a sentence is; `refused.test.ts` pins it.
    for (const card of markup.split('<li class="ig-audit-card"').slice(1)) {
      if (card.includes('data-ig-audit-kind="encoding-refused"')) continue;
      assert.match(
        card,
        /^[^>]*><svg class="ig-audit-icon"[^>]*>.*?<\/svg><div class="ig-audit-note-text"><p class="ig-audit-title">[^<]+<\/p><p class="ig-audit-detail">[^<]+<\/p>(<div class="ig-audit-remedies">|<\/div><\/li>)/,
        card,
      );
    }
  });

  it('draws one icon per note state, as the export draws them, hidden from a reader (#296)', () => {
    // The alert circle for the error state, the triangle for attention, the
    // clock for neutral. The title says what the note is about, so the icon
    // is decoration.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const iconOf = (kind: string): string =>
      new RegExp(`<li class="ig-audit-card" data-ig-audit-kind="${kind}"[^>]*>(<svg[^>]*>.*?</svg>)`).exec(markup)?.[1] ?? '';
    const ICONS: Readonly<Record<string, RegExp>> = {
      cycle: /<circle cx="12" cy="12" r="10" \/><line x1="12" x2="12" y1="8" y2="12" \/><line x1="12" x2="12.01" y1="16" y2="16" \/>/,
      'dead-duplicate-ref': /<path d="m21\.73 18-8-14a2 2 0 0 0-3\.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1\.73-3" \/><path d="M12 9v4" \/><path d="M12 17h\.01" \/>/,
      'encoding-refused': /<path d="m21\.73 18-8-14a2 2 0 0 0-3\.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1\.73-3" \/>/,
      'stale-blocker': /<circle cx="12" cy="12" r="9" \/><path d="M12 7v5l3 2" \/>/,
    };
    for (const [kind, shape] of Object.entries(ICONS)) {
      const icon = iconOf(kind);
      assert.match(icon, /^<svg class="ig-audit-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">/, `${kind} has no icon`);
      assert.match(icon, shape, `${kind} draws the wrong icon`);
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
    // The remedies' targets are edge identities, which encode the ref; none
    // carries it raw (#296 removed the Show button that targeted the ref).
    assert.match(markup, /data-ig-target="[^"]+"/, 'no remedy was drawn, so the attribute half proves nothing');
    assert.equal(/data-ig-target="[^"]*[<>]/.test(markup), false, 'a target carries markup raw');
  });

  it('names each remedy distinctly, whatever two findings share', () => {
    // THE MODE THAT STRIPS THE CARD. A screen reader's button list shows names
    // and nothing around them, so the name is all a reader has. With the Show
    // button gone (#296) the remedies are the only buttons on a note, and each
    // is named by its word and the finding's own sentence, which cannot
    // collide: two findings with one sentence are one finding.
    //
    // `a blocked-by y` and `a blocked-by z` are two closed blockers on one
    // issue, each with two remedies on one edge.
    const markup = markupOf(
      [issue('a'), issue('b'), issue('c'), issue('y', 'closed'), issue('z', 'closed')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
        ['blocked-by', 'c', 'a'],
        ['blocked-by', 'a', 'y'],
        ['blocked-by', 'a', 'z'],
      ],
      [{ ref: 'a' }],
    );
    const names = [...markup.matchAll(/class="ig-audit-remedy"[^>]*aria-label="([^"]+)"/g)].map((match) => match[1] as string);
    const targets = [...markup.matchAll(/class="ig-audit-remedy"[^>]*data-ig-target="([^"]+)"/g)].map((match) => match[1] as string);
    assert.ok(names.length > 2, 'too few buttons to collide');
    // THE PREMISE: two remedies share a target, so a target-based name collides.
    assert.ok(new Set(targets).size < targets.length, `no shared target: ${targets.join(' | ')}`);
    assert.equal(new Set(names).size, names.length, names.join('\n'));
    const labels = Object.values(WORDS.remedies);
    for (const name of names) assert.ok(labels.some((label) => name.startsWith(label)), name);
  });

  it('says how many, in the host’s word, beside the ambient mark', () => {
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const overlay = overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    // ONE COUNT, THE HEADER'S (#296). The title counted its own cards while the
    // header counted every finding, so the header read "6 problems" over "5
    // problems to fix". The export keeps one count, which includes
    // relationships that could not be read.
    const drawn = [...markup.matchAll(/<li class="ig-audit-card"/g)].length;
    // ONE TITLE WITH THE COUNT INSIDE IT (#288), as the export's "3 problems to
    // fix": the count leads the host's words within the same heading.
    assert.match(
      markup,
      new RegExp(`<h2 class="ig-audit-panel-heading"><span class="ig-audit-panel-count">${overlay.count}</span> ${WORDS.heading.other}</h2>`),
    );
    // AND THE REFUSAL IS ONE OF THE NOTES (#296), so the count and the notes
    // agree.
    assert.equal(overlay.count, drawn, markup);
    // `h2` BECAUSE THE PANEL IS THE INSPECTOR'S PEER, not its child: it sits in
    // the audit region above the selection detail, so an `h3` would announce a
    // level three ahead of the level two it claimed to sit under. The refused
    // block beside it is an `h2` for the same reason.
    // AND THE SECTION IS NAMED. An unnamed `section` carries no landmark role at
    // all, so a reader navigating by landmark cannot reach the panel.
    assert.match(markup, new RegExp(`<section class="ig-audit-panel" aria-label="${WORDS.heading.other}"`));
    // THE PANEL IS A TAB STOP. It was the scroll container while #177's bound
    // sat on this element; the bound and the scrolling belong to the audit
    // region now, so what keeps the stop is the second reason alone — its cards
    // cannot be relied on to carry the keyboard into it: `cardSpec` draws its navigation control only for a
    // member the drawn document holds, so an audit naming only issues outside
    // the loaded page renders no button and leaves the scroller with no
    // focusable descendant at all. Browsers disagree about putting a generic
    // scroll container in the tab order, so it is declared rather than assumed.
    assert.match(markup, /<section class="ig-audit-panel"[^>]*\stabindex="0"/);
    // THE HEAD DRAWS NO MARK. The export's head row holds only the title and
    // the filter button; a glyph beside a title that names no state is
    // decoration.
    assert.doesNotMatch(markup, /ig-audit-mark|◆/);
  });

  it('invents no English of its own', () => {
    // Every drawn word is one of the fixture's. Anything else in the markup's
    // text is a string this package wrote, which is the thing `AuditWords`
    // exists to prevent.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const supplied = new Set<string>([
      WORDS.heading.other,
      ...Object.values(WORDS.titles),
      // §17d's REMEDY LABELS ARE THE HOST'S TOO. This guard caught them the
      // moment they shipped, which is the guard working: the labels are real
      // sentences and the frame's own copy is tempting to hard-code.
      ...Object.values(WORDS.remedies),
      // §17d's filter entry point moved into the panel head, so its word is
      // the panel's to draw now too.
      WORDS.filter,
      // AN UNREADABLE NOTE IS IN THE PANEL SINCE #296: its rewrite control is
      // the host's word, and its ref the host's value.
      WORDS.refusedRewrite,
      'f',
    ]);
    const drawn = [...markup.matchAll(/>([^<>]+)</g)]
      .map((match) => (match[1] as string).trim())
      .filter((text) => text !== '' && !/^\d+$/.test(text));
    const overlay = overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    // A `detail` is the DETECTOR's sentence, composed from package values, and
    // it is package-owned prose by decision — recorded in `panel.ts` rather than
    // left as a gap. So it is allowed here explicitly rather than by accident.
    for (const finding of overlay.findings) supplied.add(finding.detail);
    for (const text of drawn) {
      assert.ok(supplied.has(text), `the package wrote "${text}"`);
    }
  });

  it('lists an unreadable relationship as a note, counted in the one count (#296)', () => {
    // THE EXPORT'S PANEL holds every problem, relationships that could not be
    // read included, and counts them all. It was a block of its own beside the
    // panel, under a heading of its own.
    //
    // BOTH SHAPES, because they fail differently. A refusal on a ref the
    // document carries, and one on a ref outside it: the paging case
    // `findings.ts` keeps on purpose. Each is a note either way.
    const loaded = markupOf([issue('a'), issue('b'), issue('shut', 'closed')],
      [['blocked-by', 'a', 'shut']], [{ ref: 'b' }, { ref: 'nowhere-near-this-page' }]);
    assert.equal([...loaded.matchAll(/data-ig-audit-kind="encoding-refused"/g)].length, 2, loaded);
    assert.match(loaded, /<span class="ig-audit-panel-count">3<\/span>/);
    // AND THE FIXTURE IS NOT VACUOUS: the stale blocker beside them still drew.
    assert.match(loaded, /data-ig-audit-kind="stale-blocker"/);
    // NO BLOCK OF ITS OWN, AND NO HEADING OF ITS OWN.
    assert.equal(/ig-audit-refused(?:"|-heading|-list)/.test(loaded), false, loaded);

    // A DOCUMENT WHOSE ONLY FINDING IS A REFUSAL KEEPS ITS TITLE, with the note
    // under it.
    const overlay = overlayOf([issue('a')], [], [{ ref: 'a' }]);
    assert.equal(overlay.count, 1, 'the fixture produced no finding, so this proves nothing');
    const alone = renderAuditPanel(overlay, {
      words: WORDS,
      known: new Set(['a']),
      edges: new Set<string>(),
      refusals: [{ ref: 'a' }],
    });
    assert.ok(alone !== null, 'one unreadable finding drew no panel, so no title');
    const markup = renderMarkup(alone);
    // AND THE ONE FORM OF THE HOST'S WORDS (#296): "1 problem to fix", never
    // "1 problems to fix", and the section is named the same way.
    assert.match(markup, new RegExp(`<span class="ig-audit-panel-count">1</span> ${WORDS.heading.one}</h2>`));
    assert.match(markup, new RegExp(`<section class="ig-audit-panel" aria-label="${WORDS.heading.one}"`));
    assert.equal(markup.includes(WORDS.heading.other), false, 'one finding read in the plural');
    assert.match(markup, /<ul class="ig-audit-list"><li class="ig-audit-card" data-ig-audit-kind="encoding-refused"/);
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
    assert.equal(drawnNone.includes('data-ig-target'), false, drawnNone);
    // THE CONTROL, so this cannot pass by drawing no button ever: with the loop
    // on the page its remedy names its head.
    assert.ok(markupOf(issues, edges, [], new Set(['a', 'b', 'c'])).includes('data-ig-remedy="pick-edge"'));
  });

  it('draws nothing at all when the audit found nothing', () => {
    // UNLIKE THE HEADER COUNT, which is drawn at zero because it IS the control.
    // A list of nothing is a heading over an empty region in a column whose
    // space belongs to the selection.
    const overlay = overlayOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    assert.equal(overlay.count, 0);
    assert.equal(
      renderAuditPanel(overlay, {
        words: WORDS,
        known: new Set(['a', 'b']),
        edges: new Set<string>(),
      }),
      null,
    );
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

describe('§17d — a loop’s note draws no walk line (#296)', () => {
  it('draws the title, the sentence and the remedy, and no walk, even where the reader named one', () => {
    // The export's note is a title, one sentence and its remedies. The walk
    // line, `10 → 9 → 100 → 10`, is not among them, so it is no longer drawn;
    // the finding still carries `walk`, and the remedy still names its head.
    const markup = markupOf(
      [issue('10'), issue('9'), issue('100')],
      [
        ['blocked-by', '10', '9'],
        ['blocked-by', '9', '100'],
        ['blocked-by', '100', '10'],
      ],
    );
    assert.equal(markup.includes('ig-audit-walk'), false, markup);
    assert.equal(markup.includes(' → '), false, markup);
    assert.match(markup, /data-ig-remedy="pick-edge"/);
  });

  it('escapes a ref that looks like markup in the sentence', () => {
    const nasty = '<img src=x>' as IssueRef;
    const markup = markupOf(
      [issue(nasty), issue('b')],
      [
        ['blocked-by', nasty, 'b'],
        ['blocked-by', 'b', nasty],
      ],
    );
    assert.ok(!markup.includes('<img src=x>'), markup);
    assert.ok(markup.includes('&lt;img src=x&gt;'), markup);
  });
});

describe('§17d — the remedies, which select and never write', () => {
  // `RULINGS.md` §3: remedies are REQUIRED and auto-fix is FORBIDDEN, in one
  // breath. The mechanism it names reconciles them — *"Taking a remedy selects
  // the finding's issue or edge and hands the work to the inspector"* — so
  // these tests are mostly about what the buttons are NOT allowed to be.

  const remediesIn = (markup: string): { tag: string; command: string; target: string }[] =>
    [...markup.matchAll(/<button[^>]*class="ig-audit-remedy"[^>]*>/g)].map((match) => {
      const tag = match[0];
      return {
        tag: /data-ig-remedy="([^"]+)"/.exec(tag)?.[1] ?? '',
        command: /data-ig-command="([^"]+)"/.exec(tag)?.[1] ?? '',
        target: /data-ig-target="([^"]+)"/.exec(tag)?.[1] ?? '',
      };
    });

  it('draws the frame’s four remedies, one per class as §17d draws them', () => {
    const found = remediesIn(markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges));
    assert.deepEqual(
      found.map((remedy) => remedy.tag).sort(),
      ['keep-as-history', 'pick-edge', 'remove-edge', 'repoint'],
      'the cycle gets one, the stale blocker two, the dead ref one',
    );
  });

  it('NEVER publishes a writing command — auto-fix is forbidden', () => {
    // THE LOAD-BEARING TEST OF THE THREE. A remedy that could write would make
    // the panel an auto-fix surface whatever its labels said, and the two
    // commands below are the only two that cannot: one selects an edge, the
    // other reveals an issue without the pointer semantics that complete a
    // draft. This asserts the WHOLE set rather than spot-checking, so a fifth
    // remedy added later cannot quietly introduce a third command.
    const found = remediesIn(markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges));
    assert.ok(found.length > 0, 'the premise: remedies were drawn');
    assert.deepEqual(
      [...new Set(found.map((remedy) => remedy.command))].sort(),
      ['reveal-issue', 'select-edge'],
    );
    // `select-issue` IS THE ONE THAT WOULD BITE. With a draft awaiting its
    // target the host reads it as a POINTER and emits a create proposal — so a
    // button meant to remove a relationship would declare one.
    assert.equal(/data-ig-command="select-issue"/.test(markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges)), false);
  });

  it('points each edge remedy at the finding’s own edge', () => {
    const overlay = overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges);
    const edges = new Set(
      overlay.findings
        .filter((finding) => finding.edge !== undefined)
        .map((finding) => finding.edge?.id),
    );
    assert.ok(edges.size > 0, 'the premise: findings named edges');
    for (const remedy of remediesIn(markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges))) {
      if (remedy.command !== 'select-edge') continue;
      assert.ok(edges.has(remedy.target), `${remedy.tag} names an edge no finding has`);
    }
  });

  it('offers Keep as history on the stale blocker alone', () => {
    // Gated on `keepAsHistory`, which the class table sets for that class only.
    // Asserted through the MARKUP rather than the table, so the gate is proven
    // where a reader meets it.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges);
    const cards = markup.split('<li class="ig-audit-card"');
    for (const card of cards.slice(1)) {
      const kind = /data-ig-audit-kind="([^"]+)"/.exec(card)?.[1];
      const keeps = /data-ig-remedy="keep-as-history"/.test(card);
      assert.equal(keeps, kind === 'stale-blocker', `${String(kind)} drew the wrong answer`);
    }
  });

  it('withholds a cycle’s remedy where the reader named no walk', () => {
    // No walk means no defensible head to select, and §17d will not have this
    // package choose which edge a reader should drop.
    const spec = renderAuditPanel(
      {
        ...overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges),
        findings: overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges).findings.map((finding) =>
          finding.kind === 'cycle' ? { ...finding, walk: undefined } : finding,
        ),
      },
      {
        words: WORDS,
        known: new Set(EVERY_CLASS.issues.map((held) => held.ref)),
        edges: EVERY_EDGE_IDS,
      },
    );
    assert.ok(spec !== null);
    const markup = renderMarkup(spec);
    assert.equal(/data-ig-remedy="pick-edge"/.test(markup), false);
    assert.ok(/data-ig-remedy="remove-edge"/.test(markup), 'the other cards are untouched');
  });
});

describe('§17d — a remedy is withheld when its subject is off the drawn page', () => {
  // CODEX FOUND THIS, AND IT IS THE SAME CLASS `Show the loop` WAS BUILT FOR.
  // The audit reads a document that is not always the one on screen — a host
  // audits the whole repository and renders a page of it — so a remedy can name
  // an edge the drawn document does not hold. `select-edge` then resolves to
  // nothing, `reconcileHost` refuses the stale name, and the reader has pressed
  // a button that silently cleared their selection.
  //
  // The navigation control already declined for exactly this reason. The
  // remedies did not, because they were gated on the finding HAVING an edge
  // rather than on the edge being reachable.

  it('draws no remedy at all when the surface carries none of the issues', () => {
    const spec = renderAuditPanel(overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges), {
      words: WORDS,
      known: new Set<string>(),
      edges: new Set<string>(),
    });
    assert.ok(spec !== null, 'the fixture produced no findings, so this proves nothing');
    const markup = renderMarkup(spec);
    assert.equal(/data-ig-remedy=/.test(markup), false, 'a remedy points off the page');
    // THE CARDS THEMSELVES STILL DRAW. A finding about issues the reader cannot
    // reach is still a finding they need told about — it is the CONTROL that is
    // withheld, never the information.
    assert.ok(/ig-audit-card/.test(markup), 'the findings went away with their controls');
  });

  it('asks about the EDGE, not about its ends — the ends no longer gate it', () => {
    // THIS TEST USED TO ASSERT THE ENDPOINT RULE, and the rule was wrong. It
    // read: with only one end drawn, withhold the remedy. True, but it was true
    // by accident of a proxy — see the suite below, where both ends are drawn
    // and the edge still is not.
    //
    // The gate is edge-id membership now, and that SUBSUMES the endpoint
    // question: an edge the surface draws necessarily joins two issues the
    // surface holds. So a `known` that omits an end cannot, by itself, withhold
    // anything — and asserting that it does would be pinning the old proxy.
    const spec = renderAuditPanel(overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges), {
      words: WORDS,
      known: new Set(['d']),
      edges: EVERY_EDGE_IDS,
    });
    assert.ok(spec !== null);
    const markup = renderMarkup(spec);
    assert.ok(
      /data-ig-remedy="remove-edge"/.test(markup),
      'the edge is drawn, so its remedy can complete',
    );
    // AND `known` STILL GOVERNS THE CONTROLS THAT SELECT AN ISSUE. The cycle's
    // remedy names the walk's head, which is not `d`, so it is withheld — the
    // two gates ask different questions because they publish different commands.
    assert.equal(
      /data-ig-remedy="pick-edge"/.test(markup),
      false,
      'an issue-selecting remedy named a ref the surface does not carry',
    );
  });

  it('still draws every remedy when the whole page is there', () => {
    // THE CONTROL CASE, or the two tests above pass against a panel that simply
    // stopped drawing remedies.
    const spec = renderAuditPanel(overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges), {
      words: WORDS,
      known: new Set(EVERY_CLASS.issues.map((held) => held.ref)),
      edges: EVERY_EDGE_IDS,
    });
    assert.ok(spec !== null);
    const tags = [...renderMarkup(spec).matchAll(/data-ig-remedy="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      tags.sort(),
      ['keep-as-history', 'pick-edge', 'remove-edge', 'repoint'],
    );
  });
});

describe('§17d — endpoint presence is not edge presence', () => {
  // THE COUNTEREXAMPLE A SECOND REVIEW ROUND REPRODUCED, and the reason this
  // guard is about the edge rather than about its ends.
  //
  // The first version of the reachability gate asked whether BOTH ENDS were on
  // the drawn page, reasoning that an edge between two drawn issues must itself
  // be drawn. It need not be: `workspace/mount.ts` deliberately preserves a
  // projection that omits edges, so a surface can carry two issues and nothing
  // between them. The remedy then published `select-edge` for an id the host
  // cannot resolve — the selection is cleared and the inspector opens with no
  // subject, which is a button that undoes the reader's place.
  //
  // "Both ends drawn" is a PROXY for "the edge is drawn". They come apart
  // exactly where it matters.

  it('withholds the remedy when both ends are drawn but the edge is not', () => {
    const spec = renderAuditPanel(overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges), {
      words: WORDS,
      // Every issue is on the page …
      known: new Set(EVERY_CLASS.issues.map((held) => held.ref)),
      // … and the surface draws no relationships at all.
      edges: new Set<string>(),
    });
    assert.ok(spec !== null, 'the fixture produced no findings, so this proves nothing');
    const markup = renderMarkup(spec);
    assert.equal(
      /data-ig-remedy="remove-edge"/.test(markup),
      false,
      'a remedy named an edge the surface does not draw',
    );
    assert.equal(/data-ig-remedy="repoint"/.test(markup), false);
    // THE CYCLE'S REMEDY IS UNAFFECTED, and that is correct rather than an
    // oversight: it selects an ISSUE, which is on the page, so it can complete.
    // The two gates ask different questions because they publish different
    // commands.
    assert.ok(
      /data-ig-remedy="pick-edge"/.test(markup),
      'the cycle remedy selects an issue and should survive',
    );
  });

  it('draws the edge remedies once the surface holds those edges', () => {
    // The control case, or the test above passes against a panel that stopped
    // drawing edge remedies entirely.
    const spec = renderAuditPanel(overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges), {
      words: WORDS,
      known: new Set(EVERY_CLASS.issues.map((held) => held.ref)),
      edges: EVERY_EDGE_IDS,
    });
    assert.ok(spec !== null);
    const markup = renderMarkup(spec);
    assert.ok(/data-ig-remedy="remove-edge"/.test(markup));
    assert.ok(/data-ig-remedy="repoint"/.test(markup));
  });
});
