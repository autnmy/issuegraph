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
function readableOrNull(next: string): string | null {
  const parse = parseFrontmatter(next);
  return parse.data === null && parse.diagnostics.length > 0 ? null : next;
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
 * WHAT AN EXPLICIT `null` MEANS IS NOT UNIFORM, and the asymmetry is deliberate
 * rather than an oversight — read each field's own note below rather than this
 * paragraph. `blockedBy` and `serializeWith` are SCHEDULING edges, so a present
 * `[]` or `null` is an owned REMOVAL. `decomposedFrom` and `duplicateOf` are
 * PROVENANCE and VERDICT, where the established caller shape is "write it when
 * the block lacks one, never clobber one that is already there" — it passes
 * `null` precisely to mean *leave it alone*, so spending `null` on removal
 * instead would delete provenance on every refresh of a block that has it.
 * There is consequently no way to CLEAR those two through this call; that gap
 * is real and is tracked rather than closed by overloading a value that already
 * has a caller.
 */
export interface GeneratedEdges {
  /**
   * Owned when PRESENT: existing entries are removed and a non-empty set is
   * inserted; an explicit `[]` removes without inserting. Absent = untouched.
   */
  readonly blockedBy?: readonly IssueRef[];
  /**
   * Owned when PRESENT: an existing entry is removed and a non-null ref is
   * inserted; an explicit `null` removes without inserting. Absent = untouched.
   */
  readonly serializeWith?: IssueRef | null;
  /**
   * PROVENANCE, not scheduling: absent or `null` leaves any existing
   * `decomposed-from` line completely untouched; a non-null ref replaces or
   * inserts it.
   */
  readonly decomposedFrom?: IssueRef | null;
  /**
   * A dedupe verdict (§4.3.3, §5.1). Absent or `null` leaves any existing
   * `duplicate-of` line completely untouched; a non-null ref replaces or
   * inserts it.
   */
  readonly duplicateOf?: IssueRef | null;
}

/**
 * Whether a parsed declaration carries anything a prepend would lose.
 *
 * TOTAL OVER `Frontmatter` BY CONSTRUCTION rather than a list of fields to
 * remember: every key is visited, so a field added to the format is covered the
 * day it is added instead of the round somebody notices it is missing here.
 */
function carriesAnyField(data: Frontmatter): boolean {
  return Object.values(data).some((value) => (Array.isArray(value) ? value.length > 0 : value !== null));
}

/** Whether this call owns the named field, per {@link GeneratedEdges}. */
function owns(edges: GeneratedEdges, key: string): boolean {
  switch (key) {
    case 'blocked-by':
      return edges.blockedBy !== undefined;
    case 'serialize-with':
      return edges.serializeWith !== undefined;
    case 'decomposed-from':
      return edges.decomposedFrom != null;
    case 'duplicate-of':
      return edges.duplicateOf != null;
    default:
      return false;
  }
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
  if (section === null) {
    // TWO DIFFERENT SITUATIONS REACH HERE, and `null` is the right answer to
    // only one of them.
    //
    //   - The block is one the READER also refuses (its YAML does not parse,
    //     its key is not a top-level mapping key, its section is a scalar or a
    //     sequence). Nothing readable is at stake, so `null` is correct and the
    //     caller's documented prepend loses nothing.
    //
    //   - The block READS PERFECTLY WELL and merely cannot be edited LINE BY
    //     LINE — a flow mapping, `{issuegraph: {blocked-by: ["#1"], priority: 1}}`,
    //     which is what a YAML serializer emits in flow style. Returning `null`
    //     there sends the caller down the same prepend path, and under §4.1's
    //     first-block rule the prepended block becomes canonical while the
    //     original is demoted — so every field this call did not own
    //     (`priority`, `together-with`, an unrecognised extension) SILENTLY
    //     disappears from the graph. Measured: exactly that, with zero
    //     diagnostics on either side.
    //
    // This package's discipline for the second kind is already written down —
    // a writer takes its caller's own data and fails LOUDLY rather than
    // producing an issue whose graph lies. A silent field loss is that failure
    // wearing a `null`, so it throws instead.
    //
    // ONLY WHEN SOMETHING WOULD ACTUALLY BE LOST. An empty section
    // (`issuegraph: null`) is readable and carries no field, so prepending
    // costs nothing and `null` stays correct for it.
    const parse = parseFrontmatter(body);
    if (parse.data !== null && carriesAnyField(parse.data)) {
      throw new Error(
        'issuegraph splice: this block is readable but not line-editable (its section is a flow mapping), ' +
          'and it carries fields this call does not own. Returning null would send you down the prepend ' +
          'fallback, which demotes the original block and silently drops those fields. Rewrite the block ' +
          'from its parsed value instead, or leave it alone.',
      );
    }
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
      return readableOrNull([...lines.slice(0, from), ...lines.slice(to + 1)].join('\n'));
    }
    // The section emptied but sibling top-level content remains: drop the bare
    // `issuegraph:` header, keep the rest of the block.
    const headerLine = lines[sectionHeader] ?? '';
    const headerAt = interior.indexOf(headerLine);
    if (headerAt !== -1) interior.splice(headerAt, 1);
  }

  return readableOrNull([...lines.slice(0, blockStart + 1), ...interior, ...lines.slice(blockEnd)].join('\n'));
}
