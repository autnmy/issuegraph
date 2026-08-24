/**
 * The three write verbs: `set`, `splice` and `backfill`.
 *
 * All three are body-in / body-out. The resulting body is the ONLY thing that
 * reaches stdout, so `issuegraph set … < body > new-body` is safe; every note,
 * warning and refusal goes to stderr.
 *
 * Every byte of editing is `@issuegraph/writer`'s. Nothing here builds a line.
 *
 * WHY `set` AND `splice` ARE BOTH KEPT. They mirror the writer's own split and
 * are not two spellings of one thing:
 *
 * - `splice` is the low-level generated-edges operation. A field it is given is
 *   OWNED (existing entries removed, new ones inserted); a field it is not given
 *   is untouched; and it REFUSES when there is no block to edit.
 * - `set` is the ergonomic one. It routes: render a fresh block when the body
 *   has none, splice when it has one.
 *
 * WHAT NEITHER CAN DO, stated plainly rather than discovered — the capability
 * table lives in `fields.ts` and this is its consequence. Two limits, and they
 * are different:
 *
 * - The splice surface owns GENERATED EDGES only, so `together-with`,
 *   `priority` and `evidence` reach a body with NO block (via render) and cannot
 *   be amended in one that has. The specification makes a tracker's own
 *   convention canonical for those, and the frontmatter field a mirror.
 * - Of the four edges it does own, only `blocked-by` and `serialize-with` can be
 *   REMOVED. For `decomposed-from` and `duplicate-of` the writer reads an empty
 *   value as "leave untouched" — deliberately, since they carry provenance and a
 *   dedupe verdict rather than scheduling state, and a machine refreshing its
 *   owned edges must not erase them by omission.
 *
 * BOTH ARE REFUSED WITH THE REASON, never silently dropped. A write command that
 * exits 0 having changed nothing is the same defect this package exists to
 * refuse, rebuilt one layer up: it tells its caller a thing happened that did
 * not, and automation has no way to detect it.
 */

import { backfillFrontmatter, renderFrontmatter, spliceGeneratedEdges } from '@issuegraph/writer';
import type { GeneratedEdges, IssueRef } from '@issuegraph/writer';
import { parseFrontmatter } from '@issuegraph/reader';
import type { Evidence } from '@issuegraph/core';

import { classifyDeclaration, unreadErrorLines } from '../declaration.ts';
import { clearRefusalReason, unperformableClear } from '../fields.ts';
import { EXIT } from '../exit.ts';
import type { VerbResult } from '../exit.ts';

/**
 * The fields `set` accepts.
 *
 * Absent means "leave alone". A `null` (or `[]` for the list) is a CLEAR
 * REQUEST — and a clear is only performable for the fields `fields.ts` lists as
 * clearable. Asking to clear any of the others in a body that already has a
 * block is refused rather than accepted and dropped; see the module note.
 */
export interface SetFields {
  readonly blockedBy?: readonly IssueRef[];
  readonly serializeWith?: IssueRef | null;
  readonly decomposedFrom?: IssueRef | null;
  readonly duplicateOf?: IssueRef | null;
  /** Render-only — see the module note. */
  readonly togetherWith?: IssueRef | null;
  /** Render-only — see the module note. */
  readonly priority?: number | null;
  /** Render-only — see the module note. */
  readonly evidence?: Evidence | null;
}

/** The three fields the writer's splice surface does not own, in message order. */
const RENDER_ONLY_FIELDS = Object.freeze(['together-with', 'priority', 'evidence'] as const);

function renderOnlyRequested(fields: SetFields): readonly string[] {
  const requested: string[] = [];
  if (fields.togetherWith !== undefined) requested.push('together-with');
  if (fields.priority !== undefined) requested.push('priority');
  if (fields.evidence !== undefined) requested.push('evidence');
  return requested;
}

function toGeneratedEdges(fields: SetFields): GeneratedEdges {
  return {
    ...(fields.blockedBy === undefined ? {} : { blockedBy: fields.blockedBy }),
    ...(fields.serializeWith === undefined ? {} : { serializeWith: fields.serializeWith }),
    ...(fields.decomposedFrom === undefined ? {} : { decomposedFrom: fields.decomposedFrom }),
    ...(fields.duplicateOf === undefined ? {} : { duplicateOf: fields.duplicateOf }),
  };
}

/**
 * Built per call rather than shared. A module-level constant is `readonly` to
 * TypeScript and mutable at runtime, so one caller reaching into `stderr` would
 * change what every later caller reports.
 */
/**
 * The refusal, built where the request arrives.
 *
 * Every write path shares it so the message and the exit code cannot diverge
 * between the command line and the library.
 */
function refuseClear(field: string): VerbResult {
  return {
    stdout: '',
    stderr: [`issuegraph: refusing to write — ${clearRefusalReason(field)}`],
    code: EXIT.refusedWrite,
  };
}

function nothingToDo(): VerbResult {
  return {
    stdout: '',
    stderr: ['issuegraph: no fields were given, so there is nothing to write'],
    code: EXIT.usage,
  };
}

/**
 * `set` — write the given fields into the body, whether or not it has a block.
 *
 * Refuses on `unread`: splicing into a block we could not read would replace
 * entries we never saw, which is how two hard blockers disappear. Refuses on
 * `inert` too, because prepending a second block beside an undelimited one
 * leaves a body with two declarations and no way to tell which wins — `backfill`
 * is the repair, and the message says so.
 */
export function setFields(body: string, fields: SetFields): VerbResult {
  if (Object.keys(fields).length === 0) return nothingToDo();

  const decl = classifyDeclaration(parseFrontmatter(body));

  if (decl.state === 'unread') {
    return {
      stdout: '',
      stderr: [
        ...unreadErrorLines(decl.diagnostics),
        'issuegraph: refusing to write — editing a block that could not be read would replace entries this run never saw',
      ],
      code: EXIT.unreadDeclaration,
    };
  }

  if (decl.state === 'inert') {
    return {
      stdout: '',
      stderr: [
        `issuegraph: refusing to write — a block key is present but no \`---\` pair delimits it (${decl.blockDefect}), and prepending a second block would leave two declarations. Run \`issuegraph backfill\` first.`,
      ],
      code: EXIT.refusedWrite,
    };
  }

  if (decl.state === 'read') {
    // A CLEAR THE WRITER CANNOT PERFORM IS REFUSED HERE, not only in the flag
    // table. The flags are one caller; this package is importable, so a program
    // holding `SetFields` reaches the same assignment, and refusing only at the
    // command line would leave the silent no-op available through the library.
    const unclearable = [
      ['decomposed-from', fields.decomposedFrom],
      ['duplicate-of', fields.duplicateOf],
    ] as const;
    for (const [field, value] of unclearable) {
      if (value === null) {
        return {
          stdout: '',
          stderr: [`issuegraph: refusing to write — ${clearRefusalReason(field)}`],
          code: EXIT.refusedWrite,
        };
      }
    }

    const renderOnly = renderOnlyRequested(fields);
    if (renderOnly.length > 0) {
      return {
        stdout: '',
        stderr: [
          `issuegraph: refusing to write ${renderOnly.join(', ')} into an existing block — the writer's splice surface owns generated edges only (blocked-by, serialize-with, decomposed-from, duplicate-of).`,
          `  ${RENDER_ONLY_FIELDS.join(', ')} can be written when the body has no block yet, but not amended in one that has.`,
        ],
        code: EXIT.refusedWrite,
      };
    }
    const spliced = spliceGeneratedEdges(body, toGeneratedEdges(fields));
    if (spliced === null) {
      return {
        stdout: '',
        stderr: ['issuegraph: refusing to write — the writer could not edit this block and keep it readable'],
        code: EXIT.refusedWrite,
      };
    }
    return { stdout: spliced, stderr: [], code: EXIT.ok };
  }

  // `absent`: render a fresh block and prepend it, in the canonical position.
  const block = renderFrontmatter({
    ...(fields.blockedBy === undefined ? {} : { blockedBy: fields.blockedBy }),
    ...(fields.serializeWith === undefined ? {} : { serializeWith: fields.serializeWith }),
    ...(fields.decomposedFrom === undefined ? {} : { decomposedFrom: fields.decomposedFrom }),
    ...(fields.duplicateOf === undefined ? {} : { duplicateOf: fields.duplicateOf }),
    ...(fields.togetherWith === undefined ? {} : { togetherWith: fields.togetherWith }),
    ...(fields.priority === undefined ? {} : { priority: fields.priority }),
    ...(fields.evidence === undefined ? {} : { evidence: fields.evidence }),
  });
  if (block === null) {
    // Every requested field was a clear, and there was nothing to clear.
    return { stdout: body, stderr: ['issuegraph: nothing to write; the body has no block and every field given was a clear'], code: EXIT.ok };
  }
  return { stdout: `${block}\n\n${body}`, stderr: [], code: EXIT.ok };
}

/**
 * `splice` — refresh the owned generated edges inside an existing block.
 *
 * Unlike `set` it never prepends: a body with no block is a refusal, because the
 * caller asked to edit a block and there is none. That is the writer's own
 * contract surfaced at the process boundary.
 */
export function spliceEdges(body: string, edges: GeneratedEdges): VerbResult {
  // THE EXPORTED PATH NEEDS THE SAME REFUSAL AS `setFields`. This takes the
  // writer's own `GeneratedEdges`, where `null` legitimately means "leave
  // untouched" — which is why the first fix for this class stopped short here.
  // That reasoning was wrong for one decisive reason: OMITTING the key already
  // means untouched, so `null` is a redundant spelling with no intent of its own
  // and the only thing a caller can plausibly mean by it is "clear". Refusing it
  // therefore breaks no legitimate use, and accepting it returns the body
  // unchanged at exit 0 to a caller who asked for a removal.
  const unperformable = unperformableClear(edges);
  if (unperformable !== null) return refuseClear(unperformable);

  const decl = classifyDeclaration(parseFrontmatter(body));

  if (decl.state === 'unread') {
    return {
      stdout: '',
      stderr: [
        ...unreadErrorLines(decl.diagnostics),
        'issuegraph: refusing to splice — editing a block that could not be read would replace entries this run never saw',
      ],
      code: EXIT.unreadDeclaration,
    };
  }

  const spliced = spliceGeneratedEdges(body, edges);
  if (spliced === null) {
    return {
      stdout: '',
      stderr: [
        'issuegraph: refusing to splice — this body carries no delimited block to edit. `issuegraph set` prepends one; `issuegraph backfill` repairs an undelimited one.',
      ],
      code: EXIT.refusedWrite,
    };
  }
  return { stdout: spliced, stderr: [], code: EXIT.ok };
}

/**
 * `backfill` — repair a block a code fence left inert, by adding the `---` pair
 * its author omitted and changing nothing else.
 *
 * The four outcomes map to two codes: three of them are honest answers with a
 * body to emit, and only `unrecoverable` is a refusal.
 */
export function backfill(body: string): VerbResult {
  const result = backfillFrontmatter(body);
  const notes = result.diagnostics.map((d) => `  ${d}`);

  if (result.outcome === 'unrecoverable') {
    return {
      stdout: '',
      stderr: ['issuegraph: refusing to backfill — this block cannot be repaired without guessing what it meant', ...notes],
      code: EXIT.refusedWrite,
    };
  }

  const note =
    result.outcome === 'delimited'
      ? 'issuegraph: backfilled — the block is now delimited and readable'
      : result.outcome === 'already-canonical'
        ? 'issuegraph: nothing to do — the block was already canonical; the body is unchanged'
        : 'issuegraph: nothing to do — this body carries no block; the body is unchanged';

  return { stdout: result.body, stderr: [note, ...notes], code: EXIT.ok };
}
