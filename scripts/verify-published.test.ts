/**
 * Tests for the post-publish verification's decision logic.
 *
 * Everything here is the pure half — the shell that installs, imports and runs
 * the binary is deliberately not exercised, so these run offline and
 * in-process. The halves that can only be exercised against a real registry are
 * the ones the script keeps smallest.
 *
 * The cases that matter most are the ones that fail OPEN if written carelessly:
 * a second nested copy of a package must not vanish behind an intended one, an
 * absent package must not read as propagation and burn every retry, and a
 * release must not verify vacuously when the publishable set is empty. Each of
 * those ships the defect the check exists to catch.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import {
  acceptanceFailures,
  collectInstances,
  intendedPackages,
  pinnedSpecs,
  reconcile,
  registryStanding,
  WORKSPACE_SCOPE,
  type Instance,
  type IntendedPackage,
} from './verify-published.ts';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A `packages/` directory holding the given manifests. */
function packagesFixture(manifests: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-verify-test-'));
  roots.push(root);
  const packagesDir = join(root, 'packages');
  for (const [dir, manifest] of Object.entries(manifests)) {
    mkdirSync(join(packagesDir, dir), { recursive: true });
    writeFileSync(join(packagesDir, dir, 'package.json'), JSON.stringify(manifest, null, 2));
  }
  mkdirSync(packagesDir, { recursive: true });
  return packagesDir;
}

const intended = (entries: Record<string, string>): readonly IntendedPackage[] =>
  Object.entries(entries).map(([name, version]) => ({ name, version }));

// ---------------------------------------------------------------- intended set

test('intendedPackages reads the name and version each manifest declares', () => {
  const dir = packagesFixture({
    core: { name: '@issuegraph/core', version: '0.1.1' },
    cli: { name: '@issuegraph/cli', version: '0.2.0' },
  });
  assert.deepEqual(
    [...intendedPackages(dir)].sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: '@issuegraph/cli', version: '0.2.0' },
      { name: '@issuegraph/core', version: '0.1.1' },
    ],
  );
});

test('intendedPackages skips a private package, which is never uploaded', () => {
  const dir = packagesFixture({
    core: { name: '@issuegraph/core', version: '0.1.1' },
    internal: { name: '@issuegraph/internal', version: '0.0.0', private: true },
  });
  assert.deepEqual(intendedPackages(dir).map((p) => p.name), ['@issuegraph/core']);
});

test('REQUIREMENT 6: the set is every publishable package, not the CLI dependency graph', () => {
  // `@issuegraph/store` is not a CLI dependency. A store-only release verified
  // through the CLI installs an unchanged CLI, sees no mismatch for the absent
  // store, and reports success — the exact hole #37 left. So the set has to be
  // derived from the manifests, never walked from the CLI's dependencies.
  const dir = packagesFixture({
    cli: { name: '@issuegraph/cli', version: '0.1.1', dependencies: { '@issuegraph/core': 'workspace:^' } },
    core: { name: '@issuegraph/core', version: '0.1.1' },
    store: { name: '@issuegraph/store', version: '0.1.0' },
  });
  assert.ok(intendedPackages(dir).some((p) => p.name === '@issuegraph/store'));
});

test('CONTROL: the real workspace yields every package it publishes', () => {
  // Guards the fixtures above against drifting from the repository they model —
  // and pins the two packages outside the CLI's graph by name, since those are
  // the ones a CLI-rooted walk would silently drop.
  const dir = join(import.meta.dirname, '..', 'packages');
  const names = intendedPackages(dir).map((p) => p.name);
  for (const expected of ['@issuegraph/store', '@issuegraph/viewer', '@issuegraph/cli', '@issuegraph/core']) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  for (const name of names) assert.ok(name.startsWith(WORKSPACE_SCOPE), `${name} is outside the scope`);
});

// ------------------------------------------------------------------- pinning

test('REQUIREMENT 1: specs are pinned, never the bare name', () => {
  const specs = pinnedSpecs(intended({ '@issuegraph/core': '0.1.1', '@issuegraph/cli': '0.2.0' }));
  assert.deepEqual(specs, ['@issuegraph/core@0.1.1', '@issuegraph/cli@0.2.0']);
  // The control: a bare name would resolve the `latest` tag, so an older
  // WORKING package installs and the check reports a false green having never
  // exercised the release that shipped.
  for (const spec of specs) assert.match(spec, /@\d+\.\d+\.\d+$/);
});

// ---------------------------------------------------------------- tree walk

test('collectInstances finds a package nested under another', () => {
  const tree = {
    dependencies: {
      '@issuegraph/cli': { version: '0.1.1', dependencies: { '@issuegraph/core': { version: '0.1.1' } } },
    },
  };
  assert.deepEqual(collectInstances(tree), [
    { name: '@issuegraph/cli', version: '0.1.1', path: '@issuegraph/cli' },
    { name: '@issuegraph/core', version: '0.1.1', path: '@issuegraph/cli > @issuegraph/core' },
  ]);
});

test('REQUIREMENT 3: every copy is kept, not one per name', () => {
  // npm nests a second copy when two branches need incompatible ranges. A
  // name-keyed map is last-write-wins, so the stale copy vanishes behind the
  // intended one and the check passes while a real code path still loads it.
  const tree = {
    dependencies: {
      '@issuegraph/core': { version: '0.1.1' },
      '@issuegraph/reader': {
        version: '0.2.0',
        dependencies: { '@issuegraph/core': { version: '0.1.0' } },
      },
    },
  };
  const found = collectInstances(tree);
  const cores = found.filter((i) => i.name === '@issuegraph/core');
  assert.equal(cores.length, 2, 'both copies of core must survive the walk');
  assert.deepEqual(
    cores.map((c) => c.version).sort(),
    ['0.1.0', '0.1.1'],
  );
});

test('collectInstances records the dependency path, so a mismatch says WHICH branch', () => {
  const tree = {
    dependencies: {
      '@issuegraph/cli': {
        version: '0.1.1',
        dependencies: { '@issuegraph/reader': { version: '0.2.0', dependencies: { '@issuegraph/core': { version: '0.1.0' } } } },
      },
    },
  };
  const core = collectInstances(tree).find((i) => i.name === '@issuegraph/core');
  assert.equal(core?.path, '@issuegraph/cli > @issuegraph/reader > @issuegraph/core');
});

test('collectInstances ignores packages outside the workspace scope', () => {
  const tree = { dependencies: { yaml: { version: '2.9.0' }, '@issuegraph/core': { version: '0.1.1' } } };
  assert.deepEqual(collectInstances(tree).map((i) => i.name), ['@issuegraph/core']);
});

test('collectInstances terminates on a cyclic tree', () => {
  const cyclic: Record<string, unknown> = { version: '0.1.1' };
  cyclic.dependencies = { '@issuegraph/core': cyclic };
  const found = collectInstances({ dependencies: { '@issuegraph/core': cyclic } });
  assert.ok(found.length >= 1);
  assert.ok(found.every((i) => i.name === '@issuegraph/core'));
});

test('collectInstances marks a node npm could not resolve, rather than dropping it', () => {
  // No `version` field is what an unresolved node looks like. Dropping it would
  // let a package npm failed to place read as simply absent from the tree.
  const found = collectInstances({ dependencies: { '@issuegraph/core': { required: '0.1.1' } } });
  assert.deepEqual(found, [{ name: '@issuegraph/core', version: '<unresolved>', path: '@issuegraph/core' }]);
});

// ------------------------------------------------------------------ reconcile

test('reconcile: the intended tree matches', () => {
  const instances: Instance[] = [{ name: '@issuegraph/core', version: '0.1.1', path: '@issuegraph/core' }];
  assert.deepEqual(reconcile(instances, intended({ '@issuegraph/core': '0.1.1' })), { kind: 'match' });
});

test('REQUIREMENT 4: a stale copy is PROPAGATING, so it is retried', () => {
  const instances: Instance[] = [{ name: '@issuegraph/core', version: '0.1.0', path: '@issuegraph/core' }];
  const verdict = reconcile(instances, intended({ '@issuegraph/core': '0.1.1' }));
  assert.equal(verdict.kind, 'propagating');
  assert.ok(verdict.kind === 'propagating');
  assert.equal(verdict.stale[0]?.version, '0.1.0');
});

test('REQUIREMENT 4: an ABSENT package is not propagation, so it is NOT retried', () => {
  // The install succeeded, so npm built a tree it considers complete. Waiting
  // does not add a package to it. Reading this as propagation would burn every
  // attempt on a store-only release and then fail for the wrong reason.
  const instances: Instance[] = [{ name: '@issuegraph/core', version: '0.1.1', path: '@issuegraph/core' }];
  const verdict = reconcile(instances, intended({ '@issuegraph/core': '0.1.1', '@issuegraph/store': '0.1.0' }));
  assert.equal(verdict.kind, 'absent');
  assert.ok(verdict.kind === 'absent');
  assert.deepEqual(verdict.names, ['@issuegraph/store']);
});

test('reconcile reports a stale copy even when another copy is correct', () => {
  // The last-write-wins failure again, one level up: the correct root copy must
  // not excuse the stale nested one.
  const instances: Instance[] = [
    { name: '@issuegraph/core', version: '0.1.1', path: '@issuegraph/core' },
    { name: '@issuegraph/core', version: '0.1.0', path: '@issuegraph/reader > @issuegraph/core' },
  ];
  const verdict = reconcile(instances, intended({ '@issuegraph/core': '0.1.1' }));
  assert.equal(verdict.kind, 'propagating');
  assert.ok(verdict.kind === 'propagating');
  assert.equal(verdict.stale.length, 1);
  assert.equal(verdict.stale[0]?.path, '@issuegraph/reader > @issuegraph/core');
});

test('reconcile ignores a scope package the release does not publish', () => {
  // A future package installed as a transitive dependency but not part of this
  // release has no intended version, so it can be neither stale nor absent.
  const instances: Instance[] = [
    { name: '@issuegraph/core', version: '0.1.1', path: '@issuegraph/core' },
    { name: '@issuegraph/unrelated', version: '9.9.9', path: '@issuegraph/unrelated' },
  ];
  assert.deepEqual(reconcile(instances, intended({ '@issuegraph/core': '0.1.1' })), { kind: 'match' });
});

test('reconcile: an unresolved node reads as stale, never as a match', () => {
  const instances: Instance[] = [{ name: '@issuegraph/core', version: '<unresolved>', path: '@issuegraph/core' }];
  assert.equal(reconcile(instances, intended({ '@issuegraph/core': '0.1.1' })).kind, 'propagating');
});

// ----------------------------------------------------------- registry standing

test('registryStanding names the versions the registry does not carry', () => {
  // The message this replaces was npm's own last stderr line — which is the
  // debug-log path, so a run whose only problem was an unpublished viewer said
  // "A complete log of this run can be found in: ..." five times and never
  // named the package. Measured against the real registry.
  const standing = registryStanding(
    intended({ '@issuegraph/core': '0.1.1', '@issuegraph/viewer': '0.1.0' }),
    (name) => (name === '@issuegraph/viewer' ? [] : ['0.1.0', '0.1.1']),
  );
  assert.deepEqual(standing.missing, ['@issuegraph/viewer@0.1.0']);
  assert.deepEqual(standing.unreachable, []);
});

test('registryStanding: every intended version present is an EMPTY standing', () => {
  // The control, and the one that decides the retry: empty missing plus a
  // failed install means nothing is propagating, so the failure is a defect.
  const standing = registryStanding(
    intended({ '@issuegraph/core': '0.1.1' }),
    () => ['0.1.0', '0.1.1'],
  );
  assert.deepEqual(standing.missing, []);
  assert.deepEqual(standing.unreachable, []);
});

test('registryStanding: an unreachable registry is neither present NOR missing', () => {
  // Folding it into `missing` reports a network blip as an unpublished package;
  // folding it into present clears a release nobody could verify.
  const standing = registryStanding(
    intended({ '@issuegraph/core': '0.1.1' }),
    () => ({ unreachable: 'ETIMEDOUT' }),
  );
  assert.deepEqual(standing.missing, []);
  assert.deepEqual(standing.unreachable, ['@issuegraph/core']);
});

test('registryStanding reports a package published at OTHER versions but not this one', () => {
  // The version is what matters, not the name: a package whose previous release
  // is on the registry still has not propagated THIS one.
  const standing = registryStanding(
    intended({ '@issuegraph/core': '0.2.0' }),
    () => ['0.1.0', '0.1.1'],
  );
  assert.deepEqual(standing.missing, ['@issuegraph/core@0.2.0']);
});

// ----------------------------------------------------------------- acceptance

test('acceptanceFailures: a clean import and a clean CLI run report nothing', () => {
  const probes = [
    { name: '@issuegraph/core', ok: true },
    { name: '@issuegraph/cli', ok: true },
  ];
  assert.deepEqual(acceptanceFailures(probes, { ok: true, detail: 'exit 0, state absent' }), []);
});

test('acceptanceFailures names the package that failed to import — #36 exactly', () => {
  const probes = [
    { name: '@issuegraph/core', ok: true },
    { name: '@issuegraph/reader', ok: false, error: "The requested module does not provide an export named 'isRefId'" },
  ];
  const failures = acceptanceFailures(probes, { ok: true, detail: 'exit 0, state absent' });
  assert.equal(failures.length, 1);
  assert.match(failures[0] ?? '', /@issuegraph\/reader does not import/);
  assert.match(failures[0] ?? '', /isRefId/);
});

test('acceptanceFailures reports a broken BINARY even when every import is clean', () => {
  // #36 broke both surfaces. A check that only imported would have reported a
  // green on a release whose every invocation exited 1.
  const probes = [{ name: '@issuegraph/cli', ok: true }];
  const failures = acceptanceFailures(probes, { ok: false, detail: 'exited 1: Cannot find package' });
  assert.deepEqual(failures, ['issuegraph parse: exited 1: Cannot find package']);
});

test('acceptanceFailures reports import AND binary failures together', () => {
  const probes = [{ name: '@issuegraph/reader', ok: false, error: 'boom' }];
  assert.equal(acceptanceFailures(probes, { ok: false, detail: 'exited 1' }).length, 2);
});

test('acceptanceFailures still reports an import failure carrying no error text', () => {
  const failures = acceptanceFailures([{ name: '@issuegraph/core', ok: false }], { ok: true, detail: 'ok' });
  assert.equal(failures.length, 1);
  assert.match(failures[0] ?? '', /unknown/);
});
