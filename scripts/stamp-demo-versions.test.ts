import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { STAMPED_PACKAGES, readVersions, renderVersionsModule } from './stamp-demo-versions.ts';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(manifests: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-stamp-'));
  roots.push(root);
  for (const [name, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify(manifest));
  }
  return root;
}

function allManifests(version: (name: string) => unknown): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    STAMPED_PACKAGES.map((name) => [name, { name: `@issuegraph/${name}`, version: version(name) }]),
  );
}

describe('readVersions reads the manifests the page loads', () => {
  it('returns every stamped package version from the real workspace', () => {
    const versions = readVersions(repoRoot);
    for (const name of STAMPED_PACKAGES) {
      const manifest: unknown = JSON.parse(
        readFileSync(join(repoRoot, 'packages', name, 'package.json'), 'utf8'),
      );
      assert.ok(typeof manifest === 'object' && manifest !== null);
      assert.equal(versions[name], Reflect.get(manifest, 'version'));
    }
  });

  it('refuses a manifest that names a different package', () => {
    const root = fixture({
      ...allManifests(() => '1.0.0'),
      viewer: { name: '@issuegraph/not-the-viewer', version: '1.0.0' },
    });
    assert.throws(() => readVersions(root), /packages\/viewer\/package\.json names/);
  });

  it('refuses a manifest with no version, rather than stamping "undefined"', () => {
    const root = fixture({ ...allManifests(() => '1.0.0'), core: { name: '@issuegraph/core' } });
    assert.throws(() => readVersions(root), /packages\/core\/package\.json has no version/);
  });
});

describe('renderVersionsModule emits a module the demo can import', () => {
  it('names each package once, in stamping order, with its version', () => {
    const module = renderVersionsModule(readVersions(fixture(allManifests((name) => `9.${name.length}.0`))));
    assert.match(module, /^\/\/ GENERATED/);
    assert.match(module, /export const VERSIONS/);
    for (const name of STAMPED_PACKAGES) {
      assert.match(module, new RegExp(`"${name}": "9\\.${String(name.length)}\\.0",`));
    }
    const order = STAMPED_PACKAGES.map((name) => module.indexOf(`"${name}": `));
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'the stamp order is the declared order');
  });
});
