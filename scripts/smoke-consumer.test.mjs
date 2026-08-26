/**
 * Tests for the consumer smoke test.
 *
 * The smoke test grants a WEAKER check to a package that declares no Node floor,
 * and a weakening is exactly the kind of change that turns a guard into
 * decoration. So each case asserts which check a package actually received, and
 * three of them assert the weaker path does NOT become an exemption.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { smokeTest, declaredFloorMajor } from './smoke-consumer.mjs';

const roots = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A one-package workspace whose entry is `dist/index.js`. */
function fixture(entrySource, manifest = {}, extraFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-smoke-'));
  roots.push(root);
  const dir = join(root, 'packages', 'subject');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@issuegraph/subject',
    version: '0.0.0',
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    ...manifest,
  }, null, 2));
  writeFileSync(join(dir, 'dist', 'index.js'), entrySource);
  writeFileSync(join(dir, 'dist', 'index.d.ts'), 'export declare const a: number;\n');
  for (const [name, contents] of Object.entries(extraFiles)) writeFileSync(join(dir, 'dist', name), contents);
  return join(root, 'packages');
}

const running = Number(process.versions.node.split('.')[0]);

test('a Node package that declares its floor is LOADED, not merely parsed', async () => {
  const dir = fixture('export const a = 1;\n', { engines: { node: `>=${running}` } });
  assert.deepEqual((await smokeTest(dir)).map((r) => r.check), ['loaded']);
});

test('a package with no declared floor is PARSED when Node cannot load it', async () => {
  const dir = fixture('import "./style.css";\nexport const a = 1;\n', {}, { 'style.css': 'body{}' });
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
  assert.match(result.downgraded, /Unknown file extension "\.css"/);
});

test('a browser global at module scope is parsed, not failed', async () => {
  const dir = fixture('document.title = "x";\nexport const a = 1;\n');
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
  assert.match(result.downgraded, /document is not defined/);
});

test('DERIVED, NOT ENUMERATED: an unanticipated load failure still downgrades', async () => {
  // The check this replaced listed the failures a browser entry had been OBSERVED
  // to produce and tolerated exactly those. This error is in none of them: it is
  // not a SyntaxError, not a ReferenceError, and carries no `code`. The old list
  // would have failed the package; the derived question — did it parse? — gets it
  // right without anyone having to add a row.
  const dir = fixture('await Promise.reject(new TypeError("boom"));\nexport const a = 1;\n');
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
  assert.match(result.downgraded, /boom/);
});

test('NOT AN EXEMPTION: TypeScript syntax left in an emitted .js fails', async () => {
  // Valid TypeScript, invalid JavaScript. Parsed without the real filename,
  // TypeScript reads it as TypeScript and reports nothing — so this downgraded
  // as "parsed" for source no browser can load.
  const dir = fixture('export const x: number = 1;\n');
  await assert.rejects(smokeTest(dir), /does not parse.*TypeScript files/s);
});

test('NOT AN EXEMPTION: a broken emitted SIBLING fails, not just the entry', async () => {
  // The entry is fine; what Node choked on is the file it imports. Checking only
  // the entry downgraded this and let CI pass on a package no consumer can load.
  const dir = fixture('export { b } from "./broken.js";\n', {}, { 'broken.js': 'export const b = = ;\n' });
  await assert.rejects(smokeTest(dir), /broken\.js does not parse/);
});

test('CONTROL: a valid sibling Node merely cannot load still downgrades', async () => {
  // The two cases above must not have made every import failure fatal.
  const dir = fixture('import "./style.css";\nexport { b } from "./ok.js";\n',
    {}, { 'style.css': 'body{}', 'ok.js': 'export const b = 1;\n' });
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
});

test('NOT AN EXEMPTION: an ORPHAN emitted file must parse even when the entry LOADS', async () => {
  // The same asymmetry on the other sweep. Nothing imports this file, so Node
  // never looks at it — and the package ships source no consumer can load.
  const dir = fixture('export const a = 1;\n', {}, { 'orphan.js': 'export const b = = ;\n' });
  await assert.rejects(smokeTest(dir), /orphan\.js does not parse/);
});

test('a module that throws a NON-Error string still records parse-only', async () => {
  // `throw "boom"` has no `.message`, so the reason came back `undefined` — the
  // same value that meant "the entry loaded fine" — and the success branch then
  // called `Object.keys` on an entry that never loaded.
  const dir = fixture('throw "boom";\nexport const a = 1;\n');
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
  assert.equal(result.downgraded, 'boom');
});

test('a module that throws NULL still records parse-only', async () => {
  // The harder half: reading `.message` off `null` threw INSIDE the catch, so the
  // failure escaped smokeTest as a TypeError about the wrong thing entirely.
  const dir = fixture('throw null;\nexport const a = 1;\n');
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
  assert.equal(result.downgraded, 'null');
});

test('NOT AN EXEMPTION: a missing STATIC import fails, floor or no floor', async () => {
  // The parse sweep reads the files that ARE there, so an absent one is
  // structurally invisible to it. Node reports the missing file, and the
  // downgrade must not swallow that: CI would otherwise pass a package whose
  // first import 404s for every consumer.
  const dir = fixture('export { x } from "./missing.js";\n');
  await assert.rejects(smokeTest(dir), /imports a file the package does not contain/);
});

test('NOT AN EXEMPTION: JSX left in an emitted file fails, floor or none', async () => {
  // The gap this closes: TypeScript reads `.js` as a JSX-CAPABLE variant, so an
  // untransformed element draws no diagnostic and the parse check passed it —
  // while Node answers `SyntaxError: Unexpected token '<'` and the floor-less
  // downgrade then swallowed that. Measured on TypeScript 6.0.3.
  const dir = fixture('export const a = <div />;\n');
  await assert.rejects(smokeTest(dir), /JSX syntax survived the build/);
});

test('NOT AN EXEMPTION: a JSX fragment fails too', async () => {
  // A separate node kind from an element, so it is pinned separately: dropping
  // `isJsxFragment` leaves the element test green.
  const dir = fixture('export const a = <>x</>;\n');
  await assert.rejects(smokeTest(dir), /JSX syntax survived the build/);
});

test('CONTROL: the JSX check reads the AST, not the text', async () => {
  // Both of these carry `<` — one as a comparison, one inside a string literal.
  // A textual scan for angle brackets fails this; an AST walk does not.
  const dir = fixture('export const a = 1 < 2;\nexport const b = "<div />";\n');
  assert.deepEqual((await smokeTest(dir)).map((r) => r.check), ['loaded']);
});

test('NOT AN EXEMPTION: a missing CommonJS require fails too', async () => {
  // CommonJS reports MODULE_NOT_FOUND with no `url`, so the ESM discriminator
  // does not reach it. Measured: relative and bare are identical apart from the
  // specifier named in the message.
  const dir = fixture('module.exports = require("./missing.js");\n',
    { type: 'commonjs', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } });
  await assert.rejects(smokeTest(dir), /imports a file the package does not contain/);
});

test('CONTROL: an uninstalled BARE require still downgrades', async () => {
  // The CommonJS half of the peer-dependency carve-out. Treating every
  // MODULE_NOT_FOUND as fatal would fail exactly the packages this PR admits.
  const dir = fixture('module.exports = require("some-absent-package");\n', { type: 'commonjs' });
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
});

test('CONTROL: an uninstalled BARE import still downgrades — that is the install, not the package', async () => {
  // The reason this keys on `err.url` rather than on the bare error code: a
  // browser package's peer dependency is legitimately absent from its own tree,
  // and failing it would break exactly the packages this PR exists to admit.
  const dir = fixture('import "some-absent-package";\nexport const a = 1;\n');
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
});

test('NOT AN EXEMPTION: broken syntax fails even with no declared floor', async () => {
  // The whole risk of a downgrade is that it becomes a pass for anything. A
  // SyntaxError proves the file was never valid, so it is never tolerated.
  const dir = fixture('export const a = = ;\n');
  await assert.rejects(smokeTest(dir), /does not parse/);
});

test('NOT AN EXEMPTION: a package that DECLARES a floor must load on it', async () => {
  // Exemption comes from making no claim, never from opting out of the check.
  const dir = fixture('import "./style.css";\nexport const a = 1;\n',
    { engines: { node: `>=${running}` } }, { 'style.css': 'body{}' });
  await assert.rejects(smokeTest(dir), (error) => error.code === 'ERR_UNKNOWN_FILE_EXTENSION');
});

test('NOT AN EXEMPTION: a declared floor must equal the running major', async () => {
  const dir = fixture('export const a = 1;\n', { engines: { node: `>=${running - 1}` } });
  await assert.rejects(smokeTest(dir), /declares node >=/);
});

test('a RUNTIME SyntaxError is not a parse failure, and is not treated as one', async () => {
  // The reason nothing is special-cased on error type. This module's source is
  // perfectly valid; it throws SyntaxError while EXECUTING. Trusting the error's
  // type would fail a package whose source is fine.
  const dir = fixture('JSON.parse("{");\nexport const a = 1;\n');
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
});

test('a missing exports target still fails, floor or no floor', async () => {
  const dir = fixture('export const a = 1;\n', { exports: { '.': { types: './dist/nope.d.ts', default: './dist/index.js' } } });
  await assert.rejects(smokeTest(dir), /the build did not produce/);
});

test('an empty packages directory fails rather than passing vacuously', async () => {
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-smoke-'));
  roots.push(root);
  mkdirSync(join(root, 'packages'), { recursive: true });
  await assert.rejects(smokeTest(join(root, 'packages')), /proved nothing/);
});

test('declaredFloorMajor reads the shapes an engines range actually takes', () => {
  assert.equal(declaredFloorMajor('>=18'), 18);
  assert.equal(declaredFloorMajor('^22.13.0'), 22);
  assert.equal(declaredFloorMajor('>=20.9.0 <25'), 20);
  assert.equal(declaredFloorMajor(undefined), undefined);
  assert.equal(declaredFloorMajor('*'), undefined);
});

/** A two-package workspace, so a skip can be observed without emptying the run. */
function pairFixture(subjectManifest) {
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-smoke-'));
  roots.push(root);
  for (const [name, extra] of [['subject', subjectManifest], ['bystander', {}]]) {
    const dir = join(root, 'packages', name);
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: `@issuegraph/${name}`,
      version: '0.0.0',
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      ...extra,
    }, null, 2));
    writeFileSync(join(dir, 'dist', 'index.js'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'dist', 'index.d.ts'), 'export declare const a: number;\n');
  }
  return join(root, 'packages');
}

test('a PRIVATE package is skipped — it makes no consumer claim to measure', async () => {
  const results = await smokeTest(pairFixture({ private: true }));
  assert.deepEqual(results.map((r) => r.name), ['@issuegraph/bystander']);
});

test('CONTROL: the same package without the flag is NOT skipped', async () => {
  // The control the case above needs. Both packages here are byte-identical
  // apart from `private`, so a pass below proves the skip is keyed on the flag
  // rather than on anything incidental to the fixture.
  const results = await smokeTest(pairFixture({}));
  assert.deepEqual(results.map((r) => r.name).sort(), ['@issuegraph/bystander', '@issuegraph/subject']);
});

test('a private package does not get to empty the run — the vacuity guard still fires', async () => {
  // The obvious failure mode of any skip: exclude everything and report a
  // clean pass over nothing. `results.length > 0` is what stops that, and it
  // has to keep firing now that a package can remove itself.
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-smoke-'));
  roots.push(root);
  const dir = join(root, 'packages', 'only');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@issuegraph/only',
    version: '0.0.0',
    type: 'module',
    private: true,
    exports: { '.': { default: './dist/index.js' } },
  }, null, 2));
  writeFileSync(join(dir, 'dist', 'index.js'), 'export const a = 1;\n');
  await assert.rejects(() => smokeTest(join(root, 'packages')), /proved nothing/);
});
