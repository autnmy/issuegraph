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

test('NOT AN EXEMPTION: an unresolved relative import fails, floor or no floor', async () => {
  // Everything present PARSES — the defect is what is ABSENT, which a check that
  // only reads the files on disk cannot see. Node reported it as a load failure,
  // so the downgrade swallowed it and CI passed on a package whose first import
  // 404s.
  const dir = fixture('export { x } from "./missing.js";\n');
  await assert.rejects(smokeTest(dir), /imports "\.\/missing\.js", which resolves to nothing/);
});

test('NOT AN EXEMPTION: an unresolved import in a SIBLING, reached dynamically, fails', async () => {
  // Two things at once: the sweep covers every emitted file rather than the
  // entry, and a dynamic `import()` is an edge like any other — Node would never
  // have raised this one, because nothing calls `load()` during the import.
  const dir = fixture('import "./style.css";\nexport { b } from "./ok.js";\n', {}, {
    'style.css': 'body{}',
    'ok.js': 'export const b = 1;\nexport const load = () => import("./gone.js");\n',
  });
  await assert.rejects(smokeTest(dir), /imports "\.\/gone\.js"/);
});

test("NOT AN EXEMPTION: an ESM package's extensionless import fails — ESM adds no extension", async () => {
  // This test previously asserted the OPPOSITE, because the check used a
  // hand-written suffix list that accepted `./ok` for an `ok.js` that exists.
  // That is CommonJS behaviour. In a `"type": "module"` package Node resolves
  // `./ok` to `./ok`, so the edge is broken and consumers calling `load()` get
  // ERR_MODULE_NOT_FOUND. Resolution is Node's own now, so the rules match.
  const dir = fixture('export const a = 1;\nexport const load = () => import("./ok");\n',
    {}, { 'ok.js': 'export const b = 1;\n' });
  await assert.rejects(smokeTest(dir), /imports "\.\/ok", which resolves to nothing/);
});

test('CONTROL: a CommonJS package MAY use extensionless imports and directory indexes', async () => {
  // The other half, and the reason the rules are selected per file rather than
  // applied universally: CommonJS really does search extensions and index files,
  // so tightening ESM must not fail a CJS package that is entirely correct.
  const dir = fixture('module.exports = { a: 1, load: () => require("./ok") };\nrequire("./nested");\n',
    { type: 'commonjs' }, { 'ok.js': 'module.exports = 1;\n' });
  mkdirSync(join(dir, 'subject', 'dist', 'nested'), { recursive: true });
  writeFileSync(join(dir, 'subject', 'dist', 'nested', 'index.js'), 'module.exports = 1;\n');
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'loaded');
});

test('NOT AN EXEMPTION: an ESM directory import fails, index file or not', async () => {
  // `new URL` is a pure string join, so `./nested` resolves to the DIRECTORY —
  // and Node ESM refuses that with ERR_UNSUPPORTED_DIR_IMPORT. The entry loads,
  // so only a lazy edge exposes it, and every consumer calling it fails.
  const dir = fixture('export const a = 1;\nexport const load = () => import("./nested");\n');
  mkdirSync(join(dir, 'subject', 'dist', 'nested'), { recursive: true });
  writeFileSync(join(dir, 'subject', 'dist', 'nested', 'index.js'), 'export const c = 1;\n');
  await assert.rejects(smokeTest(dir), /resolves to a DIRECTORY/);
});

test('NOT AN EXEMPTION: a package that CLAIMS a Node floor may not use bundler query suffixes', async () => {
  // The query convention is a BUNDLER one — neither Node resolver implements it,
  // both treat the query as part of the filename. Stripping it universally
  // modelled a bundler on behalf of a package that promised to run on Node.
  const dir = fixture('module.exports = { load: () => require("./ok.js?raw") };\n',
    { type: 'commonjs', engines: { node: `>=${running}` } }, { 'ok.js': 'module.exports = 1;\n' });
  await assert.rejects(smokeTest(dir), /imports "\.\/ok\.js\?raw"/);
});

test('CONTROL: a bundler query suffix names the file, and still resolves', async () => {
  const dir = fixture('import "./style.css";\nimport "./data.txt?raw";\n',
    {}, { 'style.css': 'body{}', 'data.txt': 'x' });
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
});

test('NOT AN EXEMPTION: an import that ESCAPES the package fails, however real the file', async () => {
  // It resolves, it exists, and the entry loads — in THIS checkout. `npm pack`
  // ships the package directory, so the consumer installs an edge pointing at a
  // file that was never published.
  const dir = fixture('export const a = 1;\nexport const load = () => import("../../outside.mjs");\n');
  writeFileSync(join(dir, 'outside.mjs'), 'export const s = 1;\n');
  await assert.rejects(smokeTest(dir), /resolves OUTSIDE the package/);
});

test('CONTROL: a valid sibling Node merely cannot load still downgrades', async () => {
  // The two cases above must not have made every import failure fatal.
  const dir = fixture('import "./style.css";\nexport { b } from "./ok.js";\n',
    {}, { 'style.css': 'body{}', 'ok.js': 'export const b = 1;\n' });
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
});

test('NOT AN EXEMPTION: a LAZY unresolved import fails even when the entry LOADS', async () => {
  // This entry loads perfectly. The check sat in the catch block, on the reasoning
  // that a successful import proves Node resolved the graph — true only of the
  // STATIC edges reachable from the entry, because Node resolves a dynamic
  // `import()` when it is CALLED. So the package reported `loaded` while every
  // consumer that calls `load()` gets a 404.
  const dir = fixture('export const a = 1;\nexport const load = () => import("./gone.js");\n');
  await assert.rejects(smokeTest(dir), /imports "\.\/gone\.js"/);
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
