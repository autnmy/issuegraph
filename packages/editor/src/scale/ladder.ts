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
 *
 * The cycle flag goes one layer further down the same rule: the viewer does
 * not derive it either. `clustersOf` reads `ViewerDocument.cycles`, which the
 * host fills from its reader's `Model.cycles` — the same array the audit
 * overlay on this screen reads — so a capsule's `cycle` badge and an audit's
 * `cycle` finding are one answer rendered twice, not two answers.
 */

import {
  CLUSTER_ONLY_BUDGET,
  type Cluster,
  type ClusterReach,
  GRAPH_NODE_BUDGET,
  type NormalizedDocument,
  type ViewerDocument,
  type ViewerEdge,
  type ViewerIssue,
  clusterReach,
  clustersOf,
  normalizeDocument,
  relatedKeys,
} from '@issuegraph/viewer';

import { INITIAL_SCALE_STATE, type ScaleState } from './commands.ts';

/** Which of the design's scale states the canvas is in. */
export type ScaleTier =
  /** At or under the node budget: the neighbourhood is drawn. */
  | 'direct'
  /**
   * Nothing selected and no group picked: the groups as cards, whatever their
   * size (RULES, Graphs, Dense neighbourhoods: "never every issue at once").
   * Not a refusal, so no sentence and no search: picking is the whole move.
   */
  | 'groups'
  /**
   * Past the node budget around a selection: the graph is not drawn, and the
   * workspace lists the neighbours by relationship in its place (RULES,
   * Graphs, Dense neighbourhoods: "Past 60 issues around the selection, the
   * graph doesn't draw them"). Not a refusal: the list is the answer.
   */
  | 'listed'
  /** Past the node budget: component capsules instead of a hairball. */
  | 'capsules'
  /** Past the cluster-only budget: capsules are truncated and search leads. */
  | 'clusters';

/** One connected component, as the refusal presents it. */
export interface ScaleCapsule {
  /**
   * The ANCHOR: the highest-ranked member, which is the member a `focus`
   * command names to draw this component.
   *
   * `RULINGS.md` §4 settles what this is. It was the component's first member
   * in key order, which is deterministic and means nothing — a seventy-two
   * issue component was fronted by whichever key sorted first. The anchor is
   * the member a reader would reach the component THROUGH, so a component with
   * any ready work is entered at that work.
   */
  readonly lead: string;
  /**
   * The anchor's title. Rendered as `around #488 · Extract session store
   * adapter` — never alone.
   *
   * FRAME `17f` NAMES EVERY CAPSULE — "auth & session", "replay guards" — and
   * the shipped one listed raw keys. This package's earlier reading was right
   * that a component has no name of its own to read anywhere, and Design
   * confirmed it: *"A connected component has no name and one must not be
   * invented. `auth & session` is placeholder copy, not a field."*
   *
   * WHAT CHANGED IS THE FORM, AND IT IS THE HALF THAT WAS WRONG. A bare title
   * reads as the component's NAME — as though that issue were the group — and
   * the anchor wording says what it actually is: the issue this component is
   * entered around. Same string, a claim it can support.
   */
  readonly name: string;
  readonly size: number;
  readonly blockedByEdges: number;
  readonly chainDepth: number;
  readonly hasCycle: boolean;
  /**
   * The one fact printed under the name, resolved by layer 1.
   *
   * IT IS NOT A THIRD COPY of the two fields above; it is what stops a capsule
   * printing both of them at once. See `clusterReach`: a stuck component has no
   * depth to print, because a depth beside a cycle reads as a work estimate for
   * work that can never start.
   */
  readonly reach: ClusterReach;
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

/** The size range of a set of components. Both bounds are at least one. */
export interface SizeRange {
  readonly smallest: number;
  readonly largest: number;
}

/** What the capsule list left out, and the size range it spans. */
export interface OmittedComponents {
  readonly count: number;
  /**
   * The range, or `null` when nothing omitted has a member to measure.
   *
   * NULLABLE RATHER THAN ZEROED, for the reason `capsulesOmitted` is itself
   * nullable: `0` here would report a component of no issues, and the count is
   * still true when the range is not. Unreachable while `clustersOf` emits no
   * memberless component; it is the shape that keeps it unreachable.
   */
  readonly range: SizeRange | null;
}

export interface ScaleLadder {
  readonly tier: ScaleTier;
  /**
   * The nodes the canvas would draw: the selection's neighbourhood, the focused
   * component, or all of them.
   */
  readonly nodeCount: number;
  /**
   * The related issues around a selection: the far ends of every relationship
   * it could draw and their unit partners, never the selection itself. `null`
   * with nothing selected. ONE COUNT FOR THE TIER AND THE WORDS (q347): "past
   * 60" is read off it, and so are "74 issues relate to #3104" and "74
   * related", so the line can never state a number the tier did not decide on.
   */
  readonly related: number | null;
  readonly budgets: { readonly node: number; readonly clusterOnly: number };
  /** The focused member, once resolved against a real component. */
  readonly focus: string | null;
  readonly refusal: ScaleRefusal | null;
  readonly capsules: readonly ScaleCapsule[];
  /**
   * The components beyond the capsules listed, and how big they are.
   *
   * A BARE COUNT DOES NOT SAY WHETHER THE TAIL MATTERS. Frame `17f` draws
   * "+ 5 more" over "2-7 issues each" for exactly that reason: five components
   * of two to seven is noise a reader can leave alone, and five of forty to
   * ninety is most of the backlog. `null` when nothing was omitted, so the
   * absent case has no zeroed sizes to misread.
   */
  readonly capsulesOmitted: OmittedComponents | null;
  readonly isolated: IsolatedChip;
  /**
   * The affordance, present exactly when the canvas refuses with nothing
   * selected: around a selection a match would move nothing drawn.
   */
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

/**
 * What the canvas is drawn around: the selection, and the relationships drawn
 * out from it (RULES, Graphs, Dense neighbourhoods).
 *
 * THE CALLER RESOLVES IT, because which relationships draw is a question about
 * the reader's selection and the kinds switched on, and this module knows
 * neither. It keeps what this names and nothing else.
 */
export interface ScaleAround {
  /** The selected issues, or a selected relationship's two ends. */
  readonly centre: readonly string[];
  /** The relationships drawn out from the centre. Each one's far end is drawn too. */
  readonly edges: readonly ViewerEdge[];
  /**
   * Every relationship the canvas could draw out from the centre, whatever is
   * switched off: what decides whether the neighbourhood is drawn at all. A
   * superset of {@link edges}, so a kind switched on can never carry the
   * neighbourhood past the budget and take the switch away with the graph.
   */
  readonly reach: readonly ViewerEdge[];
}

/** What a tier draws: the graph, the group cards, a refusal, and its search. */
interface TierTraits {
  readonly refuses: boolean;
  readonly lists: boolean;
}

const TIER_TRAITS: Readonly<Record<ScaleTier, TierTraits>> = Object.freeze({
  direct: { refuses: false, lists: false },
  groups: { refuses: false, lists: true },
  listed: { refuses: false, lists: false },
  capsules: { refuses: true, lists: true },
  clusters: { refuses: true, lists: true },
});

/**
 * The tier for every component at once. Within the node budget the groups are
 * still cards and never every issue at once; past it the budget's own refusal
 * stands, since it has more to say.
 */
const UNSELECTED_TIER: Readonly<Record<ScaleTier, ScaleTier>> = Object.freeze({
  direct: 'groups',
  groups: 'groups',
  listed: 'listed',
  capsules: 'capsules',
  clusters: 'clusters',
});

/** What the canvas keeps: everything related, one picked group, or a selection's neighbourhood. */
type ScaleMode = 'everything' | 'focused' | 'around';

/**
 * The tier around a selection: drawn within the budget, listed past it (RULES,
 * Graphs, Dense neighbourhoods: "Past 60 issues around the selection, the
 * graph doesn't draw them: Related groups lists them"). Never a refusal.
 */
const AROUND_TIER: Readonly<Record<ScaleTier, ScaleTier>> = Object.freeze({
  direct: 'direct',
  groups: 'listed',
  listed: 'listed',
  capsules: 'listed',
  clusters: 'listed',
});

/**
 * The tier each way of keeping takes, from the tier the budget gives. A
 * DOCUMENT WITH NOTHING RELATED HAS NO GROUPS, so with nothing kept the canvas
 * draws its own empty state rather than an empty board.
 */
const MODE_TIER: Readonly<Record<ScaleMode, (budget: ScaleTier, kept: number) => ScaleTier>> = Object.freeze({
  everything: (budget, kept) => (kept > 0 ? UNSELECTED_TIER[budget] : budget),
  focused: (budget) => budget,
  around: (budget) => AROUND_TIER[budget],
});

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

/**
 * The document restricted to `keep`.
 *
 * IT NARROWS THE NORMALIZED DOCUMENT, NEVER THE RAW INPUT, and that is a
 * correctness rule rather than a convenience. Two things go wrong otherwise.
 *
 * The canvas is handed straight to `renderViewer`, which normalizes whatever it
 * is given — so raw values re-derive every diagnostic this function already
 * collected about them, and a host surfacing diagnostics sees each one twice.
 * Worse, `keep` is built from the NORMALIZED document: normalization drops a
 * duplicate key and strips a url whose scheme the viewer will not link, so
 * filtering the raw input against a normalized key set can hand the canvas an
 * issue the ladder never counted — the ladder and the canvas disagreeing about
 * the node count, which is the one thing this module promises they cannot do.
 *
 * A SLOT SURVIVES ONLY IF EVERY MEMBER DOES. A together unit is one position
 * with several members, and half a unit is not a smaller unit — it is a
 * different claim about what gets worked together. Members of one unit are
 * joined by a `together-with` edge, so they are always in the same component
 * and a focus never splits one; the rule is written for the isolated-exclusion
 * pass, where a unit could otherwise lose a member that happens to be edge-free.
 */
function narrow(
  input: ViewerDocument,
  keep: ReadonlySet<string>,
  drawsEdge: (edge: ViewerEdge) => boolean,
): ViewerDocument {
  return {
    issues: input.issues.filter((issue) => keep.has(issue.key)),
    edges: input.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to) && drawsEdge(edge)),
    order: {
      slots: input.order.slots.filter((slot) => slot.members.every((member) => keep.has(member))),
      excluded: input.order.excluded.filter((exclusion) => keep.has(exclusion.key)),
    },
    // NARROWED, NOT RE-DERIVED — as `normalizeDocument` narrows a cycle to the
    // keys it carries. A cycle is the host's answer; a focus keeps the members
    // it draws and drops the rest, and a partial cycle is still a stuck group
    // (`ViewerCycle` says so), so `hasCycle` on the drawn component is unchanged.
    cycles: input.cycles
      .map((cycle) => cycle.filter((member) => keep.has(member)))
      .filter((cycle) => cycle.length > 0),
    // NO HOST CHROME, ON PURPOSE. The canvas answers "what surrounds this
    // issue"; the header, the NOW row and the freshness stamp are the rail's to
    // draw, and carrying those here would draw them twice in one workspace.
    //
    // THE CONDITION SURVIVES, and it is the one fact that must. It draws nothing
    // itself under `chrome: false`; what it does is stop this canvas explaining
    // an emptiness the host has already accounted for — otherwise a focus with
    // nothing to draw says "no issue in this document declares a relationship"
    // beside a rail saying the index could not be read.
    ...(input.host?.condition === undefined ? {} : { host: { condition: input.host.condition } }),
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
function capsuleOf(
  cluster: Cluster,
  titleOf: ReadonlyMap<string, string>,
  rankOf: ReadonlyMap<string, number>,
): ScaleCapsule | null {
  // THE ANCHOR IS THE HIGHEST-RANKED MEMBER, WHICH IS NOT WHAT THIS PICKED.
  //
  // `clustersOf` ends with `members.sort()` — a plain lexicographic sort of
  // KEYS — so `members[0]` was the alphabetically first key and nothing else.
  // The old comment called that "the viewer's deterministic order", which is
  // true and irrelevant: deterministic is not the same as meaningful, and on
  // the demo it fronted a seventy-two issue component with whichever key sorted
  // first.
  //
  // `RULINGS.md` §4: a capsule is identified by its ANCHOR, *"the
  // highest-ranked member"*. That is the member a reader would reach this
  // component through, and it is the one the focus control should name.
  //
  // TIES AND UNRANKED MEMBERS FALL BACK TO THE OLD HANDLE, deliberately: a
  // component can be entirely unplaced, in which case no member has a rank and
  // the sorted key is as good an answer as exists. What matters is that a
  // RANKED member always wins over an unranked one, so a component is entered
  // through the earliest position the order states for it.
  //
  // THAT POSITION NEED NOT BE READY WORK, and since `RULINGS.md` §1 it often
  // is not: a held slot whose blocker is inside the order carries a rank, so a
  // held issue can be the anchor. This comment used to promise ready work and
  // that promise is now false. The anchor is still right, and deliberately
  // unchanged — §4 defines it as the highest-RANKED member, not the highest
  // ready one, and nothing downstream needs readiness: selection minimises
  // rank, activation moves the focus key, focus keeps the whole component, and
  // no consumer here starts work. An anchor is where you ENTER a component,
  // not a claim that the component can run.
  let lead = cluster.members[0];
  let best = Number.POSITIVE_INFINITY;
  for (const member of cluster.members) {
    const rank = rankOf.get(member);
    if (rank === undefined) continue;
    if (rank < best) {
      best = rank;
      lead = member;
    }
  }
  if (lead === undefined) return null;
  return {
    lead,
    // THE KEY IS THE FALLBACK, NOT AN EMPTY NAME. Every member came out of the
    // normalized document so a title is always there; the `??` keeps a capsule
    // named rather than blank if that ever stops being true.
    name: titleOf.get(lead) ?? lead,
    size: cluster.members.length,
    blockedByEdges: cluster.blockedByEdges,
    chainDepth: cluster.chainDepth,
    hasCycle: cluster.hasCycle,
    reach: clusterReach(cluster),
    members: cluster.members,
  };
}

/**
 * The omitted components, summarised.
 *
 * COMPUTED FROM THE COMPONENTS THEMSELVES rather than from the two list
 * lengths, because the omitted set is not only the slice past the limit: a
 * component `capsuleOf` refuses also leaves the list, and a count derived by
 * subtraction cannot say how big either kind was.
 */
function omittedFrom(listable: readonly Cluster[], shown: readonly ScaleCapsule[]): OmittedComponents | null {
  const drawn = new Set(shown.map((capsule) => capsule.lead));
  // A COMPONENT OF NO ISSUES IS NOT A SIZE. `capsuleOf` refuses exactly the
  // memberless cluster, so the very components this function exists to count
  // separately are the ones that would contribute `0` — and "2 further
  // components are not listed · 0–7 issues each" reports a component of no
  // issues, which is the state `capsulesOmitted`'s own `null` exists to refuse.
  // They are still counted; they just do not stretch the range.
  const omitted = listable.filter((cluster) => {
    const lead = cluster.members[0];
    return lead === undefined || !drawn.has(lead);
  });
  // FOLDED, NOT SPREAD. `Math.min(...sizes)` passes one argument per component,
  // and this runs on the refusal path — reached BECAUSE the document is large,
  // whose worst case `clustersOf` names as "10,000 disconnected pairs". Node
  // throws `RangeError: Maximum call stack size exceeded` somewhere past
  // ~100,000 arguments, so a spread turns the surface that exists to survive a
  // huge backlog into the one that crashes on it.
  let count = 0;
  let smallest = Number.POSITIVE_INFINITY;
  let largest = 0;
  for (const cluster of omitted) {
    count += 1;
    const size = cluster.members.length;
    if (size === 0) continue;
    if (size < smallest) smallest = size;
    if (size > largest) largest = size;
  }
  if (count === 0) return null;
  // Every omitted component was memberless: counted, with no range to state.
  return { count, range: largest === 0 ? null : { smallest, largest } };
}

/**
 * Why the canvas declined, in the reader's terms. One sentence, three cases:
 * around a selection it never declines, since the list stands in for it.
 */
function reasonFor(tier: ScaleTier, nodeCount: number, mode: ScaleMode): string {
  if (mode === 'focused') {
    return `This group has ${String(nodeCount)} issues, too many to draw here. The limit is ${String(GRAPH_NODE_BUDGET)}.`;
  }
  if (tier === 'clusters') {
    return `${String(nodeCount)} related issues are far too many to draw, so they are listed as groups. Search to find one.`;
  }
  // THE EXPORT'S HEAD, AS DRAWN (#296): "141 related issues are too many to
  // draw here. Pick a group." It said what the limit was; the board says what
  // to do, and every card below is the control that does it.
  return `${String(nodeCount)} related issues are too many to draw here. Pick a group.`;
}

function refusalFor(
  tier: ScaleTier,
  nodeCount: number,
  mode: ScaleMode,
  hasCapsules: boolean,
): ScaleRefusal | null {
  if (!TIER_TRAITS[tier].refuses) return null;

  // ALWAYS AT LEAST TWO. Search reaches a component whatever the tier, and the
  // order rail is complete at any size — so a refusal is never a dead end, and
  // the emptiness of this list is not something a caller has to defend against.
  const routes: ScaleRoute[] = [];
  if (hasCapsules) {
    routes.push({ kind: 'focus-cluster', label: 'Pick a group to draw just that group.' });
  }
  if (mode === 'focused') {
    routes.push({ kind: 'clear-focus', label: 'Go back to all groups.' });
  }
  routes.push({
    kind: 'search',
    label: 'Search for an issue to draw its group.',
  });
  routes.push({
    kind: 'order-rail',
    label: 'The list always shows the full order.',
  });
  return {
    reason: reasonFor(tier, nodeCount, mode),
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
    // isolated chip is for, which is why the ROUTE TO THEM IS NOT OPTIONAL.
    //
    // THE ROUTE IS THE INVARIANT; THE CHIP IS ONE DRAWING OF IT. This sentence
    // read "the chip is not optional chrome" until a caller needed to draw the
    // same route somewhere else, and the two claims are not the same: what may
    // never be suppressed is a way to reach these issues, because this search
    // will not offer them and nothing else on the ladder does either. So
    // `ScaleLadderOptions.isolatedChip` lets a caller that draws the route
    // ITSELF — the count, the toggle and the list — turn the ladder's own copy
    // off, and forbids it to anyone who does not. `renderWorkspace` is that
    // caller: §17a puts the count at the foot of the order rail, and two copies
    // of one control would also give `mount.ts`'s focus restore two elements
    // under its single `isolated` identity.
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
 * The issues a selection's neighbourhood draws: its centre and every end of the
 * relationships drawn from it, each with its whole unit, since half a unit is
 * not a smaller unit (see `narrow`).
 */
function aroundKeys(document: NormalizedDocument, around: ScaleAround): ReadonlySet<string> {
  const reached = [...around.centre, ...around.edges.flatMap((edge) => [edge.from, edge.to])];
  const units = reached.flatMap(
    (key) => document.order.slots.find((slot) => slot.members.includes(key))?.members ?? [key],
  );
  return new Set([...reached, ...units].filter((key) => document.byKey.has(key)));
}

/**
 * How many issues relate to a selection (q347): every issue its whole reach
 * would draw, the selection's own excepted. Read off the reach, never off the
 * kinds switched on, so switching a kind on cannot turn the graph into the list
 * and take the switch away with it.
 */
function relatedAround(document: NormalizedDocument, around: ScaleAround): number {
  const centre = new Set(around.centre);
  return [...aroundKeys(document, { ...around, edges: around.reach })].filter((key) => !centre.has(key)).length;
}

/** One edge's declaration, as a key a set can hold. */
function edgeKey(edge: ViewerEdge): string {
  return `${edge.field}|${edge.from}|${edge.to}`;
}

/**
 * Resolve one document and one reader position into a ladder.
 *
 * Pure and total: no global is read, nothing is fetched, and a `focus` naming a
 * key this document does not place in any component produces a diagnostic and
 * every component, rather than a silently unnarrowed canvas that looks focused.
 *
 * `around` is the selection's neighbourhood, and it outranks a focus: with an
 * issue or a relationship selected the canvas draws what surrounds it, and the
 * picked group comes back when the selection clears. With neither, the groups
 * are drawn as cards and never every issue at once (RULES, Graphs, Dense
 * neighbourhoods).
 */
export function scaleLadder(
  input: ViewerDocument,
  state: ScaleState = INITIAL_SCALE_STATE,
  around: ScaleAround | null = null,
): ScaleLadder {
  const { document, diagnostics: normalizeDiagnostics } = normalizeDocument(input);
  const diagnostics = [...normalizeDiagnostics];

  // THE VIEWER'S OWN COUNT, NOT A COPY OF IT. This module kept a private
  // `relatedKeys` with this body while the viewer's canvas compared its budgets
  // against every LAID-OUT node — two readings of one pair of constants, which
  // agreed here only because `narrow` hands the canvas related issues alone.
  // The viewer's budgets now count exactly this set (issuegraph #133), so the
  // function moved there and the tier and the canvas read the one rule.
  const related = relatedKeys(document);
  const clusters = clustersOf(document);
  const leadOf = new Map<string, string>();
  for (const cluster of clusters) {
    const lead = cluster.members[0];
    if (lead === undefined) continue;
    for (const member of cluster.members) leadOf.set(member, lead);
  }

  const requested = around === null ? state.focus : null;
  const focusedCluster =
    requested === null
      ? null
      : (clusters.find((cluster) => cluster.members.includes(requested)) ?? null);
  if (requested !== null && focusedCluster === null) {
    diagnostics.push(
      `focus ${requested} is in no component of this document; showing every component instead`,
    );
  }

  const mode: ScaleMode = around !== null ? 'around' : focusedCluster !== null ? 'focused' : 'everything';
  const keep =
    around !== null ? aroundKeys(document, around) : focusedCluster === null ? related : new Set(focusedCluster.members);
  // AROUND A SELECTION ONLY ITS OWN RELATIONSHIPS ARE ON THE CANVAS, so the
  // lines between its neighbours wait until one of them is selected.
  const drawn = new Set(around?.edges.map(edgeKey) ?? []);
  const canvas = narrow(document, keep, (edge) => around === null || drawn.has(edgeKey(edge)));
  const nodeCount = keep.size;
  // AROUND A SELECTION THE BUDGET IS READ OFF ITS WHOLE REACH, never off the
  // kinds switched on, so switching a kind on cannot turn the graph into the
  // list and take the switch away with it. Elsewhere the reach is what is kept.
  const aroundCount = around === null ? null : relatedAround(document, around);
  const budgetTier = tierFor(aroundCount ?? keep.size).tier;
  const tier = MODE_TIER[mode](budgetTier, nodeCount);
  const traits = TIER_TRAITS[tier];

  // CAPSULES ONLY FOR EVERY COMPONENT AT ONCE. Inside one, the reader is already
  // there, and listing every other one under a refusal about THIS one would read
  // as an offer to focus what is already focused; around a selection, a focus
  // would change nothing drawn.
  const listable = mode === 'everything' ? clusters : [];
  const shown = tier === 'clusters' ? listable.slice(0, CAPSULE_LIMIT) : listable;
  const titleOf = new Map(document.issues.map((issue) => [issue.key, issue.title]));
  // THE RANK OF EVERY MEMBER THAT HAS ONE, for the anchor. Built from the
  // order's own slots rather than from the issues, because rank is a fact about
  // a SLOT: a together unit is one rank over several members, and each of them
  // is equally the rank the component would be entered at.
  const rankOf = new Map<string, number>();
  for (const slot of document.order.slots) {
    if (slot.rank === null) continue;
    for (const member of slot.members) rankOf.set(member, slot.rank);
  }
  const capsules = traits.lists
    ? shown
        .map((cluster) => capsuleOf(cluster, titleOf, rankOf))
        .filter((capsule): capsule is ScaleCapsule => capsule !== null)
    : [];

  const isolatedIssues = document.issues.filter((issue) => !related.has(issue.key));
  const isolated: IsolatedChip = {
    count: isolatedIssues.length,
    label: `${String(isolatedIssues.length)} ${isolatedIssues.length === 1 ? 'issue' : 'issues'} with no relationships`,
    open: state.isolatedOpen,
    issues: state.isolatedOpen ? isolatedIssues : [],
  };

  return {
    tier,
    nodeCount,
    related: aroundCount,
    budgets: { node: GRAPH_NODE_BUDGET, clusterOnly: CLUSTER_ONLY_BUDGET },
    focus: focusedCluster === null ? null : requested,
    refusal: refusalFor(tier, nodeCount, mode, capsules.length > 0),
    capsules,
    // COUNTED AGAINST WHAT WAS LISTED, not against what was sliced. A component
    // dropped for having no members is as absent from the list as one past the
    // limit, and reporting only the slice would under-count it.
    capsulesOmitted: traits.lists ? omittedFrom(listable, capsules) : null,
    isolated,
    // AROUND A SELECTION NOTHING REFUSES, so no search: a match would focus a
    // group, and the canvas draws what surrounds the selection, not a group.
    search: traits.refuses ? searchFor(state.query, document, leadOf) : null,
    canvas,
    diagnostics,
  };
}
