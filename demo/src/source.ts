/**
 * The demo's data source: an in-memory tracker with a switch for the two
 * outcomes a happy path never produces.
 *
 * `createMemorySource` is the reference adapter and every edit applies, which is
 * exactly right for a reference — but a visitor who can only ever see the happy
 * path has been TOLD that `failed` and `conflict` behave as designed rather than
 * shown it. `createScriptedSource` is the other shipped adapter and settles only
 * when told to, which suits a test and not a page: a demo cannot ask its visitor
 * to resolve a promise.
 *
 * So this is a third adapter, and it is a HOST's adapter rather than a package
 * one: it wraps the reference source and answers the next dispatch with whatever
 * the visitor armed. Nothing about it is special-cased by the store — it
 * implements `DataSource` and nothing more, which is the point being
 * demonstrated.
 */

import { EDGE_CARDINALITY, EDGE_FIELDS } from '@issuegraph/core';
import type {
  DataSource,
  DispatchResult,
  EdgeKind,
  GraphDocument,
  IssueRef,
  Mutation,
  StoredEdge,
} from '@issuegraph/store';
import { createMemorySource, makeEdge, resultingEdge } from '@issuegraph/store';

import { introducesCycle } from './order.ts';

/**
 * What the next dispatch will answer.
 *
 * `apply` is the reference behaviour. The other two are armed by the visitor,
 * fire ONCE, and disarm themselves — a source that failed for ever would make
 * the rest of the demo unusable, and one that had to be disarmed by hand asks
 * the visitor to remember state the page should hold.
 */
export type NextOutcome = 'apply' | 'reject' | 'conflict';

/** An in-memory source whose next answer the page can choose. */
export interface DemoSource extends DataSource {
  /** The document as it stands, for the reset button and for the page's own reads. */
  current(): GraphDocument;
  /** Arm the next dispatch. Returns nothing; `armed()` reports what is set. */
  arm(outcome: NextOutcome): void;
  armed(): NextOutcome;
}

/** How the demo source is configured. */
export interface DemoSourceOptions {
  /**
   * Called whenever the armed outcome changes, INCLUDING when a dispatch
   * disarms it.
   *
   * Without it the page cannot know: the store notifies its subscribers when
   * the write is proposed, which is BEFORE the dispatch reaches this adapter
   * and disarms, so the control redraws with the outcome still armed and then
   * nothing redraws it again until the write settles. For the whole of that
   * window the page says the next write will conflict when it will apply — and
   * an edit made in the window is the one that proves the label wrong.
   */
  readonly onArmedChange?: (armed: NextOutcome) => void;

  /**
   * How long a dispatch takes to answer, in milliseconds.
   *
   * IT MUST NOT BE ZERO IN THE BROWSER, and that is a demonstration
   * requirement rather than a cosmetic one. Every path here can answer
   * immediately, and an already-settled promise resolves on the MICROTASK
   * checkpoint — which drains before the browser gets a rendering opportunity.
   * So `pending-write` and the held order, the two things the page exists to
   * show, would be created and cleared without ever painting: observable to a
   * synchronous test and invisible to a visitor, which is the worst version of
   * this because the tests go on passing.
   *
   * Tests pass `0` to stay fast, and one of them uses a non-zero value to pin
   * that the state really does survive a turn of the event loop.
   */
  readonly settleDelayMs?: number;
}

/** The default answer time: long enough to see, short enough not to annoy. */
export const DEFAULT_SETTLE_DELAY_MS = 450;

/**
 * The edge an upstream writer added while the visitor was editing, or
 * `undefined` when this document has no room for one.
 *
 * A conflict is only meaningful if the upstream document genuinely DIFFERS from
 * the one on screen — an "upstream" identical to what the store holds shows the
 * visitor a diff with nothing in it, which teaches the wrong thing about what a
 * conflict is.
 *
 * So it SEARCHES rather than reaching for one hardcoded pair. The previous
 * version added `serialize-with` between the first two open issues and returned
 * the document unchanged when that edge already existed — which a visitor
 * reaches by simply writing that edge first, after which every armed conflict
 * lied. Returning `undefined` is what lets the caller decline instead of
 * claiming a movement that did not happen.
 *
 * It is SCREENED BY THE SAME RULES AS ANY OTHER WRITE, because a fabricated
 * upstream is still a write and this adapter installs it directly. A candidate
 * that would close a dependency cycle is skipped: without that, resolving a
 * conflict could persist exactly the graph the create flow refuses, and the one
 * write in the demo that never passes a guard would be the one that breaks the
 * rule the guard exists for.
 *
 * It honours CARDINALITY, because a fabricated upstream is still a write. Every
 * field except `blocked-by` holds one reference (§4.3), so installing a second
 * one would let conflict simulation produce a document the page's own writer
 * rules refuse — the demo contradicting itself, in the direction that is
 * hardest to notice because nothing fails.
 *
 * It also skips THE VISITOR'S OWN EDIT. If the search happened to land on the
 * very edge being dispatched, upstream and local would be expressing the same
 * intended change — which is an `unchanged` outcome, not two competing
 * versions, and drawing it as a conflict teaches the opposite of what a
 * conflict is. Reachable on the seed by arming a conflict and creating
 * `decomposed-from` from #1 to #2.
 *
 * Deliberately returns the FIRST absent edge rather than a random one: a demo
 * that shows a different conflict each time is harder to talk about, and
 * determinism costs nothing here.
 */
function upstreamEdit(document: GraphDocument, mutation: Mutation): StoredEdge | undefined {
  const open = document.issues.filter((issue) => issue.state === 'open');
  const held = new Set(document.edges.map((edge) => edge.id));
  const mine = resultingEdge(document, mutation);
  if (mine !== undefined) held.add(mine.id);
  const carries = (kind: EdgeKind, from: IssueRef): boolean =>
    document.edges.some((edge) => edge.kind === kind && edge.from === from);
  for (const from of open) {
    for (const to of open) {
      if (from.ref === to.ref) continue;
      for (const kind of EDGE_FIELDS) {
        if (EDGE_CARDINALITY[kind] === 'single' && carries(kind, from.ref)) continue;
        const added: StoredEdge = makeEdge(kind, from.ref, to.ref);
        if (held.has(added.id)) continue;
        const next = { issues: document.issues, edges: [...document.edges, added] };
        if (introducesCycle(document, next)) continue;
        return added;
      }
    }
  }
  return undefined;
}

/**
 * Refuse a write that would give a single-valued field a second value (§4.3).
 *
 * `blocked-by` is the only list; every other field holds ONE reference, because
 * a writer joins a group or names a canonical by pointing at one member. Two
 * values is not a richer document, it is an ambiguous one — a reader resolves
 * it by whichever it saw last, which is a coin toss wearing a rule.
 *
 * Asked of the RESULTING edge rather than of the operation, so a `retype` into
 * an occupied field is refused exactly like a `create` — and the edge a retype
 * or flip REPLACES is excluded, because it is on its way out.
 *
 * It is the adapter's rule rather than the guard's: `EdgeGuard` answers with a
 * closed set of refusal codes describing the STORE's own structural refusals,
 * and borrowing one to carry a format rule would misreport what happened. A
 * rejection with a sentence says what is true.
 */
function cardinalityRefusal(
  document: GraphDocument,
  mutation: Mutation,
): DispatchResult | undefined {
  const resulting = resultingEdge(document, mutation);
  if (resulting === undefined) return undefined;
  if (EDGE_CARDINALITY[resulting.kind] !== 'single') return undefined;
  const replaced = mutation.op === 'retype' || mutation.op === 'flip' ? mutation.edgeId : undefined;
  const held = document.edges.find(
    (edge) =>
      edge.kind === resulting.kind &&
      edge.from === resulting.from &&
      edge.id !== resulting.id &&
      edge.id !== replaced,
  );
  if (held === undefined) return undefined;
  return {
    outcome: 'rejected',
    reason: `${held.from} already has ${held.kind} → ${held.to}, and ${held.kind} holds one reference`,
  };
}

/**
 * A data source holding one document in memory, with the two unhappy outcomes
 * reachable from the page.
 *
 * The wrapped reference source stays the authority on what applying an edit
 * MEANS. Re-implementing that here to add a switch would make the demo's
 * behaviour a second answer to a question the package has already answered.
 */
export function createDemoSource(
  seed: GraphDocument,
  options: DemoSourceOptions = {},
): DemoSource {
  const memory = createMemorySource(seed);
  const delayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
  let next: NextOutcome = 'apply';

  /** Announce the armed outcome, so a control showing it can stop being wrong. */
  const setArmed = (outcome: NextOutcome): void => {
    if (outcome === next) return;
    next = outcome;
    options.onArmedChange?.(outcome);
  };

  /**
   * Answer after a real turn of the event loop, so the optimistic state paints.
   *
   * A MACROTASK, not a microtask: the microtask queue drains before the browser
   * renders, so `Promise.resolve()` and `queueMicrotask` both leave the pending
   * state invisible. `setTimeout` is the boundary the browser paints on.
   */
  const settle = (result: DispatchResult): Promise<DispatchResult> =>
    delayMs <= 0
      ? Promise.resolve(result)
      : new Promise((resolve) => {
          setTimeout(() => resolve(result), delayMs);
        });

  return {
    current: () => memory.current(),
    arm: setArmed,
    armed: () => next,

    hydrate: () => memory.hydrate(),

    dispatch(mutation: Mutation): Promise<DispatchResult> {
      // THE WRITER RULES ARE ENFORCED HERE, and here only, because this is the
      // one place EVERY write passes through. They were enforced in the page
      // first, and that cost three rounds of review: the create button had the
      // rule, then a second create inside the settle window did not, then
      // `retry` did not — each new way to reach a write being a new place to
      // bolt the rule on, and the next unbolted one always findable.
      //
      // An adapter is a tracker, and a tracker refuses a malformed write. The
      // store also runs ONE authoritative operation at a time, so the document
      // read here is always the current one — which is why this covers the
      // in-flight case the page could not see without being told about
      // optimistic overlays.
      const refusal = cardinalityRefusal(memory.current(), mutation);
      if (refusal !== undefined) return settle(refusal);

      const armed = next;
      // Disarmed BEFORE the answer, so an armed outcome can never fire twice —
      // including on the retry the visitor is about to press, which is the whole
      // point of offering one. Announced rather than assigned, because the page
      // has already drawn itself by now and would otherwise go on displaying an
      // outcome this adapter has just spent.
      setArmed('apply');
      if (armed === 'reject') {
        return settle({
          outcome: 'rejected',
          reason: 'the tracker refused this write (armed by the demo controls)',
        });
      }
      if (armed === 'conflict') {
        const added = upstreamEdit(memory.current(), mutation);
        // NEVER REPORT A CONFLICT WITH NOTHING TO SHOW. Where no absent edge is
        // left to fabricate — a saturated document, which takes deliberate work
        // to reach — the honest answer is a refusal that says why, not a
        // conflict whose "view diff" is empty.
        if (added === undefined) {
          return settle({
            outcome: 'rejected',
            reason:
              'the demo could not fabricate an upstream change distinct from this edit: every other edge this document could hold already exists',
          });
        }
        // INSTALL IT, do not merely describe it. "The document moved upstream"
        // has to mean the SOURCE moved: the retry the conflict offers is
        // dispatched against this adapter, so an upstream that lived only in
        // the returned snapshot would be silently discarded by the very button
        // the conflict puts on screen — the visitor would resolve a conflict
        // and watch the other side's change disappear.
        return memory
          .dispatch({
            op: 'create',
            kind: added.kind,
            from: added.from,
            to: added.to,
            mutationId: `${mutation.mutationId}-upstream`,
          })
          .then(() => settle({ outcome: 'conflict', upstream: memory.current() }));
      }
      // The reference adapter answers immediately too, so its result goes
      // through the same delay rather than around it.
      return memory.dispatch(mutation).then(settle);
    },
  };
}
