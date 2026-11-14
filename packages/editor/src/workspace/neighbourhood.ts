/**
 * What the canvas draws around the selection, and which kinds of line
 * (RULES, Graphs, Dense neighbourhoods).
 *
 * "Only the selection's own relationships draw." With an issue selected the
 * canvas keeps that issue and its neighbours through the kinds switched on;
 * with a relationship selected, its two ends. Past 8 relationships on the
 * issue the graph draws one kind at first, blocked-by, the kind that sets the
 * order, or when the issue has none the first kind it has in the legend's
 * order, so it never opens on "0 of 17 drawn"; the legend becomes a switch for
 * each kind with its count.
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
import { type InspectorRelationship, inspectorView } from './inspector.ts';
import type { WorkspaceSelection } from './selection.ts';

/**
 * The kinds this canvas draws, in the legend's order. Decomposed-from lives in
 * Sub-issues, so it is never drawn here and never a switch.
 */
export const CANVAS_KINDS: readonly EdgeField[] = Object.freeze(
  LEGEND_ORDER.filter((field) => field !== 'decomposed-from'),
);

/**
 * The kinds that draw whatever is switched: together-with, since the unit's
 * region always draws. Its entry stays plain, with its count, and counts as
 * drawn ("14 of 17 drawn" includes it).
 */
const ALWAYS_DRAWN: readonly EdgeField[] = Object.freeze(['together-with']);

/** The kinds the legend's switch turns on and off, in the legend's order. */
export const SWITCHABLE_KINDS: readonly EdgeField[] = Object.freeze(
  CANVAS_KINDS.filter((field) => !ALWAYS_DRAWN.includes(field)),
);

/** One kind the selected issue holds, as the legend's switch draws it. */
export interface CanvasKind {
  readonly field: EdgeField;
  readonly count: number;
  readonly on: boolean;
  readonly switchable: boolean;
}

/** The switch's facts: each kind, and how many of the selection's relationships draw. */
export interface CanvasKinds {
  readonly kinds: readonly CanvasKind[];
  readonly drawn: number;
  readonly total: number;
}

export interface CanvasNeighbourhood {
  /** What the ladder keeps, or `null` with nothing selected. */
  readonly around: ScaleAround | null;
  /** The legend's switch, past {@link DENSE_RELATIONSHIPS}; `null` keeps the static key. */
  readonly kinds: CanvasKinds | null;
}

const NOTHING: CanvasNeighbourhood = Object.freeze({ around: null, kinds: null });

/**
 * The kind a dense selection opens on: the first switchable kind it holds, in
 * the legend's order. Blocked-by leads the legend, so it is that whenever the
 * selection has one; with none it is the next kind the selection has, never
 * one it lacks.
 */
function firstKinds(held: readonly EdgeField[]): readonly EdgeField[] {
  return SWITCHABLE_KINDS.filter((field) => held.includes(field)).slice(0, 1);
}

/**
 * The kinds that draw for a selection, given the kind of each of its
 * relationships and the kinds the reader switched away from their start.
 *
 * THE READER'S PRESSES ARE STORED AS FLIPS, NOT AS THE SET, so the start has to
 * be read off the selection itself: the first kind it holds past eight, every
 * kind at eight or fewer. That start is a fact of the selection, and the flips
 * are cleared whenever the selection moves (`HostState.switchedKinds`), so the
 * two always describe the same issue. At eight or fewer no switch is drawn, so
 * there is nothing a press could have flipped. Together-with draws either way.
 */
export function drawnKinds(held: readonly EdgeField[], switched: readonly EdgeField[]): ReadonlySet<EdgeField> {
  if (held.length <= DENSE_RELATIONSHIPS) return new Set(CANVAS_KINDS);
  const first = firstKinds(held);
  return new Set(
    CANVAS_KINDS.filter((field) => ALWAYS_DRAWN.includes(field) || first.includes(field) !== switched.includes(field)),
  );
}

function edgeOf(relationship: InspectorRelationship): ViewerEdge {
  return { field: relationship.field, from: relationship.from, to: relationship.to };
}

/** Each kind the relationships hold, in the legend's order, with its count. */
function kindsOf(relationships: readonly InspectorRelationship[], on: ReadonlySet<EdgeField>): CanvasKinds {
  const kinds = LEGEND_ORDER.map((field) => ({
    field,
    count: relationships.filter((relationship) => relationship.field === field).length,
    on: on.has(field),
    switchable: SWITCHABLE_KINDS.includes(field),
  })).filter((kind) => kind.count > 0);
  return {
    kinds,
    drawn: kinds.filter((kind) => kind.on).reduce((sum, kind) => sum + kind.count, 0),
    total: relationships.length,
  };
}

/**
 * What the canvas is drawn around for this selection, and the legend's switch
 * when the selection is dense.
 *
 * SEVERAL ISSUES SELECTED draw each with its neighbours through every kind the
 * canvas draws. The Inspector lists no relationships for a set, so there is no
 * count to switch on and the key stays static.
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
      const keys = new Set(subject.issues.map((issue) => issue.key));
      const edges = normalizeDocument(document).document.edges.filter(
        (edge) => CANVAS_KINDS.includes(edge.field) && (keys.has(edge.from) || keys.has(edge.to)),
      );
      return { around: { centre: [...keys], edges, reach: edges }, kinds: null };
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
          // WHAT DECIDES WHETHER THE GRAPH DRAWS AT ALL is every kind it could
          // draw, never the kinds switched on: switching a kind on must not
          // turn the graph into a list and take the switch away with it.
          reach: relationships.filter((relationship) => CANVAS_KINDS.includes(relationship.field)).map(edgeOf),
        },
        kinds: relationships.length > DENSE_RELATIONSHIPS ? kindsOf(relationships, on) : null,
      };
    }
  }
}
