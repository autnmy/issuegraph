/**
 * The workspace's DOM shell — the only module in this package that touches
 * nodes.
 *
 * `renderWorkspace` renders the three-zone workspace as markup and publishes
 * every control as `data-ig-command`; `@issuegraph/viewer` publishes its two
 * identities, `data-ig-key` and `data-ig-group`. A mount reads those, reduces,
 * and renders again — and that loop is this file. What it DECIDES lives in
 * `host.ts`, as a reducer with no DOM, so this file is left with listeners, an
 * `innerHTML` assignment, and the chrome the panels leave to a mount: the add
 * button, the kind chooser, the target search, the delete button.
 *
 * ## Lifted from the demo, in the viewer's shape
 *
 * This was the demo's `workspace.ts`, written once for that page. The viewer
 * made the opposite call for the same problem — it exports `mountViewer` with
 * `update` and `destroy` — and that is the entry point a typed host actually
 * consumes. It took nine review rounds to get this shell right, and every
 * finding was in the shell, none in the reducer; a second host would have
 * re-run them. So the shell ships, in the viewer's shape: one function, one
 * handle, and a container it touches and nothing else.
 *
 * ## `innerHTML`, and why it is not the thing `render.ts` refused
 *
 * Nothing in this file interpolates host text into markup. What IS assigned as
 * markup is the package's own rendered output, which `renderMarkup` escaped —
 * the exact bytes a server-rendered host would send. The chrome beside it is
 * built with `createElement` and `textContent`, so the two disciplines meet at
 * the seam rather than mixing.
 *
 * ## One listener per event, at the root
 *
 * The workspace is re-rendered on every change, so a listener attached to a
 * rendered node dies with it. Delegation at the root is what makes the loop
 * cheap to reason about: one `click`, one `input`, one `keydown`, one scroll
 * (captured, because scroll does not bubble), and the three pointer events the
 * canvas drag needs.
 *
 * ## It reaches no global
 *
 * The document comes from the element the caller passed, which is what keeps
 * this module importable on a runtime that has no DOM — the property
 * `purity.test.ts` measures. An element is recognised by what it can do rather
 * than by `instanceof` against a constructor this module would have to reach
 * for, and a pointer release outside the element is heard on the element's own
 * document rather than on a window.
 */

import { edgeIdentity } from '@issuegraph/core';
import type { EdgeId, EdgeKind, GraphDocument, MutationId, Store, StoreSnapshot } from '@issuegraph/store';
import { nextDocument } from '@issuegraph/store';
import {
  type Scene,
  type Theme,
  type ViewerDocument,
  navigate,
  renderViewer,
  resolveTheme,
} from '@issuegraph/viewer';

import { CONTROL_ATTRIBUTES } from '../a11y/baseline.ts';
import type { AuditInput } from '../audit/findings.ts';
import { isChoosingKind } from '../create/draft.ts';
import { type CreateInteraction, type KeyboardContext, KIND_KEYS, keyIntent } from '../create/keys.ts';
import { pickerPlacement } from '../create/placement.ts';
import type { CandidateSource } from '../firstpass/candidates.ts';
import { type FirstPassContext, firstPassIntent } from '../firstpass/keys.ts';
import { ANSWER_ATTRIBUTE, renderFirstPass } from '../firstpass/render.ts';
import { firstPassStylesheet } from '../firstpass/styles.ts';
import type { FirstPassWords } from '../firstpass/words.ts';
import { STATE_ATTRIBUTE, overlayFor } from '../overlay/grammar.ts';
import { overlaysFor } from '../overlay/projected.ts';
import { renderPicker } from '../picker/render.ts';
import { pickerStylesheet } from '../picker/styles.ts';
import type { PickerWords } from '../picker/words.ts';
import { scaleLadder } from '../scale/ladder.ts';
import { mountStylesheet } from './chrome.ts';
import type { FirstPassPhase } from './firstpass.ts';
import {
  type HostCommand,
  type HostEffect,
  type HostResult,
  type HostState,
  INITIAL_HOST_STATE,
  editCarrier,
  railRowAt,
  railSlackFor,
  railWindowTarget,
  reconcileHost,
  reduceHost,
  targetMatches,
} from './host.ts';
import type { RailWindow } from './rail.ts';
import { conflictDiff } from './recovery.ts';
import {
  type WorkspaceRecovery,
  type WorkspaceRefusal,
  type WorkspaceWords,
  renderWorkspace,
} from './render.ts';
import { selectedEdgeId, selectedKey } from './selection.ts';

/** What the canvas zone draws: the editor's scale ladder, or the viewer's tree projection. */
export const CANVAS_MODES = Object.freeze(['neighbourhood', 'tree'] as const);
export type CanvasMode = (typeof CANVAS_MODES)[number];

/**
 * The words the mount's chrome needs on top of the workspace's own.
 *
 * Required, for the reason `WorkspaceWords` gives: this package does not
 * invent an English sentence, and a default would be one. `picker` is the
 * picker's vocabulary, which the mount draws for a selected edge; `keys` is
 * the one optional entry, because a host may prefer to document the keyboard
 * elsewhere.
 *
 * `addRelationship` AND `cancel` MOVED DOWN to {@link WorkspaceWords} with the
 * controls they name: `renderWorkspace` draws `+ add` and the numbered kind
 * list now, so a host rendering markup without mounting needs both. They are
 * still readable here, through the extension, and a host supplies each exactly
 * once — redeclaring one on this interface would be a second place for the same
 * word to be documented and the first place for the two to disagree.
 *
 * `flip` MOVED THE SAME WAY AND IS NOT THE SAME MOVE. It came from
 * {@link PickerWords}, which this interface holds in a NESTED field, so a host
 * reads `words.flip` where it read `words.picker.flip`. That path change is the
 * breaking half of §17b's control moving to the surface that draws it.
 */
export interface MountWords extends WorkspaceWords {
  readonly picker: PickerWords;
  /**
   * The control that proposes deleting the SELECTED edge, drawn beside the
   * retype picker.
   *
   * Distinct from `WorkspaceWords.remove`, which names the glyph control each
   * relationship ROW carries: this one is a labelled button about the one edge
   * the panel is filtered to, and a glyph button needs a name a row-independent
   * label cannot supply.
   */
  readonly deleteRelationship: string;
  /** The chooser's sentence tail while no target is known yet. */
  readonly chooseKind: string;
  /** The target search's accessible name. */
  readonly targetLabel: string;
  /** The target search's placeholder. */
  readonly targetPlaceholder: string;
  /** A one-line key legend under the inspector, when the host wants one drawn. */
  readonly keys?: string | undefined;
}

/**
 * What the host projects a store snapshot onto.
 *
 * The viewer derives nothing — the order, the holds and the provenance are all
 * inputs — and the audit reads a graph the host built, so both come from the
 * host's projection rather than from anything this mount could compute. An
 * absent `audit` means "not run", which the workspace renders as no header.
 */
export interface WorkspaceProjection {
  readonly viewer: ViewerDocument;
  readonly audit?: AuditInput | undefined;
}

export interface MountWorkspaceOptions {
  /**
   * The store the host built, with its own `DataSource` and `OrderDeriver`.
   * Fixed for the life of the mount; a host that swaps stores destroys and
   * mounts again. Hydration is the host's: the mount subscribes and redraws on
   * every notification, so a `hydrate()` before or after mounting both land.
   */
  readonly store: Store;
  /** The host's projection of a snapshot — the landed document is `{ issues, edges: landed }`. */
  readonly project: (snapshot: StoreSnapshot) => WorkspaceProjection;
  readonly words: MountWords;
  readonly theme?: Theme | undefined;
  /** The selector the theme's custom properties are written onto. */
  readonly themeSelector?: string | undefined;
  readonly canvas?: CanvasMode | undefined;
  /** How many rail rows are drawn per window. Wider than the package default so a scroll rarely lands past the drawn rows. */
  readonly railCount?: number | undefined;
  /**
   * The first pass, or nothing.
   *
   * ONE BUNDLE, ALL OF IT OR NONE, rather than a source and some words that can
   * be supplied independently: a scan with no words cannot be drawn and words
   * with no scan have nothing to draw, so the type refuses the halves rather
   * than leaving the renderer to.
   *
   * **Absent, the mount never sends the command at all.** `renderWorkspace`
   * draws §17a's `First pass →` entry INSIDE the surface this mount owns
   * (`workspace/render.ts`), so — unlike a control a host draws outside the
   * element and reads from its own listener — a host cannot intercept it. With
   * no source to call, a mount that let the command through would move to
   * `scanning` and stay there for its lifetime. So the shell withholds it, and
   * the entry is inert until a host supplies this.
   */
  readonly firstPass?: FirstPassOption | undefined;
}

/** What a host supplies to make §17a's first-pass entry work. */
export interface FirstPassOption {
  /** The host's scanner. This package ships none — see `firstpass/candidates.ts`. */
  readonly source: CandidateSource;
  readonly words: FirstPassWords;
  /** The control that leaves the queue. §17e: "exit anytime". */
  readonly exit: string;
  /** Shown while the scan is out. */
  readonly scanning: string;
  /** Shown when the host's scan rejects. Distinct from "nothing to encode". */
  readonly scanFailed: string;
}

/** What `update` may change. The store is not among them — see {@link MountWorkspaceOptions.store}. */
export type WorkspaceUpdate = Partial<Omit<MountWorkspaceOptions, 'store'>>;

export interface WorkspaceHandle {
  /** Take new options, redraw in place, keep the selection and the focus. */
  update(options?: WorkspaceUpdate): void;
  /**
   * Hand the mount a command from the host's own chrome.
   *
   * A host draws controls the mount does not — the demo's writes log, with its
   * retry and discard buttons — outside the mounted element, and this is how
   * those reach the one reducer rather than a second copy of it.
   */
  dispatch(command: HostCommand): void;
  readonly state: HostState;
  /** Remove every listener this handle added and the nodes it built. */
  destroy(): void;
}

/** The package default: wide enough that a scroll rarely lands past the drawn rows. */
export const MOUNT_RAIL_COUNT = 80;

/** The kind chooser's size for placement — the stylesheet decides the real one; this only picks a corner. */
const CHOOSER_SIZE = { width: 280, height: 220 };

/** The drag threshold, in CSS pixels: a press that moves less is a click. */
const DRAG_THRESHOLD = 6;

const KEY_ATTRIBUTE = 'data-ig-key';

/**
 * §17c's change region, which is the one node this surface carries ACROSS a
 * redraw rather than replacing.
 *
 * Matched on the role as well as the class: the class is a styling hook, and
 * what has to be preserved is the live region specifically.
 */
const LIVE_REGION = '.ig-change-line[role="status"]';
const GROUP_ATTRIBUTE = 'data-ig-group';
const COMMAND_ATTRIBUTE = 'data-ig-command';
/**
 * Which subject a command acts on, when one command names several.
 *
 * Named here because this file now READS it in two places rather than one —
 * `controlAnswer` turns it into the dispatch's `target`, and the focus token
 * below uses it to tell one `select-edge` from the next. A third bare literal for an
 * attribute the renderer writes on every relationship row and every recovery
 * button is how a typo becomes a control that silently stops matching.
 */
const TARGET_ATTRIBUTE = 'data-ig-target';

/**
 * Commands that name ONE control in two states.
 *
 * The isolated-issues chip redraws the SAME button with its command flipped
 * (`scale/render.ts`), so a focus token comparing the raw command rejects the
 * replacement and sends the reader to the rail — and that control, like the
 * conflict disclosure, is one you press a second time to undo. It is this
 * pull request's own defect wearing a different attribute value, which is
 * why it is worth a table rather than a special case: the next toggle gets
 * one line here instead of a new bug.
 *
 * A TABLE, NOT A PREFIX RULE. `open-` / `close-` looks like a pattern and is
 * not one — `first-pass` and `first-pass-close` are two different controls in
 * two different places, and a rule that folded them would restore focus onto
 * the wrong one.
 */
const TOGGLE_IDENTITY: Readonly<Record<string, string>> = Object.freeze({
  'open-isolated': 'isolated',
  'close-isolated': 'isolated',
});

/** What a control is, rather than which of its states is showing. */
function controlIdentity(control: string): string {
  return TOGGLE_IDENTITY[control] ?? control;
}

/**
 * An element, recognised by what it can do.
 *
 * Not `instanceof Element`: that reaches for a constructor this module has no
 * global for, and on a runtime with two documents — a test's jsdom beside
 * Node's own globals — it answers wrong even where one exists.
 */
function isElement(target: EventTarget | null | undefined): target is Element {
  return target !== null && target !== undefined && 'closest' in target && 'getAttribute' in target;
}

function isFocusable(node: Element | null | undefined): node is HTMLElement {
  return node !== null && node !== undefined && 'focus' in node;
}

/**
 * What an element means when it is pressed — the answer both listeners take.
 *
 * `null`, returned rather than spelled here, is the third state: NOT A CONTROL.
 * It is distinct from a refusal in the way that matters to a caller — nothing
 * here claimed the press, so whoever else wants it may have it.
 *
 * WHY THE REFUSAL CARRIES ITS REASON. See {@link controlAnswer}: the two
 * refusals are the same to a click and opposite to a key press. `input` hands
 * the press to the platform's text editing; `inert` is this package answering
 * "no", and a key press it hands back would be activated by the browser anyway.
 * A boolean `refused` would make one of those two wrong, and nothing would say
 * which one.
 */
type ControlAnswer =
  | { readonly kind: 'dispatch'; readonly command: HostCommand }
  | { readonly kind: 'refused'; readonly reason: 'input' | 'inert' };

/** The two refusals, allocated once: they carry no per-press data. */
const REFUSED_INPUT: ControlAnswer = Object.freeze({ kind: 'refused', reason: 'input' });
const REFUSED_INERT: ControlAnswer = Object.freeze({ kind: 'refused', reason: 'inert' });

/**
 * A control's identity across a redraw — every field `controlAnswer` reads
 * when it turns a press into a dispatch, and for that reason.
 *
 * THE IDENTITY IS THE DISPATCH'S, NOT A SUBSET OF IT. An earlier revision
 * carried zone, command and target only, and claimed a namesake could never be
 * mistaken for the control that had focus. Measured false: the inspector's kind
 * list and the picker's retype options each publish ONE command across several
 * buttons carrying no target, separated only by `data-ig-value` /
 * `data-ig-kind`. Focus the `together-with` option, let any redraw land, and
 * focus came back on `blocked-by` — worse than the body it replaced, because
 * the reader's next Enter then performs a DIFFERENT act rather than none.
 *
 * So the fields here mirror `controlAnswer` exactly. Anything it reads to
 * decide WHICH act a press performs has to be part of what identifies the
 * control, or restoring focus can silently change the act. Mirroring the
 * RESOLVER rather than one of its callers is what keeps that true now that a
 * key press reaches it too.
 */
interface CommandFocus {
  /** Which attribute published it — see {@link CONTROL_ATTRIBUTES}. */
  readonly channel: string;
  readonly zone: string | null;
  readonly control: string;
  readonly target: string | null;
  readonly value: string | null;
  /**
   * Which of the identical controls it was, counted in document order.
   *
   * ADDED TO CLOSE THE CLASS RATHER THAN THE CASE. Three separate findings on
   * this branch were one shape: two controls the token could not tell apart —
   * the kind options, the target matches, and finally a scale capsule beside a
   * search result, both publishing `focus` with the same lead in the same zone.
   * Each was fixable by carrying one more attribute, and the next one would
   * have been too. When two controls are genuinely indistinguishable by every
   * attribute they publish, their ORDER is the only thing left that separates
   * them, so that is what is recorded.
   *
   * It is a weaker key than the others and is used only as a tiebreak: a list
   * that reorders under the reader restores the wrong sibling. That is a real
   * limit, and it beats the alternative of always restoring the first.
   */
  readonly ordinal: number;
}

function isInput(node: Element | null | undefined): node is HTMLInputElement {
  return node !== null && node !== undefined && node.tagName === 'INPUT';
}

function isComposing(event: Event): boolean {
  return 'isComposing' in event && event.isComposing === true;
}

/** Every element under `scope` carrying exactly this key, in document order. */
function withKey(scope: Element, key: string): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}]`)].filter(
    (node) => node.getAttribute(KEY_ATTRIBUTE) === key,
  );
}

/**
 * The document the CANVAS draws: the host's document without its host facts.
 *
 * The rail draws the header, the NOW list and the freshness stamp — every
 * host fact is whole-order, and the rail is the workspace's order surface. The
 * scale ladder's focus already drops `host` for the graph canvas; the tree
 * canvas renders the whole document and so drew a second header and a second
 * refresh control in the same workspace. One place strips it for both.
 */
/**
 * The host facts a SECONDARY view keeps: what is true, never what is drawn.
 *
 * The rail owns this workspace's one header, NOW row and freshness stamp, and
 * carrying them onto a second view would draw them twice — that is why the
 * facts are stripped here at all, and it stays true.
 *
 * THE CONDITION IS NOT ONE OF THEM. It is the host's account of WHY the panel
 * is short, and the viewer uses it to refuse to invent a different account:
 * without it, a canvas beside an explained rail falls back to "no issue in this
 * document declares a relationship", which under a stated `error` is a claim
 * about something else and contradicts the rail. It draws nothing on its own
 * under `chrome: false`, so keeping it costs no chrome — it only stops a second
 * view explaining the same emptiness a different, false way.
 */
function withoutChrome(document: ViewerDocument): ViewerDocument {
  if (document.host === undefined) return document;
  const { host, ...rest } = document;
  return host.condition === undefined ? rest : { ...rest, host: { condition: host.condition } };
}

/**
 * Mount the workspace into an element.
 *
 * Returns a handle rather than nothing, for the viewer's reason: a host that
 * cannot tear this down leaks a listener on every re-render.
 */
export function mountWorkspace(element: HTMLElement, options: MountWorkspaceOptions): WorkspaceHandle {
  const doc = element.ownerDocument;
  const { store } = options;
  let current: MountWorkspaceOptions = options;

  const styles = doc.createElement('style');
  const surface = doc.createElement('div');
  surface.className = 'ig-mount';
  element.append(styles, surface);

  let state: HostState = INITIAL_HOST_STATE;
  let pending = false;
  let destroyed = false;
  // What the last redraw drew, kept so a key press can ask the viewer's own
  // navigation reducer about the scene the reader is looking at.
  let drawn: { readonly viewer: ViewerDocument; readonly rail: RailWindow } | null = null;
  // A rail row to focus once the window has been re-cut around it.
  let pendingFocus: { readonly kind: 'after' | 'before' | 'first' | 'last'; readonly key: string | null } | null = null;
  // The keys currently holding a control they activated. See `onKeydown`'s first
  // arm for why this is a fact about the PRESS and not a question asked of
  // whatever holds focus by the time the repeats arrive.
  //
  // A SET RATHER THAN THE LATEST KEY. Two can be down at once — hold `Space` on
  // one control and press `Enter` on another — and a scalar answers that by
  // forgetting the first, so its repeats stop being recognised as its own and go
  // wherever focus has since moved. That is not a case to guard; it is a case
  // the representation should not be able to express, which is what this is.
  const activating = new Set<string>();
  let pressed:
    | { readonly pointerId: number; readonly key: string; readonly x: number; readonly y: number; dragging: boolean }
    | null = null;
  // Whether the last render drew the target search, so focus moves into it on
  // the render that OPENS it and not on every render while it stays open.
  let searchWasOpen = false;
  // The phase the last render drew, so the overlay is entered once rather than
  // on every redraw, and left exactly once.
  let firstPassWas: FirstPassPhase['kind'] = 'closed';
  // Where focus was when the overlay went up, so it can be given back when the
  // overlay comes down. `mount.ts` already learned this lesson on the create
  // flow: a surface removed with focus inside it leaves `activeElement` on the
  // body, and the keydown listener is on the element — so the whole workspace
  // goes keyboard-dead until the reader clicks something.
  let focusBeforeFirstPass: string | null = null;
  /** The scanner the live lifecycle belongs to, so a swap can end it. */
  let firstPassSource: CandidateSource | null = options.firstPass?.source ?? null;
  /**
   * Which write each applied candidate created.
   *
   * THE ONLY HANDLE THAT IDENTIFIES A WRITE, and it exists nowhere else: the
   * `MutationId` is minted by `store.propose` and seen only here, while the
   * create's own `kind`/`from`/`to` does NOT identify it — `candidates.ts` mints
   * a distinct id per finding precisely so two detectors proposing the same pair
   * stay two questions, and an older failed write can carry the same triple. An
   * earlier revision matched structurally and could have discarded the wrong
   * record. Cleared when the queue closes.
   */
  const appliedWrites = new Map<string, MutationId>();

  /**
   * The issue each unsettled write is about, answered once and then remembered.
   *
   * THE ANSWER GOES STALE, WHICH IS WHY IT IS KEPT RATHER THAN RE-ASKED. A
   * refusal reaches the panel through the ledger, long after the act that
   * caused it, and `editCarrier` reads the LANDED document — so between the two
   * moments a sibling write can land and take the relationship away, leaving
   * that call with nothing but the edge's identity. An identity records which
   * two issues a relationship was between, and for a SYMMETRIC field it does not
   * record which of them declared it: `edgeIdentity` sorts those endpoints, so
   * the declaring end is not in the string at all. Re-asking therefore answered a
   * different issue from the one the edit went out under, for exactly the pairs
   * whose stored `from` sorted after their `to` — and `renderWorkspace` draws a
   * refusal only on the panel it names, so it was drawn where the reader was
   * not. Asked once, there is nothing for a second answer to disagree with.
   *
   * TWO WAYS IN, AND THE EARLIER ONE WINS. `reduceHost` decides the carrier as
   * it emits the edit — before `store.propose` is even called, from the
   * document as it stood when the reader acted — and `perform` records it under
   * the identity the store mints. A write this mount did not emit (a host
   * proposing on the same store) has no such moment, so it is answered the first
   * time this render sees it in the ledger, which is the earliest moment there
   * is. Neither is ever recomputed.
   *
   * ITS LIFETIME IS THE LEDGER'S, exactly. A record that lands is REMOVED from
   * `snapshot.writes` — that is the store's own contract — and a refused or
   * failed one stays until the reader discards it, which is precisely as long as
   * it can still be drawn. So the map is pruned to the ledger's own keys on
   * every render and needs no rule of its own. Clearing it beside
   * `appliedWrites` was the alternative and is wrong in both directions: those
   * clears are the first pass's lifecycle, not the write ledger's, so a queue
   * that closes over a still-refused write would forget where to state it, and
   * a write settling with no queue in sight would never be forgotten at all.
   */
  const writeCarriers = new Map<MutationId, string | null>();

  /**
   * The conflict whose `retry on latest` is the last one the reader pressed.
   *
   * WITHOUT IT, `hydrationError` IS THE WRONG FACT TO DRAW. The store sets that
   * field from ANY failed read — a host's own `refresh()`, a background
   * rehydrate, a failed first load — and attributes it to no mutation. Painted
   * on every conflict card it says "could not read the newest version" on cards
   * whose button nobody pressed, and on all of them at once when two conflicts
   * stand. The card's claim is about a control the reader operated, so the
   * shell records which control that was; the store cannot answer it.
   *
   * CLEARED WHEN THE READ SUCCEEDS, which the ledger cannot express: a resolve
   * that reads fine and is then refused leaves an `invalid` record and no
   * hydration error, and a stale flag here would keep explaining a failure that
   * did not happen.
   */
  let refreshFailedFor: MutationId | null = null;

  const railCount = (): number => current.railCount ?? MOUNT_RAIL_COUNT;
  const theme = (): Theme => resolveTheme(current.theme);

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: Readonly<Record<string, string>> = {},
    children: readonly (Node | string)[] = [],
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  };

  const button = (label: string, command: string, attributes: Readonly<Record<string, string>> = {}): HTMLButtonElement =>
    el('button', { type: 'button', class: 'ig-chrome-button', [COMMAND_ATTRIBUTE]: command, ...attributes }, [label]);

  const landed = (): GraphDocument => {
    const snapshot = store.getSnapshot();
    return { issues: snapshot.issues, edges: snapshot.landed };
  };

  // COALESCED ON A MICROTASK, NOT A FRAME. The store notifies once per state
  // change and a hydrate or a settling write can produce several in one task;
  // one render per task is what a reader sees anyway. A frame would coalesce
  // the same way but never fires while the tab is hidden, which stalls every
  // store notification until the reader returns — and makes the surface
  // impossible to drive headlessly, which is how it is verified.
  const schedule = (): void => {
    if (pending || destroyed) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      render();
    });
  };

  const perform = (effect: HostEffect): void => {
    switch (effect.kind) {
      case 'propose':
        // THE CARRIER IS RECORDED, NOT RE-DERIVED. See `writeCarriers`: the
        // reducer decided it from the document the reader acted on, and the
        // `MutationId` that binds the two exists only here.
        writeCarriers.set(store.propose(effect.proposal).mutationId, effect.carrier);
        return;
      case 'retry': {
        // A conflict retries against the LATEST document. The store owns that
        // resolution: it reserves the edit, re-reads, then re-dispatches as one
        // operation, so there is nothing for the mount to sequence.
        const record = store.getSnapshot().writes.find((each) => each.mutationId === effect.mutationId);
        if (record?.state === 'conflict') {
          // WHOSE READ THIS IS, recorded as the press happens. See
          // `refreshFailedFor`: after the fact there is nothing that ties the
          // store's hydration error to the edit it was read for.
          refreshFailedFor = effect.mutationId;
          void store.retryOnLatest(effect.mutationId);
        } else {
          void store.retry(effect.mutationId);
        }
        return;
      }
      case 'discard':
        store.discardMine(effect.mutationId);
        return;
      case 'dismiss-change':
        store.dismissChange();
        return;
      case 'find-candidates': {
        const option = current.firstPass;
        // UNREACHABLE WITHOUT A BUNDLE, because the command is withheld at the
        // listener — but written as a guard rather than an assertion, because
        // `update()` can take the bundle away between the click and this call.
        if (option === undefined) {
          // CLOSED, NOT FAILED. `failed` is a state this surface DRAWS, in the
          // host's own words — and with no bundle there are no words and no
          // overlay, so a failed phase here is an invisible one that blocks the
          // workspace's keyboard with no control to close it. The DOM guard
          // withholds this command, but `handle.dispatch` is public and reaches
          // the reducer directly, so the shell answers for that route too.
          dispatch({ kind: 'first-pass', command: { kind: 'close' } });
          return;
        }
        // THE OPEN IS REAL, SO THE DRAFT GOES NOW. Only the shell knows a scan
        // will actually run — the reducer cannot tell this open from one about
        // to be refused for want of a source, and clearing on both destroyed a
        // draft for a queue that never appeared. Both routes into the queue, the
        // attribute and `handle.dispatch`, arrive here.
        dispatch({ kind: 'control', name: 'cancel' });
        const { scan } = effect;
        // STARTED FROM A CALLBACK, so a host whose `findCandidates` throws
        // BEFORE returning its promise — reading its own state, building a
        // request — reaches the same failed scan as one whose promise rejects.
        // Called directly, that throw escapes the `.catch` entirely and unwinds
        // through the click handler, leaving the phase `scanning` for good.
        void Promise.resolve()
          .then(() => option.source.findCandidates())
          .then((candidates) => {
            dispatch({ kind: 'first-pass', command: { kind: 'candidates', scan, candidates } });
          })
          .catch(() => {
            // THE REASON IS THE HOST'S AND IS NOT READ. A failed scan is a phase
            // this surface draws in the host's own words; adopting the rejection
            // value would be this package writing a sentence about someone
            // else's tracker.
            dispatch({ kind: 'first-pass', command: { kind: 'scan-failed', scan } });
          });
        return;
      }
      case 'first-pass-apply': {
        // THIS CANDIDATE'S WRITE MAY ALREADY BE OUT THERE. `⌫` on an answer whose
        // create is still `pending` steps the queue back but takes nothing away,
        // because `discardMine` declines a pending record — so answering `Y`
        // again would propose the SAME create a second time, and when the first
        // lands the second turns `invalid` and shows the reader an error about a
        // relationship that now exists. One consent, one write: the handle is
        // kept and nothing new is proposed.
        if (pendingWriteFor(effect.candidateId) !== undefined) return;
        // AND THE RELATIONSHIP ITSELF MAY ALREADY BE THERE. The check above is
        // per candidate, and a candidate is not a relationship: two findings
        // with different ids may propose the same pair (`candidates.ts` keeps
        // them apart on purpose), and a close-and-reopen starts a fresh queue
        // over a document the earlier answer has since written to. Either way
        // the store refuses the second create as a duplicate — correctly — and
        // the reader is left an `invalid` record about a relationship that
        // exists.
        // LANDED OR ON ITS WAY, AND NOTHING ELSE. Asked of the two records that
        // answer it directly: `landed` says the relationship is there, and a
        // `pending-write` state says one is being created right now. An edge
        // whose only write FAILED is precisely NOT there, so a second consent is
        // free to try again.
        // ASKED OF `landed`, NOT INFERRED FROM "no unsettled write". An earlier
        // revision read a landed edge as one with an empty `writes` — which a
        // landed edge carrying any settled overlay, a failed DELETE among them,
        // is not. It then proposed a create for a relationship that was still
        // there, and the store recorded the invalid duplicate.
        const { proposal } = effect;
        if (proposal.op === 'create') {
          const id = edgeIdentity(proposal.kind, proposal.from, proposal.to);
          const snapshot = store.getSnapshot();
          // ASKED OF THE STORE'S OWN RULE, not enumerated here. `nextDocument`
          // is the store's answer to "what would this edit produce if it landed
          // exactly as proposed", and it answers for every operation the store
          // has: a create adds the edge, a delete removes it, and a retype or a
          // flip replaces it with a different identity — which removes the one
          // the reader is being asked about just as surely as a delete does.
          // FOUR EARLIER VERSIONS RECONSTRUCTED THAT ANSWER and each was wrong
          // in a way only the store's internals reveal — a failed write still
          // projects, a landed edge can carry a settled overlay, a pending
          // delete is marked `pending-write` too, and a retype removes an edge
          // without being a delete. Every one of them suppressed a consent that
          // then wrote nothing, showed nothing, and was already decided. So the
          // enumeration is the store's, and a fifth operation is covered the day
          // the store learns about one. See autnmy/issuegraph#142.
          const landedNow = { issues: snapshot.issues, edges: snapshot.landed };
          const isThere = (document___: GraphDocument): boolean =>
            document___.edges.some((edge) => edge.id === id);
          const already = isThere(landedNow);
          let coming = false;
          let going = false;
          for (const write of snapshot.writes) {
            if (write.state !== 'pending') continue;
            const after = isThere(nextDocument(landedNow, write.mutation));
            if (after && !already) coming = true;
            if (!after && already) going = true;
          }
          // THERE, AND NOT ON ITS WAY OUT. A landed edge under a pending edit
          // that would remove it is a relationship the reader may be about to
          // lose, so their consent goes to the store and is adjudicated there —
          // visible either way, which is the difference this guard exists to
          // preserve.
          if ((already && !going) || coming) return;
        }
        const handle = store.propose(effect.proposal);
        appliedWrites.set(effect.candidateId, handle.mutationId);
        // AND THE SAME RECORDING AS THE PLAIN ROUTE, because this is the same
        // kind of event: a write going out with a panel it belongs to. The
        // effect carries one now — it used to be built without going through
        // the reducer's emit funnel at all, so a refused first-pass answer had
        // no panel to be stated on.
        writeCarriers.set(handle.mutationId, effect.carrier);
        return;
      }
      case 'first-pass-withdraw': {
        // THE STORE'S OWN UNDO, AND NOTHING ELSE. `discardMine` is the whole of
        // what a host may take back: it declines a `pending` record itself, and
        // a create that LANDED has no record left at all — so in practice the
        // withdrawable set is `invalid`, `failed` and `conflict`, and the
        // reader's `⌫` on anything else steps the queue back and leaves the
        // write alone.
        // THAT REFUSAL IS NOT RESTATED HERE. An earlier revision guarded on
        // `state !== 'pending'` before calling, which is a second copy of a rule
        // the store already enforces — and a mutation test proved it: removing
        // the guard changed no observable behaviour, because `discardMine` was
        // refusing anyway. What is NOT done here is the thing that would be
        // wrong: proposing a compensating `delete`, which is the second
        // retraction path `firstpass/queue.ts` refuses in terms — "free to
        // disagree with [the store] about what undoing a create means."
        // BY THE WRITE'S OWN IDENTITY. See `appliedWrites`: a structural match on
        // the create's fields cannot tell this answer's write from another
        // candidate proposing the same pair, or from an older failed one.
        const mutationId = appliedWrites.get(effect.candidateId);
        if (mutationId === undefined) return;
        store.discardMine(mutationId);
        // THE HANDLE OUTLIVES A REFUSED DISCARD. `discardMine` leaves a `pending`
        // record exactly where it was, so forgetting the id here would lose the
        // only thing that can find that write again — see the apply arm.
        if (!recordedWriteFor(effect.candidateId)) {
          appliedWrites.delete(effect.candidateId);
        }
        return;
      }
    }
  };

  /**
   * Take a reduction: keep its state, perform its effects, draw.
   *
   * SPLIT FROM `dispatch` SO ONE CALLER CAN LOOK BEFORE IT LEAPS. The keyboard
   * arm has to know whether this reducer owns a command BEFORE it does anything
   * at all, and `schedule()` is not nothing: it redraws, which replaces
   * `surface.innerHTML` and with it the very button the reader is holding. A
   * `<button>`'s `Space` activation lands on KEYUP, so destroying it first takes
   * the host's own control off the keyboard just as surely as cancelling the
   * press did. `reduceHost` is pure, so asking costs nothing and answers safely.
   */
  const applyResult = (result: HostResult): void => {
    state = result.state;
    for (const effect of result.effects) perform(effect);
    schedule();
  };

  const dispatch = (command: HostCommand): void => {
    if (destroyed) return;
    applyResult(reduceHost(state, command, landed()));
  };

  const zone = (name: string): HTMLElement | null => surface.querySelector<HTMLElement>(`.ig-zone[data-zone="${name}"]`);

  const pitch = (): number => theme().metrics['--ig-row-height'] + theme().metrics['--ig-space-tight'];

  const kindChooser = (source: string, target: string | null): HTMLElement => {
    const { words } = current;
    const chooser = el('div', { class: 'ig-chrome-chooser', role: 'group', 'aria-label': words.picker.heading });
    chooser.append(
      el('p', { class: 'ig-chrome-sentence' }, [`#${source} … ${target === null ? words.chooseKind : `#${target}`}`]),
    );
    // THE DIGITS ARE THE KEYBOARD'S OWN, READ OFF `KIND_KEYS`. They used to be
    // computed here as `index + 1` over a `KINDS` alias in `host.ts` — a second
    // construction of `create/keys.ts`'s table: the two agreed only because
    // both walked `EDGE_FIELDS`, and nothing pinned them, so a chooser could
    // have told the reader to press a key the key map resolved to a different
    // kind. That alias is gone with its last caller, so this is now the only
    // numbering in the package.
    const list = el('div', { class: 'ig-chrome-kinds' });
    for (const entry of KIND_KEYS) {
      list.append(
        button(`${entry.key} ${words.picker.kinds[entry.edgeKind]}`, 'kind', {
          'data-ig-value': entry.edgeKind,
          'data-edge': entry.edgeKind,
        }),
      );
    }
    chooser.append(list, button(words.cancel, 'cancel', { class: 'ig-chrome-button ig-chrome-quiet' }));
    return chooser;
  };

  const targetSearch = (document: GraphDocument, source: string, kind: EdgeKind): HTMLElement => {
    const { words } = current;
    const search = el('div', { class: 'ig-chrome-search' });
    search.append(el('p', { class: 'ig-chrome-sentence' }, [`#${source} ${words.picker.kinds[kind]} …`]));
    const input = el('input', {
      type: 'search',
      class: 'ig-chrome-input',
      placeholder: words.targetPlaceholder,
      'aria-label': words.targetLabel,
      [COMMAND_ATTRIBUTE]: 'target-query',
    });
    input.value = state.targetQuery;
    search.append(input);
    const matches = targetMatches(document.issues, state.targetQuery, source);
    if (matches.length > 0) {
      const list = el('ul', { class: 'ig-chrome-matches' });
      for (const match of matches) {
        list.append(
          el('li', {}, [
            button(`#${match.ref} ${match.title}`, 'target', {
              [TARGET_ATTRIBUTE]: match.ref,
              class: 'ig-chrome-button ig-chrome-match',
            }),
          ]),
        );
      }
      search.append(list);
    }
    search.append(button(words.cancel, 'cancel', { class: 'ig-chrome-button ig-chrome-quiet' }));
    return search;
  };

  /** The chrome the inspector zone gets beside the package's own panel. */
  const inspectorChrome = (document: GraphDocument): HTMLElement => {
    const { words } = current;
    const panel = el('div', { class: 'ig-chrome', 'data-chrome': 'inspector' });
    const edgeId = selectedEdgeId(state.selection);
    const { draft } = state;

    // WHAT IS LEFT HERE IS WHAT NEEDS A DOM. `+ add`, the numbered kind list
    // and §17b's flip are `renderWorkspace`'s now — the flip because the
    // statement it reverses is the selected relationship's ROW, and a picker
    // composed into this same panel drew a second statement and a second flip
    // one element from the first. What is left below draws one control, not two.
    // The older half of this note stands: `+ add` and the numbered kind list
    // are `renderWorkspace`'s now — they are markup, and a host rendering the
    // package without mounting had a panel it could only read. The retype
    // picker and the target search stay: the first is another package's
    // renderer composed as markup, and the second is a live input over
    // `state.targetQuery` with a caret to preserve, which a markup-only
    // renderer cannot be.
    //
    // THE CHAIN'S EXCLUSIVITY IS NOW SPLIT ACROSS TWO LAYERS, and that is why
    // `renderWorkspace` is told about the draft and the drop: it re-states the
    // same guards for the steps it draws, rather than the two surfaces each
    // drawing whatever they can see.
    if (edgeId !== null) {
      const picker = el('div', { class: 'ig-chrome-picker' });
      // Package-rendered markup, escaped by the package.
      picker.innerHTML = renderPicker(document, edgeId, { words: words.picker, theme: theme() }).markup;
      panel.append(picker, button(words.deleteRelationship, 'delete', { class: 'ig-chrome-button ig-chrome-danger' }));
    } else if (draft.source !== null && draft.kind !== null && draft.target === null) {
      panel.append(targetSearch(document, draft.source, draft.kind));
    }

    if (words.keys !== undefined) panel.append(el('p', { class: 'ig-chrome-keys' }, [words.keys]));
    return panel;
  };

  const floatingChooser = (): HTMLElement | null => {
    const { draft, drop } = state;
    if (drop === null || draft.source === null || draft.kind !== null) return null;
    const bounds = surface.getBoundingClientRect();
    const placed = pickerPlacement(drop, CHOOSER_SIZE, {
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
    const chooser = kindChooser(draft.source, draft.target);
    chooser.classList.add('ig-chrome-floating');
    chooser.style.left = `${String(placed.x)}px`;
    chooser.style.top = `${String(placed.y)}px`;
    return chooser;
  };

  /**
   * The first-pass surface, when one is up.
   *
   * A TAKEOVER RATHER THAN A FOURTH ZONE: `ZONES` is a closed union the
   * workspace's grid is laid out from, and §17e's queue occupies the surface
   * rather than a column. It is built and appended the way the floating chooser
   * is — after `surface.innerHTML`, inside the workspace root, which is the box
   * `chrome.ts` positions against and the element a host's theme is scoped to.
   *
   * ## It is a modal, and says so
   *
   * The rail and the canvas are still in the DOM underneath, still focusable and
   * still in the accessibility tree. Without `aria-modal` and `inert` on the
   * zones, one Tab lands the reader on a row they cannot see, where every key is
   * inert because the queue owns the keyboard — and a screen reader reads the
   * whole covered workspace as though nothing were over it.
   *
   * ## `aria-live`, because focus deliberately does not move
   *
   * Answering swaps the question in place while focus stays on this wrapper, so
   * without a live region a reader answering sixty questions at speed hears
   * nothing after the first. Focus stays here rather than moving onto a control
   * because the first control is `apply` — the one irreversible answer — and a
   * `Space` on a focus move nobody made is precisely the un-consented apply
   * §17e forbids.
   */
  const firstPassOverlay = (): HTMLElement | null => {
    const option = current.firstPass;
    const { phase } = state.firstPass;
    if (option === undefined || phase.kind === 'closed') return null;
    const wrapper = el('div', {
      class: 'ig-firstpass-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      // THE DIALOG IS NAMED, not just its child. `renderFirstPass` puts the
      // host's label on the `<section>` it draws, which names that landmark and
      // says nothing about its dialog ancestor — so assistive technology met an
      // unnamed modal. The same word, on the element that is the modal.
      'aria-label': option.words.label,
      'aria-live': 'polite',
      'data-ig-firstpass': phase.kind,
      tabindex: '-1',
    });
    if (phase.kind === 'open') {
      const panel = el('div', { class: 'ig-firstpass-panel' });
      // Package-rendered markup, escaped by the package — the file's standing
      // idiom, the same one the inspector's picker uses.
      panel.innerHTML = renderFirstPass(phase.queue, { words: option.words, theme: theme() }).markup;
      wrapper.append(panel);
    } else {
      // THE HOST'S SENTENCE, PLACED. A scan that is out and a scan that failed
      // are different facts and get different words; neither is worded here.
      wrapper.append(
        el('p', { class: 'ig-firstpass-note' }, [
          phase.kind === 'scanning' ? option.scanning : option.scanFailed,
        ]),
      );
    }
    wrapper.append(
      button(option.exit, 'first-pass-close', { class: 'ig-chrome-button ig-chrome-quiet' }),
    );
    return wrapper;
  };

  /**
   * This candidate's write, if one is still IN FLIGHT.
   *
   * `pending` and nothing else, because the question it answers is "is this
   * create already on its way?" — and a record that has FAILED is not on its way
   * and never landed, so the relationship it stood for does not exist. Reading
   * "a record exists" as "a write is out there" suppressed the reader's second
   * consent after a failure: nothing was proposed, and the queue nevertheless
   * marked the candidate decided, so a relationship they believed they had
   * recorded was silently absent and never asked about again.
   */
  const pendingWriteFor = (candidateId: string): MutationId | undefined => {
    const mutationId = appliedWrites.get(candidateId);
    if (mutationId === undefined) return undefined;
    return store
      .getSnapshot()
      .writes.some((write) => write.mutationId === mutationId && write.state === 'pending')
      ? mutationId
      : undefined;
  };

  /** Whether the store still holds a record for this candidate's write, in any state. */
  const recordedWriteFor = (candidateId: string): boolean => {
    const mutationId = appliedWrites.get(candidateId);
    return (
      mutationId !== undefined &&
      store.getSnapshot().writes.some((write) => write.mutationId === mutationId)
    );
  };

  /**
   * Which control inside the overlay owns focus, as a SELECTOR a redraw can find
   * again — or `''` for the wrapper itself, or `null` when focus is elsewhere.
   *
   * A selector rather than the node, because the node does not survive the
   * redraw: `surface.innerHTML` is reassigned and the overlay is rebuilt, so
   * what has to be carried across is a way to name the control, not a reference
   * to the one that was destroyed.
   */
  const overlayFocusToken = (): string | null => {
    const active = doc.activeElement;
    if (!isElement(active)) return null;
    const overlay = active.closest('.ig-firstpass-overlay');
    if (overlay === null || !surface.contains(overlay)) return null;
    const answer = active.getAttribute(ANSWER_ATTRIBUTE);
    if (answer !== null) return `[${ANSWER_ATTRIBUTE}="${answer}"]`;
    const command = active.getAttribute(COMMAND_ATTRIBUTE);
    if (command !== null) return `[${COMMAND_ATTRIBUTE}="${command}"]`;
    return '';
  };

  /**
   * The command control that owns focus, as facts a redraw can match again.
   *
   * `overlayFocusToken` above answers the same question for the first-pass
   * overlay and only for it, so every command control OUTSIDE that overlay had
   * no restore path at all: the arms below cover the overlay, an `input`'s
   * caret, the target search on the render that opens it, and a pending rail
   * jump — and then fall through to restoring by RAIL ROW, which needs a
   * `[data-ig-key]` ancestor. An inspector button has none, so focus fell to
   * the body. The keydown listener is on the mount's element, so that killed
   * the whole keyboard loop until the reader clicked something else.
   *
   * FACTS, NOT A SELECTOR STRING. `overlayFocusToken` interpolates its value
   * into `[attr="value"]`, which is safe only because `data-ig-answer` and the
   * overlay's own commands come from closed sets. A general token carries
   * {@link TARGET_ATTRIBUTE} — edge identities and issue keys straight out of
   * a host's tracker — and a `"` in one would break the selector or match the
   * wrong control. Comparing attribute values during a walk removes the class
   * instead of escaping it.
   *
   * THE ZONE IS PART OF THE IDENTITY. One command name is published by many
   * controls — every relationship row carries `select-edge` — and an issue is
   * commonly drawn in the rail and again on the canvas, so a token without its
   * zone would restore focus to a namesake in a zone the reader was not in.
   */
  const commandFocusToken = (): CommandFocus | null => {
    const active = doc.activeElement;
    if (!isElement(active) || !surface.contains(active)) return null;
    // ALL THREE CHANNELS, because the defect is not the command channel's. The
    // audit header's toggle publishes on `data-ig-audit-filter` alone and the
    // first pass's answers on `data-ig-answer` — `controlAnswer` resolves each
    // in its own branch — so a token reading only `data-ig-command` left the audit
    // toggle dropping focus to the body exactly as before. #149 says "any
    // command control", and this is the list that makes that true.
    for (const channel of CONTROL_ATTRIBUTES) {
      const control = active.getAttribute(channel);
      if (control === null) continue;
      const partial = {
        channel,
        zone: active.closest('.ig-zone')?.getAttribute('data-zone') ?? null,
        control,
        target: active.getAttribute(TARGET_ATTRIBUTE),
        // THE SAME TWO SPELLINGS `controlAnswer` READS, and in its order: the picker
        // publishes its kind as `data-ig-kind`, the mount's own chrome as
        // `data-ig-value`.
        value: active.getAttribute('data-ig-value') ?? active.getAttribute('data-ig-kind'),
      };
      // `findIndex` RATHER THAN `indexOf`, because `active` is narrowed to
      // `Element` and the siblings are `HTMLElement`. Identity comparison is
      // the same question either way, and the alternative — widening the list
      // or asserting the narrower type — would be a cast this repository bans.
      const ordinal = siblingsOf(partial).findIndex((node) => node === active);
      // A CONTROL THAT DOES NOT FIND ITSELF is one this scope cannot name, so
      // there is no token to carry. `indexOf` answering -1 would otherwise
      // become an ordinal that matches nothing on the way back.
      return ordinal < 0 ? null : { ...partial, ordinal };
    }
    return null;
  };

  /**
   * Every control this token could name, in document order.
   *
   * THE ATTRIBUTE NAME IS A CONSTANT AND THE VALUES ARE COMPARED, so nothing a
   * host's tracker can spell reaches a selector. See the token above.
   *
   * Shared by the token and the restore so the ordinal means the same thing on
   * both sides: a list computed two ways is a list that can disagree with
   * itself, and the ordinal would then point at a different control than the
   * one it was counted against.
   */
  const siblingsOf = (token: Omit<CommandFocus, 'ordinal'>): readonly HTMLElement[] => {
    const scope = token.zone === null ? surface : (zone(token.zone) ?? surface);
    return [...scope.querySelectorAll<HTMLElement>(`[${token.channel}]`)].filter((node) => {
      const control = node.getAttribute(token.channel);
      // BY IDENTITY, so a toggle that redraws itself with the other command is
      // still the control the reader was on. See {@link TOGGLE_IDENTITY}.
      if (control === null || controlIdentity(control) !== controlIdentity(token.control)) return false;
      if (node.getAttribute(TARGET_ATTRIBUTE) !== token.target) return false;
      const value = node.getAttribute('data-ig-value') ?? node.getAttribute('data-ig-kind');
      if (value !== token.value) return false;
      // A ZONELESS TOKEN MUST NOT MATCH A ZONED CONTROL. The floating chooser
      // and the first-pass overlay are appended OUTSIDE the four zones, so
      // their tokens carry `zone: null` and scope to the whole surface — and
      // without this the chooser's `cancel` restored onto the inspector's.
      // The two directions are asymmetric on purpose: a zoned token is already
      // confined by `scope`.
      return !(token.zone === null && node.closest('.ig-zone') !== null);
    });
  };

  /** Give focus back to the control a {@link CommandFocus} names. `false` when it is gone. */
  const refocusCommand = (token: CommandFocus): boolean => {
    const siblings = siblingsOf(token);
    // THE SAME ONE, THEN THE FIRST. A list that shrank under the reader — a
    // match that stopped matching, a capsule that collapsed — has no nth
    // member, and landing on the first sibling keeps the keyboard alive where
    // returning `false` would drop to the rail.
    const again = siblings[token.ordinal] ?? siblings[0];
    if (again === undefined) return false;
    again.focus({ preventScroll: true });
    return true;
  };

  /** Focus the element carrying `key`, inside one zone when named, without scrolling the page. */
  const focusIn = (zoneName: string | null, key: string): void => {
    const scope = zoneName === null ? surface : (zone(zoneName) ?? surface);
    const candidates = withKey(scope, key);
    // THE FOCUSABLE ONE. The graph draws an issue twice — its SVG node and the
    // rail row positioned over it — and only the element carrying `tabindex`
    // takes focus; the first match by document order is the node, on which
    // `focus()` is a no-op and the reader's focus falls off the page.
    const target = candidates.find((node) => node.hasAttribute('tabindex')) ?? candidates[0];
    if (target === undefined) return;
    // THE ROVING TAB STOP MOVES WITH FOCUS, as the viewer's own mount moves it.
    // The zone renders one element at tabindex 0 and the rest at -1; moving
    // focus without moving the stop leaves Tab returning to the old row when
    // the reader leaves the zone and comes back.
    if (target.hasAttribute('tabindex')) {
      const owner = target.closest<HTMLElement>('.ig-zone') ?? scope;
      for (const stop of owner.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}][tabindex="0"]`)) {
        if (stop !== target) stop.setAttribute('tabindex', '-1');
      }
      target.setAttribute('tabindex', '0');
    }
    target.focus({ preventScroll: true });
  };

  /**
   * The scene a zone is showing, for the viewer's navigation reducer.
   *
   * `renderWorkspace` composes its scenes and publishes none of them, so the
   * scene is rendered again here from the SAME documents the workspace drew —
   * the rail's window and the ladder's canvas — through the same pure
   * `renderViewer`. That is a second render, not a second implementation: the
   * traversal order, the lateral neighbours and the Enter semantics are the
   * viewer's own, read off its scene rather than guessed from the markup.
   */
  const sceneFor = (zoneName: string): Scene | null => {
    if (drawn === null) return null;
    if (zoneName === 'rail') return renderViewer(drawn.rail.document, { projection: 'linear', theme: theme() }).scene;
    if (zoneName !== 'canvas') return null;
    if (current.canvas === 'tree')
      return renderViewer(withoutChrome(drawn.viewer), { projection: 'tree', theme: theme(), chrome: false }).scene;
    const ladder = scaleLadder(drawn.viewer, state.scale);
    return ladder.tier === 'direct'
      ? renderViewer(ladder.canvas, { projection: 'graph', theme: theme(), chrome: false }).scene
      : null;
  };

  /** The row or node that owns keyboard focus, if focus is on one at all. */
  const focusedKey = (): string | null => {
    const active = doc.activeElement;
    const keyed = isElement(active) ? active.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`) : null;
    return keyed !== null && surface.contains(keyed) ? keyed.getAttribute(KEY_ATTRIBUTE) : null;
  };

  /**
   * The subject `+ add` publishes, when that control itself owns focus.
   *
   * THE SECOND SOURCE FOR `KeyboardContext.focused`, and it exists because the
   * first one cannot answer here: `focusedKey` reads the rail's roving tab stop,
   * and a focused button has no keyed ancestor — every command control this
   * package draws sits in chrome beside the keyed rows rather than inside one.
   * So `R` on `+ add` reached a `relate` arm whose subject was `null`, which
   * answers `none` ("nothing focused is nothing to relate FROM"). `#173`.
   *
   * IT READS THE CONTROL'S OWN ATTRIBUTE, NOT THE SELECTION, for the reason
   * `reduceHost`'s `add` arm already reads it: `inspectorView` canonicalizes a
   * selection naming a together unit's member onto the slot's LEAD, and the
   * panel is worded from that, so the control publishes the canonical subject
   * and the selection is only a fallback for a control that names none. Taking
   * the selection here would begin the keyboard's draft from a different issue
   * than the pointer's, on one screen, from one control.
   *
   * NARROWED TO THE `add` COMMAND, and that is a correctness bound rather than
   * tidiness: {@link TARGET_ATTRIBUTE} is carried by the row remove control
   * (an edge id), by a recovery card (a mutation id) and by a hold's subject
   * button. Reading it off whichever control happens to hold focus would hand
   * `relate` an edge id as an issue ref.
   */
  const focusedAddSubject = (): string | null => {
    const active = doc.activeElement;
    if (!isElement(active) || !surface.contains(active)) return null;
    if (active.getAttribute(COMMAND_ATTRIBUTE) !== 'add') return null;
    return active.getAttribute(TARGET_ATTRIBUTE);
  };

  const render = (): void => {
    if (destroyed) return;
    const snapshot = store.getSnapshot();
    const document_ = landed();
    // WHAT THE STORE IS NOT SHOWING, computed before the reconcile rather than
    // beside the edges below, because the reconcile is the first reader of it:
    // an unsettled retype or flip hides the edge it replaces, and the landed
    // document the reconcile is otherwise handed still carries it. Both halves
    // of "the reader can no longer see this" reach `reconcileHost` together.
    const shown = new Set(snapshot.projected.map((edge) => edge.id));
    const hidden = new Set(snapshot.landed.map((edge) => edge.id).filter((id) => !shown.has(id)));
    // A landed write can retire what the state names, and an unsettled one can
    // hide it; agree with what is on show first.
    state = reconcileHost(state, document_, hidden);
    const projected = current.project(snapshot);
    // WHAT TO DRAW IS THE STORE'S PROJECTION, by the store's own contract:
    // `projected` is "landed plus every unsettled edit, each carrying its
    // states". A host projects the ORDER from the landed document — the order
    // must not move for an edit that did not land — so its viewer document
    // carries landed edges, and an edit in flight would be invisible on the
    // very surface that just proposed it. The unsettled edges are added here,
    // and only those: an edge the host's projection deliberately left out stays
    // out, because a landed edge carries no state and is never added.
    // AND A LANDED EDGE THE STORE HIDES IS DROPPED, for the same reason. A
    // pending retype or flip gives the edge a new identity and the store's
    // projection hides the old one until the write settles; the host's
    // document still carries it, so without this the old line and the new
    // dashed one were drawn together for the life of the write.
    const kept = projected.viewer.edges.filter((edge) => !hidden.has(edgeIdentity(edge.field, edge.from, edge.to)));
    const drawn_ = new Set(kept.map((edge) => edgeIdentity(edge.field, edge.from, edge.to)));
    const unsettled = snapshot.projected
      .filter((edge) => edge.states.length > 0 && !drawn_.has(edge.id))
      .map((edge) => ({ field: edge.kind, from: edge.from, to: edge.to }));
    const viewer: ViewerDocument =
      unsettled.length === 0 && kept.length === projected.viewer.edges.length
        ? projected.viewer
        : { ...projected.viewer, edges: [...kept, ...unsettled] };
    const { audit } = projected;
    const resolved = theme();
    // THE WRITE STATES ONLY. The workspace holds the one selection, and every
    // canvas draws its halo from that; a `selected` the host put on the store
    // through `store.select()` would draw a second halo the inspector does not
    // reflect, so it is stripped before the projection reaches a canvas.
    const writeStates = snapshot.projected.map((edge) =>
      edge.states.includes('selected') ? { ...edge, states: edge.states.filter((state) => state !== 'selected') } : edge,
    );
    // THE WRITE LEDGER, TURNED INTO WHAT THE PANEL DRAWS — in ONE pass, in the
    // ledger's own order.
    //
    // IT WAS TWO PASSES AND A CONCATENATION: one walk over the projection for
    // the refusals it had an edge for, then one over the ledger for the ones it
    // did not, appended after. Both halves were right and the JOIN was not.
    // The renderer collapses repeated edges last-wins, so the array's order is
    // the chronology — and appending every stranded record after every
    // projected one is not the order the reader made them in. An older
    // `unknown-edge` naming an edge a later refused create then projects
    // reported the older reason. There is nothing to get wrong now: the ledger
    // is walked once, and its order is the order.
    //
    // WHICH EDGE A REFUSAL MARKS IS THE PROJECTION'S OWN ANSWER.
    // `ProjectedEdge.writes` is its record of which mutations it is speaking
    // for, and `validity.ts` has already decided which edge each one marks — a
    // create marks the edge it would have made, a retype the one it would have
    // become. Rebuilding that here would be a second answer, free to disagree
    // with the line the canvas draws the ghost on; asked of the projection, the
    // record that produced one edge cannot also be counted against another,
    // which is the double-draw this join used to be able to produce.
    const markedBy = new Map<MutationId, EdgeId>(
      snapshot.projected.flatMap((edge) => edge.writes.map((write) => [write, edge.id] as const)),
    );
    // WHETHER THE MARKED EDGE IS REAL. Three codes refuse an edit ABOUT a
    // landed relationship — `duplicate-edge`, `unchanged-kind`,
    // `symmetric-edge` — and the panel keeps the row for those rather than
    // replacing it with a capsule; see `WorkspaceRefusal.phantom`.
    //
    // ASKED OF `landed`, NEVER OF THE CODE. A list of codes here would be a
    // second copy of `validity.ts`'s decision about which edge each refusal
    // marks, and it would already be wrong: `cardinality` reads like a fourth
    // member of that set and marks a PHANTOM through both of its routes. This
    // is the store's own answer to "what does the document actually carry".
    const landedIds = new Set(snapshot.landed.map((edge) => edge.id));
    const landedNow: GraphDocument = { issues: snapshot.issues, edges: snapshot.landed };
    // THE CARRIER MAP, BROUGHT LEVEL WITH THE LEDGER. See `writeCarriers` for
    // why the answer is kept rather than re-asked, and why the ledger's own
    // membership is the whole of its lifetime.
    const ledger = new Set(snapshot.writes.map((record) => record.mutationId));
    // CLEARED WHEN THE RECORD GOES, AND NOT BEFORE.
    //
    // Clearing it on `hydrationError === undefined` as well was the obvious
    // rule and it was WRONG BY ONE RENDER: `retryOnLatest` reserves its record
    // synchronously and publishes, so the very next render happens BEFORE the
    // read has had a chance to fail — the error is still undefined, the flag
    // was dropped, and when the failure did arrive there was nothing left to
    // attribute it to. The card then stayed silent on exactly the failure this
    // field exists to explain. Measured: the pin below went red.
    //
    // So the flag's lifetime is the RECORD's, and whether there is anything to
    // draw is asked of the snapshot at draw time instead.
    if (refreshFailedFor !== null && !ledger.has(refreshFailedFor)) {
      refreshFailedFor = null;
    }
    for (const mutationId of writeCarriers.keys()) {
      if (!ledger.has(mutationId)) writeCarriers.delete(mutationId);
    }
    for (const record of snapshot.writes) {
      // FIRST SIGHT IS THE EARLIEST MOMENT THERE IS for a write this mount did
      // not emit. Its own edits are already recorded by `perform`, from the
      // document the reader acted on, so this fills in only what a host
      // proposed on the same store — and never a second time.
      if (!writeCarriers.has(record.mutationId)) {
        writeCarriers.set(record.mutationId, editCarrier(landedNow, record.mutation));
      }
    }
    const refusals: readonly WorkspaceRefusal[] = snapshot.writes.flatMap((record) => {
      if (record.state !== 'invalid') return [];
      // WHOSE PANEL STATES IT, READ BACK RATHER THAN WORKED OUT. The panel used
      // to derive this from the refused edge's endpoints, against a subject it
      // had derived by an unrelated rule; then `editCarrier` was called here
      // instead, which is one rule but still asked at the wrong TIME — a
      // sibling write can remove the relationship between the act and the
      // refusal, and what is left says which end declared it only for the
      // directed fields — `edgeIdentity` sorts the symmetric ones. The answer
      // was taken when the edit was made; this only looks it up. The two loops
      // above run over this same `snapshot.writes`, so the key is always
      // present, and `null` means the document held neither end — there is no
      // panel a reader could be standing on to read it.
      const carrier = writeCarriers.get(record.mutationId) ?? null;
      if (carrier === null) return [];
      // THE PROJECTION'S EDGE, AND THE EDIT'S OWN AS THE FALLBACK. A refusal
      // the projection has nothing to hang on is the whole `unknown-edge`
      // class — a retype, flip or delete of an edge the document no longer
      // carries produces `{ hidden: [], drawn: [], marked: [] }` — and the
      // mutation names the edge it was about, so that id is what the capsule
      // is keyed on.
      const edgeId =
        markedBy.get(record.mutationId) ??
        (record.mutation.op === 'create'
          ? edgeIdentity(record.mutation.kind, record.mutation.from, record.mutation.to)
          : record.mutation.edgeId);
      return [{ edgeId, code: record.reason.code, carrier, phantom: !landedIds.has(edgeId) }];
    });

    // §17b's RECOVERY CARDS, BUILT FROM THE SAME LEDGER PASS AS THE REFUSALS.
    // One walk of `snapshot.writes` keeps the chronology the panel relies on,
    // and reuses the `edgeId` and `carrier` answers already worked out above
    // rather than asking either question a second time.
    //
    // THE CARRIER IS CARRIED EVEN WHEN IT IS `null`, and that is the one place
    // this deliberately parts company with the refusal derivation above, which
    // drops those. A refusal dropped costs the reader a sentence. A RECOVERY
    // dropped costs them the only retry and discard they have, on a write that
    // is still theirs to resolve — so it travels, and the panel draws it in the
    // unplaced region instead of nowhere.
    // ANNOTATED RATHER THAN INFERRED. `flatMap` takes its element type from the
    // first arm it sees, which here is the `failed` one — so an unannotated
    // callback types the whole list as failures and rejects the conflict arm
    // for want of a `reason`. The repair this repository bans is a cast; the
    // repair it wants is saying what the function returns.
    const recoveries: readonly WorkspaceRecovery[] = snapshot.writes.flatMap(
      (record): readonly WorkspaceRecovery[] => {
      if (record.state !== 'failed' && record.state !== 'conflict') return [];
      const carrier = writeCarriers.get(record.mutationId) ?? null;
      const edgeId =
        markedBy.get(record.mutationId) ??
        (record.mutation.op === 'create'
          ? edgeIdentity(record.mutation.kind, record.mutation.from, record.mutation.to)
          : record.mutation.edgeId);
      if (record.state === 'failed') {
        return [{ kind: 'failed' as const, mutationId: record.mutationId, edgeId, carrier, reason: record.reason }];
      }
      return [
        {
          kind: 'conflict' as const,
          mutationId: record.mutationId,
          edgeId,
          carrier,
          // AGAINST `landedNow`, WHICH CANNOT HOLD THE EDIT — that is the
          // point. `conflictDiff` reconstructs the reader's own side from the
          // mutation, so the card is guaranteed to name the relationship it is
          // about rather than depending on a document that by contract omits it.
          diff: conflictDiff(landedNow, record.upstream, record.mutation),
          // THE READ'S OWN FAILURE, WHICH IS NOT THE RECORD'S. A `retry on
          // latest` whose refresh fails restores this record verbatim and
          // dispatches nothing; the reason lands on the snapshot instead. Read
          // from there, the card can say why the button appeared to do nothing.
          // ONLY ON THE CARD WHOSE READ FAILED. Both halves are required: a
          // hydration error with no press behind it belongs to no card, and a
          // press whose read succeeded leaves no error to draw.
          refreshError:
            refreshFailedFor === record.mutationId ? (snapshot.hydrationError ?? null) : null,
        },
      ];
      },
    );
    // ITS LIFETIME IS THE CONFLICT'S, NOT THE LEDGER'S, and the distinction is
    // load-bearing: `retryOnLatest` reserves its record as `pending`
    // synchronously, and a resolve whose re-check refuses leaves it `invalid`.
    // In both the record is still in the ledger and its held document is gone,
    // so "still in the ledger" would leave a difference region open over
    // nothing. Asked of the state, it closes on every route out of `conflict`.
    if (
      state.diffOpen !== null &&
      !snapshot.writes.some(
        (record) => record.mutationId === state.diffOpen && record.state === 'conflict',
      )
    ) {
      state = { ...state, diffOpen: null };
    }

    const result = renderWorkspace(viewer, {
      words: current.words,
      // §17c's CAUSE AND EFFECT, STRAIGHT OFF THE SNAPSHOT. The store is the
      // single source of truth for both — `lastChange` persists until the next
      // edit or an explicit dismissal, and `dismissChange()` is already the
      // only thing besides the next edit that clears it — so nothing about
      // "has this been dismissed" is held out here. A second copy of that is
      // exactly the drift the command grammar exists to avoid.
      //
      // `orderStatus` is the SAME value stamped on `surface` below. They cannot
      // disagree because they are one read of one snapshot, and each is for a
      // different reader: the attribute on `surface` is the host's, on the
      // element the host holds; the option is the stylesheet's, on the root the
      // renderer owns, so an unmounted rendering greys the held rail too.
      change: snapshot.lastChange ?? null,
      orderStatus: snapshot.order.status,
      selection: state.selection,
      scale: state.scale,
      rail: { start: state.railStart, count: railCount() },
      audit,
      auditFiltered: state.auditFiltered,
      theme: resolved,
      themeSelector: current.themeSelector,
      // THE WRITE STATES ONLY. The workspace holds the one selection, and the
      // ladder draws its halo from that; a `selected` the host put on the store
      // through `store.select()` would draw a second halo the inspector does
      // not reflect, so it is stripped before the projection reaches the canvas.
      projected: writeStates,
      // THE SAME TWO VALUES THE CHROME BELOW READS. The create path's steps are
      // split across the two surfaces now, so both have to be told which step is
      // live — and a drop in flight suppresses the panel's list for the reason
      // `WorkspaceOptions.drop` records: the floating chooser is already open
      // at the pointer, and two choosers writing to one draft is what the
      // shell's own `if (state.drop === null)` was preventing while it drew
      // both of them.
      draft: state.draft,
      drop: state.drop,
      refusals,
      recoveries,
      diffOpen: state.diffOpen,
    });
    // THE FIRST PASS'S OWN SHEET, IMPORTED — not `renderFirstPass(...).styles`,
    // which carries a second copy of the theme block written just above it. The
    // picker is installed the same way and for the same reason.
    const sheet = [result.styles, pickerStylesheet, firstPassStylesheet, mountStylesheet].join('\n');
    if (styles.textContent !== sheet) styles.textContent = sheet;

    // What the reader was doing survives the redraw: the rail's scroll offset,
    // and the caret in whichever search box they were typing into.
    const railBefore = zone('rail');
    const scrollTop = railBefore?.scrollTop ?? 0;
    const active = doc.activeElement;
    const activeInput = isElement(active) && isInput(active) && surface.contains(active) ? active : null;
    const activeCommand = activeInput?.getAttribute(COMMAND_ATTRIBUTE) ?? null;
    // THE CARET AS IT WAS, not the end of the value: a reader editing in the
    // middle of a query keeps typing there, and every keystroke redraws.
    const caret =
      activeInput !== null
        ? { start: activeInput.selectionStart, end: activeInput.selectionEnd, direction: activeInput.selectionDirection }
        : null;
    const focused = focusedKey();
    const overlayToken = overlayFocusToken();
    // CAPTURED BEFORE THE REDRAW, like every other fact here: the node itself
    // does not survive `surface.innerHTML`, so what crosses is a way to name
    // the control rather than a reference to the one about to be destroyed.
    const commandToken = commandFocusToken();
    // WAS THE FOCUS OURS TO RESTORE? A reader whose focus is on the host's own
    // chrome must not have it dragged into the workspace by a redraw the
    // workspace happened to do — the search arm below already records paying
    // for that once. The last-resort arm needs this because it fires on
    // "nothing inside the surface holds focus", which is equally true of a
    // redraw that destroyed the focused control and of a reader who simply is
    // not here.
    const heldFocus = isElement(active) && surface.contains(active);
    // The ZONE too: an issue is commonly drawn in the rail and on the canvas,
    // and restoring "the first element with this key" would move focus from
    // a canvas node into the rail on every redraw.
    const focusedZone = isElement(active) ? (active.closest('.ig-zone')?.getAttribute('data-zone') ?? null) : null;
    drawn = { viewer, rail: result.view.rail };

    // THE LIVE REGION HAS TO SURVIVE THE REDRAW, or it announces nothing.
    //
    // `summarySpec` mounts §17c's `role="status"` region ALWAYS and leaves it
    // EMPTY until there is something to say, precisely because a status node
    // that is created already carrying its text is not reliably announced —
    // the region has to exist first and then have its contents change. This
    // function replaces the whole subtree on every redraw, so rendering that
    // region into the markup and stopping there would destroy it and insert a
    // new, already-populated one every time: the affordance present, correct
    // in the markup, and inert. Worse than absent, because it looks done.
    //
    // So the ELEMENT is carried across: re-attached still holding the previous
    // summary, and only then given the new one. The insertion says nothing and
    // the mutation is what announces, which is the sequence the region was
    // designed around.
    const liveBefore = surface.querySelector<HTMLElement>(LIVE_REGION);

    // Package-rendered markup, escaped by the package.
    surface.innerHTML = result.markup;

    const liveAfter = surface.querySelector<HTMLElement>(LIVE_REGION);
    if (liveBefore !== null && liveAfter !== null) {
      const next = liveAfter.innerHTML;
      liveAfter.replaceWith(liveBefore);
      // GUARDED, so a redraw that did not touch the summary is not a change to
      // announce. Every keystroke in the ladder's search box redraws this
      // surface, and re-assigning identical content would re-announce the last
      // edit's result on each one.
      if (liveBefore.innerHTML !== next) liveBefore.innerHTML = next;
    }
    // THE ORDER'S STATUS, PUBLISHED AS DATA. A write in flight holds the order
    // — it does not move until the edit lands — and a host that wants to say
    // so has nowhere to read it once the snapshot is consumed here. The
    // attribute is the store's own vocabulary, verbatim, so a host styles or
    // reads it without this package inventing a sentence.
    surface.setAttribute('data-order', snapshot.order.status);

    if (current.canvas === 'tree') {
      const canvas = zone('canvas');
      if (canvas !== null) {
        // THE SAME STATES THE LADDER DRAWS, on the tree's badges. The tree
        // draws a relationship as a badge rather than a line, and the overlays
        // module decorates lines only — a halo, a ghost, a dash — so there is
        // nothing for it to attach here. What the badge CAN carry is the state
        // as data, the same `data-ig-state` the ladder's line carries, so a
        // pending edge is not drawn as a settled one and a host styles or reads
        // it the same way in both modes. The merge is the ladder's own.
        // §17f'S ROW SURVIVES THIS ASSIGNMENT, AND ITS CAPTION DOES NOT.
        // `innerHTML` replaces every child, and `renderWorkspace` puts the
        // toolbar in this zone as its FIRST child — so the row, the pill
        // included, was silently deleted the moment a reader switched to the
        // tree. The pill is a property of the SURFACE, and a mounted surface is
        // exactly where a host is told to supply it, so losing it here took the
        // control away in the one state it is documented to exist in.
        //
        // THE CAPTION IS DIFFERENT, and is dropped on purpose rather than by
        // accident. It states what the LADDER's canvas draws — one connected
        // component out of the whole backlog — and this branch does not draw the
        // ladder's canvas: it draws `viewer`, the whole document, as a tree. So
        // "6 out of 312 drawn here" is simply false over a tree of 312, on the
        // same rule that keeps the caption off the refusing tiers.
        const toolbar = canvas.querySelector('.ig-canvas-toolbar');
        toolbar?.querySelector('.ig-canvas-caption')?.remove();
        canvas.innerHTML = renderViewer(withoutChrome(viewer), {
          projection: 'tree',
          theme: resolved,
          selected: selectedKey(state.selection),
          // The rail beside this canvas draws the panel's one header.
          chrome: false,
        }).markup;
        // Re-inserted rather than re-rendered: the row is already assembled,
        // and rebuilding it here would be a second place that decides what it
        // says.
        //
        // ONLY IF IT STILL HAS CONTENT, which is `canvasToolbar`'s own rule —
        // "nothing to say, no row" — and removing the caption above is exactly
        // what can empty it. A host that words the caption and not the pill
        // gets a caption-only row on the direct tier, and prepending its
        // emptied husk here left a sticky padded band with a border and no
        // content over the tree. Reading the element rather than re-deriving
        // the condition keeps the rule in one place.
        if (toolbar !== null && toolbar.childElementCount > 0) canvas.prepend(toolbar);
        const states = new Map(
          overlaysFor(viewer.edges, writeStates, selectedEdgeId(state.selection)).map((edge) => [edge.id, overlayFor(edge).attribute]),
        );
        for (const badge of canvas.querySelectorAll<HTMLElement>(`[${GROUP_ATTRIBUTE}]`)) {
          const attribute = states.get(badge.getAttribute(GROUP_ATTRIBUTE) ?? '');
          if (attribute !== undefined && attribute !== null) badge.setAttribute(STATE_ATTRIBUTE, attribute);
        }
      }
    }
    zone('inspector')?.append(inspectorChrome(document_));
    // INSIDE THE WORKSPACE ROOT, not beside it: that root is the box the
    // chrome sheet positions the chooser against, and a host that scopes its
    // theme to the root still resolves the chooser's tokens there.
    const floating = floatingChooser();
    if (floating !== null) (surface.firstElementChild ?? surface).append(floating);
    const overlay = firstPassOverlay();
    if (overlay !== null) {
      (surface.firstElementChild ?? surface).append(overlay);
      // THE ZONES GO INERT UNDER IT. Set here rather than in the stylesheet
      // because it is a behaviour — focus and hit-testing — not a look, and the
      // markup is rebuilt every render so it cannot be left behind on close.
      for (const covered of surface.querySelectorAll('.ig-zone')) covered.setAttribute('inert', '');
    }

    const rail = zone('rail');
    if (rail !== null) rail.scrollTop = scrollTop;
    // FOCUS SURVIVES THE REDRAW, and it moves to the target search when that
    // step opens. The keyboard path is R -> kind -> search -> Enter, and every
    // step redraws: without this, R destroyed the focused row, the next press
    // landed outside the workspace and read as 'elsewhere', and the advertised
    // pointer-free loop could not get past its first key.
    const search = surface.querySelector<HTMLInputElement>(`input[${COMMAND_ATTRIBUTE}="target-query"]`);
    const focusRow = (key: string | null, within: string | null = focusedZone): void => {
      if (key === null) return;
      focusIn(within, key);
    };
    if (overlay !== null) {
      // FOCUS IS TAKEN BACK ON EVERY RENDER WHILE THE OVERLAY IS UP, not only on
      // the one that opens it. Every answer dispatches, every dispatch redraws,
      // and the redraw destroys the element focus was on — so a once-only rule
      // gave the reader exactly one keystroke before `activeElement` fell to the
      // body, `interaction` read `elsewhere` and every later key returned
      // `none`. This is the same arm the target search already earns below.
      if (firstPassWas === 'closed') focusBeforeFirstPass = focused;
      const again =
        overlayToken === null || overlayToken === ''
          ? null
          : overlay.querySelector<HTMLElement>(overlayToken);
      // THE WRAPPER IS THE FALLBACK, INCLUDING ON THE RENDER THAT OPENS IT. The
      // first control is `apply`, and landing focus there would put the one
      // irreversible answer under the reader's next Space.
      (again ?? overlay).focus({ preventScroll: true });
    } else if (activeCommand !== null) {
      const again = surface.querySelector<HTMLInputElement>(`input[${COMMAND_ATTRIBUTE}="${activeCommand}"]`);
      if (again !== null) {
        again.focus();
        const end = again.value.length;
        again.setSelectionRange(
          Math.min(caret?.start ?? end, end),
          Math.min(caret?.end ?? end, end),
          caret?.direction ?? 'none',
        );
      } else {
        // The search closed under the caret — the target was committed or the
        // draft cancelled — so focus returns to the row the flow started on.
        focusRow(selectedKey(state.selection));
      }
    } else if (search !== null && !searchWasOpen) {
      // ON THE RENDER THAT OPENS IT ONLY. A store notification while the search
      // stands open and focus rests on the host's own chrome must not yank
      // focus back into the search; the caret arm above already keeps it when
      // the reader is typing there.
      search.focus();
    } else if (pendingFocus !== null) {
      const rows = result.view.rail.rows;
      const wanted = pendingFocus.key;
      const at = rows.findIndex((slot) => wanted !== null && slot.members.includes(wanted));
      // THE ENDS ARE THE VIEWER'S ENDS. The linear projection appends the
      // excluded rows after the slots, so the last focusable row of the last
      // window is an exclusion when the document has any; read the ends off
      // what the rail actually drew rather than off the slots alone.
      const drawnKeys = [...(rail?.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}][tabindex]`) ?? [])].map((row) =>
        row.getAttribute(KEY_ATTRIBUTE),
      );
      const target =
        pendingFocus.kind === 'first' ? (drawnKeys[0] ?? rows[0]?.lead)
        : pendingFocus.kind === 'last' ? (drawnKeys[drawnKeys.length - 1] ?? rows[rows.length - 1]?.lead)
        : pendingFocus.kind === 'after' ? rows[at + 1]?.lead
        : at > 0 ? rows[at - 1]?.lead : undefined;
      const jump = pendingFocus.kind;
      pendingFocus = null;
      focusRow(target ?? focused, 'rail');
      // THE VIEWPORT FOLLOWS THE JUMP. The window was re-cut around the target
      // but the scroll offset restored above is the one from before the key
      // press, so without this the focused row sits below (or above) the
      // visible rows and the reader sees nothing move.
      if (rail !== null) {
        if (jump === 'last') rail.scrollTop = rail.scrollHeight;
        else if (jump === 'first') rail.scrollTop = 0;
        else {
          const now = doc.activeElement;
          if (isFocusable(now) && typeof now.scrollIntoView === 'function') now.scrollIntoView({ block: 'nearest' });
        }
      }
    } else {
      // THE COMMAND CONTROL, WHERE THE RAIL CANNOT ANSWER. Strictly additive:
      // it is reached only when `focusedKey()` found nothing, which is exactly
      // the case `focusRow(null)` returned from without moving focus at all —
      // so no control that has a keyed ancestor changes behaviour, and the
      // rail's roving tab stop is untouched.
      //
      // The control can legitimately be gone: the edit it named landed, the
      // relationship it belonged to was deleted, the recovery card it sat in
      // resolved. `refocusCommand` says so rather than guessing, and the rail
      // fallback below is then the same one that ran before.
      const restored =
        focused === null && commandToken !== null && refocusCommand(commandToken);
      if (!restored) focusRow(focused);
      // A LAST RESORT, because half of these controls RESOLVE THEMSELVES. A
      // picker option closes the picker; `retry`, `discard`, `cancel` and
      // `dismiss-change` each remove the card they sit in — so `refocusCommand`
      // correctly answers "gone", `focusRow(null)` moves nothing, and the
      // keyboard loop died anyway. That is the whole-loop half of the defect,
      // and leaving it would have fixed the disclosure while every one-shot
      // control kept failing the same way.
      //
      // The first drawn row, on the same reasoning the first-pass close arm
      // gives for returning to §17a's entry: somewhere inside the surface that
      // reaches the listener beats the body, and the rail is the zone the
      // reader can navigate out of.
      // THE TEST IS "INSIDE THE SURFACE", NOT "FOCUSABLE". `isFocusable` asks
      // whether a node has `focus`, and `<body>` does — so it answers true for
      // exactly the state this arm exists to repair. What the keydown listener
      // needs is a focus owner it can receive an event from.
      const adrift =
        !isElement(doc.activeElement) || !surface.contains(doc.activeElement);
      if (!restored && focused === null && heldFocus && adrift) {
        // THROUGH `focusIn`, NOT `focus()`. The rail renders one row at
        // `tabindex="0"` and the rest at `-1`, and focusing a row directly
        // leaves the STOP on whichever row had it — so Tab out and back
        // returns to a different row than the one the reader is on.
        // `focusIn` moves the stop with the focus, which is why every other
        // row-focus path in this file goes through it.
        const first = zone('rail')?.querySelector<HTMLElement>(`[${KEY_ATTRIBUTE}][tabindex]`);
        const key = first?.getAttribute(KEY_ATTRIBUTE);
        if (key !== null && key !== undefined) focusIn('rail', key);
      }
      // AND A RESORT THAT CANNOT ITSELF FAIL. The rail is not always there to
      // fall back to: with the audit filter on and nothing flagged it draws no
      // rows at all, while the inspector stays perfectly usable — so pressing a
      // self-removing control there left focus on the body and killed the
      // keyboard loop exactly as before. A fallback with a precondition is not
      // a last resort.
      //
      // The surface itself always exists, and the keydown listener is on it, so
      // focus landing here is by definition focus the loop can hear. `tabindex`
      // is -1: this is somewhere to PUT focus, never a stop Tab should find.
      if (
        heldFocus &&
        (!isElement(doc.activeElement) || !surface.contains(doc.activeElement))
      ) {
        // A CONTROL, BEFORE THE SURFACE ITSELF. Most of these do not merely
        // vanish — they REPLACE themselves with the step they opened, and `add`
        // becoming the kind list is the ordinary case. Landing on the bare
        // surface there put the press back in reach of the listener and no
        // further: `interaction()` answers `canvas` only for a focused ROW, so
        // on the surface every create binding — the kind digits, Escape —
        // returns `none`. Reachable and inoperable is not the loop this is about.
        //
        // THE ZONE THE READER WAS IN FIRST, then anywhere. Which control
        // replaced which is not knowable from here — the chooser is sometimes
        // floating and sometimes the inspector's own list — so this asks the
        // weaker, answerable question: what can the reader act on, nearest to
        // where they were.
        const zoneName = commandToken?.zone ?? null;
        const near = zoneName === null ? null : zone(zoneName);
        const opened =
          near?.querySelector<HTMLElement>(`[${COMMAND_ATTRIBUTE}]`) ??
          surface.querySelector<HTMLElement>(`[${COMMAND_ATTRIBUTE}]`);
        if (opened !== null) {
          opened.focus({ preventScroll: true });
        } else {
          // AND THE SURFACE LAST, which is the resort that cannot itself fail.
          // It leaves the reader without a binding to press, but it keeps the
          // listener reachable so Tab moves them somewhere useful — strictly
          // better than the body, which reaches nothing at all.
          surface.setAttribute('tabindex', '-1');
          surface.focus({ preventScroll: true });
        }
      }
    }
    // THE KEYBOARD IS GIVEN BACK. The overlay is removed with focus inside it,
    // so without this `activeElement` is the body — and the keydown listener is
    // on the mount's element, so no press reaches it and the whole workspace is
    // dead until the reader clicks. Restores what held focus when it opened.
    if (overlay === null && firstPassWas !== 'closed') {
      const back = focusBeforeFirstPass;
      focusBeforeFirstPass = null;
      appliedWrites.clear();
      if (back !== null) {
        focusIn(null, back);
      } else {
        // NOTHING KEYED HELD FOCUS, WHICH IS THE ORDINARY CASE. §17a's entry is
        // a button and carries no `data-ig-key`, so a reader who tabbed to it
        // and pressed it leaves nothing for `focusIn` to find — and focus on
        // the document body reaches no listener at all, because the keydown
        // listener is on the mount's element. The entry is the control they
        // came in through, so it is where they come back to.
        // ONE RECORDED ANSWER, NOT TWO: an earlier revision also recorded WHICH
        // control held focus, which a mutation test showed could never differ —
        // the queue opens from this one control and no other.
        // THE ENTRY CAN BE GONE BY NOW, THOUGH. Whether a backlog has a first
        // pass to run is the host's answer and the host may change it: the
        // sandbox draws the entry only while its detector finds candidates, so
        // a completed queue whose writes land removes the very control this
        // would return to. So the order of resort ends inside the ORDER, which
        // is the one part of the workspace that is always there.
        const back_ =
          surface.querySelector<HTMLElement>(`[${COMMAND_ATTRIBUTE}="first-pass"]`) ??
          surface.querySelector<HTMLElement>(`[${KEY_ATTRIBUTE}][tabindex]`);
        back_?.focus({ preventScroll: true });
      }
    }
    firstPassWas = state.firstPass.phase.kind;
    searchWasOpen = search !== null;
  };

  /**
   * Take the option's scanner, and end the lifecycle the old one was scanning for.
   *
   * Two failures, one rule. Removing the bundle stops the overlay being drawn
   * while the phase stays open — and the phase is what hands every key to a
   * queue that is no longer on screen, with no control left to close it.
   * REPLACING the source is worse than it looks: the old scan's promise still
   * resolves under the current generation, so the queue would be drawn in the
   * new bundle's words and populated by the superseded scanner, and a `Y` there
   * writes a relationship the configured source never proposed.
   *
   * RESET RATHER THAN CLOSE, and the difference is the decided set: a
   * `CandidateId` is the HOST's and opaque, so one scanner's ids say nothing
   * about another's — carried across, a collision silently drops the new
   * detector's question, and a question nobody was asked is indistinguishable
   * from one already answered.
   *
   * CALLED FROM `update()`, AT THE MOMENT THE OPTION CHANGES, not from the
   * render that observes it later. Renders are coalesced on a microtask, so a
   * host that calls `update()` and then dispatches an `open` in the same task
   * had its brand-new lifecycle reset by a render still holding the previous
   * scanner — and the new scan's answer then arrived on a closed phase and was
   * dropped, so that supported sequence never opened a queue at all.
   *
   * Keyed on the SOURCE rather than the bundle, because a host that rebuilds an
   * equivalent options object every render has changed nothing.
   */
  const adoptSource = (): void => {
    const source = current.firstPass?.source ?? null;
    if (source === firstPassSource) return;
    firstPassSource = source;
    if (state.firstPass.phase.kind !== 'closed' || state.firstPass.decided.length > 0) {
      dispatch({ kind: 'first-pass', command: { kind: 'reset' } });
    }
    appliedWrites.clear();
  };

  // --- listeners ---

  /**
   * What a control press means, resolved once for both listeners.
   *
   * ONE CONSTRUCTION, TWO CALLERS. A pointer press and a key press perform the
   * same act, and until `#158` only the pointer could perform it — so the
   * keyboard's half was written as a second reading of the same attributes,
   * free to disagree with this one about which act a press is. Extracting the
   * answer is what makes "the click path and the key path do the same thing" a
   * fact rather than a claim two code paths happen to agree on today.
   *
   * WHY A REFUSAL IS A STATE AND NOT A `null`. The two callers want opposite
   * things from a control that declines, so collapsing the two would be wrong
   * for one of them whichever way it collapsed:
   *
   * - `onClick` must STOP on a refusal. Fall through and a press on an inert
   *   `First pass →` reaches the identity branch below and selects whatever row
   *   or group happens to sit under it — an act the reader never asked for.
   * - `onKeydown` must hand an `input` refusal BACK to the platform and hold an
   *   `inert` one. Hence the reason travels with the refusal: see the arm's own
   *   comment for the space character that is lost when it does not.
   *
   * The alternative considered and rejected: `HostCommand | null` plus an
   * `isControl(target)` predicate for the callers to gate on. The predicate has
   * to re-walk these same three `closest` calls, which is a second construction
   * of the very thing this function exists to make singular.
   *
   * THREE `closest` WALKS RATHER THAN ONE COMBINED SELECTOR, on purpose. A
   * single `closest('[a],[b],[c]')` answers with the NEAREST of the three,
   * which is not the same question: these channels are asked in a fixed
   * priority — a command wins over an answer, an answer over the audit filter —
   * and where two nest, the combined selector would answer with the inner one
   * whatever the priority says. The saving is two ancestor walks on a press,
   * which is a human keystroke rather than a loop, and the risk is changing
   * which act a press performs.
   */
  const controlAnswer = (target: Element): ControlAnswer | null => {
    const control = target.closest<HTMLElement>(`[${COMMAND_ATTRIBUTE}]`);
    if (control !== null && surface.contains(control)) {
      const name = control.getAttribute(COMMAND_ATTRIBUTE) ?? '';
      if (isInput(control)) return REFUSED_INPUT; // the `input` listener owns these
      // THE ENTRY IS INERT WITHOUT A BUNDLE, and it is withheld HERE rather
      // than in the reducer. `renderWorkspace` draws §17a's `First pass →`
      // inside this surface, so a host cannot intercept it from outside; and
      // the reducer's `first-pass` arm would move to `scanning` with no source
      // to call and no way back. See `MountWorkspaceOptions.firstPass`.
      if (name === 'first-pass' && current.firstPass === undefined) return REFUSED_INERT;
      return {
        kind: 'dispatch',
        command: {
          kind: 'control',
          name,
          target: control.getAttribute(TARGET_ATTRIBUTE) ?? undefined,
          // The picker publishes its kind as `data-ig-kind`; the mount's chrome
          // publishes `data-ig-value`. One command channel, two spellings.
          value: control.getAttribute('data-ig-value') ?? control.getAttribute('data-ig-kind') ?? undefined,
        },
      };
    }
    // AN ANSWER IS ITS OWN ATTRIBUTE, so it falls through the command branch
    // above and is read here — before the identity branch in `onClick`, which
    // would otherwise answer a click inside the overlay with whatever key or
    // group is underneath it.
    //
    // REACHED BY THE POINTER ONLY, and deliberately. `onKeydown` returns while
    // the first-pass phase is open, and this attribute is published only by the
    // overlay that is drawn while it is open — so the key arm can never see one.
    // The overlay's own `y`/`n`/`s` map owns those presses, which makes this
    // half a designed vocabulary rather than a gap.
    //
    // WHAT IS A GAP, said plainly because the first draft of this note got it
    // wrong: the same early return also hides `first-pass-close`, and THAT is a
    // `data-ig-command` control — the very channel `#158` is about, not one
    // over. Whether it is activated from `firstPassKeydown` or from a binding in
    // `firstpass/keys.ts` is a decision about who owns the queue's keyboard, so
    // it is filed as `#161` rather than settled from inside this function.
    const answered = target.closest<HTMLElement>(`[${ANSWER_ATTRIBUTE}]`);
    if (answered !== null && surface.contains(answered)) {
      return {
        kind: 'dispatch',
        command: {
          kind: 'control',
          name: 'first-pass-answer',
          value: answered.getAttribute(ANSWER_ATTRIBUTE) ?? undefined,
        },
      };
    }
    if (target.closest('[data-ig-audit-filter]') !== null) {
      return { kind: 'dispatch', command: { kind: 'control', name: 'audit-filter' } };
    }
    return null;
  };

  const onClick = (event: MouseEvent): void => {
    const target = isElement(event.target) ? event.target : null;
    if (target === null) return;
    const answer = controlAnswer(target);
    if (answer !== null) {
      // A REFUSAL STILL STOPS THE CLICK, which is what the three `return`s this
      // branch replaced did. See {@link controlAnswer} for why falling through
      // would select something underneath the control instead.
      if (answer.kind === 'dispatch') dispatch(answer.command);
      return;
    }
    // THE NEARER IDENTITY WINS. A relationship badge inside a row carries
    // `data-ig-group` and sits under the row's `data-ig-key`, so resolving the
    // key first would answer every badge click with the row and no edge could
    // ever be selected from a row. One `closest` over both attributes answers
    // with whichever the pointer actually landed on.
    const named = target.closest<HTMLElement>(`[${GROUP_ATTRIBUTE}],[${KEY_ATTRIBUTE}]`);
    if (named === null || !surface.contains(named)) return;
    const id = named.getAttribute(GROUP_ATTRIBUTE);
    if (id !== null) {
      dispatch({ kind: 'group', id });
      return;
    }
    const key = named.getAttribute(KEY_ATTRIBUTE);
    if (key !== null) dispatch({ kind: 'point', key });
  };

  const readInput = (event: Event): void => {
    const target = isElement(event.target) && isInput(event.target) ? event.target : null;
    if (target === null || !surface.contains(target)) return;
    const name = target.getAttribute(COMMAND_ATTRIBUTE);
    if (name === 'search' || name === 'target-query') dispatch({ kind: 'control', name, value: target.value });
  };

  // NOT WHILE AN INPUT METHOD IS COMPOSING. Every keystroke of a composition
  // fires `input`, and a redraw replaces the element that owns the
  // composition, which truncates or cancels the text before `compositionend`.
  // The value is read once the composition settles, from the same listener.
  const onInput = (event: Event): void => {
    if (isComposing(event)) return;
    readInput(event);
  };

  const onCompositionEnd = (event: Event): void => {
    readInput(event);
  };

  const onScroll = (event: Event): void => {
    const rail = zone('rail');
    if (rail === null || event.target !== rail) return;
    if (drawn === null) return;
    // THE DECISION IS THE REDUCER'S, and `null` is load-bearing: a scroll that
    // clamps back to the current start must not dispatch, because every
    // dispatch redraws and every redraw restores the scroll offset — which
    // fires this listener again. See `railWindowTarget`.
    // THE PITCH IS A ROW'S, and the rail zone holds more than rows: the legend,
    // and the host header and the NOW list when the host supplies them — one
    // row per running job, unbounded. Their height is measured off the drawn
    // tree and subtracted before the offset becomes a row (`railRowAt`), so a
    // host running dozens of jobs does not scroll the window past ranks the
    // reader has not reached. Measured, not derived from the theme: the header
    // wraps, and a wrapped header is taller than any constant would say.
    const rows = rail.querySelector('.ig-viewer .ig-list');
    const viewer = rail.querySelector('.ig-viewer');
    const chrome =
      rows === null || viewer === null
        ? 0
        : rows.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
    const row = railRowAt(rail.scrollTop, chrome, pitch());
    const start = railWindowTarget(row, state.railStart, railCount(), drawn.rail.total);
    if (start !== null) dispatch({ kind: 'scroll', start });
  };

  /**
   * Which of the create flow's interactions the keyboard is in.
   *
   * `canvas` ONLY on the navigation surface — a focused row or node — because
   * that is the one place every binding belongs. A picker choice, the audit
   * filter or the delete button is a control with its own Enter and Space, and
   * a Backspace there must not delete the selected edge; the key map names
   * `elsewhere` as "everything that is not our own search box", and a button is
   * that. The target search keeps its two bindings.
   *
   * ## The TWO controls that are not `elsewhere`, and the test they pass
   *
   * The rule above is right for every control it names and wrong for these two,
   * and the difference is namable rather than a taste: the audit filter and the
   * delete button share no vocabulary with the key map, while these two ARE the
   * key map rendered. The kind chooser's digits are `KIND_KEYS`, the same table
   * `keyIntent` resolves the press against, and `+ add` draws `RELATE_KEY`
   * itself as its hint. A control whose labels tell the reader to press `2`
   * cannot be a control the reader's `2` is refused by, and `#173` is the same
   * sentence about `R`: the hint named a key the reader genuinely has, at the
   * one focus position where it was inert.
   *
   * THE TEST IS "DOES THIS CONTROL DRAW A KEY THIS MAP READS", and it is what
   * stops the list growing on taste. It admits exactly two controls today; a
   * host's own widget, a filter, a remove button and every control that draws
   * no key stay `elsewhere`. `create/keys.ts` carries the matching half — the
   * new state admits the ONE binding it renders and no other.
   *
   * ## Asked of the DRAFT, not of where focus happens to be
   *
   * `#152`, and the reason three consecutive rounds of `#150` each fixed a real
   * bug and surfaced the next one: every one of them moved focus somewhere else,
   * and this predicate never read the draft, so the next place focus landed
   * classified `elsewhere` again. Focus is not the fact. A draft with a source
   * and no kind IS the reader being at the kind step, wherever the mount's
   * restore happened to put them — and it puts them on the inspector's `clear`,
   * because the last-resort arm takes the zone's FIRST command control and
   * `clear` is drawn above the kind list.
   *
   * A CONJUNCT ON THE CHOOSER'S OWN MARKUP WAS TRIED ON PAPER AND WOULD HAVE
   * SHIPPED THE BUG: `closest('<the chooser>')` is false from `clear`, so the
   * digits would still have died while the change typechecked and its own table
   * test passed.
   *
   * ## `add-control` reads focus, and that is not a relapse
   *
   * `#173`'s arm asks where focus is, which is the shape this section rejects —
   * so it has to survive the argument rather than repeat what it rejected, and
   * the difference is WHICH FACT IS MISSING. At the kind step the fact is the
   * DRAFT: a source with no kind IS the reader at that step, wherever a restore
   * put them, so reading focus there answers a question the draft had already
   * answered better. At the begin step there is no draft yet — beginning one is
   * the act — and the fact is the SUBJECT to begin from. The control publishes
   * it on `data-ig-target`, so what this arm reads is a control's own claim
   * about what it is for, and focus is what says the reader is standing on it.
   *
   * The `#150` failure mode is therefore absent by construction: it was focus
   * MOVING AWAY from the control the draft belonged to, and the arm here has no
   * "away" — it answers about the control still holding focus, and once the
   * draft begins the panel replaces this control with the kind list, at which
   * point the draft is the fact again and `kind-chooser` answers. That ordering
   * is written below rather than left to be inferred.
   *
   * ## `canvas` is asked FIRST, and that ordering is the safety property
   *
   * The only answers that move are ones that read `elsewhere` today — where
   * nothing reaches, so nothing can regress. A reader who leaves the chooser
   * open and tabs back to a row keeps the whole canvas vocabulary exactly as
   * before. Note that the order is NOT needed to keep a chooser out of `canvas`:
   * `focusedKey` walks DOM ancestry, the floating chooser is appended to the
   * workspace root beside the zones rather than inside the canvas, and the panel
   * list sits in an inspector that carries no key — so it answers null from
   * inside either one however this is ordered.
   */
  const interaction = (): CreateInteraction => {
    const active = doc.activeElement;
    if (isElement(active) && isInput(active) && active.getAttribute(COMMAND_ATTRIBUTE) === 'target-query') {
      return 'target-search';
    }
    if (focusedKey() !== null) return 'canvas';
    // A FOCUSED TEXT BOX IS NEVER THE CHOOSER, whatever the draft is doing.
    // `scale/render.ts` draws the search-to-focus input, and it stays usable
    // while a draft is open — so without this a reader who clicked it and typed
    // `1` would have the digit taken from their query and spent on a
    // relationship kind, `preventDefault()` included. That is the failure
    // `create/keys.ts` withholds the digits from `target-search` to avoid, and
    // this arm would have reintroduced it one control over.
    //
    // NARROWING THE NEW ARM ONLY, deliberately: an input that is not the target
    // search already read `elsewhere` before this predicate existed, so this
    // hands those presses back exactly as they were rather than reclassifying
    // anything that works today. A focused input INSIDE a keyed node still
    // answers `canvas` above, which is a pre-existing question and not this
    // change's to settle.
    if (isInput(active)) return 'elsewhere';
    // THE DRAFT IS ASKED BEFORE THE CONTROL, so the section above stays true of
    // the state it was written for. The two cannot both be live in practice —
    // `createStep` withholds `+ add` for the whole of the kind step — but a rule
    // that depends on another module's rendering condition is one that changes
    // silently the day that condition does.
    if (isChoosingKind(state.draft)) return 'kind-chooser';
    return focusedAddSubject() === null ? 'elsewhere' : 'add-control';
  };

  /**
   * The rail's window edge, decided BEFORE the viewer is asked.
   *
   * The viewer draws the excluded rows after every window, so its scene's
   * focus order runs from the last drawn slot into the exclusions rather than
   * ending there — from the viewer's side the window is the whole document.
   * The window is the mount's, so the mount decides first: on the last drawn
   * slot, ArrowDown and End re-cut the window rather than stepping into the
   * exclusions; on the first, ArrowUp and Home re-cut it upward. Anything
   * inside the window, and every other key, is the viewer's to answer.
   */
  const advanceRail = (rail: RailWindow, key: string, pressedKey: string): boolean => {
    const first = rail.rows[0];
    const last = rail.rows[rail.rows.length - 1];
    const onFirst = first !== undefined && first.members.includes(key);
    const onLast = last !== undefined && last.members.includes(key);
    const offset = rail.offsetOf(key);
    const count = railCount();
    const slack = railSlackFor(count);
    const lastStart = Math.max(0, rail.total - count);
    switch (pressedKey) {
      // THE WINDOW ALWAYS MOVES BY AT LEAST ONE ROW. The re-cut lands the
      // window `slack` rows above the reader; with a small window that could
      // land on the current start, and a start that does not change draws
      // no next row to focus.
      case 'ArrowDown':
        if (!onLast || rail.after === 0 || offset === undefined) return false;
        pendingFocus = { kind: 'after', key };
        dispatch({ kind: 'scroll', start: Math.min(lastStart, Math.max(state.railStart + 1, offset - slack)) });
        return true;
      case 'ArrowUp':
        if (!onFirst || rail.before === 0 || offset === undefined) return false;
        pendingFocus = { kind: 'before', key };
        dispatch({ kind: 'scroll', start: Math.max(0, Math.min(state.railStart - 1, offset - (count - slack))) });
        return true;
      case 'End':
        if (rail.after === 0) return false;
        pendingFocus = { kind: 'last', key: null };
        dispatch({ kind: 'scroll', start: lastStart });
        return true;
      case 'Home':
        if (rail.before === 0) return false;
        pendingFocus = { kind: 'first', key: null };
        dispatch({ kind: 'scroll', start: 0 });
        return true;
      default:
        return false;
    }
  };

  /**
   * The viewer's movement keys, through the viewer's own reducer.
   *
   * `mountViewer` wires these itself; the workspace composes the viewer's
   * scenes rather than its mount, so this asks `navigate` about the zone's
   * scene (see `sceneFor`) and moves focus to the key it answers with.
   * Movement never wraps and never crosses zones — the ends of the order are
   * the ends of the work — and Enter or Space selects, exactly as the viewer's
   * own shell does.
   *
   * THE RAIL WINDOW IS THE ONE THING THE VIEWER CANNOT SEE. Its scene is the
   * drawn window, so at the window's edge `navigate` correctly stays put while
   * the order goes on behind the spacer. That edge is the mount's, because the
   * window is: the window is re-cut around the row and the neighbour is
   * focused once the redraw has drawn it (`pendingFocus`).
   */
  const navigateFocus = (event: KeyboardEvent): boolean => {
    if (event.isComposing) return false;
    const active = doc.activeElement;
    if (!isElement(active)) return false;
    const owner = active.closest<HTMLElement>('.ig-zone');
    const zoneName = owner?.getAttribute('data-zone') ?? null;
    const key = active.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`)?.getAttribute(KEY_ATTRIBUTE) ?? null;
    if (owner === null || zoneName === null || key === null || !surface.contains(owner)) return false;
    if (zoneName === 'rail' && drawn !== null && advanceRail(drawn.rail, key, event.key)) return true;
    const scene = sceneFor(zoneName);
    if (scene === null) return false;
    const result = navigate(scene, { focused: key, selected: selectedKey(state.selection) }, event.key);
    if (result.command.kind === 'select') {
      dispatch({ kind: 'point', key: result.command.key });
      return true;
    }
    if (result.command.kind === 'focus') {
      focusIn(zoneName, result.command.key);
      return true;
    }
    return false;
  };

  /**
   * The queue's keys, while the queue is up.
   *
   * Returns whether the press was consumed. The queue OWNS the keyboard while it
   * is drawn — the create map and the viewer's navigation are not consulted,
   * because every one of their targets is behind an inert overlay — but a press
   * it does not recognise is handed back rather than swallowed, which is the
   * contract `firstpass/keys.ts` states in terms: `none` exists "so the host does
   * not `preventDefault()` a key it did not consume".
   */
  const firstPassKeydown = (event: KeyboardEvent): boolean => {
    const { phase } = state.firstPass;
    if (phase.kind === 'closed') return false;
    // ESCAPE IS THE MOUNT'S OWN, and it has to be: `firstpass/keys.ts` binds
    // `y`/`n`/`s` and both spellings of the delete key and nothing else, and its
    // own tests pin `Escape` to `none`. The exit CONTROL is the mount's, so the
    // exit KEY is too — without it §17e's "exit anytime" is reachable only with
    // a pointer, on the one surface that advertises a pointer-free loop.
    if (event.key === 'Escape') {
      dispatch({ kind: 'first-pass', command: { kind: 'close' } });
      return true;
    }
    // TAB STAYS INSIDE. `inert` covers the workspace's own zones and nothing
    // else, so a mount sitting beside other page chrome let Tab — and Shift-Tab
    // from the wrapper focus lands on — walk straight out of a dialog that
    // asserts `aria-modal`. The keydown listener is on the mount's element, so
    // once focus is outside, `Y`/`N`/`S` and Escape all stop working while the
    // overlay is still up: a keyboard reader stranded with no way back.
    if (event.key === 'Tab') {
      const overlay = surface.querySelector<HTMLElement>('.ig-firstpass-overlay');
      if (overlay === null) return false;
      const stops = [...overlay.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')];
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined) return false;
      const active = doc.activeElement;
      const at = isElement(active) ? stops.indexOf(active as HTMLElement) : -1;
      // WRAPPING AT BOTH ENDS, and treating "focus is on the wrapper" as before
      // the first stop — which is where it sits on open and after every answer.
      const next = event.shiftKey ? (at <= 0 ? last : stops[at - 1]) : at === stops.length - 1 ? first : stops[at + 1];
      (next ?? first).focus({ preventScroll: true });
      return true;
    }
    if (phase.kind !== 'open') return false;
    const progress = phase.queue;
    const context: FirstPassContext = {
      // `queue` WHENEVER THE OVERLAY HOLDS FOCUS. The surface has no text input
      // of its own, so the only question is whether the reader is inside it.
      interaction:
        isElement(doc.activeElement) &&
        doc.activeElement.closest('.ig-firstpass-overlay') !== null &&
        !isInput(doc.activeElement)
          ? 'queue'
          : 'elsewhere',
      hasCandidate: progress.cursor < progress.candidates.length,
      canUndo: progress.answers.length > 0,
    };
    const intent = firstPassIntent(event, context);
    if (intent.kind === 'none') return false;
    dispatch({ kind: 'first-pass', command: { kind: 'queue', command: intent.command } });
    return true;
  };

  const onKeydown = (event: KeyboardEvent): void => {
    // A HELD KEY BELONGS TO THE CONTROL IT ACTIVATED, wherever focus went next.
    //
    // The arm below already refuses to dispatch twice for one held key, and that
    // is not enough, because ACTIVATING A CONTROL OFTEN MOVES FOCUS: pressing a
    // kind option redraws and focuses `target-query`, and a self-removing
    // control falls back to a rail row. So the repeats of that same press arrive
    // at a DIFFERENT element, where the arm's question — "is what holds focus
    // now a control?" — answers about the wrong thing entirely. Held `Space` on
    // a kind option would type spaces into the query the reader has not started;
    // held `Space` on `add` would walk the rail. Each is the platform doing
    // exactly the right thing with a press this package took halfway.
    //
    // Recorded as a FACT ABOUT THE PRESS rather than re-derived from focus,
    // which is the same shape as the rest of this file's fixes for this class:
    // where focus is is not what the question was about. It ends at `keyup`, and
    // a fresh non-repeat press of the same key clears it too — so a `keyup` lost
    // to a window blur costs one held key rather than every later one.
    if (event.repeat && activating.has(event.key)) {
      event.preventDefault();
      return;
    }
    // A FRESH PRESS ENDS ONLY ITS OWN KEY'S RECORD, and with a set that falls
    // out rather than being arranged: every key's record is its own, so no other
    // key's press can reach it. A reader holding `Space` on a control and
    // touching `Shift` used to have the whole record dropped, and the next
    // `Space` repeat landed wherever the activation had sent focus.
    if (!event.repeat) activating.delete(event.key);
    if (firstPassKeydown(event)) {
      event.preventDefault();
      return;
    }
    // THE QUEUE STILL OWNS THE SURFACE even for a key it did not consume: every
    // target the create map and the viewer's navigation could reach is behind
    // the overlay and inert, so consulting them would act on something the
    // reader cannot see.
    if (state.firstPass.phase.kind !== 'closed') return;
    const document_ = landed();
    const match = targetMatches(document_.issues, state.targetQuery, state.draft.source)[0]?.ref ?? null;
    const context: KeyboardContext = {
      // The FOCUSED row, not the selection: on a fresh page a row can own
      // focus while nothing is selected, and after focus moves on, a stale
      // selection must not become the source of a keyboard-started draft.
      // AND `+ add`'S OWN SUBJECT WHERE THERE IS NO ROW, which is still that
      // rule rather than an exception to it — the fallback is a control's
      // published claim about what it acts on, not the selection this line
      // refuses. It moves nothing that worked: the second term is consulted
      // only where the first is `null`, and where it answers, `interaction()`
      // answers `add-control`, which admits `relate` alone.
      // AND IT DOES NOT OPEN THE NAVIGATION ARM BELOW, which is the one place a
      // wider `focused` could have leaked. That arm is guarded on this field,
      // but `navigateFocus` re-derives the key from a `[data-ig-key]` ANCESTOR
      // and answers `false` without one — and no command control has one, since
      // every one this package draws sits in chrome beside the keyed rows. So
      // the guard now admits a press the arm still declines, rather than
      // stepping the rail from a focused button.
      focused: focusedKey() ?? focusedAddSubject(),
      match,
      selectedEdge: selectedEdgeId(state.selection),
      interaction: interaction(),
    };
    const intent = keyIntent(event, context);
    if (intent.kind !== 'none') {
      event.preventDefault();
      dispatch({ kind: 'intent', intent });
      return;
    }
    if (context.focused !== null && navigateFocus(event)) {
      event.preventDefault();
      return;
    }
    // --- activating a control from the keyboard ---
    //
    // ## Why this is last, and why that is the safety property
    //
    // The same argument `interaction()` makes for its own ordering: the only
    // answers that move are ones nothing reaches today, so nothing can regress.
    // Two facts make it true here rather than merely plausible.
    //
    // `interaction()` answers `elsewhere` for a focused command control that is
    // neither an input, nor the kind step, nor `+ add`, so `keyIntent` returns
    // `none` for every key there. At the KIND STEP it answers `kind-chooser` —
    // the predicate is asked of the DRAFT, not of where focus is — and there
    // `enter` does not survive and `' '` is unbound, so `keyIntent` is silent
    // again. On `+ add` it answers `add-control`, which admits `RELATE_KEY`
    // alone (`#173`) and neither of these two, so this arm still owns them
    // there. So this arm does claim `Enter` and `Space` on the inspector's
    // `clear`, which is where the mount's focus restore lands after `begin`.
    // That is a control doing what a control does, and it is new behaviour on
    // a step the create loop passes through every time — said out loud because
    // it is the one place this arm changes an interaction that already worked.
    //
    // And `navigateFocus` is gated on a focused `[data-ig-key]` ancestor, which
    // no control has: every command control this package draws sits in chrome —
    // the inspector, the header, the ladder's refusal list and search — beside
    // the keyed rows rather than inside one.
    //
    // ## Why cancelling is mandatory here, not tidy
    //
    // On a real `<button>` the browser's ACTIVATION BEHAVIOUR is this keydown's
    // default action, and `onClick` sees the click it synthesises. Cancelling
    // the press is therefore what stops this arm and the browser from both
    // dispatching — the double fire that was, correctly, the reason this was
    // never built. Every path below that resolves a control reaches
    // `preventDefault()` for that reason first and the page's scroll second.
    //
    // ## …and why an `input` refusal is handed back anyway
    //
    // Both search boxes are `<input>` elements carrying `data-ig-command` — the
    // chrome's `target-query` and the ladder's `search`. `' '` is unbound in
    // `create/keys.ts` and neither input has a keyed ancestor, so a space
    // pressed in either arrives HERE. Cancel it and the reader cannot type a
    // space into the target query, which is step three of the very
    // `R → digit → search → ⏎` loop this arm exists to complete. The `input`
    // listener and the platform's text editing own those characters.
    //
    // An `inert` refusal keeps the press for the OTHER two reasons this block
    // gives: `Space` would scroll the page, and this package has answered. It is
    // NOT that handing it back would let a native button activate the entry —
    // that was the first draft of this comment and it is false, because the
    // click a handed-back press synthesizes reaches `onClick`, which asks the
    // same `controlAnswer` and gets the same refusal. Recorded wrong-then-right
    // because the argument, not the behaviour, is what the next reader inherits.
    //
    // `' '` is the modern `KeyboardEvent.key` value for the space bar; legacy
    // `'Spacebar'` is not bound. `viewer/navigation.ts` is the package's one
    // other key reader that binds it and spells it the same way. (`create/keys.ts`
    // is NOT a precedent either way: it binds no space key, and lowercases the
    // names it does bind.)
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // TWO OF THE REFUSALS `create/keys.ts` ARGUES FOR ITS OWN BINDINGS, and for
    // the same reasons — a chord is the platform's shortcut, and `Enter` while
    // an input method is composing confirms its candidate. Read off the event
    // rather than imported: those predicates are that module's private
    // business, and this is the shell's half. Its third, `repeat`, is answered
    // below rather than here, and the difference is not cosmetic — see there.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.isComposing) return;
    // THE FOCUSED ELEMENT. `onClick` reads `event.target` because a click's
    // target IS where the pointer landed; a keydown's target is the focused
    // element only under the browser's own dispatch, so a press delegated from a
    // container would name the container instead. `interaction()` and
    // `navigateFocus` both read `activeElement` for that reason, and an arm in
    // the same handler answering a different question would be the outlier.
    const active = doc.activeElement;
    if (!isElement(active)) return;
    const answer = controlAnswer(active);
    if (answer === null) return;
    if (answer.kind === 'refused' && answer.reason === 'input') return;
    // A REPEAT IS SWALLOWED, NOT HANDED BACK, and it has to be resolved first to
    // know that it is ours to swallow. Handing it back looked like the modest
    // choice and is the one that breaks: `Space` activates a `<button>` on
    // KEYUP, so a held `Space` whose first keydown this arm cancels and whose
    // second it releases lets the platform mark the button active — and the
    // keyup then synthesizes a click that dispatches the act a SECOND time. One
    // held key, two edits; on a toggle the two cancel and the control reads
    // dead. So the reader holding a key is one decision, which is what
    // `create/keys.ts` says a repeat is, and cancelling is how it stays one.
    // (`Enter` repeats natively either way; only `Space` carries the asymmetry,
    // and a rule that split them would be a rule about keyboards rather than
    // about acts.)
    // A REFUSAL IS THIS PACKAGE'S OWN ANSWER, so it keeps the press: `Space`
    // would otherwise scroll the page under a reader who has just pressed
    // something, and there is nothing else waiting for this key.
    if (answer.kind === 'refused') {
      event.preventDefault();
      return;
    }
    // DISPATCH FIRST, THEN DECIDE WHETHER THE PRESS WAS OURS TO KEEP — and that
    // order is the whole of this arm's remaining subtlety.
    //
    // `data-ig-command` IS A SHARED NAMESPACE. `reduceHost`'s `default` arm says
    // so in terms: a host's own chrome publishes on the same attribute, and
    // layer 1 already does — the freshness `refresh`, `retry:index`,
    // `review-pick-order`, `dismiss:adoption` are all drawn inside this surface
    // and all answered by the host's own `click` listener, never by this
    // reducer. Cancelling their keydown would suppress the native click that
    // listener is waiting for, and every one of those controls would stop
    // answering the keyboard — a regression this arm introduced and could not
    // see, because from out here a command the reducer ignored and one it
    // handled without changing anything look identical. So the reducer is asked.
    //
    // Unclaimed means HANDS OFF, ALL THE WAY OFF — and "all the way" is the
    // part that needed a second try. Not cancelling is not enough: dispatching
    // an unclaimed command still ends in `schedule()`, and the redraw replaces
    // `surface.innerHTML` — including the button the reader is holding. Since
    // `Space` activates a `<button>` on KEYUP, destroying it before then loses
    // the activation just as completely as cancelling the press would. So the
    // reduction is computed, read, and only THEN applied. No `preventDefault`,
    // no redraw, no `activating`: the platform's own activation is that
    // control's route, repeats and all, exactly as before this arm existed.
    if (destroyed) return;
    const result = reduceHost(state, answer.command, landed());
    if (!result.claimed) return;
    applyResult(result);
    event.preventDefault();
    // THE PRESS IS NOW RECORDED AS OURS, so its repeats are swallowed at the top
    // of this handler wherever the dispatch has since sent focus. Added beside
    // any other key already held rather than replacing it.
    activating.add(event.key);
  };

  // THE HELD KEY IS LET GO. Registered beside the keydown listener rather than on
  // the document, so a mount that is torn down takes it with it — and a `keyup`
  // that never arrives because focus left the window is survivable, which is why
  // `onKeydown` clears the flag on a fresh press too.
  const onKeyup = (event: KeyboardEvent): void => {
    activating.delete(event.key);
  };

  const onPointerDown = (event: PointerEvent): void => {
    // ONE PRIMARY MAIN-BUTTON PRESS AT A TIME. A second pointer during a drag
    // would replace the press and strand the first drag's release; a
    // right-button press would start a drag under the context menu.
    if (pressed !== null || !event.isPrimary || event.button !== 0) return;
    const target = isElement(event.target) ? event.target : null;
    const canvas = zone('canvas');
    const keyed = target?.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`) ?? null;
    if (canvas === null || keyed === null || !canvas.contains(keyed)) return;
    const key = keyed.getAttribute(KEY_ATTRIBUTE);
    if (key === null) return;
    pressed = { pointerId: event.pointerId, key, x: event.clientX, y: event.clientY, dragging: false };
  };

  // A PRESS RELEASED OUTSIDE THE ELEMENT BEFORE THE DRAG THRESHOLD. Nothing is
  // captured yet at that point, so the release never reaches the delegated
  // listeners and the press would stay recorded — and a later move inside the
  // element, even from another press, could exceed the distance from those
  // stale coordinates and start a phantom drag for the old node. The document
  // sees every release inside the page, so the pre-drag press is cleared
  // there; a drag underway holds capture and is delivered to the element.
  const onDocumentPointerUp = (event: PointerEvent): void => {
    if (pressed !== null && !pressed.dragging && pressed.pointerId === event.pointerId) pressed = null;
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pressed === null || pressed.dragging || pressed.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < DRAG_THRESHOLD) return;
    pressed.dragging = true;
    surface.setAttribute('data-dragging', 'true');
    // CAPTURED ON THE ELEMENT, ONLY ONCE A DRAG IS UNDERWAY. Without capture a
    // pointer released outside the element never reports back, and the drag
    // state stays set until some later interaction happens to clear it. Not
    // captured on the press itself, because capture also redirects the click
    // and a plain click on a node must keep reaching the node.
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic or already-released pointer cannot be captured; the
      // release then reaches the element only if it lands inside it.
    }
    dispatch({ kind: 'drag-start', key: pressed.key });
  };

  const releasePointer = (event: PointerEvent): void => {
    try {
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing was captured.
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    // THE PRESS IS CONSUMED BEFORE THE CAPTURE IS RELEASED. Releasing fires
    // `lostpointercapture` synchronously, which is wired to the cancel path;
    // with `pressed` already null that path stands down instead of cancelling
    // the drop this very handler is about to deliver.
    const was = pressed;
    pressed = null;
    releasePointer(event);
    surface.removeAttribute('data-dragging');
    if (was === null || !was.dragging) return;
    // WHAT IS UNDER THE POINTER, from the document, because a drag captured on
    // the element reports every event with the element as its target.
    const under = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(event.clientX, event.clientY) : null;
    const canvas = zone('canvas');
    const keyed = under?.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`) ?? null;
    const key = keyed !== null && canvas?.contains(keyed) === true ? keyed.getAttribute(KEY_ATTRIBUTE) : null;
    const bounds = surface.getBoundingClientRect();
    dispatch({ kind: 'drop', key, at: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } });
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (pressed === null) return;
    pressed = null;
    releasePointer(event);
    surface.removeAttribute('data-dragging');
    if (state.drag !== null) dispatch({ kind: 'drop', key: null, at: { x: 0, y: 0 } });
  };

  element.addEventListener('click', onClick);
  element.addEventListener('input', onInput);
  element.addEventListener('compositionend', onCompositionEnd);
  element.addEventListener('scroll', onScroll, true);
  element.addEventListener('keydown', onKeydown);
  element.addEventListener('keyup', onKeyup);
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onPointerCancel);
  doc.addEventListener('pointerup', onDocumentPointerUp);
  doc.addEventListener('pointercancel', onDocumentPointerUp);

  const unsubscribe = store.subscribe(schedule);

  /** Every listener off and every node this mount built removed. Shared by `destroy` and a failed first render. */
  const teardown = (): void => {
    unsubscribe();
    element.removeEventListener('click', onClick);
    element.removeEventListener('input', onInput);
    element.removeEventListener('compositionend', onCompositionEnd);
    element.removeEventListener('scroll', onScroll, true);
    element.removeEventListener('keydown', onKeydown);
    element.removeEventListener('keyup', onKeyup);
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onPointerCancel);
    doc.removeEventListener('pointerup', onDocumentPointerUp);
    doc.removeEventListener('pointercancel', onDocumentPointerUp);
    // A DRAG STILL HELD IS LET GO. The element keeps a pointer capture across
    // a destroy otherwise, and the demo's reset mounts again over this very
    // element while the reader may still be dragging.
    if (pressed !== null) {
      try {
        if (element.hasPointerCapture(pressed.pointerId)) element.releasePointerCapture(pressed.pointerId);
      } catch {
        // Nothing was captured.
      }
      pressed = null;
    }
    surface.removeAttribute('data-dragging');
    styles.remove();
    surface.remove();
    drawn = null;
  };

  // THE FIRST RENDER CAN THROW — a host's `project` is host code — and by then
  // the listeners and the subscription are live with no handle to remove
  // them. Tear down before rethrowing, so a mount that failed leaves nothing.
  try {
    render();
  } catch (error) {
    destroyed = true;
    teardown();
    throw error;
  }

  return {
    update(next?: WorkspaceUpdate): void {
      if (destroyed) return;
      if (next !== undefined) {
        current = { ...current, ...next, store };
        adoptSource();
      }
      schedule();
    },
    dispatch,
    get state(): HostState {
      return state;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      teardown();
    },
  };
}
