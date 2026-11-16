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
  // THE LOG UNDER THE HEAD, on this constant's standing rule. No state word
  // is a substring of another, so a test counting the writes the log lists by
  // a state word counts only those (#304: the relationship is the viewer's
  // own phrase, so the host passes no operation or kind word).
  log: {
    label: 'writes not yet settled',
    saving: 'still being written',
    notSaved: 'left unrecorded',
    removing: 'on its way out',
    notRemoved: 'stayed put',
    show: 'show',
  },
  // FOUR WORDS THAT SHARE NO SUBSTRING, on this constant's standing rule. The
  // caption prints them in one line either side of two numbers, so a fixture
  // where `of` occurred inside `shown` would let a row that dropped a word
  // still satisfy a test looking for it.
  canvas: {
    focus: 'centred on',
    selected: 'picked',
    selectedIssues: (count: number): string => `a set of ${String(count)}`,
    of: 'out of',
    shown: 'drawn here',
    related: 'linked to it',
    editMode: 'you may edit',
  },
  asOf: 'read at',
  open: 'in the backlog',
  encoded: 'carry relationships',
  inspector: 'the detail panel',
  workOrder: 'the order',
  showWorkOrder: 'show the order',
  closeWorkOrder: 'close the order',
  workOrderRanked: 'placed in line',
  workOrderAtATime: 'run together',
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
    view: 'view picker',
    closeSheet: 'fold the sheet down',
    around: 'centred on',
    noSelection: 'select an issue to list its links',
    nothingRelated: 'nothing here is linked yet',
  },
  // THE BATCH INSPECTOR'S WORDS (#249), each naming its count so a test can
  // tell which number a render stated.
  batch: {
    addToAll: (count: number): string => `apply to the ${String(count)}`,
    serializeAll: (count: number): string => `queue the ${String(count)} in turn`,
    unitAll: (count: number): string => `bind the ${String(count)} together`,
    blockedByAll: (count: number): string => `hold the ${String(count)} behind`,
    blockedByHeading: (count: number): string => `the ${String(count)} wait on`,
    target: 'blocking issue',
    refusal: (reason): string => `refused: ${reason}`,
    confirmTitle: (count: number): string => `write ${String(count)} links?`,
    confirmBody: (count: number): string => `${String(count)} writes go to the host`,
    confirm: (count: number): string => `write ${String(count)} links`,
    cancel: 'keep things as they are',
    saved: (saved: number, total: number, unsaved: number): string =>
      `${String(saved)} of ${String(total)} landed, ${String(unsaved)} did not`,
    retry: (unsaved: number): string => `send the ${String(unsaved)} again`,
    discard: (unsaved: number): string => `drop the ${String(unsaved)}`,
  },
  whyRank: 'why rank',
  whyHeld: 'why held',
  filteredEmpty: 'no flagged rows match',
  filteredActive: 'narrowed to flagged rows',
  filteredDenominator: (ranked) => `${String(ranked)} issues are ranked`,
  filteredClear: 'clear the filter',
  positionOf: (rank: number, total: number): string => `${String(rank)} of ${String(total)}`,
  positionTail: ({ partners, blockers }: { readonly partners: readonly string[]; readonly blockers: readonly string[] }): string => {
    const unit = partners.length === 0 ? null : `Worked with ${partners.join(', ')} as one unit`;
    const [only] = blockers;
    const after = blockers.length > 1 ? `after the ${String(blockers.length)} issues that block it close` : only === undefined ? null : `after ${only} closes`;
    if (unit !== null && after !== null) return `${unit}, ${after}`;
    const clause = unit ?? after ?? '';
    return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`;
  },
  noRelationships: 'nothing is related to this',
  showMore: (count: number): string => `Show ${String(count)} more`,
  relationshipsToDraw: 'kinds to draw',
  relationshipsDrawn: (drawn: number, total: number): string => `${String(drawn)} drawn out of ${String(total)}`,
  listedByRelationship: (count: number, issue: string): string =>
    `${String(count)} issues touch ${issue}, too many for one picture, so they are listed by kind`,
  listedAroundSelected: (count: number, selected: number): string =>
    `${String(count)} issues touch the ${String(selected)} picked, too many for one picture, so they are listed by kind`,
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
    heading: { one: 'problem in the encoding', other: 'problems in the encoding' },
    titles: {
      cycle: 'these issues wait on each other for ever',
      'stale-blocker': 'this waits on something already finished',
      'dead-duplicate-ref': 'this is filed against an issue that is gone',
      'encoding-refused': 'this declaration could not be read',
    },
    filter: 'narrow the list',
    // DELIBERATELY NOT THE FRAME'S WORDS. These fixtures use host wording that
    // no package string could be mistaken for, so a test asserting on a label
    // is asserting the word reached the markup rather than that the package
    // hard-coded the frame's copy. The demo carries §17d's actual labels.
    remedies: {
      pickEdge: 'choose an edge',
      openIssue: 'visit',
      removeEdge: 'drop it',
      keepAsHistory: 'leave it be',
      repoint: 'point it somewhere',
    },
    refusedOpen: 'see it upstream',
    refusedRewrite: 'fix it here',
  },
};

/**
 * A second, complete vocabulary: every string and every sentence the host
 * supplies, in other words (#156).
 *
 * FOR THE ANTI-COINCIDENCE PIN, as `picker/render.test.ts` has one. "Every
 * readable byte is a host word" passes vacuously on a render that happens to
 * echo {@link WORKSPACE_WORDS} by coincidence; rendering the same document
 * with this vocabulary and finding none of the first one's words left is what
 * proves each word came from the host. Every entry differs from its
 * counterpart, and none is an English word the package could write.
 */
export const OTHER_WORKSPACE_WORDS: WorkspaceWords = {
  change: {
    facets: {
      moved: 'lignes bougées',
      promoted: 'remontées',
      'newly-held': 'nouvellement bloquées',
      entered: 'arrivées',
      left: 'parties',
    },
    saved: "l'écriture est passée",
    unchanged: "cette modification n'a rien changé",
    computing: "écrit, l'ordre se calcule",
    dismiss: 'fermer le résumé',
    direction: { up: 'monte', down: 'descend' },
  },
  log: {
    label: 'écritures en cours',
    saving: "en cours d'écriture",
    notSaved: 'non enregistrée',
    removing: 'en cours de retrait',
    notRemoved: 'toujours là',
    show: 'montrer',
  },
  canvas: {
    focus: 'autour de',
    selected: 'choisi',
    selectedIssues: (count: number): string => `un lot de ${String(count)}`,
    of: 'sur',
    shown: 'dessinés ici',
    related: 'liés à lui',
    editMode: 'modifiable',
  },
  asOf: 'lu à',
  open: 'dans le carnet',
  encoded: 'portent des relations',
  inspector: 'le panneau de détail',
  workOrder: "l'ordre",
  showWorkOrder: "montrer l'ordre",
  closeWorkOrder: "fermer l'ordre",
  workOrderRanked: 'placés en file',
  workOrderAtATime: 'menés ensemble',
  nothingSelected: 'choisissez une ligne à examiner',
  issuesSelected: (count) => `${String(count)} tickets choisis`,
  clearSelection: 'vider la sélection',
  showCanvas: 'déplier le graphe',
  hideCanvas: 'ranger le graphe',
  relationships: 'relations',
  narrow: {
    order: 'file classée',
    related: 'tickets liés',
    subIssues: 'arbre des enfants',
    view: 'choix de vue',
    closeSheet: 'replier la feuille',
    around: 'centré sur',
    noSelection: 'choisissez un ticket pour voir ses liens',
    nothingRelated: "rien n'est encore lié ici",
  },
  whyRank: 'pourquoi ce rang',
  whyHeld: 'pourquoi bloqué',
  filteredEmpty: 'aucune ligne signalée ne correspond',
  filteredActive: 'réduit aux lignes signalées',
  filteredDenominator: (ranked) => `${String(ranked)} tickets sont classés`,
  filteredClear: 'retirer le filtre',
  positionOf: (rank: number, total: number): string => `${String(rank)} sur ${String(total)}`,
  positionTail: ({ partners, blockers }: { readonly partners: readonly string[]; readonly blockers: readonly string[] }): string => {
    const unit = partners.length === 0 ? null : `Mené avec ${partners.join(', ')} comme une seule unité`;
    const [only] = blockers;
    const after = blockers.length > 1 ? `après la fermeture des ${String(blockers.length)} tickets qui le bloquent` : only === undefined ? null : `après la fermeture de ${only}`;
    if (unit !== null && after !== null) return `${unit}, ${after}`;
    const clause = unit ?? after ?? '';
    return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`;
  },
  noRelationships: "rien n'est lié à ceci",
  showMore: (count: number): string => `Montrer ${String(count)} de plus`,
  relationshipsToDraw: 'genres à dessiner',
  relationshipsDrawn: (drawn: number, total: number): string => `${String(drawn)} dessinés sur ${String(total)}`,
  listedByRelationship: (count: number, issue: string): string =>
    `${String(count)} tickets touchent ${issue}, trop pour une image, donc listés par genre`,
  listedAroundSelected: (count: number, selected: number): string =>
    `${String(count)} tickets touchent les ${String(selected)} choisis, trop pour une image, donc listés par genre`,
  addRelationship: 'commencer une relation',
  addRelationshipHeading: 'ajouter une relation',
  cancel: 'abandonner le brouillon',
  relatingFrom: 'le brouillon part de',
  remove: 'délier cette ligne',
  inbound: 'déclaré ailleurs',
  flip: "la lire dans l'autre sens",
  refusals: {
    'self-edge': 'un ticket ne peut se lier à lui-même',
    'unknown-issue': "ce ticket n'est pas dans ce carnet",
    'unknown-edge': 'cette relation a déjà disparu',
    'duplicate-edge': 'cette relation est déjà déclarée',
    'unchanged-kind': "c'est déjà ce genre",
    'symmetric-edge': 'ce genre se lit pareil dans les deux sens',
    'cardinality': 'ce champ tient une seule référence',
    'would-cycle': 'cela fermerait une boucle',
    'guard-failed': "la vérification n'a pas pu tourner",
  },
  recovery: {
    failed: 'le suivi a refusé cette écriture',
    conflict: 'le ticket a bougé pendant la modification',
    viewDiff: 'comparer les deux versions',
    retry: 'renvoyer',
    retryOnLatest: 'lire la plus récente, puis renvoyer',
    discardMine: 'jeter ma modification',
    upstreamOnly: 'seulement chez eux',
    mineOnly: 'seulement chez moi',
    mineRemoved: 'seulement chez moi, retiré',
    carrierReversed: "déclaré depuis l'autre bout en amont",
    issuesChanged: 'tickets qui ont bougé',
    diffEmpty: 'rien ne diffère sur cette ligne',
    retryFailed: 'impossible de lire la version la plus récente',
  },
  audit: {
    heading: { one: "problème dans l'encodage", other: "problèmes dans l'encodage" },
    titles: {
      cycle: "ces tickets s'attendent pour toujours",
      'stale-blocker': 'ceci attend une chose déjà finie',
      'dead-duplicate-ref': 'ceci est rattaché à un ticket disparu',
      'encoding-refused': "cette déclaration n'a pas pu être lue",
    },
    filter: 'réduire la liste',
    remedies: {
      pickEdge: 'choisir un lien',
      openIssue: 'aller voir',
      removeEdge: 'le retirer',
      keepAsHistory: 'le laisser',
      repoint: 'le rediriger',
    },
    refusedOpen: 'voir en amont',
    refusedRewrite: 'corriger ici',
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

/**
 * `HUB`, blocked by each of `keys`, every issue titled `titleOf` its key.
 *
 * Every title the host's to choose, so a test can hand the list hostile text.
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
