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

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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
  const source = readFileSync(file, 'utf8');
  const out = ts.transpileModule(source, {
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
  if (error) return ts.flattenDiagnosticMessageText(error.messageText, ' ');
  return firstJsxNode(ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS))
    ? 'JSX syntax survived the build; no JavaScript runtime can parse it'
    : undefined;
}

/**
 * The first JSX node in a parsed file, or `undefined` if it contains none.
 *
 * ASKED OF THE AST, because the diagnostics CANNOT answer it. TypeScript picks
 * its language variant from the FILE EXTENSION, and `.js`, `.mjs` and `.cjs` are
 * all JSX-capable variants — so JSX left untransformed in an emitted file draws
 * no diagnostic however the compiler options are set, and no option changes that.
 * Measured on TypeScript 6.0.3, with the real filename supplied: an element and a
 * fragment both report CLEAN, against `SyntaxError: Unexpected token '<'` from
 * Node for both. That is the one shape `firstParseError` above could not see, and
 * it is the shape a browser package ships when its JSX transform misfires — the
 * exact build this workspace now admits.
 *
 * DELIBERATELY NARROW. The more derived instrument is "any Node `SyntaxError` at
 * load is fatal", and it was rejected rather than overlooked: it would also
 * reject syntax a browser accepts and the running Node does not yet parse — a
 * newer import-attributes form, say — which is precisely the tolerance the
 * floor-less downgrade exists to provide. This rejects source no JavaScript
 * runtime anywhere will parse, and nothing else.
 *
 * `ts.forEachChild` returns the first truthy result its callback produces, so
 * this stops at the first hit rather than walking the whole tree.
 */
function firstJsxNode(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return node;
  return ts.forEachChild(node, firstJsxNode);
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
 * The missing RELATIVE target of a failed load, or `undefined` when the failure
 * was anything else.
 *
 * The two module systems report this differently, and only one of them does it
 * structurally — so this is where the asymmetry lives, once, rather than at the
 * call site. Measured on Node 25:
 *
 *   ESM  export { x } from "./missing.js"  -> ERR_MODULE_NOT_FOUND, url=file:///…/missing.js
 *   ESM  import "some-absent-pkg"          -> ERR_MODULE_NOT_FOUND, url=(none)
 *   CJS  require("./missing.js")           -> MODULE_NOT_FOUND, no url, message names the specifier
 *   CJS  require("some-absent-pkg")        -> MODULE_NOT_FOUND, no url, message names the specifier
 *
 * ESM populates `err.url` only for a target that named a FILE, so the field
 * alone separates a missing file from an uninstalled package. CommonJS gives no
 * such field — both cases are `MODULE_NOT_FOUND` with an identical shape — so
 * the specifier has to come from the message, which is the ONE place this file
 * reads message text. It is bounded: Node does not localise these, the specifier
 * is the first quoted run, and a non-match yields `undefined`, which downgrades
 * exactly as before rather than failing.
 *
 * WHY THE DISTINCTION IS WORTH THE REGEX: an uninstalled peer dependency is a
 * fact about the INSTALL, not about the package, and failing it would break the
 * browser packages this PR exists to admit. Treating every CommonJS
 * `MODULE_NOT_FOUND` as fatal would do exactly that.
 */
function missingRelativeTarget(error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') return error.url;
  if (error?.code !== 'MODULE_NOT_FOUND') return undefined;
  const named = /^Cannot find module '((?:\.\.?\/)[^']*)'/.exec(String(error.message ?? ''));
  return named ? named[1] : undefined;
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
    // WHAT THIS CHECK DOES NOT COVER — stated here rather than left to be
    // rediscovered, because the downgrade below is only as honest as this list.
    //
    // Parsing is not proof of soundness, and it cannot be made into proof. Two
    // known gaps, both routed to #38 ("Verify the published artifact after a
    // release"), which answers them BY CONSTRUCTION rather than by modelling:
    //
    //   1. EARLY ERRORS are not syntax errors. `const x = 1; const x = 2;` is a
    //      duplicate lexical declaration — found at BINDING, not parsing — so
    //      `transpileModule` reports nothing while every engine rejects it.
    //      There is no static instrument for this: `node --check` is unsound for
    //      `.js` (measured on Node 25: exit 0 for a syntactically broken file),
    //      and `vm.Script` cannot accept module syntax at all.
    //   2. AN IMPORT THAT NAMES A MISSING FILE is invisible here when it is
    //      LAZY. Node resolves the entry's static graph during the import below,
    //      so a broken static edge still surfaces; a `() => import('./gone.js')`
    //      does not, because nothing calls it.
    //
    // An earlier revision of this file tried to close both statically, with a
    // sweep that resolved every emitted file's relative imports. It drew ten of
    // this PR's twelve review findings across five rounds — extension rules,
    // directory imports, query strings, package boundaries, the npm packlist,
    // the nearest package `type` — every one of them correct, and each one a
    // layer deeper than the last. The surface is the union of the JavaScript
    // spec, Node's two resolvers and npm's packlist rules; it does not close.
    // Packing the artifact and loading it answers all of it at once, which is
    // what #38 is for. This check is deliberately the cheap half.

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
      // no such claim may stop at the sweeps above.
      if (floor !== undefined) throw error;

      // A MISSING FILE IS NEVER A DOWNGRADE, whatever the package targets. The
      // parse sweep reads the files that ARE there and is structurally blind to
      // one that is absent, so without this a floor-less entry of
      // `export { x } from "./missing.js"` is reported as `parsed` and CI passes
      // a package no consumer can load. That is the defect this whole file was
      // hardened for, and removing the static resolver reintroduced it.
      //
      // ASK NODE, DO NOT MODEL IT — which is why this is six lines and not a
      // resolver. `err.url` is populated ONLY when the unresolved specifier named
      // a FILE; a bare specifier Node could not find in node_modules carries the
      // same `code` and NO `url`. Measured on Node 25:
      //
      //   export { x } from "./missing.js"  -> ERR_MODULE_NOT_FOUND, url=file:///…/missing.js
      //   import "some-absent-pkg"          -> ERR_MODULE_NOT_FOUND, url=(none)
      //   import "./style.css"              -> ERR_UNKNOWN_FILE_EXTENSION
      //
      // That distinction is what keeps this from firing on a browser package's
      // uninstalled PEER DEPENDENCY, which is a fact about the install rather
      // than about the package — the reason a blanket `ERR_MODULE_NOT_FOUND`
      // rule was rejected earlier. A control test pins it.
      const missing = missingRelativeTarget(error);
      if (missing !== undefined) {
        assert.fail(`${manifest.name}: ${runtime} imports a file the package does not contain — ${missing}`);
      }

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
