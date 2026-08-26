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
 *     encoding refused    its edges are incomplete, and it looks merely unencoded
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
export const AUDIT_CLASS_SPECS = Object.freeze({
  cycle: Object.freeze({ severity: 'blocks-work', weight: 3, keepAsHistory: false }),
  'dead-duplicate-ref': Object.freeze({ severity: 'dangerous', weight: 2, keepAsHistory: false }),
  'encoding-refused': Object.freeze({
    severity: 'blocks-own-edges',
    weight: 1,
    keepAsHistory: false,
  }),
  'stale-blocker': Object.freeze({ severity: 'misleading', weight: 0, keepAsHistory: true }),
} as const) satisfies Readonly<Record<AuditClass, AuditClassSpec>>;

/**
 * The same table, keyed so a lookup CANNOT answer with a prototype member.
 *
 * `AUDIT_CLASS_SPECS[kind]` on a plain object answers for `"__proto__"` and
 * `"constructor"` with something inherited rather than `undefined`, so an
 * invalid class survived the check below and produced a finding whose severity
 * was `undefined` — which the row grammar then stamped into an attribute. A
 * `Map` has no inherited keys, so the hazard is removed rather than guarded:
 * there is no own-key rule here for a later reader to forget.
 *
 * The record stays the export, because it is the readable declaration and a
 * consumer indexes it with a `kind` the type system has already checked.
 */
const SPEC_OF: ReadonlyMap<string, AuditClassSpec> = new Map(
  AUDIT_CLASSES.map((kind) => [kind, AUDIT_CLASS_SPECS[kind]]),
);

/** One finding. Severity travels ON it, never looked up at the render site. */
/**
 * One finding.
 *
 * `severity` and `keepAsHistory` are FIELDS, because the design asks for them
 * to be — *"severity is data on the finding, not a colour chosen at the render
 * site"* — but they are never a caller's to choose. {@link settledFinding}
 * derives both from `kind` on the way in, so the class table is the single
 * source and a finding whose severity disagrees with its class cannot survive
 * the boundary in either direction.
 *
 * WHY THE RULE IS RUNTIME RATHER THAN A TYPE. Tying the two fields to `kind`
 * through a mapped union does refuse the disagreement at compile time, and it
 * was written and measured: constructing one then needs either a cast — which
 * this repository's standards forbid outright — or a four-row builder table,
 * which is the enumeration whose second instance is what started this. Neither
 * pays for itself, because the compile-time version cannot reach the callers
 * that actually produce an inconsistent finding: JavaScript, and anything
 * deserialized from storage or a wire. The runtime rule covers those and the
 * TypeScript ones alike.
 */
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

/**
 * A finding with nothing left aliased to anyone else's object.
 *
 * BOTH LEVELS, AND THAT IS THE WHOLE POINT. `Object.freeze` is shallow, and
 * `readonly AuditFinding[]` accepts a MUTABLE array of MUTABLE objects — so
 * freezing the outer value leaves both the finding and its `members` writable
 * through the caller's own reference, and a later push changes what a consumer
 * already rendered. Fixing one level at a time just moves the aliasing down,
 * and `members` is the last level there is: every other field is a primitive.
 *
 * Exported so {@link ../surface.ts auditOverlay} normalizes what it is HANDED
 * by the same rule this module applies to what it BUILDS. Two spellings of
 * "settled" is how the two come to disagree.
 */
/**
 * Whether a value carries the fields {@link settledFinding} READS.
 *
 * A TYPE GUARD OVER `unknown`, AND THAT IS THE HONEST SIGNATURE. The values
 * this defends against are precisely the ones TypeScript never saw — a
 * JavaScript caller, or anything rebuilt from storage or a wire — so a
 * parameter claiming they are already `AuditFinding`s would assert a guarantee
 * the source cannot provide.
 *
 * IT IS EXHAUSTIVE OVER WHAT IS READ, WHICH IS THE POINT RATHER THAN A DETAIL.
 * Four rounds of review found this boundary malformed one field at a time — a
 * caller's array, a caller's `members`, a caller's disagreeing `severity`, a
 * prototype key in `kind` — and answering each in turn is an enumeration with
 * no end. So the rule is stated once, over the whole shape: `kind` must name a
 * class the table carries, `members` must be an array of strings, `detail` must
 * be a string. `severity` and `keepAsHistory` are absent from this list because
 * they are never read from the input at all — they are derived below — so there
 * is no malformed value of either that could reach anything.
 *
 * That closes the seam rather than narrowing it: every field of the interface
 * is either validated here or ignored by construction. Adding a READ field
 * without adding it here is the only way to reopen it.
 */
function isSettleable(value: unknown): value is AuditFinding {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: Record<string, unknown> = { ...value };
  if (typeof candidate['kind'] !== 'string' || !SPEC_OF.has(candidate['kind'])) return false;
  const members = candidate['members'];
  if (!Array.isArray(members) || members.some((member) => typeof member !== 'string')) return false;
  return typeof candidate['detail'] === 'string';
}

export function settledFinding(found: AuditFinding): AuditFinding | null {
  // ANSWERING `null` RATHER THAN THROWING is this module's own rule, that an
  // audit must not die on the data it is auditing — and the cost of getting it
  // wrong is the whole surface: one malformed persisted finding took the header
  // and every row with it, in the one component whose job is to report that
  // something is wrong.
  if (!isSettleable(found)) return null;
  const spec = SPEC_OF.get(found.kind);
  if (spec === undefined) return null;
  // DERIVED FROM `kind`, NEVER COPIED — which is what stops two render sites
  // classifying one finding differently: the row grammar already reads the
  // table, so a stored `severity` that disagreed with it was a second, editable
  // copy of a fact the table states.
  return Object.freeze({
    kind: found.kind,
    severity: spec.severity,
    keepAsHistory: spec.keepAsHistory,
    members: Object.freeze([...found.members]),
    detail: found.detail,
  });
}

function finding(kind: AuditClass, members: readonly IssueRef[], detail: string): AuditFinding {
  // Every call site passes a literal from `AUDIT_CLASSES`, so the table always
  // has it and `settledFinding` cannot answer null here. Reading it through the
  // same door anyway is what keeps ONE place that derives the class-owned
  // fields; a second construction path is how the two come to disagree.
  const spec = AUDIT_CLASS_SPECS[kind];
  const settled = settledFinding({
    kind,
    severity: spec.severity,
    keepAsHistory: spec.keepAsHistory,
    members,
    detail,
  });
  if (settled === null) throw new Error(`unreachable: ${kind} is not in the class table`);
  return settled;
}

function edgesOfKind(document: GraphDocument, kind: StoredEdge['kind']): readonly StoredEdge[] {
  return document.edges.filter((edge) => edge.kind === kind);
}

/**
 * One resolution of the document, shared by every class that asks about an
 * EDGE'S ENDS rather than about the graph as a whole.
 *
 * IT EXISTS BECAUSE THE ALTERNATIVE DID NOT CONVERGE. `stale-blocker` and
 * `dead-duplicate-ref` ask the same three questions of an edge — is the
 * declarer live, does the target resolve somewhere closed, and is that answer
 * knowable — and while each detector asked them for itself, successive review
 * rounds found one detector missing one question at a time: the closed-subject
 * test in one, then the under-read test in the other. Two detectors times three
 * rules is six places to be right, and the ones nobody had written yet were
 * worse. Asking once, here, makes a fifth class inherit all three instead of
 * being reviewed into them.
 */
interface EdgeVerdict {
  /**
   * The issue the target's work ultimately defers to (§4.3.3), which is the
   * one whose state the finding is really about.
   */
  readonly effective: IssueRef;
  /** Provably closed. An issue the document does not carry is UNKNOWN, not closed. */
  readonly effectiveClosed: boolean;
  /**
   * Whether anything about this edge is settled at all.
   *
   * FALSE WHENEVER EITHER END'S DECLARATION WAS REFUSED, and that is the rule
   * both classes kept being found without. A declaration nobody could read may
   * carry a `duplicate-of` redirecting the chain at an OPEN canonical — so a
   * closed, under-read target is not a discharged blocker, and a duplicate
   * resolving to one is not work tracked nowhere. Until it parses, nobody
   * knows, and an audit that guesses in either direction is worse than one that
   * says nothing.
   */
  readonly knowable: boolean;
  /**
   * Whether a finding about the DECLARER describes a live problem.
   *
   * Two of the four classes name a harm that needs an open subject: a dead
   * duplicate ref claims work is *"tracked nowhere"*, and a stale blocker
   * claims readiness is satisfied. On a closed declarer both report the
   * ordinary end of a lifecycle as a defect, for ever.
   */
  readonly declarerLive: boolean;
}

/**
 * The two classes that read this ask about an edge; the other two do not, and
 * deliberately keep none of it. §6.6 already restricts cycles to open nodes,
 * and an encoding refusal is a fact about a DECLARATION — which the model reads
 * from closed nodes too, so a closed issue's unreadable `duplicate-of` still
 * misroutes live edges.
 */
function verdictFor(
  edge: StoredEdge,
  closed: ReadonlySet<IssueRef>,
  refused: ReadonlySet<IssueRef>,
  graph: AuditGraph,
  // WHICH END'S CANONICAL DECIDES THE ANSWER. A stale blocker asks where the
  // TARGET's work went; a dead duplicate ref asks where the DECLARER's did.
  resolveFrom: 'from' | 'to',
): EdgeVerdict {
  const subject = resolveFrom === 'from' ? edge.from : edge.to;
  const effective = graph.duplicateCanonical(subject) ?? edge.to;
  return {
    effective,
    effectiveClosed: closed.has(effective),
    // THE TARGET SIDE ONLY, and the scope is load-bearing rather than
    // incidental. What a refusal costs is knowledge of where the edge POINTS:
    // the unreadable declaration is the one that might have redirected the
    // chain. The DECLARER's own refusal says nothing about whether the issue on
    // the other end is closed, so suppressing on it would hide a true finding —
    // measured, by this package's own all-four-classes fixture, which went to
    // three the moment that leg was added.
    knowable: !refused.has(edge.to) && !refused.has(effective),
    declarerLive: !closed.has(edge.from),
  };
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
function staleBlockerFindings(
  document: GraphDocument,
  graph: AuditGraph,
  refused: ReadonlySet<IssueRef>,
): AuditFinding[] {
  const closed = closedRefs(document);
  const findings: AuditFinding[] = [];
  for (const edge of edgesOfKind(document, 'blocked-by')) {
    const verdict = verdictFor(edge, closed, refused, graph, 'to');
    if (!verdict.declarerLive || !verdict.knowable || !verdict.effectiveClosed) continue;
    const effective = verdict.effective;
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
function deadDuplicateFindings(
  document: GraphDocument,
  graph: AuditGraph,
  refused: ReadonlySet<IssueRef>,
): AuditFinding[] {
  const closed = closedRefs(document);
  const findings: AuditFinding[] = [];
  for (const edge of edgesOfKind(document, 'duplicate-of')) {
    const verdict = verdictFor(edge, closed, refused, graph, 'from');
    if (!verdict.declarerLive || !verdict.knowable || !verdict.effectiveClosed) continue;
    const canonical = verdict.effective;
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
        `${refusal.ref} declares relationships the reader refused${because}; the edges it declares are incomplete and cannot be trusted until it parses`,
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
  const refusals = input.encodingRefused ?? [];
  const refused = new Set(refusals.map((refusal) => refusal.ref));
  return Object.freeze([
    ...cycleFindings(graph),
    ...staleBlockerFindings(document, graph, refused),
    ...deadDuplicateFindings(document, graph, refused),
    ...encodingRefusedFindings(refusals),
  ]);
}
