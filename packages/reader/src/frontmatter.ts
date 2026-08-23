/**
 * Reading the Issuegraph frontmatter block out of an issue body (SPEC §4).
 *
 * An issue body MAY open with standard `---`-delimited YAML frontmatter
 * namespaced under a top-level `issuegraph` key. Trackers that render markdown
 * usually show the block wrapped in a plain code fence as display armor, so
 * §4.1 requires a reader to see through both a wrapping fence and any leading
 * banner content. This module extracts and validates that data into a typed
 * shape; `model.ts` turns a set of those into a graph.
 *
 * PARSER POSTURE — a restricted SUBSET reader, deliberately hand-rolled:
 *
 *   - The specification requires restricted parsing (§4.1: "a plain YAML data
 *     parser — no anchors resolving to arbitrary object construction, no custom
 *     tags"), and the recognised field grammar is a tiny closed subset: scalar
 *     integers and strings, flow lists, block lists, comments, quotes. The
 *     FORMAT stays standard YAML — this reader accepts the subset the spec's
 *     fields can express, and anything outside it degrades per the rules below.
 *   - Issue bodies are untrusted content: anyone who can file an issue can
 *     author one. A short auditable parser that constructs no objects is a
 *     smaller attack surface than a general YAML engine, and it keeps this
 *     package free of runtime dependencies — which matters for something every
 *     other package here is expected to sit on.
 *
 * DEGRADATION RULES — this module never throws, on any input:
 *
 *   - No frontmatter, or no `issuegraph` key anywhere -> `data: null` and no
 *     diagnostics: a valid node with no edges, not an error.
 *   - A structurally unparseable block (bad delimiters, non-mapping under the
 *     key) -> `data: null` plus a diagnostic. An issue with a broken block is
 *     still a workable issue with no edges. BAD DELIMITERS INCLUDES NO
 *     DELIMITERS: a key wrapped in a bare ```yaml fence with the `---` pair
 *     omitted is the malformed case, not the absent one. Reporting it as absent
 *     hides the overwhelming majority of hand-authored declarations — measured
 *     on one real backlog, 336 of the 369 bodies carrying the key were written
 *     that way, and every edge in them was inert while reading byte-identically
 *     to "this issue has no block".
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
  type Evidence,
  type Priority,
} from '@issuegraph/core';

/**
 * THE ACCEPTED SPELLING OF THE BLOCK'S TOP-LEVEL KEY, and the one definition of
 * it. YAML permits whitespace between a key and its colon, so `issuegraph :`
 * and `issuegraph\t:` are the same key as `issuegraph:`, and this parser
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
 */
export const FRONTMATTER_KEY_PATTERN = `${FRONTMATTER_KEY}[ \\t]*:`;

/**
 * The accepted key LINE: {@link FRONTMATTER_KEY_PATTERN} anchored to a
 * line's start. Every in-module test of "is this the block's key line?" runs
 * through this one regex, so the rule has a single site to change.
 */
const FRONTMATTER_KEY_LINE = new RegExp(`^${FRONTMATTER_KEY_PATTERN}`);

/** A reference to an issue: same-repo (a bare number) or cross-repo (§4.2). */
export interface IssueRef {
  /** `owner/repo` when the reference is qualified; null for same-repo refs. */
  readonly repo: string | null;
  readonly number: number;
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
   * `blocked-by: [123, not-a-ref]` yields a list carrying only `#123`, and
   * `blocked-by: [not-a-ref]` yields an EMPTY list that reads exactly like a body
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
   *     {@link extractBlockLines} emits for a key at ANY line start with no
   *     `---` pair. That arm is the loosest rule in this module ON PURPOSE, on
   *     the stated grounds that nothing gates on it — and hand-authored blocks
   *     are overwhelmingly written that way, so a gate reading it refuses
   *     nearly every real declaration.
   *   - `data !== null &&` alone misses a DELIMITED block that was unusable —
   *     `issuegraph: { together-with: 71 }` inside a proper `---` pair returns
   *     `data: null` with a diagnostic. That issue declared a relationship in
   *     the canonical form and nobody could read it, which is exactly the case
   *     a gate must catch.
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


// `owner/repo#N` — owner and repo per GitHub's allowed character classes,
// deliberately narrow (no dots-only names edge-casing; a miss degrades to a
// dropped field with a diagnostic, never a crash).
const CROSS_REPO_REF = /^([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)#([0-9]+)$/;

/** Parse one scalar token as a ref: bare int, `#N`, or `owner/repo#N`. */
function parseRef(raw: string): IssueRef | null {
  const s = stripQuotes(raw.trim());
  if (/^[0-9]+$/.test(s)) return boundedRef(null, s);
  if (/^#[0-9]+$/.test(s)) return boundedRef(null, s.slice(1));
  const m = CROSS_REPO_REF.exec(s);
  if (m !== null) {
    const repo = m[1];
    const num = m[2];
    if (repo !== undefined && num !== undefined) return boundedRef(repo, num);
  }
  return null;
}

// BOUNDS ARE PART OF PARSING: a digit-run that is not a safe
// positive integer is UNPARSEABLE, not a ref. `Number("1e21-digits")` loses
// precision silently and the renderer's `String()` then emits scientific
// notation no reader accepts, so an unbounded parse here lets a
// author-supplied `- 99999999999999999999999` ride a writer's re-render
// into a corrupted line — parse-clean in, unparseable out. Zero is equally
// invalid (issue numbers start at 1) and made the renderer THROW. Dropping
// them here routes both through the ordinary dropped-with-diagnostic path
// every conforming reader already takes for `not-a-ref`, and nothing real is
// unblocked by the drop: no tracker can resolve issue 0 or 1e21.
function boundedRef(repo: string | null, digits: string): IssueRef | null {
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return { repo, number: n };
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    if ((first === '"' || first === "'") && s[s.length - 1] === first) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// Strip a trailing YAML comment: ` #` outside quotes starts a comment. The
// subset rule (whitespace before `#`) is exactly YAML's, which is what keeps
// `owner/repo#N` working unquoted.
function stripComment(s: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      if (i === 0 || s[i - 1] === ' ' || s[i - 1] === "\t") {
        return s.slice(0, i);
      }
    }
  }
  return s;
}

/**
 * Split a flow list body (`a, b, c` — no nested brackets in the subset).
 *
 * AN EMPTY ENTRY IS KEPT, and that is the whole subtlety here. YAML reads
 * `[1,,2]` as three nodes whose middle one is null, and a null is not a ref —
 * so the empty item must survive to the caller, be refused by `parseRef`, and
 * earn its diagnostic like any other unparseable item. Dropping empties here
 * instead made `[,]` return an empty list with NO diagnostic, which is
 * byte-identical to a body declaring `[]` and no edges: an absence rendered as
 * a value, and exactly the licence for a false clear that
 * {@link ParseResult.diagnostics} exists to withhold.
 *
 * Two entries are NOT empty items and must not become diagnostics:
 *
 *   - `[]` (or `[ ]`) — a genuinely empty list, which the spec permits and a
 *     writer emits when it removes the last edge. Returned as no items at all.
 *   - ONE trailing comma — `[1, 2,]` is valid YAML for a two-item list, so the
 *     empty part it leaves behind is punctuation rather than a node.
 *
 * A SECOND trailing comma is not covered by that, deliberately: `[1,,]` leaves
 * two empty parts, one of which is a real null node, so it is diagnosed.
 */
function splitFlowList(inner: string): string[] {
  if (inner.trim().length === 0) return [];
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (const c of inner) {
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    if (c === ',' && !inSingle && !inDouble) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  const trimmed = parts.map((p) => p.trim());
  if (trimmed.length > 1 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed;
}

interface RawEntry {
  readonly key: string;
  /** Scalar text after the colon (comment-stripped, trimmed); "" for none. */
  readonly scalar: string;
  /** Items accumulated from an indented `- item` block list, if any. */
  readonly blockItems: string[];
  /** Indent of the entry's FIRST list item; -1 until one arrives. Deeper
   *  dashes are the item's own nested content, never additional items. */
  itemIndent: number;
}

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
function extractBlockLines(body: string): {
  lines: string[] | null;
  defect: BlockDefect | null;
} {
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
        return { lines: block, defect: null };
      }
      // A `---` pair without the key: the NEXT `---` starts a new candidate
      // (markdown horizontal rules between sections behave this way).
      start = i;
    }
  }
  // No closed block carried the key — but an OPEN delimiter followed by the
  // key with no closing `---` is a malformed block the writer meant to exist.
  if (start !== -1 && lines.slice(start + 1).some((l) => FRONTMATTER_KEY_LINE.test(l))) {
    return { lines: null, defect: 'unterminated' };
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
  // second reader of the block's structure, sitting beside the walk below and
  // re-deriving part of it, so each round found another line where the two
  // disagreed. Three of the four disagreements left a real declaration SILENT,
  // which is the exact failure this change exists to end.
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
    return { lines: null, defect: 'undelimited' };
  }
  return { lines: null, defect: null };
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
 * Parse the canonical issuegraph frontmatter out of an issue body (SPEC §4).
 * Never throws on any input.
 */
export function parseFrontmatter(body: string): ParseResult {
  const diagnostics: string[] = [];
  const extracted = extractBlockLines(body);
  if (extracted.lines === null) {
    if (extracted.defect !== null) diagnostics.push(BLOCK_DEFECT_DIAGNOSTIC[extracted.defect]);
    return { data: null, diagnostics, blockDefect: extracted.defect };
  }
  const block = extracted.lines;

  // Walk the block: find `issuegraph:` at indent 0, then collect its indented
  // child entries until the next indent-0 line (other top-level keys: inert).
  let inSection = false;
  let sectionSeen = false;
  let sectionContentInvalid = false;
  let closedOwnerRecognized = false;
  const contaminated = new Set<string>();
  let childIndent = -1;
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;

  for (const rawLine of block) {
    const line = stripComment(rawLine).trimEnd();
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    if (inSection && line.slice(0, indent).includes("\t")) {
      // YAML forbids tabs in indentation; mixed tab/space widths also corrupt
      // the indent arithmetic below. Structural, per the degrade contract.
      sectionContentInvalid = true;
      diagnostics.push('issuegraph: tab character in indentation; block ignored');
      continue;
    }

    if (indent === 0) {
      if (FRONTMATTER_KEY_LINE.test(line)) {
        if (sectionSeen) {
          // A later claimant is ignored — and it also ENDS the active section,
          // or an adjacent duplicate's children would merge into the first.
          inSection = false;
          continue;
        }
        const after = line.replace(FRONTMATTER_KEY_LINE, '').trim();
        if (after.length > 0) {
          // Flow-map or scalar value on the key itself is outside the subset.
          diagnostics.push(
            'issuegraph: inline value on the top-level key is outside the supported subset; block ignored',
          );
          return { data: null, diagnostics, blockDefect: null };
        }
        inSection = true;
        sectionSeen = true;
      } else {
        if (inSection) inSection = false; // another top-level key: inert
      }
      continue;
    }

    if (!inSection) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed === '-') {
      // Block-list item for the current entry — only when an entry is open to
      // receive it and the item sits at or below the child level.
      if (
        indent === childIndent &&
        current !== null &&
        current.scalar === '' &&
        (current.itemIndent === -1 || current.itemIndent === indent)
      ) {
        // Standard YAML permits an indentationless sequence value: items at
        // the KEY's own indent belong to the preceding key when that key has
        // no scalar (this is yaml.dump's default emission style). Falls
        // through to the attach path below.
      } else if (childIndent === -1 || indent <= childIndent) {
        // Otherwise a section-level item is a sequence/mapping mixture —
        // before or after mapping entries, or beside a key that already has a
        // scalar value: structurally invalid, order-blind.
        sectionContentInvalid = true;
        diagnostics.push(`issuegraph: list item without a key ("${trimmed}"); ignored`);
        continue;
      }
      if (current === null) {
        // Deeper than the child level with no open entry: content of whatever
        // the nested mapping closed. Diagnostic-worthy only when that owner
        // was a recognized field; extension subtrees are inert and silent.
        if (closedOwnerRecognized) {
          diagnostics.push(`issuegraph: list item without a key ("${trimmed}"); ignored`);
        }
        continue;
      }
      if (current.itemIndent === -1) current.itemIndent = indent;
      if (indent !== current.itemIndent) {
        // A dash nested inside an item. For a RECOGNIZED field this is a
        // malformed continuation worth a diagnostic; inside an unrecognized
        // extension subtree it is inert and silent (SPEC §4.1).
        if (isField(current.key)) {
          diagnostics.push(`issuegraph: nested list content ("${trimmed}"); ignored`);
        }
        continue;
      }
      current.blockItems.push(trimmed === '-' ? '' : trimmed.slice(2).trim());
      continue;
    }

    if (childIndent === -1) childIndent = indent;
    if (indent !== childIndent) {
      // Nested content of some entry (an extension subtree): inert — and it
      // CLOSES the current entry, so a deeper list cannot misattach to it.
      // Remember whether the closed owner was a recognized field: malformed
      // continuations under recognized fields stay diagnostic-worthy, while
      // unrecognized extension subtrees are inert AND silent (SPEC §4.1).
      if (current !== null) {
        closedOwnerRecognized = isField(current.key);
        if (closedOwnerRecognized) contaminated.add(current.key);
      }
      current = null;
      continue;
    }
    const colon = trimmed.indexOf(':');
    // A BLOCK-MAPPING COLON MUST BE FOLLOWED BY WHITESPACE OR END-OF-LINE.
    // Without that test `blocked-by:[1]` and `priority:0` parsed as fields,
    // while a conforming YAML reader sees a plain SCALAR — so this reader
    // derived edges and priorities that another reader, reading the same body,
    // does not have. Two conforming readers disagreeing about the graph is the
    // one failure a reference implementation cannot ship.
    //
    // It degrades the whole block through the same arm as any other unparseable
    // line, and that is faithful rather than heavy-handed: a section whose
    // children are a scalar, or a mixture of a scalar and mapping entries, is
    // not a mapping in YAML either.
    const separated = colon !== -1 && (colon + 1 === trimmed.length || trimmed[colon + 1] === ' ' || trimmed[colon + 1] === '\t');
    if (!separated) {
      sectionContentInvalid = true;
      diagnostics.push(`issuegraph: unparseable line ("${trimmed}"); ignored`);
      continue;
    }
    const key = trimmed.slice(0, colon).trim();
    const scalar = trimmed.slice(colon + 1).trim();
    // A REPEATED RECOGNIZED KEY IS A MALFORMED MAPPING, and letting the last
    // one win discards a declaration in silence: `blocked-by: [123]` followed
    // by `blocked-by: []` returned no blockers and no diagnostic, so the issue
    // read as fully declared and unblocked while the dependency it named was
    // thrown away.
    //
    // STRUCTURAL, not a dropped field. Dropping the field would leave the
    // safety hole pointing the wrong way — an issue with no blockers looks
    // schedulable to anything reading `data` alone — so this degrades the whole
    // block, which is also what a strict YAML reader does with a duplicate key.
    //
    // Only RECOGNIZED keys, because §4.1 makes an unrecognized field inert and
    // a repeated inert field decides nothing here.
    if (isField(key) && entries.some((e) => e.key === key)) {
      sectionContentInvalid = true;
      diagnostics.push(`issuegraph: ${key} is declared more than once; block ignored`);
      continue;
    }
    current = { key, scalar, blockItems: [], itemIndent: -1 };
    entries.push(current);
  }

  if (!sectionSeen) {
    // The key existed (extractBlockLines proved it) but never parsed as a
    // top-level section line — outside the subset.
    diagnostics.push('issuegraph: key present but no parseable section');
    return { data: null, diagnostics, blockDefect: null };
  }
  if (sectionContentInvalid) {
    // Direct non-mapping content under the key (a sequence item or unparseable
    // line at the section's own level) is STRUCTURAL: the documented contract
    // degrades the whole block to null, even when valid mapping entries were
    // also collected — a sequence/mapping mixture is not valid YAML.
    diagnostics.push('issuegraph: section is not a mapping; block ignored');
    return { data: null, diagnostics, blockDefect: null };
  }

  // Validate recognized fields.
  let blockedBy: IssueRef[] = [];
  let decomposedFrom: IssueRef | null = null;
  let duplicateOf: IssueRef | null = null;
  let serializeWith: IssueRef | null = null;
  let togetherWith: IssueRef | null = null;
  let priority: Priority | null = null;
  let evidence: Evidence | null = null;

  const singleRef = (entry: RawEntry): IssueRef | null => {
    if (entry.blockItems.length > 0 || entry.scalar.startsWith('[')) {
      diagnostics.push(`issuegraph: ${entry.key} takes a single ref, not a list; dropped`);
      return null;
    }
    const ref = parseRef(entry.scalar);
    if (ref === null) {
      diagnostics.push(`issuegraph: ${entry.key} has an unparseable ref ("${entry.scalar}"); dropped`);
    }
    return ref;
  };

  for (const entry of entries) {
    if (!isField(entry.key)) continue; // inert, silently
    if (contaminated.has(entry.key)) {
      diagnostics.push(`issuegraph: ${entry.key} has nested mapping content; dropped`);
      continue;
    }
    switch (entry.key) {
      case 'blocked-by': {
        if (entry.blockItems.length > 0 && entry.scalar.length > 0) {
          diagnostics.push('issuegraph: blocked-by has both a scalar value and list items; dropped');
          break;
        }
        let items: string[];
        if (entry.blockItems.length > 0) items = entry.blockItems;
        else if (entry.scalar.startsWith('[') && entry.scalar.endsWith(']')) {
          items = splitFlowList(entry.scalar.slice(1, -1));
        } else if (entry.scalar.length > 0) {
          items = [entry.scalar]; // single scalar tolerated as a 1-list
        } else {
          // A BARE `blocked-by:` IS A YAML NULL, NOT AN EMPTY LIST, and the two
          // must not answer the same. `[]` is a writer declaring no blockers;
          // a null is a field whose value is missing, which this reader cannot
          // turn into a list without inventing one. Silent, it returned an
          // empty list with no diagnostic — indistinguishable from `[]` — so
          // `isUnreadDeclaration` said the declaration was fully read.
          //
          // Every OTHER recognised field already diagnoses a blank value:
          // `duplicate-of:`, `serialize-with:`, `together-with:` through
          // `parseRef('')`, and `priority:` / `evidence:` through their own
          // arms. This was the one exception, which is what makes it an
          // inconsistency rather than a tolerance.
          //
          // The block-list form is unaffected: `blocked-by:` with indented
          // items has a blank scalar too, and the branch above claims it first.
          diagnostics.push(
            'issuegraph: blocked-by has no value (write [] to declare none); dropped',
          );
          items = [];
        }
        const refs: IssueRef[] = [];
        for (const item of items) {
          const ref = parseRef(item);
          if (ref === null) {
            diagnostics.push(`issuegraph: blocked-by item unparseable ("${item}"); dropped`);
          } else {
            refs.push(ref);
          }
        }
        blockedBy = refs;
        break;
      }
      case 'decomposed-from':
        decomposedFrom = singleRef(entry);
        break;
      case 'duplicate-of':
        duplicateOf = singleRef(entry);
        break;
      case 'serialize-with':
        serializeWith = singleRef(entry);
        break;
      case 'together-with':
        togetherWith = singleRef(entry);
        break;
      case 'priority': {
        if (entry.blockItems.length > 0) {
          diagnostics.push('issuegraph: priority has nested list content; dropped');
          break;
        }
        const raw = stripQuotes(entry.scalar);
        // `Number("")` is 0, and an empty scalar is an ABSENT value rather than
        // the most urgent priority there is — so the empty case is mapped away
        // from the numeric conversion before `isPriority` ever sees it.
        const n = raw === '' ? Number.NaN : Number(raw);
        if (isPriority(n)) priority = n;
        else
          diagnostics.push(
            `issuegraph: priority must be an integer ${PRIORITY_MIN}-${PRIORITY_MAX} (got "${entry.scalar}"); dropped`,
          );
        break;
      }
      case 'evidence': {
        if (entry.blockItems.length > 0) {
          diagnostics.push('issuegraph: evidence has nested list content; dropped');
          break;
        }
        const v = stripQuotes(entry.scalar);
        if (isEvidence(v)) evidence = v;
        else
          diagnostics.push(
            `issuegraph: evidence must be ${EVIDENCE_VALUES.join("|")} (got "${entry.scalar}"); dropped`,
          );
        break;
      }
    }
  }

  return {
    data: { blockedBy, decomposedFrom, duplicateOf, serializeWith, togetherWith, priority, evidence },
    diagnostics,
    // The block was delimited and walked; any diagnostic here is a FIELD
    // rejection inside it, never a block-level defect.
    blockDefect: null,
  };
}
