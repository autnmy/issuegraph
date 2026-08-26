/**
 * What the writer can actually do with each field — DERIVED FROM THE WRITER,
 * because the answer differs per field and every place that forgets it produces
 * a silent no-op.
 *
 * TWO CAPABILITIES NOW, WHERE THERE WERE THREE. The splice can WRITE a field
 * and — since [#18](https://github.com/autnmy/issuegraph/issues/18) — CLEAR
 * every field it can write, uniformly, through `{ clear: true }`. So the only
 * split left is between the fields `spliceGeneratedEdges` owns
 * (`@issuegraph/writer`'s `SPLICE_OWNED_FIELDS`, which this file reads rather
 * than restates) and the recognised fields only `renderFrontmatter` can write
 * into a body that has no block yet.
 *
 * THE CLEAR COLUMN USED TO BE THE ONE THAT BIT, and #18 removed it rather than
 * documenting it better. `null` meant "leave untouched" for `decomposed-from`
 * and `duplicate-of` and "remove" for `serialize-with` — same-shaped values,
 * opposite meanings, one field apart — so this file carried a refusal kind, a
 * narrower null-clearable list, and a shared refusal sentence, all of them
 * there to stop a command accepting a clear the library could not perform.
 * `EdgeWrite` gave removal its own spelling, every owned field became
 * clearable, and all three went with the asymmetry. What is left is the
 * TRANSLATION from this package's flat surfaces to the writer's wrapped one.
 *
 * THE FLAT SURFACES ARE DELIBERATE, not lag. A `--no-<field>` flag and an
 * `--edges` payload distinguish ABSENT from `null` on their own, so `null` can
 * safely mean *clear* at this boundary; the ambiguity `EdgeWrite` resolves is a
 * LIBRARY caller-shape problem — `x === null ? ref : null` — with no analogue
 * here. Keeping the payload flat also means no `--edges` invocation that
 * worked before #18 behaves differently after it.
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

import { FIELDS } from '@issuegraph/core';
import { SPLICE_FIELD_OWNERSHIP, SPLICE_OWNED_FIELDS } from '@issuegraph/writer';
import type { EdgeWrite, GeneratedEdges, SpliceOwnedField } from '@issuegraph/writer';

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
 *
 * IT IS THE WHOLE OWNED SET SINCE #18, and it is kept as a separate name rather
 * than collapsed into {@link SPLICE_WRITABLE} because the two answer different
 * questions — which fields can be written into an existing block, and which can
 * be removed from one. They coincide today; a field that could be written but
 * not removed would separate them again, and the flag surface reads the second.
 */
export const SPLICE_CLEARABLE: readonly WritableField[] = SPLICE_OWNED_FIELDS;

/**
 * This package's flat spelling of a write, translated to the writer's.
 *
 * ONE TRANSLATOR FOR BOTH PATHS — the `set` flags and the `--edges` payload —
 * because they make the same decision and a second copy of it is precisely the
 * defect class this file's header describes. `null` is a CLEAR here, which is
 * safe for the reason the header gives: at a flag or JSON boundary, absent and
 * `null` are already distinguishable, so `null` is not carrying two meanings.
 *
 * An empty list arrives as `{ set: [] }` rather than `{ clear: true }`. The
 * writer renders both as no lines at all and a test in that package pins them
 * equal, so this does not have to choose — and passing the caller's own value
 * through keeps the translation total rather than special-cased.
 */
export function edgeWrite<T>(value: T | null): EdgeWrite<T> {
  return value === null ? { clear: true } : { set: value };
}

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
 * Why a write request cannot proceed, or `null` when it can.
 *
 * THIS IS THE CLASS THIS PACKAGE KEPT REBUILDING, so it is worth stating once.
 * Review found, over three rounds: a `--no-` flag for a clear the writer cannot
 * perform; an unrecognised `--edges` key ignored; the same clear reaching the
 * exported `spliceEdges`; and an empty edge object accepted. (The first and
 * third are no longer reachable — #18 made every owned field clearable, so
 * there is no unperformable clear to accept. The class is unchanged; only that
 * instance of it closed.) Four spellings of
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
  | {
      readonly kind: 'unsupported-key';
      readonly key: string;
      readonly allowed: readonly string[];
    };

export function writeRequestRefusal(
  // Any write request. It used to be narrowed to the two provenance properties,
  // because the only thing read off it beyond `Object.entries` was the clear
  // test — and #18 removed that. Narrowing it further today would describe a
  // shape this function no longer inspects.
  request: object,
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

  // A THIRD ARM USED TO SIT HERE: an unperformable clear, for the two fields the
  // writer could set but not remove. #18 made every owned field clearable, so
  // the refusal has no cases and the shared sentence that phrased it is gone
  // too. Both are recorded in the header rather than kept as dead code.
  return null;
}
