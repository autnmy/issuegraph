#!/usr/bin/env node
/**
 * The binary. All of this package's I/O, and nothing else.
 *
 * It reads argv, reads stdin or the file options, calls {@link dispatch}, writes
 * the two streams, and sets an exit code. Every decision it reports was made in
 * the pure layer, which is why the same answers are available to a program that
 * imports this package instead of executing it.
 *
 * NEVER `process.exit()`. It can truncate writes that are still in flight on a
 * pipe, and for this binary stdout IS the answer — a truncated body written back
 * to an issue is worse than any exit code. `process.exitCode` lets Node drain
 * first, which is the same discipline `scripts/check-isolation.ts` follows and
 * for the same reason.
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { parseArgv } from './argv.ts';
import { VERBS } from './argv.ts';
import { EXIT } from './exit.ts';
import type { ExitCode } from './exit.ts';
import { dispatch } from './run.ts';
import type { ResolvedInputs } from './run.ts';

/**
 * Reported by `--version`.
 *
 * A literal rather than a read of `package.json`: the manifest sits outside
 * `rootDir`, so importing it would either break the build layout or bake a
 * second copy of the version into `dist`. The release process owns keeping this
 * in step, exactly as it owns the manifest.
 */
const VERSION = '0.1.0';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A file, or a usage-shaped failure naming the path — never a stack trace. */
async function readTextFile(path: string, option: string): Promise<string | Error> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Error(`${option} ${JSON.stringify(path)} could not be read — ${detail}`);
  }
}

function write(stream: NodeJS.WriteStream, text: string): void {
  if (text !== '') stream.write(text);
}

async function main(): Promise<void> {
  const parsed = parseArgv(process.argv.slice(2));

  let inputs: ResolvedInputs = { primary: '' };

  if (parsed.kind === 'verb') {
    const spec = VERBS[parsed.verb];
    const fileOption = spec.input === 'body' ? '--body-file' : '--input';
    const path = parsed.options.get(fileOption)?.[0];

    if (path !== undefined) {
      const text = await readTextFile(path, fileOption);
      if (text instanceof Error) {
        process.stderr.write(`issuegraph: ${text.message}\n`);
        process.exitCode = EXIT.usage;
        return;
      }
      inputs = { primary: text };
    } else if (process.stdin.isTTY === true) {
      // A terminal with nothing piped in would otherwise block forever, looking
      // like a hang rather than a missing argument.
      process.stderr.write(
        `issuegraph: ${parsed.verb} needs its input on stdin, or through ${fileOption} <path>\n`,
      );
      process.exitCode = EXIT.usage;
      return;
    } else {
      inputs = { primary: await readStdin() };
    }

    const edgesPath = parsed.options.get('--edges-file')?.[0];
    if (edgesPath !== undefined) {
      const text = await readTextFile(edgesPath, '--edges-file');
      if (text instanceof Error) {
        process.stderr.write(`issuegraph: ${text.message}\n`);
        process.exitCode = EXIT.usage;
        return;
      }
      inputs = { primary: inputs.primary, edgesFile: text };
    }
  }

  const result = dispatch(parsed, inputs, VERSION);
  write(process.stdout, result.stdout);
  write(process.stderr, result.stderr.length === 0 ? '' : `${result.stderr.join('\n')}\n`);
  process.exitCode = result.code;
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`issuegraph: internal error — ${detail}\n`);
  // `internal` is its own code so a crash is never mistaken for a verdict.
  const code: ExitCode = EXIT.internal;
  process.exitCode = code;
});
