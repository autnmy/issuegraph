/**
 * The post-publish verification.
 *
 * `check-publishable.ts` is the gate BEFORE an upload: it asks whether every
 * package can be released as it stands. This is its complement, and it asks the
 * one question nothing else in this repository asks — **does what actually went
 * up work when a consumer installs it?**
 *
 * Nothing else can answer it. `ci.yml` builds the workspace, where `workspace:^`
 * always resolves to the local package — the one arrangement that cannot fail —
 * and `smoke-consumer.mjs` loads `dist` through that same link. Both were green
 * throughout [#36](https://github.com/autnmy/issuegraph/issues/36), in which
 * every fresh `npm install @issuegraph/cli` threw on import and the binary
 * exited 1 on every invocation.
 *
 * It cannot PREVENT a bad release — a publish is irreversible, and npm does not
 * allow an unpublish after 72 hours. What it does is make one loud in the same
 * run, instead of leaving it for the first consumer to find.
 *
 * ## What "install from the registry" buys that a static check cannot
 *
 * This installs and LOADS rather than modelling, and that is the whole design.
 * A static model of what npm and Node do with a built package has to be kept
 * correct against two moving specifications; the failure is not that the model
 * is hard to write but that its surface is unbounded. Measured, on this
 * repository's own reviews: the static sweep in
 * [#4](https://github.com/autnmy/issuegraph/pull/4) drew 12 findings across 6
 * heads — extension rules, directory imports, both module systems' error
 * shapes, and JSX left untransformed, which TypeScript cannot report at all
 * because it reads `.js` as a JSX-capable variant. Every one of those is
 * answered here by construction, because the engine raises the error itself:
 *
 *   - the **packlist** — a `files` allowlist can omit a file the code imports,
 *     which no check reasoning about the package DIRECTORY can see;
 *   - **early errors** — `const x = 1; const x = 2;` is a duplicate lexical
 *     declaration, found at BINDING rather than parsing, so no static parser
 *     reports it and every engine rejects the module;
 *   - the **nearest package scope** — a file's module format comes from the
 *     closest `package.json`, not the root manifest.
 *
 * ## Retry means propagation, never "try until it looks fixed"
 *
 * A registry that has not caught up and a broken release are indistinguishable
 * from a single failed attempt, and conflating them makes the check useless in
 * both directions: retrying a defect just waits for a green that never comes,
 * and failing on propagation reds a healthy release. So the two are separated
 * on EVIDENCE rather than on timing — the resolved tree is compared against the
 * versions this workspace intends, and only a tree that has not caught up is
 * retried. A tree that matches the intended release and STILL fails is a defect
 * and is reported immediately.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Reused rather than reimplemented: its E404-is-definitive handling and its
// `--prefer-online` rationale are exactly what this needs, and a second copy of
// those semantics is a second place for them to drift.
import { registryVersions } from './check-publishable.ts';

/** The scope every package this repository publishes lives under. */
export const WORKSPACE_SCOPE = '@issuegraph/';

/** A package this workspace intends to publish, at the version it intends. */
export interface IntendedPackage {
  readonly name: string;
  readonly version: string;
}

/**
 * One resolved copy of a package in an installed tree.
 *
 * `path` is the dependency chain that reaches it — `@issuegraph/cli >
 * @issuegraph/reader > @issuegraph/core` — because a mismatch a consumer hits
 * is only actionable if you know WHICH branch resolves the stale copy.
 */
export interface Instance {
  readonly name: string;
  readonly version: string;
  readonly path: string;
}

export type TreeVerdict =
  /** Every intended package is present, at the intended version, in every copy. */
  | { readonly kind: 'match' }
  /**
   * At least one copy is at a version other than the intended one. RETRYABLE:
   * this is what a registry that has not caught up looks like.
   */
  | { readonly kind: 'propagating'; readonly stale: readonly Instance[] }
  /**
   * The install succeeded and the tree still does not carry a package at all.
   * NOT retryable — waiting does not add a package to a tree npm already built.
   */
  | { readonly kind: 'absent'; readonly names: readonly string[] };

/**
 * Every package this workspace would publish, at the version it would publish.
 *
 * The whole publishable set, NOT the CLI's dependency graph. `@issuegraph/store`
 * and `@issuegraph/viewer` are not CLI dependencies, so a store-only release
 * verified through the CLI would install an unchanged CLI, see no mismatch for
 * the absent store, and report success — the requirement #37's implementation
 * did not solve, and the immediate reason this was split out of it.
 *
 * `private: true` is the one exclusion, because a private package is never
 * uploaded and asking the registry for it would fail forever.
 */
export function intendedPackages(packagesDir: string): readonly IntendedPackage[] {
  const intended: IntendedPackage[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, 'package.json');
    try {
      statSync(manifestPath);
    } catch {
      continue;
    }
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') continue;
    const { name, version, private: isPrivate } = parsed as Record<string, unknown>;
    if (isPrivate === true) continue;
    if (typeof name !== 'string' || typeof version !== 'string') continue;
    intended.push({ name, version });
  }
  return intended;
}

/**
 * EVERY copy of every scope package in a resolved tree, not one per name.
 *
 * npm nests a second copy when two branches need incompatible ranges, so a
 * name-keyed map is last-write-wins: a stale copy vanishes behind an intended
 * one and the check passes while a real code path still loads the stale copy.
 * An array cannot lose one.
 *
 * Termination is by ANCESTOR IDENTITY — a node already open on the current
 * branch is recorded but not descended into. Keying a `seen` set on the
 * dependency path instead cannot work, and the failure is not subtle: every
 * recursion builds a LONGER path, so the key never repeats and the walk
 * recurses until the stack overflows. Measured, by the test that asserts this.
 *
 * `JSON.parse` cannot produce a cycle, so real `npm ls` output never exercises
 * it. It is here because this function is exported and takes `unknown`, and
 * because an unbounded recursion is a far worse way to learn that than a
 * three-line guard.
 */
export function collectInstances(tree: unknown): readonly Instance[] {
  const found: Instance[] = [];

  const walk = (node: unknown, path: readonly string[], ancestors: ReadonlySet<object>): void => {
    if (node === null || typeof node !== 'object') return;
    const dependencies = (node as { readonly dependencies?: unknown }).dependencies;
    if (dependencies === null || typeof dependencies !== 'object') return;
    const open = new Set(ancestors).add(node);

    for (const [name, child] of Object.entries(dependencies as Record<string, unknown>)) {
      const here = [...path, name];
      const key = here.join(' > ');

      if (name.startsWith(WORKSPACE_SCOPE)) {
        const version =
          child !== null && typeof child === 'object'
            ? (child as { readonly version?: unknown }).version
            : undefined;
        found.push({
          name,
          // A node npm could not resolve carries no version. Recorded as the
          // literal `<unresolved>` rather than skipped: it is never equal to an
          // intended version, so it surfaces as a mismatch instead of vanishing.
          version: typeof version === 'string' ? version : '<unresolved>',
          path: key,
        });
      }
      // Recorded above either way; only the DESCENT is skipped, so a cycle
      // still reports the copy it reaches rather than silently dropping it.
      if (typeof child === 'object' && child !== null && open.has(child)) continue;
      walk(child, here, open);
    }
  };

  walk(tree, [], new Set());
  return found;
}

/**
 * What an installed tree says about the release, judged against what this
 * workspace intends.
 *
 * The ORDER of the two tests is the retry policy. A stale copy is reported as
 * propagation and retried; a package missing from a tree npm has already built
 * is reported as absent and is NOT retried, because no amount of waiting adds
 * it. Reversing them would make a store-only release — where the store is
 * absent rather than stale — burn every attempt before failing.
 */
export function reconcile(instances: readonly Instance[], intended: readonly IntendedPackage[]): TreeVerdict {
  const wanted = new Map(intended.map((p) => [p.name, p.version]));

  const stale = instances.filter((instance) => {
    const want = wanted.get(instance.name);
    return want !== undefined && instance.version !== want;
  });
  if (stale.length > 0) return { kind: 'propagating', stale };

  const present = new Set(instances.map((i) => i.name));
  const names = intended.map((p) => p.name).filter((name) => !present.has(name));
  if (names.length > 0) return { kind: 'absent', names };

  return { kind: 'match' };
}

/** The `name@version` specs to install, pinned. */
export function pinnedSpecs(intended: readonly IntendedPackage[]): readonly string[] {
  // Never the bare name: it resolves the `latest` tag, so a stale tag installs
  // an OLDER WORKING package and reports a false green having never exercised
  // the release that just shipped.
  return intended.map((p) => `${p.name}@${p.version}`);
}

/** What a registry lookup can answer for one package. */
export type VersionLookup = (name: string) => readonly string[] | { readonly unreachable: string };

export interface RegistryStanding {
  /** `name@version` specs the registry does not yet carry. */
  readonly missing: readonly string[];
  /** Packages the registry could not be asked about at all. */
  readonly unreachable: readonly string[];
}

/**
 * Which intended versions the registry does not yet carry.
 *
 * This exists because npm's install failure does not say. Its last stderr line
 * is the debug-log path, so the operator is told a release failed and given a
 * file name — measured, on this repository's own packages: a run whose only
 * problem was an unpublished `@issuegraph/viewer` reported
 * `A complete log of this run can be found in: …`, five times, and never named
 * the package once.
 *
 * Asking the registry is STRUCTURAL where parsing that output is not, and it
 * buys a second thing worth more than the message: it separates the two
 * failures npm reports identically. If the registry is missing a version, the
 * install failed because propagation has not caught up, and retrying is right.
 * If the registry carries EVERY intended version and the install still failed,
 * nothing is propagating — that is a defect, and retrying only waits for a
 * broken release to start looking fixed.
 *
 * The lookup is injected rather than called directly so this decision is
 * testable without a network.
 */
export function registryStanding(intended: readonly IntendedPackage[], lookup: VersionLookup): RegistryStanding {
  const missing: string[] = [];
  const unreachable: string[] = [];
  for (const { name, version } of intended) {
    const versions = lookup(name);
    // An unreachable registry is NEITHER present nor missing. Folding it into
    // `missing` would report a network blip as an unpublished package; folding
    // it into present would clear a release nobody could verify.
    if (!Array.isArray(versions)) unreachable.push(name);
    else if (!versions.includes(version)) missing.push(`${name}@${version}`);
  }
  return { missing, unreachable };
}

/** One package's result from the consumer-side load probe. */
export interface ProbeResult {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Whether the probe results and the CLI run together clear the release.
 *
 * Separated from the running so the decision is testable offline — the halves
 * that can only be exercised against a real registry are the ones this file
 * keeps smallest.
 */
export function acceptanceFailures(
  probes: readonly ProbeResult[],
  cli: { readonly ok: boolean; readonly detail: string },
): readonly string[] {
  const failures = probes.filter((p) => !p.ok).map((p) => `${p.name} does not import: ${p.error ?? 'unknown'}`);
  return cli.ok ? failures : [...failures, `issuegraph parse: ${cli.detail}`];
}

const run = (command: string, args: readonly string[], cwd: string): string =>
  execFileSync(command, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * The resolved tree, read from `npm ls` OUTPUT rather than its exit status.
 *
 * `npm ls` exits non-zero for trees it merely dislikes — an unmet peer, an
 * extraneous package — while still printing complete JSON. Reading the status
 * would throw away the answer in exactly the cases worth inspecting, so the
 * stdout carried on the thrown error is used just as the successful stdout is.
 */
function resolvedTree(cwd: string): unknown {
  let output: string;
  try {
    output = run('npm', ['ls', '--all', '--json'], cwd);
  } catch (error) {
    const stdout = error !== null && typeof error === 'object' ? (error as { stdout?: unknown }).stdout : undefined;
    if (typeof stdout !== 'string' || stdout.trim() === '') throw error;
    output = stdout;
  }
  return JSON.parse(output);
}

/**
 * Import every published package by NAME, from inside the installed project.
 *
 * Written to a file rather than passed to `node -e`, so every specifier
 * resolves from the project directory the way a consumer's own module does.
 * Each import is caught individually: one broken package must report itself
 * rather than hiding the state of the other six.
 */
function probeImports(projectDir: string, intended: readonly IntendedPackage[]): readonly ProbeResult[] {
  const probe = join(projectDir, 'probe.mjs');
  const names = JSON.stringify(intended.map((p) => p.name));
  writeFileSync(
    probe,
    `const results = [];\n` +
      `for (const name of ${names}) {\n` +
      `  try { await import(name); results.push({ name, ok: true }); }\n` +
      `  catch (error) { results.push({ name, ok: false, error: String(error?.message ?? error).split('\\n')[0] }); }\n` +
      `}\n` +
      `process.stdout.write(JSON.stringify(results));\n`,
  );
  const parsed: unknown = JSON.parse(run('node', [probe], projectDir));
  return Array.isArray(parsed) ? (parsed as readonly ProbeResult[]) : [];
}

/**
 * #36's own acceptance case: `issuegraph parse` on a body with no block.
 *
 * Both surfaces that incident broke — the library import above and the binary —
 * so a check that only imported would have reported a green on the release that
 * made every invocation exit 1.
 */
function runCli(projectDir: string): { readonly ok: boolean; readonly detail: string } {
  const bin = join(projectDir, 'node_modules', '.bin', 'issuegraph');
  try {
    const stdout = execFileSync(bin, ['parse'], {
      cwd: projectDir,
      encoding: 'utf8',
      input: 'Just prose, with no issuegraph block in it.\n',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed: unknown = JSON.parse(stdout);
    const state =
      parsed !== null && typeof parsed === 'object' ? (parsed as { readonly state?: unknown }).state : undefined;
    if (state !== 'absent') return { ok: false, detail: `exited 0 but reported state ${JSON.stringify(state)}` };
    return { ok: true, detail: 'exit 0, state absent' };
  } catch (error) {
    const status = error !== null && typeof error === 'object' ? (error as { status?: unknown }).status : undefined;
    const stderr = error !== null && typeof error === 'object' ? (error as { stderr?: unknown }).stderr : undefined;
    const first = String(stderr ?? error)
      .trim()
      .split('\n')[0];
    return { ok: false, detail: `exited ${String(status ?? 'abnormally')}: ${first ?? 'no output'}` };
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attempts, and the wait before each retry.
 *
 * Sized against npm's OWN stated latency, not a guess: a publish prints
 * `Your package is being processed and may take a few minutes to become
 * available`, and that is the wait this has to cover. Measured on the release
 * that first published `@issuegraph/viewer` — `reader@0.2.1` was queryable
 * immediately while `derive@0.1.1` and `viewer@0.1.0` were not, so the lag is
 * per package rather than per release and a budget that covers the fastest one
 * reds a healthy release.
 *
 * The earlier 5 x 10s was 40 seconds against a documented few minutes, and it
 * failed exactly that way on a release where all three packages had in fact
 * uploaded. Failing a good release is the expensive direction here: the upload
 * is irreversible, so a false red is investigated by hand while the packages
 * are already public.
 */
const ATTEMPTS = 10;
const BACKOFF_MS = 30_000;

async function main(): Promise<number> {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const intended = intendedPackages(join(repoRoot, 'packages'));

  if (intended.length === 0) {
    console.error('verify-published: found no publishable package, so this check would pass vacuously.');
    return 1;
  }

  const specs = pinnedSpecs(intended);
  console.log(`verifying ${intended.length} published package(s):`);
  for (const spec of specs) console.log(`  ${spec}`);

  const projectDir = mkdtempSync(join(tmpdir(), 'issuegraph-verify-'));
  try {
    // An empty project, not this repository: a consumer has no workspace, no
    // lockfile and no `workspace:` link, and installing anywhere inside the
    // repo would quietly resolve through one of them.
    writeFileSync(
      join(projectDir, 'package.json'),
      `${JSON.stringify({ name: 'issuegraph-verify-consumer', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`,
    );

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      let installFailure: string | undefined;
      try {
        // `--prefer-online` or the retries are theatre: a fresh project
        // directory does not defeat the runner's npm cache, so a first attempt
        // that cached a stale packument is served the same answer on every
        // retry, burning the attempts without ever observing propagation.
        run('npm', ['install', ...specs, '--prefer-online', '--no-audit', '--no-fund'], projectDir);
      } catch (error) {
        const stderr = error !== null && typeof error === 'object' ? (error as { stderr?: unknown }).stderr : undefined;
        installFailure = String(stderr ?? error).trim().split('\n').slice(-1)[0] ?? 'unknown install failure';
      }

      // WHY the install failed is asked of the REGISTRY, not of npm's output.
      // A missing version is propagation and is retried; every version present
      // and the install still failing is a defect, and retrying it just waits
      // for a broken release to start looking fixed.
      let installDiagnosis: { readonly retry: boolean; readonly why: string } | undefined;
      if (installFailure !== undefined) {
        const standing = registryStanding(intended, (name) => registryVersions(name, projectDir));
        if (standing.missing.length > 0) {
          installDiagnosis = { retry: true, why: `the registry does not yet carry ${standing.missing.join(', ')}` };
        } else if (standing.unreachable.length > 0) {
          installDiagnosis = { retry: true, why: `could not reach the registry for ${standing.unreachable.join(', ')}` };
        } else {
          installDiagnosis = {
            retry: false,
            why: `the registry carries every intended version, so this is not propagation: ${installFailure}`,
          };
        }
      }

      if (installDiagnosis?.retry === false) {
        console.error('\nverify-published: the install failed for a reason that is not propagation.');
        console.error(`      ${installDiagnosis.why}`);
        return 1;
      }

      const verdict: TreeVerdict =
        installDiagnosis === undefined
          ? reconcile(collectInstances(resolvedTree(projectDir)), intended)
          : { kind: 'propagating', stale: [] };

      if (verdict.kind === 'propagating') {
        const why =
          installDiagnosis?.why ??
          verdict.stale.map((i) => `${i.path} is ${i.version}`).join('; ');
        if (attempt === ATTEMPTS) {
          console.error(`\nverify-published: the registry never caught up after ${ATTEMPTS} attempts.`);
          console.error(`      last: ${why}`);
          console.error('      Treated as a failure: an unanswered question is not an all-clear.');
          return 1;
        }
        console.log(`  attempt ${attempt}/${ATTEMPTS}: not yet propagated (${why}); retrying`);
        await delay(BACKOFF_MS);
        continue;
      }

      if (verdict.kind === 'absent') {
        // NOT retried. The install succeeded, so npm built a tree it considers
        // complete; a package missing from it is a defect in what was published,
        // and waiting does not add it.
        console.error(`\nverify-published: the installed tree does not carry ${verdict.names.join(', ')}.`);
        console.error('      The install succeeded, so this is the release, not propagation.');
        return 1;
      }

      // The tree matches the intended release. From here a failure is a DEFECT
      // and is reported immediately — retrying would just wait for a broken
      // release to start looking fixed.
      const probes = probeImports(projectDir, intended);
      const cli = runCli(projectDir);
      const failures = acceptanceFailures(probes, cli);

      if (failures.length > 0) {
        console.error('\nverify-published: the published packages resolve, but do not work.');
        for (const failure of failures) console.error(`      ${failure}`);
        console.error('      The resolved tree matches the intended release, so this is NOT propagation.');
        return 1;
      }

      console.log(`\nverified: ${intended.length} package(s) installed from the registry, imported, and \`issuegraph parse\` ${cli.detail}.`);
      return 0;
    }

    return 1;
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

// Only when run as a program. Importing this module — which the test does — must
// not reach the network or exit the process. Compared as REAL paths, because a
// string-built `file://` URL misses when the path carries a space or is reached
// through a symlink, and a miss is silent: the module would load, do nothing,
// and exit 0, reporting a green having never run.
const invokedAs = process.argv[1] === undefined ? undefined : realpathSync(process.argv[1]);
if (invokedAs !== undefined && invokedAs === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(await main());
}
