/**
 * What a conflicted write is a conflict ABOUT, as data.
 *
 * §17b gives a conflict three resolutions — view diff, retry on latest, discard
 * mine — and **never an auto-merge**. The first of those needs something to
 * view, and the store keeps it: a `conflict` record carries the authoritative
 * document as the adapter reported it, "retained for the host to show; never
 * adopted" (`@issuegraph/store`'s `WriteRecord`). This module turns that held
 * document into the difference a reader can actually read.
 *
 * ## It computes nothing the store already answers
 *
 * `edgeChangeFor` is the store's own rule for which edges an unlanded edit
 * draws, and it is imported rather than restated. A second spelling of "what
 * would this mutation produce" is precisely the drifting duplicate the package
 * family removes everywhere else, and it would be wrong in the interesting
 * cases first: a retype that produces the identity it started from is a MARK
 * and not a swap, and a `resultingEdge` can be `undefined` when a sibling write
 * has already taken the edge away.
 *
 * ## Why it lives in layer 2 rather than in the store
 *
 * Both candidate homes in `@issuegraph/store` would take a foreign domain:
 * `change.ts` scopes itself to "what an edit did to the ORDER" and imports only
 * `IssueRef`, `Mutation` and `OrderRow`; `write.ts` is the ledger. And the
 * inputs are all already public — `edgeChangeFor`, `GraphDocument`,
 * `StoredEdge`, `StoredIssue` — so composing them here is use of a surface, not
 * a reach past one.
 *
 * The deciding reason is release mechanics rather than taste. A new store
 * export moves the store off its published version, and this package depends on
 * it as `workspace:^`, which packs a caret that pins the MINOR on a `0.x`
 * version. A leaf that draws two cards should not force a two-package release
 * to do it. If a second consumer ever needs this, moving it is a follow-up with
 * a reason.
 *
 * ## The two documents, named
 *
 * `landed` is what the source has CONFIRMED, and by the write ledger's founding
 * rule — a failed write is marked, never reverted — it does **not** contain the
 * conflicting edit. So the reader's own side has to be reconstructed from the
 * mutation, and that is exactly what {@link conflictDiff} does. Handing it
 * `projected` instead would fold in every OTHER unsettled write, and the card
 * would state edits the reader is not resolving.
 *
 * ## Identity is `edge.id`, and the reason is symmetric ORDER
 *
 * `edgeId` sorts a SYMMETRIC field's endpoints, so `A serialize-with B` and
 * `B serialize-with A` are one identity where a field-by-field compare of
 * `{ kind, from, to }` reports a difference — which on a conflict card would
 * invent an upstream change nobody made.
 *
 * It does NOT canonicalise how a reference is spelled, and nothing here should
 * be written as though it does: `owner/repo#9` and `owner%2Frepo%239` are
 * deliberately distinct identities, because two distinct references must not
 * collide.
 *
 * ## It is not scoped to a panel
 *
 * A diff is over the whole document and the RENDERER narrows it, because the
 * panel's reach is a key SET — a together unit's lead speaks for its partners —
 * and a single key cannot express that. Scoping here by one carrier would
 * exclude a conflicted edge from its own diff on exactly the panel that is
 * entitled to state it.
 */

import {
  type EdgeId,
  type GraphDocument,
  type IssueRef,
  type Mutation,
  type StoredEdge,
  type StoredIssue,
  edgeChangeFor,
} from '@issuegraph/store';

/**
 * One issue the two documents disagree about.
 *
 * `null` on either side means the document does not hold that issue at all,
 * which is a real difference and not an absence of one: an issue that appeared
 * upstream while the reader was editing is the change they most need to see.
 */
export interface ConflictIssueChange {
  readonly ref: IssueRef;
  readonly mine: StoredIssue | null;
  readonly upstream: StoredIssue | null;
}

/**
 * Both sides of a conflict, held apart.
 *
 * THREE FIELDS BECAUSE §17b's CONFLICT IS AN ISSUE-BODY CHANGE. The spec's
 * stated cause is "body changed upstream", and the store carries issues on the
 * held document precisely so they are not lost. An edges-only difference would
 * come back empty for the most common conflict there is, and a card that then
 * said "upstream changed elsewhere" would be stating a falsehood.
 *
 * NOTHING HERE COMBINES THE TWO SIDES, and that is the type doing the work
 * rather than a rule someone has to keep: there is no `merged` field, no
 * `resolved` field, and no ordering that would let a caller read one as
 * superseding the other.
 */
export interface ConflictDiff {
  /** In the held document and not in the reader's. */
  readonly upstreamOnly: readonly StoredEdge[];
  /** The reader's own unlanded edit ADDS these, where upstream does not have them. */
  readonly mineOnly: readonly StoredEdge[];
  /**
   * The reader's own unlanded edit REMOVES these, and upstream still has them.
   *
   * WITHOUT THIS SIDE A DELETE HAS NO DIFFERENCE AT ALL, and the card said so
   * out loud: `edgeChangeFor(landed, delete).drawn` is empty by design, and
   * `upstreamOnly` is empty because both documents still hold the edge — so a
   * conflicted delete produced a wholly empty diff and rendered
   * {@link RecoveryWords.diffEmpty}, whose host wording is some form of "the
   * change upstream was elsewhere". That is a FALSE STATEMENT on exactly the
   * input, and it is the failure this module's own header claims to avoid. A
   * retype or flip whose `resultingEdge` is `undefined` — a sibling write took
   * the edge — reaches it the same way.
   */
  readonly mineRemoved: readonly StoredEdge[];
  readonly issuesChanged: readonly ConflictIssueChange[];
  /**
   * Relationships both documents hold whose DECLARING END disagrees.
   *
   * `edge.id` is the right join key and is not the whole answer. `sameEdgeSet`
   * in `@issuegraph/store` records why in terms: for a symmetric field
   * `edgeId` sorts the endpoints, so a carrier reversal upstream reads as
   * "nothing changed" — "after which a retype writes the OPPOSITE direction,
   * which §17b names as the most common encoding mistake there is". Joined on
   * identity and reported on direction, both halves are visible.
   */
  readonly carrierReversed: readonly ConflictCarrierChange[];
}

/** One relationship both sides hold, pointing opposite ways. */
export interface ConflictCarrierChange {
  readonly id: EdgeId;
  readonly mine: StoredEdge;
  readonly upstream: StoredEdge;
}

/** Whether two issues differ on any field a reader can see. */
function issueMoved(a: StoredIssue, b: StoredIssue): boolean {
  return (
    a.title !== b.title ||
    a.state !== b.state ||
    a.priority !== b.priority ||
    a.url !== b.url
  );
}

function byRef(issues: readonly StoredIssue[]): ReadonlyMap<IssueRef, StoredIssue> {
  return new Map(issues.map((issue) => [issue.ref, issue]));
}

/**
 * The difference between the confirmed document and the one held on a conflict,
 * with the reader's own unlanded edit reconstructed from its mutation.
 *
 * `mineOnly` is derived rather than read because `landed` cannot contain the
 * edit — see the module note. It is therefore structurally guaranteed to hold
 * the one relationship the card exists to be about, which no amount of care at
 * the call site could have guaranteed if this took a document.
 */
export function conflictDiff(
  landed: GraphDocument,
  upstream: GraphDocument,
  mutation: Mutation,
): ConflictDiff {
  const landedIds = new Set(landed.edges.map((edge) => edge.id));
  const upstreamIds = new Set(upstream.edges.map((edge) => edge.id));

  const upstreamOnly = upstream.edges.filter((edge) => !landedIds.has(edge.id));
  // THE STORE'S OWN ANSWER to what this edit does. `drawn` is what it adds and
  // `hidden` is what it replaces; a `delete` draws nothing and hides nothing —
  // it MARKS the edge it removes, which is deliberate there and is why the
  // removal side reads `marked` for that op alone.
  const change = edgeChangeFor(landed, mutation);
  const mineOnly = change.drawn.filter((edge) => !upstreamIds.has(edge.id));
  const removedIds =
    mutation.op === 'delete' ? change.marked : change.hidden;
  const mineRemoved = removedIds.flatMap((id) => {
    const edge = upstream.edges.find((each) => each.id === id);
    return edge === undefined ? [] : [edge];
  });

  // JOINED ON IDENTITY, REPORTED ON DIRECTION. See `carrierReversed`.
  const upstreamById = new Map(upstream.edges.map((edge) => [edge.id, edge]));
  const carrierReversed = landed.edges.flatMap((mine) => {
    const theirs = upstreamById.get(mine.id);
    if (theirs === undefined) return [];
    if (theirs.from === mine.from && theirs.to === mine.to) return [];
    return [{ id: mine.id, mine, upstream: theirs }];
  });

  const mineIssues = byRef(landed.issues);
  const upstreamIssues = byRef(upstream.issues);
  const issuesChanged: ConflictIssueChange[] = [];
  // WALKED OVER THE UNION, so an issue that exists on one side only is a
  // difference rather than a lookup that quietly returned nothing.
  for (const ref of new Set([...mineIssues.keys(), ...upstreamIssues.keys()])) {
    const mine = mineIssues.get(ref) ?? null;
    const theirs = upstreamIssues.get(ref) ?? null;
    if (mine !== null && theirs !== null && !issueMoved(mine, theirs)) continue;
    if (mine === null && theirs === null) continue;
    issuesChanged.push({ ref, mine, upstream: theirs });
  }

  return { upstreamOnly, mineOnly, mineRemoved, issuesChanged, carrierReversed };
}

/** Whether a diff has anything at all to show. */
export function diffIsEmpty(diff: ConflictDiff): boolean {
  return (
    diff.upstreamOnly.length === 0 &&
    diff.mineOnly.length === 0 &&
    diff.mineRemoved.length === 0 &&
    diff.issuesChanged.length === 0 &&
    diff.carrierReversed.length === 0
  );
}

/**
 * The part of a diff a given panel is entitled to draw.
 *
 * TAKES THE PANEL'S KEY SET, NOT ONE KEY. `panelScope` entitles an issue panel
 * by its own key AND every together-unit partner that canonicalized onto it, so
 * narrowing by a single carrier would drop a partner's conflicted edge from the
 * one panel allowed to state it.
 *
 * An issue change is kept when the issue itself is in the set; an edge when
 * either endpoint is.
 */
export function diffWithin(diff: ConflictDiff, keys: ReadonlySet<string>): ConflictDiff {
  const touches = (edge: StoredEdge): boolean => keys.has(edge.from) || keys.has(edge.to);
  return {
    upstreamOnly: diff.upstreamOnly.filter(touches),
    mineOnly: diff.mineOnly.filter(touches),
    mineRemoved: diff.mineRemoved.filter(touches),
    issuesChanged: diff.issuesChanged.filter((change) => keys.has(change.ref)),
    carrierReversed: diff.carrierReversed.filter((change) => touches(change.mine)),
  };
}
