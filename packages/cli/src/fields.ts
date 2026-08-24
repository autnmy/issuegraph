/**
 * What the writer can actually do with each field — DERIVED FROM THE WRITER,
 * because the answer differs per field and every place that forgets it produces
 * a silent no-op.
 *
 * Three capabilities, and they do not coincide: the splice can WRITE a field,
 * it can CLEAR one, and `renderFrontmatter` can write one into a body that has
 * no block yet. The first two are `@issuegraph/writer`'s
 * `SPLICE_FIELD_OWNERSHIP`, which this file reads rather than restates; the
 * third is every recognised field the splice does not own.
 *
 * THE CLEAR COLUMN IS THE ONE THAT BITES, and it is not an oversight in the
 * writer. `null` means "leave untouched" for `decomposed-from` and
 * `duplicate-of` — they are PROVENANCE and a dedupe VERDICT, not scheduling
 * state, so a machine refreshing its owned edges must not be able to erase them
 * by omission. For `serialize-with`, `null` means "remove"; for `blocked-by`,
 * `[]` means "remove". Same-shaped values, opposite meanings, one field apart.
 * That is the RATIONALE; which field is which is the writer's table.
 *
 * WHY THIS FILE EXISTS RATHER THAN THE RULE BEING SPELLED AT EACH SITE. The
 * first version of this package offered a `--no-<field>` flag for all seven,
 * which meant five of them accepted a clear the libraries cannot perform and
 * exited 0 having changed nothing. That is the exact defect this package exists
 * to refuse — a command reporting success for work it did not do — rebuilt one
 * layer up. A flag table generated from these lists cannot drift back into it.
 *
 * AND WHY THE LISTS ARE NO LONGER WRITTEN HERE. They used to be typed out, and
 * a hand-maintained copy of a rule the library owns is the same defect one more
 * layer up: it cannot drift loudly, only into accepting a value the writer then
 * refuses. Four of the eleven findings on this package's own review were that.
 * The writer exports the domain now, so these ask.
 */

import { EDGE_CARDINALITY, FIELDS } from '@issuegraph/core';
import { isSpliceOwnedField, SPLICE_FIELD_OWNERSHIP, SPLICE_OWNED_FIELDS } from '@issuegraph/writer';
import type { SpliceOwnedField } from '@issuegraph/writer';

/** A frontmatter field this CLI can write, spelled as it appears in a block. */
export type WritableField = (typeof FIELDS)[number];

/**
 * The fields `spliceGeneratedEdges` owns, so they can be written into a block
 * that already exists.
 */
export const SPLICE_WRITABLE: readonly WritableField[] = SPLICE_OWNED_FIELDS;

/**
 * The fields the writer can REMOVE from an existing block. A `--no-<field>` flag
 * exists for exactly these and for no others.
 */
export const SPLICE_CLEARABLE: readonly WritableField[] = Object.freeze(
  SPLICE_OWNED_FIELDS.filter((field) => SPLICE_FIELD_OWNERSHIP[field].clearable),
);

/** The owned fields an explicit empty value does NOT clear — the refusal set. */
const SPLICE_UNCLEARABLE: readonly SpliceOwnedField[] = Object.freeze(
  SPLICE_OWNED_FIELDS.filter((field) => !SPLICE_FIELD_OWNERSHIP[field].clearable),
);

/**
 * The fields only `renderFrontmatter` can write, so they reach a body that has
 * no block yet and cannot be amended in one that has.
 *
 * The COMPLEMENT of what the splice owns, over the spec's own field list, rather
 * than a third list to keep in step: a field added to the specification lands
 * here automatically instead of falling into no list at all.
 */
export const RENDER_ONLY: readonly WritableField[] = Object.freeze(
  FIELDS.filter((field) => !isSpliceOwnedField(field)),
);

/** The key names the `--edges` payload accepts, matching the writer's own surface. */
export const EDGE_JSON_KEYS = Object.freeze(
  SPLICE_OWNED_FIELDS.map((field) => SPLICE_FIELD_OWNERSHIP[field].property),
);

/** A key in the `--edges` payload. */
export type EdgeJsonKey = (typeof EDGE_JSON_KEYS)[number];

/**
 * The `--edges` keys for which an explicit `null` means REMOVE. For the others
 * the writer reads `null` as "leave untouched", so accepting one would be a
 * clear request the command silently declines to perform.
 *
 * CLEARABLE IS NOT THE SAME QUESTION AS NULL-CLEARABLE, and conflating them is
 * how this constant briefly became false. `clearable` says a field's OWN empty
 * value removes it — and for a list-valued field that value is `[]`, not `null`.
 * `blocked-by` is clearable and `blockedBy: null` is still refused, as a
 * non-array, before it ever reaches the null test. So the cardinality is asked
 * too, from `@issuegraph/core`, which already owns it: `null` is the empty value
 * exactly for the SINGLE-valued fields.
 */
export const CLEARABLE_JSON_KEYS: readonly EdgeJsonKey[] = Object.freeze(
  SPLICE_OWNED_FIELDS.filter(
    (field) => SPLICE_FIELD_OWNERSHIP[field].clearable && EDGE_CARDINALITY[field] === 'single',
  ).map((field) => SPLICE_FIELD_OWNERSHIP[field].property),
);

/**
 * The field a clear request names that the writer cannot perform, or `null`.
 *
 * ONE implementation, called by EVERY path that reaches the writer — the flag
 * collector, `setFields`, and `spliceEdges`. The first fix for this class put
 * the test inline in one of them and review found the next path still open; a
 * second inline copy is how a third path gets missed. The shape it accepts is
 * the intersection of `SetFields` and `GeneratedEdges`, which is exactly the two
 * fields at issue.
 *
 * `undefined` is NOT a clear request and never refused: absent already means
 * "leave untouched". That is also why refusing `null` costs a caller nothing —
 * the only intent `null` could express here is already expressible by omission,
 * so there is no legitimate use to break.
 *
 * IT WALKS THE WRITER'S OWN UNCLEARABLE SET rather than testing two fields by
 * name. The two `if`s it replaces were correct and were also a fourth copy of a
 * rule the writer now exports; if the writer ever makes one of them clearable,
 * or adds an owned field that is not, this follows without an edit.
 */
export function unperformableClear(edges: {
  readonly decomposedFrom?: unknown;
  readonly duplicateOf?: unknown;
}): WritableField | null {
  const request: Readonly<Record<string, unknown>> = edges;
  for (const field of SPLICE_UNCLEARABLE) {
    const { property } = SPLICE_FIELD_OWNERSHIP[field];
    if (request[property] === null) return field;
  }
  return null;
}

/**
 * Why a write request cannot proceed, or `null` when it can.
 *
 * THIS IS THE CLASS THIS PACKAGE KEPT REBUILDING, so it is worth stating once.
 * Review found, over three rounds: a `--no-` flag for a clear the writer cannot
 * perform; an unrecognised `--edges` key ignored; the same clear reaching the
 * exported `spliceEdges`; and an empty edge object accepted. Four spellings of
 * ONE defect — **a write that accepts a request it does not act on and exits 0**
 * — and each fix added the missing check at the one site that lacked it, which
 * is precisely why the next round found the next site.
 *
 * So the preconditions stop being per-site. Every write request is judged here,
 * and `performWrite` in `verbs/write.ts` is the only way to reach the writer, so
 * a new write path inherits both questions by construction rather than by its
 * author remembering them.
 */
export type WriteRefusal =
  | { readonly kind: 'nothing-requested' }
  | { readonly kind: 'unperformable-clear'; readonly field: WritableField };

export function writeRequestRefusal(request: {
  readonly decomposedFrom?: unknown;
  readonly duplicateOf?: unknown;
}): WriteRefusal | null {
  // A request naming no field asks for nothing. Returning the body unchanged at
  // exit 0 would tell a caller an edit happened; there is no edit.
  if (Object.keys(request).length === 0) return { kind: 'nothing-requested' };
  const field = unperformableClear(request);
  return field === null ? null : { kind: 'unperformable-clear', field };
}

/** Why a clear is refused, phrased once so every refusal says the same thing. */
export function clearRefusalReason(field: string): string {
  return (
    `${field} cannot be cleared from an existing block: the writer reads an empty value there as ` +
    '"leave untouched" rather than "remove", because it carries provenance or a dedupe verdict ' +
    'rather than scheduling state. Edit the block by hand if the entry really must go.'
  );
}
