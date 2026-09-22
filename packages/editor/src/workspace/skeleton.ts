/**
 * `renderWorkspaceSkeleton` — the grooming workspace before its first read.
 *
 * The same three zones the workspace draws, each holding the viewer's own
 * placeholder, under the same root attributes — so the container queries that
 * size and fold the real zones size and fold these too, and nothing moves when
 * the document arrives. See `@issuegraph/viewer`'s `renderViewerSkeleton` for
 * why the shape is the package's and the look is the host's.
 *
 * `mountWorkspace` draws this on its own while the store's first load is in
 * flight, which is what stops a mounted workspace from announcing an empty
 * backlog it has not read. It is exported pure as well, so a host can render
 * the identical markup in a route's server-side loading state.
 */

import {
  type Theme,
  element,
  renderMarkup,
  resolveTheme,
  skeletonSpec,
  themeCss,
  viewerStylesheet,
} from '@issuegraph/viewer';

import { workspaceStylesheet } from './styles.ts';

export interface WorkspaceSkeletonOptions {
  /**
   * The host's words for what is loading, read to assistive technology. Absent,
   * the surface is marked busy and carries no text — this package writes none.
   */
  readonly label?: string | undefined;
  readonly theme?: Theme | undefined;
  /** The selector `themeCss` writes the custom properties onto. */
  readonly themeSelector?: string | undefined;
}

export interface WorkspaceSkeletonResult {
  readonly markup: string;
  /** The stylesheets and the theme. Install all of it. */
  readonly styles: string;
}

function block(shape: string): ReturnType<typeof element> {
  return element('span', { class: 'ig-skeleton-block', 'data-shape': shape });
}

/** Render the workspace's placeholder. Pure and total. */
export function renderWorkspaceSkeleton(options: WorkspaceSkeletonOptions = {}): WorkspaceSkeletonResult {
  const theme = resolveTheme(options.theme);
  const root = element(
    'div',
    {
      class: 'ig-workspace',
      // THE REAL SURFACE'S RESTING STATE, so the narrow layouts' container
      // queries fold these zones exactly as they will fold the real ones.
      'data-canvas': 'strip',
      'data-inspector': 'dismissed',
      'data-ig-loading': 'true',
      'aria-busy': 'true',
      role: options.label === undefined ? undefined : 'status',
      'aria-label': options.label,
    },
    [
      element('section', { class: 'ig-zone', 'data-zone': 'header' }, [
        element('div', { class: 'ig-workspace-header', 'aria-hidden': 'true' }, [block('label'), block('chip')]),
      ]),
      element('section', { class: 'ig-zone', 'data-zone': 'rail' }, [
        skeletonSpec({ projection: 'linear', frame: false }),
      ]),
      element('section', { class: 'ig-zone', 'data-zone': 'canvas' }, [
        skeletonSpec({ projection: 'graph', frame: false, chrome: false }),
      ]),
      element('section', { class: 'ig-zone', 'data-zone': 'inspector' }, [
        element('div', { class: 'ig-inspector', 'aria-hidden': 'true' }, [
          block('label'),
          block('title'),
          block('meta'),
        ]),
      ]),
    ],
  );
  return {
    markup: renderMarkup(root),
    styles: [viewerStylesheet, themeCss(theme, options.themeSelector ?? ':root'), workspaceStylesheet].join('\n'),
  };
}
