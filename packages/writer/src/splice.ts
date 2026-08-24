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
function readableOrNull(body: string, next: string, intent: 'edit' | 'remove'): string | null {
  const after = parseFrontmatter(next);

  // A SPLICE MUST NEVER TURN A READABLE DECLARATION INTO AN UNREADABLE ONE,
  // and this comparison is what makes the control total rather than partial.
  //
  // The predicate below cannot see the worst case on its own, because it asks
  // only about the RESULT: a body whose block the edit destroyed so thoroughly
  // that it is no longer discoverable parses as `data: null` with NO
  // diagnostic — absence is silent by design — which is indistinguishable from
  // "this body never had a block" and slips straight through. Measured: an
  // explicit-key section (`? issuegraph` / `:` / `  priority: 1`) spliced for
  // `blocked-by` handed back a NON-NULL body in which the requested edge was
  // not written, `priority` was gone, and the reader reported no declaration at
  // all — the caller told it had succeeded. That is the silent half-write this
  // module's contract says it makes impossible.
  //
  // Asking whether the block was readable BEFORE closes it: destroying a
  // declaration is a failed write whatever the wreckage looks like afterwards.
  // The `before` parse is the only way to tell that from a body that never
  // declared anything, and the whole-block REMOVAL path below is why it is a
  // comparison rather than a flat refusal of `data: null`.
  //
  // THE INTENT IS PASSED IN RATHER THAN INFERRED, because the whole-block
  // REMOVAL path legitimately ends with no declaration at all — inferring
  // "the block vanished, so the edit failed" would refuse the one success
  // whose correct outcome is an absent block.
  if (intent === 'edit') {
    const before = parseFrontmatter(body);
    if (before.data !== null && after.data === null) return null;
  }

  return after.data === null && after.diagnostics.length > 0 ? null : next;
}

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
 * WHAT AN EXPLICIT EMPTY VALUE MEANS IS NOT UNIFORM, and the asymmetry is
 * deliberate. `blockedBy` and `serializeWith` are SCHEDULING edges, so a present
 * `[]` or `null` is an owned REMOVAL. `decomposedFrom` and `duplicateOf` are
 * PROVENANCE and VERDICT, where the established caller shape is "write it when
 * the block lacks one, never clobber one that is already there" — it passes
 * `null` precisely to mean *leave it alone*, so spending `null` on removal
 * instead would delete provenance on every refresh of a block that has it.
 * There is consequently no way to CLEAR those two through this call; that gap
 * is real and is tracked rather than closed by overloading a value that already
 * has a caller.
 *
 * WHICH FIELD IS WHICH IS {@link SPLICE_FIELD_OWNERSHIP}, NOT THIS PARAGRAPH.
 * The rule above is the RATIONALE; the table is the answer, it is exported, and
 * {@link owns} derives from it — so a consumer asks rather than reading prose,
 * and prose cannot drift away from behaviour. Restating the per-field mechanics
 * here is what made four separate copies of this rule; the notes below name
 * each field's ROLE and defer the mechanics to the table.
 */
export interface GeneratedEdges {
  /** A SCHEDULING edge. Clearable — see {@link SPLICE_FIELD_OWNERSHIP}. */
  readonly blockedBy?: readonly IssueRef[];
  /** A SCHEDULING edge. Clearable — see {@link SPLICE_FIELD_OWNERSHIP}. */
  readonly serializeWith?: IssueRef | null;
  /** PROVENANCE. Not clearable — see {@link SPLICE_FIELD_OWNERSHIP}. */
  readonly decomposedFrom?: IssueRef | null;
  /** A dedupe VERDICT (§4.3.3, §5.1). Not clearable — see {@link SPLICE_FIELD_OWNERSHIP}. */
  readonly duplicateOf?: IssueRef | null;
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

/** What this splice can do with one owned field. */
export interface SpliceFieldOwnership {
  /** The {@link GeneratedEdges} property that carries this field's value. */
  readonly property: keyof GeneratedEdges;
  /**
   * Whether an explicit empty value (`[]` for a list, `null` for a single)
   * REMOVES the entry. When `false`, an empty value means *leave untouched* and
   * there is no way to clear the field through this call.
   *
   * IT IS ALSO THE OWNERSHIP PREDICATE, which is why one flag carries both
   * facts rather than two that could disagree: a clearable field is owned when
   * its property is present at all, and a non-clearable one only when that
   * property is non-null — because for the latter, `null` is already spoken for.
   */
  readonly clearable: boolean;
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
  'blocked-by': Object.freeze({ property: 'blockedBy', clearable: true }),
  'serialize-with': Object.freeze({ property: 'serializeWith', clearable: true }),
  'decomposed-from': Object.freeze({ property: 'decomposedFrom', clearable: false }),
  'duplicate-of': Object.freeze({ property: 'duplicateOf', clearable: false }),
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
 * that table's note. `clearable` selects the predicate, for the reason
 * {@link SpliceFieldOwnership.clearable} gives.
 */
function owns(edges: GeneratedEdges, key: string): boolean {
  if (!isSpliceOwnedField(key)) return false;
  const { property, clearable } = SPLICE_FIELD_OWNERSHIP[key];
  return clearable ? edges[property] !== undefined : edges[property] != null;
}

/**
 * Splice the owned generated edges into the canonical block, returning the new
 * body — or `null` when `body` carries no closed keyed block this writer can
 * edit, in which case the caller prepends a fresh block instead (§4.1's
 * canonical position, `renderFrontmatter`'s output).
 *
 * Inserted lines adopt the section's own child indent, so an author's two- or
 * four-space style survives, and the renderer's canonical ref spelling.
 *
 * WHEN THE EDIT LEAVES NOTHING, THE WHOLE BLOCK GOES — delimiters, a directly
 * wrapping fence pair, and one following blank line — because an empty stub
 * must not survive either. When only the section empties but sibling top-level
 * keys remain, the bare `issuegraph:` header is dropped and the rest stays.
 *
 * EVERY NON-NULL RETURN IS PARSE-VERIFIED (see {@link readableOrNull}). A body
 * this hands back is one whose block a conforming reader can still read; if the
 * result would not be, the answer is `null` and the caller prepends instead.
 */
export function spliceGeneratedEdges(body: string, edges: GeneratedEdges): string | null {
  const located = locateBlock(body);
  if (located.lines === null) return null;
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
      throw new Error(
        'issuegraph splice: this block is readable but not line-editable (its section is a flow mapping), ' +
          'and it carries entries this call does not own. Returning null would send you down the prepend ' +
          'fallback, which demotes the original block and silently drops those entries. Rewrite the block ' +
          'from its parsed value instead, or leave it alone.',
      );
    }
    return null;
  }
  if (section === null) {
    // NULL NOW MEANS EXACTLY ONE THING: there is no readable section — the YAML
    // did not parse, the key is not a top-level mapping key, or its value is a
    // scalar or a sequence. Nothing readable is at stake, so the caller's
    // documented prepend loses nothing. The readable-but-uneditable case is
    // handled above and never reaches here.
    return null;
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
  const ins: string[] = [];
  if (edges.blockedBy !== undefined && edges.blockedBy.length > 0) {
    ins.push(`${pad}blocked-by:`);
    for (const ref of edges.blockedBy) ins.push(`${itemPad}- ${renderRef(ref)}`);
  }
  if (edges.decomposedFrom != null) ins.push(`${pad}decomposed-from: ${renderRef(edges.decomposedFrom)}`);
  if (edges.duplicateOf != null) ins.push(`${pad}duplicate-of: ${renderRef(edges.duplicateOf)}`);
  if (edges.serializeWith != null) ins.push(`${pad}serialize-with: ${renderRef(edges.serializeWith)}`);

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
      return readableOrNull(body, [...lines.slice(0, from), ...lines.slice(to + 1)].join('\n'), 'remove');
    }
    // The section emptied but sibling top-level content remains: drop the bare
    // `issuegraph:` header, keep the rest of the block.
    const headerLine = lines[sectionHeader] ?? '';
    const headerAt = interior.indexOf(headerLine);
    if (headerAt !== -1) interior.splice(headerAt, 1);
  }

  return readableOrNull(
    body,
    [...lines.slice(0, blockStart + 1), ...interior, ...lines.slice(blockEnd)].join('\n'),
    ins.length === 0 && sectionSurvivors === 0 ? 'remove' : 'edit',
  );
}
