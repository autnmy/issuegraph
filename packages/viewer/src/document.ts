/**
 * The viewer's input: one normalised document, and nothing else.
 *
 * THIS IS A PLAIN, JSON-SAFE SHAPE ON PURPOSE. `@issuegraph/derive` describes
 * its own return value as "an in-process value, not a payload" — it carries a
 * live closure and two `Map`s, so it cannot cross a serialization boundary. A
 * viewer that took it directly would be unusable from a server-rendered host, a
 * worker, or anything that receives its data over a wire, and it would couple
 * the innermost rendering layer to a package it is not allowed to need.
 *
 * So the shape here is a PROJECTION of that value rather than the value: a host
 * that uses `deriveIssueOrder` maps it across in a few lines, and a host that
 * ranks its backlog some other way supplies the same fields from its own
 * source. The viewer derives no order, resolves no reference, and reads no
 * tracker — everything it draws was given to it.
 *
 * `normalizeDocument` is the one entry point. It never throws on a document of
 * the declared shape: a document assembled by hand is untrusted input, not a
 * contract, and a renderer that dies on a dangling edge is worse than one that
 * draws what it can and says what it dropped. A MISSING FIELD IS OUTSIDE THAT
 * PROMISE — `order` absent has always thrown, and `cycles` absent throws the
 * same way — because a document without one is a type error, not a document.
 */

import {
  EDGE_CARDINALITY,
  type EdgeField,
  isEdgeField,
  isSymmetricEdgeField,
} from '@issuegraph/core';

/**
 * How an issue's rank came about, in the three forms the format and a host's
 * own configuration can produce. The viewer FORMATS provenance; it never
 * decides it — which is why every arm carries its own text rather than a code
 * the viewer would have to interpret.
 */
export type RankProvenance =
  /** A host ordering query matched this issue. `label` is the query as written. */
  | { readonly kind: 'matched-query'; readonly index: number; readonly label: string }
  /** No query matched; the issue sits in its declared priority tier. */
  | { readonly kind: 'declared-tier'; readonly priority: number }
  /**
   * Effective priority promoted it. `notation` is the spec's own `P3 -> 0`
   * form and `promotedBy` names the open dependents the urgency arrived
   * through — both supplied, because the viewer cannot recompute either.
   */
  | {
      readonly kind: 'promotion';
      readonly notation: string;
      readonly promotedBy: readonly string[];
    };

/** Where a hold came from. The two families never share a treatment. */
export type HoldFamily =
  /**
   * The graph itself holds it — a `blocked-by` that is still open, or a
   * serialize component someone else is in. These render INLINE at the rank
   * the work would have taken, because "why isn't my P1 running" has to be
   * answerable in place.
   */
  | 'graph'
  /**
   * The runner or the tracker holds it — claimed, parked, an external gate.
   * These are not facts about the work, so they earn no rank slot and collapse
   * into a footer group.
   */
  | 'tracker';

/** What every hold carries, whichever family imposed it. */
interface HoldBase {
  /** Human-readable, host-authored. The viewer renders it verbatim. */
  readonly reason: string;
  /**
   * The machine-readable cause, host-authored like `reason`. A host fed by
   * `@issuegraph/reader` supplies its `ReadinessHold.code`; the viewer
   * publishes whatever it is given as `data-code` and interprets none of it,
   * because the vocabulary is the reader's and this layer restates nothing.
   * OPTIONAL BY DESIGN: a hold the tracker or runner imposes has no reader
   * code, and inventing one would be a second vocabulary.
   */
  readonly code?: string | undefined;
  /**
   * The issue the cause names — the open blocker, the claimed peer, the unready
   * member — when it names one, as the document's own key for it. Published as
   * `data-subject` so a host can turn the sentence into a link or a filter
   * facet; the viewer draws it as text and links nothing (it has no URL shape
   * to link with — see `ViewerIssue.url`).
   */
  readonly subject?: string | undefined;
}

/** A hold the graph itself imposes. Drawn inline at the rank the work would have taken. */
export interface GraphHold extends HoldBase {
  readonly family: 'graph';
}

/**
 * A hold the runner or the tracker imposes. Drawn in the footer, with no rank.
 *
 * THE ONE ARM THAT CARRIES A LABEL, and the reason the hold is a union rather
 * than one interface with a family string: the design's footer names each
 * runner hold by ONE WORD — `claimed`, `parked` — beside the sentence, and a
 * graph hold has no such word (its family is the whole of what it is). Putting
 * `label` on both arms would let a document label a graph hold, which nothing
 * draws; narrowing it here makes that a type error rather than a silent drop.
 * OPTIONAL, because a host that supplied `{ family: 'tracker', reason }` before
 * this field existed still does, and still type-checks.
 */
export interface TrackerHold extends HoldBase {
  readonly family: 'tracker';
  /** The runner's own word for the hold — `claimed`, `parked`. Rendered as a chip before `reason`. */
  readonly label?: string | undefined;
}

/**
 * One reason a slot is held, and which family it belongs to. A discriminated
 * union on `family`, so the two families are told apart by the type system
 * and not by a string a call site happens to compare.
 */
export type ViewerHold = GraphHold | TrackerHold;

/**
 * A pick-order query the host's engine could not evaluate locally, so the row
 * was ranked some other way. The host says how; the viewer prints the note
 * under a `◐ preview-only` badge and interprets nothing.
 */
export interface PreviewOnly {
  readonly note: string;
}

/**
 * Two ordering signals that disagree about this issue — a mapped label and a
 * frontmatter `priority`, say. WHICH ONE WINS IS THE HOST'S DECISION (the
 * design is explicit that precedence is an owner call, not a default), so the
 * host names the signal it ranked by and the one it set aside; the viewer
 * prints both and strikes only the losing value, so the loser stays legible.
 */
export interface Disagreement {
  /** The signal the rank came from, as the host spells it: `label:P1 (your mapping)`. */
  readonly used: string;
  readonly ignored: {
    /** Who declared the losing value: `frontmatter`. */
    readonly carrier: string;
    /** The losing value itself, struck through: `priority: 3`. */
    readonly value: string;
  };
}

/** One issue the document knows about. */
export interface ViewerIssue {
  /** The model's node key: `"12"`, or `"owner/repo#12"` when qualified. */
  readonly key: string;
  /** Rendered as the row's leading text. Escaped at render; never parsed. */
  readonly title: string;
  /**
   * The deep-link target for the `owner/repo#N` chip. OPTIONAL BY DESIGN: the
   * viewer renders no link it was not given, because inventing one means
   * knowing a tracker's URL shape, which is precisely the knowledge this layer
   * must not carry.
   */
  readonly url?: string | undefined;
  readonly open: boolean;
  /** Declared priority, as the host resolved it. */
  readonly priority: number;
  /** Absent when the host has no provenance to state. */
  readonly provenance?: RankProvenance | undefined;
  /** Set when the host's engine ranked this row by a fallback. Absent means the query evaluated. */
  readonly previewOnly?: PreviewOnly | undefined;
  /** Set when two host signals disagreed about this row. Absent means they agreed, or there was one. */
  readonly disagreement?: Disagreement | undefined;
  /**
   * The block's `evidence` field, when the host read one.
   *
   * ABSENT READS `asserted`, which §16d states in those words — so the type is
   * optional rather than defaulted, and the row draws a chip only for
   * `verified`. A panel that printed "asserted" on every row would spend a chip
   * slot saying nothing, and defaulting the value here would make an absent
   * field indistinguishable from a stated one.
   */
  readonly evidence?: 'asserted' | 'verified' | undefined;
}

/** One relationship, exactly as the format declares it. */
export interface ViewerEdge {
  readonly field: EdgeField;
  readonly from: string;
  readonly to: string;
}

/**
 * One position in the order. A together unit is ONE slot with several members,
 * not one slot per member — the same rule `@issuegraph/derive` applies, carried
 * across so the two cannot disagree about what a position is.
 */
export interface ViewerSlot {
  /**
   * The 1-based rank, or `null` when the slot is held. A held slot renders `—`
   * rather than a number: it has no position in the sequence, and printing one
   * would claim work is queued that nothing can start.
   */
  readonly rank: number | null;
  /** The member that placed the slot — the detail surface's subject. */
  readonly lead: string;
  /** Every member, in the order the host supplied. */
  readonly members: readonly string[];
  readonly ready: boolean;
  /** Empty when ready. Each entry names one failed readiness condition. */
  readonly holds: readonly ViewerHold[];
  /**
   * The rank this slot becomes ready after, when the host knows it. Drives the
   * hollow readiness station; `null` renders a filled one when ready and a
   * dashed one when held.
   */
  readonly readyAfterRank?: number | null | undefined;
}

/** An issue the order deliberately never works. */
export interface ViewerExclusion {
  readonly key: string;
  /** The issue this one defers to. */
  readonly canonical: string;
  readonly reason: 'duplicate-of';
}

/** The order, as the host derived it. */
export interface ViewerOrder {
  /**
   * Every slot in derivation order. A HELD slot keeps its position — it is
   * never moved to the end — so its rank column reads `—` exactly where the
   * work would have sat.
   */
  readonly slots: readonly ViewerSlot[];
  readonly excluded: readonly ViewerExclusion[];
}

/**
 * One `blocked-by` cycle, as the host's reader found it: every member key, in
 * whatever order the host supplied. A cycle of one is a self-loop.
 *
 * ONCE NORMALISED IT IS THE MEMBERS THIS DOCUMENT CARRIES, which need not be
 * a closed ring: a document that is a slice of the graph — a window, a focus
 * — keeps the members it draws and drops the rest, exactly as it does for the
 * edges. A cycle is still a stuck group, and a member of one is still stuck.
 */
export type ViewerCycle = readonly string[];

/**
 * The host's tally over the WHOLE order — every number a non-negative integer.
 *
 * SUPPLIED, NEVER COUNTED HERE, and the reason is the same one that keeps the
 * order itself an input: the document this layer holds may be a window (the
 * editor's rail slices the slots) or a slice (a host showing the next
 * twenty-five). A count over those slots would state the reader's scroll
 * position as a fact about the order. The host has the whole order; it counts.
 */
export interface OrderCounts {
  /** Slots that hold a rank. */
  readonly ranked: number;
  /** Slots that may start now — the number the design compares to the cap. */
  readonly readyNow: number;
  /** Slots held, by either family. */
  readonly held: number;
}

/** The job the host's runner is working right now. Every string is the host's. */
export interface RunningJob {
  /** The document's key for the issue being worked. Must be an issue this document carries. */
  readonly key: string;
  /** The runner's phase word: `Review`. */
  readonly phase: string;
  /** How long it has run, as the host formats it: `12m`. */
  readonly elapsed: string;
}

/**
 * How fresh the host's mirror is. The viewer has no clock, so every value here
 * is the host's text, formatted by the host.
 */
export interface Freshness {
  /** The stamp: `14:32`. Empty drops the whole freshness fact with a diagnostic. */
  readonly asOf: string;
  /** Relative age, when the host states it: `2m ago`. */
  readonly age?: string | undefined;
  /** Past the host's threshold. Renders the word `stale` and `data-stale="true"`. */
  readonly stale?: boolean | undefined;
  /**
   * The label of a refresh control. WHEN PRESENT, AND ONLY THEN, the viewer
   * renders a button carrying `data-ig-command="refresh"` and wires nothing to
   * it — refreshing is the host's, so the host listens for the command.
   */
  readonly refresh?: string | undefined;
}

/**
 * THE HOST-FACTS PORT: the half of the design the graph cannot derive.
 *
 * The format excludes run state on purpose (SPEC §2, §6.8), so who is working
 * what, how many may run at once, and how fresh the mirror is are facts only
 * the host holds. Every field is optional, and a host that supplies none of
 * them renders exactly the pure-graph view — pinned by test. Nothing here is a
 * viewer constant: no cap, no clock, no repository name.
 */
export interface HostFacts {
  /** How many ready slots may run at once. A non-negative integer. */
  readonly concurrencyCap?: number | undefined;
  readonly counts?: OrderCounts | undefined;
  readonly running?: readonly RunningJob[] | undefined;
  readonly freshness?: Freshness | undefined;
}

/** Everything the viewer draws. */
export interface ViewerDocument {
  readonly issues: readonly ViewerIssue[];
  readonly edges: readonly ViewerEdge[];
  readonly order: ViewerOrder;
  /**
   * The `blocked-by` cycles the document contains, AS THE HOST DERIVED THEM.
   * A host fed by `@issuegraph/reader` passes `Model.cycles` verbatim — the
   * spec's §6.6 stuck groups; a hand-assembled document passes `[]`.
   *
   * REQUIRED, LIKE `order`, AND FOR THE SAME REASON: the viewer derives no
   * cycle, as it derives no order — the edges here are the ones it can draw,
   * not the graph, so a walk over them is a mirror whose input space drifts
   * (see `clusters.ts`). And a badge that is simply absent reads as "no
   * cycle", so an answer a host forgot to pass must not render as one: `[]`
   * says none, and omission is a type error.
   */
  readonly cycles: readonly ViewerCycle[];
  /**
   * What the host knows and the graph does not. OPTIONAL, unlike `order` and
   * `cycles`, because absence here is a complete answer: a host with no runner
   * has no run state to state, and the pure-graph view is what it means.
   */
  readonly host?: HostFacts | undefined;
}

/** The host facts after normalisation: `running` always a list, the rest present only when the host stated them. */
export interface NormalizedHostFacts {
  readonly concurrencyCap?: number | undefined;
  readonly counts?: OrderCounts | undefined;
  readonly running: readonly RunningJob[];
  readonly freshness?: Freshness | undefined;
}

/**
 * A normalised document plus an index over it. The index exists so no
 * projection re-scans the issue list per row, and so every projection resolves
 * a key the same way.
 */
export interface NormalizedDocument {
  readonly issues: readonly ViewerIssue[];
  readonly edges: readonly ViewerEdge[];
  readonly order: ViewerOrder;
  /**
   * The host's cycles, narrowed to the keys this document carries. Every
   * member here is present in `byKey`; a cycle none of whose members are is
   * not here at all.
   */
  readonly cycles: readonly ViewerCycle[];
  /** Key -> issue. Every edge and slot member below is present here. */
  readonly byKey: ReadonlyMap<string, ViewerIssue>;
  /** Key -> the edges touching it, in document order. */
  readonly edgesOf: ReadonlyMap<string, readonly ViewerEdge[]>;
  /** Keys that appear in no slot and on no edge. */
  readonly isolated: readonly string[];
  /**
   * Key -> the `decomposed-from` origin it declares that this document does not
   * carry.
   *
   * KEPT RATHER THAN DROPPED WITH THE EDGE. The edge itself cannot be drawn —
   * a node outside the set has no bounds — but the tree projection has to be
   * able to say "this is a root because its origin is not here" instead of
   * "this is a root". An absence rendered as a value licenses a false
   * conclusion, and the false conclusion here is that an issue has no
   * provenance when in fact its provenance was not supplied.
   */
  readonly outOfSetOrigins: ReadonlyMap<string, string>;
  /** The host facts, validated. Always present; every field but `running` is present only when stated. */
  readonly host: NormalizedHostFacts;
}

export interface NormalizeResult {
  readonly document: NormalizedDocument;
  /**
   * What was dropped and why. A host surfaces these; the viewer does not draw
   * them, because a diagnostic is a fact about the DATA and this layer renders
   * the work order.
   */
  readonly diagnostics: readonly string[];
}

/**
 * The schemes a deep link may carry.
 *
 * A DOCUMENT IS UNTRUSTED INPUT — this module says so at the top, and a `url`
 * is the one field that becomes an executable surface when it reaches the DOM.
 * `javascript:` and `data:` hrefs run in the host's origin, so escaping the
 * attribute is not enough: the value has to be refused. An ALLOWLIST rather
 * than a denylist, because the scheme space is open and a miss here publishes
 * exactly the bug the check exists to stop.
 *
 * A relative URL is allowed: it cannot name a scheme, and a host embedding the
 * viewer under its own routes has a legitimate reason to pass one.
 */
const LINKABLE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

function isLinkable(url: string): boolean {
  // CANONICALIZE THE WAY A URL PARSER DOES, THEN READ THE SCHEME. Reading the
  // raw string is not enough: the URL parser REMOVES every ASCII tab, newline
  // and carriage return from ANYWHERE in the input before it reads anything,
  // and then strips leading C0 controls and spaces. So `java<TAB>script:alert(1)`
  // reaches the browser as `javascript:` while a raw scan finds no scheme at
  // all, reads the value as relative, and links it.
  //
  // The test therefore has to canonicalize first. Stripping only the leading
  // controls — which is what this did — left the whole embedded-control class
  // open, which is the same fail-open the allowlist exists to close.
  const canonical = url.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, '');
  // A scheme is `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"` (RFC 3986 3.1).
  // No match means the value is relative, which carries no scheme to abuse.
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(canonical);
  if (scheme === null) return true;
  return LINKABLE_SCHEMES.has(`${(scheme[1] as string).toLowerCase()}:`);
}

function indexIssues(
  issues: readonly ViewerIssue[],
  diagnostics: string[],
): { kept: ViewerIssue[]; byKey: Map<string, ViewerIssue> } {
  const byKey = new Map<string, ViewerIssue>();
  const kept: ViewerIssue[] = [];
  for (const issue of issues) {
    if (issue.key === '') {
      diagnostics.push('issue with an empty key dropped');
      continue;
    }
    if (byKey.has(issue.key)) {
      diagnostics.push(`duplicate issue key ${issue.key}: the first occurrence is kept`);
      continue;
    }
    let kept_issue = issue;
    if (issue.url !== undefined && issue.url !== '' && !isLinkable(issue.url)) {
      diagnostics.push(
        `${issue.key} declares a url whose scheme the viewer will not link; the deep link was dropped`,
      );
      const { url: _dropped, ...rest } = issue;
      kept_issue = rest;
    }
    byKey.set(issue.key, kept_issue);
    kept.push(kept_issue);
  }
  return { kept, byKey };
}

/**
 * An edge survives only when the format recognises its field AND both ends are
 * issues this document carries.
 *
 * DROPPING A DANGLING EDGE IS THE POINT, not a shortcut. Every projection
 * derives an endpoint from a node's computed bounds, and a node that does not
 * exist has none — so an edge kept here would either be drawn at coordinates
 * nobody computed or crash the layout. Dropping it and SAYING SO leaves the
 * absence visible to the host, which is the only party that can resolve it.
 */
function indexEdges(
  edges: readonly ViewerEdge[],
  byKey: ReadonlyMap<string, ViewerIssue>,
  slotOf: ReadonlyMap<string, string>,
  diagnostics: string[],
): {
  kept: ViewerEdge[];
  edgesOf: Map<string, ViewerEdge[]>;
  outOfSetOrigins: Map<string, string>;
} {
  const kept: ViewerEdge[] = [];
  const edgesOf = new Map<string, ViewerEdge[]>();
  const outOfSetOrigins = new Map<string, string>();
  // SINGLE-CARDINALITY IS ASKED OF THE FORMAT, NOT LISTED HERE. `EDGE_CARDINALITY`
  // names four single-reference fields and this guard used to enforce exactly
  // one of them, so a document declaring two `duplicate-of` (or `serialize-with`,
  // or `together-with`) edges from one issue kept both: two badges for one
  // relationship and two graph paths, where the format promises one fact and
  // this reader promises a diagnostic. Reading the constant means the fifth
  // single field, whenever the spec adds one, is covered the day it lands.
  // THE RULE BELONGS HERE, where the edges are read — not later, per projection.
  // A second origin that resolved while the first did not left the tree nesting
  // an issue under one parent while printing that it came from another, with
  // neither the diagnostic nor the first-origin rule the projection promises.
  // First declared wins, whether or not it resolves.
  // KEYED ON (from, field), WHICH IS WHAT MAKES IT SAFE FOR THE SYMMETRIC FIELDS.
  // `A together-with B` and `B together-with A` are one undirected fact written
  // the way the format asks, and each endpoint declared ONCE — so keying on the
  // endpoint PAIR would reject the reverse declaration as a repeat, and keying on
  // the target would reject a legitimate three-member group in which B and C both
  // point at A. Each issue gets one declaration; who points at it is not its
  // budget to spend.
  const claimed = new Set<string>();
  // Every edge's identity, symmetric or directed — see the branch below for what
  // each key collapses.
  const edgeSeen = new Set<string>();
  for (const edge of edges) {
    if (!isEdgeField(edge.field)) {
      diagnostics.push(`edge ${edge.from} -> ${edge.to} names an unknown field and was dropped`);
      continue;
    }
    // BEFORE THE SYMMETRIC DEDUPE BELOW, AND THAT ORDER IS THE CORRECTNESS. The
    // dedupe drops a symmetric edge's reverse declaration as a repeat of one
    // fact — so counted after it, `B together-with A` would spend nothing, and a
    // `B together-with C` arriving later would read as B's first declaration
    // when it is really its second. Counting first means every declaration an
    // author WROTE is counted, whatever the reader later collapses or drops.
    if (EDGE_CARDINALITY[edge.field] === 'single') {
      const claim = `${edge.field}\u0000${edge.from}`;
      if (claimed.has(claim)) {
        diagnostics.push(
          `${edge.from} declares more than one ${edge.field}; the format allows one, so only the first is kept and ${edge.to} was dropped`,
        );
        continue;
      }
      claimed.add(claim);
    }
    const missing = !byKey.has(edge.from) ? edge.from : !byKey.has(edge.to) ? edge.to : null;
    if (missing !== null) {
      // The edge cannot be drawn, but a missing PROVENANCE origin is worth
      // remembering: the tree projection has to distinguish "no origin" from
      // "an origin this document was not given".
      if (edge.field === 'decomposed-from' && missing === edge.to && byKey.has(edge.from)) {
        if (!outOfSetOrigins.has(edge.from)) outOfSetOrigins.set(edge.from, edge.to);
      }
      diagnostics.push(
        `${edge.field} edge ${edge.from} -> ${edge.to} names ${missing}, which this document does not carry, and was dropped`,
      );
      continue;
    }
    if (edge.from === edge.to) {
      diagnostics.push(`${edge.field} self-edge on ${edge.from} was dropped`);
      continue;
    }
    // A `together-with` THE ORDER DOES NOT GROUP CANNOT BE DRAWN AT ALL. It is
    // rendered as an enclosure around one slot's members rather than as an arc,
    // and the enclosures come from the slot table — so an edge whose endpoints
    // sit in different slots, or in none, produced no mark anywhere while still
    // counting toward the relationship total the legend reports. Measured: a
    // document with one such edge said "2 relationships" and drew one.
    // DROPPED AND REPORTED RATHER THAN DRAWN SOME OTHER WAY. The alternative is a
    // fallback connector, which invents a second visual form for one relationship
    // and leaves the reader to reconcile them. The input is inconsistent — an
    // author declared a grouping the order does not carry — and saying so is what
    // this reader does with every other undrawable edge above.
    // THE COUNT IS WHY IT MATTERS: it is taken from the kept edges, so dropping
    // here makes the total the legend prints match what the canvas contains.
    if (edge.field === 'together-with') {
      const home = slotOf.get(edge.from);
      if (home === undefined || home !== slotOf.get(edge.to)) {
        diagnostics.push(
          `together-with edge ${edge.from} -> ${edge.to} is not carried by any one order slot, so nothing could draw it, and it was dropped`,
        );
        continue;
      }
    }
    // A SYMMETRIC FIELD IS ONE UNDIRECTED FACT, so both endpoints declaring it
    // is the NORMAL way to write it down, not a malformed document — and the
    // reader that keeps both renders the one relationship twice: two badges,
    // two paths, and a component edge count nobody can reconcile with what is
    // drawn. Canonicalizing the pair collapses the reverse declaration AND a
    // repeat of the same direction, because the identity of an undirected edge
    // is its endpoint SET.
    // NO DIAGNOSTIC. Unlike the drops above, nothing here is wrong with the
    // document: `A serialize-with B` plus `B serialize-with A` is exactly what
    // the format asks an author to write, so reporting it would train readers
    // to ignore the diagnostics that do mean something.
    // ONE FACT IS DRAWN ONCE, WHICHEVER DIRECTION THE FIELD HAS. The symmetric
    // arm canonicalizes the endpoint PAIR, because `A serialize-with B` and
    // `B serialize-with A` are one undirected fact. A DIRECTED field has no such
    // equivalence — `A blocked-by B` and `B blocked-by A` are two different
    // claims — but an EXACT repeat of one of them is still one relationship
    // written twice, and this reader kept both: two identical paths, two badges,
    // and a blocking count in the refusal summary inflated past what the canvas
    // contains. Measured: `A blocked-by B` listed twice survived as two edges.
    // THE KEY IS WHAT DIFFERS, not the rule. Symmetric collapses the reverse;
    // directed keeps it and collapses only the exact triple — so the distinct
    // `B -> A` edge is preserved, which is the half that must not be lost.
    // NO DIAGNOSTIC, for the reason the symmetric arm already gives: a repeat is
    // the format's normal redundancy rather than a malformed document, and
    // reporting it would train readers to ignore the drops that do mean
    // something.
    const identity = isSymmetricEdgeField(edge.field)
      ? edge.from < edge.to
        ? `${edge.field}\u0000${edge.from}\u0000${edge.to}`
        : `${edge.field}\u0000${edge.to}\u0000${edge.from}`
      : `${edge.field}\u0000${edge.from}\u0000${edge.to}`;
    if (edgeSeen.has(identity)) continue;
    edgeSeen.add(identity);
    kept.push(edge);
    for (const end of [edge.from, edge.to]) {
      const existing = edgesOf.get(end);
      if (existing === undefined) edgesOf.set(end, [edge]);
      else existing.push(edge);
    }
  }
  return { kept, edgesOf, outOfSetOrigins };
}

/**
 * A slot survives only when at least one member is an issue the document
 * carries; unknown members are dropped from it, with a diagnostic each.
 */
function normalizeSlots(
  slots: readonly ViewerSlot[],
  byKey: ReadonlyMap<string, ViewerIssue>,
  diagnostics: string[],
): { kept: ViewerSlot[]; placed: Set<string> } {
  const kept: ViewerSlot[] = [];
  // ONE ISSUE HOLDS ONE PLACE IN THE ORDER. A hand-built document can name the
  // same issue in two slots, and keeping both publishes the key twice: two rows
  // render `tabindex="0"` for one focused key, while `indexOf` and the mount
  // index can only ever address the first — so roving focus breaks and the
  // later row is unreachable. The first placement wins, as everywhere else here.
  const placed = new Set<string>();
  for (const slot of slots) {
    const members = slot.members.filter((member) => {
      if (!byKey.has(member)) {
        diagnostics.push(`slot member ${member} is not an issue in this document and was dropped`);
        return false;
      }
      if (placed.has(member)) {
        diagnostics.push(`${member} is already placed in an earlier slot; the later placement was dropped`);
        return false;
      }
      placed.add(member);
      return true;
    });
    if (members.length === 0) {
      diagnostics.push(`slot led by ${slot.lead} has no known member and was dropped`);
      continue;
    }
    const lead = members.includes(slot.lead) ? slot.lead : (members[0] as string);
    if (lead !== slot.lead) {
      diagnostics.push(`slot lead ${slot.lead} is not among its members; ${lead} leads instead`);
    }
    kept.push(Object.freeze({ ...slot, lead, members: Object.freeze(members) }));
  }
  return { kept, placed };
}

/**
 * A cycle survives with the members this document carries; an unknown member
 * is dropped from it with a diagnostic, and a cycle left with no member is
 * dropped whole. The host's ORDER of members is kept — it is the reader's own
 * sorted order, and re-sorting it here would be a second opinion about a
 * value this layer only relays.
 *
 * NOT VALIDATED AGAINST THE EDGES. The host's reader saw the whole graph; this
 * document may carry a slice of it, so a cycle whose closing edge is absent
 * here is still a cycle the reader found, and refusing it would make the badge
 * depend on which edges the host chose to draw — the drift the field exists to
 * remove.
 */
function normalizeCycles(
  cycles: readonly ViewerCycle[],
  byKey: ReadonlyMap<string, ViewerIssue>,
  diagnostics: string[],
): ViewerCycle[] {
  const kept: ViewerCycle[] = [];
  cycles.forEach((cycle, index) => {
    // AN EMPTY CYCLE IS THE HOST'S MISTAKE, NOT THIS DOCUMENT'S. The reader never
    // emits one — a stuck group has at least one member — so it is reported as
    // what it is rather than as a slice that happened to carry none of it.
    if (cycle.length === 0) {
      diagnostics.push(`cycle at index ${String(index)} is empty and was dropped`);
      return;
    }
    // A MEMBER IS NAMED ONCE PER CYCLE, and the dedupe runs BEFORE the carry
    // test so a repeated unknown key is reported once. A hand-built cycle can
    // repeat a key, and the count `clustersOf` derives from it would then read
    // one issue as two. First occurrence wins, as everywhere else in this reader.
    const seen = new Set<string>();
    const members = cycle.filter((member) => {
      if (seen.has(member)) {
        diagnostics.push(`cycle member ${member} is named twice in one cycle; the repeat was dropped`);
        return false;
      }
      seen.add(member);
      if (byKey.has(member)) return true;
      diagnostics.push(
        `cycle member ${member} is not an issue in this document and was dropped from the cycle`,
      );
      return false;
    });
    if (members.length === 0) {
      diagnostics.push(`cycle at index ${String(index)} names no issue in this document and was dropped`);
      return;
    }
    kept.push(Object.freeze(members));
  });
  return kept;
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * The host facts, validated the way every other input is: a value the viewer
 * cannot draw is dropped and said so, never thrown on and never rendered as a
 * value it is not.
 *
 * A RUNNING KEY MUST BE AN ISSUE THIS DOCUMENT CARRIES, because the NOW row is
 * built from that issue's title and identity — a key with no issue has no row
 * to draw. `counts` drops WHOLE when one member is bad: a tally with one of its
 * numbers missing would print a sentence that adds up to nothing.
 */
function normalizeHost(
  host: HostFacts | undefined,
  byKey: ReadonlyMap<string, ViewerIssue>,
  diagnostics: string[],
): NormalizedHostFacts {
  const running: RunningJob[] = [];
  const seen = new Set<string>();
  for (const job of host?.running ?? []) {
    if (!byKey.has(job.key)) {
      diagnostics.push(`running job names ${job.key}, which this document does not carry, and was dropped`);
      continue;
    }
    if (seen.has(job.key)) {
      diagnostics.push(`running job names ${job.key} twice; the repeat was dropped`);
      continue;
    }
    seen.add(job.key);
    running.push(Object.freeze({ ...job }));
  }

  let concurrencyCap: number | undefined;
  if (host?.concurrencyCap !== undefined) {
    if (isCount(host.concurrencyCap)) concurrencyCap = host.concurrencyCap;
    else diagnostics.push(`concurrency cap ${String(host.concurrencyCap)} is not a non-negative integer and was dropped`);
  }

  let counts: OrderCounts | undefined;
  if (host?.counts !== undefined) {
    const { ranked, readyNow, held } = host.counts;
    if (isCount(ranked) && isCount(readyNow) && isCount(held)) counts = Object.freeze({ ranked, readyNow, held });
    else diagnostics.push('order counts carry a value that is not a non-negative integer and were dropped whole');
  }

  let freshness: Freshness | undefined;
  if (host?.freshness !== undefined) {
    if (host.freshness.asOf.trim() === '') diagnostics.push('freshness has an empty asOf stamp and was dropped whole');
    else freshness = Object.freeze({ ...host.freshness });
  }

  return Object.freeze({
    ...(concurrencyCap === undefined ? {} : { concurrencyCap }),
    ...(counts === undefined ? {} : { counts }),
    running: Object.freeze(running),
    ...(freshness === undefined ? {} : { freshness }),
  });
}

/**
 * Read a document into the shape every projection consumes.
 *
 * Deterministic and total over the declared shape: the same input always
 * produces the same output, and no document produces a throw. Call it once per
 * render and pass the result down.
 */
export function normalizeDocument(input: ViewerDocument): NormalizeResult {
  const diagnostics: string[] = [];
  const { kept: issues, byKey } = indexIssues(input.issues, diagnostics);
  // SLOTS BEFORE EDGES, because one edge rule needs to know them. `together-with`
  // is drawn as an ENCLOSURE around a slot's members rather than as an arc, so an
  // edge whose endpoints are not in one slot has nothing to draw it — and
  // `indexEdges` is where an undrawable edge is dropped and reported. Nothing in
  // `normalizeSlots` reads the edges, so the two are free to swap.
  const { kept: slots, placed } = normalizeSlots(input.order.slots, byKey, diagnostics);
  // WHICH SLOT OWNS EACH KEY, which is the whole question the rule asks.
  const slotOf = new Map<string, string>();
  for (const slot of slots) for (const member of slot.members) slotOf.set(member, slot.lead);
  const { kept: edges, edgesOf, outOfSetOrigins } = indexEdges(input.edges, byKey, slotOf, diagnostics);

  // AN EXCLUSION IS A POSITION TOO. The rule is one issue, one position — and
  // it has to cover this field as well as the slots, because the projections
  // publish both into one focus order. A key in a slot AND in `excluded`, or
  // twice in `excluded`, rendered two keyed rows: `ArrowDown` from the first
  // resolved to the same key and returned `none`, so nothing after it was
  // reachable.
  const excluded = input.order.excluded.filter((exclusion) => {
    if (!byKey.has(exclusion.key)) {
      diagnostics.push(`excluded ${exclusion.key} is not an issue in this document and was dropped`);
      return false;
    }
    if (placed.has(exclusion.key)) {
      diagnostics.push(`${exclusion.key} already holds a position in the order; the exclusion was dropped`);
      return false;
    }
    placed.add(exclusion.key);
    return true;
  });

  const host = normalizeHost(input.host, byKey, diagnostics);
  // A RUNNING ISSUE IS DRAWN — as the NOW row — so it is not "in no slot", even
  // when the host put it in none. Counting it would make the isolated chip
  // state a falsehood about a row the reader can see above the order.
  const running = new Set(host.running.map((job) => job.key));

  const isolated = issues
    .filter(
      (issue) =>
        !placed.has(issue.key) && !running.has(issue.key) && (edgesOf.get(issue.key) ?? []).length === 0,
    )
    .map((issue) => issue.key);

  const cycles = normalizeCycles(input.cycles, byKey, diagnostics);

  return Object.freeze({
    document: Object.freeze({
      issues: Object.freeze(issues),
      edges: Object.freeze(edges),
      order: Object.freeze({ slots: Object.freeze(slots), excluded: Object.freeze(excluded) }),
      cycles: Object.freeze(cycles),
      byKey,
      edgesOf,
      isolated: Object.freeze(isolated),
      outOfSetOrigins,
      host,
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}
