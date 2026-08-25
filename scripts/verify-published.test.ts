/**
 * Tests for the post-publish verification's retry decision.
 *
 * The pure half only, so these run offline: `mismatches` is what separates
 * "the registry has not caught up" — retry — from "this is the release we
 * published and it is broken" — fail immediately. Getting that split wrong
 * fails in both directions: retrying a real defect waits for a broken release
 * to look fixed, and not retrying propagation reds a correct one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mismatches } from './verify-published.ts';

const INTENDED = {
  '@issuegraph/cli': '0.1.0',
  '@issuegraph/core': '0.1.1',
  '@issuegraph/reader': '0.2.0',
};

test('a tree matching the intended release has no mismatches', () => {
  assert.deepEqual(
    mismatches({ '@issuegraph/cli': '0.1.0', '@issuegraph/core': '0.1.1' }, INTENDED),
    [],
  );
});

test('a nested dependency still being served stale IS a mismatch', () => {
  // The core-only release: the CLI installs fine at its unchanged version while
  // `core` is still the pre-release one. Reading this as "installed, so verify
  // it" turns a propagation delay into a red on a correct release.
  const found = mismatches({ '@issuegraph/cli': '0.1.0', '@issuegraph/core': '0.1.0' }, INTENDED);
  assert.deepEqual(found, [{ name: '@issuegraph/core', resolved: '0.1.0', intended: '0.1.1' }]);
});

test('a stale CLI tag IS a mismatch — the false-green case', () => {
  // If the `latest` tag has not moved, an older working CLI installs and
  // everything passes without exercising the release that just shipped.
  const found = mismatches({ '@issuegraph/cli': '0.0.9' }, INTENDED);
  assert.deepEqual(found, [{ name: '@issuegraph/cli', resolved: '0.0.9', intended: '0.1.0' }]);
});

test('a package the workspace does not declare is not judged', () => {
  // `yaml` is a real transitive dependency and none of this release's business.
  assert.deepEqual(mismatches({ yaml: '2.9.0' }, INTENDED), []);
});

test('a package the workspace declares but the tree does not carry is not a mismatch', () => {
  // Installing the CLI need not pull every workspace package — `store` is not in
  // its dependency graph. Absence is not a wrong version.
  assert.deepEqual(mismatches({ '@issuegraph/cli': '0.1.0' }, INTENDED), []);
});

test('every mismatch is reported, in a stable order', () => {
  const found = mismatches(
    { '@issuegraph/reader': '0.1.0', '@issuegraph/core': '0.1.0' },
    INTENDED,
  );
  assert.deepEqual(
    found.map((p) => p.name),
    ['@issuegraph/core', '@issuegraph/reader'],
  );
});
