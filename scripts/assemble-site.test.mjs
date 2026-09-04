import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import {
  DEMO_FILES,
  ROOT_FILES,
  SITE_PACKAGES,
  assembleSite,
  missingReferences,
  referencedPaths,
} from './assemble-site.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputs = [];
after(() => {
  for (const out of outputs) rmSync(out, { recursive: true, force: true });
});

function fresh(prefix) {
  const out = mkdtempSync(join(tmpdir(), prefix));
  outputs.push(out);
  return out;
}

describe('referencedPaths reads what a page actually asks for', () => {
  it('collects import-map targets and local src/href values, and nothing remote', () => {
    const html = [
      '<script type="importmap">{"imports":{"@issuegraph/store":"/packages/store/dist/index.js","yaml":"/packages/reader/node_modules/yaml/browser/index.js"}}</script>',
      '<link rel="stylesheet" href="./styles.css">',
      '<a href="https://github.com/autnmy/issuegraph">Source</a>',
      '<a href="/">home</a>',
      '<a href="#board">skip</a>',
      '<script type="module" src="./dist/main.js"></script>',
    ].join('\n');
    assert.deepEqual(referencedPaths(html, 'demo/index.html'), [
      '',
      'demo/dist/main.js',
      'demo/styles.css',
      'packages/reader/node_modules/yaml/browser/index.js',
      'packages/store/dist/index.js',
    ]);
  });
});

describe('the assembled site satisfies every reference the pages make', () => {
  // This runs against the REAL built tree: `pnpm run ci` builds before it
  // tests, and the Pages workflow assembles after the same build. A missing
  // dist here means the deploy would ship a page with nothing behind it.
  it('copies the allowlist and every demo reference resolves inside it', () => {
    const out = fresh('issuegraph-site-');
    const copied = assembleSite({ root: repoRoot, out });
    for (const entry of [...ROOT_FILES, ...DEMO_FILES]) assert.ok(copied.includes(entry), entry);
    for (const name of SITE_PACKAGES) assert.ok(copied.includes(`packages/${name}/dist`), name);
    assert.deepEqual(missingReferences(out, 'demo/index.html'), []);
    assert.deepEqual(missingReferences(out, 'index.html'), []);
  });

  it('ships no declaration files and no source outside the allowlist', () => {
    const out = fresh('issuegraph-site-');
    assembleSite({ root: repoRoot, out });
    assert.ok(!existsSync(join(out, 'packages/store/dist/index.d.ts')));
    assert.ok(!existsSync(join(out, 'packages/store/src')));
    assert.ok(!existsSync(join(out, 'demo/src')));
    assert.ok(!existsSync(join(out, 'node_modules')));
  });

  it('follows the pnpm symlink for yaml rather than copying a link', () => {
    const out = fresh('issuegraph-site-');
    assembleSite({ root: repoRoot, out });
    assert.ok(existsSync(join(out, 'packages/reader/node_modules/yaml/browser/index.js')));
    assert.ok(existsSync(join(out, 'packages/reader/node_modules/yaml/package.json')));
  });

  it('refuses a tree whose build has not run', () => {
    const root = fresh('issuegraph-unbuilt-');
    for (const entry of ROOT_FILES) writeFileSync(join(root, entry), '');
    mkdirSync(join(root, 'demo'), { recursive: true });
    assert.throws(() => assembleSite({ root, out: fresh('issuegraph-site-') }), /demo\/index\.html is missing/);
  });

  it('CONTROL: a reference the tree cannot satisfy is reported, not swallowed', () => {
    const out = fresh('issuegraph-site-');
    mkdirSync(join(out, 'demo'), { recursive: true });
    writeFileSync(
      join(out, 'demo/index.html'),
      '<script type="importmap">{"imports":{"x":"/packages/missing/dist/index.js"}}</script><script src="./dist/main.js"></script>',
    );
    assert.deepEqual(missingReferences(out, 'demo/index.html'), [
      'demo/dist/main.js',
      'packages/missing/dist/index.js',
    ]);
  });
});
