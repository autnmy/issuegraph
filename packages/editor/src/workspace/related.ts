/**
 * The Related groups list: the selection's neighbours as order rows under each
 * kind's head (RULES, Graphs, Dense neighbourhoods). Drawn under `640`, and in
 * the canvas's place past the graph's budget at any width.
 *
 * GROUPED AT EVERY COUNT. An order row does not name its kind, so the head
 * does; "flat up to 8" is the Inspector's rule, whose phrase rows carry the
 * kind themselves. The groups are the Inspector's own (`inspectorGroups`), so
 * a kind's count, its order and the key a reader's "Show N more" opens are one
 * fact on both surfaces, and `shownGroups` opens a group in both.
 *
 * WITH NOTHING SELECTED IT HAS NO ROWS OF ITS OWN. The tab then shows the
 * groups the canvas drew, never every issue at once; `renderWorkspace` leaves
 * this list out for them.
 */

import { edgeIdentity, isSymmetricEdgeField } from '@issuegraph/core';
import { type ViewerDocument, normalizeDocument } from '@issuegraph/viewer';

import {
  INSPECTOR_GROUP_SHOWN,
  type InspectorGroup,
  type InspectorRelationship,
  inspectorGroups,
  inspectorView,
} from './inspector.ts';
import type { WorkspaceSelection } from './selection.ts';

/** One kind's group: the Inspector's group, and the issue each of its relationships reaches. */
export interface RelatedGroup {
  readonly group: InspectorGroup;
  /** The far end of each relationship, in the group's order: the rows. */
  readonly neighbours: readonly string[];
}

export type RelatedListView =
  | { readonly kind: 'no-selection' }
  | { readonly kind: 'no-relationships' }
  | {
      readonly kind: 'listed';
      /**
       * The issue the list is read around, the head's "Around #2290": the
       * selected issue, or a selected relationship's `from` end, whose phrase
       * its stored order reads in. `null` for a set, which has no one issue.
       */
      readonly around: string | null;
      readonly groups: readonly RelatedGroup[];
      /** Every relationship listed: the head's count. */
      readonly total: number;
    };

const NO_SELECTION: RelatedListView = Object.freeze({ kind: 'no-selection' });
const NO_RELATIONSHIPS: RelatedListView = Object.freeze({ kind: 'no-relationships' });

/**
 * A set's relationships, each read from the member it touches: every one
 * touching a member, except one between two members (both ends are already
 * the selection) and a sub-issue, which is the Sub-issues tree's to list.
 */
function setRelationships(document: ViewerDocument, keys: ReadonlySet<string>): readonly InspectorRelationship[] {
  return normalizeDocument(document)
    .document.edges.filter((edge) => keys.has(edge.from) !== keys.has(edge.to))
    .map((edge) => ({
      edgeId: edgeIdentity(edge.field, edge.from, edge.to),
      field: edge.field,
      from: edge.from,
      to: edge.to,
      direction: isSymmetricEdgeField(edge.field) ? null : keys.has(edge.from) ? ('outgoing' as const) : ('incoming' as const),
    }))
    .filter((relationship) => !(relationship.field === 'decomposed-from' && relationship.direction === 'incoming'));
}

/** The list for relationships read from the issues in `centre`. */
function listed(
  around: string | null,
  centre: ReadonlySet<string>,
  relationships: readonly InspectorRelationship[],
): RelatedListView {
  if (relationships.length === 0) return NO_RELATIONSHIPS;
  const far = (relationship: InspectorRelationship): string =>
    centre.has(relationship.from) ? relationship.to : relationship.from;
  const groups = inspectorGroups(relationships).map((group) => ({ group, neighbours: group.relationships.map(far) }));
  return {
    kind: 'listed',
    around,
    groups,
    total: relationships.length,
  };
}

/** Project the selection's relationships onto the Related groups list. */
export function relatedListView(document: ViewerDocument, selection: WorkspaceSelection): RelatedListView {
  const inspected = inspectorView(document, selection);
  const subject = inspected.subject;
  switch (subject.kind) {
    case 'none':
      return NO_SELECTION;
    case 'issue':
      return listed(subject.issue.key, new Set([subject.issue.key]), inspected.relationships);
    // A SELECTED RELATIONSHIP IS READ FROM ITS `from` END, the end its stored
    // order phrases it from, so the head says what the one row is to it.
    case 'edge': {
      const { relationship } = subject;
      const direction = isSymmetricEdgeField(relationship.field) ? null : ('outgoing' as const);
      return listed(relationship.from, new Set([relationship.from]), [{ ...relationship, direction }]);
    }
    case 'issues': {
      const keys = new Set(subject.issues.map((issue) => issue.key));
      return listed(null, keys, setRelationships(document, keys));
    }
  }
}

/**
 * The rows a group draws: its first five until the reader opens it, the way
 * the Inspector folds. One rule for the list and for the keyboard's scene of
 * it, so the reader moves through exactly the rows drawn.
 */
export function shownNeighbours(group: RelatedGroup, shownGroups: readonly string[]): readonly string[] {
  return shownGroups.includes(group.group.key) ? group.neighbours : group.neighbours.slice(0, INSPECTOR_GROUP_SHOWN);
}

/** Every row the list draws, in the order drawn. */
export function relatedRowKeys(view: RelatedListView, shownGroups: readonly string[]): readonly string[] {
  return view.kind === 'listed' ? view.groups.flatMap((group) => shownNeighbours(group, shownGroups)) : [];
}
