/**
 * Import and purity rules for the published packages.
 *
 * TWICE NOW, a hand-rolled scanner that read source with a regular expression
 * has been replaced by rules over the AST. The import rules below replaced the
 * first; the purity rules in the second config object replaced the second, for
 * the same reason and after the same shape of evidence. If a third scanner is
 * ever proposed here, this is the note that should stop it.
 *
 * These rules replace a hand-rolled scanner that read module syntax with a
 * regular expression. Module syntax is an open grammar, and eight review rounds
 * on that scanner produced findings in both directions — specifier forms it
 * could not read (template literals, comments between the keyword and the
 * paren, absolute paths, `file://` URLs) and prose it wrongly read as an import.
 * ESLint parses the real AST, so every one of those is handled by construction
 * rather than by another pattern.
 *
 * What is NOT here, and what that costs, measured rather than assumed. These
 * rules were probed with deliberate violations one at a time. They catch a
 * forbidden name, an absolute path (static or dynamic), and a relative import
 * into a sibling package. They do NOT catch an absolute path written as a
 * template literal, nor a relative climb to a path that is not a package — the
 * second needs per-file path resolution that no rule here expresses.
 *
 * `scripts/check-isolation.ts` keeps the two checks that are not import
 * questions at all: the brand-token scan over published text, and the manifest
 * checks, which read JSON — a closed grammar that has never produced a finding.
 *
 * A LATER ADDITION, guarding a different boundary: `SIBLING_SUBPATHS` below
 * keeps the OSS seam between the packages themselves. The rules above ask
 * whether a package reaches OUT of this repository; that one asks whether a
 * package reaches PAST a sibling's public surface. Both are import questions,
 * so both belong here rather than in another text scanner.
 *
 * Scoped to `packages/` because that is what ships. `scripts/` is repository
 * tooling and is free to read the repository.
 *
 * `demo/` gets the SAME rules despite not shipping, and that is deliberate. It
 * is the in-repo proof consumer, so the day it reaches past a package's public
 * surface is the day the surface stopped being sufficient — and a demo quietly
 * importing `@issuegraph/store/src/...` would hide exactly the defect it exists
 * to expose. Its `no-relative-packages` is the load-bearing one: reaching into
 * `../packages/store/src` would make the whole page prove nothing.
 */

import { builtinModules } from 'node:module';

import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * Consumer-side names. A published package that depends on the product whose
 * backlog this specification was implemented against is a private library
 * wearing a public name.
 */
const FORBIDDEN = ['@descant', '@descant/*', 'descant', 'descant/*', '@takumi', '@takumi/*', 'takumi', 'takumi/*'];

/**
 * Subpaths of a sibling `@issuegraph/*` package — that is, everything except the
 * bare specifier.
 *
 * This is the OSS seam, and unlike the rules above it guards a boundary INSIDE
 * this repository. The editor is layer 2 and the viewer is layer 1; they used to
 * be one codebase, so the boundary was enforced by construction. Now that both
 * ship as packages, the design's own words are that it "stops being enforced by
 * construction and becomes discipline — layer 2 composes layer 1 through its
 * public surface and never reaches past it."
 *
 * Two patterns, because a glob `*` does not cross a `/`: the first catches
 * `@issuegraph/viewer/src`, the second everything below it.
 *
 * A published package can add an export later and can never take one back, which
 * is why the answer to a missing export is to add one deliberately rather than
 * to reach around the surface for it.
 *
 * NOT redundant with each package's `exports` map, which today declares `"."`
 * alone and so already refuses these specifiers at resolution time. That refusal
 * is a property of the package being IMPORTED: the day one of them publishes a
 * subpath export for a good reason, every other package silently gains the
 * ability to reach through it. This rule is a property of the package doing the
 * importing, so it keeps holding.
 */
const SIBLING_SUBPATHS = ['@issuegraph/*/*', '@issuegraph/*/**'];

/**
 * The import restrictions every published package carries. Named so the
 * browser-package block below can EXTEND them instead of restating them.
 *
 * In flat config a later object's options for the same rule REPLACE the earlier
 * ones for matching files — they do not merge. So a second `no-restricted-imports`
 * that listed only `node:` would silently drop the consumer ban and the seam ban
 * for exactly the two packages that need them most. Composing from one array is
 * what makes that impossible rather than remembered.
 */
const BASE_IMPORT_PATTERNS = [
  {
    group: FORBIDDEN,
    message:
      'A published @issuegraph package may not depend on the consuming product. Move what you need into the package, or into @issuegraph/core.',
  },
  {
    group: SIBLING_SUBPATHS,
    message:
      'Import a sibling @issuegraph package at its bare specifier. Reaching into its internals is the seam the package split exists to keep — if you need something it does not export, export it deliberately.',
  },
];

/**
 * Every extension TypeScript emits from, as one brace glob.
 *
 * The purity block was scoped to `.ts` alone while the import block above
 * already covered the whole family — so a `network.mts` in a rendering package
 * was compiled by its `tsconfig.json`, emitted to `dist`, published, and lint
 * saw none of the purity rules. Two lists that can disagree is the defect;
 * there is now one.
 */
const TS_EXTENSIONS = '{ts,tsx,mts,cts}';

/**
 * A dynamic import whose specifier cannot be READ.
 *
 * This is the assumption the two value-based selectors below rest on, made
 * enforceable. They read `source.value`, which exists only on a `Literal`. A
 * template literal has no `value`, so ``import(`@issuegraph/viewer/src/x.js`)``
 * slipped past both — and so would a concatenation, or anything else computed.
 *
 * Adding a template-literal case would have closed one more spelling and left
 * the rest, which is the shape of every finding on these rules since round two.
 * So this refuses a dynamic import whose specifier cannot be read at all: the
 * value-based rules then cover every specifier that REACHES them, because an
 * unreadable one no longer does.
 *
 * `check-isolation.ts` records the same class — a specifier built by
 * concatenation is invisible — and routes it rather than patching per round.
 * This closes it for `import()` instead, which is cheap here because a
 * published package has no reason to build a specifier at runtime.
 */
const UNREADABLE_SPECIFIER = {
  selector: "ImportExpression:not([source.type='Literal'])",
  message:
    'A dynamic import in a published package must name a plain string literal. A template literal or a computed specifier cannot be read by the seam and consumer rules, so it is refused rather than waved through.',
};

/**
 * `no-restricted-imports` visits STATIC import and export declarations. It does
 * not visit `import('…')`, so every pattern in this file — the consumer ban and
 * the sibling-seam ban alike — is bypassed by the dynamic form.
 *
 * That is the same hole `require()` opened, and it is closed the same way and
 * for the same reason: both are calls rather than declarations, so a rule that
 * reads declarations cannot see either. Scoped by selector rather than banned
 * outright, because a non-rendering package may legitimately load something at
 * runtime; what it may not do is reach around a sibling's surface or name the
 * consumer while doing it.
 */
const DYNAMIC_IMPORT_SELECTORS = [
  {
    selector: 'ImportExpression[source.value=/^@issuegraph\\/[^/]+\\//]',
    message:
      'Import a sibling @issuegraph package at its bare specifier. A dynamic import reaches past the seam exactly as a static one does, and no-restricted-imports cannot see it.',
  },
  {
    selector: 'ImportExpression[source.value=/^(@descant|descant|@takumi|takumi)(\\/|$)/]',
    message:
      'A published @issuegraph package may not depend on the consuming product, dynamically or otherwise.',
  },
];

/** The syntax bans every package carries, composed so neither block can drop one. */
const BASE_SYNTAX = [
  {
    selector: "CallExpression[callee.name='require']",
    message:
      'require() is not available in these ESM packages, and it bypasses every import rule in this config — including the sibling-seam ban. Use an import.',
  },
  ...DYNAMIC_IMPORT_SELECTORS,
];

/**
 * The packages that render, and therefore may not reach for a runtime.
 *
 * `viewer` and `editor` claim "no fetching, no auth, no persistence" — the
 * claim that makes them installable by anyone. `cli`, `reader` and `writer`
 * make no such claim and legitimately read files, so this is scoped rather
 * than global.
 */
const BROWSER_PACKAGES = [`packages/viewer/**/*.${TS_EXTENSIONS}`, `packages/editor/**/*.${TS_EXTENSIONS}`];

/**
 * Globals whose mere presence in a rendering package breaks the claim.
 *
 * THE SECOND GROUP IS THE NAMESPACE OBJECTS, and banning them is what makes
 * this a rule rather than a list of spellings. `no-restricted-globals` reports
 * an unqualified reference only, so with `fetch` alone
 * `window.fetch('/write')` passed — and the load test cannot cover for it,
 * because nothing calls the function. The regex scanner this replaced DID catch
 * that spelling (`/\bfetch\s*\(/` matches `window.fetch(`), so the move to the
 * AST was a regression on exactly this case until the objects went on the list.
 *
 * Enumerating `(object, property)` pairs instead would be combinatorial and
 * always one member short — `window.fetch`, `self.fetch`, `globalThis.fetch`,
 * `window.localStorage`, and so on. Removing the objects removes every reach
 * THROUGH them at once, including ones nobody has thought of.
 *
 * `document` is on the list and does NOT break the viewer, which uses
 * `document` as a PARAMETER name throughout `parts.ts`: a parameter shadows the
 * global, and this rule reports unresolved references only. Verified by running
 * it over both packages, and pinned by a control test.
 */
const FORBIDDEN_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB', 'process', 'globalThis',
  'window', 'self', 'navigator', 'document',
];

/**
 * Every Node builtin, in both spellings, read from Node rather than typed out.
 *
 * `node:*` alone missed the bare form — `import { readFile } from 'fs'` is a
 * valid builtin import that the pattern never saw, and Node's ambient typings
 * let it compile. A hand-written list would be the same defect deferred: it is
 * correct until Node adds a module, and nothing would fail when it does.
 * `builtinModules` is the authority, so the list cannot drift.
 *
 * The `/*` variants cover deep specifiers such as `fs/promises`.
 */
const NODE_BUILTIN_SPECIFIERS = [
  'node:*',
  ...builtinModules,
  ...builtinModules.map((name) => `${name}/*`),
];

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['packages/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', 'demo/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { 'import-x': importX },
    rules: {
      // Names the consumer directly, or reaches past a sibling's public surface.
      'no-restricted-imports': ['error', { patterns: BASE_IMPORT_PATTERNS }],
      // Reaches into a sibling package's internals by walking up out of its own.
      'import-x/no-relative-packages': 'error',
      // Leaves the machine's filesystem layout in a published artifact.
      'import-x/no-absolute-path': 'error',
      // `require()` is the hole in every rule above: `no-restricted-imports`
      // reads module syntax and does not inspect a call, so
      // `require('@issuegraph/viewer/src/document.js')` walks past the seam ban
      // while lint stays green. Every package here is `"type": "module"`, where
      // `require` is not defined at all — so banning it outright costs nothing
      // and closes that door. No source in packages/ or demo/ uses one.
      'no-restricted-syntax': ['error', ...BASE_SYNTAX],
    },
  },
  {
    /**
     * `UNREADABLE_SPECIFIER` applies to what SHIPS, and to nothing else.
     *
     * Its own message says "in a published package", and a test is not one.
     * The purity tests legitimately load every shipped module through
     * ``import(`./${file}`)`` — a computed specifier, and the only way to walk
     * a directory — so applying this to them would fail correct code.
     *
     * A SEPARATE BLOCK rather than an `ignores` on the block above, because an
     * `ignores` there would drop the consumer ban and the seam ban from tests
     * too. Those still apply everywhere; only this one narrows.
     *
     * `BASE_SYNTAX` is repeated here for the reason it is repeated everywhere in
     * this file: flat config REPLACES a rule's options rather than merging them.
     */
    files: ['packages/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', 'demo/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    ignores: ['**/*.test.*', '**/testing/**'],
    rules: {
      'no-restricted-syntax': ['error', ...BASE_SYNTAX, UNREADABLE_SPECIFIER],
    },
  },
  {
    /**
     * The purity rules for the two packages that RENDER.
     *
     * These replace a hand-rolled scanner that lived in each package's
     * `purity.test.ts` and read source with regular expressions. It drew four
     * findings across two review rounds, and the last one was caused by the fix
     * for the round before it: blanking `//` comments also blanked everything
     * after a `//` inside a string, so `const url = 'https://api'; … fetch(url)`
     * scanned clean. Verified, not argued.
     *
     * That is the same lesson the import rules above already record — module
     * syntax is an open grammar and a regex over it is wrong in both directions
     * — arriving a second time by a different door. Comments, string literals,
     * template literals, regex literals and `require()` are all handled by
     * construction once a parser reads the code, and none of them can be
     * "handled" by another pattern.
     *
     * Each package keeps the OTHER half of its purity test — the load with the
     * browser globals removed — because that half never was a scan: it catches
     * a computed access like `globalThis['fet' + 'ch']`, which no static rule
     * sees.
     *
     * TESTS AND TEST HELPERS ARE EXCLUDED, and they have to be: the load test
     * legitimately imports `node:test`, reads `globalThis` and deletes globals.
     * That is the same boundary `shippedSources()` drew — what ships, not what
     * proves it.
     */
    files: BROWSER_PACKAGES,
    ignores: ['**/*.test.ts', '**/testing/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...FORBIDDEN_GLOBALS.map((name) => ({
          name,
          message: `A rendering package may not reach for ${name}. It fetches nothing, authenticates nothing and persists nothing — the host does, through the injected data source.`,
        })),
      ],
      // NO `no-restricted-properties` HERE, deliberately. It used to carry
      // `navigator.sendBeacon` and `document.cookie`, and both are now
      // SUBSUMED: the objects themselves are banned above, so every property
      // reached through them is refused already. Keeping a rule that can only
      // fire where another has fired first is a second thing to maintain that
      // proves nothing, and it reads as though those two properties were the
      // ones that mattered.
      // EXTENDS the base patterns rather than replacing them — see
      // BASE_IMPORT_PATTERNS on why a bare restatement here would be a silent
      // downgrade for these two packages.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...BASE_IMPORT_PATTERNS,
            {
              group: NODE_BUILTIN_SPECIFIERS,
              message:
                'A rendering package may not import a Node builtin — it has to run in a browser. Both spellings are banned: `fs` is as much a builtin as `node:fs`. Note the load test cannot catch this for you: a builtin imports perfectly well under Node.',
            },
          ],
        },
      ],
      // COMPOSED, for the same reason `no-restricted-imports` is: flat config
      // REPLACES a rule's options rather than merging them, so restating only
      // the browser bans here would drop the seam and consumer bans for the two
      // packages that need them most.
      'no-restricted-syntax': [
        'error',
        ...BASE_SYNTAX,
        { selector: 'ImportExpression', message: 'A rendering package loads nothing at runtime.' },
        { selector: "CallExpression[callee.name='eval']", message: 'A rendering package evaluates nothing.' },
        {
          // BOTH SPELLINGS OF ONE CAPABILITY, in one selector. `Function('…')`
          // without `new` constructs exactly the same function as
          // `new Function('…')`, and a selector naming only `NewExpression`
          // caught one of them. `:matches()` takes both node types rather than
          // this becoming two entries that can drift apart.
          selector: ":matches(NewExpression, CallExpression)[callee.name='Function']",
          message: 'A rendering package evaluates nothing — with or without `new`.',
        },
      ],
    },
  },
];
