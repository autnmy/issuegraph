import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { deriveIssueOrder } from './order.ts';
import { issuegraphOrderSeed, issuegraphOrderSeedCreatedAt } from './testing/fixtures.ts';

// "Never store the derived model" is the reason two clients reading the same
// issue bodies agree without coordinating, and the reason the model cannot go
// stale. A comment cannot hold that: the moment a caching or persistence seam
// appears, the guarantee is gone and nothing fails.
//
// The pins below are chosen so the LIKELIEST violation — a module-scope memo —
// fails. A dependency allowlist alone does not catch one: a `new Map()` at
// module scope imports nothing, reaches for no storage API, and makes a
// compare-by-value determinism test pass MORE easily, because returning the
// identical object satisfies every deep-equal. So identity and freshness are
// pinned too.

const MODULE_FILES = ['order.ts', 'precedence.ts', 'cycle.ts', 'index.ts'] as const;

/** The complete set of module specifiers the derivation may depend on. */
const ALLOWED_IMPORTS = new Set([
  '@issuegraph/reader',
  './order.ts',
  './precedence.ts',
  './cycle.ts',
]);

function moduleSource(file: string): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    moduleSource(file),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
}

/**
 * Every module specifier in a file, read from TypeScript's own AST.
 *
 * Deliberately NOT a set of regexes. Module syntax is an open grammar, and a
 * pattern-based reader leaks a shape per review round — most memorably
 * `import("./x.ts", { with: … })`, which a pattern requiring `)` right after
 * the literal never matches — and each leak makes the closure come back SHORT,
 * so the guard agrees with itself about code it never inspected. The
 * repository's own import rules moved to a real parser for the same reason.
 *
 * Fails CLOSED: a dynamic import or require whose specifier is not a string
 * literal cannot be checked against the allowlist, so it is reported rather
 * than silently omitted.
 */
function moduleSpecifiers(file: string): string[] {
  const source = parse(file);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        const arg = node.arguments[0];
        specifiers.push(
          arg !== undefined && ts.isStringLiteral(arg)
            ? arg.text
            : `<non-literal specifier at ${file}:${
                source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
              }>`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/** Module-scope declarations that could hold state across calls. */
function moduleScopeMutableState(file: string): string[] {
  const source = parse(file);
  const offenders: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(source);
      if (!isConst) {
        offenders.push(`${name} (let/var at module scope)`);
        continue;
      }
      const initializer = declaration.initializer;
      if (
        initializer !== undefined &&
        ts.isNewExpression(initializer) &&
        /^(Map|Set|WeakMap|WeakSet|WeakRef)$/.test(initializer.expression.getText(source))
      ) {
        offenders.push(`${name} (module-scope ${initializer.expression.getText(source)})`);
      }
    }
  }
  return offenders;
}

function buildSeedOrder(): ReturnType<typeof deriveIssueOrder> {
  return deriveIssueOrder({
    issues: issuegraphOrderSeed(),
    config: {
      baseRanking: { source: 'fixture-parity', createdAt: issuegraphOrderSeedCreatedAt() },
    },
  });
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner);
}

describe('the derivation package is pure', () => {
  for (const file of MODULE_FILES) {
    test(`depends on nothing outside the allowlist (${file})`, () => {
      for (const specifier of moduleSpecifiers(file)) {
        assert.ok(
          ALLOWED_IMPORTS.has(specifier),
          `${file} imports ${JSON.stringify(specifier)}, which is not on the allowlist`,
        );
      }
    });
  }

  test('keeps the allowlist exact — every entry is genuinely depended on', () => {
    // A RELATION, not a count floor: this stays honest when a module gains or
    // loses a dependency, and it is what makes the per-file check above
    // non-vacuous (an allowlist entry nothing uses would be dead permission).
    const observed = new Set(MODULE_FILES.flatMap((file) => moduleSpecifiers(file)));
    assert.deepStrictEqual([...observed].sort(), [...ALLOWED_IMPORTS].sort());
  });

  for (const file of MODULE_FILES) {
    test(`holds no module-scope mutable state (${file})`, () => {
      // Where a stored model would actually live. Function-local `new Map()` is
      // fine and common here; only module scope can outlive a call.
      assert.deepStrictEqual(moduleScopeMutableState(file), []);
    });
  }

  for (const file of MODULE_FILES) {
    test(`reaches for no fetch, storage, cache, or clock seam (${file})`, () => {
      const source = moduleSource(file);
      for (const seam of [
        'fetch(',
        'XMLHttpRequest',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'caches',
        'globalThis',
        'node:fs',
        'process.env',
        // Nondeterminism is the other way a "pure" derivation stops agreeing
        // with itself across two clients.
        'Date.now',
        'new Date',
        'Math.random',
        'performance.now',
      ]) {
        assert.ok(!source.includes(seam), `${file} mentions ${JSON.stringify(seam)}`);
      }
    });
  }

  test('returns equal output for the same input, twice', () => {
    const first = buildSeedOrder();
    const second = buildSeedOrder();
    assert.deepStrictEqual(second.slots, first.slots);
    assert.deepStrictEqual([...second.rankOf], [...first.rankOf]);
    assert.deepStrictEqual([...second.priority], [...first.priority]);
    assert.deepStrictEqual(second.excluded, first.excluded);
    assert.deepStrictEqual(second.provenance, first.provenance);
    assert.deepStrictEqual(second.diagnostics, first.diagnostics);
  });

  test('builds a fresh model each call rather than handing back a stored one', () => {
    // The identity pin a memo cannot satisfy: equal by value, distinct by
    // reference. A cache returning the stored model fails here immediately,
    // while passing every assertion in the test above.
    const first = buildSeedOrder();
    const second = buildSeedOrder();
    assert.notStrictEqual(second.slots, first.slots);
    assert.notStrictEqual(second.rankOf, first.rankOf);
    assert.notStrictEqual(second.priority, first.priority);
    assert.notStrictEqual(second.wouldCycle, first.wouldCycle);
  });

  test('recomputes from the current issues, so the model cannot go stale', () => {
    // The freshness pin: same config object, changed node set. A model keyed
    // on anything coarser than the input — a repo id, a config identity, a
    // call count — serves the old order here and fails.
    const config = {
      baseRanking: { source: 'fixture-parity', createdAt: issuegraphOrderSeedCreatedAt() },
    } as const;
    const before = deriveIssueOrder({ issues: issuegraphOrderSeed(), config });
    const unblocked = issuegraphOrderSeed().map((issue) =>
      issue.number === 602 ? { ...issue, open: false } : issue,
    );
    const after = deriveIssueOrder({ issues: unblocked, config });

    assert.equal(before.rankOf.get('530'), null);
    assert.notEqual(after.rankOf.get('530'), null);
  });

  test('does not mutate either half of its input', () => {
    const issues = issuegraphOrderSeed();
    deepFreeze(issues);
    const createdAt = issuegraphOrderSeedCreatedAt();
    const issuesSnapshot = JSON.stringify(issues);
    const createdAtSnapshot = [...createdAt];

    assert.doesNotThrow(() =>
      deriveIssueOrder({
        issues,
        config: { baseRanking: { source: 'fixture-parity', createdAt } },
      }),
    );
    assert.equal(JSON.stringify(issues), issuesSnapshot);
    // `ReadonlyMap` erases at runtime — the caller handed over a live Map.
    assert.deepStrictEqual([...createdAt], createdAtSnapshot);
  });

  test('does not mutate a config-arm base ranking', () => {
    const order = [
      { key: '512', matchedOrderIndex: 0 },
      { key: '514', matchedOrderIndex: 0 },
    ];
    const orderSnapshot = structuredClone(order);
    deriveIssueOrder({
      issues: issuegraphOrderSeed(),
      config: { baseRanking: { source: 'config', order } },
    });
    assert.deepStrictEqual(order, orderSnapshot);
  });
});
