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

import { EDGE_FIELDS } from '@issuegraph/core';
import type { DataSource, DispatchResult, GraphDocument, Mutation, StoredEdge } from '@issuegraph/store';
import { createMemorySource, makeEdge, resultingEdge } from '@issuegraph/store';

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

/** How the demo source is configured. Only the settle delay, so far. */
export interface DemoSourceOptions {
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
function withUpstreamEdit(document: GraphDocument, mutation: Mutation): GraphDocument | undefined {
  const open = document.issues.filter((issue) => issue.state === 'open');
  const held = new Set(document.edges.map((edge) => edge.id));
  const mine = resultingEdge(document, mutation);
  if (mine !== undefined) held.add(mine.id);
  for (const from of open) {
    for (const to of open) {
      if (from.ref === to.ref) continue;
      for (const kind of EDGE_FIELDS) {
        const added: StoredEdge = makeEdge(kind, from.ref, to.ref);
        if (held.has(added.id)) continue;
        return { issues: document.issues, edges: [...document.edges, added] };
      }
    }
  }
  return undefined;
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
    arm: (outcome: NextOutcome) => {
      next = outcome;
    },
    armed: () => next,

    hydrate: () => memory.hydrate(),

    dispatch(mutation: Mutation): Promise<DispatchResult> {
      const armed = next;
      // Disarmed BEFORE the answer, so an armed outcome can never fire twice —
      // including on the retry the visitor is about to press, which is the whole
      // point of offering one.
      next = 'apply';
      if (armed === 'reject') {
        return settle({
          outcome: 'rejected',
          reason: 'the tracker refused this write (armed by the demo controls)',
        });
      }
      if (armed === 'conflict') {
        const upstream = withUpstreamEdit(memory.current(), mutation);
        // NEVER REPORT A CONFLICT WITH NOTHING TO SHOW. Where no absent edge is
        // left to fabricate — a saturated document, which takes deliberate work
        // to reach — the honest answer is a refusal that says why, not a
        // conflict whose "view diff" is empty.
        if (upstream === undefined) {
          return settle({
            outcome: 'rejected',
            reason:
              'the demo could not fabricate an upstream change distinct from this edit: every other edge this document could hold already exists',
          });
        }
        return settle({ outcome: 'conflict', upstream });
      }
      // The reference adapter answers immediately too, so its result goes
      // through the same delay rather than around it.
      return memory.dispatch(mutation).then(settle);
    },
  };
}
