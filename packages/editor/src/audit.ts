/**
 * The audit: four findings about an encoding, as a pure detector over one
 * document.
 *
 * Design §17d names exactly four, and they are not variations on one theme —
 * each says something different about how much of the encoding can be trusted:
 *
 *     cycle               nothing in the component can EVER be ready
 *     stale blocker       bookkeeping; a closed blocker already satisfies readiness
 *     dead duplicate ref  the issue is out of the order and nothing tracks its work
 *     encoding refused    the issue has NO edges, and looks merely unencoded
 *
 * THE FOURTH IS THE ONE THAT IS EASY TO DROP, and it is the reason this module
 * takes more than a document. It is not a relationship finding — it is the
 * ABSENCE of readable relationships, and §17e is explicit that most issues
 * legitimately have none. Without it, an issue whose declaration the reader
 * refused is indistinguishable from an issue that declares nothing, which is an
 * absence rendered as a value in the one place somebody is auditing for
 * encoding accuracy. A parsed document cannot carry it: a refusal is a fact
 * about the raw body, and by the time a document exists the body is gone. So
 * the host states it, from the reader's own answer.
 *
 * NOTHING HERE FIXES ANYTHING. Every finding is a judgment call — a stale
 * blocker may be deliberate history — so the detector reports and the surface
 * navigates. `auto-fix` appears nowhere in this package, deliberately.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import type { GraphDocument, IssueRef, StoredEdge } from '@issuegraph/store';

/**
 * The four classes, in the order §17d states them — which is also the order
 * findings are reported in, so a list is stable between runs.
 */
export const AUDIT_CLASSES = Object.freeze([
  'cycle',
  'stale-blocker',
  'dead-duplicate-ref',
  'encoding-refused',
] as const);

export type AuditClass = (typeof AUDIT_CLASSES)[number];

/**
 * How much a finding costs, in the design's own words rather than a number.
 *
 * Named rather than ranked because the four are not points on one scale: a
 * cycle stops the work, a dead duplicate ref hides work that looks handled, and
 * those are different harms. {@link AUDIT_CLASS_SPECS} carries the one ordering
 * anything needs — which finding wins a row that has several.
 */
export type AuditSeverity =
  /** The only finding that stops work outright: no member can ever be ready. */
  | 'blocks-work'
  /** The issue is excluded from the order while nothing tracks its work. */
  | 'dangerous'
  /** Closed blockers satisfy readiness; clearing is bookkeeping. */
  | 'misleading'
  /** Until it parses the issue has no edges at all. */
  | 'blocks-own-edges';

/** What is true of a class, for every finding in it. */
export interface AuditClassSpec {
  readonly severity: AuditSeverity;
  /**
   * Which finding speaks for a row carrying several. Higher wins.
   *
   * A ROW ORDERING, NOT A SEVERITY ORDERING. `severity` stays a name because
   * the four harms are not commensurable; this number exists only because one
   * issue can carry two findings and the left-bar has one row to say it on.
   */
  readonly weight: number;
  /**
   * Whether the finding may be kept as deliberate history.
   *
   * TRUE ON `stale-blocker` AND NOTHING ELSE (§17d). A closed blocker is often
   * a record of what a piece of work waited for, and clearing it destroys that;
   * none of the other three is ever something to keep. Stated as data on the
   * class so the affordance cannot be offered by a render site that decides for
   * itself.
   */
  readonly keepAsHistory: boolean;
}

/**
 * The class table. A total record, so adding a class to {@link AUDIT_CLASSES}
 * is a compile error until this states what it costs — which is what stops a
 * fifth finding arriving with its severity chosen wherever it is first drawn.
 */
export const AUDIT_CLASS_SPECS: Readonly<Record<AuditClass, AuditClassSpec>> = Object.freeze({
  cycle: Object.freeze({ severity: 'blocks-work', weight: 3, keepAsHistory: false }),
  'dead-duplicate-ref': Object.freeze({ severity: 'dangerous', weight: 2, keepAsHistory: false }),
  'encoding-refused': Object.freeze({
    severity: 'blocks-own-edges',
    weight: 1,
    keepAsHistory: false,
  }),
  'stale-blocker': Object.freeze({ severity: 'misleading', weight: 0, keepAsHistory: true }),
});

/** One finding. Severity travels ON it, never looked up at the render site. */
export interface AuditFinding {
  readonly kind: AuditClass;
  readonly severity: AuditSeverity;
  readonly keepAsHistory: boolean;
  /**
   * Every issue the finding is about, sorted so two runs over one document
   * agree. A cycle names its whole component; the other three name one issue,
   * or the two ends of the edge that produced them.
   */
  readonly members: readonly IssueRef[];
  /** What the reader can be told, in one sentence. Never parsed, never a code. */
  readonly detail: string;
}

/**
 * An issue whose declaration the reader refused.
 *
 * The `diagnostic` is the reader's own words when the host has them — this
 * package never produces one, because it never sees a body.
 */
export interface EncodingRefusal {
  readonly ref: IssueRef;
  readonly diagnostic?: string | undefined;
}

/**
 * Would `from blocked-by to` close a `blocked-by` cycle?
 *
 * THE PORT, AND THE WHOLE REASON THIS MODULE DOES NOT WALK THE GRAPH.
 * `@issuegraph/derive` already ships the walk, and `@issuegraph/store` already
 * declares the seat it arrives in — `EdgeGuard`, *"refusals that need to see
 * the graph, cycles above all"*. A second walk here would be the mirror whose
 * input space drifts, and it would drift in a specific, checkable way: the
 * store treats a reference as OPAQUE and never parses one, while the reader
 * normalises `owner/repo#N` against a home repo (§4.2). Translating between
 * those two spellings out here is a second statement of §4.2, and the first
 * cross-repo backlog is where the two would part company.
 *
 * `DerivedIssueOrder.wouldCycle` is the intended implementation: it is bound to
 * a node set the host has already built, so an audit that re-runs on every edit
 * costs one walk per `blocked-by` edge rather than one model build per edge.
 * `wouldCycleOnBlockedBy` satisfies the same signature for a host that has no
 * derived order to hand.
 *
 * REQUIRED, never defaulted. Cycle is the one finding that stops work outright,
 * so a host with no probe must not quietly receive three classes and read them
 * as four — that is the same absence-rendered-as-a-value this module exists to
 * refuse, arriving through its own front door. A required field is a compile
 * error at every call site instead.
 */
export type CycleProbe = (from: IssueRef, to: IssueRef) => boolean;

export interface AuditInput {
  readonly document: GraphDocument;
  /** See {@link CycleProbe}. Required. */
  readonly wouldCycle: CycleProbe;
  /**
   * Refs the reader refused, from the host's own parse. Absent means the host
   * has nothing to report, which is not the same claim as "every issue parsed"
   * — but it is the only claim a caller who omits it has made, so the class
   * simply yields no findings.
   */
  readonly encodingRefused?: readonly EncodingRefusal[] | undefined;
}

/** Whether the document holds this ref as a CLOSED issue. */
function closedRefs(document: GraphDocument): ReadonlySet<IssueRef> {
  const closed = new Set<IssueRef>();
  for (const issue of document.issues) {
    if (issue.state === 'closed') closed.add(issue.ref);
  }
  return closed;
}

/**
 * Minimal union-find over refs, for grouping the edges that lie on a cycle.
 *
 * Fifteen lines rather than a shared structure, on the precedent
 * `@issuegraph/derive` sets for exactly this: a rule is worth sharing because
 * it can drift, and a union-find cannot. What is shared here is the CYCLE
 * PREDICATE, which is the part that encodes §6.6.
 */
function componentsOf(pairs: readonly (readonly [IssueRef, IssueRef])[]): IssueRef[][] {
  const parent = new Map<IssueRef, IssueRef>();
  const find = (ref: IssueRef): IssueRef => {
    let root = ref;
    for (;;) {
      const next = parent.get(root);
      if (next === undefined || next === root) break;
      root = next;
    }
    let cursor = ref;
    for (;;) {
      const next = parent.get(cursor);
      if (next === undefined || next === root) break;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const add = (ref: IssueRef): void => {
    if (!parent.has(ref)) parent.set(ref, ref);
  };
  for (const [a, b] of pairs) {
    add(a);
    add(b);
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootA, rootB);
  }
  const members = new Map<IssueRef, IssueRef[]>();
  for (const ref of parent.keys()) {
    const root = find(ref);
    const existing = members.get(root);
    if (existing === undefined) members.set(root, [ref]);
    else existing.push(ref);
  }
  const groups = [...members.values()];
  for (const group of groups) group.sort();
  groups.sort((a, b) => compareMembers(a, b));
  return groups;
}

/** Lexicographic on the sorted member lists, so a finding list is stable. */
function compareMembers(a: readonly IssueRef[], b: readonly IssueRef[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const left = a[index] as IssueRef;
    const right = b[index] as IssueRef;
    if (left !== right) return left < right ? -1 : 1;
  }
  return a.length - b.length;
}

function finding(kind: AuditClass, members: readonly IssueRef[], detail: string): AuditFinding {
  const spec = AUDIT_CLASS_SPECS[kind];
  return Object.freeze({
    kind,
    severity: spec.severity,
    keepAsHistory: spec.keepAsHistory,
    // FROZEN, because `readonly` is a compile-time claim and a finding travels
    // to render sites this package does not compile. Every member list here is
    // built fresh, so nothing a caller passed in is frozen underneath them.
    members: Object.freeze(members),
    detail,
  });
}

function edgesOfKind(document: GraphDocument, kind: StoredEdge['kind']): readonly StoredEdge[] {
  return document.edges.filter((edge) => edge.kind === kind);
}

/**
 * Every `blocked-by` edge that lies on a cycle, grouped into the components
 * whose members can never be ready.
 *
 * AN EDGE IS ON A CYCLE EXACTLY WHEN THE PROBE SAYS SO, and that reads
 * backwards until you hold the probe's semantics: it asks whether `to` already
 * depends on `from`. For an edge that is ALREADY in the document, an answer of
 * yes means there is a path back — which, with this edge, closes the loop.
 *
 * TWO CYCLES SHARING A NODE REPORT AS ONE FINDING. That is the union, and it is
 * deliberate rather than a limitation of the grouping: the finding's claim is
 * that none of its members can ever be ready, and that claim is true of the
 * whole union. Splitting it would need a second walk to name the individual
 * loops, which is the walk this module does not own.
 */
function cycleFindings(document: GraphDocument, wouldCycle: CycleProbe): AuditFinding[] {
  const onCycle: (readonly [IssueRef, IssueRef])[] = [];
  for (const edge of edgesOfKind(document, 'blocked-by')) {
    if (wouldCycle(edge.from, edge.to)) onCycle.push([edge.from, edge.to]);
  }
  return componentsOf(onCycle).map((members) =>
    finding(
      'cycle',
      members,
      `${members.join(' · ')} form a blocked-by cycle; no member can ever become ready`,
    ),
  );
}

/**
 * A `blocked-by` whose target is closed.
 *
 * "LONG-closed" IS NOT AVAILABLE HERE and the shortfall is stated rather than
 * approximated: a document carries no timestamp, so how long ago a blocker
 * closed is not a fact this layer holds. Every closed blocker is reported
 * instead — the safe direction for a finding whose whole severity is
 * `misleading`, and the one a host can narrow with a date it does have.
 *
 * A TARGET THE DOCUMENT DOES NOT HOLD IS NOT REPORTED. It is unknown, not
 * closed, and reporting it would state as bookkeeping what is really a paging
 * boundary.
 */
function staleBlockerFindings(document: GraphDocument): AuditFinding[] {
  const closed = closedRefs(document);
  return edgesOfKind(document, 'blocked-by')
    .filter((edge) => closed.has(edge.to))
    .map((edge) =>
      finding(
        'stale-blocker',
        [edge.from, edge.to].sort(),
        `${edge.from} is blocked-by ${edge.to}, which is closed; readiness is already satisfied`,
      ),
    )
    .sort((a, b) => compareMembers(a.members, b.members));
}

/**
 * A `duplicate-of` whose canonical is closed.
 *
 * The dangerous one: §4.3.3 excludes a duplicate from the order entirely, so
 * with the canonical closed the work is tracked by nothing at all while the
 * backlog reads as though it were handled.
 */
function deadDuplicateFindings(document: GraphDocument): AuditFinding[] {
  const closed = closedRefs(document);
  return edgesOfKind(document, 'duplicate-of')
    .filter((edge) => closed.has(edge.to))
    .map((edge) =>
      finding(
        'dead-duplicate-ref',
        [edge.from, edge.to].sort(),
        `${edge.from} is duplicate-of ${edge.to}, which is closed; its work is excluded from the order and tracked nowhere`,
      ),
    )
    .sort((a, b) => compareMembers(a.members, b.members));
}

/**
 * The refusals the host reported.
 *
 * NOT FILTERED TO THE DOCUMENT. A refused declaration is a fact the host
 * asserted about an issue it read, and dropping the ones the document does not
 * carry would silently discard findings on exactly the issues a paging boundary
 * has not reached yet. The row overlay simply has no row to mark for those,
 * which is a presentation consequence rather than a reason to lose the finding.
 *
 * Deduplicated by ref, first occurrence winning — the model's own rule for a
 * repeated key, kept here so a host that reports one issue twice does not get
 * two identical findings.
 */
function encodingRefusedFindings(refusals: readonly EncodingRefusal[]): AuditFinding[] {
  const seen = new Set<IssueRef>();
  const findings: AuditFinding[] = [];
  for (const refusal of refusals) {
    if (seen.has(refusal.ref)) continue;
    seen.add(refusal.ref);
    const because =
      refusal.diagnostic === undefined || refusal.diagnostic === ''
        ? ''
        : `: ${refusal.diagnostic}`;
    findings.push(
      finding(
        'encoding-refused',
        [refusal.ref],
        `${refusal.ref} declares relationships the reader refused${because}; until it parses the issue has no edges`,
      ),
    );
  }
  return findings.sort((a, b) => compareMembers(a.members, b.members));
}

/**
 * Every finding in one document, in {@link AUDIT_CLASSES} order.
 *
 * Pure and total: it reads the document it was given, asks the probe, and
 * touches nothing else. A malformed or partial document yields fewer findings
 * rather than an exception — an audit that throws on the data it is auditing is
 * worse than one that reports what it can see.
 */
export function auditDocument(input: AuditInput): readonly AuditFinding[] {
  const { document, wouldCycle } = input;
  return Object.freeze([
    ...cycleFindings(document, wouldCycle),
    ...staleBlockerFindings(document),
    ...deadDuplicateFindings(document),
    ...encodingRefusedFindings(input.encodingRefused ?? []),
  ]);
}
