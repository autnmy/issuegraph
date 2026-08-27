/**
 * The ladder, as markup.
 *
 * Pure, like `renderViewer` and for the same reason that package gives: a
 * rendering package whose output can only be inspected by mounting it cannot be
 * tested at the level its correctness actually lives at. Everything below is
 * reachable without a DOM.
 *
 * ## The command contract
 *
 * Every control this renders publishes what it does as data — `data-ig-command`
 * names the {@link ScaleCommand} kind, `data-ig-target` carries the key a
 * `focus` needs, and the search input carries its own query as its value. A
 * host reads them, calls `scaleReducer`, and renders again.
 *
 * THAT INDIRECTION IS THE POINT, not a missing wire. The viewer learned this
 * the expensive way: a control that cannot complete the action it advertises
 * draws a finding every round, and the fix was to stop publishing one from a
 * layer that could not narrow. Layer 2 CAN narrow, so it publishes the controls
 * — but the narrowing still happens by re-rendering with new state, which means
 * the dispatcher is whatever owns that state. Wiring the listeners and
 * restoring focus across the redraw is a mount's job and lands with the
 * workspace that owns one.
 *
 * ## What is drawn, and what is not
 *
 * The canvas is rendered through `@issuegraph/viewer` ONLY on the tier that
 * draws one. Handing an over-budget document to the viewer would make it draw
 * its own refusal beside this one — two refusals about one document, one of
 * which has no routes.
 */

import {
  type ElementSpec,
  type Theme,
  type ViewerDocument,
  element,
  renderMarkup,
  renderViewer,
  resolveTheme,
  themeCss,
  viewerStylesheet,
} from '@issuegraph/viewer';

import { INITIAL_SCALE_STATE, type ScaleState } from './commands.ts';
import {
  type IsolatedChip,
  type ScaleLadder,
  type ScaleRefusal,
  type ScaleSearch,
  scaleLadder,
} from './ladder.ts';
import { scaleLadderStylesheet } from './styles.ts';

export interface ScaleLadderOptions {
  readonly state?: ScaleState | undefined;
  readonly theme?: Theme | undefined;
  /** The selector the theme's custom properties are written onto. */
  readonly themeSelector?: string | undefined;
  /**
   * The selected issue key, handed to the viewer as `aria-current`.
   *
   * ADDITIVE AND OPTIONAL, for the surface that assembles this beside a rail.
   * A workspace holds ONE selection and every zone reads it, so a canvas that
   * could not be told what is selected made the shared value disagree with
   * itself between zones on every render — the rail marking a row current while
   * the graph drew the same issue as ordinary.
   *
   * Reaches the viewer only on the tier that draws one; there is nothing to
   * mark on a tier whose canvas is a refusal.
   */
  readonly selected?: string | null | undefined;
}

export interface ScaleLadderResult {
  readonly ladder: ScaleLadder;
  /** The canvas, when there is one, followed by the ladder's own chrome. */
  readonly markup: string;
  /** The viewer's stylesheet, the theme, and the chrome's own. Install all. */
  readonly styles: string;
  readonly diagnostics: readonly string[];
}

function refusalSpec(refusal: ScaleRefusal, ladder: ScaleLadder): ElementSpec {
  return element('section', { class: 'ig-refusal', role: 'note' }, [
    element('p', {}, [refusal.reason]),
    ladder.capsules.length === 0
      ? null
      : element(
          'ol',
          { class: 'ig-list', 'aria-label': 'connected components' },
          ladder.capsules.map((capsule) =>
            element('li', { class: 'ig-capsule' }, [
              element(
                'button',
                {
                  type: 'button',
                  'data-ig-command': 'focus',
                  'data-ig-target': capsule.lead,
                },
                [`Focus ${capsule.lead}`],
              ),
              element('span', { class: 'ig-count' }, [`${String(capsule.size)} issues`]),
              element('span', { class: 'ig-count' }, [
                `${String(capsule.blockedByEdges)} blocking`,
              ]),
              element('span', { class: 'ig-count' }, [`depth ${String(capsule.chainDepth)}`]),
              capsule.hasCycle
                ? element('span', { class: 'ig-badge', 'data-edge': 'blocked-by' }, ['cycle'])
                : null,
              element('span', { class: 'ig-id' }, [capsule.members.slice(0, 3).join(', ')]),
            ]),
          ),
        ),
    ladder.capsulesOmitted > 0
      ? element('p', { class: 'ig-refusal-omitted' }, [
          `${String(ladder.capsulesOmitted)} further ${ladder.capsulesOmitted === 1 ? 'component is' : 'components are'} not listed.`,
        ])
      : null,
    element(
      'ul',
      { class: 'ig-ladder-routes', 'aria-label': 'what to do next' },
      refusal.routes.map((route) =>
        element('li', { class: 'ig-refusal-next', 'data-route': route.kind }, [route.label]),
      ),
    ),
  ]);
}

function searchSpec(search: ScaleSearch): ElementSpec {
  return element('div', { class: 'ig-ladder-search' }, [
    // THE INPUT SITS INSIDE ITS LABEL, so the two are associated without an
    // `id`. A fixed `id` is not a detail here: a host rendering two documents
    // side by side would emit it twice, and a duplicated `id` makes `for`
    // resolve to whichever came first — so one of the two search boxes would
    // silently lose its label.
    element('label', {}, [
      'Search to focus a component',
      element('input', {
        type: 'search',
        'data-ig-command': 'search',
        value: search.query,
        autocomplete: 'off',
      }),
    ]),
    search.matches.length === 0
      ? null
      : element(
          'ol',
          { class: 'ig-list', 'aria-label': 'search matches' },
          search.matches.map((match) =>
            element('li', { class: 'ig-ladder-match' }, [
              element(
                'button',
                { type: 'button', 'data-ig-command': 'focus', 'data-ig-target': match.lead },
                [`Focus ${match.key}`],
              ),
              element('span', { class: 'ig-title' }, [match.title]),
            ]),
          ),
        ),
    search.omitted > 0
      ? element('p', { class: 'ig-refusal-omitted' }, [
          `${String(search.omitted)} further ${search.omitted === 1 ? 'match is' : 'matches are'} not listed.`,
        ])
      : null,
  ]);
}

function isolatedSpec(isolated: IsolatedChip): ElementSpec | null {
  // NOTHING IS DRAWN FOR AN EMPTY SET. A chip reading "0 isolated issues" is a
  // control that opens nothing, and the count IS the information these issues
  // carry — so with no issues there is nothing to say.
  if (isolated.count === 0) return null;
  return element('div', { class: 'ig-ladder-isolated' }, [
    element(
      'button',
      {
        type: 'button',
        class: 'ig-chip',
        'aria-expanded': isolated.open ? 'true' : 'false',
        'data-ig-command': isolated.open ? 'close-isolated' : 'open-isolated',
      },
      [isolated.label],
    ),
    // A LIST, NEVER A CANVAS. These issues have no relationship to draw, which
    // is exactly why they were collapsed in the first place.
    isolated.open
      ? element(
          'ol',
          { class: 'ig-isolated-list', 'aria-label': 'isolated issues' },
          isolated.issues.map((issue) =>
            element('li', {}, [
              element('span', { class: 'ig-id' }, [issue.key]),
              element('span', { class: 'ig-title' }, [issue.title]),
            ]),
          ),
        )
      : null,
  ]);
}

/** Render one document at one reader position. */
export function renderScaleLadder(
  input: ViewerDocument,
  options: ScaleLadderOptions = {},
): ScaleLadderResult {
  const state = options.state ?? INITIAL_SCALE_STATE;
  const ladder = scaleLadder(input, state);
  const theme = resolveTheme(options.theme);

  const canvas =
    ladder.tier === 'direct'
      ? renderViewer(ladder.canvas, { projection: 'graph', theme, selected: options.selected ?? null })
      : null;

  const chrome = element('section', { class: 'ig-ladder', 'data-tier': ladder.tier }, [
    ladder.focus === null
      ? null
      : element(
          'button',
          { type: 'button', class: 'ig-chip', 'data-ig-command': 'clear-focus' },
          ['Return to every component'],
        ),
    ladder.refusal === null ? null : refusalSpec(ladder.refusal, ladder),
    ladder.search === null ? null : searchSpec(ladder.search),
    isolatedSpec(ladder.isolated),
  ]);

  return {
    ladder,
    // SIBLINGS RATHER THAN A HAND-BUILT WRAPPER. Every byte here comes from
    // `renderMarkup`, so no attribute value in this package is ever
    // concatenated into markup by hand — which is the escaping surface a
    // second, hand-rolled renderer would have introduced.
    markup: `${canvas?.markup ?? ''}${renderMarkup(chrome)}`,
    styles: `${viewerStylesheet}\n${themeCss(theme, options.themeSelector ?? ':root')}\n${scaleLadderStylesheet}`,
    diagnostics: [...ladder.diagnostics, ...(canvas?.diagnostics ?? [])],
  };
}
