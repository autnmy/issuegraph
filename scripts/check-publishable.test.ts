/**
 * Tests for the publish-staleness guard's decision logic.
 *
 * Everything here is the pure half — the shell that packs, fetches and reports
 * is deliberately not exercised, so these run offline and in-process.
 *
 * The cases that matter most are the two that fail OPEN if written carelessly:
 * a registry that could not be reached must not read as "not published", and a
 * dependency-key reordering must not read as a content change. The first ships
 * the defect the guard exists to catch; the second gets the guard switched off.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  admitsVersion,
  diffTarballContents,
  isBlocking,
  normalizeManifest,
  standingFor,
  unresolvableConsumers,
  type TarballContents,
} from './check-publishable.ts';

const payload = (entries: Record<string, string>): TarballContents =>
  new Map(Object.entries(entries).map(([path, text]) => [path, Buffer.from(text, 'utf8')]));

test('normalizeManifest makes key order irrelevant and value changes visible', () => {
  const a = '{"dependencies":{"yaml":"^2.9.0","zod":"^3.0.0"}}';
  const b = '{"dependencies":{"zod":"^3.0.0","yaml":"^2.9.0"}}';
  assert.equal(normalizeManifest(a), normalizeManifest(b));

  // The control in the other direction: a REORDERING is invisible, a REVALUING
  // is not. Without this the first assertion is satisfied by a function that
  // returns a constant. Third-party names deliberately — a SIBLING range is
  // blanked as derived, so using one here would make the control vacuous.
  const c = '{"dependencies":{"yaml":"^2.10.0","zod":"^3.0.0"}}';
  assert.notEqual(normalizeManifest(a), normalizeManifest(c));
});

test('normalizeManifest sorts nested keys, not just the top level', () => {
  const a = '{"exports":{".":{"types":"./d.ts","default":"./i.js"}}}';
  const b = '{"exports":{".":{"default":"./i.js","types":"./d.ts"}}}';
  assert.equal(normalizeManifest(a), normalizeManifest(b));
});

test('normalizeManifest preserves array order, which is meaning rather than spelling', () => {
  // `files` and `keywords` are ordered lists; sorting them would hide a real
  // edit. Only OBJECT keys are unordered in JSON.
  const a = '{"files":["dist","LICENSE"]}';
  const b = '{"files":["LICENSE","dist"]}';
  assert.notEqual(normalizeManifest(a), normalizeManifest(b));
});

test('diffTarballContents reports a changed dist file', () => {
  const differences = diffTarballContents(
    payload({ 'dist/index.js': 'export const a = 1;', 'package.json': '{}' }),
    payload({ 'dist/index.js': 'export const a = 2;', 'package.json': '{}' }),
  );
  assert.deepEqual(differences, ['dist/index.js']);
});

test('diffTarballContents ignores a manifest that differs only in key order', () => {
  const differences = diffTarballContents(
    payload({ 'package.json': '{"a":1,"b":2}' }),
    payload({ 'package.json': '{"b":2,"a":1}' }),
  );
  assert.deepEqual(differences, []);
});

test('diffTarballContents reports a manifest whose values actually changed', () => {
  const differences = diffTarballContents(
    payload({ 'package.json': '{"version":"0.1.1"}' }),
    payload({ 'package.json': '{"version":"0.1.0"}' }),
  );
  assert.deepEqual(differences, ['package.json (manifest content differs)']);
});

test('diffTarballContents reports files present on only one side, naming which', () => {
  const differences = diffTarballContents(
    payload({ 'dist/new.js': 'x' }),
    payload({ 'dist/gone.js': 'y' }),
  );
  assert.deepEqual(differences, [
    'dist/gone.js (only in the published tarball)',
    'dist/new.js (only in the local pack)',
  ]);
});

test('diffTarballContents compares sourcemaps like any other shipped file', () => {
  // A sourcemap carries `sourcesContent`, so a change visible only there is
  // still a change to what a consumer downloads. Excusing it would let a source
  // edit ship under an unbumped version, which is this guard's whole subject.
  const differences = diffTarballContents(
    payload({ 'dist/index.js.map': '{"sourcesContent":["const a = 1;"]}' }),
    payload({ 'dist/index.js.map': '{"sourcesContent":["const a = 2;"]}' }),
  );
  assert.deepEqual(differences, ['dist/index.js.map']);
});

test('standingFor: a version absent from the registry is new', () => {
  assert.deepEqual(standingFor(['0.1.0'], '0.1.1', undefined), { kind: 'new' });
});

test('standingFor: a package with no published versions at all is new', () => {
  assert.deepEqual(standingFor([], '0.1.0', undefined), { kind: 'new' });
});

test('standingFor: identical content on a published version is unchanged', () => {
  const same = payload({ 'dist/index.js': 'export const a = 1;' });
  assert.deepEqual(standingFor(['0.1.0'], '0.1.0', { local: same, published: same }), {
    kind: 'unchanged',
  });
});

test('standingFor: changed content on a published version is stale', () => {
  const standing = standingFor(['0.1.0'], '0.1.0', {
    local: payload({ 'dist/index.js': 'export const isRefId = () => true;' }),
    published: payload({ 'dist/index.js': 'export const a = 1;' }),
  });
  assert.equal(standing.kind, 'stale');
  assert.deepEqual(standing.kind === 'stale' ? standing.differences : undefined, ['dist/index.js']);
});

test('standingFor: an unreachable registry is unknown, NEVER new', () => {
  // The fail-open this exists to prevent: reading a transport failure as
  // absence would publish-skip exactly the change the guard was added for, at
  // the moment the network is the reason nobody can see the conflict.
  const standing = standingFor({ unreachable: 'ETIMEDOUT' }, '0.1.0', undefined);
  assert.equal(standing.kind, 'unknown');
  assert.match(standing.kind === 'unknown' ? standing.reason : '', /ETIMEDOUT/);
});

test('standingFor: a published version whose tarball could not be read is unknown', () => {
  const standing = standingFor(['0.1.0'], '0.1.0', undefined);
  assert.equal(standing.kind, 'unknown');
});

test('isBlocking fails on stale and unknown, and only on those', () => {
  const finding = (standing: ReturnType<typeof standingFor>) => ({ name: '@x/y', version: '0.1.0', standing });
  assert.equal(isBlocking(finding({ kind: 'new' })), false);
  assert.equal(isBlocking(finding({ kind: 'unchanged' })), false);
  assert.equal(isBlocking(finding({ kind: 'stale', differences: ['dist/index.js'] })), true);
  assert.equal(isBlocking(finding({ kind: 'unknown', reason: 'ETIMEDOUT' })), true);
});

test('normalizeManifest ignores a sibling range, which pnpm derives rather than an author writing it', () => {
  const a = '{"dependencies":{"@issuegraph/core":"^0.1.0"}}';
  const b = '{"dependencies":{"@issuegraph/core":"^0.1.1"}}';
  assert.equal(normalizeManifest(a), normalizeManifest(b));
});

test('normalizeManifest still reports a sibling dependency being ADDED or REMOVED', () => {
  // The reason the range is blanked rather than the key deleted: gaining or
  // losing a dependency is authored, and deleting the key would hide it.
  const withDep = '{"dependencies":{"@issuegraph/core":"^0.1.0"}}';
  const without = '{"dependencies":{}}';
  assert.notEqual(normalizeManifest(withDep), normalizeManifest(without));
});

test('normalizeManifest does NOT blank a third-party range', () => {
  // `yaml` is a real external dependency; its range is authored, and a change
  // to it is a change to what a consumer installs.
  const a = '{"dependencies":{"yaml":"^2.9.0"}}';
  const b = '{"dependencies":{"yaml":"^2.10.0"}}';
  assert.notEqual(normalizeManifest(a), normalizeManifest(b));
});

test('admitsVersion: a caret on 0.x pins the MINOR — the rule the whole fix turns on', () => {
  assert.equal(admitsVersion('^0.1.0', '0.1.1'), true);
  assert.equal(admitsVersion('^0.1.0', '0.1.0'), true);
  assert.equal(admitsVersion('^0.1.0', '0.2.0'), false);
  assert.equal(admitsVersion('^0.1.0', '1.0.0'), false);
  assert.equal(admitsVersion('^0.1.2', '0.1.1'), false);
});

test('admitsVersion: a caret on 1.x pins the MAJOR', () => {
  assert.equal(admitsVersion('^1.2.0', '1.3.0'), true);
  assert.equal(admitsVersion('^1.2.0', '1.2.0'), true);
  assert.equal(admitsVersion('^1.2.0', '2.0.0'), false);
  assert.equal(admitsVersion('^1.2.3', '1.2.2'), false);
});

test('admitsVersion: a caret on 0.0.x pins the PATCH', () => {
  assert.equal(admitsVersion('^0.0.3', '0.0.3'), true);
  assert.equal(admitsVersion('^0.0.3', '0.0.4'), false);
});

test('admitsVersion: an exact range admits only itself', () => {
  assert.equal(admitsVersion('0.1.0', '0.1.0'), true);
  assert.equal(admitsVersion('0.1.0', '0.1.1'), false);
});

test('admitsVersion: a shape outside the allowlist is undefined, never a guess', () => {
  // Undefined is what makes the caller fail closed. Returning `true` for an
  // unparsed range is the answer that ships the bug; returning `false` would
  // block correct releases. Neither is available, so the guard declines.
  for (const range of ['~0.1.0', '>=0.1.0 <0.3.0', '0.1.x', '*', 'workspace:^', '']) {
    assert.equal(admitsVersion(range, '0.1.1'), undefined, `${range} should not be judged`);
  }
  assert.equal(admitsVersion('^0.1.0', '0.1.1-beta.1'), undefined);
});

test('unresolvableConsumers: a patch bump strands nobody', () => {
  const published = [
    { name: '@issuegraph/reader', version: '0.2.0', dependencies: { '@issuegraph/core': '^0.1.0' } },
  ];
  assert.deepEqual(unresolvableConsumers(published, { '@issuegraph/core': '0.1.1' }), []);
});

test('unresolvableConsumers: a MINOR bump strands every published consumer', () => {
  // The plausible-but-wrong fix for #36 — adding exports reads as a minor — and
  // the reason this check exists at all.
  const published = [
    { name: '@issuegraph/reader', version: '0.2.0', dependencies: { '@issuegraph/core': '^0.1.0' } },
    { name: '@issuegraph/writer', version: '0.1.0', dependencies: { '@issuegraph/core': '^0.1.0' } },
  ];
  const stranded = unresolvableConsumers(published, { '@issuegraph/core': '0.2.0' });
  assert.equal(stranded.length, 2);
  assert.deepEqual(
    stranded.map((f) => f.consumer),
    ['@issuegraph/reader', '@issuegraph/writer'],
  );
  assert.equal(stranded[0]?.admits, false);
});

test('unresolvableConsumers: a consumer being republished is not stranded', () => {
  // Its new manifest goes up with the release, so its old range stops mattering.
  const published = [
    { name: '@issuegraph/reader', version: '0.2.0', dependencies: { '@issuegraph/core': '^0.1.0' } },
  ];
  const releasing = { '@issuegraph/core': '0.2.0', '@issuegraph/reader': '0.3.0' };
  assert.deepEqual(unresolvableConsumers(published, releasing), []);
});

test('unresolvableConsumers: an unjudgeable range is reported, not waved through', () => {
  const published = [
    { name: '@issuegraph/reader', version: '0.2.0', dependencies: { '@issuegraph/core': '~0.1.0' } },
  ];
  const stranded = unresolvableConsumers(published, { '@issuegraph/core': '0.1.1' });
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0]?.admits, undefined);
});

test('unresolvableConsumers: a third-party dependency is not this guard s business', () => {
  const published = [
    { name: '@issuegraph/reader', version: '0.2.0', dependencies: { yaml: '^2.9.0' } },
  ];
  assert.deepEqual(unresolvableConsumers(published, { yaml: '3.0.0' }), []);
});

test('unresolvableConsumers: a sibling that is not being released cannot strand anybody', () => {
  const published = [
    { name: '@issuegraph/reader', version: '0.2.0', dependencies: { '@issuegraph/core': '^0.1.0' } },
  ];
  assert.deepEqual(unresolvableConsumers(published, {}), []);
});

test('the guard would have caught #36: core gaining an export without a bump', () => {
  // The regression this whole file exists for, stated as the scenario rather
  // than as a unit: `@issuegraph/core@0.1.0` gained `isRefId`, its version did
  // not move, and `pnpm publish -r` skipped it.
  const standing = standingFor(['0.1.0'], '0.1.0', {
    local: payload({
      'dist/index.js': 'export { isEvidence, isRefId, isRepoQualifier };',
      'package.json': '{"name":"@issuegraph/core","version":"0.1.0"}',
    }),
    published: payload({
      'dist/index.js': 'export { isEvidence };',
      'package.json': '{"name":"@issuegraph/core","version":"0.1.0"}',
    }),
  });
  assert.equal(standing.kind, 'stale');

  // And the fix clears it: with the version bumped, the same tree is `new`.
  assert.deepEqual(standingFor(['0.1.0'], '0.1.1', undefined), { kind: 'new' });
});
