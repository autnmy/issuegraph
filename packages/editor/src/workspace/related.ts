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
 * ONE BLOCK PER ISSUE READ AROUND, each under its "Around #2290" with its own
 * count: one for a selected issue, one for a selected relationship (the list
 * stays as it was around the issue it was picked from, with that
 * relationship's row selected), and one per member of a selected set, in rank
 * order, counting only what lies outside the set.
 *
 * WITH NOTHING SELECTED IT HAS NO ROWS OF ITS OWN. The tab then shows the
 * groups the canvas drew, never every issue at once; `renderWorkspace` leaves
 * this list out for them.
 */

import { type ViewerDocument, normalizeDocument } from '@issuegraph/viewer';

import {
  INSPECTOR_GROUP_SHOWN,
  type InspectorGroup,
  type InspectorRelationship,
  inspectorGroups,
  inspectorView,
  issueRelationships,
} from './inspector.ts';
import type { WorkspaceSelection } from './selection.ts';

/** One kind's group: the Inspector's group, and the issue each of its relationships reaches. */
export interface RelatedGroup {
  readonly group: InspectorGroup;
  /**
   * What the group's "Show N more" names in `shownGroups`: the Inspector's
   * group key around one issue, so a group opened in one is open in the
   * other; in a set's block, scoped to the block's issue, since every block
   * has its own "Is blocked by".
   */
  readonly key: string;
  /** The far end of each relationship, in the group's order: the rows. */
  readonly neighbours: readonly string[];
  /**
   * The row that is the selected relationship's, its far end, or `null`. Its
   * group opens only when that row sits past the fold, so the row is always
   * drawn and the list otherwise stays as it was (q349).
   */
  readonly selected: string | null;
}

/** The list around one issue: its "Around #2290 · 17", then its groups. */
export interface RelatedBlock {
  /** The issue the block is read around, the head's "Around #2290". */
  readonly around: string;
  readonly groups: readonly RelatedGroup[];
  /** Every relationship the block lists: the head's count. */
  readonly total: number;
}

export type RelatedListView =
  | { readonly kind: 'no-selection' }
  | { readonly kind: 'no-relationships' }
  | { readonly kind: 'listed'; readonly blocks: readonly RelatedBlock[] };

const NO_SELECTION: RelatedListView = Object.freeze({ kind: 'no-selection' });
const NO_RELATIONSHIPS: RelatedListView = Object.freeze({ kind: 'no-relationships' });

/**
 * The block around `around`, from its relationships. `selected` is the edge
 * whose row is the selected row, and `scope` prefixes the groups' keys.
 */
function blockOf(
  around: string,
  relationships: readonly InspectorRelationship[],
  selected: string | null,
  scope: string,
): RelatedBlock {
  const far = (relationship: InspectorRelationship): string =>
    relationship.from === around ? relationship.to : relationship.from;
  const groups = inspectorGroups(relationships).map((group) => ({
    group,
    key: `${scope}${group.key}`,
    neighbours: group.relationships.map(far),
    selected: group.relationships.filter((relationship) => relationship.edgeId === selected).map(far)[0] ?? null,
  }));
  return { around, groups, total: relationships.length };
}

/** The list of these blocks, leaving out a block with nothing in it. */
function listed(blocks: readonly RelatedBlock[]): RelatedListView {
  const shown = blocks.filter((block) => block.total > 0);
  return shown.length === 0 ? NO_RELATIONSHIPS : { kind: 'listed', blocks: shown };
}

/** The selected issues in rank order: as the order places them, the rest after in the order added. */
function inRankOrder(document: ViewerDocument, keys: readonly string[]): readonly string[] {
  const placed = document.order.slots.flatMap((slot) => slot.members);
  const position = (key: string): number => {
    const index = placed.indexOf(key);
    return index === -1 ? placed.length : index;
  };
  return [...keys].sort((a, b) => position(a) - position(b));
}

/**
 * One block per member of a set, in rank order, each listing only that
 * member's relationships whose far end lies outside the set.
 */
function setBlocks(document: ViewerDocument, keys: readonly string[]): readonly RelatedBlock[] {
  const set = new Set(keys);
  return inRankOrder(document, keys).map((key) =>
    blockOf(
      key,
      issueRelationships(document, key).filter((relationship) => !(set.has(relationship.from) && set.has(relationship.to))),
      null,
      `${key} `,
    ),
  );
}

/** Project the selection's relationships onto the Related groups list. */
export function relatedListView(raw: ViewerDocument, selection: WorkspaceSelection): RelatedListView {
  const document = normalizeDocument(raw).document;
  const inspected = inspectorView(document, selection);
  const subject = inspected.subject;
  switch (subject.kind) {
    case 'none':
      return NO_SELECTION;
    case 'issue':
      return listed([blockOf(subject.issue.key, inspected.relationships, null, '')]);
    // A SELECTED RELATIONSHIP LEAVES THE LIST AS IT WAS, around the issue it
    // was picked from, with its row selected. The selection names only the
    // edge, so that issue is read as its stored `from` end, the end its
    // stored order phrases it from.
    case 'edge': {
      const { relationship } = subject;
      return listed([blockOf(relationship.from, issueRelationships(document, relationship.from), relationship.edgeId, '')]);
    }
    case 'issues':
      return listed(setBlocks(document, subject.issues.map((issue) => issue.key)));
  }
}

/**
 * The rows a group draws: its first five until the reader opens it, the way
 * the Inspector folds, and all of them when the selected row sits past those
 * five (q349: "the list stays as it was", so a selected row already drawn
 * opens nothing). One rule for the list and for the keyboard's scene of it, so
 * the reader moves through exactly the rows drawn.
 */
export function shownNeighbours(group: RelatedGroup, shownGroups: readonly string[]): readonly string[] {
  const selectedPastFold = group.selected !== null && group.neighbours.indexOf(group.selected) >= INSPECTOR_GROUP_SHOWN;
  return shownGroups.includes(group.key) || selectedPastFold
    ? group.neighbours
    : group.neighbours.slice(0, INSPECTOR_GROUP_SHOWN);
}

/** Every row the list draws, in the order drawn. */
export function relatedRowKeys(view: RelatedListView, shownGroups: readonly string[]): readonly string[] {
  return view.kind === 'listed'
    ? view.blocks.flatMap((block) => block.groups.flatMap((group) => shownNeighbours(group, shownGroups)))
    : [];
}
