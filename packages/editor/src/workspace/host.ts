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

import { type EdgeField, EDGE_FIELDS, isEdgeField } from '@issuegraph/core';
import type { GraphDocument, MutationId, Proposal, StoredIssue } from '@issuegraph/store';
import { findEdge } from '@issuegraph/store';

import { type CreateDraft, IDLE_CREATE_DRAFT, createReducer } from '../create/draft.ts';
import type { KeyIntent } from '../create/keys.ts';
import type { Point } from '../create/placement.ts';
import { pickerView } from '../picker/view.ts';
import { INITIAL_SCALE_STATE, type ScaleState, scaleReducer } from '../scale/commands.ts';
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
});

/**
 * What the shell saw.
 *
 * `control` carries a `data-ig-command` — the package's own vocabulary
 * (`select-edge`, `focus`, `search`, `retype`, `flip`, …) and the mount's
 * chrome (`add`, `kind`, `target`, `delete`, `retry`, …) share one channel
 * because the shell reads one attribute. `point` and `group` are the viewer's
 * two identities: a focusable issue key, and a mark naming an edge or a slot.
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
  | { readonly kind: 'drop'; readonly key: string | null; readonly at: Point };

/** What the shell performs against the store after reducing. */
export type HostEffect =
  | { readonly kind: 'propose'; readonly proposal: Proposal }
  | { readonly kind: 'retry'; readonly mutationId: MutationId }
  | { readonly kind: 'discard'; readonly mutationId: MutationId }
  | { readonly kind: 'dismiss-change' };

export interface HostResult {
  readonly state: HostState;
  readonly effects: readonly HostEffect[];
}

function settled(state: HostState): HostResult {
  return { state, effects: [] };
}

/** A draft step: apply the create reducer, and emit the proposal it completes. */
function drafted(
  state: HostState,
  command: Parameters<typeof createReducer>[1],
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
  return {
    state: { ...state, draft: IDLE_CREATE_DRAFT, targetQuery: '', drop: null },
    effects: [{ kind: 'propose', proposal: result.proposal }],
  };
}

/** A pointer on an issue: a target while one is being chosen, a selection otherwise. */
function pointed(state: HostState, key: string): HostResult {
  const choosingTarget = state.draft.kind !== null && state.draft.target === null;
  if (choosingTarget && key !== state.draft.source) {
    return drafted(state, { kind: 'target', ref: key });
  }
  return settled({
    ...state,
    selection: selectionReducer(state.selection, { kind: 'select-issue', key }),
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
      return proposal === null ? settled(state) : { state, effects: [{ kind: 'propose', proposal }] };
    }
    case 'flip': {
      if (edgeId === null) return settled(state);
      const proposal = pickerProposal(document, edgeId, { kind: 'flip' });
      return proposal === null ? settled(state) : { state, effects: [{ kind: 'propose', proposal }] };
    }
    case 'dismiss-change':
      return { state, effects: [{ kind: 'dismiss-change' }] };

    // --- the mount's chrome ---
    case 'audit-filter':
      return settled({ ...state, auditFiltered: !state.auditFiltered });
    case 'add': {
      const source = selectedKey(state.selection);
      return source === null ? settled(state) : drafted(state, { kind: 'begin', source });
    }
    case 'kind':
      return value === undefined || !isEdgeField(value)
        ? settled(state)
        : drafted(state, { kind: 'type', edgeKind: value });
    case 'target-query':
      return settled({ ...state, targetQuery: value ?? '' });
    case 'target':
      return target === undefined ? settled(state) : drafted(state, { kind: 'target', ref: target });
    case 'cancel':
      return settled({ ...state, draft: IDLE_CREATE_DRAFT, targetQuery: '', drop: null });
    case 'delete':
      return edgeId === null
        ? settled(state)
        : { state, effects: [{ kind: 'propose', proposal: { op: 'delete', edgeId } }] };
    case 'retry':
      return target === undefined ? settled(state) : { state, effects: [{ kind: 'retry', mutationId: target }] };
    case 'discard':
      return target === undefined
        ? settled(state)
        : { state, effects: [{ kind: 'discard', mutationId: target }] };
    default:
      // A COMMAND THIS REDUCER DOES NOT KNOW CHANGES NOTHING. A host's own
      // chrome may publish commands on the same attribute — the demo's theme
      // switch does — and those are the host's to read from its own listener,
      // never a reason for this reducer to guess.
      return settled(state);
  }
}

function intended(state: HostState, intent: KeyIntent): HostResult {
  switch (intent.kind) {
    case 'none':
    // `T` opens the picker; the picker is already drawn whenever an edge is
    // selected, so there is nothing to change.
    case 'retype':
      return settled(state);
    case 'create':
      return drafted(state, intent.command);
    case 'propose':
      return { state, effects: [{ kind: 'propose', proposal: intent.proposal }] };
  }
}

/** The one reducer. `document` is the landed document, for edge lookups. */
export function reduceHost(state: HostState, command: HostCommand, document: GraphDocument): HostResult {
  switch (command.kind) {
    case 'point':
      return pointed(state, command.key);
    case 'group': {
      // A mark names either an edge (its store identity) or a slot (its lead).
      // A MARK NAMING NEITHER CHANGES NOTHING. The canvas draws an edge the
      // store has not landed yet — a pending create carries a mark from the
      // moment it is proposed — and its identity is in no landed document and
      // is no issue key. Falling through to `pointed` would select that
      // identity as an issue, or worse, commit it as a draft's target.
      if (findEdge(document, command.id) !== undefined) return selectEdge(state, command.id);
      if (document.issues.some((issue) => issue.ref === command.id)) return pointed(state, command.id);
      return settled(state);
    }
    case 'control':
      return controlled(state, command.name, command.target, command.value, document);
    case 'intent':
      return intended(state, command.intent);
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
 * Bring the state back into agreement with a document that moved under it.
 *
 * The store re-renders on every landed write, and a write can remove what the
 * state names: a retype or a flip gives the edge a NEW identity, a delete
 * removes it, and a conflict's rehydrate can drop an issue a draft was aimed
 * at. A selection naming an edge the document no longer carries would leave
 * the inspector showing a picker for nothing — the viewer already refuses a
 * stale selection the same way, so the host does too, from the document
 * rather than from memory of what it just proposed.
 */
export function reconcileHost(state: HostState, document: GraphDocument): HostState {
  const edgeId = selectedEdgeId(state.selection);
  const selection =
    edgeId !== null && findEdge(document, edgeId) === undefined ? INITIAL_SELECTION : state.selection;
  const issueKey = selectedKey(state.selection);
  const known = new Set(document.issues.map((issue) => issue.ref));
  const draftStands =
    (state.draft.source === null || known.has(state.draft.source)) &&
    (state.draft.target === null || known.has(state.draft.target));
  if (selection === state.selection && draftStands && (issueKey === null || known.has(issueKey))) {
    return state;
  }
  return {
    ...state,
    selection: issueKey !== null && !known.has(issueKey) ? INITIAL_SELECTION : selection,
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

/** The edge kinds, in the format's order — the keyboard path's `1`–`5` is this list. */
export const KINDS: readonly EdgeField[] = EDGE_FIELDS;

/** How far the reader may scroll into the rail window before it is re-cut around them, in rows. */
export const RAIL_SLACK = 20;

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
  const offset = row - start;
  if (offset >= 0 && offset <= count - RAIL_SLACK * 2) return null;
  const lastStart = Math.max(0, total - count);
  const next = Math.min(lastStart, Math.max(0, Math.floor(row) - RAIL_SLACK));
  return next === start ? null : next;
}
