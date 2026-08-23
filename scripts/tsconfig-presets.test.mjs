/**
 * Tests for the TypeScript presets.
 *
 * `tsconfig.browser.json` is referenced by no package yet — the packages that
 * need it are still being written — so nothing in `pnpm run ci` compiles
 * anything with it. Measured: stripping `DOM` and `jsx` back out of the preset
 * left CI exiting 0. A config file that ships without ever being exercised is
 * indistinguishable from one that does not work, and this is the difference.
 *
 * Each case compiles a real fixture and asserts the outcome. The base-config
 * case is the control: the SAME source must FAIL there, or the browser case
 * proves nothing about the preset rather than about TypeScript's defaults.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(repoRoot, 'node_modules', '.bin', 'tsc');
const roots = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A browser-shaped source file: JSX, a DOM global, and a jsx-runtime shim. */
const BROWSER_SOURCE = 'export const El = () => <div onClick={() => { document.title = "x"; }}>hi</div>;\n';
const JSX_SHIM = `declare module 'react/jsx-runtime' {
  export const jsx: unknown;
  export const jsxs: unknown;
  export const Fragment: unknown;
}
declare namespace JSX {
  interface IntrinsicElements { div: Record<string, unknown> }
  interface Element { readonly _brand: unique symbol }
}
`;

/** Compile BROWSER_SOURCE against one of the repo's presets; return tsc's output. */
function compileUnder(preset) {
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-preset-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'types'), { recursive: true });
  // `module: NodeNext` reads the nearest package.json to decide CommonJS vs ESM.
  // Without this the fixture is CommonJS and fails on `verbatimModuleSyntax`
  // alone — passing or failing for a reason that has nothing to do with the
  // preset under test.
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'src', 'index.tsx'), BROWSER_SOURCE);
  writeFileSync(join(root, 'types', 'jsx.d.ts'), JSX_SHIM);
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    extends: join(repoRoot, preset),
    compilerOptions: {
      rootDir: '.',
      noEmit: true,
      // The fixture lives outside the repository, so `@types/node` is not on its
      // resolution path. Without this the base config dies on TS2688 before it
      // ever reaches the JSX and DOM errors — a control that fails for the wrong
      // reason, which is a control that proves nothing.
      typeRoots: [join(repoRoot, 'node_modules', '@types')],
    },
    include: ['src', 'types'],
  }, null, 2));
  const run = spawnSync(tsc, ['-p', join(root, 'tsconfig.json')], { encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

test('the browser preset compiles JSX and DOM', () => {
  const { status, output } = compileUnder('tsconfig.browser.json');
  assert.equal(status, 0, `expected a clean compile, got:\n${output}`);
});

test('CONTROL: the same source FAILS under the Node base config', () => {
  // Without this, the test above would pass just as well if TypeScript accepted
  // JSX and DOM by default — it would be measuring nothing about the preset.
  const { status, output } = compileUnder('tsconfig.base.json');
  assert.notEqual(status, 0, 'the base config should not compile browser source');
  assert.match(output, /TS17004/, 'expected the missing --jsx flag');
  assert.match(output, /TS2584/, 'expected `document` to be unknown without the DOM lib');
});

test('the browser preset keeps the base’s strictness rather than replacing it', () => {
  // `extends` merges compilerOptions, but a preset that restated the whole block
  // would silently drop `strict`, `noUncheckedIndexedAccess` and the rest. This
  // asserts an unused local is still an error, which only holds if the base's
  // options survived.
  const root = mkdtempSync(join(tmpdir(), 'issuegraph-preset-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'src', 'index.ts'), 'export function f() { const unused = 1; return 2; }\n');
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    extends: join(repoRoot, 'tsconfig.browser.json'),
    compilerOptions: {
      rootDir: '.',
      noEmit: true,
      typeRoots: [join(repoRoot, 'node_modules', '@types')],
    },
    include: ['src'],
  }, null, 2));
  const run = spawnSync(tsc, ['-p', join(root, 'tsconfig.json')], { encoding: 'utf8' });
  assert.notEqual(run.status, 0, 'an unused local should still be an error under the browser preset');
  assert.match(`${run.stdout}${run.stderr}`, /TS6133/);
});
