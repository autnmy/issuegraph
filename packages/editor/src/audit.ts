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
 * The two answers the audit needs from a reader, and does not compute.
 *
 * THE PORT, AND THE WHOLE REASON THIS MODULE WALKS NOTHING. Both fields come
 * straight off `buildModel(...)` in `@issuegraph/reader`: `cycles` is
 * `Model.cycles`, `duplicateCanonical` is `Model.duplicateCanonical`. A second
 * implementation of either here would be the mirror whose input space drifts,
 * and both would drift in specific, checkable ways rather than hypothetical
 * ones — see each field.
 *
 * IT IS THE READER'S ANSWER SPECIFICALLY, NOT `@issuegraph/derive`'s
 * `wouldCycleOnBlockedBy`, AND THAT DISTINCTION IS THE WHOLE POINT. That
 * function is a PRE-WRITE GUARD, and its documented divergences all lean the
 * fail-safe way for a write that is about to happen: it spans closed nodes, and
 * it does NOT exempt a together unit's internal `blocked-by` edges. Refusing
 * too much is the recoverable direction before a write — a human can decline
 * the refusal — and it is exactly the wrong direction for a statement about
 * what a backlog IS. §6.6 says so in as many words: internal edges *"stay
 * advisory... they would make every group carrying its own ordering read as
 * stuck"*. Interpreting the write guard as an edge-on-cycle test therefore
 * reports a `blocks-work` finding for every ordinary together group that
 * carries its own ordering.
 *
 * REQUIRED, never defaulted. Both classes that rest on this are the ones that
 * matter most — the finding that stops work, and the finding that hides work —
 * so a host with no reader must not quietly receive a thinner audit and read it
 * as a complete one. That is the same absence-rendered-as-a-value the fourth
 * class exists to refuse, arriving through this module's own front door.
 */
export interface AuditGraph {
  /**
   * `Model.cycles` — the `blocked-by` cycles among OPEN nodes (§6.6), each as
   * sorted keys, contracted over schedulable units with internal edges dropped.
   *
   * Every rule in that sentence is one this module would otherwise have to
   * restate, and §6.6 calls a reader that skips the contraction non-conforming.
   */
  readonly cycles: readonly (readonly IssueRef[])[];
  /**
   * `Model.duplicateCanonical` — the TRANSITIVE §4.3.3 canonical for a ref, or
   * `null` when the ref is already canonical.
   *
   * Transitive is the load-bearing word. With `a duplicate-of b`, `b
   * duplicate-of c` and `c` closed, the reader excludes BOTH `a` and `b` from
   * the order — so both are dead references, and a test against each edge's
   * immediate target sees only `b`, because `b` itself is open. The same
   * resolution applies to a `blocked-by` naming a duplicate, which §4.3.3 reads
   * as naming its canonical.
   */
  readonly duplicateCanonical: (ref: IssueRef) => IssueRef | null;
}

export interface AuditInput {
  readonly document: GraphDocument;
  /**
   * See {@link AuditGraph}. Required, and stated in the STORE's own ref
   * spelling — the host builds the model, so the host owns the translation
   * between a store reference (opaque, never parsed) and a model key
   * (normalised against a home repo, §4.2). That is the right side of the seam
   * for it: the host is the only party holding both.
   */
  readonly graph: AuditGraph;
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
 * The reader's stuck groups, one finding each.
 *
 * A PASS-THROUGH, AND DELIBERATELY SO. §6.6's answer already carries every rule
 * that makes it correct — open nodes only, contracted over schedulable units,
 * internal `blocked-by` edges dropped as advisory — and each of those is a rule
 * this module would otherwise restate and eventually disagree with. What is
 * left here is presentation: sorting, and the sentence.
 *
 * An empty group is skipped rather than drawn: a finding naming nobody would
 * add to the header count while giving a reader nothing to navigate to.
 */
function cycleFindings(graph: AuditGraph): AuditFinding[] {
  return graph.cycles
    .filter((members) => members.length > 0)
    .map((members) => [...members].sort())
    .sort((a, b) => compareMembers(a, b))
    .map((members) =>
      finding(
        'cycle',
        members,
        `${members.join(' · ')} form a blocked-by cycle; no member can ever become ready`,
      ),
    );
}

/**
 * A `blocked-by` whose EFFECTIVE target is closed.
 *
 * EFFECTIVE, because §4.3.3 makes an edge naming a duplicate name its canonical
 * instead — so a blocker that is itself a duplicate of a closed issue is a
 * stale blocker, and testing the immediate target alone misses it.
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
function staleBlockerFindings(document: GraphDocument, graph: AuditGraph): AuditFinding[] {
  const closed = closedRefs(document);
  const findings: AuditFinding[] = [];
  for (const edge of edgesOfKind(document, 'blocked-by')) {
    const effective = graph.duplicateCanonical(edge.to) ?? edge.to;
    if (!closed.has(effective)) continue;
    const via = effective === edge.to ? '' : ` (via ${edge.to}, which duplicates it)`;
    findings.push(
      finding(
        'stale-blocker',
        [edge.from, edge.to].sort(),
        `${edge.from} is blocked-by ${effective}${via}, which is closed; readiness is already satisfied`,
      ),
    );
  }
  return findings.sort((a, b) => compareMembers(a.members, b.members));
}

/**
 * A `duplicate-of` whose TRANSITIVE canonical is closed.
 *
 * The dangerous one: §4.3.3 excludes a duplicate from the order entirely, so
 * with the canonical closed the work is tracked by nothing at all while the
 * backlog reads as though it were handled.
 *
 * TRANSITIVE IS WHAT MAKES IT COMPLETE. In a chain — `a duplicate-of b`, `b
 * duplicate-of c`, `c` closed — the reader excludes both `a` and `b`, so both
 * references are dead. Testing each edge's immediate target reports `b` and
 * misses `a`, because `b` is open: the miss is silent, and it is a miss in the
 * one class whose whole point is work that looks handled and is not.
 *
 * The fallback to the immediate target covers a chain the model could not
 * resolve, where `duplicateCanonical` answers `null`. Reporting on what the
 * edge itself names is the fail-safe direction for a `dangerous` class.
 */
function deadDuplicateFindings(document: GraphDocument, graph: AuditGraph): AuditFinding[] {
  const closed = closedRefs(document);
  const findings: AuditFinding[] = [];
  for (const edge of edgesOfKind(document, 'duplicate-of')) {
    const canonical = graph.duplicateCanonical(edge.from) ?? edge.to;
    if (!closed.has(canonical)) continue;
    const via = canonical === edge.to ? '' : ` (through ${edge.to})`;
    findings.push(
      finding(
        'dead-duplicate-ref',
        [edge.from, edge.to].sort(),
        `${edge.from} is duplicate-of ${canonical}${via}, which is closed; its work is excluded from the order and tracked nowhere`,
      ),
    );
  }
  return findings.sort((a, b) => compareMembers(a.members, b.members));
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
  const { document, graph } = input;
  return Object.freeze([
    ...cycleFindings(graph),
    ...staleBlockerFindings(document, graph),
    ...deadDuplicateFindings(document, graph),
    ...encodingRefusedFindings(input.encodingRefused ?? []),
  ]);
}
