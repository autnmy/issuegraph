/**
 * Reading the Issuegraph frontmatter block out of an issue body (SPEC §4).
 *
 * An issue body MAY open with standard `---`-delimited YAML frontmatter
 * namespaced under a top-level `issuegraph` key. Trackers that render markdown
 * sometimes show the block wrapped in a plain code fence as display armor, so
 * §4.1 requires a reader to see through both a wrapping fence and any leading
 * banner. This module extracts and validates that data into a typed shape;
 * `model.ts` turns a set of those into a graph.
 *
 * PARSER POSTURE — tokenizing is delegated, and the delegation is the point:
 *
 *   - §4.1 mandates it: "Readers MUST parse the frontmatter with a plain YAML
 *     data parser (no anchors resolving to arbitrary object construction, no
 *     custom tags)." Tokenizing is `yaml`'s job, so the grammar's corners are
 *     its problem and not ours. This module decides only what the SPEC's own
 *     fields mean.
 *   - A hand-rolled grammar for an open format yields one review finding per
 *     round indefinitely. Two of them were filed as issues before the class was
 *     named; delegating removes the premise rather than adjudicating instances.
 *   - It costs this package its zero-runtime-dependency posture, which earlier
 *     revisions of this header argued for at length. That trade was made
 *     deliberately. `yaml` carries no dependencies of its own and declares
 *     `node >= 14.6`, comfortably under the `>=18` floor this package
 *     publishes — so the cost is bounded to one direct dependency, which is
 *     what made it affordable for the package everything else sits on.
 *
 * WHAT IS *NOT* DELEGATED, and must not be: locating the block. §4.1's
 * canonical-block rule — the FIRST `---`-delimited block containing the key,
 * seen through a wrapping fence and any leading banner, later claimants
 * ignored — is this specification's, not YAML's, and no frontmatter library
 * implements it. {@link locateBlock} owns that and hands `yaml` the text.
 *
 * SAFETY IS `parseDocument`, NOT `parse`, AND THE DIFFERENCE IS MEASURED. With
 * `{ customTags: [], maxAliasCount: 0 }`, an anchor throws — good — but an
 * unresolved custom tag does NOT: `blocked-by: !!python/object 1` comes back as
 * the string `"1"` with only a warning, so `parse` alone meets §4.1's anchor
 * clause and silently fails its tag clause. Refusing on `errors` OR `warnings`
 * is what closes that, and it is why this module reads a document rather than a
 * value.
 *
 * DEGRADATION RULES — this module never throws, on any input:
 *
 *   - No frontmatter, or no `issuegraph` key anywhere -> `data: null` and no
 *     diagnostics: a valid node with no edges, not an error.
 *   - A structurally unparseable block (bad delimiters, YAML that does not
 *     parse, a non-mapping under the key) -> `data: null` plus a diagnostic. An
 *     issue with a broken block is still a workable issue with no edges. BAD
 *     DELIMITERS INCLUDES NO DELIMITERS: a key wrapped in a bare ```yaml fence
 *     with the `---` pair omitted is the malformed case, not the absent one.
 *     Reporting it as absent hides the overwhelming majority of hand-authored
 *     declarations — measured on one real backlog, 336 of the 369 bodies
 *     carrying the key were written that way, and every edge in them was inert
 *     while reading byte-identically to "this issue has no block".
 *   - A recognised field with an invalid VALUE -> that field is dropped with a
 *     diagnostic; the rest of the block still parses. Unrecognised fields are
 *     inert (§4.1), silently.
 *   - Only the FIRST `---` block containing the key is canonical; later
 *     claimants are ignored (§4.1).
 */

import {
  EVIDENCE_VALUES,
  FRONTMATTER_KEY,
  PRIORITY_MAX,
  PRIORITY_MIN,
  isEvidence,
  isField,
  isPriority,
  isRefId,
  isRepoQualifier,
  type Evidence,
  type Priority,
} from '@issuegraph/core';
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  Scalar,
  type Document,
  type DocumentOptions,
  type Pair,
  type ParseOptions,
  type SchemaOptions,
} from 'yaml';

/**
 * THE PARSE OPTIONS, in one place because the posture must not differ between
 * the reader's own parse and the section location a writer asks for. Each entry
 * is load-bearing:
 *
 *   - `version: '1.2'` and `schema: 'core'` — the plain data schema. No
 *     implicit typing beyond YAML's own core types.
 *   - `customTags: []` — no tag this module did not ask for resolves to
 *     anything. On its own this is NOT sufficient; see the header.
 *
 * ALIAS REFUSAL IS NOT AN OPTION HERE, and the asymmetry is the library's
 * rather than a choice: `maxAliasCount` belongs to the value-materializing step
 * (`toJS`), not to the parse. So the parse happily produces a document
 * containing an alias node, and refusing it is {@link readDocument}'s own job.
 *
 * A FRESH OBJECT PER CALL, not a frozen constant: `yaml` types these options as
 * mutable, so a shared literal would have to be widened or cast to satisfy it —
 * and a shared mutable options object is the kind of thing that acquires a
 * caller-set field years later. One allocation per parse is not a cost worth
 * reasoning about.
 */
function yamlOptions(): ParseOptions & DocumentOptions & SchemaOptions {
  return { version: '1.2', schema: 'core', customTags: [] };
}

/**
 * The value of a node that could not be materialized. No validator accepts it,
 * so the field carrying it is dropped with a diagnostic like any other
 * unreadable value.
 */
const UNREADABLE = Symbol('issuegraph: unreadable node');

/**
 * THE ACCEPTED SPELLING OF THE BLOCK'S TOP-LEVEL KEY, and the one definition of
 * it. YAML permits whitespace between a key and its colon, so `issuegraph :`
 * and `issuegraph\t:` are the same key as `issuegraph:`, and this pattern
 * accepts all three.
 *
 * EXPORTED AS A PATTERN SOURCE RATHER THAN A COMPILED REGEX, because the same
 * decision gets made on the other side of a language boundary. A tracker mirror
 * that wants to know, in SQL, whether a body can possibly carry a block before
 * it spends a parse on it needs this rule as text — and a hand-written copy of
 * it drifts. The first two copies written against an earlier version of this
 * reader both required the contiguous substring `issuegraph:`, so an author who
 * wrote `issuegraph :` was never fetched and their declaration silently did not
 * exist.
 *
 * SO THE SYNTAX IS DELIBERATELY RESTRICTED to the subset every regex dialect
 * worth targeting spells identically: literal characters, a bracket expression,
 * and `*`. Do not add anything outside that subset without checking what else
 * derives a predicate from it — and pin the translation with a behavioural
 * test, because a shared STRING cannot prove two dialects read it the same way.
 *
 * IT OVER-MATCHES ON PURPOSE, which is why the quote handling is `*` and not
 * the `?` the grammar would suggest: `?` is outside that shared subset, and a
 * prefilter has no use for the precision. This answers "could this body carry a
 * block?", never "is this line the key". A false positive costs one parse that
 * finds nothing; a false negative means a declaration is never fetched and
 * silently does not exist. So it accepts spellings the parser will go on to
 * reject, unbalanced quotes included, and the YAML parse is what actually
 * decides. This module's test asserts the pattern is a SUPERSET of what the
 * parser accepts, which is the invariant a prefilter owes; asserting equality
 * would break the first time the two legitimately diverge.
 */
export const FRONTMATTER_KEY_PATTERN = `["']*${FRONTMATTER_KEY}["']*[ \\t]*:`;

/**
 * The accepted key LINE: {@link FRONTMATTER_KEY_PATTERN} anchored to a
 * line's start. Every in-module test of "is this the block's key line?" runs
 * through this one regex, so the rule has a single site to change.
 */
const FRONTMATTER_KEY_LINE = new RegExp(`^${FRONTMATTER_KEY_PATTERN}`);

/**
 * A reference to an issue (§4.2).
 *
 * THE IDENTIFIER IS OPAQUE AND TRACKER-SCOPED, which is the format's position
 * rather than this implementation's convenience. GitHub numbers issues; Jira
 * writes `ABC-123`; Linear writes `ENG-456`. A format admitting only integers
 * cannot describe two of those three, and §4.2 used to say in as many words
 * that no other identifier type existed — which was the defect, not a
 * simplification.
 *
 * SO `id` IS A STRING, AND IT IS DELIBERATELY NOT NAMED `number`. The field it
 * replaces was `number: number`, and widening that field's TYPE rather than
 * renaming it would have left arithmetic on it compiling: a sort tiebreak
 * subtracting two ids yields `NaN` for `ABC-123`, which is an unspecified order
 * rather than an error, in the one module whose whole purpose is that two
 * clients holding the same graph derive the same order. A rename cannot be
 * missed by a consumer; a widening can.
 *
 * BOTH SPELLINGS OF A SAME-REPO REFERENCE PRODUCE THE SAME VALUE: `123` and
 * `#123` are one reference, so `id` never carries the sigil.
 */
export interface IssueRef {
  /** `owner/repo` when the reference is qualified; null for same-repo refs. */
  readonly repo: string | null;
  /** The tracker's own identifier, without any `#` sigil. */
  readonly id: string;
}

/** Parsed, validated issuegraph frontmatter for one issue (SPEC §4.3). */
export interface Frontmatter {
  readonly blockedBy: readonly IssueRef[];
  readonly decomposedFrom: IssueRef | null;
  readonly duplicateOf: IssueRef | null;
  readonly serializeWith: IssueRef | null;
  readonly togetherWith: IssueRef | null;
  /**
   * The frontmatter's OWN priority field, or null when it is absent or was
   * dropped. This is the raw carrier, NOT the resolved declared priority —
   * carrier precedence (§4.3.5: a tracker's own convention is canonical, the
   * frontmatter field is a fallback) is the model's job, and the model needs
   * both raw carriers to be able to surface a disagreement between them.
   */
  readonly priority: Priority | null;
  /** Raw evidence carrier; resolution/defaulting is the consumer's concern. */
  readonly evidence: Evidence | null;
}

export interface ParseResult {
  readonly data: Frontmatter | null;
  /**
   * Human-readable parse diagnostics (dropped fields, malformed structure).
   *
   * THIS FIELD IS THE ONLY CARRIER OF FAILURE, so `data` alone can never answer
   * "was the declaration fully read?". Read it WITH {@link blockDefect}:
   *
   *   no block at all        -> diagnostics [],    blockDefect null         -> absent
   *   key, but no `---` pair -> diagnostics [why], blockDefect undelimited  -> inert
   *   `---` rule above fence -> diagnostics [why], blockDefect unterminated -> inert
   *   delimited, unusable    -> diagnostics [why], blockDefect null         -> not read
   *   delimited, FIELD drop  -> diagnostics [why], blockDefect null, data NON-null
   *
   * THE LAST ROW IS THE ONE READERS MISS, and it is the one that costs money:
   * `data` comes back non-null and LOOKING COMPLETE while a field was rejected.
   * `blocked-by: [123, "a ref"]` yields a list carrying only `123`, and
   * `blocked-by: ["a ref"]` yields an EMPTY list that reads exactly like a body
   * declaring no edge at all. A reader testing `data` alone reports both as
   * complete declarations — an absence rendered as a value, and the licence for a
   * false clear.
   *
   * SO: a reader that gates behaviour on a declaration must test the
   * diagnostics, and a declaration it could not fully evaluate must never be
   * treated as an absence. **Ask that question through
   * {@link isUnreadDeclaration}**, which is this rule in executable form; the
   * REASONING stays here, in the contract's own home, and the helper cites it
   * rather than restating it.
   *
   * THE PREDICATE IS SHARED; THE POLICY IS NOT. What a reader DOES about an
   * unread declaration differs every time (refuse to clear, drop a candidate,
   * refuse admission, refuse a write, report a verdict), and that is exactly
   * the part that does not factor into a helper. The question itself factors
   * perfectly, and readers hand-spelling it is how they drift apart — so it is
   * offered once, and each reader still answers it its own way.
   *
   * TEST ANY DIAGNOSTIC, NOT ONE CONCERNING YOUR FIELD. The only way to ask the
   * narrower question is to string-match this module's message prose, and a
   * reworded message would silently stop matching and fail OPEN — restoring the
   * defect invisibly. Testing for any diagnostic fails CLOSED under every future
   * wording; its cost is over-refusal when an unrelated field is malformed.
   */
  readonly diagnostics: readonly string[];
  /**
   * WHICH BLOCK-LEVEL DEFECT stopped the block being read, or null — either
   * because the block read fine, or because it failed INSIDE a well-delimited
   * block. It is the structural answer to a question consumers were reduced to
   * approximating, and it exists because both approximations are wrong:
   *
   *   - `diagnostics.length > 0` alone captures `undelimited`, which
   *     {@link locateBlock} emits for a key at ANY line start with no `---`
   *     pair. That arm is the loosest rule in this module ON PURPOSE, on the
   *     stated grounds that nothing gates on it — and hand-authored blocks are
   *     overwhelmingly written that way, so a gate reading it refuses nearly
   *     every real declaration.
   *   - `data !== null &&` alone misses a DELIMITED block that was unusable —
   *     `issuegraph: hello` inside a proper `---` pair returns `data: null`
   *     with a diagnostic. That issue declared in the canonical form and nobody
   *     could read it, which is exactly the case a gate must catch.
   *
   * So the axis is not "did data survive" but "was there a delimited block at
   * all", and only this field answers it. A gate wants
   * `diagnostics.length > 0 && blockDefect === null`.
   *
   * `=== null`, NOT `!== "undelimited"` — BOTH defects are ungated, and reading
   * the pair as one inert row is the point rather than an accident.
   * `unterminated` is not "a writer who opened a block properly and forgot to
   * close it"; it is overwhelmingly the SAME fence-without-delimiters shape with
   * an ordinary markdown `---` rule above it, which this parser reads as an
   * unclosed opening delimiter — a shape seen repeatedly in real corpora. A
   * gate excluding only `undelimited` therefore reintroduces the same
   * over-refusal one subtype down.
   *
   * REPORTED STRUCTURALLY RATHER THAN MATCHED OUT OF THE MESSAGE TEXT, which is
   * the whole point: the message is prose that may be reworded, and a matcher
   * that silently stops matching fails OPEN.
   */
  readonly blockDefect: BlockDefect | null;
}

/**
 * The IDENTIFIER TEXT a scalar node carries, or null when it is not a scalar.
 *
 * A REFERENCE IS LEXICAL, NOT TYPED, and this is the whole of §4.2: an
 * identifier is an opaque string, so what a YAML schema would have made of that
 * string is irrelevant to it.
 *
 * Reading the MATERIALIZED value instead was a silent defect. YAML implicitly
 * types a plain scalar, so the reader was handed a number and never saw the
 * author's token — measured:
 *
 *     1e5   ->  100000     a different issue
 *     0x1F  ->  31         a different issue
 *     007   ->  7          a different issue, AND it bypasses §4.2's
 *                          non-canonical rejection, which the spec's own
 *                          conformance table requires
 *
 * `1e5` and `0x1F` are perfectly good identifiers under §4.2's class, so an
 * author on such a tracker had the edge pointed at another issue with no
 * diagnostic — and if the substituted target happened to be closed, the issue
 * read READY while its real blocker was open. Shipping work in the wrong order
 * is the one outcome this format exists to prevent.
 *
 * So a PLAIN scalar's identifier is its SOURCE. A QUOTED one's is its unescaped
 * value: quoting is how an author says "these exact bytes", and the value is
 * what those bytes are.
 *
 * IT ALSO REMOVES AN ASYMMETRY THAT WAS PREVIOUSLY DOCUMENTED AS ACCEPTABLE:
 * quoted `"007"` was refused while plain `007` silently became `7`. Both are
 * refused now, which is what the spec says and what an author would expect.
 */
function scalarIdText(node: unknown, text: string): string | null {
  if (!isScalar(node)) return null;
  // Only the QUOTED and BLOCK styles carry author bytes in `value`; everything
  // else — plain, and any style this list does not name — is read lexically,
  // which is the §4.2-faithful direction and fails toward the author's token.
  const quoted: readonly unknown[] = [
    Scalar.QUOTE_SINGLE,
    Scalar.QUOTE_DOUBLE,
    Scalar.BLOCK_LITERAL,
    Scalar.BLOCK_FOLDED,
  ];
  if (quoted.includes(node.type)) {
    return typeof node.value === 'string' ? node.value : null;
  }
  const range = nodeRange(node);
  if (range === null) return null;
  // A ZERO-WIDTH range is the empty node an unquoted `- #9094` leaves behind
  // once `#` opens a comment. It yields `""`, which no identifier grammar
  // accepts — which is what keeps that silent-null case refused.
  return text.slice(range[0], range[1]);
}

/**
 * Parse one identifier token as a reference: `123`, `#123`, `ABC-123`,
 * `owner/repo#123` (§4.2).
 *
 * NOT TRIMMED, and the reason is measured rather than stylistic. YAML already
 * strips surrounding whitespace from a PLAIN scalar — including inside a flow
 * sequence — so a trim here could only ever act on a QUOTED one, where the
 * author explicitly asked for those bytes. Trimming there bypasses `isRefId`'s
 * deliberate whitespace exclusion: `" #123 "` would become the reference `123`
 * and a re-render would write it back as `"#123"`, silently changing what the
 * author wrote.
 */
function parseRef(s: string): IssueRef | null {
  if (s.length === 0) return null;

  // The sigil is same-repo-only: in a qualified reference the `#` is the
  // separator, so a leading one is the bare `#123` spelling and nothing else.
  if (s.startsWith('#')) return sameRepoRef(s.slice(1));

  const hash = s.indexOf('#');
  if (hash !== -1) {
    const repo = s.slice(0, hash);
    const id = s.slice(hash + 1);
    if (!isRepoQualifier(repo) || !isRefId(id)) return null;
    return { repo, id };
  }
  return sameRepoRef(s);
}

function sameRepoRef(id: string): IssueRef | null {
  return isRefId(id) ? { repo: null, id } : null;
}

/**
 * The code-fence lines §4.1 permits as display armor around the block. An
 * opener may carry an info string (```yaml); a closer is bare.
 *
 * EXPORTED so a writer recognises the SAME armor this reader sees through. Two
 * copies is a drift hazard with real consequences either way it drifts: a fence
 * one skips and the other keeps gets delimited INTO the block, and one the
 * other way gets left outside it.
 */
export const FENCE_OPEN = /^`{3,}[A-Za-z0-9-]*[ \t]*$/;
export const FENCE_CLOSE = /^`{3,}[ \t]*$/;

/**
 * Why a body that CARRIES the key still yielded no block. A closed union, not
 * a pair of booleans: the two defects are mutually exclusive by construction
 * (an unterminated block has an opening delimiter, an undelimited one has
 * none), and a boolean pair makes the impossible both-at-once state
 * representable — and, worse, makes "neither" mean two different things.
 */
export type BlockDefect = 'unterminated' | 'undelimited';

/**
 * The diagnostic each defect reports, as a table rather than a branch: the
 * parser's job here is to LOOK UP what it found, not to decide it again.
 * Adding a defect adds a row, and the type system requires the row.
 */
const BLOCK_DEFECT_DIAGNOSTIC: Readonly<Record<BlockDefect, string>> = {
  unterminated: 'issuegraph: opening --- with an issuegraph key but no closing ---; block ignored',
  undelimited:
    'issuegraph: an issuegraph key is present but no `---` pair delimits it (a code fence is armor, not a delimiter); block ignored',
};

/**
 * Locate the canonical issuegraph frontmatter block in an issue body and
 * return its raw lines, or null when no `---` block carrying the key exists.
 * Tolerates any prefix content (banners, callouts, a wrapping code fence):
 * the scan is line-based, so fence lines are simply lines that are not `---`.
 *
 * When no block is returned, `defect` separates a body that MEANT to carry one
 * from a body that never did — the distinction the whole `data: null` contract
 * rests on (`ParseResult.diagnostics`). It is null only for a body
 * with no key at line start anywhere.
 */
export interface BlockLocation {
  /** The block's interior lines (between the delimiters), or null when none. */
  readonly lines: readonly string[] | null;
  readonly defect: BlockDefect | null;
  /**
   * Index of the opening `---` in a newline split of `body`, or -1 when
   * `lines` is null. A splice edits LINE RANGES of the original body, so it
   * needs where the block is and not only what it says — and re-deriving that
   * with a second scan is how an editor and a parser come to disagree about
   * which block is canonical.
   */
  readonly startLine: number;
  /** Index of the closing `---`; -1 when `lines` is null. */
  readonly endLine: number;
}

/**
 * Locate the canonical issuegraph frontmatter block in an issue body: its raw
 * interior lines and the delimiter line indices, or null lines when no `---`
 * block carrying the key exists. Tolerates any prefix content (banners,
 * callouts, a wrapping code fence): the scan is line-based, so fence lines are
 * simply lines that are not `---`.
 *
 * Split the body on `\n` to use the indices — every line terminator this
 * splits on contains one, so a `\r\n` body yields the same indices with the
 * carriage returns left on the line ends where an editor must preserve them.
 *
 * When no block is returned, `defect` separates a body that MEANT to carry one
 * from a body that never did — the distinction the whole `data: null` contract
 * rests on ({@link ParseResult.diagnostics}). It is null only for a body with
 * no key at line start anywhere.
 *
 * EXPORTED for `@issuegraph/writer`, which must edit the block this reader
 * would read and no other.
 */
export function locateBlock(body: string): BlockLocation {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').trimEnd() === '---') {
      if (start === -1) {
        start = i;
        continue;
      }
      const block = lines.slice(start + 1, i);
      if (block.some((l) => FRONTMATTER_KEY_LINE.test(l))) {
        return { lines: block, defect: null, startLine: start, endLine: i };
      }
      // A `---` pair without the key: the NEXT `---` starts a new candidate
      // (markdown horizontal rules between sections behave this way).
      start = i;
    }
  }
  // No closed block carried the key — but an OPEN delimiter followed by the
  // key with no closing `---` is a malformed block the writer meant to exist.
  if (start !== -1 && lines.slice(start + 1).some((l) => FRONTMATTER_KEY_LINE.test(l))) {
    return { lines: null, defect: 'unterminated', startLine: -1, endLine: -1 };
  }
  // The key is at a line's start SOMEWHERE, and no `---` pair ever
  // enclosed it — the form hand-authors overwhelmingly write, a bare ```yaml
  // fence with the delimiters omitted. Measured 2026-08-21: 336 of the 369
  // open issues carrying the key were written this way, and every one of their
  // edges was inert while reading BYTE-IDENTICAL to "this issue has no block":
  // `data: null` with no diagnostic. Absent and malformed must not render the
  // same, so this is the block the writer meant to exist and it says so.
  //
  // THE SCAN IS OVER THE WHOLE BODY, deliberately, and not `slice(start + 1)`
  // like the arm above. `start` is the last `---` seen, so when the key sits
  // BEFORE every `---` line — a fenced block at the top followed by ordinary
  // markdown rules between sections, which is the common issue shape here —
  // a scan anchored on `start` looks only PAST the key and reports nothing.
  //
  // THE KEY AT A LINE'S START IS THE WHOLE TEST, AND A SECOND ONE MUST NOT BE
  // ADDED BACK. Four review rounds argued about qualifying this, one shape per
  // round: a bare mention should not count (r1); a column-zero YAML comment
  // should not disqualify (r2); nor should an unindented field (r3); nor an
  // inert extension subtree before a recognized one (r4). Every one of those
  // was correct ABOUT THE QUALIFIER, and that is the tell — a qualifier is a
  // second reader of the block's structure, re-deriving part of the parse, so
  // each round found another line where the two disagreed. Three of the four
  // disagreements left a real declaration SILENT, which is the exact failure
  // this change exists to end.
  //
  // Measured over the 500 open issues, 2026-08-22: the qualifier, a fence
  // requirement, and no qualifier at all select the SAME 345 bodies. It has
  // never once changed an answer on real data — it only ever added shapes that
  // could go quiet. So it is gone, and this is deliberately the loosest rule.
  //
  // OVER-REPORTING IS THE SAFE DIRECTION HERE, which is why the r1 concern is
  // answered rather than implemented: `data` is untouched either way, so no
  // edge reading moves and nothing is released or blocked. A false positive is
  // one advisory line a reader dismisses; a false negative is the silent inert
  // edge that put 336 issues in this state. A detector whose purpose is to end
  // silence must fail LOUD.
  if (lines.some((l) => FRONTMATTER_KEY_LINE.test(l))) {
    return { lines: null, defect: 'undelimited', startLine: -1, endLine: -1 };
  }
  return { lines: null, defect: null, startLine: -1, endLine: -1 };
}

/**
 * TRUE when a DELIMITED block was found and something inside it could not be
 * read — the one question a reader must ask before it may treat a declaration
 * as complete.
 *
 * WHY IT IS OFFERED HERE RATHER THAN LEFT TO THE CALL SITES. The rule itself is
 * stated once, in {@link ParseResult.blockDefect}'s own doc; read it there
 * rather than through a paraphrase. The short version is that the QUESTION
 * factors and the POLICY does not: every reader asks the same thing and each
 * answers it its own way (drop a candidate, refuse an admission, refuse a
 * write, report a verdict). The alternative is every call site spelling the
 * expression by hand, which is one place per site for it to drift.
 *
 * IT IS NOT INTERCHANGEABLE WITH `diagnostics.length > 0`, and the difference
 * is the whole reason `blockDefect` exists: the bare test also captures the
 * `undelimited`/`unterminated` family, which the parser emits for a key at any
 * line start with no `---` pair. That arm is its loosest rule ON PURPOSE, and
 * hand-authored blocks are overwhelmingly written that way — so a gate reading
 * it refuses nearly every real declaration. Nor is `data === null` the
 * question: a delimited block that was unusable returns null data WITH a
 * diagnostic, and a delimited block that merely DROPPED A FIELD returns
 * non-null data that looks complete. Both are unread declarations.
 *
 * A COROLLARY WORTH RELYING ON, pinned by this module's test rather than left
 * to be re-derived: `data !== null` implies `blockDefect === null`, because the
 * only return carrying a non-null defect also returns `data: null`. So a caller
 * that has already established non-null data may use this in place of a bare
 * diagnostics test without widening what it refuses.
 */
export function isUnreadDeclaration(parse: ParseResult): boolean {
  return parse.diagnostics.length > 0 && parse.blockDefect === null;
}

/**
 * One recognised or unrecognised entry under `issuegraph:`, located by LINE so
 * a writer can replace exactly its own bytes.
 *
 * Line indices are relative to the block's INTERIOR lines — what
 * {@link BlockLocation.lines} returns — not to the body, because that is the
 * only frame both packages already share.
 */
export interface SectionField {
  /** The key as it SPELLS, unquoted: `"blocked-by"` and `blocked-by` agree. */
  readonly key: string;
  /** First interior line index of the entry (the key's own line). */
  readonly startLine: number;
  /** Last interior line index belonging to the entry, inclusive. */
  readonly endLine: number;
}

/**
 * Where the `issuegraph:` section sits inside a located block, and which lines
 * each of its entries occupies.
 *
 * THIS EXISTS SO THERE IS EXACTLY ONE GRAMMAR. `@issuegraph/writer` edits the
 * block this reader reads, so it needs to know which bytes constitute an entry
 * — and the previous answer was a hand-written line scanner exported from this
 * module and re-walked by the writer. Two walks of one grammar is how an editor
 * hands back a body its own parser cannot read; three separate defects were
 * filed against exactly that seam.
 *
 * Now the answer comes from the same `yaml` document the parse uses, whose
 * nodes carry byte ranges. Nothing here re-tokenizes, so the editor and the
 * parser cannot disagree about what an entry is: there is only one opinion.
 */
export interface SectionLocation {
  /** Interior line index of the `issuegraph:` key line. */
  readonly headerLine: number;
  /** Last interior line index belonging to the section, inclusive. */
  readonly endLine: number;
  /** Column at which the section's child entries begin. */
  readonly childIndent: number;
  readonly fields: readonly SectionField[];
  /** True when a top-level key other than `issuegraph` carries content. */
  readonly hasSiblingKeys: boolean;
}

/**
 * Whether one line is the block's top-level `issuegraph:` key line.
 *
 * THE STRICT RULE, as opposed to {@link FRONTMATTER_KEY_PATTERN}'s prefilter.
 * The pattern over-matches on purpose — it accepts `""issuegraph:`, which the
 * parser refuses — so a tool counting header lines with it reads a body
 * carrying one valid key plus one over-matched line as ambiguous, and leaves a
 * declaration it could have repaired alone.
 *
 * ANSWERED BY THE PARSER, not by a line grammar. A repair tool and a reader
 * disagreeing about which line opens the section is the same drift the section
 * location exists to remove, one question smaller.
 *
 * TWO CONDITIONS, both load-bearing: the line carries no leading whitespace
 * (YAML accepts an indented root mapping, so parsing alone would answer `true`
 * for a nested `  issuegraph:` inside somebody else's mapping), and it parses
 * as a mapping whose key is this specification's.
 *
 * EXPORTED for `@issuegraph/writer`.
 */
export function isSectionHeader(line: string): boolean {
  if (line.length !== line.trimStart().length) return false;
  const doc = readDocument(line);
  if (doc === null) return false;
  const root = doc.contents;
  if (!isMap(root) || root.items.length !== 1) return false;
  return scalarKey(root.items[0] as Pair<unknown, unknown>) === FRONTMATTER_KEY;
}

/**
 * Locate the `issuegraph:` section within a block's interior lines, or null
 * when the block does not carry a usable one.
 *
 * Null means "do not edit this", for one of two reasons:
 *
 *   - The block is one the READER also refuses — the YAML did not parse, no
 *     `issuegraph` key is a top-level mapping key, or its value is a scalar or
 *     a sequence. A writer that stops here and a reader returning `data: null`
 *     are then answering from the same evidence.
 *   - The section is written INLINE, as a flow mapping on the header's own
 *     line. The reader reads that perfectly well, so this is the one case where
 *     the two legitimately differ: a line-based edit has no span to replace
 *     that is not also the header.
 *
 * EXPORTED for `@issuegraph/writer`. It is a LOWER-LEVEL surface than
 * {@link parseFrontmatter} and consumers who only want the data should not
 * reach for it.
 */
export function locateSection(blockLines: readonly string[]): SectionLocation | null {
  const text = blockLines.join('\n');
  const doc = readDocument(text);
  if (doc === null) return null;
  const root = doc.contents;
  if (!isMap(root)) return null;

  const lineAt = lineIndexer(text);
  let section: Pair<unknown, unknown> | null = null;
  let hasSiblingKeys = false;
  for (const pair of root.items) {
    const key = scalarKey(pair);
    if (key === FRONTMATTER_KEY) {
      // The FIRST claimant is canonical (§4.1). A duplicate top-level key is a
      // YAML error, so `readDocument` has already refused it — this only
      // guards a hypothetical parser that tolerated one.
      section ??= pair;
    } else if (key !== null) {
      hasSiblingKeys = true;
    }
  }
  if (section === null) return null;
  const value = sectionMap(section.value);
  if (value === null) return null;
  if (!isLineEditableSection(section.value)) return null;

  const headerRange = nodeRange(section.key);
  if (headerRange === null) return null;
  const headerLine = lineAt(headerRange[0]);
  const fields: SectionField[] = [];
  let childIndent = -1;
  let sectionEnd = headerLine;
  for (const pair of value) {
    const key = scalarKey(pair);
    const keyRange = nodeRange(pair.key);
    if (keyRange === null) return null;
    const startLine = lineAt(keyRange[0]);
    // AN ENTRY MUST OWN ITS OWN LINE, or a line-based edit cannot express it.
    // `issuegraph: {priority: 1}` is a perfectly good FLOW mapping that the
    // parser reads — see `parseFrontmatter` — but every entry in it starts on
    // the header's line, so replacing an entry's span would delete the header
    // and hand back a body nobody can read. A writer must prepend a fresh block
    // instead, which is what `null` routes it to.
    if (startLine <= headerLine) return null;
    // `range[2]` is the node END, which includes trailing comments and the
    // newline that closes the node — so it can land on the line AFTER the
    // entry's last content. Step back to the last line carrying content.
    const valueRange = nodeRange(pair.value);
    const rawEnd = valueRange === null ? keyRange[2] : valueRange[2];
    let endLine = lineAt(Math.max(rawEnd - 1, keyRange[0]));
    while (endLine > startLine && (blockLines[endLine] ?? '').trim().length === 0) endLine -= 1;
    if (childIndent === -1) childIndent = columnAt(text, keyRange[0]);
    if (endLine > sectionEnd) sectionEnd = endLine;
    // A NON-STRING KEY IS SKIPPED, NEVER A REFUSAL — and the two halves of that
    // are separate on purpose.
    //
    // `parseFrontmatter` treats `1: extension` as an unrecognised field: inert,
    // silent, and the recognised fields beside it still read (SPEC 4.1).
    // Refusing the whole section here would make the writer disagree with the
    // reader about a block the reader handles fine — and the consequence is not
    // a refused write, it is DATA LOSS. `spliceGeneratedEdges` returns null, the
    // caller takes the documented path and PREPENDS a fresh block, and under
    // §4.1's first-block rule the author's original block stops being canonical:
    // every recognised-but-unowned field in it silently goes invisible.
    //
    // Its SPAN still counts, above, even though the field itself is not
    // reported. `sectionEnd` is what tells a writer where the section stops, so
    // an entry omitted from the span would be classified as sibling content —
    // and a section that still holds one would have its `issuegraph:` header
    // dropped as though it were empty. Nothing is owed to `fields`: a writer
    // only ever REMOVES lines it owns, so an entry it cannot name is preserved
    // by not being listed.
    if (key === null) continue;
    fields.push({ key, startLine, endLine });
  }
  return {
    headerLine,
    endLine: sectionEnd,
    childIndent: childIndent === -1 ? 2 : childIndent,
    fields,
    hasSiblingKeys,
  };
}

/**
 * Parse the canonical issuegraph frontmatter out of an issue body (SPEC §4).
 * Never throws on any input.
 */
export function parseFrontmatter(body: string): ParseResult {
  const diagnostics: string[] = [];
  const located = locateBlock(body);
  if (located.lines === null) {
    if (located.defect !== null) diagnostics.push(BLOCK_DEFECT_DIAGNOSTIC[located.defect]);
    return { data: null, diagnostics, blockDefect: located.defect };
  }

  // THE TEXT THE RANGES INDEX. Every node range below is an offset into exactly
  // this string, so it is computed once and threaded rather than rebuilt.
  const blockText = located.lines.join('\n');
  const read = readDocumentOrReason(blockText);
  if (read.doc === null) {
    diagnostics.push(`issuegraph: the block is not readable YAML (${read.reason ?? 'unreadable'}); block ignored`);
    return { data: null, diagnostics, blockDefect: null };
  }
  const doc = read.doc;
  const root = doc.contents;
  if (!isMap(root)) {
    diagnostics.push('issuegraph: the block is not a mapping; block ignored');
    return { data: null, diagnostics, blockDefect: null };
  }

  let section: Pair<unknown, unknown> | null = null;
  for (const pair of root.items) {
    if (scalarKey(pair) === FRONTMATTER_KEY) {
      section ??= pair; // first claimant is canonical (§4.1)
    }
  }
  if (section === null) {
    // `locateBlock` proved the key is at a line start, but it never parsed as
    // a top-level mapping key — an indented `issuegraph:` inside somebody
    // else's mapping, or a spelling YAML reads as something other than a key.
    diagnostics.push('issuegraph: key present but no parseable section');
    return { data: null, diagnostics, blockDefect: null };
  }
  const value = sectionMap(section.value);
  if (value === null) {
    // A scalar or a sequence. Neither is the mapping §4.3 describes, and
    // reading edges out of one would mean inventing them.
    diagnostics.push('issuegraph: section is not a mapping; block ignored');
    return { data: null, diagnostics, blockDefect: null };
  }

  let blockedBy: readonly IssueRef[] = [];
  let decomposedFrom: IssueRef | null = null;
  let duplicateOf: IssueRef | null = null;
  let serializeWith: IssueRef | null = null;
  let togetherWith: IssueRef | null = null;
  let priority: Priority | null = null;
  let evidence: Evidence | null = null;

  const singleRef = (key: string, node: unknown): IssueRef | null => {
    if (isSeq(node)) {
      diagnostics.push(`issuegraph: ${key} takes a single ref, not a list; dropped`);
      return null;
    }
    if (isMap(node)) {
      diagnostics.push(`issuegraph: ${key} has nested mapping content; dropped`);
      return null;
    }
    const token = scalarIdText(node, blockText);
    if (token === null) {
      diagnostics.push(`issuegraph: ${key} has an unparseable ref; dropped`);
      return null;
    }
    const ref = parseRef(token);
    if (ref === null) {
      diagnostics.push(`issuegraph: ${key} has an unparseable ref ("${token}"); dropped`);
    }
    return ref;
  };

  for (const pair of value) {
    const key = scalarKey(pair);
    if (key === null || !isField(key)) continue; // inert, silently (§4.1)
    switch (key) {
      // THE RELATIONSHIP FIELDS READ THE NODE, not a materialized value: a
      // reference is lexical (§4.2), so YAML's implicit typing of a plain
      // scalar must not reach it. See `scalarIdText`.
      case 'blocked-by':
        blockedBy = refsFrom(pair.value, blockText, diagnostics);
        break;
      case 'decomposed-from':
        decomposedFrom = singleRef(key, pair.value);
        break;
      case 'duplicate-of':
        duplicateOf = singleRef(key, pair.value);
        break;
      case 'serialize-with':
        serializeWith = singleRef(key, pair.value);
        break;
      case 'together-with':
        togetherWith = singleRef(key, pair.value);
        break;
      // THE SCALAR FIELDS KEEP THE MATERIALIZED VALUE, and the asymmetry is the
      // point rather than an inconsistency: `priority` IS an integer (§4.3.5)
      // and `evidence` IS one of two words, so YAML's typing is exactly right
      // for them. Only references are opaque strings.
      case 'priority': {
        const raw: unknown = toJS(pair.value, doc);
        if (isPriority(raw)) priority = raw;
        else
          diagnostics.push(
            `issuegraph: priority must be an integer ${PRIORITY_MIN}-${PRIORITY_MAX} (got "${describe(raw)}"); dropped`,
          );
        break;
      }
      case 'evidence': {
        const raw: unknown = toJS(pair.value, doc);
        if (typeof raw === 'string' && isEvidence(raw)) evidence = raw;
        else
          diagnostics.push(
            `issuegraph: evidence must be ${EVIDENCE_VALUES.join('|')} (got "${describe(raw)}"); dropped`,
          );
        break;
      }
    }
  }

  return {
    data: { blockedBy, decomposedFrom, duplicateOf, serializeWith, togetherWith, priority, evidence },
    diagnostics,
    // The block was delimited and parsed; any diagnostic here is a FIELD
    // rejection inside it, never a block-level defect.
    blockDefect: null,
  };
}

/**
 * The refs a `blocked-by` value declares, diagnosing every member it could not
 * read.
 *
 * A `null` MEMBER IS REFUSED, AND THAT IS THIS FUNCTION'S REASON TO EXIST.
 * Measured: an unquoted `#`-sigil reference in a block sequence —
 *
 *     blocked-by:
 *       - #9094
 *
 * — parses SUCCESSFULLY to `[null]`, with zero parser errors and zero warnings,
 * because `#` opens a YAML comment and what remains is an empty node. Nothing
 * upstream of this function reports it. Left unrefused, the issue reads as
 * declaring no edges at all: a park that looks exactly like a free issue, which
 * is the licence for a false clear that {@link ParseResult.diagnostics} exists
 * to withhold. So a null member is a dropped field with a diagnostic, never a
 * shorter list.
 *
 * A BARE `blocked-by:` IS ALSO A NULL, and it is diagnosed for the same reason
 * one field over: `[]` is a writer declaring no blockers, while a missing value
 * is a field this reader cannot turn into a list without inventing one. Every
 * other recognised field already diagnoses a blank value, so tolerating it here
 * would be an inconsistency rather than a tolerance.
 */
function refsFrom(node: unknown, text: string, diagnostics: string[]): readonly IssueRef[] {
  if (isMap(node)) {
    diagnostics.push('issuegraph: blocked-by has nested mapping content; dropped');
    return [];
  }
  if (!isSeq(node)) {
    // A single scalar is tolerated as a one-item list, as it always has been.
    const token = scalarIdText(node, text);
    if (token === null || token.length === 0) {
      diagnostics.push('issuegraph: blocked-by has no value (write [] to declare none); dropped');
      return [];
    }
    const ref = parseRef(token);
    if (ref === null) {
      diagnostics.push(`issuegraph: blocked-by item unparseable ("${token}"); dropped`);
      return [];
    }
    return [ref];
  }
  const refs: IssueRef[] = [];
  for (const item of node.items) {
    const token = scalarIdText(item, text);
    if (token === null) {
      diagnostics.push('issuegraph: blocked-by item is not a reference; dropped');
      continue;
    }
    const ref = parseRef(token);
    if (ref === null) {
      diagnostics.push(`issuegraph: blocked-by item unparseable ("${token}"); dropped`);
      continue;
    }
    refs.push(ref);
  }
  return refs;
}

/**
 * Parse a block's text into a document, or null when it is not safe to read.
 *
 * REFUSES ON WARNINGS AS WELL AS ERRORS, and that is not belt-and-braces — it
 * is the only thing enforcing §4.1's custom-tag clause. Measured:
 * `blocked-by: !!python/object 1` produces ZERO errors, one
 * `TAG_RESOLVE_FAILED` warning, and the string `"1"`. A reader testing
 * `errors` alone accepts it, and the tag requirement is met in name only.
 *
 * Refusing every warning is the fail-CLOSED direction, and deliberately wider
 * than the one code that motivated it: a matcher on `TAG_RESOLVE_FAILED` would
 * silently stop covering whatever warning `yaml` adds next, which is the same
 * fail-open shape this module refuses everywhere else.
 */
function readDocument(text: string): Document.Parsed | null {
  return readDocumentOrReason(text).doc;
}

/**
 * The same read, with the REASON it refused — so a diagnostic can name the
 * cause instead of saying only that something was wrong.
 *
 * The parser's own message is better than any prose this module could write
 * for the same fault: it names the line, the column and the rule ("Map keys
 * must be unique", "Tabs are not allowed as indentation"). Passing it through
 * is why delegating tokenizing improves the diagnostics rather than costing
 * them — and it is reported as OPAQUE TEXT, never matched on, exactly as
 * {@link ParseResult.diagnostics} requires of every message here.
 */
function readDocumentOrReason(text: string): { doc: Document.Parsed | null; reason: string | null } {
  let doc: Document.Parsed;
  try {
    doc = parseDocument(text, yamlOptions());
  } catch (cause) {
    // `parseDocument` is not documented to throw for input faults, but the
    // never-throws contract is this module's and not the library's.
    return { doc: null, reason: cause instanceof Error ? cause.message : 'unreadable' };
  }
  const fault = doc.errors[0] ?? doc.warnings[0];
  if (fault !== undefined) return { doc: null, reason: fault.message };
  // AN ANCHOR MUST NOT RESOLVE (§4.1), and the parse options cannot express
  // that — `maxAliasCount` is a `toJS` option, so `parseDocument` returns a
  // document with the alias node intact. Refusing structurally is both earlier
  // and clearer than letting the materializing step raise: an alias is a
  // document this reader will not read, not a field it drops.
  let aliased = false;
  visit(doc, {
    Alias() {
      aliased = true;
      return visit.BREAK;
    },
  });
  return aliased
    ? { doc: null, reason: 'an anchor alias may not resolve here (SPEC 4.1)' }
    : { doc, reason: null };
}

/**
 * The section's entries, or null when its value is not a mapping at all.
 *
 * A NULL VALUE IS AN EMPTY MAPPING HERE, not a broken one, and the distinction
 * is load-bearing rather than lenient. A bare `issuegraph:` header beside a
 * sibling top-level key is a legitimate empty declaration — it is exactly what
 * a splice leaves behind after removing the last owned edge — so refusing it
 * would make the writer hand back bodies its own reader calls unreadable.
 *
 * A SCALAR or a SEQUENCE is genuinely not a mapping and still refuses: §4.3
 * describes a mapping of fields, and reading edges out of either would mean
 * inventing them.
 */
function sectionMap(value: unknown): readonly Pair<unknown, unknown>[] | null {
  // Reachable through the explicit-key and flow spellings (`? issuegraph`,
  // `{issuegraph}`), which carry no value node at all. The ORDINARY bare
  // `issuegraph:` does not land here — measured, yaml gives it a zero-width
  // null Scalar, which the next line catches.
  if (value === null || value === undefined) return [];
  if (isScalar(value) && value.value === null) return [];
  return isMap(value) ? value.items : null;
}

/**
 * Whether a writer can insert a child line under this section header.
 *
 * SEPARATE FROM {@link sectionMap} ON PURPOSE, because the reader and the
 * writer are answering different questions and one of them is not about
 * spelling. `issuegraph:` and `issuegraph: null` are the SAME YAML value —
 * measured, both materialize to `{issuegraph: null}` — so the PARSER treats
 * them identically, and it must: distinguishing two spellings of one value by
 * reaching past the data model into the syntax tree is the hand-rolled-grammar
 * reflex this module exists to have stopped.
 *
 * A LINE-BASED EDIT still cannot treat them identically, and that is a fact
 * about editing rather than about meaning. A writer inserting `  blocked-by:`
 * under `issuegraph: null` produces a mapping nested under a scalar value —
 * invalid YAML — so the only correct answer is to refuse and let the caller
 * prepend a fresh block.
 *
 * That refusal already happened, but only DOWNSTREAM: the splice's parse-check
 * caught the unreadable result and returned null. Safety by accident is worth
 * converting into safety by construction, because the accident depends on a
 * control one refactor away from being narrowed.
 *
 * A FLOW mapping is refused for the same reason and is stated here rather than
 * left to the per-entry line test, which an EMPTY flow map (`{}`) never reaches.
 */
function isLineEditableSection(value: unknown): boolean {
  if (isScalar(value) && value.value === null) {
    // An OMITTED value is zero-width; a WRITTEN `null` / `~` / `Null` is not.
    const range = nodeRange(value);
    return range !== null && range[1] === range[0];
  }
  if (value === null || value === undefined) return false;
  return isMap(value) && value.flow !== true;
}

/** A pair's key as a plain string, or null when it is not a scalar string key. */
function scalarKey(pair: Pair<unknown, unknown>): string | null {
  const key = pair.key;
  if (!isScalar(key)) return null;
  return typeof key.value === 'string' ? key.value : null;
}

/** A node's `[start, value-end, node-end]` byte range, or null when it has none. */
function nodeRange(node: unknown): readonly [number, number, number] | null {
  if (node === null || typeof node !== 'object') return null;
  const range = (node as { range?: unknown }).range;
  return Array.isArray(range) && range.length === 3 ? (range as [number, number, number]) : null;
}

/**
 * A node's plain JavaScript value.
 *
 * `maxAliasCount: 0` is passed again at this boundary because `toJS` takes its
 * own options: the parse-time setting stops an alias RESOLVING, and this stops
 * a document that somehow carried one from expanding it here.
 */
function toJS(node: unknown, doc: Document.Parsed): unknown {
  if (isAlias(node)) return UNREADABLE; // refused in readDocument; belt and braces
  if (!isScalar(node) && !isSeq(node) && !isMap(node)) return null;
  try {
    return node.toJS(doc, { maxAliasCount: 0 });
  } catch {
    // Unreachable while `readDocument` refuses every aliased document, and
    // caught anyway: "never throws on any input" is THIS module's contract, so
    // it may not rest on another module's refusal being exhaustive.
    return UNREADABLE;
  }
}

/** A one-line rendering of a rejected value, for a diagnostic. */
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'symbol') return 'unreadable';
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return Array.isArray(value) ? '[...]' : '{...}';
  return String(value);
}

/**
 * A byte-offset -> line-index lookup over one text, built once per call.
 *
 * Linear in the text rather than per query: `locateSection` asks for two
 * offsets per field, and re-scanning from the start each time is quadratic on a
 * block with many entries.
 */
function lineIndexer(text: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  };
}

/** The column an offset sits at, counted from its line's start. */
function columnAt(text: string, offset: number): number {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return offset - lineStart;
}
