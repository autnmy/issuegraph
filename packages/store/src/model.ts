/**
 * The document this store holds, and the identity rule for an edge in it.
 *
 * The shapes here are the *store's* schema, not a tracker's: an adapter maps its
 * own issues onto these and the store never learns what it mapped from. That is
 * the whole of BYO-DataSource on this side of the port.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import { type EdgeField, type Priority, isSymmetricEdgeField } from '@issuegraph/core';

/**
 * An issue reference, exactly as the adapter emits it.
 *
 * The specification admits two forms — a bare integer and the qualified
 * `owner/repo#123` (§4.2) — and normalising between them is the reader's job.
 * This store therefore treats a reference as an OPAQUE identity: it compares
 * references, and it never parses, reformats or resolves one. An adapter's
 * contract is that equal references mean the same issue.
 */
export type IssueRef = string;

/** A relationship kind. The format's vocabulary, taken from the shared package. */
export type EdgeKind = EdgeField;

/**
 * An edge's identity, derived from its content by {@link edgeId} rather than
 * assigned by a host.
 *
 * Derived because the store has to recognise the edge an adapter returns as the
 * same edge it drew optimistically. A host-assigned identifier would push that
 * correlation onto every adapter, and an adapter that got it wrong would leave
 * an optimistic edge stranded beside its own landed twin.
 */
export type EdgeId = string;

/** Whether an issue is still open. Readiness (§6.2) is the deriver's to compute. */
export type IssueState = 'open' | 'closed';

/**
 * One issue, reduced to what a relationship surface renders.
 *
 * `priority` is the *declared* priority (§4.3.5) as the adapter resolved it —
 * the tracker's own convention where one exists, the frontmatter field where it
 * does not. Resolving that precedence is the adapter's job, not the store's.
 */
export interface StoredIssue {
  readonly ref: IssueRef;
  readonly title: string;
  readonly state: IssueState;
  readonly priority?: Priority;
  readonly url?: string;
}

/**
 * One relationship, held as a directed pair even for the symmetric kinds.
 *
 * The pair is retained rather than normalised away because a symmetric edge is
 * still *written* on one issue pointing at another (§4.3.4), and an editor has
 * to know which issue carries the field in order to delete it. Symmetry is
 * expressed in {@link edgeId} instead, so `A serialize-with B` and
 * `B serialize-with A` are one edge without either of them losing its carrier.
 */
export interface StoredEdge {
  readonly id: EdgeId;
  readonly kind: EdgeKind;
  readonly from: IssueRef;
  readonly to: IssueRef;
}

/** Everything the store holds about the backlog at one instant. */
export interface GraphDocument {
  readonly issues: readonly StoredIssue[];
  readonly edges: readonly StoredEdge[];
}

/**
 * The identity of an edge, as a pure function of its content.
 *
 * References are percent-encoded before joining, so the separator cannot appear
 * inside a reference: `encodeURIComponent` escapes `|`, which means no reference
 * — however a tracker spells it — can forge the identity of a different edge.
 *
 * The two symmetric kinds (§4.3.4, §4.3.7) sort their endpoints, so the two
 * spellings of one relationship collapse to one identity. The directed kinds do
 * not, because for them the direction IS the fact: `A blocked-by B` and
 * `B blocked-by A` are opposite claims about which issue may start.
 */
export function edgeId(kind: EdgeKind, from: IssueRef, to: IssueRef): EdgeId {
  const [first, second] = isSymmetricEdgeField(kind) && to < from ? [to, from] : [from, to];
  return `${kind}|${encodeURIComponent(first)}|${encodeURIComponent(second)}`;
}

/** An edge with its identity filled in from its content. */
export function makeEdge(kind: EdgeKind, from: IssueRef, to: IssueRef): StoredEdge {
  return { id: edgeId(kind, from, to), kind, from, to };
}

/** The edge carrying an identity, or `undefined` when the document has none. */
export function findEdge(document: GraphDocument, id: EdgeId): StoredEdge | undefined {
  return document.edges.find((edge) => edge.id === id);
}

/** Whether the document holds an issue under this reference. */
export function hasIssue(document: GraphDocument, ref: IssueRef): boolean {
  return document.issues.some((issue) => issue.ref === ref);
}

/**
 * Whether two edge lists state the same set of relationships.
 *
 * Compared as a SET, not a sequence: an adapter is free to return its edges in
 * whatever order its own storage yields, and treating a reordering as a change
 * would re-derive the order and emit a change summary for a write that moved
 * nothing. Identity already encodes kind and endpoints, so comparing identities
 * compares the edges.
 */
export function sameEdgeSet(a: readonly StoredEdge[], b: readonly StoredEdge[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((edge) => edge.id));
  return b.every((edge) => ids.has(edge.id));
}

/**
 * Whether two issue lists state the same issues, in the same order.
 *
 * Order is compared as well as content because a rehydrate that returns the
 * same issues in a different sequence really is a different document to render
 * — and unlike edges, an issue list has no derived identity to compare as a set.
 */
export function sameIssueList(a: readonly StoredIssue[], b: readonly StoredIssue[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((issue, index) => {
    const other = b[index];
    if (other === undefined) return false;
    return (
      issue.ref === other.ref &&
      issue.title === other.title &&
      issue.state === other.state &&
      issue.priority === other.priority &&
      issue.url === other.url
    );
  });
}
