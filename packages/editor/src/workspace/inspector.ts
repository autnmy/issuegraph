/**
 * The inspector: detail, the "why", relationships, and the edit affordances
 * that hang off them.
 *
 * ## It is a projection of the selection, and holds no state of its own
 *
 * §17b makes `selected` the one edge state that also filters the inspector, so
 * this zone is a pure function of the document and that single value. It keeps
 * no "currently inspecting" of its own — a second copy would be free to
 * disagree with the rail and the canvas about what is selected, which is the
 * whole reason the workspace owns exactly one selection.
 *
 * ## An edge selection FILTERS; it does not open a different panel
 *
 * The distinction matters and it is easy to lose. With an edge selected the
 * inspector shows the same relationship list, narrowed to that one edge —
 * rather than a separate edge inspector. So the reader's frame of reference
 * never jumps.
 *
 * CLEARING RETURNS TO NOTHING SELECTED, NOT TO A WIDER LIST — and an earlier
 * revision of this comment said the opposite, which is how a control came to be
 * worded "show every relationship" while it emptied the panel. §17b makes the
 * inspector a projection of the SELECTION, and `none` is a selection with no
 * subject, so there is no list for it to widen to.
 *
 * The alternative was considered and not taken: `none` could list every
 * relationship in the document, which would make the three states a clean
 * narrowing — all, then one issue's, then one edge's — and make "show every
 * relationship" literally true. It also invents a fourth thing for the panel to
 * be, on a zone whose whole contract is that it shows what is selected. The
 * cheaper repair was to stop the prose promising a behaviour the design does
 * not have.
 *
 * ## Edge identity comes from `@issuegraph/core`
 *
 * A `ViewerEdge` carries no id — layer 1 has no need of one — but the picker,
 * the overlays and the store all name edges by the identity `edgeIdentity`
 * derives from content. Recomputing it here is composing the foundation both
 * layers already sit on, which is the same crossing `picker/view.ts` declared
 * and for the same reason: a local second spelling of an identity is how a host
 * comes to hold two ids for one edge.
 */

import { edgeIdentity, isSymmetricEdgeField } from '@issuegraph/core';
import type { EdgeField } from '@issuegraph/core';
import type { ViewerDocument, ViewerHold, ViewerIssue, ViewerSlot } from '@issuegraph/viewer';
import { normalizeDocument } from '@issuegraph/viewer';

import type { WorkspaceSelection } from './selection.ts';

/** One relationship, as the inspector lists it. */
export interface InspectorRelationship {
  /** The identity `@issuegraph/core` derives — what a retype or delete names. */
  readonly edgeId: string;
  readonly field: EdgeField;
  readonly from: string;
  readonly to: string;
  /**
   * Which end the subject is on — `null` when there is no direction to state.
   *
   * A DIRECTION RELATIVE TO THE SUBJECT, not a sentence: "blocked-by, outgoing"
   * is a fact, and the English for it is the host's to write. The package
   * refuses to construct one, exactly as the picker does.
   *
   * NULL FOR A SYMMETRIC FIELD, and that is a fact about the FORMAT rather
   * than a rendering choice. `serialize-with` and `together-with` state the
   * same relationship whichever way round their endpoints are stored —
   * `edgeIdentity` normalizes them for exactly that reason — so a direction
   * read off the stored order is one that does not exist, and a host wording
   * it would describe the relationship wrongly. `picker/view.ts` already
   * refuses a direction for those two kinds; this now agrees with it instead
   * of contradicting it from the next zone over.
   *
   * Also `null` when the subject is not an issue: an edge selection has no
   * "my end" to be relative to.
   */
  readonly direction: 'outgoing' | 'incoming' | null;
}

/** What the inspector knows about the selected issue's position. */
export interface InspectorPosition {
  /** 1-based, or `null` for a held slot — the viewer's own convention. */
  readonly rank: number | null;
  readonly ready: boolean;
  readonly holds: readonly ViewerHold[];
}

export interface InspectorView {
  /**
   * What the selection resolved to.
   *
   * `none` covers both "nothing selected" and "the selection no longer
   * resolves". They are deliberately one state rather than two: a selection
   * that named a row a write has since removed is not an error a reader can
   * act on, and rendering last frame's answer for it is the stale-detail bug
   * that keeping no document on the selection exists to prevent.
   */
  readonly subject:
    | { readonly kind: 'none' }
    | { readonly kind: 'issue'; readonly issue: ViewerIssue; readonly position: InspectorPosition | null }
    | { readonly kind: 'edge'; readonly relationship: InspectorRelationship };
  /**
   * The relationships on show: every one touching the selected issue, the one
   * selected edge, or none.
   */
  readonly relationships: readonly InspectorRelationship[];
  /** Whether an edge selection is narrowing the list. Drives the clear control. */
  readonly filtered: boolean;
}

const EMPTY: InspectorView = {
  subject: { kind: 'none' },
  relationships: [],
  filtered: false,
};

/** Every relationship in the document, carrying the identity edits name. */
function relationshipsOf(
  document: ViewerDocument,
  subject: string | null,
): readonly InspectorRelationship[] {
  return document.edges.map((edge) => ({
    edgeId: edgeIdentity(edge.field, edge.from, edge.to),
    field: edge.field,
    from: edge.from,
    to: edge.to,
    direction:
      subject === null ||
      isSymmetricEdgeField(edge.field) ||
      (edge.from !== subject && edge.to !== subject)
        ? null
        : edge.from === subject
          ? ('outgoing' as const)
          : ('incoming' as const),
  }));
}

/** The slot carrying a key, if the order places it. */
function slotFor(document: ViewerDocument, key: string): ViewerSlot | undefined {
  return document.order.slots.find((slot) => slot.members.includes(key));
}

/**
 * Project a document and a selection onto the inspector.
 *
 * Pure and total: an unresolvable selection returns the empty view rather than
 * throwing, because a document changing under a selection is ordinary — a write
 * lands, the order recomputes — and is not a condition a reader can fix.
 */
export function inspectorView(
  raw: ViewerDocument,
  selection: WorkspaceSelection,
): InspectorView {
  if (selection.kind === 'none') return EMPTY;

  // IT NORMALIZES ITS OWN INPUT, so the list can never disagree with what the
  // other zones drew. Reading the raw edges published relationships layer 1 had
  // already dropped — a dangling edge, a repeated one, a self-edge — each with
  // a live `select-edge` command on it, so the inspector offered the reader an
  // edge that exists on no other surface.
  //
  // Inside rather than at the call site, because this is exported: a host
  // calling it directly gets the same answer the workspace does. Idempotent, so
  // the workspace normalizing first costs a pass and changes nothing.
  const document = normalizeDocument(raw).document;

  if (selection.kind === 'issue') {
    // CANONICALIZED TO THE SLOT LEAD, because a together unit is ONE row and
    // layer 1 has already decided which member speaks for it. `ViewerSlot.lead`
    // is documented as "the detail surface's subject", and both projections run
    // their options through `atStations` before drawing — so a selection naming
    // a PARTNER marked the lead current in the rail and on the canvas while this
    // panel showed the partner's title and relationships. Two zones naming
    // different issues for one selection, which is the exact thing holding a
    // single selection value was supposed to make impossible.
    //
    // Falls back to the key itself when the order does not place it: an
    // excluded or unplaced issue is its own subject, and there is no lead to
    // defer to.
    const placement = slotFor(document, selection.key);
    const subject = placement?.lead ?? selection.key;
    const issue = document.issues.find((candidate) => candidate.key === subject);
    if (issue === undefined) return EMPTY;
    const slot = placement;
    return {
      subject: {
        kind: 'issue',
        issue,
        // NULL RATHER THAN A FABRICATED POSITION. An issue the order excludes —
        // a duplicate — genuinely has no position, and inventing `rank: null,
        // ready: false` for it would read as a hold, which is a different fact
        // with a different remedy.
        position:
          slot === undefined
            ? null
            : { rank: slot.rank, ready: slot.ready, holds: slot.holds },
      },
      // FILTERED ON MEMBERSHIP, NOT ON DIRECTION. Those were the same question
      // only while every edge touching the subject had one — and the moment a
      // symmetric field correctly reported `null`, a `together-with` or
      // `serialize-with` on the selected issue disappeared from the panel
      // entirely. "Does this edge touch my subject" and "which end is my
      // subject on" are different questions, and only the first belongs here.
      relationships: relationshipsOf(document, subject).filter(
        (relationship) => relationship.from === subject || relationship.to === subject,
      ),
      filtered: false,
    };
  }

  const relationship = relationshipsOf(document, null).find(
    (candidate) => candidate.edgeId === selection.edgeId,
  );
  if (relationship === undefined) return EMPTY;
  return {
    subject: { kind: 'edge', relationship },
    relationships: [relationship],
    filtered: true,
  };
}
