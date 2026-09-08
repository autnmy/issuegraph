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
 *
 * AND NONE OF THEM IS THE THING IT NAMES. `inspector: 'inspector'` was the
 * exception and it made its own pin vacuous: hard-coding the word into
 * `render.ts` left every test green, because the fixture and the hardcode are
 * the same string. A fixture word has to be one no renderer would write.
 */
export const WORKSPACE_WORDS: WorkspaceWords = {
  // FOUR WORDS THAT SHARE NO SUBSTRING, on this constant's standing rule. The
  // caption prints them in one line either side of two numbers, so a fixture
  // where `of` occurred inside `shown` would let a row that dropped a word
  // still satisfy a test looking for it.
  canvas: {
    focus: 'centred on',
    of: 'out of',
    shown: 'drawn here',
    editMode: 'you may edit',
  },
  asOf: 'read at',
  open: 'in the backlog',
  encoded: 'carry relationships',
  inspector: 'the detail panel',
  nothingSelected: 'pick a row to inspect it',
  clearSelection: 'clear the selection',
  relationships: 'relationships',
  whyRank: 'why rank',
  whyHeld: 'why held',
  workedAsOneUnit: 'worked as one unit with',
  noRelationships: 'nothing is related to this',
  addRelationship: 'begin a relationship',
  // DELIBERATELY UNLIKE THE CONTROL'S LABEL ABOVE. A fixture that spelled the
  // heading and the control the same way would pass whichever one the panel
  // drew, which is the pin failing to hold the distinction it exists for.
  addRelationshipHeading: 'add relationship',
  cancel: 'abandon the draft',
  relatingFrom: 'the draft starts at',
  remove: 'unlink this row',
  inbound: 'declared elsewhere',
  flip: 'read it the other way round',
  // ONE DISTINCT SENTENCE PER CODE, for the reason the whole constant states:
  // a capsule that renders the wrong refusal is exactly the failure a shared
  // string would hide, and `would-cycle` — the one refusal this package family
  // cannot detect for itself — is the one a test most needs to tell apart.
  refusals: {
    'self-edge': 'an issue cannot relate to itself',
    'unknown-issue': 'that issue is not in this backlog',
    'unknown-edge': 'that relationship is already gone',
    'duplicate-edge': 'that relationship is already declared',
    'unchanged-kind': 'it is already that kind',
    'symmetric-edge': 'that kind reads the same both ways',
    'cardinality': 'that field holds one reference',
    'would-cycle': 'that would close a loop',
    'guard-failed': 'the check could not be run',
  },
  // `retry` AND `retryOnLatest` ARE DELIBERATELY UNALIKE HERE, not two
  // spellings of one word. They label two different store calls, and a fixture
  // where one contained the other would let a card labelled with the wrong one
  // satisfy a test looking for the right one — which is the single mistake
  // these two words exist to make impossible.
  recovery: {
    failed: 'the tracker refused this write',
    conflict: 'the issue moved while you were editing',
    viewDiff: 'compare the two versions',
    retry: 'send it again',
    retryOnLatest: 'read the newest, then send it again',
    discardMine: 'throw my edit away',
    upstreamOnly: 'only in theirs',
    mineOnly: 'only in mine',
    mineRemoved: 'only in mine, taken away',
    carrierReversed: 'declared from the other end upstream',
    issuesChanged: 'issues that moved',
    diffEmpty: 'nothing on this row differs',
    retryFailed: 'could not read the newest version',
    unplaced: 'writes about issues this backlog does not hold',
  },
  audit: {
    heading: 'problems in the encoding',
    classes: {
      cycle: 'a loop',
      'stale-blocker': 'closed blocker',
      'dead-duplicate-ref': 'dead canonical',
      'encoding-refused': 'unreadable',
    },
    titles: {
      cycle: 'these issues wait on each other for ever',
      'stale-blocker': 'this waits on something already finished',
      'dead-duplicate-ref': 'this is filed against an issue that is gone',
      'encoding-refused': 'this declaration could not be read',
    },
    show: 'go to it',
  },
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
  /** The host's cycle answer, declared beside the edges that close it. */
  readonly cycles?: readonly (readonly string[])[] | undefined;
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
    cycles: options.cycles ?? [],
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
