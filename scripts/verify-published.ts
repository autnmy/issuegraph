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
 * Run: `pnpm verify:published [version]`. Exit 0 clean, 1 on a broken install.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKAGE = '@issuegraph/cli';

/**
 * npm's registry is read through a CDN, so a version can 404 for a short window
 * after a successful publish. Retrying an INSTALL is therefore legitimate — but
 * only the install: a package that installs and then fails to import is a real
 * defect, and retrying that would turn this into a check that waits for a
 * broken release to look fixed.
 */
const INSTALL_ATTEMPTS = 5;
const RETRY_DELAY_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function run(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main(): Promise<number> {
  const requested = process.argv[2];
  const spec = requested === undefined ? PACKAGE : `${PACKAGE}@${requested}`;
  const scratch = mkdtempSync(join(tmpdir(), 'issuegraph-verify-'));

  try {
    // An empty directory with no lockfile, no workspace and no link to this
    // checkout — the arrangement a consumer is actually in, and the one the
    // workspace can never reproduce.
    writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'verify-published', private: true }));

    let installed = false;
    for (let attempt = 1; attempt <= INSTALL_ATTEMPTS; attempt += 1) {
      try {
        run('npm', ['install', '--no-audit', '--no-fund', spec], scratch);
        installed = true;
        break;
      } catch (error) {
        const detail = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : String(error);
        if (attempt === INSTALL_ATTEMPTS) {
          console.error(`FAILED to install ${spec} after ${attempt} attempts:\n${detail}`);
          return 1;
        }
        console.log(`install attempt ${attempt} failed; the registry may not have propagated yet, retrying...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
    if (!installed) return 1;

    // `unknown` and narrowed, not annotated `string`: `npm ls` output is data
    // this script does not control, and a type annotation over `JSON.parse` is a
    // promise nothing checks.
    const listed: unknown = JSON.parse(run('npm', ['ls', PACKAGE, '--json', '--depth=0'], scratch));
    const resolved =
      listed !== null && typeof listed === 'object'
        ? (listed as { dependencies?: Record<string, { version?: unknown }> }).dependencies?.[PACKAGE]?.version
        : undefined;
    console.log(
      `installed ${PACKAGE}@${typeof resolved === 'string' ? resolved : 'unknown'} into an empty directory`,
    );

    // The LIBRARY entry. #36 broke this and the binary together, but they are
    // separate surfaces and a consumer may only use one.
    run('node', ['--input-type=module', '-e', `await import(${JSON.stringify(PACKAGE)})`], scratch);
    console.log(`ok  import(${JSON.stringify(PACKAGE)}) resolved and evaluated`);

    // The BINARY, on the acceptance case #36 names: a body carrying no block
    // must parse and exit 0. This is what exited 1 on every invocation.
    writeFileSync(join(scratch, 'body.md'), 'a body with no issuegraph block\n');
    const parsed = run('sh', ['-c', `./node_modules/.bin/issuegraph parse < body.md`], scratch);
    console.log(`ok  issuegraph parse exited 0: ${parsed.trim().replace(/\s+/g, ' ')}`);

    console.log(`\nverified: ${spec} installs, imports and runs from the registry.`);
    return 0;
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : String(error);
    console.error(`FAILED: ${spec} is installed but does not work for a consumer.\n${detail}`);
    console.error('This is what a fresh `npm install` gets. Treat it as a broken release.');
    return 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

process.exit(await main());
