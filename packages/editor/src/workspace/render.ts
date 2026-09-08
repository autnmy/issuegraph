/**
 * The three-zone workspace: the package's top-level surface.
 *
 * Rail on the left, canvas in the centre, inspector on the right, with the
 * ambient audit count in the header. Every zone is COMPOSED from the leaf that
 * already owns it — this file assembles, it does not re-derive.
 *
 * | zone      | comes from                                            |
 * |-----------|-------------------------------------------------------|
 * | header    | `auditOverlay` + `renderAuditHeader`                   |
 * | rail      | `renderViewer(…, { projection: 'linear' })`, windowed  |
 * | canvas    | `renderScaleLadder`                                    |
 * | inspector | `inspectorView`, rendered here                         |
 *
 * ## The audit left-bar is applied to the rail's SPEC, never to its markup
 *
 * The rail's rows are layer 1's, and this package's standing rule is that
 * nothing splices a rendered string — that is the hand-rolled escaping surface
 * the spec grammar exists to remove, and `reevaluate/render.ts` records the
 * same decision when it nests `scene.root` rather than concatenating chips into
 * the rail.
 *
 * `scene.root` is DATA, and `KEY_ATTRIBUTE` is published, so {@link markRail}
 * walks the spec tree and adds `data-ig-audit` to the keyed rows. That is a
 * pure transform over a public value rather than a reach past a surface, and it
 * means no attribute in this file is ever escaped by anything but `renderMarkup`.
 *
 * ## A row's severity is the heaviest across its MEMBERS
 *
 * A `together-with` unit is one row and several refs, and a finding can name a
 * member that does not lead. Read off the lead alone, an affected unit renders
 * clean — which is the audit failing silently on exactly the rows where an
 * encoding error is hardest to see.
 *
 * ## The zone frames, and the one place a tag is written here
 *
 * Two of the four zones hand back a STRING rather than a spec — the ladder's
 * chrome and the audit header — so the frames are assembled by concatenation,
 * as `renderScaleLadder` already assembles its own canvas and chrome. What
 * makes that safe is not care: {@link ZONES} is a closed union of literals, so
 * no caller value can reach an attribute here at all, and `zones.test.ts` pins
 * it. Everything with a dynamic value in it goes through `renderMarkup`.
 *
 * ## Dark only
 *
 * The pass-2 brief carries "light + dark" over from pass 1; light was cut after
 * that pass, and dark-only is the decision rather than an omission. There is no
 * forked token set here and no second palette: the theme is the viewer's, and
 * `styles.ts` writes structure against its custom properties.
 */

import {
  type Adoption,
  type AttrValue,
  type ElementSpec,
  type EdgeTreatment,
  type Freshness,
  type HostFacts,
  type NormalizedHostFacts,
  type SpecChild,
  type Theme,
  type ViewerDocument,
  type ViewerHold,
  KEY_ATTRIBUTE,
  element,
  glyphAndLabel,
  hiddenGlyph,
  identity,
  labelFrom,
  normalizeDocument,
  renderMarkup,
  provenanceClause,
  renderViewer,
  resolveTheme,
  themeCss,
  treatmentFor,
  viewerStylesheet,
} from '@issuegraph/viewer';

import type {
  EdgeId,
  InvalidCode,
  MutationId,
  OrderChange,
  OrderStatus,
  ProjectedEdge,
  StoredEdge,
} from '@issuegraph/store';

import type { AuditInput, AuditSeverity } from '../audit/findings.ts';
import { type AuditWords, renderAuditPanel } from '../audit/panel.ts';
import { auditStylesheet } from '../audit/styles.ts';
import { type CreateDraft, IDLE_CREATE_DRAFT } from '../create/draft.ts';
import { KIND_KEYS, RELATE_KEY } from '../create/keys.ts';
import type { Point } from '../create/placement.ts';
import { type OverlayAffordance, OVERLAY_TREATMENTS, treatmentForState } from '../overlay/grammar.ts';
import { DELTA_ATTRIBUTE, chipSpec, deltaKind, summarySpec, textOf } from '../reevaluate/parts.ts';
import { reevaluateStylesheet } from '../reevaluate/styles.ts';
import { type PlacedChip, reevaluateView } from '../reevaluate/view.ts';
import type { ChangeWords } from '../reevaluate/words.ts';
import { edgeOverlayStylesheet } from '../overlay/styles.ts';
import {
  AUDIT_SEVERITY_ATTRIBUTE,
  type AuditOverlay,
  auditFilterKeeps,
  auditOverlay,
  heaviestRow,
  renderAuditHeader,
} from '../audit/surface.ts';
import { type ScaleState, INITIAL_SCALE_STATE } from '../scale/commands.ts';
import { renderScaleLadder } from '../scale/render.ts';
import { scaleLadderStylesheet } from '../scale/styles.ts';

import {
  type InspectorRelationship,
  type InspectorView,
  type InspectorWhyRank,
  inspectorView,
} from './inspector.ts';
import { type RailWindow, type RailWindowOptions, railWindow } from './rail.ts';
import { type ConflictDiff, diffIsEmpty, diffWithin } from './recovery.ts';
import {
  type WorkspaceSelection,
  INITIAL_SELECTION,
  selectedEdgeId,
  selectedKey,
} from './selection.ts';
import { workspaceStylesheet } from './styles.ts';

/** The four fixed positions. A closed union, which is what keeps `zone` safe. */
export const ZONES = Object.freeze(['header', 'rail', 'canvas', 'inspector'] as const);

export type Zone = (typeof ZONES)[number];

export interface WorkspaceWords {
  /**
   * §17c's vocabulary — the change summary's facets, its dismiss control and
   * its direction words.
   *
   * OPTIONAL, AND ITS ABSENCE DRAWS NOTHING rather than drawing a default.
   * `ChangeWords` states the doctrine and this obeys it exactly: the store
   * ships the change as COUNTS so a host writes the sentence in its own
   * language, and a default supplied here would take that choice back one layer
   * down. So a host that has not supplied these gets no summary and no chips —
   * not an English summary it cannot translate.
   *
   * It is the one shape that also keeps this a non-breaking addition: every
   * host built against 0.12 renders exactly as it did.
   */
  readonly change?: ChangeWords | undefined;
  /**
   * Reads the freshness stamp in §17a's header — the frame's `as of 14:32 ↻`,
   * minus the clock.
   *
   * THE NUMBER IS APPENDED, NOT INTERPOLATED, exactly as {@link whyRank}'s is
   * and for the reason stated there: a `{n}` template makes every host
   * reimplement the substitution, which is how a package that refuses to invent
   * English ships a tiny template language instead. `Freshness.asOf` and
   * `Freshness.age` are the host's own strings and are printed verbatim.
   *
   * THE STALE FLAG CARRIES NO WORD, unlike layer 1's stamp, which appends a
   * literal ` · stale`. §17a's stamp is `as of 14:32 ↻` and says nothing more,
   * so staleness rides on `data-stale` for the stylesheet to treat. A word here
   * would be a fourth thing to translate for a state the frame draws silently.
   */
  readonly asOf: string;
  /**
   * The noun after the backlog's total — frame 17a's `312 open`.
   *
   * IT WORDS `Adoption.counts.total`, WHICH IS NOT `OrderCounts`. Two different
   * pairs reach this surface and only one of them is §17a's header content: the
   * adoption pair says how much of the backlog is encoded, and the order pair
   * (`ranked` / `readyNow` / `held`) says how the order splits. The second stays
   * in the rail, where it belongs to the order it describes.
   */
  readonly open: string;
  /**
   * The noun after the encoded count — frame 17a's `64 encoded`, wording
   * `Adoption.counts.declaring`.
   *
   * SEPARATE FROM {@link open} RATHER THAN ONE PHRASE, because the two numbers
   * are the package's and the two nouns are the host's; a single string would
   * have to carry both figures and would be a template again.
   */
  readonly encoded: string;
  /**
   * The panel's own heading — frame 17a's `INSPECTOR`.
   *
   * UNCONDITIONAL, and that is what it is for: the zone used to begin with
   * whatever the selection happened to resolve to, so a reader who had selected
   * nothing met a bare sentence in an unnamed column. The caps are the
   * stylesheet's, as they already are for `WHY RANK` and `RELATIONSHIPS`, so
   * the word supplied here reads as a word.
   */
  readonly inspector: string;
  /** Shown in the inspector when nothing is selected. */
  readonly nothingSelected: string;
  /**
   * The control that returns to nothing selected.
   *
   * NAMED FOR WHAT IT DOES, after a round of review found the previous name
   * inviting a host to write the wrong sentence: called `clearFilter`, it read
   * as "widen the list back", and the fixture here duly labelled it "show every
   * relationship" — a button that emptied the panel it promised to fill. The
   * command it publishes is `clear`, and that is the whole of its behaviour.
   */
  readonly clearSelection: string;
  /** Names the relationships list. */
  readonly relationships: string;
  /**
   * §17a's `WHY RANK n` heading, without the number.
   *
   * THE NUMBER IS APPENDED, NOT INTERPOLATED INTO A HOST TEMPLATE. A rank is
   * the one part of this heading the package knows and the host does not, and
   * a `{n}` placeholder would make every host reimplement the substitution —
   * which is how a package that refuses to invent English ends up shipping a
   * tiny template language instead.
   */
  readonly whyRank: string;
  /**
   * The same heading for a HELD slot, which has no rank to name.
   *
   * A held slot's rank is `null` by construction (`@issuegraph/derive` assigns
   * `ready ? (rank += 1) : null`), so "why rank —" would be a heading about a
   * position that does not exist. The design's own §16d ruling is the same one:
   * a held unit prints the em dash rather than a number.
   */
  readonly whyHeld: string;
  /**
   * Joins the rest of a together unit: §17a ends *"then worked with #514 as one
   * unit"*, and this is that phrase minus the members, which the package names.
   */
  readonly workedAsOneUnit: string;
  /**
   * Stated when the subject has no relationships at all.
   *
   * A STATED EMPTY IS NOT THE SAME AS AN ABSENT LIST. The panel used to draw
   * the `RELATIONSHIPS` heading and then nothing under it, which reads as a
   * list that failed to load rather than as an issue that is genuinely
   * unrelated to everything — and "this issue is connected to nothing" is one
   * of the more actionable things a grooming surface can say.
   */
  readonly noRelationships: string;
  /**
   * The control that begins a relationship from the selected issue — frame
   * 17a's `+ add`, publishing `add`.
   *
   * MOVED HERE FROM `MountWords`, where it was while the mount drew the button.
   * `renderWorkspace` is the published surface and the panel is now what draws
   * it, so a host rendering the markup without mounting gets the control rather
   * than a panel that can only be read. `MountWords` extends this, so the mount
   * still reads the same field and no host supplies two.
   */
  readonly addRelationship: string;
  /**
   * §17a's `ADD RELATIONSHIP` heading, over the numbered kinds.
   *
   * NOT {@link WorkspaceWords.addRelationship}, AND THE FRAME IS WHY. That
   * field is the CONTROL's label — frame 17a writes it `+ add`, on the
   * relationships header row — and this is the HEADING over the five numbered
   * choices, which the frame writes in full. They are two strings in the frame
   * and reusing one for both would put a control's label where a section name
   * belongs, in a panel whose other two headings are already section names.
   *
   * REQUIRED, on the same rule the three header nouns took. An optional field
   * would draw the heading only for a host that opted in, leaving every other
   * host with the frame's two moved placements and not its third — a panel that
   * half-applies the pass this exists to complete. The usual argument for
   * optional, that a host built against the previous version renders
   * byte-identically, has nothing to preserve here: this release moves `+ add`
   * and the kind digits for every host regardless of what it passes.
   */
  readonly addRelationshipHeading: string;
  /**
   * The control that abandons a draft — frame 17b's escape hatch beside the
   * numbered kind list, publishing `cancel`.
   *
   * MOVED HERE FROM `MountWords` WITH THE STEP IT BELONGS TO. The kind list and
   * the control that withdraws from it are one affordance; leaving the cancel
   * in host chrome while the list moved into the package would have split a
   * control group across two layers, and a draft the reader cannot abandon with
   * a pointer is the failure `create/keys.ts` names for the keyboard. The
   * mount's target-search step still reads this field, through the extension.
   */
  readonly cancel: string;
  /**
   * Names the issue a live draft was begun from, when that is not the panel's
   * subject — "relating from", read before the reference the package supplies.
   *
   * IT EXISTS BECAUSE THE TWO CAN DIVERGE AND THE DRAFT MUST STILL BE
   * CANCELLABLE. See {@link createStep}: a draft begun by `R` on a together
   * unit's non-lead member, or one outlived by a change of selection, leaves
   * the kind step live under a panel headed by a different issue. The step is
   * drawn anyway — it carries the only pointer cancel there is — so it has to
   * say whose it is, and the package invents that phrase no more readily than
   * it invents {@link WorkspaceWords.workedAsOneUnit}. The REFERENCE is the
   * package's, appended as its own element, so a host writes a phrase and never
   * a template.
   */
  readonly relatingFrom: string;
  /**
   * The accessible name of a row's remove control — the `✕` in frame 17a's
   * right-hand slot.
   *
   * ROW-INDEPENDENT WORDING. Which relationship it removes is in the markup
   * (`data-ig-target`) and in the row the button sits on, not in this string, so
   * a host writing "remove #488" here would be wrong on every other row.
   *
   * DISTINCT FROM `MountWords.deleteRelationship`, which names a different
   * control: that is the mount's labelled button for the one SELECTED edge, and
   * this is a glyph button repeated once per row. A glyph carries no name of its
   * own — see {@link relationshipSpec} — so the two cannot share one string
   * without one of them reading wrongly.
   */
  readonly remove: string;
  /**
   * The right-hand marker on an incoming row — frame 17a's `inbound`.
   *
   * IT IS A STATED FACT, NOT A MISSING CONTROL. An inbound edge's field lives in
   * the OTHER issue's body, so this panel's subject cannot declare it away; the
   * slot says which relationship this is rather than leaving a gap where the
   * other rows have a `✕`.
   */
  readonly inbound: string;
  /**
   * The control that reverses a directed relationship — frame 17b's `⇅ flip`.
   *
   * MOVED HERE FROM `PickerWords` WITH THE CONTROL ITSELF, on the same rule
   * that brought `addRelationship` and `cancel` down from `MountWords`: the
   * surface that draws a control owns the word for it, so a host rendering the
   * markup without mounting gets the affordance rather than a panel it can only
   * read. §17b calls direction “the single most common encoding mistake”, which
   * made this the worst control to have reachable from one rendering path only.
   *
   * IT IS NOT #144's MOVE, AND THE DIFFERENCE IS VISIBLE TO EVERY HOST.
   * `addRelationship` travelled between two interfaces in one `extends` chain,
   * so `words.addRelationship` read the same before and after. `MountWords`
   * holds the picker's vocabulary in a NESTED field, so this word's path
   * changed: `words.picker.flip` became `words.flip`.
   *
   * ROW-INDEPENDENT WORDING, exactly as {@link WorkspaceWords.remove} is. Which
   * relationship it reverses is the selected row it sits in, never this string.
   */
  readonly flip: string;
  /**
   * Why the store refused an edit, keyed by its code.
   *
   * TOTAL OVER `InvalidCode`, so a code the store adds is a compile error in
   * every host rather than a capsule that renders blank on the one refusal
   * nobody anticipated. The store's own `InvalidReason.message` is deliberately
   * not used: it is one sentence in one language chosen by the layer that
   * detected the refusal, and `overlay/grammar.ts` already records that an
   * invalid edge's sentence is the host's, keyed off the code.
   */
  readonly refusals: Readonly<Record<InvalidCode, string>>;
  /**
   * §17b's recovery cards, in the host's own words.
   *
   * `retry` AND `retryOnLatest` ARE TWO WORDS BECAUSE THEY ARE TWO CALLS. §17b
   * names the failed affordance "retry" and the conflict affordance "retry on
   * latest", and they reach `store.retry` and `store.retryOnLatest`
   * respectively — the second of which re-reads and ADOPTS the upstream
   * document as the new base before re-dispatching. One string for both would
   * make one card lie about what pressing it does, and it would be the card
   * whose consequence most needs stating.
   */
  readonly recovery: RecoveryWords;
  /**
   * §17d's findings panel, in the host's own words.
   *
   * NESTED, like `recovery` and `refusals` beside it, because it is a record
   * over a closed class table rather than a loose string — flattening four
   * chips and four titles into this interface would put eight members here
   * whose relationship to each other is only legible from their names.
   */
  readonly audit: AuditWords;
}

export interface RecoveryWords {
  /** Names the state on a failed card. */
  readonly failed: string;
  /** Names the state on a conflicted card. */
  readonly conflict: string;
  readonly viewDiff: string;
  /** `failed` → `store.retry`. */
  readonly retry: string;
  /** `conflict` → `store.retryOnLatest`, which adopts upstream as the new base. */
  readonly retryOnLatest: string;
  readonly discardMine: string;
  /** Heads the edges the held document has and the reader's does not. */
  readonly upstreamOnly: string;
  /** Heads the reader's own unlanded edit, where it ADDS a relationship. */
  readonly mineOnly: string;
  /** Heads the reader's own unlanded edit, where it REMOVES one. */
  readonly mineRemoved: string;
  /** Heads relationships both sides hold pointing opposite ways. */
  readonly carrierReversed: string;
  /** Heads the issues the two documents disagree about. */
  readonly issuesChanged: string;
  /** Shown when the diff has nothing to show on THIS panel. */
  readonly diffEmpty: string;
  /**
   * Why a `retry on latest` could not even read.
   *
   * The store's refresh is half of one operation: when it fails the record is
   * restored verbatim and nothing is dispatched, so without this the button
   * reads as dead on exactly the failure the store went to trouble to make
   * observable.
   */
  readonly retryFailed: string;
  /**
   * Heads the region for recoveries with no panel to sit on.
   *
   * See {@link WorkspaceRecovery.carrier}: a write about issues this backlog
   * does not hold has no panel, and dropping it would leave the reader's work
   * unrecoverable.
   */
  readonly unplaced: string;
}

/**
 * One unsettled write the reader can still act on: §17b's `failed` and
 * `conflict`.
 *
 * NARROW FOR THE REASON {@link WorkspaceRefusal} IS, and shaped the same way.
 * The whole write ledger is the larger surface this deliberately is not: a
 * `WriteRecord` carries a `Mutation` and, on a conflict, an entire second
 * `GraphDocument`, none of which a renderer can draw. What a card needs is the
 * state, the reason or the difference, and which panel states it.
 *
 * A UNION, BECAUSE THE TWO STATES CARRY DIFFERENT FACTS. `WriteRecord` is
 * already a union on this exact line. Two optionals would admit a conflict with
 * no diff and a failure with one, and the renderer would need a runtime guard
 * for a case the type can refuse outright.
 *
 * NO `phantom` EQUIVALENT, and the absence is deliberate rather than an
 * oversight. {@link WorkspaceRefusal.phantom} exists because a refusal either
 * JOINS a relationship row or REPLACES it, and getting that wrong deletes a
 * removable relationship from the panel. A recovery card is its own element in
 * its own region and replaces nothing, so the question does not arise.
 */
export type WorkspaceRecovery =
  | {
      readonly kind: 'failed';
      readonly mutationId: MutationId;
      readonly edgeId: EdgeId;
      readonly carrier: string | null;
      /**
       * The adapter's own sentence, verbatim.
       *
       * NOT KEYED OFF A CODE, and the asymmetry with {@link
       * WorkspaceWords.refusals} is the argument. The store's refusal codes are
       * a CLOSED set the store owns, so a host can be made total over them. An
       * adapter's failure is an open one — a status, a rate limit, a network
       * message — and there is no code to key on, so the sentence travels.
       */
      readonly reason: string;
    }
  | {
      readonly kind: 'conflict';
      readonly mutationId: MutationId;
      readonly edgeId: EdgeId;
      readonly carrier: string | null;
      /** Both sides, held apart. See `recovery.ts`. */
      readonly diff: ConflictDiff;
      /**
       * Why the last refresh could not read, or `null`.
       *
       * A `retry on latest` whose READ fails restores the record exactly as it
       * was and dispatches nothing — the conflict keeps its held document so it
       * can still be compared against. Without this the card re-renders
       * identically and the button reads as dead.
       */
      readonly refreshError: string | null;
    };

/**
 * One refused edit, as the panel needs it: which edge, and why.
 *
 * NARROW ON PURPOSE, AND THE NARROWNESS IS THE ARGUMENT. `WorkspaceOptions.projected`
 * already carries every edge's states, and `invalid` is among them — but a
 * state says an edge was refused and never says why, because the code lives on
 * `WriteRecord.reason`, which reaches no renderer. The alternative was to hand
 * the panel the whole write ledger, which is the input #137's conflict cards
 * need and is a much larger surface: both versions of a conflicted body, the
 * upstream document, the retry and discard affordances. This is one code per
 * edge id, derivable in a shell from what the store already publishes, and
 * nothing here is blocked on that larger shape.
 */
export interface WorkspaceRefusal {
  readonly edgeId: EdgeId;
  readonly code: InvalidCode;
  /**
   * The issue whose panel states this refusal.
   *
   * THE EDIT'S OWN SUBJECT, DECIDED BY WHOEVER MADE THE EDIT. This panel used
   * to work it out for itself, by asking whether the refused edge's identity
   * named the issue on show — a derivation entirely separate from the one that
   * produced the subject, and free to disagree with it. It did, three times
   * over: an unfiltered orphan branch drew every refusal on every panel; a
   * retype whose projection hid the edge the panel was filtered to left the
   * panel with no subject and the reason nowhere; and a draft begun from a
   * together-unit partner produced an edge naming the partner while
   * `inspectorView` had canonicalized the panel onto the slot's lead, so
   * nothing matched. None of the three is a question this renderer can answer
   * from an identity, because none of them is about the identity.
   *
   * A MOUNT KNOWS IT WITHOUT GUESSING, BECAUSE IT WROTE IT DOWN. `editCarrier`
   * in `host.ts` answers it — for a create from a draft, for a retype or flip
   * whose produced identity differs from the one the reader named, and for a
   * delete — and `mountWorkspace` asks it as the edit goes OUT, while the
   * document still holds the relationship, then keeps the answer against the
   * write. It cannot be asked again afterwards: by the time a refusal comes
   * back a sibling write may have removed the edge, and an identity records
   * which two issues a relationship was between and never which of them
   * declared it. A host rendering without `mountWorkspace` states the same fact
   * the same way: whichever issue's panel it wants the refusal read on, decided
   * when it made the edit.
   *
   * NOT DERIVABLE FROM {@link WorkspaceRefusal.edgeId}, which is why it is a
   * second field rather than a lookup. `unknown-issue` names an issue the
   * document does not hold; `unknown-edge` names an edge it does not hold; and
   * a together unit's panel is headed by a key the edge may never mention.
   */
  readonly carrier: string;
  /**
   * Whether the edge this refusal marks exists only because the refusal does.
   *
   * NOT EVERY REFUSAL IS ABOUT AN EDIT THAT LEFT NO TRACE, and reading them as
   * if they were deleted a relationship the reader still has. Three of the
   * store's codes mark an edge that is already LANDED — measured against the
   * store rather than reasoned from the code list: `duplicate-edge` (a create
   * of a relationship that exists; `project` folds the phantom onto the real
   * edge), and `unchanged-kind` and `symmetric-edge` (a retype or flip whose
   * result has the identity it started from, so `edgeChangeFor` marks the
   * original rather than swapping it). `cardinality` looks like a fourth and is
   * not: through a create it marks the edge it would have made, and through a
   * retype it marks the edge it would have BECOME — a phantom either way, with
   * the original hidden — which is exactly why this is asked of the document
   * rather than keyed off a list of codes. With the capsule REPLACING the row
   * for all of them, telling a reader "this relationship is already declared"
   * removed the declared relationship's row from the panel, remove control
   * included — so the one message they were given was contradicted by the list
   * beside it, and nothing on the surface could undo the edge they had just
   * been told about.
   *
   * TRUE MEANS THE ROW IS THE REFUSAL. A refused CREATE of a genuinely new
   * relationship draws as a capsule in the row it would have been: there is no
   * relationship to operate, and a `select-edge` and a `✕` on it would offer to
   * remove something that was never added. False means the relationship is
   * real, so the row stands and the reason is attached to it.
   *
   * REQUIRED, BECAUSE NEITHER DEFAULT IS SAFE. Defaulted to `true` the panel
   * eats real rows; defaulted to `false` it draws a live remove control for an
   * edge the document does not have. A host derives it in one line — the
   * refused id is in `snapshot.landed` or it is not — and the store's own
   * projection is where both halves already come from.
   */
  readonly phantom: boolean;
}

export interface WorkspaceOptions {
  /**
   * The words. Required, for the reason `ChangeWords` gives: this package does
   * not invent an English sentence, and a default would be one.
   */
  readonly words: WorkspaceWords;
  /**
   * The store's `lastChange` — what the last landed edit did to the order.
   *
   * ABSENT MEANS NO EDIT HAS LANDED TO REPORT, which is not the same as an edit
   * that landed and moved nothing. The second is a `change` whose summary is
   * `unchanged`, and §17c draws it in the summary's own place because "landed
   * and moved nothing" is the finding an owner auditing an encoding most needs.
   */
  readonly change?: OrderChange | null | undefined;
  /**
   * The store's `order.status`. `held` labels the rail and greys it one step.
   *
   * THE RANKS DRAWN ARE STILL THE ONES THE CALLER VOUCHED FOR. This says the
   * order is being re-evaluated; it does not re-rank anything, and nothing in
   * this render moves a row because a write is in flight. §122's rule —
   * optimistic rendering yes, optimistic re-ORDERING no — is held by there
   * being no code path here that reorders at all.
   */
  readonly orderStatus?: OrderStatus | undefined;
  readonly selection?: WorkspaceSelection | undefined;
  /** The ladder's reader position — search, focus, opened isolates. */
  readonly scale?: ScaleState | undefined;
  /** Which slice of the order the rail draws. See {@link railWindow}. */
  readonly rail?: RailWindowOptions | undefined;
  /**
   * The audit's input, when the host has one.
   *
   * ABSENT MEANS "NOT RUN", NOT "CLEAN", and the two render differently: with
   * no input the header is left out entirely rather than drawn at zero, because
   * a zero the reader can trust and a zero nobody computed are different facts.
   */
  readonly audit?: AuditInput | undefined;
  /**
   * Whether the audit filter is narrowing the rail to affected rows.
   *
   * THE HEADER PUBLISHES THE TOGGLE, SO SOMETHING HAS TO HOLD ITS STATE.
   * `renderAuditHeader` draws a `button` with `aria-pressed`, and without this
   * option every render answered `false` and left the rail unnarrowed — a
   * control that could not complete the action it advertised, which is the
   * finding the scale ladder already records paying for once. The ladder's note
   * is also the resolution: layer 2 CAN narrow, and the assembling surface is
   * the layer that holds the state to narrow with.
   *
   * Ignored with no audit, because there is nothing to filter by.
   */
  readonly auditFiltered?: boolean | undefined;
  readonly theme?: Theme | undefined;
  /** The selector the theme's custom properties are written onto. */
  readonly themeSelector?: string | undefined;
  /**
   * The store's projection, for the canvas to draw each edge's write states.
   * See `ScaleLadderOptions.projected`; the workspace forwards it and reads
   * none of it, because the rail and the inspector draw no line to overlay.
   *
   * AND IT IS NOT WHERE THE INSPECTOR'S REFUSALS COME FROM, which is worth
   * saying here because it is the obvious place to look. A `ProjectedEdge`
   * carries `states` and `writes` — so it says an edge is `invalid` and never
   * says why. The code is on the write record, and the panel takes it through
   * {@link WorkspaceOptions.refusals}.
   */
  readonly projected?: readonly ProjectedEdge[] | undefined;
  /**
   * The create draft in flight, so the panel can draw the step the reader is on.
   *
   * §17b's inspector path is `+ add` → kind → target, and `create/draft.ts`
   * makes `begin` RESET the kind and the target on purpose. An always-visible
   * kind list would therefore let a reader fill a slot that the next `+ add`
   * silently discards, so the list is drawn only while a draft is live —
   * which the panel cannot know without being told.
   *
   * Absent means idle, which is the state a host that has no create path is in.
   */
  readonly draft?: CreateDraft | undefined;
  /**
   * Where a canvas drop landed, or `null`. Read for its NULLNESS alone.
   *
   * THE PANEL SUPPRESSES ITS KIND LIST WHILE A DROP IS LIVE, which is the
   * invariant that keeps the two choosers mutually exclusive. A drag that ends
   * on the canvas opens a chooser AT THE DROP POINT; a panel list drawn at the
   * same moment would be a second copy of the same step, one under the
   * reader's pointer and one in the column beside it, both writing to the one
   * draft. The shell held that rule alone while it drew both, and it cannot
   * hold it any more now that one of them is package markup.
   *
   * The host's own value is forwarded rather than a boolean derived from it:
   * a `dropInFlight: boolean` would be a second spelling of a fact the shell
   * already holds, free to disagree with it on the render where it matters.
   */
  readonly drop?: Point | null | undefined;
  /**
   * The edits the store refused, so the panel can say so where the reader made
   * them. See {@link WorkspaceRefusal}.
   *
   * IN THE ORDER THE STORE RECORDED THEM, and that is part of the contract
   * rather than an accident of how a caller happened to build it. One row
   * states one reason, so two refusals naming one edge collapse to the LAST —
   * the one the reader just caused, rather than the one they have read and
   * moved past. A caller assembling this from two passes and concatenating
   * them loses that chronology at the join; `mountWorkspace` walks
   * `snapshot.writes` once for exactly this reason.
   *
   * ABSENT MEANS "NOTHING REFUSED", which is unlike {@link WorkspaceOptions.audit}
   * and is safe for the reason that one is not: a refusal is a fact the store
   * produces, so a host with no refusals to report and a host that never asked
   * are in the same position — there is nothing to draw either way. An audit
   * count is a NUMBER, and inventing a zero for one nobody computed is the
   * distinction that option exists to keep.
   */
  readonly refusals?: readonly WorkspaceRefusal[] | undefined;
  /**
   * The failed and conflicted writes the reader can still act on.
   *
   * OPTIONAL, on the same reasoning as {@link WorkspaceOptions.refusals}: an
   * unsettled write is a fact the store produces, so "none" and "never asked"
   * leave the panel with the same nothing to draw.
   */
  readonly recoveries?: readonly WorkspaceRecovery[] | undefined;
  /**
   * Which conflict has its difference open, if any.
   *
   * ONE AT A TIME, because the region is inside a panel rather than a dialog.
   * The shell holds it for the reason `auditFiltered` is held: the card
   * publishes a toggle, so something has to carry its state or every render
   * answers "closed" and the control cannot complete what it advertises.
   */
  readonly diffOpen?: MutationId | null | undefined;
}

export interface WorkspaceView {
  readonly selection: WorkspaceSelection;
  readonly rail: RailWindow;
  readonly inspector: InspectorView;
  /** `null` when no audit input was supplied — see {@link WorkspaceOptions.audit}. */
  readonly audit: AuditOverlay | null;
  /**
   * Whether the rail was narrowed to affected rows.
   *
   * DERIVED, not echoed: it is `auditFiltered` AND an audit to filter by, so a
   * caller reading this is reading what actually happened rather than what was
   * asked for.
   */
  readonly auditFiltered: boolean;
}

export interface WorkspaceResult {
  readonly view: WorkspaceView;
  /** The whole surface: the four zones inside one root. */
  readonly markup: string;
  /** Every stylesheet this surface needs, in install order. */
  readonly styles: string;
  readonly diagnostics: readonly string[];
}

/**
 * A zone frame.
 *
 * The only tag written by hand in this package, and it takes no caller value:
 * `zone` is one of {@link ZONES} and `inner` is already-rendered markup from
 * `renderMarkup` or from a sibling leaf's renderer.
 */
function zone(name: Zone, inner: string): string {
  return `<section class="ig-zone" data-zone="${name}">${inner}</section>`;
}

/**
 * The height the rows outside the window would have taken.
 *
 * WITHOUT THESE THE SCROLL CONTAINER CANNOT REACH THE ORDER. The rail zone
 * scrolls, and a zone containing only the drawn rows is exactly as tall as
 * those rows — so native scrolling stops at the end of the first window, and a
 * host has no scroll offset to turn into the next `start`. `addressOf` keeps
 * the MODEL complete, and a reader who cannot scroll to rank 287 does not care.
 *
 * ONE ROW HEIGHT FOR ALL OF THEM, which is an approximation and is stated as
 * one: a row carrying holds is taller than a bare one, so the scrollbar is
 * proportional rather than exact. That is the standard cost of fixed-height
 * virtualisation and the alternative — measuring rows — needs a mount, which
 * this package does not have and will not grow.
 *
 * `aria-hidden`, because a spacer is geometry: it names no row, and a reader
 * moving by rank uses the order rather than the scrollbar.
 */
function railSpacer(rows: number, edge: 'before' | 'after'): string {
  return rows === 0
    ? ''
    : renderMarkup(
        element('div', {
          class: 'ig-rail-spacer',
          'data-edge': edge,
          'aria-hidden': 'true',
          // Through `element`, so the one dynamic value here is escaped by the
          // same renderer as every other attribute in this package.
          style: `--ig-rail-rows:${String(rows)}`,
        }),
      );
}

/** The heaviest severity across a row's members, or `undefined` when clean. */
function severityForRow(
  overlay: AuditOverlay | null,
  members: readonly string[],
): AuditSeverity | undefined {
  // THE RANKING BELONGS NEXT TO THE WEIGHTS, which is why this delegates rather
  // than scanning. An earlier version walked `overlay.rows` and took the first
  // member it matched, on the stated grounds that those rows are "sorted" — and
  // they are, by `ref`, LEXICOGRAPHICALLY. So it returned whichever member
  // sorted earliest, and a `stale-blocker` on `a` masked a `cycle` on `b`: the
  // bar still appeared, understating what it was about. The comment asserting
  // the justification was the defect, not the loop.
  return overlay === null ? undefined : heaviestRow(overlay, members)?.severity;
}

/**
 * Add `data-ig-audit` to the rail's keyed rows.
 *
 * A total walk that rebuilds the tree rather than mutating it: `ElementSpec` is
 * `readonly` throughout, and a mutating walk would also be visible to the
 * caller's own copy of `scene.root`.
 */
/**
 * What a keyed rail row needs to draw its delta: the chip, the words that word
 * it, and the kind that tints the row.
 *
 * THE WORDS TRAVEL WITH THE CHIP rather than being closed over separately, so
 * a row can only be marked by a caller that actually has a vocabulary for it.
 * Without `words.change` there is no `RowDelta` to hand out at all, which is
 * how "the package invents no English" is held by the types instead of by a
 * branch someone has to remember.
 */
interface RowDelta {
  readonly chip: PlacedChip;
  readonly words: ChangeWords;
  /** `undefined` when no member carries a drawable delta. See {@link DELTA_ATTRIBUTE}. */
  readonly kind: string | undefined;
}

function markRail(
  root: ElementSpec,
  severityOf: (key: string) => AuditSeverity | undefined,
  deltaOf: (key: string) => RowDelta | undefined,
): ElementSpec {
  // TYPED AS `ElementSpec -> ElementSpec` AT THE BOUNDARY, with the child walk
  // kept inside. A single function over `SpecChild` would hand `renderMarkup` a
  // union it does not take, and the obvious repair — casting the result back —
  // is the one this repository bans outright. The narrowing belongs where the
  // string case actually lives.
  const markChild = (child: SpecChild): SpecChild =>
    typeof child === 'string' ? child : markSpec(child);

  function markSpec(spec: ElementSpec): ElementSpec {
    const key = spec.attrs?.[KEY_ATTRIBUTE];
    // A KEY IS A STRING OR IT IS NOT A KEY. `AttrValue` admits numbers and
    // booleans, and `String(true)` would look up a row named "true" — which
    // resolves to nothing today and to something the day a host names an issue
    // that. Narrowed rather than coerced.
    const severity = typeof key === 'string' ? severityOf(key) : undefined;
    const delta = typeof key === 'string' ? deltaOf(key) : undefined;
    const walked = spec.children?.map(markChild);
    // THE CHIP IS APPENDED TO THE ROW, WHICH IS WHY IT IS DRAWN HERE AND NOT
    // IN A MOUNT. §17c puts the effect in place — "only affected rows carry a
    // delta chip · unaffected rows are left completely alone" — and
    // `reevaluate/render.ts` deferred that to "the change that assembles the
    // workspace" on the ground that placing a chip needs the row's geometry.
    // It does not: the row is a SPEC here, keyed and reachable, and this walk
    // was already composing one decoration onto it. So the chip is composed
    // like the audit's mark rather than positioned like an overlay, and no
    // geometry is consulted at all.
    //
    // AN UNAFFECTED ROW IS RETURNED WITH ITS OWN `children` ARRAY, not a
    // rebuilt one carrying an appended `null` — `deltaOf` answering `undefined`
    // has to leave the row byte-identical, which is the design's rule made
    // structural rather than asserted.
    const chip = delta === undefined ? null : chipSpec(delta.chip, delta.words, { placed: true });
    const children = chip === null ? walked : [...(walked ?? []), chip];
    const marked: Record<string, AttrValue> = { ...spec.attrs };
    if (severity !== undefined) marked[AUDIT_SEVERITY_ATTRIBUTE] = severity;
    // THE CHIP IS IN THE ROW'S NAME, OR IT IS SILENT.
    //
    // Layer 1 gives the row an `aria-label`, and an accessible name computed
    // from `aria-label` WINS over descendant text — so a chip appended here is
    // seen and not heard. The rail is the surface a reader arrows through, and
    // "which row moved, and by how much" is exactly what §17c puts on the row;
    // the summary above carries aggregate counts and cannot recover it.
    //
    // APPENDED TO THE NAME rather than hung off `aria-describedby`, and the
    // reason is that the alternative costs more than it looks. A description
    // needs an id, this package emits none anywhere, and `a11y/baseline.ts`
    // records what ids cost here — a host-derived token reaching an attribute
    // that other code resolves, which is the injection class the mount's focus
    // token was written to avoid. A name needs no id and is announced as the
    // reader arrives rather than after it.
    //
    // The separator is layer 1's own: `slotLabel` joins its three parts with
    // the same em dash, so this reads as one more part rather than a second
    // sentence in a different hand.
    const label = marked['aria-label'];
    if (chip !== null && typeof label === 'string') {
      marked['aria-label'] = `${label} — ${textOf(chip)}`;
    }
    // OMITTED WHEN THE CHIP HAS NO DRAWABLE KIND, rather than stamped empty.
    // `DELTA_ATTRIBUTE` records why: an attribute on every row with one value
    // meaning "nothing" is marking the row, not leaving it alone.
    if (delta?.kind !== undefined) marked[DELTA_ATTRIBUTE] = delta.kind;
    const attrs: Readonly<Record<string, AttrValue>> | undefined =
      severity === undefined && delta?.kind === undefined ? spec.attrs : marked;
    return {
      ...spec,
      ...(attrs === undefined ? {} : { attrs }),
      ...(children === undefined ? {} : { children }),
    };
  }

  return markSpec(root);
}


/**
 * A row's right-hand slot: exactly one of `selected`, a remove control, or the
 * inbound marker.
 *
 * THE ORDER IS THE FRAME'S AND IT IS ALSO THE SAFE ONE. A selected row's SLOT
 * says so and offers nothing else, which matters because `selected` is the
 * state that FILTERS this panel: the reader is looking at one edge on purpose,
 * and a destructive control is not what the slot is for at that moment.
 *
 * THE SLOT, NOT THE ROW — §17b's flip sits beside it on exactly that row. The
 * reasoning above is specific to a DESTRUCTIVE control; a flip is the
 * corrective act §17b asks for, so it is admitted where a `✕` is not.
 * {@link relationshipSpec} draws it as the slot's peer and says why there.
 *
 * AN INBOUND ROW GETS NO REMOVE CONTROL, and that is a fact about the format
 * rather than caution. An incoming edge's field is declared in the OTHER
 * issue's body, so this panel's subject cannot declare it away; a `✕` there
 * would publish an edit that either does nothing or edits a document the
 * reader is not looking at. The reference implementation encodes the same rule
 * as `removable: false`, and frame 17a puts the word `inbound` in the slot the
 * other rows spend on `✕`.
 *
 * THE KEYBOARD'S `⌫` IS NOT A SECOND RULE. `create/keys.ts` acts on the
 * SELECTED edge because a selection is the only edge a keyboard has named; that
 * is this rule with the selection as the subject, not an exception to it.
 *
 * `selected` IS THE PACKAGE'S OWN WORD, taken from `treatmentForState` rather
 * than from the words object. Write-state names are already authored here —
 * `writing…`, `failed`, `invalid` — and a `selected` on `WorkspaceWords` would
 * be a second spelling of one the overlay grammar publishes on the canvas.
 */
function rowSlot(
  relationship: InspectorRelationship,
  selected: string | null,
  words: WorkspaceWords,
): ElementSpec {
  if (relationship.edgeId === selected) {
    return element(
      'span',
      { class: 'ig-relationship-state', 'data-ig-state': 'selected' },
      [treatmentForState('selected').label],
    );
  }
  if (relationship.direction === 'incoming') {
    return element('span', { class: 'ig-relationship-inbound' }, [words.inbound]);
  }
  // THE GLYPH IS HIDDEN AND THE NAME IS AN ATTRIBUTE. `glyphAndLabel` draws a
  // VISIBLE word beside its glyph, which is right for the kind and wrong here:
  // the frame's slot is a bare `✕`. So the mark is layer 1's `hiddenGlyph` —
  // the published half of that same pairing, rather than its class and its
  // `aria-hidden` written out again here, which is exactly the local copy
  // `glyphAndLabel`'s own header calls the failure it exists to prevent. `✕`
  // announces as whatever a screen reader's character table calls it, which
  // describes the mark and not the act, so the host's word becomes the
  // button's accessible name. On the BUTTON, never on a span around it:
  // `parts.ts` records that a plain span takes the generic role, on which ARIA
  // prohibits naming, so the name would be dropped without a warning.
  return element(
    'button',
    {
      type: 'button',
      class: 'ig-relationship-remove',
      'data-ig-command': 'delete',
      // ITS OWN ROW'S EDGE, WHICH IS THE WHOLE POINT OF THE ATTRIBUTE HERE.
      // `reduceHost`'s delete arm read the selection and ignored the target
      // while the only delete control lived inside `if (edgeId !== null)`; a
      // control repeated per row makes that wrong in both directions — a no-op
      // with an issue selected, and a delete of the WRONG edge with a
      // different row's edge selected.
      'data-ig-target': relationship.edgeId,
      'aria-label': words.remove,
    },
    [hiddenGlyph('\u2715')],
  );
}

/**
 * §17b's flip, on the selected row.
 *
 * ## It is drawn where the sentence is, and only where the reducer can act
 *
 * Frame 17b draws a directed relationship as a statement with `⇅ flip` at the
 * end of the same line, and the row already IS that statement: with an edge
 * selected the panel filters to one relationship and
 * {@link relationshipDescription}'s no-subject arm words it forward with both
 * references in stored order. So the control joins the row rather than opening
 * a second card above it — a card would need a sentence of its own, and the
 * panel would then state one relationship twice, one element apart, which is
 * the encoding ambiguity §17b exists to remove.
 *
 * ONLY ON THE SELECTED ROW, and that is a fact about the REDUCER rather than
 * restraint. `reduceHost`'s `flip` arm takes its edge from
 * `selectedEdgeId(state.selection)` and ignores `data-ig-target` — deliberately,
 * because a flip is one operation about the edge the reader is looking at. A
 * control on an unselected row would publish a command the reducer would answer
 * about a different edge, or, with an issue selected, about none; the panel's
 * standing rule is that a control which cannot complete the act it advertises
 * is not drawn.
 *
 * THAT GUARANTEE IS THE MOUNT'S, AND A STANDALONE HOST OWES THE SAME STEP. This
 * surface is handed a `ViewerDocument` and the reducer a `GraphDocument`, so
 * "the selected edge exists" is only true while the two agree. `mountWorkspace`
 * makes them agree by running `reconcileHost` against the landed document
 * before every render, which clears a selection naming an edge that is gone and
 * moves one naming an edge hidden behind an unsettled write. A host wiring the
 * published attributes itself must do the same, or it can draw a flip whose
 * press the reducer answers with nothing.
 *
 * ## A symmetric kind gets no control, and the absence is the finding
 *
 * `serialize-with` and `together-with` state one fact whichever way round they
 * are stored, so a control to reverse them claims something the format does not
 * say — and the store would refuse the edit as `symmetric-edge` anyway.
 * `picker/view.ts` already answers `null` there; this agrees with it rather
 * than contradicting it from the next zone over.
 *
 * ONE ORACLE FOR THAT QUESTION. The directedness is read off the SAME
 * {@link EdgeTreatment} `relationshipDescription` already reads to word the
 * row, which is what `labelFrom` itself branches on. Importing
 * `isSymmetricEdgeField` here instead would put two answers to one question at
 * one call site, in a package whose objection everywhere else is "not a wrong
 * answer, a second answer". `render.test.ts` pins the two to agree across the
 * whole vocabulary, so the shorter reach is safe in both directions.
 *
 * ## It publishes and wires nothing
 *
 * `data-ig-command="flip"` and no target: the attribute the reducer does not
 * read would advertise a per-row flip it does not implement. On a `button`,
 * because a span has no tab stop and no native activation — the control §17b
 * names most error-prone is the last one that should be pointer-only.
 */
function flipControl(
  relationship: InspectorRelationship,
  selected: string | null,
  words: WorkspaceWords,
): ElementSpec | null {
  if (relationship.edgeId !== selected) return null;
  if (treatmentFor(relationship.field).symmetric) return null;
  return element(
    'button',
    { type: 'button', class: 'ig-relationship-flip', 'data-ig-command': 'flip' },
    [words.flip],
  );
}

/**
 * The host's sentence for a refusal, wherever the panel states one.
 *
 * SHARED FOR THE REASON THE HEAD BELOW IS. A refusal reaches the reader in two
 * shapes — a capsule standing in for a relationship that does not exist, and a
 * reason attached to one that does — and a second element built at the second
 * site would be free to take a different class and lose the rule that styles
 * it, on the half that ships later.
 */
function refusalReason(code: InvalidCode, words: WorkspaceWords): ElementSpec {
  return element('span', { class: 'ig-relationship-reason' }, [words.refusals[code]]);
}

/**
 * What a relationship READS as: the kind's glyph and word, and the reference at
 * the other end. No control, no wrapper — only the description.
 *
 * ONE DESCRIPTION FOR THE ROW AND FOR THE CAPSULE. They state the same thing
 * about the same edge, and they briefly stated it twice — including deriving
 * `outgoing` from the same two values in both places, which is the shape this
 * package calls a second answer rather than a repetition.
 *
 * SPLIT FROM THE CONTROL THAT WRAPS IT, rather than parameterised with a
 * "draw a button?" flag, because the two callers do not differ in a DETAIL of
 * one element: one of them draws no control at all. A flag would leave the
 * element that IS the control deciding whether to be one, and every attribute
 * on it conditional on that. The description is the shared fact; who wraps it
 * is the caller's, exactly as the slot beside it and the border around it
 * already are.
 *
 * ## It draws the OTHER end, and words the kind from the subject's end
 *
 * The row used to draw three bare tokens — the field's machine name, then both
 * endpoints — one of which is the issue whose panel this is. So the reader read
 * their own subject back on every row and had to work out which of the two
 * references was the other one, from a token that stated no direction at all
 * while `data-direction` sat unread on the same element.
 *
 * WITH NO ISSUE SUBJECT THERE IS NO "OTHER END", and both are drawn. That is an
 * edge selection: the panel is showing one relationship rather than one issue's
 * relationships, so the head reads as the edge is stored, `from` before `to`,
 * and the kind takes its plain forward wording. Picking one end there would
 * mean picking arbitrarily and then wording the sentence around the choice.
 */
function relationshipDescription(
  relationship: InspectorRelationship,
  subject: string | null,
): readonly ElementSpec[] {
  const treatment = treatmentFor(relationship.field);
  const outgoing = subject === null || relationship.from === subject;
  // THE ROLE TRAVELS WITH THE REFERENCE, and it is not decoration. §17b's rule
  // is that direction is STATED, never inferred — and with no issue subject
  // both ends are drawn, so without a role the only thing saying which is which
  // is their ORDER. That is inference, by the reader and by any host restyling
  // the row. `directionSpec` published exactly this pair of roles before §17b's
  // statement became the row; dropping them would have moved the statement and
  // quietly lost the half that made it a statement.
  //
  // OMITTED, NOT FALSIFIED, WHERE THERE IS NO PAIR. With an issue subject the
  // row draws one reference — the other end — and it is worded relative to the
  // subject by `labelFrom`, so a `from`/`to` on it would name an end of the
  // stored pair while the words name an end of the reader's sentence, and those
  // are not always the same one.
  const reference = (ref: string, role?: 'from' | 'to'): ElementSpec =>
    element('span', { class: 'ig-relationship-ref', 'data-ig-role': role }, [ref]);
  return [
    element(
      'span',
      { class: 'ig-relationship-kind' },
      // LAYER 1's PAIRING, not a second one. The glyph is one of the four
      // channels the colour-blind-safety claim rests on and is
      // `aria-hidden` because it announces as a character description;
      // the word beside it is what a reader hears. A local copy of that
      // arrangement is free to drop the second half.
      glyphAndLabel(treatment.glyph, labelFrom(treatment, outgoing)),
    ),
    ...(subject === null
      ? [reference(relationship.from, 'from'), reference(relationship.to, 'to')]
      : [reference(outgoing ? relationship.to : relationship.from)]),
  ];
}

/**
 * A relationship's head on a row that HAS one: the description, inside the
 * control that selects the edge.
 *
 * ONLY WHERE THE EDGE IS IN THE DOCUMENT. `select-edge` reduces to a selection,
 * and the next render's `reconcileHost` drops a selection naming an edge the
 * landed document does not carry — so on a phantom this control would close the
 * inspector instead of inspecting anything. That is the rule the panel's own
 * header already states about `+ add`: a control that cannot complete the act
 * it advertises is not drawn. {@link refusalCapsule} draws the description
 * bare for exactly that reason.
 */
function relationshipHead(
  relationship: InspectorRelationship,
  subject: string | null,
): ElementSpec {
  return element(
    'button',
    {
      type: 'button',
      class: 'ig-relationship-select',
      'data-ig-command': 'select-edge',
      'data-ig-target': relationship.edgeId,
    },
    relationshipDescription(relationship, subject),
  );
}

/**
 * One relationship, as a row the reader can actually operate.
 *
 * THE COMMAND SITS ON A BUTTON, NOT ON THE `li`. A plain list item has no tab
 * stop and no native Enter/Space activation, so a `data-ig-command` on one is
 * reachable by pointer and by nothing else — and a host wiring the published
 * attributes cannot fix that without rebuilding the semantics this package
 * should have supplied. Every other command in the package is already on a
 * button; {@link refusalCapsule}'s capsule is the same `li` + `button` shape.
 *
 * The `li` keeps the hue and the direction, because those describe the
 * relationship rather than the action.
 *
 * ## A REFUSAL CAN LAND ON A ROW THAT STAYS
 *
 * `refused` is the code when the store refused an edit ABOUT this relationship
 * and the relationship is still there — a create of an edge that already
 * exists, a retype to the kind it already has, a flip of a symmetric kind. The
 * reason joins the row and the row keeps its remove control, because the edge
 * it names is real and removable; only a refusal about an edge that does not
 * exist replaces the row, and {@link WorkspaceRefusal.phantom} is which. It is
 * published as `data-ig-code` here for the same reason the capsule publishes
 * it: a host styles or counts refusals off the store's vocabulary rather than
 * by matching a sentence.
 */
function relationshipSpec(
  relationship: InspectorRelationship,
  subject: string | null,
  selected: string | null,
  words: WorkspaceWords,
  refused: InvalidCode | undefined,
): ElementSpec {
  return element(
    'li',
    {
      class: 'ig-relationship',
      'data-edge': relationship.field,
      // Omitted rather than falsified when the subject is not an issue: an edge
      // selection has no "my end", and `data-direction=""` would claim one.
      'data-direction': relationship.direction ?? undefined,
      'data-ig-code': refused,
    },
    [
      relationshipHead(relationship, subject),
      refused === undefined ? null : refusalReason(refused, words),
      rowSlot(relationship, selected, words),
      // A PEER OF THE SLOT RATHER THAN A FOURTH OCCUPANT OF IT. The slot's
      // three occupants are exclusive because two are statements and one is a
      // destructive control, and a row is only ever one of those things; the
      // flip is neither, and it coexists with the `selected` marker on the one
      // row that draws both. Last, because frame 17b ends the statement's line
      // with it.
      flipControl(relationship, selected, words),
    ],
  );
}

/**
 * A refused relationship, drawn where the reader was building it.
 *
 * §17b's rule is that a refusal is shown IN PLACE and never snapped back, and
 * until this the package had no surface that said so: the store marked the edge
 * `invalid`, the canvas drew a ghost line, and the panel the reader had just
 * used listed nothing about it. `would-cycle` is the case that matters — it is
 * the one refusal this package family cannot detect for itself, so it arrives
 * only after the reader has committed to the relationship.
 *
 * IT REPLACES THE ROW ONLY WHEN THERE IS NO RELATIONSHIP UNDER IT, and that
 * qualification is the correction to an earlier "a refused edge is not a
 * relationship: it is an edit that did not happen". Three of the store's codes
 * refuse an edit ABOUT AN EDGE THAT EXISTS — `duplicate-edge`, `unchanged-kind`
 * and `symmetric-edge` all mark a landed edge — so replacing the row for those
 * deleted a real relationship from the panel, and with it the only control that
 * could remove the edge the reader had just been told about.
 * For an edge that genuinely does not exist the argument stands unchanged:
 * listing it as an ordinary row would assert a relationship the document does
 * not have, with a `select-edge` and a `✕` on it offering to remove something
 * that was never added. {@link WorkspaceRefusal.phantom} is the question, and
 * {@link relationshipEntries} is where it is asked. Either way the reader's
 * POSITION is kept, because that is where they were working.
 *
 * THE SHAPE IS `scale/render.ts`'s CAPSULE — an `li` carrying a button and a
 * stated reason — and the shape is all that is copied. That capsule's English
 * is written inline in this package, which is a debt rather than a precedent;
 * the reason here is the host's, keyed off the store's own code.
 *
 * IT NAMES THE EDGE AND OPERATES NOTHING. The capsule reused the row's head,
 * which is a `select-edge` control — so a phantom that survived normalization
 * (a `would-cycle` refusal reaches the panel as an edge, because the store
 * draws a refused create precisely so a surface can mark it) published a live
 * selector for an edge the LANDED document does not carry. Under
 * `mountWorkspace` that click selected the phantom and the next render's
 * `reconcileHost` dropped the selection again, so the one control on the
 * capsule closed the inspector rather than inspecting anything. The
 * description is drawn bare instead, on the rule
 * {@link WorkspaceRefusal.phantom} already states in as many words: there is no
 * relationship to operate. Its remove control was withheld for the same reason
 * from the start; this is the half that was missed.
 *
 * `data-ig-code` IS THE STORE'S VOCABULARY VERBATIM, so a host that wants to
 * style or count refusals reads the code rather than matching a sentence.
 */
function refusalCapsule(
  relationship: InspectorRelationship | undefined,
  code: InvalidCode,
  subject: string | null,
  words: WorkspaceWords,
): ElementSpec {
  return element(
    'li',
    {
      class: 'ig-relationship-refused',
      'data-ig-code': code,
      'data-edge': relationship?.field,
    },
    [
      // THE RELATIONSHIP IS NAMED WHEN IT CAN BE, AND THE CAPSULE STANDS WHEN
      // IT CANNOT. The refused edge normally reaches the document as the
      // store's phantom — `edgeChangeFor` draws a refused create so the refusal
      // has something to be about — but a host that projects only landed edges
      // gives us a code and nothing to word, and a refusal the reader cannot
      // see is worse than one drawn without its subject.
      relationship === undefined
        ? null
        : element(
            'span',
            { class: 'ig-relationship-name' },
            relationshipDescription(relationship, subject),
          ),
      refusalReason(code, words),
    ],
  );
}
/**
 * The numbered kind list, its heading, and the control that withdraws from it.
 *
 * DRAWN IN BOTH FRAMES, AND THIS FUNCTION ANSWERS TO BOTH. §17b fixes the
 * keyboard loop the digits belong to; §17a draws the same list in the inspector
 * with a heading over it and the digit as a chip at each row's end. Those two
 * placements are §17a's, taken here under autnmy/issuegraph#147; the flip, the
 * target search and delete/retype remain §17b's and are not drawn here.
 *
 * THE DIGITS ARE `create/keys.ts`'s OWN, through `KIND_KEYS`. Drawing
 * `index + 1` over the kind order here would be a second construction of the
 * keyboard's table — which is exactly what the mount's chooser did, agreeing
 * with the key map only because both walked `EDGE_FIELDS`, with nothing
 * pinning them to each other.
 *
 * THE WORD IS THE EDGE VOCABULARY'S, so an entry in this list and the row it
 * will become read the same. A `kinds` record on `WorkspaceWords` would be a
 * third spelling of a wording layer 1 already publishes twice over.
 *
 * IT IS NOT DRAWN AT THE TARGET STEP. `renderWorkspace` is markup-only and the
 * target search is a live input over the reader's query, so that step stays the
 * shell's. A host using this renderer without `mountWorkspace` can read,
 * remove and BEGIN a relationship, and must supply its own target picker.
 *
 * `source` NAMES THE DRAFT WHEN IT IS NOT THIS PANEL'S OWN, and is `null` when
 * it is — see {@link createStep} for why the list is drawn either way. Written
 * as the reference beside the host's phrase, which is `whyRankSpec`'s own shape
 * for the same problem: the package names the issue and the host writes the
 * English around it.
 */
function kindListSpec(words: WorkspaceWords, source: string | null): ElementSpec {
  return element('div', { class: 'ig-inspector-add' }, [
    // §17a HEADS THE KINDS, in the caps treatment the stylesheet already
    // declares for three headings and until now drew only two of. Without it
    // the five numbered rows run straight on from the relationship rows above,
    // and nothing on screen says the numbers choose a kind rather than name
    // more relationships.
    element('h3', { class: 'ig-inspector-heading' }, [words.addRelationshipHeading]),
    source === null
      ? null
      : element('p', { class: 'ig-inspector-source' }, [
          `${words.relatingFrom} `,
          element('span', { class: 'ig-id' }, [source]),
        ]),
    element(
      'ul',
      { class: 'ig-kind-list' },
      KIND_KEYS.map((entry) => {
        const treatment = treatmentFor(entry.edgeKind);
        return element('li', {}, [
          element(
            'button',
            {
              type: 'button',
              class: 'ig-kind-option',
              'data-ig-command': 'kind',
              'data-ig-value': entry.edgeKind,
              'data-edge': entry.edgeKind,
            },
            [
              // §17a PUTS THE DIGIT LAST, IN A CHIP. The kind is what the reader
              // is choosing between, so it comes first in the reading order and
              // the key follows it — "blocked-by, 1" rather than "1,
              // blocked-by". The chip is what carries the "this is a key"
              // signal a left-hand column used to carry by alignment alone.
              ...glyphAndLabel(treatment.glyph, treatment.label),
              element('span', { class: 'ig-kind-digit' }, [entry.key]),
            ],
          ),
        ]);
      }),
    ),
    element(
      'button',
      { type: 'button', class: 'ig-inspector-cancel', 'data-ig-command': 'cancel' },
      [words.cancel],
    ),
  ]);
}

/**
 * §17a's "why rank" block: the heading, and one sentence explaining the
 * position.
 *
 * THE SYMPTOM THIS PACKAGE WAS FILED FOR. `#122` names it exactly: the frame
 * gives the inspector a `WHY RANK 2` heading and a sentence, "the shipped
 * inspector shows raw tokens and no sentence, even though the package already
 * carries the function that composes provenance". It did, and this composes it.
 *
 * THE PROVENANCE CLAUSE IS LAYER 1's, AND THAT IS THE POINT. `provenanceClause`
 * is the same function the §16 rail row's provenance line is built from, so the
 * row and the panel state one fact one way. Switching on `RankProvenance` here
 * would be a second wording, free to drift from the row's the moment either is
 * edited — which is what the issue means by "composed from the existing
 * provenance model rather than a second implementation of it".
 *
 * A HOLD'S REASON IS RENDERED VERBATIM, exactly as layer 1's `holdLine` renders
 * it: `ViewerHold.reason` is host-authored, and rewording it here would put
 * this package in the business of explaining a hold whose vocabulary belongs to
 * the reader that produced it.
 *
 * WHAT DOES NOT APPEAR: a rank on a held slot. `@issuegraph/derive` assigns
 * `ready ? (rank += 1) : null`, so the two are exclusive and the heading says
 * which one it is. Frame 17a draws `#512` at rank 2 *and* "Held until #488
 * closes"; that state is unrepresentable, and PR #126 already ruled for §16
 * that the model wins and the em dash stands.
 */
function whyRankSpec(
  why: InspectorWhyRank,
  words: WorkspaceWords,
  holds: readonly ElementSpec[],
): ElementSpec {
  const held = why.rank === null;
  return element('div', { class: 'ig-why-rank', 'data-held': held ? 'true' : 'false' }, [
    element('h3', { class: 'ig-why-rank-heading' }, [
      held ? words.whyHeld : `${words.whyRank} ${String(why.rank)}`,
    ]),
    element('p', { class: 'ig-why-rank-sentence' }, [
      provenanceClause(why.provenance),
      why.unitPartners.length === 0
        ? null
        : element('span', { class: 'ig-why-rank-unit' }, [
            `${words.workedAsOneUnit} `,
            element('span', { class: 'ig-id' }, [why.unitPartners.join(', ')]),
          ]),
    ]),
    // THE HOLDS BELONG TO THE EXPLANATION, so they live inside this block
    // rather than beside it. They were briefly stated twice — once worded into
    // this sentence and once in the list below it — which is the panel telling
    // a reader the same cause in two voices.
    //
    // The LIST is what survived, because it is the half that carries the
    // holder as a control: `holdRow` publishes `select-issue` on the blocker,
    // under rules about when that control is withheld which a sentence could
    // not express. A reason inline would have discarded them.
    holds.length === 0 ? null : element('ul', { class: 'ig-inspector-holds' }, holds),
  ]);
}

/**
 * One header member, rendered, or the empty string.
 *
 * The zone is assembled by concatenating already-rendered markup — the audit
 * header arrives that way and owns its own `aria-pressed` — so a member that is
 * a spec has to be rendered before it joins them, and an absent member has to
 * join as nothing rather than as a gap.
 */
function specMarkup(spec: ElementSpec | null): string {
  return spec === null ? '' : renderMarkup(spec);
}

/**
 * §17a's `312 open · 64 encoded` — how much of the backlog carries relationships.
 *
 * OMITTED WHEN THE HOST STATED NO NUMBERS, never defaulted, on this zone's
 * standing rule: a zero the reader can trust and a zero nobody computed are
 * different facts. `Adoption.counts` is optional precisely so a host that
 * cannot count says nothing.
 *
 * THE TOTAL LEADS, WHICH IS THE FRAME'S ORDER AND NOT LAYER 1's. §16a words the
 * same pair as `64 of 312 declare relationships`, subject first. §17a reads the
 * backlog first and the encoded subset second, and the two surfaces are allowed
 * to differ: this is the header of a grooming workspace, where "how much is
 * left to encode" is the question, and that one is answered by the pair read in
 * this direction.
 */
function adoptionCountsSpec(adoption: Adoption | undefined, words: WorkspaceWords): ElementSpec | null {
  const counts = adoption?.counts;
  if (counts === undefined) return null;
  return element('span', { class: 'ig-workspace-counts' }, [
    element('span', { class: 'ig-id' }, [String(counts.total)]),
    ` ${words.open} · `,
    element('span', { class: 'ig-id' }, [String(counts.declaring)]),
    ` ${words.encoded}`,
  ]);
}

/**
 * §17a's `as of 14:32 ↻` — how fresh the read is, and the way to take another.
 *
 * THE CONTROL IS PUBLISHED AND NOT WIRED, the shape layer 1 already gives it:
 * refreshing a mirror is fetching, which no layer here does, so the button
 * carries `refresh` on the command attribute and the host that can listens. A
 * real `button`, so the mount's own click and Enter handling treat it as a
 * control rather than as a row.
 *
 * DRAWN ONLY WHEN THE HOST SUPPLIED A WORD FOR IT, again as layer 1 does: a
 * control nobody named is one nobody wired.
 *
 * STALENESS IS AN ATTRIBUTE, NOT A WORD. See {@link WorkspaceWords.asOf}.
 */
function freshnessSpec(freshness: Freshness | undefined, words: WorkspaceWords): ElementSpec | null {
  if (freshness === undefined) return null;
  return element(
    'span',
    {
      class: 'ig-workspace-freshness',
      'data-stale': freshness.stale === true ? 'true' : 'false',
    },
    [
      `${words.asOf} `,
      element('span', { class: 'ig-id' }, [freshness.asOf]),
      freshness.age === undefined || freshness.age === '' ? null : ` · ${freshness.age}`,
      freshness.refresh === undefined || freshness.refresh === ''
        ? null
        : element(
            'button',
            { type: 'button', class: 'ig-workspace-refresh', 'data-ig-command': 'refresh' },
            [freshness.refresh],
          ),
    ],
  );
}

/**
 * The host facts the RAIL is given: everything except the two §17a's header now
 * draws.
 *
 * THIS IS THE WHOLE MECHANISM OF #135's MOVE, and it is a subtraction rather
 * than a switch. Layer 1 draws a fact when it is given one and omits it when it
 * is not — `hostHeader` returns `null` outright once nothing is left for it —
 * so the zone that receives a fact is the zone that states it, and no option
 * has to be invented to say so. `SceneOptions.chrome` is the switch that could
 * not do this: it would also take the condition notice, the adoption NOTE and
 * `data-ig-condition`, none of which §17a's header replaces.
 *
 * `adoption.note` SURVIVES WHILE `adoption.counts` DOES NOT, which is why this
 * cannot drop the field whole. They are two independent members of one optional
 * object — §16h's own note says the design draws the count where adoption is
 * partial and the line where it is absent — and the line is the rail's panel
 * footer, a place §17a's header is not.
 *
 * `running` SURVIVES BY BEING LEFT ALONE. The NOW row is not part of layer 1's
 * panel header and never was gated with it; see {@link headerMarkup} for the
 * premise that said otherwise.
 */
function railHostFacts(host: NormalizedHostFacts): HostFacts {
  const { freshness, adoption, ...rest } = host;
  return adoption?.note === undefined ? rest : { ...rest, adoption: { note: adoption.note } };
}

/**
 * §17a's workspace header: what backlog this is, how much of it is encoded,
 * what is wrong with it, how fresh the read is, and the way into a first pass.
 *
 * IT IS UNCONDITIONAL NOW, AND THAT IS THE FIX. The zone used to be emitted
 * only when an audit overlay existed — `overlay === null ? '' : zone('header',
 * …)` — so the header WAS the audit header, and a workspace with no audit
 * input had no header at all. §17a's header carries five facts and the audit
 * count is one of them.
 *
 * WHAT IT DRAWS IS WHAT THE RAIL DOES NOT, and #135 settled the split. §17a
 * hoists the identity, the adoption counts and the freshness stamp into a
 * header spanning all three zones, so this carries five facts: what backlog
 * this is, how much of it is encoded, what the audit found, how fresh the read
 * is, and the way into a first pass.
 *
 * THE RULING, RECORDED HERE BECAUSE THIS IS THE SURFACE IT IS ABOUT:
 *
 *   - `Adoption.counts` and the freshness stamp (with its refresh control) are
 *     drawn HERE and nowhere else. §17a draws both, and layer 1's panel header
 *     drew both until this change.
 *   - `OrderCounts` and `concurrencyCap` stay in the RAIL. They are a different
 *     pair from the adoption one — how the order splits, not how much of the
 *     backlog is encoded — and §17a's header does not draw them. The rail is
 *     the order, so the order's own tally belongs to its panel header.
 *   - The running-job NOW row stays in the rail, unchanged.
 *
 * ⚠️ #135's PREMISE WAS WRONG ABOUT THE NOW ROW, and correcting it is what made
 * the ruling small. The issue records that `SceneOptions.chrome` takes the
 * stamp, the refresh control, the count chips AND the NOW row together, so that
 * flipping it would drop a row §17a's rail does not replace. It does not:
 * `nowRows` is called unconditionally by all three projection roots, beside the
 * `chrome`-gated header, so no setting of that switch has ever reached it.
 *
 * SO THE SWITCH IS NOT THE LEVER, and it is deliberately left alone. `chrome:
 * false` also takes the condition notice, the adoption NOTE and the panel's
 * `data-ig-condition` — three things §17a's header does not replace — so the
 * all-or-nothing flip could only be made by dropping them. What moves a fact
 * instead is WHICH ZONE IS GIVEN IT: {@link railHostFacts} hands the rail the
 * host facts minus the two this header now draws, and layer 1 then omits them
 * on its own existing "omitted when absent" rule rather than on a new option.
 *
 * EVERY FACT COMES FROM THE PORT THAT ALREADY CARRIES IT. `ViewerDocument.host`
 * is commented "THE HOST-FACTS PORT", and #127 rejected deriving its numbers in
 * terms: "Reporting is not deriving — the host's number is still what gets
 * drawn." Counting the document here would give the header a second answer,
 * free to disagree with the rail beside it.
 *
 * OMITTED WHEN ABSENT, NEVER DEFAULTED, for the reason the audit count already
 * gives: a zero the reader can trust and a zero nobody computed are different
 * facts, and a header that invents either is worse than one that says less.
 */
function headerMarkup(
  host: HostFacts | undefined,
  auditHeader: string,
  words: WorkspaceWords,
): string {

  // A STRING, not a spec, because one member of this zone already is one: the
  // audit header comes from its own leaf rendered, and it owns the filter
  // toggle's `aria-pressed` and the count's own omitted-when-absent rule. The
  // file's standing idiom applies — everything carrying a dynamic value goes
  // through `renderMarkup`, and only already-rendered markup is concatenated.
  const parts: string[] = [
    host?.identity === undefined || host.identity === ''
      ? ''
      : renderMarkup(element('span', { class: 'ig-workspace-identity' }, [host.identity])),
    specMarkup(adoptionCountsSpec(host?.adoption, words)),
    auditHeader,
    specMarkup(freshnessSpec(host?.freshness, words)),
    host?.firstPass === undefined || host.firstPass === ''
      ? ''
      : renderMarkup(
          element(
            'button',
            { type: 'button', class: 'ig-workspace-firstpass', 'data-ig-command': 'first-pass' },
            [host.firstPass],
          ),
        ),
  ];

  return `<div class="ig-workspace-header">${parts.join('')}</div>`;
}

/**
 * Everything the panel needs beyond the view it is drawing.
 *
 * AN OBJECT RATHER THAN SIX POSITIONAL PARAMETERS, and the reason is the same
 * one the binding tables give: a call site that has to remember an order is a
 * call site that can get it wrong silently, and two of these are
 * `ReadonlyMap`s of string, which no signature distinguishes.
 */
interface InspectorContext {
  readonly words: WorkspaceWords;
  /**
   * The audit, when the host asked for one, so the zone can carry §17d's list.
   *
   * `null` IS "NO AUDIT INPUT", NOT "NOTHING FOUND" — the same distinction
   * {@link WorkspaceOptions.audit} keeps. A zero count is a fact about a
   * question that was asked; an absent overlay is the absence of the question.
   */
  readonly audit: AuditOverlay | null;
  /** The keys a hold's subject control may name — see {@link holdRow}. */
  readonly known: ReadonlySet<string>;
  /** Which slot a key sits in, by lead. See {@link holdRow}. */
  readonly leadOf: ReadonlyMap<string, string>;
  readonly draft: CreateDraft;
  readonly drop: Point | null;
  /**
   * Refused edits, in the order the store recorded them. See {@link
   * relationshipEntries}.
   *
   * A LIST, AND THE LEDGER'S OWN ORDER. It was a `ReadonlyMap` keyed by edge,
   * collapsed by the caller — which threw the chronology away at the seam
   * where two collections were joined, so a stale refusal on an edge could
   * outrank the one the reader had just caused. The collapse is a rendering
   * decision ("one row states one reason, the last one") and it now happens
   * where that decision is made, over a list whose order is the store's.
   */
  readonly refusals: readonly WorkspaceRefusal[];
  /** Unsettled writes the reader can act on, in the ledger's own order. */
  readonly recoveries: readonly WorkspaceRecovery[];
  readonly diffOpen: MutationId | null;
}

/**
 * Which refusals a panel is entitled to state.
 *
 * THE PANEL'S REACH, AS DATA. The three subjects reach different things and
 * the difference is not a detail: an issue panel speaks for a whole together
 * unit, because `inspectorView` folds every member onto the slot's lead and
 * words the panel from it — so an edit made from a PARTNER is an edit made
 * from this panel, and stating its refusal anywhere else states it nowhere. An
 * edge panel is one relationship narrowed out of a list, so it states a
 * refusal about that relationship and no other. And `none` states nothing at
 * all: a refusal drawn under "pick a row to inspect it" is a refusal about an
 * issue the reader is not looking at, and it also suppresses the empty line by
 * making the list non-empty.
 *
 * BUILT FROM THE VIEW, NOT FROM THE SELECTION. `unitPartners` is
 * `inspectorView`'s own record of which keys canonicalize onto this subject —
 * the same canonicalization that chose the subject — so the set cannot come
 * apart from the heading above it.
 */
type PanelScope =
  | { readonly kind: 'none' }
  | { readonly kind: 'issue'; readonly keys: ReadonlySet<string> }
  | { readonly kind: 'edge'; readonly edgeId: EdgeId };

function panelScope(view: InspectorView): PanelScope {
  const { subject } = view;
  switch (subject.kind) {
    case 'none':
      return { kind: 'none' };
    case 'issue':
      return {
        kind: 'issue',
        keys: new Set([subject.issue.key, ...(subject.whyRank?.unitPartners ?? [])]),
      };
    case 'edge':
      return { kind: 'edge', edgeId: subject.relationship.edgeId };
  }
}

/**
 * What this panel needs to know to decide whether a record is its to state.
 *
 * STRUCTURAL RATHER THAN NAMED, so a refusal and a recovery share one rule.
 * Typed as `WorkspaceRefusal` it could not take a {@link WorkspaceRecovery},
 * which carries neither `code` nor `phantom` — and the repair a caller reaches
 * for at that point is a second copy of the rule, which is exactly the drift
 * `carrier` was introduced to end.
 *
 * `carrier` is nullable here because a recovery's is: see
 * {@link WorkspaceRecovery.carrier}. A `null` carrier is stated by no panel,
 * which falls out of `Set.has(null)` being false rather than needing its own arm.
 */
interface Stateable {
  readonly edgeId: EdgeId;
  readonly carrier: string | null;
}

/** Whether this panel is the one that states this record. */
function statedHere(scope: PanelScope, record: Stateable): boolean {
  switch (scope.kind) {
    case 'none':
      return false;
    case 'issue':
      return record.carrier !== null && scope.keys.has(record.carrier);
    case 'edge':
      return record.edgeId === scope.edgeId;
  }
}

/**
 * The three affordances, mapped to the commands that carry them out.
 *
 * `satisfies Record<OverlayAffordance, string>` IS THE POINT. A fourth
 * affordance is a compile error here rather than a button that renders and does
 * nothing, and the vocabulary it is total over cannot spell `merge` — §17b's
 * one prohibition, encoded in a type rather than left to a reviewer.
 */
const AFFORDANCE_COMMANDS = Object.freeze({
  'view-diff': 'view-diff',
  retry: 'retry',
  'discard-mine': 'discard',
} as const satisfies Record<OverlayAffordance, string>);

/**
 * The region a card's `view-diff` control discloses.
 *
 * Derived from the write's own identity so `aria-controls` can name it, and
 * scoped by a prefix because a page may mount more than one workspace.
 */
function diffRegionId(mutationId: MutationId): string {
  return `ig-recovery-diff-${mutationId}`;
}

/** One edge in a difference, named the way the relationship rows name one. */
function diffEdgeSpec(edge: StoredEdge): ElementSpec {
  return element('li', { class: 'ig-recovery-edge', 'data-edge': edge.kind }, [
    // OUTGOING, because a diff row names the edge as the document stores it —
    // `from` then `to` — rather than from the point of view of a subject. There
    // is no subject here: the list is about the document, not about one issue.
    element('span', { class: 'ig-relationship-kind' }, [labelFrom(treatmentFor(edge.kind), true)]),
    element('span', { class: 'ig-id' }, [edge.from]),
    element('span', { class: 'ig-id' }, [edge.to]),
  ]);
}

/** One side of a difference, or nothing when that side is empty. */
function diffSideSpec(
  heading: string,
  edges: readonly StoredEdge[],
): ElementSpec | null {
  return edges.length === 0
    ? null
    : element('div', { class: 'ig-recovery-side' }, [
        element('h5', { class: 'ig-recovery-side-name' }, [heading]),
        element('ul', { class: 'ig-recovery-edges' }, edges.map(diffEdgeSpec)),
      ]);
}

/**
 * The held difference, drawn.
 *
 * NOTHING HERE COMBINES THE TWO SIDES. They are separate lists under separate
 * headings, with no control that takes both — which is what "never auto-merge"
 * looks like in markup rather than in a comment.
 */
function diffSpec(diff: ConflictDiff, words: RecoveryWords, id: string): ElementSpec {
  if (diffIsEmpty(diff)) {
    return element('p', { class: 'ig-recovery-diff-empty', id }, [words.diffEmpty]);
  }
  return element('div', { class: 'ig-recovery-diff', id }, [
    diffSideSpec(words.upstreamOnly, diff.upstreamOnly),
    diffSideSpec(words.mineOnly, diff.mineOnly),
    diffSideSpec(words.mineRemoved, diff.mineRemoved),
    diff.carrierReversed.length === 0
      ? null
      : element('div', { class: 'ig-recovery-side' }, [
          element('h5', { class: 'ig-recovery-side-name' }, [words.carrierReversed]),
          element(
            'ul',
            { class: 'ig-recovery-edges' },
            // BOTH DIRECTIONS, SIDE BY SIDE. Which end declares a symmetric
            // relationship is the fact `edgeId` discards, so stating one
            // direction here would be this package picking a winner.
            diff.carrierReversed.flatMap((change) => [
              diffEdgeSpec(change.mine),
              diffEdgeSpec(change.upstream),
            ]),
          ),
        ]),
    diff.issuesChanged.length === 0
      ? null
      : element('div', { class: 'ig-recovery-side' }, [
          element('h5', { class: 'ig-recovery-side-name' }, [words.issuesChanged]),
          element(
            'ul',
            { class: 'ig-recovery-issues' },
            diff.issuesChanged.map((change) =>
              element('li', { class: 'ig-recovery-issue' }, [
                element('span', { class: 'ig-id' }, [change.ref]),
                // BOTH TITLES, NEVER ONE RECONCILED ONE. A single line here
                // would be this package choosing a winner, which is the whole
                // of what §17b forbids.
                element('span', { class: 'ig-recovery-was' }, [change.mine?.title ?? '']),
                element('span', { class: 'ig-recovery-now' }, [change.upstream?.title ?? '']),
              ]),
            ),
          ),
        ]),
  ]);
}

/**
 * The label for one affordance on one card.
 *
 * KEYED OFF THE CARD'S KIND, not off the affordance alone: `retry` is two
 * different operations and §17b gives them two different names.
 */
function affordanceWord(
  affordance: OverlayAffordance,
  kind: WorkspaceRecovery['kind'],
  words: RecoveryWords,
): string {
  switch (affordance) {
    case 'view-diff':
      return words.viewDiff;
    case 'retry':
      return kind === 'conflict' ? words.retryOnLatest : words.retry;
    case 'discard-mine':
      return words.discardMine;
  }
}

/**
 * One unsettled write the reader can act on.
 *
 * THE BUTTONS ARE THE GRAMMAR TABLE'S, NOT A LIST WRITTEN HERE.
 * `OVERLAY_TREATMENTS[kind].affordances` is what the line already draws its
 * state from, so the card and the edge cannot come to offer different things —
 * and because `OverlayAffordance` has no `merge` member, no entry in that table
 * can produce a merge button. That is what this construction buys, and it is
 * worth being exact about what it does NOT buy: the behavioural guarantee that
 * nothing merges lives one layer down, in a store that exposes no merge call
 * and a `HostEffect` with no merge arm.
 *
 * EVERY BUTTON CARRIES `data-ig-target`. The mount turns an attribute-borne
 * command into `{ kind: 'control', name, target }`, and the reducer's `retry`
 * and `discard` arms return NO EFFECT when `target` is undefined. Without the
 * attribute all three controls render, read correctly, and do nothing — while
 * every assertion about the command names stays green.
 */
function recoveryCard(
  recovery: WorkspaceRecovery,
  words: RecoveryWords,
  diffOpen: MutationId | null,
  keys: ReadonlySet<string> | null,
): ElementSpec {
  const treatment = OVERLAY_TREATMENTS[recovery.kind];
  const open = recovery.kind === 'conflict' && diffOpen === recovery.mutationId;
  return element(
    'li',
    {
      class: 'ig-recovery',
      // THE STORE'S OWN VOCABULARY, so a host styles or counts these off the
      // state rather than by matching a sentence — `data-ig-code`'s rule.
      'data-ig-state': recovery.kind,
    },
    [
      element('h4', { class: 'ig-recovery-name' }, [
        recovery.kind === 'conflict' ? words.conflict : words.failed,
      ]),
      recovery.kind === 'failed'
        ? element('p', { class: 'ig-recovery-reason' }, [recovery.reason])
        : null,
      // THE REFRESH ERROR SITS ABOVE THE CONTROLS, because it is the reason the
      // control the reader last pressed did nothing.
      recovery.kind === 'conflict' && recovery.refreshError !== null
        ? element('p', { class: 'ig-recovery-refresh-error' }, [
            `${words.retryFailed} `,
            element('span', { class: 'ig-recovery-refresh-detail' }, [recovery.refreshError]),
          ])
        : null,
      element(
        'div',
        { class: 'ig-recovery-actions' },
        treatment.affordances.map((affordance) =>
          element(
            'button',
            {
              type: 'button',
              class: 'ig-recovery-action',
              'data-ig-command': AFFORDANCE_COMMANDS[affordance],
              'data-ig-target': recovery.mutationId,
              // A DISCLOSURE, NOT A TOGGLE BUTTON. `view-diff` shows and hides
              // a region, so `aria-expanded` (with `aria-controls` naming it)
              // is the pattern; `aria-pressed` announces a two-state button and
              // tells a screen-reader user nothing about the region that
              // appeared. The other two act once and carry neither.
              'aria-expanded': affordance === 'view-diff' ? (open ? 'true' : 'false') : undefined,
              // ONLY WHILE THE REGION EXISTS. The difference is rendered only
              // when open, so naming it while shut pointed `aria-controls` at
              // no element at all — which the test for this control already
              // calls "worse than none at all", while checking only the open
              // case where it does resolve. `aria-expanded="false"` is
              // complete on its own; `aria-controls` is optional, and a
              // dangling IDREF is invisible on screen and total for a
              // screen-reader user. Found by the a11y baseline's
              // reference rule on its first run.
              'aria-controls':
                affordance === 'view-diff' && open ? diffRegionId(recovery.mutationId) : undefined,
            },
            [affordanceWord(affordance, recovery.kind, words)],
          ),
        ),
      ),
      // NARROWED BY THE PANEL'S KEY SET, not by the carrier alone. A together
      // unit's lead speaks for its partners, so a single key would drop a
      // partner's conflicted edge from the one panel entitled to state it.
      // `null` keys is the unplaced region, which is nobody's unit: nothing is
      // narrowed away there.
      open && recovery.kind === 'conflict'
        ? diffSpec(
            keys === null ? recovery.diff : diffWithin(recovery.diff, keys),
            words,
            diffRegionId(recovery.mutationId),
          )
        : null,
    ],
  );
}

/** The cards a panel states, or nothing when it states none. */
function recoveryListSpec(
  recoveries: readonly WorkspaceRecovery[],
  words: RecoveryWords,
  diffOpen: MutationId | null,
  keys: ReadonlySet<string> | null,
  heading: string | null,
): ElementSpec | null {
  if (recoveries.length === 0) return null;
  return element('div', { class: 'ig-recovery-region' }, [
    heading === null ? null : element('h3', { class: 'ig-inspector-heading' }, [heading]),
    element(
      'ul',
      { class: 'ig-recovery-list' },
      recoveries.map((recovery) => recoveryCard(recovery, words, diffOpen, keys)),
    ),
  ]);
}

/**
 * The relationship list, with a refused edit drawn where the reader made it.
 *
 * ## A refusal about an edge that EXISTS keeps its row
 *
 * See {@link WorkspaceRefusal.phantom}. Four of the store's codes mark a landed
 * edge, so the capsule replaces the row only when there is no relationship
 * under it; otherwise the reason joins the row and the remove control stays.
 *
 * ## Whose refusal it is, is not a question asked here
 *
 * {@link statedHere} asks it, of the carrier the refusal arrived carrying —
 * and that is the whole of the change this function used to be the wrong place
 * for. `refusals` is one list for the whole surface, not one per panel, and
 * this function used to filter it by asking whether the refused edge's
 * IDENTITY named the panel's subject. That is a second derivation of the
 * edit's subject, run against a subject derived by a different rule, and every
 * way the two can come apart is a refusal drawn in the wrong place or in no
 * place: on every panel when nothing matched, on none when the panel had been
 * canonicalized onto a together unit's lead, on none again when the projection
 * had hidden the edge and left the panel with no subject at all. The refusal
 * names its own carrier now, so there is one derivation and nothing for a
 * second one to disagree with.
 *
 * ## The list is the ledger's, and the LAST refusal on an edge is the one
 *
 * One row states one reason, and the reader can be refused twice on one
 * relationship — `ProjectedEdge.writes` is a list because two edits touching
 * one edge compose in the order the reader made them. The last is the one they
 * just caused; the first is one they have read and moved past. That collapse
 * is `Map`'s repeated-key rule over `refusals` IN ORDER, which is why the
 * option is a list rather than a map a caller had already collapsed: a caller
 * assembling one from two passes loses the chronology at the join, and reports
 * a stale reason for an edge the reader has just been refused on again.
 *
 * ## A refusal with no row is still drawn
 *
 * The refused edge normally reaches the document — the store draws a refused
 * create as a phantom precisely so a surface can mark it — but that depends on
 * the host's projection, and a refusal that vanished because the host projects
 * only landed edges is the "never silently dropped" half of §17b's rule failing
 * quietly. So a refusal this panel states and no row carries is appended after
 * the rest, as a capsule.
 */
function relationshipEntries(
  view: InspectorView,
  subject: string | null,
  selected: string | null,
  context: InspectorContext,
): readonly ElementSpec[] {
  const scope = panelScope(view);
  const stated = new Map<EdgeId, WorkspaceRefusal>();
  for (const refusal of context.refusals) {
    if (statedHere(scope, refusal)) stated.set(refusal.edgeId, refusal);
  }
  const listed = new Set<EdgeId>();
  const rows = view.relationships.map((relationship) => {
    const refusal = stated.get(relationship.edgeId);
    if (refusal === undefined) {
      return relationshipSpec(relationship, subject, selected, context.words, undefined);
    }
    listed.add(relationship.edgeId);
    return refusal.phantom
      ? refusalCapsule(relationship, refusal.code, subject, context.words)
      : relationshipSpec(relationship, subject, selected, context.words, refusal.code);
  });
  const orphaned = [...stated.values()]
    .filter((refusal) => !listed.has(refusal.edgeId))
    .map((refusal) => refusalCapsule(undefined, refusal.code, subject, context.words));
  return [...rows, ...orphaned];
}

/**
 * §17a's inspector panel.
 *
 * ## The heading and the clear control are the panel's, not the list's
 *
 * Both used to hang off the relationship list, and the clear control was drawn
 * only while an EDGE selection was narrowing it — so a reader who had selected
 * an issue had no way back to nothing selected, on a control whose own doc
 * says it "returns to nothing selected" and whose command is `clear`. The
 * condition it wanted was "is there a selection to clear", which is what it now
 * asks. `INITIAL_SELECTION` resolves to `none`, so the control is absent
 * exactly when pressing it would do nothing.
 *
 * ## The create step is drawn here, and the target step is not
 *
 * See {@link kindListSpec}. What the panel owns is `+ add` and the numbered
 * kind list; the target search stays in the shell because it is a live input
 * over the reader's query and this renderer returns markup.
 *
 * WITH AN EDGE SELECTED IT DRAWS NEITHER. That is not the create path being
 * unavailable — it is the panel filtered to one relationship, where "add a
 * relationship from the selected issue" has no subject: `reduceHost`'s `add`
 * reads `selectedKey`, which answers `null` for an edge selection. A control
 * that could not complete the act it advertises is the finding the audit
 * header already records paying for once.
 */
function inspectorSpec(view: InspectorView, context: InspectorContext): ElementSpec {
  const { words } = context;
  const subject = view.subject;
  // THE CANONICAL SUBJECT, NOT THE SELECTION'S KEY. `inspectorView` folds a
  // together-unit member onto its slot's lead and lists the LEAD's
  // relationships, so a row worded against the key the reader clicked would
  // read every relationship from the wrong end on exactly the units where a
  // partner was selected. Read off the view, which is what the list was built
  // from.
  const key = subject.kind === 'issue' ? subject.issue.key : null;
  const selected = subject.kind === 'edge' ? subject.relationship.edgeId : null;
  const entries = relationshipEntries(view, key, selected, context);
  // THE SAME SCOPE THE RELATIONSHIP LIST USED, asked once here rather than
  // recomputed per region: two calls could not disagree today, but a panel that
  // decides its own reach twice is the shape `carrier` exists to have ended.
  const scope = panelScope(view);
  // ASKED ONCE, FOR THE SAME REASON `scope` IS. §17a draws the create path in
  // two zones — `+ add` on the relationships header, the numbered kinds under
  // their own heading — and a step derived separately per zone is two answers
  // to one question, free to disagree the day either guard moves.
  const step = createStep(context, key);
  return element('div', { class: 'ig-inspector', 'data-subject': subject.kind }, [
    element('div', { class: 'ig-inspector-head' }, [
      element('h2', { class: 'ig-inspector-name' }, [words.inspector]),
      subject.kind === 'none'
        ? null
        : element(
            'button',
            { type: 'button', class: 'ig-inspector-clear', 'data-ig-command': 'clear' },
            [words.clearSelection],
          ),
    ]),
    subject.kind === 'none'
      ? element('p', { class: 'ig-inspector-empty' }, [words.nothingSelected])
      : null,
    subject.kind === 'issue'
      ? element('div', { class: 'ig-inspector-issue' }, [
          element('h3', { class: 'ig-inspector-title' }, [subject.issue.title]),
          // LAYER 1's CHIP, not a second spelling of it. `identity` links the
          // qualified reference when the host gave a URL and prints it plain
          // when it did not — the rule for which is exactly the knowledge this
          // package must not carry a second copy of.
          identity(subject.issue),
          // THE RANK IS THE HEADING'S NOW, so there is no separate position
          // line: it printed the number, or the em dash for a held slot, which
          // is exactly what `WHY RANK n` and `WHY HELD` already say. Two
          // elements for one fact is how they come to disagree.
          subject.whyRank === null
            ? null
            : whyRankSpec(
                subject.whyRank,
                words,
                subject.whyRank.holds.map((hold) =>
                  holdRow(hold, context.known, (subjectKey) =>
                    context.leadOf.get(subjectKey) === context.leadOf.get(subject.issue.key),
                  ),
                ),
              ),
        ])
      : null,
    // ONE DERIVATION, READ TWICE. The step is asked once here and both
    // placements below read the answer, so the header and the body cannot
    // disagree about WHICH step is live. What each draws for a given arm is
    // still a discipline this file keeps rather than one the type checker
    // keeps — the single-return shape this replaces made drawing both
    // unrepresentable, and a value read at two sites does not. The pin that
    // stands where the return ordering used to is the one asserting no `add`
    // control exists anywhere in the panel at the kind step.
    element(
      'div',
      { class: 'ig-inspector-relationships', 'data-filtered': view.filtered ? 'true' : 'false' },
      [
          // §17a PUTS `+ add` ON THE HEADING'S OWN ROW, and the reason is the
          // list between them: it is unbounded, so a control after it drifts
          // down the panel as a subject gains relationships and is below the
          // fold on the busy issues a groomer most needs it for. On the header
          // row its position does not depend on the content.
          element('div', { class: 'ig-inspector-relationships-head' }, [
            element('h3', { class: 'ig-inspector-heading' }, [words.relationships]),
            step.kind === 'add' ? addControlSpec(words, step.subject) : null,
          ]),
          // A STATED EMPTY, AND ONLY WHERE THERE IS A SUBJECT TO STATE IT ABOUT.
          // With nothing selected the panel already says so once, in
          // `nothingSelected`; adding "no relationships" under it would be the
          // same absence reported twice, in two registers, on the render where
          // the reader has asked nothing yet.
          entries.length === 0 && subject.kind !== 'none'
            ? element('p', { class: 'ig-inspector-none' }, [words.noRelationships])
            : null,
          entries.length === 0 ? null : element('ul', { class: 'ig-relationship-list' }, entries),
          // THE STEPS ARE EXCLUSIVE, AND THE CHAIN IS THE SHELL'S OWN. `+ add`
          // begins a draft; the numbered list is what a live draft with no kind
          // yet looks like. Drawing `+ add` beside a live list would offer a
          // reader mid-draft a control that RESETS the draft they are in —
          // `create/draft.ts` makes `begin` clear the kind and the target
          // deliberately.
        step.kind === 'kinds' ? kindListSpec(words, step.source) : null,
      ],
    ),
    // STATED WHERE THE READER MADE THE EDIT, by the same rule the refusals use
    // — one `statedHere`, one carrier, no second derivation of whose panel this
    // is. No heading: the cards carry their own state names, and a heading over
    // a region that is usually absent is a heading a reader learns to skip.
    recoveryListSpec(
      context.recoveries.filter((recovery) => statedHere(scope, recovery)),
      words.recovery,
      context.diffOpen,
      scope.kind === 'issue' ? scope.keys : null,
      null,
    ),
    // THE WRITES WITH NOWHERE TO SIT, ON EVERY PANEL. A recovery whose carrier
    // is `null` is about issues this backlog does not hold, so no panel is
    // entitled to it — and the refusal path drops exactly these. Dropping a
    // REFUSAL costs a sentence the reader can live without; dropping a RECOVERY
    // takes away the only retry and discard they have, which is #137's
    // Done-when 1 ("offers all three resolutions from the editor's own
    // surface") failing on the state where it matters most. So they are drawn
    // here, under a heading that says why they are not on a relationship.
    // AND NEVER TWICE ON ONE PANEL. `statedHere`'s EDGE arm matches on
    // `edgeId` and ignores the carrier, so an edge panel narrowed to a
    // null-carrier recovery's own edge states it above AND here — two identical
    // cards, two tab stops, and two buttons carrying one write's id.
    recoveryListSpec(
      context.recoveries.filter(
        (recovery) => recovery.carrier === null && !statedHere(scope, recovery),
      ),
      words.recovery,
      context.diffOpen,
      null,
      words.recovery.unplaced,
    ),
  ]);
}

/**
 * Which step of the create path the panel is showing, as one value.
 *
 * §17a DRAWS THE TWO STEPS IN DIFFERENT ZONES, which is why this is a value
 * rather than the markup it used to return. `+ add` sits on the relationships
 * header row and the numbered kinds sit under their own heading further down,
 * so one function can no longer return "the step's markup" — but the QUESTION
 * is still one question, and asking it twice is how the two zones would come to
 * disagree. `inspectorSpec` asks once and each zone reads the arm it owns.
 *
 * WHAT THIS BUYS, AND WHAT IT DOES NOT. It buys one derivation: no second
 * predicate to keep in step. It does NOT make the two placements exclusive the
 * way the single-return shape did — that made drawing both unrepresentable,
 * because there was one slot. Nothing here stops a later edit drawing `+ add`
 * on the `kinds` arm. The pin standing where the return ordering used to is the
 * test asserting no `add` control exists ANYWHERE in the panel at the kind step.
 *
 * THE STEP FOLLOWS THE DRAFT, NOT THE SELECTION, and the draft's source is
 * NAMED when it is not this panel's subject. The two can diverge: `pointed`
 * diverts a click to the draft only once a kind has been chosen, so at the kind
 * step a click anywhere else moves the selection and leaves the draft's source
 * behind — and `R` on a together unit's non-lead member begins a draft from
 * that member while `inspectorView` canonicalizes the panel onto the slot's
 * LEAD, so the two disagree from the first keystroke. Unnamed, the panel showed
 * "choose a kind" beneath the heading of one issue while the write would go out
 * from another. Named, it says whose draft it is.
 *
 * WITHHOLDING THE LIST WAS THE FIRST ANSWER AND IT WAS WORSE. It left the
 * reader a LIVE draft with no pointer route to it at all: the numbered choices
 * were gone, the cancel that sits with them was gone, and the shell draws no
 * chooser of its own at this step — `mount.ts`'s floating one is drawn only
 * under a canvas drop, and its target search only once a kind is chosen. So the
 * one control still on screen was `+ add`, which does not cancel a draft, it
 * RESETS one, silently moving the source to whatever the reader happened to be
 * looking at. "The shell's cancel still reaches it" was the reasoning, and the
 * shell has no cancel to reach it with.
 *
 * `add` IS NOT ANSWERED BESIDE `kinds`, on either panel. Two entries into one
 * draft is the rule {@link WorkspaceOptions.drop} already states for the
 * floating chooser, and here the second entry is the destructive one:
 * `create/draft.ts` makes `begin` clear the kind and the target, so a reader
 * mid-draft offered `+ add` is offered a reset wearing the label of a start.
 * The arms are ordered, so `kinds` answers first and `add` cannot follow it.
 *
 * THE `kinds` ARM IS ASKED OF THE DRAFT ALONE, INCLUDING FOR NO SUBJECT. One
 * guard over both steps dropped a live draft's controls on a panel with no
 * issue subject, which `reconcileHost` reaches: it clears a selection whose
 * issue a landed write removed while leaving a draft begun from a DIFFERENT
 * issue standing, because that draft's own references are all still in the
 * document.
 *
 * THE `add` ARM ASKS NOTHING ABOUT `drop` OR ABOUT `draft.kind`, AND THAT IS
 * DELIBERATELY PRESERVED. It is `subject !== null && draft.source !== subject`,
 * exactly as it has been — so on a panel whose subject is NOT the draft's
 * source, `+ add` is drawn at the target step and under a live drop. Whether
 * that is right is a live question (autnmy/issuegraph#147): pressing it there
 * `begin`s from this panel's subject and clears the in-flight kind and target.
 * It is not answered here, because this change moves where controls sit and
 * must not quietly change when they appear. The existing fixtures cannot see
 * the case — both set the selection to the draft's own source, the one case
 * this arm refuses — so it is pinned explicitly instead.
 *
 * `none` AT THE TARGET STEP AND UNDER A LIVE DROP is therefore only the answer
 * for a panel whose subject IS the draft's source. The target step belongs to
 * the shell, which owns the live input and draws its own cancel beside it; a
 * drop means a chooser is already open at the pointer, and a second copy of the
 * same step in the column beside it would be two controls writing to one draft.
 */
type CreateStep =
  | { readonly kind: 'add'; readonly subject: string }
  | { readonly kind: 'kinds'; readonly source: string | null }
  | { readonly kind: 'none' };

function createStep(context: InspectorContext, subject: string | null): CreateStep {
  const { draft, drop } = context;
  if (draft.source !== null && draft.kind === null && drop === null) {
    return { kind: 'kinds', source: draft.source === subject ? null : draft.source };
  }
  // `+ add` NEEDS A SUBJECT TO BEGIN FROM, and `reduceHost`'s `add` arm answers
  // `null` for an edge selection and for none — so drawing it there would
  // publish an act that cannot complete.
  if (subject !== null && draft.source !== subject) return { kind: 'add', subject };
  return { kind: 'none' };
}

/**
 * §17a's `+ add`, with the key that does the same thing beside it.
 *
 * THE HINT IS THE BINDING'S OWN LETTER, through {@link RELATE_KEY}. A literal
 * here would be a second spelling of a key the map already owns, free to go
 * stale the day the binding moves and with nothing failing to say so — the
 * drift `create/keys.ts`'s header rejects in terms, and the reason `KIND_KEYS`
 * exists for the digits one function below.
 *
 * IT IS `aria-hidden`, AND THE BUTTON KEEPS THE HOST'S WORD AS ITS NAME. An
 * accessible name is computed from descendant text, so an exposed hint appends
 * a bare letter to the act — "add relationship R" — which announces a shortcut
 * as though it were part of the label. Hidden, the name is the host's word
 * alone. This is the pairing rule `hiddenGlyph` already applies to every mark
 * beside a word in this package: the mark is seen, the word is heard.
 *
 * UPPERCASE IS THE STYLESHEET'S. The map stores the lowercase key a press
 * normalizes to; §17a draws `R`. `text-transform` renders it, as it already
 * does for every heading in this panel, so there is no second string.
 *
 * NOTE THE HINT AND THE CONTROL CAN BEGIN FROM DIFFERENT ISSUES. `keyIntent`'s
 * `relate` arm begins from `KeyboardContext.focused`, while this button
 * publishes the canonical `data-ig-target`; on a together unit's non-lead
 * member those are different issues, which {@link createStep} records. Both
 * begin a draft the reader can see and cancel, so the pairing is kept.
 *
 * AND THE KEY DOES NOT WORK WHILE THIS BUTTON ITSELF HOLDS FOCUS. Measured, not
 * inferred: `mountWorkspace`'s `interaction()` answers `elsewhere` for a focused
 * command control, and `create/keys.ts`'s `reaches()` refuses every binding
 * there — and `KeyboardContext.focused` is the rail's tab stop, which is `null`
 * then, so the `relate` arm would answer `none` even if the interaction did
 * reach. `R` works from the rail, which is where a reader who has not yet
 * touched this control is standing, and the button itself answers `Enter` and
 * `Space`; so the hint names a key the reader has, at the one focus position
 * where it is inert.
 *
 * IT IS NOT REPAIRED HERE, DELIBERATELY. Making it true needs BOTH a new
 * `interaction()` answer and a second source for `focused` — and `interaction`'s
 * own header records that conjoining this predicate on where focus happens to
 * be is what produced three consecutive rounds of defects ("Focus is not the
 * fact"). That is a keyboard-routing change, and this one moves where controls
 * sit without changing what any key does. Filed on autnmy/issuegraph#147.
 */
function addControlSpec(words: WorkspaceWords, subject: string): ElementSpec {
  return element(
    'button',
    {
      type: 'button',
      class: 'ig-inspector-addbutton',
      'data-ig-command': 'add',
      // THE CANONICAL SUBJECT, PUBLISHED, for the reason the row's remove
      // control publishes its own edge. `reduceHost`'s `add` arm read
      // `selectedKey` — the RAW key — while everything around it is worded
      // against the slot LEAD that `inspectorView` canonicalizes to, so
      // selecting a together-unit PARTNER drew a panel titled with the lead
      // and began a relationship from the partner. The act names its
      // subject; the selection is the fallback for a control that names none.
      'data-ig-target': subject,
    },
    [
      // THE WORD IS A BARE CHILD, NOT A WRAPPED ONE. A span around it would need
      // a class, and a class with no rule is what `styles.test.ts` refuses —
      // correctly, since an element this sheet does not style is one a host
      // cannot theme.
      words.addRelationship,
      element('span', { class: 'ig-inspector-addkey', 'aria-hidden': 'true' }, [RELATE_KEY]),
    ],
  );
}

/**
 * One hold in the inspector, with its cause and its subject on the markup.
 *
 * THE SUBJECT IS A CONTROL, NOT A SPAN. A held slot's holder is routinely not
 * among the members drawn — an ordinary blocker never is, a claimed serialize
 * peer sits in another component, an unresolvable reference is nowhere — so
 * before this the sentence was the only place the holder was named, and a
 * reader had to find it by hand. Publishing `select-issue` on it makes the
 * holder a deep link into the ONE selection every zone shares: the rail and
 * the canvas move to it, and the inspector re-renders on it. The same
 * `data-ig-command` protocol the relationship rows use, and the same reducer
 * (`selectionReducer`) answers it, so a host wires nothing new.
 *
 * ONLY FOR A SUBJECT THE DOCUMENT CARRIES. An unresolvable reference names an
 * issue that is in no document by definition, and a serialize peer can be a
 * weak node the host never listed; `inspectorView` answers `none` for a key it
 * cannot find, so a control for one would discard the reader's selection and
 * show nothing. The attribute is still published — the subject is a fact about
 * the hold either way — and only the control is withheld.
 *
 * AND NEVER FOR A SUBJECT IN THE INSPECTED SLOT. Two shapes reach that, and
 * the test is the SLOT rather than the key because the second one hides
 * behind a key test. A node blocked by itself is a groomed-graph defect the
 * reader still reports, as a hold whose subject is the issue being inspected —
 * and `selectionReducer` toggles a re-selection of the selected issue to
 * `none`, so a control there would close the inspector. And a
 * `together-member-unready` hold names a PARTNER in the same unit, which
 * `inspectorView` canonicalizes back to the lead already on show — the first
 * click changes nothing visible and the second clears the selection. Withheld,
 * on the same rule as above: the attribute stays, the control does not.
 *
 * `data-code` and `data-subject` mirror layer 1's `holdLine` exactly — same
 * names, same omit-when-absent rule — so a rule written against
 * `.ig-hold[data-subject]` on the rail has an exact twin in
 * `.ig-inspector-hold[data-subject]` here. Class-qualified on purpose: the
 * inspector's ROOT also carries a `data-subject` (`issue` / `edge`, what the
 * selection resolved to), so a bare `[data-subject]` reads both.
 */
function holdRow(
  hold: ViewerHold,
  known: ReadonlySet<string>,
  inInspectedSlot: (key: string) => boolean,
): ElementSpec {
  return element(
    'li',
    {
      class: 'ig-inspector-hold',
      'data-family': hold.family,
      'data-code': hold.code,
      'data-subject': hold.subject,
    },
    [
      // THE RUNNER'S WORD, as the rail draws it: the same hold must not read
      // `claimed …` in one zone and bare in the other.
      hold.family === 'tracker' && hold.label !== undefined && hold.label !== ''
        ? element('span', { class: 'ig-badge', 'data-hold': hold.label }, [hold.label])
        : null,
      hold.family === 'tracker' && hold.label !== undefined && hold.label !== '' ? ` ${hold.reason}` : hold.reason,
      hold.subject === undefined || !known.has(hold.subject) || inInspectedSlot(hold.subject)
        ? null
        : element(
            'button',
            {
              type: 'button',
              class: 'ig-inspector-hold-subject',
              'data-ig-command': 'select-issue',
              'data-ig-target': hold.subject,
            },
            [hold.subject],
          ),
    ],
  );
}

/** Render one document at one reader position, as the whole workspace. */
export function renderWorkspace(
  input: ViewerDocument,
  options: WorkspaceOptions,
): WorkspaceResult {
  const selection = options.selection ?? INITIAL_SELECTION;
  const theme = resolveTheme(options.theme);
  const overlay = options.audit === undefined ? null : auditOverlay(options.audit);

  // NORMALIZE ONCE, AT THE TOP, AND DERIVE EVERYTHING FROM THAT — this replaces
  // four separate defects rather than fixing them one at a time, and the class
  // is worth naming because it is not obvious from any one of them.
  //
  // Every zone normalizes the document it is handed; this function did NOT, so
  // it derived the window, the severity map, the filter set and the inspector's
  // relationships from the RAW input while the zones drew the normalized one.
  // Anything layer 1 drops — a duplicate placement, a self-edge, an edge naming
  // an issue the document does not carry — therefore survived in this
  // function's answers and vanished from the picture beside them. Two of the
  // shapes that reached: the inspector published a `select-edge` command for an
  // edge no zone had drawn, and a duplicate placement straddling a window
  // boundary became VALID whenever its earlier copy fell outside the window, so
  // the visible order changed with the scroll position.
  //
  // Normalizing here makes those unrepresentable instead of handled.
  // `normalizeDocument` is idempotent — measured: re-normalizing its own output
  // yields zero further diagnostics — so the zones' own passes now find nothing
  // left to drop, and this is the one place that reports what was dropped.
  const sound = normalizeDocument(input);
  const document = sound.document;
  // The keys a hold's subject control may name — see `holdRow`.
  const known: ReadonlySet<string> = new Set(document.issues.map((issue) => issue.key));
  // Which slot a key sits in, by lead — so a hold's subject that resolves to the
  // inspected slot gets no control. The same canonicalization `inspectorView`
  // applies, read off the same normalized slots.
  const leadOf: ReadonlyMap<string, string> = new Map(
    document.order.slots.flatMap((slot) => slot.members.map((member) => [member, slot.lead] as const)),
  );

  // THE FILTER NARROWS THE RAIL, AND ONLY THE RAIL. §17a gives the audit a
  // filter for focus and deliberately no mode; the canvas answers "what
  // surrounds this issue", which the filter says nothing about.
  //
  // It narrows BEFORE the window, or it would narrow only whichever rows the
  // window had already reached and read as doing nothing on a long backlog. On
  // members rather than the lead, for the reason the bar is: a finding can name
  // a member that does not lead its unit.
  const filtered = overlay !== null && options.auditFiltered === true;
  // THE HEADER'S TWO FACTS ARE WITHHELD FROM THE RAIL HERE, and this is the one
  // place they are: see `railHostFacts` for why a subtraction rather than
  // `SceneOptions.chrome`.
  const railHost = railHostFacts(document.host);
  const railInput: ViewerDocument = filtered
    ? {
        ...document,
        host: railHost,
        order: {
          // EXCLUSIONS ARE ROWS TOO, and filtering only the slots left the clean
          // ones on screen while the header said the filter was on — the toggle
          // narrowing part of the rail and claiming to have narrowed it.
          slots: document.order.slots.filter((slot) =>
            slot.members.some((member) => auditFilterKeeps(overlay, member)),
          ),
          excluded: document.order.excluded.filter((exclusion) =>
            auditFilterKeeps(overlay, exclusion.key),
          ),
        },
      }
    : { ...document, host: railHost };

  const rail = railWindow(railInput, options.rail ?? {});
  const railRender = renderViewer(rail.document, {
    projection: 'linear',
    theme,
    // The rail is where a selected ISSUE reads as current. An edge selection
    // resolves to no key, which is `selectedKey`'s whole job.
    selected: selectedKey(selection),
  });
  // Built once, over the window's rows, so a rail of 312 costs one pass rather
  // than one scan of `overlay.rows` per drawn row.
  const severityByKey = new Map<string, AuditSeverity>();
  for (const slot of rail.rows) {
    const severity = severityForRow(overlay, slot.members);
    if (severity !== undefined) severityByKey.set(slot.lead, severity);
  }
  // EXCLUSIONS CARRY A KEY AND RENDER A ROW, so the bar belongs on them too.
  // Built from the slots alone, the map missed exactly the row a
  // `dead-duplicate-ref` finding is about — the class most associated with an
  // exclusion in the first place — and the ambient warning went missing on the
  // one row it most obviously described.
  for (const exclusion of rail.document.order.excluded) {
    const severity = severityForRow(overlay, [exclusion.key]);
    if (severity !== undefined) severityByKey.set(exclusion.key, severity);
  }

  // THE CANVAS IS THE WHOLE DOCUMENT, NOT THE WINDOW. The window is the rail's
  // scrolling position and says nothing about what surrounds the selected
  // issue; handing the ladder a windowed document would make its budgets — and
  // therefore its refusal — depend on where the reader had scrolled to.
  const canvas = renderScaleLadder(document, {
    state: options.scale ?? INITIAL_SCALE_STATE,
    theme,
    // THE SAME ONE VALUE THE RAIL READ. Without this the canvas drew the
    // selected issue as ordinary while the rail marked it current, so the
    // single selection this surface advertises disagreed with itself between
    // two zones on every render.
    selected: selectedKey(selection),
    // AND ITS OTHER HALF. The union has two payloads, and reading only the
    // issue one left the canvas the single zone that could not see an edge
    // selection: the inspector filtered to the edge while the canvas drew it
    // as ordinary — the same disagreement the line above closed for issues,
    // still open for the other kind.
    selectedEdge: selectedEdgeId(selection),
    projected: options.projected,
  });

  const inspector = inspectorView(document, selection);

  // §17c'S LOOP, OVER THE RAIL THE READER IS ACTUALLY LOOKING AT.
  // `reevaluateView` is handed the WINDOWED scene, so a chip whose row is
  // scrolled out of the window resolves to no row and draws nowhere — which is
  // right: a chip is a mark ON a row, and there is no row. The summary still
  // counts it, because the summary is about the ORDER and not about the window.
  //
  // NO WORDS, NO LOOP. `words.change` is optional and its absence is the whole
  // reason there is no default sentence here; see `ChangeWords`.
  const changeWords = options.words.change;
  const orderStatus: OrderStatus = options.orderStatus ?? 'settled';
  // EVERY REF THE ORDER HAS, WINDOWED OR NOT — and taken from the UNFILTERED
  // document on purpose, so a row the audit filter is hiding counts as expected
  // for the same reason an off-window row does. The rail this render hands the
  // viewer is narrowed twice over; neither narrowing is a disagreement between
  // the projection and the change, and only this function holds the order both
  // narrowings started from.
  const inTheOrder = new Set<string>();
  for (const slot of document.order.slots) {
    inTheOrder.add(slot.lead);
    for (const member of slot.members) inTheOrder.add(member);
  }
  for (const exclusion of document.order.excluded) inTheOrder.add(exclusion.key);

  const change = reevaluateView(
    changeWords === undefined ? null : options.change,
    railRender.scene,
    orderStatus,
    inTheOrder,
  );
  const deltaByKey = new Map<string, RowDelta>(
    changeWords === undefined
      ? []
      : change.chips.map((chip) => [
          chip.key,
          { chip, words: changeWords, kind: deltaKind(chip) },
        ]),
  );

  const markup = [
    // THE ORDER'S STATUS, ON THE SURFACE ROOT. `mount.ts` already publishes the
    // same value on the mounted element for a host to read; this puts it where
    // the stylesheet can reach it in the UNMOUNTED rendering too, so §17c's
    // "greyed one step, and labelled" is drawn by whoever renders rather than
    // only by whoever mounts. Same vocabulary, verbatim, so the two agree.
    // STAMPED ONLY WHERE THE LABEL CAN BE DRAWN, and the two really are one
    // treatment. §17c's held state is a greyed rail AND the word saying why —
    // "a stale-but-labelled order beats a half-computed one" — and half of that
    // is worse than neither: a dimmed order with no explanation is exactly the
    // defect the label exists to prevent. `mountWorkspace` passes the store's
    // status unconditionally, so a host that has not supplied `words.change`
    // would otherwise get the greying with the label suppressed one branch
    // below, on the very path the optional vocabulary exists to keep working.
    //
    // THE FACT IS NOT LOST TO A HOST. `mount.ts` publishes the same status on
    // the element the host holds, which is the reader this attribute was never
    // for: this one is the stylesheet's hook, so it is absent exactly when the
    // stylesheet must not act.
    changeWords === undefined
      ? `<div class="ig-workspace">`
      : `<div class="ig-workspace" data-order="${orderStatus}">`,
    zone(
      'header',
      [
        headerMarkup(
          document.host,
          overlay === null ? '' : renderAuditHeader(overlay, { filtered }),
          options.words,
        ),
        // §17c'S SUMMARY LIVES IN THE HEADER, NOT AT THE TOP OF THE RAIL, and
        // the frame draws them adjacent so this is a real departure worth the
        // sentence. The rail zone is the SCROLLER — `mount.ts` preserves
        // `railBefore.scrollTop` across every redraw — so a summary placed
        // inside it scrolls away from the reader, and §17c's rule is that the
        // summary "persists until the next edit or an explicit dismiss". A
        // summary that survives a dismiss but not a scroll is not persistent.
        //
        // The header is where #135 settled that a workspace-wide fact is
        // stated, and it is stated in exactly one zone. The chips carry the
        // adjacency instead: cause in the header, effect on the row.
        // "A STALE-BUT-LABELLED ORDER BEATS A HALF-COMPUTED ONE." §17c greys the
        // held rail and says WHY beside it, and the greying without the label
        // is the half of that pair which communicates nothing.
        //
        // THE LABEL IS `summarySpec`'S, INSIDE ITS LIVE REGION, and it was a
        // sibling of that region until a reader pointed out this made it
        // silent. The store clears `lastChange` when a write goes PENDING, so
        // the region is empty in exactly the state the label exists for — a
        // sighted reader got the greying and the sentence, and a screen-reader
        // user was told nothing about the ranks having gone stale.
        changeWords === undefined
          ? ''
          : renderMarkup(summarySpec(change.summary, changeWords, { held: change.held })),
      ].join(''),
    ),
    zone(
      'rail',
      [
        railSpacer(rail.before, 'before'),
        renderMarkup(
          markRail(
            railRender.scene.root,
            (key) => severityByKey.get(key),
            (key) => deltaByKey.get(key),
          ),
        ),
        railSpacer(rail.after, 'after'),
      ].join(''),
    ),
    zone('canvas', canvas.markup),
    zone(
      'inspector',
      // §17d'S LIST IS THE SELECTION'S SIBLING, AND THEY SHARE ONE SCROLL
      // TRACK. Sibling rather than child so the panel keeps its own padding and
      // reads as a peer of the selection rather than part of it — its heading
      // is an `h2` beside the inspector's for the same reason.
      //
      // THEY DO NOT GET INDEPENDENT SHARES, and this comment said they did
      // until a review round caught it still describing a reverted layout. Only
      // the ZONE scrolls (`workspace/styles.ts`); `audit/styles.ts` declares no
      // share and no scroll of its own. So a long audit CAN push the selection
      // detail down the track — a property this zone already had, since a long
      // relationship list does the same.
      //
      // A two-pane version was built and reverted: it clipped `.ig-chrome`,
      // which `mountWorkspace` appends to this zone as a THIRD sibling. How the
      // three share one column is a design question and #177 owns it, with the
      // four attempts and why each failed.
      //
      // BOTH SIDES ARE ALREADY-RENDERED MARKUP, which is the rule `zone` exists
      // under: it writes the only hand-authored tag in this package and takes
      // no caller value, and everything with a dynamic value in it went through
      // `renderMarkup`.
      //
      // `known` IS THE DRAWN DOCUMENT'S KEYS, the same set `holdRow` withholds
      // its subject control on, and NOT the audit's: a host audits what it
      // holds and draws a page of it, so a ref can be audited and still have no
      // row here. The panel cannot see that difference and is told.
      (() => {
        if (overlay === null) return '';
        const panel = renderAuditPanel(overlay, { words: options.words.audit, known });
        return panel === null ? '' : renderMarkup(panel);
      })() +
      renderMarkup(
        inspectorSpec(inspector, {
          words: options.words,
          audit: overlay,
          known,
          leadOf,
          draft: options.draft ?? IDLE_CREATE_DRAFT,
          drop: options.drop ?? null,
          // FORWARDED IN THE ORDER IT ARRIVED, and turned into an answer per
          // edge inside `relationshipEntries` — after the panel has decided
          // which of them are its to state. Collapsing here instead put the
          // "one reason per row" rule one layer away from the filter that
          // decides which reasons there are, and made the ORDER of this array
          // load-bearing at a distance: a caller building it from two passes
          // lost the ledger's chronology at the join, and the panel reported a
          // refusal the reader had already read instead of the one they had
          // just caused.
          refusals: options.refusals ?? [],
          // FORWARDED IN THE LEDGER'S ORDER too, for the reason above: the
          // cards are drawn in the order the writes were made, so the one the
          // reader just caused is the one nearest what they were doing.
          recoveries: options.recoveries ?? [],
          diffOpen: options.diffOpen ?? null,
        }),
      ),
    ),
    `</div>`,
  ].join('');

  return {
    view: { selection, rail, inspector, audit: overlay, auditFiltered: filtered },
    markup,
    // THE THEME IS WRITTEN ONCE. Both leaves below emit their own copy of the
    // viewer's stylesheet and the theme rule, so taking `canvas.styles`
    // wholesale would install the custom properties two or three times over —
    // harmless to render and impossible to debug when a host overrides one.
    styles: [
      viewerStylesheet,
      themeCss(theme, options.themeSelector ?? ':root'),
      scaleLadderStylesheet,
      // THE CANVAS CAN DRAW A SELECTION HALO NOW, so the sheet that styles one
      // has to be installed. It is listed here rather than inherited from
      // `canvas.styles` for the reason directly above: that value carries its
      // own copy of the viewer sheet and the theme.
      // UNCONDITIONAL, unlike the audit sheet beside it. An audit overlay is a
      // whole zone a caller opts into; an edge selection arrives from a click
      // AFTER this render, so a sheet installed only when something is already
      // selected is one that is missing on exactly the render that first needs
      // it.
      edgeOverlayStylesheet,
      ...(overlay === null ? [] : [auditStylesheet]),
      // UNCONDITIONAL, for the reason `edgeOverlayStylesheet` above records:
      // the summary and the chips arrive with the NEXT snapshot after an edit,
      // so a sheet installed only once something has already changed is missing
      // on exactly the render that first draws one.
      reevaluateStylesheet,
      workspaceStylesheet,
    ].join('\n'),
    // CONCATENATED, NOT DEDUPED — and the dedupe that used to sit here is worth
    // recording rather than deleting quietly, because it was CORRECT when it
    // was added and became wrong two commits later without being touched.
    //
    // It was added when both zones normalized the raw document independently
    // and reported the same defect twice. Normalizing once removed that source,
    // and the same `Set` then had only one thing left to collapse: the
    // deliberately REPEATED diagnostics a single pass emits, one per occurrence
    // — two identical self-edges, the same unknown member in several slots.
    // Understating how many times an input is malformed is worse than the
    // duplication it was guarding against, and it is a count a host acts on.
    //
    // Nothing replaces it, because nothing needs to: the zones now receive an
    // already-sound document, so they contribute nothing to this list at all.
    // `reports every occurrence, and the zones add nothing` pins both halves.
    // THE PLACEMENT DIAGNOSTICS ARE THE CHANGE'S, and they are only worth
    // reporting because `expected` above makes them mean what they say. Dropped
    // entirely, a host got no signal that its projection and its change
    // disagree; forwarded unfiltered, every scroll past a changed row would
    // have reported one.
    diagnostics: [
      ...sound.diagnostics,
      ...railRender.diagnostics,
      ...canvas.diagnostics,
      ...change.diagnostics,
    ],
  };
}
