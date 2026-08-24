/**
 * Repairing one issue body whose `issuegraph:` block exists but is INERT
 * because no `---` pair delimits it.
 *
 * WHAT GOES WRONG IN A REAL CORPUS. §4.1 lets a writer wrap the block in a code
 * fence as display armor, because a markdown-rendering tracker shows a bare
 * `---` block as a broken table. Hand-authors read the fence AS the delimiter
 * and omit the `---` pair, which reads to a parser as "no block at all".
 * Measured on one real backlog: 336 of the 369 bodies carrying the key were
 * written that way, and every edge in them was inert. `parseFrontmatter`'s
 * `undelimited` defect is the half that makes that state say so; this module is
 * the half that repairs the data.
 *
 * IT ADDS DELIMITERS AND NOTHING ELSE. The author's block is kept
 * BYTE-FOR-BYTE and wrapped in the `---` pair it was missing. Nothing is
 * re-spelled, and no line is ever removed.
 *
 * THAT IS A CORRECTION ARRIVED AT THE HARD WAY, stated so nobody reinstates the
 * alternative. This used to re-render the block from the parsed value, which
 * normalizes the spelling. But a renderer can only emit what the parser MODELS,
 * so every repair silently deleted whatever fell outside that model. Three
 * review rounds found three different populations, and the third was live in
 * the corpus:
 *
 *   1. field values the parser REJECTS (`evidence: measured`) — 11 issues;
 *   2. unrecognized EXTENSION fields, which §4.1 makes inert AND SILENT, so no
 *      diagnostic exists to detect them by;
 *   3. YAML COMMENTS inside the block — one issue carried four, recording a
 *      decision, and re-rendering would have erased them.
 *
 * Each fix was a new test for "what might be lost", which is a denylist, and it
 * grew an entry every round. Preserving the author's bytes removes the question
 * instead of answering it again: this module cannot delete anything, because it
 * only ever inserts two delimiter lines.
 *
 * The DELIMITER spelling is still not hand-invented. It is pinned to
 * {@link renderFrontmatter}'s own wrapper by a round-trip test, so if the
 * canonical form ever moves, the suite goes red rather than the corpus going
 * stale.
 *
 * IT REPAIRS ONE SHAPE AND REFUSES EVERYTHING ELSE: a block inside a code fence
 * this walk can ESTABLISH, which is §4.1's display armor and the reason an
 * inert block exists at all. An UNFENCED key is refused however well it parses,
 * because being unfenced proves nothing — an HTML comment, a `<details>` block
 * or any other container a future author reaches for makes a column-zero key
 * prose just as a fence does, and the undelimited detector models none of them.
 * Requiring the fence is positive evidence; enumerating containers is a list
 * that grows a row per review round. Measured on that same backlog: all 358
 * repair candidates are fenced and none takes the unfenced path, so this
 * authority costs nothing and closes every container at once.
 *
 * Every outcome other than `delimited` leaves the body BYTE-IDENTICAL, and the
 * caller is expected to report those numbers rather than retry them: a body
 * this cannot round-trip is one a human should look at.
 */

import {
  FENCE_CLOSE,
  FENCE_OPEN,
  parseFrontmatter,
  topLevelKeyScalar,
  type Frontmatter,
} from '@issuegraph/reader';

/**
 * What the backfill did to one body.
 *
 * - `delimited` — the block was inert and is now wrapped in the `---` pair it
 *   was missing. Its own lines are unchanged. `diagnostics` is non-empty when
 *   the parse DROPPED something (an invalid field value), which is worth
 *   reporting even though nothing was lost from the body.
 * - `already-canonical` — the block parses today; nothing to repair.
 *   `diagnostics` is non-empty on exactly the same terms as `delimited`: the
 *   parse DROPPED something. Nothing is owed to the BODY, but the declaration
 *   still says less than its author wrote, and the caller is told so.
 * - `no-block` — the body carries no `issuegraph:` key at all.
 * - `unrecoverable` — a block existed and could not be repaired with certainty.
 *   Body untouched; `diagnostics` says why.
 */
export type BackfillOutcome = 'delimited' | 'already-canonical' | 'no-block' | 'unrecoverable';

export interface BackfillResult {
  readonly outcome: BackfillOutcome;
  /** The body to write. Byte-identical to the input unless the outcome rewrote it. */
  readonly body: string;
  /** The data the repaired block declares; null when nothing was repaired. */
  readonly data: Frontmatter | null;
  readonly diagnostics: readonly string[];
}

/**
 * The wrapper a repaired block is placed in: the §4.1 display fence, then the
 * `---` pair the author omitted.
 *
 * NOT DERIVED FROM THE RENDERER AT RUNTIME, but pinned to it by test. Calling
 * the renderer here would mean rendering the parsed VALUE, which is exactly the
 * lossy path this module no longer takes; a test comparing the two forms gets
 * the anti-drift guarantee without reintroducing it.
 */
const CANONICAL_WRAPPER = { fence: '```', open: '---', close: '---' } as const;

interface InertRegion {
  /** First line index of the text to replace (the fence opener, when there is one). */
  readonly start: number;
  /** Last line index of the text to replace, inclusive. */
  readonly end: number;
  /**
   * First line index of the block's OWN lines — the line after the fence
   * opener.
   *
   * THE SPAN, NOT A COPY OF THE LINES. One review round's defect was the block
   * lines and the replaced span derived separately, so a line inside the span
   * could be absent from the replacement and therefore deleted. Carrying one
   * span and slicing from it at the single point of use makes the two unable to
   * disagree — and it is what lets the splice lift the block out of the
   * ORIGINAL string, terminators and all, rather than rejoining split lines.
   */
  readonly blockStart: number;
  /** Last line index of the block's own lines, inclusive. */
  readonly blockEnd: number;
}

/** Why a body was not repairable, when the reason is the SHAPE rather than the content. */
type LocateRefusal =
  | 'no-key'
  | 'ambiguous-key'
  | 'unfenced'
  | 'block-not-flush-with-fence'
  | 'undecidable-fence'
  | 'fence-mismatch';

/**
 * What each refusal reports, as a table rather than a branch — the same shape
 * the reader's own block-defect table uses, so adding a refusal adds a row and
 * the type system requires it.
 */
const LOCATE_REFUSAL_DIAGNOSTIC: Readonly<Record<LocateRefusal, string>> = {
  'no-key': 'backfill: the parser reports a block this walk could not locate',
  'ambiguous-key':
    'backfill: more than one issuegraph key at a line start; one of them may be a documentation example, and choosing is not this tool’s call',
  unfenced: 'backfill: the key is not inside a code fence, so nothing establishes it as frontmatter rather than prose',
  // NAMED FOR WHAT IS ACTUALLY TRUE. This used to say "the block has a fence on
  // one side only", and that sentence was false EVERY time it fired: an
  // established enclosing pair is a precondition of reaching it, because a
  // genuinely one-sided fence returns `unfenced` or `undecidable-fence` further
  // up. What it really detects is content between the block and its fence that
  // this walk will not pull inside the `---` pair — prose, or another tool's
  // top-level key. Sending a reader to look for a missing fence wastes the one
  // thing a refusal is for.
  'block-not-flush-with-fence':
    'backfill: the fence around this block is established, but something between the block and that fence is neither blank nor a comment, and this walk will not pull it inside the delimiters',
  'undecidable-fence':
    'backfill: this body’s code-fence structure is not one this walk can establish, so whether the key sits inside a fence cannot be answered',
  'fence-mismatch': 'backfill: the fence around the key is not the one the body’s fence structure pairs it with',
};

/**
 * A line that COULD open or close a CommonMark fence but that {@link FENCE_OPEN}
 * does not classify: indented, inside a blockquote or a list item, spelled with
 * tildes, or carrying an info string richer than a bare word. Its presence means
 * the column-0 scan below is looking at an incomplete set of the body's fences.
 */
const FENCE_LIKE = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*(?:`{3,}|~{3,})/;

/** One established fence: the line that opens it and the line that closes it. */
interface FencePair {
  readonly open: number;
  readonly close: number;
}

/**
 * The fence enclosing the key, `null` when none does, or a REFUSAL when the
 * body's fence structure is not one this walk can establish.
 *
 * WHY THIS IS A WALK AND NOT A COUNT. This decision used to be fence PARITY
 * above the key: every line matching the fence pattern toggled in/out, and an
 * odd count meant the key was inside a fence. Parity assumes every fence line is
 * a delimiter, and in Markdown it is not — a ``` line inside a ```` block is
 * CONTENT, because a closer must be at least as long as its opener and must
 * carry no info string. A four-backtick block quoting a literal ```yaml line
 * therefore counted two toggles, read even, and the key inside it was called
 * unfenced. A DOCUMENTATION EXAMPLE would then be delimited into a real
 * scheduling edge, and once written that edge starts blocking the issue.
 *
 * THREE ROUNDS OF REVIEW EACH FOUND A DIFFERENT FENCE SHAPE THAT SCAN GOT
 * WRONG, and each fix became the next round's finding. The pattern was the
 * finding: the surface of Markdown fence shapes is unbounded, so answering it
 * one shape at a time cannot terminate. This walk establishes the fences it can
 * and REFUSES otherwise, which removes the class rather than growing a rule per
 * shape.
 *
 * WHAT IT ESTABLISHES is the subset where the answer is not an inference:
 * backtick fences at column zero, alternating open/close, each closer at least
 * as long as its opener and carrying no info string. Any fence-like line it
 * cannot classify — indented, blockquoted, inside a list item, tilde-spelled,
 * or with an info string it does not model — is a fence this walk cannot see,
 * and its absence from the pairing is precisely the failure that produced the
 * defect, so it refuses.
 *
 * IT SETTLES AS EARLY AS IT CAN, AND THAT IS SOUNDNESS, NOT AN OPTIMISATION.
 * Fence pairing runs strictly left to right, so nothing after the answer can
 * change it: once the walk reaches the key outside any fence, or closes the
 * fence the key sits in, the question is answered and the rest of the body is
 * irrelevant to it. Refusing on a fence shape BELOW that point would refuse
 * bodies whose own block is unambiguous — three issues in the measured corpus
 * carry a clean fence around the block and an indented fence inside a list item
 * a hundred lines further down. Their answer does not depend on it, so this
 * does not ask.
 *
 * REFUSING COSTS RECALL, NOT CORRECTNESS, and the refusals are reported rather
 * than silently skipped: `unrecoverable` leaves the body byte-identical and
 * names its reason, which is the outcome a human is meant to look at.
 */
function locateEnclosingFence(lines: readonly string[], header: number): FencePair | null | 'undecidable-fence' {
  let opener: { readonly line: number; readonly length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    // Reached the key with no fence open: settled, and nothing below can reopen
    // the question.
    if (index === header && opener === null) return null;

    const line = lines[index] ?? '';
    if (!FENCE_OPEN.test(line)) {
      // Not a fence this walk models. If it LOOKS like one, the pairing is built
      // on an incomplete set and nothing it says can be trusted.
      if (FENCE_LIKE.test(line)) return 'undecidable-fence';
      continue;
    }

    const run = (/^`+/.exec(line)?.[0] ?? '').length;
    if (opener === null) {
      opener = { line: index, length: run };
      continue;
    }

    // Expecting a closer. A line carrying an info string is content, and so is a
    // run shorter than the opener's — both leave this walk unable to say where
    // the open fence ends.
    if (!FENCE_CLOSE.test(line) || run < opener.length) return 'undecidable-fence';
    if (opener.line < header && header < index) return { open: opener.line, close: index };
    opener = null;
  }

  // The key sits inside a fence that never closes, so there is no region to
  // replace and no end to splice against.
  return 'undecidable-fence';
}

/**
 * Locate the inert block: the `issuegraph:` key at a line's start, the indented
 * entries under it, and the code fence that must be established around them.
 * Returns a refusal instead whenever the shape cannot be established with
 * certainty — including when there is no fence at all.
 *
 * THE WALK STOPS AT THE FIRST NON-BLANK COLUMN-0 LINE, which is what makes it
 * safe on a body whose block is followed immediately by prose: a fence closer, a
 * `---` rule and a paragraph all sit at column 0, so none of them is absorbed.
 * Blank lines inside the run are tolerated and then trimmed back off the end, so
 * a block separated from its fence by a blank line does not carry that blank
 * into the probe.
 *
 * IT DELIBERATELY DOES NOT ABSORB A PRECEDING `---`. Bodies in the corpus carry
 * a markdown horizontal rule above the fence, which the parser reads as an
 * unclosed opening delimiter. That rule is prose and stays prose: inserting the
 * real delimiters below it leaves an intervening span that carries no key, which
 * the parser skips on its way to the block it now can see.
 *
 * IT REFUSES A SECOND KEY RATHER THAN PICKING THE FIRST, and that is a limit on
 * this module's authority rather than a parsing nicety. The parser's undelimited
 * detector is DELIBERATELY loose — its own comment says over-reporting is safe
 * because `data` is untouched either way, so a documentation example written at
 * column zero is a harmless false positive THERE. Here it would not be harmless:
 * repairing a body whose key is an example promotes prose into real scheduling
 * edges, and `blocked-by: [12]` in a code sample would start blocking the issue
 * for real. A body carrying two keys is precisely the case where one of them is
 * plausibly an example, and choosing between them is a judgement this module
 * does not get to make.
 *
 * IT REFUSES A HALF-FENCED BLOCK for the same reason it looks for the closer
 * past blank lines: splicing a complete fenced replacement into a shape whose
 * other fence line stays behind leaves a stray fence, which corrupts the
 * rendering of everything after it — and the positive control cannot see it,
 * because the block still parses.
 */
function locateInertRegion(lines: readonly string[]): InertRegion | LocateRefusal {
  const headers = lines.reduce<number[]>((found, line, index) => {
    // THE STRICT KEY RULE, not the prefilter. Building a header test out of
    // `FRONTMATTER_KEY_PATTERN` would over-match on purpose — it accepts
    // `""issuegraph:`, which the parser refuses — and counting THAT as a header
    // makes a body carrying one valid key plus one over-matched line read as
    // `ambiguous-key`, so a declaration this tool could have repaired is left
    // inert. Genuine ambiguity — two keys the parser would both read — is still
    // refused; that is the case the count exists for.
    if (topLevelKeyScalar(line) !== null) found.push(index);
    return found;
  }, []);
  if (headers.length === 0) return 'no-key';
  if (headers.length > 1) return 'ambiguous-key';
  const header = headers[0] ?? 0;

  let last = header;
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0 || /^[ \t]/.test(line)) {
      last = i;
      continue;
    }
    break;
  }
  while (last > header && (lines[last] ?? '').trim().length === 0) last--;

  // IS THE BLOCK ACTUALLY INSIDE A FENCE? ESTABLISH IT OR REFUSE — see
  // `locateEnclosingFence` for why counting cannot answer this. The answer is
  // "which established fence encloses this key", not an inference from what sits
  // next to it or from how many fence lines precede it.
  const enclosing = locateEnclosingFence(lines, header);
  if (enclosing === 'undecidable-fence') return enclosing;

  // NO FENCE, NO REPAIR — AND THIS IS THE CLASS REMOVAL, NOT A SEVENTH SHAPE.
  //
  // This used to wrap an unfenced key in a fence of its own. The trouble is what
  // an unfenced key PROVES, which is nothing: a Markdown fence is only one of
  // the containers that turn a column-zero `issuegraph:` into prose. An HTML
  // comment does it, so does a `<details>` block, so does anything else a future
  // author reaches for — and the undelimited detector models none of them,
  // because its own comment says over-reporting is safe PRECISELY BECAUSE it
  // never writes. Repairing removes that premise, and then every unmodelled
  // container is a route from hidden documentation to a live scheduling edge.
  //
  // Enumerating containers is the same losing game as enumerating fence shapes:
  // each one is a correct fix and the next round finds the next one. So the
  // authority is inverted. The block must be inside a fence this walk
  // ESTABLISHED — §4.1's display armor, and the only reason an inert block
  // exists at all — and everything else is refused. That is positive evidence
  // rather than an absence of evidence.
  //
  // It costs nothing: over the measured corpus, all 358 repair candidates are
  // inside an established fence and NOT ONE takes the unfenced path. The
  // capability being removed here repairs zero bodies and was never the
  // population this module describes — authors who wrote the fence and read it
  // AS the delimiter.
  if (enclosing === null) return 'unfenced';

  // Inside a fence: find the two lines that actually delimit it. The opener scan
  // crosses blanks and YAML comments — a fence separated from the key by
  // `# context` went unrecognized before, so a complete fenced replacement was
  // spliced INSIDE the existing fence, leaving the original opener and closer
  // around it.
  let opener = header - 1;
  while (opener >= 0) {
    const line = lines[opener] ?? '';
    if (line.trim().length === 0 || /^[ \t]*#/.test(line)) {
      opener--;
      continue;
    }
    break;
  }
  const hasOpener = opener >= 0 && FENCE_OPEN.test(lines[opener] ?? '');

  let closer = last + 1;
  while (closer < lines.length && (lines[closer] ?? '').trim().length === 0) closer++;
  const hasCloser = closer < lines.length && FENCE_CLOSE.test(lines[closer] ?? '');

  // AN ESTABLISHED FENCE ENCLOSES THE KEY, so failing to reach it from here does
  // not mean a fence is missing — it means something is IN THE WAY. The local
  // search deliberately crosses only blanks and YAML comments, so it stops at
  // prose, and at another tool's top-level key.
  //
  // STOPPING AT A SIBLING TOP-LEVEL KEY IS A KNOWN RECALL LIMIT, not a claim
  // that such a block is malformed: §4.1 explicitly permits other tools' keys in
  // the same frontmatter, and this refuses to repair one. Widening the scan to
  // the enclosing fence's own boundaries is the obvious remedy and is NOT taken
  // here, because that is the one thing the narrow span exists to prevent — it
  // pairs across prose and would pull it inside the delimiters, promoting text
  // into frontmatter. Admitting sibling keys without admitting prose needs a
  // discriminator, and a `Word: text` line of prose satisfies every cheap one.
  // That design question is #19; the refusal below is the safe direction
  // meanwhile, and it now says what is actually true.
  if (!hasOpener || !hasCloser) return 'block-not-flush-with-fence';

  // THE TWO READINGS MUST AGREE, AND THE SPAN COMES FROM THE LOCAL ONE. The
  // local search is the narrower of the two: it stops at the first line that is
  // neither blank nor a YAML comment, so it refuses a key separated from its
  // fence by prose. `locateEnclosingFence` pairs across that prose and would
  // pull it inside the delimiters. Requiring equality keeps the narrow span
  // while leaving `locateEnclosingFence` the authority on WHETHER a fence
  // encloses the key at all — the question the local search cannot answer.
  //
  // No corpus body falsifies this today, because alternation means any fence
  // line strictly between a pair's ends was consumed by the pairing. It is kept
  // as the fence around both walks: widen either one and they can disagree, and
  // this is the only thing that would notice.
  if (opener !== enclosing.open || closer !== enclosing.close) return 'fence-mismatch';

  // THE CONTENT IS DERIVED FROM THE BOUNDARIES, NOT ALONGSIDE THEM — and that is
  // the fix for a class, not one shape. The block lines used to start at the
  // header while the span moved back to the fence, so ANY line between the two
  // was inside the replaced span but absent from the replacement, and therefore
  // deleted. A leading `# context` went that way; so would a leading blank.
  // Deriving both from one span makes them unable to disagree: everything
  // strictly inside the replaced region is carried through, and the caller
  // re-wraps it in the canonical delimiters.
  return { start: opener, end: closer, blockStart: opener + 1, blockEnd: closer - 1 };
}

/** Structural equality over the parser's own value shape (refs are plain records). */
function sameData(a: Frontmatter, b: Frontmatter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The character offset at which each line of `body` begins, for a `\r?\n` split
 * of it. This is what lets the splice address the ORIGINAL string rather than a
 * rebuilt one, so line endings outside the repaired region survive untouched.
 */
function lineStartOffsets(body: string, lines: readonly string[]): number[] {
  const starts: number[] = [];
  let pos = 0;
  for (const line of lines) {
    starts.push(pos);
    pos += line.length;
    if (body.startsWith('\r\n', pos)) pos += 2;
    else if (body.startsWith('\n', pos)) pos += 1;
  }
  return starts;
}

/**
 * The terminator to use INSIDE the replacement block: whichever the body's own
 * first line break uses, so an inserted block matches its surroundings. A body
 * with no line break at all gets `\n`, which is what the renderer emits anyway.
 */
function firstLineTerminator(body: string): string {
  const index = body.indexOf('\n');
  if (index === -1) return '\n';
  return index > 0 && body[index - 1] === '\r' ? '\r\n' : '\n';
}

/**
 * Repair one issue body's inert `issuegraph:` block, or explain why it was left
 * alone. Pure: the input string is never mutated and every outcome other than
 * `delimited` returns it unchanged.
 */
export function backfillFrontmatter(body: string): BackfillResult {
  const current = parseFrontmatter(body);
  if (current.data !== null) {
    // DIAGNOSTICS ARE CARRIED HERE TOO. This arm used to return `[]`
    // unconditionally, which made the module say two different things about one
    // fact: a dropped field on the `delimited` path is reported — this type's
    // own doc calls it "worth reporting even though nothing was lost from the
    // body" — while the IDENTICAL drop on a block that already had its
    // delimiters was discarded. The loss is the same loss; only the block's
    // punctuation differed.
    //
    // `already-canonical` STILL MEANS "nothing to repair": this pass repairs
    // inert blocks, and a field drop inside a well-delimited one is not inert.
    // The fix is to stop LAUNDERING the fact, not to hand this pass a second
    // job.
    return { outcome: 'already-canonical', body, data: current.data, diagnostics: current.diagnostics };
  }
  if (current.diagnostics.length === 0) {
    return { outcome: 'no-block', body, data: null, diagnostics: [] };
  }

  const lines = body.split(/\r?\n/);
  const offsets = lineStartOffsets(body, lines);
  const region = locateInertRegion(lines);
  if (typeof region === 'string') {
    return {
      outcome: 'unrecoverable',
      body,
      data: null,
      diagnostics: [...current.diagnostics, LOCATE_REFUSAL_DIAGNOSTIC[region]],
    };
  }

  // Re-parse the lifted block under delimiters the parser accepts. This is the
  // ONLY reading of the block's meaning anywhere in this module.
  const blockLines = lines.slice(region.blockStart, region.blockEnd + 1);
  const probe = parseFrontmatter(['---', ...blockLines, '---'].join('\n'));
  if (probe.data === null) {
    return {
      outcome: 'unrecoverable',
      body,
      data: null,
      diagnostics: [...current.diagnostics, ...probe.diagnostics],
    };
  }

  // THE AUTHOR'S LINES, WRAPPED IN THE DELIMITERS THEY WERE MISSING, AND LIFTED
  // AS ONE SUBSTRING OF THE ORIGINAL BODY. There is no second path: the block is
  // never re-spelled from the parsed value, for the reason set out at the top of
  // this file. `CANONICAL_WRAPPER` is pinned against the renderer's own output
  // by test, so the delimiter form cannot drift away from it even though nothing
  // here calls the renderer.
  //
  // TAKING THE BLOCK AS TEXT RATHER THAN AS LINES IS WHAT MAKES "BYTE-FOR-BYTE"
  // TRUE. Rejoining the split lines picks ONE terminator and imposes it on every
  // line it writes, so a body whose prose is LF and whose block is CRLF came back
  // with the BLOCK's line endings rewritten — the promise at the top of this file
  // broken inside the very region it is about, and invisible to both positive
  // controls because the content and the parse are identical either way.
  // `blockText` carries whatever terminators the block arrived with,
  // `blockTerminator` is the one that followed its last line, and `eol` is used
  // ONLY for the four delimiter lines this function actually inserts.
  const eol = firstLineTerminator(body);
  const blockFrom = offsets[region.blockStart] ?? 0;
  const blockTo = (offsets[region.blockEnd] ?? 0) + (lines[region.blockEnd] ?? '').length;
  const blockText = body.slice(blockFrom, blockTo);
  const blockTerminator = body.startsWith('\r\n', blockTo) ? '\r\n' : body.startsWith('\n', blockTo) ? '\n' : eol;

  // ONE REPLACEMENT STRING, READ BY BOTH THE SPLICE AND THE CONTENT CONTROL.
  // Building the spliced text one way and the checked text another is the
  // separately-derived-span defect in a different costume: the control would
  // then be verifying something the body never receives.
  const replacementText =
    CANONICAL_WRAPPER.fence +
    eol +
    CANONICAL_WRAPPER.open +
    eol +
    blockText +
    blockTerminator +
    CANONICAL_WRAPPER.close +
    eol +
    CANONICAL_WRAPPER.fence;

  // SPLICED BY OFFSET INTO THE ORIGINAL STRING, never rebuilt by re-joining the
  // split lines. Slicing leaves everything outside `[start, end]` exactly as it
  // arrived, whatever it was — a CRLF body does not come back with thousands of
  // changed bytes in prose this function never looked at.
  const startOffset = offsets[region.start] ?? 0;
  const endOffset = (offsets[region.end] ?? 0) + (lines[region.end] ?? '').length;
  const nextBody = body.slice(0, startOffset) + replacementText + body.slice(endOffset);

  // THE SECOND POSITIVE CONTROL — CONTENT, NOT JUST DATA. The one below checks
  // that the repaired body DECLARES the same thing; this checks that it still
  // SAYS the same thing. They are different questions, and three review rounds in
  // a row found defects that only the second one can see: a rejected field value,
  // a silent extension field, and a `# context` line between the fence and the
  // key. Every one of them parsed identically before and after, so the data check
  // was satisfied while author text was being deleted.
  //
  // The test is exact: every line inside the replaced span must appear in the
  // replacement, EXCEPT a fence line, which is deliberately re-spelled from
  // ```yaml to the canonical ```. Anything else missing means the walk and the
  // replacement disagree, and nothing is written.
  const replaced = lines.slice(region.start, region.end + 1);
  const kept = new Set(replacementText.split(/\r?\n/));
  const dropped = replaced.filter((line) => !kept.has(line) && !FENCE_OPEN.test(line));
  if (dropped.length > 0) {
    return {
      outcome: 'unrecoverable',
      body,
      data: null,
      diagnostics: [
        ...current.diagnostics,
        `backfill: the replacement would drop ${String(dropped.length)} line(s) from inside the block`,
      ],
    };
  }

  // THE POSITIVE CONTROL, AND IT GUARDS FABRICATION AS WELL AS ABSENCE. "It
  // parses now" is not the test — a rewrite that invented an edge, dropped one,
  // or renumbered a ref would satisfy it exactly. The rewritten body must parse
  // AND declare the same data the probe read, or nothing is written.
  //
  // ITS TWO HALVES HAVE DIFFERENT REACH, AND THAT IS WORTH STATING RATHER THAN
  // LEAVING FOR SOMEONE TO REDISCOVER BY DELETING IT. The null check is live: a
  // splice that failed to produce a readable block takes it. The `sameData` check
  // has no falsifying input today, because the block's own lines are carried
  // through unchanged and the splice cannot change which block the parser
  // selects. It is kept as the fence around `locateInertRegion`: widen that walk,
  // and the probe and this re-read can disagree. Deleting it would remove the
  // only thing that would notice.
  const verify = parseFrontmatter(nextBody);
  if (verify.data === null || !sameData(verify.data, probe.data)) {
    return {
      outcome: 'unrecoverable',
      body,
      data: null,
      diagnostics: [
        ...current.diagnostics,
        'backfill: the rewritten body does not re-parse to the data the original block declared',
      ],
    };
  }

  return {
    outcome: 'delimited',
    body: nextBody,
    data: probe.data,
    // Nothing was lost from the BODY — the block's lines are carried through
    // unchanged — but a dropped field still means the DECLARATION says less than
    // its author wrote, and the caller reports that for adjudication.
    diagnostics: probe.diagnostics,
  };
}
