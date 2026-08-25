/**
 * Import rules for the published packages.
 *
 * These four rules replace a hand-rolled scanner that read module syntax with a
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
      // Names the consumer directly.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: FORBIDDEN,
              message:
                'A published @issuegraph package may not depend on the consuming product. Move what you need into the package, or into @issuegraph/core.',
            },
          ],
        },
      ],
      // Reaches into a sibling package's internals by walking up out of its own.
      'import-x/no-relative-packages': 'error',
      // Leaves the machine's filesystem layout in a published artifact.
      'import-x/no-absolute-path': 'error',
    },
  },
];
