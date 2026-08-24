/**
 * The pieces every projection draws the same way.
 *
 * Identity, provenance, holds, readiness stations and edge badges are one
 * grammar, not three — the design's extensibility clause turns on that. Putting
 * them here means a projection cannot invent a second spelling of "this issue
 * is held", and a change to the grammar lands in every projection at once.
 */

import type { EdgeField } from '@issuegraph/core';

import type {
  NormalizedDocument,
  RankProvenance,
  ViewerHold,
  ViewerIssue,
  ViewerSlot,
} from './document.ts';
import { type ElementSpec, element } from './element.ts';
import { EDGE_ORDER, treatmentFor } from './vocabulary.ts';

/** How a readiness station is filled — the parallelism channel. */
export type StationFill = 'filled' | 'hollow' | 'dashed';

/**
 * Filled = ready now. Hollow = ready once a named rank lands. Dashed = held.
 *
 * The hollow case needs the host to have told us the rank; without it a ready
 * slot is simply ready, and inventing a pending state would claim a dependency
 * nobody declared.
 */
export function stationFill(slot: ViewerSlot): StationFill {
  if (!slot.ready) return 'dashed';
  const after = slot.readyAfterRank;
  return after === undefined || after === null ? 'filled' : 'hollow';
}

const STATION_LABEL: Readonly<Record<StationFill, string>> = Object.freeze({
  filled: 'ready now',
  hollow: 'ready after an earlier rank',
  dashed: 'held',
});

export function station(fill: StationFill): ElementSpec {
  return element('span', {
    class: 'ig-station',
    'data-fill': fill,
    role: 'img',
    'aria-label': STATION_LABEL[fill],
  });
}

/**
 * The identity chip: the qualified reference, linked only when the host gave us
 * a URL. The viewer never constructs one — knowing a tracker's URL shape is the
 * kind of knowledge this layer exists not to have.
 */
export function identity(issue: ViewerIssue): ElementSpec {
  if (issue.url === undefined || issue.url === '') {
    return element('span', { class: 'ig-id' }, [issue.key]);
  }
  return element('span', { class: 'ig-id' }, [
    element(
      'a',
      {
        class: 'ig-link',
        href: issue.url,
        rel: 'noreferrer',
        'aria-label': `open ${issue.key}`,
      },
      [`${issue.key} ↗`],
    ),
  ]);
}

/**
 * The provenance line, in the three forms the design fixes: a matched ordering
 * query, the declared tier, and an effective-priority promotion that names the
 * dependent the urgency arrived through.
 */
export function provenanceLine(provenance: RankProvenance | undefined): ElementSpec | null {
  if (provenance === undefined) return null;
  switch (provenance.kind) {
    case 'matched-query':
      return element('p', { class: 'ig-provenance' }, [
        `matched ordered query ${String(provenance.index)} · `,
        element('span', { class: 'ig-id' }, [provenance.label]),
      ]);
    case 'declared-tier':
      return element('p', { class: 'ig-provenance' }, [
        `priority tier P${String(provenance.priority)}`,
      ]);
    case 'promotion': {
      const via =
        provenance.promotedBy.length === 0
          ? ''
          : ` · inherited from ${provenance.promotedBy.join(', ')}`;
      return element('p', { class: 'ig-provenance' }, [
        element('span', { class: 'ig-id' }, [provenance.notation]),
        `${via}`,
      ]);
    }
  }
}

/** One hold, rendered with the family it belongs to visible in the markup. */
export function holdLine(hold: ViewerHold): ElementSpec {
  return element('p', { class: 'ig-hold', 'data-family': hold.family }, [hold.reason]);
}

/** A badge naming one relationship, on all four channels at once. */
function edgeBadge(field: EdgeField, detail: string): ElementSpec {
  const treatment = treatmentFor(field);
  return element(
    'span',
    {
      class: 'ig-badge',
      'data-edge': field,
      title: `${treatment.label} ${detail}`,
      'aria-label': `${treatment.label} ${detail}`,
    },
    [
      element('span', { class: 'ig-glyph', 'aria-hidden': 'true' }, [treatment.glyph]),
      element('span', {}, [detail]),
    ],
  );
}

/**
 * Every relationship touching one issue, as badges in the format's own field
 * order — so two issues with the same relationships always read identically.
 */
export function edgeBadges(document: NormalizedDocument, key: string): ElementSpec | null {
  const edges = document.edgesOf.get(key) ?? [];
  if (edges.length === 0) return null;
  const badges: ElementSpec[] = [];
  for (const field of EDGE_ORDER) {
    for (const edge of edges) {
      if (edge.field !== field) continue;
      const treatment = treatmentFor(field);
      // A symmetric edge states one fact whichever end you read it from, so it
      // is announced as one relationship rather than as two directions.
      const other = edge.from === key ? edge.to : edge.from;
      const detail = treatment.symmetric || edge.from === key ? other : `${other} (incoming)`;
      badges.push(edgeBadge(field, detail));
    }
  }
  return element('span', { class: 'ig-badges' }, badges);
}

/** The legend. Rendered once per scene so the grammar is readable cold. */
export function legend(): ElementSpec {
  return element('fieldset', { class: 'ig-legend' }, [
    element('legend', { class: 'ig-legend-caption' }, ['relationships']),
    ...EDGE_ORDER.map((field) => {
      const treatment = treatmentFor(field);
      return element('span', { class: 'ig-badge', 'data-edge': field }, [
        element('span', { class: 'ig-glyph', 'aria-hidden': 'true' }, [treatment.glyph]),
        element('span', {}, [treatment.label]),
      ]);
    }),
  ]);
}

/** The title of a slot, naming every member — a together unit is one row. */
export function slotTitle(document: NormalizedDocument, slot: ViewerSlot): string {
  return slot.members
    .map((member) => document.byKey.get(member)?.title ?? member)
    .join(' · ');
}

/** A slot's accessible name: what it is, where it sits, and whether it is held. */
export function slotLabel(document: NormalizedDocument, slot: ViewerSlot): string {
  const position = slot.rank === null ? 'held, no rank' : `rank ${String(slot.rank)}`;
  return `${slotTitle(document, slot)} — ${slot.members.join(', ')} — ${position}`;
}

/** The empty state. A container with nothing in it reads as a bug. */
export function emptyState(message: string): ElementSpec {
  return element('p', { class: 'ig-empty' }, [message]);
}
