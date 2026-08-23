/**
 * The deliberate-violation proof for the ESLint import rules.
 *
 * A green lint run says nothing on its own — the same green appears when the
 * config never matched a file, when a plugin failed to load, or when a rule was
 * silently dropped from the config. So each rule is exercised against source
 * written to break it, and each case asserts the EXACT rule id that fired.
 *
 * The clean case is the control in the other direction: it proves the fixtures
 * are otherwise valid, so a failing case failed because of the one thing it
 * changed rather than because ESLint could not parse it at all.
 *
 * `.mjs`, like the smoke test, so it does not depend on the TypeScript
 * toolchain it exists partly to lint.
 */

import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

/** The rule ids reported for a source string, as if it lived inside a package. */
async function rulesFor(source) {
  const results = await eslint.lintText(source, {
    filePath: `${repoRoot}packages/core/src/__violation-fixture__.ts`,
  });
  const ids = results.flatMap((result) => result.messages.map((message) => message.ruleId ?? 'PARSE-ERROR'));
  return [...new Set(ids)].sort();
}

test('POSITIVE CONTROL: ordinary imports report nothing', async () => {
  assert.deepEqual(
    await rulesFor("import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n"),
    [],
  );
});

test('CONTROL: the config actually matches this path and parses TypeScript', async () => {
  // If the config matched nothing, every case above and below would pass
  // vacuously. A deliberate syntax error must surface as a parse error.
  const ids = await rulesFor('export const broken: = ;\n');
  assert.deepEqual(ids, ['PARSE-ERROR']);
});

test('a forbidden consumer import is caught', async () => {
  assert.deepEqual(
    await rulesFor("import { parse } from '@descant/types';\nexport const p = parse;\n"),
    ['no-restricted-imports'],
  );
});

test('an unscoped consumer import is caught', async () => {
  assert.deepEqual(
    await rulesFor("import { runner } from 'descant/runner';\nexport const r = runner;\n"),
    ['no-restricted-imports'],
  );
});

test('a static absolute path is caught', async () => {
  assert.deepEqual(
    await rulesFor("import '/home/runner/work/consumer/private.js';\nexport const a = 1;\n"),
    ['import-x/no-absolute-path'],
  );
});

test('a DYNAMIC absolute path is caught — the form a text scan reads worst', async () => {
  assert.deepEqual(
    await rulesFor("export const load = () => import('/home/runner/work/consumer/private.js');\n"),
    ['import-x/no-absolute-path'],
  );
});

test('KNOWN GAP: a template-literal absolute path is NOT caught', async () => {
  // Recorded rather than hidden. This is why scripts/check-isolation.ts keeps a
  // text-level escape check: it reads this form, and ESLint does not. If a
  // future rule closes it, this test fails and should be deleted, not amended.
  assert.deepEqual(await rulesFor('export const load = () => import(`/home/runner/consumer.js`);\n'), []);
});
