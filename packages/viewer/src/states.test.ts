/**
 * The §16 states, each pinned by what makes it ITSELF.
 *
 * The design's own criterion is that a later refactor must not be able to
 * silently collapse two of these into one, and a per-state assertion cannot
 * make that claim: six tests that each check their own marker is PRESENT all
 * stay green when two states start rendering identically. So the markers that
 * are exclusive to one state are asserted present in that state and ABSENT in
 * every other, as a cross product.
 *
 * TWO KINDS OF ASSERTION, AND MIXING THEM IS THE TRAP. Some things are true in
 * every state by design — the freshness stamp is always drawn, the projection
 * toggle is always offered, no state spins. Cross-producting those would make
 * the suite unsatisfiable on day one, so they are asserted in EVERY row instead,
 * as invariants rather than as discriminators.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HostFacts, ViewerDocument, ViewerIssue } from './document.ts';
import { normalizeDocument } from './document.ts';
import { type RenderOptions, renderViewer } from './render.ts';
import type { Projection } from './scene.ts';

const PROJECTIONS: readonly Projection[] = ['linear', 'graph', 'tree'];

function issue(key: string, extra: Partial<ViewerIssue> = {}): ViewerIssue {
  return { key, title: `Title ${key}`, open: true, priority: 2, ...extra };
}

/** The freshness every state carries. Always present, never a spinner. */
const FRESHNESS = { asOf: '14:32', age: '2m ago', stale: false, refresh: 'refresh' } as const;

const order = {
  slots: [
    { rank: 1, lead: '1', members: ['1'], ready: true, holds: [] },
    { rank: 2, lead: '2', members: ['2'], ready: true, holds: [] },
    { rank: 3, lead: '3', members: ['3'], ready: true, holds: [] },
  ],
  excluded: [],
};

/**
 * A populated document with no row-level caveat on it.
 *
 * THE TWO CHANNELS ARE HELD APART HERE ON PURPOSE. A caveat is a fact about one
 * ROW and a condition is a fact about the PANEL; carrying both on one document
 * would put every caveat marker in every condition state and make the cross
 * product below assert nothing. So the condition states draw over this, and the
 * caveat states draw over `withCaveats`.
 */
const populated: ViewerDocument = {
  issues: [
    issue('1', { priority: 0, provenance: { kind: 'matched-query', index: 1, label: 'label:P0' } }),
    issue('2', { priority: 1, provenance: { kind: 'matched-query', index: 2, label: 'label:P1' } }),
    issue('3', { priority: 3, provenance: { kind: 'matched-query', index: 4, label: 'label:P3' } }),
  ],
  edges: [{ field: 'blocked-by', from: '1', to: '2' }],
  order,
  cycles: [],
};

/** The same order with ONE caveat on it — one document per caveat, for the reason above. */
function withCaveat(index: number, caveat: Partial<ViewerIssue>): ViewerDocument {
  return {
    ...populated,
    issues: populated.issues.map((carried, at) => (at === index ? { ...carried, ...caveat } : carried)),
  };
}

const previewOnlyDocument = withCaveat(1, {
  previewOnly: { note: "query 5 (involves:@me) can't be evaluated locally yet" },
});

const disagreeDocument = withCaveat(2, {
  disagreement: { used: 'label:P1 (your mapping)', ignored: { carrier: 'frontmatter', value: 'priority: 3' } },
});

/** Nothing in the order and nothing to draw — the shape an `empty` host draws over. */
const nothingRanked: ViewerDocument = { ...populated, edges: [], order: { slots: [], excluded: [] } };

const IMPORTING = {
  kind: 'importing',
  headline: 'Building the local index',
  caution: 'The order below is real but incomplete — ranks will change as the rest arrive.',
  progress: '412 of ~1,200 issues · relationships resolve last',
} as const;

const EMPTY = {
  kind: 'empty',
  headline: 'Nothing is eligible right now',
  reason: 'No open issue matches your pick order.',
  assurance: 'The pipeline stays armed and will take the first one that does.',
  action: { label: 'Review pick order' },
} as const;

const ERROR = {
  kind: 'error',
  headline: 'The index could not be read',
  assurance: 'Your settings are safe, and the pipeline continues on its last known order.',
  retry: 'Retry',
} as const;

/**
 * One state the panel can be in: the document and host facts that produce it,
 * and the markup that belongs to it and to nothing else.
 */
interface State {
  readonly name: string;
  readonly document: ViewerDocument;
  readonly host: HostFacts;
  /** Substrings present in THIS state and absent in every other. */
  readonly exclusive: readonly string[];
}

const STATES: readonly State[] = [
  {
    name: 'first import',
    document: populated,
    host: { freshness: FRESHNESS, condition: IMPORTING },
    exclusive: ['data-ig-condition="importing"', IMPORTING.headline, IMPORTING.caution, IMPORTING.progress],
  },
  {
    name: 'empty',
    document: nothingRanked,
    host: { freshness: FRESHNESS, condition: EMPTY },
    exclusive: [
      'data-ig-condition="empty"',
      EMPTY.headline,
      EMPTY.reason,
      EMPTY.assurance,
      'data-ig-command="review-pick-order"',
    ],
  },
  {
    name: 'error',
    document: populated,
    host: { freshness: FRESHNESS, condition: ERROR },
    exclusive: ['data-ig-condition="error"', ERROR.headline, ERROR.assurance, 'data-ig-command="retry:index"'],
  },
  {
    name: 'preview-only',
    document: previewOnlyDocument,
    host: { freshness: FRESHNESS },
    exclusive: ['data-caveat="preview-only"'],
  },
  {
    name: 'signals disagree',
    document: disagreeDocument,
    host: { freshness: FRESHNESS },
    // The design's guarantee here is not which signal wins — that is the
    // owner's call — but that the LOSER STAYS VISIBLE. The strike is the pin.
    exclusive: ['data-caveat="disagree"'],
  },
  {
    name: 'zero adoption',
    document: { ...populated, edges: [] },
    host: {
      freshness: FRESHNESS,
      adoption: {
        note: {
          text: 'No issue in this repository declares relationships, so ordering is entirely your pick order.',
          link: { text: 'what relationships add', href: 'https://issuegraph.org/' },
          dismiss: '✕',
        },
      },
    },
    exclusive: ['class="ig-adoption"', 'data-ig-command="dismiss:adoption"'],
  },
];

function draw(state: State, projection: Projection, options: RenderOptions = {}): string {
  return renderViewer({ ...state.document, host: state.host }, { projection, switchable: true, ...options }).markup;
}

describe('the §16 states', () => {
  it('draws each state’s own markers and NONE of any other state’s', () => {
    // THE CROSS PRODUCT IS THE POINT. Presence alone cannot catch a collapse;
    // two states that started rendering the same would both stay green.
    for (const projection of PROJECTIONS) {
      for (const state of STATES) {
        const markup = draw(state, projection);
        for (const marker of state.exclusive) {
          assert.ok(markup.includes(marker), `${projection}/${state.name} is missing its own ${marker}`);
        }
        for (const other of STATES) {
          if (other.name === state.name) continue;
          for (const marker of other.exclusive) {
            if (state.exclusive.includes(marker)) continue;
            assert.ok(
              !markup.includes(marker),
              `${projection}/${state.name} carries ${other.name}’s marker ${marker}`,
            );
          }
        }
      }
    }
  });

  it('keeps the stamp present and the panel never busy, in every state and projection', () => {
    // ALWAYS PRESENT, NEVER A SPINNER — the design states it as an absolute, so
    // it is asserted in every row rather than made one state’s discriminator.
    for (const projection of PROJECTIONS) {
      for (const state of STATES) {
        const markup = draw(state, projection);
        assert.ok(markup.includes('class="ig-freshness"'), `${projection}/${state.name} lost the stamp`);
        assert.ok(markup.includes('14:32'), `${projection}/${state.name} lost the as-of time`);
        for (const busy of ['aria-busy', 'ig-spinner', 'role="progressbar"']) {
          assert.ok(!markup.includes(busy), `${projection}/${state.name} drew ${busy}`);
        }
      }
    }
  });

  it('carries no rate-limit countdown in any state — the state was deleted, not restyled', () => {
    // PINNED OVER THE RENDERED MARKUP, not over the source. This package retired
    // a regex-over-source scan and wrote down why (`purity.test.ts`); a scan for
    // these words would also match the file asserting them. What the design
    // actually promises is about what a reader sees, so that is what is read.
    for (const projection of PROJECTIONS) {
      for (const state of STATES) {
        const markup = draw(state, projection);
        assert.ok(!/rate.?limit/i.test(markup), `${projection}/${state.name} names a rate limit`);
        assert.ok(!/retry in \d/i.test(markup), `${projection}/${state.name} draws a retry countdown`);
      }
    }
  });

  it('draws the host’s cause statement INSTEAD of its own, never both', () => {
    // The defect this rule exists for: the package's own empty sentence is
    // DERIVED — it is what an empty slot list looks like from in here — and the
    // graph's version names relationships, so an unreadable index would be
    // explained to the reader as a document that declares no edges.
    //
    // EACH PROJECTION IS FED THE DOCUMENT THAT MAKES IT SPEAK. They fall into
    // their own sentences on different inputs — the tree's needs no roots at
    // all — and a shared fixture would have proved the rule for one of them and
    // silently skipped the other two.
    const speaks: readonly { readonly projection: Projection; readonly document: ViewerDocument }[] = [
      { projection: 'linear', document: nothingRanked },
      { projection: 'graph', document: nothingRanked },
      { projection: 'tree', document: { issues: [], edges: [], order: { slots: [], excluded: [] }, cycles: [] } },
    ];
    for (const { projection, document } of speaks) {
      const bare = renderViewer({ ...document, host: { freshness: FRESHNESS } }, { projection });
      assert.ok(bare.markup.includes('ig-empty'), `${projection} lost its own empty sentence`);

      const withCondition = renderViewer(
        { ...document, host: { freshness: FRESHNESS, condition: EMPTY } },
        { projection },
      );
      assert.ok(!withCondition.markup.includes('ig-empty'), `${projection} drew two cause statements`);
      assert.ok(withCondition.markup.includes(EMPTY.reason), `${projection} lost the host’s reason`);
    }
  });

  it('draws no control the host named no word for', () => {
    for (const projection of PROJECTIONS) {
      const noRetry = renderViewer(
        { ...populated, host: { freshness: FRESHNESS, condition: { ...ERROR, retry: undefined } } },
        { projection },
      ).markup;
      assert.ok(noRetry.includes(ERROR.headline), `${projection} lost the error headline`);
      assert.ok(!noRetry.includes('retry:index'), `${projection} drew a retry nothing wired`);

      const noAction = renderViewer(
        { ...nothingRanked, host: { freshness: FRESHNESS, condition: { ...EMPTY, action: undefined } } },
        { projection },
      ).markup;
      assert.ok(!noAction.includes('review-pick-order'), `${projection} drew an action nothing wired`);

      const noDismiss = renderViewer(
        { ...populated, host: { freshness: FRESHNESS, adoption: { note: { text: 'No relationships declared.' } } } },
        { projection },
      ).markup;
      assert.ok(noDismiss.includes('ig-adoption'), `${projection} lost the adoption line`);
      assert.ok(!noDismiss.includes('dismiss:adoption'), `${projection} drew a dismiss nothing wired`);
    }
  });

  it('treats a blank label as no label, not as a control with no name', () => {
    // `'   '` IS NOT A NAME. Every required string is refused when it is blank
    // after trimming; a control label compared for exact emptiness instead let a
    // whitespace word through, and the panel drew a button with a published
    // command and nothing a screen reader could announce — the "control nobody
    // wired" failure arriving through the one predicate that did not trim.
    const blank = renderViewer(
      {
        ...nothingRanked,
        host: {
          freshness: FRESHNESS,
          condition: { ...EMPTY, action: { label: '   ' } },
          adoption: { note: { text: 'No relationships declared.', dismiss: '  ' } },
        },
      },
      { projection: 'linear' },
    );
    assert.ok(!blank.markup.includes('review-pick-order'), 'a blank label drew a nameless action');
    assert.ok(!blank.markup.includes('dismiss:adoption'), 'a blank label drew a nameless dismiss');
    assert.ok(blank.diagnostics.includes('condition action has no label and was dropped'));

    const blankRetry = renderViewer(
      { ...populated, host: { freshness: FRESHNESS, condition: { ...ERROR, retry: '\t' } } },
      { projection: 'linear' },
    ).markup;
    assert.ok(!blankRetry.includes('retry:index'), 'a blank label drew a nameless retry');
  });

  it('refuses an adoption count that cannot describe any repository', () => {
    // `50 of 48` needs no document to refute it — it is unsatisfiable on its
    // face, so it is refused with the out-of-range members rather than drawn.
    const { document, diagnostics } = normalizeDocument({
      ...populated,
      host: { freshness: FRESHNESS, adoption: { counts: { declaring: 50, total: 48 } } },
    });
    assert.equal(document.host.adoption, undefined, '50 of 48 was drawn');
    assert.ok(
      diagnostics.some((line) => line.includes('declaring no greater than total')),
      'an unsatisfiable count was accepted in silence',
    );
  });

  it('draws the condition, its outline and the adoption line as CHROME — a chrome-less render carries none', () => {
    // `chrome: false` exists so a host drawing two views of ONE document gets one
    // header. A notice outside that gate would be drawn twice by the same host —
    // and `@issuegraph/editor` is that host, on four render paths.
    for (const projection of PROJECTIONS) {
      const markup = renderViewer(
        {
          ...populated,
          host: { freshness: FRESHNESS, condition: ERROR, adoption: { note: { text: 'No relationships declared.' } } },
        },
        { projection, chrome: false },
      ).markup;
      assert.ok(!markup.includes('ig-header'), `${projection} drew a header under chrome:false`);
      assert.ok(!markup.includes('ig-notice'), `${projection} drew a notice under chrome:false`);
      assert.ok(!markup.includes('ig-adoption'), `${projection} drew the adoption line under chrome:false`);
      // THE OUTLINE IS CHROME TOO. The stylesheet reads this attribute to paint
      // the panel gold, so leaving it on a chrome-less render kept a treatment
      // with nothing anywhere in that render saying what the gold meant.
      assert.ok(
        !markup.includes('data-ig-condition'),
        `${projection} kept the condition outline under chrome:false`,
      );
    }
  });

  it('adds no navigable key and moves no row, whatever the condition says', () => {
    // The notice inserts native tab stops — that is what a button in the flow
    // is — but it must not enter the scene's own published sets, which is the
    // invariant `graph.ts` spent three review rounds establishing.
    for (const projection of PROJECTIONS) {
      const bare = renderViewer({ ...populated, host: { freshness: FRESHNESS } }, { projection });
      for (const condition of [IMPORTING, EMPTY, ERROR]) {
        const withCondition = renderViewer(
          { ...populated, host: { freshness: FRESHNESS, condition } },
          { projection },
        );
        assert.deepEqual(
          withCondition.scene.focusOrder,
          bare.scene.focusOrder,
          `${projection}/${condition.kind} moved the focus order`,
        );
        assert.deepEqual(
          withCondition.scene.navigable,
          bare.scene.navigable,
          `${projection}/${condition.kind} published a new navigable key`,
        );
      }
    }
  });

  it('keeps the losing signal visible, struck rather than hidden', () => {
    // §16h leaves WHICH signal wins to the owner and guarantees only that the
    // loser stays legible. That guarantee is the thing a refactor could quietly
    // drop — the chip would survive and the reader would lose the number that
    // was set aside — so it is pinned on its own rather than folded into the
    // chip's marker. The caveat LINE is a row-detail treatment, so it is
    // asserted where a row carries one.
    for (const projection of ['linear', 'tree'] as const) {
      const markup = renderViewer({ ...disagreeDocument, host: { freshness: FRESHNESS } }, { projection }).markup;
      assert.ok(
        markup.includes('ranked by label:P1 (your mapping) · frontmatter declares '),
        `${projection} lost the provenance line naming both signals`,
      );
      assert.ok(
        markup.includes('<s class="ig-strike">priority: 3</s>'),
        `${projection} hid the losing signal instead of striking it`,
      );
    }
  });

  it('states the adoption count once, in the header, when the host supplies one', () => {
    for (const projection of PROJECTIONS) {
      const markup = renderViewer(
        { ...populated, host: { freshness: FRESHNESS, adoption: { counts: { declaring: 12, total: 48 } } } },
        { projection },
      ).markup;
      const occurrences = markup.split('12 of 48 declare relationships').length - 1;
      assert.equal(occurrences, 1, `${projection} did not state the adoption count exactly once`);
      assert.ok(!markup.includes('ig-adoption'), `${projection} drew a footer line for a count-only host`);
    }
  });
});

describe('§16h: zero adoption reads complete, not degraded', () => {
  /** The scale the design's own example uses — and under the graph's node budget. */
  const SIZE = 48;
  const LABELS = ['label:P0', 'label:P1', 'label:P2', 'label:P3'] as const;

  const wide: ViewerDocument = {
    issues: Array.from({ length: SIZE }, (_, i) =>
      issue(String(i + 1), {
        priority: i % 4,
        provenance: { kind: 'matched-query', index: (i % 4) + 1, label: LABELS[i % 4] as string },
      }),
    ),
    edges: [],
    order: {
      slots: Array.from({ length: SIZE }, (_, i) => ({
        rank: i + 1,
        lead: String(i + 1),
        members: [String(i + 1)],
        ready: true,
        holds: [],
      })),
      excluded: [],
    },
    cycles: [],
  };

  it('draws the plain sequence in BOTH projections, with the toggle still offered', () => {
    for (const projection of ['linear', 'graph'] as const) {
      const { markup, diagnostics } = renderViewer(
        { ...wide, host: { freshness: FRESHNESS } },
        { projection, switchable: true },
      );
      assert.deepEqual(diagnostics, [], `${projection} refused a zero-edge document`);
      assert.ok(!markup.includes('ig-empty'), `${projection} called a full order empty`);
      assert.ok(markup.includes('ig-toggle'), `${projection} hid the projection toggle`);
      const keyed = markup.split('data-ig-key=').length - 1;
      assert.ok(keyed >= SIZE, `${projection} drew ${String(keyed)} keyed nodes for ${String(SIZE)} slots`);
    }
  });

  it('shows real P0–P3 variety from the host’s provenance, not a flat tier', () => {
    // The spec's "absent means 2" default applies to the frontmatter field only;
    // it never overrides a host's mapped label. A panel that flattened these to
    // P2 would be reading the default where no default applies.
    const markup = renderViewer({ ...wide, host: { freshness: FRESHNESS } }, { projection: 'linear' }).markup;
    for (const label of LABELS) {
      assert.ok(markup.includes(label), `the zero-adoption panel never names ${label}`);
    }
    assert.ok(!markup.includes('ranked in tier'), 'the zero-adoption panel fell back to a tier read');
  });

  it('carries no relationship badge at all', () => {
    // ON THE BADGE CLASS, not on the bare attribute: the legend draws a SAMPLE
    // of every edge kind whatever the document holds, so a bare `data-edge=`
    // count reads the legend as rows.
    const markup = renderViewer({ ...wide, host: { freshness: FRESHNESS } }, { projection: 'linear' }).markup;
    const badges = markup.match(/class="ig-badge" data-edge="/g) ?? [];
    assert.deepEqual(badges, [], 'a zero-edge document drew a relationship badge');
  });
});
