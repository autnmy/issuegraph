import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * "No fetching, no mutation, no auth" is the package's central claim, so it is
 * measured rather than promised — twice, because neither instrument is
 * sufficient alone.
 *
 * The SCAN reads the shipped sources for the APIs that would break it. A scan
 * can only find what it looks for, so it carries a POSITIVE CONTROL: the same
 * detector is run over a source that deliberately contains each violation, and
 * has to report every one. Without that, a detector broken by a bad pattern
 * reports a clean package and looks exactly like a clean package.
 *
 * The LOAD test removes the globals a browser would supply and imports every
 * shipped module. A textual scan cannot see `globalThis['fet' + 'ch']`; a
 * module that touches a global at import time fails here whatever it is called.
 */

const SOURCE_DIR = fileURLToPath(new URL('.', import.meta.url));

/** What a rendering package may never reach for. */
const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = Object.freeze([
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
  { name: 'navigator.sendBeacon', pattern: /\bsendBeacon\b/ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
  { name: 'cookie', pattern: /\bdocument\.cookie\b/ },
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'Function constructor', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'dynamic import', pattern: /(?<![\w.])import\s*\(/ },
  { name: 'process', pattern: /\bprocess\.\w/ },
  // BOTH QUOTE STYLES AND BOTH IMPORT FORMS. `from 'node:` alone missed
  // `from "node:fs"` and the side-effect `import 'node:fs'` outright — and the
  // load test cannot cover for it, because a node builtin loads perfectly well
  // under Node. This scan is the only instrument that refuses one.
  { name: 'node builtin', pattern: /(?:\bfrom\s*|\bimport\s*)['"]node:/ },
  { name: 'globalThis', pattern: /\bglobalThis\b/ },
]);

export interface Violation {
  readonly file: string;
  readonly name: string;
  readonly line: number;
}

/**
 * Comments blanked to spaces, with every newline kept so line numbers still
 * describe the original file.
 *
 * This replaced a rule that DISCARDED any line whose first non-space character
 * opened a comment, which threw away the code after an inline one:
 * `/* note *\/ export const save = () => fetch('/write')` scanned as clean, and
 * the load test could not cover for it because nothing calls `save`. An
 * ordinary annotation defeated the guard.
 *
 * Blanking is strictly better than discarding — it removes the comment and
 * keeps the code — and it is the same treatment `scripts/check-isolation.ts`
 * applies for the same reason. It over-blanks a `/*` inside a string literal,
 * which can mask a later violation on that line; that is the one direction this
 * is weaker than a parser, and the load test below is the second instrument.
 */
function withoutComments(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

/** Report every forbidden reference in one source. Exported so it can be controlled. */
export function scanSource(file: string, source: string): Violation[] {
  const found: Violation[] = [];
  withoutComments(source).split('\n').forEach((text, index) => {
    // A CONTINUATION line of a block comment — ` * and never touches
    // localStorage` — still has to be skipped. In a real file its `/*` opener is
    // present and the blanking above already removed it; this covers a fragment
    // scanned on its own, which is what the prose control below passes.
    //
    // Applied AFTER blanking, deliberately: `/* note *\/ export …` no longer
    // begins with a comment once the comment is gone, so the code survives.
    if (text.trim().startsWith('*')) return;
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(text)) found.push({ file, name: rule.name, line: index + 1 });
    }
  });
  return found;
}

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

describe('the purity scan', () => {
  it('reports every violation in a source built to contain them — the positive control', () => {
    // Run FIRST, deliberately: a clean result below means nothing unless the
    // detector has been shown to fire. An absent finding and a broken detector
    // are indistinguishable without this.
    const planted = [
      "const a = await fetch('https://example.test');",
      'const b = new XMLHttpRequest();',
      "const c = new WebSocket('wss://example.test');",
      "const d = new EventSource('/stream');",
      "navigator.sendBeacon('/beacon');",
      "localStorage.setItem('k', 'v');",
      "sessionStorage.getItem('k');",
      "indexedDB.open('db');",
      "document.cookie = 'a=b';",
      "eval('1 + 1');",
      "const e = new Function('return 1');",
      "const f = await import('./other.ts');",
      'const g = process.env.HOME;',
      "import { readFileSync } from 'node:fs';",
      'const h = globalThis;',
    ].join('\n');

    const names = new Set(scanSource('planted.ts', planted).map((violation) => violation.name));
    for (const rule of FORBIDDEN) {
      assert.ok(names.has(rule.name), `the detector missed ${rule.name}`);
    }
  });

  it('does not fire on prose that merely mentions a forbidden API', () => {
    const commentary = ['// this module never calls fetch(', ' * and never touches localStorage'].join('\n');
    assert.deepEqual(scanSource('commentary.ts', commentary), []);
  });

  it('still reads the CODE after an inline comment', () => {
    // The rule that discarded a whole line whose first character opened a
    // comment scanned this as clean, and the load test could not cover for it
    // because nothing calls `save`.
    const annotated = "/* instrumentation */ export const save = () => fetch('/write');";
    assert.deepEqual(
      scanSource('annotated.ts', annotated).map((violation) => violation.name),
      ['fetch'],
    );
  });

  it('reports a node builtin in every import form, not just single-quoted `from`', () => {
    // Three forms the `from 'node:` pattern missed. They matter more than the
    // others in this list: a node builtin LOADS fine under Node, so the load
    // test below cannot catch one — this scan is the only instrument that
    // refuses it.
    for (const form of [
      'import { readFile } from "node:fs";',
      "import 'node:fs';",
      'import "node:fs";',
    ]) {
      assert.deepEqual(
        scanSource('form.ts', form).map((violation) => violation.name),
        ['node builtin'],
        form,
      );
    }
  });

  it('CONTROL: keeps reporting the single-quoted `from` form it always did', () => {
    assert.deepEqual(
      scanSource('classic.ts', "import { readFileSync } from 'node:fs';").map((v) => v.name),
      ['node builtin'],
    );
  });

  it('reports a violation on the line it is actually on, after a multi-line comment', () => {
    // Blanking rather than deleting is what keeps this true. A stripper that
    // removed comment TEXT would shift every line number after a block comment,
    // and the report would name the wrong line — which for a guard is close to
    // useless.
    const source = ['/*', ' * a block comment', ' */', "const a = await fetch('/x');"].join('\n');
    assert.deepEqual(scanSource('lines.ts', source), [{ file: 'lines.ts', name: 'fetch', line: 4 }]);
  });

  it('finds nothing in the shipped sources', () => {
    const violations = shippedSources().flatMap(({ file, source }) => scanSource(file, source));
    assert.deepEqual(
      violations.map((violation) => `${violation.file}:${String(violation.line)} ${violation.name}`),
      [],
    );
  });

  it('scans a set that actually contains the package', () => {
    // A scan over an empty set passes vacuously. Pin the denominator.
    const files = shippedSources().map(({ file }) => file);
    assert.ok(files.includes('index.ts'));
    assert.ok(files.includes('mount.ts'));
    assert.ok(files.includes('projections/graph.ts'));
    assert.ok(files.length >= 10, `only ${String(files.length)} sources were scanned`);
    assert.equal(files.some((file) => file.endsWith('.test.ts')), false);
  });
});

describe('the shipped modules load with no DOM', () => {
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
