/**
 * The overlays a canvas draws for the edges it drew: the store's write states,
 * composed with the one selection.
 *
 * ONE MERGE, TWO CANVASES. The scale ladder and the workspace's tree mode both
 * draw a scene over a document and both owe it the same overlays; written
 * twice, the two drifted within a review round (the tree drew none). So the
 * merge is a pure function over the drawn edges, the store's projection and
 * the selected identity, and both canvases call it.
 *
 * Narrowed to the edges the scene drew, by identity, so an entry for an edge a
 * narrower tier left out attaches to nothing rather than being reported as
 * unattached. `states: ['selected']` is synthesised for the selection — the
 * one state that is not about a write — and folded INTO a projected record for
 * the same edge rather than added beside it, because `attachEdgeOverlays` keys
 * overlays by identity and a second record would replace the first.
 */

import { edgeIdentity } from '@issuegraph/core';
import type { ProjectedEdge } from '@issuegraph/store';
import type { ViewerEdge } from '@issuegraph/viewer';

export function overlaysFor(
  drawn: readonly ViewerEdge[],
  projected: readonly ProjectedEdge[] | undefined,
  selectedEdge: string | null | undefined,
): readonly ProjectedEdge[] {
  const identities = new Set(drawn.map((edge) => edgeIdentity(edge.field, edge.from, edge.to)));
  const selected =
    selectedEdge === null || selectedEdge === undefined
      ? null
      : (drawn.find((edge) => edgeIdentity(edge.field, edge.from, edge.to) === selectedEdge) ?? null);
  const selectedOverlay: ProjectedEdge | null =
    selected === null
      ? null
      : {
          id: edgeIdentity(selected.field, selected.from, selected.to),
          kind: selected.field,
          from: selected.from,
          to: selected.to,
          states: ['selected'],
          writes: [],
        };
  const overlays: ProjectedEdge[] = [];
  for (const edge of projected ?? []) {
    if (!identities.has(edge.id) || edge.states.length === 0) continue;
    if (selectedOverlay !== null && edge.id === selectedOverlay.id) {
      overlays.push({ ...edge, states: [...edge.states, 'selected'] });
      continue;
    }
    overlays.push(edge);
  }
  if (selectedOverlay !== null && !overlays.some((edge) => edge.id === selectedOverlay.id)) {
    overlays.push(selectedOverlay);
  }
  return overlays;
}
