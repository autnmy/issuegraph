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
 * IT LOCATES THE BLOCK WITH THE READER'S OWN RULES, not with a second scan of
 * its own: `locateBlock`, `topLevelKeyScalar` and `readMappingEntry` come from
 * `@issuegraph/reader`, so an editor and a parser cannot disagree about which
 * block is canonical, which line opens the section, or which bytes constitute
 * an entry. Every one of those three questions has produced a real defect when
 * answered twice — a splice that could not see a quoted `"issuegraph":` header
 * the parser read perfectly well, and a quoted `"blocked-by":` this writer owns
 * that it failed to recognise as its own and so duplicated.
 */

import {
  FENCE_CLOSE,
  FENCE_OPEN,
  locateBlock,
  readMappingEntry,
  stripComment,
  topLevelKeyScalar,
  type IssueRef,
} from '@issuegraph/reader';

import { parseFrontmatter } from '@issuegraph/reader';

import { renderRef } from './render.ts';

/**
 * THE POSITIVE CONTROL: hand back a body only when the block in it can still be
 * READ. Otherwise refuse, which routes the caller to the documented fallback.
 *
 * WHY THIS EXISTS RATHER THAN MORE ARMS IN THE WALK. The walk models the
 * parser's rules, and it will always model *some* of them: a section can be
 * structurally invalid in ways it does not check — a tab in the indentation, a
 * dedented child, a sequence where a mapping belongs — and for every one of
 * those the walk classified the lines happily, inserted the owned entry, and
 * returned a NON-NULL body that `parseFrontmatter` reads as `data: null`. The
 * caller then skips the `null` fallback and persists a body in which the gate it
 * just wrote is unreadable. That is the silent half-write this module's contract
 * says it makes impossible, arriving through the one door the walk cannot close
 * by enumeration — each missing arm is a correct fix and the next review finds
 * the next one.
 *
 * Asking the parser is the class removal: whatever the walk failed to model, the
 * answer here is the one the consumer will get.
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
 *     unowned `- not-a-ref` this splice preserved byte-for-byte parses with
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
 * That covers the structural faults the walk above does not model, so the
 * promise does not depend on the walk being exhaustive.
 */
export function spliceGeneratedEdges(body: string, edges: GeneratedEdges): string | null {
  const located = locateBlock(body);
  if (located.lines === null) return null;
  const lines = body.split('\n');
  const blockStart = located.startLine;
  const blockEnd = located.endLine;

  // Walk the interior with the parser's rules: first `issuegraph:` claimant at
  // indent 0 opens the section; the next indent-0 line closes it; the first
  // child sets the entry indent; deeper lines continue the entry above.
  let sectionHeader = -1;
  let sectionEnd = blockEnd;
  let sectionClosed = false;
  let childIndent = -1;
  const ownedSpans: Array<{ from: number; to: number }> = [];
  let openSpan: number | null = null;
  let lastContent = -1;
  const closeSpan = (): void => {
    if (openSpan !== null) {
      ownedSpans.push({ from: openSpan, to: lastContent });
      openSpan = null;
    }
  };
  for (let i = blockStart + 1; i < blockEnd; i++) {
    // STRIP THE COMMENT BEFORE CLASSIFYING, because the parse walk does — and
    // this line is CLASSIFICATION ONLY. The output below writes `lines[i]`
    // verbatim, so the author's comment bytes are never at risk from this.
    //
    // Skipping this step was a live defect twice over. A section child that is
    // wholly a comment (`  # why`) reached `readMappingEntry`, came back null,
    // and — since an unreadable child is structural — the whole splice was
    // refused on a block the parser reads perfectly well. The caller then took
    // the documented `null` fallback and prepended a FRESH block, which makes
    // the author's original block a later claimant: canonical no longer, so its
    // unowned fields go silently invisible. And a comment at INDENT ZERO closed
    // the section early, so every entry below it stopped being editable.
    const content = stripComment((lines[i] ?? '').replace(/\r$/, '')).trimEnd();
    if (content.trim().length === 0) continue;
    const indent = content.length - content.trimStart().length;
    if (indent === 0) {
      if (sectionHeader === -1) {
        const headerScalar = topLevelKeyScalar(content);
        if (headerScalar !== null) {
          // AN INLINE VALUE ON THE KEY MAKES THE PARSER REFUSE THE WHOLE BLOCK,
          // so splicing into it would hand back a body that does not parse while
          // the caller believes its edge was written — the same silent half-write
          // the child-entry arm below refuses, one line up.
          if (headerScalar.length > 0) return null;
          sectionHeader = i;
          continue;
        }
      }
      if (sectionHeader !== -1 && !sectionClosed) {
        closeSpan();
        sectionEnd = i;
        sectionClosed = true;
      }
      continue;
    }
    if (sectionHeader === -1 || sectionClosed) continue;
    if (childIndent === -1) childIndent = indent;
    if (indent === childIndent) {
      const trimmedLine = content.trim();
      if (trimmedLine.startsWith('- ') || trimmedLine === '-') {
        // An indentationless sequence item: YAML permits list items at the key's
        // OWN indent, and the parser accepts them as items of the entry above —
        // so they are a CONTINUATION here, never a new entry. Treating them as
        // entries would close an owned span before its items, orphan the dashes
        // on removal, and structurally invalidate the section for every reader.
        lastContent = i;
        continue;
      }
      closeSpan();
      const entry = readMappingEntry(trimmedLine);
      if (entry === null) {
        // A CHILD THE PARSER WILL REFUSE MAKES THIS WHOLE SPLICE A LIE, so
        // refuse it here instead. `blocked-by:[1]` — no space after the colon —
        // is not a mapping entry, so the parse walk marks the section
        // structurally invalid and returns `data: null`. A cruder reader used to
        // match that line and replace it; this one does not, so the line would
        // survive and a canonical entry be inserted beside it, handing back a
        // NON-NULL body that parses to nothing. A caller writing a `blocked-by`
        // gate would then believe it had written one — the silent half-write
        // this module exists to make impossible. Returning null is the
        // contract's documented path: the caller prepends a fresh block.
        return null;
      }
      const key = entry.key;
      if (
        (edges.blockedBy !== undefined && key === 'blocked-by') ||
        (edges.serializeWith !== undefined && key === 'serialize-with') ||
        (edges.decomposedFrom != null && key === 'decomposed-from') ||
        (edges.duplicateOf != null && key === 'duplicate-of')
      ) {
        openSpan = i;
      }
    }
    // Deeper than childIndent: continuation of the entry above — covered by
    // `lastContent` when a span is open.
    lastContent = i;
  }
  closeSpan();
  if (sectionHeader === -1) return null; // key outside the subset; the parse would be null too

  // Inserted lines: the section's own child indent, the renderer's spelling,
  // the SPEC declaration order among the owned fields.
  const pad = ' '.repeat(childIndent === -1 ? 2 : childIndent);
  const itemPad = ' '.repeat((childIndent === -1 ? 2 : childIndent) + 2);
  const ins: string[] = [];
  if (edges.blockedBy !== undefined && edges.blockedBy.length > 0) {
    ins.push(`${pad}blocked-by:`);
    for (const ref of edges.blockedBy) ins.push(`${itemPad}- ${renderRef(ref)}`);
  }
  if (edges.decomposedFrom != null) ins.push(`${pad}decomposed-from: ${renderRef(edges.decomposedFrom)}`);
  if (edges.duplicateOf != null) ins.push(`${pad}duplicate-of: ${renderRef(edges.duplicateOf)}`);
  if (edges.serializeWith != null) ins.push(`${pad}serialize-with: ${renderRef(edges.serializeWith)}`);

  const removed = new Set<number>();
  for (const span of ownedSpans) {
    for (let i = span.from; i <= span.to; i++) removed.add(i);
  }
  const insertAt = ownedSpans.length > 0 ? (ownedSpans[0] as { from: number }).from : sectionHeader + 1;

  let sectionSurvivors = 0;
  let siblingContent = 0;
  const interior: string[] = [];
  for (let i = blockStart + 1; i < blockEnd; i++) {
    if (i === insertAt) interior.push(...ins);
    if (removed.has(i)) continue;
    const line = lines[i] ?? '';
    if (i !== sectionHeader && line.replace(/\r$/, '').trim().length > 0) {
      if (i > sectionHeader && i < sectionEnd) sectionSurvivors += 1;
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
