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
 * - `package-escape` — a relative specifier, or a `file:`/`link:`/`portal:`
 *   dependency, that resolves outside its own package. This is how a package
 *   reaches a sibling's internals, or the repository root, without ever naming
 *   Descant — and a local-path dependency survives into the packed manifest, so
 *   it also ships an artifact no installer can resolve.
 * - `brand-leak` — a Descant brand token in ANY text file under a package, plus
 *   its `package.json` metadata. Not an extension list: what a package can
 *   publish is an open set — source, README, a JSON schema, a NOTICE — so a list
 *   of what to scan is always one member short. Everything is read and binaries
 *   are skipped by content.
 *
 * The rules stay disjoint the cheap way: `brand-leak` is not reported on a line
 * that already produced another violation. Suppression therefore REQUIRES an
 * existing report on that same line, so it can never hide a leak — which is the
 * property the previous design lacked. That design blanked out anything that
 * looked like a module specifier before the brand scan, and every round found
 * another string it wrongly believed was one: a quoted capitalised name, then a
 * quoted path. Guessing which quoted strings are specifiers is the defect; the
 * disjointness it bought is cosmetic, and this buys the same thing for nothing.
 *
 * Run: `pnpm check:isolation`. Exit 0 clean, 1 with violations.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

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
export const FORBIDDEN_SCOPES = Object.freeze(['@descant', '@takumi'] as const);
export const FORBIDDEN_PACKAGES = Object.freeze(['descant', 'takumi'] as const);
export const BRAND_TOKEN = /\b(descant|takumi)\b/i;

/**
 * Directories that are not this package's own text. `dist` is deliberately NOT
 * among them: it is what npm actually publishes, and its sourcemaps carry the
 * whole of `src` inside `sourcesContent`, so excluding it exempted the artifact
 * from the rule while checking the thing the artifact is made from.
 */
const SKIPPED_DIRECTORIES = Object.freeze(['node_modules', '.git', 'coverage'] as const);

const DEPENDENCY_MAPS = Object.freeze([
  'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
] as const);

/** Extensions a JavaScript runtime can execute. Nothing else can import. */
const MODULE_EXTENSIONS = Object.freeze([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
] as const);

function isModuleFile(file: string): boolean {
  return MODULE_EXTENSIONS.some((extension) => file.endsWith(extension));
}

/**
 * Module specifiers, matched as STATEMENTS rather than as a quoted string after
 * a keyword.
 *
 * The looser form reported `This was imported from "../private/guide.md"` in a
 * README as a package escape — a false positive that fails CI on correct
 * content, which is worse than a miss because it stops work rather than letting
 * it through. Anchoring the `from` form at the start of a line, and requiring
 * the call form to close its parenthesis, is what separates an import from
 * prose that mentions one. The escape rule is additionally applied only to files
 * a runtime can execute, since a Markdown file cannot import anything at all.
 *
 * Still not a parser, and still an open grammar — a specifier built by
 * concatenation is invisible, and that class is tracked on
 * autnmy/descant#9137 rather than patched per round.
 */
const SPECIFIER_PATTERNS = Object.freeze([
  // import x from 'y' / export { x } from 'y' — anchored: prose does not begin a line with the keyword.
  /^[ \t]*(?:import|export)\b[^\n]*?\bfrom[ \t]*(['"`])([^'"`\n]+)\1/gm,
  // import 'y' — side-effect import, same anchor.
  /^[ \t]*import[ \t]*(['"`])([^'"`\n]+)\1/gm,
  // import('y') / require('y'), comments tolerated between keyword and paren.
  // The closing paren is required, which prose almost never writes.
  /\b(?:import|require)[ \t]*(?:\/\*[\s\S]*?\*\/[ \t]*)*\([ \t]*(['"`])([^'"`\n]+)\1[ \t]*\)/g,
] as const);

/**
 * Whether a specifier reaches outside its own package.
 *
 * Three shapes reach out, not one. The rule used to test only RELATIVE paths, so
 * `import '/home/runner/work/consumer/private.js'` and its `file://` spelling
 * both walked past it — valid Node specifiers that leave the package and bake an
 * environment-specific path into a published artifact.
 */
function escapesPackage(packageDir: string, file: string, specifier: string): boolean {
  if (isRelative(specifier)) return !isInside(packageDir, resolve(file, '..', specifier));
  if (specifier.startsWith('file:')) {
    try {
      return !isInside(packageDir, fileURLToPath(new URL(specifier)));
    } catch {
      // An unparseable file: URL is not a resolvable module either. Report it
      // rather than deciding it is fine — an unknown is not an absence.
      return true;
    }
  }
  return isAbsolute(specifier) ? !isInside(packageDir, specifier) : false;
}

function isForbiddenPackage(specifier: string): boolean {
  if (FORBIDDEN_SCOPES.some((scope) => specifier === scope || specifier.startsWith(`${scope}/`))) {
    return true;
  }
  return FORBIDDEN_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/**
 * Protocols whose value is a PATH on this machine rather than a registry name.
 * `workspace:` is deliberately absent — it names a sibling package, which is how
 * these packages are meant to depend on each other.
 */
const LOCAL_PROTOCOLS = Object.freeze(['file:', 'link:', 'portal:'] as const);

/**
 * The path a dependency value points at, when it points at one at all.
 *
 * Unlike a module specifier in source, this is not an open grammar: a manifest
 * is JSON and the value is exactly one string, so reading it is unambiguous.
 */
function localDependencyPath(value: string): string | undefined {
  for (const protocol of LOCAL_PROTOCOLS) {
    if (value.startsWith(protocol)) return value.slice(protocol.length);
  }
  return value.startsWith('./') || value.startsWith('../') ? value : undefined;
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
        // A dependency whose NAME carries the token is caught here rather than
        // left to the brand rule, so the manifest and the source agree: an
        // import of it is a brand-leak, and allowing the same name in the
        // manifest would be the rule holding in one file and not the other.
        : BRAND_TOKEN.test(name) ? `declares "${name}", whose name carries the token`
        : undefined;
      // A local-path dependency that climbs out of the package is an escape, and
      // a worse one than a source import: npm preserves it in the packed
      // manifest, so the published artifact carries a dependency no installer
      // can resolve. Reported under the escape rule rather than the forbidden
      // one because it need not name the consumer to do this.
      const local = localDependencyPath(spec);
      if (local !== undefined && !isInside(packageDir, resolve(packageDir, local))) {
        violations.push({
          rule: 'package-escape',
          file: relative(packagesDir, manifestPath),
          line: 0,
          detail: `${mapName} points "${name}" at "${spec}", outside ${relative(packagesDir, packageDir)}`,
        });
      }
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

  // Only a file a runtime can execute has imports to find. Everything else is
  // still scanned by the brand rule below, which is what a README needs.
  if (isModuleFile(file)) {
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const specifier = match[2];
        if (specifier === undefined) continue;
        const at = match.index ?? 0;

        if (isForbiddenPackage(specifier)) {
          violations.push({
            rule: 'forbidden-dependency',
            file: where,
            line: lineOf(text, at),
            detail: `imports "${specifier}"`,
          });
          continue;
        }
        if (escapesPackage(packageDir, file, specifier)) {
          violations.push({
            rule: 'package-escape',
            file: where,
            line: lineOf(text, at),
            detail: `"${specifier}" resolves outside ${relative(packagesDir, packageDir)}`,
          });
        }
      }
    }
  }

  // One leak, one report — without ever deciding what a quoted string "really
  // is". A line that already carries a violation has been reported by the rule
  // that owns it; every other line is scanned as written.
  const alreadyReported = new Set(violations.map((violation) => violation.line));
  for (const [index, line] of text.split('\n').entries()) {
    if (alreadyReported.has(index + 1)) continue;
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
