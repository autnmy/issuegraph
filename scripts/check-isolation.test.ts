/**
 * The deliberate-violation proof.
 *
 * A guard that has never failed is not known to work — observing that nothing
 * violates the rule today says nothing about whether the guard would notice if
 * something did. So every rule is exercised against a package built to break
 * it, and each case asserts the *exact* rules that fired. Asserting only "some
 * violation was found" would pass on a guard that reports the wrong rule, or
 * that fails for a reason unrelated to the violation.
 *
 * The clean case is the positive control in the other direction: it proves the
 * fixtures are otherwise well-formed, so a failing case failed because of the
 * one thing it changed.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { findIsolationViolations } from './check-isolation.ts';

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * Build a one-package workspace on disk and return its packages directory.
 * `files` are written relative to the package root.
 */
function fixture(files: Record<string, string>, manifest: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-isolation-'));
  roots.push(root);
  const packagesDir = join(root, 'packages');
  const packageDir = join(packagesDir, 'subject');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: '@issuegraph/subject', version: '0.0.0', ...manifest }, null, 2),
  );
  for (const [name, contents] of Object.entries(files)) {
    const target = join(packageDir, name);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
  }
  return packagesDir;
}

/** The distinct rules that fired, sorted, so a case can assert on them exactly. */
function rulesFired(packagesDir: string): string[] {
  return [...new Set(findIsolationViolations(packagesDir).map((violation) => violation.rule))].sort();
}

const CLEAN_SOURCE = [
  "import { readFileSync } from 'node:fs';",
  "import { helper } from './helper.ts';",
  '',
  'export const read = (path: string): string => helper(readFileSync(path, "utf8"));',
].join('\n');

const HELPER_SOURCE = 'export const helper = (text: string): string => text.trim();\n';

test('POSITIVE CONTROL: a clean package produces no violations', () => {
  const packagesDir = fixture({ 'src/index.ts': CLEAN_SOURCE, 'src/helper.ts': HELPER_SOURCE });
  assert.deepEqual(findIsolationViolations(packagesDir), []);
});

test('a scoped Descant import is a forbidden-dependency, and only that', () => {
  const packagesDir = fixture({
    'src/index.ts': "import { parse } from '@descant/types';\n\nexport const p = parse;\n",
  });
  assert.deepEqual(rulesFired(packagesDir), ['forbidden-dependency']);
});

test('an unscoped Descant require is a forbidden-dependency', () => {
  const packagesDir = fixture({
    // The identifier deliberately avoids the brand token, so this case breaks
    // exactly one rule and cannot pass by tripping a different guard.
    'src/index.cjs': "const runner = require('descant/runner');\nmodule.exports = runner;\n",
  });
  assert.deepEqual(rulesFired(packagesDir), ['forbidden-dependency']);
});

test('a dynamic import of a Descant package is caught like a static one', () => {
  const packagesDir = fixture({
    'src/index.ts': "export const load = async () => import('@descant/orchestrator');\n",
  });
  assert.deepEqual(rulesFired(packagesDir), ['forbidden-dependency']);
});

test('a package.json dependency on Descant is caught even with nothing importing it', () => {
  const packagesDir = fixture(
    { 'src/index.ts': "export const nothing = 'imports it';\n" },
    { dependencies: { '@descant/types': '^1.0.0' } },
  );
  assert.deepEqual(rulesFired(packagesDir), ['forbidden-dependency']);
});

test('a relative specifier escaping the package is a package-escape, and only that', () => {
  const packagesDir = fixture({
    'src/index.ts': "export { model } from '../../../apps/dashboard/src/model.ts';\n",
  });
  assert.deepEqual(rulesFired(packagesDir), ['package-escape']);
});

test('a deep import into a sibling package is a package-escape too', () => {
  const packagesDir = fixture({
    'src/index.ts': "export { thing } from '../../reader/src/internal.ts';\n",
  });
  assert.deepEqual(rulesFired(packagesDir), ['package-escape']);
});

test('a brand token outside any specifier is a brand-leak, and only that', () => {
  const packagesDir = fixture({
    'src/index.ts': "export const ORIGIN = 'filed by the Descant pipeline';\n",
  });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a brand token in a comment is a brand-leak — an import scan would miss it', () => {
  const packagesDir = fixture({
    'src/index.ts': '/** Ported from Takumi. */\nexport const ported = true;\n',
  });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('the forbidden-dependency and brand-leak rules never both fire on one import', () => {
  const packagesDir = fixture({
    'src/index.ts': "import { parse } from '@descant/types';\n\nexport const p = parse;\n",
  });
  const violations = findIsolationViolations(packagesDir);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, 'forbidden-dependency');
});

test('a violation is located precisely enough to fix without searching', () => {
  const packagesDir = fixture({
    'src/index.ts': ['// line 1', '// line 2', "import x from '@descant/types';", 'export default x;'].join('\n'),
  });
  const [violation] = findIsolationViolations(packagesDir);
  assert.equal(violation?.file, join('subject', 'src', 'index.ts'));
  assert.equal(violation?.line, 3);
  assert.match(violation?.detail ?? '', /@descant\/types/);
});

test("a brand token in a package's README is a brand-leak — the README is published too", () => {
  const packagesDir = fixture({
    'README.md': '# @issuegraph/subject\n\nExtracted from the Descant pipeline.\n',
  });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a relative specifier naming a brand-tokened FILE is a brand-leak', () => {
  // The mask covers bare specifiers, whose names this repository does not choose.
  // A relative path is a filename we did choose, so it stays visible to the rule.
  const packagesDir = fixture({
    'src/index.ts': "export { note } from './descant-notes.ts';\n",
    'src/descant-notes.ts': 'export const note = 1;\n',
  });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('an npm: alias to a forbidden package is caught, whatever the key is called', () => {
  // The key reveals nothing and the import names only the alias, so a scan
  // reading either alone passes while the coupling is real.
  const packagesDir = fixture(
    { 'src/index.ts': "export { parse } from 'innocent';\n" },
    { dependencies: { innocent: 'npm:@descant/types@^1.0.0' } },
  );
  assert.deepEqual(rulesFired(packagesDir), ['forbidden-dependency']);
});

test('an alias with no version pinned is caught too', () => {
  const packagesDir = fixture(
    { 'src/index.ts': "export const nothing = 'imports it';\n" },
    { dependencies: { innocent: 'npm:descant' } },
  );
  assert.deepEqual(rulesFired(packagesDir), ['forbidden-dependency']);
});

test('a dependency resolved through a git URL naming the consumer is caught', () => {
  const packagesDir = fixture(
    { 'src/index.ts': "export const nothing = 'imports it';\n" },
    { dependencies: { helper: 'github:autnmy/descant#main' } },
  );
  assert.deepEqual(rulesFired(packagesDir), ['forbidden-dependency']);
});

test('an ordinary version range is not mistaken for a forbidden resolution', () => {
  const packagesDir = fixture(
    { 'src/index.ts': "export const nothing = 'imports it';\n" },
    { dependencies: { typescript: '^7.0.2', vitest: '^2.0.0' } },
  );
  assert.deepEqual(rulesFired(packagesDir), []);
});

test('quoted prose is NOT masked as a specifier — the brand rule still sees it', () => {
  // `from "Descant"` matches the specifier pattern, which runs over comments and
  // Markdown. Masking it would delete the leak on its way to the brand rule.
  const packagesDir = fixture({
    'README.md': '# subject\n\nExtracted from "Descant".\n',
  });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('the same prose inside a code comment is not masked either', () => {
  const packagesDir = fixture({
    'src/index.ts': '// Ported from "Takumi", with changes.\nexport const ported = true;\n',
  });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('POSITIVE CONTROL: an ordinary import block produces nothing', () => {
  // The control for deleting the mask: dropping it must not start reporting the
  // imports every package has.
  const packagesDir = fixture({
    'src/index.ts': [
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "import { helper } from './helper.ts';",
      'export const all = [readFileSync, join, helper];',
    ].join('\n'),
    'src/helper.ts': HELPER_SOURCE,
  });
  assert.deepEqual(findIsolationViolations(packagesDir), []);
});

test('a quoted PATH after `from` is not treated as a specifier and hidden', () => {
  // The mask used to blank anything package-shaped after `from`, which swallowed
  // this sentence whole. Nothing decides what a quoted string "really is" now.
  const packagesDir = fixture({
    'README.md': '# subject\n\nNotes imported from "docs/descant".\n',
  });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a dependency whose NAME carries the token is caught in both files alike', () => {
  // Deliberate and fail-closed: the token is a made-up product name, so a real
  // package containing it is not a case worth an escape hatch — and letting the
  // manifest allow what source rejects is the rule holding in one file only.
  const inSource = fixture({
    'src/index.ts': "import { a } from 'eslint-plugin-descant';\n\nexport const b = a;\n",
  });
  assert.deepEqual(rulesFired(inSource), ['brand-leak']);
  const inManifest = fixture(
    { 'src/index.ts': 'export const clean = true;\n' },
    { dependencies: { 'eslint-plugin-descant': '^1.0.0' } },
  );
  assert.deepEqual(rulesFired(inManifest), ['forbidden-dependency']);
});

test('a leak that exists ONLY in the built output is caught', () => {
  // dist is what npm publishes, and a source scan cannot reach a banner or a
  // copied asset that the build puts there.
  const packagesDir = fixture(
    {
      'src/index.ts': 'export const clean = true;\n',
      'dist/index.js': '// generated banner: built by the Descant toolchain\nexport const clean = true;\n',
    },
    { files: ['dist'] },
  );
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a published JSON asset is scanned — there is no extension allowlist', () => {
  const packagesDir = fixture(
    { 'schema.json': '{"description":"Descant-specific schema"}\n' },
    { files: ['schema.json'] },
  );
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a file with NO extension at all is scanned', () => {
  // A NOTICE is the case an extension list cannot express at all, which is the
  // point of deciding by content instead.
  const packagesDir = fixture({ NOTICE: 'Portions derived from Takumi.\n' });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a YAML config is scanned', () => {
  const packagesDir = fixture({ 'config.yaml': 'title: descant fixture\n' });
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a binary file is skipped rather than decoded', () => {
  // The token's own bytes are in there, so this fails if binaries are read as
  // text — and it would also catch the guard crashing on one.
  const packagesDir = fixture({ 'src/index.ts': 'export const clean = true;\n' });
  writeFileSync(
    join(packagesDir, 'subject', 'logo.png'),
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]), Buffer.from('descant')]),
  );
  assert.deepEqual(findIsolationViolations(packagesDir), []);
});

test('a manifest leak is reported once, not twice', () => {
  // The file walk now reaches package.json too, so the manifest has to be
  // excluded from it or checkManifest's finding is duplicated.
  const packagesDir = fixture(
    { 'src/index.ts': 'export const clean = true;\n' },
    { description: 'Extracted from the Descant pipeline' },
  );
  assert.equal(findIsolationViolations(packagesDir).length, 1);
});

test('a brand token in the published description is a brand-leak', () => {
  // npm publishes package.json whole, so its metadata reaches every installer
  // exactly as the README does.
  const packagesDir = fixture(
    { 'src/index.ts': 'export const clean = true;\n' },
    { description: 'Extracted from the Descant pipeline' },
  );
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a brand token inside an array of keywords is found', () => {
  const packagesDir = fixture(
    { 'src/index.ts': 'export const clean = true;\n' },
    { keywords: ['issuegraph', 'takumi'] },
  );
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a brand token in a manifest KEY is found, not just in a value', () => {
  const packagesDir = fixture(
    { 'src/index.ts': 'export const clean = true;\n' },
    { 'descant-config': { enabled: true } },
  );
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('a field nobody anticipated is scanned too — the walk is not a field list', () => {
  // The point of recursing rather than checking known metadata fields: a manifest
  // key invented tomorrow is published tomorrow, and a table would call it clean.
  const packagesDir = fixture(
    { 'src/index.ts': 'export const clean = true;\n' },
    { publishConfig: { registry: 'https://registry.descant.example/' } },
  );
  assert.deepEqual(rulesFired(packagesDir), ['brand-leak']);
});

test('the metadata scan does not double-report a forbidden dependency', () => {
  // The dependency maps are removed before the metadata walk, because the
  // forbidden rule owns them. Without that, every forbidden dependency would be
  // reported twice, under two rules.
  const packagesDir = fixture(
    { 'src/index.ts': "export const nothing = 'imports it';\n" },
    { dependencies: { '@descant/types': '^1.0.0' } },
  );
  const violations = findIsolationViolations(packagesDir);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, 'forbidden-dependency');
});

test('an ordinary manifest with a repository and homepage stays clean', () => {
  const packagesDir = fixture(
    { 'src/index.ts': 'export const clean = true;\n' },
    {
      description: 'The specification vocabulary, as data.',
      keywords: ['issuegraph', 'dependency-graph'],
      homepage: 'https://github.com/autnmy/issuegraph#readme',
      repository: { type: 'git', url: 'git+https://github.com/autnmy/issuegraph.git' },
      publishConfig: { access: 'public', provenance: true },
    },
  );
  assert.deepEqual(findIsolationViolations(packagesDir), []);
});

test('a directory under packages with no package.json is not scanned', () => {
  const packagesDir = fixture({ 'src/index.ts': CLEAN_SOURCE, 'src/helper.ts': HELPER_SOURCE });
  const stray = join(packagesDir, 'not-a-package', 'src');
  mkdirSync(stray, { recursive: true });
  writeFileSync(join(stray, 'index.ts'), "import '@descant/types';\n");
  assert.deepEqual(findIsolationViolations(packagesDir), []);
});

test('a near-miss name is not forbidden — the guard matches package boundaries, not substrings', () => {
  const packagesDir = fixture({
    'src/index.ts': "import { note } from 'descantabilify';\n\nexport const n = note;\n",
  });
  assert.deepEqual(rulesFired(packagesDir), []);
});
