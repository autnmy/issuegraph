/**
 * Fixtures for the three-zone workspace.
 *
 * Its own file rather than an addition to `reevaluate.ts`: that file answers
 * "where does a delta chip land", and its `railOf` builds a flat, edgeless rail
 * on purpose. The workspace needs the opposite in two places — a backlog large
 * enough to make windowing mean something, and a rail carrying real edges so
 * the inspector has relationships to list — so building both from one helper
 * would make each test read the other's constraints.
 */

import type { EdgeField } from '@issuegraph/core';
import type { ViewerDocument, ViewerHold } from '@issuegraph/viewer';

import type { WorkspaceWords } from '../index.ts';

/**
 * A host vocabulary.
 *
 * Every entry is distinct and none is a substring of another, so an assertion
 * that finds one word cannot be satisfied by a different one — the same rule
 * `reevaluate.ts`'s `WORDS` states.
 */
export const WORKSPACE_WORDS: WorkspaceWords = {
  nothingSelected: 'pick a row to inspect it',
  clearFilter: 'show every relationship',
  relationships: 'relationships',
};

/** `count` keys, zero-padded so lexical and numeric order agree. */
export function keysOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `i${String(index + 1).padStart(4, '0')}`);
}

export interface BacklogOptions {
  /** Keys whose slot is held: no rank, and a graph-family hold. */
  readonly held?: readonly string[] | undefined;
  readonly edges?: readonly (readonly [EdgeField, string, string])[] | undefined;
  /** Keys folded into the slot led by the key they map to. */
  readonly unitOf?: Readonly<Record<string, string>> | undefined;
}

const GRAPH_HOLD: ViewerHold = { family: 'graph', reason: 'a blocker is open' };

/**
 * A backlog of `total` issues, ranked in key order.
 *
 * Held slots keep their POSITION and lose their RANK, which is the viewer's own
 * rule — so a fixture with holds in it exercises the fact that ranks are not a
 * coordinate the window can slice on.
 */
export function backlogOf(total: number, options: BacklogOptions = {}): ViewerDocument {
  const keys = keysOf(total);
  const held = new Set(options.held ?? []);
  const unitOf = options.unitOf ?? {};
  const folded = new Set(Object.keys(unitOf));

  let rank = 0;
  const slots = keys
    .filter((key) => !folded.has(key))
    .map((key) => {
      const members = [key, ...Object.entries(unitOf).flatMap(([m, lead]) => (lead === key ? [m] : []))];
      const isHeld = held.has(key);
      if (!isHeld) rank += 1;
      return {
        rank: isHeld ? null : rank,
        lead: key,
        members,
        ready: !isHeld,
        holds: isHeld ? [GRAPH_HOLD] : [],
      };
    });

  return {
    issues: keys.map((key) => ({ key, title: `Issue ${key}`, open: true, priority: 2 })),
    edges: (options.edges ?? []).map(([field, from, to]) => ({ field, from, to })),
    order: { slots, excluded: [] },
  };
}

/** Every `data-zone` the workspace rendered, in document order. */
export function zonesIn(markup: string): string[] {
  return [...markup.matchAll(/data-zone="([^"]+)"/g)].map((match) => match[1] ?? '');
}

/** Every rail row key the workspace drew, in document order. */
export function drawnKeys(markup: string): string[] {
  return [...markup.matchAll(/<li class="ig-slot" data-ig-key="([^"]+)"/g)].map(
    (match) => match[1] ?? '',
  );
}
