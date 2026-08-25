/**
 * The demo's order — PROJECTED onto the published derivation, never computed
 * here.
 *
 * `@issuegraph/store` takes its `OrderDeriver` as a port with NO default,
 * because the selection order is its own concern: a default in the store would
 * be a second implementation of it. A host therefore has to supply one, and the
 * demo is a host. What it supplies is `@issuegraph/derive` — the reference
 * derivation — reached through two projections and nothing else:
 *
 *   the store's `GraphDocument`  ->  the derivation's `NodeInput[]`
 *   the derivation's slots       ->  the stations this page draws
 *
 * THE EARLIER VERSION OF THIS FILE READ THE ORDERING RULES A SECOND TIME, and
 * that was the right call at the time only because there was nothing to import:
 * it carried its own union-find, its own duplicate-chain walk, its own Tarjan,
 * its own effective-priority fixed point and its own selection sort, all read
 * off SPEC §6.2, §6.3 and §6.4. Every one of those is gone. The review that
 * produced this file measured what the duplication cost — 31 findings across
 * fifteen rounds, the largest cluster in exactly those algorithms — which is
 * the argument for the port having no default stated as evidence rather than as
 * a design note.
 *
 * WHAT IS STILL THE HOST'S IS STILL HERE, because the specification puts it
 * here rather than because it was convenient to keep:
 *
 *  - the EXECUTOR HOLDS (§6.8: hold semantics must not be encoded as format
 *    fields, so the format never learns why an executor declines ready work);
 *  - the CONCURRENCY CAP (§6.5: ready issues are safe to run concurrently by
 *    construction, and how many to dispatch is scheduler policy, out of scope);
 *  - the BASE RANKING (`@issuegraph/derive` takes a host's own ordering as an
 *    input and never computes one, so that a tracker's existing `ORDER BY` stays
 *    single-sourced where it already lives);
 *  - and the RENDERING — stations, placement, chips, wording.
 *
 * Those are inputs to a derivation and a projection of its output. None of them
 * is a derivation.
 *
 * Two outputs from one computation. {@link explainOrder} is the rich form the
 * demo renders and {@link createDeriver} projects it onto the store's
 * `OrderRow`, so the rail and the page cannot disagree about one document.
 */

import {
  DEFAULT_PRIORITY,
  type EdgeField,
  type Priority,
  isPriority,
  isSymmetricEdgeField,
} from '@issuegraph/core';
import type { ConfigRankedIssue, DerivedIssueOrder, IssueOrderSlot } from '@issuegraph/derive';
import { deriveIssueOrder } from '@issuegraph/derive';
import type { Frontmatter, IssueRef as ParsedRef, Model, NodeInput } from '@issuegraph/reader';
import { buildModel } from '@issuegraph/reader';
import type {
  GraphDocument,
  IssueRef,
  OrderDeriver,
  OrderRow,
  StoredEdge,
  StoredIssue,
} from '@issuegraph/store';

/**
 * A hold the EXECUTOR applies, not the graph (§6.8).
 *
 * It reaches the derivation through this table rather than through the
 * document, because §6.8 forbids encoding hold semantics as format fields: the
 * format never learns why an executor declines ready work. A host knows its own
 * holds; that is exactly the asymmetry this table expresses.
 */
export interface ExecutorHold {
  readonly ref: IssueRef;
  /** One word for the badge — `claimed`, `parked`. */
  readonly label: string;
  /** The sentence shown beside it. */
  readonly detail: string;
  /**
   * Whether this hold means the issue is ACTIVELY BEING WORKED.
   *
   * §6.2 rule 4 admits a serialize group on "no actively-claimed member" — a
   * claim, not a hold in general. Reading every executor hold as a claim holds
   * a whole group because one member is *parked*, which is the opposite of what
   * a width-1 semaphore is for: nothing is running, so nothing is excluded.
   *
   * It reaches the derivation as `NodeInput.assigneeCount`, which is the one
   * channel the model reads a claim through — so the ADMISSION RULE is applied
   * by the reader and this flag only decides what to tell it.
   */
  readonly active?: boolean;
}

/**
 * How many ready stations may run at once.
 *
 * An EXECUTOR's number, not the graph's: §6.5 is explicit that ready issues are
 * safe to run concurrently by construction and that how many to dispatch is
 * scheduler policy, out of the specification's scope. It lives here for the
 * same reason the executor holds do — the host knows it and the format never
 * learns it — and it is what makes a hollow station mean anything.
 */
export const DEFAULT_CONCURRENCY_CAP = 2;

/** Which family a hold belongs to. The two are never given one treatment. */
export type HoldFamily = 'graph' | 'executor';

/**
 * One thing worth saying about why an issue is where it is.
 *
 * A CHIP IS PRESENTATION, NOT THE VERDICT. Whether a row may start comes from
 * `IssueOrderSlot.ready` and from nothing else; these carry the demo's own
 * wording for what the model already decided, so a visitor reads a sentence
 * rather than a boolean. `order.test.ts` pins the two together in both
 * directions, which is what stops the wording drifting into a second opinion.
 *
 * Most holds block. One does not, and §6.7 is explicit about the asymmetry: an
 * unresolved `blocked-by` is treated as BLOCKING, because unknown state is not
 * "closed" and starting work whose dependency nobody can see is the failure
 * that rule exists to prevent — while an unresolved reference on a SYMMETRIC
 * field "contributes no linkage" and is merely surfaced for grooming. It links
 * nothing, so it excludes nothing.
 */
export interface Hold {
  readonly family: HoldFamily;
  readonly label: string;
  readonly detail: string;
  /**
   * Whether this reason keeps the issue out of the ready set. Absent means it
   * does — blocking is the overwhelming case, and a flag that must be
   * remembered on every ordinary hold would be forgotten on one.
   */
  readonly blocking?: false;
}

/** Whether a reason actually keeps work out of the ready set. */
function blocks(hold: Hold): boolean {
  return hold.blocking !== false;
}

/**
 * How a station is drawn. The three forms answer ONE question — can this start
 * now? — and they are about PARALLELISM, not about the graph:
 *
 * - `filled` — ready, and inside the concurrency cap. Glance-count these
 *   against the cap and you have the answer to "how much can run right now".
 * - `hollow` — ready, but beyond the cap: it starts after a NAMED rank frees a
 *   slot. A sequencing statement, never a hold.
 * - `dashed` — held. Every hold lands here, both families alike; what differs
 *   between the families is WHERE the row is drawn, not how its station reads.
 */
export type Station = 'filled' | 'hollow' | 'dashed';

/**
 * Where a row's rank came from. Three forms, from the workspace design's §16d.
 *
 * The design's first form is a host's own ordered query (`label:P1`), which is
 * chrome this demo has no equivalent of — it ranks the whole document. The
 * `declared` form stands in its place: the issue's own declared priority
 * (§4.3.5) is what put it here.
 */
export type Provenance =
  | { readonly form: 'declared'; readonly priority: Priority }
  | { readonly form: 'default-tier'; readonly priority: Priority }
  | {
      readonly form: 'promoted';
      readonly declared: Priority;
      readonly effective: Priority;
      /** The dependent whose urgency it inherited (§6.3). */
      readonly from: IssueRef;
    };

/** A row as the demo renders it. A superset of the store's `OrderRow`. */
export interface ExplainedRow {
  readonly issue: StoredIssue;
  readonly rank: number;
  /**
   * Whether the rank is shown. Graph-derived holds sit inline at their would-be
   * rank and show `—`; the executor-held and duplicates sit in a collapsed
   * footer group and earn no rank slot at all.
   */
  readonly showRank: boolean;
  /** Whether the row belongs to the spine or the collapsed footer group. */
  readonly placement: 'spine' | 'footer';
  readonly ready: boolean;
  readonly station: Station;
  /** For a hollow station: the rank whose completion frees this row's slot. */
  readonly readyAfterRank?: number;
  readonly holds: readonly Hold[];
  readonly provenance: Provenance;
  readonly effectivePriority: Priority;
  /**
   * How many issues share this row's `serialize-with` or `together-with`
   * component. Groups are never written down (§6.1), so this is computed — by
   * the derivation, which counts CANDIDATES and spans a together unit's whole
   * membership rather than its lead's.
   */
  readonly serializeGroupSize: number;
  readonly togetherGroupSize: number;
}

/**
 * The priority label spelling the reader understands (§4.3.5's mapped-label
 * carrier, which is canonical over the frontmatter field).
 *
 * The demo carries a declared priority on `StoredIssue`, and a tracker's own
 * convention is how that reaches the model. `order.test.ts` asserts this
 * round-trips through `priorityLabelValue` for every `Priority`, so the demo
 * cannot quietly spell a label the reader does not read — which would present
 * as "every issue is in the spec's default tier" rather than as a failure.
 */
function priorityLabel(priority: Priority): string {
  return `P${String(priority)}`;
}

/** The derivation answers in `number`; the vocabulary's own type is narrower. */
function asPriority(value: number): Priority {
  return isPriority(value) ? value : DEFAULT_PRIORITY;
}

/**
 * One issue's declaration, assembled from the edges the document holds.
 *
 * THE SWITCH IS EXHAUSTIVE OVER `EdgeField`, which is the mechanism rather than
 * a style: a sixth relationship kind added to the vocabulary fails to compile
 * here instead of being silently dropped out of the projection — and a dropped
 * edge is an absence rendered as a value, which is the one failure the reader's
 * own under-read tier exists to refuse.
 *
 * FIRST DECLARATION WINS on the four single-valued fields (§4.3.4, §4.3.7:
 * a writer joins a group by pointing at any ONE existing member). The demo's
 * adapter refuses to write a second, so this is a total function over documents
 * the adapter can produce rather than a policy about ones it cannot;
 * `order.test.ts` pins the split against `EDGE_CARDINALITY` so the two cannot
 * drift.
 */
function declarationFor(ref: IssueRef, edges: readonly StoredEdge[]): Frontmatter {
  const blockedBy: ParsedRef[] = [];
  let decomposedFrom: ParsedRef | null = null;
  let duplicateOf: ParsedRef | null = null;
  let serializeWith: ParsedRef | null = null;
  let togetherWith: ParsedRef | null = null;

  for (const edge of edges) {
    if (edge.from !== ref) continue;
    // `repo: null` throughout: this document is one repository's, so a
    // reference is bare and `nodeKey`/`refKey` collapse to the demo's own
    // opaque reference. The two key spaces are therefore IDENTICAL, which is
    // what lets every model answer below be looked up by `IssueRef` with no
    // translation layer — and `order.test.ts` asserts it rather than assuming.
    const target: ParsedRef = { repo: null, id: edge.to };
    const kind: EdgeField = edge.kind;
    switch (kind) {
      case 'blocked-by':
        blockedBy.push(target);
        break;
      case 'decomposed-from':
        decomposedFrom ??= target;
        break;
      case 'duplicate-of':
        duplicateOf ??= target;
        break;
      case 'serialize-with':
        serializeWith ??= target;
        break;
      case 'together-with':
        togetherWith ??= target;
        break;
    }
  }

  return {
    blockedBy,
    decomposedFrom,
    duplicateOf,
    serializeWith,
    togetherWith,
    // The demo carries priority as the tracker's own convention (a mapped
    // label), which §4.3.5 makes canonical. Declaring it in BOTH carriers would
    // manufacture the §5.4 disagreement anomaly out of nothing.
    priority: null,
    evidence: null,
  };
}

/**
 * The document, projected onto the derivation's node input.
 *
 * `declarationRead: 'read'` throughout, and it is a fact rather than an
 * optimism: this document was never parsed out of an issue body, so no field
 * could have been dropped on the way in. A host that DID parse bodies would
 * carry the parser's own answer here.
 */
function toNodes(document: GraphDocument, holds: readonly ExecutorHold[]): readonly NodeInput[] {
  const claimed = new Set(holds.filter((hold) => hold.active === true).map((hold) => hold.ref));
  return document.issues.map((issue) => ({
    id: issue.ref,
    repo: null,
    open: issue.state === 'open',
    labels: issue.priority === undefined ? [] : [priorityLabel(issue.priority)],
    // §6.2 rule 4's admission input, and the ONLY channel a claim reaches the
    // model through. The rule itself — which member excludes which, and how a
    // together unit's own atomic claim is exempted — is the reader's.
    assigneeCount: claimed.has(issue.ref) ? 1 : 0,
    data: declarationFor(issue.ref, document.edges),
    declarationRead: 'read' as const,
  }));
}

/**
 * The demo's base ranking: newest first.
 *
 * `@issuegraph/derive` takes the host's own ordering as an INPUT and never
 * computes one — the array index is the position, which is what a tracker's own
 * `ORDER BY` already produced. This host has no ordered query, so it ranks the
 * whole document by reference, newest first: §6.4's default tiebreak, and the
 * reason the seed numbers its issues the way a tracker numbers them.
 *
 * `matchedOrderIndex` is rank PROVENANCE — which ordered-query entry matched —
 * and there is exactly one "query" here, so every row carries `0`. The
 * derivation does not read it.
 */
function baseRanking(document: GraphDocument): readonly ConfigRankedIssue[] {
  return [...document.issues]
    .sort((a, b) => newestFirst(a.ref, b.ref))
    .map((issue) => ({ key: issue.ref, matchedOrderIndex: 0 }));
}

/**
 * Newest first, over references a tracker assigns in ascending order.
 *
 * §6.4 permits a substituted tiebreak where the domain argues for one and
 * requires only that it be DETERMINISTIC, which comparing references is. A
 * reference is opaque (§4.2), so the numeric reading is a fast path and the
 * codepoint comparison is what makes the ordering total.
 */
function newestFirst(a: IssueRef, b: IssueRef): number {
  const numeric = Number(b) - Number(a);
  if (Number.isFinite(numeric) && numeric !== 0) return numeric;
  return b < a ? -1 : b > a ? 1 : 0;
}

/** One derivation of one document: the model it rests on, and the order. */
interface Derivation {
  readonly model: Model;
  readonly order: DerivedIssueOrder;
}

/**
 * Derive one document, once.
 *
 * TWO CALLS, ONE MODEL — and they cannot disagree. `deriveIssueOrder` builds
 * its own model from `applyPriorityPrecedence(issues)`, which under the default
 * precedence (`label`, §4.3.5's own ordering) returns the array untouched; both
 * are pure functions of the same nodes. The demo needs the model directly for
 * the two structural questions the order does not answer — which nodes sit in a
 * `blocked-by` cycle (§6.6), and which component a chip should name — and asks
 * it rather than reading either off a diagnostic sentence, because prose that is
 * matched fails OPEN the day it is reworded.
 */
function derive(document: GraphDocument, holds: readonly ExecutorHold[]): Derivation {
  const nodes = toNodes(document, holds);
  return {
    model: buildModel(nodes),
    order: deriveIssueOrder({
      issues: nodes,
      config: { baseRanking: { source: 'config', order: baseRanking(document) } },
    }),
  };
}

/** Everything a chip needs to look up, resolved once per document. */
interface Index {
  readonly model: Model;
  readonly byRef: ReadonlyMap<IssueRef, StoredIssue>;
  readonly edges: readonly StoredEdge[];
  readonly executor: ReadonlyMap<IssueRef, ExecutorHold>;
  readonly claimed: ReadonlySet<IssueRef>;
  readonly cyclic: ReadonlySet<IssueRef>;
}

function index(document: GraphDocument, holds: readonly ExecutorHold[], model: Model): Index {
  return {
    model,
    byRef: new Map(document.issues.map((issue) => [issue.ref, issue])),
    edges: document.edges,
    executor: new Map(holds.map((hold) => [hold.ref, hold])),
    claimed: new Set(holds.filter((hold) => hold.active === true).map((hold) => hold.ref)),
    cyclic: new Set(model.cycles.flat()),
  };
}

/**
 * Every reason worth SAYING about this issue, in the demo's own words.
 *
 * Each one is a structural question put to the model — never a match against a
 * readiness sentence, and never a rule restated beside it. The model resolves
 * duplicates (§4.3.3), finds the cycles (§6.6) and computes both components
 * (§4.3.4, §4.3.7); what is left here is looking up an issue's state in the
 * demo's own document and choosing a word for the chip.
 */
function ownHolds(ref: IssueRef, at: Index): Hold[] {
  const found: Hold[] = [];
  const issue = at.byRef.get(ref);
  if (issue === undefined) return found;

  if (issue.state === 'closed') {
    found.push({ family: 'graph', label: 'closed', detail: 'the issue is closed' });
  }

  const executor = at.executor.get(ref);
  if (at.model.duplicateCanonical(ref) !== null) {
    found.push({ family: 'executor', label: 'duplicate', detail: 'a duplicate is never worked' });
    // A DUPLICATE DECLARES NOTHING (§4.3.3, and `buildModel` drops its edges
    // entirely), so listing the relationships it happens to carry would explain
    // a row with edges the model does not read. The one hold it can still earn
    // is the executor's own, which the format never learns about either way.
    if (executor !== undefined) {
      found.push({ family: 'executor', label: executor.label, detail: executor.detail });
    }
    return found;
  }

  if (at.cyclic.has(ref)) {
    found.push({
      family: 'graph',
      label: 'cycle',
      detail: 'in a blocked-by cycle, which is stuck until a groomer breaks it',
    });
  }

  // §4.3.7: an edge BETWEEN two members of one together unit is internal and
  // advisory — the unit advances together, so a member cannot wait on its own
  // partner. Asked of the model's component rather than re-derived from edges.
  const unit = new Set(at.model.togetherComponent(ref));

  for (const edge of at.edges) {
    if (edge.from !== ref) continue;
    if (edge.kind === 'blocked-by') {
      // §4.3.3: an edge naming a duplicate names its CANONICAL instead. The
      // model's own answer, so this and readiness cannot read one edge two ways.
      const target = at.model.duplicateCanonical(edge.to) ?? edge.to;
      const blocker = at.byRef.get(target);
      if (blocker === undefined) {
        found.push({
          family: 'graph',
          label: 'unresolvable',
          detail: `blocked-by ${target}, which this document cannot resolve — treated as blocking`,
        });
        continue;
      }
      if (target !== ref && unit.has(target)) continue;
      if (blocker.state === 'open') {
        found.push({ family: 'graph', label: 'blocked', detail: `blocked by ${target}` });
      }
      continue;
    }
    // An unresolved reference on a GROUP field, surfaced rather than silently
    // dropped: dropping it is what turns a malformed document into one that
    // merely looks thin, and a groomer has nothing to act on.
    //
    // THE TWO GROUP FIELDS ARE NOT ONE CASE, and reading them as one is a
    // mis-generalization of §6.7 this demo shipped until the swap onto the
    // published derivation caught it. §6.7 names `blocked-by` and
    // `serialize-with` only: an unresolvable `serialize-with` "contributes no
    // linkage but is likewise surfaced", so it links nothing and therefore
    // excludes nothing. It says NOTHING about `together-with`, and the reader
    // refuses the declarer there — correctly, by §4.3.7: a unit is claimed
    // ATOMICALLY, and a member that cannot be identified cannot be claimed
    // alongside. Measured, one field apart: the declarer comes back `ready`
    // with an unresolvable `serialize-with` and NOT ready with an unresolvable
    // `together-with`.
    //
    // Drawing both as non-blocking left a row the derivation was holding with
    // nothing but a note on it — a station that says "held" and no reason a
    // visitor could read. `order.test.ts` pins the chips against
    // `IssueOrderSlot.ready` in both directions, which is what found it.
    if (isSymmetricEdgeField(edge.kind) && !at.byRef.has(edge.to)) {
      const linksNothing = edge.kind === 'serialize-with';
      found.push({
        family: 'graph',
        label: 'unresolvable',
        detail: linksNothing
          ? `serialize-with ${edge.to}, which this document cannot resolve — it links nothing`
          : `together-with ${edge.to}, which this document cannot resolve — the unit cannot be claimed atomically without it`,
        ...(linksNothing ? { blocking: false as const } : {}),
      });
    }
  }

  for (const member of at.model.serializeComponent(ref)) {
    if (member === ref) continue;
    // A GROUPMATE IS NOT A RIVAL. A together component is ONE atomic claim
    // (§4.3.7), so a member of this issue's own unit holding that claim is this
    // issue's claim too, not a second worker competing for the same semaphore.
    // The reader excludes the unit from its own claim scan for exactly this
    // reason; the chip has to agree with it or it would name a rival the model
    // never counted.
    if (unit.has(member)) continue;
    if (!at.claimed.has(member)) continue;
    if (at.byRef.get(member)?.state !== 'open') continue;
    found.push({
      family: 'graph',
      label: 'serialized',
      detail: `serialize group member ${member} is actively claimed`,
    });
  }

  if (executor !== undefined) {
    found.push({ family: 'executor', label: executor.label, detail: executor.detail });
  }
  return found;
}

/**
 * Every reason an issue may not start, §6.2 rule 5 included: a together group is
 * ready as a unit or not at all, so a groupmate's hold is this issue's hold.
 *
 * This mirrors what the derivation does one layer up — `IssueOrderSlot`'s
 * `holdReasons` is the UNION over the unit's members and its `ready` is the
 * conjunction — so the chips a member shows are the reasons its slot is held.
 * A member's own `blocked` chips are propagated too, because the reader does
 * NOT contract the dependency graph across a unit: each member carries its own
 * blockers and the union at the slot is what makes them the unit's.
 *
 * A together component contains only OPEN nodes — the reader unions the edge
 * only when both endpoints are open — so there is no closed member to filter
 * here, and a filter that no input can reach would read as evidence that one
 * exists.
 */
function holdsFor(ref: IssueRef, at: Index): readonly Hold[] {
  const own = ownHolds(ref, at);
  const unit = at.model.togetherComponent(ref);
  if (unit.length <= 1) return own;
  const shared: Hold[] = [...own];
  for (const member of unit) {
    if (member === ref) continue;
    for (const hold of ownHolds(member, at)) {
      shared.push({ ...hold, detail: `${member}, in this together group, is held: ${hold.detail}` });
    }
  }
  return shared;
}

/** A slot the derivation ranked, or `null` for a row it never ranked at all. */
type Slot = IssueOrderSlot | null;

/** One drawn row, before it is described: where it sits and at what rank. */
interface Placement {
  readonly ref: IssueRef;
  readonly rank: number;
  readonly placement: ExplainedRow['placement'];
  readonly slot: Slot;
}

/**
 * The whole order, in the form the demo renders.
 *
 * One derivation, projected. The store's rows come off this rather than being
 * computed beside it, so the rail and the page can never disagree about one
 * document.
 */
export function explainOrder(
  document: GraphDocument,
  holds: readonly ExecutorHold[] = [],
  concurrencyCap = DEFAULT_CONCURRENCY_CAP,
): readonly ExplainedRow[] {
  const { model, order } = derive(document, holds);
  const at = index(document, holds, model);

  const holdsOf = new Map<IssueRef, readonly Hold[]>();
  for (const issue of document.issues) holdsOf.set(issue.ref, holdsFor(issue.ref, at));

  const executorHeld = (slot: IssueOrderSlot): boolean =>
    slot.members.some((member) =>
      (holdsOf.get(member) ?? []).some((hold) => hold.family === 'executor' && blocks(hold)),
    );

  // ---- placement: which rows exist, where they sit, and at what rank ----
  //
  // PLACEMENT IS DECIDED PER SLOT, not per issue, and that is what keeps a
  // together group in ONE place. The design's rule is about the hold's FAMILY —
  // graph-derived holds render inline at their would-be rank, executor-derived
  // ones and duplicates collapse into the footer — and a unit is one piece of
  // work, so it is placed as one.
  //
  // A HELD SPINE SLOT KEEPS ITS POSITION rather than moving to the end, which is
  // the derivation's own contract: "why isn't my P1 running" is answerable at
  // the rank the work would have taken. The derivation numbers only READY slots
  // (a held one carries `rank: null`, because it has no position in the
  // sequence), so the demo draws every spine slot at its index and shows `—`
  // where there is no number to show.
  const placements: Placement[] = [];
  const seen = new Set<IssueRef>();
  let next = 0;

  /** One rank for one unit of work, skipping anything already placed. */
  const place = (refs: readonly IssueRef[], where: Placement['placement'], slot: Slot): void => {
    const fresh = refs.filter((ref) => !seen.has(ref));
    // NOTHING FRESH TAKES NO RANK. Incrementing regardless would leave a hole in
    // the sequence for a row that was never drawn, and the ranks are what the
    // hollow stations name.
    if (fresh.length === 0) return;
    const rank = next;
    next += 1;
    for (const ref of fresh) {
      seen.add(ref);
      placements.push({ ref, rank, placement: where, slot });
    }
  };

  for (const slot of order.slots) if (!executorHeld(slot)) place(slot.members, 'spine', slot);

  // The footer's three populations, none of which is a candidate the order
  // ranks: slots an EXECUTOR is holding, issues the derivation EXCLUDED as
  // duplicates (§4.3.3), and CLOSED issues. Their numbers exist only so a row
  // has somewhere to sit — `showRank` is false throughout, because a position in
  // a sequence nothing can start is not a fact about the work.
  for (const slot of order.slots) if (executorHeld(slot)) place(slot.members, 'footer', slot);
  for (const excluded of order.excluded) place([excluded.key], 'footer', null);
  for (const issue of [...document.issues].sort((a, b) => newestFirst(a.ref, b.ref))) {
    place([issue.ref], 'footer', null);
  }

  // The ranks a READY spine slot occupies, ascending because that is the order
  // they were assigned in. This is what the concurrency cap is counted against:
  // a together unit is one candidate, so it consumes one entry rather than one
  // per member.
  const readySlots = [
    ...new Set(
      placements
        .filter((each) => each.placement === 'spine' && each.slot?.ready === true)
        .map((each) => each.rank),
    ),
  ];

  // ---- the rows ----
  const rows: ExplainedRow[] = [];
  for (const { ref, rank, placement, slot } of placements) {
    const issue = at.byRef.get(ref);
    if (issue === undefined) continue;
    // READINESS IS THE DERIVATION'S, and the chips are what it is SAID with. A
    // footer row is not a candidate at all, so it is never ready — and a spine
    // slot carries no blocking executor hold by construction, so there is
    // nothing to add to `slot.ready`.
    const ready = placement === 'spine' && slot?.ready === true;
    // A ready row inside the cap can start now; one beyond it starts when the
    // slot `concurrencyCap` places earlier is finished, which is the rank the
    // hollow station names.
    const position = ready ? readySlots.indexOf(rank) : -1;
    const beyondCap = position >= concurrencyCap;
    const readyAfter = beyondCap ? readySlots[position - concurrencyCap] : undefined;
    rows.push({
      issue,
      rank,
      showRank: ready,
      placement,
      ready,
      station: !ready ? 'dashed' : beyondCap ? 'hollow' : 'filled',
      ...(readyAfter === undefined ? {} : { readyAfterRank: readyAfter }),
      holds: holdsOf.get(ref) ?? [],
      provenance: provenanceOf(issue, order, model),
      effectivePriority: asPriority(model.effectivePriority(ref)),
      // FROM THE SLOT WHEREVER THERE IS ONE, so the sizes a row shows are the
      // derivation's own — the union over a unit's members, counting candidates.
      // A duplicate or a closed issue was never ranked and has no slot to read,
      // so the model's components answer for it.
      serializeGroupSize: slot?.serializeGroupSize ?? model.serializeComponent(ref).length,
      togetherGroupSize: slot?.togetherGroupSize ?? model.togetherComponent(ref).length,
    });
  }
  return rows;
}

/**
 * Where a row's rank came from, read off the derivation's priority view.
 *
 * The view carries §6.3's promotion and the dependents the urgency arrived
 * through, so `promoted` is the derivation's verdict rather than a comparison
 * made here. Only a CANDIDATE has one — a duplicate or a closed issue is not in
 * the order — so those fall back to the model's own declared priority, which is
 * the same accessor the derivation reads.
 */
function provenanceOf(issue: StoredIssue, order: DerivedIssueOrder, model: Model): Provenance {
  const view = order.priority.get(issue.ref);
  const declared = asPriority(view?.declared ?? model.declaredPriority(issue.ref).value);
  const promoter = view?.promotedBy[0];
  if (view !== undefined && view.promoted && promoter !== undefined) {
    return { form: 'promoted', declared, effective: asPriority(view.effective), from: promoter };
  }
  return issue.priority === undefined
    ? { form: 'default-tier', priority: declared }
    : { form: 'declared', priority: declared };
}

/**
 * How many scheduler SLOTS a set of rows occupies.
 *
 * A together group is one candidate holding one rank (§4.3.7), so counting its
 * members would report more work running than the concurrency cap allows — a
 * header contradicting the stations drawn directly beneath it. Deduplicating by
 * rank is what makes a count mean the same thing a station does.
 */
export function slotCount(rows: readonly ExplainedRow[]): number {
  return new Set(rows.map((row) => row.rank)).size;
}

/**
 * The `OrderDeriver` the store takes, projected from {@link explainOrder}.
 *
 * The executor holds are closed over rather than passed through the document,
 * for §6.8's reason: the format never learns why an executor declines ready
 * work, so they cannot travel with it.
 */
export function createDeriver(holds: readonly ExecutorHold[] = []): OrderDeriver {
  return (document: GraphDocument): readonly OrderRow[] =>
    explainOrder(document, holds)
      // FOOTER ROWS ARE NOT IN THE ORDER — that is what the footer means, and
      // the store computes `entered` and `left` by comparing one order against
      // the next. Handing it rows that were never candidates made an issue
      // LEAVING the order (a visitor marking it a duplicate) look like a move
      // to its footer rank instead, so the change summary reported a blast
      // radius that never happened.
      //
      // `explainOrder` still returns them, because the PAGE draws them: the
      // collapsed group is how a visitor sees what was excluded and why. The
      // two readers want different sets, and this is the seam between them.
      .filter((row) => row.placement === 'spine')
      .map(
        (row): OrderRow => ({
          ref: row.issue.ref,
          rank: row.rank,
          ready: row.ready,
          // The store documents this as "why it may not start, EMPTY WHEN
          // READY". A non-blocking annotation is not such a reason, so
          // including it would hand the store a ready row with reasons — a
          // contract violation.
          holdReasons: row.holds.filter(blocks).map((hold) => hold.detail),
        }),
      );
}

/**
 * The `blocked-by` edges this document holds that LIE ON a cycle, by edge id.
 *
 * Asked of `@issuegraph/derive`'s own pre-write guard, one edge at a time. The
 * guard answers "would `from blocked-by to` close a loop", and the walk starts
 * at `to` — so asking it about an edge the document ALREADY holds asks whether
 * `to` reaches `from` by some OTHER path, which is exactly "this edge is on a
 * cycle". `deriveIssueOrder` returns the probe bound to the node set it derived
 * from, so every question costs a walk and no round-trip.
 *
 * NOT `Model.cycles`, and the difference is the package's own, deliberately.
 * `cycles` is §6.6's DETECT-ON-READ surface: it filters to open nodes and drops
 * a duplicate's own edges, because a duplicate declares nothing and a closed
 * blocker does not block today. The guard is asked about the FUTURE — the edge
 * is about to be written and will outlive today's states — so it spans closed
 * nodes and KEEPS a duplicate's edges, since clearing a `duplicate-of` brings
 * them back with the cycle already written. Refusing more is the recoverable
 * direction: a person can decline a refusal, and nobody can unstick a component
 * after the fact.
 *
 * The demo takes BOTH surfaces from the package rather than picking one and
 * calling the other wrong — the `cycle` chip reads `Model.cycles`, so what a row
 * SAYS agrees with why the derivation held it, and the guard reads this, so what
 * a write is REFUSED for agrees with the package's refusal.
 */
function cyclicEdges(document: GraphDocument): ReadonlySet<string> {
  const { order } = derive(document, []);
  const found = new Set<string>();
  for (const edge of document.edges) {
    if (edge.kind !== 'blocked-by') continue;
    if (order.wouldCycle(edge.from, edge.to)) found.add(edge.id);
  }
  return found;
}

/**
 * The host's graph guard, asked of the two DOCUMENTS rather than of the edit.
 *
 * A store that only ever wrote `blocked-by` would call `wouldCycleOnBlockedBy`
 * on the mutation and be done. This surface writes all five kinds, and a cycle
 * needs no new dependency to appear: `duplicate-of` COLLAPSES vertices.
 * `#4 blocked-by #2`, `#2 blocked-by #3`, `#3 duplicate-of #4` closes
 * `#4 -> #2 -> #4` with the last edit adding no dependency at all. Extending the
 * guard kind by kind is a list that is always one entry short; asking the same
 * package predicate of both documents has no list — and the walk is still the
 * package's, edge for edge.
 *
 * The store hands a guard both documents precisely so it can ask this.
 *
 * Deliberately NOT a refusal of a cycle that already exists — §6.6 is explicit
 * that a cycle is detected on read and surfaced for grooming, because
 * write-time rejection pushes writers into describing the dependency in prose.
 * Comparing which EDGES lie on one means only what this edit adds is refused,
 * and the seed ships a cycle for exactly that reason.
 */
export function introducesCycle(current: GraphDocument, next: GraphDocument): boolean {
  const before = cyclicEdges(current);
  for (const id of cyclicEdges(next)) if (!before.has(id)) return true;
  return false;
}
