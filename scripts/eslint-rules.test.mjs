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

test('a deep import into a sibling package is caught — the OSS seam', async () => {
  assert.deepEqual(
    await rulesFor("import { normalizeDocument } from '@issuegraph/viewer/src/document.ts';\nexport const n = normalizeDocument;\n"),
    ['no-restricted-imports'],
  );
});

test('a one-segment subpath is caught too — a glob star does not cross a slash', async () => {
  // `@issuegraph/*/*` alone would miss the deeper form above, and `@issuegraph/*/**`
  // alone would miss this one. Both cases are asserted so neither pattern can be
  // dropped as redundant.
  assert.deepEqual(
    await rulesFor("import { anything } from '@issuegraph/store/internals';\nexport const a = anything;\n"),
    ['no-restricted-imports'],
  );
});

test('CONTROL: the BARE sibling specifier is not caught', async () => {
  // The negative control the two cases above need. A rule that fired on every
  // `@issuegraph/*` import would also pass them, while forbidding the one thing
  // layer 2 is supposed to do.
  assert.deepEqual(
    await rulesFor("import { edgeId } from '@issuegraph/store';\nexport const e = edgeId;\n"),
    [],
  );
});

/**
 * The rule ids reported for a source string, as if it lived inside a RENDERING
 * package. The purity rules are scoped to `packages/{viewer,editor}`, so the
 * `packages/core` path above deliberately does not carry them.
 */
async function purityRulesFor(source) {
  const results = await eslint.lintText(source, {
    filePath: `${repoRoot}packages/editor/src/__violation-fixture__.ts`,
  });
  const ids = results.flatMap((result) => result.messages.map((message) => message.ruleId ?? 'PARSE-ERROR'));
  return [...new Set(ids)].sort();
}

/**
 * These replace a regex scanner that lived in each rendering package's
 * `purity.test.ts`. It drew four findings across two review rounds, and the
 * last was caused by the fix for the round before it — which is why the
 * scanner is gone rather than patched again, and why the two cases it got
 * wrong are pinned FIRST below.
 */

test('PURITY: a `//` inside a STRING no longer hides the code after it', async () => {
  // The regression the regex scanner had: blanking `//` comments also blanked
  // everything after a `//` inside a string literal, so this scanned clean.
  // `https://` in a source line is about as common as it gets.
  assert.deepEqual(
    await purityRulesFor("const url = 'https://api';\nexport const save = () => fetch(url);\n"),
    ['no-restricted-globals'],
  );
});

test('PURITY: an inline block comment no longer hides the code after it', async () => {
  // The finding BEFORE that one: a line whose first character opened a comment
  // was discarded whole, taking the code with it.
  assert.deepEqual(
    await purityRulesFor("/* instrumentation */ export const save = () => fetch('/write');\n"),
    ['no-restricted-globals'],
  );
});

test('PURITY: a deferred require of a Node builtin is caught', async () => {
  // The load test cannot cover this one: nothing calls the function, and a
  // builtin imports perfectly well under Node anyway.
  assert.deepEqual(
    await purityRulesFor("export const load = () => require('node:fs');\n"),
    ['no-restricted-syntax'],
  );
});

test('SEAM: a require() deep import walks past no-restricted-imports, so syntax catches it', async () => {
  assert.deepEqual(
    await purityRulesFor("export const d = () => require('@issuegraph/viewer/src/document.js');\n"),
    ['no-restricted-syntax'],
  );
});

test('PURITY: a Node builtin is caught in every import form', async () => {
  for (const form of [
    "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n",
    'import { readFile } from "node:fs";\nexport const r = readFile;\n',
    "import 'node:fs';\nexport const a = 1;\n",
  ]) {
    assert.deepEqual(await purityRulesFor(form), ['no-restricted-imports'], form);
  }
});

test('PURITY: the remaining forbidden reaches are caught', async () => {
  const cases = [
    ["export const s = () => localStorage.getItem('k');\n", 'no-restricted-globals'],
    ['export const c = () => document.cookie;\n', 'no-restricted-globals'],
    ["export const l = () => import('./other.js');\n", 'no-restricted-syntax'],
    ["export const e = () => eval('1');\n", 'no-restricted-syntax'],
    ["export const f = () => new Function('return 1');\n", 'no-restricted-syntax'],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(await purityRulesFor(source), [expected], source);
  }
});

test('CONTROL: the base import bans still apply inside a rendering package', async () => {
  // The trap flat config sets for this change: a later object's options for the
  // same rule REPLACE the earlier ones rather than merging, so the block that
  // adds `node:*` could silently drop the consumer ban and the seam ban for the
  // two packages that need them most.
  assert.deepEqual(
    await purityRulesFor("import { parse } from '@descant/types';\nexport const p = parse;\n"),
    ['no-restricted-imports'],
  );
  assert.deepEqual(
    await purityRulesFor("import { x } from '@issuegraph/viewer/src/document.ts';\nexport const y = x;\n"),
    ['no-restricted-imports'],
  );
});

test('CONTROL: the purity rules are SCOPED — a non-rendering package may read files', async () => {
  // `cli`, `reader` and `writer` make no browser claim and legitimately touch
  // the filesystem. A global ban would have broken them, and a rule that fired
  // everywhere would pass every case above while being wrong.
  assert.deepEqual(await rulesFor("import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n"), []);
});

test('CONTROL: ordinary pure code in a rendering package reports nothing', async () => {
  assert.deepEqual(await purityRulesFor('export const add = (a: number, b: number) => a + b;\n'), []);
});

test('CONTROL: a legitimate bare sibling import reports nothing', async () => {
  assert.deepEqual(
    await purityRulesFor("import { edgeId } from '@issuegraph/store';\nexport const e = edgeId;\n"),
    [],
  );
});

test('PURITY: a QUALIFIED global reach is caught — window.fetch and friends', async () => {
  // `no-restricted-globals` reports an UNQUALIFIED reference only, so banning
  // `fetch` alone left `window.fetch('/write')` green — and the load test
  // cannot cover for it, because nothing calls the function. Worse, the regex
  // scanner these rules replaced DID catch that spelling, so the move to the
  // AST was a regression here until the namespace OBJECTS went on the list.
  //
  // Banning the objects is what makes this a rule instead of a list of
  // spellings: enumerating (object, property) pairs is combinatorial and always
  // one member short.
  for (const source of [
    "export const s = () => window.fetch('/w');\n",
    "export const s = () => self.localStorage.getItem('k');\n",
    "export const b = () => navigator.sendBeacon('/b');\n",
    'export const c = () => document.cookie;\n',
  ]) {
    assert.deepEqual(await purityRulesFor(source), ['no-restricted-globals'], source);
  }
});

test('CONTROL: `document` as a PARAMETER is not a global reach', async () => {
  // The viewer names a parameter `document` throughout `parts.ts`. A parameter
  // shadows the global and this rule reports unresolved references only — but
  // that is exactly the kind of claim that should be pinned rather than
  // reasoned about, because getting it wrong would break a shipping package.
  assert.deepEqual(
    await purityRulesFor('type D = { k: string };\nexport const t = (document: D) => document.k;\n'),
    [],
  );
});

test('PURITY: an UNPREFIXED Node builtin is caught, not just `node:`', async () => {
  // `import { readFile } from 'fs'` is a valid builtin import that a `node:*`
  // pattern never sees, and Node's ambient typings let it compile. The list is
  // read from `builtinModules` rather than typed out, so it cannot drift as
  // Node adds modules.
  for (const source of [
    "import { readFile } from 'fs';\nexport const r = readFile;\n",
    "import { readFile } from 'fs/promises';\nexport const r = readFile;\n",
    "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n",
  ]) {
    assert.deepEqual(await purityRulesFor(source), ['no-restricted-imports'], source);
  }
});
