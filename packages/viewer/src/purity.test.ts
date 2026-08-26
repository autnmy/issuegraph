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
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    found.push({ file: relative, source: readFileSync(join(directory, entry.name), 'utf8') });
  }
  return found;
}

describe('the shipped modules load with no DOM', () => {
  it('scans a set that actually contains the package', () => {
    // A load over an empty set passes vacuously. Pin the denominator — the same
    // guard the removed scan carried, which the loop below needs just as much.
    const files = shippedSources().map(({ file }) => file);
    assert.ok(files.includes('index.ts'));
    assert.ok(files.includes('mount.ts'));
    assert.ok(files.includes('projections/graph.ts'));
    assert.ok(files.length >= 10, `only ${String(files.length)} sources were scanned`);
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
        const loaded: Record<string, unknown> = await import(`./${file}`);
        assert.ok(
          Object.keys(loaded).length > 0,
          `${file} loaded but exported nothing, so the import proved nothing`,
        );
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
