/**
 * Assemble the site GitHub Pages deploys: the landing page plus the demo.
 *
 * The demo loads the published packages through an import map whose targets
 * are ABSOLUTE paths into each package's built `dist` — `/packages/store/dist/
 * index.js` and so on — and `serve.mjs` serves the repository root so those
 * resolve locally. `dist/` is gitignored, so a branch deploy of `main` serves
 * `demo/index.html` with nothing behind it. This script produces a tree in
 * which every one of those paths exists, AT THE SAME PATH, so the page that
 * runs on issuegraph.org is byte-identical to the one `serve.mjs` shows.
 *
 * It copies an ALLOWLIST rather than the checkout: a site that ships whatever
 * happens to be in the working tree ships `node_modules`, source maps for
 * private code and anything a contributor left behind. Each entry below is
 * there because the page references it, and `verifySite` proves the page's
 * references resolve inside the result — so a renamed dist file or a new
 * import-map entry fails the build rather than the visitor.
 *
 * The `yaml` browser build is the one thing copied from `node_modules`. It is
 * the reader's own runtime dependency, mapped where the reader resolves it, and
 * pnpm puts a symlink there — so it is copied through `realpath`, following the
 * link to the store, and the destination keeps the symlink's path.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The packages the demo's import map names. Order is irrelevant; presence is not. */
export const SITE_PACKAGES = Object.freeze(['core', 'derive', 'editor', 'reader', 'store', 'viewer']);

/** Files at the repository root the site serves as-is. */
export const ROOT_FILES = Object.freeze(['index.html', 'CNAME', '.nojekyll']);

/** The demo's own files. Its `dist` is the build output; the rest is checked in. */
export const DEMO_FILES = Object.freeze(['demo/index.html', 'demo/styles.css', 'demo/dist']);

/** The reader's `yaml` dependency, at the path the import map resolves it. */
export const YAML_PATH = 'packages/reader/node_modules/yaml';

/**
 * Every local path an HTML page references: import-map targets, `src` and
 * `href` attributes that are not URLs and not fragments.
 *
 * Paths are returned as they appear in the page, absolute ones site-rooted
 * and relative ones resolved against `pagePath`.
 */
export function referencedPaths(html, pagePath) {
  const found = new Set();
  const pageDir = posix.dirname(pagePath);
  const add = (raw) => {
    const value = raw.trim();
    if (value === '' || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return;
    const withoutQuery = value.split(/[?#]/)[0];
    found.add(withoutQuery.startsWith('/') ? withoutQuery.slice(1) : posix.join(pageDir, withoutQuery));
  };
  const importMap = html.match(/<script\s+type="importmap"\s*>([\s\S]*?)<\/script>/);
  if (importMap !== null) {
    const parsed = JSON.parse(importMap[1]);
    for (const target of Object.values(parsed.imports ?? {})) add(String(target));
  }
  for (const match of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) add(match[1]);
  return [...found].sort();
}

/**
 * Whether the page's references all resolve inside `siteRoot`.
 *
 * Returns the missing paths rather than throwing, so a caller can report all
 * of them at once; the CLI below turns a non-empty list into a failure.
 */
export function missingReferences(siteRoot, pagePath) {
  const html = readFileSync(join(siteRoot, pagePath), 'utf8');
  return referencedPaths(html, pagePath).filter((path) => {
    const full = join(siteRoot, path);
    if (!existsSync(full)) return true;
    // A directory satisfies a reference only through its index page, which is
    // how Pages serves `/demo/`.
    return statSync(full).isDirectory() && !existsSync(join(full, 'index.html'));
  });
}

function copyInto(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    // The `.d.ts` files and their maps are the typechecker's; the browser never
    // asks for them and the site has no reason to carry them.
    filter: (path) => !/\.d\.ts(\.map)?$/.test(path),
  });
}

/**
 * Copy the site into `out`. Returns the repository-relative paths it copied.
 *
 * Throws on a missing source: an absent `dist` means the build did not run,
 * and a site assembled from a partial tree is exactly what this script exists
 * to refuse.
 */
export function assembleSite({ root, out }) {
  const copied = [];
  const entries = [
    ...ROOT_FILES,
    ...DEMO_FILES,
    ...SITE_PACKAGES.map((name) => `packages/${name}/dist`),
    `${YAML_PATH}/package.json`,
    `${YAML_PATH}/browser`,
  ];
  for (const entry of entries) {
    const source = join(root, entry);
    if (!existsSync(source)) {
      throw new Error(`cannot assemble the site: ${entry} is missing — has \`pnpm run build\` run?`);
    }
    copyInto(realpathSync(source), join(out, entry));
    copied.push(entry);
  }
  return copied;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const out = resolve(process.argv[2] ?? join(root, '_site'));
  const copied = assembleSite({ root, out });
  const missing = ['index.html', 'demo/index.html'].flatMap((page) =>
    missingReferences(out, page).map((path) => `${page} -> ${path}`),
  );
  if (missing.length > 0) {
    console.error('the assembled site does not satisfy every reference the pages make:');
    for (const line of missing) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`assembled ${String(copied.length)} entries into ${out}`);
}
