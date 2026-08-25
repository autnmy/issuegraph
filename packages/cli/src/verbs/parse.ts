/**
 * `parse` — what does this body declare?
 *
 * A DATA verb: it answers with the declaration, and it refuses only in the one
 * state where answering would be a lie. `read`, `absent` and `inert` all have an
 * honest representation, so all three exit `ok`; `unread` does not, so it exits
 * non-zero and emits no `data` at all.
 *
 * `inert` deliberately does NOT refuse. The reader documents that arm as its
 * loosest rule on purpose — a key at any line start with no `---` pair — and
 * hand-authored blocks are overwhelmingly written that way, so a verb that
 * refused it would refuse nearly every real declaration. `validate` is where
 * that finding belongs, and `backfill` is its remedy.
 */

import { parseFrontmatter } from '@issuegraph/reader';

import { classifyDeclaration, unreadErrorLines } from '../declaration.ts';
import { EXIT } from '../exit.ts';
import type { VerbResult } from '../exit.ts';
import { toJson } from '../json.ts';

export function parseBody(body: string): VerbResult {
  const decl = classifyDeclaration(parseFrontmatter(body));

  if (decl.state === 'unread') {
    return {
      // No `data` key, at the wire level as well as the type level. A caller
      // reading this JSON gets the state and the reasons, and nothing it could
      // mistake for an edge list.
      stdout: toJson({ state: decl.state, diagnostics: decl.diagnostics }),
      stderr: unreadErrorLines(decl.diagnostics),
      code: EXIT.unreadDeclaration,
    };
  }

  if (decl.state === 'inert') {
    return {
      stdout: toJson({
        state: decl.state,
        blockDefect: decl.blockDefect,
        diagnostics: decl.diagnostics,
      }),
      stderr: [
        `issuegraph: inert declaration (${decl.blockDefect}) — a block key is present but no \`---\` pair delimits it, so nothing reads it. \`issuegraph backfill\` repairs it.`,
        ...decl.diagnostics.map((d) => `  ${d}`),
      ],
      code: EXIT.ok,
    };
  }

  if (decl.state === 'read') {
    return {
      stdout: toJson({ state: decl.state, data: decl.data, diagnostics: decl.diagnostics }),
      stderr: [],
      code: EXIT.ok,
    };
  }

  return {
    stdout: toJson({ state: decl.state, diagnostics: decl.diagnostics }),
    stderr: [],
    code: EXIT.ok,
  };
}
