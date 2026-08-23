/**
 * The consumer smoke test.
 *
 * Everything else in this repository runs TypeScript SOURCE on a modern Node.
 * This loads the BUILT artifact, on the floor the published manifest declares —
 * so `engines.node` stops being a compatibility claim no instrument measured.
 *
 * Plain `.mjs` on purpose: the floor is older than Node's native type stripping,
 * so a `.ts` smoke test could not run there at all.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

/** The major version a `>=X` / `^X` style engines range starts at. */
export function declaredFloorMajor(range) {
  const found = /(\d+)/.exec(range ?? '');
  return found ? Number(found[1]) : undefined;
}

/** Every file an `exports` map points at, however deeply it is nested. */
function exportTargets(node, found = []) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) found.push(node);
    return found;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) exportTargets(value, found);
  }
  return found;
}

/**
 * Why a module that PARSED could still not be loaded by Node.
 *
 * These three prove the entry was read and understood: a bad extension fails
 * while LINKING an import the entry declared, and a `ReferenceError` happens
 * while EXECUTING it. A `SyntaxError` is the opposite — it proves the file was
 * never valid — so it is deliberately absent and always fails.
 */
const NOT_RUNNABLE_IN_NODE = new Map([
  ['ERR_UNKNOWN_FILE_EXTENSION', 'imports an asset Node cannot load'],
  ['ERR_MODULE_NOT_FOUND', 'imports a module not resolvable from Node'],
]);

function whyNotRunnable(error) {
  if (error instanceof SyntaxError) return undefined;
  if (error instanceof ReferenceError) return 'uses a browser global at module scope';
  return NOT_RUNNABLE_IN_NODE.get(error?.code);
}

/**
 * Smoke-test every package under `packagesDir`. Returns one result per package.
 *
 * A package that declares `engines.node` is held to BOTH checks: this process
 * must be running that floor, and the built entry must load in it. A package
 * that declares none is not exempt from being checked — it is exempt from
 * claiming a Node floor, and it still has to PARSE. The difference between the
 * two is reported per package rather than left silent, because a check that
 * quietly weakens is indistinguishable from one that passed.
 */
export async function smokeTest(packagesDir, { log = () => {} } = {}) {
  const results = [];
  const runningMajor = Number(process.versions.node.split('.')[0]);

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const targets = exportTargets(manifest.exports);
    assert.ok(targets.length > 0, `${manifest.name} declares no exports; a consumer has nothing to import`);

    for (const target of targets) {
      assert.ok(
        existsSync(join(dir, target)),
        `${manifest.name}: exports names "${target}", which the build did not produce`,
      );
    }

    const runtime = manifest.exports?.['.']?.default ?? manifest.main;
    assert.ok(runtime, `${manifest.name} declares no runtime entry`);

    const floor = declaredFloorMajor(manifest.engines?.node);
    if (floor !== undefined) {
      assert.equal(
        runningMajor,
        floor,
        `${manifest.name} declares node >=${floor} but this smoke test is running on ${process.version}. ` +
          'Run it on the declared floor, or change the floor — testing a newer runtime proves nothing about the older one.',
      );
    }

    let loaded;
    let downgraded;
    try {
      loaded = await import(pathToFileURL(join(dir, runtime)).href);
    } catch (error) {
      const why = whyNotRunnable(error);
      // A package that CLAIMS a Node floor must load on it. Only a package
      // making no such claim may fall back to the parse-only check.
      if (why === undefined || floor !== undefined) throw error;
      downgraded = why;
    }

    if (downgraded === undefined) {
      assert.ok(Object.keys(loaded).length > 0, `${manifest.name} loaded but exported nothing`);
      log(`ok    ${manifest.name}  ${runtime}  loaded, ${Object.keys(loaded).length} exports, node ${process.version}`);
    } else {
      log(`parse ${manifest.name}  ${runtime}  parsed but not run here — ${downgraded}`);
    }
    results.push({ name: manifest.name, entry: runtime, check: downgraded === undefined ? 'loaded' : 'parsed', downgraded });
  }

  assert.ok(results.length > 0, 'no packages were smoke-tested; this job proved nothing');
  return results;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const packagesDir = fileURLToPath(new URL('../packages', import.meta.url));
  const results = await smokeTest(packagesDir, { log: (line) => console.log(line) });
  const loaded = results.filter((r) => r.check === 'loaded').length;
  console.log(`smoke: ${results.length} package(s) on node ${process.version} — ${loaded} loaded, ${results.length - loaded} parse-only`);
}
