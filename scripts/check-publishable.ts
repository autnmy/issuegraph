/**
 * The publish-staleness guard.
 *
 * `pnpm publish --recursive` publishes a package only when its version is not
 * already on the registry. A package whose CONTENT changed while its VERSION
 * did not is therefore SKIPPED — silently, at exit 0, with a summary that says
 * the release succeeded. Nothing was wrong with the release; the package simply
 * was not in it.
 *
 * That is not a hypothetical. `@issuegraph/core` gained `isRefId` and
 * `isRepoQualifier` in #25 without a version bump, so the next release skipped
 * it and published `@issuegraph/reader@0.2.0` and `@issuegraph/writer@0.1.0` —
 * both of which IMPORT those two names, and both of which pnpm had rewritten to
 * depend on `@issuegraph/core@^0.1.0`, the stale tarball. Every fresh install of
 * `@issuegraph/cli` then threw on import and the binary exited 1 on every
 * invocation ([#36](https://github.com/autnmy/issuegraph/issues/36)).
 *
 * The reason it reached the registry unnoticed is that nothing compared what was
 * about to be published against what already had been. `ci.yml` builds and tests
 * the workspace, where `workspace:^` always resolves to the LOCAL `core` — the
 * one configuration that cannot fail. `smoke-consumer.mjs` loads `dist`, but it
 * loads it through that same workspace link. Both are green in precisely the
 * arrangement no consumer ever gets.
 *
 * So this asks the one question neither of them can: **for every package whose
 * version is already published, is the content identical?** If it is, the
 * release will skip it and nothing is lost. If it is not, the version must be
 * bumped or the change never ships, and the guard says so before the release
 * rather than after.
 *
 * ## Two questions, because one of them opens a hole the other closes
 *
 * **Staleness** — did a package's AUTHORED content change while its version did
 * not? That is #36 exactly, and a bump is the answer.
 *
 * Sibling `@issuegraph/*` ranges are excluded from that comparison, because they
 * are not authored: pnpm derives them from the sibling's version at pack time,
 * so bumping ONE package rewrites the manifest of every package that depends on
 * it. Measured — bumping `core` to `0.1.1` made `cli`, `reader`, `store` and
 * `writer` all differ from their published tarballs, at nothing but `^0.1.0` →
 * `^0.1.1`. Blocking a release on that is a false positive on a correct tree,
 * and a guard that cries wolf is a guard somebody switches off.
 *
 * **Resolvability** — closes the hole that exclusion opens, and is not a bonus
 * check. Not every range change is harmless: a published consumer that is NOT
 * being republished keeps the range it already carries, so the question is
 * whether that range still admits the version this release puts on the registry.
 * `^0.1.0` admits `0.1.1`, which is why a PATCH bump of `core` repairs every
 * already-published consumer without touching one. `^0.1.0` does NOT admit
 * `0.2.0` — a caret pins the minor on a `0.x` version — so a minor bump would
 * leave every published consumer resolving the OLD `core` and reproduce #36
 * while looking like its fix. Excluding the ranges without asking this would
 * make that invisible.
 *
 * ## What it deliberately does NOT do
 *
 * It does not pack every package, install the tarballs into a scratch directory
 * and import them. That control was the obvious candidate and it does not work:
 * the locally packed `core` satisfies the rewritten `^0.1.0` range, so the stale
 * PUBLISHED tarball is never fetched and the import succeeds. Measured against
 * the broken tree — it passed. A control that passes on the defect it was added
 * for is decoration.
 *
 * The complement — installing from the registry AFTER a release and importing
 * what a consumer actually gets — is a different instrument and lives in
 * `publish.yml`, where it can run against the thing that was really uploaded.
 *
 * ## Absence is proven, never inferred
 *
 * A version missing from the registry is a definitive answer and a fine one: it
 * is a new version and the release will publish it. A registry that cannot be
 * REACHED is not that answer. Reading a transport failure as "not published"
 * would wave through exactly the change this guard exists to stop, at the moment
 * the network is the reason nobody can see the conflict — so an unreachable
 * registry fails closed and says which package it could not resolve.
 *
 * Run: `pnpm check:publishable`. Exit 0 clean, 1 with findings. Needs network.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/**
 * A package's standing against the registry.
 *
 * `unknown` is a first-class member rather than an error thrown past the
 * reporting layer: it is the verdict for "the question could not be answered",
 * and it has to be as visible as a failure because it fails closed like one.
 */
export type PublishStanding =
  | { readonly kind: 'new' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'stale'; readonly differences: readonly string[] }
  | { readonly kind: 'unknown'; readonly reason: string };

/** One package's verdict, named well enough to act on without searching. */
export interface PackageFinding {
  readonly name: string;
  readonly version: string;
  readonly standing: PublishStanding;
}

/**
 * A published consumer whose recorded range would stop admitting a sibling once
 * this release lands, so it must be bumped and republished alongside it.
 */
export interface ResolvabilityFinding {
  /** The already-published package carrying the range. */
  readonly consumer: string;
  readonly consumerVersion: string;
  readonly dependency: string;
  /** The range as the PUBLISHED manifest records it — not the local one. */
  readonly range: string;
  /** The version this release would put on the registry. */
  readonly releasing: string;
  /** Absent when the range shape is one this guard declines to judge. */
  readonly admits: boolean | undefined;
}

/** The name every package in this workspace shares, so siblings are nameable. */
export const WORKSPACE_SCOPE = '@issuegraph/';

/** A packed tarball's payload: the path inside `package/`, and its bytes. */
export type TarballContents = ReadonlyMap<string, Buffer>;

/**
 * `package.json` is compared as MEANING, not as bytes.
 *
 * pnpm rewrites `workspace:^` into a concrete range at pack time, and the key
 * order it emits is not the order the published manifest carries. Measured on
 * `@issuegraph/cli@0.1.0`: the local pack and the published tarball differ ONLY
 * in the order of the `dependencies` keys — same names, same ranges. A raw byte
 * comparison reports that as a stale package, which is a false positive on a
 * release that is perfectly correct.
 *
 * That matters more than the noise it makes. This guard's verdict blocks a
 * release, so a check that cries wolf on a healthy tree is a check somebody
 * switches off — and then the real defect ships. Sorting keys throws away
 * ordering and nothing else: every name and every value survives, so a genuine
 * manifest change is still a difference.
 */
export function normalizeManifest(text: string): string {
  const sortDeep = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]));
    }
    return value;
  };

  const parsed: unknown = JSON.parse(text);
  const manifest = parsed !== null && typeof parsed === 'object' ? { ...(parsed as Record<string, unknown>) } : parsed;

  // Sibling ranges are DERIVED, not authored — pnpm rewrites `workspace:^` from
  // the sibling's version at pack time — so they are blanked rather than
  // compared. Blanked, not deleted: a sibling dependency that was ADDED or
  // REMOVED is an authored change and must still show up as a difference, which
  // deleting the key would hide.
  if (manifest !== null && typeof manifest === 'object') {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const block = (manifest as Record<string, unknown>)[field];
      if (block === null || typeof block !== 'object') continue;
      const rewritten = Object.fromEntries(
        Object.entries(block as Record<string, unknown>).map(([name, range]) => [
          name,
          name.startsWith(WORKSPACE_SCOPE) ? '<workspace-derived>' : range,
        ]),
      );
      (manifest as Record<string, unknown>)[field] = rewritten;
    }
  }
  return JSON.stringify(sortDeep(manifest));
}

/**
 * Whether `range` admits `version`, or `undefined` when the shape is one this
 * guard declines to judge.
 *
 * An ALLOWLIST of two shapes — an exact version and a caret — not a general
 * semver implementation, and not a denylist of shapes to reject. pnpm emits
 * exactly `^X.Y.Z` from `workspace:^`, so that is the population this actually
 * meets; anything else returns `undefined`, which the caller reports and fails
 * closed on. A hand-rolled parser for the full grammar would grow a defect per
 * range shape, and a wrong ADMITS is the answer that ships the bug.
 *
 * The caret rule is the whole point of the check: on a `0.x` version a caret
 * pins the MINOR, so `^0.1.0` admits `0.1.1` but not `0.2.0`. That single line
 * is why #36's fix is a patch bump and why a minor one would have reproduced it.
 */
export function admitsVersion(range: string, version: string): boolean | undefined {
  const parse = (text: string): readonly [number, number, number] | undefined => {
    const found = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
    if (found === null) return undefined;
    const [major, minor, patch] = [found[1], found[2], found[3]].map((part) => Number(part));
    if (major === undefined || minor === undefined || patch === undefined) return undefined;
    return [major, minor, patch];
  };

  const target = parse(version);
  if (target === undefined) return undefined;

  const exact = parse(range);
  if (exact !== undefined) return exact[0] === target[0] && exact[1] === target[1] && exact[2] === target[2];

  if (!range.startsWith('^')) return undefined;
  const floor = parse(range.slice(1));
  if (floor === undefined) return undefined;

  const [fMajor, fMinor, fPatch] = floor;
  const [tMajor, tMinor, tPatch] = target;
  const atOrAbove =
    tMajor > fMajor ||
    (tMajor === fMajor && (tMinor > fMinor || (tMinor === fMinor && tPatch >= fPatch)));
  if (!atOrAbove) return false;

  // The ceiling moves to the leftmost NON-ZERO part, which is what makes a
  // caret stricter on `0.x` than on `1.x`.
  if (fMajor > 0) return tMajor === fMajor;
  if (fMinor > 0) return tMajor === 0 && tMinor === fMinor;
  return tMajor === 0 && tMinor === 0 && tPatch === fPatch;
}

/**
 * The published consumers this release would strand.
 *
 * Asked of the PUBLISHED manifests, because a consumer that is not being
 * republished keeps the range it already carries — the local manifest's range is
 * the one that will not ship. A consumer that IS being republished is skipped:
 * its new manifest goes up with the release, so its old range stops mattering.
 */
export function unresolvableConsumers(
  published: readonly {
    readonly name: string;
    readonly version: string;
    readonly dependencies: Readonly<Record<string, string>>;
  }[],
  releasing: Readonly<Record<string, string>>,
): readonly ResolvabilityFinding[] {
  const findings: ResolvabilityFinding[] = [];
  for (const consumer of published) {
    if (Object.prototype.hasOwnProperty.call(releasing, consumer.name)) continue;
    for (const [dependency, range] of Object.entries(consumer.dependencies)) {
      if (!dependency.startsWith(WORKSPACE_SCOPE)) continue;
      const version = releasing[dependency];
      if (version === undefined) continue;
      const admits = admitsVersion(range, version);
      if (admits !== true) {
        findings.push({
          consumer: consumer.name,
          consumerVersion: consumer.version,
          dependency,
          range,
          releasing: version,
          admits,
        });
      }
    }
  }
  return findings;
}

/**
 * The paths at which two packed payloads differ, as a sorted list.
 *
 * Every path is compared: `dist`, the manifest, the README, the LICENSE. A
 * sourcemap is NOT excused — it carries `sourcesContent`, so a change visible
 * only there is still a change to what a consumer downloads. Reproducibility is
 * not assumed either; it is measured, and it holds: four of this workspace's six
 * packages pack byte-identically to tarballs GitHub Actions published, which is
 * what makes a byte comparison the right instrument for everything except the
 * manifest.
 */
export function diffTarballContents(local: TarballContents, published: TarballContents): readonly string[] {
  const differences: string[] = [];
  const paths = new Set([...local.keys(), ...published.keys()]);
  for (const path of [...paths].sort()) {
    const a = local.get(path);
    const b = published.get(path);
    if (a === undefined) {
      differences.push(`${path} (only in the published tarball)`);
      continue;
    }
    if (b === undefined) {
      differences.push(`${path} (only in the local pack)`);
      continue;
    }
    if (path === 'package.json') {
      if (normalizeManifest(a.toString('utf8')) !== normalizeManifest(b.toString('utf8'))) {
        differences.push(`${path} (manifest content differs)`);
      }
      continue;
    }
    if (!a.equals(b)) differences.push(path);
  }
  return differences;
}

/**
 * The verdict for one package, given what the registry knows and — only when it
 * knows this version — the two payloads.
 *
 * Pure, and separated from the packing and fetching so the decision can be
 * tested without a network or a tarball. The shell below is what turns a
 * registry into these arguments.
 */
export function standingFor(
  versions: readonly string[] | { readonly unreachable: string },
  version: string,
  payloads: { readonly local: TarballContents; readonly published: TarballContents } | undefined,
): PublishStanding {
  if (!Array.isArray(versions)) {
    return { kind: 'unknown', reason: (versions as { readonly unreachable: string }).unreachable };
  }
  if (!versions.includes(version)) return { kind: 'new' };
  if (payloads === undefined) {
    return { kind: 'unknown', reason: `${version} is published but its tarball could not be read` };
  }
  const differences = diffTarballContents(payloads.local, payloads.published);
  return differences.length === 0 ? { kind: 'unchanged' } : { kind: 'stale', differences };
}

/** Whether a finding should fail the run. `new` and `unchanged` are both fine. */
export function isBlocking(finding: PackageFinding): boolean {
  return finding.standing.kind === 'stale' || finding.standing.kind === 'unknown';
}

/* ------------------------------------------------------------------------- */
/* The imperative shell: packing, fetching, reporting.                        */
/* ------------------------------------------------------------------------- */

interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
}

const run = (command: string, args: readonly string[], cwd: string): string =>
  execFileSync(command, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Every file under `package/` in a tarball, keyed by its path within it. */
function readTarball(tarball: string): TarballContents {
  const extracted = mkdtempSync(join(tmpdir(), 'issuegraph-pack-'));
  try {
    run('tar', ['-xzf', tarball, '-C', extracted], extracted);
    const root = join(extracted, 'package');
    const contents = new Map<string, Buffer>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) contents.set(relative(root, full).split(sep).join('/'), readFileSync(full));
      }
    };
    walk(root);
    return contents;
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}

/**
 * The versions the registry holds for a package.
 *
 * Membership in a fetched list is a DEFINITIVE answer for every version at once,
 * which is why the whole list is asked for rather than probing one version. A
 * per-version probe has to read a 404 as absence, and a 404 and a proxy error
 * are not always distinguishable from the outside.
 *
 * `E404` on the package itself IS definitive — nothing under that name has ever
 * been published — so it yields an empty list rather than an unknown. It is
 * matched as npm's own error CODE, which npm prints unlocalized, and not as
 * prose.
 */
function registryVersions(name: string, cwd: string): readonly string[] | { readonly unreachable: string } {
  try {
    const parsed: unknown = JSON.parse(run('npm', ['view', name, 'versions', '--json'], cwd));
    if (typeof parsed === 'string') return [parsed];
    if (Array.isArray(parsed) && parsed.every((v): v is string => typeof v === 'string')) return parsed;
    return { unreachable: `npm view ${name} returned a version list this guard could not read` };
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : String(error);
    if (detail.includes('E404')) return [];
    return { unreachable: `npm view ${name} failed: ${detail.trim().split('\n').slice(-1)[0] ?? 'unknown error'}` };
  }
}

/** The `dependencies` block a published manifest records, as plain strings. */
function publishedDependencies(contents: TarballContents): Readonly<Record<string, string>> {
  const manifest = contents.get('package.json');
  if (manifest === undefined) return {};
  const parsed: unknown = JSON.parse(manifest.toString('utf8'));
  const block =
    parsed !== null && typeof parsed === 'object'
      ? (parsed as { readonly dependencies?: unknown }).dependencies
      : undefined;
  if (block === null || typeof block !== 'object') return {};
  return Object.fromEntries(
    Object.entries(block as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function main(): number {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const packagesDir = join(repoRoot, 'packages');
  const scratch = mkdtempSync(join(tmpdir(), 'issuegraph-publishable-'));
  const findings: PackageFinding[] = [];
  const publishedManifests: { name: string; version: string; dependencies: Readonly<Record<string, string>> }[] = [];
  const releasing: Record<string, string> = {};

  try {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(packagesDir, entry.name);
      const manifestPath = join(dir, 'package.json');
      try {
        statSync(manifestPath);
      } catch {
        continue;
      }
      const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const { name, version } = manifest;
      if (manifest.private === true || name === undefined || version === undefined) continue;

      const versions = registryVersions(name, repoRoot);
      let payloads: { local: TarballContents; published: TarballContents } | undefined;

      if (Array.isArray(versions) && versions.includes(version)) {
        try {
          // `pnpm pack`, not `npm pack`: only pnpm rewrites `workspace:^` into
          // the concrete range the published manifest carries, so `npm pack`
          // would compare a manifest no release ever produces.
          const localDir = mkdtempSync(join(scratch, 'local-'));
          run('pnpm', ['pack', '--pack-destination', localDir], dir);
          const publishedDir = mkdtempSync(join(scratch, 'published-'));
          run('npm', ['pack', `${name}@${version}`, '--pack-destination', publishedDir], repoRoot);
          const only = (d: string): string => {
            const files = readdirSync(d).filter((f) => f.endsWith('.tgz'));
            const first = files[0];
            if (files.length !== 1 || first === undefined) {
              throw new Error(`expected exactly one tarball in ${d}, found ${files.length}`);
            }
            return join(d, first);
          };
          payloads = { local: readTarball(only(localDir)), published: readTarball(only(publishedDir)) };
        } catch (error) {
          payloads = undefined;
          void error;
        }
      }

      const standing = standingFor(versions, version, payloads);
      findings.push({ name, version, standing });

      // What this release will actually upload: a version not on the registry.
      // An `unchanged` package is skipped by pnpm, so it puts nothing new up and
      // cannot strand anybody.
      if (standing.kind === 'new') releasing[name] = version;

      // The ranges the ALREADY-PUBLISHED manifest carries. Collected for every
      // published version this workspace still declares, whether or not it is
      // stale — a stale package is one whose range set is about to be reported
      // for a different reason, and its recorded range is still the live one
      // until somebody bumps it.
      if (payloads !== undefined) {
        publishedManifests.push({ name, version, dependencies: publishedDependencies(payloads.published) });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // A loop over an empty directory passes silently, which would make this a
  // green light that looked at nothing — the same vacuity `smoke-consumer.mjs`
  // guards against at its own end.
  if (findings.length === 0) {
    console.error('no publishable packages were checked; this guard proved nothing');
    return 1;
  }

  for (const finding of findings) {
    const label = `${finding.name}@${finding.version}`;
    switch (finding.standing.kind) {
      case 'new':
        console.log(`ok    ${label}  not yet published — the release will publish it`);
        break;
      case 'unchanged':
        console.log(`ok    ${label}  already published, byte-identical — the release will skip it`);
        break;
      case 'stale':
        console.error(`STALE ${label}  is already published with DIFFERENT content, so a release SKIPS it.`);
        console.error(`      Bump the version, or the change never reaches a consumer. Differs at:`);
        for (const path of finding.standing.differences) console.error(`        ${path}`);
        break;
      case 'unknown':
        console.error(`UNKNOWN ${label}  ${finding.standing.reason}`);
        console.error(`      Treated as a failure: an unanswered question is not an all-clear.`);
        break;
    }
  }

  const stranded = unresolvableConsumers(publishedManifests, releasing);
  for (const finding of stranded) {
    const shape = finding.admits === undefined ? 'a range shape this guard will not judge' : 'does not admit it';
    console.error(
      `STRANDED ${finding.consumer}@${finding.consumerVersion} depends on ` +
        `${finding.dependency}@${finding.range}, and this release publishes ` +
        `${finding.dependency}@${finding.releasing} — ${shape}.`,
    );
    console.error(
      `      That published consumer is not being republished, so it would keep resolving the OLD ` +
        `${finding.dependency}. Bump and republish it too, or choose a version its range admits.`,
    );
  }

  const blocking = findings.filter(isBlocking);
  if (blocking.length > 0 || stranded.length > 0) {
    console.error(
      `\n${blocking.length} of ${findings.length} package(s) cannot be released as they stand; ` +
        `${stranded.length} published consumer(s) would be stranded.`,
    );
    return 1;
  }
  console.log(
    `\npublishable: ${findings.length} package(s) checked against the registry, ` +
      `${Object.keys(releasing).length} to be published, no published consumer stranded.`,
  );
  return 0;
}

// Only when run as a program. Importing this module — which the test does — must
// not reach the network or exit the process.
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main());
}
