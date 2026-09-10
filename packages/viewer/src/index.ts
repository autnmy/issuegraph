/**
 * `@issuegraph/viewer` — render an Issuegraph document as a work order.
 *
 * The innermost layer of the Issuegraph UI, and the whole of its contract:
 *
 *     in   {issues, edges, order, cycles, host?} + a projection choice
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
 * and a second components/depth pass whose input space drifts from this
 * one. `svg`, `materialize` and the mount-side element types stay internal —
 * nothing owes them yet.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export type {
  Adoption,
  ConditionAction,
  Disagreement,
  Freshness,
  GraphHold,
  HoldFamily,
  HostFacts,
  NormalizeResult,
  NormalizedDocument,
  NormalizedHostFacts,
  OrderCounts,
  PreviewOnly,
  RankProvenance,
  RunningJob,
  TrackerHold,
  ViewerCondition,
  ViewerCycle,
  ViewerDocument,
  ViewerEdge,
  ViewerExclusion,
  ViewerHold,
  ViewerIssue,
  ViewerOrder,
  ViewerSlot,
} from './document.ts';
export { isLinkable, normalizeDocument } from './document.ts';

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
  EffectToken,
  MetricToken,
  Theme,
  ThemeOverride,
  TypeToken,
} from './theme.ts';
export { resolveTheme,
  COLOR_TOKENS,
  EFFECT_TOKENS,
  METRIC_TOKENS,
  THEME_TOKENS,
  TYPE_TOKENS,
  defaultTheme,
  extendTheme,
  themeCss,
} from './theme.ts';

export { viewerStylesheet } from './styles.ts';

export type { EdgeDash, EdgeTerminal, EdgeTreatment, OrderingEffect } from './vocabulary.ts';
// `labelFrom` is on the surface for the same reason `treatmentFor` beside it
// is, and it carries more than a lookup: it is the ONE construction of "which
// verb, read from which end". §16's rail badge and §17a's inspector row draw
// the same edge one zone apart on one screen, so a consumer left to write
// `outgoing || symmetric ? label : reverseLabel` itself has a second copy of an
// expression whose failure mode is not a missing word but an INVERTED one — an
// inbound `duplicate-of` worded forwards asserts that the reader's subject is
// the duplicate when the other issue is. Publishing the treatment's fields and
// withholding the rule that reads them is what put two copies of it here once
// already.
export { EDGE_TREATMENTS, dashArrayFor, labelFrom, treatmentFor } from './vocabulary.ts';

export { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET } from './projections/graph.ts';

/**
 * The mark vocabulary, and it is deliberately the ONLY thing `marks.ts` puts on
 * the surface.
 *
 * A host asks for a mark by where it goes — `companion`, `terminal` — and never
 * by what it means, so this package cannot learn that one of its consumers is an
 * editor. The geometry that places them stays internal: publishing the ANSWER is
 * the seam, and publishing the machine that computes it is not.
 */
export type { EdgeMark, EdgeMarkPlacement } from './marks.ts';
export { EDGE_MARK_CLASS, MARK_PLACEMENT_ATTRIBUTE } from './marks.ts';
// `COMMAND_ATTRIBUTE` is on the surface because a host that reads the DOM rather
// than the callback needs the attribute name, and knowing it by inspection is
// how a consumer ends up with a literal that drifts.
// `identity`, `provenanceClause`, `glyphAndLabel` and `hiddenGlyph` are on the
// surface for the EDITOR, which composes all four into §17a's inspector.
// Reaching them by relative path instead is a package escape
// `check:isolation` fails, and re-spelling any of them in layer 2 would give
// one fact two wordings — the identity chip's link rule and the provenance
// sentence would then be free to drift from the rail's, and a second
// glyph/word pairing is free to drop the `aria-hidden` that makes the pair
// accessible at all.
// TWO PIECES OF ONE RULE, BECAUSE ONE OF THEM ALONE PUBLISHED A COPY. The
// inspector's `✕` is a glyph with no visible word — its name is on the button
// it sits in — so given only the pairing, layer 2 wrote the `ig-glyph` class
// and the `aria-hidden` out by hand: the same duplication, in the same commit
// that argued against it. `hiddenGlyph` is the half that call site needs.
export {
  COMMAND_ATTRIBUTE,
  ROW_BADGE_BUDGET,
  glyphAndLabel,
  hiddenGlyph,
  identity,
  provenanceClause,
} from './parts.ts';

export type { Cluster, ClusterReach } from './clusters.ts';
export { clusterReach, clusterReachLabel, clustersOf } from './clusters.ts';

export type { AttrValue, ElementSpec, SpecChild } from './element.ts';
export { element, renderMarkup } from './element.ts';
