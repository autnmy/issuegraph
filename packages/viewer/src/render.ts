/**
 * `renderViewer` — the pure entry point.
 *
 * Everything the package draws is reachable from here without a DOM: markup for
 * server rendering, the stylesheet and the theme's custom properties, the
 * scene's traversal order, and whatever the document forced it to drop. That is
 * deliberate — a rendering package whose output can only be inspected by
 * mounting it cannot be tested at the level its correctness actually lives at.
 */

import { type NormalizedDocument, type ViewerDocument, normalizeDocument } from './document.ts';
import { renderMarkup } from './element.ts';
import { type GraphOptions, graphScene } from './projections/graph.ts';
import { linearScene } from './projections/linear.ts';
import { treeScene } from './projections/tree.ts';
import type { Projection, Scene } from './scene.ts';
import { type Theme, defaultTheme, themeCss } from './theme.ts';
import { viewerStylesheet } from './styles.ts';

export interface RenderOptions extends GraphOptions {
  readonly projection?: Projection | undefined;
  /** The selector `themeCss` writes the custom properties onto. */
  readonly themeSelector?: string | undefined;
}

export interface RenderResult {
  readonly markup: string;
  /** The stylesheet and the theme, in that order. Install both. */
  readonly styles: string;
  readonly scene: Scene;
  /** Everything the document and the projection had to drop or refuse. */
  readonly diagnostics: readonly string[];
}

/** Build the scene for one projection. Exported so `mount` reuses it exactly. */
export function sceneFor(
  document: NormalizedDocument,
  projection: Projection,
  options: GraphOptions,
): Scene {
  switch (projection) {
    case 'linear':
      return linearScene(document, options);
    case 'graph':
      return graphScene(document, options);
    case 'tree':
      return treeScene(document, options);
  }
}

/**
 * Render a document.
 *
 * Pure and total: no global is read, nothing is fetched, and a malformed
 * document produces diagnostics rather than a throw.
 */
export function renderViewer(input: ViewerDocument, options: RenderOptions = {}): RenderResult {
  const { document, diagnostics } = normalizeDocument(input);
  const theme: Theme = options.theme ?? defaultTheme;
  const scene = sceneFor(document, options.projection ?? 'linear', { ...options, theme });

  return {
    markup: renderMarkup(scene.root),
    styles: `${viewerStylesheet}\n${themeCss(theme, options.themeSelector ?? ':root')}`,
    scene,
    diagnostics: [...diagnostics, ...scene.diagnostics],
  };
}
