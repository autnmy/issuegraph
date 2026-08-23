/**
 * `@issuegraph/store` — a client store for an Issuegraph document, and the port
 * a host plugs its tracker in through.
 *
 * The package fetches nothing, authenticates nothing and persists nothing. It
 * holds the document, renders edits optimistically, dispatches every one of
 * them outward, and refuses to re-evaluate the selection order until a write
 * has actually landed.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export {
  type EdgeId,
  type EdgeKind,
  type GraphDocument,
  type IssueRef,
  type IssueState,
  type StoredEdge,
  type StoredIssue,
  edgeId,
  findEdge,
  hasIssue,
  makeEdge,
  sameEdgeSet,
  sameIssueList,
} from './model.ts';

export {
  type EdgeState,
  type InvalidCode,
  type InvalidReason,
  type Mutation,
  type MutationId,
  type Proposal,
  EDGE_STATES,
  INVALID_CODES,
  isEdgeState,
} from './mutation.ts';

export type {
  DataSource,
  DispatchResult,
  EdgeGuard,
  EdgeGuardContext,
  OrderDeriver,
  OrderRow,
} from './source.ts';

export {
  type EdgeChange,
  edgeChangeFor,
  nextDocument,
  resultingEdge,
  structuralRefusal,
} from './validity.ts';

export {
  type ProjectedEdge,
  type WriteRecord,
  anyPending,
  edgeStateOf,
  project,
  sameProjection,
  sameRecords,
} from './write.ts';

export {
  type ChangeCounts,
  type OrderChange,
  type RankDelta,
  type RankMovement,
  diffOrder,
  sameOrder,
} from './change.ts';

export {
  type HydrationStatus,
  type OrderStatus,
  type OrderView,
  type ProposalHandle,
  type Store,
  type StoreConfig,
  type StoreSnapshot,
  createStore,
} from './store.ts';

export { type MemorySource, createMemorySource } from './adapters/memory.ts';
export {
  type PendingDispatch,
  type ScriptedOutcome,
  type ScriptedSource,
  createScriptedSource,
} from './adapters/scripted.ts';
