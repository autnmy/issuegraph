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
import { SPLICE_FIELD_OWNERSHIP, SPLICE_OWNED_FIELDS } from '@issuegraph/writer';
import type { GeneratedEdges, SpliceOwnedField } from '@issuegraph/writer';

/**
 * Compile-time proof that a key list names EVERY key of the interface it claims
 * to cover, and no others.
 *
 * A list of key names is a restatement of a type, and a restatement drifts —
 * which is the class this whole file exists to stop, one level up. `AssertTrue`
 * turns the drift into a compile error at the declaration site: add a field to
 * `GeneratedEdges` or `SetFields` without adding it to the matching list, or
 * leave a stale entry behind, and the build fails here rather than the key being
 * silently accepted or silently refused.
 *
 * `[A] extends [B]` rather than `A extends B`: a bare conditional over a union
 * DISTRIBUTES, so a missing member would be tested one member at a time and the
 * answer would come back a union of `true | false` rather than the `false` this
 * needs. The tuple wrapper compares the unions as wholes.
 */
export type AssertTrue<T extends true> = T;
export type SameKeys<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
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

/** A field the splice does not own, so only `renderFrontmatter` can write it. */
type RenderOnlyField = Exclude<WritableField, SpliceOwnedField>;

/**
 * The render-only fields, listed DELIBERATELY and checked for totality.
 *
 * NOT A BARE COMPLEMENT OF `FIELDS`, and the difference is a real defect rather
 * than a style preference. `argv.ts` generates `set`'s option surface from
 * `[...SPLICE_WRITABLE, ...RENDER_ONLY]`, while `collectSetFields` in `run.ts`
 * handles the field names it names. A complement makes the OPTION surface grow
 * the moment a field is added to the specification, and the HANDLER does not
 * grow with it — so the new `--<field>` is parsed, accepted, and silently
 * ignored, and the command exits 0 having not done what it was asked. That is
 * the exact defect this file exists to refuse, rebuilt one layer up, and it is
 * strictly worse than the field simply being unsupported.
 *
 * The totality proof makes the divergence a BUILD ERROR instead: add a field to
 * the specification and this stops compiling until somebody classifies it, which
 * is the moment to teach `collectSetFields` about it too.
 *
 * Proved with this file's own `AssertTrue`/`SameKeys` idiom rather than a
 * `satisfies Record<...>`, so one file does not carry two ways of saying the
 * same thing. It holds in both directions, which is what `SameKeys` is for.
 */
const RENDER_ONLY_MEMBERS = Object.freeze({
  'together-with': true,
  priority: true,
  evidence: true,
});

/** @see RENDER_ONLY_MEMBERS — the compile-time totality proof, not a runtime value. */
export type RenderOnlyMembersCoverComplement = AssertTrue<
  SameKeys<keyof typeof RENDER_ONLY_MEMBERS, RenderOnlyField>
>;

/**
 * The fields only `renderFrontmatter` can write, so they reach a body that has
 * no block yet and cannot be amended in one that has.
 *
 * Ordered by the specification's own field order rather than by the literal
 * above, so the two cannot disagree about presentation.
 */
export const RENDER_ONLY: readonly WritableField[] = Object.freeze(
  FIELDS.filter((field) => field in RENDER_ONLY_MEMBERS),
);

/** The key names the `--edges` payload accepts, matching the writer's own surface. */
export const EDGE_JSON_KEYS = Object.freeze(
  SPLICE_OWNED_FIELDS.map((field) => SPLICE_FIELD_OWNERSHIP[field].property),
);

/** A key in the `--edges` payload. */
export type EdgeJsonKey = (typeof EDGE_JSON_KEYS)[number];

/**
 * The list above IS the writer's splice surface — proved, not asserted in prose.
 * This is what lets it serve as the allowlist `writeRequestRefusal` applies to a
 * splice request: an allowlist one field out of date would refuse a write the
 * writer can perform, which is the mirror image of the defect it is there for.
 *
 * IT NOW PROVES A DERIVED LIST RATHER THAN A HAND-WRITTEN ONE, which makes it
 * strictly stronger: `EDGE_JSON_KEYS` is built from the writer's own ownership
 * table, so this also fails if a property is added to `GeneratedEdges` and not
 * to that table.
 */
export type EdgeJsonKeysCoverGeneratedEdges = AssertTrue<
  SameKeys<EdgeJsonKey, keyof GeneratedEdges>
>;

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
  | { readonly kind: 'unperformable-clear'; readonly field: WritableField }
  | {
      readonly kind: 'unsupported-key';
      readonly key: string;
      readonly allowed: readonly string[];
    };

export function writeRequestRefusal(
  request: { readonly decomposedFrom?: unknown; readonly duplicateOf?: unknown },
  // The keys the operation being reached can actually act on. Passed IN rather
  // than fixed here, because the two write paths have different surfaces: `set`
  // reaches `renderFrontmatter` and owns seven fields, `splice` reaches
  // `spliceGeneratedEdges` and owns four. One shared allowlist would have to be
  // their union, and would then wave `togetherWith` through to a splice that
  // ignores it — the same silent no-op, one field further along.
  allowed: readonly string[],
): WriteRefusal | null {
  // `Object.entries` types its values `any` against an interface; re-binding
  // keeps each one `unknown`, so nothing below reads a value it has not proved.
  const entries: readonly (readonly [string, unknown])[] = Object.entries(request);

  // AN UNSUPPORTED KEY IS REFUSED, NOT IGNORED. `writeRequestRefusal` used to
  // test only that the request named SOME field, so `{ serialiseWith: ref }` —
  // one letter off — passed, the writer ignored the property it does not know,
  // and the wrapper returned the unchanged body at exit 0. TypeScript already
  // refuses that spelling in every form, including through a variable
  // (TS2561 on the literal, TS2559 on the variable), so the reachable population
  // is plain-JavaScript callers of an exported function; a published package's
  // type annotation is a promise to TypeScript callers and nothing at all to the
  // others, which is the same reasoning `@issuegraph/core`'s own predicates were
  // corrected on.
  //
  // Checked BEFORE the emptiness test would otherwise pass and before the clear
  // test, so a misspelled key is reported as itself rather than as whatever the
  // request looks like once the unknown key is disregarded.
  for (const [key] of entries) {
    if (!allowed.includes(key)) return { kind: 'unsupported-key', key, allowed };
  }

  // A request naming no field asks for nothing. Returning the body unchanged at
  // exit 0 would tell a caller an edit happened; there is no edit.
  //
  // JUDGED ON VALUES, NOT ON KEY COUNT. `{ blockedBy: undefined }` names a key
  // and asks for nothing — absent and explicitly-undefined mean the same thing
  // to every reader downstream — so counting keys let exactly one shape of
  // "nothing requested" through to a body-unchanged exit 0. Same defect, same
  // reachable population: `exactOptionalPropertyTypes` is on, so TypeScript
  // callers cannot write it either.
  if (entries.every(([, value]) => value === undefined)) return { kind: 'nothing-requested' };

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
