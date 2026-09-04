/**
 * Everything the re-evaluate tests build from: a rail, an order, an edit, a
 * vocabulary, and two readers over rendered markup.
 *
 * The changes under test are built by the STORE'S OWN `diffOrder` rather than
 * hand-written as `OrderChange` literals. A hand-written fixture is a second
 * statement of what a change looks like, and it goes on passing after the
 * computation it stands for has moved — which is exactly the drift a
 * presentation layer over someone else's data must not build on.
 *
 * Its own file rather than an addition to `documents.ts`: that file answers
 * "how big is this document", which is a different question and is being edited
 * by other work.
 */

import type { Mutation, OrderRow } from '@issuegraph/store';
import type { ViewerDocument } from '@issuegraph/viewer';
import assert from 'node:assert/strict';

import type { ChangeWords } from '../index.ts';

/**
 * An order over `refs`, in the given sequence.
 *
 * Ranks are 0-BASED, which is what `OrderRow` documents and NOT what the
 * viewer's rail renders — the rail is 1-based. Keeping the fixture honest about
 * the store's basis is what lets a test assert that no rank from a change ever
 * reaches the rail as a number.
 */
export function orderOf(refs: readonly string[], held: readonly string[] = []): OrderRow[] {
  const holdSet = new Set(held);
  return refs.map((ref, index) => ({
    ref,
    rank: index,
    ready: !holdSet.has(ref),
    holdReasons: holdSet.has(ref) ? ['a blocker is open'] : [],
  }));
}

/** One landed edit. Which edit it is never affects placement or the counts. */
export function editOf(mutationId = 'm1'): Mutation {
  return { mutationId, op: 'create', kind: 'blocked-by', from: 'c0-1', to: 'c0-2' };
}

/**
 * A rail with one slot per key, ranked 1-based in the order given.
 *
 * Flat and edgeless, unlike `documents.ts`'s builder, which chains every
 * component with `blocked-by` and refuses a component of one. These tests ask
 * where a chip lands rather than how big a document is, so they need arbitrary
 * keys that line up with an order's refs — which that builder's generated keys
 * cannot give them.
 */
export function railOf(keys: readonly string[]): ViewerDocument {
  return {
    issues: keys.map((key) => ({ key, title: `Issue ${key}`, open: true, priority: 2 })),
    edges: [],
    order: {
      slots: keys.map((key, index) => ({
        rank: index + 1,
        lead: key,
        members: [key],
        ready: true,
        holds: [],
      })),
      excluded: [],
    },
    cycles: [],
  };
}

/**
 * A rail whose rank-2 row is a two-member `together-with` unit.
 *
 * The unit is one ROW keyed by its lead while the order carries a row per ref,
 * so this is the shape where a chip speaks for more than one issue — and the
 * only shape that exercises attributing each fact to the member it is about.
 */
export function unitRailOf(): ViewerDocument {
  return {
    issues: ['lead', 'partner', 'other'].map((key) => ({
      key,
      title: `Issue ${key}`,
      open: true,
      priority: 2,
    })),
    edges: [{ field: 'together-with', from: 'lead', to: 'partner' }],
    order: {
      slots: [
        { rank: 1, lead: 'other', members: ['other'], ready: true, holds: [] },
        { rank: 2, lead: 'lead', members: ['lead', 'partner'], ready: true, holds: [] },
      ],
      excluded: [],
    },
    cycles: [],
  };
}

/**
 * A host vocabulary.
 *
 * Every entry is distinct and none of it is a substring of another, so an
 * assertion that finds one word cannot be satisfied by a different one.
 */
export const WORDS: ChangeWords = {
  facets: {
    moved: 'rows moved',
    promoted: 'promoted',
    'newly-held': 'newly held',
    entered: 'entered',
    left: 'left',
  },
  unchanged: 'this edit changed nothing',
  computing: 'write landed, order computing',
  dismiss: 'dismiss',
  direction: { up: 'up', down: 'down' },
};

/**
 * One rail row's markup, verbatim.
 *
 * A row carries no nested `<li>` — its children are spans and paragraphs — so
 * the first `</li>` after its opening tag closes it. The opening tag is matched
 * on `class="ig-slot"` specifically, so a delta chip (also an `<li>`, and
 * rendered before the rail) can never be picked up instead.
 */
export function railRow(markup: string, key: string): string {
  const open = markup.indexOf(`<li class="ig-slot" data-ig-key="${key}"`);
  assert.notEqual(open, -1, `no rail row for ${key}`);
  const close = markup.indexOf('</li>', open);
  assert.notEqual(close, -1, `unterminated row for ${key}`);
  return markup.slice(open, close + '</li>'.length);
}

/** Every rank the rail printed, in document order. */
export function ranks(markup: string): string[] {
  return [...markup.matchAll(/<span class="ig-rank"[^>]*>([^<]*)<\/span>/g)].map(
    (match) => match[1] ?? '',
  );
}
