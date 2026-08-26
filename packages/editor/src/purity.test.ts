import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * The half of the purity claim that a static rule cannot make.
 *
 * "No fetching, no auth, no persistence" is now enforced where it belongs — in
 * `eslint.config.mjs`, over the AST, for `packages/viewer` and
 * `packages/editor`. This file used to carry a second enforcement: a regular
 * expression over the source text. That scanner drew four findings across two
 * review rounds, and the last was caused by the fix for the round before it —
 * blanking `//` comments also blanked everything after a `//` INSIDE A STRING,
 * so `const url = 'https://api'; … fetch(url)` scanned clean.
 *
 * It is the same lesson `eslint.config.mjs` already records about module
 * syntax, arriving a second time by a different door: a grammar with strings,
 * template literals, regex literals and comments in it cannot be read by a
 * pattern, and each patch buys the next finding. So the scan is gone rather
 * than fixed again, and `scripts/eslint-rules.test.mjs` proves the rules that
 * replaced it fire — on deliberate violations, naming the exact rule id.
 *
 * WHAT REMAINS HERE IS NOT A SCAN AND NEVER WAS. It removes the globals a
 * browser would supply and imports every shipped module. That catches what no
 * static rule sees — a computed access like `globalThis['fet' + 'ch']`, or any
 * module that touches a global at import time whatever it is spelled.
 */

const SOURCE_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Every source the package publishes: `src`, minus tests and test helpers. */
function shippedSources(directory = SOURCE_DIR, prefix = ''): { file: string; source: string }[] {
  const found: { file: string; source: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'testing') continue;
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...shippedSources(join(directory, entry.name), relative));
      continue;
    }
    // THE SAME EXTENSION FAMILY THE LINT RULES COVER. `tsconfig.json` compiles
    // and publishes `.mts`, `.cts` and `.tsx` as readily as `.ts`, so a filter
    // naming one of them left the load half blind to the other three — and the
    // load half is the ONLY instrument for an import-time computed access that
    // no AST rule can recognise. Declining this as "lint refuses it first" was
    // wrong: lint is exactly what cannot see that case.
    if (!/\.(ts|mts|cts|tsx)$/.test(entry.name) || /\.test\.(ts|mts|cts|tsx)$/.test(entry.name)) continue;
    found.push({ file: relative, source: readFileSync(join(directory, entry.name), 'utf8') });
  }
  return found;
}

describe('the shipped modules load with no DOM', () => {
  it('scans a set that actually contains the package', () => {
    // A load over an empty set passes vacuously. Pin the denominator.
    //
    // The floor is 1 rather than the viewer's 10 because the surface is
    // deliberately empty for now — but it is a floor, not a permission: what it
    // rules out is the directory read returning NOTHING, which is what would
    // make the loop below meaningless.
    const files = shippedSources().map(({ file }) => file);
    assert.ok(files.includes('index.ts'));
    assert.ok(files.length >= 1, `only ${String(files.length)} sources were scanned`);
    assert.equal(files.some((file) => file.endsWith('.test.ts')), false);
  });

  it('imports every one of them with the browser globals removed', async () => {
    // Redefined rather than assigned: some of these are accessor properties on
    // the global object (`navigator` is, on this runtime), and a plain
    // assignment throws instead of removing them.
    const removed = ['document', 'window', 'navigator', 'fetch', 'localStorage'];
    const saved = new Map(
      removed.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const),
    );
    for (const name of removed) {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }

    try {
      for (const { file } of shippedSources()) {
        // NOT asserted to export something, which is where this departs from the
        // viewer's copy. The surface is deliberately empty until the assembly
        // change decides it, so "exported nothing" is the CORRECT state here and
        // that assertion would fail on a healthy package. What the import still
        // proves is the thing this test is for: the module evaluates with the
        // browser globals gone.
        await import(`./${file}`);
      }
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor === undefined) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, descriptor);
        }
      }
    }
  });
});
