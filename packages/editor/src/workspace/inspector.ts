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
 * never jumps, and clearing the selection widens the list back rather than
 * navigating anywhere.
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

import { edgeIdentity } from '@issuegraph/core';
import type { EdgeField } from '@issuegraph/core';
import type { ViewerDocument, ViewerHold, ViewerIssue, ViewerSlot } from '@issuegraph/viewer';

import type { WorkspaceSelection } from './selection.ts';

/** One relationship, as the inspector lists it. */
export interface InspectorRelationship {
  /** The identity `@issuegraph/core` derives — what a retype or delete names. */
  readonly edgeId: string;
  readonly field: EdgeField;
  readonly from: string;
  readonly to: string;
  /**
   * Which end the subject is on, or `null` when the subject is not an issue.
   *
   * A DIRECTION RELATIVE TO THE SUBJECT, not a sentence: "blocked-by, outgoing"
   * is a fact, and the English for it is the host's to write. The package
   * refuses to construct one, exactly as the picker does.
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
      subject === null || (edge.from !== subject && edge.to !== subject)
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
  document: ViewerDocument,
  selection: WorkspaceSelection,
): InspectorView {
  if (selection.kind === 'none') return EMPTY;

  if (selection.kind === 'issue') {
    const issue = document.issues.find((candidate) => candidate.key === selection.key);
    if (issue === undefined) return EMPTY;
    const slot = slotFor(document, selection.key);
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
      relationships: relationshipsOf(document, selection.key).filter(
        (relationship) => relationship.direction !== null,
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
