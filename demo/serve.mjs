/**
 * A static server for the demo, with no dependencies.
 *
 * "Runs from a clean checkout with no credentials of any kind" is the
 * milestone's bar, and it would be a thin bar if running the page pulled a
 * server off the registry first. `node:http` is enough: the page needs nothing
 * but files served with the right content types, because the browser's own
 * module loader resolves the packages through the import map.
 *
 * It serves the REPOSITORY ROOT rather than `demo/`, because the import map
 * points at the built `dist` directory of each package under `packages`, which
 * is where the browser has to be able to reach them.
 *
 * Localhost only, and read-only. It exists to look at a page on this machine.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * The requested path, resolved inside the root or not at all.
 *
 * A static server that joins a URL onto a directory serves whatever `..`
 * reaches. Decoding first and then testing the RESOLVED path against the root
 * is what makes that impossible, rather than stripping the sequences a request
 * is expected to contain.
 */
function resolveWithin(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const full = resolve(join(root, normalize(decoded)));
  if (full !== root && !full.startsWith(root + sep)) return undefined;
  return full;
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end('method not allowed\n');
    return;
  }
  const requested = new URL(request.url ?? '/', 'http://localhost').pathname;
  let file = resolveWithin(requested);
  if (file === undefined) {
    response.writeHead(403).end('forbidden\n');
    return;
  }
  let stats;
  try {
    stats = statSync(file);
    if (stats.isDirectory()) {
      // REDIRECT rather than serve the index here. Without the trailing slash
      // the browser resolves the page's own relative `./styles.css` and
      // `./dist/main.js` against the PARENT, so `/demo` would render an
      // unstyled page with no script and no error anyone could read.
      if (!requested.endsWith('/')) {
        response.writeHead(301, { location: `${requested}/` }).end();
        return;
      }
      file = join(file, 'index.html');
      stats = statSync(file);
    }
  } catch {
    response.writeHead(404).end('not found\n');
    return;
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': stats.size,
    // Nothing here is deployed; a cached stale bundle after a rebuild is the
    // one confusing failure a local demo server can produce.
    'cache-control': 'no-store',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`the demo is at http://127.0.0.1:${port}/demo/`);
});
