/**
 * What the writer can actually do with each field — as data, because the answer
 * differs per field and every place that forgets it produces a silent no-op.
 *
 * Three capabilities, and they do not coincide:
 *
 * | field             | splice can WRITE | splice can CLEAR | render can write |
 * |-------------------|------------------|------------------|------------------|
 * | `blocked-by`      | yes              | yes (`[]`)       | yes              |
 * | `serialize-with`  | yes              | yes (`null`)     | yes              |
 * | `decomposed-from` | yes              | **no**           | yes              |
 * | `duplicate-of`    | yes              | **no**           | yes              |
 * | `together-with`   | **no**           | no               | yes              |
 * | `priority`        | **no**           | no               | yes              |
 * | `evidence`        | **no**           | no               | yes              |
 *
 * THE MIDDLE COLUMN IS THE ONE THAT BITES, and it is not an oversight in the
 * writer. `spliceGeneratedEdges` documents `null` as "leave untouched" for
 * `decomposed-from` and `duplicate-of` — they are PROVENANCE and a dedupe
 * VERDICT, not scheduling state, so a machine refreshing its owned edges must
 * not be able to erase them by omission. For `serialize-with`, `null` means
 * "remove"; for `blocked-by`, `[]` means "remove". Same-shaped values, opposite
 * meanings, one field apart.
 *
 * WHY THIS FILE EXISTS RATHER THAN THE RULE BEING SPELLED AT EACH SITE. The
 * first version of this package offered a `--no-<field>` flag for all seven,
 * which meant five of them accepted a clear the libraries cannot perform and
 * exited 0 having changed nothing. That is the exact defect this package exists
 * to refuse — a command reporting success for work it did not do — rebuilt one
 * layer up. A flag table generated from these lists cannot drift back into it,
 * and the tests read the same lists rather than a copy.
 */

/** A frontmatter field this CLI can write, spelled as it appears in a block. */
export type WritableField =
  | 'blocked-by'
  | 'serialize-with'
  | 'decomposed-from'
  | 'duplicate-of'
  | 'together-with'
  | 'priority'
  | 'evidence';

/**
 * The fields `spliceGeneratedEdges` owns, so they can be written into a block
 * that already exists.
 */
export const SPLICE_WRITABLE: readonly WritableField[] = Object.freeze([
  'blocked-by',
  'serialize-with',
  'decomposed-from',
  'duplicate-of',
]);

/**
 * The fields the writer can REMOVE from an existing block. A `--no-<field>` flag
 * exists for exactly these and for no others.
 */
export const SPLICE_CLEARABLE: readonly WritableField[] = Object.freeze([
  'blocked-by',
  'serialize-with',
]);

/**
 * The fields only `renderFrontmatter` can write, so they reach a body that has
 * no block yet and cannot be amended in one that has.
 */
export const RENDER_ONLY: readonly WritableField[] = Object.freeze([
  'together-with',
  'priority',
  'evidence',
]);

/** The key names the `--edges` payload accepts, matching the writer's own surface. */
export const EDGE_JSON_KEYS = Object.freeze([
  'blockedBy',
  'serializeWith',
  'decomposedFrom',
  'duplicateOf',
] as const);

/** A key in the `--edges` payload. */
export type EdgeJsonKey = (typeof EDGE_JSON_KEYS)[number];

/**
 * The `--edges` keys for which an explicit `null` means REMOVE. For the other
 * two the writer reads `null` as "leave untouched", so accepting one would be a
 * clear request the command silently declines to perform.
 */
export const CLEARABLE_JSON_KEYS: readonly EdgeJsonKey[] = Object.freeze([
  'serializeWith',
]);

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
 */
export function unperformableClear(edges: {
  readonly decomposedFrom?: unknown;
  readonly duplicateOf?: unknown;
}): WritableField | null {
  if (edges.decomposedFrom === null) return 'decomposed-from';
  if (edges.duplicateOf === null) return 'duplicate-of';
  return null;
}

/** Why a clear is refused, phrased once so every refusal says the same thing. */
export function clearRefusalReason(field: string): string {
  return (
    `${field} cannot be cleared from an existing block: the writer reads an empty value there as ` +
    '"leave untouched" rather than "remove", because it carries provenance or a dedupe verdict ' +
    'rather than scheduling state. Edit the block by hand if the entry really must go.'
  );
}
