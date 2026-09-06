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

import type { NormalizedDocument, ViewerHold, ViewerSlot } from '../document.ts';
import { type ElementSpec, element } from '../element.ts';
import {
  caveatBadges,
  caveatLines,
  edgeBadgeList,
  edgeBadges,
  emptyState,
  evidenceBadge,
  footerLabels,
  holdLine,
  hostHeader,
  identity,
  legend,
  notReadyBadge,
  nowRows,
  priorityBadge,
  provenanceLine,
  slotLabel,
  slotTitle,
  station,
  stationFill,
  stationsOf,
  unitBlock,
  unitMark,
  atStations,
} from '../parts.ts';
import { type LateralNeighbours, type Scene, resolveFocusKey } from '../scene.ts';
import { treatmentFor } from '../vocabulary.ts';

export interface SceneOptions {
  /** The selected key, if any. Rendered as `aria-current`. */
  readonly selected?: string | null | undefined;
  /** The key holding the roving tab stop. Defaults to the first in order. */
  readonly focused?: string | null | undefined;
  /**
   * Draw the panel's own header bar — its name, the projection toggle, the
   * host's counts, the freshness stamp. Defaults to `true`.
   *
   * FOR A HOST THAT MOUNTS THE VIEWER TWICE. §16's panel has ONE header, and a
   * host composing a list beside a graph — which is exactly what the grooming
   * workspace does — would otherwise draw two, with two projection toggles that
   * disagree about which projection is current. The host suppresses the second
   * rather than this package guessing which of its instances is the panel.
   */
  readonly chrome?: boolean | undefined;
  /**
   * Draw the header's own view controls — the List/Graph toggle, and the
   * graph's expand/collapse affordance. Defaults to `false`.
   *
   * OPT-IN, BECAUSE THIS PACKAGE CANNOT COMPLETE THE COMMANDS. It is a pure
   * renderer: `g`, the toggle and the size affordance all publish a command —
   * `projection:linear|graph`, `expand`, `collapse` — and the HOST re-renders
   * with a different option. Drawn by default, every host that had not wired
   * them displayed buttons that do nothing, which is what the editor's composed
   * workspace did: the canvas mode is the editor's own control, and a second,
   * inert one sat beside the counts.
   *
   * §16a draws the toggle, so the surface that reproduces §16a passes `true`
   * and wires it. Advertising an action nobody can perform is worse than a
   * plain absence — the same rule the graph's refusal already states about its
   * own capsules.
   */
  readonly switchable?: boolean | undefined;
}

/**
 * A slot the footer owns.
 *
 * ANY tracker-family hold sends the slot to the footer, even alongside a
 * graph-derived one. A slot the runner has already claimed is not waiting on
 * the graph in any sense a rank could express, so giving it a position would
 * claim work is queued that nothing can start.
 */
/**
 * What the footer group calls itself.
 *
 * IT COVERS TWO FAMILIES, AND SAYING "held by the runner" COVERED ONE. §16a's
 * own group lists a duplicate under that heading, but §16d's table is explicit
 * that a duplicate is a different fact — "canonical elsewhere, never worked" —
 * from a claim or a park. A document with one duplicate and no tracker hold
 * therefore read "1 held by the runner" about an issue no runner has touched.
 * Shared by both projections, so the two cannot word one group two ways.
 */
export function footerHeading(count: number, kinds: FooterKinds): string {
  const reasons = [
    kinds.runner ? 'held by the runner' : null,
    kinds.neverWorked ? 'never worked' : null,
    kinds.undrawn ? 'not drawn at this width' : null,
  ].filter((reason): reason is string => reason !== null);
  const tail =
    reasons.length === 0
      ? ''
      : ` — ${reasons.slice(0, -1).join(', ')}${reasons.length > 1 ? ', or ' : ''}${reasons[reasons.length - 1] ?? ''}`;
  return `${String(count)} outside the order${tail}`;
}

/**
 * Which families of entry a footer group actually holds.
 *
 * SAID RATHER THAN ASSUMED, because the group holds a different set in each
 * projection and the heading is a claim about every row beneath it. The list's
 * group holds runner-held slots and duplicates; the COLUMN's holds those plus
 * every gutter endpoint the compact graph does not draw — ordinary open
 * blockers, which no runner holds and which are worked like anything else. One
 * heading for all three read as a statement about them that is simply untrue.
 */
export interface FooterKinds {
  readonly runner: boolean;
  readonly neverWorked: boolean;
  /** Present only in the column, where the gutters are not drawn. */
  readonly undrawn: boolean;
}

export function isFooterSlot(slot: ViewerSlot): boolean {
  return slot.holds.some((hold) => hold.family === 'tracker');
}

/**
 * One ranked row: the rank track, then everything else in one body column.
 *
 * TWO CHILDREN, WHICH IS THE FRAME'S GRID EXACTLY. The row that shipped was a
 * four-column grid with more than four children, so the extras auto-placed into
 * column one — the rank track — and a single relationship badge set that
 * column's width for the whole list, pushing every title across to pay for it.
 * A rank cell and a body cell cannot do that: there is no third column for a
 * child to fall into, and the alignment grid the rows hang off is therefore a
 * property of the markup rather than of remembering to place each new child.
 */
export function slotRow(
  document: NormalizedDocument,
  slot: ViewerSlot,
  options: SceneOptions,
  showRank: boolean,
): ElementSpec {
  const held = !slot.ready;
  const lead = document.byKey.get(slot.lead);
  const selected = options.selected === slot.lead;
  const focused = options.focused === slot.lead;
  const unit = slot.members.length > 1;

  const rankCell = element('div', { class: 'ig-rank-cell', 'aria-hidden': 'true' }, [
    showRank
      ? element(
          'span',
          { class: 'ig-rank', 'data-held': held ? 'true' : 'false' },
          // A held slot never prints a number: it has no position in the
          // sequence, and printing one would claim work is queued that nothing
          // can start.
          [slot.rank === null ? '—' : String(slot.rank)],
        )
      : null,
    station(stationFill(slot)),
  ]);

  // A UNIT'S HEAD IS ITS ENCLOSURE, not a joined title. Every other row keeps
  // the frame's two-line pair: the title, and the identity 2px beneath it.
  const head = unit
    ? [unitMark(slot), unitBlock(document, slot)]
    : [
        element('div', { class: 'ig-row-head' }, [
          element('span', { class: 'ig-title' }, [slotTitle(document, slot)]),
          lead === undefined ? null : identity(lead),
        ]),
      ];

  const badges = [
    priorityBadge(lead?.provenance),
    evidenceBadge(lead),
    notReadyBadge(slot),
    ...caveatBadges(lead),
  ].filter((badge): badge is ElementSpec => badge !== null);

  // ONE BADGE ROW, FED BY FOUR SOURCES. §16a draws the tier, the evidence, the
  // readiness and the relationships as one wrapping row of chips, in that
  // order — the facts a reader scans for before they read a word of the
  // sentence beneath.
  const badgeRow = [...badges, ...edgeBadgeList(document, slot.members)];

  const body = element('div', { class: 'ig-row-body' }, [
    ...head,
    badgeRow.length === 0 ? null : element('div', { class: 'ig-badges' }, badgeRow),
    provenanceLine(lead?.provenance),
    // THE LEAD'S CAVEATS, like the lead's provenance: a together unit is one
    // row and one rank, and the host facts about that rank ride on its lead.
    ...caveatLines(lead),
    ...slot.holds.map(holdLine),
  ]);

  return element(
    'li',
    {
      class: 'ig-slot',
      'data-ig-key': slot.lead,
      'data-held': held ? 'true' : 'false',
      'data-unit': unit ? 'true' : 'false',
      'aria-current': selected ? 'true' : 'false',
      'aria-label': slotLabel(document, slot),
      tabindex: focused ? 0 : -1,
    },
    [rankCell, body],
  );
}

/**
 * One footer entry: a label chip, a title and an identity, on one line.
 *
 * THESE ARE NOT FACTS ABOUT THE WORK, which is the whole reason they are down
 * here rather than in the order — so they get no rank, no station and no
 * explanation block. Drawing them as full rows, which is what shipped, claimed
 * the opposite: a reader saw a claimed issue laid out exactly like a queued
 * one and had only the heading to tell them apart.
 */
export function footerRow(
  document: NormalizedDocument,
  slot: ViewerSlot,
  options: SceneOptions,
): ElementSpec {
  const lead = document.byKey.get(slot.lead);
  // THE REASON RIDES THE NAME. A footer entry is one line — a chip, a title and
  // an identity — because it is not a fact about the work; but the host still
  // said WHY, and dropping the sentence entirely would lose it from the panel.
  // The same channel the graph's cards use for the same reason: sighted readers
  // hover, screen readers hear it, and the one-line row is untouched.
  const because = slot.holds.map((hold) => hold.reason).join(' · ');
  // NARROWED THROUGH THE FAMILY, because the union is what carries the label:
  // a graph hold has none to read, and reaching for one on the union is a
  // compile error rather than a silent undefined.
  const labelled = slot.holds.find(
    (hold): hold is Extract<ViewerHold, { family: 'tracker' }> =>
      hold.family === 'tracker' && hold.label !== undefined && hold.label !== '',
  );
  return element(
    'li',
    {
      class: 'ig-footer-row',
      'data-ig-key': slot.lead,
      'aria-current': options.selected === slot.lead ? 'true' : 'false',
      'aria-label':
        because === '' ? slotLabel(document, slot) : `${slotLabel(document, slot)} — ${because}`,
      title: because === '' ? null : because,
      tabindex: options.focused === slot.lead ? 0 : -1,
    },
    [
      labelled === undefined
        ? null
        : element('span', { class: 'ig-badge', 'data-hold': labelled.label }, [labelled.label]),
      element('span', { class: 'ig-title' }, [slotTitle(document, slot)]),
      lead === undefined ? null : identity(lead),
      footerRelationships(document, slot.members),
    ],
  );
}

/**
 * The relationships of the keys a footer row stands for.
 *
 * EVERY FOOTER SHAPE CARRIES THEM, and that is the rule rather than three
 * places to remember. A footer row is the ONLY mark either projection makes for
 * its issue — the list draws no arc at all, and the graph draws no node for
 * anything down here — so an edge whose ends are both in this group had nothing
 * left to represent it and disappeared entirely while both issues stayed
 * visible. That is a picture that lies about the document rather than one that
 * shows less of it, and it arrived once per row shape: the aside row, then this
 * one. One helper, called by all three.
 */
function footerRelationships(
  document: NormalizedDocument,
  keys: readonly string[],
): ElementSpec | null {
  return edgeBadges(document, keys);
}

// EXPORTED FOR THE GRAPH'S REFUSAL, which is the only other place an exclusion
// has to be drawn: when the graph refuses, its rail is the whole order UI and
// an exclusion rendered nowhere would make the refusal's own completeness claim
// false. One row shape for both projections rather than a second that can drift.
export function excludedRow(
  document: NormalizedDocument,
  key: string,
  canonical: string,
  options: SceneOptions,
): ElementSpec {
  const issue = document.byKey.get(key);
  // THE SAME ONE-LINE SHAPE THE OTHER FOOTER ENTRIES TAKE. A duplicate is the
  // clearest case of "not a fact about the work": it is never worked at all, so
  // giving it a station, a badge row and a hold paragraph drew it as heavier
  // than the ranked rows it is excluded from.
  return element(
    'li',
    {
      class: 'ig-footer-row',
      'data-ig-key': key,
      'aria-current': options.selected === key ? 'true' : 'false',
      'aria-label': `${issue?.title ?? key} — ${treatmentFor('duplicate-of').label} ${canonical}, never worked`,
      // A HARDCODED -1 HERE MEANT THE VIEWER LOST ITS TAB STOP ENTIRELY. An
      // exclusion is in `focusOrder`, so focus can resolve to one — and when it
      // did, no element carried `tabindex="0"` and Tab could not enter the
      // viewer at all. Every row that can hold focus renders the roving stop.
      tabindex: options.focused === key ? 0 : -1,
    },
    [
      element('span', { class: 'ig-badge', 'data-edge': 'duplicate-of' }, ['duplicate']),
      element('span', { class: 'ig-title' }, [issue?.title ?? key]),
      issue === undefined ? null : identity(issue),
      element('span', { class: 'ig-id' }, [`→ ${canonical}`]),
      footerRelationships(document, [key]),
    ],
  );
}

/**
 * A footer entry that is neither a slot nor an exclusion: an ordinary issue the
 * canvas had no column for.
 *
 * ONLY THE COMPACT GRAPH PRODUCES ONE. It draws no gutters, so an off-order
 * relationship endpoint — an open blocker, a closed split origin — has nowhere
 * on the picture to be, and vanishing is not an option: a smaller view must not
 * be a lying one. It takes the same one-line shape as every other footer entry,
 * because the reason it is down here is the same one — it is not a fact about
 * the order.
 */
export function asideRow(
  document: NormalizedDocument,
  key: string,
  options: SceneOptions,
): ElementSpec {
  const issue = document.byKey.get(key);
  return element(
    'li',
    {
      class: 'ig-footer-row',
      'data-ig-key': key,
      'aria-current': options.selected === key ? 'true' : 'false',
      'aria-label': `${issue?.title ?? key} — ${key} — outside the order`,
      tabindex: options.focused === key ? 0 : -1,
    },
    [
      element('span', { class: 'ig-badge' }, ['outside the order']),
      element('span', { class: 'ig-title' }, [issue?.title ?? key]),
      issue === undefined ? null : identity(issue),
      footerRelationships(document, [key]),
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
  rawOptions: SceneOptions = {},
): Scene {
  // NAMED THE WAY THIS PROJECTION NAMES THEM, BEFORE ANYTHING IS DRAWN. A
  // together unit is one row keyed by its lead, so a caller handing us a
  // partner is naming a subject this projection has a different name for —
  // and building the markup from the partner marked nothing `aria-current`
  // and left the tab stop on the fallback.
  const stations = stationsOf(document);
  const options = atStations(rawOptions, stations);
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
    ...footerSlots.map((slot) => footerRow(document, slot, withFocus)),
    ...document.order.excluded.map((exclusion) =>
      excludedRow(document, exclusion.key, exclusion.canonical, withFocus),
    ),
  ];

  // The runner's own words, when the host supplied them, to the RIGHT of the
  // count — which is where §16a puts them, and it is the difference between a
  // heading that says what this group is and one that also has to list the
  // reasons inside it.
  const labels = footerLabels(footerSlots);
  const footer =
    footerEntries.length === 0
      ? null
      : element('section', { class: 'ig-footer' }, [
          element('div', { class: 'ig-footer-head' }, [
            element('p', { class: 'ig-footer-title' }, [
              footerHeading(footerEntries.length, {
                runner: footerSlots.length > 0,
                neverWorked: document.order.excluded.length > 0,
                // The list draws every column it has, so it never withholds one.
                undrawn: false,
              }),
            ]),
            labels === '' ? null : element('span', { class: 'ig-footer-labels' }, [labels]),
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
    // The host facts first: what the runner is doing and how fresh the mirror
    // is frame the order beneath them. Both are `null` for a host that stated
    // nothing, and the section then begins at the legend exactly as before.
    // THE LEGEND IS A FOOTER BAR, WHERE §16b PUTS IT, and it comes last. Above
    // the rows it was the first thing a reader met — a table of five symbols
    // before a single row of the thing they came for — and §16a draws no
    // legend at that position at all.
    [
      options.chrome === false
        ? null
        : hostHeader(document, { projection: 'linear', switchable: options.switchable === true }),
      nowRows(document),
      body,
      footer,
      isolatedChip(document.isolated.length),
      legend(),
    ],
  );

  // The linear projection has one column, so nothing sits left or right of
  // anything. An empty map is the honest answer; a self-referencing one would
  // make a lateral key press look handled.
  const lateral: ReadonlyMap<string, LateralNeighbours> = new Map();

  // No lateral axis here, so nothing is reachable sideways that the order does
  // not already contain.
  return {
    projection: 'linear',
    root,
    focusOrder,
    navigable: focusOrder,
    lateral,
    // A together unit is ONE row keyed by its lead, so its partners are drawn
    // under that station and are absent from the order above.
    stationOf: stations,
    diagnostics: [],
  };
}
