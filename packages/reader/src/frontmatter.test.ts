import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FENCE_CLOSE,
  FENCE_OPEN,
  FRONTMATTER_KEY_PATTERN,
  isUnreadDeclaration,
  isSectionHeader,
  locateBlock,
  locateSection,
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
      assert.deepEqual(r.data?.blockedBy, [{ repo: null, id: '42' }]);
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
    assert.deepEqual(r.data?.decomposedFrom, { repo: null, id: '7129' });
    assert.deepEqual(r.data?.blockedBy, [
      { repo: null, id: '7143' },
      { repo: null, id: '3367' },
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
    assert.deepEqual(r.data?.blockedBy, [{ repo: null, id: '7143' }]);
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

  test("a duplicate issuegraph key WITHIN one block refuses the block", () => {
    // A DELIBERATE TIGHTENING. This used to take the first claimant and discard
    // the second in silence, which is the same last-one-wins hazard the
    // repeated-FIELD rule below already refuses: a body naming a dependency
    // twice had one of them thrown away with nothing said.
    //
    // A duplicate key inside one mapping is malformed YAML, so the parser
    // refuses it and this reader reports why. §4.1's "later claimants MUST be
    // ignored" is untouched — it governs later `---` BLOCKS, which
    // `locateBlock` still resolves to the first one carrying the key.
    const body = ["---", "issuegraph:", "  priority: 1", "other: x", "issuegraph:", "  priority: 3", "  evidence: verified", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("accepts block lists, single scalars, and flow lists for blocked-by", () => {
    const block = (v: string[]): string => ["---", "issuegraph:", ...v, "---"].join("\n");
    assert.deepEqual(parseFrontmatter(block(["  blocked-by:", "    - 1", "    - 2"])).data?.blockedBy, [
      { repo: null, id: '1' },
      { repo: null, id: '2' },
    ]);
    assert.deepEqual(parseFrontmatter(block(["  blocked-by: 9"])).data?.blockedBy, [
      { repo: null, id: '9' },
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

    // STRICTER THAN IT USED TO BE, in the safe direction: a real parser rejects
    // `[,]` outright rather than yielding a null node the reader then drops, so
    // the block is refused instead of returning a partial list. The property
    // that made this a defect is untouched and strengthened — an empty entry can
    // never come back as a clean empty list.
    const onlyComma = parseFrontmatter(block("[,]"));
    assert.equal(onlyComma.data, null);
    assert.ok(onlyComma.diagnostics.length > 0, "an empty entry must be diagnosed");
    assert.equal(isUnreadDeclaration(onlyComma), true);

    const interior = parseFrontmatter(block("[1,,2]"));
    assert.equal(interior.data, null);
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
    // ANY diagnostic, not one whose prose names the fault: the message is the
    // parser's own now, and matching it would fail OPEN the moment it is
    // reworded — the rule `ParseResult.diagnostics` states for every reader.
    assert.ok(dedented.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(dedented), true);

    // DEEPER is still inert and still silent — that is §4.1's extension rule and
    // this must not have widened into it. The recognized field beside the
    // subtree is read normally.
    const nested = parseFrontmatter(block("  blocked-by: [1]", "  extension:", "    - value"));
    assert.deepEqual(nested.data?.blockedBy, [{ repo: null, id: '1' }]);
    assert.deepEqual(nested.diagnostics, []);
  });

  test("a quoted TOP-LEVEL key is the same key too", () => {
    // The worst reading in the whole module: `"issuegraph":` returned
    // data null, NO diagnostics and NO block defect — byte-identical to a body
    // that never carried a block. A scheduler cannot distinguish "no
    // dependencies" from "dependencies it could not see", so it dispatches.
    for (const spelling of ['"issuegraph":', "'issuegraph':", "issuegraph :", "issuegraph\t:"]) {
      const r = parseFrontmatter(["---", spelling, "  blocked-by: [1]", "---"].join("\n"));
      assert.deepEqual(r.data?.blockedBy, [{ repo: null, id: '1' }], spelling);
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
    assert.deepEqual(r.data?.blockedBy, [{ repo: null, id: '1' }]);
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
      assert.deepEqual(parseFrontmatter(body).data?.blockedBy, [{ repo: null, id: '1' }], spelling);
      assert.ok(prefilter.test(spelling), `prefilter must not miss ${spelling}`);
    }
    // It still discriminates: a different key is not a candidate at all.
    assert.equal(prefilter.test("not-issuegraph:"), false);
  });

  test("a quoted key is the same key", () => {
    const block = (...v: string[]): string => ["---", "issuegraph:", ...v, "---"].join("\n");

    for (const spelling of ['"blocked-by": [1]', "'blocked-by': [1]"]) {
      const r = parseFrontmatter(block(`  ${spelling}`));
      assert.deepEqual(r.data?.blockedBy, [{ repo: null, id: '1' }], spelling);
      assert.deepEqual(r.diagnostics, [], spelling);
    }

    // ...which means the two spellings are the SAME key to the repeat guard.
    // Stripping after that guard would let a quoted duplicate through as a
    // second field and hand the win to whichever came last.
    const repeated = parseFrontmatter(block("  blocked-by: [123]", '  "blocked-by": []'));
    assert.equal(repeated.data, null);
    assert.ok(repeated.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(repeated), true);
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
      assert.ok(r.diagnostics.length > 0, repeated.join(" / "));
      assert.equal(isUnreadDeclaration(r), true, repeated.join(" / "));
    }

    // AN UNRECOGNIZED FIELD IS INERT (§4.1) — a single one decides nothing and
    // must not degrade a block whose recognized fields are fine.
    const inert = parseFrontmatter(block("  extension: a", "  blocked-by: [5]"));
    assert.deepEqual(inert.data?.blockedBy, [{ repo: null, id: '5' }]);
    assert.deepEqual(inert.diagnostics, []);

    // REPEATING one is a different matter, and this is a deliberate tightening.
    // Inertness is about what a field MEANS; a duplicate key is malformed YAML
    // whatever the key is called, so the mapping does not parse and no field in
    // it is trustworthy. Distinguishing the two would mean re-implementing
    // duplicate detection beside the parser — the hand-rolled grammar this
    // module exists to have stopped keeping.
    const repeatedInert = parseFrontmatter(block("  extension: a", "  extension: b", "  blocked-by: [5]"));
    assert.equal(repeatedInert.data, null);
    assert.equal(isUnreadDeclaration(repeatedInert), true);
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
    assert.deepEqual(parseFrontmatter(block("blocked-by: [1]")).data?.blockedBy, [{ repo: null, id: '1' }]);
    assert.deepEqual(parseFrontmatter(block("blocked-by:\t[1]")).data?.blockedBy, [{ repo: null, id: '1' }]);
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
      { repo: null, id: '1' },
      { repo: null, id: '2' },
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
      { repo: null, id: '1' },
      { repo: null, id: '2' },
    ]);
    assert.deepEqual(trailing.diagnostics, []);

    // A SECOND trailing comma is not punctuation, and must never be swallowed.
    // The parser rejects it outright rather than yielding a null node the
    // reader then drops, so the block is refused instead of returning a partial
    // list — stricter than before, in the direction that cannot go quiet.
    const twoTrailing = parseFrontmatter(block("[1,,]"));
    assert.equal(twoTrailing.data, null);
    assert.ok(twoTrailing.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(twoTrailing), true);
  });

  test("parses cross-repo, hash-prefixed, and quoted refs", () => {
    const body = ["---", "issuegraph:", '  blocked-by: [autnmy/issuegraph#4, "#12", \'7\']', "  duplicate-of: acme/backlog#90", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, [
      { repo: "autnmy/issuegraph", id: '4' },
      { repo: null, id: '12' },
      { repo: null, id: '7' },
    ]);
    assert.deepEqual(r.data?.duplicateOf, { repo: "acme/backlog", id: '90' });
  });

  test("strips comments without breaking unquoted owner/repo#N refs", () => {
    const body = ["---", "issuegraph:", "  serialize-with: acme/backlog#5 # conflict forecast", "  priority: 2 # default anyway", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.serializeWith, { repo: "acme/backlog", id: '5' });
    assert.equal(r.data?.priority, 2);
  });

  test("drops invalid field values with diagnostics, keeping the rest", () => {
    const body = ["---", "issuegraph:", "  priority: 9", "  evidence: maybe", "  together-with: 44", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, null);
    assert.equal(r.data?.evidence, null);
    assert.deepEqual(r.data?.togetherWith, { repo: null, id: '44' });
    assert.equal(r.diagnostics.length, 2);
  });

  test("drops a list handed to a single-ref field", () => {
    const body = ["---", "issuegraph:", "  duplicate-of: [1, 2]", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.duplicateOf, null);
    assert.equal(r.diagnostics.some((d) => d.includes("duplicate-of")), true);
  });

  test("reads an inline flow mapping on the top-level key", () => {
    // A DELIBERATE WIDENING, and the clearest single illustration of what
    // delegating tokenizing buys. This used to be refused as "outside the
    // supported subset" — a subset that existed only because the grammar was
    // hand-written. It is ordinary YAML, the author plainly meant it, and a
    // real parser reads it.
    const body = ["---", "issuegraph: {priority: 1}", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 1);
    assert.deepEqual(r.diagnostics, []);

    // A SCALAR value is still refused: it is not a mapping of fields at all, so
    // reading edges out of it would mean inventing them.
    const scalar = parseFrontmatter(["---", "issuegraph: hello", "---"].join("\n"));
    assert.equal(scalar.data, null);
    assert.equal(isUnreadDeclaration(scalar), true);
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
    assert.deepEqual(parsed.data?.blockedBy, [{ repo: null, id: '7143' }]);
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
        { repo: null, id: '1' },
      ]);
      const r = parseFrontmatter(["```yaml", ...content, "```"].join("\n"));
      assert.equal(r.data, null);
      assert.equal(r.diagnostics.some((d) => d.includes("no `---` pair delimits it")), true);
    }
  });

  test("a nested mapping where blocked-by expects refs drops the field", () => {
    const body = ["---", "issuegraph:", "  blocked-by:", "    nested:", "      - 5", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, []);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("an empty first section does not let a later claimant supply its fields", () => {
    // The hazard this pins is unchanged: the second `issuegraph:` must not fill
    // in what the first left empty. What changed is the answer — refusing the
    // malformed mapping outright, rather than reading the first and discarding
    // the second silently.
    const body = ["---", "issuegraph:", "other: x", "issuegraph:", "  priority: 3", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.equal(isUnreadDeclaration(r), true);
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

  test("a field carrying both a scalar and block items refuses the block", () => {
    // Stricter than the old field-level drop, and for the same reason as every
    // other row here: a block sequence cannot follow a flow value on one key,
    // so the mapping does not parse at all and no field in it can be trusted.
    const body = ["---", "issuegraph:", "  blocked-by: [1]", "    - 2", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("a direct sequence item invalidates the section even beside valid mappings", () => {
    const body = ["---", "issuegraph:", "  - bogus", "  priority: 0", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("a dash nested inside a block-list item does not become a second ref", () => {
    // YAML folds the continuation into one plain scalar (`1 - 2`), which is not
    // a reference — so the item is dropped with a diagnostic rather than
    // silently contributing an edge nobody wrote. The hazard pinned here is
    // that the nested dash must never read as a ref of its own.
    const body = ["---", "issuegraph:", "  blocked-by:", "    - 1", "      - 2", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, []);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("a direct sequence item AFTER mapping entries also invalidates the section", () => {
    const body = ["---", "issuegraph:", "  priority: 0", "  - bogus", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("an ADJACENT duplicate issuegraph key refuses the block rather than merging", () => {
    // The children must never merge into the first section — that would let a
    // second claimant contribute fields the author wrote under a key the reader
    // says it ignored. Refusing is a stronger answer than the old first-wins,
    // and it is the parser's: a duplicate key is a malformed mapping.
    const body = ["---", "issuegraph:", "  priority: 1", "issuegraph:", "  priority: 3", "  evidence: verified", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("scalar fields with nested continuations drop instead of validating the scalar alone", () => {
    const body = ["---", "issuegraph:", "  priority: 0", "    - 2", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, null);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("unrecognized extension subtrees are inert AND silent, sequences included", () => {
    const body = ["---", "issuegraph:", "  extension:", "    - foo:", "      - bar", "  priority: 1", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data?.priority, 1);
    assert.deepEqual(r.diagnostics, []);
  });

  test("a nested mapping under a recognized scalar refuses the block", () => {
    // Stricter than the old per-field drop: a mapping nested under a scalar
    // value is not valid YAML, so the sibling `evidence` is not trustworthy
    // either — reading it would be reporting a field out of a mapping that does
    // not parse.
    const body = ["---", "issuegraph:", "  priority: 0", "    sub: x", "  evidence: verified", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("tab indentation is structural per YAML", () => {
    const body = ["---", "issuegraph:", "\tpriority: 0", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.equal(r.data, null);
    assert.ok(r.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(r), true);
  });

  test("accepts the indentationless sequence style yaml emitters produce", () => {
    const body = ["---", "issuegraph:", "  blocked-by:", "  - 1", "  - 2", "  priority: 1", "---"].join("\n");
    const r = parseFrontmatter(body);
    assert.deepEqual(r.data?.blockedBy, [
      { repo: null, id: '1' },
      { repo: null, id: '2' },
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
      // `not-a-ref` USED TO BE the unparseable example and is now a perfectly
      // good opaque tracker id (SPEC 4.2) — which is the point of the widening.
      // A token carrying WHITESPACE is unparseable under any tracker's grammar,
      // so it is what this row needs.
      ["```", "---", "issuegraph:", '  blocked-by: [7143, "not a ref"]', "---", "```"].join("\n"),
    );
    assert.equal(parse.data?.blockedBy.length, 1);
    assert.ok(parse.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(parse), true);
  });

  test("is TRUE when every item dropped, leaving an EMPTY list that reads as no edge", () => {
    const parse = parseFrontmatter(
      ["```", "---", "issuegraph:", '  blocked-by: ["not a ref"]', "---", "```"].join("\n"),
    );
    assert.deepEqual(parse.data?.blockedBy, []);
    assert.equal(isUnreadDeclaration(parse), true);
  });

  test("is TRUE for a DELIMITED block that was unusable — data null, no block defect", () => {
    const parse = parseFrontmatter(
      // An inline flow mapping now PARSES, so the unusable-but-delimited row
      // needs a value that is genuinely not a mapping of fields.
      ["```", "---", "issuegraph: hello", "---", "```"].join("\n"),
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
      ["```", "---", "issuegraph:", '  blocked-by: [7143, "a ref"]', "---", "```"].join("\n"),
      ["```", "---", "issuegraph:", "  priority: nine", "  blocked-by: [7143]", "---", "```"].join("\n"),
      ["```", "issuegraph:", "  blocked-by: [7143]", "```"].join("\n"),
      "no block here",
    ]) {
      const parse = parseFrontmatter(body);
      if (parse.data !== null) assert.equal(parse.blockDefect, null);
    }
  });
});


/**
 * THE BLOCK'S STRUCTURE, and the two questions the writer package asks of it.
 *
 * These exports exist so an editor and a parser cannot disagree about which
 * bytes are a block, which line opens the section, or which bytes constitute an
 * entry. The tests below are the proof that they answer for THIS parser rather
 * than merely alongside it — a second spelling that happened to agree on the
 * examples anyone thought to write is the failure they exist to prevent.
 *
 * They replace a hand-written line grammar (`readMappingEntry`,
 * `topLevelKeyScalar`, `stripComment`) that answered the same questions
 * SEPARATELY from the parse. Both surfaces are now computed from the one `yaml`
 * document, so the cases below are no longer "do the two agree" — they are "is
 * the one answer right".
 */
describe('isSectionHeader', () => {
  test('names the header the parse opens on, and nothing else', () => {
    assert.equal(isSectionHeader('issuegraph:'), true);
    assert.equal(isSectionHeader('"issuegraph":'), true);
    assert.equal(isSectionHeader("'issuegraph':"), true);
    assert.equal(isSectionHeader('issuegraph :'), true, 'YAML allows space before the colon');
    assert.equal(isSectionHeader('issuegraph:  # note'), true, 'a trailing comment is not a value');
    assert.equal(isSectionHeader('issuegraph: { blocked-by: [7] }'), true, 'an inline value is still the key');

    assert.equal(isSectionHeader('  issuegraph:'), false, 'indented: a nested key is not the block header');
    assert.equal(isSectionHeader('issuegraph'), false, 'no colon at all');
    assert.equal(isSectionHeader('issuegraph:x'), false, 'the colon must be followed by whitespace or line end');
    assert.equal(isSectionHeader('""issuegraph:'), false, 'the prefilter accepts this; the parser does not');
    assert.equal(isSectionHeader('note about issuegraph: yes'), false);
  });

  test('the prefilter pattern is a SUPERSET of what it accepts', () => {
    // The invariant a prefilter owes: it may select lines the strict rule
    // rejects (one wasted parse), and must never reject one the strict rule
    // accepts (a declaration that silently does not exist).
    const prefilter = new RegExp(`^${FRONTMATTER_KEY_PATTERN}`);
    for (const header of ['issuegraph:', '"issuegraph":', "'issuegraph':", 'issuegraph :', 'issuegraph:  # note']) {
      assert.equal(isSectionHeader(header), true, `${header} should be a header`);
      assert.equal(prefilter.test(header), true, `${header} must survive the prefilter`);
    }
  });
});

describe('locateSection', () => {
  const block = (...lines: readonly string[]): readonly string[] => lines;

  test('reports each entry the line span it occupies', () => {
    const located = locateSection(
      block('issuegraph:', '  blocked-by:', '    - "#7"', '    - "#8"', '  priority: 1'),
    );
    assert.notEqual(located, null);
    assert.equal(located?.headerLine, 0);
    assert.equal(located?.childIndent, 2);
    assert.deepEqual(
      located?.fields.map((f) => [f.key, f.startLine, f.endLine]),
      [
        ['blocked-by', 1, 3],
        ['priority', 4, 4],
      ],
    );
  });

  test('a quoted field name is the same field', () => {
    const located = locateSection(block('issuegraph:', '  "blocked-by": ["#7"]'));
    assert.deepEqual(located?.fields.map((f) => f.key), ['blocked-by']);
  });

  test('an unrecognized field is reported too — a writer must not overwrite it', () => {
    const located = locateSection(block('issuegraph:', '  extension:', '    a: 1', '  priority: 0'));
    assert.deepEqual(
      located?.fields.map((f) => [f.key, f.startLine, f.endLine]),
      [
        ['extension', 1, 2],
        ['priority', 3, 3],
      ],
    );
  });

  test('a sibling top-level key is reported and is not a field', () => {
    const located = locateSection(block('other: 1', 'issuegraph:', '  priority: 0'));
    assert.equal(located?.hasSiblingKeys, true);
    assert.equal(located?.headerLine, 1);
    assert.deepEqual(located?.fields.map((f) => f.key), ['priority']);
  });

  test("an author's four-space style survives", () => {
    const located = locateSection(block('issuegraph:', '    priority: 0'));
    assert.equal(located?.childIndent, 4);
  });

  test('refuses exactly what the parser refuses', () => {
    // Each of these makes `parseFrontmatter` return `data: null`, so a writer
    // that spliced into one would hand back a body nobody can read.
    assert.equal(locateSection(block('issuegraph: hello')), null, 'section is a scalar');
    assert.equal(locateSection(block('issuegraph:', '  - 1')), null, 'section is a sequence');
    assert.equal(locateSection(block('issuegraph:', '\tpriority: 0')), null, 'tab in the indentation');
    assert.equal(locateSection(block('other: 1')), null, 'no issuegraph key at all');
    assert.equal(
      locateSection(block('issuegraph:', '  priority: 0', '  priority: 1')),
      null,
      'a duplicate key is a malformed mapping',
    );
  });

  test('the spans it reports cover the entry and nothing else', () => {
    // The property a byte-for-byte splice rests on: replacing exactly the
    // reported span leaves every other line untouched.
    const lines = ['issuegraph:', '  # keep me', '  blocked-by:', '    - "#7"', '  priority: 1'];
    const located = locateSection(lines);
    const blockedBy = located?.fields.find((f) => f.key === 'blocked-by');
    assert.notEqual(blockedBy, undefined);
    const kept = lines.filter((_, i) => i < (blockedBy?.startLine ?? 0) || i > (blockedBy?.endLine ?? 0));
    assert.deepEqual(kept, ['issuegraph:', '  # keep me', '  priority: 1']);
  });
});

/**
 * BLOCK LOCATION, which is deliberately NOT delegated to the YAML parser.
 *
 * §4.1's canonical-block rule — the FIRST `---`-delimited block containing the
 * key, seen through a wrapping fence and any leading banner — is this
 * specification's, not YAML's, and no frontmatter library implements it. So
 * these rules stay ours and are tested as ours.
 */
describe('locateBlock and the fence armor', () => {

  test('locateBlock reports the delimiter line indices a writer edits between', () => {
    const body = ['Banner.', '', '```', '---', 'issuegraph:', '  blocked-by: [7]', '---', '```', '', 'Prose.'].join(
      '\n',
    );
    const located = locateBlock(body);
    assert.equal(located.defect, null);
    assert.deepEqual([...(located.lines ?? [])], ['issuegraph:', '  blocked-by: [7]']);
    const lines = body.split('\n');
    assert.equal(lines[located.startLine], '---');
    assert.equal(lines[located.endLine], '---');
    // The interior really is the span between them, so an editor slicing on the
    // indices sees exactly what the parser read.
    assert.deepEqual(lines.slice(located.startLine + 1, located.endLine), [...(located.lines ?? [])]);
  });

  test('locateBlock reports -1 indices for every no-block outcome', () => {
    // Absence must not be spelled as a usable position: a writer that took the
    // indices without checking `lines` would splice at line -1.
    for (const body of ['no block here', ['---', 'issuegraph:', '  priority: 1'].join('\n'), 'issuegraph:\n  priority: 1']) {
      const located = locateBlock(body);
      assert.equal(located.lines, null, body);
      assert.equal(located.startLine, -1, body);
      assert.equal(located.endLine, -1, body);
    }
  });

  test('the fence patterns classify the armor §4.1 permits', () => {
    assert.ok(FENCE_OPEN.test('```'));
    assert.ok(FENCE_OPEN.test('```yaml'));
    assert.ok(FENCE_OPEN.test('````'));
    assert.ok(FENCE_CLOSE.test('```'));
    // A closer carries no info string; an opener with one is not a closer.
    assert.ok(!FENCE_CLOSE.test('```yaml'));
    assert.ok(!FENCE_OPEN.test('  ```'), 'indented fences are outside the modelled subset');
    assert.ok(!FENCE_OPEN.test('~~~'), 'tilde fences are outside the modelled subset');
  });
});

/**
 * REFERENCES ARE OPAQUE TRACKER-SCOPED IDENTIFIERS (SPEC 4.2).
 *
 * The specification used to define a reference as an integer and say, in as
 * many words, that "no other identifier type exists in the format" — which
 * excluded Jira's `ABC-123` and Linear's `ENG-456` by construction. These pin
 * the widened grammar, and the bound the numeric shape still carries.
 */
describe('issue references', () => {
  const B = (v: string): string => ['---', 'issuegraph:', `  blocked-by: [${v}]`, '---'].join('\n');
  const refsOf = (v: string): readonly { repo: string | null; id: string }[] =>
    parseFrontmatter(B(v)).data?.blockedBy ?? [];

  test('every spelling the format admits parses', () => {
    assert.deepEqual(refsOf('123'), [{ repo: null, id: '123' }]);
    assert.deepEqual(refsOf('"#123"'), [{ repo: null, id: '123' }]);
    assert.deepEqual(refsOf('ABC-123'), [{ repo: null, id: 'ABC-123' }]);
    assert.deepEqual(refsOf('ENG-456'), [{ repo: null, id: 'ENG-456' }]);
    assert.deepEqual(refsOf('owner/repo#123'), [{ repo: 'owner/repo', id: '123' }]);
    assert.deepEqual(refsOf('owner/repo#ABC-123'), [{ repo: 'owner/repo', id: 'ABC-123' }]);
  });

  test('`123` and `#123` are the SAME reference, not two', () => {
    // The sigil is spelling, never identity — so `id` never carries it. A
    // reader that kept the sigil would key the same issue two different ways
    // and silently miss half its own edges.
    assert.deepEqual(refsOf('123'), refsOf('"#123"'));
  });

  test('the numeric shape keeps its bound; the opaque shape has none to keep', () => {
    // The bound exists because a writer re-renders what a reader parsed:
    // `Number("1e21")` loses precision and `String()` emits scientific notation
    // no reader accepts — parse-clean in, unparseable out.
    for (const bad of ['0', '-1', '99999999999999999999999', '"007"', '"9007199254740993"']) {
      const r = parseFrontmatter(B(bad));
      assert.deepEqual(r.data?.blockedBy, [], bad);
      assert.ok(r.diagnostics.length > 0, bad);
      assert.equal(isUnreadDeclaration(r), true, bad);
    }
    // The largest one a re-render survives is still accepted, so the refusal
    // above is not simply refusing everything.
    const max = String(Number.MAX_SAFE_INTEGER);
    assert.deepEqual(refsOf(max), [{ repo: null, id: max }]);
  });

  test('a reference is read LEXICALLY, so YAML cannot retype it', () => {
    // THIS TEST PREVIOUSLY PINNED A DEFECT, and the correction is recorded here
    // rather than quietly swapped, because a test that asserts a defect is
    // worse than no test. It used to assert that `007`, `0x1F` and `1e5` came
    // back as `7`, `31` and `100000` — YAML implicitly types a plain scalar, so
    // the reader was handed a number and never saw the author's token — and it
    // called that acceptable on the grounds that the result round-trips stably
    // from there.
    //
    // It does not. `1e5` and `0x1F` are perfectly good identifiers under §4.2's
    // class, so an author on such a tracker had the edge silently pointed at a
    // DIFFERENT ISSUE — and if that substituted target happened to be closed,
    // the issue read READY while its real blocker was open. `007` additionally
    // bypassed §4.2's non-canonical rejection, which the spec's own conformance
    // table requires.
    //
    // §4.2 says an identifier is an opaque STRING, so a plain scalar's
    // identifier is its SOURCE and a quoted one's is its unescaped value.
    assert.deepEqual(refsOf('1e5'), [{ repo: null, id: '1e5' }]);
    assert.deepEqual(refsOf('0x1F'), [{ repo: null, id: '0x1F' }]);
    assert.deepEqual(refsOf('1_000'), [{ repo: null, id: '1_000' }]);

    // `007` is now REFUSED, in both spellings — which also removes an asymmetry
    // this suite previously documented as acceptable: quoted `"007"` was
    // refused while plain `007` silently became `7`.
    for (const spelling of ['007', '"007"']) {
      const r = parseFrontmatter(B(spelling));
      assert.deepEqual(r.data?.blockedBy, [], spelling);
      assert.ok(r.diagnostics.length > 0, spelling);
      assert.equal(isUnreadDeclaration(r), true, spelling);
    }

    // Quoting still means "these exact bytes", so the two spellings of one
    // identifier agree.
    assert.deepEqual(refsOf('"1e5"'), refsOf('1e5'));
    assert.deepEqual(refsOf('"ABC-1"'), refsOf('ABC-1'));
  });

  test('a token carrying whitespace or a stray separator is not an identifier', () => {
    for (const bad of ['"a ref"', '"a/b"', '"-lead"', '"#"', '""']) {
      const r = parseFrontmatter(B(bad));
      assert.deepEqual(r.data?.blockedBy, [], bad);
      assert.ok(r.diagnostics.length > 0, bad);
    }
  });

  test('priority stays an integer 0-3 — widening references did not widen it', () => {
    const P = (v: string): string => ['---', 'issuegraph:', `  priority: ${v}`, '---'].join('\n');
    assert.equal(parseFrontmatter(P('1')).data?.priority, 1);
    for (const bad of ['ABC-1', '"2"', '4', '-1', '2.5']) {
      const r = parseFrontmatter(P(bad));
      assert.equal(r.data?.priority, null, bad);
      assert.ok(r.diagnostics.length > 0, bad);
    }
  });

  test('a reference is never used as a bare object key', () => {
    // Measured: a `yaml`-parsed mapping carries `__proto__` as an OWN property,
    // so a lookup table indexed by a reference is reachable there — and the
    // value is truthy, which means a `?? fallback` never fires. Numeric-looking
    // ids coerce on top of that (`"2"` becomes `2`). The defence is to key on a
    // Map, and this pins that the parse of such a body stays ordinary data
    // rather than reaching a prototype.
    const body = ['---', 'issuegraph:', '  __proto__: 1', '  blocked-by: ["#2"]', '---'].join('\n');
    const parse = parseFrontmatter(body);
    assert.deepEqual(parse.data?.blockedBy, [{ repo: null, id: '2' }]);
    assert.deepEqual(parse.diagnostics, [], '__proto__ is an unrecognised field, and inert');

    // A Map keyed by the ref answers for the ref and for nothing else.
    const byRef = new Map((parse.data?.blockedBy ?? []).map((r) => [r.id, r] as const));
    assert.equal(byRef.get('__proto__'), undefined);
    assert.equal(byRef.has('__proto__'), false);
    assert.notEqual(byRef.get('2'), undefined);
  });
});

/**
 * THE MUTATION THE ISSUE ASKS FOR (autnmy/issuegraph#13, Done-when 5).
 *
 * "Verified by mutation, not by a green suite: feed the unquoted
 * block-sequence form to the reader and confirm it now ERRORS rather than
 * returning empty edges. That silent-null case is the one a passing test suite
 * will not catch."
 *
 * It will not catch it because NOTHING UPSTREAM REPORTS IT. Measured on the
 * parser directly: this body yields `{"blocked-by": [null, null]}` with
 * `errors: 0` and `warnings: 0`. It is a successful parse of a body that
 * declares two edges and produces none.
 *
 * So the refusal is this reader's own, in `refsFrom`, and these cases are what
 * hold it in place. Neuter that null-member rejection and the first assertion
 * below goes red — which is how this was verified, rather than by observing
 * that it passes.
 */
describe('the silent-null case: an unquoted # in a block sequence', () => {
  test('is REFUSED, not read as an issue with no edges', () => {
    const body = ['---', 'issuegraph:', '  blocked-by:', '    - #9094', '    - #9095', '---'].join('\n');
    const parse = parseFrontmatter(body);
    // The failure this prevents: `blockedBy: []` with NO diagnostic, which is
    // byte-identical to a body declaring no blockers at all — a park that reads
    // as a free issue.
    assert.ok(parse.diagnostics.length > 0, 'a null member must be diagnosed');
    assert.equal(isUnreadDeclaration(parse), true);
    assert.deepEqual(parse.data?.blockedBy, []);
  });

  test('the FLOW spelling is refused too, by a different route', () => {
    // Worth its own case: `[#9094]` is a PARSE ERROR rather than a silent null,
    // so it exercises the block-level refusal instead of the member check. Both
    // must refuse, and neither arm covers the other.
    const body = ['---', 'issuegraph:', '  blocked-by: [#9094, #9095]', '---'].join('\n');
    const parse = parseFrontmatter(body);
    assert.equal(parse.data, null);
    assert.ok(parse.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(parse), true);
  });

  test('CONTROL: the QUOTED spellings both read two refs, cleanly', () => {
    // Without this the two cases above are satisfiable by refusing everything,
    // which would be a reader that reports no edges anywhere.
    const expected = [
      { repo: null, id: '9094' },
      { repo: null, id: '9095' },
    ];
    const seq = parseFrontmatter(
      ['---', 'issuegraph:', '  blocked-by:', '    - "#9094"', '    - "#9095"', '---'].join('\n'),
    );
    assert.deepEqual(seq.data?.blockedBy, expected);
    assert.deepEqual(seq.diagnostics, []);

    const flow = parseFrontmatter(
      ['---', 'issuegraph:', '  blocked-by: ["#9094", "#9095"]', '---'].join('\n'),
    );
    assert.deepEqual(flow.data?.blockedBy, expected);
    assert.deepEqual(flow.diagnostics, []);
  });
});

describe('locateSection agrees with the parser about what it refuses', () => {
  test('a NON-STRING key is skipped, exactly as the parser skips it', () => {
    // The divergence this pins caused DATA LOSS rather than a refused write:
    // `parseFrontmatter` reads `1: extension` as an unrecognised field and
    // returns the recognised ones beside it, so a `locateSection` that refused
    // the section sent the writer down its prepend-a-fresh-block path — and
    // under §4.1's first-block rule the author's original block stopped being
    // canonical, taking every unowned field in it out of view.
    const lines = ['issuegraph:', '  1: extension', '  blocked-by: ["#7"]'];
    const parsed = parseFrontmatter(['---', ...lines, '---'].join('\n'));
    assert.deepEqual(parsed.data?.blockedBy, [{ repo: null, id: '7' }], 'the parser reads it');
    assert.deepEqual(parsed.diagnostics, [], 'and says nothing — an unrecognised field is inert');

    const located = locateSection(lines);
    assert.notEqual(located, null, 'so the locator must not refuse it');
    assert.deepEqual(located?.fields.map((f) => f.key), ['blocked-by']);
  });

  test("a skipped entry's SPAN still bounds the section", () => {
    // `sectionEnd` is what tells a writer where the section stops. An entry
    // omitted from it would read as sibling top-level content, and a section
    // that still holds one would have its `issuegraph:` header dropped as
    // though it had emptied.
    const located = locateSection(['issuegraph:', '  blocked-by: ["#7"]', '  1: extension']);
    assert.equal(located?.endLine, 2);
    assert.equal(located?.hasSiblingKeys, false);
  });
});

describe('a quoted reference is taken as written', () => {
  const B = (v: string): string => ['---', 'issuegraph:', `  blocked-by: [${v}]`, '---'].join('\n');

  test('whitespace inside quotes is not trimmed away', () => {
    // Measured: YAML already strips surrounding whitespace from a PLAIN scalar,
    // including inside a flow sequence — so a trim in the ref parser could only
    // ever act on a QUOTED one, where the author explicitly asked for those
    // bytes. Trimming there bypasses `isRefId`'s whitespace exclusion and
    // silently changes what the author wrote: `" #123 "` would become the
    // reference `123`, and a re-render would write it back as `"#123"`.
    for (const quoted of ['" #123 "', '" ABC-123 "', "' 123 '", '"ABC-123 "']) {
      const r = parseFrontmatter(B(quoted));
      assert.deepEqual(r.data?.blockedBy, [], quoted);
      assert.ok(r.diagnostics.length > 0, quoted);
      assert.equal(isUnreadDeclaration(r), true, quoted);
    }
  });

  test('CONTROL: an unquoted scalar YAML already trimmed still parses', () => {
    // Without this the case above is satisfiable by refusing every padded
    // reference, including the ordinary spelling nobody quoted.
    const r = parseFrontmatter(['---', 'issuegraph:', '  blocked-by: [  ABC-123  ,  231  ]', '---'].join('\n'));
    assert.deepEqual(r.data?.blockedBy, [
      { repo: null, id: 'ABC-123' },
      { repo: null, id: '231' },
    ]);
    assert.deepEqual(r.diagnostics, []);
  });
});

describe('an explicitly-written null section', () => {
  const body = (header: string): string => ['---', header, 'other: x', '---'].join('\n');

  test('READS as an empty declaration, exactly as a bare key does — deliberately', () => {
    // `issuegraph:` and `issuegraph: null` are the SAME YAML value. Measured:
    // both materialize to `{issuegraph: null}`, and the only difference is a
    // zero-width range in the syntax tree. So the parser treats them
    // identically, and it must — distinguishing two spellings of one value by
    // reaching past the data model is the hand-rolled-grammar reflex this
    // module exists to have stopped. "No data" is correctly read as "no edges",
    // which is §4.3's degenerate legal case.
    for (const header of ['issuegraph:', 'issuegraph: null', 'issuegraph: ~', 'issuegraph: Null']) {
      const r = parseFrontmatter(body(header));
      assert.notEqual(r.data, null, header);
      assert.deepEqual(r.data?.blockedBy, [], header);
      assert.equal(r.data?.priority, null, header);
      assert.deepEqual(r.diagnostics, [], header);
      assert.equal(isUnreadDeclaration(r), false, header);
    }
  });

  test('but is NOT line-editable — reported as such, NOT as an absent section', () => {
    // A fact about EDITING, not about meaning. Inserting `  blocked-by:` under
    // `issuegraph: null` nests a mapping under a scalar value — invalid YAML —
    // so a writer must not edit in place.
    //
    // THIS USED TO RETURN `null`, AND THAT WAS THE DEFECT. `null` also means
    // "there is no readable section", and a caller's response to THAT is to
    // prepend a fresh block — which under §4.1's first-block rule demotes this
    // one and silently drops every entry it carries. "I could not answer" and
    // "the answer is none" must not be the same value.
    for (const header of ['issuegraph: null', 'issuegraph: ~', 'issuegraph: Null']) {
      const located = locateSection([header, 'other: x']);
      assert.notEqual(located, null, header);
      assert.equal(located?.lineEditable, false, header);
      assert.deepEqual(located?.fields, [], `${header} carries nothing, so nothing is at stake`);
    }

    // A FLOW mapping is not editable either, and its ENTRIES are still
    // reported — that is what lets a writer tell "nothing to lose" from
    // "something to lose" instead of guessing from a projection.
    const empty = locateSection(['issuegraph: {}']);
    assert.equal(empty?.lineEditable, false, 'empty flow map');
    assert.deepEqual(empty?.fields, [], 'empty flow map carries nothing');

    const carrying = locateSection(['issuegraph: {priority: 1, future-edge: "#5"}']);
    assert.equal(carrying?.lineEditable, false, 'flow map');
    assert.deepEqual(
      carrying?.fields.map((f) => f.key),
      ['priority', 'future-edge'],
      'UNRECOGNISED entries are reported too — a writer counting only recognised fields drops them',
    );
  });

  test('CONTROL: a BARE key stays editable — a writer inserts under it', () => {
    // The other half. Refusing this too would break the ordinary path a splice
    // takes when a block's section has emptied, which is the shape it leaves
    // behind after removing the last owned edge.
    const located = locateSection(['issuegraph:', 'other: x']);
    assert.notEqual(located, null);
    assert.equal(located?.headerLine, 0);
    assert.deepEqual(located?.fields, []);
    assert.equal(located?.hasSiblingKeys, true);
  });
});

/**
 * The READER, not just the predicate, must agree with SPEC.md §4.2.
 *
 * `@issuegraph/core` already pins `isRefId` against §4.2's conformance table.
 * That pin passed while the reader VIOLATED the same table, and the gap is
 * worth naming: an unquoted `007` never reaches `isRefId` as `"007"` — YAML
 * hands the reader the number `7` — so a pin on the predicate says nothing
 * about the parse path the spec is actually describing.
 *
 * This reads the same table and drives it through `parseFrontmatter`, which is
 * the surface a consumer has.
 */
describe('parseFrontmatter agrees with SPEC.md §4.2', () => {
  function specCases(): { id: string; accepted: boolean }[] {
    const specPath = fileURLToPath(new URL('../../../SPEC.md', import.meta.url));
    const spec = readFileSync(specPath, 'utf8');
    const start = spec.indexOf('### 4.2 Issue references');
    assert.notEqual(start, -1, 'SPEC.md no longer contains a "### 4.2 Issue references" heading');
    const section = spec.slice(start, spec.indexOf('### 4.3 Fields'));
    const marker = '| identifier | accepted | why |';
    const at = section.indexOf(marker);
    assert.notEqual(at, -1, 'SPEC.md §4.2 no longer carries the identifier conformance table');
    const cases: { id: string; accepted: boolean }[] = [];
    for (const line of section.slice(at + marker.length).split('\n').slice(2)) {
      if (!line.startsWith('|')) break;
      const cells = line.split('|').map((cell) => cell.trim());
      const id = cells[1];
      const verdict = cells[2];
      if (id === undefined || verdict === undefined || id === '') break;
      cases.push({ id: id.slice(1, -1), accepted: verdict === 'yes' });
    }
    return cases;
  }

  test('every identifier the table states parses, or is refused, as stated', () => {
    const cases = specCases();
    assert.ok(cases.length >= 8, `expected §4.2's table to yield cases, got ${cases.length}`);
    assert.ok(
      cases.some((c) => c.accepted) && cases.some((c) => !c.accepted),
      'the table must state both verdicts, or this pins only one direction',
    );
    for (const { id, accepted } of cases) {
      // QUOTED, so the table's own bytes reach the reader rather than a
      // spelling YAML would retype. The unquoted path is covered separately by
      // the lexical test above — this asserts the SPEC's cases, as written.
      const body = ['---', 'issuegraph:', `  blocked-by: [${JSON.stringify(id)}]`, '---'].join('\n');
      const parse = parseFrontmatter(body);
      assert.equal(
        parse.data?.blockedBy.length ?? 0,
        accepted ? 1 : 0,
        `§4.2 says ${JSON.stringify(id)} is ${accepted ? 'accepted' : 'rejected'}`,
      );
      if (accepted) assert.deepEqual(parse.diagnostics, [], JSON.stringify(id));
      else assert.ok(parse.diagnostics.length > 0, JSON.stringify(id));
    }
  });

  test('and the UNQUOTED spelling of each case agrees too, where YAML permits one', () => {
    // The half the core pin structurally cannot reach: these go through YAML's
    // implicit typing, which is exactly where `007` used to become `7`.
    for (const { id, accepted } of specCases()) {
      if (/[\s"/#]/.test(id)) continue; // not writable unquoted; the sigil rule covers those
      const body = ['---', 'issuegraph:', `  blocked-by: [${id}]`, '---'].join('\n');
      const parse = parseFrontmatter(body);
      assert.equal(
        parse.data?.blockedBy[0]?.id ?? null,
        accepted ? id : null,
        `unquoted ${id} must read as ${accepted ? id : 'a refusal'}`,
      );
    }
  });
});

describe('block discovery finds the key the PARSER reports, not one spelling of it', () => {
  const withKey = (...header: string[]): string =>
    ['---', ...header, '---'].join('\n');

  test('a flow-root block is read — an ordinary serializer emits one', () => {
    // THE HONESTLY-REACHABLE MEMBER of this class, and the reason it is not a
    // curiosity: `yaml.stringify` in flow style emits exactly this shape. So a
    // conforming third-party writer's block was reported as NO BLOCK, with
    // `data: null` and ZERO diagnostics — indistinguishable from an issue that
    // never declared anything, and every edge in it silently gone.
    const parse = parseFrontmatter(withKey('{issuegraph: {blocked-by: ["#1"], priority: 1}}'));
    assert.deepEqual(parse.data?.blockedBy, [{ repo: null, id: '1' }]);
    assert.equal(parse.data?.priority, 1);
    assert.deepEqual(parse.diagnostics, []);
  });

  test('the other spellings a line pattern cannot see are read too', () => {
    // Widening the PATTERN would have been a denylist of spellings, growing a
    // row per review round, with every missing row another silent loss. Asking
    // the parser is total by construction — so these need no rows.
    for (const header of [
      '"issuegraph":\n  blocked-by: ["#1"]',
      '? issuegraph\n: {blocked-by: ["#1"]}',
      '{"issuegraph": {"blocked-by": ["#1"]}}',
      '  issuegraph:\n    blocked-by: ["#1"]',
    ]) {
      const parse = parseFrontmatter(withKey(...header.split('\n')));
      assert.deepEqual(parse.data?.blockedBy, [{ repo: null, id: '1' }], header);
      assert.deepEqual(parse.diagnostics, [], header);
    }
  });

  test('a key NESTED under another key is still not the block header', () => {
    // The case the old indent-zero rule actually protected, and the parser
    // answers it more precisely than an indent test could: `issuegraph` is not
    // a key of this document's root mapping, so the body carries no block.
    const nested = parseFrontmatter(withKey('other:', '  issuegraph:', '    blocked-by: ["#9"]'));
    assert.equal(nested.data, null);

    // And when a real root-level key sits beside it, the ROOT one is canonical.
    const both = parseFrontmatter(
      withKey('other:', '  issuegraph:', '    blocked-by: ["#9"]', 'issuegraph:', '  blocked-by: ["#1"]'),
    );
    assert.deepEqual(both.data?.blockedBy, [{ repo: null, id: '1' }]);
  });

  test('a block that carries the key but does NOT parse is still SELECTED', () => {
    // The regression the union exists to prevent. Judging a candidate by the
    // parse alone would make an unreadable-but-keyed block invisible — no
    // block, no defect, no diagnostic — so the cheap line prefilter is OR-ed in
    // rather than replaced. The union can only ever select more.
    const parse = parseFrontmatter(withKey('issuegraph:', '  priority: 0', '  priority: 1'));
    assert.equal(parse.data, null);
    assert.equal(parse.blockDefect, null, 'a delimited block, so not a block-level defect');
    assert.ok(parse.diagnostics.length > 0, 'and it must say why');
    assert.equal(isUnreadDeclaration(parse), true);
  });

  test('CONTROL: a body with no declaration is still silently absent', () => {
    // Absence must stay absence — the widening must not start reporting a
    // defect for every markdown rule in a body.
    for (const body of ['no block here', ['---', 'other: 1', '---'].join('\n'), ['A', '', '---', '', 'Prose.', '', '---', '', 'B'].join('\n')]) {
      const parse = parseFrontmatter(body);
      assert.equal(parse.data, null, body);
      assert.deepEqual(parse.diagnostics, [], body);
      assert.equal(parse.blockDefect, null, body);
    }
  });
});

describe('a projection must never testify that content is absent', () => {
  // ONE CLASS, TWO SITES, and the review found an instance at each. Every
  // decision about a block here is made from the block's own raw content —
  // never from a line pattern that cannot see every spelling, a parse that
  // failed, or the recognised-field projection that omits extensions by design.

  test('a MALFORMED flow-root block reports itself unread, like the block-style spelling', () => {
    // A failed parse cannot testify the key is absent. It used to: a flow-root
    // block with a YAML error matched no line pattern and would not parse, so
    // it was reported as NO BLOCK — `data: null`, zero diagnostics,
    // `isUnreadDeclaration` false. A malformed declaration read as a fully-read
    // edge-free one, which is the licence for a false clear.
    const malformedFlow = parseFrontmatter(['---', '{ issuegraph: { blocked-by: ["#1", } }', '---'].join('\n'));
    assert.equal(malformedFlow.data, null);
    assert.ok(malformedFlow.diagnostics.length > 0);
    assert.equal(isUnreadDeclaration(malformedFlow), true);

    // The block-style spelling of the same fault, which the line prefilter
    // already caught — the two must not disagree about one body's meaning.
    const malformedBlock = parseFrontmatter(['---', 'issuegraph:', '  blocked-by: ["#1",', '---'].join('\n'));
    assert.equal(isUnreadDeclaration(malformedBlock), true);
  });

  test('CONTROL: a body that never meant to declare stays silently absent', () => {
    // The unanchored key test only decides whether to SELECT an unparseable
    // block; it must not start reporting a defect for ordinary prose.
    for (const body of ['no block here', ['---', 'other: 1', '---'].join('\n'), ['A', '', '---', '', 'Prose.', '', '---', '', 'B'].join('\n')]) {
      const parse = parseFrontmatter(body);
      assert.equal(parse.data, null, body);
      assert.deepEqual(parse.diagnostics, [], body);
      assert.equal(isUnreadDeclaration(parse), false, body);
    }
  });
});
