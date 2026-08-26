import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as surface from './index.ts';
import {
  EDGE_TOKENS,
  SURFACE_TOKENS,
  TEXT_TOKENS,
  contrastRatio,
} from './testing/contrast.ts';
import { fixtureDocument } from './testing/fixtures.ts';

const { COLOR_TOKENS, defaultTheme, extendTheme, renderViewer } = surface;

/**
 * The issue's own "done when", executable.
 *
 * Everything below is asserted through the PUBLIC surface only — no internal
 * import — because the acceptance criterion is about what a consumer gets, and
 * a test reaching past the exports would pass on a package nobody can use.
 */

/** The second theme the README documents. Kept here so the two cannot drift. */
export const paperTheme = extendTheme(defaultTheme, {
  colors: {
    '--ig-bg': '#FBFAF7',
    '--ig-surface': '#FFFFFF',
    '--ig-surface-2': '#F2F0EA',
    '--ig-line': '#D9D4C7',
    '--ig-text': '#1B1A17',
    '--ig-text-body': '#3B3A35',
    '--ig-text-muted': '#5E5B52',
    '--ig-accent': '#0A5B8A',
    '--ig-focus': '#0A5B8A',
    '--ig-station-ready': '#0A5B8A',
    '--ig-station-pending': '#5E5B52',
    '--ig-station-held': '#8A857A',
    '--ig-edge-blocked-by': '#A32020',
    '--ig-edge-serialize-with': '#7A5A00',
    '--ig-edge-together-with': '#0A5B8A',
    '--ig-edge-duplicate-of': '#6B2E9E',
    '--ig-edge-decomposed-from': '#A31257',
  },
});

describe('done when: the viewer renders all three projections from a fixture', () => {
  for (const projection of ['linear', 'graph', 'tree'] as const) {
    it(`renders the ${projection} projection`, () => {
      const result = renderViewer(fixtureDocument, { projection });

      assert.match(result.markup, new RegExp(`data-projection="${projection}"`));
      assert.deepEqual([...result.diagnostics], []);
      // Legible, not merely non-empty: the fixture's work is named, and the
      // grammar that explains it is on the page.
      assert.match(result.markup, /Backfill the ledger/);
      assert.match(result.markup, /class="ig-legend"/);
    });
  }

  it('answers the order question from the spine alone — the seam test', () => {
    // "Strip layers 2 and 3 and the viewer still renders a correct, legible
    // order." Nothing is attached here: no editor, no chrome, no data source.
    const { markup } = renderViewer(fixtureDocument, { projection: 'linear' });

    assert.match(markup, /class="ig-rank"[^>]*>1</);
    assert.match(markup, /class="ig-rank"[^>]*>2</);
    assert.match(markup, /class="ig-rank"[^>]*>—</);
    assert.match(markup, /blocked by 102, which is open/);
  });
});

describe('done when: a second theme renders correctly through custom properties only', () => {
  it('changes every colour without moving a byte of markup', () => {
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const dark = renderViewer(fixtureDocument, { projection });
      const paper = renderViewer(fixtureDocument, { projection, theme: paperTheme });

      assert.equal(paper.markup, dark.markup, `${projection} markup depends on the theme`);
      for (const token of COLOR_TOKENS) {
        assert.ok(
          paper.styles.includes(`${token}: ${paperTheme.colors[token]};`),
          `${token} did not reach the second theme's stylesheet`,
        );
      }
    }
  });

  it('renders the second theme legibly, not merely differently', () => {
    // "Correctly" has to mean more than "the bytes changed". The documented
    // second theme is held to the same accessibility bar as the default, or the
    // theming capability is proved with a palette nobody could read.
    for (const token of TEXT_TOKENS) {
      for (const surfaceToken of SURFACE_TOKENS) {
        const ratio = contrastRatio(paperTheme.colors[token], paperTheme.colors[surfaceToken]);
        assert.ok(ratio >= 4.5, `${token} on ${surfaceToken} measures ${ratio.toFixed(2)}:1`);
      }
    }
    for (const token of EDGE_TOKENS) {
      for (const surfaceToken of SURFACE_TOKENS) {
        const ratio = contrastRatio(paperTheme.colors[token], paperTheme.colors[surfaceToken]);
        assert.ok(ratio >= 3, `${token} on ${surfaceToken} measures ${ratio.toFixed(2)}:1`);
      }
    }
  });

  it('supplies the second theme as nothing but custom properties', () => {
    const paper = renderViewer(fixtureDocument, { theme: paperTheme });
    const dark = renderViewer(fixtureDocument);
    const themeBlock = paper.styles.slice(paper.styles.lastIndexOf(':root {'));

    assert.equal(
      paper.styles.replace(themeBlock, ''),
      dark.styles.replace(dark.styles.slice(dark.styles.lastIndexOf(':root {')), ''),
      'the structural stylesheet changed with the theme',
    );
    for (const line of themeBlock.split('\n').slice(1, -2)) {
      assert.match(line.trim(), /^--ig-/);
    }
  });
});

describe('done when: nothing can reach a network or a mutation', () => {
  it('exports no function that could', () => {
    // The surface is the claim's other half: `purity.test.ts` measures the
    // sources, and this pins that no export invites a caller to do it for us.
    const forbidden = ['fetch', 'save', 'write', 'mutate', 'update', 'delete', 'post', 'auth'];
    for (const name of Object.keys(surface)) {
      for (const word of forbidden) {
        assert.equal(
          name.toLowerCase().includes(word),
          false,
          `${name} reads as a mutation or a fetch`,
        );
      }
    }
  });

  it('renders with the browser globals removed', () => {
    const removed = ['document', 'window', 'fetch'];
    const saved = new Map(
      removed.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const),
    );
    for (const name of removed) {
      Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true });
    }
    try {
      for (const projection of ['linear', 'graph', 'tree'] as const) {
        assert.ok(renderViewer(fixtureDocument, { projection }).markup.length > 0);
      }
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
        else Object.defineProperty(globalThis, name, descriptor);
      }
    }
  });
});

describe('the public surface', () => {
  it('exports exactly what the package documents', () => {
    // A published package can add an export later and can never take one back,
    // so the surface is pinned rather than left to grow by accident.
    assert.deepEqual(Object.keys(surface).sort(), [
      'CLUSTER_ONLY_BUDGET',
      'COLOR_TOKENS',
      'EDGE_TREATMENTS',
      'GRAPH_NODE_BUDGET',
      'KEY_ATTRIBUTE',
      'METRIC_TOKENS',
      'THEME_TOKENS',
      'TYPE_TOKENS',
      'dashArrayFor',
      'defaultTheme',
      'extendTheme',
      'initialNavigationState',
      'mountViewer',
      'navigate',
      'normalizeDocument',
      'reconcile',
      'renderViewer',
      'resolveTheme',
      'themeCss',
      'treatmentFor',
      'viewerStylesheet',
    ]);
  });
});
