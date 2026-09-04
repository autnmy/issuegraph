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
  type Field,
  type Priority,
} from '@issuegraph/core';
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  Parser,
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
 * finds nothing. So it accepts spellings the parser will go on to reject,
 * unbalanced quotes included, and the YAML parse is what actually decides.
 *
 * IT IS NOT A SUPERSET OF EVERY SPELLING THE READER ACCEPTS, and saying so
 * plainly matters more than the property would. This reader takes the key its
 * YAML parser reports, so a flow-root (`{issuegraph: …}`) or escape-encoded
 * (`"\u0069ssuegraph"`) key is read and this pattern cannot match either.
 * §4.1 closes that gap on the WRITE side — a conforming writer writes the key
 * literally, at the document's top level — so a mirror prefiltering with this
 * is correct for every conforming body, and the reader never depends on it
 * ({@link blockCarriesKey} ORs it with the parser's own answer). What a mirror
 * must not assume is that a body this misses cannot carry a declaration.
 */
export const FRONTMATTER_KEY_PATTERN = `["']*${FRONTMATTER_KEY}["']*[ \\t]*:`;

/**
 * The accepted key LINE: {@link FRONTMATTER_KEY_PATTERN} anchored to a
 * line's start. Every in-module test of "is this the block's key line?" runs
 * through this one regex, so the rule has a single site to change.
 */
const FRONTMATTER_KEY_LINE = new RegExp(`^${FRONTMATTER_KEY_PATTERN}`);

/**
 * The same rule at a position that could plausibly BE a mapping key, for the one
 * question that must be asked of a block whose YAML did not parse: "did this
 * plausibly mean to carry a declaration?" A failed parse cannot answer it, and
 * treating silence as "no" is what makes a malformed block indistinguishable
 * from an absent one.
 *
 * ANCHORED TO A KEY POSITION RATHER THAN TO NOTHING AT ALL. The predecessor was
 * a bare substring test, and it selected any malformed block whose text merely
 * MENTIONED the key — inside a quoted scalar, inside a comment. Under §4.1's
 * first-block rule that block then shadowed a later VALID declaration, whose
 * real edges never loaded. Measured on `---\nnote: "issuegraph:\n---` followed
 * by a valid block: `data: null`, one diagnostic, and the good block ignored.
 *
 * A KEY POSITION IS LINE START, `{`, `,`, OR `?` — the places YAML can begin a
 * mapping key. Line start is the block-style spelling (already tried above, and
 * repeated here because this arm also runs on lines the anchored test skipped);
 * `{` and `,` are the FLOW spellings, which is what keeps the case this fallback
 * was added for: `{ issuegraph: { blocked-by: [ "#1" ]` — a malformed flow-root
 * — is still selected, so `parseFrontmatter` can say why it is unreadable rather
 * than reporting no block at all.
 *
 * A NODE PROPERTY MAY SIT BETWEEN THE POSITION AND THE KEY. `&anchor` and
 * `!tag` are legal before a mapping key and the parser accepts them — a
 * WELL-FORMED `&key issuegraph:` is read and its edges load — so a MALFORMED one
 * has to be selected for the same reason every other malformed spelling is.
 * Without this it was not: measured, `&key issuegraph:` with a broken value came
 * back `data: null` with ZERO diagnostics, which is the silent absence this
 * whole arm exists to prevent, and a later valid block was selected instead.
 *
 * `?` IS THE EXPLICIT-KEY INDICATOR, and it is here because the first version of
 * this anchor dropped a spelling the bare mention used to catch: `{? issuegraph
 * : …}`. Review reported it as a regression on the BLOCK-style explicit key
 * (`? issuegraph` on its own line), and that half is not true — that line
 * carries no `:` after the key, so this pattern never matched it and the old one
 * did not either; the parser path is what reads it. The FLOW-style explicit key
 * is the real case, and it was a regression. Measured both before changing
 * anything.
 *
 * IT STILL OVER-SELECTS, NARROWLY, and that is the right side to err on. A
 * comma inside a quoted scalar (`{a: "x, issuegraph: y"}`) still reads as a key
 * position. Deciding otherwise would mean tokenizing the very text that failed
 * to tokenize. Over-selecting costs one advisory diagnostic; under-selecting is
 * the silent absence above, which is strictly worse.
 *
 * BUILT AROUND {@link FRONTMATTER_KEY_PATTERN} RATHER THAN EDITING IT. That
 * constant is exported for mirrors on the other side of a language boundary and
 * is deliberately held to a portable regex subset; this anchor is a local
 * concern, exactly as {@link FRONTMATTER_KEY_LINE} is.
 */
const FRONTMATTER_KEY_AT_KEY_POSITION = new RegExp(
  `(^|[{,?])[ \t]*(?:[&!][^ \t]*[ \t]+)*${FRONTMATTER_KEY_PATTERN}`,
);

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

/**
 * ONE THING THIS PARSE COULD NOT READ, and WHICH PART OF THE BLOCK lost it.
 *
 * THE SCOPE IS THE POINT. `diagnostics` answers the TOTAL question — was
 * anything in this block lost? — and a consumer gating on one field had no way
 * to ask the NARROWED one, so every gate was as strict as the most damaged
 * field anywhere in the block. That over-refusal is fail-closed and therefore
 * safe, but it makes per-field gates unbuildable: a single unrecognised
 * extension field anywhere refuses every gate in the system.
 *
 * The attribution already existed INSIDE the parser — it knows which field it
 * dropped at the moment it drops it. Only the reporting stopped at the package
 * boundary, and this is that boundary opening. Ask the narrowed question
 * through {@link isUnreadDeclarationFor} rather than reading these by hand.
 *
 * WHY A CONSUMER COULD NOT DERIVE IT, recorded because each route looks
 * available until it is tried:
 *
 *   - STRING-MATCHING the diagnostic prose. A reworded message silently stops
 *     matching and fails OPEN, restoring the very defect the predicate exists
 *     to catch. This is the route consumers actually took.
 *   - COMPARING `locateSection().fields` against `data`. Works for a field
 *     dropped ENTIRELY; not for a PARTIAL drop. `blocked-by: [123, "not a ref"]`
 *     leaves an entry that is present and a `blockedBy` that is non-empty, so
 *     the comparison reports "read" while one ref was discarded. `SectionField`
 *     spans cannot close it — they are degenerate for a flow section by
 *     documented design, so item-level counting is unavailable exactly where it
 *     would be needed.
 *   - RE-PARSING the block's YAML. That is a second opinion about what an entry
 *     is — the thing {@link locateSection} was introduced to eliminate, after
 *     three defects were filed against that seam.
 *
 * `field` IS `@issuegraph/core`'s `Field`, NOT A FRESH STRING UNION. The
 * vocabulary has one home; a second spelling of it here is the duplicate the
 * core package exists to prevent, and it would be free to drift from `FIELDS`
 * the moment the spec adds one.
 */
export type Finding =
  /**
   * The BLOCK was lost, so which fields it contained is unknowable. A narrowed
   * reader must refuse exactly where the broad one does — see
   * {@link isUnreadDeclarationFor}, which is where that rule is enforced.
   */
  | { readonly scope: 'block'; readonly message: string }
  /** ONE recognised field was dropped; everything else in the block still read. */
  | { readonly scope: 'field'; readonly field: Field; readonly message: string };

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
   * NEVER STRING-MATCH THESE MESSAGES TO ASK ABOUT ONE FIELD. A reworded
   * message silently stops matching and fails OPEN, restoring the defect
   * invisibly. The narrowed question has a structural answer now:
   * {@link findings} carries the attribution and {@link isUnreadDeclarationFor}
   * asks it. This array is DERIVED from those findings — one message each, in
   * order — so the two can never disagree about whether something was lost.
   */
  readonly diagnostics: readonly string[];
  /**
   * The same losses as {@link diagnostics}, each attributed to the part of the
   * block that lost it — one finding per message, same order.
   *
   * IT IS THE SOURCE AND `diagnostics` IS THE PROJECTION, not two arrays kept
   * in step. Two hand-maintained lists drift, and a drifted pair reports a loss
   * to one reader and not the other — which is the failure this whole field
   * exists to end, reintroduced one level down.
   *
   * Read it through {@link isUnreadDeclarationFor} rather than by hand: the
   * block/field rule is the part that is easy to get wrong, and getting it
   * wrong fails OPEN.
   */
  readonly findings: readonly Finding[];
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
 * `owner/repo#123` (§4.2). `null` when the token is not a legal reference.
 *
 * EXPORTED BECAUSE IT IS THE MOST-RESTATED RULE IN THE FORMAT. A consumer that
 * validates its own input — a CLI flag, a write request, an order document —
 * has to answer "is this a reference?" before calling in, and until this was
 * exported the only ways to answer were to re-implement the grammar or to feed
 * a synthetic frontmatter block to {@link parseFrontmatter} and read the result
 * back. Both were observed: re-implementation drifts into accepting values the
 * library then refuses, and the round-trip is a parser invocation standing in
 * for a function call. This is that function.
 *
 * NOT TRIMMED, and the reason is measured rather than stylistic. YAML already
 * strips surrounding whitespace from a PLAIN scalar — including inside a flow
 * sequence — so a trim here could only ever act on a QUOTED one, where the
 * author explicitly asked for those bytes. Trimming there bypasses `isRefId`'s
 * deliberate whitespace exclusion: `" #123 "` would become the reference `123`
 * and a re-render would write it back as `"#123"`, silently changing what the
 * author wrote.
 *
 * A CALLER READING FROM SOMEWHERE THAT IS NOT YAML may legitimately trim first
 * — a shell argument carries whitespace the user never typed — but that is the
 * caller's decision about its own input, taken BEFORE this is called, and it
 * does not transfer to a token read out of a document.
 *
 * TAKES `unknown` AND TESTS THE TYPE FIRST, matching `@issuegraph/core`'s
 * `isRefId`, and for the reason that predicate records: these are PUBLISHED
 * packages, so a `string` annotation is a promise to TypeScript callers and
 * nothing at all to JavaScript ones. While this function was private its
 * callers were all internal and all passed strings; exporting it makes that
 * assumption unenforceable. Measured before the guard: `parseRef(undefined)`
 * and `parseRef(123)` THREW a `TypeError` rather than refusing, which would
 * have made a validator that cannot be called defensively — the opposite of
 * what a consumer exports it to do, and this reader's stated discipline is that
 * parsing untrusted input never throws.
 */
export function parseRef(s: unknown): IssueRef | null {
  if (typeof s !== 'string' || s.length === 0) return null;

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
 * Whether a `---` block carries the top-level `issuegraph` key.
 *
 * A UNION OF TWO TESTS, AND THE UNION IS THE POINT: the cheap line prefilter,
 * OR the key the YAML parser actually reports. Either alone loses declarations.
 *
 * THE PREFILTER ALONE MISSES EVERY SPELLING IT CANNOT SEE, and one of them is
 * ordinary rather than exotic. `yaml.stringify` in flow style emits
 *
 *     { issuegraph: { blocked-by: [ "#1" ] } }
 *
 * which no line-anchored key pattern matches — so a conforming third-party
 * writer's block was reported as NO BLOCK, with `data: null` and ZERO
 * diagnostics. Indistinguishable from an issue that never declared anything,
 * which is the absence-rendered-as-a-value licence this module refuses
 * everywhere else. The explicit-key (`? issuegraph`) and escape-encoded
 * (`"\u0069ssuegraph"`) spellings fail the same way.
 *
 * Widening the PATTERN instead was the obvious move and is the wrong one: it is
 * a denylist of spellings, it grows a row per review round, and every row it is
 * missing is another silent loss. Asking the parser is total by construction.
 *
 * THE PREFILTER IS STILL OR-ED IN, and dropping it would be a regression rather
 * than a simplification. A block that carries the key but does NOT parse — a
 * duplicate key, a tab in the indentation — must still be SELECTED, so that
 * `parseFrontmatter` can report why it is unreadable. Judge it by the parse
 * alone and such a block becomes invisible: no block, no defect, no diagnostic.
 * The union can only ever select more, so it cannot lose a case the previous
 * rule caught.
 */
function blockCarriesKey(block: readonly string[]): boolean {
  if (block.some((line) => FRONTMATTER_KEY_LINE.test(line))) return true;
  const doc = readDocument(block.join('\n'));
  if (doc === null) {
    // A FAILED PARSE IS NOT TESTIMONY THAT THE KEY IS ABSENT, and reading it as
    // one is how a MALFORMED flow-root block came back as an issue with no
    // declaration at all: `data: null`, no diagnostic, `isUnreadDeclaration`
    // false. The block-style spelling of the same fault is caught by the line
    // prefilter above and reports itself correctly, so the two spellings
    // disagreed about a body that plainly meant to declare something.
    //
    // AT A KEY POSITION, NOT ANYWHERE. This arm decides only whether to SELECT
    // the block so `parseFrontmatter` can say WHY it is unreadable — it never
    // decides what the block means, so it errs toward selecting. But a bare
    // substring test errs too far: it selected a block that merely MENTIONED
    // the key in a scalar or a comment, and §4.1's first-block rule then let
    // that block shadow a later VALID declaration. Restricting to the positions
    // YAML can start a mapping key keeps the malformed-flow case this arm
    // exists for and drops the mention case. See the constant for the residue.
    return block.some((line) => FRONTMATTER_KEY_AT_KEY_POSITION.test(line));
  }
  const root = doc.contents;
  if (!isMap(root)) return false;
  return root.items.some((pair) => scalarKey(pair) === FRONTMATTER_KEY);
}

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
      if (blockCarriesKey(block)) {
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
 * {@link isUnreadDeclaration}, NARROWED to the fields a caller actually
 * consumes: TRUE when a delimited block was found and something **those**
 * fields depend on could not be read.
 *
 * WHY THE NARROWING IS NOT A NICETY. A consumer gating admission on
 * `blocked-by` must refuse a body whose `blocked-by` was damaged. With only the
 * total predicate it must ALSO refuse a body whose `priority` was damaged and
 * whose `blocked-by` read perfectly — so every gate is as strict as the most
 * damaged field anywhere in the block, and one unrecognised extension field
 * anywhere refuses every gate in the system. That is fail-closed and therefore
 * safe, which is exactly why it survived: it never announces itself.
 *
 * TWO PROPERTIES HOLD, and both are pinned by this module's tests because a
 * caller may rely on them:
 *
 *   - A `block`-SCOPED FINDING ANSWERS TRUE TO EVERY QUERY, including one for
 *     the empty set. A structural loss discards the block entire, so the fields
 *     it contained are unknowable and a narrowed reader must refuse exactly
 *     where the broad one does. Without this the narrowing is a HOLE rather
 *     than a refinement — and it is the arm that fails OPEN if it is dropped,
 *     which is why it is stated before the field test below rather than after.
 *   - ASKING FOR THE FULL FIELD SET REPRODUCES {@link isUnreadDeclaration}
 *     EXACTLY. That is what keeps the broad and narrow predicates from drifting
 *     into disagreement, and it is a test rather than a comment because nothing
 *     else would notice if a future field forgot to be attributed.
 *
 * THE POLICY IS STILL NOT SHARED. Like its broad sibling this answers the
 * question and says nothing about what to do — refuse to clear, drop the
 * candidate, refuse the write, report a verdict. Each caller still decides.
 *
 * `Iterable<Field>` so a `Set` a caller already holds and an inline array are
 * both ordinary arguments; it is materialised once here rather than rescanned
 * per finding.
 */
export function isUnreadDeclarationFor(parse: ParseResult, fields: Iterable<Field>): boolean {
  if (parse.blockDefect !== null) return false;
  const wanted = new Set(fields);
  return parse.findings.some((finding) => finding.scope === 'block' || wanted.has(finding.field));
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
  /**
   * Interior line indices inside the span, after the key's line, that are
   * nothing but a YAML comment — an author's prose sitting inside the entry.
   *
   * ANSWERED BY THE TOKENIZER, not by the shape of the line. `#123` under
   * `duplicate-of: |-` is a block scalar's CONTENT and a valid ref this reader
   * accepts, while `# ruling` between `blocked-by:` and its items is a
   * comment; both open with `#` after indentation, and only the tokenizer
   * that produced the document knows which is which. A writer replacing the
   * entry keeps the second and removes the first, and it must not be left to
   * guess between them with a regular expression.
   *
   * A trailing comment on a content line is NOT listed: that line is content,
   * and it goes with the entry. Degenerate (empty) for a flow section, like
   * the spans themselves.
   */
  readonly commentLines: readonly number[];
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
  /**
   * Whether a writer can insert or replace lines inside this section.
   *
   * SEPARATE FROM `null`, and that separation is the point. Returning `null`
   * for "there is no readable section" AND for "there is one I cannot edit
   * line by line" made the two indistinguishable to a caller — and the
   * caller's response to the first (prepend a fresh block) SILENTLY DESTROYS
   * the second, because §4.1's first-block rule then demotes a block that
   * carries fields. A value that says "I could not answer" and one that says
   * "the answer is none" must not be the same value.
   */
  readonly lineEditable: boolean;
  /**
   * Every entry the section carries, RECOGNISED OR NOT.
   *
   * Unrecognised entries are included deliberately: §4.1 makes them inert to
   * the reader but they are still an author's bytes, and a writer deciding
   * whether anything would be lost must count them. Asking the recognised
   * `Frontmatter` projection instead reported "nothing here" for a section
   * carrying only an extension field.
   *
   * When `lineEditable` is false the spans are degenerate — a flow section's
   * entries all sit on the header's line — so read the KEYS, never the spans.
   */
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
 * NULL MEANS EXACTLY ONE THING: there is no readable section here — the YAML
 * did not parse, no `issuegraph` key is a top-level mapping key, or its value
 * is a scalar or a sequence. A writer that stops on `null` and a reader
 * returning `data: null` are then answering from the same evidence, and a
 * caller's prepend loses nothing because there was nothing to lose.
 *
 * A SECTION THAT READS BUT CANNOT BE LINE-EDITED IS NOT NULL. It comes back
 * with `lineEditable: false` and its fields intact, because those are two
 * different answers and collapsing them is what let a caller's prepend
 * silently demote a block carrying an author's fields.
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
  let lineEditable = isLineEditableSection(section.value);

  const headerRange = nodeRange(section.key);
  if (headerRange === null) return null;
  const headerLine = lineAt(headerRange[0]);
  const comments = commentOnlyLines(text, lineAt);
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
    // parser reads, but every entry in it starts on the header's line, so
    // replacing an entry's span would delete the header. That makes the section
    // UNEDITABLE — not unreadable — so the fields are still reported and the
    // caller is told which of the two it is.
    if (startLine <= headerLine) lineEditable = false;
    // `range[2]` is the node END, which includes trailing comments and the
    // whitespace that closes the node — so it can land PAST the entry's last
    // content. How far past depends on what the node is, and the first fix
    // here modelled only one of the two shapes:
    //
    //   - A node with a VALUE ends after its newline, so `rawEnd - 1` is the
    //     newline itself, or a blank line below it. A step-back over blank
    //     LINES covered that.
    //   - A node the parser reads as EMPTY WITH A COMMENT — `- #9094`, the
    //     unquoted-sigil shape a hand author writes, or `serialize-with: #7` —
    //     ends at the FIRST CONTENT BYTE OF THE NEXT LINE. `rawEnd - 1` is then
    //     the next sibling's indentation: a line with content, which no
    //     blank-line step-back can leave. The entry's span swallowed the
    //     sibling, and a writer removing that span removed the sibling's
    //     bytes with it (autnmy/issuegraph#92, `evidence: verified` gone).
    //
    // Both are one rule: an entry ends on the line holding the last
    // NON-WHITESPACE byte its node put in the text. Step back over every
    // whitespace BYTE, which crosses a newline, an indentation and a blank
    // line alike, and stops at content the node owns — a value, or its
    // trailing comment. A keep-chomped block scalar (`|+`) whose value ends
    // in blank lines therefore spans to its last content line, exactly as the
    // blank-line step-back already had it; those lines are never removed,
    // because a splice removes only the lines of an entry it owns and no
    // owned field is a block scalar.
    const valueRange = nodeRange(pair.value);
    const rawEnd = valueRange === null ? keyRange[2] : valueRange[2];
    const endLine = lineAt(lastContentOffset(text, rawEnd, keyRange[0]));
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
    const commentLines: number[] = [];
    for (let l = startLine + 1; l <= endLine; l++) if (comments.has(l)) commentLines.push(l);
    fields.push({ key, startLine, endLine, commentLines });
  }
  return {
    headerLine,
    endLine: sectionEnd,
    // AN EMPTY SECTION HAS NO CHILD TO MEASURE, so the fallback is derived from
    // the HEADER's own column rather than assumed to be 2. Assuming it put a
    // writer's first insert at the header's own indent when the block itself
    // was indented — `  issuegraph:` — so `  blocked-by:` landed as a SIBLING
    // of the section instead of a child. The body still parsed, so the
    // post-edit readability check passed, and the caller was told the write
    // succeeded while the blocker it asked for was never written.
    childIndent: childIndent === -1 ? columnAt(text, headerRange[0]) + 2 : childIndent,
    lineEditable,
    fields,
    hasSiblingKeys,
  };
}

/**
 * Parse the canonical issuegraph frontmatter out of an issue body (SPEC §4).
 * Never throws on any input.
 */
export function parseFrontmatter(body: string): ParseResult {
  const findings: Finding[] = [];
  /**
   * THE BLOCK WAS LOST. Every one of these also returns `data: null`, and that
   * correspondence is the rule to check a new site against: a loss that leaves
   * `data` non-null lost a FIELD, not the block. Mis-scoping the other way —
   * a field loss recorded as `block` — merely over-refuses, but recording a
   * block loss as a field would let a narrowed reader clear a block it cannot
   * see inside, which is the one direction that fails OPEN.
   */
  const blockLost = (message: string): void => {
    findings.push({ scope: 'block', message });
  };
  /** ONE recognised field was dropped; the rest of the block still read. */
  const fieldLost = (field: Field, message: string): void => {
    findings.push({ scope: 'field', field, message });
  };
  /**
   * `diagnostics` IS A PROJECTION of `findings`, which is what makes the two
   * incapable of disagreeing about whether something was lost.
   *
   * BOTH COME OFF ONE SNAPSHOT, and that is not ceremony. Returning the live
   * accumulator as `findings` while `diagnostics` is a mapped copy would let
   * the pair diverge the moment anything pushed after the call — the exact
   * drift this derivation exists to prevent, reintroduced by the mechanism
   * meant to prevent it. Every call below is a tail `return`, so nothing
   * reaches that today; copying makes it unreachable by construction instead
   * of by call-site discipline, at the cost of one allocation on an array that
   * is empty in the ordinary case.
   */
  const parsed = (data: Frontmatter | null, blockDefect: BlockDefect | null): ParseResult => {
    const snapshot = [...findings];
    return { data, diagnostics: snapshot.map((finding) => finding.message), findings: snapshot, blockDefect };
  };

  const located = locateBlock(body);
  if (located.lines === null) {
    if (located.defect !== null) blockLost(BLOCK_DEFECT_DIAGNOSTIC[located.defect]);
    return parsed(null, located.defect);
  }

  // THE TEXT THE RANGES INDEX. Every node range below is an offset into exactly
  // this string, so it is computed once and threaded rather than rebuilt.
  const blockText = located.lines.join('\n');
  const read = readDocumentOrReason(blockText);
  if (read.doc === null) {
    blockLost(`issuegraph: the block is not readable YAML (${read.reason ?? 'unreadable'}); block ignored`);
    return parsed(null, null);
  }
  const doc = read.doc;
  const root = doc.contents;
  if (!isMap(root)) {
    blockLost('issuegraph: the block is not a mapping; block ignored');
    return parsed(null, null);
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
    blockLost('issuegraph: key present but no parseable section');
    return parsed(null, null);
  }
  const value = sectionMap(section.value);
  if (value === null) {
    // A scalar or a sequence. Neither is the mapping §4.3 describes, and
    // reading edges out of one would mean inventing them.
    blockLost('issuegraph: section is not a mapping; block ignored');
    return parsed(null, null);
  }

  let blockedBy: readonly IssueRef[] = [];
  let decomposedFrom: IssueRef | null = null;
  let duplicateOf: IssueRef | null = null;
  let serializeWith: IssueRef | null = null;
  let togetherWith: IssueRef | null = null;
  let priority: Priority | null = null;
  let evidence: Evidence | null = null;

  // `key` IS A `Field`, not a string: the loop below refuses anything `isField`
  // rejects before it reaches here, and typing it so is what lets every message
  // attribute itself without the caller restating which field it was reading.
  const singleRef = (key: Field, node: unknown): IssueRef | null => {
    if (isSeq(node)) {
      fieldLost(key, `issuegraph: ${key} takes a single ref, not a list; dropped`);
      return null;
    }
    if (isMap(node)) {
      fieldLost(key, `issuegraph: ${key} has nested mapping content; dropped`);
      return null;
    }
    const token = scalarIdText(node, blockText);
    if (token === null) {
      fieldLost(key, `issuegraph: ${key} has an unparseable ref; dropped`);
      return null;
    }
    const ref = parseRef(token);
    if (ref === null) {
      fieldLost(key, `issuegraph: ${key} has an unparseable ref ("${token}"); dropped`);
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
        blockedBy = refsFrom(pair.value, blockText, fieldLost);
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
          fieldLost(
            key,
            `issuegraph: priority must be an integer ${PRIORITY_MIN}-${PRIORITY_MAX} (got "${describe(raw)}"); dropped`,
          );
        break;
      }
      case 'evidence': {
        const raw: unknown = toJS(pair.value, doc);
        if (typeof raw === 'string' && isEvidence(raw)) evidence = raw;
        else
          fieldLost(key, `issuegraph: evidence must be ${EVIDENCE_VALUES.join('|')} (got "${describe(raw)}"); dropped`);
        break;
      }
    }
  }

  // The block was delimited and parsed; any finding here is a FIELD rejection
  // inside it, never a block-level defect.
  return parsed({ blockedBy, decomposedFrom, duplicateOf, serializeWith, togetherWith, priority, evidence }, null);
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
function refsFrom(node: unknown, text: string, fieldLost: (field: Field, message: string) => void): readonly IssueRef[] {
  // EVERY LOSS HERE IS `blocked-by`'s — this function reads that field and no
  // other — so it attributes its own rather than letting the caller restate it.
  // A partial drop is why the attribution has to come from in here: the list
  // still returns members, so nothing outside can tell one was discarded.
  const lost = (message: string): void => {
    fieldLost('blocked-by', message);
  };
  if (isMap(node)) {
    lost('issuegraph: blocked-by has nested mapping content; dropped');
    return [];
  }
  if (!isSeq(node)) {
    // A single scalar is tolerated as a one-item list, as it always has been.
    const token = scalarIdText(node, text);
    if (token === null || token.length === 0) {
      lost('issuegraph: blocked-by has no value (write [] to declare none); dropped');
      return [];
    }
    const ref = parseRef(token);
    if (ref === null) {
      lost(`issuegraph: blocked-by item unparseable ("${token}"); dropped`);
      return [];
    }
    return [ref];
  }
  const refs: IssueRef[] = [];
  for (const item of node.items) {
    const token = scalarIdText(item, text);
    if (token === null) {
      lost('issuegraph: blocked-by item is not a reference; dropped');
      continue;
    }
    const ref = parseRef(token);
    if (ref === null) {
      lost(`issuegraph: blocked-by item unparseable ("${token}"); dropped`);
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

/**
 * The offset of the last non-whitespace byte before `end`, never below `floor`.
 *
 * WHITESPACE MEANS BYTES, NOT LINES. The `yaml` node end for an empty node
 * carrying a comment sits on the NEXT line's first content byte, so stepping
 * back a line at a time cannot reach the node's own last byte — the line it
 * lands on has content, and it is somebody else's. Stepping back a byte at a
 * time stops on the comment's last character, which is the node's.
 */
function lastContentOffset(text: string, end: number, floor: number): number {
  let at = Math.min(end, text.length) - 1;
  while (at > floor && isYamlWhitespace(text.charCodeAt(at))) at -= 1;
  return Math.max(at, floor);
}

/**
 * YAML's own whitespace: space, tab, and the two line-break bytes. Narrower
 * than `\s` on purpose — a non-breaking space is content to the parser, so
 * stepping over one would land a span short of a byte the node owns.
 */
function isYamlWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/** The column an offset sits at, counted from its line's start. */
function columnAt(text: string, offset: number): number {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return offset - lineStart;
}

/**
 * The line indices of every line in `text` that is nothing but a comment.
 *
 * READ OFF THE CONCRETE SYNTAX TREE, from the same tokenizer `parseDocument`
 * runs, so the answer is the tokenizer's rather than a second opinion about
 * where a comment begins. A `#` after indentation opens a comment in a block
 * mapping and is CONTENT inside a block scalar (`|-` / `>-`), and this reader
 * accepts a block scalar as a ref — so a line's shape cannot decide it. The
 * CST carries a `comment` token only for the first case.
 *
 * COMMENT-ONLY, not "carries a comment": a token that starts at the line's
 * first non-blank column is the whole of that line. A trailing comment on a
 * content line starts later and is not reported, because the line it sits on
 * is content and belongs to whatever entry owns it.
 *
 * The walk is generic over the CST rather than typed per token kind: comment
 * tokens sit in an item's `start`, `sep` and `end` arrays across every
 * collection shape, and enumerating those positions is a list that grows a
 * row per YAML construct. `type === 'comment'` with an `offset` is the whole
 * of what is asked, and only a token can carry it.
 */
function commentOnlyLines(text: string, lineAt: (offset: number) => number): ReadonlySet<number> {
  const lines = text.split('\n');
  const found = new Set<number>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const token = value as Readonly<Record<string, unknown>>;
    const offset = token['offset'];
    if (token['type'] === 'comment' && typeof offset === 'number') {
      const line = lineAt(offset);
      const source = lines[line] ?? '';
      if (columnAt(text, offset) === source.length - source.trimStart().length) found.add(line);
    }
    for (const key of Object.keys(token)) walk(token[key]);
  };
  for (const doc of new Parser().parse(text)) walk(doc);
  return found;
}
