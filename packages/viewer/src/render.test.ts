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
    const taller = extendTheme(defaultTheme, { metrics: { '--ig-card-line': 36 } });
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

describe('the outer frame, and the container that declines it', () => {
  it('frames every projection by default, because standing alone it is a card', () => {
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const markup = renderViewer(fixtureDocument, { projection }).markup;
      assert.equal(
        /data-frame=/.test(markup),
        false,
        `${projection} stamps the attribute unasked, so the default is no longer the absence`,
      );
    }
  });

  it('stamps data-frame on all three roots when a container declines it', () => {
    // ALL THREE, not just the one the workspace happens to draw today. A
    // projection toggle must not put the frame back: the container's seams do
    // not change because the reader switched to the tree.
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const markup = renderViewer(fixtureDocument, { projection, frame: false }).markup;
      assert.match(
        markup,
        /^<section class="ig-viewer [a-z-]+" data-projection="[a-z]+" data-frame="none"/,
        `${projection} did not decline the frame`,
      );
    }
  });

  it('unsets the border and the radius, and nothing else', () => {
    // THE DEFECT THIS EXISTS FOR: composed into the workspace, the viewer's own
    // border landed one pixel from the rail track's `border-right` and from the
    // canvas toolbar's `border-bottom`, so every seam on the surface read as a
    // doubled hairline. Asserted against the bytes, because the attribute is
    // inert without the rule and nothing would fail.
    const rule = /\.ig-viewer\[data-frame='none'\] \{([^}]*)\}/.exec(viewerStylesheet);
    assert.ok(rule, 'the stylesheet no longer answers the attribute, so declining it draws the frame anyway');
    const declarations = (rule[1] as string)
      .split(';')
      .map((text) => text.trim())
      .filter((text) => text !== '');
    assert.deepEqual(declarations.sort(), ['border-radius: 0', 'border: 0']);
  });
});

describe('the docked legend, and the scrollport it needs', () => {
  it('leaves the legend in the flow unless a container asks for the dock', () => {
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const markup = renderViewer(fixtureDocument, { projection }).markup;
      assert.equal(
        /data-legend=/.test(markup),
        false,
        `${projection} docks unasked, and a viewer at its natural height has no scrollport but the page`,
      );
    }
  });

  it('stamps data-legend on all three roots when a container asks', () => {
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const markup = renderViewer(fixtureDocument, { projection, dockLegend: true }).markup;
      assert.match(markup, /data-legend="docked"/, `${projection} did not dock its legend`);
    }
  });

  it('lifts the root\u2019s clip, which is the whole mechanism', () => {
    // THE DECLARATION THAT LOOKS LIKE A TIDY-UP AND IS THE FEATURE. Sticky
    // positions against the nearest SCROLLPORT, and a root left at
    // `overflow: hidden` is one — so the legend would stick to a box that never
    // scrolls, which is the box it already sat at the bottom of. Nothing moves
    // and nothing errors: the sticky rule below would read as though it worked.
    const css = viewerStylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
    const docked = /\.ig-viewer\[data-legend='docked'\] \{([^}]*)\}/.exec(css);
    assert.ok(docked, 'the docked root has no rule, so it is still its own scrollport');
    assert.match(docked[1] as string, /overflow:\s*visible/);

    const legend = /\.ig-viewer\[data-legend='docked'\] > \.ig-legend \{([^}]*)\}/.exec(css);
    assert.ok(legend, 'the docked legend has no rule of its own');
    assert.match(legend[1] as string, /position:\s*sticky/);
    assert.match(
      legend[1] as string,
      /bottom:\s*0/,
      'the dock needs a default edge for a container with nothing else pinned there',
    );
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
    // AND THE UNIT IS STILL DRAWN. `doesNotThrow` alone would pass on a render
    // that silently dropped the mark it could not identify, which is the same
    // under-reporting the refusal declines to do.
    const { markup } = renderViewer(document, { projection: 'graph' });
    assert.match(markup, /data-unit="true"/, 'the unit was dropped rather than drawn');
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
      /<p class="ig-hold" data-family="graph" data-code="blocked-by-open" data-subject="102"><span class="ig-turn" aria-hidden="true">↳<\/span><span>blocked-by 102 is open<\/span><\/p>/,
    );
  });

  it('and omits both when the host stated neither — never an empty attribute', () => {
    const { markup } = renderViewer(fixtureDocument, { projection: 'linear' });
    assert.match(markup, /<p class="ig-hold" data-family="graph"><span class="ig-turn" aria-hidden="true">↳<\/span><span>blocked by 102, which is open<\/span><\/p>/);
    assert.doesNotMatch(markup, /data-code=/);
    assert.doesNotMatch(markup, /data-subject=/);
  });
});

describe('\u00a716f \u2014 the expand affordance', () => {
  // The state lives in the HOST, so what this package owns is exactly two
  // things: it reports which rows are open, and its stylesheet draws an open
  // one. Both are pinned here; the key that asks is in `navigation.test.ts`
  // and the reducer that answers is in the editor's `host.test.ts`.

  const slots = (markup: string): Map<string, string | null> =>
    new Map(
      [...markup.matchAll(/<li class="ig-slot"([^>]*)>/g)].map((tag) => {
        const body = tag[1] as string;
        const key = /data-ig-key="([^"]+)"/.exec(body)?.[1] as string;
        return [key, /aria-expanded="([a-z]+)"/.exec(body)?.[1] ?? null];
      }),
    );

  it('reports open on exactly the rows the host named', () => {
    const closed = slots(renderViewer(fixtureDocument, { projection: 'linear' }).markup);
    assert.ok(closed.size > 1);
    assert.deepEqual(
      [...closed.values()].filter((value) => value === 'true'),
      [],
      'nothing is open until the host says so',
    );

    const open = slots(
      renderViewer(fixtureDocument, { projection: 'linear', expanded: ['102'] }).markup,
    );
    assert.equal(open.get('102'), 'true');
    assert.deepEqual(
      [...open].filter(([, value]) => value === 'true').map(([key]) => key),
      ['102'],
      'one named row opens one row',
    );
  });

  it('keeps the provenance markup whole whether the row is open or not', () => {
    // WHAT CHANGES IS THE ATTRIBUTE, NOT THE MARKUP. The rail hides provenance
    // with `display: none` and the accessible name is built from the same
    // parts, so removing it when closed would change the row's name as a side
    // effect of a display choice \u2014 and the wide panel, which shows it inline,
    // renders through this very path.
    const both = ['expand-nothing', '102'].map(
      (key) =>
        (
          renderViewer(fixtureDocument, {
            projection: 'linear',
            expanded: key === '102' ? ['102'] : [],
          }).markup.match(/ig-provenance/g) ?? []
        ).length,
    );
    assert.ok((both[0] as number) > 0, 'the premise: the fixture has provenance to draw');
    assert.equal(both[0], both[1]);
  });

  it('names an unknown key without opening anything', () => {
    // The rail is WINDOWED, so a key the host holds open may not be drawn at
    // all. That must cost a miss, never a throw or a stray open row.
    const drawn = slots(
      renderViewer(fixtureDocument, { projection: 'linear', expanded: ['not-a-row'] }).markup,
    );
    assert.deepEqual([...drawn.values()].filter((value) => value === 'true'), []);
  });

  it('draws an open row\u2019s provenance back, out-specifying the rule that hid it', () => {
    // THE TRAP THIS EXISTS FOR: two rules that both match and a winner decided
    // by file order. A previous sweep shipped a row that rendered EMPTY while
    // measuring a perfect height, because two selectors tied at the same
    // specificity. So this compares the two rules rather than asserting that
    // the override is merely present.
    const css = viewerStylesheet;
    const hide = css.indexOf('.ig-slot .ig-provenance');
    const show = css.indexOf(".ig-slot[aria-expanded='true'] .ig-provenance");
    assert.ok(hide !== -1 && show !== -1, 'both rules are in the sheet');
    // The attribute adds a component the bare descendant selector does not
    // have, so the override wins on specificity and does not depend on order.
    // It is nonetheless AFTER the rule it overrides, which is what keeps this
    // readable to anyone editing the block.
    assert.ok(show > hide, 'the override follows the rule it overrides');
    assert.match(
      css.slice(show, show + 120),
      /\.ig-slot\[aria-expanded='true'\]\s+\.ig-provenance\s*\{[^}]*display:\s*block/,
      'and it restores display rather than something adjacent',
    );
  });
});
