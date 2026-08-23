/**
 * The scripted adapter: asynchronous, and able to fail on purpose.
 *
 * It is a second adapter rather than the in-memory one with a flag, and the
 * structural difference is deliberate: **it does not settle until it is told
 * to.** That is the only way to observe the store mid-flight, which is the only
 * way to assert that the order stays put while a write is pending — and a flag
 * on a synchronous adapter could never provide it.
 *
 * Two audiences. Inside this package it is what induces `failed` and `conflict`
 * rather than asserting they exist. Outside it, it is the harness a host writes
 * its own adapter's tests against, which is why it ships rather than living in
 * a test file.
 */

import type { GraphDocument } from '../model.ts';
import type { Mutation, MutationId } from '../mutation.ts';
import type { DataSource, DispatchResult } from '../source.ts';

/** An edit this adapter has been handed and has not answered yet. */
export interface PendingDispatch {
  readonly mutationId: MutationId;
  readonly mutation: Mutation;
}

/**
 * What to answer with. `'applied'` is resolved against the adapter's own
 * document, so a test can say "this one lands" without restating the edges.
 */
export type ScriptedOutcome = 'applied' | DispatchResult;

/** A scripted data source, plus the controls a test or a demo drives it with. */
export interface ScriptedSource extends DataSource {
  /** Every edit handed over and not yet answered, oldest first. */
  pending(): readonly PendingDispatch[];
  /**
   * Resolves once an edit is waiting to be settled — a named one, or the next
   * one to arrive.
   *
   * A store that serialises its writes hands an edit over some time AFTER the
   * caller proposed it, so "proposed" and "the adapter has it" are two
   * different moments. Without this a caller has to guess how many microtasks
   * separate them, which is the kind of test that passes until it doesn't.
   */
  whenPending(mutationId?: MutationId): Promise<PendingDispatch>;
  /**
   * Answer the oldest unanswered edit. Throws when there is none, because
   * settling nothing is always a mistake in the caller rather than a state to
   * tolerate — and a silent no-op here would make a test pass by not running.
   */
  settleNext(outcome: ScriptedOutcome): void;
  /** Answer one specific edit, whatever order it was handed over in. */
  settle(mutationId: MutationId, outcome: ScriptedOutcome): void;
  /** Reject the oldest unanswered edit's promise outright — a crashing adapter. */
  throwNext(error: Error): void;
  /** The document as it stands. Advanced only by an `applied` settlement. */
  current(): GraphDocument;
}

interface Waiting extends PendingDispatch {
  readonly resolve: (result: DispatchResult) => void;
  readonly reject: (error: Error) => void;
}

interface Watcher {
  readonly mutationId: MutationId | undefined;
  readonly notify: (entry: PendingDispatch) => void;
}

/**
 * A data source that hands control of every settlement to its caller.
 *
 * `seed` is what it hydrates. `apply` computes the document an `'applied'`
 * settlement produces — injected rather than reimplemented here, so a test can
 * reuse an in-memory source's behaviour or supply its own without this adapter
 * growing a second copy of the edit semantics.
 */
export function createScriptedSource(
  seed: GraphDocument,
  apply: (document: GraphDocument, mutation: Mutation) => GraphDocument,
): ScriptedSource {
  let document: GraphDocument = { issues: [...seed.issues], edges: [...seed.edges] };
  const waiting: Waiting[] = [];
  let watchers: Watcher[] = [];

  function take(mutationId: MutationId | undefined): Waiting {
    const index = mutationId === undefined
      ? 0
      : waiting.findIndex((entry) => entry.mutationId === mutationId);
    const entry = index < 0 ? undefined : waiting[index];
    if (entry === undefined) {
      throw new Error(
        mutationId === undefined
          ? 'scripted source: nothing is waiting to be settled'
          : `scripted source: ${mutationId} is not waiting to be settled`,
      );
    }
    waiting.splice(index, 1);
    return entry;
  }

  function answer(entry: Waiting, outcome: ScriptedOutcome): void {
    if (outcome !== 'applied') {
      entry.resolve(outcome);
      return;
    }
    document = apply(document, entry.mutation);
    entry.resolve({ outcome: 'applied', document });
  }

  return {
    current: () => document,

    pending: () => waiting.map(({ mutationId, mutation }) => ({ mutationId, mutation })),

    hydrate: () => Promise.resolve(document),

    dispatch(mutation: Mutation): Promise<DispatchResult> {
      const settlement = new Promise<DispatchResult>((resolve, reject) => {
        waiting.push({ mutationId: mutation.mutationId, mutation, resolve, reject });
      });
      const entry = { mutationId: mutation.mutationId, mutation };
      const matched = watchers.filter(
        (watcher) => watcher.mutationId === undefined || watcher.mutationId === mutation.mutationId,
      );
      watchers = watchers.filter((watcher) => !matched.includes(watcher));
      for (const watcher of matched) watcher.notify(entry);
      return settlement;
    },

    whenPending(mutationId) {
      const already = mutationId === undefined
        ? waiting[0]
        : waiting.find((entry) => entry.mutationId === mutationId);
      if (already !== undefined) {
        return Promise.resolve({ mutationId: already.mutationId, mutation: already.mutation });
      }
      return new Promise<PendingDispatch>((resolve) => {
        watchers.push({ mutationId, notify: resolve });
      });
    },

    settleNext(outcome) {
      answer(take(undefined), outcome);
    },

    settle(mutationId, outcome) {
      answer(take(mutationId), outcome);
    },

    throwNext(error) {
      take(undefined).reject(error);
    },
  };
}
