/**
 * What recedes around a selection, so its neighbours read first.
 *
 * A selection is either a set of issues or one relationship, never both. With
 * issues, what stays is the selected issues, every issue that shares an edge of
 * any kind with one, and every edge with a selected issue at an end; the rest
 * recedes. With a relationship, that edge and its two ends stay.
 *
 * THE SELECTION IS READ EXACTLY AS GIVEN. Selecting one member of a together
 * unit does not select its partners: a partner stays as a neighbour over
 * `together-with`, but its own other edges and neighbours recede. The unit is
 * still one card, though, so no member of a unit with a kept member recedes —
 * a card cannot be half receded.
 *
 * AN EDGE IS MATCHED BY ITS WHOLE IDENTITY, NEVER PARSED. The identity a host
 * hands back is compared against `edgeIdentity(field, from, to)` over the
 * document's own edges, in declared orientation, so a string that only looks
 * like an identity — padded, re-cased, ends swapped on a directed field —
 * matches nothing and recedes nothing.
 */

import { edgeIdentity } from '@issuegraph/core';

import type { NormalizedDocument, ViewerEdge } from './document.ts';

/** How strongly a receded line or station still draws: half strength. */
export const RECEDE_ALPHA = 0.5;

export interface RecedeSelection {
  /** One issue key or a set of them. Keys this document does not carry are ignored. */
  readonly key?: string | readonly string[] | null;
  /** One relationship's `edgeIdentity`. Ignored when any `key` resolves. */
  readonly edge?: string | null;
}

export interface Receding {
  readonly keys: ReadonlySet<string>;
  /** `edgeIdentity(field, from, to)` of every receding edge. */
  readonly edges: ReadonlySet<string>;
}

interface Kept {
  readonly keys: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
}

function identityOf(edge: ViewerEdge): string {
  return edgeIdentity(edge.field, edge.from, edge.to);
}

function selectedKeys(document: NormalizedDocument, key: RecedeSelection['key']): readonly string[] {
  const given = typeof key === 'string' ? [key] : (key ?? []);
  return given.filter((candidate) => document.byKey.has(candidate));
}

function keptByIssues(document: NormalizedDocument, selected: readonly string[]): Kept {
  const touching = selected.flatMap((key) => document.edgesOf.get(key) ?? []);
  return {
    keys: new Set([...selected, ...touching.flatMap((edge) => [edge.from, edge.to])]),
    edges: new Set(touching.map(identityOf)),
  };
}

function keptByEdge(document: NormalizedDocument, edge: RecedeSelection['edge']): Kept | null {
  const selected = document.edges.find((candidate) => identityOf(candidate) === edge);
  return selected === undefined
    ? null
    : { keys: new Set([selected.from, selected.to]), edges: new Set([identityOf(selected)]) };
}

/** Every member of the card each kept key is drawn on. */
function withWholeCards(document: NormalizedDocument, keys: ReadonlySet<string>): ReadonlySet<string> {
  const cardMembers = (key: string): readonly string[] =>
    document.slotByLead.get(document.leadOf.get(key) ?? key)?.members ?? [key];
  return new Set([...keys].flatMap(cardMembers));
}

function kept(document: NormalizedDocument, selection: RecedeSelection): Kept | null {
  const selected = selectedKeys(document, selection.key);
  return selected.length > 0 ? keptByIssues(document, selected) : keptByEdge(document, selection.edge);
}

/**
 * The issue keys and edge identities that recede around `selection`. No
 * selection, or one that does not resolve, recedes nothing.
 */
export function recedingOf(document: NormalizedDocument, selection: RecedeSelection): Receding {
  const stays = kept(document, selection);
  if (stays === null) return { keys: new Set(), edges: new Set() };
  const keptKeys = withWholeCards(document, stays.keys);
  return {
    keys: new Set(document.issues.map((issue) => issue.key).filter((key) => !keptKeys.has(key))),
    edges: new Set(document.edges.map(identityOf).filter((identity) => !stays.edges.has(identity))),
  };
}
