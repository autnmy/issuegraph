import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FRONTMATTER_KEY_PATTERN,
  isUnreadDeclaration,
  parseFrontmatter,
} from './frontmatter.ts';

/**
 * `haystack.includes(needle)` as an assertion that survives
 * `noUncheckedIndexedAccess` and says what it saw when it fails. An
 * `assert.ok(x.includes(y))` on a possibly-absent element does not typecheck,
 * and widening it with `?.` would let an ABSENT value pass as a non-match
 * without saying so.
 */
function assertIncludes(haystack: string | undefined, needle: string): void {
  assert.ok(
    haystack !== undefined && haystack.includes(needle),
    `expected ${JSON.stringify(haystack)} to contain ${JSON.stringify(needle)}`,
  );
}

const FENCED = [
  "```",
  "---",
  "issuegraph:",
  "  decomposed-from: 7129",
  "  blocked-by: [7143, 3367]",
  "  priority: 1",
  "---",
  "```",
  "",
  "## What",
  "Body prose.",
].join("\n");

// THE ACCEPTED KEY SPELLING, pinned where it is DEFINED. This rule gets a
// second reader across a language boundary — a tracker mirror that prefilters
// bodies in SQL before spending a parse on them, an index predicate that
// encodes the same decision — and the first hand-written copies of it drifted
// immediately: they required the contiguous substring `issuegraph:`, so an
// author who wrote `issuegraph :` was invisible to them while being perfectly
// valid here. A derived copy fixes that only while what this parser accepts is
// pinned as BEHAVIOUR, rather than left as somebody's reading of a regex.
describe("parseFrontmatter: the accepted header spelling", () => {
  const HEADER_SPELLINGS = [
    ["no space, the canonical form", "issuegraph:"],
    ["a space before the colon", "issuegraph :"],
    ["several spaces before the colon", "issuegraph   :"],
    ["a tab before the colon", "issuegraph\t:"],
    ["a tab and a space before the colon", "issuegraph \t :"],
  ] as const;

  for (const [label, header] of HEADER_SPELLINGS) {
    test(`accepts a block whose key is written with ${label}`, () => {
      const body = ["---", header, "  blocked-by: [42]", "---", "", "prose"].join("\n");
      const r = parseFrontmatter(body);
      assert.deepEqual(r.data?.blockedBy, [{ repo: null, number: 42 }]);
    });
  }

  test("matches every accepted spelling with the exported pattern, and only at a line's start", () => {
    // The constant the SQL side derives from. If it ever stops describing what
    // the cases above accept, the derived predicate is describing something
    // else too — which is the drift this pins.
    const line = new RegExp(`^${FRONTMATTER_KEY_PATTERN}`);
    for (const [, header] of HEADER_SPELLINGS) assert.equal(line.test(header), true);
    assert.equal(line.test("  issuegraph:"), false);
    assert.equal(line.test("the issuegraph: key"), false);
    assert.equal(line.test("issuegraph"), false);
    assert.equal(line.test("issuegraph\n:"), false);
  });

  test("still requires the key at indent 0 of a --- block, not merely somewhere", () => {
    const r = parseFrontmatter("a paragraph mentioning issuegraph : loudly\n");
    assert.equal(r.data, null);
    assert.deepEqual(r.diagnostics, []);
  });
});

describe("parseFrontmatter", () => {
  test("parses the fence-wrapped GitHub form", () => {
    const r = parseFrontmatter(FENCED);
    assert.deepEqual(r.diagnostics, []);
    assert.notEqual(r.data, null);
    assert.deepEqual(r.data?.decomposedFrom, { repo: null, number: 7129 });
    assert.deepEqual(r.data?.blockedBy, [
      { repo: null, number: 7143 },
      { repo: null, number: 3367 },
    ]);
    assert.equal(r.data?.priority, 1);
  });

  test("parses a bare block and tolerates a leading banner", () => {
    const body = ["> [!NOTE]", "> banner", "", "---", "issuegraph:", "  priority: 0", "---", "prose"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 0);
  });

  test("returns null with no diagnostics when no frontmatter exists", () => {
    const r = parseFrontmatter("just prose\n\nmore prose");
    assert.equal(r.data, null);
    assert.deepEqual(r.diagnostics, []);
  });

  // Bounds are part of parsing (#7145 review): a digit-run outside safe
  // positive integers is UNPARSEABLE, never a ref — `Number()` loses precision
  // past 2^53 and the renderer would emit scientific notation (or throw on 0),
  // so an unbounded parse lets author-supplied digits ride a writer's
  // re-render into a corrupted line.
  test("drops zero and unsafe-magnitude refs with a diagnostic, in every spelling", () => {
    const body = [
      "---",
      "issuegraph:",
      "  blocked-by:",
      "    - 0",
      "    - 99999999999999999999999",
      "    - 7143",
      "  duplicate-of: '#0'",
      "  serialize-with: acme/widgets#99999999999999999999999",
      "---",
    ].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, [{ repo: null, number: 7143 }]);
    assert.equal(r.data?.duplicateOf, null);
    assert.equal(r.data?.serializeWith, null);
    // Each drop is reported — four invalid refs, four diagnostics.
    assert.equal(r.diagnostics.length, 4);
    assertIncludes(r.diagnostics.join(" "), "unparseable");
  });

  test("skips --- pairs without the key and finds a later canonical block", () => {
    const body = ["intro", "---", "a horizontal rule section", "---", "issuegraph:", "  priority: 3", "---", "tail"].join("\n");
    // First pair (lines 2-4) lacks the key; the scan restarts at its closing
    // delimiter, so the block from there to the final --- carries the key.
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 3);
  });

  test("first block with the key wins; later claimants are ignored", () => {
    const body = ["---", "issuegraph:", "  priority: 1", "---", "middle", "---", "issuegraph:", "  priority: 3", "---"].join("\n");
    assert.equal(parseFrontmatter(body).data?.priority, 1);
  });

  test("a duplicate issuegraph key WITHIN one block is ignored too", () => {
    const body = ["---", "issuegraph:", "  priority: 1", "other: x", "issuegraph:", "  priority: 3", "  evidence: verified", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 1);
    assert.equal(r.data?.evidence, null);
  });

  test("accepts block lists, single scalars, and flow lists for blocked-by", () => {
    const block = (v: string[]): string => ["---", "issuegraph:", ...v, "---"].join("\n");
    assert.deepEqual(parseFrontmatter(block(["  blocked-by:", "    - 1", "    - 2"])).data?.blockedBy, [
      { repo: null, number: 1 },
      { repo: null, number: 2 },
    ]);
    assert.deepEqual(parseFrontmatter(block(["  blocked-by: 9"])).data?.blockedBy, [
      { repo: null, number: 9 },
    ]);
    assert.deepEqual(parseFrontmatter(block(["  blocked-by: []"])).data?.blockedBy, []);
  });

  test("an empty flow-list entry is a dropped item, not a vanished one", () => {
    // The row that made this a defect rather than a nit: `[,]` used to return
    // an empty list with NO diagnostic, which is byte-identical to a body
    // declaring `[]` and no edges. A scheduler reading `data` — or asking
    // `isUnreadDeclaration` — could not tell "this issue has no blockers" from
    // "this issue's blockers could not be read", which is the absence-rendered-
    // as-a-value licence the whole diagnostics contract exists to withhold.
    const block = (v: string): string => ["---", "issuegraph:", `  blocked-by: ${v}`, "---"].join("\n");

    const onlyComma = parseFrontmatter(block("[,]"));
    assert.deepEqual(onlyComma.data?.blockedBy, []);
    assert.ok(onlyComma.diagnostics.length > 0, "an empty entry must be diagnosed");
    assert.equal(isUnreadDeclaration(onlyComma), true);

    // The surviving refs are still read; only the null node is dropped.
    const interior = parseFrontmatter(block("[1,,2]"));
    assert.deepEqual(interior.data?.blockedBy, [
      { repo: null, number: 1 },
      { repo: null, number: 2 },
    ]);
    assert.ok(interior.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(interior), true);
  });

  test("a dedented field is a broken mapping, not nested content", () => {
    // The silent-discard shape: an INERT first child at a deeper indent set the
    // bar, and every properly-placed field after it was read as that child's
    // nested content and skipped — so a declared dependency vanished with no
    // diagnostic and the declaration reported itself fully read.
    const block = (...v: string[]): string => ["---", "issuegraph:", ...v, "---"].join("\n");

    const dedented = parseFrontmatter(block("    extension: x", "  blocked-by: [1]"));
    assert.equal(dedented.data, null);
    assert.ok(dedented.diagnostics.some((d) => d.includes("does not align")));
    assert.equal(isUnreadDeclaration(dedented), true);

    // DEEPER is still inert and still silent — that is §4.1's extension rule and
    // this must not have widened into it. The recognized field beside the
    // subtree is read normally.
    const nested = parseFrontmatter(block("  blocked-by: [1]", "  extension:", "    - value"));
    assert.deepEqual(nested.data?.blockedBy, [{ repo: null, number: 1 }]);
    assert.deepEqual(nested.diagnostics, []);
  });

  test("a quoted TOP-LEVEL key is the same key too", () => {
    // The worst reading in the whole module: `"issuegraph":` returned
    // data null, NO diagnostics and NO block defect — byte-identical to a body
    // that never carried a block. A scheduler cannot distinguish "no
    // dependencies" from "dependencies it could not see", so it dispatches.
    for (const spelling of ['"issuegraph":', "'issuegraph':", "issuegraph :", "issuegraph\t:"]) {
      const r = parseFrontmatter(["---", spelling, "  blocked-by: [1]", "---"].join("\n"));
      assert.deepEqual(r.data?.blockedBy, [{ repo: null, number: 1 }], spelling);
      assert.deepEqual(r.diagnostics, [], spelling);
    }
  });

  test("an inert key containing a colon does not refuse the block", () => {
    // A regression this PR introduced and then removed: once the separator was
    // required, `indexOf(':')` picked the colon INSIDE a quoted extension key,
    // the separator test failed on it, and a whole valid declaration became
    // unread. §4.1 says an unrecognized field is inert — it must not be able to
    // refuse the fields beside it.
    const r = parseFrontmatter(
      ["---", "issuegraph:", '  "extension:foo": v', "  blocked-by: [1]", "---"].join("\n"),
    );
    assert.deepEqual(r.data?.blockedBy, [{ repo: null, number: 1 }]);
    assert.deepEqual(r.diagnostics, []);
  });

  test("the exported pattern is a SUPERSET of what the parser accepts", () => {
    // The invariant a PREFILTER owes, and deliberately not equality: its job is
    // to decide whether a body is worth parsing, on the other side of a
    // language boundary. A false positive costs one parse that finds nothing; a
    // false negative means a declaration is never fetched and silently does not
    // exist. Equality would break the first time the two legitimately diverge.
    const prefilter = new RegExp(`^${FRONTMATTER_KEY_PATTERN}`);
    for (const spelling of [
      "issuegraph:",
      '"issuegraph":',
      "'issuegraph':",
      "issuegraph :",
      "issuegraph\t:",
    ]) {
      const body = ["---", spelling, "  blocked-by: [1]", "---"].join("\n");
      assert.deepEqual(parseFrontmatter(body).data?.blockedBy, [{ repo: null, number: 1 }], spelling);
      assert.ok(prefilter.test(spelling), `prefilter must not miss ${spelling}`);
    }
    // It still discriminates: a different key is not a candidate at all.
    assert.equal(prefilter.test("not-issuegraph:"), false);
  });

  test("a quoted key is the same key", () => {
    const block = (...v: string[]): string => ["---", "issuegraph:", ...v, "---"].join("\n");

    for (const spelling of ['"blocked-by": [1]', "'blocked-by': [1]"]) {
      const r = parseFrontmatter(block(`  ${spelling}`));
      assert.deepEqual(r.data?.blockedBy, [{ repo: null, number: 1 }], spelling);
      assert.deepEqual(r.diagnostics, [], spelling);
    }

    // ...which means the two spellings are the SAME key to the repeat guard.
    // Stripping after that guard would let a quoted duplicate through as a
    // second field and hand the win to whichever came last.
    const repeated = parseFrontmatter(block("  blocked-by: [123]", '  "blocked-by": []'));
    assert.equal(repeated.data, null);
    assert.ok(repeated.diagnostics.some((d) => d.includes("declared more than once")));
  });

  test("a repeated recognized key is malformed, not last-one-wins", () => {
    // The silent-discard shape: the second declaration overwrote the first and
    // said nothing, so an issue that named a dependency read as fully declared
    // and unblocked.
    const block = (...v: string[]): string => ["---", "issuegraph:", ...v, "---"].join("\n");

    for (const repeated of [
      ["  blocked-by: [123]", "  blocked-by: []"],
      ["  blocked-by: [123]", "  blocked-by: [7]"],
      ["  priority: 0", "  priority: 3"],
    ]) {
      const r = parseFrontmatter(block(...repeated));
      assert.equal(r.data, null, repeated.join(" / "));
      assert.ok(r.diagnostics.some((d) => d.includes("declared more than once")), repeated.join(" / "));
      assert.equal(isUnreadDeclaration(r), true, repeated.join(" / "));
    }

    // An UNRECOGNIZED field is inert (§4.1), so repeating one decides nothing
    // and must not degrade a block whose recognized fields are fine.
    const inert = parseFrontmatter(block("  extension: a", "  extension: b", "  blocked-by: [5]"));
    assert.deepEqual(inert.data?.blockedBy, [{ repo: null, number: 5 }]);
    assert.deepEqual(inert.diagnostics, []);
  });

  test("a mapping colon needs whitespace or end-of-line after it", () => {
    // `blocked-by:[1]` is a plain SCALAR to a conforming YAML reader, not a
    // field — so reading it as one made this reader derive an edge that another
    // reader, given the same body, does not have. Two conforming readers
    // disagreeing about the graph is the failure a reference implementation
    // cannot ship, and it is worse than refusing: the divergence is silent.
    const block = (v: string): string => ["---", "issuegraph:", `  ${v}`, "---"].join("\n");

    for (const malformed of ["blocked-by:[1]", "priority:0", "evidence:verified"]) {
      const r = parseFrontmatter(block(malformed));
      assert.equal(r.data, null, malformed);
      assert.ok(r.diagnostics.length > 0, malformed);
      assert.equal(isUnreadDeclaration(r), true, malformed);
    }

    // The two separated forms are unaffected — a space, and end-of-line.
    assert.deepEqual(parseFrontmatter(block("blocked-by: [1]")).data?.blockedBy, [{ repo: null, number: 1 }]);
    assert.deepEqual(parseFrontmatter(block("blocked-by:\t[1]")).data?.blockedBy, [{ repo: null, number: 1 }]);
    const bare = parseFrontmatter(block("duplicate-of:"));
    assert.equal(bare.data?.duplicateOf, null);
    assert.ok(bare.diagnostics.some((d) => d.includes("unparseable ref")), "end-of-line still parses as a field");
  });

  test("a bare blocked-by is a null, and nulls are diagnosed like every other field", () => {
    // The asymmetry that made this a defect: every other recognised field
    // already diagnoses a blank value, and blocked-by silently became `[]` —
    // which is a writer declaring NO blockers, not a field whose value is
    // missing. A scheduler could not tell the two apart.
    const block = (v: string[]): string => ["---", "issuegraph:", ...v, "---"].join("\n");

    const bare = parseFrontmatter(block(["  blocked-by:"]));
    assert.deepEqual(bare.data?.blockedBy, []);
    assert.ok(bare.diagnostics.length > 0, "a null value must be diagnosed");
    assert.equal(isUnreadDeclaration(bare), true);

    // The BLOCK-LIST form has a blank scalar too, and must stay clean — this is
    // the false positive a careless fix introduces, and it would fire on the
    // most common spelling of the field there is.
    const list = parseFrontmatter(block(["  blocked-by:", "    - 1", "    - 2"]));
    assert.deepEqual(list.data?.blockedBy, [
      { repo: null, number: 1 },
      { repo: null, number: 2 },
    ]);
    assert.deepEqual(list.diagnostics, []);

    // Every other field already behaved this way; pinned so the consistency is
    // a property rather than a coincidence.
    for (const field of ["duplicate-of:", "serialize-with:", "together-with:", "priority:", "evidence:"]) {
      const r = parseFrontmatter(block([`  ${field}`]));
      assert.ok(r.diagnostics.length > 0, field);
      assert.equal(isUnreadDeclaration(r), true, field);
    }
  });

  test("an empty list and one trailing comma stay clean — the two non-entries", () => {
    // The other half of the rule, and the half a fix for the case above breaks
    // if it simply stops trimming: `[]` is a list a writer emits when it
    // removes the last edge, and YAML permits one trailing comma. Neither is a
    // null node, so neither may raise a diagnostic — an over-strict reader
    // refuses perfectly good declarations, which is worse than the miss.
    const block = (v: string): string => ["---", "issuegraph:", `  blocked-by: ${v}`, "---"].join("\n");

    for (const empty of ["[]", "[ ]"]) {
      const r = parseFrontmatter(block(empty));
      assert.deepEqual(r.data?.blockedBy, [], empty);
      assert.deepEqual(r.diagnostics, [], empty);
      assert.equal(isUnreadDeclaration(r), false, empty);
    }

    const trailing = parseFrontmatter(block("[1, 2,]"));
    assert.deepEqual(trailing.data?.blockedBy, [
      { repo: null, number: 1 },
      { repo: null, number: 2 },
    ]);
    assert.deepEqual(trailing.diagnostics, []);

    // A SECOND trailing comma leaves a real null node behind it, so it is not
    // punctuation and is diagnosed. Pinned because the obvious implementation —
    // strip every trailing empty — would swallow it.
    const twoTrailing = parseFrontmatter(block("[1,,]"));
    assert.deepEqual(twoTrailing.data?.blockedBy, [{ repo: null, number: 1 }]);
    assert.ok(twoTrailing.diagnostics.length > 0);
  });

  test("parses cross-repo, hash-prefixed, and quoted refs", () => {
    const body = ["---", "issuegraph:", '  blocked-by: [autnmy/issuegraph#4, "#12", \'7\']', "  duplicate-of: acme/backlog#90", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, [
      { repo: "autnmy/issuegraph", number: 4 },
      { repo: null, number: 12 },
      { repo: null, number: 7 },
    ]);
    assert.deepEqual(r.data?.duplicateOf, { repo: "acme/backlog", number: 90 });
  });

  test("strips comments without breaking unquoted owner/repo#N refs", () => {
    const body = ["---", "issuegraph:", "  serialize-with: acme/backlog#5 # conflict forecast", "  priority: 2 # default anyway", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.serializeWith, { repo: "acme/backlog", number: 5 });
    assert.equal(r.data?.priority, 2);
  });

  test("drops invalid field values with diagnostics, keeping the rest", () => {
    const body = ["---", "issuegraph:", "  priority: 9", "  evidence: maybe", "  together-with: 44", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, null);
    assert.equal(r.data?.evidence, null);
    assert.deepEqual(r.data?.togetherWith, { repo: null, number: 44 });
    assert.equal(r.diagnostics.length, 2);
  });

  test("drops a list handed to a single-ref field", () => {
    const body = ["---", "issuegraph:", "  duplicate-of: [1, 2]", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.duplicateOf, null);
    assert.equal(r.diagnostics.some((d) => d.includes("duplicate-of")), true);
  });

  test("rejects an inline value on the top-level key as outside the subset", () => {
    const body = ["---", "issuegraph: {priority: 1}", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.equal(r.diagnostics.length, 1);
  });

  test("treats unrecognized fields as inert without diagnostics", () => {
    const body = ["---", "issuegraph:", "  priority: 1", "  some-other-tool-key: whatever", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 1);
    assert.deepEqual(r.diagnostics, []);
  });

  test("ignores other top-level frontmatter keys sharing the block", () => {
    const body = ["---", "title: something", "issuegraph:", "  priority: 0", "othertool:", "  x: 1", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 0);
    assert.deepEqual(r.diagnostics, []);
  });

  test("handles CRLF bodies", () => {
    const r = parseFrontmatter("---\r\nissuegraph:\r\n  priority: 1\r\n---\r\n");
    assert.equal(r.data?.priority, 1);
  });

  test("drops a BLANK priority instead of reading it as 0", () => {
    const body = ["---", "issuegraph:", "  priority:", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, null);
    assert.equal(r.diagnostics.some((d) => d.includes("priority")), true);
  });

  test("keeps recognized keys nested under extension mappings inert", () => {
    const body = ["---", "issuegraph:", "  some-extension:", "    priority: 0", "    blocked-by: [5]", "  priority: 3", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 3);
    assert.deepEqual(r.data?.blockedBy, []);
  });

  test("diagnoses an unterminated block carrying the key", () => {
    const body = ["---", "issuegraph:", "  priority: 1", "", "## What", "prose"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.equal(r.diagnostics.some((d) => d.includes("no closing")), true);
  });

  // #8457. The three outcomes are pinned TOGETHER, in one test, because the
  // defect was that two of them were byte-identical: a body whose key no `---`
  // pair delimits returned `data: null` with NO diagnostic, exactly like a body
  // that never carried a key — so the overwhelming majority of the open issues
  // carrying the key had every edge silently discarded. Separated into three
  // tests, a regression that re-collapses them fails one assertion and reads
  // like a wording change; together, the collapse is what fails.
  //
  // The CANONICAL arm is the positive control and is not decoration: without
  // it, "the parser returned null" is equally good evidence that the harness
  // is broken. It parses in the same process, on the same call, as the arm
  // that must not.
  test("separates a canonical block, an undelimited one, and no block at all", () => {
    const canonical = ["```", "---", "issuegraph:", "  blocked-by: [7143]", "---", "```"].join("\n");
    const undelimited = ["```yaml", "issuegraph:", "  blocked-by: [7143]", "```"].join("\n");
    const absent = "## What\n\nprose that carries no frontmatter at all";

    const parsed = parseFrontmatter(canonical);
    assert.deepEqual(parsed.data?.blockedBy, [{ repo: null, number: 7143 }]);
    assert.deepEqual(parsed.diagnostics, []);

    const refused = parseFrontmatter(undelimited);
    assert.equal(refused.data, null);
    assert.equal(refused.diagnostics.some((d) => d.includes("no `---` pair delimits it")), true);

    const unencoded = parseFrontmatter(absent);
    assert.equal(unencoded.data, null);
    assert.deepEqual(unencoded.diagnostics, []);
  });

  // The shape a scan anchored on the LAST `---` seen cannot report: the key
  // precedes every delimiter line, so looking only PAST that line looks past
  // the key. Ordinary markdown section rules put a body in this state, so it
  // is the common half of the corpus rather than an exotic one.
  test("diagnoses an undelimited key that sits ahead of the body's markdown rules", () => {
    const body = ["```yaml", "issuegraph:", "  priority: 1", "```", "", "## What", "prose", "", "---", "", "## Why", "more"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.equal(r.diagnostics.some((d) => d.includes("no `---` pair delimits it")), true);
  });

  // #8457, and the pin for a RULE rather than for a family of shapes. Four
  // review rounds argued about qualifying the undelimited test — a bare
  // mention, a column-zero comment, an unindented field, an inert extension
  // subtree — and three of the four qualifiers left a real declaration SILENT,
  // which is the failure this change exists to end. Measured over 500 open
  // issues, every candidate qualifier selected the SAME bodies as no qualifier
  // at all, so the qualifier was deleted rather than corrected a fourth time.
  //
  // The rule under test is therefore: a key at a line's start that no `---`
  // pair encloses IS HEARD. The last row is the deliberate over-report that
  // buys it — prose alone draws an advisory diagnostic, and `data` stays null
  // either way, so no edge reading moves. A new shape is a row here, never a
  // qualifier in the parser.
  const UNDELIMITED_SHAPES = [
    ["an ordinary indented field", ["```yaml", "issuegraph:", "  blocked-by: [1]", "```"]],
    ["a field the author forgot to indent", ["```yaml", "issuegraph:", "blocked-by: [1]", "```"]],
    ["a column-zero comment before the field", ["```yaml", "issuegraph:", "# why", "  blocked-by: [1]", "```"]],
    ["an inert extension subtree before a recognized field", ["```yaml", "issuegraph:", "  extension:", "    - value", "  blocked-by: [1]", "```"]],
    ["a header with nothing after it", ["```yaml", "issuegraph:", "```"]],
    ["a key mentioned in prose (the accepted over-report)", ["issuegraph: is the key this parser reads", "", "and here is why"]],
  ] as const;

  for (const [label, body] of UNDELIMITED_SHAPES) {
    test(`hears an undelimited key: ${label}`, () => {
      const r = parseFrontmatter(body.join("\n"));
      assert.equal(r.data, null);
      assert.equal(r.diagnostics.some((d) => d.includes("no `---` pair delimits it")), true);
    });
  }

  // A body with no key at a line's start stays silent — the third outcome, and
  // the one the whole `data: null` contract rests on.
  test("stays silent on a body that carries no key at a line's start", () => {
    const r = parseFrontmatter("## What\n\nprose that carries no frontmatter, and no issuegraph : key at column zero");
    assert.equal(r.data, null);
    assert.deepEqual(r.diagnostics, []);
  });

  // The standard the undelimited path is held to, as an EQUIVALENCE rather
  // than a hand-written expectation: content the DELIMITED path parses into a
  // real edge must, undelimited, at least be heard. A future edit that
  // re-diverges the two fails on the comparison. Every shape here is one a
  // review round found going silent behind a qualifier.
  test("hears every undelimited shape the delimited path would have parsed", () => {
    for (const content of [
      ["issuegraph:", "  blocked-by: [1]"],
      ["issuegraph:", "# why this is blocked", "  blocked-by: [1]"],
      ["issuegraph:", "  extension:", "    - value", "  blocked-by: [1]"],
    ]) {
      assert.deepEqual(parseFrontmatter(["---", ...content, "---"].join("\n")).data?.blockedBy, [
        { repo: null, number: 1 },
      ]);
      const r = parseFrontmatter(["```yaml", ...content, "```"].join("\n"));
      assert.equal(r.data, null);
      assert.equal(r.diagnostics.some((d) => d.includes("no `---` pair delimits it")), true);
    }
  });

  test("gates list items by indent and closes entries at nested mappings", () => {
    const body = ["---", "issuegraph:", "  blocked-by:", "    nested:", "      - 5", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, []);
    assert.equal(r.diagnostics.some((d) => d.includes("list item without a key")), true);
  });

  test("an empty first section still wins over later claimants", () => {
    const body = ["---", "issuegraph:", "other: x", "issuegraph:", "  priority: 3", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, null);
  });

  test("returns null data when the section is not a mapping", () => {
    const seq = parseFrontmatter(["---", "issuegraph:", "  - priority: 1", "---"].join("\n"));
    assert.equal(seq.data, null);
    assert.equal(seq.diagnostics.some((d) => d.includes("not a mapping")), true);
  });

  test("a genuinely empty section is empty data, not an error", () => {
    const r = parseFrontmatter(["---", "issuegraph:", "other: x", "---"].join("\n"));
    assert.notEqual(r.data, null);
    assert.equal(r.data?.priority, null);
    assert.deepEqual(r.diagnostics, []);
  });

  test("drops a field carrying both a scalar and block items", () => {
    const body = ["---", "issuegraph:", "  blocked-by: [1]", "    - 2", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, []);
    assert.equal(r.diagnostics.some((d) => d.includes("both a scalar value and list items")), true);
  });

  test("a direct sequence item invalidates the section even beside valid mappings", () => {
    const body = ["---", "issuegraph:", "  - bogus", "  priority: 0", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.equal(r.diagnostics.some((d) => d.includes("not a mapping")), true);
  });

  test("ignores dashes nested inside a block-list item", () => {
    const body = ["---", "issuegraph:", "  blocked-by:", "    - 1", "      - 2", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, [{ repo: null, number: 1 }]);
    assert.equal(r.diagnostics.some((d) => d.includes("nested list content")), true);
  });

  test("a direct sequence item AFTER mapping entries also invalidates the section", () => {
    const body = ["---", "issuegraph:", "  priority: 0", "  - bogus", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.equal(r.diagnostics.some((d) => d.includes("not a mapping")), true);
  });

  test("an ADJACENT duplicate issuegraph key does not merge its children into the first", () => {
    const body = ["---", "issuegraph:", "  priority: 1", "issuegraph:", "  priority: 3", "  evidence: verified", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 1);
    assert.equal(r.data?.evidence, null);
  });

  test("scalar fields with nested continuations drop instead of validating the scalar alone", () => {
    const body = ["---", "issuegraph:", "  priority: 0", "    - 2", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, null);
    assert.equal(r.diagnostics.some((d) => d.includes("priority has nested list content")), true);
  });

  test("unrecognized extension subtrees are inert AND silent, sequences included", () => {
    const body = ["---", "issuegraph:", "  extension:", "    - foo:", "      - bar", "  priority: 1", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 1);
    assert.deepEqual(r.diagnostics, []);
  });

  test("a nested mapping under a recognized scalar drops the field", () => {
    const body = ["---", "issuegraph:", "  priority: 0", "    sub: x", "  evidence: verified", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, null);
    assert.equal(r.data?.evidence, "verified");
    assert.equal(r.diagnostics.some((d) => d.includes("priority has nested mapping content")), true);
  });

  test("tab indentation is structural per YAML", () => {
    const body = ["---", "issuegraph:", "\tpriority: 0", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.equal(r.diagnostics.some((d) => d.includes("tab character")), true);
  });

  test("accepts the indentationless sequence style yaml emitters produce", () => {
    const body = ["---", "issuegraph:", "  blocked-by:", "  - 1", "  - 2", "  priority: 1", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, [
      { repo: null, number: 1 },
      { repo: null, number: 2 },
    ]);
    assert.equal(r.data?.priority, 1);
    assert.deepEqual(r.diagnostics, []);
  });

  test("same-indent items beside a scalar-valued key stay structural", () => {
    const body = ["---", "issuegraph:", "  priority: 0", "  - 1", "---"].join("\n");
    assert.equal(parseFrontmatter(body).data, null);
  });

  test("accepts evidence literals", () => {
    const body = ["---", "issuegraph:", "  evidence: verified", "---"].join("\n");
    assert.equal(parseFrontmatter(body).data?.evidence, "verified");
  });
});

describe("isUnreadDeclaration", () => {
  // The predicate's whole job is telling these five shapes apart, so each row
  // of `IssuegraphParseResult.diagnostics`' own table gets a case. Anything a
  // future edit loosens here shows up as one of them flipping.

  test("is FALSE for a body carrying no block at all", () => {
    const parse = parseFrontmatter("just prose, no frontmatter");
    assert.equal(parse.data, null);
    assert.deepEqual(parse.diagnostics, []);
    assert.equal(isUnreadDeclaration(parse), false);
  });

  test("is FALSE for a block that parsed cleanly", () => {
    const parse = parseFrontmatter(FENCED);
    assert.notEqual(parse.data, null);
    assert.deepEqual(parse.diagnostics, []);
    assert.equal(isUnreadDeclaration(parse), false);
  });

  test("is TRUE for a delimited block that DROPPED a field — the row readers miss", () => {
    // Non-null `data` that LOOKS complete: the surviving ref is there, and the
    // rejected one is recorded only in the diagnostics.
    const parse = parseFrontmatter(
      ["```", "---", "issuegraph:", "  blocked-by: [7143, not-a-ref]", "---", "```"].join("\n"),
    );
    assert.equal(parse.data?.blockedBy.length, 1);
    assert.ok(parse.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(parse), true);
  });

  test("is TRUE when every item dropped, leaving an EMPTY list that reads as no edge", () => {
    const parse = parseFrontmatter(
      ["```", "---", "issuegraph:", "  blocked-by: [not-a-ref]", "---", "```"].join("\n"),
    );
    assert.deepEqual(parse.data?.blockedBy, []);
    assert.equal(isUnreadDeclaration(parse), true);
  });

  test("is TRUE for a DELIMITED block that was unusable — data null, no block defect", () => {
    const parse = parseFrontmatter(
      ["```", "---", "issuegraph: { together-with: 71 }", "---", "```"].join("\n"),
    );
    assert.equal(parse.data, null);
    assert.equal(parse.blockDefect, null);
    assert.equal(isUnreadDeclaration(parse), true);
  });

  test("is FALSE for the UNDELIMITED family — the loosest arm, which nothing may gate on", () => {
    // 336 of 369 header-carrying open issues are written this way (#8872); a
    // predicate that returned true here would stop nearly the whole backlog.
    const undelimited = parseFrontmatter(
      ["```", "issuegraph:", "  blocked-by: [7143]", "```"].join("\n"),
    );
    assert.notEqual(undelimited.blockDefect, null);
    assert.ok(undelimited.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(undelimited), false);

    // `unterminated` is a SUBTYPE of the same shape — an ordinary markdown rule
    // above a fenced block reads as an unclosed opening delimiter — so a
    // predicate excluding only `undelimited` would gate it. Pinned separately
    // because that is the one-subtype-down over-refusal.
    const unterminated = parseFrontmatter(
      ["---", "", "```", "issuegraph:", "  blocked-by: [7143]", "```"].join("\n"),
    );
    assert.notEqual(unterminated.blockDefect, null);
    assert.equal(isUnreadDeclaration(unterminated), false);
  });

  test("pins the corollary readers rely on: non-null data implies no block defect", () => {
    // A caller that has ALREADY established non-null `data` may use the shared
    // predicate in place of a bare diagnostics test, on the grounds that the
    // two decide identically there. That equivalence IS this implication, so it
    // is pinned once here rather than re-argued at every such call site.
    for (const body of [
      FENCED,
      ["```", "---", "issuegraph:", "  blocked-by: [7143, not-a-ref]", "---", "```"].join("\n"),
      ["```", "---", "issuegraph:", "  priority: nine", "  blocked-by: [7143]", "---", "```"].join("\n"),
      ["```", "issuegraph:", "  blocked-by: [7143]", "```"].join("\n"),
      "no block here",
    ]) {
      const parse = parseFrontmatter(body);
      if (parse.data !== null) assert.equal(parse.blockDefect, null);
    }
  });
});
