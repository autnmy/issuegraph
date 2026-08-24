/**
 * The backfill's contract is two invariants, and every case below is an
 * instance of one of them:
 *
 *   1. A body it DELIMITS parses afterwards to exactly the data the original
 *      block declared — no edge invented, dropped, or renumbered — and the
 *      block's own lines survive verbatim.
 *   2. A body it does NOT delimit comes back BYTE-IDENTICAL.
 *
 * Asserting only "it parses now" would let a rewrite that silently changed an
 * edge pass every one of these, which is the failure the module's own positive
 * control exists to refuse — so the assertions here compare DATA, not just
 * parse-success.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseFrontmatter } from '@issuegraph/reader';

import { backfillFrontmatter } from './backfill.ts';
import { renderFrontmatter } from './render.ts';

/** The shape hand-authors actually wrote: a fence, and no `---` pair. */
function fenced(...lines: readonly string[]): string {
  return ['```yaml', 'issuegraph:', ...lines, '```', '', '## Body prose', '', 'Text below.'].join('\n');
}

describe('backfillFrontmatter', () => {
  it('repairs the corpus shape: a ```yaml fence with the delimiters omitted', () => {
    const body = fenced('  blocked-by: [12, 34]', '  evidence: verified');
    assert.equal(parseFrontmatter(body).data, null);

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.deepEqual(parseFrontmatter(result.body).data, {
      blockedBy: [
        { repo: null, number: 12 },
        { repo: null, number: 34 },
      ],
      decomposedFrom: null,
      duplicateOf: null,
      serializeWith: null,
      togetherWith: null,
      priority: null,
      evidence: 'verified',
    });
  });

  it('preserves every line outside the block byte-for-byte', () => {
    const result = backfillFrontmatter(fenced('  duplicate-of: 99'));

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.endsWith('\n## Body prose\n\nText below.'));
  });

  it("wraps the block in the renderer's own canonical delimiters", () => {
    // THE ANTI-DRIFT PIN. The module no longer calls the renderer — it preserves
    // the author's lines rather than re-spelling them — so this is what keeps
    // the DELIMITER form tied to what the writer emits. If the canonical wrapper
    // ever moves, this fails instead of the corpus quietly going stale.
    const canonical = renderFrontmatter({ priority: 2 }, { fenceWrapped: true });
    assert.notEqual(canonical, null);
    const canonicalLines = (canonical ?? '').split('\n');

    const result = backfillFrontmatter(fenced('  priority: 2'));
    const got = result.body.split('\n');

    assert.equal(got[0], canonicalLines[0]);
    assert.equal(got[1], canonicalLines[1]);
    assert.deepEqual(got.slice(0, 5), ['```', '---', 'issuegraph:', '  priority: 2', '---']);
    assert.equal(got[5], canonicalLines[canonicalLines.length - 1]);
  });

  it('keeps YAML comments inside the block', () => {
    // §4.1 makes unrecognized content inert and SILENT, so no diagnostic exists
    // to detect it by — re-rendering from the parsed value deleted it without a
    // trace. One real issue carried four comment lines recording a decision;
    // this is the reason the repair preserves rather than re-spells.
    const body = fenced('  # RULING 2026-08-21: keep this', '  blocked-by: [12]');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.includes('# RULING 2026-08-21: keep this'));
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 12 }]);
  });

  it('keeps an unrecognized extension field', () => {
    const result = backfillFrontmatter(fenced('  blocked-by: [12]', '  owner-note: keep-me'));

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.includes('owner-note: keep-me'));
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 12 }]);
  });

  it('repairs a block sitting under a markdown rule (the `unterminated` reading)', () => {
    // Bodies in the corpus carry a `---` section rule above the fence. The
    // parser reads that rule as an unclosed opening delimiter, so the block
    // reports `unterminated` rather than `undelimited`. The rule is prose and
    // must survive; the repair goes inside the fence, below it.
    const body = [
      '> [!IMPORTANT]',
      '> A callout.',
      '',
      '---',
      '',
      '```yaml',
      'issuegraph:',
      '  blocked-by: [7]',
      '```',
      '',
      'Prose.',
    ].join('\n');
    assert.ok(parseFrontmatter(body).diagnostics.join(' ').includes('no closing'));

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.includes('> A callout.'));
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 7 }]);
  });

  it('keeps a rejected field value, and reports that the parse dropped it', () => {
    // `evidence: measured` is outside the `asserted | verified` vocabulary, so
    // the parser drops it. The BODY keeps the line; the parsed declaration does
    // not, and the caller is told so via `diagnostics`.
    const result = backfillFrontmatter(fenced('  evidence: measured'));

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.includes('evidence: measured'));
    assert.ok(result.diagnostics.join(' ').includes('evidence must be'));
    const reparsed = parseFrontmatter(result.body);
    assert.notEqual(reparsed.data, null);
    assert.equal(reparsed.data?.evidence, null);
  });

  it('leaves an already-canonical body untouched', () => {
    const body = ['---', 'issuegraph:', '  blocked-by: [5]', '---', '', 'Prose.'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'already-canonical');
    assert.equal(result.body, body);
    // A CLEAN block reports nothing — the control for the case below, which
    // would otherwise pass just as well against a function that always returned
    // the parser's diagnostics.
    assert.deepEqual(result.diagnostics, []);
  });

  it('reports a dropped field on an ALREADY-CANONICAL block, not just a repaired one', () => {
    // The same loss, reached through the other arm. `delimited` reports it, and
    // this arm used to return `[]` for the identical drop, purely because the
    // author had remembered the delimiters.
    const body = ['---', 'issuegraph:', '  blocked-by: [5, not-a-ref]', '---', '', 'Prose.'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'already-canonical');
    assert.equal(result.body, body);
    assert.deepEqual(result.data?.blockedBy, [{ repo: null, number: 5 }]);
    // Same diagnostics the parser gave — carried, not re-worded, so a future
    // message change cannot make this pin silently stop describing the loss.
    assert.deepEqual(result.diagnostics, parseFrontmatter(body).diagnostics);
    assert.ok(result.diagnostics.length > 0);
  });

  it('leaves a body with no block untouched', () => {
    const body = '## Just prose\n\nNothing to see.';

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'no-block');
    assert.equal(result.body, body);
  });

  it('does not treat the word issuegraph in prose as a block', () => {
    assert.equal(backfillFrontmatter('We should fix the issuegraph parser.\n\nMore prose.').outcome, 'no-block');
  });

  it('stops at the first column-0 line, so following prose is never swallowed', () => {
    const body = ['```yaml', 'issuegraph:', '  blocked-by: [1]', '```', '## Immediately after', 'prose'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.includes('## Immediately after'));
    assert.ok(result.body.includes('prose'));
  });

  it('does not swallow a later, unrelated fence', () => {
    // The closer is taken across blank lines only. A fence further down, with
    // real content before it, belongs to some other block — absorbing the span
    // between them would delete prose.
    const body = ['```yaml', 'issuegraph:', '  priority: 0', '```', '', '```sh', 'echo hi', '```'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.includes('echo hi'));
    assert.ok(result.body.includes('```sh'));
  });

  it('is idempotent — a repaired body is already-canonical on a second pass', () => {
    const first = backfillFrontmatter(fenced('  blocked-by: [3]', '  evidence: asserted'));
    const second = backfillFrontmatter(first.body);

    assert.equal(second.outcome, 'already-canonical');
    assert.equal(second.body, first.body);
  });

  it('refuses rather than repairs when the block cannot be round-tripped', () => {
    // A sequence directly under the key is a mapping/sequence mixture, which the
    // parser degrades to null STRUCTURALLY — delimiting it would not make it
    // readable, so the body must come back untouched.
    const body = ['```yaml', 'issuegraph:', '  - 12', '  - 34', '```', '', 'Prose.'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'unrecoverable');
    assert.equal(result.body, body);
  });

  it('refuses an unfenced key rather than promoting it', () => {
    // An unfenced column-zero key proves nothing about whether it is metadata or
    // prose: a Markdown fence is only one of the containers that make it prose,
    // and the undelimited detector models none of the others. The population
    // this module repairs is authors who WROTE the fence and read it as the
    // delimiter, so the fence is the evidence and its absence is a refusal.
    const body = ['issuegraph:', '  duplicate-of: 4', '', 'Prose.'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'unrecoverable');
    assert.equal(result.body, body);
    assert.ok(result.diagnostics.join(' ').includes('not inside a code fence'));
  });

  it('tolerates CRLF bodies', () => {
    const body = ['```yaml', 'issuegraph:', '  blocked-by: [8]', '```', '', 'Prose.'].join('\r\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 8 }]);
  });

  it('does not rewrite the line endings of prose it never touched', () => {
    // Rebuilding the body by re-joining split lines picks ONE terminator and
    // imposes it everywhere, so a CRLF body comes back with thousands of changed
    // bytes outside the repaired block. Asserting on parsed data alone cannot
    // see that — this asserts on the BYTES after the region.
    const body = ['```yaml', 'issuegraph:', '  blocked-by: [8]', '```', '', 'Prose one.', 'Prose two.'].join('\r\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.endsWith('\r\nProse one.\r\nProse two.'));
    assert.ok(!result.body.includes('\nProse one.\nProse two.'));
  });

  it("keeps the block's own line endings when the body mixes them", () => {
    // The terminator used to be chosen once from the body's FIRST line break and
    // imposed on every line the replacement wrote — including the block's own. A
    // body whose prose is LF and whose block is CRLF therefore came back with
    // the BLOCK's endings rewritten, which is the byte-for-byte promise broken
    // inside the one region it is about. Neither positive control can see it:
    // the content and the parse are identical either way, so this asserts on
    // the bytes.
    const body = 'Intro.\n\n```yaml\r\nissuegraph:\r\n  blocked-by: [8]\r\n  evidence: verified\r\n```\n\nProse.';

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    // The block's lines keep the CRLF they arrived with...
    assert.ok(result.body.includes('issuegraph:\r\n  blocked-by: [8]\r\n  evidence: verified\r\n'));
    // ...and no line of the block was converted to a bare LF.
    assert.ok(!result.body.includes('issuegraph:\n'));
    assert.ok(!result.body.includes('  blocked-by: [8]\n'));
    // The prose outside the region is untouched, LF and all.
    assert.ok(result.body.startsWith('Intro.\n\n'));
    assert.ok(result.body.endsWith('\n\nProse.'));
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 8 }]);
  });

  it('consumes a closing fence separated from the block by a blank line', () => {
    // The block walk trims trailing blanks back off the block, so the line after
    // it is the BLANK, not the closer. Taking only the immediate next line left
    // the original closer standing below the new fence — a stray fence that
    // corrupts the rendering of everything after it. The block still parses
    // either way, so the positive control cannot catch this.
    const body = ['```yaml', 'issuegraph:', '  blocked-by: [11]', '', '```', '', 'Prose.'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 11 }]);
    // Exactly one fence pair survives: the canonical one.
    assert.equal(result.body.split('\n').filter((line) => /^`{3,}\s*$/.test(line)).length, 2);
    assert.ok(result.body.includes('Prose.'));
  });

  it('refuses a block whose fence it can see on one side only', () => {
    // The blank-line skip must not become a general scan. With real content
    // between the block and its closer, this block's own closer cannot be
    // established locally — splicing a complete fenced replacement over an
    // opener whose closer stays behind leaves a stray fence, and the positive
    // control cannot see that because the block still parses.
    const body = ['```yaml', 'issuegraph:', '  priority: 1', '', 'Prose between.', '', '```'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'unrecoverable');
    assert.equal(result.body, body);
    // THE REFUSAL MUST SAY WHAT IS TRUE. This body's fences DO pair — an
    // established enclosing pair is a precondition of reaching this arm at all,
    // since a genuinely one-sided fence is refused further up as `unfenced` or
    // `undecidable-fence`. So the old "fence on one side only" wording was false
    // every time it fired, and it sent a reader looking for a fence that is
    // right there.
    assert.ok(result.diagnostics.join(' ').includes('something between the block and that fence'));
    assert.ok(
      !result.diagnostics.join(' ').includes('fence on one side only'),
      'the refusal must not claim a fence is missing when both are established',
    );
  });

  // §4.1 permits another tool's top-level keys in the same frontmatter. This
  // walk refuses to repair a block that carries one, because the local scan
  // crosses only blanks and comments — a KNOWN RECALL LIMIT, tracked as #19,
  // and deliberately not closed by widening the scan to the enclosing fence,
  // which is the one thing the narrow span exists to prevent.
  //
  // Pinned so the limit is a decision with a stated cost rather than a surprise,
  // and so the diagnostic keeps naming the real reason.
  for (const [name, body] of [
    [
      'a sibling top-level key BEFORE the section',
      ['```yaml', 'labels-hint: platform', 'issuegraph:', '  blocked-by: [7]', '```', '', 'Prose.'].join('\n'),
    ],
    [
      'a sibling top-level key AFTER the section',
      ['```yaml', 'issuegraph:', '  blocked-by: [7]', 'labels-hint: platform', '```', '', 'Prose.'].join('\n'),
    ],
  ] as const) {
    it(`refuses ${name}, and says why rather than blaming the fence`, () => {
      const result = backfillFrontmatter(body);

      assert.equal(result.outcome, 'unrecoverable');
      assert.equal(result.body, body, 'a refusal writes nothing at all');
      assert.ok(result.diagnostics.join(' ').includes('something between the block and that fence'));
      assert.ok(
        !result.diagnostics.join(' ').includes('fence on one side only'),
        'both fences are established here; the refusal must not claim otherwise',
      );
    });
  }
});

// THE SHAPES A PARITY COUNT GOT WRONG, AND THE CLASS AROUND THEM. Parity treated
// every fence-pattern line as a delimiter. Markdown does not: a closer must be
// at least as long as its opener and must carry no info string, and a fence the
// scan cannot see at all is not a delimiter it may ignore. Each of these bodies
// made parity answer "not inside a fence" for a key that IS inside one — which
// delimits a documentation example into a real scheduling edge. The assertion is
// the same for all of them: refuse, leave the body byte-identical, and declare
// nothing.
describe('refuses a fence structure it cannot establish', () => {
  const shapes: readonly (readonly [string, string])[] = [
    [
      'a four-backtick block quoting a literal ```yaml line',
      ['Here is how to write one:', '', '````markdown', '```yaml', 'issuegraph:', '  blocked-by: [12]', '````'].join(
        '\n',
      ),
    ],
    ['a closer shorter than its opener', ['````', 'issuegraph:', '  blocked-by: [12]', '```', '````'].join('\n')],
    [
      'a tilde fence the backtick scan cannot see',
      ['~~~', 'example', '~~~', '```yaml', 'issuegraph:', '  blocked-by: [7]', '```'].join('\n'),
    ],
    [
      'a fence indented inside a list item',
      ['- like so:', '', '  ```yaml', 'issuegraph:', '  blocked-by: [7]', '```'].join('\n'),
    ],
    ['an info string this scan does not model', ['```ts {1,3}', 'issuegraph:', '  blocked-by: [7]', '```'].join('\n')],
    ['a fence that is never closed', ['```yaml', 'issuegraph:', '  blocked-by: [7]'].join('\n')],
    // NOT FENCE SHAPES — CONTAINER shapes, and the reason the unfenced path is
    // gone rather than taught about HTML. A Markdown fence is one of the things
    // that turns a column-zero key into prose; these are others, and the next
    // author will find one more. Requiring an established fence refuses all of
    // them at once, including the ones nobody has written yet.
    ['a key hidden inside an HTML comment', ['<!--', 'issuegraph:', '  blocked-by: [12]', '-->'].join('\n')],
    [
      'a key inside a details block',
      ['<details>', '<summary>example</summary>', '', 'issuegraph:', '  blocked-by: [12]', '', '</details>'].join('\n'),
    ],
    ['a key with no container at all', ['issuegraph:', '  blocked-by: [12]', '', 'Prose.'].join('\n')],
  ];

  for (const [name, body] of shapes) {
    it(name, () => {
      const result = backfillFrontmatter(body);

      assert.equal(result.outcome, 'unrecoverable', `${name} must not be repaired`);
      // Byte-identical: a refusal writes nothing at all.
      assert.equal(result.body, body);
      // And the harm the refusal exists to prevent: no edge is declared, so
      // nothing here can start blocking an issue once written.
      assert.equal(result.data, null);
      assert.equal(parseFrontmatter(result.body).data, null);
    });
  }

  // THE OTHER HALF OF THE RULE, AND THE REASON THE WALK STOPS EARLY. Fence
  // pairing runs left to right, so a shape the walk cannot read BELOW the answer
  // cannot change it. Refusing on those would refuse bodies whose own block is
  // unambiguous — real issues pair a clean fence around the block with an
  // indented fence inside a list item a hundred lines further down. This is that
  // shape, and it must repair.
  it('still repairs when the shape it cannot read sits below the answer', () => {
    const body = [
      '```yaml',
      'issuegraph:',
      '  blocked-by: [12]',
      '```',
      '',
      'Steps:',
      '',
      '- run it:',
      '',
      '  ```sh',
      '  echo hi',
      '  ```',
    ].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 12 }]);
    // The list item's own fence is untouched, indentation included.
    assert.ok(result.body.includes('  ```sh'));
    assert.ok(result.body.includes('  echo hi'));
  });

  it('reports the refusal rather than skipping it silently', () => {
    const body = ['Here is how:', '', '````markdown', '```yaml', 'issuegraph:', '  blocked-by: [12]', '````'].join(
      '\n',
    );

    assert.ok(backfillFrontmatter(body).diagnostics.join(' ').includes('code-fence structure'));
  });
});

describe('locating the fence around the key', () => {
  it('finds a fence opener separated from the key by a comment or blank line', () => {
    // Checking only `header - 1` missed the wrapper entirely, so a complete
    // fenced replacement went INSIDE the existing fence and left the original
    // opener, prefix and closer around it — nested fences, and a parse check
    // that still passes.
    const body = ['```yaml', '# context', '', 'issuegraph:', '  blocked-by: [21]', '```', '', 'Prose.'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'delimited');
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 21 }]);
    // Exactly one fence pair survives, and the comment went with the block it
    // belonged to.
    assert.equal(result.body.split('\n').filter((line) => /^`{3,}\s*$/.test(line)).length, 2);
    assert.ok(!result.body.includes('```yaml'));
    assert.ok(result.body.includes('Prose.'));
    // THE ASSERTION THIS TEST WAS MISSING. Moving the span back to the fence
    // while the replacement still began at the key deleted everything between
    // them, and every other assertion here passed while it did.
    assert.ok(result.body.includes('# context'));
  });

  it('refuses a body carrying a second key, which may be a documentation example', () => {
    // The undelimited detector is deliberately loose because a false positive
    // there leaves `data` untouched. Acting on it makes that false positive a
    // real edge, so a body where one key may be an example is not this tool's to
    // adjudicate.
    const body = [
      '```yaml',
      'issuegraph:',
      '  blocked-by: [12]',
      '```',
      '',
      'Write yours like this:',
      '',
      'issuegraph:',
      '  blocked-by: [34]',
    ].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'unrecoverable');
    assert.equal(result.body, body);
    assert.ok(result.diagnostics.join(' ').includes('more than one issuegraph key'));
  });

  it('never deletes a rejected field just because another field survived', () => {
    // `blocked-by` parses and `evidence: measured` does not, so a renderer would
    // emit only the valid field — silently dropping the author's line. The
    // positive control cannot catch it: the probe had already dropped that
    // field, so both sides agree.
    const result = backfillFrontmatter(fenced('  blocked-by: [12]', '  evidence: measured'));

    assert.equal(result.outcome, 'delimited');
    assert.ok(result.body.includes('evidence: measured'));
    assert.deepEqual(parseFrontmatter(result.body).data?.blockedBy, [{ repo: null, number: 12 }]);
  });

  it('refuses a key between two fenced code blocks rather than reading its neighbours as a pair', () => {
    // A BARE ``` satisfies both the opener and the closer test, so this shape
    // once had the previous block's CLOSER and the next block's OPENER read as a
    // matched pair around the key. Pairing the body's fences answers it outright
    // — neither established pair encloses the key — and an unenclosed key is
    // refused, so the neighbours are never touched at all.
    const body = ['```sh', 'echo one', '```', 'issuegraph:', '  blocked-by: [1]', '```', 'print(2)', '```'].join('\n');

    const result = backfillFrontmatter(body);

    assert.equal(result.outcome, 'unrecoverable');
    assert.equal(result.body, body);
    // The neighbouring code blocks keep their own fences and contents.
    assert.ok(result.body.includes('```sh'));
    assert.ok(result.body.includes('echo one'));
    assert.ok(result.body.includes('print(2)'));
  });
});

// THE INVARIANT, TESTED DIRECTLY RATHER THAN ONE SHAPE AT A TIME.
//
// Three consecutive review rounds found three different ways for author text to
// disappear — a rejected field value, a silent extension field, and a line
// between the fence and the key — and every one of them parsed identically
// before and after, so no data-level assertion could see any of them. Each was
// fixed by adding another example. This asserts the property instead: a repaired
// body keeps every line it started with, except the fence line that is
// deliberately re-spelled.
describe('no repair ever loses a line', () => {
  const shapes: readonly (readonly [string, string])[] = [
    ['plain', ['```yaml', 'issuegraph:', '  blocked-by: [1]', '```', '', 'Prose.'].join('\n')],
    ['comment before the key', ['```yaml', '# note', 'issuegraph:', '  blocked-by: [1]', '```', '', 'P.'].join('\n')],
    ['blank before the key', ['```yaml', '', 'issuegraph:', '  blocked-by: [1]', '```', '', 'P.'].join('\n')],
    ['comment inside the block', ['```yaml', 'issuegraph:', '  # why', '  blocked-by: [1]', '```', '', 'P.'].join('\n')],
    [
      'extension field',
      ['```yaml', 'issuegraph:', '  blocked-by: [1]', '  owner-note: keep', '```', '', 'P.'].join('\n'),
    ],
    ['rejected value', ['```yaml', 'issuegraph:', '  evidence: measured', '```', '', 'P.'].join('\n')],
    ['blank before the closer', ['```yaml', 'issuegraph:', '  blocked-by: [1]', '', '```', '', 'P.'].join('\n')],
    ['banner above', ['> [!NOTE]', '> hi', '', '```yaml', 'issuegraph:', '  priority: 3', '```', '', 'P.'].join('\n')],
    [
      'under a markdown rule',
      ['> hi', '', '---', '', '```yaml', 'issuegraph:', '  blocked-by: [2]', '```', '', 'P.'].join('\n'),
    ],
  ];

  for (const [name, body] of shapes) {
    it(name, () => {
      const result = backfillFrontmatter(body);
      assert.equal(result.outcome, 'delimited');

      // A fence line may be re-spelled (```yaml -> ```); nothing else may go.
      const isFence = (line: string): boolean => /^`{3,}[A-Za-z0-9-]*[ \t]*$/.test(line.trim());
      const after = result.body.split('\n');
      for (const line of body.split('\n')) {
        if (line.trim() === '' || isFence(line)) continue;
        assert.ok(after.includes(line), `lost ${JSON.stringify(line)} from the ${name} shape`);
      }
      // And the repair must have actually worked.
      assert.notEqual(parseFrontmatter(result.body).data, null);
    });
  }
});

describe('the strict key rule decides what counts as a header', () => {
  it('repairs an undelimited block whose key is quoted', () => {
    // A locator built on a regex over the key's spelling used to miss this:
    // a hand-authored `"issuegraph":` block with no `---` pair was invisible
    // here, so the backfill did nothing and the declaration stayed inert.
    const body = ['```yaml', '"issuegraph":', '  blocked-by: [7]', '```', '', 'prose'].join('\n');
    const r = backfillFrontmatter(body);
    assert.equal(r.outcome, 'delimited');
    assert.deepEqual(r.data?.blockedBy, [{ repo: null, number: 7 }]);
  });

  it('stops reporting a SECOND key that only the prefilter can see', () => {
    // The exported pattern over-matches on purpose: it accepts `""issuegraph:`,
    // which the parser refuses. Counting headers with it reported
    // `ambiguous-key` — "more than one issuegraph key at a line start" — for a
    // body carrying exactly ONE key the parser would read. That sends a human
    // looking for a second declaration that does not exist.
    //
    // The body is NOT repairable either way, and the correct outcome is still a
    // refusal. What the strict count buys is a refusal for the RIGHT reason: the
    // stray line sits between the fence and the block, so wrapping the block
    // alone would strand it.
    const body = ['```yaml', '""issuegraph:', '"issuegraph":', '  blocked-by: [7]', '```'].join('\n');
    const r = backfillFrontmatter(body);
    assert.notEqual(r.outcome, 'delimited');
    assert.ok(r.diagnostics.join(' ').includes('something between the block and that fence'));
    assert.ok(!r.diagnostics.join(' ').includes('more than one issuegraph key'));
  });

  it('still refuses when TWO strictly-valid keys are present', () => {
    // The guard against over-correcting: genuine ambiguity is still ambiguity,
    // and choosing between two real headers is not this tool's call.
    const body = ['```yaml', 'issuegraph:', '  blocked-by: [7]', '"issuegraph":', '  blocked-by: [8]', '```'].join(
      '\n',
    );
    assert.notEqual(backfillFrontmatter(body).outcome, 'delimited');
  });

  it('repairs a lone quoted-key block, so the strict count did not break the ordinary case', () => {
    const body = ['```yaml', '"issuegraph":', '  blocked-by: [7]', '```'].join('\n');
    const r = backfillFrontmatter(body);
    assert.equal(r.outcome, 'delimited');
    assert.deepEqual(r.data?.blockedBy, [{ repo: null, number: 7 }]);
  });
});
