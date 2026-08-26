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
 * The packages that render, and therefore may not reach for a runtime.
 *
 * `viewer` and `editor` claim "no fetching, no auth, no persistence" — the
 * claim that makes them installable by anyone. `cli`, `reader` and `writer`
 * make no such claim and legitimately read files, so this is scoped rather
 * than global.
 */
const BROWSER_PACKAGES = ['packages/viewer/**/*.ts', 'packages/editor/**/*.ts'];

/** Globals whose mere presence in a rendering package breaks the claim. */
const FORBIDDEN_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB', 'process', 'globalThis',
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
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require']",
          message:
            'require() is not available in these ESM packages, and it bypasses every import rule in this config — including the sibling-seam ban. Use an import.',
        },
      ],
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
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: 'A rendering package sends nothing.' },
        { object: 'document', property: 'cookie', message: 'A rendering package reads no credentials.' },
      ],
      // EXTENDS the base patterns rather than replacing them — see
      // BASE_IMPORT_PATTERNS on why a bare restatement here would be a silent
      // downgrade for these two packages.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...BASE_IMPORT_PATTERNS,
            {
              group: ['node:*'],
              message:
                'A rendering package may not import a Node builtin — it has to run in a browser. Note the load test cannot catch this for you: a builtin imports perfectly well under Node.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require']",
          message:
            'require() is not available in these ESM packages, and it bypasses every import rule in this config — including the Node-builtin ban directly above.',
        },
        { selector: 'ImportExpression', message: 'A rendering package loads nothing at runtime.' },
        { selector: "CallExpression[callee.name='eval']", message: 'A rendering package evaluates nothing.' },
        { selector: "NewExpression[callee.name='Function']", message: 'A rendering package evaluates nothing.' },
      ],
    },
  },
];
