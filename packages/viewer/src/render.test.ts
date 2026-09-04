import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderViewer } from './render.ts';
import { viewerStylesheet } from './styles.ts';
import { reconcile } from './navigation.ts';
import {
  crowdedDocument,
  doublePlacedDocument,
  fixtureDocument,
  heldTogetherDocument,
  sharedGutterDocument,
} from './testing/fixtures.ts';
import { COLOR_TOKENS, defaultTheme, extendTheme, themeCss } from './theme.ts';
import { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET } from './projections/graph.ts';

describe('renderViewer', () => {
  it('renders every projection from one document', () => {
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const result = renderViewer(fixtureDocument, { projection });
      assert.match(result.markup, new RegExp(`data-projection="${projection}"`));
      assert.equal(result.scene.projection, projection);
      assert.ok(result.markup.length > 0);
    }
  });

  it('defaults to the linear projection', () => {
    assert.match(renderViewer(fixtureDocument).markup, /data-projection="linear"/);
  });

  it('ships the stylesheet and the theme together', () => {
    const result = renderViewer(fixtureDocument);
    assert.ok(result.styles.includes(viewerStylesheet));
    assert.ok(result.styles.includes(themeCss(defaultTheme)));
  });

  it('writes the theme onto the selector it is given', () => {
    assert.match(
      renderViewer(fixtureDocument, { themeSelector: '.host' }).styles,
      /\.host \{\n {2}--ig-bg:/,
    );
  });

  it('renders a second theme with byte-identical markup and different styles', () => {
    // THE THEMING PROOF, and the reason it is stated this way: if any colour
    // reached the markup, changing the palette would change the markup too.
    // Byte equality is what makes "themeable through custom properties" a fact
    // rather than a claim about the existence of some variables.
    const second = extendTheme(defaultTheme, {
      colors: Object.fromEntries(COLOR_TOKENS.map((token) => [token, '#FFEEDD'])) as Record<
        (typeof COLOR_TOKENS)[number],
        string
      >,
    });

    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const base = renderViewer(fixtureDocument, { projection });
      const rethemed = renderViewer(fixtureDocument, { projection, theme: second });

      assert.equal(rethemed.markup, base.markup, `${projection} markup moved with the theme`);
      assert.notEqual(rethemed.styles, base.styles);
      assert.ok(rethemed.styles.includes('#FFEEDD'));
    }
  });

  it('moves the drawing when a theme changes its geometry', () => {
    // The other half of the theming contract: geometry is theme data too, so a
    // metric override has to reach the SVG coordinates and not only the CSS.
    const taller = extendTheme(defaultTheme, { metrics: { '--ig-row-height': 88 } });
    const base = renderViewer(fixtureDocument, { projection: 'graph' });
    const rethemed = renderViewer(fixtureDocument, { projection: 'graph', theme: taller });

    assert.notEqual(rethemed.markup, base.markup);
  });

  it('carries both the document and the projection diagnostics', () => {
    const result = renderViewer(
      {
        issues: [{ key: '1', title: 'One', open: true, priority: 2 }],
        edges: [{ field: 'blocked-by', from: '1', to: '99' }],
        order: { slots: [], excluded: [] },
        cycles: [],
      },
      { projection: 'graph' },
    );

    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0] as string, /names 99/);
  });

  it('appends a projection refusal to the document diagnostics', () => {
    const result = renderViewer(crowdedDocument(GRAPH_NODE_BUDGET + 1), { projection: 'graph' });
    assert.ok(result.diagnostics.some((line) => /graph refused/.test(line)));
  });

  it('never touches a global, so it runs where there is no DOM', () => {
    // Asserted rather than asserted about: the globals are removed for the call
    // and put back, so a reference added later fails here instead of in a host.
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = { document: globals['document'], window: globals['window'] };
    globals['document'] = undefined;
    globals['window'] = undefined;
    try {
      assert.ok(renderViewer(fixtureDocument, { projection: 'graph' }).markup.length > 0);
    } finally {
      globals['document'] = saved.document;
      globals['window'] = saved.window;
    }
  });

  it('holds the whole navigation contract, for every projection and every shape', () => {
    // FOUR INVARIANTS, NOT FOUR EXAMPLES. Three review rounds kept finding the
    // same class — a published navigation target the markup cannot honour —
    // each time in a place the previous round's test did not reach: a gutter
    // node, a refusal, an enclosure winning the index, an excluded row with a
    // hardcoded `-1`. Asserting the CONTRACT across every projection and every
    // shape is what leaves the class nothing to hide in.
    const shapes = [
      ['fixture', fixtureDocument],
      ['held-together', heldTogetherDocument],
      ['shared-gutter', sharedGutterDocument],
      ['double-placed', doublePlacedDocument],
      ['refusal-capsules', crowdedDocument(GRAPH_NODE_BUDGET + 1)],
      ['refusal-clusters', crowdedDocument(CLUSTER_ONLY_BUDGET + 1)],
      ['empty', { issues: [], edges: [], order: { slots: [], excluded: [] }, cycles: [] }],
    ] as const;

    for (const [name, input] of shapes) {
      for (const projection of ['linear', 'graph', 'tree'] as const) {
        const { scene } = renderViewer(input, { projection });
        const where = `${name}/${projection}`;

        // 1. The published sets agree with each other and repeat nothing. A
        //    duplicate entry makes `ArrowDown` resolve to the key it is already
        //    on and answer `none`, stranding everything after it.
        assert.equal(
          new Set(scene.focusOrder).size,
          scene.focusOrder.length,
          `${where}: focusOrder repeats a key`,
        );
        for (const key of scene.focusOrder) {
          assert.ok(scene.navigable.includes(key), `${where}: focusOrder is not a subset of navigable`);
        }

        // 2. Every lateral pair is REVERSIBLE. A node has one neighbour per
        //    side, so a shared target cannot point back to two — the map must
        //    only ever publish pairs whose reverse it kept.
        for (const [from, neighbours] of scene.lateral) {
          for (const side of ['left', 'right'] as const) {
            const to = neighbours[side];
            if (to === undefined) continue;
            assert.ok(scene.navigable.includes(to), `${where}: lateral target ${to} is not navigable`);
            assert.equal(
              scene.lateral.get(to)?.[side === 'left' ? 'right' : 'left'],
              from,
              `${where}: ${from} -${side}-> ${to} does not come back`,
            );
          }
        }

        // 3 and 4, under every focus state a host can hand us: each published
        //    key has exactly ONE focusable element, and the element carrying the
        //    roving tab stop is exactly the key `reconcile` reports. When those
        //    two disagree, Tab cannot enter the viewer at all.
        const states = [
          { focused: null, selected: null },
          { focused: scene.focusOrder[scene.focusOrder.length - 1] ?? null, selected: null },
          { focused: 'not-a-key', selected: scene.focusOrder[0] ?? null },
          { focused: 'not-a-key', selected: 'also-not-a-key' },
          ...scene.focusOrder.map((key) => ({ focused: key, selected: null })),
          ...[...scene.lateral.keys()].map((key) => ({ focused: key, selected: null })),
        ];

        for (const state of states) {
          const { markup } = renderViewer(input, { projection, ...state });
          const focusable = [
            ...markup.matchAll(/data-ig-key="([^"]+)"[^>]*tabindex="(?:0|-1)"/g),
          ].map((match) => match[1] as string);
          const stops = [...markup.matchAll(/data-ig-key="([^"]+)"[^>]*tabindex="0"/g)].map(
            (match) => match[1] as string,
          );

          for (const key of scene.navigable) {
            assert.equal(
              focusable.filter((found) => found === key).length,
              1,
              `${where}: ${key} does not have exactly one focusable element`,
            );
          }

          const expected = reconcile(scene, state);
          assert.deepEqual(
            stops,
            expected.focused === null ? [] : [expected.focused],
            `${where}: the tab stop and the reconciled focus disagree for ${JSON.stringify(state)}`,
          );
        }
      }
    }
  });

  it('is deterministic across projections', () => {
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      assert.equal(
        renderViewer(fixtureDocument, { projection }).markup,
        renderViewer(fixtureDocument, { projection }).markup,
      );
    }
  });
});

describe('a document whose keys are not encodable', () => {
  it('renders a together unit with a lone surrogate key instead of throwing', () => {
    // THE CONTRACT THIS FILE ALREADY STATES: a malformed document produces
    // diagnostics rather than a throw. Drawing connectors began stamping an
    // edge identity on each one, and `encodeURIComponent` throws `URIError` on
    // an unpaired surrogate — so a key a `String` may legally hold turned a
    // render into an exception, on the one projection that draws connectors.
    // ASSERTED ON `renderViewer`, the public entry the contract is written
    // about, rather than on the encoder in isolation: the encoder having been
    // made total is the fix, and this is the promise the fix exists to keep.
    const document = {
      issues: [
        { key: '\uD800', title: 'Lone high surrogate', open: true, priority: 2 as const },
        { key: '2', title: 'Partner', open: true, priority: 2 as const },
      ],
      edges: [{ field: 'together-with' as const, from: '\uD800', to: '2' }],
      order: {
        slots: [{ rank: 1, lead: '\uD800', members: ['\uD800', '2'], ready: true, holds: [] }],
        excluded: [],
      },
      cycles: [],
    };

    assert.doesNotThrow(() => renderViewer(document, { projection: 'graph' }));
    const rendered = renderViewer(document, { projection: 'graph' });
    assert.match(rendered.markup, /class="ig-connector"/, 'the connector was dropped rather than drawn');
  });
});

describe('a hold publishes its cause and subject when the host supplied them', () => {
  const heldSlot = fixtureDocument.order.slots.find((slot) => slot.lead === '101');
  assert.ok(heldSlot !== undefined);
  const coded = {
    ...fixtureDocument,
    order: {
      ...fixtureDocument.order,
      slots: fixtureDocument.order.slots.map((slot) =>
        slot.lead === '101'
          ? {
              ...slot,
              holds: [
                {
                  family: 'graph' as const,
                  reason: 'blocked-by 102 is open',
                  code: 'blocked-by-open',
                  subject: '102',
                },
              ],
            }
          : slot,
      ),
    },
    cycles: [],
  };

  it('as data-code and data-subject beside data-family, sentence unchanged', () => {
    const { markup } = renderViewer(coded, { projection: 'linear' });
    assert.match(
      markup,
      /<p class="ig-hold" data-family="graph" data-code="blocked-by-open" data-subject="102">blocked-by 102 is open<\/p>/,
    );
  });

  it('and omits both when the host stated neither — never an empty attribute', () => {
    const { markup } = renderViewer(fixtureDocument, { projection: 'linear' });
    assert.match(markup, /<p class="ig-hold" data-family="graph">blocked by 102, which is open<\/p>/);
    assert.doesNotMatch(markup, /data-code=/);
    assert.doesNotMatch(markup, /data-subject=/);
  });
});
