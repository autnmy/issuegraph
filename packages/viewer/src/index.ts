/**
 * `@issuegraph/viewer` — render an Issuegraph document as a work order.
 *
 * The innermost layer of the Issuegraph UI, and the whole of its contract:
 *
 *     in   {issues, edges, order} + a projection choice
 *     out  onSelect, onHover
 *     never  fetching, mutation, auth, persistence, or a host's vocabulary
 *
 * It owns the node, edge and badge grammar, the layout maths and the readiness
 * stations. It derives no order — `@issuegraph/derive` does that, and a second
 * implementation here would be a mirror whose input space drifts.
 *
 * Two entry points: {@link renderViewer} is pure and returns markup plus
 * styles, which is what server rendering and every test in this package use;
 * {@link mountViewer} builds the same tree as nodes and wires the two callbacks.
 *
 * THE SURFACE IS WHAT A CONSUMER CALLS, and no more. Internals stay internal
 * because a published package can add an export later and can never take one
 * back.
 *
 * ONE OF THOSE CONSUMERS IS `@issuegraph/editor`, which is why the markup
 * grammar and the component summary are on the surface at all. Layer 2 draws
 * edit affordances as overlays on this layer and refuses the canvas on this
 * layer's budgets, and it composes through this file or not at all — its own
 * README states the rule: what a sibling does not export gets exported
 * deliberately, never reached past. The alternative for each was a second
 * implementation out there: a second HTML escaper over untrusted document text,
 * and a second components/cycle/depth pass whose input space drifts from this
 * one. `svg`, `materialize` and the mount-side element types stay internal —
 * nothing owes them yet.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export type {
  HoldFamily,
  NormalizeResult,
  NormalizedDocument,
  RankProvenance,
  ViewerDocument,
  ViewerEdge,
  ViewerExclusion,
  ViewerHold,
  ViewerIssue,
  ViewerOrder,
  ViewerSlot,
} from './document.ts';
export { normalizeDocument } from './document.ts';

export type { Projection, Scene } from './scene.ts';
export { KEY_ATTRIBUTE } from './scene.ts';

export type { RenderOptions, RenderResult } from './render.ts';
export { renderViewer } from './render.ts';

export type {
  MountElement,
  MountEvent,
  MountOptions,
  ViewerHandle,
} from './mount.ts';
export { mountViewer } from './mount.ts';

export type { NavigationCommand, NavigationResult, NavigationState } from './navigation.ts';
export { initialNavigationState, navigate, reconcile } from './navigation.ts';

export type {
  ColorToken,
  MetricToken,
  Theme,
  ThemeOverride,
  TypeToken,
} from './theme.ts';
export { resolveTheme,
  COLOR_TOKENS,
  METRIC_TOKENS,
  THEME_TOKENS,
  TYPE_TOKENS,
  defaultTheme,
  extendTheme,
  themeCss,
} from './theme.ts';

export { viewerStylesheet } from './styles.ts';

export type { EdgeDash, EdgeTerminal, EdgeTreatment, OrderingEffect } from './vocabulary.ts';
export { EDGE_TREATMENTS, dashArrayFor, treatmentFor } from './vocabulary.ts';

export { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET } from './projections/graph.ts';

export type { Cluster } from './clusters.ts';
export { clustersOf } from './clusters.ts';

export type { AttrValue, ElementSpec, SpecChild } from './element.ts';
export { element, renderMarkup } from './element.ts';
