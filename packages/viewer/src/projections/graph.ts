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
  type EdgeGeometry,
  type GraphLayout,
  edgeGeometry,
  connectorPath,
  enclosureBounds,
  fitLabel,
  layoutGraph,
} from '../layout.ts';
import {
  edgeBadges,
  emptyState,
  legend,
  slotLabel,
  slotTitle,
  station,
  stationFill,
  stationsOf,
  atStations,
} from '../parts.ts';
import { type LateralNeighbours, type Scene, resolveFocusKey } from '../scene.ts';
import { type Theme, resolveTheme } from '../theme.ts';
import { type EdgeTerminal, dashArrayFor, treatmentFor } from '../vocabulary.ts';
import { type SceneOptions, excludedRow, isFooterSlot } from './linear.ts';

/**
 * The node budget, from the design's scale table. Above the first threshold the
 * canvas shows component capsules; above the second, clusters only.
 */
export const GRAPH_NODE_BUDGET = 60;
export const CLUSTER_ONLY_BUDGET = 300;

export interface GraphOptions extends SceneOptions {
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
 * One node on the canvas.
 *
 * A NODE THE SCENE PUBLISHES AS A NAVIGATION TARGET HAS TO BE FOCUSABLE. The
 * rail draws only the ranked spine slots, so a tracker-held slot, a duplicate
 * and every gutter node exist ONLY as this group — and an SVG group with no
 * `tabindex` cannot take focus, so navigating to one called `focus()` on
 * nothing and the visible tab stop vanished.
 *
 * `railed` names the keys the rail already draws, so exactly one element per
 * key is tabbable; a second tab stop for the same issue would be worse than
 * none. A focusable element also needs a name, hence `role`/`aria-label`.
 */
function nodeShape(
  document: NormalizedDocument,
  layout: GraphLayout,
  key: string,
  options: SceneOptions,
  theme: Theme,
  navigable: {
    readonly keys: readonly string[];
    readonly focused: string | null;
    readonly railed: ReadonlySet<string>;
  },
): ElementSpec | null {
  const box = layout.nodes.get(key);
  if (box === undefined) return null;
  const issue = document.byKey.get(key);
  const selected = options.selected === key;
  const ownsTabStop = navigable.keys.includes(key) && !navigable.railed.has(key);

  const full = issue?.title ?? key;
  const drawn = fitLabel(theme, full, box.width);

  // A HOLD THE RAIL DOES NOT CARRY HAS TO BE CARRIED HERE. The rail draws only
  // the non-footer slots, so a tracker-held slot is filtered out of it — and the
  // reason last round put on the rail row therefore never reached the graph at
  // all for exactly those slots, while `ViewerHold` says the viewer renders the
  // reason verbatim. Measured on the fixture: `claimed by another run` appeared
  // nowhere in graph markup.
  // I DEFERRED THIS ONCE ON A REASON THAT WAS WRONG, and it is worth recording:
  // I said `nodeShape` "takes a key and an issue and knows nothing about slots",
  // so carrying the reason would be a signature change touching every node. It
  // takes the whole `document`, and the slots are on it. There was no signature
  // change to make. See issue #41.
  // ONLY FOR A NODE THE RAIL DOES NOT LABEL — a railed slot already carries its
  // reason on its row, and repeating it here would announce the same sentence
  // twice for one slot.
  const heldBecause = navigable.railed.has(key)
    ? ''
    : document.order.slots
        .filter((slot) => slot.lead === key || slot.members.includes(key))
        .flatMap((slot) => slot.holds.map((hold) => hold.reason))
        .join(' · ');

  // THE POINTER MUST NOT NAME AN IDENTITY THE KEYBOARD CANNOT REACH. A together
  // unit is ONE station with one focus key, so its non-lead members are absent
  // from `navigable` deliberately — and this published each of them as its own
  // `data-ig-key` anyway. Measured on the fixture: clicking `104` emitted `104`,
  // selected `104`, and threw focus to `102` — not even the unit that was
  // clicked, because `resolveFocusKey` found neither the selection nor the
  // requested key in the order and fell back to its first entry. No keyboard can
  // produce that state.
  // ROUTED TO THE STATION, NOT MADE A STATION. Giving the partner its own focus
  // key is the other repair codex offered and it is the one round ten already
  // rejected: it splits the unit into two stations, which `navigation.test.ts`
  // forbids in as many words. So the member keeps its node and loses only its
  // FOCUS identity, which it never legitimately had.
  // `GROUP_ATTRIBUTE` IS EXACTLY THIS CHANNEL — the enclosure and the connector
  // already answer a pointer with their unit's lead through it, and a member's
  // node is the same question about the same unit. `keyAt` reads it as the
  // fallback the focus index never sees.
  // A KEY NO SLOT REPRESENTS FALLS BACK TO ITSELF, which is no worse than what
  // it published before; the orphan pass above is what makes such a key
  // navigable, and the invariant test is what proves it did.
  const published = navigable.keys.includes(key);
  const station = document.order.slots.find((slot) => slot.members.includes(key))?.lead ?? key;

  return svg(
    'g',
    {
      class: 'ig-node-group',
      'data-ig-key': published ? key : null,
      'data-ig-group': published ? null : station,
      'data-column': box.column,
      'aria-current': selected ? 'true' : 'false',
      role: ownsTabStop ? 'img' : null,
      // THE REASON RIDES THE NAME WHEN THERE IS ONE, on the same channels the
      // rail row uses, so one hold reads the same whichever surface drew it.
      'aria-label': ownsTabStop
        ? heldBecause === ''
          ? `${full} — ${key}`
          : `${full} — ${key} — ${heldBecause}`
        : null,
      tabindex: ownsTabStop ? (navigable.focused === key ? 0 : -1) : null,
    },
    [
      // AND ON THE POINTER CHANNEL, which is also the only one left for a node
      // that owns no tab stop and therefore carries no `aria-label` at all.
      // First child, because that is where SVG looks for `<title>`.
      heldBecause === '' ? null : svg('title', {}, [`${full} — ${heldBecause}`]),
      svg('rect', {
        class: 'ig-node',
        'data-held': box.held ? 'true' : 'false',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        rx: theme.metrics['--ig-radius'],
      }),
      // A node is labelled by its RAIL ROW when it has one, so labelling it
      // here too would print the title twice — once selectable, once not. But
      // the rail draws only the ranked slots, and keying this on the COLUMN
      // rather than on the rail left a tracker-held slot as a blank rectangle:
      // no title, no hold reason, nothing. The question is whether this key is
      // railed, not which column it sits in.
      navigable.railed.has(key)
        ? null
        : svg(
            'text',
            {
              class: 'ig-node-label',
              x: box.x + theme.metrics['--ig-space'],
              // `dominant-baseline` centres the glyphs on the line rather than
              // a remembered offset, so the label stays centred at any scale.
              y: box.y + box.height / 2,
              'dominant-baseline': 'middle',
            },
            [
              // THE FULL TITLE IS NOT LOST WHEN IT DOES NOT FIT — and it has to
              // be a CHILD ELEMENT to do that job. This was written as a `title`
              // ATTRIBUTE, which SVG ignores entirely: no tooltip, no accessible
              // description, nothing. The markup contained the string, so a test
              // asserting the full title was "somewhere in the markup" passed
              // while a reader hovering the shortened label recovered nothing.
              // FIRST CHILD, because that is where SVG looks for it, and only on
              // truncation — an untruncated label already reads in full, and a
              // `<title>` echoing it would announce it twice.
              // A railed node never reaches here at all: the rail row is its
              // label, and its own CSS ellipsis handles the same overflow.
              drawn === full ? null : svg('title', {}, [full]),
              drawn,
            ],
          ),
    ],
  );
}

/**
 * The spine's ranks and readiness stations, drawn as HTML ON the canvas.
 *
 * Text in SVG is not selectable, not reflowable and announces poorly, so the
 * spine's rows stay HTML — but they are the labels FOR the spine nodes, and
 * emitting them as a sibling block put them above the drawing instead of on it.
 * Ranks and stations then described a picture the reader had to hold in their
 * head, which is the opposite of the design's claim that the spine IS the
 * order.
 *
 * So each row is positioned at the coordinates the LAYOUT computed for its own
 * node — same source of truth as every edge endpoint. Hand-authoring these
 * against remembered positions is the failure mode the design's implementation
 * note names; the numbers ride custom properties so the theme still owns them.
 */
/**
 * What the rail draws — ONE rule, because two callers read it.
 *
 * `spineRail` renders these rows and the focus index has to publish exactly the
 * same set, or the projection draws a keyed row nothing can reach. That is not
 * hypothetical: widening the rail for the refusal without widening the index
 * left the footer slot and the exclusion drawn with `data-ig-key` and absent
 * from `navigable` — the identical defect the canvas had two rounds ago,
 * reintroduced by fixing its sibling. Deriving both from here is what makes the
 * two provably agree rather than agree by inspection.
 *
 * `positioned` is the refusal signal inverted: with a canvas, a footer slot is
 * drawn as a canvas node and an exclusion sits off the spine entirely, so the
 * rail carries neither. Without one, the rail IS the order.
 */
function railContents(
  document: NormalizedDocument,
  positioned: boolean,
): { slots: readonly ViewerSlot[]; excluded: readonly ViewerExclusion[] } {
  return positioned
    ? { slots: document.order.slots.filter((slot) => !isFooterSlot(slot)), excluded: [] }
    : { slots: document.order.slots, excluded: document.order.excluded };
}

function spineRail(
  document: NormalizedDocument,
  layout: GraphLayout,
  options: SceneOptions,
  focused: string | null,
  positioned: boolean,
): ElementSpec {
  // A REFUSAL'S RAIL IS THE WHOLE ORDER UI, so it must carry what the canvas
  // would otherwise have drawn. `positioned` is exactly the refusal signal — the
  // only `false` call site is the refusal arm — and when the canvas is absent, a
  // footer slot has nothing to draw it and an exclusion has no row at all.
  // Measured on a refused document: the tracker-held slot's title, its hold
  // reason, and the excluded key were all absent from the markup, while the
  // refusal's own text said "The order list is complete at any size". That claim
  // was written into this file and it was false.
  // FILTERED ONLY WHEN THE CANVAS DRAWS THEM. In ordinary graph mode a footer
  // slot IS drawn, as a canvas node, so keeping it out of the rail is what stops
  // one slot appearing twice — the filter is right there and wrong here.
  const { slots, excluded } = railContents(document, positioned);
  return element(
    'ol',
    // A plain list for the reason `linear.ts` gives: an interactive descendant
    // may not live inside `role="option"`.
    // WHEN THERE IS NO CANVAS THERE IS NOTHING TO SIT ON. A refusal draws no
    // spine nodes, so the rail returns to ordinary flow rather than positioning
    // itself against coordinates nothing rendered.
    { class: positioned ? 'ig-list ig-rail' : 'ig-list', 'aria-label': 'work order' },
    [
    ...slots.map((slot) => {
      const box = layout.nodes.get(slot.lead);
      // THE REASON A SLOT IS HELD IS PART OF WHAT THIS ROW MEANS. `ViewerHold`
      // says the viewer renders the reason verbatim, and the linear projection
      // does — this one rendered rank, station and title, so a graph reader was
      // told THAT a slot is held and never WHY. `data-held` styles the row, so
      // the holding was visible and the host's sentence was not, on either the
      // visible or the accessible channel.
      // ON THE LABEL AND THE TOOLTIP, NOT AS A BLOCK IN THE ROW. This row is
      // positioned onto its node's box — `--ig-row-h` IS the node height — so a
      // paragraph per hold would overflow geometry the layout computed for a
      // node, which is a worse defect than the one being fixed. `title` plus
      // `aria-label` is how this package already carries text that cannot take
      // space (see the edge badges): sighted readers hover, screen readers hear
      // it, and the layout is untouched.
      // ONLY HERE, not in `slotLabel`. That helper is shared with the linear
      // projection, which renders the same holds as visible paragraphs — adding
      // them there would announce every linear hold twice.
      const heldBecause = slot.holds.map((hold) => hold.reason).join(' · ');
      return element(
        'li',
        {
          class: positioned ? 'ig-slot ig-rail-row' : 'ig-slot',
          'data-ig-key': slot.lead,
          'data-held': slot.ready ? 'false' : 'true',
          'aria-current': options.selected === slot.lead ? 'true' : 'false',
          'aria-label':
            heldBecause === ''
              ? slotLabel(document, slot)
              : `${slotLabel(document, slot)} — ${heldBecause}`,
          title: heldBecause === '' ? null : heldBecause,
          tabindex: focused === slot.lead ? 0 : -1,
          // Positioned from the layout, not from the flow, so a row sits on the
          // node it names however the theme scales the geometry.
          style:
            positioned && box !== undefined
              ? `--ig-row-x:${String(box.x)}px;--ig-row-y:${String(box.y)}px;--ig-row-w:${String(box.width)}px;--ig-row-h:${String(box.height)}px`
              : null,
        },
        [
          element(
            'span',
            { class: 'ig-rank', 'data-held': slot.ready ? 'false' : 'true', 'aria-hidden': 'true' },
            [slot.rank === null ? '—' : String(slot.rank)],
          ),
          station(stationFill(slot)),
          element('span', { class: 'ig-title' }, [slotTitle(document, slot)]),
          // AND THE RELATIONSHIPS, ON THE SAME TERMS AS THE HOLDS AND THE
          // EXCLUSIONS ABOVE — a third instance of this rail dropping something
          // the canvas carries, found the same way. With a canvas, an edge is
          // drawn as an arc publishing `edgeIdentity(...)`; a refusal draws no
          // arcs, so without this the ONLY representation of a relationship
          // disappears exactly when the rail is claiming to be the whole order.
          // THE CONSEQUENCE IS A LOST SELECTION, not just a missing badge. A
          // badge is what puts an edge in `mount`'s `pointable` set, and an edge
          // identity is in no document — so a selection made in the linear or
          // tree projection was cleared on a switch INTO a refused graph, with
          // the host told `onSelect(null)`. That is the same defect the badge
          // identity was added to fix, surviving in the one projection state
          // that draws neither an arc nor a badge.
          // ONLY WHEN THE RAIL IS UNPOSITIONED, and that is the whole reason it
          // is safe. A positioned row sits ON its node's box — `--ig-row-h` IS
          // the node height — so badges there would overflow geometry the layout
          // computed for a node, which is why the holds above went onto the
          // label rather than into the row. A refusal positions nothing, so the
          // row is in ordinary flow and carries them exactly as a linear row
          // does. In positioned mode the canvas draws the arcs anyway, so there
          // is nothing missing to restore.
          positioned ? null : edgeBadges(document, slot.members),
        ],
      );
    }),
    // AND THE EXCLUSIONS, on the same terms: they have no canvas node in any
    // mode, so ordinary graph mode simply never showed them — which is correct
    // there, because the spine rail sits ON the canvas and an exclusion is not
    // on it. In a refusal there is no canvas, the rail is the entire order, and
    // an exclusion left out is a row of the order that is missing.
    ...excluded.map((exclusion) =>
      excludedRow(document, exclusion.key, exclusion.canonical, { ...options, focused }),
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

export function graphScene(document: NormalizedDocument, rawOptions: GraphOptions = {}): Scene {
  // See `linearScene` — the same rule, applied before the canvas is laid out.
  const stations = stationsOf(document);
  const options = atStations(rawOptions, stations);
  const theme = resolveTheme(options.theme);
  const layout = layoutGraph(document, theme);
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
  const refused = nodeCount === 0 || nodeCount > GRAPH_NODE_BUDGET;
  // FROM THE SAME RULE THE RAIL RENDERS FROM — see `railContents`. Hard-coding
  // `inline` here was correct only while the rail rendered exactly `inline`, and
  // it silently stopped being correct the moment the refusal's rail widened.
  const shown = railContents(document, !refused);
  const railed: ReadonlySet<string> = new Set([
    ...shown.slots.map((slot) => slot.lead),
    ...shown.excluded.map((exclusion) => exclusion.key),
  ]);
  const focusable: ReadonlySet<string> = new Set([
    ...railed,
    ...(refused ? [] : layout.nodes.keys()),
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
    for (const key of layout.nodes.keys()) {
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

  if (nodeCount === 0) {
    canvas = emptyState('No issue in this document declares a relationship, so the canvas is empty.');
  } else if (nodeCount > CLUSTER_ONLY_BUDGET) {
    diagnostics.push(`graph refused: ${String(nodeCount)} nodes is past the cluster-only budget of ${String(CLUSTER_ONLY_BUDGET)}`);
    canvas = refusal(document, layout, nodeCount, 'clusters');
  } else if (nodeCount > GRAPH_NODE_BUDGET) {
    diagnostics.push(`graph refused: ${String(nodeCount)} nodes is past the node budget of ${String(GRAPH_NODE_BUDGET)}`);
    canvas = refusal(document, layout, nodeCount, 'capsules');
  } else {
    const edgeLayers: ElementSpec[] = [];
    for (const edge of document.edges) {
      // `together-with` is drawn as an enclosure plus its connector, not as an
      // arc: it shares a rank rather than ordering anything.
      if (edge.field === 'together-with') continue;
      const geometry = edgeGeometry(layout, edge);
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

    // The one declared seam crossing: the connector lives in this layer,
    // because a click target cannot be added from outside without the viewer
    // knowing where members are.
    const enclosures: ElementSpec[] = [];
    for (const [lead, members] of layout.slotMembers) {
      const bounds = enclosureBounds(layout, members, theme);
      if (bounds === null) continue;
      enclosures.push(
        // `data-ig-GROUP`, not `data-ig-key`. The enclosure is painted BEFORE
        // the nodes so it sits behind them, and `mountViewer` indexes the first
        // element it sees for a key — so sharing the key made keyboard movement
        // to a canvas-owned lead call `focus()` on this non-tabbable rect
        // instead of its `<g tabindex="0">`. Decoration does not compete with
        // the thing it decorates for an identity.
        svg('rect', {
          class: 'ig-enclosure',
          'data-ig-group': lead,
          'stroke-dasharray': dashArrayFor('enclosure'),
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          rx: theme.metrics['--ig-radius'],
          role: 'img',
          'aria-label': `${members.join(' and ')} share one rank`,
        }),
      );
      const inUnit = new Set(members);
      for (const edge of document.edges) {
        // ONE CONNECTOR PER DECLARED EDGE, NOT ONE PER ADJACENT PAIR. Walking
        // the member list pairwise assumed a group is written as a chain — but
        // a writer joins one by pointing at ANY existing member (§4.3.7), so
        // `2 together-with 1` and `3 together-with 1` is an ordinary star. That
        // walk drew a `2`–`3` connector for a relationship the document does
        // not contain, so the identity it published resolved to no
        // `StoredEdge`, while the real `1`–`3` edge got no connector at all.
        // Reading the edges themselves cannot invent one and cannot miss one.
        if (edge.field !== 'together-with') continue;
        if (!inUnit.has(edge.from) || !inUnit.has(edge.to)) continue;
        const d = connectorPath(layout, members, edge.from, edge.to, theme);
        if (d === null) continue;
        enclosures.push(
          svg('path', {
            class: 'ig-connector',
            fill: 'none',
            // THE PAIR'S OWN IDENTITY, NOT THE SLOT'S. Every connector in a
            // unit used to carry the lead, so a three-member unit drew two
            // marks a pointer could not tell apart and a click on either named
            // the unit — the one thing an editor cannot delete, retype or
            // report a write against. `edgeIdentity` is the SAME function the
            // store derives `StoredEdge.id` with, so what `onSelect` hands the
            // host is a key `findEdge` resolves rather than a shape it has to
            // be taught.
            //
            // STILL `data-ig-group`, and that is not an oversight about the
            // "addressable via the key scheme" wording. Decoration announces
            // itself on this attribute precisely so it stays OUT of the focus
            // index — one element per key, or `focus()` lands on a
            // non-tabbable mark instead of the node it decorates. `keyAt`
            // reads both attributes for POINTER identity, which is the
            // question a click asks, so the connector is addressable without
            // re-opening that.
            'data-ig-group': edgeIdentity(edge.field, edge.from, edge.to),
            d,
          }),
        );
      }
    }

    const nodeShapes = [...layout.nodes.keys()]
      .map((key) => nodeShape(document, layout, key, options, theme, navigable))
      .filter((node): node is ElementSpec => node !== null);

    canvas = svg(
      'svg',
      {
        class: 'ig-canvas',
        viewBox: `0 0 ${String(Math.round(layout.width))} ${String(Math.round(layout.height))}`,
        // `role="img"` FLATTENS every descendant into a single image, which
        // would hide the very node roles and labels that make gutter and
        // held nodes reachable. A container holding separately focusable
        // semantic children is a group, not a picture.
        role: 'group',
        'aria-label': `${String(nodeCount)} issues and ${String(document.edges.length)} relationships`,
      },
      [...enclosures, ...edgeLayers, ...nodeShapes],
    );
  }

  const root = element(
    'section',
    { class: 'ig-viewer ig-graph', 'data-projection': 'graph', 'aria-label': 'issue order and relationships' },
    [
      legend(),
      // ONE STAGE, sized in the layout's own units, so an absolutely-positioned
      // rail row and an SVG coordinate mean the same thing. A percentage-width
      // canvas would rescale under the rail and the two would drift apart.
      // A refusal draws no nodes, so it needs no stage and the rail stays in
      // ordinary flow — a fixed-height stage would clip it.
      refused
        ? canvas
        : element(
            'div',
            {
              class: 'ig-stage',
              style: `--ig-stage-w:${String(Math.round(layout.width))}px;--ig-stage-h:${String(Math.round(layout.height))}px`,
            },
            [canvas, spineRail(document, layout, options, navigable.focused, true)],
          ),
      refused ? spineRail(document, layout, options, navigable.focused, false) : null,
      document.isolated.length === 0
        ? null
        : element('p', { class: 'ig-count' }, [
            `${String(document.isolated.length)} isolated ${document.isolated.length === 1 ? 'issue' : 'issues'} not drawn`,
          ]),
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
