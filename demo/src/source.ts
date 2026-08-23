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

import type { DataSource, DispatchResult, GraphDocument, Mutation, StoredEdge } from '@issuegraph/store';
import { createMemorySource, makeEdge } from '@issuegraph/store';

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

/**
 * The edge an upstream writer added while the visitor was editing.
 *
 * A conflict is only meaningful if the upstream document genuinely differs from
 * the one on screen — an "upstream" identical to what the store holds would show
 * the visitor a diff with nothing in it, which teaches the wrong thing about
 * what a conflict IS.
 */
function withUpstreamEdit(document: GraphDocument): GraphDocument {
  const first = document.issues[0];
  const other = document.issues.find(
    (issue) => first !== undefined && issue.ref !== first.ref && issue.state === 'open',
  );
  if (first === undefined || other === undefined) return document;
  const added: StoredEdge = makeEdge('serialize-with', first.ref, other.ref);
  if (document.edges.some((edge) => edge.id === added.id)) return document;
  return { issues: document.issues, edges: [...document.edges, added] };
}

/**
 * A data source holding one document in memory, with the two unhappy outcomes
 * reachable from the page.
 *
 * The wrapped reference source stays the authority on what applying an edit
 * MEANS. Re-implementing that here to add a switch would make the demo's
 * behaviour a second answer to a question the package has already answered.
 */
export function createDemoSource(seed: GraphDocument): DemoSource {
  const memory = createMemorySource(seed);
  let next: NextOutcome = 'apply';

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
        return Promise.resolve({
          outcome: 'rejected',
          reason: 'the tracker refused this write (armed by the demo controls)',
        });
      }
      if (armed === 'conflict') {
        return Promise.resolve({
          outcome: 'conflict',
          upstream: withUpstreamEdit(memory.current()),
        });
      }
      return memory.dispatch(mutation);
    },
  };
}
