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
import { WORDS as CHANGE_WORDS } from './reevaluate.ts';

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
  // THE RE-EVALUATE SURFACE'S OWN FIXTURE, so a summary drawn in the workspace
  // and one drawn by `renderReevaluate` are checked against the same words.
  change: CHANGE_WORDS,
  // THE LOG UNDER THE HEAD, on this constant's standing rule. No operation
  // word or kind word is a substring of another, so a test counting the
  // writes the log lists by their operation word counts only those, and none
  // of the kind words is the viewer's own label for that kind.
  log: {
    label: 'writes not yet settled',
    saving: 'still being written',
    ops: {
      create: 'putting in place',
      delete: 'taking out',
      flip: 'turning around',
      retype: 'swapping the kind of',
    },
    becomes: 'so that it reads as',
    kinds: {
      'blocked-by': 'waits on',
      'decomposed-from': 'split out of',
      'duplicate-of': 'repeats',
      'serialize-with': 'queues behind',
      'together-with': 'ships alongside',
    },
  },
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
  issuesSelected: (count) => `${String(count)} issues selected`,
  clearSelection: 'clear the selection',
  // §17k's STRIP CONTROL, AND THE TWO LABELS SHARE NO SUBSTRING — this
  // constant's standing rule, and it has a second edge here: the control
  // carries `aria-expanded`, so a test that found the wrong label would be
  // reading a button that offers to open what is already open.
  showCanvas: 'unfold the graph',
  hideCanvas: 'put the graph away',
  relationships: 'relationships',
  // THE LAYOUT UNDER 640, on this constant's standing rule: no tab's word is a
  // substring of another's, so a tab that drew the wrong word fails its pin.
  narrow: {
    order: 'ranked queue',
    related: 'linked issues',
    subIssues: 'child tree',
    closeSheet: 'fold the sheet down',
    noSelection: 'select an issue to list its links',
    searchRelated: 'search links',
    omitted: (count) => `${String(count)} more not shown; narrow the search`,
    noMatch: 'no link matches',
  },
  whyRank: 'why rank',
  whyHeld: 'why held',
  filteredEmpty: 'no flagged rows match',
  filteredActive: 'narrowed to flagged rows',
  filteredDenominator: (ranked) => `${String(ranked)} issues are ranked`,
  filteredClear: 'clear the filter',
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
    filter: 'narrow the list',
    // DELIBERATELY NOT THE FRAME'S WORDS. These fixtures use host wording that
    // no package string could be mistaken for, so a test asserting on a label
    // is asserting the word reached the markup rather than that the package
    // hard-coded the frame's copy. The demo carries §17d's actual labels.
    remedies: {
      pickEdge: 'choose an edge',
      removeEdge: 'drop it',
      keepAsHistory: 'leave it be',
      repoint: 'point it somewhere',
    },
    refusedHeading: 'could not be read',
    refusedOpen: 'see it upstream',
    refusedRewrite: 'fix it here',
  },
};

/** `count` keys, zero-padded so lexical and numeric order agree. */
export function keysOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `i${String(index + 1).padStart(4, '0')}`);
}

/**
 * `count` relationships between `i0001` and each of the next `count` issues,
 * alternating `blocked-by` and `serialize-with` — the hub the Related groups
 * list needs to pass its limits. For `backlogOf(count + 1, { edges })`.
 *
 * EACH `serialize-with` IS DECLARED BY THE OTHER ISSUE. An issue may declare
 * only one `serialize-with`, and the viewer keeps the first and drops the rest,
 * so a hub declaring them all would list one. `blocked-by` takes many, so the
 * hub declares those itself.
 */
export function relatedHubEdges(count: number): (readonly [EdgeField, string, string])[] {
  return keysOf(count + 1)
    .slice(1)
    .map((key, index): readonly [EdgeField, string, string] =>
      index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
    );
}

/** 301 keys that each hold `TASK-1` as a substring, so only an exact key match reaches `TASK-1` past 300. */
export const TASK_KEYS: readonly string[] = Array.from({ length: 301 }, (_, n) => `TASK-${String(1000 + n)}`);

/**
 * `HUB`, blocked by each of `keys`, every issue titled `titleOf` its key.
 *
 * The Related groups list's search reads keys and titles, and the hub of
 * {@link relatedHubEdges} gives every issue its own of both, so a search that
 * must tell same-titled or substring keys apart needs this one.
 */
export function blockedHub(keys: readonly string[], titleOf: (key: string) => string): ViewerDocument {
  return {
    issues: ['HUB', ...keys].map((key) => ({ key, title: titleOf(key), open: true, priority: 2 })),
    edges: keys.map((to) => ({ field: 'blocked-by' as const, from: 'HUB', to })),
    order: {
      slots: ['HUB', ...keys].map((key, n) => ({ rank: n + 1, lead: key, members: [key], ready: true, holds: [] })),
      excluded: [],
    },
    cycles: [],
  };
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
