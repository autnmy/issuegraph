/**
 * `@issuegraph/editor` — everything that mutates an Issuegraph document.
 *
 * Layer 2 of the three-layer seam. Its whole contract is a composition:
 *
 *     composes  @issuegraph/viewer  (layer 1) — the node, edge and badge grammar
 *     composes  @issuegraph/store            — the document, the edit set, the port
 *     never     fetching, auth, persistence, or a write of its own
 *
 * An edit is a `Proposal` handed to the store, which dispatches it to the host's
 * injected `DataSource`. The editor performs none of that itself, which is what
 * lets it be published: what editing drags in — auth, network, the
 * fail-or-conflict state machine — is host-shaped and injected.
 *
 * ## The seam, and why it is a test rather than a sentence
 *
 * Layer 1 and layer 2 ship as separate packages, so the boundary between them is
 * no longer enforced by a repository line. The design says so in as many words:
 * the seam "stops being enforced by construction and becomes discipline — layer 2
 * composes layer 1 through its public surface and never reaches past it."
 *
 * Discipline that nothing checks is a comment. The check is in
 * `eslint.config.mjs`, over the AST: every import of a sibling package must be
 * its BARE specifier, and `require()` is banned outright because it is the one
 * call that walks past every import rule. A reach into
 * `@issuegraph/viewer/src/...` fails lint rather than a code review that might
 * not happen, and `scripts/eslint-rules.test.mjs` proves the rules fire by
 * running them against deliberate violations.
 *
 * The same config carries the purity claim for this package and the viewer — no
 * fetch, no storage, no credentials, no Node builtin. `purity.test.ts` keeps the
 * half no static rule can do: it loads every shipped module with the browser
 * globals removed, which is what catches a computed access like
 * `globalThis['fet' + 'ch']`.
 *
 * ## The one declared crossing
 *
 * The `together-with` connector lives in the VIEWER, not here. A `together-with`
 * edge must be individually selectable, retypeable and deletable, and an
 * enclosure has no edge to click — so the connector is a hit target, and only
 * the layer that computes the layout knows where its endpoints are. Adding it
 * from out here would mean re-deriving positions layer 1 already has, which is
 * the drifting second implementation the package split exists to avoid.
 *
 * It is written down as a declared crossing rather than discovered later. Treat
 * it as the precedent for DECLARING a crossing, never as permission for more.
 *
 * ## The surface
 *
 * The SCALE LADDER, the AUDIT, the RE-EVALUATE SURFACE, the EDGE
 * MUTATION-STATE OVERLAYS, the TYPE PICKER, the CREATE PATHS and the FIRST
 * PASS. The final shape of this file is decided by the change that assembles
 * the workspace.
 *
 * The first pass is the first thing here to take a PORT of its own. The create
 * paths take a target from the host because searching a backlog needs the
 * backlog; the first pass goes further and takes the whole question set,
 * because the evidence §17e describes — two bodies referencing one path, a
 * comment linking an issue — is not derivable from a `GraphDocument` at all. A
 * heuristic shipped in here would be an un-themeable product opinion inside a
 * published package, which is the same reason the store fetches nothing.
 *
 * The create paths are the first thing here to be shaped by a requirement that
 * three surfaces be EQUIVALENT rather than merely present. They gather the same
 * three facts in different orders, so the draft is modelled as a set of slots
 * rather than a sequence of steps, and there is exactly one emitter — which is
 * what makes "the inspector is not a fallback" structural instead of a promise.
 * The only thing that genuinely differs between them is where the picker is
 * drawn, and that is geometry rather than state.

 *
 * The picker is the first thing here to compose @issuegraph/core directly. The
 * split between directed and symmetric relationships is a fact about the
 * FORMAT, and core owns it; a local list out here would be the drifting second
 * implementation the package family removes everywhere else. Core is the layer
 * both siblings already sit on, and the seam refuses a sibling's SUBPATH rather
 * than its bare specifier, so reaching for the shared foundation is not
 * reaching past a surface.
 *
 * The re-evaluate surface is the first thing here to compose the STORE as well
 * as the viewer — it presents `diffOrder`'s output and computes no diff of its
 * own — and the first to require words from its host rather than writing them.
 *
 * The overlays are the first to compose the store's PROJECTION, and they draw
 * only what reuses a path's own position: a halo, a ghost, a dash. Anything
 * needing a new position — the chips, the ✕, the inline reason, a conflict's
 * second version — is declared as a mark for the layer that computed the
 * layout, which is the workspace this file's final shape waits on.
 *
 * A published package can add an export later and can never take one back, so
 * nothing is exported before something is owed.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export type {
  AuditClass,
  AuditClassSpec,
  AuditFinding,
  AuditGraph,
  AuditInput,
  AuditSeverity,
  EncodingRefusal,
} from './audit/findings.ts';
export { AUDIT_CLASSES, AUDIT_CLASS_SPECS, auditDocument } from './audit/findings.ts';

export type { AuditHeaderOptions, AuditOverlay, AuditRow } from './audit/surface.ts';
export {
  AUDIT_COUNT_ATTRIBUTE,
  AUDIT_FILTER_ATTRIBUTE,
  AUDIT_SEVERITY_ATTRIBUTE,
  auditFilterKeeps,
  auditOverlay,
  auditRowAttributes,
  renderAuditHeader,
} from './audit/surface.ts';

export { auditStylesheet } from './audit/styles.ts';

export {
  INITIAL_SCALE_STATE,
  type ScaleCommand,
  type ScaleState,
  scaleReducer,
} from './scale/commands.ts';

export {
  type IsolatedChip,
  type ScaleCapsule,
  type ScaleLadder,
  type ScaleMatch,
  type ScaleRefusal,
  type ScaleRoute,
  type ScaleRouteKind,
  type ScaleSearch,
  type ScaleTier,
  scaleLadder,
} from './scale/ladder.ts';

export {
  type ScaleLadderOptions,
  type ScaleLadderResult,
  renderScaleLadder,
} from './scale/render.ts';

export { scaleLadderStylesheet } from './scale/styles.ts';

export {
  OVERLAY_TREATMENTS,
  STATE_ATTRIBUTE,
  type EdgeOverlay,
  type OverlayAffordance,
  type OverlayDash,
  type OverlayMark,
  type OverlayStroke,
  type OverlayTreatment,
  overlayFor,
  overlayLabel,
  treatmentForState,
} from './overlay/grammar.ts';

export {
  OVERLAY_CLASS,
  type AttachResult,
  type OverlayOptions,
  attachEdgeOverlays,
  renderOverlayMark,
} from './overlay/render.ts';

export { edgeOverlayStylesheet } from './overlay/styles.ts';

export {
  type DirectionStatement,
  type FlipControl,
  type KindOption,
  type PickerView,
  pickerView,
} from './picker/view.ts';

export { type PickerWords } from './picker/words.ts';

export {
  type PickerOptions,
  type PickerResult,
  renderPicker,
} from './picker/render.ts';

export { pickerStylesheet } from './picker/styles.ts';

export {
  type CreateCommand,
  type CreateDraft,
  type CreateResult,
  IDLE_CREATE_DRAFT,
  createReducer,
} from './create/draft.ts';

export {
  type CreateInteraction,
  type KeyIntent,
  type KeyPress,
  type KeyboardContext,
  keyIntent,
} from './create/keys.ts';

export {
  type Bounds,
  type PickerPlacement,
  type Point,
  type Size,
  pickerPlacement,
} from './create/placement.ts';

export {
  type ChangeFacet,
  type ChangeSummary,
  type PlacedChip,
  type ReevaluateView,
  type SummaryPart,
  CHANGE_FACETS,
  reevaluateView,
  summaryOf,
} from './reevaluate/view.ts';

export { type ChangeWords } from './reevaluate/words.ts';

export {
  type ReevaluateOptions,
  type ReevaluateResult,
  renderReevaluate,
} from './reevaluate/render.ts';

export { reevaluateStylesheet } from './reevaluate/styles.ts';

export type {
  Candidate,
  CandidateEvidence,
  CandidateId,
  CandidateSource,
} from './firstpass/candidates.ts';

export {
  type Answer,
  type Answered,
  type QueueCommand,
  type QueueProgress,
  type QueueResult,
  type QueueState,
  currentCandidate,
  isAnswered,
  openQueue,
  queueProgress,
  queueReducer,
  skippedCandidates,
} from './firstpass/queue.ts';

export {
  type BatchDirection,
  type BatchOutcome,
  type BatchPlan,
  type BatchRefusal,
  type BatchRequest,
  type BatchSettlement,
  planBatch,
  resumeBatch,
} from './firstpass/batch.ts';

export {
  type FirstPassContext,
  type FirstPassInteraction,
  type FirstPassIntent,
  firstPassIntent,
} from './firstpass/keys.ts';

export {
  type FirstPassQuestion,
  type FirstPassView,
  firstPassView,
} from './firstpass/view.ts';

export { type FirstPassWords } from './firstpass/words.ts';

export {
  ANSWERED_ATTRIBUTE,
  ANSWER_ATTRIBUTE,
  COMMAND_ATTRIBUTE,
  EVIDENCE_TOKEN_ATTRIBUTE,
  FOUND_ATTRIBUTE,
  type FirstPassOptions,
  type FirstPassResult,
  renderFirstPass,
} from './firstpass/render.ts';

export { firstPassStylesheet } from './firstpass/styles.ts';
