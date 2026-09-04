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
 * `normalizeDocument` is the one entry point. It never throws: a document
 * assembled by hand is untrusted input, not a contract, and a renderer that
 * dies on a dangling edge is worse than one that draws what it can and says
 * what it dropped.
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

/** One reason a slot is held, and which family it belongs to. */
export interface ViewerHold {
  readonly family: HoldFamily;
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

/** Everything the viewer draws. */
export interface ViewerDocument {
  readonly issues: readonly ViewerIssue[];
  readonly edges: readonly ViewerEdge[];
  readonly order: ViewerOrder;
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
 * Read a document into the shape every projection consumes.
 *
 * Deterministic and total: the same input always produces the same output, and
 * no input produces a throw. Call it once per render and pass the result down.
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

  const isolated = issues
    .filter((issue) => !placed.has(issue.key) && (edgesOf.get(issue.key) ?? []).length === 0)
    .map((issue) => issue.key);

  return Object.freeze({
    document: Object.freeze({
      issues: Object.freeze(issues),
      edges: Object.freeze(edges),
      order: Object.freeze({ slots: Object.freeze(slots), excluded: Object.freeze(excluded) }),
      byKey,
      edgesOf,
      isolated: Object.freeze(isolated),
      outOfSetOrigins,
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}
