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

import type { EdgeField } from '@issuegraph/core';

import { clustersOf } from '../clusters.ts';
import type { NormalizedDocument, ViewerEdge } from '../document.ts';
import { type ElementSpec, element, svg } from '../element.ts';
import {
  type EdgeGeometry,
  type GraphLayout,
  edgeGeometry,
  enclosureBounds,
  fitLabel,
  layoutGraph,
} from '../layout.ts';
import { emptyState, legend, slotLabel, slotTitle, station, stationFill } from '../parts.ts';
import { type LateralNeighbours, type Scene, resolveFocusKey } from '../scene.ts';
import { type Theme, defaultTheme } from '../theme.ts';
import { type EdgeTerminal, dashArrayFor, treatmentFor } from '../vocabulary.ts';
import { type SceneOptions, isFooterSlot } from './linear.ts';

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
  theme: Theme,
): ElementSpec | null {
  const { end, endAngle } = geometry;
  const degrees = (endAngle * 180) / Math.PI;
  const transform = `translate(${end.x.toFixed(2)} ${end.y.toFixed(2)}) rotate(${degrees.toFixed(2)})`;
  const common = { class: 'ig-terminal', 'data-edge': field, transform };
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

  return svg(
    'g',
    {
      class: 'ig-node-group',
      'data-ig-key': key,
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
function spineRail(
  document: NormalizedDocument,
  layout: GraphLayout,
  options: SceneOptions,
  focused: string | null,
  positioned: boolean,
): ElementSpec {
  const slots = document.order.slots.filter((slot) => !isFooterSlot(slot));
  return element(
    'ol',
    // A plain list for the reason `linear.ts` gives: an interactive descendant
    // may not live inside `role="option"`.
    // WHEN THERE IS NO CANVAS THERE IS NOTHING TO SIT ON. A refusal draws no
    // spine nodes, so the rail returns to ordinary flow rather than positioning
    // itself against coordinates nothing rendered.
    { class: positioned ? 'ig-list ig-rail' : 'ig-list', 'aria-label': 'work order' },
    slots.map((slot) => {
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
        ],
      );
    }),
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

export function graphScene(document: NormalizedDocument, options: GraphOptions = {}): Scene {
  const theme = options.theme ?? defaultTheme;
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
  const railed: ReadonlySet<string> = new Set(inline.map((slot) => slot.lead));
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
      const marker = terminalMarker(treatmentFor(edge.field).terminal, geometry, edge.field, theme);
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
      for (let index = 1; index < members.length; index += 1) {
        const previous = layout.nodes.get(members[index - 1] as string);
        const current = layout.nodes.get(members[index] as string);
        if (previous === undefined || current === undefined) continue;
        enclosures.push(
          svg('line', {
            class: 'ig-connector',
            'data-ig-group': lead,
            x1: previous.x + previous.width / 2,
            y1: previous.y + previous.height,
            x2: current.x + current.width / 2,
            y2: current.y,
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

  return { projection: 'graph', root, focusOrder, navigable: navigableKeys, lateral, diagnostics };
}
