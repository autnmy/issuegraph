/**
 * The re-evaluate surface, as markup: the rail, a summary of what the last edit
 * did to it, and a delta chip for each row that changed.
 *
 * ## It draws nothing inside a row
 *
 * The rail is `@issuegraph/viewer`'s linear projection, composed here as a SPEC
 * rather than as a string — `renderViewer` hands back `scene.root`, so the
 * viewer's tree nests inside this one and every byte still comes out of
 * `renderMarkup`. Nothing is concatenated by hand, and no attribute value in
 * this package is ever escaped by anything but the one renderer.
 *
 * That is what makes the design's rule structural instead of asserted:
 * **unaffected rows are left completely alone** because this package never
 * touches a row. The rejected alternative — splice chips into the rail's markup
 * string — would have re-introduced exactly the hand-built escaping surface the
 * spec grammar exists to remove.
 *
 * ## The chips are a KEYED LIST here, and the WORKSPACE draws them on the row
 *
 * Said plainly because the earlier wording did not: `data-ig-key` has no
 * browser behaviour of its own. In THIS surface the chips render as a list
 * beside the rail, and the list is built to stand on its own: every chip NAMES
 * the row it describes, which is what lets a reader account for the rows that
 * got no chip.
 *
 * THE DEFERRAL THIS COMMENT USED TO CARRY IS DISCHARGED, and its premise was
 * wrong rather than merely stale. It said placing a chip on its row "needs that
 * row's geometry — which only a mount has". It does not: a row is a keyed SPEC
 * before it is an element, and `workspace/render.ts`'s `markRail` was already
 * walking that tree to compose the audit's mark onto it. So the workspace
 * composes the chip the same way — no geometry, no mount, no positioning — and
 * `parts.ts` holds the one builder both call.
 *
 * This surface keeps the list because it is the honest answer for a host that
 * renders WITHOUT the workspace's rail: there is no row to sit on, so naming
 * the row in text is the only thing that accounts for the ones that did not
 * move. `chipSpec`'s `placed` arm is the other half, and it drops that name
 * because there the row already carries it.
 *
 * ## Two rejected alternatives from the design, recorded so they stay rejected
 *
 * A before/after side-by-side makes the owner redo the comparison the machine
 * already did, and doubles the surface at 300 rows. An animated re-sort is
 * pretty once and unusable in a loop, because rows moving under the cursor mean
 * the next edit targets the wrong thing. Neither is reachable from here.
 *
 * ## Nothing dismisses itself
 *
 * There is no timer, and there is no view state. `Store.dismissChange()` is
 * already the only thing besides the next edit that clears the summary, so this
 * renders a control publishing `data-ig-command="dismiss-change"` and lets the
 * store stay the single source of truth. A second copy of "has this been
 * dismissed" held out here is the drift the command grammar exists to avoid.
 */

import {
  type Theme,
  type ViewerDocument,
  element,
  renderMarkup,
  renderViewer,
  resolveTheme,
} from '@issuegraph/viewer';
import type { OrderChange, OrderStatus } from '@issuegraph/store';

import type { ChangeWords } from './words.ts';
import { chipSpec, summarySpec } from './parts.ts';
import { type ReevaluateView, reevaluateView } from './view.ts';
import { reevaluateStylesheet } from './styles.ts';

export interface ReevaluateOptions {
  /**
   * The words. Required — see {@link ChangeWords} for why this package will not
   * invent them.
   */
  readonly words: ChangeWords;
  /** The store's `lastChange`. Absent means no edit has landed to report. */
  readonly change?: OrderChange | null | undefined;
  /** The store's `order.status`. `held` greys and labels the rail. */
  readonly status?: OrderStatus | undefined;
  readonly theme?: Theme | undefined;
  /** The selector the theme's custom properties are written onto. */
  readonly themeSelector?: string | undefined;
}

export interface ReevaluateResult {
  readonly view: ReevaluateView;
  /** The whole surface: the summary, the chips, and the rail inside one root. */
  readonly markup: string;
  /** The viewer's stylesheet, the theme, and this surface's own. Install all. */
  readonly styles: string;
  readonly diagnostics: readonly string[];
}

/** Render the order, and what the last edit did to it. */
export function renderReevaluate(
  input: ViewerDocument,
  options: ReevaluateOptions,
): ReevaluateResult {
  const status = options.status ?? 'settled';
  const theme = resolveTheme(options.theme);
  const rail = renderViewer(input, {
    projection: 'linear',
    theme,
    ...(options.themeSelector === undefined ? {} : { themeSelector: options.themeSelector }),
  });
  const view = reevaluateView(options.change, rail.scene, status);

  const root = element(
    'section',
    {
      class: 'ig-reevaluate',
      // The rail's own state, on the surface that owns the label for it. The
      // viewer draws the order it was handed; whether that order is the current
      // one is a fact only the store knows.
      'data-order': status,
    },
    [
      // "Write landed, order computing" shows the PREVIOUS order, held still,
      // greyed one step and EXPLICITLY LABELLED. A stale-but-labelled order
      // beats a half-computed one, and the rail never shows a rank it is not
      // sure of — which is why nothing here re-ranks anything: the ranks drawn
      // are the ones the caller vouched for, and a chip's movement is drawn as
      // a chip rather than as a rank.
      summarySpec(view.summary, options.words, { held: view.held }),
      view.chips.length === 0
        ? null
        : element(
            'ul',
            { class: 'ig-delta-list' },
            view.chips.map((chip) => chipSpec(chip, options.words)),
          ),
      // The viewer's own tree, nested rather than concatenated.
      rail.scene.root,
    ],
  );

  return {
    view,
    markup: renderMarkup(root),
    styles: `${rail.styles}\n${reevaluateStylesheet}`,
    diagnostics: [...view.diagnostics, ...rail.diagnostics],
  };
}
