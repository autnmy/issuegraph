/**
 * The host's state, as a reducer — every decision the shell makes, with no DOM.
 *
 * `@issuegraph/editor` renders and publishes: each control says what it does
 * as `data-ig-command`, and "wiring the published controls to real listeners
 * remains a mount's job and therefore a host's". This file is that job's
 * DECISIONS. The shell in `workspace.ts` reads the DOM and turns what it saw
 * into a {@link HostCommand}; this file turns the command into the next state
 * and a list of {@link HostEffect}s the shell then performs against the store.
 *
 * It composes the package's own reducers — `selectionReducer`, `scaleReducer`,
 * `createReducer`, `pickerView` — and adds only what those leave to a host:
 * which one selection is shared, when the create draft begins and ends, the
 * rail's scroll offset, the theme, the canvas mode, and the drag that turns a
 * canvas drop into a draft. Nothing here reaches a node, so all of it runs
 * under `node --test` with no DOM, which is the property the packages' own
 * reducers are shaped for and the reason this is not written into listeners.
 */

import { type EdgeField, EDGE_FIELDS, isEdgeField } from '@issuegraph/core';
import {
  type CreateDraft,
  type KeyIntent,
  type ScaleState,
  type WorkspaceSelection,
  IDLE_CREATE_DRAFT,
  INITIAL_SCALE_STATE,
  INITIAL_SELECTION,
  createReducer,
  pickerView,
  scaleReducer,
  selectedEdgeId,
  selectedKey,
  selectionReducer,
} from '@issuegraph/editor';
import type { GraphDocument, MutationId, Proposal, StoredIssue } from '@issuegraph/store';
import { findEdge } from '@issuegraph/store';

import type { NextOutcome } from './source.ts';

/** The two themes the page offers: the package default, and the README's paper theme. */
export const THEMES = Object.freeze(['default', 'paper'] as const);
export type ThemeName = (typeof THEMES)[number];

/** What the canvas zone draws: the editor's scale ladder, or the viewer's tree projection. */
export const CANVAS_MODES = Object.freeze(['neighbourhood', 'tree'] as const);
export type CanvasMode = (typeof CANVAS_MODES)[number];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface HostState {
  readonly selection: WorkspaceSelection;
  readonly scale: ScaleState;
  readonly auditFiltered: boolean;
  /** The rail window's first slot — a scroll offset in rows, never a rank. */
  readonly railStart: number;
  readonly draft: CreateDraft;
  /** What the reader has typed into the target search. */
  readonly targetQuery: string;
  readonly theme: ThemeName;
  readonly canvas: CanvasMode;
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
  theme: 'default',
  canvas: 'neighbourhood',
  drag: null,
  drop: null,
});

/**
 * What the shell saw.
 *
 * `control` carries a `data-ig-command` — the package's own vocabulary
 * (`select-edge`, `focus`, `search`, `retype`, `flip`, …) and the host's
 * (`add`, `kind`, `target`, `delete`, `retry`, …) share one channel because
 * the shell reads one attribute. `point` and `group` are the viewer's two
 * identities: a focusable issue key, and a mark naming an edge or a slot.
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
  | { readonly kind: 'dismiss-change' }
  | { readonly kind: 'arm'; readonly outcome: NextOutcome }
  | { readonly kind: 'reset' };

export interface HostResult {
  readonly state: HostState;
  readonly effects: readonly HostEffect[];
}

const OUTCOMES: ReadonlySet<string> = new Set(['apply', 'reject', 'conflict']);

function isOutcome(value: string | undefined): value is NextOutcome {
  return value !== undefined && OUTCOMES.has(value);
}

function isTheme(value: string | undefined): value is ThemeName {
  return value === 'default' || value === 'paper';
}

function isCanvasMode(value: string | undefined): value is CanvasMode {
  return value === 'neighbourhood' || value === 'tree';
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
    return settled({ ...state, draft: result.draft, selection });
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
    // --- the editor's own commands ---
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

    // --- the host's own chrome ---
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
    case 'theme':
      return isTheme(value) ? settled({ ...state, theme: value }) : settled(state);
    case 'canvas':
      return isCanvasMode(value) ? settled({ ...state, canvas: value }) : settled(state);
    case 'arm':
      return isOutcome(value) ? { state, effects: [{ kind: 'arm', outcome: value }] } : settled(state);
    case 'reset':
      return {
        state: { ...INITIAL_HOST_STATE, theme: state.theme, canvas: state.canvas },
        effects: [{ kind: 'reset' }],
      };
    default:
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
    case 'group':
      // A mark names either an edge (its store identity) or a slot (its lead).
      return findEdge(document, command.id) === undefined
        ? pointed(state, command.id)
        : selectEdge(state, command.id);
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
