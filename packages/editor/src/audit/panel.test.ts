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

function markupOf(
  issues: readonly StoredIssue[],
  edges: readonly (readonly [EdgeKind, IssueRef, IssueRef])[],
  encodingRefused: readonly { readonly ref: IssueRef; readonly diagnostic?: string }[] = [],
): string {
  const spec = renderAuditPanel(overlayOf(issues, edges, encodingRefused), { words: WORDS });
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
    // pass as reachable.
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const cards = markup.match(/<li class="ig-audit-card"/g) ?? [];
    const shows = [
      ...markup.matchAll(/<button type="button" class="ig-audit-show" data-ig-command="select-issue" data-ig-target="([^"]+)"/g),
    ];
    assert.equal(shows.length, cards.length, 'a card has no way out');
    const overlay = overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    // THE TARGET IS THE FINDING'S OWN, not merely some issue in the document —
    // a control that navigated to an unrelated row would satisfy a presence
    // check and mislead every reader who pressed it.
    shows.forEach((show, index) => {
      const finding = overlay.findings[index];
      assert.ok(finding !== undefined);
      assert.ok(
        finding.members.includes(show[1] as IssueRef),
        `${String(show[1])} is not a member of the ${finding.kind} finding`,
      );
    });
  });

  it('says how many, in the host’s word, beside the ambient mark', () => {
    const markup = markupOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    const overlay = overlayOf(EVERY_CLASS.issues, EVERY_CLASS.edges, [{ ref: 'f' }]);
    assert.match(markup, new RegExp(`<span class="ig-audit-panel-count">${overlay.count}</span>`));
    assert.match(markup, new RegExp(WORDS.heading));
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

  it('draws nothing at all when the audit found nothing', () => {
    // UNLIKE THE HEADER COUNT, which is drawn at zero because it IS the control.
    // A list of nothing is a heading over an empty region in a column whose
    // space belongs to the selection.
    const overlay = overlayOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    assert.equal(overlay.count, 0);
    assert.equal(renderAuditPanel(overlay, { words: WORDS }), null);
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
