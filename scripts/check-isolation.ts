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
 *   entry, naming a Descant-side package.
 * - `package-escape` — a relative specifier that resolves outside its own
 *   package. This is how a source file reaches a sibling package's internals,
 *   or the repository root, without ever naming Descant.
 * - `brand-leak` — a Descant brand token in the source text itself, outside any
 *   module specifier. An import scan cannot see a leak that arrives as an
 *   identifier, a string or a doc comment.
 *
 * The rules are disjoint by construction: `brand-leak` scans the source with
 * every module specifier removed, so a forbidden import is reported once, by
 * the rule that owns it.
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

/**
 * What gets scanned. Markdown is in the list because a package's README is
 * published with it — `files` ships it to the registry — so a brand token there
 * is exactly as public as one in the code, and an extension list covering only
 * code would leave the most-read file in the package unguarded.
 */
const SOURCE_EXTENSIONS = Object.freeze([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.md',
] as const);

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

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if ((SKIPPED_DIRECTORIES as readonly string[]).includes(entry.name)) continue;
      found.push(...listSourceFiles(join(dir, entry.name)));
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
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

function checkManifest(packagesDir: string, packageDir: string): Violation[] {
  const manifestPath = join(packageDir, 'package.json');
  const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof raw !== 'object' || raw === null) return [];

  const violations: Violation[] = [];
  const manifest = raw as Record<string, unknown>;
  for (const mapName of DEPENDENCY_MAPS) {
    const map = manifest[mapName];
    if (typeof map !== 'object' || map === null) continue;
    for (const name of Object.keys(map)) {
      if (!isForbiddenPackage(name)) continue;
      violations.push({
        rule: 'forbidden-dependency',
        file: relative(packagesDir, manifestPath),
        line: 0,
        detail: `${mapName} declares "${name}"`,
      });
    }
  }
  return violations;
}

function checkSourceFile(packagesDir: string, packageDir: string, file: string): Violation[] {
  const text = readFileSync(file, 'utf8');
  const where = relative(packagesDir, file);
  const violations: Violation[] = [];

  // Blank each BARE specifier in place as it is judged — spaces, not deletion, so
  // every offset and line number below still describes the original file. What is
  // left is the text the specifier rules do not own, which is what the brand rule
  // scans.
  //
  // A relative specifier is deliberately left visible to the brand rule: it names
  // a file THIS repository chose to call something, so `./descant-notes.ts` is a
  // leak in exactly the way a third-party package that happens to contain the
  // token in its name is not.
  const masked = [...text];
  for (const match of text.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2];
    const span = match.indices?.[2];
    if (specifier === undefined || span === undefined) continue;
    const at = match.index ?? 0;
    if (!isRelative(specifier)) {
      const [start, end] = span;
      for (let i = start; i < end; i += 1) masked[i] = ' ';
    }

    if (isForbiddenPackage(specifier)) {
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
    for (const file of listSourceFiles(packageDir)) {
      violations.push(...checkSourceFile(packagesDir, packageDir, file));
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
