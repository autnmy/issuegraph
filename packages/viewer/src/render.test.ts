import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderViewer } from './render.ts';
import { viewerStylesheet } from './styles.ts';
import { crowdedDocument, fixtureDocument } from './testing/fixtures.ts';
import { COLOR_TOKENS, defaultTheme, extendTheme, themeCss } from './theme.ts';
import { GRAPH_NODE_BUDGET } from './projections/graph.ts';

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

  it('is deterministic across projections', () => {
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      assert.equal(
        renderViewer(fixtureDocument, { projection }).markup,
        renderViewer(fixtureDocument, { projection }).markup,
      );
    }
  });
});
