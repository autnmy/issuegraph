/**
 * What the canvas draws around the selection, and which kinds of line
 * (RULES, Graphs, Dense neighbourhoods).
 *
 * "Only the selection's own relationships draw." With an issue selected the
 * canvas keeps that issue and its neighbours through the kinds switched on;
 * with a relationship selected, its two ends. Past 8 relationships on the
 * issue, with two kinds or more that switch, the graph draws one kind at
 * first, the first that switches in the legend's order, and the legend
 * becomes a switch for each kind with its count; with fewer there is nothing
 * to choose, every kind draws and the legend stays plain with the counts.
 *
 * A PURE VIEW OF THE INSPECTOR'S OWN LIST, as the Related groups list is: the
 * relationships counted here are `inspectorView(...).relationships`, so the
 * legend's "is blocked by 12" and the Inspector's "Is blocked by 12" are one
 * count drawn twice.
 */

import type { EdgeField } from '@issuegraph/core';
import {
  DENSE_RELATIONSHIPS,
  LEGEND_ORDER,
  type ViewerDocument,
  type ViewerEdge,
  normalizeDocument,
} from '@issuegraph/viewer';

import type { ScaleAround } from '../scale/ladder.ts';
import { type InspectorRelationship, inspectorView, issueRelationships } from './inspector.ts';
import type { WorkspaceSelection } from './selection.ts';

/**
 * The kinds that draw whatever is switched: together-with, since the unit's
 * region always draws. Its entry stays plain, with its count, and counts as
 * drawn ("10 of 11 drawn" includes it).
 */
const ALWAYS_DRAWN: readonly EdgeField[] = Object.freeze(['together-with']);

/**
 * The kinds the legend's switch turns on and off, in the legend's order:
 * blocked-by, serializes-with, is a duplicate of and was decomposed from.
 * Every kind the legend has draws around a selection; a sub-issue never
 * reaches it, since the Relationships list leaves sub-issues to Sub-issues.
 */
export const SWITCHABLE_KINDS: readonly EdgeField[] = Object.freeze(
  LEGEND_ORDER.filter((field) => !ALWAYS_DRAWN.includes(field)),
);

/** One kind the selected issue holds, as the legend's switch draws it. */
export interface CanvasKind {
  readonly field: EdgeField;
  readonly count: number;
  readonly on: boolean;
  readonly switchable: boolean;
}

/** The legend's facts past 8: each kind, and how many of the selection's relationships draw. */
export interface CanvasKinds {
  /**
   * Whether the legend is a switch: two kinds or more that switch. With fewer
   * there is nothing to choose, every kind draws and the legend stays plain.
   */
  readonly switches: boolean;
  readonly kinds: readonly CanvasKind[];
  readonly drawn: number;
  readonly total: number;
}

export interface CanvasNeighbourhood {
  /** What the ladder keeps, or `null` with nothing selected. */
  readonly around: ScaleAround | null;
  /** The legend past {@link DENSE_RELATIONSHIPS}; `null` keeps the static key. */
  readonly kinds: CanvasKinds | null;
}

const NOTHING: CanvasNeighbourhood = Object.freeze({ around: null, kinds: null });

/** The kinds that switch among those held, in the legend's order. */
function switchableHeld(held: readonly EdgeField[]): readonly EdgeField[] {
  return SWITCHABLE_KINDS.filter((field) => held.includes(field));
}

/**
 * Whether a selection's legend is a switch: past 8 relationships, with two
 * kinds or more that switch. Together-with alone, together-with with one
 * other kind, or any single kind leaves nothing to choose.
 */
function switches(held: readonly EdgeField[]): boolean {
  return held.length > DENSE_RELATIONSHIPS && switchableHeld(held).length > 1;
}

/**
 * The kinds that draw for a selection, given the kind of each of its
 * relationships and the kinds the reader switched away from their start.
 *
 * THE READER'S PRESSES ARE STORED AS FLIPS, NOT AS THE SET, so the start has to
 * be read off the selection itself: where the legend switches, the first kind
 * that switches in the legend's order (blocked-by, the kind that sets the
 * order, whenever the selection has one), so the graph never opens on "0 of
 * 17 drawn"; elsewhere every kind. That start is a fact of the selection, and
 * the flips are cleared whenever the selection moves
 * (`HostState.switchedKinds`), so the two always describe the same issue.
 * Where no switch is drawn there is nothing a press could have flipped.
 * Together-with draws either way.
 */
export function drawnKinds(held: readonly EdgeField[], switched: readonly EdgeField[]): ReadonlySet<EdgeField> {
  if (!switches(held)) return new Set(LEGEND_ORDER);
  const first = switchableHeld(held).slice(0, 1);
  return new Set(
    LEGEND_ORDER.filter((field) => ALWAYS_DRAWN.includes(field) || first.includes(field) !== switched.includes(field)),
  );
}

function edgeOf(relationship: InspectorRelationship): ViewerEdge {
  return { field: relationship.field, from: relationship.from, to: relationship.to };
}

/** Each kind the relationships hold, in the legend's order, with its count. */
function kindsOf(relationships: readonly InspectorRelationship[], on: ReadonlySet<EdgeField>): CanvasKinds {
  const held = relationships.map((relationship) => relationship.field);
  const kinds = LEGEND_ORDER.map((field) => ({
    field,
    count: relationships.filter((relationship) => relationship.field === field).length,
    on: on.has(field),
    switchable: SWITCHABLE_KINDS.includes(field),
  })).filter((kind) => kind.count > 0);
  return {
    switches: switches(held),
    kinds,
    drawn: kinds.filter((kind) => kind.on).reduce((sum, kind) => sum + kind.count, 0),
    total: relationships.length,
  };
}

/**
 * Every relationship a set's members hold, each once: the lines between two
 * members too, since both ends are the selection, but no member's sub-issues.
 */
function setEdges(document: ViewerDocument, keys: readonly string[]): readonly ViewerEdge[] {
  const byId = new Map(
    keys.flatMap((key) => issueRelationships(document, key)).map((relationship) => [relationship.edgeId, relationship]),
  );
  return [...byId.values()].map(edgeOf);
}

/**
 * What the canvas is drawn around for this selection, and the legend past 8
 * relationships when the selection is one issue.
 *
 * SEVERAL ISSUES SELECTED draw each with its neighbours through every kind.
 * The Inspector lists no relationships for a set, so there is no count to
 * switch on and the key stays static.
 */
export function canvasNeighbourhood(
  document: ViewerDocument,
  selection: WorkspaceSelection,
  switched: readonly EdgeField[],
): CanvasNeighbourhood {
  const inspected = inspectorView(document, selection);
  const subject = inspected.subject;
  switch (subject.kind) {
    case 'none':
      return NOTHING;
    case 'edge': {
      // THE SELECTED RELATIONSHIP DRAWS WHATEVER ITS KIND: the reader picked it.
      const edges = [edgeOf(subject.relationship)];
      return {
        around: { centre: [subject.relationship.from, subject.relationship.to], edges, reach: edges },
        kinds: null,
      };
    }
    case 'issues': {
      const keys = subject.issues.map((issue) => issue.key);
      const edges = setEdges(normalizeDocument(document).document, keys);
      return { around: { centre: keys, edges, reach: edges }, kinds: null };
    }
    case 'issue': {
      const relationships = inspected.relationships;
      const on = drawnKinds(
        relationships.map((relationship) => relationship.field),
        switched,
      );
      return {
        around: {
          centre: [subject.issue.key],
          edges: relationships.filter((relationship) => on.has(relationship.field)).map(edgeOf),
          // WHAT DECIDES WHETHER THE GRAPH DRAWS AT ALL is every relationship
          // it could draw, never the kinds switched on: switching a kind on
          // must not turn the graph into a list and take the switch away.
          reach: relationships.map(edgeOf),
        },
        kinds: relationships.length > DENSE_RELATIONSHIPS ? kindsOf(relationships, on) : null,
      };
    }
  }
}
