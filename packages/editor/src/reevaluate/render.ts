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
 * ## The chips are a KEYED LIST, and this package does not position them
 *
 * Said plainly because the earlier wording did not: `data-ig-key` has no
 * browser behaviour of its own. The chips render as a list beside the rail, and
 * putting one ON its row needs that row's geometry — which only a mount has,
 * and this package has no mount. Naming it an overlay while shipping a
 * normal-flow list claimed a positioning this markup cannot do.
 *
 * So the list is built to stand on its own instead: every chip NAMES the row it
 * describes, which is what lets a reader account for the rows that got no chip.
 * The key is published for the mount that will position them, and that mount
 * lands with the change that assembles the workspace — the same boundary the
 * scale ladder already draws when it defers listener wiring and focus
 * restoration to whoever owns the mount.
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
  type ElementSpec,
  type Theme,
  type ViewerDocument,
  KEY_ATTRIBUTE,
  element,
  renderMarkup,
  renderViewer,
  resolveTheme,
} from '@issuegraph/viewer';
import type { OrderChange, OrderStatus, RankDelta } from '@issuegraph/store';

import type { ChangeWords } from './words.ts';
import { type ChangeSummary, type PlacedChip, type ReevaluateView, reevaluateView } from './view.ts';
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

function countWord(count: number, word: string): readonly ElementSpec[] {
  return [
    element('span', { class: 'ig-change-count' }, [String(count)]),
    element('span', { class: 'ig-change-word' }, [word]),
  ];
}

function summarySpec(summary: ChangeSummary, words: ChangeWords): ElementSpec {
  return element(
    'div',
    {
      class: 'ig-change-summary',
      'data-unchanged': summary.unchanged ? 'true' : 'false',
      'data-op': summary.op,
      'data-mutation': summary.mutationId,
    },
    [
      // THE LIVE REGION IS THE STABLE WRAPPER, NOT THE CONTENT AND NOT THE
      // WHOLE SUMMARY. `role="status"` announces its subtree when that subtree
      // changes, which needs the region itself to persist across renders — and
      // the content below does not: an edit that moved something renders a
      // list, one that moved nothing renders a paragraph, so a role on either
      // would come and go with it. Keeping the dismiss button OUTSIDE matters
      // for the same reason from the other side: inside, its label would be
      // re-announced with every summary.
      //
      // It is a role, not a timer. Nothing about it expires and the region
      // stays put until the next edit or an explicit dismissal.
      element('div', { class: 'ig-change-line', role: 'status' }, [
        // THE ZERO CASE RENDERS, in the summary's own place. An edit that landed
        // and moved nothing is the finding an owner auditing an encoding most
        // needs, and drawing nothing for it is the defect this branch prevents.
        summary.unchanged
          ? element('p', { class: 'ig-change-unchanged' }, [words.unchanged])
          : element(
              'ul',
              { class: 'ig-change-parts' },
              summary.parts.map((part) =>
                element('li', { class: 'ig-change-part', 'data-facet': part.facet }, [
                  ...countWord(part.count, words.facets[part.facet]),
                ]),
              ),
            ),
      ]),
      // ITS OWN CLASS, not the ladder's `.ig-chip`. That class is defined only
      // in `scale/styles.ts`, so borrowing it would leave this control unstyled
      // for a host that installs this surface and not that one. Folding the two
      // chip looks into one rule is the assembling change's call, not this
      // leaf's — it is the change that first has both on screen at once.
      element(
        'button',
        { type: 'button', class: 'ig-change-dismiss', 'data-ig-command': 'dismiss-change' },
        [words.dismiss],
      ),
    ],
  );
}

/**
 * What one issue's delta says, as spans.
 *
 * IT NAMES A DIRECTION AND A DISTANCE, NEVER A RANK. `RankMovement.from` and
 * `.to` are the deriver's 0-BASED positions, while the rail beside them renders
 * the viewer's 1-BASED ranks — so printing either as a number would put two
 * different bases side by side and read as an off-by-one. `by` is a distance,
 * which is basis-independent and safe to print. A host that knows the basis and
 * wants the endpoints reads them off `view.chips[].deltas`, which carries every
 * `RankDelta` untouched.
 */
function memberSpec(delta: RankDelta, words: ChangeWords): ElementSpec {
  return element('span', { class: 'ig-delta-member', 'data-ref': delta.ref }, [
    delta.movement === undefined
      ? null
      : element(
          'span',
          {
            class: 'ig-delta-move',
            'data-direction': delta.movement.direction,
            'data-by': delta.movement.by,
          },
          [...countWord(delta.movement.by, words.direction[delta.movement.direction])],
        ),
    delta.readiness === undefined
      ? null
      : element('span', { class: 'ig-delta-readiness', 'data-readiness': delta.readiness }, [
          words.facets[delta.readiness],
        ]),
    delta.presence === undefined
      ? null
      : element('span', { class: 'ig-delta-presence', 'data-presence': delta.presence }, [
          words.facets[delta.presence],
        ]),
  ]);
}

/**
 * One ROW's chip — which can speak for more than one issue.
 *
 * A `together-with` unit is one row and several refs, so its members are nested
 * inside a single chip rather than given one each. Each keeps its own
 * `data-ref`, so a host can still tell which member moved.
 *
 * IT NAMES ITS ROW IN TEXT, not only in `KEY_ATTRIBUTE`. Unpositioned, a chip
 * that carried its key only as an attribute said nothing a reader could see
 * about WHICH row moved — and the rows that did not move are accounted for
 * precisely by not being named here. The key is data, not language, so naming
 * it costs the host no word.
 */
function chipSpec(chip: PlacedChip, words: ChangeWords): ElementSpec {
  return element('li', { class: 'ig-delta-chip', [KEY_ATTRIBUTE]: chip.key }, [
    element('span', { class: 'ig-delta-key' }, [chip.key]),
    ...chip.deltas.map((delta) => memberSpec(delta, words)),
  ]);
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
      view.held ? element('p', { class: 'ig-order-computing' }, [options.words.computing]) : null,
      view.summary === null ? null : summarySpec(view.summary, options.words),
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
