/**
 * Refreshing the GENERATED edge fields inside a block somebody else wrote.
 *
 * A tracker's issue body is a document a human edits. A writer that owns some
 * edges — a decomposition pass that maps sibling ordinals onto the issue
 * numbers filing produced, a groomer recording a dedupe verdict — must be able
 * to refresh those without touching a single other byte, because everything
 * else in the block belongs to somebody else.
 *
 * SURGICAL IS THE CONTRACT. The format deliberately tolerates other top-level
 * YAML keys in the same `---` block and unrecognized future fields under
 * `issuegraph:` (§4.1) — author metadata a wholesale block replacement would
 * silently delete. This edits ONLY the lines of the owned entries (the entry
 * line plus its indented list items and nested continuation), inserts the
 * desired renderings at the first removed entry's position (or directly under
 * the section header), and preserves every other line BYTE-FOR-BYTE: unknown
 * children, sibling top-level keys, comments, the fence armor, even a poisoned
 * ref another writer left — its line simply stays, and a conforming reader
 * already drops it with a diagnostic.
 *
 * IT LOCATES THE BLOCK AND ITS ENTRIES WITH THE READER'S OWN PARSE, not with a
 * second scan of its own: `locateBlock` and `locateSection` come from
 * `@issuegraph/reader`, and the latter computes its line spans from the very
 * `yaml` document the parser reads. So an editor and a parser cannot disagree
 * about which block is canonical, which line opens the section, or which bytes
 * constitute an entry — there is one opinion, not two.
 *
 * THAT SEAM USED TO BE A HAND-WRITTEN LINE GRAMMAR shared between the packages
 * (`readMappingEntry`, `topLevelKeyScalar`, `stripComment`), and every one of
 * its three questions produced a real defect when answered twice: a splice that
 * could not see a quoted `"issuegraph":` header the parser read perfectly well,
 * a quoted `"blocked-by":` this writer owns that it failed to recognise as its
 * own and so duplicated, and a wholly-comment child that made it refuse a block
 * the parser reads fine. None of those is expressible now.
 */

import {
  FENCE_CLOSE,
  FENCE_OPEN,
  locateBlock,
  locateSection,
  parseFrontmatter,
  type Frontmatter,
  type IssueRef,
} from '@issuegraph/reader';

import { renderRef } from './render.ts';

/**
 * THE POSITIVE CONTROL: hand back a body only when the block in it can still be
 * READ. Otherwise refuse, which routes the caller to the documented fallback.
 *
 * WHY THIS EXISTS RATHER THAN MORE ARMS IN THE WALK. A walk models the parser's
 * rules, and it will always model *some* of them — so for every rule it misses
 * it classified the lines happily, inserted the owned entry, and returned a
 * NON-NULL body that `parseFrontmatter` reads as `data: null`. The caller then
 * skips the `null` fallback and persists a body in which the gate it just wrote
 * is unreadable. That is the silent half-write this module's contract says it
 * makes impossible, arriving through the one door enumeration cannot close.
 *
 * Asking the parser is the class removal: whatever the edit failed to model,
 * the answer here is the one the consumer will get. It stays even though the
 * location now comes from the parser too — locating an entry correctly is not
 * the same as proving the RESULT still parses, and this asserts the second.
 *
 * THE PREDICATE IS `data === null` WITH A DIAGNOSTIC, and both halves are
 * load-bearing:
 *
 *   - `data === null` ALONE would refuse the legitimate whole-block removal
 *     below — a body with no block reads as null, correctly, and that is a
 *     success.
 *   - A DIAGNOSTIC is what separates "there is no block" (null, silent) from
 *     "there is a block and nobody could read it" (null, loud). Only the second
 *     is a failed write.
 *   - It deliberately does NOT refuse on diagnostics alone: a body carrying an
 *     unowned `- "a ref"` this splice preserved byte-for-byte parses with
 *     non-null data AND a diagnostic, and refusing there would destroy the
 *     preservation guarantee one field over.
 */
function settle(
  body: string,
  next: string,
  intent: 'edit' | 'remove',
  edges: GeneratedEdges,
): SpliceResult {
  const after = parseFrontmatter(next);
  const before = parseFrontmatter(body);

  // A SPLICE MUST NEVER TURN A READABLE DECLARATION INTO AN UNREADABLE ONE.
  // The predicate below cannot see the worst case on its own, because it asks
  // only about the RESULT: a body whose block the edit destroyed so thoroughly
  // that it is no longer discoverable parses as `data: null` with NO
  // diagnostic — absence is silent by design — which is indistinguishable from
  // "this body never had a block". Measured: an explicit-key section
  // (`? issuegraph` / `:` / `  priority: 1`) spliced for `blocked-by` handed
  // back a NON-NULL body in which the requested edge was not written,
  // `priority` was gone, and the reader reported no declaration at all.
  //
  // THE INTENT IS PASSED IN RATHER THAN INFERRED, because the whole-block
  // REMOVAL path legitimately ends with no declaration at all — inferring "the
  // block vanished, so the edit failed" would refuse the one success whose
  // correct outcome is an absent block.
  if (intent === 'edit' && before.data !== null && after.data === null) {
    return {
      outcome: 'not-written',
      data: before.data,
      detail: 'the edit destroyed a declaration that was readable before it',
    };
  }

  if (after.data === null && after.diagnostics.length > 0) {
    return {
      outcome: 'not-written',
      data: before.data,
      detail: `the result is not readable: ${after.diagnostics[0] ?? 'unreadable'}`,
    };
  }

  // DID THE EDIT LAND? Everything above asks only whether the result can be
  // READ, and a body can read perfectly while containing none of what was asked
  // for. Measured: an empty INDENTED section took a fixed child indent of two,
  // so `blocked-by` was written as a SIBLING of `issuegraph:` — the body
  // parsed, the call reported success, and the edge was never in the
  // declaration. That shape passed every readability check cleanly.
  //
  // ONE MECHANICAL CHECK RATHER THAN ONE FIX PER SHAPE. Three separate review
  // findings were instances of this class, each repaired at its own site. The
  // function already knows exactly which fields it owns, so it re-reads the
  // result and compares.
  const mismatch = ownedFieldMismatch(edges, after.data);
  if (mismatch !== null) {
    return { outcome: 'not-written', data: before.data, detail: mismatch };
  }

  return { outcome: 'spliced', body: next };
}

/** Two refs, compared as the parser hands them back. */
function sameRef(a: IssueRef | null, b: IssueRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.repo === b.repo && a.id === b.id;
}

/**
 * Which owned field is not what the call asked for, if any.
 *
 * COMPARED AGAINST THE PARSER'S OWN ANSWER, so the writer's canonical spelling
 * is not restated here: a caller passing `{ repo: null, id: '9' }` gets `"#9"`
 * rendered and `{ repo: null, id: '9' }` back, and those compare equal. That
 * round-trip is already pinned by `expectedParseOfRender`, so this leans on it
 * rather than re-deriving it.
 *
 * ONLY OWNED FIELDS. A field the call did not name is left byte-untouched by
 * construction — the splice removes and reinserts owned lines only — and an
 * UNRECOGNISED field is not in `Frontmatter` at all, so it cannot be compared
 * here even in principle. Line preservation protects those; this checks what
 * this call claims to have written.
 */
function ownedFieldMismatch(edges: GeneratedEdges, after: Frontmatter | null): string | null {
  for (const key of SPLICE_OWNED_FIELDS) {
    if (!owns(edges, key)) continue;
    const { property } = SPLICE_FIELD_OWNERSHIP[key];
    if (property === 'blockedBy') {
      const wanted = written(edges.blockedBy) ?? [];
      // A NULL PARSE IS AN EMPTY DECLARATION HERE, not a failure: the
      // whole-block removal path legitimately ends with no block, and clearing
      // `blocked-by` is what asked for that.
      const got = after === null ? [] : after.blockedBy;
      const same =
        wanted.length === got.length && wanted.every((ref, i) => sameRef(ref, got[i] ?? null));
      if (!same) {
        return `blocked-by did not land: asked for ${wanted.length} ref(s), the result reads ${got.length}`;
      }
      continue;
    }
    // A CLEAR IS VERIFIED LIKE ANY OTHER WRITE, which the previous shape could
    // not express: a field whose only empty spelling meant *leave alone* had no
    // removal for this to check. `written` reads a clear as `null`, so "asked
    // for none, the result reads #7" is a reportable failure now.
    const wanted = written(edges[property]);
    const got = after === null ? null : after[property];
    if (!sameRef(wanted, got)) {
      return `${key} did not land: asked for ${wanted === null ? 'none' : renderRef(wanted)}, the result reads ${got === null ? 'none' : renderRef(got)}`;
    }
  }
  return null;
}

/**
 * How one owned field is written: a value to put there, or a request to REMOVE
 * what is there. Absence — the property not appearing on {@link GeneratedEdges}
 * at all — is the third state, and still means *leave it byte-untouched*.
 *
 * WHY A WRAPPER RATHER THAN A BARE VALUE. The bare form spent `null` on two
 * incompatible jobs one field apart. For `serialize-with` a present `null`
 * REMOVED the entry; for `decomposed-from` and `duplicate-of` it meant *leave
 * it alone*, because the established caller shape for provenance is "write it
 * when the block lacks one, never clobber one that is already there" and such a
 * caller passes `null` precisely to say so:
 *
 * ```ts
 * decomposedFrom: parsed.decomposedFrom === null ? decomposedFrom : null,
 * ```
 *
 * Reading that `null` as a removal would delete provenance on every refresh of
 * a block that has it — a silent data loss on the path the call exists to
 * serve. So `null` was taken, and those two fields had NO WAY TO CLEAR at all,
 * which is what [#18](https://github.com/autnmy/issuegraph/issues/18) reports.
 * Absent / `{ set }` / `{ clear }` are three spellings for three meanings, so
 * nothing is overloaded and all four fields read the same.
 *
 * TWO REJECTED ALTERNATIVES, because the next reader will think of both. A
 * DISTINCT SENTINEL (a `CLEAR` symbol, so `null` keeps its meaning) is cheaper
 * and leaves THREE spellings of one concept — `[]`, `null`, `CLEAR` — which is
 * the restatement problem this package has already paid for four times; a
 * symbol also cannot cross a JSON boundary, so `@issuegraph/cli` would need a
 * fourth. A SEPARATE `clearGeneratedEdges` VERB reads well and forces a caller
 * that sets one edge while clearing another into TWO calls with two independent
 * results, where the second can fail after the first already changed the body —
 * the half-written block this module's contract says it makes impossible.
 *
 * `clear?: never` / `set?: never` ON THE OPPOSITE ARM IS LOAD-BEARING. Excess
 * property checking fires only on a FRESH object literal — the same rule that
 * makes the `satisfies` POSITION matter for {@link SPLICE_FIELD_OWNERSHIP} — so
 * without them `{ set: ref, clear: true }` compiles clean the moment it arrives
 * through a variable. It is checked at runtime as well, because a published
 * package's type annotation is a promise to TypeScript callers and nothing at
 * all to JavaScript ones.
 */
export type EdgeWrite<T> =
  | { readonly set: T; readonly clear?: never }
  | { readonly clear: true; readonly set?: never };

/**
 * What a write puts in the block: the value for a `set`, and `null` for a clear
 * or for a field this call does not name.
 *
 * ONE READER FOR EVERY SITE that asks "what should be there when this is done".
 * The insert builder and {@link ownedFieldMismatch} ask the same question of
 * the same value, and answering it twice is how this package accumulated four
 * copies of its last per-field rule.
 */
function written<T>(write: EdgeWrite<T> | undefined): T | null {
  if (write === undefined || write.clear === true) return null;
  return write.set;
}
/**
 * What one splice call did — a distinguished result, because `string | null`
 * made a caller guess between outcomes that need OPPOSITE repairs.
 *
 * `null` used to mean both "there is no block, prepend one" (lossless) and
 * "I could not edit the block that is there" — and prepending in the second
 * case demotes the canonical block under §4.1's first-block rule, so every
 * field the call did not own silently disappears. #25 closed the data loss by
 * THROWING for the uneditable case, which removed the silence and left a caller
 * that wants to handle it nothing to branch on but an exception message. This
 * is the branch.
 *
 * BOTH FAILURE ARMS CARRY THE PARSED VALUE, because the one correct repair is
 * the same for both: re-render the whole block from `data` plus the edges the
 * call owns. Handing back the outcome without the value would leave the caller
 * to re-parse a body it was just told is not writable.
 *
 * THAT REPAIR IS LOSSY FOR UNRECOGNISED FIELDS, and the design should say so
 * rather than imply a clean rewrite is available: a renderer emits only what the
 * parser models, exactly as `backfillFrontmatter`'s header explains for its own
 * case. A caller that cannot accept that loss should leave the body alone.
 */
export type SpliceResult =
  /** The edit was made and verified. */
  | { readonly outcome: 'spliced'; readonly body: string }
  /**
   * No closed keyed block to edit. The documented prepend is correct and
   * lossless here, and ONLY here.
   */
  | { readonly outcome: 'no-block' }
  /**
   * Readable, but not line-editable — a flow mapping, which is what a YAML
   * serializer emits in flow style — and it carries entries this call does not
   * own. Known BEFORE anything is attempted.
   */
  | { readonly outcome: 'uneditable-block'; readonly data: Frontmatter }
  /**
   * The edit was attempted and did not land: the result stopped being readable,
   * or an owned field is not what the call asked for. Discovered AFTER, by
   * re-reading the result — which is the difference from `uneditable-block`.
   */
  | {
      readonly outcome: 'not-written';
      readonly data: Frontmatter | null;
      readonly detail: string;
    };

/**
 * The generated edge fields a writer owns for one splice call.
 *
 * OWNERSHIP IS PER-FIELD AND OPT-IN: a field the input omits is left
 * byte-untouched, because not every writer owns every edge — a groomer owns
 * `duplicate-of` on an issue whose scheduling edges belong to other writers —
 * and round-tripping parsed values back through a splice would silently launder
 * away unparseable items and exotic spellings the parser tolerates with a
 * diagnostic.
 *
 * ALL FOUR FIELDS BEHAVE IDENTICALLY, which they did not before #18: absent
 * leaves the entry alone, `{ set }` replaces or inserts, `{ clear: true }`
 * removes. {@link EdgeWrite} carries why the uniform shape replaced a bare
 * value, and which two alternatives were rejected.
 *
 * THE PER-FIELD NOTES BELOW NAME EACH FIELD'S ROLE AND NOTHING ELSE. They used
 * to state each field's clear MECHANICS too, which made them one of the four
 * copies of a rule that {@link SPLICE_FIELD_OWNERSHIP} owns — and copies of
 * that particular rule produced four of the eleven findings in #26. The role is
 * what a caller cannot derive from the table; the mechanics are what it can.
 */
export interface GeneratedEdges {
  /** A SCHEDULING edge. */
  readonly blockedBy?: EdgeWrite<readonly IssueRef[]>;
  /** A SCHEDULING edge. */
  readonly serializeWith?: EdgeWrite<IssueRef>;
  /** PROVENANCE: which issue this one was split out of (§5.2). */
  readonly decomposedFrom?: EdgeWrite<IssueRef>;
  /** A dedupe VERDICT (§4.3.3, §5.1). */
  readonly duplicateOf?: EdgeWrite<IssueRef>;
}

/**
 * The edge fields this splice can own, spelled as they appear in a block.
 *
 * `together-with` is ABSENT rather than present-and-false: the splice cannot
 * write it at all, so it is not a member of this domain. A consumer asking
 * "can I splice this?" gets `false` from {@link isSpliceOwnedField} without the
 * table needing a third state to describe a field it does not handle.
 */
export const SPLICE_OWNED_FIELDS = Object.freeze([
  'blocked-by',
  'serialize-with',
  'decomposed-from',
  'duplicate-of',
] as const);

/** An edge field {@link spliceGeneratedEdges} can own. */
export type SpliceOwnedField = (typeof SPLICE_OWNED_FIELDS)[number];

/**
 * What this splice can do with one owned field.
 *
 * IT USED TO CARRY A `clearable` FLAG, and #18 DELETED it rather than setting
 * it `true` on every row. The flag answered "does an explicit empty value
 * remove this entry" — a question {@link EdgeWrite} abolished, because
 * `{ clear: true }` removes every field and no field has an overloaded empty
 * value left. A uniformly-`true` flag would have kept four consumers reading a
 * constant, and would have left `@issuegraph/cli`'s whole clear-refusal path
 * alive with nothing to refuse.
 */
export interface SpliceFieldOwnership {
  /** The {@link GeneratedEdges} property that carries this field's value. */
  readonly property: keyof GeneratedEdges;
}

/**
 * THE SPLICE'S OWNERSHIP DOMAIN, AS DATA — the single source of truth.
 *
 * {@link owns} below derives from this, so the table is not a description of
 * the behaviour sitting alongside it: it IS the behaviour, and the splice suite
 * that covers clearing and preservation covers this table too. That is the
 * point. A table written beside a hand-maintained predicate would be one more
 * copy of a rule this package already had three of, and copies of this
 * particular rule are what produced four of the eleven findings in #26.
 *
 * `satisfies` PROVES TOTALITY IN BOTH DIRECTIONS: a field added to
 * {@link SPLICE_OWNED_FIELDS} with no row here fails to compile (TS1360), and a
 * row whose key is not a member fails too (TS1360, excess property). Neither is
 * a comment asking the next author to remember.
 *
 * IT SITS INSIDE `Object.freeze`, NOT AFTER IT, AND THAT POSITION IS THE SECOND
 * DIRECTION. Excess-property checking applies only to a FRESH object literal, so
 * `Object.freeze({…}) satisfies …` checks the freeze's RETURN VALUE — by then
 * the literal is spent, and an extra key rides through silently. Measured: with
 * the assertion outside, a bogus `'together-with'` row compiled clean, while the
 * missing-row direction failed correctly. A one-directional guard that reads as
 * two-directional is worse than none, because the comment above would be false.
 */
export const SPLICE_FIELD_OWNERSHIP = Object.freeze({
  'blocked-by': Object.freeze({ property: 'blockedBy' }),
  'serialize-with': Object.freeze({ property: 'serializeWith' }),
  'decomposed-from': Object.freeze({ property: 'decomposedFrom' }),
  'duplicate-of': Object.freeze({ property: 'duplicateOf' }),
} satisfies Readonly<Record<SpliceOwnedField, SpliceFieldOwnership>>);

const SPLICE_OWNED_FIELD_SET: ReadonlySet<string> = new Set<string>(SPLICE_OWNED_FIELDS);

/**
 * Whether a field name is one this splice can own.
 *
 * Takes `unknown` and narrows, matching `@issuegraph/core`'s predicates: these
 * are published packages, so a `string` annotation is a promise to TypeScript
 * callers and nothing at all to JavaScript ones. Set-backed, so unlike a
 * `RegExp.test` it cannot coerce its argument into an answer.
 */
export function isSpliceOwnedField(value: unknown): value is SpliceOwnedField {
  return typeof value === 'string' && SPLICE_OWNED_FIELD_SET.has(value);
}

/**
 * Whether this call owns the named field.
 *
 * DERIVED FROM {@link SPLICE_FIELD_OWNERSHIP}, not a switch restating it — see
 * that table's note.
 *
 * ONE PREDICATE FOR ALL FOUR FIELDS. It used to branch on `clearable`, because
 * a non-clearable field could only be owned when its property was non-`null` —
 * `null` there meant *leave alone*, so treating presence as ownership would
 * have deleted the entry. {@link EdgeWrite} removed the overload, so presence
 * is now the whole question and the branch is gone with the flag.
 */
/** The parser's empty form, for an uneditable block whose YAML did not parse. */
const EMPTY_FRONTMATTER: Frontmatter = Object.freeze({
  blockedBy: [],
  decomposedFrom: null,
  duplicateOf: null,
  serializeWith: null,
  togetherWith: null,
  priority: null,
  evidence: null,
});

function owns(edges: GeneratedEdges, key: string): boolean {
  if (!isSpliceOwnedField(key)) return false;
  return edges[SPLICE_FIELD_OWNERSHIP[key].property] !== undefined;
}

/**
 * Splice the owned generated edges into the canonical block, returning a
 * {@link SpliceResult}. Only `no-block` licenses the caller's prepend fallback
 * (§4.1's canonical position, `renderFrontmatter`'s output); the other two
 * failure arms need the opposite repair, which is why they are distinguished.
 *
 * Inserted lines adopt the section's own child indent, so an author's two- or
 * four-space style survives, and the renderer's canonical ref spelling.
 *
 * WHEN THE EDIT LEAVES NOTHING, THE WHOLE BLOCK GOES — delimiters, a directly
 * wrapping fence pair, and one following blank line — because an empty stub
 * must not survive either. When only the section empties but sibling top-level
 * keys remain, the bare `issuegraph:` header is dropped and the rest stays.
 *
 * EVERY `spliced` RETURN IS PARSE-VERIFIED (see {@link settle}), on BOTH
 * questions: the result still reads, AND every field this call owns is what the
 * call asked for. A body handed back is one whose block a conforming reader can
 * read and whose graph says what the caller requested.
 *
 * THE RESULT IS A UNION, NOT `string | null`. `null` conflated "there is no
 * block, prepend one" with "I could not edit the block that is there", and those
 * need opposite repairs — prepending in the second case demotes the canonical
 * block and drops every field this call does not own. See {@link SpliceResult}.
 */
/**
 * Name a value in a message, without becoming the failure being reported.
 *
 * `JSON.stringify` IS NOT AVAILABLE HERE. It throws on a bigint and on a cyclic
 * structure, and this runs on an object a DIRECT caller supplied — so the
 * obvious builder enters its rejection branch correctly and then escapes with a
 * TypeError raised while describing the value, which is the very defect the
 * rejection exists to report. `@issuegraph/cli` shipped exactly that and had to
 * fix it one line inside its own guard; this is the same formatter, local
 * because the dependency runs the other way (the CLI depends on this package).
 *
 * Nothing below reaches a `toString` a caller controls. `Object.keys` does not
 * recurse, so a cycle is fine, and `String` is applied only to primitives whose
 * conversion the VALUE cannot override.
 *
 * THE FUNCTION ARM IS NOT TIDINESS, it is the hole this formatter shipped with.
 * A function is a reference type carrying its own `toString`, and `typeof` tags
 * it `'function'` rather than `'object'` — so it fell past the object arm, past
 * the string arm, and into `String(value)`. Measured: a function with a
 * throwing `toString` made `assertEdgeWrites` escape with that function's own
 * `Error` instead of the `TypeError` naming the field, which is EXACTLY the
 * defect this formatter was written to prevent, reproduced one branch over.
 *
 * The test that was supposed to pin this used a plain arrow function, whose
 * `toString` is perfectly safe, so it passed against the broken code. Raised in
 * review; the test now carries a throwing one and keeps the plain one as a
 * control.
 *
 * Global tampering with `Number.prototype.toString` is deliberately NOT in
 * scope: a caller who does that has also broken `Object.keys`, and defending
 * against it here would buy nothing.
 */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  if (type === 'function') return 'a function';
  if (type === 'object') {
    const keys = Object.keys(value as object);
    return keys.length === 0 ? 'an object with no keys' : `an object with keys ${keys.join(', ')}`;
  }
  if (type === 'string') return `the string ${value as string}`;
  return `${type} ${String(value)}`;
}

/** Why a value is not an {@link EdgeWrite}, or `null` when it is one. */
function edgeWriteDefect(write: unknown): string | null {
  if (typeof write !== 'object' || write === null || Array.isArray(write)) {
    // Phrased as the DEFECT, like the three below it — `got 42 — a write is an
    // object` read as an assertion that it was one. Raised in review.
    return 'it is not a plain object';
  }
  const record: Readonly<Record<string, unknown>> = write as Readonly<Record<string, unknown>>;
  const setting = record['set'] !== undefined;
  const clearing = record['clear'] !== undefined;
  if (setting && clearing) return 'it names both, and they contradict each other';
  if (!setting && !clearing) return 'it names neither';
  if (clearing && record['clear'] !== true) return '`clear` is only ever `true`';
  return null;
}

/**
 * Refuse a malformed edge value BEFORE anything is read or written.
 *
 * WHY A THROW RATHER THAN A REFUSING RESULT. This module's package note states
 * the discipline: a parser takes untrusted issue text and must never throw,
 * while a writer takes its caller's own control-plane data, so a contract
 * violation is a programmer error and throws before anything is written.
 * `render.ts` already refuses a malformed ref the same way.
 *
 * WHY IT EXISTS AT ALL, given TypeScript rejects every old shape. The
 * annotation is a promise to TypeScript callers and nothing at all to
 * JavaScript ones, so the reachable population is a plain-JS caller still
 * holding the pre-#18 spelling — and for that caller the one unacceptable
 * outcome is having it read as a CLEAR, which is the exact silent data loss #18
 * was filed to prevent, arriving through the fix for it. Measured on the two
 * shapes that were silent rather than merely broken: `{ blockedBy: [ref] }`
 * spliced clean and left `blocked-by: []` — every blocker the caller was trying
 * to SET, removed — and `{ set, clear }` together took the clear. The remaining
 * shapes surfaced as a `TypeError` from inside `renderRef` or a property read
 * on `null`, naming neither the field nor the value.
 *
 * IT RUNS AHEAD OF `locateBlock`, so a call carrying one good field and one bad
 * one cannot half-apply.
 */
function assertEdgeWrites(edges: GeneratedEdges): void {
  for (const key of SPLICE_OWNED_FIELDS) {
    // Read through the ownership table and widen to `unknown` rather than
    // casting `edges` to an index signature: the table is already the single
    // source of which property carries which field, and a cast would let a
    // property that is NOT in the table be read here without anything noticing.
    const write: unknown = edges[SPLICE_FIELD_OWNERSHIP[key].property];
    if (write === undefined) continue;
    const defect = edgeWriteDefect(write);
    if (defect !== null) {
      throw new TypeError(
        `issuegraph splice: ${key} must be { set: … } or { clear: true }, got ${describeValue(write)} — ${defect}`,
      );
    }
  }
}

export function spliceGeneratedEdges(body: string, edges: GeneratedEdges): SpliceResult {
  assertEdgeWrites(edges);
  const located = locateBlock(body);
  if (located.lines === null) return { outcome: 'no-block' };
  const section = locateSection(located.lines);
  if (section !== null && !section.lineEditable) {
    // READABLE, BUT NOT EDITABLE LINE BY LINE — a flow mapping, which is what a
    // YAML serializer emits in flow style. Returning `null` here would send the
    // caller down the prepend fallback, and §4.1's first-block rule then demotes
    // this block: every entry the call does not own goes with it.
    //
    // COUNTED FROM THE SECTION'S OWN ENTRIES, not from the recognised
    // `Frontmatter`. That projection omits unrecognised fields by design, so a
    // section carrying only `{future-edge: "#5"}` reported "nothing to lose"
    // and the extension was demoted in silence — §4.1 makes such a field inert
    // to the READER, never disposable by a WRITER.
    if (section.fields.length > 0) {
      // A DISTINGUISHED ARM RATHER THAN A THROW. #25 made this throw, which
      // removed the silence and left a caller nothing to branch on but an
      // exception message — the string-matching this repo refuses everywhere
      // else. The parsed value rides along because re-rendering the block from
      // it, plus the edges this call owns, is the one correct repair.
      return { outcome: 'uneditable-block', data: parseFrontmatter(body).data ?? EMPTY_FRONTMATTER };
    }
    return { outcome: 'no-block' };
  }
  if (section === null) {
    // NULL NOW MEANS EXACTLY ONE THING: there is no readable section — the YAML
    // did not parse, the key is not a top-level mapping key, or its value is a
    // scalar or a sequence. Nothing readable is at stake, so the caller's
    // documented prepend loses nothing. The readable-but-uneditable case is
    // handled above and never reaches here.
    return { outcome: 'no-block' };
  }

  const lines = body.split('\n');
  const blockStart = located.startLine;
  const blockEnd = located.endLine;
  // `locateSection` indexes the block's INTERIOR; the edit indexes the body.
  const toBody = (interiorLine: number): number => blockStart + 1 + interiorLine;

  const sectionHeader = toBody(section.headerLine);
  const sectionEnd = toBody(section.endLine);

  const removed = new Set<number>();
  let firstOwned: number | null = null;
  for (const field of section.fields) {
    if (!owns(edges, field.key)) continue;
    const from = toBody(field.startLine);
    const to = toBody(field.endLine);
    if (firstOwned === null || from < firstOwned) firstOwned = from;
    for (let i = from; i <= to; i++) removed.add(i);
  }

  // Inserted lines: the section's own child indent, the renderer's spelling,
  // the SPEC declaration order among the owned fields.
  const pad = ' '.repeat(section.childIndent);
  const itemPad = ' '.repeat(section.childIndent + 2);
  // A CLEAR INSERTS NOTHING; the removal above is the whole edit. `written`
  // reads both a clear and an unnamed field as "nothing goes here", so one
  // emptiness test covers all three cases rather than one per field.
  //
  // `{ set: [] }` AND `{ clear: true }` PRODUCE THE SAME BYTES on `blockedBy`,
  // deliberately. A list with no entries renders no lines, so the two are one
  // outcome; refusing either would be a rule with no defect behind it. A test
  // pins that they agree, so the equivalence cannot drift into a difference.
  const ins: string[] = [];
  const blockedBy = written(edges.blockedBy) ?? [];
  const decomposedFrom = written(edges.decomposedFrom);
  const duplicateOf = written(edges.duplicateOf);
  const serializeWith = written(edges.serializeWith);
  if (blockedBy.length > 0) {
    ins.push(`${pad}blocked-by:`);
    for (const ref of blockedBy) ins.push(`${itemPad}- ${renderRef(ref)}`);
  }
  if (decomposedFrom !== null) ins.push(`${pad}decomposed-from: ${renderRef(decomposedFrom)}`);
  if (duplicateOf !== null) ins.push(`${pad}duplicate-of: ${renderRef(duplicateOf)}`);
  if (serializeWith !== null) ins.push(`${pad}serialize-with: ${renderRef(serializeWith)}`);

  const insertAt = firstOwned ?? sectionHeader + 1;

  let sectionSurvivors = 0;
  let siblingContent = 0;
  const interior: string[] = [];
  for (let i = blockStart + 1; i < blockEnd; i++) {
    if (i === insertAt) interior.push(...ins);
    if (removed.has(i)) continue;
    const line = lines[i] ?? '';
    if (i !== sectionHeader && line.replace(/\r$/, '').trim().length > 0) {
      if (i > sectionHeader && i <= sectionEnd) sectionSurvivors += 1;
      else siblingContent += 1;
    }
    interior.push(line);
  }
  if (insertAt >= blockEnd) interior.push(...ins);

  if (ins.length === 0 && sectionSurvivors === 0) {
    if (siblingContent === 0) {
      // Nothing left at all: remove the whole block, its fence armor, and one
      // following blank line — an empty stub must not survive.
      let from = blockStart;
      let to = blockEnd;
      const above = from > 0 ? (lines[from - 1] ?? '').trimEnd() : null;
      const below = to + 1 < lines.length ? (lines[to + 1] ?? '').trimEnd() : null;
      if (above !== null && below !== null && FENCE_OPEN.test(above) && FENCE_CLOSE.test(below)) {
        from -= 1;
        to += 1;
      }
      if (to + 1 < lines.length && (lines[to + 1] as string).trim() === '') to += 1;
      return settle(body, [...lines.slice(0, from), ...lines.slice(to + 1)].join('\n'), 'remove', edges);
    }
    // The section emptied but sibling top-level content remains: drop the bare
    // `issuegraph:` header, keep the rest of the block.
    const headerLine = lines[sectionHeader] ?? '';
    const headerAt = interior.indexOf(headerLine);
    if (headerAt !== -1) interior.splice(headerAt, 1);
  }

  return settle(
    body,
    [...lines.slice(0, blockStart + 1), ...interior, ...lines.slice(blockEnd)].join('\n'),
    ins.length === 0 && sectionSurvivors === 0 ? 'remove' : 'edit',
    edges,
  );
}
