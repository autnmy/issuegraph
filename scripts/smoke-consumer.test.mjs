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
  assert.match(result.downgraded, /asset Node cannot load/);
});

test('a browser global at module scope is parsed, not failed', async () => {
  const dir = fixture('document.title = "x";\nexport const a = 1;\n');
  const [result] = await smokeTest(dir);
  assert.equal(result.check, 'parsed');
  assert.match(result.downgraded, /browser global/);
});

test('NOT AN EXEMPTION: broken syntax fails even with no declared floor', async () => {
  // The whole risk of a downgrade is that it becomes a pass for anything. A
  // SyntaxError proves the file was never valid, so it is never tolerated.
  const dir = fixture('export const a = = ;\n');
  await assert.rejects(smokeTest(dir), SyntaxError);
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
