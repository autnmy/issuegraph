/**
 * `renderViewerSkeleton` — what the viewer draws before there is a document.
 *
 * ## Why the package draws it, and the host only styles it
 *
 * A viewer mounted before its data arrives had two choices and both were wrong.
 * Rendered over an empty document it said "nothing is in the order", which is
 * a claim about a backlog nobody has read yet. Held back by the host instead,
 * the host drew its own placeholder — a guess at this package's layout that
 * jumped when the real rows landed and that every host had to rewrite.
 *
 * So the SHAPE is this package's: the skeleton rows use the same `.ig-slot`
 * geometry the order uses, so a placeholder row is exactly as tall as a real
 * one at every density the container picks, and nothing moves on arrival. It
 * is a pure function over no document, so a host can render it on the server
 * — in a route's loading state — and the page-load placeholder, the
 * waiting-for-data placeholder and the data all line up.
 *
 * The LOOK is the host's. Every placeholder is an `.ig-skeleton-block`,
 * filled with `--ig-surface-2` and carrying no animation. This package ships
 * no motion anywhere — the editor's sheet says why — so a host that wants its
 * own pulse adds it to that one class, gated on its own reduced-motion rule,
 * and the fill follows the host's theme like every other surface here.
 *
 * ## No word of its own
 *
 * The root is `aria-busy` always. It is a labelled `status` region only when
 * the host supplies `label` — "Loading your issues" is a sentence in the
 * host's language, and this package does not write one.
 */

import { type ElementSpec, element, renderMarkup } from './element.ts';
import { type Theme, resolveTheme, themeCss } from './theme.ts';
import { viewerStylesheet } from './styles.ts';

export interface SkeletonOptions {
  /** Which projection the placeholder stands in for. Defaults to `linear`. */
  readonly projection?: 'linear' | 'graph' | 'tree' | undefined;
  /** How many placeholder rows or cards to draw. Defaults to 8 rows, 3 cards. */
  readonly rows?: number | undefined;
  /**
   * The host's words for what is loading, read to assistive technology. Absent,
   * the region is marked busy and carries no text — this package writes none.
   */
  readonly label?: string | undefined;
  /** Draw the panel header's placeholder. Same meaning as `SceneOptions.chrome`. Defaults to `true`. */
  readonly chrome?: boolean | undefined;
  /** Same meaning as `SceneOptions.frame`. Defaults to `true`. */
  readonly frame?: boolean | undefined;
  readonly theme?: Theme | undefined;
  /** The selector `themeCss` writes the custom properties onto. */
  readonly themeSelector?: string | undefined;
}

export interface SkeletonResult {
  readonly markup: string;
  /** The stylesheet and the theme, in that order. Install both. */
  readonly styles: string;
}

const DEFAULT_ROWS = 8;
const DEFAULT_CARDS = 3;
/** Title widths cycle through a few lengths so the column reads as text, not as a bar chart. */
const TITLE_WIDTHS = ['0', '1', '2', '1'] as const;

function block(shape: string, extra: Readonly<Record<string, string>> = {}): ElementSpec {
  return element('span', { class: 'ig-skeleton-block', 'data-shape': shape, ...extra });
}

function headerSkeleton(): ElementSpec {
  return element('header', { class: 'ig-header' }, [
    element('div', { class: 'ig-header-top' }, [block('label')]),
    element('div', { class: 'ig-skeleton-chips' }, [block('chip'), block('chip'), block('chip')]),
  ]);
}

function rowSkeleton(index: number): ElementSpec {
  return element('li', { class: 'ig-slot ig-skeleton-row' }, [
    // THE STATION ALONE IN THE RANK TRACK. A rank figure over it made the cell
    // taller than a real row's, and the whole placeholder a few pixels a row
    // too tall — the jump this file exists to prevent. Measured against the
    // real rail at its dense density: 53 and 53.
    element('div', { class: 'ig-rank-cell' }, [block('station')]),
    element('div', { class: 'ig-row-body' }, [
      // ONE WRAPPER FOR BOTH LINES, as the real row has, so the body's own gap
      // is not spent between the title and the meta line a second time.
      element('div', { class: 'ig-skeleton-lines' }, [
        block('title', { 'data-width': TITLE_WIDTHS[index % TITLE_WIDTHS.length] ?? '0' }),
        block('meta'),
      ]),
    ]),
  ]);
}

function cardSkeleton(): ElementSpec {
  return element('div', { class: 'ig-skeleton-card' }, [
    block('station'),
    element('div', { class: 'ig-skeleton-card-body' }, [block('title', { 'data-width': '1' }), block('meta')]),
  ]);
}

/**
 * The placeholder's root, as a spec — exported so a composing surface (the
 * editor's workspace skeleton) can place it inside its own zones.
 */
export function skeletonSpec(options: SkeletonOptions = {}): ElementSpec {
  const projection = options.projection ?? 'linear';
  const graph = projection === 'graph';
  const count = Math.max(1, Math.floor(options.rows ?? (graph ? DEFAULT_CARDS : DEFAULT_ROWS)));
  const body = graph
    ? element('div', { class: 'ig-skeleton-stage' }, Array.from({ length: count }, () => cardSkeleton()))
    : element(
        'ol',
        { class: 'ig-list' },
        Array.from({ length: count }, (_, index) => rowSkeleton(index)),
      );
  return element(
    'section',
    {
      class: `ig-viewer ${graph ? 'ig-graph' : projection === 'tree' ? 'ig-tree-view' : 'ig-linear'}`,
      'data-projection': projection,
      'data-frame': options.frame === false ? 'none' : undefined,
      'data-ig-loading': 'true',
      'aria-busy': 'true',
      role: options.label === undefined ? undefined : 'status',
      'aria-label': options.label,
    },
    [
      options.chrome === false || graph ? null : headerSkeleton(),
      // THE PLACEHOLDERS SAY NOTHING. They are shapes, not content, and a
      // screen reader walking eight empty list items learns only that there
      // are eight of them — the region's busy state and label already say it.
      element('div', { 'aria-hidden': 'true' }, [body]),
    ],
  );
}

/** Render the placeholder a host shows before the viewer has a document. Pure and total. */
export function renderViewerSkeleton(options: SkeletonOptions = {}): SkeletonResult {
  const theme = resolveTheme(options.theme);
  return {
    markup: renderMarkup(skeletonSpec(options)),
    styles: `${viewerStylesheet}\n${themeCss(theme, options.themeSelector ?? ':root')}`,
  };
}
