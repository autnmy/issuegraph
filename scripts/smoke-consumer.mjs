/**
 * The consumer smoke test.
 *
 * Everything else in this repository runs TypeScript SOURCE on a modern Node.
 * Nothing loaded the built artifact, and nothing ran on the floor the published
 * manifests declare — so `engines.node` was a compatibility claim no instrument
 * had ever measured. A future export using an API absent from that floor would
 * have passed every job and shipped as compatible.
 *
 * So this runs on the OLDEST supported Node, in CI, and it deliberately loads
 * `dist` through the entry each manifest declares rather than importing source:
 * that also makes a broken `exports` map — a path pointing at a file the build
 * does not produce — a failure rather than something a consumer discovers.
 *
 * Plain `.mjs` on purpose: the floor is older than Node's native type stripping,
 * so a `.ts` smoke test could not run there at all.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const packagesDir = fileURLToPath(new URL('../packages', import.meta.url));

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

/** The major version a `>=X` / `^X` style engines range starts at. */
function declaredFloorMajor(range) {
  const found = /(\d+)/.exec(range ?? '');
  return found ? Number(found[1]) : undefined;
}

const runningMajor = Number(process.versions.node.split('.')[0]);
let checked = 0;

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(packagesDir, entry.name);
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) continue;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const targets = exportTargets(manifest.exports);
  assert.ok(
    targets.length > 0,
    `${manifest.name} declares no exports; a consumer has nothing to import`,
  );

  // Every declared target must EXIST. A `types` path that the build stopped
  // emitting is invisible to a runtime import, and breaks every typed consumer.
  for (const target of targets) {
    const resolved = join(dir, target);
    assert.ok(existsSync(resolved), `${manifest.name}: exports names "${target}", which the build did not produce`);
  }

  // The job must be RUNNING on the floor this package declares. Without this the
  // workflow's node version and the manifest's `engines` drift apart silently,
  // and the smoke test goes on passing while testing a version nobody promised
  // — which is the same unmeasured claim this file exists to end, one level up.
  const floor = declaredFloorMajor(manifest.engines?.node);
  assert.ok(floor !== undefined, `${manifest.name} declares no engines.node, so there is no floor to test`);
  assert.equal(
    runningMajor,
    floor,
    `${manifest.name} declares node >=${floor} but this smoke test is running on ${process.version}. ` +
      'Run it on the declared floor, or change the floor — testing a newer runtime proves nothing about the older one.',
  );

  // And the runtime entry must LOAD on this Node, which is the whole point of
  // running this job on the declared floor.
  const runtime = manifest.exports?.['.']?.default ?? manifest.main;
  assert.ok(runtime, `${manifest.name} declares no runtime entry`);
  const loaded = await import(pathToFileURL(join(dir, runtime)).href);
  assert.ok(
    Object.keys(loaded).length > 0,
    `${manifest.name} loaded but exported nothing`,
  );

  console.log(`ok  ${manifest.name}  ${runtime}  (${Object.keys(loaded).length} exports, node ${process.version})`);
  checked += 1;
}

// A loop over an empty directory passes silently, which would make this job a
// green light that looked at nothing.
assert.ok(checked > 0, 'no packages were smoke-tested; this job proved nothing');
console.log(`smoke: ${checked} package(s) loaded from dist on node ${process.version}`);
