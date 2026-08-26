/**
 * The scale ladder — which of the three canvas tiers applies, and the route out
 * of the two that refuse.
 *
 * The list scales; the graph does not, and that is fine because they answer
 * different questions. The order rail is complete at any size — "what gets
 * worked next" is answerable for every issue in the document — while the canvas
 * is a LOCAL instrument answering "what surrounds this issue". So past its
 * budget the canvas refuses rather than thinning, and this module is what makes
 * that refusal actionable.
 *
 * ## Why this is layer 2 rather than more of layer 1
 *
 * `@issuegraph/viewer` already decides the same three tiers and already draws a
 * refusal — deliberately an INFORMATIONAL one. Its own source says why: that
 * package does not narrow, it renders exactly what it is given, so a control it
 * published could never complete the action it advertised. Narrowing is the
 * host's, and the editor is the host. What lands here is only the half layer 1
 * refused to own: a component the reader can actually choose, a search that
 * reaches one, and a chip that opens the issues the canvas leaves out.
 *
 * ## What this module deliberately does not compute
 *
 * Components, blocking counts, cycle flags and chain depth all come from
 * `clustersOf` in the viewer. A second pass out here would be a mirror whose
 * input space drifts from the canvas it is describing — the exact failure the
 * package split exists to prevent — and the two would eventually disagree about
 * whether a component contains a cycle while both were rendered on one screen.
 */

import {
  CLUSTER_ONLY_BUDGET,
  type Cluster,
  GRAPH_NODE_BUDGET,
  type NormalizedDocument,
  type ViewerDocument,
  type ViewerIssue,
  clustersOf,
  normalizeDocument,
} from '@issuegraph/viewer';

import { INITIAL_SCALE_STATE, type ScaleState } from './commands.ts';

/** Which of the design's three scale states the canvas is in. */
export type ScaleTier =
  /** At or under the node budget: the neighbourhood is drawn. */
  | 'direct'
  /** Past the node budget: component capsules instead of a hairball. */
  | 'capsules'
  /** Past the cluster-only budget: capsules are truncated and search leads. */
  | 'clusters';

/** One connected component, as the refusal presents it. */
export interface ScaleCapsule {
  /**
   * The member a `focus` command should name to draw this component. It is the
   * component's first member in the viewer's own ordering, so two renders of
   * one document always offer the same handle.
   */
  readonly lead: string;
  readonly size: number;
  readonly blockedByEdges: number;
  readonly chainDepth: number;
  readonly hasCycle: boolean;
  readonly members: readonly string[];
}

/**
 * A move the reader can make from a refusal.
 *
 * KINDS, NOT INSTANCES. An earlier shape emitted one route per capsule, which
 * made `routes` a second copy of `capsules` that could disagree with it. The
 * capsules carry the identities; this says what can be done with them.
 */
export type ScaleRouteKind = 'focus-cluster' | 'search' | 'clear-focus' | 'order-rail';

export interface ScaleRoute {
  readonly kind: ScaleRouteKind;
  readonly label: string;
}

/** Why the canvas declined, and where to go instead. Never routeless. */
export interface ScaleRefusal {
  readonly reason: string;
  readonly nodeCount: number;
  /** The drawing budget the count is past. */
  readonly budget: number;
  readonly routes: readonly ScaleRoute[];
}

/**
 * The issues carrying no relationship at all, collapsed to a count.
 *
 * THIS IS NOT `NormalizedDocument.isolated`, and the difference is the whole
 * reason the field is defined here. That one means "in no slot AND on no edge",
 * which in a grooming view — where every issue holds an order position — is
 * empty however many relationship-free issues the backlog has. The design's
 * chip counts issues with no RELATIONSHIP, because in a relationship graph they
 * are dots carrying no information. Two different questions; reusing one name
 * for both would report an absence as a value.
 */
export interface IsolatedChip {
  readonly count: number;
  /** The chip's own text — the count is the information these issues carry. */
  readonly label: string;
  readonly open: boolean;
  /** The issues themselves, and only once the chip has been opened. */
  readonly issues: readonly ViewerIssue[];
}

export interface ScaleMatch {
  readonly key: string;
  readonly title: string;
  /** The `focus` handle for the component this match sits in. */
  readonly lead: string;
}

export interface ScaleSearch {
  readonly query: string;
  readonly matches: readonly ScaleMatch[];
  /** Matches found beyond the ones listed. */
  readonly omitted: number;
}

export interface ScaleLadder {
  readonly tier: ScaleTier;
  /** The nodes the canvas would draw: the focused component, or all of them. */
  readonly nodeCount: number;
  readonly budgets: { readonly node: number; readonly clusterOnly: number };
  /** The focused member, once resolved against a real component. */
  readonly focus: string | null;
  readonly refusal: ScaleRefusal | null;
  readonly capsules: readonly ScaleCapsule[];
  /** Components found beyond the capsules listed. */
  readonly capsulesOmitted: number;
  readonly isolated: IsolatedChip;
  /** The affordance, present exactly when the canvas refuses. */
  readonly search: ScaleSearch | null;
  /**
   * The document for the CANVAS ZONE — never for the order rail.
   *
   * Narrowing the canvas is not narrowing the order, and the two must not be
   * confused: the rail is rendered from the whole document by the workspace
   * that assembles the zones. Handing this to a rail would silently shorten the
   * one surface the design guarantees is complete at any size.
   */
  readonly canvas: ViewerDocument;
  readonly diagnostics: readonly string[];
}

interface TierStep {
  readonly tier: ScaleTier;
  readonly ceiling: number;
}

/**
 * The ladder, as the design's table rather than as branches — and pinned to the
 * viewer's exported budgets rather than restating their numbers, so the tier
 * and the canvas cannot disagree about what "past budget" means.
 */
const CLUSTERS_ONLY: TierStep = { tier: 'clusters', ceiling: Number.POSITIVE_INFINITY };
const TIERS: readonly TierStep[] = [
  { tier: 'direct', ceiling: GRAPH_NODE_BUDGET },
  { tier: 'capsules', ceiling: CLUSTER_ONLY_BUDGET },
  CLUSTERS_ONLY,
];

/** How many capsules the cluster-only tier lists before it says it stopped. */
const CAPSULE_LIMIT = 12;
/** How many search matches are listed before the search says it stopped. */
const MATCH_LIMIT = 20;

function tierFor(nodeCount: number): TierStep {
  // The last step's ceiling is infinite, so the fallback is unreachable — it
  // stays because a total function must not depend on a reader noticing that.
  return TIERS.find((step) => nodeCount <= step.ceiling) ?? CLUSTERS_ONLY;
}

/** The keys carrying at least one relationship: exactly what the canvas draws. */
function relatedKeys(document: NormalizedDocument): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const issue of document.issues) {
    if ((document.edgesOf.get(issue.key) ?? []).length > 0) keys.add(issue.key);
  }
  return keys;
}

/**
 * The document restricted to `keep`.
 *
 * A SLOT SURVIVES ONLY IF EVERY MEMBER DOES. A together unit is one position
 * with several members, and half a unit is not a smaller unit — it is a
 * different claim about what gets worked together. Members of one unit are
 * joined by a `together-with` edge, so they are always in the same component
 * and a focus never splits one; the rule is written for the isolated-exclusion
 * pass, where a unit could otherwise lose a member that happens to be edge-free.
 */
function narrow(input: ViewerDocument, keep: ReadonlySet<string>): ViewerDocument {
  return {
    issues: input.issues.filter((issue) => keep.has(issue.key)),
    edges: input.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
    order: {
      slots: input.order.slots.filter((slot) => slot.members.every((member) => keep.has(member))),
      excluded: input.order.excluded.filter((exclusion) => keep.has(exclusion.key)),
    },
  };
}

/**
 * A capsule, or `null` for a component with no members.
 *
 * NULL RATHER THAN AN EMPTY LEAD. `''` would render a control reading "Focus "
 * that focuses nothing — an affordance that cannot complete its own action,
 * which is the exact class the viewer's refusal spent four rounds removing.
 * `clustersOf` never returns one today; this is what keeps that from becoming a
 * silent contract.
 */
function capsuleOf(cluster: Cluster): ScaleCapsule | null {
  // `members` is already in the viewer's deterministic order, so the first is a
  // stable handle rather than whichever member the walk happened to reach first.
  const lead = cluster.members[0];
  if (lead === undefined) return null;
  return {
    lead,
    size: cluster.members.length,
    blockedByEdges: cluster.blockedByEdges,
    chainDepth: cluster.chainDepth,
    hasCycle: cluster.hasCycle,
    members: cluster.members,
  };
}

/** Why the canvas declined, in the reader's terms. One sentence, three cases. */
function reasonFor(tier: ScaleTier, nodeCount: number, focused: boolean): string {
  if (focused) {
    return `The component you focused is ${String(nodeCount)} issues, itself past this canvas's budget of ${String(GRAPH_NODE_BUDGET)}, so it is not drawing them.`;
  }
  if (tier === 'clusters') {
    return `${String(nodeCount)} related issues is far past this canvas's budget of ${String(GRAPH_NODE_BUDGET)} — past the cluster-only budget of ${String(CLUSTER_ONLY_BUDGET)} as well — so it is listing components and leading with search.`;
  }
  return `${String(nodeCount)} related issues is past this canvas's budget of ${String(GRAPH_NODE_BUDGET)}, so it is not drawing them.`;
}

function refusalFor(
  tier: ScaleTier,
  nodeCount: number,
  focused: boolean,
  hasCapsules: boolean,
): ScaleRefusal | null {
  if (tier === 'direct') return null;

  // ALWAYS AT LEAST TWO. Search reaches a component whatever the tier, and the
  // order rail is complete at any size — so a refusal is never a dead end, and
  // the emptiness of this list is not something a caller has to defend against.
  const routes: ScaleRoute[] = [];
  if (hasCapsules) {
    routes.push({ kind: 'focus-cluster', label: 'Focus one component to draw it on its own.' });
  }
  if (focused) {
    routes.push({ kind: 'clear-focus', label: 'Return to every component.' });
  }
  routes.push({
    kind: 'search',
    label: 'Search for an issue to focus the component around it.',
  });
  routes.push({
    kind: 'order-rail',
    label: 'The order list is complete at any size — nothing about the sequence is refused here.',
  });
  return {
    reason: reasonFor(tier, nodeCount, focused),
    nodeCount,
    budget: GRAPH_NODE_BUDGET,
    routes,
  };
}

function searchFor(
  query: string,
  document: NormalizedDocument,
  leadOf: ReadonlyMap<string, string>,
): ScaleSearch {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { query, matches: [], omitted: 0 };

  const found: ScaleMatch[] = [];
  for (const issue of document.issues) {
    // ONLY ISSUES THAT SIT IN A COMPONENT. This search exists to focus one, and
    // an issue with no relationship has none to focus — offering it would be a
    // match that cannot be acted on. The issues it leaves out are the ones the
    // isolated chip is for, which is why the chip is not optional chrome.
    const lead = leadOf.get(issue.key);
    if (lead === undefined) continue;
    if (
      !issue.key.toLowerCase().includes(needle) &&
      !issue.title.toLowerCase().includes(needle)
    ) {
      continue;
    }
    found.push({ key: issue.key, title: issue.title, lead });
  }
  return {
    query,
    matches: found.slice(0, MATCH_LIMIT),
    omitted: Math.max(0, found.length - MATCH_LIMIT),
  };
}

/**
 * Resolve one document and one reader position into a ladder.
 *
 * Pure and total: no global is read, nothing is fetched, and a `focus` naming a
 * key this document does not place in any component produces a diagnostic and
 * every component, rather than a silently unnarrowed canvas that looks focused.
 */
export function scaleLadder(
  input: ViewerDocument,
  state: ScaleState = INITIAL_SCALE_STATE,
): ScaleLadder {
  const { document, diagnostics: normalizeDiagnostics } = normalizeDocument(input);
  const diagnostics = [...normalizeDiagnostics];

  const related = relatedKeys(document);
  const clusters = clustersOf(document);
  const leadOf = new Map<string, string>();
  for (const cluster of clusters) {
    const lead = cluster.members[0];
    if (lead === undefined) continue;
    for (const member of cluster.members) leadOf.set(member, lead);
  }

  const requested = state.focus;
  const focusedCluster =
    requested === null
      ? null
      : (clusters.find((cluster) => cluster.members.includes(requested)) ?? null);
  if (requested !== null && focusedCluster === null) {
    diagnostics.push(
      `focus ${requested} is in no component of this document; showing every component instead`,
    );
  }

  const keep = focusedCluster === null ? related : new Set(focusedCluster.members);
  const canvas = narrow(input, keep);
  const nodeCount = keep.size;
  const { tier } = tierFor(nodeCount);

  // NO CAPSULES WHILE ONE COMPONENT IS FOCUSED. The reader is already inside a
  // component; listing every other one under a refusal about THIS one would
  // read as an offer to focus what is already focused.
  const listable = focusedCluster === null ? clusters : [];
  const shown = tier === 'clusters' ? listable.slice(0, CAPSULE_LIMIT) : listable;
  const capsules =
    tier === 'direct'
      ? []
      : shown.map(capsuleOf).filter((capsule): capsule is ScaleCapsule => capsule !== null);

  const isolatedIssues = document.issues.filter((issue) => !related.has(issue.key));
  const isolated: IsolatedChip = {
    count: isolatedIssues.length,
    label: `${String(isolatedIssues.length)} isolated ${isolatedIssues.length === 1 ? 'issue' : 'issues'}, with no relationship to draw`,
    open: state.isolatedOpen,
    issues: state.isolatedOpen ? isolatedIssues : [],
  };

  return {
    tier,
    nodeCount,
    budgets: { node: GRAPH_NODE_BUDGET, clusterOnly: CLUSTER_ONLY_BUDGET },
    focus: focusedCluster === null ? null : requested,
    refusal: refusalFor(tier, nodeCount, focusedCluster !== null, capsules.length > 0),
    capsules,
    // COUNTED AGAINST WHAT WAS LISTED, not against what was sliced. A component
    // dropped for having no members is as absent from the list as one past the
    // limit, and reporting only the slice would under-count it.
    capsulesOmitted: tier === 'direct' ? 0 : listable.length - capsules.length,
    isolated,
    search: tier === 'direct' ? null : searchFor(state.query, document, leadOf),
    canvas,
    diagnostics,
  };
}
