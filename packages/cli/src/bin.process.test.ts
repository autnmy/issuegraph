/**
 * The process-level proof.
 *
 * Everything else in this package tests functions. This file spawns the BUILT
 * binary and reads its exit code, because that is the surface a shell, a
 * workflow and a GitHub Action actually see — and because the requirement it
 * discharges says an absent declaration and a malformed one must differ in the
 * exit code, which no in-process assertion can demonstrate.
 *
 * It runs `dist/bin.js` deliberately. `pnpm run ci` builds before it tests, so
 * CI always executes a fresh artifact; a developer running the package's tests
 * straight after an edit gets whatever `dist` currently holds, which is the same
 * window every sibling package already has (they resolve their dependencies
 * through `dist` too). When `dist` is missing entirely, the check below says so
 * with the remedy rather than failing as a confusing spawn error.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { EXIT } from './exit.ts';
import { VERB_NAMES } from './argv.ts';
import { ABSENT_BODY, HAZARD_BODY, QUOTED_BODY } from './testing/fixtures.ts';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

assert.ok(
  existsSync(BIN),
  `dist/bin.js is not built. Run \`pnpm run build\` first — this test executes the built binary by design (${BIN})`,
);

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[], stdin = ''): Run {
  const result = spawnSync(process.execPath, [BIN, ...args], { input: stdin, encoding: 'utf8' });
  assert.equal(result.error, undefined, String(result.error));
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function json(stdout: string): Record<string, unknown> {
  const value: unknown = JSON.parse(stdout);
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

describe('the built binary distinguishes absence from malformation', () => {
  test('THE HAZARD: unquoted block-sequence refs exit non-zero with a named error', () => {
    const result = run(['parse'], HAZARD_BODY);
    assert.equal(result.status, EXIT.unreadDeclaration);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('unread declaration'), result.stderr);
    assert.equal(Object.hasOwn(json(result.stdout), 'data'), false, 'edges must not be reported');
    assert.equal(json(result.stdout)['state'], 'unread');
  });

  test('THE CONTROL: the same two edges, quoted, exit 0 and are reported', () => {
    // Without this the test above proves only that the binary can fail, not that
    // it discriminates.
    const result = run(['parse'], QUOTED_BODY);
    assert.equal(result.status, EXIT.ok);
    assert.ok(Object.hasOwn(json(result.stdout), 'data'));
    assert.ok(result.stdout.includes('123') && result.stdout.includes('124'));
  });

  test('THE THIRD ARM: a body with no block exits 0 and says absent', () => {
    const result = run(['parse'], ABSENT_BODY);
    assert.equal(result.status, EXIT.ok);
    assert.equal(json(result.stdout)['state'], 'absent');
    assert.equal(Object.hasOwn(json(result.stdout), 'data'), false);
  });

  test('the three arms produce three distinguishable outcomes', () => {
    const hazard = run(['parse'], HAZARD_BODY);
    const absent = run(['parse'], ABSENT_BODY);
    const quoted = run(['parse'], QUOTED_BODY);
    assert.notEqual(hazard.status, absent.status);
    assert.equal(absent.status, quoted.status);
    assert.notEqual(json(absent.stdout)['state'], json(quoted.stdout)['state']);
  });
});

describe('usage errors at the process boundary', () => {
  test('an unknown verb exits usage and names the allowed verbs', () => {
    const result = run(['nope']);
    assert.equal(result.status, EXIT.usage);
    for (const name of VERB_NAMES) assert.ok(result.stderr.includes(name), `missing ${name}`);
  });

  test('a known option on the wrong verb exits usage', () => {
    assert.equal(run(['parse', '--edges', '{}']).status, EXIT.usage);
  });

  test('--body-file pointing at a missing path exits usage and names the path', () => {
    const result = run(['parse', '--body-file', '/definitely/not/here.md']);
    assert.equal(result.status, EXIT.usage);
    assert.ok(result.stderr.includes('/definitely/not/here.md'), result.stderr);
  });

  test('an invalid order document exits usage, never unread', () => {
    const result = run(['order'], '{ not json');
    assert.equal(result.status, EXIT.usage);
    assert.notEqual(result.status, EXIT.unreadDeclaration);
  });
});

describe('a write command never exits 0 having silently done nothing', () => {
  // Both reported findings, at the boundary a caller's automation actually reads.
  test('#18: --no-duplicate-of is a real clear now, and the BODY is what proves it', () => {
    // This used to assert a REFUSAL, because the writer could not perform the
    // clear and a flag exiting 0 having changed nothing is precisely the defect
    // this suite is named for. The clear is real since #18, so the guarantee is
    // unchanged and only its evidence moved: from the exit code to the body.
    // Asserting `EXIT.ok` alone would pass for a command that did nothing.
    const body = ['---', 'issuegraph:', '  duplicate-of: 42', '  blocked-by:', '    - 1', '---', '', 'Prose.'].join('\n');
    const result = run(['set', '--no-duplicate-of'], body);
    assert.equal(result.status, EXIT.ok, result.stderr);
    assert.ok(!result.stdout.includes('duplicate-of'), result.stdout);
    assert.ok(result.stdout.includes('blocked-by'), 'an unowned field must survive');
  });

  test('an unrecognised --edges key is refused, not ignored', () => {
    const body = ['---', 'issuegraph:', '  serialize-with: 9', '---', '', 'Prose.'].join('\n');
    const result = run(['splice', '--edges', '{"serialiseWith":"9"}'], body);
    assert.equal(result.status, EXIT.usage);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes('serialiseWith'), result.stderr);
  });

  test('CONTROL: the clear the writer CAN perform still succeeds and still clears', () => {
    const body = ['---', 'issuegraph:', '  serialize-with: 9', '  blocked-by:', '    - 1', '---', '', 'Prose.'].join('\n');
    const result = run(['set', '--no-serialize-with'], body);
    assert.equal(result.status, EXIT.ok);
    assert.ok(!result.stdout.includes('serialize-with'), result.stdout);
    assert.ok(result.stdout.includes('blocked-by'), 'an unowned field must survive');
  });
});

describe('--help and --version', () => {
  const help = run(['--help']);

  test('--help exits 0', () => {
    assert.equal(help.status, EXIT.ok);
  });

  test('documents every verb', () => {
    for (const name of VERB_NAMES) assert.ok(help.stdout.includes(name), `help omits ${name}`);
  });

  test('documents every exit code, so a new code cannot ship undocumented', () => {
    for (const [name, code] of Object.entries(EXIT)) {
      assert.ok(help.stdout.includes(name), `help omits the ${name} code`);
      assert.ok(help.stdout.includes(String(code)), `help omits code ${code}`);
    }
  });

  test('--version prints something version-shaped, and only that', () => {
    const result = run(['--version']);
    assert.equal(result.status, EXIT.ok);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  });
});

describe('the stream contract', () => {
  test('a body verb writes ONLY the body to stdout, so redirection is safe', () => {
    const result = run(['set', '--blocked-by', '7'], ABSENT_BODY);
    assert.equal(result.status, EXIT.ok);
    // Feed the captured stdout straight back in: if a note had leaked into it,
    // the round-trip would not read.
    const reread = run(['parse'], result.stdout);
    assert.equal(reread.status, EXIT.ok);
    assert.equal(json(reread.stdout)['state'], 'read');
  });

  test('a refusal writes nothing at all to stdout', () => {
    const result = run(['set', '--blocked-by', '7'], HAZARD_BODY);
    assert.equal(result.status, EXIT.unreadDeclaration);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  });

  test('stdout survives a large body — the exit code never truncates the answer', () => {
    // `process.exit()` can cut a pending pipe write short; this binary sets
    // `process.exitCode` instead. A body far larger than a pipe buffer is what
    // makes the difference observable.
    const big = `${ABSENT_BODY}\n${'filler line to make this body large.\n'.repeat(5000)}`;
    const result = run(['backfill'], big);
    assert.equal(result.status, EXIT.ok);
    assert.equal(result.stdout, big, 'stdout was truncated');
  });
});

describe('order at the process boundary', () => {
  const document = JSON.stringify({
    baseRanking: {
      source: 'config',
      order: [
        { key: '1', matchedOrderIndex: 0 },
        { key: '2', matchedOrderIndex: 0 },
      ],
    },
    issues: [
      {
        number: 1,
        open: true,
        labels: ['P1'],
        assigneeCount: 0,
        body: ['---', 'issuegraph:', '  blocked-by:', '    - "#2"', '---', '', 'Prose.'].join('\n'),
      },
      { number: 2, open: true, labels: ['P2'], assigneeCount: 0, body: 'no block' },
    ],
  });

  test('runs with no token, no network and no tracker — only the document', () => {
    const result = run(['order'], document);
    assert.equal(result.status, EXIT.ok);
    assert.ok(json(result.stdout)['slots'] !== undefined);
  });

  test('ready is a strict subset of order on the same input', () => {
    const all: unknown = JSON.parse(run(['order'], document).stdout);
    const only: unknown = JSON.parse(run(['ready'], document).stdout);
    assert.ok(Array.isArray((all as { slots: unknown[] }).slots));
    const allSlots = (all as { slots: { ready: boolean }[] }).slots;
    const readySlots = (only as { slots: { ready: boolean }[] }).slots;
    assert.deepEqual(readySlots, allSlots.filter((s) => s.ready));
  });
});
