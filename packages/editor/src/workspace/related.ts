/**
 * The Related groups list drawn under `640`: the selection's relationships,
 * listed as the Inspector lists them (RULES, Graphs, Dense neighbourhoods:
 * "Under 640 the list does the same").
 *
 * A PURE VIEW OF THE INSPECTOR'S OWN LIST. It reads
 * `inspectorView(...).relationships` and lists them with `inspectorListing`,
 * so the list can never name a relationship, a kind or a count the Inspector
 * does not: one flat list up to eight, and past eight a group per kind, five
 * rows before "Show 4 more".
 *
 * WITH NOTHING SELECTED IT HAS NO ROWS OF ITS OWN. The tab then shows the
 * groups the canvas drew, never every issue at once; `renderWorkspace` leaves
 * this list out for them.
 */

import type { ViewerDocument } from '@issuegraph/viewer';

import { type InspectorListing, inspectorListing, inspectorView } from './inspector.ts';
import type { WorkspaceSelection } from './selection.ts';

export type RelatedListView =
  | { readonly kind: 'no-selection' }
  | { readonly kind: 'no-relationships' }
  | { readonly kind: 'listed'; readonly listing: InspectorListing; readonly total: number };

const NO_SELECTION: RelatedListView = Object.freeze({ kind: 'no-selection' });
const NO_RELATIONSHIPS: RelatedListView = Object.freeze({ kind: 'no-relationships' });

/** Project the selection's relationships onto the Related groups list. */
export function relatedListView(document: ViewerDocument, selection: WorkspaceSelection): RelatedListView {
  const inspected = inspectorView(document, selection);
  if (inspected.subject.kind === 'none') return NO_SELECTION;
  if (inspected.relationships.length === 0) return NO_RELATIONSHIPS;
  return { kind: 'listed', listing: inspectorListing(inspected.relationships), total: inspected.relationships.length };
}
