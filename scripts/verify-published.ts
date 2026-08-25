/**
 * The post-publish verification.
 *
 * Everything else in this repository looks at the workspace, or at a tarball
 * packed from it. This is the only instrument that asks what a CONSUMER
 * actually gets: it installs `@issuegraph/cli` from the registry into an empty
 * directory, imports it, and runs one real command.
 *
 * That is the gap [#36](https://github.com/autnmy/issuegraph/issues/36) fell
 * through. `@issuegraph/core` was published without the two predicates its
 * consumers import, so every fresh install threw on import and the binary exited
 * 1 on every invocation — while `ci.yml` stayed green, because inside the
 * workspace `workspace:^` always resolves to the local `core`. The failure only
 * exists once pnpm has rewritten the ranges at publish time, and nothing
 * installed the result.
 *
 * `check-publishable.ts` is the guard that stops that reaching the registry.
 * This is the one that confirms it did not, and it runs AFTER the upload because
 * that is the only time the question can be asked honestly. A publish is
 * irreversible, so this cannot prevent a bad release — what it does is make one
 * LOUD immediately rather than leaving it for the first consumer to discover.
 *
 * ## It asserts WHICH release it verified, which is the whole difficulty
 *
 * npm's registry is read through a CDN, so for a window after a successful
 * publish the old packument is still being served. That makes two opposite
 * mistakes available, and a naive version of this script makes both:
 *
 * - **A false GREEN.** Installing the bare name `@issuegraph/cli` resolves the
 *   `latest` tag. If propagation has not caught up, an OLDER and perfectly
 *   working CLI installs, imports and runs — and the check reports success
 *   having never exercised the release that just shipped. A control that passes
 *   without looking at its subject is the exact defect this whole change is
 *   about, so it must not be rebuilt here.
 * - **A false RED.** The CLI may install fine while a DEPENDENCY is still being
 *   served stale — for a `core`-only release, precisely the interesting case —
 *   and the import then fails for a release that was published correctly.
 *
 * Both are answered by the same thing: the workspace knows exactly which
 * versions this release intends, so the script reads them, installs the CLI
 * PINNED to its intended version, and compares every resolved `@issuegraph/*`
 * against what was intended.
 *
 * Retrying is then keyed on the DISTINCTION rather than on which call threw:
 * a tree that has not caught up yet is retried, and a tree that matches the
 * intended release but does not work fails IMMEDIATELY. Retrying the latter
 * would only wait for a broken release to look fixed.
 *
 * Run: `pnpm verify:published`. Exit 0 clean, 1 on a broken release.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const PACKAGE = '@issuegraph/cli';
const SCOPE = '@issuegraph/';

const PROPAGATION_ATTEMPTS = 6;
const RETRY_DELAY_MS = 15_000;

/** A package resolved in the consumer's tree, against what this release intends. */
export interface ResolvedPackage {
  readonly name: string;
  /** EVERY version present in the tree, since npm may nest more than one. */
  readonly resolved: readonly string[];
  readonly intended: string;
}

/**
 * The packages of which the tree carries a version this release does not intend.
 *
 * Takes ALL versions per package, not one. npm nests a second copy whenever two
 * branches need incompatible ranges, so a package can legitimately appear twice
 * at different versions — and collapsing that to a single value means whichever
 * copy is visited last wins. A STALE copy overwritten by an intended one leaves
 * this returning empty, and the import-and-run smoke below then reports a false
 * green while another code path still loads the stale one. That is a control
 * passing without looking at its subject, which is this whole change's subject.
 *
 * So a package is reported when ANY of its copies differs from the intended
 * version — not when the last one does.
 *
 * Pure, so the retry decision can be tested without a registry. Only packages
 * the workspace declares are judged: anything else in the tree is somebody
 * else's dependency and not this release's business.
 */
export function mismatches(
  resolved: Readonly<Record<string, readonly string[]>>,
  intended: Readonly<Record<string, string>>,
): readonly ResolvedPackage[] {
  const found: ResolvedPackage[] = [];
  for (const [name, versions] of Object.entries(resolved)) {
    const want = intended[name];
    if (want === undefined) continue;
    if (versions.some((version) => version !== want)) {
      found.push({ name, resolved: [...versions].sort(), intended: want });
    }
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function run(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const stderrOf = (error: unknown): string =>
  error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : String(error);

/** What this release intends: every publishable workspace package and its version. */
function intendedVersions(repoRoot: string): Readonly<Record<string, string>> {
  const packagesDir = join(repoRoot, 'packages');
  const intended: Record<string, string> = {};
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest: { name?: string; version?: string; private?: boolean };
    try {
      manifest = JSON.parse(readFileSync(join(packagesDir, entry.name, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const { name, version } = manifest;
    if (manifest.private === true || name === undefined || version === undefined) continue;
    intended[name] = version;
  }
  return intended;
}

/**
 * EVERY `@issuegraph/*` version in the installed tree, however deeply nested.
 *
 * A list per package, not a value: npm nests a second copy when two branches
 * need incompatible ranges, and keeping only one of them is how a stale copy
 * disappears behind an intended one. See `mismatches`.
 */
function resolvedVersions(cwd: string): Readonly<Record<string, readonly string[]>> {
  // `--all` because a stale dependency is the case that matters and it is NOT
  // at depth 0: for a `core`-only release the CLI sits at the top and `core` is
  // nested under `reader` and `writer`.
  //
  // `npm ls` exits non-zero on any tree it considers invalid while still
  // printing the JSON, so the status is deliberately ignored and the OUTPUT is
  // what gets parsed. Unparseable output is a different matter and throws, which
  // the caller turns into a failure rather than an empty all-clear.
  let raw: string;
  try {
    raw = run('npm', ['ls', '--all', '--json'], cwd);
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout ?? '') : '';
    if (stdout.trim() === '') throw error;
    raw = stdout;
  }
  const listed: unknown = JSON.parse(raw);
  const found: Record<string, string[]> = {};
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const dependencies = (node as { dependencies?: unknown }).dependencies;
    if (dependencies === null || typeof dependencies !== 'object') return;
    for (const [name, child] of Object.entries(dependencies as Record<string, unknown>)) {
      if (child !== null && typeof child === 'object') {
        const version = (child as { version?: unknown }).version;
        if (name.startsWith(SCOPE) && typeof version === 'string') {
          const seen = (found[name] ??= []);
          if (!seen.includes(version)) seen.push(version);
        }
        walk(child);
      }
    }
  };
  walk(listed);
  return found;
}

async function main(): Promise<number> {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const intended = intendedVersions(repoRoot);
  const cliVersion = intended[PACKAGE];
  if (cliVersion === undefined) {
    console.error(`FAILED: the workspace declares no ${PACKAGE}, so there is no release to verify.`);
    return 1;
  }

  // PINNED, never the bare name. A bare spec resolves the `latest` tag, and a
  // stale tag would install an older working CLI and report a false green.
  const spec = `${PACKAGE}@${cliVersion}`;
  console.log(`verifying ${spec}, expecting: ${Object.entries(intended).map(([n, v]) => `${n}@${v}`).join(', ')}`);

  for (let attempt = 1; attempt <= PROPAGATION_ATTEMPTS; attempt += 1) {
    const scratch = mkdtempSync(join(tmpdir(), 'issuegraph-verify-'));
    try {
      // An empty directory with no lockfile, no workspace and no link to this
      // checkout — the arrangement a consumer is actually in, and the one the
      // workspace can never reproduce. A FRESH directory per attempt, so a
      // retry cannot inherit the stale tree it is retrying because of.
      writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'verify-published', private: true }));

      try {
        // `--prefer-online` is what makes RETRYING mean anything. npm caches
        // packuments and revalidates them only when it decides they are stale,
        // so a first attempt that cached a stale packument would be served the
        // same answer from cache on every later attempt — the retries would burn
        // through, never see the propagation they are waiting for, and false-red
        // a release that published correctly. A fresh project directory does not
        // help: the cache is the runner's, not the directory's.
        run('npm', ['install', '--no-audit', '--no-fund', '--prefer-online', spec], scratch);
      } catch (error) {
        const detail = stderrOf(error);
        if (attempt === PROPAGATION_ATTEMPTS) {
          console.error(`FAILED to install ${spec} after ${attempt} attempts:\n${detail}`);
          return 1;
        }
        console.log(`attempt ${attempt}: install failed, the registry may not have propagated yet; retrying...`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // The tree must be the release this run intends BEFORE anything is
      // imported. Otherwise a failure below cannot be attributed: it could be a
      // broken release, or a perfectly good one the CDN has not served yet.
      const stale = mismatches(resolvedVersions(scratch), intended);
      if (stale.length > 0) {
        const summary = stale
          .map((p) => `${p.name}@${p.resolved.join('/')} (want ${p.intended})`)
          .join(', ');
        if (attempt === PROPAGATION_ATTEMPTS) {
          console.error(`FAILED: after ${attempt} attempts the registry still serves: ${summary}`);
          console.error('Either propagation is unusually slow, or these versions were never published.');
          return 1;
        }
        console.log(`attempt ${attempt}: registry has not caught up (${summary}); retrying...`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      console.log(`ok  installed the intended release into an empty directory`);

      // From here a failure is a REAL defect and is never retried — the tree is
      // exactly what this release published. Retrying now would only wait for a
      // broken release to look fixed.
      try {
        // The LIBRARY entry. #36 broke this and the binary together, but they
        // are separate surfaces and a consumer may use only one.
        run('node', ['--input-type=module', '-e', `await import(${JSON.stringify(PACKAGE)})`], scratch);
        console.log(`ok  import(${JSON.stringify(PACKAGE)}) resolved and evaluated`);

        // The BINARY, on the acceptance case #36 names: a body carrying no
        // block must parse and exit 0. This is what exited 1 on every call.
        writeFileSync(join(scratch, 'body.md'), 'a body with no issuegraph block\n');
        const parsed = run('sh', ['-c', './node_modules/.bin/issuegraph parse < body.md'], scratch);
        console.log(`ok  issuegraph parse exited 0: ${parsed.trim().replace(/\s+/g, ' ')}`);
      } catch (error) {
        console.error(`FAILED: the intended release installs but does not work for a consumer.`);
        console.error(stderrOf(error));
        console.error('This is what a fresh `npm install` gets. Treat it as a broken release.');
        return 1;
      }

      console.log(`\nverified: ${spec} installs, imports and runs from the registry.`);
      return 0;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  console.error(`FAILED: ${spec} could not be verified within ${PROPAGATION_ATTEMPTS} attempts.`);
  return 1;
}

// Only when run as a program. Importing this module — which the test does — must
// not reach the network or exit the process.
// Compared as REAL paths. A string-built `file://` URL misses when the path
// carries a space or is reached through a symlink — and a miss here is silent:
// the module would load, do nothing, and exit 0, so the guard would report a
// green having never run. That is the vacuous pass this whole change is about.
const invokedAs = process.argv[1] === undefined ? undefined : realpathSync(process.argv[1]);
if (invokedAs !== undefined && invokedAs === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(await main());
}
