/**
 * `@issuegraph/derive` — the selection order, and the refusal that has to run
 * before a `blocked-by` write.
 *
 * It sits one layer above `@issuegraph/reader`: the reader answers what the
 * graph IS (ready set, effective priority, components, duplicates, cycles) and
 * this package answers what ORDER follows from it, with every row carrying the
 * reasons it holds the position it does.
 *
 * The two functions here are exactly the two ports `@issuegraph/store`
 * declares and deliberately does not implement — {@link deriveIssueOrder} for
 * its `OrderDeriver`, {@link wouldCycleOnBlockedBy} for its `EdgeGuard`. A
 * store that wrote either would be a second implementation of the thing the
 * reference packages exist to have one of.
 *
 * Pure throughout: no fetching, no mutation, no persistence, no clock. Nothing
 * is stored between calls, which is why two clients reading the same issue
 * bodies agree without coordinating.
 *
 * THE SURFACE IS THE TWO ENTRY POINTS A CONSUMER ACTUALLY CALLS, plus the
 * types needed to hold their results. The internals — the precedence
 * normalization, the adjacency builder, the per-issue signal resolver — stay
 * behind it. A consumer that needs one can be given it then, with a caller to
 * justify the shape; a published package cannot take an export back. Probing
 * many candidate edges cheaply is already covered: `deriveIssueOrder` returns
 * a `wouldCycle` bound to the node set it derived from.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export type {
  ConfigRankedIssue,
  DeriveIssueOrderInput,
  DerivedIssueOrder,
  ExcludedIssue,
  IssueOrderBaseRanking,
  IssueOrderConfig,
  IssueOrderSlot,
  IssuePriorityView,
  ProvenanceOrigin,
} from './order.ts';
export { deriveIssueOrder } from './order.ts';

export type { DeclaredPriorityPrecedence, PrioritySignals } from './precedence.ts';
export { DEFAULT_PRIORITY_PRECEDENCE } from './precedence.ts';

export type { WouldCycleOptions } from './cycle.ts';
export { wouldCycleOnBlockedBy } from './cycle.ts';
