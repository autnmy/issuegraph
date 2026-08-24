/**
 * The Issuegraph ordering derivation — a PURE function of persisted state plus
 * host configuration. Given `{issues, config}` it returns the derived order:
 * ranked slots, held slots, together units, excluded duplicates, priority
 * promotions, and the pre-write cycle refusal.
 *
 * NOTHING HERE IS STORED. The model is recomputed on every read so it cannot
 * go stale, and so two clients reading the same issue bodies agree without
 * coordinating. There is no fetch, no cache, and no persistence seam in this
 * module — `purity.test.ts` pins that mechanically.
 *
 * ── WHAT THIS MODULE DOES NOT DO ────────────────────────────────────────────
 *
 * Two implementations already own most of this predicate, and neither is
 * re-created here:
 *
 *  1. `buildModel` (`@issuegraph/reader`) owns declared priority, transitive
 *     effective priority, readiness, serialize/together components, duplicate
 *     canonicals, and cycle detection. This module CALLS it. A second
 *     TypeScript implementation of any of those would be a mirror whose input
 *     space drifts.
 *  2. The BASE RANKING — a tracker's own ordering, however it produces one:
 *     mapped P0-P3 labels, issue types, saved ordering queries, a tie-break
 *     strategy. It is an INPUT here, never computed — see
 *     {@link IssueOrderBaseRanking}, whose arms each CARRY a ranking. Hosts
 *     routinely evaluate that ranking in a database, and re-deriving it here
 *     would be a second ordering engine beside the authoritative one.
 *
 * ── RELATIONSHIP TO A CLAIM-TIME SELECTOR ───────────────────────────────────
 *
 * A scheduler's claim-time selector also composes the graph model and also
 * sorts by effective priority. The two are deliberately NOT one helper,
 * because they answer different questions and their outputs disagree by
 * design:
 *
 *   |                | selector (claim time)        | here (preview)              |
 *   |----------------|------------------------------|-----------------------------|
 *   | question       | what may be CLAIMED this tick| what the ORDER is           |
 *   | held issues    | dropped from the result      | kept at `rank: null`, w/ why|
 *   | together unit  | may refuse the unit          | ONE rank slot for the unit  |
 *   | serialize comp | one survivor per batch       | every member ranked         |
 *   | rank numbers   | none — an ordered array      | explicit; `null` when held  |
 *
 * Held-vs-dropped is the load-bearing difference: "why isn't my P1 running"
 * must be answerable IN PLACE, and a claim-time evaluator deletes exactly that
 * information. Folding the two together would push claim-batch policy
 * (suppression preference, one-survivor-per-batch) into a read-only preview
 * where it has no meaning. What they share — the model — they share.
 *
 * ── HOW THE TWO ORDERING SOURCES COMPOSE ────────────────────────────────────
 *
 * The base ranking produces a complete ranking on its own; frontmatter
 * MODIFIES it and never replaces it. That is one sort with a swappable
 * secondary key:
 *
 *     (effectivePriority ASC, baseRankingPosition ASC, issueNumber ASC)
 *
 * At zero frontmatter adoption every effective priority equals its declared
 * priority, so the primary key collapses to the priority band the base ranking
 * already produced and the output IS the base ranking. Frontmatter only ever
 * moves an issue between bands (promotion), out of the order (duplicate), or
 * into a held slot. Getting this backwards makes the package useless to anyone
 * who has not adopted the format, which is everyone at first.
 *
 * The `fixture-parity` arm swaps that secondary key for the issue's createdAt
 * ordinal, reproducing the reference prototype's own `(effectivePriority,
 * createdAt)` sort so the seed fixture pins this module against it. It is a
 * TIE-BREAK SUBSTITUTION, not a second ranking engine.
 */

import type { IssueRef, Model, NodeInput } from '@issuegraph/reader';
import { buildModel, nodeKey, nodeSourceRepo, refKey } from '@issuegraph/reader';

import {
  DEFAULT_PRIORITY_PRECEDENCE,
  type DeclaredPriorityPrecedence,
  type PrioritySignals,
  applyPriorityPrecedence,
  resolvePrioritySignals,
} from './precedence.ts';
import { buildBlockedByAdjacency, wouldCycleOnAdjacency } from './cycle.ts';

/**
 * One entry of the base ranking, carrying the node key and the provenance of
 * the match — so a host maps its own ordering output straight onto this
 * without a translation layer.
 */
export interface ConfigRankedIssue {
  /** The model's node key: `"N"`, or `"owner/repo#N"` when qualified. */
  readonly key: string;
  /**
   * RANK PROVENANCE, not the rank. This is the ordered-query ENTRY index that
   * matched the row (first-match dedupe), so many rows share one value — it is
   * what a surface renders as "matched query N", never a position. The
   * derivation does not read it.
   */
  readonly matchedOrderIndex: number;
}

/**
 * The base ranking the relationship layer modifies. Every arm CARRIES a
 * ranking; no arm computes one. That is what keeps the host's own ordering
 * single-sourced wherever it already lives.
 */
export type IssueOrderBaseRanking =
  | {
      /** Production: the host's own ordered rows. */
      readonly source: 'config';
      /**
       * MUST be supplied in rank order — the ARRAY INDEX is the position,
       * which is what the host's own `ORDER BY` already produced. Re-sorting,
       * filtering, or concatenating pages changes the ranking; the per-row
       * `matchedOrderIndex` is a band index and cannot repair it.
       */
      readonly order: readonly ConfigRankedIssue[];
    }
  | {
      /**
       * TEST PARITY ONLY: the reference prototype's `createdAt` tie-break, so
       * the seed reproduces it exactly. Production reads the `config` arm —
       * this one exists because the prototype's own sort has to remain
       * reproducible. Values are compared, never interpreted; any ascending
       * FINITE ordinal works.
       */
      readonly source: 'fixture-parity';
      readonly createdAt: ReadonlyMap<string, number>;
    };

export interface IssueOrderConfig {
  readonly baseRanking: IssueOrderBaseRanking;
  /** The home repository (`owner/repo`) — the model's bare-number key space. */
  readonly homeRepo?: string | undefined;
  /** Defaults to the mapped label winning (SPEC §4.3.5). */
  readonly priorityPrecedence?: DeclaredPriorityPrecedence | undefined;
}

export interface DeriveIssueOrderInput {
  readonly issues: readonly NodeInput[];
  readonly config: IssueOrderConfig;
}

/** One position in the order. A together unit is ONE slot, not one per member. */
export interface IssueOrderSlot {
  /**
   * The 1-based rank, or `null` when the slot is HELD. A held slot never
   * carries a number: it has no position in the sequence, and rendering one
   * would claim work is queued that nothing can start.
   */
  readonly rank: number | null;
  /** The member that placed the slot; the detail surface's subject. */
  readonly lead: string;
  /** Every candidate member, in the model's canonical component order. */
  readonly members: readonly string[];
  readonly ready: boolean;
  /** Empty when ready; each entry names one failed readiness condition. */
  readonly holdReasons: readonly string[];
  /**
   * COMPUTED sizes — no issue writes its group down (SPEC §4.3.4/§4.3.7).
   * Both count CANDIDATES only (open, non-duplicate), so the two read on the
   * same denominator: a serialize partner that shipped no longer counts, just
   * as a closed together member no longer does.
   */
  readonly togetherGroupSize: number;
  readonly serializeGroupSize: number;
}

export interface IssuePriorityView {
  readonly declared: number;
  /**
   * The lowest declared priority among this issue and every open issue that
   * transitively depends on it. SELECTION USES THIS, never `declared`.
   */
  readonly effective: number;
  readonly promoted: boolean;
  /** The open dependents the urgency arrived through; empty when not promoted. */
  readonly promotedBy: readonly string[];
  /** The spec's own notation: `P3 -> 0` when promoted, else `P3`. */
  readonly notation: string;
  readonly signals: PrioritySignals;
}

export interface ExcludedIssue {
  readonly key: string;
  /** The canonical issue this one duplicates. */
  readonly canonical: string;
  readonly reason: 'duplicate-of';
}

/** A `decomposed-from` edge. PROVENANCE ONLY — never an ordering arrow. */
export interface ProvenanceOrigin {
  readonly key: string;
  readonly origin: string;
  /** `null` when the origin is outside the supplied node set. */
  readonly originOpen: boolean | null;
}

/**
 * The derived model.
 *
 * AN IN-PROCESS VALUE, not a payload. `wouldCycle` is a live closure and
 * `rankOf`/`priority` are `Map`s, so this cannot cross a serialization
 * boundary as-is: passing it to a client component throws on the function, and
 * `JSON.stringify` silently drops `wouldCycle` and flattens both maps to `{}`.
 * Project it explicitly at any such boundary rather than handing it over whole.
 */
export interface DerivedIssueOrder {
  /**
   * Every slot in derivation order. A HELD slot keeps its position — it is not
   * moved to the end — so "why isn't my P1 running" is answerable at the rank
   * the work would have taken.
   */
  readonly slots: readonly IssueOrderSlot[];
  /** Candidate key -> its slot's rank. Held members map to `null`. */
  readonly rankOf: ReadonlyMap<string, number | null>;
  readonly priority: ReadonlyMap<string, IssuePriorityView>;
  readonly excluded: readonly ExcludedIssue[];
  readonly provenance: readonly ProvenanceOrigin[];
  readonly diagnostics: readonly string[];
  /**
   * Would adding `from blocked-by to` create a cycle? Bound to this node set,
   * so a refusal costs zero round-trips.
   */
  readonly wouldCycle: (from: string, to: string) => boolean;
}

/** Sorts after every ranked issue, within the issue's own priority band. */
const UNRANKED_POSITION = Number.POSITIVE_INFINITY;

export function deriveIssueOrder(input: DeriveIssueOrderInput): DerivedIssueOrder {
  const { issues, config } = input;
  const homeRepo = config.homeRepo;
  const precedence = config.priorityPrecedence ?? DEFAULT_PRIORITY_PRECEDENCE;
  const diagnostics: string[] = [];

  // Precedence is applied to the model's INPUT so effective priority is never
  // re-derived here (see `precedence.ts`).
  const model = buildModel(applyPriorityPrecedence(issues, precedence), {
    ...(homeRepo === undefined ? {} : { homeRepo }),
  });
  diagnostics.push(...model.diagnostics);

  // Raw carriers come off the UNNORMALIZED nodes, so the losing signal stays
  // recoverable whichever precedence is active.
  const rawByKey = new Map<string, NodeInput>();
  for (const node of issues) {
    const key = nodeKey(node, homeRepo);
    if (!rawByKey.has(key)) rawByKey.set(key, node); // first occurrence wins
  }

  // The carrier-disagreement anomaly (SPEC §5.4) is emitted HERE, from the
  // untouched carriers, rather than left to the model. Under `frontmatter`
  // precedence the normalization has already removed the labels the model
  // would compare, so its own disagreement branch cannot fire — the anomaly
  // would silently vanish for exactly the issues that have one. Emitting it
  // from the raw input keeps `diagnostics` identical under both precedences,
  // and covers closed and excluded nodes that never reach a priority view.
  for (const [key, node] of rawByKey) {
    const signals = resolvePrioritySignals(node, precedence);
    if (!signals.disagreement) continue;
    diagnostics.push(
      `${key}: priority label p${String(signals.labelValue)} disagrees with frontmatter ${String(signals.frontmatterValue)}`,
    );
  }

  const basePosition = baseRankingPositions(config.baseRanking);

  // ---- candidates: open, and not excluded as a duplicate (SPEC §4.3.3) ----
  const excluded: ExcludedIssue[] = [];
  const candidates: string[] = [];
  for (const key of model.keys) {
    const node = rawByKey.get(key);
    if (node === undefined || !node.open) continue;
    const canonical = model.duplicateCanonical(key);
    if (canonical !== null) {
      excluded.push({ key, canonical, reason: 'duplicate-of' });
      continue;
    }
    candidates.push(key);
  }
  const candidateSet = new Set(candidates);

  // ---- sort: effective priority, then the base ranking, then issue number ----
  const sorted = [...candidates].sort((a, b) => {
    const priorityDelta = model.effectivePriority(a) - model.effectivePriority(b);
    if (priorityDelta !== 0) return priorityDelta;
    const positionA = basePosition(a);
    const positionB = basePosition(b);
    if (positionA !== positionB) return positionA - positionB;
    // Both unranked by the base ranking (or genuinely tied): a deterministic
    // refinement rather than an unspecified order.
    const numberDelta = (rawByKey.get(a)?.number ?? 0) - (rawByKey.get(b)?.number ?? 0);
    if (numberDelta !== 0) return numberDelta;
    // Issue NUMBER is not unique across repos, so it cannot be the last word:
    // two cross-repo issues sharing a number tie here, the stable sort keeps
    // whatever order they were fetched in, and two clients holding the same
    // graph derive different orders — which is exactly the coordination-free
    // agreement this module exists to provide. Keys are unique, so comparing
    // them totalizes the ordering. Codepoint order, not `localeCompare`: a
    // locale-sensitive collation would reintroduce the disagreement between
    // clients that this comparison is here to remove.
    return a < b ? -1 : a > b ? 1 : 0;
  });
  // ---- slots: a together component collapses to ONE (SPEC §4.3.7) ----
  const slots: IssueOrderSlot[] = [];
  const rankOf = new Map<string, number | null>();
  const claimedByUnit = new Set<string>();
  let rank = 0;
  for (const key of sorted) {
    if (claimedByUnit.has(key)) continue;
    const members = model.togetherComponent(key).filter((member) => candidateSet.has(member));
    for (const member of members) {
      claimedByUnit.add(member);
      // Every candidate is a member of exactly one slot, so this reaches all of
      // them without a second pass over `sorted`. Covers both arms: absent from
      // the supplied ranking, or present with a non-finite ordinal.
      if (basePosition(member) === UNRANKED_POSITION) {
        diagnostics.push(
          `${member}: no usable position in the base ranking; sorted last within its effective-priority band`,
        );
      }
    }
    const holdReasons = [...new Set(members.flatMap((member) => model.readiness(member).reasons))];
    // The unit is ONE piece of work: it advances only when every member can.
    const ready = members.every((member) => model.readiness(member).ready);
    const slotRank = ready ? (rank += 1) : null;
    slots.push({
      rank: slotRank,
      lead: key,
      members,
      ready,
      holdReasons,
      togetherGroupSize: members.length,
      serializeGroupSize: model
        .serializeComponent(key)
        .filter((member) => candidateSet.has(member)).length,
    });
    for (const member of members) rankOf.set(member, slotRank);
  }

  // ---- priority views ----
  const priority = new Map<string, IssuePriorityView>();
  const { dependents, declaredTogether } = promotionEdges(issues, homeRepo, rawByKey, model);
  /**
   * Every neighbour urgency can arrive through — §6.3 relaxes effective
   * priority along blocked-by AND together edges, so a reverse index of one of
   * them explains only half the promotions it is asked about.
   *
   * THE TOGETHER HALF IS THE ADJACENT PEER, NOT THE COMPONENT. Relaxation puts
   * every member of a component at the SAME effective priority, so the filter
   * below cannot tell a peer from a stranger three hops away — enumerate the
   * component and every member reads as a cause. `promotedBy` promises the
   * neighbour urgency arrived THROUGH, and the blocked-by arm has always
   * answered that with the adjacent issue even when the cause is further off.
   *
   * INTERSECTING THE COMPONENT WITH THE DECLARED EDGES is what keeps this from
   * restating the model's admission rule for a third time. A together edge is
   * unioned only when the target resolves AND both endpoints are open
   * (`model.ts:519`), and a duplicate declares nothing at all — so membership
   * of the component already carries all of that. What is left to check is the
   * single thing the component cannot say: whether these two are DIRECTLY
   * joined. Re-testing `open` here would be a second statement of a rule no
   * input can reach, which is exactly the kind of unfalsifiable defence the
   * reader's own model refuses to write.
   *
   * Dependents first, then peers, deduplicated: a direct dependent is the more
   * specific answer, and an issue can be both.
   */
  const promotersOf = (key: string): readonly string[] => [
    ...new Set([
      ...(dependents.get(key) ?? []),
      ...model
        .togetherComponent(key)
        .filter(
          (member) =>
            member !== key &&
            (declaredTogether.get(key) === member || declaredTogether.get(member) === key),
        ),
    ]),
  ];
  for (const key of candidates) {
    const node = rawByKey.get(key) as NodeInput;
    const signals = resolvePrioritySignals(node, precedence);
    const declared = model.declaredPriority(key).value;
    const effective = model.effectivePriority(key);
    const promoted = effective !== declared;
    priority.set(key, {
      declared,
      effective,
      promoted,
      // The neighbours the urgency arrived through. Reads EFFECTIVE priority
      // on the dependents, so a promotion several hops away still names the
      // adjacent issue rather than reporting none.
      promotedBy: promoted
        ? promotersOf(key).filter(
            (neighbour) => model.effectivePriority(neighbour) === effective,
          )
        : [],
      notation: promoted ? `P${String(declared)} -> ${String(effective)}` : `P${String(declared)}`,
      signals,
    });
  }

  // ---- provenance: `decomposed-from`, which orders NOTHING (SPEC §4.3.6) ----
  // Driven off the deduplicated view, like every other pass: a repeated node
  // must not emit two origins, and a later inert copy must not report an edge
  // the rest of the derivation ignored.
  const provenance: ProvenanceOrigin[] = [];
  for (const [key, node] of rawByKey) {
    const origin = node.data?.decomposedFrom;
    if (origin == null) continue;
    const originKey = refKey(origin, nodeSourceRepo(node, homeRepo), homeRepo);
    provenance.push({
      key,
      origin: originKey,
      originOpen: rawByKey.get(originKey)?.open ?? null,
    });
  }

  // One options value for both halves: the adjacency's keys and the probe's
  // endpoints have to fold identically or the walk starts at a key that is not
  // there and the guard fails open.
  const cycleOptions = { homeRepo };
  // The model's OWN duplicate answer, handed over rather than recomputed — the
  // walk has to see the same edges the model sees (SPEC §4.3.3), and a caller
  // that already built a model must not pay for a second one.
  const adjacency = buildBlockedByAdjacency(issues, model.duplicateCanonical, cycleOptions);

  return {
    slots,
    rankOf,
    priority,
    excluded,
    provenance,
    diagnostics: [...new Set(diagnostics)],
    wouldCycle: (from, to) =>
      wouldCycleOnAdjacency(adjacency, model.duplicateCanonical, from, to, cycleOptions),
  };
}

/**
 * A key's position in the base ranking; `UNRANKED_POSITION` when absent.
 *
 * A NON-FINITE ordinal degrades to the same unranked path an absent key takes.
 * It cannot be allowed through: the comparator only subtracts when the two
 * positions differ, and `NaN !== NaN` passes that guard, so one `NaN` (a
 * `Date.parse` of a missing timestamp is the obvious way to produce it) makes
 * the comparator intransitive and the sort order implementation-defined —
 * two clients could render the same issues differently.
 */
function baseRankingPositions(ranking: IssueOrderBaseRanking): (key: string) => number {
  if (ranking.source === 'fixture-parity') {
    return (key) => finitePosition(ranking.createdAt.get(key));
  }
  const positions = new Map<string, number>();
  ranking.order.forEach((entry, index) => {
    if (!positions.has(entry.key)) positions.set(entry.key, index);
  });
  return (key) => finitePosition(positions.get(key));
}

function finitePosition(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : UNRANKED_POSITION;
}

/** The declared edges promotion provenance is read from. */
interface PromotionEdges {
  /** `key -> the OPEN issues directly blocked by it` (the reverse blocked-by edge). */
  readonly dependents: ReadonlyMap<string, readonly string[]>;
  /**
   * `key -> the single key its own `together-with` names`, resolved.
   *
   * The FORWARD direction only, because the field is single-valued: the edge is
   * symmetric, so the reverse is read by asking the other endpoint. No
   * admission test is applied here — see `promotersOf`, which intersects this
   * with the model's own component.
   */
  readonly declaredTogether: ReadonlyMap<string, string>;
}

/**
 * ONE walk over the declared edges, for both promotion paths.
 *
 * It is one function rather than two because "walk the declarations, skip a
 * duplicate declarer, resolve the target" is a rule that had been written out
 * three separate times by the third review round, and each copy grew its own
 * gap. Reading both edges in a single pass leaves one place for it.
 *
 * IT MUST MATCH THE MODEL EXACTLY, which is the opposite instruction from the
 * cycle guard's. `promotedBy` EXPLAINS a promotion the model computed, so an
 * edge the model did not read cannot be the reason it gives, and an edge the
 * model attributed elsewhere has to be attributed the same way. Refusing more
 * is a safe direction for a pre-write guard and a WRONG one for provenance: it
 * names a cause that did not act.
 *
 * So both of §4.3.3's halves are applied, through the model's own answer:
 * a duplicate declares nothing (`model.ts:443`), and an edge naming a duplicate
 * names its canonical (`model.ts:477`).
 */
function promotionEdges(
  issues: readonly NodeInput[],
  homeRepo: string | undefined,
  rawByKey: ReadonlyMap<string, NodeInput>,
  model: Model,
): PromotionEdges {
  const dependents = new Map<string, string[]>();
  const declaredTogether = new Map<string, string>();
  const seen = new Set<string>();
  for (const node of issues) {
    const key = nodeKey(node, homeRepo);
    if (seen.has(key)) continue; // first occurrence wins, like the model
    seen.add(key);
    if (!node.open) continue; // a closed dependent propagates no urgency
    // A duplicate contributed no edge to the model, so it promoted nothing and
    // may not be named as a promoter — however its own effective priority
    // happens to compare.
    if (model.duplicateCanonical(key) !== null) continue;
    const sourceRepo = nodeSourceRepo(node, homeRepo);
    const resolve = (ref: IssueRef): string => {
      const target = refKey(ref, sourceRepo, homeRepo);
      return model.duplicateCanonical(target) ?? target;
    };
    for (const ref of node.data?.blockedBy ?? []) {
      const blockerKey = resolve(ref);
      // An unresolvable or closed blocker inherits nothing: the lookup answers
      // "is this a known OPEN node" in one step.
      if (rawByKey.get(blockerKey)?.open !== true) continue;
      const existing = dependents.get(blockerKey);
      if (existing === undefined) dependents.set(blockerKey, [key]);
      else existing.push(key);
    }
    const together = node.data?.togetherWith;
    if (together != null) declaredTogether.set(key, resolve(together));
  }
  return { dependents, declaredTogether };
}
