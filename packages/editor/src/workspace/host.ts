/**
 * The workspace's host reducer — every decision a mount makes, with no DOM.
 *
 * `renderWorkspace` renders and publishes: each control says what it does as
 * `data-ig-command`, and the viewer publishes its two identities, `data-ig-key`
 * and `data-ig-group`. This file is the DECISIONS a mount takes on reading
 * them. The shell in `mount.ts` reads the DOM and turns what it saw into a
 * {@link HostCommand}; this file turns the command into the next state and a
 * list of {@link HostEffect}s the shell then performs against the store.
 *
 * It composes the package's own reducers — `selectionReducer`, `scaleReducer`,
 * `createReducer`, `pickerView` — and adds only what those leave to a mount:
 * which one selection is shared, when the create draft begins and ends, the
 * rail's scroll offset, and the drag that turns a canvas drop into a draft.
 * Nothing here reaches a node, so all of it runs under `node --test` with no
 * DOM, which is the property the package's other reducers are shaped for and
 * the reason this is not written into listeners.
 *
 * ## Lifted from the demo, and why
 *
 * This was the demo's `host.ts`, written once for that page. A second host
 * re-implemented it from scratch and re-ran the review rounds that shaped it;
 * the design kit's layer rule puts the interaction shell in layer 2, not in
 * the host. What stayed behind in the demo is exactly what was demo-shaped:
 * the theme switch, the armed dispatch outcome, and the sandbox reset — none
 * of which a host reducer should know about, and each of which the demo now
 * handles beside the mount rather than through it.
 */

import { type EdgeField, edgeIdentityEnd, isEdgeField } from '@issuegraph/core';
import type { EdgeId, GraphDocument, MutationId, Proposal, StoredEdge, StoredIssue } from '@issuegraph/store';
import { findEdge } from '@issuegraph/store';

import { type CreateDraft, IDLE_CREATE_DRAFT, createReducer } from '../create/draft.ts';
import type { KeyIntent } from '../create/keys.ts';
import type { Point } from '../create/placement.ts';
import type { CandidateId } from '../firstpass/candidates.ts';
import { type Answer, type QueueResult } from '../firstpass/queue.ts';
import { pickerView } from '../picker/view.ts';
import { INITIAL_SCALE_STATE, type ScaleState, scaleReducer } from '../scale/commands.ts';
import {
  type FirstPassCommand,
  type FirstPassState,
  INITIAL_FIRST_PASS,
  firstPassReducer,
} from './firstpass.ts';
import {
  INITIAL_SELECTION,
  type WorkspaceSelection,
  selectedEdgeId,
  selectedKey,
  selectionReducer,
} from './selection.ts';

export interface HostState {
  readonly selection: WorkspaceSelection;
  readonly scale: ScaleState;
  readonly auditFiltered: boolean;
  /** The rail window's first slot — a scroll offset in rows, never a rank. */
  readonly railStart: number;
  readonly draft: CreateDraft;
  /** What the reader has typed into the target search. */
  readonly targetQuery: string;
  /** The issue a canvas drag started on, while the pointer is down. */
  readonly drag: string | null;
  /** Where a canvas drop landed, so the kind chooser can be placed there. */
  readonly drop: Point | null;
  /** The first-pass surface: shut, scanning, failed, or holding a queue. */
  readonly firstPass: FirstPassState;
  /**
   * Which conflicted write has its held document on show, if any.
   *
   * ONE AT A TIME: the difference is drawn inside a panel rather than a dialog,
   * and two open at once would push the second past the fold on the surface
   * whose whole job is to be read at a glance.
   *
   * PRUNED BY THE SHELL, NOT BY `reconcileHost`. Its lifetime is the WRITE
   * LEDGER's and reconciliation sees only the landed document — a mutation id
   * is not answerable from a `GraphDocument`. `mountWorkspace` already walks
   * the ledger to prune `writeCarriers` and clears this in the same pass, on a
   * rule stricter than "still in the ledger": a `retry on latest` reserves its
   * record as `pending` and a resolve whose re-check refuses leaves it
   * `invalid`, and in BOTH the record is still there with its held document
   * gone. So the rule is "still a conflict".
   */
  readonly diffOpen: MutationId | null;
}

export const INITIAL_HOST_STATE: HostState = Object.freeze({
  selection: INITIAL_SELECTION,
  scale: INITIAL_SCALE_STATE,
  auditFiltered: false,
  railStart: 0,
  draft: IDLE_CREATE_DRAFT,
  targetQuery: '',
  drag: null,
  drop: null,
  firstPass: INITIAL_FIRST_PASS,
  diffOpen: null,
});

/**
 * What the shell saw.
 *
 * `control` carries a `data-ig-command` — the package's own vocabulary
 * (`select-edge`, `focus`, `add`, `kind`, `delete`, `cancel`, …) and the
 * mount's chrome, which is now the handful of controls that need a DOM or a
 * host's own surface (`target-query`, `target`, `audit-filter`, `retry`,
 * `discard`) — share one channel because the shell reads one attribute.
 * `point` and `group` are the viewer's two identities: a focusable issue key,
 * and a mark naming an edge or a slot.
 */
export type HostCommand =
  | { readonly kind: 'point'; readonly key: string }
  | { readonly kind: 'group'; readonly id: string }
  | {
      readonly kind: 'control';
      readonly name: string;
      readonly target?: string | undefined;
      readonly value?: string | undefined;
    }
  | { readonly kind: 'intent'; readonly intent: KeyIntent }
  | { readonly kind: 'scroll'; readonly start: number }
  | { readonly kind: 'drag-start'; readonly key: string }
  | { readonly kind: 'drop'; readonly key: string | null; readonly at: Point }
  /**
   * A first-pass act that did not arrive as a `data-ig-command` string.
   *
   * The keyboard's intent is already a typed {@link FirstPassCommand}-shaped
   * value and a scan's answer is a list of candidates, so both reach this
   * reducer as VALUES rather than being flattened into an attribute and parsed
   * back out. The controls that DO arrive as attributes still come through
   * `control`, and both routes end in the same arm below.
   */
  | { readonly kind: 'first-pass'; readonly command: FirstPassCommand };

/** What the shell performs against the store after reducing. */
export type HostEffect =
  | {
      readonly kind: 'propose';
      readonly proposal: Proposal;
      /**
       * The issue this edit is about, answered ONCE — here, and never again.
       *
       * THE SHELL REMEMBERS IT AGAINST THE WRITE. A refusal arrives from the
       * store long after the act that caused it, by which time a sibling write
       * may have taken the relationship away; asking then is asking a document
       * that no longer holds the answer. See {@link editCarrier} for what the
       * remaining sources can and cannot say, and `mount.ts` for the map this
       * value is recorded in.
       *
       * `null` when the document holds NEITHER end — there is no panel for an
       * issue this backlog does not carry, so there is nowhere to state it.
       */
      readonly carrier: string | null;
    }
  | { readonly kind: 'retry'; readonly mutationId: MutationId }
  | { readonly kind: 'discard'; readonly mutationId: MutationId }
  | { readonly kind: 'dismiss-change' }
  /**
   * Run the host's candidate scan under this generation.
   *
   * The port is asynchronous by declaration, so the scan is an EFFECT and its
   * answer comes back as a command. The generation rides along because a close
   * and a re-open can leave two scans in flight — see `firstpass.ts`.
   */
  | { readonly kind: 'find-candidates'; readonly scan: number }
  /**
   * An `apply`: propose this create, and REMEMBER which candidate it was.
   *
   * Its own arm rather than a plain `propose`, because the shell has to be able
   * to find this exact write again if the reader takes the answer back — and it
   * cannot do that from the create's fields. `candidates.ts` mints a distinct
   * {@link CandidateId} per finding precisely so two detectors proposing the
   * same pair stay two findings, so `kind`/`from`/`to` does not identify a
   * write; only the `MutationId` the store returns does, and only the shell
   * ever sees it.
   */
  | {
      readonly kind: 'first-pass-apply';
      readonly candidateId: CandidateId;
      readonly proposal: Proposal;
      /** As on `propose`, and for the same reason — this arm emits a write too. */
      readonly carrier: string | null;
    }
  /**
   * An `undo` took back an `apply`, and the shell decides what the store can do
   * about it.
   *
   * The CANDIDATE rather than a proposal: this reducer does not build a
   * `Proposal` for a write it is not making, and the shell matches the create
   * against the store's own records by the candidate's own fields.
   */
  | { readonly kind: 'first-pass-withdraw'; readonly candidateId: CandidateId };

export interface HostResult {
  readonly state: HostState;
  readonly effects: readonly HostEffect[];
  /**
   * Whether this reducer HAS AN ARM for the command, rather than whether the
   * command changed anything.
   *
   * The two are different and only one of them is answerable here. Plenty of
   * arms settle without changing state — a `retype` with no edge selected, a
   * `focus` that was already focused — and those are still this reducer's acts.
   * What `false` means is narrower and is the `default` arm's own words: a
   * command published on the same attribute that belongs to the HOST's chrome,
   * which this reducer must not guess at.
   *
   * IT EXISTS FOR THE KEYBOARD. A shell activating a control from a key press
   * has to cancel the press, or the browser's own activation behaviour fires a
   * second click and the act happens twice — but cancelling a press whose
   * command this reducer never owned suppresses the native click the host's own
   * listener was waiting for, and the host's control silently stops answering
   * the keyboard. The shell cannot tell those apart from the outside; this
   * reducer already knows, so it says.
   */
  readonly claimed: boolean;
}

function settled(state: HostState): HostResult {
  return { state, effects: [], claimed: true };
}

/** The `default` arm's result: not this reducer's command. See {@link HostResult.claimed}. */
function unclaimed(state: HostState): HostResult {
  return { state, effects: [], claimed: false };
}

/**
 * The issue whose own frontmatter declares a relationship.
 *
 * ONE SPELLING OF A FACT TWO DECISIONS DEPEND ON. `from` is the carrier for
 * every field, the symmetric ones included: §4.3 puts a relationship in ONE
 * issue's block, and `from` is the end it was declared from — which is why a
 * flip of a symmetric kind is refused rather than moving it. Both readers
 * below — where the panel goes when the edge it was showing stops being drawn,
 * and which issue a refused edit is stated under — wrote `edge.from` for
 * themselves, which is two answers to one question, agreeing only for as long
 * as nobody touched either.
 *
 * IT CAN ONLY BE READ WHILE THE DOCUMENT STILL HOLDS THE EDGE, and every reader
 * of it is shaped by that. Once the edge is gone its identity is the only record
 * left, and it is a weaker record for the SYMMETRIC fields: `edgeIdentity` sorts
 * their endpoints, so a `serialize-with` declared from `z` to `a` and one
 * declared from `a` to `z` are one string and `from` is not a function of it. A revision of `@issuegraph/core` named the carrying end of
 * every identity anyway; for the symmetric fields that answer was the sort order
 * wearing the carrier's name, and a refusal about such an edge was stated on the
 * far end's panel — the panel the reader was NOT on — whenever the pair sorted
 * the other way. `edgeIdentityEnd` now answers `either` for exactly those and
 * names the carrier for the directed fields, so this function stays the only
 * source of the fact while the edge is there, and nothing downstream has to
 * guess which kind of record it is holding.
 */
function carrierOf(edge: StoredEdge): string {
  return edge.from;
}

/**
 * What an edit can still say about its two ends.
 *
 * TWO SOURCES, AND THEY DO NOT ANSWER THE SAME QUESTION. A create, and an edit
 * on an edge the document still holds, yield an ORDERED pair: the carrier, and
 * the far end. An edit naming an edge the document no longer carries yields an
 * identity — a weaker record, which names WHICH TWO ISSUES and says which of
 * them declared the relationship only for the directed fields, because those
 * are the ones `edgeIdentity` does not sort. Holding the two apart in the type
 * is what stops the second being read as the first, which is exactly the
 * reading this shape replaced; how much the identity kept is then
 * `@issuegraph/core`'s answer rather than this layer's assumption.
 */
type EditEnds =
  | { readonly kind: 'pair'; readonly carrier: string; readonly far: string }
  | { readonly kind: 'identity'; readonly edgeId: EdgeId };

function endsOf(document: GraphDocument, proposal: Proposal): EditEnds {
  // A CREATE HAS NO EDGE YET, and its own two references are the whole of what
  // it is about — including the `unknown-issue` case, where one of them is an
  // issue the document does not hold and no lookup could recover it.
  if (proposal.op === 'create') return { kind: 'pair', carrier: proposal.from, far: proposal.to };
  const edge = findEdge(document, proposal.edgeId);
  if (edge !== undefined) return { kind: 'pair', carrier: carrierOf(edge), far: edge.to };
  // AND THE EDGE CAN BE ABSENT, which is the `unknown-edge` refusal itself: the
  // reader acted on a relationship a landed write had already removed. All that
  // is left is the identity the act named.
  return { kind: 'identity', edgeId: proposal.edgeId };
}

/**
 * Which issue an edit is ABOUT — the panel that states it, and the panel it is
 * refused on.
 *
 * THE SUBJECT OF AN EDIT IS DECIDED ONCE, AND THAT MEANS ONCE IN TIME AS WELL
 * AS ONCE IN THE SOURCE. It used to be decided twice and in two vocabularies:
 * the panel derived its own subject from the selection (canonicalized onto a
 * together unit's lead), and the inspector separately asked whether the REFUSED
 * EDGE's identity named that subject. Two derivations of one fact diverge, and
 * they did, three times over. This function replaced the second derivation —
 * and then a fourth divergence appeared inside it, because it was still being
 * CALLED twice: once when the edit went out, and again when the refusal came
 * back, against a document a sibling write had changed in between. So the shell
 * calls it at the moment of emission, records the answer against the write, and
 * reads the record afterwards. See `HostEffect`'s `carrier` and `mount.ts`.
 *
 * THE CARRIER'S END WINS, AND THE FAR END IS THE FALLBACK. The relationship is
 * declared in the carrier's block, so that is the panel a reader made the edit
 * from and the panel that can undo it. A create naming an unknown SOURCE has
 * no such panel, and stating the refusal on the target's — the only issue the
 * document holds — beats stating it nowhere.
 *
 * AND WITH ONLY AN IDENTITY LEFT, THE SAME RANKING APPLIES AS FAR AS THE FORMAT
 * KEPT IT. `edgeIdentity` discards the declaring end of a SYMMETRIC pair and
 * keeps it for a directed one, so `edgeIdentityEnd` names the carrier of a
 * directed identity and answers `either` for a symmetric one — and both arms
 * here rank by one rule instead of two. THIS ARM HAS BEEN WRONG IN BOTH
 * DIRECTIONS: ranking a symmetric identity's segments invented an order the
 * format had thrown away and stated a refusal on the far end's panel, and the
 * correction — ranking nothing at all — discarded the order a DIRECTED identity
 * still carries, so a host proposing on the shared store had its refusal placed
 * under whichever end `document.issues` listed first. `either`, and a directed
 * identity whose carrier this backlog does not hold, both fall through to the
 * fallback this arm always had: "an issue this backlog holds and this edit was
 * between", in the document's own order. The reader's own edits reach none of
 * it, because their carrier was taken while the edge was still there.
 *
 * `null` when the document holds NEITHER end, which is not a refusal being
 * dropped: there is no panel for an issue this backlog does not carry, so
 * there is nowhere the reader could be standing to read it.
 */
export function editCarrier(document: GraphDocument, proposal: Proposal): string | null {
  const keys = document.issues.map((issue) => issue.ref);
  const ends = endsOf(document, proposal);
  switch (ends.kind) {
    case 'pair':
      return keys.find((ref) => ref === ends.carrier) ?? keys.find((ref) => ref === ends.far) ?? null;
    case 'identity':
      return (
        keys.find((ref) => edgeIdentityEnd(ends.edgeId, ref) === 'carrier') ??
        keys.find((ref) => edgeIdentityEnd(ends.edgeId, ref) !== null) ??
        null
      );
  }
}

/**
 * What the shell is to do with an emitted proposal — the ONE axis on which the
 * two emissions differ.
 *
 * A ROUTE RATHER THAN TWO EMITTERS. The first pass needs its write performed
 * differently — the shell has to be able to find that exact record again if the
 * reader takes the answer back, so the effect carries the candidate — and for
 * one review round that difference was reason enough for it to build its own
 * effect and skip {@link emitting} entirely. Everything else about the two is
 * identical, and the part it skipped was the part that decides which panel the
 * refusal lands on. The difference is this value; the funnel is one.
 */
type EmitRoute =
  | { readonly kind: 'propose' }
  | { readonly kind: 'first-pass-apply'; readonly candidateId: CandidateId };

/** The reader's own edits: performed as a plain write, with nothing to take back by name. */
const TO_THE_STORE: EmitRoute = { kind: 'propose' };

/**
 * The effect a route emits, as an exhaustive switch rather than a pair of
 * branches: a third way to write is a compile error here, not a route that
 * quietly builds its own effect again.
 */
function effectFor(route: EmitRoute, proposal: Proposal, carrier: string | null): HostEffect {
  switch (route.kind) {
    case 'propose':
      return { kind: 'propose', proposal, carrier };
    case 'first-pass-apply':
      return { kind: 'first-pass-apply', candidateId: route.candidateId, proposal, carrier };
  }
}

/**
 * Emit an edit, and leave the panel on the issue the edit is about.
 *
 * EVERY PROPOSAL THIS REDUCER EMITS GOES THROUGH HERE, which is the point. The
 * type does not prove that on its own — a new arm could still write out a
 * `carrier` by hand — but it makes skipping this deliberate rather than an
 * omission: both of `HostEffect`'s write-bearing arms REQUIRE the field, so a
 * route that goes round the funnel has to invent an answer in plain sight
 * instead of quietly not having one.
 *
 * §17b requires a refusal to be visible at the moment the reader is refused,
 * and a refusal is stated on its carrier's panel — so the panel has
 * to BE the carrier's when the edit goes out, rather than arriving there
 * afterwards by whichever route happens to notice. Each route that had to
 * notice separately cost a review round: a retype's projection hides the edge
 * the panel was filtered to, and until `reconcileHost` was taught about hidden
 * edges the panel resolved to nothing selected and the reason was drawn
 * nowhere; a create completed after the reader had clicked another issue went
 * out from the draft's source while the panel was headed by the issue they
 * clicked, which nothing downstream can see at all — a completed draft leaves
 * no trace of where it began; and a first-pass `apply` built its effect for
 * itself, so a queue opened with nothing selected answered `Y`, was refused,
 * and closed onto a panel that stated nothing.
 *
 * IT WRITES BACK WHAT WAS ALREADY THERE ON THE CREATE PATHS, which is the
 * check that this is not a behaviour change smuggled in beside a fix.
 * Beginning a draft already selects its source and a canvas drop already
 * selects the node it started on, so the undiverted paths land on the same
 * selection. The picker's routes DO move — an edit on a selected edge takes
 * the panel to that edge's carrier now rather than one render later, which is
 * where a retype or a flip already ended up through `reconcileHost` and where
 * a delete of the selected edge used to leave the reader with `none` once the
 * write landed and took the edge away.
 *
 * SO DOES THE FIRST PASS, AND IT MOVES THE PANEL UNDER A SURFACE THAT COVERS
 * IT. That is the intended effect rather than a side one: the overlay is modal,
 * the reader answers `Y`, and where they are put down when it closes is the
 * only chance a refusal of that answer has of being read. Whether the write
 * will be refused is not knowable here, so every `apply` moves the panel and
 * the last one answered is the panel the reader lands on.
 *
 * AN EDIT ABOUT NO ISSUE THIS DOCUMENT HOLDS LEAVES THE SELECTION ALONE. See
 * {@link editCarrier}: there is no panel to move to, and clearing would take
 * the reader off the one they are on for a reason they could not see. The
 * effect still carries the `null`, because "no panel states this" is an answer
 * the shell must not go and compute a different one for.
 */
function emitting(
  state: HostState,
  proposal: Proposal,
  document: GraphDocument,
  route: EmitRoute,
): HostResult {
  const carrier = editCarrier(document, proposal);
  return {
    state:
      carrier === null
        ? state
        : {
            ...state,
            selection: selectionReducer(INITIAL_SELECTION, { kind: 'select-issue', key: carrier }),
          },
    effects: [effectFor(route, proposal, carrier)],
    claimed: true,
  };
}

/** A draft step: apply the create reducer, and emit the proposal it completes. */
function drafted(
  state: HostState,
  command: Parameters<typeof createReducer>[1],
  document: GraphDocument,
): HostResult {
  const result = createReducer(state.draft, command);
  if (result.proposal === null) {
    // BEGINNING A DRAFT SELECTS ITS SOURCE. The inspector draws the picker for
    // a selected edge ahead of any draft, so a draft begun by R from a focused
    // row while an edge stayed selected would render behind the picker and
    // could never reach its target search. One selection, and it is the
    // draft's subject — the same rule the canvas drop already applies.
    const selection: WorkspaceSelection =
      command.kind === 'begin' ? { kind: 'issue', key: command.source } : state.selection;
    // A CANCEL CLEARS THE DRAFT'S CHROME TOO — the drop point a canvas chooser
    // was placed at and the query typed into the target search — exactly as
    // the explicit cancel control does. Escape reaches here through the key
    // map, and a draft begun afterwards must not open at the old drop point
    // or with the old query already in the box.
    const chrome = command.kind === 'cancel' ? { targetQuery: '', drop: null } : {};
    return settled({ ...state, draft: result.draft, selection, ...chrome });
  }
  // THE DRAFT ENDS WHERE IT BEGAN. `begin` selects the source three lines
  // above; `emitting` puts the panel back on the edit's carrier, which for a
  // create IS that source. Without it a click on another issue between the two
  // steps left the write going out from one issue and the panel headed by
  // another — and a refusal about the first stated on no panel at all.
  const proposed = emitting(state, result.proposal, document, TO_THE_STORE);
  return {
    ...proposed,
    state: { ...proposed.state, draft: IDLE_CREATE_DRAFT, targetQuery: '', drop: null },
  };
}

/**
 * Whether a string names an {@link Answer}.
 *
 * Its own guard rather than a cast: the value arrives off a DOM attribute, and
 * `AGENTS.md`'s strict-TypeScript rule forbids asserting it into the union. The
 * three names are `queue.ts`'s, read from a frozen tuple so an answer added
 * there fails a build here rather than being silently unreachable.
 */
const ANSWERS = Object.freeze(['apply', 'reject', 'skip'] as const);

function isAnswer(value: string): value is Answer {
  return ANSWERS.some((answer): boolean => answer === value);
}

/**
 * Apply one first-pass command, and turn what it produced into effects.
 *
 * The two emissions are exactly the two things `QueueResult` reports and the
 * queue itself cannot perform: the proposal an `apply` stands for, and the
 * answer an `undo` took back. Nothing else here reaches the store, which is what
 * keeps §17e's consent rule a property of the shape — drawing a candidate,
 * opening the surface, closing it and skipping all emit nothing because there is
 * no arm on which they could.
 *
 * THE APPLY GOES THROUGH {@link emitting}, AND FOR A ROUND IT DID NOT. This
 * function built the `first-pass-apply` effect itself, which made the claim
 * "every proposal this reducer emits goes through one funnel" false at the one
 * emission that could not be reached any other way — the overlay is modal, so
 * the reader's hands are nowhere near the panel. A queue opened with nothing
 * selected, or with an unrelated issue selected, answered `Y`, had the create
 * refused, closed, and put the reader back exactly where they had been: a panel
 * that states no refusal because the edit was about some other issue. It is the
 * `document` argument that this route was missing, so that is what it now takes.
 */
function firstPassed(state: HostState, command: FirstPassCommand, document: GraphDocument): HostResult {
  const outcome = firstPassReducer(state.firstPass, command);
  // THE DRAFT IS NOT TOUCHED HERE, and an earlier revision's attempt to is worth
  // recording: opening the surface does have to cancel a live draft — the queue
  // covers the target search and the kind chooser, and a draft left standing
  // behind it is re-entered on close with the reader's context gone — but this
  // reducer cannot tell an open that will SCAN from one the shell is about to
  // refuse for want of a source. Clearing on every open destroyed the reader's
  // draft for a queue that then never appeared. So the cancel belongs to the
  // shell, which knows, and it is dispatched there — see `mount.ts`.
  let next: HostState = { ...state, firstPass: outcome.state };
  const effects: HostEffect[] = [];
  if (outcome.scanning !== null) effects.push({ kind: 'find-candidates', scan: outcome.scanning });
  const result: QueueResult | null = outcome.result;
  if (result !== null) {
    // THE ANSWER'S OWN CANDIDATE, read off the queue's record of it rather than
    // off the screen: by the time this runs the cursor has already advanced.
    const given = result.state.answers[result.state.answers.length - 1];
    if (result.proposal !== null && given !== undefined) {
      const applied = emitting(next, result.proposal, document, {
        kind: 'first-pass-apply',
        candidateId: given.candidate.id,
      });
      // THE PANEL MOVE IS KEPT, not discarded beside the effect. It is the whole
      // of what this route was missing: the overlay closes onto the issue the
      // answered create was about, which is the panel its refusal is stated on.
      next = applied.state;
      effects.push(...applied.effects);
    }
    // ONLY A WITHDRAWN `apply` REACHES THE STORE. A withdrawn `reject` or `skip`
    // dispatched nothing, so there is nothing out there to take back.
    if (result.withdrawn !== null && result.withdrawn.answer === 'apply') {
      effects.push({ kind: 'first-pass-withdraw', candidateId: result.withdrawn.candidate.id });
    }
  }
  return { state: next, effects, claimed: true };
}

/** A pointer on an issue: a target while one is being chosen, a selection otherwise. */
function pointed(state: HostState, key: string, document: GraphDocument): HostResult {
  const choosingTarget = state.draft.kind !== null && state.draft.target === null;
  if (choosingTarget && key !== state.draft.source) {
    return drafted(state, { kind: 'target', ref: key }, document);
  }
  return settled({
    ...state,
    selection: selectionReducer(state.selection, { kind: 'select-issue', key }),
  });
}

/**
 * Move the selection onto an issue, taking no other reading of the click.
 *
 * The same shape as {@link selectEdge} one function down, and for the same
 * reason: a navigation that leaves a half-built draft armed behind it would let
 * the NEXT click land somewhere the reader is no longer looking.
 *
 * AND IT DOES NOT TOGGLE. `select-issue` clears when it names what is already
 * selected — right for a row click, which is ambivalent, and wrong for a
 * control that says where to arrive: an audit finding whose member is already
 * inspected would answer "go and look" by emptying the panel.
 */
function revealIssue(state: HostState, key: string): HostResult {
  return settled({
    ...state,
    // `reveal-issue`, NOT `select-issue`: the latter TOGGLES, so revealing the
    // issue already selected would empty the panel the reader was sent to.
    selection: selectionReducer(state.selection, { kind: 'reveal-issue', key }),
    draft: IDLE_CREATE_DRAFT,
    targetQuery: '',
    drop: null,
  });
}

function selectEdge(state: HostState, edgeId: string): HostResult {
  return settled({
    ...state,
    selection: selectionReducer(state.selection, { kind: 'select-edge', edgeId }),
    draft: IDLE_CREATE_DRAFT,
    targetQuery: '',
    drop: null,
  });
}

/** The retype and flip proposals come from the picker's own view, never built here. */
function pickerProposal(
  document: GraphDocument,
  edgeId: string,
  choice: { readonly kind: 'retype'; readonly field: EdgeField } | { readonly kind: 'flip' },
): Proposal | null {
  const view = pickerView(document, edgeId);
  if (choice.kind === 'flip') return view.flip?.proposal ?? null;
  return view.options.find((option) => option.kind === choice.field && !option.current)?.proposal ?? null;
}

function controlled(
  state: HostState,
  name: string,
  target: string | undefined,
  value: string | undefined,
  document: GraphDocument,
): HostResult {
  const edgeId = selectedEdgeId(state.selection);
  switch (name) {
    // --- the package's own commands ---
    case 'select-edge':
      return target === undefined ? settled(state) : selectEdge(state, target);
    case 'select-issue':
      // THE HOLDER DEEP LINK. The inspector publishes a hold's subject — the
      // open blocker, the claimed peer — as this control, so a reader can reach
      // the issue holding the one they are looking at. It is a pointer on that
      // issue, with a pointer's rules: a selection, or the target of a draft.
      return target === undefined ? settled(state) : pointed(state, target, document);
    case 'reveal-issue':
      // NAVIGATION THAT CANNOT WRITE, which is why it is not `select-issue`.
      // A pointer's rules are right for the hold deep link and wrong here: with
      // a draft awaiting its target, `pointed` reads the click as CHOOSING that
      // target and `drafted` emits the create proposal — so an audit finding's
      // "go and look" would silently declare a relationship. §17d's whole rule
      // for this surface is that it "offers navigation and never a remedy", and
      // a control that can write is a remedy however it is labelled.
      //
      // IT ABANDONS THE DRAFT RATHER THAN REFUSING TO MOVE, the discipline
      // `selectEdge` above already keeps. Nothing is written either way, and a
      // button that silently did nothing while a draft was open would be the
      // dead affordance this control exists to avoid.
      return target === undefined ? settled(state) : revealIssue(state, target);
    case 'clear':
      return settled({
        ...state,
        selection: INITIAL_SELECTION,
        draft: IDLE_CREATE_DRAFT,
        targetQuery: '',
        drop: null,
      });
    case 'focus':
      return target === undefined
        ? settled(state)
        : settled({ ...state, scale: scaleReducer(state.scale, { kind: 'focus', key: target }) });
    case 'clear-focus':
      return settled({ ...state, scale: scaleReducer(state.scale, { kind: 'clear-focus' }) });
    case 'search':
      return settled({
        ...state,
        scale: scaleReducer(state.scale, { kind: 'search', query: value ?? '' }),
      });
    case 'open-isolated':
      return settled({ ...state, scale: scaleReducer(state.scale, { kind: 'open-isolated' }) });
    case 'close-isolated':
      return settled({ ...state, scale: scaleReducer(state.scale, { kind: 'close-isolated' }) });
    case 'retype': {
      if (edgeId === null || value === undefined || !isEdgeField(value)) return settled(state);
      const proposal = pickerProposal(document, edgeId, { kind: 'retype', field: value });
      return proposal === null ? settled(state) : emitting(state, proposal, document, TO_THE_STORE);
    }
    case 'flip': {
      if (edgeId === null) return settled(state);
      const proposal = pickerProposal(document, edgeId, { kind: 'flip' });
      return proposal === null ? settled(state) : emitting(state, proposal, document, TO_THE_STORE);
    }
    case 'dismiss-change':
      return { state, effects: [{ kind: 'dismiss-change' }], claimed: true };
    case 'add': {
      // THE CONTROL'S OWN SUBJECT FIRST, AND THE SELECTION AS THE FALLBACK —
      // the same one rule the `delete` arm below states, for the same reason.
      //
      // `inspectorView` CANONICALIZES a selection naming a together-unit member
      // onto its slot's LEAD, and `renderWorkspace` words the whole panel from
      // that: the heading, the title, every row. `selectedKey` answers the RAW
      // key. So with a partner selected the panel was titled with the lead and
      // its `+ add` began a relationship from the partner — one control writing
      // about a different issue from the one every other line of its own panel
      // named. The panel publishes the canonical key on the control, which is
      // the fact only it holds.
      const source = target ?? selectedKey(state.selection);
      return source === null ? settled(state) : drafted(state, { kind: 'begin', source }, document);
    }
    case 'kind':
      return value === undefined || !isEdgeField(value)
        ? settled(state)
        : drafted(state, { kind: 'type', edgeKind: value }, document);
    case 'cancel':
      return settled({ ...state, draft: IDLE_CREATE_DRAFT, targetQuery: '', drop: null });
    case 'delete': {
      // THE CONTROL'S OWN EDGE FIRST, AND THE SELECTION AS THE FALLBACK.
      //
      // This arm read the selection and ignored `target` entirely, which was
      // sound for exactly as long as the only delete control lived inside
      // `if (edgeId !== null)` — one button, about the one selected edge, and
      // nothing else could publish the command. §17a's inspector puts a remove
      // control on EVERY relationship row, and against the old arm each of them
      // was wrong in one of two ways: with an issue selected `edgeId` is `null`
      // and every row's remove was a silent no-op, and with row B's edge
      // selected row A's remove deleted B. A control that deletes a different
      // relationship from the one it sits on is worse than one that does
      // nothing.
      //
      // THE FALLBACK IS NOT A CONVENIENCE — it is the keyboard. `create/keys.ts`
      // binds `⌫` to the SELECTED edge, because a selection is the only edge a
      // keyboard has named, and that intent arrives through `intended` rather
      // than here; what still needs the fallback is the mount's own labelled
      // delete button, which is drawn only for a selected edge and carries no
      // target. One rule — "the edge the act names" — with the selection as the
      // subject when nothing else names one.
      const subject = target ?? edgeId;
      return subject === null
        ? settled(state)
        : emitting(state, { op: 'delete', edgeId: subject }, document, TO_THE_STORE);
    }

    // --- the mount's chrome: what still needs a DOM, or a host's own surface ---
    // `add`, `kind`, `cancel` and `delete` used to be listed here, and they are
    // not the mount's any more: `renderWorkspace` draws every one of them in its
    // own markup, so a host rendering the package without mounting it publishes
    // them too. What is left below genuinely is the shell's — a live input over
    // the reader's query and the matches it offers, the audit toggle the header
    // publishes, and the two write-recovery controls the mount draws beside a
    // failed record.
    case 'audit-filter':
      return settled({ ...state, auditFiltered: !state.auditFiltered });
    case 'target-query':
      return settled({ ...state, targetQuery: value ?? '' });
    case 'target':
      return target === undefined ? settled(state) : drafted(state, { kind: 'target', ref: target }, document);
    case 'retry':
      return target === undefined
        ? settled(state)
        : { state, effects: [{ kind: 'retry', mutationId: target }], claimed: true };
    case 'discard':
      return target === undefined
        ? settled(state)
        : { state, effects: [{ kind: 'discard', mutationId: target }], claimed: true };
    // A TOGGLE, AND NOTHING LEAVES THE CLIENT. Showing a held document is a
    // reading act: it dispatches nothing, adopts nothing, and cannot be the
    // step that resolves a conflict. So it emits NO effect — which is also the
    // strongest thing that can be said about it, and what its test asserts.
    //
    // IT IS A `control` LIKE ITS TWO SIBLINGS, not a command arm of its own.
    // The shell turns every `data-ig-command` into `{ kind: 'control', name,
    // target }`, so an arm outside that shape has no route from a button and
    // would be unreachable code behind a control that did nothing.
    case 'view-diff':
      return target === undefined
        ? settled(state)
        : settled({ ...state, diffOpen: state.diffOpen === target ? null : target });

    // --- the first pass ---
    case 'first-pass':
      return firstPassed(state, { kind: 'open' }, document);
    case 'first-pass-close':
      return firstPassed(state, { kind: 'close' }, document);
    case 'first-pass-answer':
      return value === undefined || !isAnswer(value)
        ? settled(state)
        : firstPassed(state, { kind: 'queue', command: { kind: 'answer', answer: value } }, document);
    case 'undo':
      // GUARDED BY THE PHASE, not by the control's existence: `undo` is a name a
      // host's own chrome could publish too, and `firstPassReducer` answers a
      // queue command with no queue by changing nothing.
      return firstPassed(state, { kind: 'queue', command: { kind: 'undo' } }, document);
    default:
      // A COMMAND THIS REDUCER DOES NOT KNOW CHANGES NOTHING. A host's own
      // chrome may publish commands on the same attribute — the demo's theme
      // switch does — and those are the host's to read from its own listener,
      // never a reason for this reducer to guess.
      //
      // AND IT SAYS SO, rather than being indistinguishable from an arm that
      // settled. See {@link HostResult.claimed}: a keyboard shell that cancels
      // this press takes the host's control away from the keyboard entirely.
      return unclaimed(state);
  }
}

function intended(state: HostState, intent: KeyIntent, document: GraphDocument): HostResult {
  switch (intent.kind) {
    case 'none':
    // `T` opens the picker; the picker is already drawn whenever an edge is
    // selected, so there is nothing to change.
    case 'retype':
      return settled(state);
    case 'create':
      return drafted(state, intent.command, document);
    case 'propose':
      return emitting(state, intent.proposal, document, TO_THE_STORE);
  }
}

/** The one reducer. `document` is the landed document, for edge lookups. */
export function reduceHost(state: HostState, command: HostCommand, document: GraphDocument): HostResult {
  switch (command.kind) {
    case 'point':
      return pointed(state, command.key, document);
    case 'group': {
      // A mark names either an edge (its store identity) or a slot (its lead).
      // A MARK NAMING NEITHER CHANGES NOTHING. The canvas draws an edge the
      // store has not landed yet — a pending create carries a mark from the
      // moment it is proposed — and its identity is in no landed document and
      // is no issue key. Falling through to `pointed` would select that
      // identity as an issue, or worse, commit it as a draft's target.
      if (findEdge(document, command.id) !== undefined) return selectEdge(state, command.id);
      if (document.issues.some((issue) => issue.ref === command.id)) return pointed(state, command.id, document);
      return settled(state);
    }
    case 'control':
      return controlled(state, command.name, command.target, command.value, document);
    case 'first-pass':
      return firstPassed(state, command.command, document);
    case 'intent':
      return intended(state, command.intent, document);
    case 'scroll':
      return settled({ ...state, railStart: Math.max(0, Math.floor(command.start)) });
    case 'drag-start':
      return settled({ ...state, drag: command.key });
    case 'drop': {
      const source = state.drag;
      const released = { ...state, drag: null };
      if (source === null || command.key === null || command.key === source) return settled(released);
      // A drop is the canvas path's first two facts at once: source, then
      // target. The kind is still to be gathered, at the drop point.
      const begun = createReducer(IDLE_CREATE_DRAFT, { kind: 'begin', source });
      const targeted = createReducer(begun.draft, { kind: 'target', ref: command.key });
      return settled({
        ...released,
        draft: targeted.draft,
        drop: command.at,
        selection: selectionReducer(INITIAL_SELECTION, { kind: 'select-issue', key: source }),
      });
    }
  }
}

/**
 * Bring the state back into agreement with what the reader can SEE.
 *
 * The store re-renders on every landed write, and a write can remove what the
 * state names: a retype or a flip gives the edge a NEW identity, a delete
 * removes it, and a conflict's rehydrate can drop an issue a draft was aimed
 * at. A selection naming an edge the document no longer carries would leave
 * the inspector showing a picker for nothing — the viewer already refuses a
 * stale selection the same way, so the host does too, from the document
 * rather than from memory of what it just proposed.
 *
 * ## `hidden` is the OTHER half of "no longer carries", and the landed
 * document cannot state it
 *
 * `document` is what LANDED, and an unsettled retype or flip lands nothing —
 * so the edge the reader was inspecting is still in it, and the check above
 * passes, while the store's projection has already hidden that edge and the
 * workspace has already stopped drawing it. Two documents were answering
 * "does this selection resolve", and they disagreed for the whole life of the
 * write: the panel resolved the selection to `none` and drew the empty
 * sentence, and — because a refusal is only drawn for the subject it names —
 * the reason the edit was refused was drawn nowhere at all. A reader who
 * retyped an edge into a relationship that already exists saw the picker
 * close and nothing else. `hidden` is the store's own set of landed edges its
 * projection is not showing, so both halves of the question are asked here
 * and the answer is one.
 *
 * A HIDDEN EDGE RETURNS THE PANEL TO ITS CARRIER, not to nothing. Through
 * {@link carrierOf}, which is the same rule the refusal's own carrier was taken
 * by when the edit went out — so the panel this lands on and the panel the
 * refusal is stated under are one answer rather than two that agree. Clearing to `none`
 * instead would be the same silence the check above already produced.
 *
 * IT IS A BACKSTOP NOW, NOT THE ONLY GUARD. `emitting` already puts the panel
 * on the carrier the moment the reader's own edit goes out, so the route this
 * paragraph was written for cannot reach here any more. What still can is a
 * SIBLING write: another edit's retype or flip hiding the edge this selection
 * names, which no act of the reader's announced.
 *
 * RECONCILING ONTO THE PROJECTED REPLACEMENT was the other candidate — follow
 * the selection to the identity the edit produced — and it cannot be done from
 * here or anywhere else. It works only when that identity happens to be
 * landed, which is exactly one of the two refusals this route reaches:
 * `duplicate-edge` produces an edge that already exists, but `cardinality`
 * produces a PHANTOM, and a selection naming an edge the landed document does
 * not carry is dropped by the first check in this very function on the next
 * render. Measured: `reconcileHost` returns `{ kind: 'none' }` for it. That is
 * the same vanishing one frame later, and it is the same decision the phantom
 * capsule already records by publishing no `select-edge` — there is nothing
 * there to select.
 */
export function reconcileHost(
  state: HostState,
  document: GraphDocument,
  hidden: ReadonlySet<EdgeId>,
): HostState {
  const edgeId = selectedEdgeId(state.selection);
  const edge = edgeId === null ? undefined : findEdge(document, edgeId);
  const resolved =
    edgeId === null
      ? state.selection
      : edge === undefined
        ? INITIAL_SELECTION
        : hidden.has(edge.id)
          ? selectionReducer(INITIAL_SELECTION, { kind: 'select-issue', key: carrierOf(edge) })
          : state.selection;
  const issueKey = selectedKey(resolved);
  const known = new Set(document.issues.map((issue) => issue.ref));
  // ASKED OF `resolved`, NOT OF `state.selection`. The carrier above is read
  // off an edge, and an edge can name an issue the document does not list;
  // asking the question of the selection that came IN would let that one
  // through unchecked, which is the stale name this function exists to refuse.
  const selection = issueKey !== null && !known.has(issueKey) ? INITIAL_SELECTION : resolved;
  const draftStands =
    (state.draft.source === null || known.has(state.draft.source)) &&
    (state.draft.target === null || known.has(state.draft.target));
  if (selection === state.selection && draftStands) return state;
  return {
    ...state,
    selection,
    ...(draftStands ? {} : { draft: IDLE_CREATE_DRAFT, targetQuery: '', drop: null }),
  };
}

/** The issues a target search offers, by reference or title, never the source itself. */
export function targetMatches(
  issues: readonly StoredIssue[],
  query: string,
  source: string | null,
  limit = 8,
): readonly StoredIssue[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return issues
    .filter((issue) => issue.ref !== source)
    .filter((issue) => issue.ref.includes(needle) || issue.title.toLowerCase().includes(needle))
    .slice(0, limit);
}

/** How far the reader may scroll into the rail window before it is re-cut around them, in rows. */
export const RAIL_SLACK = 20;

/**
 * The slack a window of `count` rows actually gets: `RAIL_SLACK`, bounded to a
 * quarter of the window and never below one row. A slack as wide as the window
 * re-cut a small window onto its own start — ArrowDown on the last drawn row
 * computed `offset - slack` at or below the current start, dispatched it
 * unchanged, and keyboard navigation could not leave the first window.
 */
export function railSlackFor(count: number): number {
  return Math.min(RAIL_SLACK, Math.max(1, Math.floor(count / 4)));
}

/**
 * Which order row a rail scroll offset points at.
 *
 * THE ROWS DO NOT START AT THE TOP OF THE RAIL. The legend sits above them, and
 * so do the host header and the NOW list when the host supplies them — and the
 * NOW list is one row per running job, unbounded. Dividing the raw offset by
 * the row pitch read that chrome as rows: with enough jobs the window advanced
 * past ranks the reader had not reached, and the rows chased the scroll
 * position. The chrome's height is measured and subtracted first, so the
 * offset that reaches the division is the offset INTO the rows.
 */
export function railRowAt(scrollTop: number, chromeHeight: number, pitch: number): number {
  return Math.floor(Math.max(0, scrollTop - chromeHeight) / pitch);
}

/**
 * Where the rail window should be re-cut for a scroll position, or `null` when
 * it should stay where it is.
 *
 * `row` is the first visible row (scroll offset over pitch), `start` the
 * window's current first slot, `count` the window's size and `total` the rows
 * in the order. Inside the window's slack band nothing moves. Outside it, the
 * window is re-cut `RAIL_SLACK` rows above the reader, clamped to the order.
 *
 * THE CLAMP CAN LAND ON THE CURRENT START, AND THAT CASE MUST ANSWER `null`.
 * At the end of a long order the window is already pinned to its last start
 * while the reader is deep inside it, so every scroll position there is
 * "outside the band" and clamps back to the same start. A shell that
 * dispatched that as a change redrew, restored the scroll offset — which
 * fires `scroll` again — and never stopped. The decision is a pure function
 * here so that cycle is refused where it can be tested without a browser.
 */
export function railWindowTarget(row: number, start: number, count: number, total: number): number | null {
  const slack = railSlackFor(count);
  const offset = row - start;
  if (offset >= 0 && offset <= count - slack * 2) return null;
  const lastStart = Math.max(0, total - count);
  const next = Math.min(lastStart, Math.max(0, Math.floor(row) - slack));
  return next === start ? null : next;
}
