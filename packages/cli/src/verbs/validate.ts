/**
 * `validate` — is this body's declaration in good order?
 *
 * A LINT verb. It asks the same question `parse` does and answers it with a
 * different POLICY, which is the split the reader's own documentation describes:
 * the question factors, the policy does not. Concretely, `validate` and `parse`
 * agree on every state except `inert` — a block nothing reads is exactly the
 * finding a linter exists to surface, and exactly the finding a data verb has no
 * business refusing over.
 *
 * | state    | `parse` | `validate` |
 * |----------|---------|------------|
 * | `read`   | ok      | ok         |
 * | `absent` | ok      | ok         |
 * | `inert`  | ok      | inert (5)  |
 * | `unread` | unread (3) | unread (3) |
 */

import { parseFrontmatter } from '@issuegraph/reader';

import { classifyDeclaration, unreadErrorLines } from '../declaration.ts';
import { EXIT } from '../exit.ts';
import type { VerbResult } from '../exit.ts';
import { toJson } from '../json.ts';

export function validateBody(body: string): VerbResult {
  const decl = classifyDeclaration(parseFrontmatter(body));
  const ok = decl.state === 'read' || decl.state === 'absent';

  const stdout = toJson({
    state: decl.state,
    ok,
    ...(decl.state === 'inert' ? { blockDefect: decl.blockDefect } : {}),
    diagnostics: decl.diagnostics,
  });

  if (decl.state === 'unread') {
    return { stdout, stderr: unreadErrorLines(decl.diagnostics), code: EXIT.unreadDeclaration };
  }

  if (decl.state === 'inert') {
    return {
      stdout,
      stderr: [
        `issuegraph: inert declaration (${decl.blockDefect}) — a block key is present but no \`---\` pair delimits it, so nothing reads it. \`issuegraph backfill\` repairs it.`,
        ...decl.diagnostics.map((d) => `  ${d}`),
      ],
      code: EXIT.inertDeclaration,
    };
  }

  return { stdout, stderr: [], code: EXIT.ok };
}
