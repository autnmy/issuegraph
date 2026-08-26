/**
 * Dispatch-level tests — the layer where a command line becomes a decision.
 *
 * The refusals here all belong to ONE class, and it is the class this package
 * exists to refuse, rebuilt one layer up: **a write command that exits 0 having
 * silently not done what it was asked.** Two instances were reported in review
 * (a clear the writer cannot perform, and an unrecognised payload key); sweeping
 * the predicate behind them found five dishonest flags rather than two, and the
 * fix removes the class by generating the flag table from `fields.ts` instead of
 * listing it. These tests pin the predicate, not the two reported spellings.
 *
 * ONE OF THOSE TWO INSTANCES NO LONGER EXISTS. #18 made every owned field
 * clearable, so there is no unperformable clear left to refuse — the flag table
 * is still generated, and the tests below now pin that it offers a `--no-` form
 * for every owned field and for none of the render-only three. The CLASS is
 * unchanged; one of its two original spellings closed.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseArgv } from './argv.ts';
import { EXIT } from './exit.ts';
import { EDGE_JSON_KEYS, RENDER_ONLY, SPLICE_CLEARABLE, SPLICE_WRITABLE } from './fields.ts';
import { dispatch } from './run.ts';
import { CANONICAL_BODY } from './testing/fixtures.ts';

/** A block carrying one of every writable field, so a clear has something to remove. */
const FULL_BODY = [
  '---',
  'issuegraph:',
  '  blocked-by:',
  '    - 1',
  '  serialize-with: 9',
  '  decomposed-from: 7',
  '  duplicate-of: 42',
  '---',
  '',
  'Prose.',
].join('\n');

function run(argv: readonly string[], body: string, edgesFile?: string) {
  const parsed = parseArgv(argv);
  return dispatch(parsed, edgesFile === undefined ? { primary: body } : { primary: body, edgesFile }, '0.0.0-test');
}

describe('a clear is offered only where the writer can perform one', () => {
  test('every clearable field has a --no- flag', () => {
    for (const field of SPLICE_CLEARABLE) {
      const parsed = parseArgv(['set', `--no-${field}`]);
      assert.equal(parsed.kind, 'verb', `--no-${field} should be accepted`);
    }
  });

  test('every NON-clearable writable field has NO --no- flag', () => {
    // The sweep, still worth keeping. It used to cover five fields:
    // `decomposed-from` and `duplicate-of` were the two reported, and
    // `together-with`, `priority` and `evidence` were found by applying the
    // predicate rather than by a second review round. #18 made the first two
    // clearable, so three remain — and those three are a DIFFERENT limit: the
    // splice cannot amend them in an existing block at all, so there is nothing
    // for a `--no-` form to remove.
    const nonClearable = [...SPLICE_WRITABLE, ...RENDER_ONLY].filter(
      (field) => !SPLICE_CLEARABLE.includes(field),
    );
    assert.deepEqual([...nonClearable], [...RENDER_ONLY], 'exactly the render-only fields, and nothing else');
    for (const field of nonClearable) {
      const parsed = parseArgv(['set', `--no-${field}`]);
      assert.ok(parsed.kind === 'usage-error', `--no-${field} must not be accepted`);
      assert.ok(parsed.message.includes(`--no-${field}`), parsed.message);
    }
  });

  test('#18: --no-duplicate-of now EXISTS and removes the entry', () => {
    // It used to be a usage error, because the writer could not perform the
    // clear and a flag that exits 0 having changed nothing is the defect this
    // package exists to refuse. The retraction is real now, so the flag is too.
    const result = run(['set', '--no-duplicate-of'], FULL_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.ok(!result.stdout.includes('duplicate-of'), result.stdout);
  });

  test('#18: --no-decomposed-from likewise', () => {
    const result = run(['set', '--no-decomposed-from'], FULL_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.ok(!result.stdout.includes('decomposed-from'), result.stdout);
  });

  test('CONTROL: --no-serialize-with really does remove the entry, and exits 0', () => {
    // Without this control the tests above would pass for a CLI that had simply
    // stopped clearing anything.
    const result = run(['set', '--no-serialize-with'], FULL_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.ok(!result.stdout.includes('serialize-with'), result.stdout);
    assert.ok(result.stdout.includes('duplicate-of'), 'an unowned field must survive');
  });

  test('CONTROL: a --field and its --no- form together are still contradictory', () => {
    // The two new flags inherit the contradiction check by being in the same
    // list the flag surface is generated from. Pinned on one of them, because
    // that inheritance is the thing that could quietly not happen.
    const result = run(['set', '--duplicate-of', '#5', '--no-duplicate-of'], FULL_BODY);
    assert.equal(result.code, EXIT.usage);
    assert.equal(result.stdout, '', 'a refusal writes no body');
  });
});

describe('splice --edges validates its payload', () => {
  test('an unrecognised key is refused, naming what is allowed', () => {
    for (const key of ['serialiseWith', 'duplicate-of', 'blockedby', 'nonsense']) {
      const result = run(['splice', '--edges', JSON.stringify({ [key]: '9' })], FULL_BODY);
      assert.equal(result.code, EXIT.usage, `${key} should be refused`);
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.join('\n').includes(key), result.stderr.join('\n'));
      for (const allowed of EDGE_JSON_KEYS) {
        assert.ok(result.stderr.join('\n').includes(allowed), `should name ${allowed}`);
      }
    }
  });

  test('#18: a null on ANY single-valued key clears it', () => {
    // It used to be refused for `decomposedFrom` and `duplicateOf`, because the
    // writer read `null` there as "leave untouched" and accepting it would have
    // reported a clear the command never performed. Every one of them is a real
    // clear now, so no invocation that used to succeed changed — only ones that
    // used to exit `refusedWrite`.
    for (const [key, spelling] of [
      ['serializeWith', 'serialize-with'],
      ['decomposedFrom', 'decomposed-from'],
      ['duplicateOf', 'duplicate-of'],
    ] as const) {
      const result = run(['splice', '--edges', JSON.stringify({ [key]: null })], FULL_BODY);
      assert.equal(result.code, EXIT.ok, `${key}: ${result.stderr.join('\n')}`);
      assert.ok(!result.stdout.includes(spelling), result.stdout);
    }
  });

  test('#18: an empty blockedBy array still clears, and is not read as a null', () => {
    // `blocked-by` is cleared with `[]` at this boundary, never with `null` —
    // a `null` there is refused as a non-array before any clear test is
    // reached. The two questions used to need a whole derived constant to keep
    // apart; the list/single distinction is all that is left of it.
    const cleared = run(['splice', '--edges', '{"blockedBy":[]}'], FULL_BODY);
    assert.equal(cleared.code, EXIT.ok, cleared.stderr.join('\n'));
    assert.ok(!cleared.stdout.includes('blocked-by'), cleared.stdout);

    const nulled = run(['splice', '--edges', '{"blockedBy":null}'], FULL_BODY);
    assert.equal(nulled.code, EXIT.usage, nulled.stderr.join('\n'));
    assert.ok(nulled.stderr.join('\n').includes('array'), nulled.stderr.join('\n'));
  });

  test('CONTROL: an ordinary write through a recognised key still lands', () => {
    const result = run(['splice', '--edges', '{"duplicateOf":"99"}'], FULL_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.ok(result.stdout.includes('duplicate-of: "#99"'), result.stdout);
  });

  test('blockedBy: [] still clears — the writer reads an empty LIST as remove', () => {
    const result = run(['splice', '--edges', '{"blockedBy":[]}'], FULL_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.ok(!result.stdout.includes('blocked-by'), result.stdout);
  });

  test('a payload that is not an object is refused', () => {
    assert.equal(run(['splice', '--edges', '[]'], FULL_BODY).code, EXIT.usage);
    assert.equal(run(['splice', '--edges', 'null'], FULL_BODY).code, EXIT.usage);
  });

  test('--edges and --edges-file together is refused', () => {
    const result = run(['splice', '--edges', '{}', '--edges-file', 'x.json'], FULL_BODY, '{}');
    assert.equal(result.code, EXIT.usage);
    assert.ok(result.stderr.join('\n').includes('not both'), result.stderr.join('\n'));
  });

  test('neither --edges nor --edges-file is refused', () => {
    const result = run(['splice'], FULL_BODY);
    assert.equal(result.code, EXIT.usage);
  });

  test('--edges-file content is read from the resolved input, never the path', () => {
    // The path must never be mistaken for the payload — splicing the characters
    // of a filename into an issue body is the failure this separation prevents.
    const result = run(['splice', '--edges-file', '/tmp/edges.json'], FULL_BODY, '{"duplicateOf":"55"}');
    assert.equal(result.code, EXIT.ok);
    assert.ok(result.stdout.includes('duplicate-of: "#55"'), result.stdout);
  });
});

describe('--priority is validated as a SPELLING, not coerced', () => {
  const BODY = 'Prose with no block.';

  function priorityOf(result: ReturnType<typeof run>): string | null {
    const found = /priority: (\d+)/.exec(result.stdout);
    return found?.[1] ?? null;
  }

  test('every non-canonical spelling is refused', () => {
    // `Number()` is a coercion, not a parser. Each of these produced a silently
    // WRONG priority; the empty one wrote 0, the highest urgency there is.
    for (const value of ['', ' ', '  ', '0x2', '1e0', '2.0', '+1', '-0', '03', '4', 'one']) {
      const result = run(['set', `--priority=${value}`], BODY);
      assert.equal(result.code, EXIT.usage, `--priority=${JSON.stringify(value)} was accepted`);
      assert.equal(priorityOf(result), null, `--priority=${JSON.stringify(value)} wrote a value`);
    }
  });

  test('CONTROL: every canonical spelling still works, and writes what it says', () => {
    for (const value of ['0', '1', '2', '3']) {
      const result = run(['set', `--priority=${value}`], BODY);
      assert.equal(result.code, EXIT.ok, `--priority=${value} was refused`);
      assert.equal(priorityOf(result), value);
    }
  });

  test('the empty spelling does not become the highest priority', () => {
    // The specific harm, pinned on its own: a caller who typed `--priority=` and
    // walked away must not have reordered the backlog.
    const result = run(['set', '--priority='], BODY);
    assert.notEqual(priorityOf(result), '0');
  });
});

describe('dispatch routes the non-verb forms', () => {
  test('--help exits 0 and mentions the boundary rule', () => {
    const result = dispatch(parseArgv(['--help']), { primary: '' }, '9.9.9');
    assert.equal(result.code, EXIT.ok);
    assert.ok(result.stdout.includes('ticket body'));
  });

  test('--version reports the version it was given', () => {
    const result = dispatch(parseArgv(['--version']), { primary: '' }, '9.9.9');
    assert.equal(result.code, EXIT.ok);
    assert.equal(result.stdout.trim(), '9.9.9');
  });

  test('a usage error from parsing survives into the result', () => {
    const result = dispatch(parseArgv(['nope']), { primary: '' }, '0.0.0');
    assert.equal(result.code, EXIT.usage);
  });

  test('every verb is reachable and none throws on an ordinary body', () => {
    // Totality over the verb table: a new verb with no dispatch arm would fail
    // to compile, and one that throws on a plain body fails here.
    for (const argv of [
      ['parse'],
      ['validate'],
      ['backfill'],
      ['set', '--blocked-by', '3'],
      ['splice', '--edges', '{"blockedBy":["3"]}'],
    ]) {
      assert.doesNotThrow(() => run(argv, CANONICAL_BODY), argv.join(' '));
    }
  });
});
