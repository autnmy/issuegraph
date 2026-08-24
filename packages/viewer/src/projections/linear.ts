/**
 * The linear projection: the work order as rows.
 *
 * Sequence is vertical position and nothing else — the list IS the order, so
 * there is no number to hunt for and no layout that shifts between refreshes.
 * Everything else about a row (readiness, provenance, relationships, holds)
 * hangs off that one line.
 *
 * The two hold families are drawn differently on purpose, and it is the rule
 * this projection exists to honour: a graph-derived hold stays INLINE at the
 * rank the work would have taken, because "why isn't my P1 running" has to be
 * answerable in place; a runner- or tracker-derived hold is not a fact about
 * the work, earns no rank slot, and collapses into the footer with duplicates.
 */

import type { NormalizedDocument, ViewerSlot } from '../document.ts';
import { type ElementSpec, element } from '../element.ts';
import {
  edgeBadges,
  emptyState,
  holdLine,
  identity,
  legend,
  provenanceLine,
  slotLabel,
  slotTitle,
  station,
  stationFill,
} from '../parts.ts';
import { type LateralNeighbours, type Scene, resolveFocusKey } from '../scene.ts';
import { treatmentFor } from '../vocabulary.ts';

export interface SceneOptions {
  /** The selected key, if any. Rendered as `aria-current`. */
  readonly selected?: string | null | undefined;
  /** The key holding the roving tab stop. Defaults to the first in order. */
  readonly focused?: string | null | undefined;
}

/**
 * A slot the footer owns.
 *
 * ANY tracker-family hold sends the slot to the footer, even alongside a
 * graph-derived one. A slot the runner has already claimed is not waiting on
 * the graph in any sense a rank could express, so giving it a position would
 * claim work is queued that nothing can start.
 */
export function isFooterSlot(slot: ViewerSlot): boolean {
  return slot.holds.some((hold) => hold.family === 'tracker');
}

function slotRow(
  document: NormalizedDocument,
  slot: ViewerSlot,
  options: SceneOptions,
  showRank: boolean,
): ElementSpec {
  const held = !slot.ready;
  const lead = document.byKey.get(slot.lead);
  const selected = options.selected === slot.lead;
  const focused = options.focused === slot.lead;

  const rank = showRank
    ? element(
        'span',
        { class: 'ig-rank', 'data-held': held ? 'true' : 'false', 'aria-hidden': 'true' },
        // A held slot never prints a number: it has no position in the
        // sequence, and printing one would claim work is queued that nothing
        // can start.
        [slot.rank === null ? '—' : String(slot.rank)],
      )
    : null;

  const children = [
    rank,
    station(stationFill(slot)),
    element('span', { class: 'ig-title' }, [slotTitle(document, slot)]),
    lead === undefined ? null : identity(lead),
    edgeBadges(document, slot.lead),
    provenanceLine(lead?.provenance),
    ...slot.holds.map(holdLine),
  ];

  return element(
    'li',
    {
      class: 'ig-slot',
      'data-ig-key': slot.lead,
      'data-held': held ? 'true' : 'false',
      'aria-current': selected ? 'true' : 'false',
      'aria-label': slotLabel(document, slot),
      tabindex: focused ? 0 : -1,
    },
    children,
  );
}

function excludedRow(
  document: NormalizedDocument,
  key: string,
  canonical: string,
  options: SceneOptions,
): ElementSpec {
  const issue = document.byKey.get(key);
  return element(
    'li',
    {
      class: 'ig-slot',
      'data-ig-key': key,
      'data-held': 'true',
      'aria-current': options.selected === key ? 'true' : 'false',
      'aria-label': `${issue?.title ?? key} — ${treatmentFor('duplicate-of').label} ${canonical}, never worked`,
      // A HARDCODED -1 HERE MEANT THE VIEWER LOST ITS TAB STOP ENTIRELY. An
      // exclusion is in `focusOrder`, so focus can resolve to one — and when it
      // did, no element carried `tabindex="0"` and Tab could not enter the
      // viewer at all. Every row that can hold focus renders the roving stop.
      tabindex: options.focused === key ? 0 : -1,
    },
    [
      station('dashed'),
      element('span', { class: 'ig-title' }, [issue?.title ?? key]),
      issue === undefined ? null : identity(issue),
      edgeBadges(document, key),
      element('p', { class: 'ig-hold', 'data-family': 'tracker' }, [
        `${treatmentFor('duplicate-of').label} ${canonical} — never worked`,
      ]),
    ],
  );
}

/** The one count chip isolated issues collapse into (they carry no information as rows). */
function isolatedChip(count: number): ElementSpec | null {
  if (count === 0) return null;
  return element('p', { class: 'ig-count' }, [
    `${String(count)} ${count === 1 ? 'issue is' : 'issues are'} in no slot and declare no relationships`,
  ]);
}

export function linearScene(
  document: NormalizedDocument,
  options: SceneOptions = {},
): Scene {
  const inline = document.order.slots.filter((slot) => !isFooterSlot(slot));
  const footerSlots = document.order.slots.filter(isFooterSlot);

  const focusOrder = [
    ...inline.map((slot) => slot.lead),
    ...footerSlots.map((slot) => slot.lead),
    ...document.order.excluded.map((exclusion) => exclusion.key),
  ];

  // A REQUESTED KEY THIS PROJECTION NO LONGER DRAWS must not silently render no
  // tab stop at all — that leaves the viewer unreachable by keyboard. The
  // shared rule resolves it, and `reconcile` uses the same one, so the markup
  // and `handle.state.focused` cannot disagree about where focus sits.
  const withFocus: SceneOptions = {
    ...options,
    focused: resolveFocusKey(focusOrder, options.focused, options.selected),
  };

  const body =
    inline.length === 0
      ? emptyState('Nothing is in the order right now.')
      : element(
          'ol',
          // A PLAIN LIST, not a listbox. Every row carries a deep-link chip, and
          // an interactive descendant inside `role="option"` is a pattern
          // violation that real screen readers and axe both flag — so selection
          // is announced with `aria-current`, which any element may carry.
          { class: 'ig-list', 'aria-label': 'work order' },
          inline.map((slot) => slotRow(document, slot, withFocus, true)),
        );

  const footerEntries = [
    ...footerSlots.map((slot) => slotRow(document, slot, withFocus, false)),
    ...document.order.excluded.map((exclusion) =>
      excludedRow(document, exclusion.key, exclusion.canonical, withFocus),
    ),
  ];

  const footer =
    footerEntries.length === 0
      ? null
      : element('section', { class: 'ig-footer' }, [
          element('p', { class: 'ig-footer-title' }, [
            'Held outside the order — claimed, parked, or never worked',
          ]),
          element(
            'ol',
            { class: 'ig-list', 'aria-label': 'held outside the order' },
            footerEntries,
          ),
        ]);

  const root = element(
    'section',
    { class: 'ig-viewer ig-linear', 'data-projection': 'linear', 'aria-label': 'issue order' },
    [legend(), body, footer, isolatedChip(document.isolated.length)],
  );

  // The linear projection has one column, so nothing sits left or right of
  // anything. An empty map is the honest answer; a self-referencing one would
  // make a lateral key press look handled.
  const lateral: ReadonlyMap<string, LateralNeighbours> = new Map();

  // No lateral axis here, so nothing is reachable sideways that the order does
  // not already contain.
  return { projection: 'linear', root, focusOrder, navigable: focusOrder, lateral, diagnostics: [] };
}
