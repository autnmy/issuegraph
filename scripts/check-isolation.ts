/**
 * The isolation guard.
 *
 * `autnmy/issuegraph` publishes packages that anyone can install. Nothing in
 * them may reach into Descant — the product whose backlog the specification was
 * implemented against — because a package that depends on one consumer is a
 * private library wearing a public name. That rule is the whole reason the
 * packages are worth extracting, and it is the first thing to erode under
 * deadline, so it is enforced here rather than remembered.
 *
 * Three rules, each with one job:
 *
 * - `forbidden-dependency` — a module specifier, or a `package.json` dependency
 *   entry, naming a Descant-side package. An entry names one in three places:
 *   its key, an `npm:` alias target, and a git or tarball value.
 * - `package-escape` — a relative specifier that resolves outside its own
 *   package. This is how a source file reaches a sibling package's internals,
 *   or the repository root, without ever naming Descant.
 * - `brand-leak` — a Descant brand token in ANY text file under a package, plus
 *   its `package.json` metadata. Not an extension list: what a package can
 *   publish is an open set — source, README, a JSON schema, a NOTICE — so a list
 *   of what to scan is always one member short. Everything is read and binaries
 *   are skipped by content.
 *
 * The rules are disjoint by construction: `brand-leak` scans the source with the
 * specifiers the OTHER rules own blanked out, so a forbidden import is reported
 * once, by the rule that owns it. What may be blanked is the delicate part — the
 * pattern below matches prose as readily as code, and blanking prose would
 * delete a leak on its way to the brand rule — so the decision is written out at
 * the loop that makes it rather than summarised here.
 *
 * Run: `pnpm check:isolation`. Exit 0 clean, 1 with violations.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Which rule a violation broke. */
export type IsolationRule = 'forbidden-dependency' | 'package-escape' | 'brand-leak';

/** One violation, located precisely enough to fix without searching. */
export interface Violation {
  readonly rule: IsolationRule;
  /** Path relative to the scanned packages directory. */
  readonly file: string;
  /** 1-based line number, or 0 for a whole-file finding such as a manifest entry. */
  readonly line: number;
  readonly detail: string;
}

/**
 * What counts as Descant-side. Declared as data so adding a name is an edit to
 * this table and nothing else.
 */
const FORBIDDEN_SCOPES = Object.freeze(['@descant', '@takumi'] as const);
const FORBIDDEN_PACKAGES = Object.freeze(['descant', 'takumi'] as const);
const BRAND_TOKEN = /\b(descant|takumi)\b/i;

const SKIPPED_DIRECTORIES = Object.freeze(['node_modules', 'dist', '.git', 'coverage'] as const);

const DEPENDENCY_MAPS = Object.freeze([
  'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
] as const);

/**
 * Every module specifier in a source text, with the line it sits on.
 *
 * A regex rather than a parser: the guard must run before anything is built and
 * with no dependencies, and it errs toward reading *more* text as a specifier,
 * which fails toward reporting.
 */
// The `d` flag is load-bearing: the brand scan below blanks a specifier by its
// exact span, and only `match.indices` reports that span. Blanking by searching
// the text for the matched string instead reaches only the FIRST occurrence, so
// a second identical import line would keep its specifier and be handed to the
// brand rule that does not own it.
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/dg;

function isForbiddenPackage(specifier: string): boolean {
  if (FORBIDDEN_SCOPES.some((scope) => specifier === scope || specifier.startsWith(`${scope}/`))) {
    return true;
  }
  return FORBIDDEN_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/**
 * Whether a string could actually be a module specifier for a package.
 *
 * The specifier pattern below runs over comments and Markdown as well as code,
 * so ordinary prose — `Extracted from "Descant"` — matches it. That text must
 * still reach the brand rule, which means the mask has to be able to tell a
 * package name from a quoted word. npm names are lowercase by rule, so a
 * capitalised or spaced value is prose, not a dependency.
 */
function isPackageSpecifier(specifier: string): boolean {
  const withoutProtocol = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[^\s'"]+)?$/.test(withoutProtocol);
}

/**
 * The package an `npm:` alias actually resolves to.
 *
 * `"innocent": "npm:@descant/types@^1.0.0"` installs the forbidden package under
 * a name that reveals nothing, so a manifest scan reading only keys — and a
 * source scan reading only `import ... from 'innocent'` — both pass while the
 * coupling is real.
 */
function aliasTarget(value: string): string | undefined {
  if (!value.startsWith('npm:')) return undefined;
  const rest = value.slice('npm:'.length);
  // A scoped name opens with `@`, so only a LATER `@` separates the version.
  const versionAt = rest.lastIndexOf('@');
  return versionAt > 0 ? rest.slice(0, versionAt) : rest;
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..';
}

/** True when `candidate` is `parent` itself or lives beneath it. */
function isInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * Every file under a package, minus the build and tooling directories.
 *
 * Deliberately NOT an extension allowlist. This started as one — code, then
 * Markdown when a README leak was found — and each round named another surface
 * it did not cover: a published `schema.json`, a `NOTICE`, a YAML config. The
 * set of things a package can publish is open, so a list of what to scan is a
 * list that is always one member short. Scanning everything and deciding by
 * CONTENT closes that: a file type invented tomorrow is covered tomorrow.
 */
function listScannedFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if ((SKIPPED_DIRECTORIES as readonly string[]).includes(entry.name)) continue;
      found.push(...listScannedFiles(join(dir, entry.name)));
      continue;
    }
    if (entry.isFile()) found.push(join(dir, entry.name));
  }
  return found;
}

/**
 * A file's text, or `undefined` when it is not text at all.
 *
 * A NUL byte in the first block is the usual, cheap discriminator: no UTF-8 text
 * contains one, and every common binary format does within its header. Skipping
 * a binary matters for more than speed — decoding one as UTF-8 produces
 * replacement characters that could match anything.
 */
function readTextOrSkip(file: string): string | undefined {
  const buffer = readFileSync(file);
  if (buffer.subarray(0, 8000).includes(0)) return undefined;
  return buffer.toString('utf8');
}

function listPackageDirectories(packagesDir: string): string[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !(SKIPPED_DIRECTORIES as readonly string[]).includes(entry.name))
    .map((entry) => join(packagesDir, entry.name))
    .filter((dir) => {
      try {
        return statSync(join(dir, 'package.json')).isFile();
      } catch {
        return false;
      }
    });
}

/**
 * Every string in a manifest, with the JSON path it sits at — keys included,
 * because `"descant-config": {}` is a leak as surely as a value is.
 *
 * Recursive rather than a list of fields to check: npm publishes `package.json`
 * whole, so a field nobody thought of is published too, and a table of known
 * metadata fields would read as complete while a new one defaulted to unscanned.
 */
function eachManifestString(value: unknown, path: string, visit: (at: string, text: string) => void): void {
  if (typeof value === 'string') {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => eachManifestString(item, `${path}[${index}]`, visit));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      const at = path === '' ? key : `${path}.${key}`;
      visit(at, key);
      eachManifestString(nested, at, visit);
    }
  }
}

function checkManifest(packagesDir: string, packageDir: string): Violation[] {
  const manifestPath = join(packageDir, 'package.json');
  const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof raw !== 'object' || raw === null) return [];

  const violations: Violation[] = [];
  const manifest = raw as Record<string, unknown>;
  for (const mapName of DEPENDENCY_MAPS) {
    const map = manifest[mapName];
    if (typeof map !== 'object' || map === null) continue;
    for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
      const spec = typeof value === 'string' ? value : '';
      const alias = aliasTarget(spec);
      // Three readings of one entry, because a dependency can name the consumer
      // in three places: the key, an `npm:` alias target, or a git/tarball URL.
      const reason =
        isForbiddenPackage(name) ? `declares "${name}"`
        : alias !== undefined && isForbiddenPackage(alias) ? `aliases "${name}" to "${alias}"`
        : BRAND_TOKEN.test(spec) ? `resolves "${name}" through "${spec}"`
        : undefined;
      if (reason === undefined) continue;
      violations.push({
        rule: 'forbidden-dependency',
        file: relative(packagesDir, manifestPath),
        line: 0,
        detail: `${mapName} ${reason}`,
      });
    }
  }

  // npm publishes package.json in full, so its metadata is a published surface
  // exactly like the README — a `description` naming the consumer ships to every
  // installer. The dependency maps are removed first because the rule above owns
  // them; everything else is scanned, so a field nobody anticipated is covered
  // rather than defaulting to unwatched.
  const metadata: Record<string, unknown> = { ...manifest };
  for (const mapName of DEPENDENCY_MAPS) delete metadata[mapName];
  eachManifestString(metadata, '', (at, text) => {
    const brand = BRAND_TOKEN.exec(text);
    if (brand === null) return;
    violations.push({
      rule: 'brand-leak',
      file: relative(packagesDir, manifestPath),
      line: 0,
      detail: `${at} mentions "${brand[1]}"`,
    });
  });
  return violations;
}

function checkScannedFile(packagesDir: string, packageDir: string, file: string, text: string): Violation[] {
  const where = relative(packagesDir, file);
  const violations: Violation[] = [];

  // Blank a specifier in place — spaces, not deletion, so every offset and line
  // number below still describes the original file — but ONLY when one of the
  // specifier rules owns it. Masking is what keeps the rules disjoint, and it is
  // also the way a leak escapes, so what may be masked is decided explicitly:
  //
  //   forbidden        → masked; the forbidden rule reported it.
  //   relative         → NOT masked; it names a file THIS repository chose to
  //                      call something, so `./descant-notes.ts` is a leak in a
  //                      way a third-party package name is not.
  //   a package name   → masked; a third-party name is not our brand choice.
  //   anything else    → NOT masked. The pattern runs over comments and Markdown,
  //                      so prose like `from "Descant"` matches it, and masking
  //                      that would delete the leak on its way to the brand rule.
  const masked = [...text];
  for (const match of text.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2];
    const span = match.indices?.[2];
    if (specifier === undefined || span === undefined) continue;
    const at = match.index ?? 0;
    const forbidden = isForbiddenPackage(specifier);

    if (forbidden || (!isRelative(specifier) && isPackageSpecifier(specifier))) {
      const [start, end] = span;
      for (let i = start; i < end; i += 1) masked[i] = ' ';
    }

    if (forbidden) {
      violations.push({
        rule: 'forbidden-dependency',
        file: where,
        line: lineOf(text, at),
        detail: `imports "${specifier}"`,
      });
      continue;
    }
    if (isRelative(specifier) && !isInside(packageDir, resolve(file, '..', specifier))) {
      violations.push({
        rule: 'package-escape',
        file: where,
        line: lineOf(text, at),
        detail: `"${specifier}" resolves outside ${relative(packagesDir, packageDir)}`,
      });
    }
  }

  const lines = masked.join('').split('\n');
  for (const [index, line] of lines.entries()) {
    const brand = BRAND_TOKEN.exec(line);
    if (brand === null) continue;
    violations.push({
      rule: 'brand-leak',
      file: where,
      line: index + 1,
      detail: `mentions "${brand[1]}"`,
    });
  }
  return violations;
}

/**
 * Every isolation violation under a packages directory, in a stable order so a
 * caller can compare two runs.
 */
export function findIsolationViolations(packagesDir: string): Violation[] {
  const violations: Violation[] = [];
  for (const packageDir of listPackageDirectories(packagesDir)) {
    violations.push(...checkManifest(packagesDir, packageDir));
    const manifestPath = join(packageDir, 'package.json');
    for (const file of listScannedFiles(packageDir)) {
      // checkManifest owns the package's own manifest; scanning it again here
      // would report one leak twice.
      if (file === manifestPath) continue;
      const text = readTextOrSkip(file);
      if (text === undefined) continue;
      violations.push(...checkScannedFile(packagesDir, packageDir, file, text));
    }
  }
  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
}

/** The workspace's own packages directory, resolved from this file, not the cwd. */
export const WORKSPACE_PACKAGES_DIR = fileURLToPath(new URL('../packages', import.meta.url));

function main(): void {
  const violations = findIsolationViolations(WORKSPACE_PACKAGES_DIR);
  if (violations.length === 0) {
    console.log(`isolation: clean — no package reaches outside ${relative(process.cwd(), WORKSPACE_PACKAGES_DIR)}`);
    return;
  }
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}  ${violation.rule}  ${violation.detail}`);
  }
  console.error(`\nisolation: ${violations.length} violation(s). See scripts/check-isolation.ts for what each rule means.`);
  // Never process.exit() here: it can truncate the writes above on a pipe.
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
