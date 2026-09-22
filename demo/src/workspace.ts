/**
 * The sandbox — what is left of the host once the mount is the package's.
 *
 * `@issuegraph/editor` ships `mountWorkspace`: the listener wiring, the focus
 * source and restore, the keyboard routing, the canvas drag and the store
 * subscription all live there now, in the viewer's `mountViewer` shape. This
 * file used to be that shell, written once for this page; what remains is the
 * chrome that is genuinely the sandbox's — the writes log, the versions line,
 * the theme, canvas and document toggles, the armed dispatch outcome and the
 * reset — and
 * the two ports the mount takes from a host: the store, and the projection of
 * a snapshot onto the viewer's document and the audit's input.
 *
 * ## One listener, for the sandbox's own controls
 *
 * The mount reads every `data-ig-command` inside the element it was given and
 * nothing outside it. The controls above and beside the workspace publish the
 * same attribute, so one delegated `click` on the sandbox root reads them:
 * the commands the mount's reducer knows (`retry`, `discard`, `dismiss-change`
 * — the writes log's) are handed to it through `handle.dispatch`, and the ones
 * it does not (`theme`, `canvas`, `scenario`, `reset`, and the viewer's own
 * `refresh`) are the sandbox's own.
 *
 * ## `textContent`, everywhere
 *
 * Every string written here is host chrome built with `createElement` and
 * `textContent`; the package's markup is the mount's to assign. Nothing in
 * this file touches `innerHTML`.
 */

import {
  CANVAS_MODES,
  type CanvasMode,
  type EncodingRefusal,
  type FirstPassWords,
  type MountWords,
  type PickerWords,
  type WorkspaceHandle,
  type WorkspaceProjection,
  mountWorkspace,
} from '@issuegraph/editor';
import type { EdgeKind, GraphDocument, Store, StoreSnapshot, WriteRecord } from '@issuegraph/store';
import { type Theme, defaultTheme, extendTheme } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import { candidateSource, candidatesIn } from './firstpass.ts';
import {
  DEMO_STATE_LABELS,
  DEMO_STATE_NAMES,
  type DemoStateName,
  hostFacts,
  liftedByARead,
  runningSince,
  showsOrder,
} from './host.ts';
import { explainDocument } from './order.ts';
import {
  DEFAULT_SCENARIO,
  SCENARIOS,
  SCENARIO_NAMES,
  type Scenario,
  type ScenarioName,
  adoptionFor,
} from './seed.ts';
import type { DemoSource, NextOutcome } from './source.ts';
import { STAMPED_PACKAGES, VERSIONS } from './versions.ts';

/** The two themes the page offers: the package default, and the README's paper theme. */
export const THEMES = Object.freeze(['default', 'paper'] as const);
export type ThemeName = (typeof THEMES)[number];

/**
 * What each toggle SAYS, as distinct from what it is called.
 *
 * THE BUTTONS USED TO PRINT THE ENUM VALUE ITSELF — `default`, `paper`,
 * `neighbourhood`, `tree` — which is an identifier leaking onto the front door.
 * A first-time visitor reads "neighbourhood" and has no way to know it means
 * the relationship map; worse, it is one of the few British spellings on a
 * surface that is otherwise US English, and it is visible precisely because it
 * was never meant to be read.
 *
 * SEPARATE MAPS RATHER THAN A RENAMED VALUE. `CanvasMode` is
 * `@issuegraph/editor`'s published API and `ThemeName` is what `themeCss`
 * resolves; renaming either to fix a label would be a breaking change to a
 * package in service of a word on a page. The label is the host's, which is
 * exactly where the specification already puts the wording.
 */
export const THEME_LABELS: Readonly<Record<ThemeName, string>> = Object.freeze({
  default: 'Dark',
  paper: 'Light',
});

/** See `THEME_LABELS`. `neighbourhood` is the editor's value; "Work order" is what it draws. */
export const CANVAS_LABELS: Readonly<Record<CanvasMode, string>> = Object.freeze({
  neighbourhood: 'Work order',
  tree: 'Sub-issues',
});

/**
 * The scenario panel's one-line summary, one phrase per setting.
 *
 * THE PANEL STARTS SHUT, SO THIS IS WHAT MOST VISITORS READ OF IT. A collapsed
 * control that hides which backlog is loaded, or that the load is being faked,
 * leaves the reader looking at a broken-seeming demo with no clue why. So the
 * summary restates what is in force, in the same words as the buttons.
 *
 * THE SAVE OUTCOME APPEARS ONLY WHEN ARMED. "Saves" is the normal case and
 * saying so on every visit is noise; a refusal or a conflict waiting on the
 * next edit is exactly the thing a reader would otherwise walk into blind.
 */
const SUMMARY_SCENARIO: Readonly<Record<ScenarioName, string>> = Object.freeze({
  comp: 'Sample backlog',
  backlog: 'Big backlog',
  adoption: 'New repo',
});
const SUMMARY_STATE: Readonly<Record<DemoStateName, string>> = Object.freeze({
  live: 'load: fine',
  importing: 'load: still loading',
  empty: 'load: nothing to do',
  error: 'load: won\u2019t load',
  stale: 'load: old data',
});
const SUMMARY_CANVAS: Readonly<Record<CanvasMode, string>> = Object.freeze({
  neighbourhood: 'work order',
  tree: 'sub-issues',
});
const SUMMARY_OUTCOME: Readonly<Record<NextOutcome, string | null>> = Object.freeze({
  apply: null,
  reject: 'next save: refused',
  conflict: 'next save: conflict',
});

/** The shut panel's line, from the four settings in force. */
export function scenarioSummary(
  scenario: ScenarioName,
  state: DemoStateName,
  canvas: CanvasMode,
  outcome: NextOutcome,
): string {
  const parts = [SUMMARY_SCENARIO[scenario], SUMMARY_STATE[state], SUMMARY_CANVAS[canvas], SUMMARY_OUTCOME[outcome]];
  return parts.filter((part): part is string => part !== null).join(' \u00b7 ');
}

/** Each relationship as a phrase, so a picker reads as a sentence. */
export const KIND_PHRASE: Readonly<Record<EdgeKind, string>> = {
  'blocked-by': 'is blocked by',
  'serialize-with': 'serializes with',
  'together-with': 'goes together with',
  'duplicate-of': 'is a duplicate of',
  'decomposed-from': 'was decomposed from',
};

export const PICKER_WORDS: PickerWords = {
  kinds: KIND_PHRASE,
  heading: 'Relationship kind',
  current: 'current',
};

/**
 * What backlog this is, for §17a's header.
 *
 * A CONSTANT rather than a per-scenario field: every scenario is a different
 * document of the SAME sandbox, and giving each one a repository name would
 * dress a comparison surface up as four repositories.
 */
const SANDBOX_IDENTITY = 'issuegraph/sandbox';

/**
 * The first pass's vocabulary.
 *
 * Its own constant rather than an addition to `WORKSPACE_WORDS`: those are the
 * mount's, and these are the queue's — `FirstPassWords` is a separate type for
 * the same reason, and a host translating one surface should not have to read
 * past the other.
 *
 * The progress sentence is the one that matters. §17e insists "100% encoded is
 * never the goal", and `firstpass/words.ts` records why the wording is handed
 * over rather than defaulted: "12 of 64 complete" reads as a target where
 * "12 of 64 answered" reads as an activity. This host chooses the activity.
 */
const FIRST_PASS_WORDS: FirstPassWords = {
  label: 'Suggested relationships',
  answers: { apply: 'Yes, add it', reject: 'No', skip: 'Skip for now' },
  answersLabel: 'Your answer',
  undo: '⌫ Undo last answer',
  evidence: 'Why we’re asking',
  progress: (answered, found) => `${String(answered)} of ${String(found)} answered`,
  finished: 'That’s every suggestion. Nothing else is waiting.',
  noCandidates: 'The scan found no relationships to suggest.',
};

/** The words the packages refuse to invent. */
export const WORKSPACE_WORDS: MountWords = {
  // §17f's canvas caption, OPTIONAL IN THE PACKAGE AND SUPPLIED HERE for the
  // reason the `change` block below states in full: the demo is the one surface
  // anyone can actually try, so a feature the demo does not word ships dark.
  // Without these the canvas draws no caption and no edit-mode pill, and the
  // narrowing that makes the graph legible stays as silent as it was before.
  //
  // `editMode` IS SUPPLIED BECAUSE THIS HOST MOUNTS. The package leaves it
  // separately optional so markup served without `mountWorkspace` cannot claim
  // to be editable; this demo calls `mountWorkspace`, so the claim is true here.
  //
  // No colon after `focus` and no punctuation anywhere: the package draws its
  // own. Each word has to read on its own AND next to a number, because the two
  // counts sit between them.
  canvas: {
    focus: 'centered on',
    of: 'of',
    shown: 'shown',
    editMode: 'edit mode',
  },
  // §17a'S RAIL FOOTER. OPTIONAL IN THE PACKAGE AND SUPPLIED HERE, on `canvas`'s
  // reasoning: the vocabulary is optional so a host built before the footer
  // keeps rendering, and the demo is where it is proved real. Supplying it also
  // moves the isolated route out of the canvas ladder's chip and into the rail,
  // so this member is what makes the demo draw §17a's rail rather than the
  // ladder's own chrome — one count, one zone.
  //
  // `isolated` reads next to a number and never alone, like the canvas counts.
  rail: {
    isolated: 'with no relationships',
    show: 'show',
    hide: 'hide',
  },
  // §17c's re-evaluate loop. OPTIONAL IN THE PACKAGE AND SUPPLIED HERE, which
  // is the whole point: the vocabulary is optional so a host built before §17c
  // keeps rendering, and the demo is the proof the feature is real — without
  // these words a landed edit draws no summary, no dismiss control, no row
  // chips and no held-order label, and the loop would ship dark on the one
  // surface anyone can actually try.
  //
  // Worded for a reader rather than for a log: each facet has to read on its
  // own AND after a number, because `ChangeWords.facets` words both the summary
  // line and the per-row chips.
  change: {
    facets: {
      moved: 'moved',
      promoted: 'promoted',
      'newly-held': 'newly held',
      entered: 'entered the order',
      left: 'left the order',
    },
    unchanged: 'Saved. The order did not change.',
    // NOT "your edit is saved", WHICH THIS STATE DOES NOT MEAN. `held` is
    // `anyPending(records)`, and `dispatch` reserves the record as `pending`
    // and publishes BEFORE it drains — so this sentence is on screen while the
    // adapter can still reject, throw or come back with a conflict. Telling a
    // reader their edit is saved and then showing them a failure card is the
    // one thing the §17b recovery states exist to avoid.
    //
    // The frame's own title reads "write landed · order computing", and that is
    // the frame being about a state the store does not have: nothing publishes
    // "landed, still recomputing". So this words what `held` actually is.
    computing: 'Saving. The order below updates when the save is done.',
    dismiss: 'Dismiss',
    direction: { up: 'up', down: 'down' },
  },
  // §17a's header: `312 open · 64 encoded` and `as of 14:32 ↻`. The numbers are
  // the package's and these are the nouns beside them.
  asOf: 'as of',
  open: 'open',
  encoded: 'with relationships',
  // The frame draws the panel's name in caps; the caps are the stylesheet's, as
  // they are for every other heading in this zone, so the word reads as a word.
  loading: 'Loading your issues',
  inspector: 'Inspector',
  nothingSelected: 'Select an issue or a relationship to see its details.',
  clearSelection: 'Clear selection',
  // §17k's strip. Below 1120 the canvas collapses to a handle and this is the
  // handle's label, so it names the ZONE rather than a direction: the button is
  // a few characters wide, turned on its side, with nothing beside it to say
  // what it would open.
  showCanvas: 'Show the graph',
  hideCanvas: 'Hide the graph',
  relationships: 'Relationships',
  // §17a's inspector explains the position before it lists the relationships.
  // The frame draws the heading in caps; the caps are the stylesheet's, so the
  // words here read as words.
  whyRank: 'Position',
  whyHeld: 'Why it is held',
  // §17's filtered empty state, and the two strings are doing different jobs.
  // The first says what did not match. The second says what still EXISTS, and
  // it is the one that stops a reader concluding the backlog is empty when a
  // filter is merely narrow — RULINGS.md §2: the denominator is always present
  // "so 'nothing matched' can never be misread as 'nothing exists'."
  filteredEmpty: 'No flagged rows match.',
  filteredActive: 'Showing flagged rows only.',
  filteredDenominator: (ranked) =>
    // The plural is why the package hands over a count instead of a template.
    ranked === 1 ? '1 issue is ranked' : `${String(ranked)} issues are ranked`,
  filteredClear: 'Clear filter',
  workedAsOneUnit: 'worked together with',
  noRelationships: 'Nothing is related to this issue yet.',
  addRelationship: '+ add',
  addRelationshipHeading: 'Add relationship',
  cancel: 'Cancel',
  // WHOSE DRAFT THE KIND STEP BELONGS TO, when it is not the panel's subject:
  // a draft begun on a together unit's partner, or one the reader selected
  // away from. The panel appends the reference itself.
  relatingFrom: 'Adding a relationship to',
  // NAMES THE ACT, NOT THE ROW. The `✕` is repeated once per relationship and
  // the markup already says which one it is about, so a word naming a
  // particular reference would be wrong on every other row.
  remove: 'Remove this relationship',
  // WHY THERE IS NO CONTROL BESIDE IT, said plainly rather than left as a gap.
  // An inbound relationship is declared in the other issue's body, so it cannot
  // be removed from this panel.
  inbound: 'set on the other issue',
  // §17b's flip, on the selected relationship's row. A VERB PHRASE rather than
  // the frame's bare "flip", because the row it sits in is a sentence and a
  // one-word control there reads as part of it.
  flip: 'Flip direction',
  // The store's codes, worded for someone grooming a backlog rather than for
  // someone reading the store. `would-cycle` is the one this host's guard
  // actually produces; the rest are refused before dispatch.
  refusals: {
    'self-edge': 'An issue cannot be related to itself.',
    'unknown-issue': 'That issue is not in this backlog.',
    'unknown-edge': 'That relationship is no longer there.',
    'duplicate-edge': 'That relationship is already declared.',
    'unchanged-kind': 'It is already that kind of relationship.',
    'symmetric-edge': 'That kind of relationship reads the same both ways.',
    'cardinality': 'This issue can only have one of those, and it already has one.',
    'would-cycle': 'That would make the two issues block each other.',
    'guard-failed': 'Could not check for a loop, so nothing was saved.',
  },
  // §17b's RECOVERY CARDS, worded for someone grooming a backlog. Both of these
  // states are reachable from the page's own controls: the writes panel arms
  // the next dispatch to reject or to conflict.
  //
  // "RETRY ON LATEST" IS SPELLED OUT, because it is not the same act as a plain
  // retry: it re-reads the issue first and sends the edit against what it finds.
  // A visitor who reads it as "try again" would be surprised by the order
  // moving, which it can — the base really did change.
  recovery: {
    failed: 'This edit was not saved.',
    conflict: 'This issue changed while you were editing it.',
    viewDiff: 'Compare',
    retry: 'Retry',
    retryOnLatest: 'Redo on the latest version',
    discardMine: 'Discard my edit',
    upstreamOnly: 'Only theirs',
    mineOnly: 'Only yours',
    mineRemoved: 'You removed',
    // WHICH END DECLARES IT. Both documents hold the relationship; they
    // disagree about whose body it is written in, which the identity hides.
    carrierReversed: 'They set it from the other issue',
    issuesChanged: 'Issues that changed',
    // NOT "no changes". The difference is narrowed to the panel you are on, so
    // an empty one means the upstream edit was somewhere else in the backlog —
    // which is a different fact, and the one a groomer needs.
    diffEmpty: 'Nothing on this issue is different. Their change was somewhere else.',
    retryFailed: 'Could not read the latest version:',
    unplaced: 'Unsaved edits to issues that are no longer here',
  },
  // §17d's FINDINGS LIST. The chips are the frame's own four words; the titles
  // say the CONSEQUENCE rather than restating the finding, because the sentence
  // under each one already names the issues and what is declared between them.
  //
  // THE FRAME'S TITLES ARE PER FINDING and these are per class — "#533 is
  // blocked by an issue closed 4 months ago" needs a date and a reference the
  // finding does not carry, and this package appends numbers rather than
  // interpolating them. So the title says what is true of every finding in its
  // class and the detail beneath it says which issues.
  audit: {
    heading: 'problems to fix',
    classes: {
      cycle: 'loop',
      'stale-blocker': 'closed blocker',
      'dead-duplicate-ref': 'closed original',
      'encoding-refused': 'unreadable',
    },
    titles: {
      cycle: 'These issues block each other in a loop.',
      'stale-blocker': 'This waits on an issue that is already closed.',
      'dead-duplicate-ref': 'This is a duplicate of a closed issue, so nothing tracks its work.',
      'encoding-refused': 'Some of this issue\u2019s relationships could not be read.',
    },
    show: 'Show',
    // §17d's own entry point, drawn in the panel head: `filter the rail to
    // these`. It used to ride the header count; §3 gave that count one job.
    filter: 'Show only these in the list',
    // §17d's REMEDY LABELS, and these ARE the frame's own words rather than a
    // paraphrase: the frame draws `pick one edge to drop`, `Remove the edge`,
    // `Keep as history` and `Repoint or clear`. Unlike the titles above, they
    // need no per-finding detail to make sense, so there is nothing to
    // generalise away.
    remedies: {
      pickEdge: 'Pick one to remove',
      removeEdge: 'Remove the relationship',
      keepAsHistory: 'Keep as history',
      repoint: 'Change or remove',
    },
    refusedHeading: 'Could not be read',
    refusedOpen: 'Open in GitHub',
    refusedRewrite: 'Rewrite here',
  },
  picker: PICKER_WORDS,
  deleteRelationship: 'Delete this relationship',
  chooseKind: 'Choose the kind',
  targetLabel: 'Target issue',
  targetPlaceholder: 'Issue number or title',
  // `R` IS LISTED HERE AS WELL AS ON THE CONTROL, and the duplication is the
  // lesser fault. Dropping it was tried first, on the reasoning that a hint
  // beside the control makes the legend's copy redundant — but the two make
  // DIFFERENT claims. The control's hint says what THAT control's key is, and
  // the control is conditional: no `+ add` is drawn with an edge selected, with
  // nothing selected, or at the kind step. `keyIntent` begins a relationship
  // from the rail's focused row, so `R` keeps working in every one of those
  // states, and a legend that omits it tells the reader a key they have is a
  // key they do not.
  keys: 'R add · 1–5 pick kind · type to search · ⏎ save · ⌫ delete · T change kind · Esc cancel',
};

/**
 * The second theme: the paper palette the viewer's README documents, so the
 * switcher proves the contract the Descant embed relies on — redeclare the
 * tokens, touch nothing else. The exact values are the README's, which the
 * viewer's acceptance test also renders, so this cannot drift from what is
 * tested.
 */
export const PAPER_THEME: Theme = extendTheme(defaultTheme, {
  colors: {
    '--ig-bg': '#FBFAF7',
    '--ig-surface': '#FFFFFF',
    '--ig-surface-2': '#F2F0EA',
    '--ig-line': '#D9D4C7',
    '--ig-text': '#1B1A17',
    '--ig-text-body': '#3B3A35',
    '--ig-text-muted': '#5E5B52',
    '--ig-accent': '#0A5B8A',
    '--ig-focus': '#0A5B8A',
    '--ig-station-ready': '#0A5B8A',
    '--ig-station-pending': '#5E5B52',
    '--ig-station-held': '#8A857A',
    '--ig-edge-blocked-by': '#A32020',
    '--ig-edge-serialize-with': '#7A5A00',
    '--ig-edge-together-with': '#0A5B8A',
    '--ig-edge-duplicate-of': '#6B2E9E',
    '--ig-edge-decomposed-from': '#A31257',
  },
});

export function themeFor(name: ThemeName): Theme {
  return name === 'paper' ? PAPER_THEME : defaultTheme;
}

const UNSETTLED: ReadonlySet<WriteRecord['state']> = new Set(['pending', 'invalid', 'failed', 'conflict']);

const STATE_LABEL: Readonly<Record<WriteRecord['state'], string>> = {
  pending: 'saving',
  invalid: 'not saved: the change is not allowed',
  failed: 'not saved: the tracker refused it',
  conflict: 'not saved: someone else changed it first',
};

/** The commands the mount's reducer owns that the writes log publishes outside the mount. */
const FORWARDED: ReadonlySet<string> = new Set(['retry', 'discard', 'dismiss-change']);

/**
 * Commands published INSIDE the mounted workspace that are the host's to act
 * on. The viewer draws the freshness stamp's refresh control and wires nothing
 * to it — refreshing a mirror is fetching, which the packages never do — and
 * the mount's reducer answers a command it does not know by changing nothing.
 * So the click reaches this listener, and this set is what admits it past the
 * "inside the mount, the mount owns it" rule below.
 */
export const HOST_COMMANDS_FROM_WORKSPACE: ReadonlySet<string> = new Set([
  'refresh',
  // THE CONDITION'S AND THE ADOPTION LINE'S CONTROLS, admitted the same way and
  // for the same reason. Without membership here the click is dropped by the
  // rule above BEFORE it reaches the switch, which is a control that looks
  // wired and silently is not — the exact failure the viewer refuses to draw.
  //
  // `retry:index`, NOT `retry`. The bare word is already the mount reducer's,
  // for retrying a WRITE, and it is in `FORWARDED` two lines up: admitting it
  // here would hand the viewer's index retry to the writes log.
  'retry:index',
  'review-pick-order',
  'dismiss:adoption',
]);

const OUTCOMES: ReadonlySet<string> = new Set(['apply', 'reject', 'conflict']);

function isOutcome(value: string): value is NextOutcome {
  return OUTCOMES.has(value);
}

function isDemoState(value: string | null): value is DemoStateName {
  return DEMO_STATE_NAMES.some((name) => name === value);
}

function isTheme(value: string | null): value is ThemeName {
  return value === 'default' || value === 'paper';
}

function isCanvasMode(value: string | null): value is CanvasMode {
  return value === 'neighbourhood' || value === 'tree';
}

function isScenario(value: string | null): value is ScenarioName {
  return SCENARIO_NAMES.some((name) => name === value);
}

export interface Live {
  readonly store: Store;
  readonly source: DemoSource;
}

export interface SandboxElements {
  /** The container every sandbox listener is attached to; holds all of the below. */
  readonly root: HTMLElement;
  /** The element the workspace is mounted into. The mount installs its own stylesheet there. */
  readonly workspace: HTMLElement;
  readonly writes: HTMLElement;
  readonly versions: HTMLElement;
  readonly outcome: HTMLSelectElement;
}

export interface SandboxState {
  readonly theme: ThemeName;
  readonly canvas: CanvasMode;
  /** Which document is loaded: the §16 comp the page lands on, or the big backlog behind the control. */
  readonly scenario: ScenarioName;
  /** The mount's own state — the selection, the draft, the scale, the rail window. */
  readonly workspace: WorkspaceHandle['state'];
}

export interface SandboxHandle {
  readonly state: () => SandboxState;
  destroy(): void;
}

/**
 * The host's projection, from ONE derivation, for one scenario.
 *
 * `explainDocument` is the same `@issuegraph/derive` call the store's deriver
 * runs — over the same holds and the same base ranking, which are the
 * scenario's — so the viewer's rows, the audit's cycles and the store's order
 * cannot disagree. The landed document is `{ issues, edges: landed }` — never
 * the projection with its unsettled edits, because the order must not move for
 * an edit that did not land. The mount adds the unsettled edges to the canvas
 * itself, from the store's own projection.
 */
/** The moments the host facts are read against: the last mirror read, the clock, and the page's mount. */
export interface HostMoments {
  readonly observedAt: () => Date;
  readonly now: () => Date;
  readonly mountedAt: Date;
  /**
   * Which state the panel is being drawn in, READ AT PROJECTION TIME.
   *
   * A getter, like the clock beside it, because `projectFor` is bound once per
   * mount and the state changes between renders: a value captured here would
   * pin the panel to whatever was selected when the store was built, and the
   * control would move nothing until the document changed.
   */
  readonly state: () => DemoStateName;
  /** Whether the visitor has dismissed this document's adoption line. */
  readonly dismissed: () => boolean;
}

function projectFor(scenario: Scenario, moments: HostMoments): (snapshot: StoreSnapshot) => WorkspaceProjection {
  return (snapshot) => {
    // A HOST THAT SAYS NOTHING IS ELIGIBLE SHOWS NOTHING. See `showsOrder`: it
    // is the one state that contradicts a populated order rather than
    // qualifying it, so the host projects what it claims to have.
    const shown = showsOrder(moments.state());
    // TWO DOCUMENTS, BECAUSE THEY ANSWER TWO QUESTIONS. `held` is the whole
    // repository the store carries; `landed` is what this panel DRAWS, which
    // the empty state deliberately blanks. Adoption is a fact about the
    // repository — how much of the backlog declares relationships — so blanking
    // the order must not blank it: a panel saying "nothing is eligible" over a
    // full backlog would then also claim that backlog declares nothing.
    const held = { issues: snapshot.issues, edges: snapshot.landed };
    const landed = shown ? held : { issues: [], edges: [] };
    const explained = explainDocument(landed, scenario.holds, scenario.ranking);
    // THE AUDIT READS THE REPOSITORY, and reads it whole: its own document AND
    // its own probes over that document. Where the panel draws what it holds
    // these are the same reading and cost nothing; where it does not, auditing
    // one graph with another graph's answers is the failure to avoid.
    const audited = {
      document: held,
      explained: shown ? explained : explainDocument(held, scenario.holds, scenario.ranking),
      // §17d'S FOURTH CLASS, AND IT IS A FIXTURE RATHER THAN A READING. The
      // demo parses no issue bodies — it builds its backlog from seed data — so
      // nothing here can genuinely refuse a declaration, and without an authored
      // one the refused block has nothing to draw on any scenario. A real host
      // passes its reader's own answer.
      //
      // ATTACHED TO THE FIRST ISSUE THE BACKLOG ACTUALLY HOLDS, so the block's
      // rewrite control has a row to reach: the control is withheld for a ref
      // the drawn document does not carry, which is correct and would have made
      // the fixture silently draw half a card.
      encodingRefused: refusalFor(held),
    };
    // THE HOST FACTS, from the same explained order the slots come from, so the
    // header's tally and the rows beneath it are one derivation. The running
    // job is the scenario's; its start is anchored to the mount, once.
    const host = hostFacts({
      rows: explained.rows,
      observedAt: moments.observedAt(),
      now: moments.now(),
      running:
        !shown || scenario.running === undefined ? undefined : runningSince(scenario.running, moments.mountedAt),
      state: moments.state(),
      // AGAINST THE DOCUMENT ON SCREEN, not the one the module loaded with: the
      // store lets a visitor add and delete relationships, and a count captured
      // at boot describes a backlog that no longer exists after the first edit.
      adoption: adoptionFor(scenario, held, moments.dismissed()),
      identity: SANDBOX_IDENTITY,
      // THE ENTRY IS DRAWN ONLY WHEN THE SCAN HAS SOMETHING. §17e's queue is
      // "the make-or-break adoption moment", and a way in that opens on
      // "nothing to encode" is the opposite of that promise. The detector is
      // asked here rather than guessed at, over the document on screen.
      firstPass: candidatesIn(held).length === 0 ? undefined : 'Scan for relationships →',
    });
    return projectDocument(explained, landed, host, scenario.caveats, audited);
  };
}

/**
 * One authored refusal, on an issue the backlog holds.
 *
 * SEPARATE FROM THE SCENARIOS ON PURPOSE. A refusal is not a property of a
 * backlog's SHAPE — every scenario here is a well-formed seed — so it belongs
 * beside the projection that needs one rather than in the seed data, where it
 * would read as something the reader found.
 *
 * EMPTY FOR AN EMPTY BACKLOG. The first-import scenario draws no rows at all,
 * and a refusal naming an issue that is not there would render a card whose
 * only control is withheld — a dead entry in the one state whose whole point is
 * that there is nothing yet.
 */
function refusalFor(held: GraphDocument): readonly EncodingRefusal[] {
  const first = held.issues[0];
  if (first === undefined) return [];
  return [
    {
      ref: first.ref,
      diagnostic: 'line 3 could not be read',
      sourceLine: 'blocked-by: [231, 234',
    },
  ];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function button(label: string, command: string, attributes: Readonly<Record<string, string>> = {}): HTMLButtonElement {
  return el('button', { type: 'button', class: 'chrome-button', 'data-ig-command': command, ...attributes }, [label]);
}

/**
 * A relationship's identity, read back as the sentence it stands for.
 *
 * THE LOG PRINTED THE RAW IDENTITY — `blocked-by|512|488` — which is a storage
 * key, not something a reader can check against the screen. The identity is
 * `@issuegraph/core`'s own three-part form, so it is split rather than looked
 * up; anything that does not parse is printed as it came, never dropped.
 */
function edgeSentence(edgeId: string): string {
  const [kind, from, to] = edgeId.split('|');
  if (kind === undefined || from === undefined || to === undefined || !(kind in KIND_PHRASE)) return edgeId;
  return `#${decodeURIComponent(from)} ${KIND_PHRASE[kind as EdgeKind]} #${decodeURIComponent(to)}`;
}

/** One write, as a sentence. Exhaustive over `Proposal['op']`, so a sixth op fails here. */
function describe(record: WriteRecord): string {
  const mutation = record.mutation;
  switch (mutation.op) {
    case 'create':
      return `Add: #${mutation.from} ${KIND_PHRASE[mutation.kind]} #${mutation.to}`;
    case 'delete':
      return `Delete: ${edgeSentence(mutation.edgeId)}`;
    case 'retype':
      return `Change: ${edgeSentence(mutation.edgeId)}, now ${KIND_PHRASE[mutation.nextKind]}`;
    case 'flip':
      return `Flip: ${edgeSentence(mutation.edgeId)}`;
  }
}

/** Mount the sandbox. `boot` builds a fresh store and source over a scenario, and is called again on reset and on a scenario change. */
export interface SandboxOptions {
  /** The clock the host facts read. The page passes the real one; a test passes a fixed one. */
  readonly clock?: () => Date;
  /** How often the clock-derived facts are redrawn. Defaults to {@link CLOCK_TICK_MS}. */
  readonly tickMs?: number;
}

/**
 * How often the page redraws for the clock alone.
 *
 * The elapsed time on the NOW row, the stamp's age and the `stale` threshold
 * are all functions of `now`, and `now` is read only when a projection runs —
 * so a page left open with nothing happening froze at its first values and
 * never went stale. Once a minute is the coarsest tick that keeps a
 * minute-resolution stamp honest.
 */
export const CLOCK_TICK_MS = 60_000;

export function mountSandbox(
  elements: SandboxElements,
  boot: (scenario: Scenario, onChange: () => void) => Live,
  options: SandboxOptions = {},
): SandboxHandle {
  const { root, workspace, writes, versions, outcome } = elements;
  const clock = options.clock ?? ((): Date => new Date());
  const tickMs = options.tickMs ?? CLOCK_TICK_MS;
  // WHEN THE MIRROR WAS LAST READ — the `as of` stamp. Set when the store
  // hydrates and again on every refresh, which is the only two times this
  // trackerless demo has anything that reads as a mirror read.
  let observedAt: Date = clock();
  const mountedAt: Date = observedAt;
  const moments: HostMoments = {
    observedAt: () => observedAt,
    now: clock,
    mountedAt,
    state: () => panelState,
    dismissed: () => adoptionDismissed,
  };

  let theme: ThemeName = 'default';
  let canvas: CanvasMode = 'neighbourhood';
  let scenario: ScenarioName = DEFAULT_SCENARIO;
  let panelState: DemoStateName = 'live';
  // THE HOST HIDES ITS OWN LINE, NOT THE VIEWER. Dismiss is published like every
  // other command and the package never removes an element it drew; the host
  // re-projects without the note, which is the only place that state can live.
  let adoptionDismissed = false;
  let live: Live;
  let handle: WorkspaceHandle | null = null;
  let unsubscribe = (): void => {};
  let pending = false;
  let destroyed = false;

  // COALESCED ON A MICROTASK, for the mount's reason: one redraw per task, and
  // never a frame, which stalls while the tab is hidden.
  const schedule = (): void => {
    if (pending || destroyed) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      renderChrome();
    });
  };

  const renderWrites = (snapshot: StoreSnapshot): void => {
    writes.replaceChildren();
    const unsettled = snapshot.writes.filter((record) => UNSETTLED.has(record.state));
    // THE ORDER'S STATUS AND THE LAST CHANGE ARE THE WORKSPACE'S NOW, and they
    // used to be drawn here as well. Supplying `words.change` gave the mount
    // §17c, so this panel was restating both: two summaries and two
    // `dismiss-change` buttons for one edit — and this section is
    // `aria-live="polite"`, so a screen reader heard the result twice.
    //
    // #135's rule, one zone over: each host fact is stated in exactly one
    // place. This log keeps what the workspace does NOT draw — the unsettled
    // records with their §17b recovery controls — and nothing else.
    if (unsettled.length === 0) return;
    const list = el('ul', { class: 'writes-list' });
    for (const record of unsettled) {
      const row = el('li', { class: 'write', 'data-state': record.state });
      row.append(
        el('span', { class: 'write-op' }, [describe(record)]),
        el('span', { class: 'write-state' }, [STATE_LABEL[record.state]]),
      );
      if (record.state === 'invalid') row.append(el('span', { class: 'write-reason' }, [record.reason.message]));
      if (record.state === 'failed') row.append(el('span', { class: 'write-reason' }, [record.reason]));
      if (record.state === 'failed' || record.state === 'conflict') {
        row.append(button(record.state === 'conflict' ? 'Redo on the latest version' : 'Retry', 'retry', { 'data-ig-target': record.mutationId, class: 'chrome-button chrome-inline' }));
      }
      if (record.state !== 'pending') {
        row.append(button('Discard my edit', 'discard', { 'data-ig-target': record.mutationId, class: 'chrome-button chrome-quiet chrome-inline' }));
      }
      list.append(row);
    }
    writes.append(list);
  };

  const renderChrome = (): void => {
    if (destroyed) return;
    renderWrites(live.store.getSnapshot());
    outcome.value = live.source.armed();
    document.documentElement.setAttribute('data-theme', theme);
    // The masthead toggles read as pressed for the value in force.
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-chrome="theme"] [data-ig-value]')) {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('data-ig-value') === theme));
    }
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-chrome="canvas"] [data-ig-value]')) {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('data-ig-value') === canvas));
    }
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-chrome="scenario"] [data-ig-value]')) {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('data-ig-value') === scenario));
    }
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-chrome="state"] [data-ig-value]')) {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('data-ig-value') === panelState));
    }
    // OPTIONAL, like every other chrome hook here: a host page without the
    // scenario panel has nothing to summarise, and the sandbox runs regardless.
    const summary = root.querySelector('[data-chrome="summary"]');
    if (summary !== null) summary.textContent = scenarioSummary(scenario, panelState, canvas, live.source.armed());
  };

  /** Build a fresh store over the current scenario and mount the workspace over it. Called at start, on reset, and when the scenario changes. */
  const start = (): void => {
    unsubscribe();
    handle?.destroy();
    const loaded = SCENARIOS[scenario];
    live = boot(loaded, schedule);
    unsubscribe = live.store.subscribe(schedule);
    handle = mountWorkspace(workspace, {
      store: live.store,
      project: projectFor(loaded, moments),
      words: WORKSPACE_WORDS,
      theme: themeFor(theme),
      canvas,
      // THE HOST'S HALF OF THE FIRST PASS: a detector the package refuses to
      // ship, and the five words it refuses to invent. Read against the store's
      // CURRENT document, not the one this closure was built with.
      // WHERE AN ISSUE LIVES, WHICH ONLY A HOST KNOWS. The package holds an
      // opaque ref and no repository identity, so §17d's outward link is drawn
      // only for a URL supplied here — and only if it passes the viewer's
      // scheme allowlist.
      //
      // THE TRACKER RATHER THAN A PER-ISSUE ADDRESS, BECAUSE THE REFS ARE
      // FICTIONAL. This backlog is seeded, so a composed
      // `.../issues/<ref>` would be a link to nothing dressed as a real one —
      // worse in a sandbox than a link that plainly goes to the project's own
      // issues. A real host composes the per-issue URL it actually has.
      issueUrl: () => 'https://github.com/autnmy/issuegraph/issues',
      firstPass: {
        source: candidateSource(() => {
          const snapshot = live.store.getSnapshot();
          return { issues: snapshot.issues, edges: snapshot.landed };
        }),
        words: FIRST_PASS_WORDS,
        exit: 'Stop anytime',
        scanning: 'Scanning your issues for relationships…',
        scanFailed: 'The scan failed. Close this and try again.',
      },
    });
    // ONE RENDER, once the store has answered: `read` schedules it.
    void read(true);
  };

  /**
   * Read the mirror: load the store and stamp the read.
   *
   * THE STAMP HAS TO REACH THE WORKSPACE, and the store's own notification
   * does not carry it: the store publishes to its subscribers synchronously,
   * INSIDE the load, so the mount has already projected — with the OLD
   * `observedAt` — by the time the await returns. Re-stamping and redrawing
   * only the chrome left the drawn `as of` one read behind, every time. The
   * mount's `update()` re-runs the projection with the new stamp.
   *
   * THREE THINGS A STAMP MUST NOT CLAIM. A read that FAILED is not a read: the
   * store resolves either way and says why in `hydrationError`, so the stamp
   * moves only when it is undefined. A completion from a store the sandbox has
   * since replaced (reset, scenario change) is about a document no longer on
   * screen, so it stamps nothing. And the FIRST load is `hydrate()` while every
   * later one is `rehydrate()`, which keeps the last good document and the
   * store ready when the source refuses — `hydrate()` again would fail it.
   */
  const read = async (initial: boolean): Promise<void> => {
    const store = live.store;
    const owner = handle;
    await (initial ? store.hydrate() : store.rehydrate());
    if (store !== live.store || owner !== handle) return;
    if (store.getSnapshot().hydrationError === undefined) {
      observedAt = clock();
      // A FORCED STATE LIFTS WITH THE STAMP IT CONTRADICTS, in the one place
      // that already knows a read landed. Two things this gets right that
      // clearing at the click did not: a refresh that FAILED leaves
      // `observedAt` untouched and must leave the state with it, and EVERY
      // state a read refutes is lifted rather than whichever one was last
      // reported — see `liftedByARead`.
      if (liftedByARead(panelState)) panelState = 'live';
      handle?.update();
    }
    schedule();
  };

  // --- the sandbox's own controls ---

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>('[data-ig-command]') ?? null;
    if (control === null || !root.contains(control)) return;
    const name = control.getAttribute('data-ig-command') ?? '';
    // Inside the mounted element the mount owns every command; this listener
    // reads only the chrome around it — and the few commands the packages
    // publish for the HOST to act on (`HOST_COMMANDS_FROM_WORKSPACE`).
    if (workspace.contains(control) && !HOST_COMMANDS_FROM_WORKSPACE.has(name)) return;
    const value = control.getAttribute('data-ig-value');
    if (handle === null) return;
    if (FORWARDED.has(name)) {
      handle.dispatch({ kind: 'control', name, target: control.getAttribute('data-ig-target') ?? undefined });
      return;
    }
    switch (name) {
      case 'theme':
        if (!isTheme(value)) return;
        theme = value;
        handle.update({ theme: themeFor(theme) });
        schedule();
        return;
      case 'canvas':
        if (!isCanvasMode(value)) return;
        canvas = value;
        handle.update({ canvas });
        schedule();
        return;
      case 'scenario':
        // A scenario is a different DOCUMENT, so it is a fresh store rather
        // than an update — the mount reads one store for its lifetime, and a
        // visitor's unsettled edits belong to the document they were made on.
        if (!isScenario(value) || value === scenario) return;
        scenario = value;
        // A NEW DOCUMENT GETS ITS LINE BACK. The dismissal was of THIS
        // document's note, and carrying it across would hide a sentence the
        // visitor has not seen yet.
        adoptionDismissed = false;
        start();
        return;
      case 'state':
        // A state is the same document seen differently, so it is a re-project
        // rather than a fresh store: the visitor's edits survive the switch.
        if (!isDemoState(value) || value === panelState) return;
        panelState = value;
        handle.update({});
        schedule();
        return;
      case 'retry:index':
        // A RETRY IS A READ, so it performs one and lets the read speak. It used
        // to clear the state at the click, which is the same optimism that made
        // a failed refresh look successful: a retry that cannot reach the
        // tracker must leave the panel saying the index could not be read.
        void read(false);
        return;
      case 'review-pick-order':
        // NOT A READ, so no read lifts it. This sandbox has no pick-order chrome
        // to route to, and the page says so; leaving the state is the one thing
        // the control can honestly do here.
        panelState = 'live';
        handle.update({});
        schedule();
        return;
      case 'dismiss:adoption':
        adoptionDismissed = true;
        handle.update({});
        schedule();
        return;
      case 'reset':
        start();
        return;
      case 'refresh':
        // A REFRESH THAT CANNOT MAKE THE STAMP FRESH IS A CONTROL THAT LIES.
        // `stale` is drawn by dating the read further back on every render, so
        // a successful re-read landed and the panel still said "stale · 17m
        // ago" — the one affordance §16g gives that state, doing nothing a
        // reader could see. `read` lifts every such state when the read LANDS,
        // beside the stamp, because that is the event; doing it here would move
        // the state before the evidence and make a failed refresh look
        // successful.
        void read(false);
        return;
      default:
        return;
    }
  };

  const onChange = (event: Event): void => {
    if (event.target !== outcome || !isOutcome(outcome.value)) return;
    live.source.arm(outcome.value);
    // Arming writes nothing, so the store will not ask for a redraw — but the
    // shut panel's summary names an armed outcome, and has to say so now.
    renderChrome();
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  // THE CLOCK MOVES WHEN NOTHING ELSE DOES. `update()` re-runs the projection,
  // which reads `now`; cleared in `destroy()`, so a torn-down sandbox draws
  // nothing and holds no timer.
  const ticking = setInterval(() => {
    if (!destroyed) handle?.update();
  }, tickMs);

  versions.replaceChildren(
    ...STAMPED_PACKAGES.map((name) =>
      // THE SHORT NAME, WITH THE SCOPE IN THE TITLE. Six rows of the same
      // `@issuegraph/` prefix is the prefix read six times; the full name is
      // still one hover away for anyone matching it against a lockfile.
      el('span', { class: 'version', title: `@issuegraph/${name}` }, [`${name} `, el('strong', {}, [VERSIONS[name]])]),
    ),
  );

  // The masthead's own controls publish commands too, so the one listener covers them.
  for (const control of root.querySelectorAll<HTMLElement>('[data-chrome="theme"]')) {
    control.replaceChildren(
      ...THEMES.map((name) =>
        button(THEME_LABELS[name], 'theme', { 'data-ig-value': name, class: 'chrome-button chrome-toggle' }),
      ),
    );
  }
  for (const control of root.querySelectorAll<HTMLElement>('[data-chrome="canvas"]')) {
    control.replaceChildren(
      ...CANVAS_MODES.map((name) =>
        button(CANVAS_LABELS[name], 'canvas', { 'data-ig-value': name, class: 'chrome-button chrome-toggle' }),
      ),
    );
  }
  for (const control of root.querySelectorAll<HTMLElement>('[data-chrome="scenario"]')) {
    control.replaceChildren(
      ...SCENARIO_NAMES.map((name) =>
        button(SCENARIOS[name].label, 'scenario', { 'data-ig-value': name, class: 'chrome-button chrome-toggle' }),
      ),
    );
  }
  // ORTHOGONAL TO THE DOCUMENT, so it is its own row rather than more entries in
  // the one above: a repository can be importing or unreadable whatever backlog
  // it holds, and folding the two would make the control a matrix.
  for (const control of root.querySelectorAll<HTMLElement>('[data-chrome="state"]')) {
    control.replaceChildren(
      ...DEMO_STATE_NAMES.map((name) =>
        button(DEMO_STATE_LABELS[name], 'state', { 'data-ig-value': name, class: 'chrome-button chrome-toggle' }),
      ),
    );
  }

  start();

  return {
    state: () => {
      if (handle === null) throw new Error('the sandbox is not mounted');
      return { theme, canvas, scenario, workspace: handle.state };
    },
    destroy: () => {
      destroyed = true;
      clearInterval(ticking);
      unsubscribe();
      handle?.destroy();
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
    },
  };
}
