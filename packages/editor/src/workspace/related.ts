/**
 * The Related groups list drawn under `640`: which of the selection's
 * relationships are on screen, grouped or searched, and how many are cut.
 *
 * A PURE VIEW OF THE INSPECTOR'S OWN LIST. It reads
 * `inspectorView(...).relationships`, so the list can never name a relationship
 * the Inspector does not, and each row it returns is the Inspector's own row,
 * which the renderer words the same way.
 *
 * ITS LIMITS ARE ITS OWN. The viewer's graph budgets count related issues; these
 * count relationships, and two relationships to one issue are two rows.
 */

import { EDGE_FIELDS } from '@issuegraph/core';
import type { EdgeField } from '@issuegraph/core';
import type { ViewerDocument } from '@issuegraph/viewer';

import { inspectorView } from './inspector.ts';
import type { InspectorRelationship } from './inspector.ts';
import type { WorkspaceSelection } from './selection.ts';

/** Up to this many relationships draw as one flat list; past it they group by kind. */
export const RELATED_FLAT_LIMIT = 60;

/** The most rows any one draw of the list holds. */
export const RELATED_ROW_LIMIT = 60;

/**
 * Where the search field is drawn, and how many relationships its scope must
 * pass before it is. An open group searches its own rows once they no longer
 * fit in one draw; with no group open, every relationship is searched once
 * there are too many groups' worth to open one by one.
 */
const SEARCH_LIMITS: Readonly<Record<RelatedSearchScope, number>> = Object.freeze({
  group: RELATED_ROW_LIMIT,
  all: 300,
});

/** What the search field filters: the open group, or every relationship. */
export type RelatedSearchScope = 'group' | 'all';

/** The reader's place in the list, as the host state holds it. */
export interface RelatedListState {
  /** The open group, or `null` for all closed. At most one is open. */
  readonly group: EdgeField | null;
  /** The search text; read only while a search field is drawn. */
  readonly query: string;
}

/** One kind of relationship the subject holds, and how many of it. */
export interface RelatedGroup {
  readonly field: EdgeField;
  readonly count: number;
  readonly open: boolean;
}

export type RelatedListView =
  | { readonly kind: 'no-selection' }
  | { readonly kind: 'no-relationships' }
  | { readonly kind: 'flat'; readonly rows: readonly InspectorRelationship[] }
  | {
      readonly kind: 'grouped';
      /** One per kind present, in `EDGE_FIELDS` order; empty while a top-level search is listing its matches. */
      readonly groups: readonly RelatedGroup[];
      readonly search: RelatedSearchScope | 'none';
      readonly rows: readonly InspectorRelationship[];
      /** How many rows the list would hold past the {@link RELATED_ROW_LIMIT} cut. */
      readonly omitted: number;
    };

const NO_SELECTION: RelatedListView = Object.freeze({ kind: 'no-selection' });
const NO_RELATIONSHIPS: RelatedListView = Object.freeze({ kind: 'no-relationships' });

/**
 * The keys a row draws besides the subject. An issue subject sits on every one
 * of its rows, so matching its own key would match them all; an edge selection
 * has no subject issue and draws both ends.
 */
function drawnEnds(relationship: InspectorRelationship, subject: string | null): readonly string[] {
  if (subject === null) return [relationship.from, relationship.to];
  return [relationship.from === subject ? relationship.to : relationship.from];
}

/**
 * The rows the query matches, with every row whose drawn key IS the query
 * first. A short key can be a substring of hundreds of others that share one
 * title; without putting the exact match first it could fall past the cut and
 * never be drawn, whatever the reader typed.
 *
 * Plain substring tests on lower-cased text: the query is never built into a
 * pattern, so `(` or `.*` mean only themselves.
 */
function matching(
  rows: readonly InspectorRelationship[],
  query: string,
  subject: string | null,
  titleOf: (key: string) => string,
): readonly InspectorRelationship[] {
  const needle = query.toLowerCase();
  if (needle === '') return rows;
  const ends = (row: InspectorRelationship): readonly string[] => drawnEnds(row, subject);
  const isExact = (row: InspectorRelationship): boolean => ends(row).some((key) => key.toLowerCase() === needle);
  const holds = (row: InspectorRelationship): boolean =>
    ends(row).some((key) => key.toLowerCase().includes(needle) || titleOf(key).toLowerCase().includes(needle));
  const found = rows.filter(holds);
  return [...found.filter(isExact), ...found.filter((row) => !isExact(row))];
}

/** One group per kind present, opening `open` only when the list holds that kind. */
function groupsOf(rows: readonly InspectorRelationship[], open: EdgeField | null): readonly RelatedGroup[] {
  return EDGE_FIELDS.map((field) => ({
    field,
    count: rows.filter((row) => row.field === field).length,
    open: field === open,
  })).filter((group) => group.count > 0);
}

/**
 * Project the selection's relationships onto the Related groups list.
 *
 * A query is ignored wherever no search field is drawn: the reader can neither
 * see nor clear it there, so it must not hide rows.
 */
export function relatedListView(
  document: ViewerDocument,
  selection: WorkspaceSelection,
  state: RelatedListState,
): RelatedListView {
  const inspected = inspectorView(document, selection);
  if (inspected.subject.kind === 'none') return NO_SELECTION;
  const all = inspected.relationships;
  if (all.length === 0) return NO_RELATIONSHIPS;
  if (all.length <= RELATED_FLAT_LIMIT) return { kind: 'flat', rows: all };

  const subject = inspected.subject.kind === 'issue' ? inspected.subject.issue.key : null;
  const groups = groupsOf(all, state.group);
  const open = groups.find((group) => group.open)?.field ?? null;
  const scope = open === null ? all : all.filter((row) => row.field === open);
  const scopeKind: RelatedSearchScope = open === null ? 'all' : 'group';
  const search = scope.length > SEARCH_LIMITS[scopeKind] ? scopeKind : 'none';
  const query = search === 'none' ? '' : state.query.trim();
  // With every group closed no rows are drawn until a query lists its
  // matches, and those matches then stand in for the closed groups.
  const searching = open === null && query !== '';
  const titles = new Map(document.issues.map((issue) => [issue.key, issue.title]));
  const listed =
    open !== null || searching ? matching(scope, query, subject, (key) => titles.get(key) ?? '') : [];
  const rows = listed.slice(0, RELATED_ROW_LIMIT);
  return {
    kind: 'grouped',
    groups: searching ? [] : groups,
    search,
    rows,
    omitted: listed.length - rows.length,
  };
}
