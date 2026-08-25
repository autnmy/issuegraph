/**
 * The consumer smoke test.
 *
 * Everything else in this repository runs TypeScript SOURCE on a modern Node.
 * This loads the BUILT artifact, on the floor the published manifest declares —
 * so `engines.node` stops being a compatibility claim no instrument measured.
 *
 * Plain `.mjs` on purpose: the floor is older than Node's native type stripping,
 * so a `.ts` smoke test could not run there at all.
 */

import ts from 'typescript';

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

/** The major version a `>=X` / `^X` style engines range starts at. */
export function declaredFloorMajor(range) {
  const found = /(\d+)/.exec(range ?? '');
  return found ? Number(found[1]) : undefined;
}

/** Every file an `exports` map points at, however deeply it is nested. */
function exportTargets(node, found = []) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) found.push(node);
    return found;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) exportTargets(value, found);
  }
  return found;
}

/**
 * The first syntax error in a source file, or `undefined` if it parses.
 *
 * This is a DERIVED test, and it replaced an enumerated one. The previous
 * version listed the failures a browser entry was observed to produce —
 * `ERR_UNKNOWN_FILE_EXTENSION`, `ReferenceError` — and tolerated those. That is
 * a denylist wearing an allowlist's clothes: the property actually wanted is
 * "the entry parsed", and the ways a valid module can fail to LOAD in Node are
 * an open set. A `.wasm` import, an import-attributes syntax this Node does not
 * know, a top-level `await` on a browser promise — each fails differently and
 * none was on the list. Verified: all three PARSE, and only genuinely broken
 * source does not.
 *
 * NOT `node --check`, which is the obvious tool and is unsound here. Measured on
 * Node 25: `node --check` exits 0 for a syntactically broken `.js` file, and
 * only reports correctly for `.mjs` and CommonJS. It would have passed on
 * exactly the input this exists to catch.
 */
function firstParseError(file) {
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    reportDiagnostics: true,
    // The REAL filename, not a placeholder. Without it TypeScript parses the
    // input AS TYPESCRIPT, so `export const x: number = 1` left in an emitted
    // `.js` file reads as valid — the exact source no browser can load. Verified:
    // unnamed it reports nothing, named `index.js` it reports "Type annotations
    // can only be used in TypeScript files."
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, allowJs: true },
  });
  const error = (out.diagnostics ?? []).find((d) => d.category === ts.DiagnosticCategory.Error);
  return error ? ts.flattenDiagnosticMessageText(error.messageText, ' ') : undefined;
}

const EMITTED_EXTENSIONS = ['.js', '.mjs', '.cjs'];

/** Every JavaScript file a package would publish, entry and siblings alike. */
function emittedJsFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      found.push(...emittedJsFiles(join(dir, entry.name)));
    } else if (EMITTED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/**
 * The first emitted file in a package that does not parse.
 *
 * Checking only the ENTRY was not enough: a valid entry importing a malformed
 * emitted sibling makes Node reject the import, while the entry itself parses
 * cleanly — so the failure was downgraded and CI passed on a package no consumer
 * can load. The failure originates in the dependency, so the dependency has to
 * be looked at. Every JavaScript file the package ships is checked rather than
 * resolving the module graph, which needs no resolver and cannot miss an edge.
 */
function firstUnparseableFile(dir) {
  for (const file of emittedJsFiles(dir)) {
    const error = firstParseError(file);
    if (error !== undefined) return { file, error };
  }
  return undefined;
}

/**
 * The paths Node would try for a relative specifier, in the shapes an emitted
 * file actually uses.
 *
 * The empty suffix is the ESM shape TypeScript emits (`./foo.js`, already
 * carrying its extension); the rest are the CommonJS and bundler shapes, where
 * `./foo` may be `foo.js` or `foo/index.js`. Being GENEROUS here is deliberate:
 * this list decides what counts as RESOLVED, so a shape left off it becomes a
 * false failure, and a false failure in a guard is worse than a narrow one.
 */
const RESOLUTION_SUFFIXES = ['', '.js', '.mjs', '.cjs', '.json', '/index.js', '/index.mjs', '/index.cjs'];

/** Whether a relative specifier names something that is actually on disk. */
function resolvesOnDisk(fromFile, specifier) {
  // A bundler query or fragment names the same FILE with different handling —
  // `./worker.js?worker`, `./data.txt?raw`. Browser packages emit these, and
  // the file they name is what has to exist.
  const path = specifier.split(/[?#]/)[0];
  const base = join(dirname(fromFile), path);
  return RESOLUTION_SUFFIXES.some((suffix) => {
    const candidate = base + suffix;
    return existsSync(candidate) && statSync(candidate).isFile();
  });
}

/**
 * The first relative import in a package's emitted files that resolves to
 * nothing.
 *
 * Parsing is not enough, and this is the gap it leaves. An entry of
 * `export { x } from "./missing.js"` parses perfectly, every file that DOES
 * exist parses too — so the load failure downgraded to parse-only and CI passed
 * on a package whose first import 404s. Nothing was broken; something was
 * absent, and an absence is invisible to a check that only reads what is there.
 *
 * `ts.preProcessFile` rather than a hand-walked AST: it is what TypeScript's own
 * program builder uses to find a file's edges, so it already covers every shape
 * an emitted file takes — `import`, `export ... from`, `import()` with a literal
 * argument, and `require()` in CommonJS output.
 *
 * BARE specifiers are deliberately not checked. Resolving `react` needs a real
 * resolver and a node_modules layout, and a peer dependency legitimately absent
 * from the package's own tree would fail. A RELATIVE specifier needs neither: it
 * names a file the package itself is supposed to ship.
 */
function firstUnresolvedImport(dir) {
  for (const file of emittedJsFiles(dir)) {
    const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const { fileName: specifier } of importedFiles) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
      if (!resolvesOnDisk(file, specifier)) return { file, specifier };
    }
  }
  return undefined;
}

/**
 * A readable one-line reason from a thrown value, which need NOT be an `Error`.
 *
 * `throw null` and `throw "boom"` are legal JavaScript, and a module whose
 * top-level await rejects with a primitive lands here too. Reading `.message` off
 * those either throws outright (`null`) or yields `undefined` (a string) — and
 * `undefined` used to be the very value that meant "the entry loaded fine", so a
 * module that never loaded took the success branch.
 *
 * `String` is not total either: it throws for a null-prototype object, which has
 * no `toString`. The fallback is what stops a diagnostic becoming the failure it
 * was trying to describe.
 */
function describeThrown(value) {
  if (value instanceof Error && typeof value.message === 'string') return value.message;
  try {
    return String(value);
  } catch {
    return '<a thrown value that cannot be converted to a string>';
  }
}

/**
 * Smoke-test every package under `packagesDir`. Returns one result per package.
 *
 * A package that declares `engines.node` is held to BOTH checks: this process
 * must be running that floor, and the built entry must load in it. A package
 * that declares none is not exempt from being checked — it is exempt from
 * claiming a Node floor. Every package, floor or not, must still PARSE and must
 * name only files it actually ships. The difference between the two is reported
 * per package rather than left silent, because a check that quietly weakens is
 * indistinguishable from one that passed.
 */
export async function smokeTest(packagesDir, { log = () => {} } = {}) {
  const results = [];
  const runningMajor = Number(process.versions.node.split('.')[0]);

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const targets = exportTargets(manifest.exports);
    assert.ok(targets.length > 0, `${manifest.name} declares no exports; a consumer has nothing to import`);

    for (const target of targets) {
      assert.ok(
        existsSync(join(dir, target)),
        `${manifest.name}: exports names "${target}", which the build did not produce`,
      );
    }

    const runtime = manifest.exports?.['.']?.default ?? manifest.main;
    assert.ok(runtime, `${manifest.name} declares no runtime entry`);

    const floor = declaredFloorMajor(manifest.engines?.node);
    if (floor !== undefined) {
      assert.equal(
        runningMajor,
        floor,
        `${manifest.name} declares node >=${floor} but this smoke test is running on ${process.version}. ` +
          'Run it on the declared floor, or change the floor — testing a newer runtime proves nothing about the older one.',
      );
    }

    // BOTH STATIC SWEEPS RUN FOR EVERY PACKAGE, whatever the load then does.
    // They used to sit in the catch block below, on the reasoning that an import
    // which SUCCEEDED had its graph resolved by Node itself. That is true only of
    // the static edges REACHABLE FROM THE ENTRY, and it left two real defects
    // invisible: Node resolves a dynamic `import()` when it is CALLED, not at
    // load, so an entry can load cleanly while `() => import('./missing.js')`
    // 404s for every consumer that calls the API; and Node never looks at an
    // emitted file nothing imports, so an orphan carrying broken source ships
    // unexamined. Both are STATIC facts about the files on disk, so neither has
    // any business being conditional on a runtime outcome.
    //
    // Asked of the FILES, never of the error, because the ways a valid module can
    // fail to LOAD in Node are an open set — and because a module can throw a
    // `SyntaxError` at RUNTIME (`JSON.parse("{")` at module scope) from source
    // that is perfectly fine.
    const broken = firstUnparseableFile(dir);
    assert.equal(
      broken,
      undefined,
      `${manifest.name}: ${broken ? relative(dir, broken.file) : ''} does not parse — ${broken?.error}`,
    );
    // Parsing says nothing about whether the files a module NAMES are there. A
    // missing relative import is a defect in every target, browser or Node, so it
    // is never downgraded: the downgrade exists for a package Node cannot LOAD,
    // not for one that is incomplete.
    const missing = firstUnresolvedImport(dir);
    assert.equal(
      missing,
      undefined,
      `${manifest.name}: ${missing ? relative(dir, missing.file) : ''} imports "${missing?.specifier}", ` +
        'which the package does not contain',
    );

    let loaded;
    // THE DOWNGRADE IS TRACKED SEPARATELY FROM ITS REASON, never inferred from
    // it. This used to be a lone `downgraded = error.message`, so a module
    // throwing a non-Error — `throw "boom"`, or a top-level await rejecting with
    // a primitive — produced `undefined`, which is the same value that meant "the
    // entry loaded fine": the success branch then ran on an entry that never
    // loaded. A boolean cannot be spoofed by the shape of what was thrown.
    let parseOnly = false;
    let reason = '';
    const entryPath = join(dir, runtime);
    try {
      loaded = await import(pathToFileURL(entryPath).href);
    } catch (error) {
      // A package that CLAIMS a Node floor must still LOAD on it; only one making
      // no such claim may stop at the sweeps above. Nothing here is special-cased
      // on the error's type or code — the sweeps have already established the
      // only properties that make a downgrade honest.
      if (floor !== undefined) throw error;
      parseOnly = true;
      reason = describeThrown(error);
    }

    if (parseOnly) {
      log(`parse ${manifest.name}  ${runtime}  parsed, not loadable here — ${reason}`);
    } else {
      assert.ok(Object.keys(loaded).length > 0, `${manifest.name} loaded but exported nothing`);
      log(`ok    ${manifest.name}  ${runtime}  loaded, ${Object.keys(loaded).length} exports, node ${process.version}`);
    }
    results.push({
      name: manifest.name,
      entry: runtime,
      check: parseOnly ? 'parsed' : 'loaded',
      downgraded: parseOnly ? reason : undefined,
    });
  }

  assert.ok(results.length > 0, 'no packages were smoke-tested; this job proved nothing');
  return results;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const packagesDir = fileURLToPath(new URL('../packages', import.meta.url));
  const results = await smokeTest(packagesDir, { log: (line) => console.log(line) });
  const loaded = results.filter((r) => r.check === 'loaded').length;
  console.log(`smoke: ${results.length} package(s) on node ${process.version} — ${loaded} loaded, ${results.length - loaded} parse-only`);
}
