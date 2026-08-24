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

  return svg(
    'g',
    {
      class: 'ig-node-group',
      'data-ig-key': key,
      'data-column': box.column,
      'aria-current': selected ? 'true' : 'false',
      role: ownsTabStop ? 'img' : null,
      'aria-label': ownsTabStop ? `${issue?.title ?? key} — ${key}` : null,
      tabindex: ownsTabStop ? (navigable.focused === key ? 0 : -1) : null,
    },
    [
      svg('rect', {
        class: 'ig-node',
        'data-held': box.held ? 'true' : 'false',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        rx: theme.metrics['--ig-radius'],
      }),
      svg(
        'text',
        {
          class: 'ig-node-label',
          x: box.x + theme.metrics['--ig-space'],
          // `dominant-baseline` centres the glyphs on the line rather than a
          // remembered offset, so the label stays centred at any type scale.
          y: box.y + box.height / 2,
          'dominant-baseline': 'middle',
        },
        [issue?.title ?? key],
      ),
    ],
  );
}

/**
 * The spine's rank column and readiness stations, drawn as HTML beside the
 * canvas rather than inside it.
 *
 * Text in SVG is not selectable, not reflowable, and announces poorly; the
 * spine's job is to be read. Keeping the stations in the document flow is also
 * what lets them keep the `4px` background halo the design asks for, so a
 * crossing arc reads as passing behind.
 */
function spineRail(
  document: NormalizedDocument,
  options: SceneOptions,
  focused: string | null,
): ElementSpec {
  const slots = document.order.slots.filter((slot) => !isFooterSlot(slot));
  return element(
    'ol',
    // A plain list for the reason `linear.ts` gives: an interactive descendant
    // may not live inside `role="option"`.
    { class: 'ig-list', 'aria-label': 'work order' },
    slots.map((slot) =>
      element(
        'li',
        {
          class: 'ig-slot',
          'data-ig-key': slot.lead,
          'data-held': slot.ready ? 'false' : 'true',
          'aria-current': options.selected === slot.lead ? 'true' : 'false',
          'aria-label': slotLabel(document, slot),
          tabindex: focused === slot.lead ? 0 : -1,
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
      ),
    ),
  );
}

function refusal(document: NormalizedDocument, nodeCount: number, mode: 'capsules' | 'clusters'): ElementSpec {
  const clusters = clustersOf(document);
  const heading =
    mode === 'capsules'
      ? `${String(nodeCount)} related issues is past this canvas's budget of ${String(GRAPH_NODE_BUDGET)}, so it is not drawing them.`
      : `${String(nodeCount)} related issues is far past this canvas's budget, so it is showing clusters only.`;

  const shown = mode === 'capsules' ? clusters : clusters.slice(0, 12);
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
    element('p', { class: 'ig-refusal-next' }, [
      mode === 'capsules'
        ? 'Select one component to draw it, or use the order list, which is complete at any size.'
        : 'Search for an issue to focus its neighbourhood, or use the order list, which is complete at any size.',
    ]),
  ]);
}

export function graphScene(document: NormalizedDocument, options: GraphOptions = {}): Scene {
  const theme = options.theme ?? defaultTheme;
  const layout = layoutGraph(document, theme);
  const nodeCount = layout.nodes.size;

  const inline = document.order.slots.filter((slot) => !isFooterSlot(slot));
  const footerSlots = document.order.slots.filter(isFooterSlot);
  const focusOrder = [
    ...inline.map((slot) => slot.lead),
    ...footerSlots.map((slot) => slot.lead),
    ...document.order.excluded.map((exclusion) => exclusion.key),
  ];
  // The rail draws the ranked slots; the canvas owns the tab stop for
  // everything else the scene reaches.
  const railed: ReadonlySet<string> = new Set(inline.map((slot) => slot.lead));

  // Lateral traversal reaches the gutters from the spine and back. It is built
  // from the layout's own columns, so a node that moves column moves its
  // neighbours with it.
  const lateral = new Map<string, LateralNeighbours>();
  for (const slot of document.order.slots) {
    // Every MEMBER's edges, not just the lead's: a together unit is one station
    // with one focus key, so a gutter neighbour reachable only through its
    // second member would otherwise be unreachable by keyboard entirely.
    const touching = slot.members.flatMap(
      (member) =>
        (document.edgesOf.get(member) ?? []).map((edge) => ({
          other: edge.from === member ? edge.to : edge.from,
        })),
    );
    const inColumn = (column: 'left' | 'right'): string | undefined =>
      touching.find(({ other }) => layout.nodes.get(other)?.column === column)?.other;
    const left = inColumn('left');
    const right = inColumn('right');
    if (left !== undefined || right !== undefined) {
      lateral.set(slot.lead, { left, right });
    }
  }

  // A GUTTER NODE IS REACHABLE SIDEWAYS WITHOUT BEING A POSITION IN THE ORDER,
  // so the set that can hold focus is wider than the order that walks it. Built
  // here, after `lateral`, because its targets are exactly the difference —
  // `focusOrder` leads so the first entry is the same under either.
  const navigableKeys = [...focusOrder];
  for (const neighbours of lateral.values()) {
    for (const key of [neighbours.left, neighbours.right]) {
      if (key !== undefined && !navigableKeys.includes(key)) navigableKeys.push(key);
    }
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
    canvas = refusal(document, nodeCount, 'clusters');
  } else if (nodeCount > GRAPH_NODE_BUDGET) {
    diagnostics.push(`graph refused: ${String(nodeCount)} nodes is past the node budget of ${String(GRAPH_NODE_BUDGET)}`);
    canvas = refusal(document, nodeCount, 'capsules');
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
        svg('rect', {
          class: 'ig-enclosure',
          'data-ig-key': lead,
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
            'data-ig-key': lead,
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
        role: 'img',
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
      spineRail(document, options, navigable.focused),
      canvas,
      document.isolated.length === 0
        ? null
        : element('p', { class: 'ig-count' }, [
            `${String(document.isolated.length)} isolated ${document.isolated.length === 1 ? 'issue' : 'issues'} not drawn`,
          ]),
    ],
  );

  return { projection: 'graph', root, focusOrder, navigable: navigableKeys, lateral, diagnostics };
}
