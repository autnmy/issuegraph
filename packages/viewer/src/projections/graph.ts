/**
 * The graph projection: the ordered spine with gutters, and arcs for everything
 * off it.
 *
 * Sequence is vertical position on the spine. Dependency is the arcs. Both
 * readings work at once because they use different visual channels, which is
 * the whole reason this shape was chosen over a force-directed or layered
 * drawing — those make dependency legible and sequence a hunt, and their layout
 * shifts between refreshes, which destroys trust in a panel whose job is to be
 * authoritative.
 *
 * IT REFUSES RATHER THAN DEGRADES. The list scales; the canvas is a local
 * instrument answering "what surrounds this issue", so past its budget it says
 * so and offers the next move instead of drawing a hairball.
 */

import { type EdgeField, edgeIdentity } from '@issuegraph/core';

import { clustersOf } from '../clusters.ts';
import type {
  NormalizedDocument,
  ViewerEdge,
  ViewerExclusion,
  ViewerSlot,
} from '../document.ts';
import { type ElementSpec, element, svg } from '../element.ts';
import {
  type Column,
  type EdgeGeometry,
  type GraphLayout,
  edgeGeometry,
  layoutGraph,
} from '../layout.ts';
import {
  type CardBlock,
  atStations,
  cardBlocks,
  caveatBadges,
  footerLabels,
  nowRows,
  caveatText,
  edgeBadgeList,
  emptyState,
  evidenceBadge,
  hostHeader,
  identity,
  legend,
  notReadyBadge,
  priorityBadge,
  slotLabel,
  stationFill,
  stationsOf,
  unitBlock,
} from '../parts.ts';
import { type LateralNeighbours, type Scene, resolveFocusKey } from '../scene.ts';
import { type Theme, resolveTheme } from '../theme.ts';
import { type EdgeTerminal, dashArrayFor, treatmentFor } from '../vocabulary.ts';
import {
  type SceneOptions,
  asideRow,
  excludedRow,
  footerHeading,
  footerRow,
  isFooterSlot,
  slotRow,
} from './linear.ts';

/**
 * The node budget, from the design's scale table. Above the first threshold the
 * canvas shows component capsules; above the second, clusters only.
 */
export const GRAPH_NODE_BUDGET = 60;
export const CLUSTER_ONLY_BUDGET = 300;

export interface GraphOptions extends SceneOptions {
  /**
   * Draw the in-column preview rather than the full-width picture.
   *
   * §16b fixes the rule and the reason: at a settings column's width the
   * relationship arcs and both gutters cannot be drawn legibly, so in a column
   * the graph is a spine-only preview carrying an expand affordance. The host
   * decides which — it is the only party that knows how much room it gave the
   * viewer.
   */
  readonly compact?: boolean | undefined;
  readonly theme?: Theme | undefined;
}

function terminalMarker(
  terminal: EdgeTerminal,
  geometry: EdgeGeometry,
  field: EdgeField,
  identity: string,
  theme: Theme,
): ElementSpec | null {
  const { end, endAngle } = geometry;
  const degrees = (endAngle * 180) / Math.PI;
  const transform = `translate(${end.x.toFixed(2)} ${end.y.toFixed(2)}) rotate(${degrees.toFixed(2)})`;
  // THE TERMINAL IS PART OF THE EDGE A READER SEES, so it answers to the same
  // identity as the stroke it caps. Without this the arrowhead is a hole in
  // its own line: the path beside it selects and the mark at its end resolves
  // to nothing, which reads as the click having missed.
  // Overlays are unaffected — `attachEdgeOverlays` skips `ig-terminal` on the
  // CLASS, before it ever looks at an identity, precisely so an overlay never
  // draws over one of the four redundant channels.
  const common = { class: 'ig-terminal', 'data-edge': field, 'data-ig-group': identity, transform };
  // Every dimension is theme data. A marker sized by a literal would stay put
  // while a host scaled the type around it, and the shape channel the
  // colour-blind-safety claim leans on is exactly what would stop reading.
  const length = theme.metrics['--ig-terminal-length'];
  const half = theme.metrics['--ig-terminal-width'] / 2;

  switch (terminal) {
    case 'arrow':
      return svg('path', {
        ...common,
        d: `M 0 0 L ${String(-length)} ${String(-half)} L ${String(-length)} ${String(half)} Z`,
        fill: 'currentColor',
      });
    case 'hollow-circle':
      return svg('circle', {
        ...common,
        cx: -half,
        cy: 0,
        r: half,
        fill: 'none',
        stroke: 'currentColor',
      });
    case 'tee':
      return svg('path', {
        ...common,
        d: `M 0 ${String(-half)} L 0 ${String(half)}`,
        stroke: 'currentColor',
        fill: 'none',
      });
    case 'none':
    case 'enclosure':
      return null;
  }
}

/**
 * One edge, drawn on all four channels: the path carries dash and hue, the
 * marker carries the terminal, and the badge grammar carries the glyph.
 *
 * `serialize-with` is drawn as two parallel strokes rather than one dashed
 * line — the "double" pattern is structural, so it cannot be confused with a
 * dash under any theme.
 */
function edgePaths(edge: ViewerEdge, geometry: EdgeGeometry, theme: Theme): ElementSpec[] {
  const treatment = treatmentFor(edge.field);
  const dash = dashArrayFor(treatment.dash);
  const label = `${edge.from} ${treatment.label} ${edge.to}`;
  const base = {
    class: 'ig-edge',
    'data-edge': edge.field,
    // THE SAME POINTER IDENTITY THE CONNECTOR ALREADY PUBLISHES. A
    // `together-with` connector has carried `edgeIdentity(...)` on
    // `data-ig-group` since it became a click target; every OTHER relationship
    // was drawn as a bare path with no identity at all, so `keyAt` walked past
    // it, found the canvas `<g>`, and a click on a `blocked-by` line either
    // named an unrelated issue or resolved to nothing. Four of the five
    // relationships could not be pointed at on the canvas.
    //
    // `data-ig-GROUP`, not `data-ig-key`, for the reason that attribute exists:
    // the focus index takes one element per key, and an edge is not a
    // navigation target — `navigable` lists issues. Pointer identity and focus
    // identity are different questions, and this one is only the first.
    //
    // `edgeIdentity` is the SAME function the store derives `StoredEdge.id`
    // with, so what `onSelect` hands the host is a key `findEdge` resolves
    // rather than a shape it has to be taught.
    'data-ig-group': edgeIdentity(edge.field, edge.from, edge.to),
    d: geometry.d,
    'stroke-dasharray': dash,
    role: 'img',
    'aria-label': label,
  } as const;

  if (treatment.dash === 'double') {
    // Separated by one stroke width, so the pair reads as two lines at any
    // scale rather than merging once a host thickens the stroke.
    const offset = theme.metrics['--ig-stroke'];
    return [
      svg('path', { ...base, transform: `translate(0 ${String(-offset)})` }),
      svg('path', {
        ...base,
        transform: `translate(0 ${String(offset)})`,
        'aria-hidden': 'true',
        role: null,
      }),
    ];
  }
  return [svg('path', base)];
}

/**
 * One node, drawn as an HTML card positioned on the coordinates the layout gave
 * it.
 *
 * A CARD, NOT A LABELLED RECTANGLE, and that is the change this pass exists to
 * make. Drawing a node's text in SVG means the text neither wraps nor clips, so
 * every title had to be run through a width fit and came out truncated — the
 * "Retype the ca…" the issue names. §16b's node is three lines deep: a title
 * that wraps, an identity, and a badge row, and none of that is expressible as
 * one centred `<text>`.
 *
 * IT ALSO SETTLES WHERE FOCUS LIVES. There used to be two kinds of node — a
 * rail row for a ranked slot and an SVG group for everything else — and three
 * rounds of review found the same class of defect at the seam between them: a
 * key published as a navigation target with no focusable element behind it. One
 * kind of node cannot have that seam.
 */
function nodeCard(
  document: NormalizedDocument,
  layout: GraphLayout,
  key: string,
  options: SceneOptions,
  focused: string | null,
): ElementSpec | null {
  const box = layout.nodes.get(key);
  if (box === undefined) return null;
  const issue = document.byKey.get(key);
  const slot = document.order.slots.find((candidate) => candidate.lead === key);
  const members = layout.slotMembers.get(key) ?? [key];
  const exclusion = document.order.excluded.find((candidate) => candidate.key === key);

  const caveats = caveatText(issue);
  const heldBecause = [
    ...(slot?.holds ?? []).map((hold) => hold.reason),
    ...(caveats === '' ? [] : [caveats]),
    ...(exclusion === undefined
      ? []
      : [`${treatmentFor('duplicate-of').label} ${exclusion.canonical} — never worked`]),
  ].join(' · ');

  // RENDERED FROM THE CARD'S OWN DESCRIPTION, which is also what the layout
  // counted this card's height from — see `CardBlock`. Built from a second
  // reading of what the card should hold, four blocks in a row were added to
  // the drawing and not to the count, and every one of them overran the box the
  // arcs were anchored to.
  const drawn = cardBlocks(document, key, members, box.column === 'spine', box.now === true).map(
    (block) => cardMark(document, block, key, members, slot),
  );

  const label = [
    slot === undefined ? (issue?.title ?? key) : slotLabel(document, slot),
    heldBecause === '' ? null : heldBecause,
  ]
    .filter((part): part is string => part !== null)
    .join(' — ');

  return element(
    'li',
    {
      class: 'ig-rail-row',
      'data-ig-key': key,
      'aria-current': options.selected === key ? 'true' : 'false',
      'aria-label': label,
      title: heldBecause === '' ? null : heldBecause,
      tabindex: focused === key ? 0 : -1,
      // Positioned from the layout, not from the flow, so a card sits where its
      // edges terminate however the theme scales the geometry.
      style: `--ig-row-x:${String(box.x)}px;--ig-row-y:${String(box.y)}px;--ig-row-w:${String(box.width)}px;--ig-row-h:${String(box.height)}px`,
    },
    [
      element(
        'div',
        {
          class: 'ig-card',
          'data-column': box.column,
          'data-held': box.held ? 'true' : 'false',
          'data-now': box.now === true ? 'true' : 'false',
          'data-unit': members.length > 1 ? 'true' : 'false',
          'data-exclusion': exclusion === undefined ? null : 'true',
        },
        drawn,
      ),
    ],
  );
}

/** One described block, drawn. The other half of `cardBlocks`. */
function cardMark(
  document: NormalizedDocument,
  block: CardBlock,
  key: string,
  members: readonly string[],
  slot: ViewerSlot | undefined,
): ElementSpec {
  switch (block.kind) {
    case 'banner':
      return element('div', { class: 'ig-unit-mark' }, [
        element(
          'span',
          { class: block.mark === 'now' ? 'ig-now-mark' : 'ig-unit-pill' },
          [block.mark],
        ),
        block.note === '' ? null : element('span', { class: 'ig-unit-note' }, [block.note]),
      ]);
    case 'head': {
      const issue = document.byKey.get(block.key);
      return element('div', { class: 'ig-row-head' }, [
        element('span', { class: 'ig-title' }, [issue?.title ?? block.key]),
        issue === undefined ? null : identity(issue),
      ]);
    }
    case 'unit':
      // Through `unitBlock`, so the enclosure and its deep links are the ones
      // the list draws rather than a second spelling of them.
      return slot === undefined
        ? element('div', { class: 'ig-row-head' }, [])
        : (unitBlock(document, slot) ?? element('div', { class: 'ig-row-head' }, []));
    case 'badges':
      // THE BADGE ROW IS THE SAME ONE THE LIST DRAWS, which is what makes the
      // two projections one grammar rather than two spellings. A gutter card
      // carries it too: it is the only mark this projection draws for its
      // issue, so a relation left off it is one the graph reader never sees.
      return element(
        'div',
        { class: 'ig-badges' },
        // FROM THE SAME BUILDERS `badgeTexts` READS, so what the layout packed
        // and what the card draws are one list of chips rather than two that
        // can differ by one.
        [
          priorityBadge(document.byKey.get(key)?.provenance),
          evidenceBadge(document.byKey.get(key)),
          slot === undefined ? null : notReadyBadge(slot),
          ...caveatBadges(document.byKey.get(key)),
          ...edgeBadgeList(document, members),
        ].filter((badge): badge is ElementSpec => badge !== null),
      );
    case 'note':
      // A SPINE CARD KEEPS ITS SENTENCES ON THE TOOLTIP, because the list
      // projection prints them and §16b's spine card draws a chip. A gutter card
      // is the only mark this projection makes for its issue, so its sentence
      // has nowhere else to be — and §16b prints it there.
      return element('p', { class: 'ig-hold', 'data-family': 'tracker' }, [
        element('span', {}, [block.text]),
      ]);
  }
}

/**
 * The spine: one line, and one station per card on it.
 *
 * THE LINE IS THE POINT. §16c's whole argument for this layout is that sequence
 * gets a channel of its own — vertical position on a single line — so that
 * nothing has to encode sequence and dependency at once. Without the line drawn
 * there is no single line to read down, and the picture degrades into the
 * column of rectangles the alternatives were rejected for.
 */
function spineStations(
  document: NormalizedDocument,
  layout: GraphLayout,
  theme: Theme,
): readonly ElementSpec[] {
  const size = theme.metrics['--ig-station-box'];
  const stations: ElementSpec[] = [];
  for (const key of layout.spineOrder) {
    const box = layout.nodes.get(key);
    if (box === undefined) continue;
    const slot = document.order.slots.find((candidate) => candidate.lead === key);
    const fill = slot === undefined ? 'filled' : stationFill(slot);
    // A serialize hold waits on a PEER rather than on a rank above it, and the
    // frame colours that station differently for exactly that reason.
    const waiting = slot?.holds.some((hold) => hold.code === 'serialized') === true;
    stations.push(
      element(
        'span',
        {
          class: 'ig-spine-station',
          'data-fill': box.now === true ? 'filled' : fill,
          'data-wait': waiting ? 'serialize' : null,
          role: 'img',
          'aria-label':
            box.now === true
              ? 'working now'
              : slot === undefined || slot.rank === null
                ? 'held, no rank'
                : `rank ${String(slot.rank)}`,
          style: `--ig-station-x:${String(box.x - theme.metrics['--ig-space'] - size)}px;--ig-station-y:${String(box.y + theme.metrics['--ig-space'])}px`,
        },
        [box.now === true ? '▸' : slot?.rank === null || slot === undefined ? '—' : String(slot.rank)],
      ),
    );
  }
  return stations;
}

/** The three column headings, set at the x of the column each names. */
function columnHeads(layout: GraphLayout): readonly ElementSpec[] {
  const heads: readonly (readonly [Column, string])[] = [
    ['left', 'Explains the order'],
    ['spine', 'The work order ↓'],
    ['right', 'Not worked'],
  ];
  const drawn = new Set<Column>();
  for (const box of layout.nodes.values()) drawn.add(box.column);
  return heads
    .filter(([column]) => drawn.has(column))
    .map(([column, text]) =>
      element(
        'span',
        {
          class: 'ig-column-head',
          'data-column': column,
          style: `--ig-col-x:${String(layout.columnX[column])}px`,
        },
        [text],
      ),
    );
}

/**
 * What the ORDER UI draws when the canvas will not.
 *
 * A refusal's list is the whole order UI — the refusal's own last sentence
 * promises "the order list is complete at any size" — so it carries the footer
 * slots and the exclusions the canvas would otherwise have drawn. With a
 * canvas, every one of those is a card, so the list carries nothing and this
 * answers empty.
 *
 * ONE RULE, TWO READERS. This decides what renders AND what the focus index
 * publishes; declaring them separately is how a keyed row with nothing to focus
 * kept coming back.
 */
function refusalContents(
  document: NormalizedDocument,
  refused: boolean,
): { slots: readonly ViewerSlot[]; excluded: readonly ViewerExclusion[] } {
  return refused
    ? { slots: document.order.slots, excluded: document.order.excluded }
    : { slots: [], excluded: [] };
}

/**
 * The order as a list, for a document the canvas refuses.
 *
 * IT IS THE LINEAR PROJECTION'S OWN ROW, not a second spelling of it. The rail
 * that shipped had its own three-child row — rank, station, title — which drew
 * neither the badges nor the provenance the list draws, so a refused document
 * silently lost the explanation the unrefused one carried.
 */
function refusalOrder(
  document: NormalizedDocument,
  options: SceneOptions,
  focused: string | null,
): ElementSpec {
  const { slots, excluded } = refusalContents(document, true);
  const withFocus: SceneOptions = { ...options, focused };
  return element(
    'ol',
    { class: 'ig-list', 'aria-label': 'work order' },
    [
      ...slots.map((slot) => slotRow(document, slot, withFocus, true)),
      ...excluded.map((exclusion) =>
        excludedRow(document, exclusion.key, exclusion.canonical, withFocus),
      ),
    ],
  );
}

/**
 * The refusal.
 *
 * A refusal with a route forward reads as competence — but only if the route is
 * one the reader can actually take. "Select one component to draw it" was not:
 * the capsules carried no identity, nothing dispatched from them, and this
 * package never narrows to a component. Advertising an action nobody can
 * perform is worse than a plain refusal, so each capsule now carries its
 * component's lead as a pointer identity (a host receives it through
 * `onSelect`) and the instruction names what actually happens next — the host
 * narrows the document, because narrowing IS the host's job in a package that
 * renders exactly what it is given.
 */
function refusal(
  document: NormalizedDocument,
  layout: GraphLayout,
  nodeCount: number,
  mode: 'capsules' | 'clusters',
): ElementSpec {
  // THE SAME KEY SET THE COUNT ABOVE CAME FROM. `nodeCount` is `layout.nodes`,
  // so the component list has to partition `layout.nodes` or the two disagree —
  // which is how an edge-free over-budget document listed no components at all
  // under a sentence telling the reader to choose one.
  const clusters = clustersOf(document, new Set(layout.nodes.keys()));
  const heading =
    mode === 'capsules'
      ? `${String(nodeCount)} related issues is past this canvas's budget of ${String(GRAPH_NODE_BUDGET)}, so it is not drawing them.`
      : `${String(nodeCount)} related issues is far past this canvas's budget, so it is showing clusters only.`;

  // THE REFUSAL IS INFORMATIONAL. IT PUBLISHES NO CONTROL — and that is a
  // RESTRUCTURE, not a regression of the round-five finding it answers.
  // That finding offered two remedies: expose an actionable component target,
  // OR replace the instruction with an action the rendered API actually
  // supports. The first was taken, and it drew a defect in every round since —
  // the capsule was pointer-only, then it was a button outside the focus index
  // whose activation redraws and destroys itself, leaving a keyboard reader
  // with focus on nothing. Each patch was correct and each bought another.
  // The cause underneath them is that this package DOES NOT NARROW. It renders
  // exactly what it is given, so a control here can never complete the action
  // it advertises; only the host can, by narrowing the document and rendering
  // again. A control that cannot finish its own job is the surface generating
  // the findings, so it goes rather than gets a fourth fix — and with it go the
  // focus index it never belonged to, the synthesized click, and the group
  // identity nothing could act on.
  // The order list remains, and IS complete at any size: that is the action a
  // reader can actually take inside this package, so it is the one named below.
  const LIMIT = 12;
  const shown = mode === 'capsules' ? clusters : clusters.slice(0, LIMIT);
  // SAY WHAT WAS OMITTED. A silent slice left a reader looking at twelve
  // components and no indication that 139 others existed — under a heading
  // announcing it was showing clusters. Refusing to draw is defensible;
  // under-reporting the shape without saying so is not, because the reader
  // cannot tell a complete list from a truncated one.
  const omitted = clusters.length - shown.length;
  return element('section', { class: 'ig-refusal', role: 'note' }, [
    element('p', {}, [heading]),
    element(
      'ol',
      { class: 'ig-list', 'aria-label': 'connected components' },
      shown.map((cluster) =>
        element('li', { class: 'ig-capsule' }, [
          element('span', { class: 'ig-count' }, [`${String(cluster.members.length)} issues`]),
          element('span', { class: 'ig-count' }, [`${String(cluster.blockedByEdges)} blocking`]),
          element('span', { class: 'ig-count' }, [`depth ${String(cluster.chainDepth)}`]),
          cluster.hasCycle
            ? element('span', { class: 'ig-badge', 'data-edge': 'blocked-by' }, ['cycle'])
            : null,
          element('span', { class: 'ig-id' }, [cluster.members.slice(0, 3).join(', ')]),
        ]),
      ),
    ),
    omitted > 0
      ? element('p', { class: 'ig-refusal-omitted' }, [
          `${String(omitted)} further ${omitted === 1 ? 'component is' : 'components are'} not listed; ${String(clusters.length)} were found in total.`,
        ])
      : null,
    element('p', { class: 'ig-refusal-next' }, [
      'Narrow the document to one neighbourhood and render again — narrowing is the host\'s, because this package draws exactly what it is given. The order list is complete at any size.',
    ]),
  ]);
}

/**
 * The runner-held slots the canvas draws nowhere, as §16a's footer group.
 *
 * THE GRAPH AND THE LIST MUST SHOW THE SAME ISSUES. A projection change is a
 * change of representation, never of subject — so an issue the list carries in
 * its footer cannot simply be absent from the graph, whatever the canvas has
 * room for.
 */
function footerGroup(
  document: NormalizedDocument,
  layout: GraphLayout,
  options: SceneOptions,
  focused: string | null,
): ElementSpec | null {
  const entries = footerKeys(document, layout, { ...options, focused });
  if (entries.length === 0) return null;
  const slots = document.order.slots.filter((slot) => layout.footer.includes(slot.lead));
  const labels = footerLabels(slots);
  return element('section', { class: 'ig-footer' }, [
    element('div', { class: 'ig-footer-head' }, [
      element('p', { class: 'ig-footer-title' }, [footerHeading(entries.length)]),
      labels === '' ? null : element('span', { class: 'ig-footer-labels' }, [labels]),
    ]),
    element('ol', { class: 'ig-list', 'aria-label': 'held outside the order' }, entries),
  ]);
}

/**
 * A row for EVERY key the canvas drew nowhere, in the layout's own order.
 *
 * DERIVED FROM `layout.footer` AND NOTHING ELSE, which is the whole correction.
 * A group built from `order.slots` covered the runner-held ones; adding
 * `order.excluded` covered the duplicates; and an ordinary off-order
 * relationship endpoint — an open blocker, a closed split origin — is neither,
 * so in compact mode, where the gutters are not drawn, it was in
 * `layout.footer` and rendered by nothing at all. Two partial rules chasing one
 * set is how the key that belongs to neither goes missing, so there is one
 * rule: the layout says what it did not draw, and every one of those gets a row.
 */
function footerKeys(
  document: NormalizedDocument,
  layout: GraphLayout,
  options: SceneOptions,
): readonly ElementSpec[] {
  return layout.footer.map((key) => {
    const slot = document.order.slots.find((candidate) => candidate.lead === key);
    if (slot !== undefined) return footerRow(document, slot, options);
    const exclusion = document.order.excluded.find((candidate) => candidate.key === key);
    if (exclusion !== undefined) {
      return excludedRow(document, key, exclusion.canonical, options);
    }
    return asideRow(document, key, options);
  });
}

export function graphScene(document: NormalizedDocument, rawOptions: GraphOptions = {}): Scene {
  // See `linearScene` — the same rule, applied before the canvas is laid out.
  const stations = stationsOf(document);
  const options = atStations(rawOptions, stations);
  const theme = resolveTheme(options.theme);
  const layout = layoutGraph(document, theme, options.compact === true);
  const nodeCount = layout.nodes.size;

  const inline = document.order.slots.filter((slot) => !isFooterSlot(slot));
  const footerSlots = document.order.slots.filter(isFooterSlot);

  // ── WHICH KEYS CAN HOLD FOCUS IS DERIVED FROM WHAT THIS SCENE WILL DRAW ────
  //
  // Three rounds of review found the same class here — a key published as a
  // navigation target with no focusable element behind it — in three different
  // places: gutter nodes with no `tabindex`, then refusal mode replacing the
  // whole canvas while the published sets still named its nodes. Patching each
  // site kept the invariant true by maintenance, which is why it kept coming
  // back.
  //
  // So the sets are FILTERED BY WHAT RENDERS instead of declared beside it. The
  // rail always draws the ranked slots; the canvas draws every laid-out node,
  // and draws NOTHING keyed when it refuses or is empty. Everything downstream
  // is a subset of that, so "every published target is focusable" holds by
  // construction rather than by remembering.
  // AN EMPTY NODE MAP IS NOT AN EMPTY PANEL. In the column the gutters are not
  // drawn, so a document whose issues are all off the order — relationships and
  // no ranked or running station — lays out NOTHING and puts every one of them
  // in `layout.footer`. Read as a refusal, that said "no issue in this document
  // declares a relationship" about a document full of them AND suppressed the
  // footer group that was holding all of them, so the panel came back blank.
  // The question is whether this scene draws anything, and the footer draws.
  const drawsNothing = nodeCount === 0 && layout.footer.length === 0;
  const refused = drawsNothing || nodeCount > GRAPH_NODE_BUDGET;
  // FROM THE SAME RULE THE LIST RENDERS FROM — see `refusalContents`. With a
  // canvas every node is a card and the card owns the tab stop; without one,
  // the list is the whole order UI and its rows do.
  const shown = refusalContents(document, refused);
  const railed: ReadonlySet<string> = new Set([
    ...shown.slots.map((slot) => slot.lead),
    ...shown.excluded.map((exclusion) => exclusion.key),
  ]);
  // THE FOOTER GROUP IS FOCUSABLE TOO, and it is off the canvas: its rows are
  // drawn beneath the stage, so a set derived from the laid-out nodes alone
  // published nothing for them and a keyboard could not reach half the issues
  // the projection draws.
  const focusable: ReadonlySet<string> = new Set([
    ...railed,
    ...(refused ? [] : [...layout.nodes.keys(), ...layout.footer]),
  ]);

  const focusOrder = [
    ...inline.map((slot) => slot.lead),
    ...footerSlots.map((slot) => slot.lead),
    ...document.order.excluded.map((exclusion) => exclusion.key),
  ].filter((key) => focusable.has(key));

  // ── the lateral axis: ONLY PAIRS WHOSE REVERSE HOLDS ──────────────────────
  //
  // A one-way mapping is not a traversal — focus went out to a gutter node and
  // the opposite arrow answered `none`. Recording both ends fixed that, and
  // then broke on the case one gutter node is related to TWO spine slots: each
  // slot overwrote the gutter's single reverse entry, so `A.left = G` while
  // `G.right = B`, and left-then-right did not come back.
  //
  // A node has ONE neighbour per side, so a shared gutter cannot point back to
  // both — no amount of care makes it. So the invariant is the thing published:
  // a pair is written only when its reverse is still free, and a forward link
  // whose reverse could not be kept is not published either. Every pair in this
  // map is reversible, which `graph.test.ts` asserts over the whole map rather
  // than for one example.
  const lateral = new Map<string, LateralNeighbours>();
  const opposite = (side: 'left' | 'right'): 'left' | 'right' =>
    side === 'left' ? 'right' : 'left';
  const linkable = (key: string, side: 'left' | 'right'): boolean =>
    (lateral.get(key) ?? {})[side] === undefined;
  const link = (key: string, side: 'left' | 'right', target: string): void => {
    lateral.set(key, { ...(lateral.get(key) ?? {}), [side]: target });
  };

  for (const slot of document.order.slots) {
    if (!focusable.has(slot.lead)) continue;
    // FROM THE SPINE OUTWARD, and only from there. §16f gives the lateral keys
    // one job: leave the sequence for the gutter card that explains this rank,
    // and come back. A gutter card linked to ANOTHER gutter card is a step that
    // never touches the order at all — and it consumed the one neighbour-per-
    // side each node has, so the reverse link back to the spine could not be
    // written and the traversal stopped being reversible.
    if (layout.nodes.get(slot.lead)?.column !== 'spine') continue;
    // Every MEMBER's edges, not just the lead's: a together unit is one station
    // with one focus key, so a gutter neighbour reachable only through its
    // second member would otherwise be unreachable by keyboard entirely.
    const touching = slot.members.flatMap((member) =>
      (document.edgesOf.get(member) ?? []).map((edge) =>
        edge.from === member ? edge.to : edge.from,
      ),
    );

    for (const side of ['left', 'right'] as const) {
      const target = touching.find(
        (other) =>
          focusable.has(other) &&
          layout.nodes.get(other)?.column === side &&
          // Both directions have to be free, or the pair is not reversible.
          linkable(slot.lead, side) &&
          linkable(other, opposite(side)),
      );
      if (target === undefined) continue;
      link(slot.lead, side, target);
      link(target, opposite(side), slot.lead);
    }
  }

  // A NODE NO STATION REPRESENTS HAS NO KEYBOARD EXISTENCE AT ALL. The canvas
  // draws it with a key, so a pointer can select what a keyboard cannot reach —
  // and where NOTHING is ordered, every list is empty and the canvas offers no
  // keyboard entry whatsoever. Measured: a document with edges and no order
  // slots renders two keyed nodes and not one `tabindex`.
  // THE TEST IS "REPRESENTED BY A STATION", NOT "IN A LIST", and that distinction
  // is the whole correctness of this. A together unit is ONE station with one
  // focus key, so its non-lead members are absent from the order DELIBERATELY —
  // `104` in this package's fixture is exactly that, and an earlier version of
  // this fix gave it a station of its own, splitting the unit and breaking the
  // rule `navigation.test.ts` states in as many words. A member is represented
  // by its lead; only a key belonging to no slot at all is unrepresented.
  // THEY JOIN THE VERTICAL ORDER rather than the membership set alone, because
  // with a roving tabindex only the FOCUSED key is tabbable — a key focus can
  // never ARRIVE at is unreachable however wide the set of things that "can hold
  // focus" is. The arrows are the only way in.
  // APPENDED, so every ranked position keeps its rank and the first entry is
  // unchanged; in the layout's own node order, so the result is deterministic.
  const represented = new Set<string>();
  for (const slot of document.order.slots) for (const member of slot.members) represented.add(member);
  if (!refused) {
    // THE FOOTER GROUP'S KEYS TOO. Its rows are drawn beneath the stage rather
    // than on a column, so a set derived from the laid-out nodes alone reached
    // none of them — and in compact mode, where the gutters are not drawn, that
    // is every off-order endpoint the panel still lists.
    for (const key of [...layout.nodes.keys(), ...layout.footer]) {
      if (!focusOrder.includes(key) && !lateral.has(key) && !represented.has(key)) focusOrder.push(key);
    }
  }

  // A GUTTER NODE IS REACHABLE SIDEWAYS WITHOUT BEING A POSITION IN THE ORDER,
  // so the set that can hold focus is wider than the order that walks it.
  // `focusOrder` LEADS, so the first entry is the same under either — which is
  // why this is built AFTER the pass above rather than before it. Built first,
  // the lateral keys landed between the ranked entries and the appended ones and
  // `navigable` stopped leading with `focusOrder`, which the scene contract
  // requires and `graph.test.ts` asserts. Anything derived from the ORDER has to
  // come after a pass that changes the order.
  const navigableKeys = [...focusOrder];
  for (const key of lateral.keys()) {
    if (!navigableKeys.includes(key)) navigableKeys.push(key);
  }
  // One rule, shared with `reconcile` and the other projections, so the element
  // that renders `tabindex="0"` and the state a host reads cannot disagree.
  const navigable = {
    keys: navigableKeys,
    focused: resolveFocusKey(navigableKeys, options.focused, options.selected),
    railed,
  };

  const diagnostics: string[] = [];
  let canvas: ElementSpec;

  if (drawsNothing) {
    canvas = emptyState('No issue in this document declares a relationship, so the canvas is empty.');
  } else if (nodeCount === 0) {
    // Nothing to draw ON the canvas, and a footer group beneath it that is the
    // whole panel. No stage, no refusal: the group renders in ordinary flow.
    canvas = emptyState('Nothing in this document is in the order, so the spine is empty.');
  } else if (nodeCount > CLUSTER_ONLY_BUDGET) {
    diagnostics.push(`graph refused: ${String(nodeCount)} nodes is past the cluster-only budget of ${String(CLUSTER_ONLY_BUDGET)}`);
    canvas = refusal(document, layout, nodeCount, 'clusters');
  } else if (nodeCount > GRAPH_NODE_BUDGET) {
    diagnostics.push(`graph refused: ${String(nodeCount)} nodes is past the node budget of ${String(GRAPH_NODE_BUDGET)}`);
    canvas = refusal(document, layout, nodeCount, 'capsules');
  } else {
    const edgeLayers: ElementSpec[] = [];
    // ONE STATION PER SLOT MEANS ONE BOX PER SLOT, so an edge inside a unit has
    // both ends on the same card and no arc to draw. It is not lost: the card
    // lists its members, and the badge row names the relationship, which is the
    // same treatment the list projection gives it. `edgeGeometry` answers null
    // for exactly that case, and it resolves a member to its unit's card for
    // every other — so this loop asks the geometry rather than deciding twice.
    for (const edge of document.edges) {
      // No arcs in the column: §16b says they cannot be drawn legibly there,
      // and an arc drawn illegibly is worse than an arc a reader knows to
      // expand for. The badge row on every card still names the relationship.
      if (layout.compact) break;
      // THE ARROW POINTS AT WHAT IS HELD UP, not at what holds it. §16b draws
      // every blocking arc arriving on the blocked card, and it is the reading
      // that answers the question the panel exists for: a reader following an
      // arrowhead is asking "what is waiting on this", and an arrow into the
      // blocker answers the question nobody asked. The DECLARATION is untouched
      // — the identity below is still the field's own orientation, so what a
      // click reports is the edge as written.
      const drawn: ViewerEdge =
        edge.field === 'blocked-by' ? { field: edge.field, from: edge.to, to: edge.from } : edge;
      const geometry = edgeGeometry(layout, drawn);
      if (geometry === null) continue;
      edgeLayers.push(...edgePaths(edge, geometry, theme));
      const marker = terminalMarker(
        treatmentFor(edge.field).terminal,
        geometry,
        edge.field,
        edgeIdentity(edge.field, edge.from, edge.to),
        theme,
      );
      if (marker !== null) edgeLayers.push(marker);
    }

    // THE SPINE ITSELF, painted first so every arc bows off a line that is
    // already there. It spans the stations and no further: a line running the
    // full height of the canvas would imply order where the gutters sit.
    const spine =
      layout.spineOrder.length === 0
        ? null
        : svg('line', {
            class: 'ig-spine',
            x1: layout.spineLineX,
            y1: layout.spineTop,
            x2: layout.spineLineX,
            y2: layout.spineBottom,
          });

    canvas = svg(
      'svg',
      {
        class: 'ig-canvas',
        viewBox: `0 0 ${String(Math.round(layout.width))} ${String(Math.round(layout.height))}`,
        // The picture is decoration over an HTML rail that carries every node,
        // every name and every tab stop, so it announces nothing of its own.
        // `role="img"` with a label would put a second, flattened description of
        // the same nodes into the accessibility tree.
        'aria-hidden': 'true',
      },
      [spine, ...edgeLayers],
    );
  }

  // ONE LIST PER COLUMN, LABELLED THE WAY ITS HEADING IS. Every card in one
  // list called "work order" told a screen reader that the left gutter's
  // explanations and the right gutter's never-worked issues are ordered work —
  // which is the opposite of what those two columns exist to say, and what
  // their own visible headings say instead.
  const columns: readonly (readonly [Column, string])[] = [
    ['spine', 'work order'],
    ['left', 'explains the order'],
    ['right', 'not worked'],
  ];
  const cardLists = refused
    ? []
    : columns
        .map(([column, label]) => {
          const cards = [...layout.nodes.keys()]
            .filter((key) => layout.nodes.get(key)?.column === column)
            .map((key) => nodeCard(document, layout, key, options, navigable.focused))
            .filter((card): card is ElementSpec => card !== null);
          return cards.length === 0
            ? null
            : element('ol', { class: 'ig-list', 'aria-label': label }, cards);
        })
        .filter((list): list is ElementSpec => list !== null);

  const root = element(
    'section',
    { class: 'ig-viewer ig-graph', 'data-projection': 'graph', 'aria-label': 'issue order and relationships' },
    [
      options.chrome === false
        ? null
        : hostHeader(document, {
            projection: 'graph',
            compact: layout.compact,
            switchable: options.switchable === true,
          }),
      // ONE STAGE, sized in the layout's own units, so an absolutely-positioned
      // card and an SVG coordinate mean the same thing. A percentage-width
      // canvas would rescale under the cards and the two would drift apart.
      // A refusal draws no nodes, so it needs no stage and the list stays in
      // ordinary flow — a fixed-height stage would clip it.
      // NO STAGE WITHOUT A NODE TO SIT ON. A stage is sized in the layout's own
      // units, and a layout with no boxes has none — so a document whose issues
      // are all in the footer renders its message and its group in ordinary
      // flow, exactly as a refusal does, without BEING a refusal.
      refused || nodeCount === 0
        ? canvas
        : element(
            'div',
            {
              class: 'ig-stage',
              style: `--ig-stage-w:${String(Math.round(layout.width))}px;--ig-stage-h:${String(Math.round(layout.height))}px`,
            },
            [
              canvas,
              element('div', { class: 'ig-rail' }, [
                ...columnHeads(layout),
                ...cardLists,
                ...spineStations(document, layout, theme),
              ]),
            ],
          ),
      // THE RUNNING JOB SURVIVES A REFUSAL. A refused canvas draws no station,
      // so the one issue the panel exists to say is in flight vanished
      // completely when it held no slot, and was reduced to an ordinary order
      // row — no phase, no elapsed time — when it did. The band is what §16a
      // uses where there is no spine to put a station on, and a refusal is
      // exactly that case.
      refused ? nowRows(document) : null,
      refused ? refusalOrder(document, options, navigable.focused) : null,
      // §16a'S FOOTER GROUP, ON THE GRAPH. A runner-held slot that blocks
      // nothing on the spine has no column to sit in — it is neither the order
      // nor an explanation of it — and drawing it on the spine gave it a
      // position in a sequence it is not part of. So it lands here, in the same
      // one-line-each group the list draws, which is also what keeps the two
      // projections showing the same set of issues.
      refused ? null : footerGroup(document, layout, options, navigable.focused),
      document.isolated.length === 0
        ? null
        : element('p', { class: 'ig-count' }, [
            `${String(document.isolated.length)} isolated ${document.isolated.length === 1 ? 'issue' : 'issues'} not drawn`,
          ]),
      legend(),
    ],
  );

  return {
    projection: 'graph',
    root,
    focusOrder,
    navigable: navigableKeys,
    lateral,
    // The same stations the canvas keys its member nodes to through
    // `GROUP_ATTRIBUTE` — one rule, so the markup and the published state agree.
    stationOf: stations,
    diagnostics,
  };
}
