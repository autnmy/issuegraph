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
  EDGE_TREATMENTS,
  type ElementSpec,
  type Theme,
  type ViewerDocument,
  clusterReachLabel,
  element,
  renderMarkup,
  renderViewer,
  resolveTheme,
  themeCss,
  viewerStylesheet,
} from '@issuegraph/viewer';

import type { ProjectedEdge } from '@issuegraph/store';

import { overlaysFor } from '../overlay/projected.ts';
import { attachEdgeOverlays } from '../overlay/render.ts';
import { edgeMarkRequests } from '../overlay/request.ts';
import { edgeOverlayStylesheet } from '../overlay/styles.ts';
import { INITIAL_SCALE_STATE, type ScaleState } from './commands.ts';
import {
  type IsolatedChip,
  type OmittedComponents,
  type ScaleCapsule,
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
  /**
   * The selected EDGE's identity, drawn on the canvas as a selection halo.
   *
   * THE OTHER HALF OF `selected`, AND IT COULD NOT BE FOLDED INTO IT. A
   * workspace holds one selection of one of two kinds, and the viewer's own
   * `selected` renders `aria-current` on a NODE — so an edge identity handed to
   * that option matches nothing, and the canvas drew the selected edge as
   * ordinary while the inspector was filtered to it. One value, two zones, and
   * the canvas was the zone that could not read it.
   *
   * THE LADDER APPLIES THE OVERLAY ITSELF rather than publishing its scene for
   * a caller to decorate. Exposing the scene would have left two ways to obtain
   * this canvas's markup — `result.markup`, and a re-render of the decorated
   * scene — with the first silently wrong for an edge selection. A result with
   * a stale field beside a correct one is worse than a narrower option.
   *
   * Resolved against `ladder.canvas`, which is what this canvas actually draws:
   * a narrowed tier, or a refusal that draws no canvas at all, renders as
   * nothing selected rather than as a halo on a line that is not there.
   */
  readonly selectedEdge?: string | null | undefined;
  /**
   * The store's projection — every edge to draw, each carrying its write
   * states — so the canvas shows what is HAPPENING to an edge, not only what
   * it is: a `pending-write` dash, an `invalid` or `failed` cross, a
   * `conflict`'s second version.
   *
   * ADDITIVE AND OPTIONAL, like the two options above, and for the same reason:
   * the overlays module already composes the store's projection, and the
   * ladder is the layer that holds the scene the overlays attach to. Without
   * this the only state the canvas could draw was the selection, and a host
   * had no way to show a write in flight on the line it concerns.
   *
   * Resolved against `ladder.canvas.edges` exactly as `selectedEdge` is: an
   * entry naming an edge this tier does not draw contributes nothing. An entry
   * for the selected edge composes with the halo rather than replacing it,
   * because `overlayFor` reads a list of states.
   */
  readonly projected?: readonly ProjectedEdge[] | undefined;
  /**
   * Whether this ladder draws its own isolated CHIP. Default `true`.
   *
   * SUPPRESS THIS ONLY IF YOU DRAW THE CONTROL YOURSELF. `searchFor`
   * deliberately omits every issue with no component (`ladder.ts`, and the
   * reasoning is recorded there), so this is the only way these issues are
   * reachable from the ladder's own surface. What may never be optional is a
   * route to them; this option says who draws its control, not whether it
   * exists.
   *
   * THE LIST IS NOT OPTIONAL AND IS NOT PART OF THIS. `isolatedSpec` keeps
   * drawing it whatever this says, because the caller that wants the control
   * has nowhere better to put the rows: `renderWorkspace`'s rail is virtualized
   * on a fixed row pitch, and content of arbitrary height inside that scroll
   * track breaks the offset-to-row arithmetic the window is re-cut from. This
   * zone has no such constraint.
   *
   * A BOOLEAN AMONG DATA-SHAPED OPTIONS, and it is one deliberately. Its three
   * siblings hand this renderer a VALUE it could not otherwise know — what is
   * selected, which edges are in flight. This one answers a different question:
   * whether a caller has already drawn a control this renderer would otherwise
   * draw. There is no value that carries that fact, because it is a fact about
   * the caller's own markup.
   *
   * DEFAULT `true`, so a standalone ladder is unchanged. It has no rail to put
   * a footer at the foot of, which is why the control lives in its chrome by
   * default rather than by accident; `renderWorkspace` is the caller that has
   * one, and §17a puts the count there.
   */
  readonly isolatedChip?: boolean | undefined;
  /**
   * The id to put on the isolated list, for a caller whose control is elsewhere.
   *
   * MINTED BY THE CALLER, BECAUSE ONLY THE CALLER KNOWS THE PAGE. `searchSpec`
   * records why this renderer must not invent one: a host rendering two
   * documents side by side emits the markup twice, and a duplicated `id` makes
   * the second surface's reference resolve to the first surface's element. The
   * caller drawing the remote control is the one that can make the value unique
   * and use the same string on both halves.
   *
   * Absent, the list carries no `id` and no control names it — which is right
   * for the adjacent chip, whose list is already its next sibling.
   */
  readonly isolatedListId?: string | undefined;
}

export interface ScaleLadderResult {
  readonly ladder: ScaleLadder;
  /** The canvas, when there is one, followed by the ladder's own chrome. */
  readonly markup: string;
  /** The viewer's stylesheet, the theme, and the chrome's own. Install all. */
  readonly styles: string;
  readonly diagnostics: readonly string[];
}

/**
 * What the capsule list left out, with the size range frame `17f` draws under
 * it — "+ 5 more" over "2-7 issues each".
 *
 * THE RANGE IS THE HALF THAT SAYS WHETHER THE TAIL MATTERS. A bare count leaves
 * the reader unable to tell five components of two from five of ninety, and
 * only one of those is safe to leave alone. A single omitted size, or several
 * of one size, states that size once rather than as a range against itself.
 */
function omittedSpec(omitted: OmittedComponents | null): ElementSpec | null {
  if (omitted === null) return null;
  const { range } = omitted;
  const span =
    range === null
      ? ''
      : range.smallest === range.largest
        ? ` \u00b7 ${String(range.smallest)} ${range.smallest === 1 ? 'issue' : 'issues'} each`
        : ` \u00b7 ${String(range.smallest)}\u2013${String(range.largest)} issues each`;
  return element('p', { class: 'ig-refusal-omitted' }, [
    `${String(omitted.count)} further ${omitted.count === 1 ? 'component is' : 'components are'} not listed${span}.`,
  ]);
}

/**
 * The capsule's accessible name — the same facts as a sentence.
 *
 * ONE FACT, ONE WORDING still holds: the reach comes from `clusterReachLabel`
 * exactly as the visible text does, so the two can never describe a component
 * differently. What differs is only what a glyph cannot carry.
 *
 * THE LEAD IS IN IT BECAUSE THE TITLE IS NOT UNIQUE. A component has no name of
 * its own, so `name` is the LEAD ISSUE'S TITLE — and two components whose leads
 * share a title and agree on size, blocking count and reach would otherwise
 * carry the same accessible name, with no key drawn on the card to tell them
 * apart either. The lead key is unique by construction, because components
 * partition the document's keys; naming it keeps the guarantee the old
 * `Focus <lead>` label had by accident.
 */
function capsuleLabel(capsule: ScaleCapsule): string {
  const blocking =
    capsule.reach.kind === 'cyclic'
      ? 'holds a cycle'
      : `${String(capsule.blockedByEdges)} blocked-by ${capsule.blockedByEdges === 1 ? 'edge' : 'edges'}`;
  return `Focus ${capsule.name} (${capsule.lead}) \u2014 ${String(capsule.size)} issues, ${blocking}, ${clusterReachLabel(capsule.reach)}`;
}

/**
 * One component, as frame `17f` draws it: a card whose whole surface enters it.
 *
 * THE CAPSULE IS THE CONTROL, not a row with a button in it. The frame says
 * "click to enter one; the spine renders inside it", and a `Focus #101` button
 * beside four static spans makes the pointer target a fraction of what is drawn
 * as one surface — while putting the LEAST informative thing, a raw key, first
 * in the reading order.
 *
 * THIS IS LAYER 2 AND ONLY LAYER 2. `graph.ts` deliberately draws its §16
 * capsule as an inert `li`, because that package does not narrow and a control
 * there could never complete the action it advertises. Layer 2 narrows, so here
 * the control is real — the same reasoning, landing on the opposite answer.
 *
 * ORDERED BY WHAT CHANGES BEHAVIOUR, which is the frame's own annotation:
 * count, then the blocking count or the cycle that voids it, then the name,
 * then the reach. The accessible name is written rather than left to the
 * contents, and carries the lead key so two capsules are told apart by their
 * own identity rather than by position.
 */
function capsuleSpec(capsule: ScaleCapsule): ElementSpec {
  // A CELL, NOT A CAPSULE. `.ig-capsule` is layer 1's own CARD — background,
  // border, radius, padding and a top margin (`viewer/src/styles.ts`) — so
  // keeping it here drew a bordered box inside a bordered box, put the stuck
  // tint and the hover on the INNER border only, and made the row gutter wider
  // than the column gutter by that margin. Resetting it from layer 2 would be
  // redefining a layer 1 class, which this package's stylesheet opens by
  // refusing to do; the list item simply stops claiming to be one.
  return element('li', { class: 'ig-capsule-cell' }, [
    element(
      'button',
      {
        type: 'button',
        class: 'ig-capsule-enter',
        'data-ig-command': 'focus',
        'data-ig-target': capsule.lead,
        // THE REACH AS AN ATTRIBUTE, so the frame's tint on a stuck card is a
        // rule rather than a second branch in the markup, and a host styling
        // the board can reach the same distinction.
        'data-reach': capsule.reach.kind,
        // WRITTEN, NOT LEFT TO THE CONTENTS. `element` concatenates children
        // with no whitespace — the trap `.ig-isolated-list` already records —
        // so the four parts below would reach a screen reader as one run:
        // "20\u2298 19Issue c0-1deepest chain 19". The gap that separates them
        // is CSS, which the accessibility tree does not read. This also spells
        // out the glyph, which is a shape with no name of its own.
        'aria-label': capsuleLabel(capsule),
      },
      [
        element('span', { class: 'ig-capsule-size' }, [String(capsule.size)]),
        // THE CYCLE STANDS WHERE THE BLOCKING COUNT STANDS. On a stuck
        // component the number of blocking edges is not the fact that changes
        // what the reader does: none of the members is reachable however few
        // there are.
        //
        // NEITHER SLOT TAKES `.ig-count`, and that is not a style preference:
        // layer 1 gives that class a cell's padding (`styles.ts`), which inside
        // a card indents the text off the grid line the count above it sits on.
        // The `ig-capsule-*` classes are this card's own, so it can place its
        // four parts without editing a class §16's capsule also draws.
        capsule.reach.kind === 'cyclic'
          ? element('span', { class: 'ig-capsule-load ig-badge', 'data-edge': 'blocked-by' }, [
              'cycle',
            ])
          : element('span', { class: 'ig-capsule-load' }, [
              `${EDGE_TREATMENTS['blocked-by'].glyph} ${String(capsule.blockedByEdges)}`,
            ]),
        element('span', { class: 'ig-capsule-name' }, [capsule.name]),
        element('span', { class: 'ig-capsule-reach' }, [clusterReachLabel(capsule.reach)]),
      ],
    ),
  ]);
}

function refusalSpec(refusal: ScaleRefusal, ladder: ScaleLadder): ElementSpec {
  return element('section', { class: 'ig-refusal', role: 'note' }, [
    element('p', {}, [refusal.reason]),
    ladder.capsules.length === 0
      ? null
      : element(
          'ol',
          { class: 'ig-list', 'aria-label': 'connected components' },
          ladder.capsules.map((capsule) => capsuleSpec(capsule)),
        ),
    omittedSpec(ladder.capsulesOmitted),
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

/**
 * The isolated set: a chip that toggles it, and the list it opens.
 *
 * `chip` DROPS THE CONTROL AND KEEPS THE LIST, which is the whole shape
 * `ScaleLadderOptions.isolatedChip` needs. A caller drawing the toggle
 * elsewhere still has nowhere of its own to put 248 rows: the workspace's rail
 * is VIRTUALIZED — `railRowAt` maps a scroll offset to a row index by
 * `floor((scrollTop - chrome) / pitch)` — so a list of arbitrary height inside
 * that track makes every offset below it name the wrong row, and the window
 * re-cuts against a geometry that no longer holds. This zone has no such
 * arithmetic, so the list stays here and only the control moves.
 */
function isolatedSpec(
  isolated: IsolatedChip,
  chip: boolean,
  listId: string | undefined,
): ElementSpec | null {
  // NOTHING IS DRAWN FOR AN EMPTY SET. A chip reading "0 isolated issues" is a
  // control that opens nothing, and the count IS the information these issues
  // carry — so with no issues there is nothing to say.
  if (isolated.count === 0) return null;
  // NO CONTROL AND NOTHING OPEN IS NOTHING AT ALL. A caller that drew the chip
  // elsewhere leaves this with only the list to draw, and a shut list is no
  // list — so the wrapper would be an empty bordered box, which is the chrome
  // carrying no fact that the count-zero rule above already refuses.
  if (!chip && !isolated.open) return null;
  return element('div', { class: 'ig-ladder-isolated' }, [
    !chip ? null : element(
      'button',
      {
        type: 'button',
        class: 'ig-chip',
        'aria-expanded': isolated.open ? 'true' : 'false',
        // NO `aria-controls` WHEN THIS CHIP IS THE CONTROL, AND THAT IS NOT AN
        // OMISSION. The list is this button's immediate next sibling, so the
        // relationship is already there in reading order; `aria-controls` earns
        // its keep for a REMOTE disclosure, which is why the workspace's footer
        // carries one and this does not.
        //
        // AND A FIXED ID HERE WOULD BE A DEFECT, not a shortcut. `searchSpec`
        // below nests its input inside its label precisely so it needs no `id`,
        // recording that "a host rendering two documents side by side would emit
        // it twice" — the same host, the same page, and the second list would
        // then answer to the first surface's button. An earlier revision of this
        // file shipped a module constant with a comment claiming fixed ids were
        // the norm on these surfaces; the control ten lines down had already
        // decided otherwise.
        ...(isolated.open && listId !== undefined ? { 'aria-controls': listId } : {}),
        'data-ig-command': isolated.open ? 'close-isolated' : 'open-isolated',
      },
      [isolated.label],
    ),
    // A LIST, NEVER A CANVAS. These issues have no relationship to draw, which
    // is exactly why they were collapsed in the first place.
    isolated.open
      ? element(
          'ol',
          // THE ID IS THE CALLER'S, OR THERE IS NONE. Only a caller drawing the
          // control somewhere else needs to name this list, and only that caller
          // knows what else is on its page — so it mints the value and passes it
          // to both halves. This renderer inventing one would be the collision
          // `searchSpec` avoids.
          {
            class: 'ig-isolated-list',
            ...(listId === undefined ? {} : { id: listId }),
            'aria-label': 'isolated issues',
          },
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

  // THE OVERLAYS ARE RESOLVED BEFORE THE CANVAS IS DRAWN, because the marks
  // among them are an INPUT to the drawing rather than something added over it.
  // A mark needs a position, and the only layer that has one is the layer that
  // computes the layout — so the request goes in with the render and the placed
  // marks come back inside the scene. The stroke-derived overlays still go the
  // other way, attached to the scene afterwards, because those reuse a position
  // that is already solved.
  const requestedOverlays = overlaysFor(ladder.canvas.edges, options.projected, options.selectedEdge);

  const canvas =
    ladder.tier === 'direct'
      ? renderViewer(ladder.canvas, {
          projection: 'graph',
          theme,
          selected: options.selected ?? null,
          // THE PANEL HAS ONE HEADER, and the rail beside this canvas is
          // drawing it. Two would mean two projection toggles disagreeing
          // about which projection is current.
          chrome: false,
          edgeMarks: edgeMarkRequests(requestedOverlays),
        })
      : null;

  // THE SELECTION HALO AND THE WRITE STATES, attached to the scene the canvas
  // just drew. Resolved against `ladder.canvas.edges` — the document this canvas
  // was rendered from — rather than against the caller's input: an identity
  // naming an edge this tier does not draw resolves to nothing, which is the
  // promise every zone makes. A selection is a NAME, and a name that no longer
  // resolves renders as nothing selected. The merge itself is `overlaysFor`,
  // shared with the workspace's tree canvas so the two cannot drift.
  const overlays = canvas === null ? [] : requestedOverlays;
  // `unattached` IS DELIBERATELY NOT SURFACED HERE, and the reason is a fact
  // about this call site rather than about the value.
  //
  // `attachEdgeOverlays` reports an overlay whose edge the scene did not draw
  // because a caller can hand it edges from anywhere. This one hands it exactly
  // one edge, found moments earlier IN `ladder.canvas` — the same document the
  // scene beside it was rendered from — and layer 1 states that geometry cannot
  // fail for a kept edge: `edgeGeometry` returns `null` only when "a caller
  // built a layout from a different document than the edge came from".
  //
  // So the one state this would report is one the inputs cannot reach, and the
  // near miss it looks like — the viewer refusing under a `direct` tier —
  // already reports itself through `canvas.diagnostics`. A diagnostic string no
  // test can make appear is a claim about behaviour nobody can check; the
  // reasoning is worth more here than the branch.
  const overlaid =
    canvas === null || overlays.length === 0 ? null : attachEdgeOverlays(canvas.scene, overlays, { theme });

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
    // THE CONTROL, UNLESS THE CALLER DREW IT — the LIST is drawn either way.
    // See `ScaleLadderOptions.isolatedChip`, and `ladder.ts`'s `searchFor` for
    // why there has to be a route at all.
    isolatedSpec(ladder.isolated, options.isolatedChip ?? true, options.isolatedListId),
  ]);

  return {
    ladder,
    // SIBLINGS RATHER THAN A HAND-BUILT WRAPPER. Every byte here comes from
    // `renderMarkup`, so no attribute value in this package is ever
    // concatenated into markup by hand — which is the escaping surface a
    // second, hand-rolled renderer would have introduced.
    markup: `${overlaid === null ? (canvas?.markup ?? '') : renderMarkup(overlaid.scene.root)}${renderMarkup(chrome)}`,
    // THE OVERLAY'S OWN SHEET TRAVELS WITH THE MARKUP THAT NEEDS IT. The halo
    // is a class this package styles, so a canvas that can draw one and a
    // stylesheet a caller has to remember separately is a mark that renders
    // invisibly whenever the caller forgets.
    styles: `${viewerStylesheet}\n${themeCss(theme, options.themeSelector ?? ':root')}\n${scaleLadderStylesheet}\n${edgeOverlayStylesheet}`,
    diagnostics: [...ladder.diagnostics, ...(canvas?.diagnostics ?? [])],
  };
}
