/**
 * Did a CLI change alter an invocation that already worked?
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST. It compares this checkout's binary
 * against the PUBLISHED one, so it needs the network and the registry — the
 * same reason `verify-published.ts` and `smoke-consumer.mjs` sit outside
 * `pnpm run ci`. A network dependency inside the test suite buys a flaky gate,
 * not a safer one.
 *
 * WHAT IT IS FOR. A CLI's compatibility promise is the kind of claim that gets
 * asserted in a changelog and never checked again. #18 made exactly that claim
 * — that its breaking library change reached the command line without moving
 * any invocation that already worked — and measured it once, by hand, from a
 * throwaway shell script. Three separate reviewers pointed out that a one-time
 * measurement guards nothing. This is that measurement, committed.
 *
 * HOW IT DECIDES. Every case runs through BOTH binaries with identical argv and
 * identical stdin, and is compared on stdout AND exit code. A case is declared
 * `same` or `changed`, and each case says which it EXPECTS — so a run that
 * cannot tell the two apart fails loudly instead of reporting agreement.
 *
 * THAT LAST PART IS THE POINT, and it is not hypothetical. The first hand-run
 * of this comparison reported "SAME" for all 25 cases while both binaries were
 * failing to launch: two identical failures compare equal. A sweep that cannot
 * distinguish a changed case from an unchanged one is not evidence, so this
 * refuses to report at all unless the must-differ cases actually differ.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The body every case is run against — deliberately carrying more than the owned edges. */
const BODY = [
  '---',
  'issuegraph:',
  '  duplicate-of: "#42"',
  '  decomposed-from: "#7"',
  '  serialize-with: "#3"',
  '  blocked-by:',
  '    - "#9"',
  '    - "#10"',
  '  priority: 1',
  '  future-extension: keep-me',
  'labels-hint: platform',
  '---',
  '',
  'Prose.',
  '',
].join('\n');

interface Case {
  readonly label: string;
  readonly argv: readonly string[];
  /** `true` when this invocation must behave identically across the two versions. */
  readonly expectSame: boolean;
}

/**
 * EVERY CASE THAT WAS VALID AT THE BASELINE MUST BE `expectSame`, and the
 * must-differ list is the release's own claim about what it changed. Adding a
 * changed behaviour means adding it here deliberately, which is the review
 * moment this file exists to create.
 */
const CASES: readonly Case[] = [
  // --edges, every shape the payload accepts.
  { label: '--edges blockedBy set', argv: ['splice', '--edges', '{"blockedBy":["#1","#2"]}'], expectSame: true },
  { label: '--edges blockedBy []', argv: ['splice', '--edges', '{"blockedBy":[]}'], expectSame: true },
  { label: '--edges blockedBy null', argv: ['splice', '--edges', '{"blockedBy":null}'], expectSame: true },
  { label: '--edges serializeWith ref', argv: ['splice', '--edges', '{"serializeWith":"#5"}'], expectSame: true },
  { label: '--edges serializeWith null', argv: ['splice', '--edges', '{"serializeWith":null}'], expectSame: true },
  { label: '--edges decomposedFrom ref', argv: ['splice', '--edges', '{"decomposedFrom":"#8"}'], expectSame: true },
  { label: '--edges duplicateOf ref', argv: ['splice', '--edges', '{"duplicateOf":"#99"}'], expectSame: true },
  { label: '--edges qualified ref', argv: ['splice', '--edges', '{"duplicateOf":"acme/widgets#4"}'], expectSame: true },
  { label: '--edges multi-field', argv: ['splice', '--edges', '{"blockedBy":["#1"],"duplicateOf":"#9"}'], expectSame: true },
  { label: '--edges unknown key', argv: ['splice', '--edges', '{"serialiseWith":"#5"}'], expectSame: true },
  { label: '--edges empty object', argv: ['splice', '--edges', '{}'], expectSame: true },
  { label: '--edges malformed json', argv: ['splice', '--edges', '{oops'], expectSame: true },
  // set, flags.
  { label: 'set --blocked-by', argv: ['set', '--blocked-by', '#1'], expectSame: true },
  { label: 'set --no-blocked-by', argv: ['set', '--no-blocked-by'], expectSame: true },
  { label: 'set --serialize-with', argv: ['set', '--serialize-with', '#4'], expectSame: true },
  { label: 'set --no-serialize-with', argv: ['set', '--no-serialize-with'], expectSame: true },
  { label: 'set --duplicate-of', argv: ['set', '--duplicate-of', '#77'], expectSame: true },
  { label: 'set --decomposed-from', argv: ['set', '--decomposed-from', '#77'], expectSame: true },
  { label: 'set --priority (render-only refusal)', argv: ['set', '--priority', '2'], expectSame: true },
  { label: 'set contradictory pair', argv: ['set', '--blocked-by', '#1', '--no-blocked-by'], expectSame: true },
  // read verbs, which the change must not have touched at all.
  { label: 'parse', argv: ['parse'], expectSame: true },
  { label: 'validate', argv: ['validate'], expectSame: true },
  { label: 'backfill', argv: ['backfill'], expectSame: true },

  // THE RELEASE'S OWN CLAIM about what changed. Each of these exited `usage` at
  // the baseline — a refusal, never a success — so nothing that worked moved.
  { label: '--edges duplicateOf null', argv: ['splice', '--edges', '{"duplicateOf":null}'], expectSame: false },
  { label: '--edges decomposedFrom null', argv: ['splice', '--edges', '{"decomposedFrom":null}'], expectSame: false },
  { label: 'set --no-duplicate-of', argv: ['set', '--no-duplicate-of'], expectSame: false },
  { label: 'set --no-decomposed-from', argv: ['set', '--no-decomposed-from'], expectSame: false },
];

interface Run {
  readonly code: number | null;
  readonly stdout: string;
}

function run(binary: string, argv: readonly string[]): Run {
  const result = spawnSync('node', [binary, ...argv], { input: BODY, encoding: 'utf8' });
  if (result.error !== undefined) throw result.error;
  return { code: result.status, stdout: result.stdout };
}

/**
 * Install the published version somewhere disposable and return its binary.
 *
 * INSTALL RATHER THAN `npm pack`. A packed tarball is the package's own files
 * and NONE of its dependencies, so the extracted binary cannot resolve
 * `@issuegraph/reader` and dies on startup — every case then "matches" every
 * other case, because two identical startup failures compare equal. Measured:
 * the first version of this script did exactly that and reported all 27 cases
 * as differing from a baseline that had never run. `npm install` resolves the
 * published dependency ranges, which is also the thing being tested.
 */
function fetchBaseline(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'issuegraph-compat-'));
  const installed = spawnSync(
    'npm',
    ['install', '--silent', '--no-audit', '--no-fund', '--prefix', dir, `@issuegraph/cli@${version}`],
    { encoding: 'utf8' },
  );
  if (installed.status !== 0) {
    throw new Error(`could not install @issuegraph/cli@${version}: ${installed.stderr.trim()}`);
  }
  return join(dir, 'node_modules', '@issuegraph', 'cli', 'dist', 'bin.js');
}

function main(): void {
  const baselineVersion = process.argv[2];
  if (baselineVersion === undefined) {
    console.error('usage: node scripts/check-cli-compat.ts <baseline-version>');
    console.error('  e.g. node scripts/check-cli-compat.ts 0.2.0');
    process.exitCode = 2;
    return;
  }

  const current = new URL('../packages/cli/dist/bin.js', import.meta.url).pathname;
  try {
    readFileSync(current);
  } catch {
    console.error(`compat: ${current} is missing — run \`pnpm run build\` first`);
    process.exitCode = 2;
    return;
  }

  const baseline = fetchBaseline(baselineVersion);

  let compared = 0;
  let unexpected = 0;
  const lines: string[] = [];

  for (const { label, argv, expectSame } of CASES) {
    const before = run(baseline, argv);
    const after = run(current, argv);

    // A LAUNCH FAILURE IS NOT A COMPARISON. Exit 127 on either side means the
    // binary never ran, and two identical non-runs compare equal — which is how
    // the hand-run version of this sweep once reported agreement on every case
    // while measuring nothing at all.
    if (before.code === 127 || after.code === 127) {
      lines.push(`  HARNESS-BROKEN  ${label} (a binary did not launch)`);
      unexpected += 1;
      continue;
    }

    compared += 1;
    const same = before.code === after.code && before.stdout === after.stdout;
    const asExpected = same === expectSame;
    if (!asExpected) unexpected += 1;
    lines.push(
      `  ${same ? 'same   ' : 'changed'} ${baselineVersion}=exit${String(before.code)} now=exit${String(after.code)}  ` +
        `${label.padEnd(38)} ${asExpected ? '' : '<-- UNEXPECTED'}`,
    );
  }

  console.log(`compat: @issuegraph/cli ${baselineVersion} vs this checkout\n`);
  for (const line of lines) console.log(line);

  const mustDiffer = CASES.filter((c) => !c.expectSame).length;
  console.log(
    `\ncompat: ${String(compared)} of ${String(CASES.length)} cases compared; ` +
      `${String(mustDiffer)} expected to differ.`,
  );

  // THE SELF-CHECK. Zero comparisons means the sweep proved nothing, and an
  // all-same run would be indistinguishable from a broken harness — so a run
  // that cannot tell the two apart is a failure, not a pass.
  if (compared === 0) {
    console.error('compat: nothing was compared — the sweep is broken, not the code');
    process.exitCode = 1;
    return;
  }
  if (unexpected > 0) {
    console.error(`compat: ${String(unexpected)} case(s) did not match their expectation`);
    process.exitCode = 1;
    return;
  }
  console.log('compat: every case behaved as this release claims.');
}

main();
