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
import type { BackfillOutcome, GeneratedEdges, IssueRef } from '@issuegraph/writer';
import { parseFrontmatter } from '@issuegraph/reader';
import type { Evidence } from '@issuegraph/core';

import { classifyDeclaration, unreadErrorLines } from '../declaration.ts';
import { toJson } from '../json.ts';
import type { Declaration } from '../declaration.ts';
import {
  EDGE_JSON_KEYS,
  RENDER_ONLY,
  clearRefusalReason,
  unperformableClear,
  writeRequestRefusal,
} from '../fields.ts';
import type { AssertTrue, SameKeys, WriteRefusal } from '../fields.ts';
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

/**
 * The keys a `set` request may name — the allowlist `performWrite` applies to it.
 *
 * It sits beside `SetFields` rather than in `fields.ts` because it is that
 * interface's key set and nothing else, and `fields.ts` proves it: the
 * `SetFieldKeysCoverSetFields` line below fails to compile if a field is added
 * to `SetFields` and not to this list, or left here after being removed.
 */
export const SET_FIELD_KEYS = Object.freeze([
  'blockedBy',
  'serializeWith',
  'decomposedFrom',
  'duplicateOf',
  'togetherWith',
  'priority',
  'evidence',
] as const);

/** @see SET_FIELD_KEYS — the compile-time totality proof, not a runtime value. */
export type SetFieldKeysCoverSetFields = AssertTrue<
  SameKeys<(typeof SET_FIELD_KEYS)[number], keyof SetFields>
>;


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
 * Render a precondition refusal.
 *
 * Built per call rather than shared as a constant: `readonly` is compile-time
 * only, so one caller reaching into `stderr` would change what every later
 * caller reports.
 */
function refuse(refusal: WriteRefusal): VerbResult {
  if (refusal.kind === 'nothing-requested') {
    return {
      stdout: '',
      stderr: ['issuegraph: no fields were given, so there is nothing to write'],
      code: EXIT.usage,
    };
  }
  if (refusal.kind === 'unsupported-key') {
    // `usage`, matching what `--edges` already reports for an unrecognised key
    // at the process boundary: the request is malformed, not a performable
    // request the writer declines.
    return {
      stdout: '',
      stderr: [
        `issuegraph: ${JSON.stringify(refusal.key)} is not a field this write can set. ` +
          `Allowed: ${refusal.allowed.join(', ')}`,
      ],
      code: EXIT.usage,
    };
  }
  return {
    stdout: '',
    stderr: [`issuegraph: refusing to write — ${clearRefusalReason(refusal.field)}`],
    code: EXIT.refusedWrite,
  };
}

/**
 * THE ONLY WAY TO REACH THE WRITER.
 *
 * It owns the questions every write shares — does the request name only fields
 * this write can act on, does it ask for anything, is what it asks for
 * performable, and was the block readable — and answers them BEFORE `perform`
 * runs. A write path written through this cannot skip them, so the guarantee is
 * structural rather than a rule each author has to remember.
 *
 * The allowlist is an ARGUMENT because the answer to the FIRST question differs
 * per path — `set` owns seven fields, `splice` owns four — while the other three
 * are the same for every write. Fixing one shared list here would have to be the
 * union of the two, which accepts `togetherWith` into a splice that ignores it.
 *
 * That is the point. Review found four spellings of one defect across three
 * rounds, and every fix added the missing check at the one site that lacked it,
 * which is exactly why the next round found the next site. The check is not
 * per-site any more.
 *
 * What it deliberately does NOT own is each verb's declaration-state policy:
 * `set` renders into an absent body and refuses an inert one, `splice` lets the
 * writer's own null return speak. Those genuinely differ, and folding them in
 * would make the funnel a place where behaviour hides.
 */
function performWrite(
  body: string,
  request: { readonly decomposedFrom?: unknown; readonly duplicateOf?: unknown },
  allowed: readonly string[],
  perform: (declaration: Declaration) => VerbResult,
): VerbResult {
  const refusal = writeRequestRefusal(request, allowed);
  if (refusal !== null) return refuse(refusal);

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
  return perform(decl);
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
  return performWrite(body, fields, SET_FIELD_KEYS, (decl) => {
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
      //
      // IT ASKS `unperformableClear` rather than listing the two fields again.
      // The list that used to sit here was a fourth copy of a rule the writer now
      // exports, and `fields.ts` already says why there must be exactly one
      // implementation: each previous fix added the check at the one site that
      // lacked it, which is why the next round found the next site.
      const unclearable = unperformableClear(fields);
      if (unclearable !== null) {
        return {
          stdout: '',
          stderr: [`issuegraph: refusing to write — ${clearRefusalReason(unclearable)}`],
          code: EXIT.refusedWrite,
        };
      }

      const renderOnly = renderOnlyRequested(fields);
      if (renderOnly.length > 0) {
        return {
          stdout: '',
          stderr: [
            `issuegraph: refusing to write ${renderOnly.join(', ')} into an existing block — the writer's splice surface owns generated edges only (blocked-by, serialize-with, decomposed-from, duplicate-of).`,
            `  ${RENDER_ONLY.join(', ')} can be written when the body has no block yet, but not amended in one that has.`,
          ],
          code: EXIT.refusedWrite,
        };
      }
      const spliced = spliceGeneratedEdges(body, toGeneratedEdges(fields));
      // ONE MESSAGE PER OUTCOME. Under the old `string | null` contract these
      // were one sentence covering three different situations, so the operator
      // was told "could not edit this block" whichever had happened and had no
      // way to tell which repair applied.
      switch (spliced.outcome) {
        case 'spliced':
          return { stdout: spliced.body, stderr: [], code: EXIT.ok };
        case 'no-block':
          return {
            stdout: '',
            stderr: [
              'issuegraph: refusing to write — this body carries no readable block to edit. `issuegraph set` on a body with no block prepends one.',
            ],
            code: EXIT.refusedWrite,
          };
        case 'uneditable-block':
          return {
            stdout: '',
            stderr: [
              'issuegraph: refusing to write — the block is readable but not line-editable (its section is a flow mapping) and carries entries this command does not own.',
              '  Editing it would demote the block and drop those entries. Rewrite the block from its current value instead.',
            ],
            code: EXIT.refusedWrite,
          };
        case 'not-written':
          return {
            stdout: '',
            stderr: [
              `issuegraph: refusing to write — the edit did not land: ${spliced.detail}.`,
              '  The body was left untouched; this is a writer defect, not a bad input.',
            ],
            code: EXIT.refusedWrite,
          };
      }
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
  });
}

/**
 * `splice` — refresh the owned generated edges inside an existing block.
 *
 * Unlike `set` it never prepends: a body with no block is a refusal, because the
 * caller asked to edit a block and there is none. That is the writer's own
 * contract surfaced at the process boundary.
 */
export function spliceEdges(body: string, edges: GeneratedEdges): VerbResult {
  return performWrite(body, edges, EDGE_JSON_KEYS, () => {
    const spliced = spliceGeneratedEdges(body, edges);
    if (spliced.outcome !== 'spliced') {
      // The three refusals differ in what the operator should DO, which is the
      // whole reason the writer stopped returning `null` for all of them.
      const stderr =
        spliced.outcome === 'no-block'
          ? [
              'issuegraph: refusing to splice — this body carries no delimited block to edit. `issuegraph set` prepends one; `issuegraph backfill` repairs an undelimited one.',
            ]
          : spliced.outcome === 'uneditable-block'
            ? [
                'issuegraph: refusing to splice — the block is readable but not line-editable (its section is a flow mapping) and carries entries this command does not own.',
                '  Editing it would demote the block and drop those entries. Rewrite the block from its current value instead.',
              ]
            : [
                `issuegraph: refusing to splice — the edit did not land: ${spliced.detail}.`,
                '  The body was left untouched; this is a writer defect, not a bad input.',
              ];
      return { stdout: '', stderr, code: EXIT.refusedWrite };
    }
    return { stdout: spliced.body, stderr: [], code: EXIT.ok };
  });
}

/** How `backfill` should answer. */
export interface BackfillOptions {
  /**
   * Emit the OUTCOME as JSON on stdout instead of the repaired body.
   *
   * Off by default, because the body-in/body-out shape is what makes
   * `issuegraph backfill < body > new-body` work in a shell.
   */
  readonly json: boolean;
}

/**
 * The stderr line for each outcome, as a TOTAL record rather than a ladder.
 *
 * Total over {@link BackfillOutcome}, so a fifth outcome added to the writer is
 * a compile error here instead of a body that silently prints nothing. The
 * refusal is in this table too — it is a line about an outcome like the other
 * three, and keeping it out was what let the two spellings drift.
 */
const BACKFILL_NOTE: Readonly<Record<BackfillOutcome, string>> = Object.freeze({
  delimited: 'issuegraph: backfilled — the block is now delimited and readable',
  'already-canonical':
    'issuegraph: nothing to do — the block was already canonical; the body is unchanged',
  'no-block': 'issuegraph: nothing to do — this body carries no block; the body is unchanged',
  unrecoverable:
    'issuegraph: refusing to backfill — this block cannot be repaired without guessing what it meant',
});

/**
 * `backfill` — repair a block a code fence left inert, by adding the `---` pair
 * its author omitted and changing nothing else.
 *
 * The four outcomes map to two codes: three of them are honest answers with a
 * body to emit, and only `unrecoverable` is a refusal.
 *
 * ---------------------------------------------------------------------------
 * WHY `--json` EXISTS, AND WHY NOTHING ELSE WOULD DO
 * ---------------------------------------------------------------------------
 * Without it the outcome is observable ONLY as the prose on stderr, and a
 * programmatic caller that needs to branch on it — write this body, skip that
 * one, escalate the third to a human — has no choice but to string-match
 * another package's message text. A reworded message then stops matching
 * silently and FAILS OPEN, which is the same class of defect this package
 * exists to refuse.
 *
 * `validate` cannot stand in for it, and this is the measurement rather than an
 * intuition. These two bodies produce BYTE-IDENTICAL `validate` output —
 * `{"state":"inert","ok":false,"blockDefect":"undelimited"}` — while `backfill`
 * repairs the first and refuses the second:
 *
 *     x                                     issuegraph:
 *                                             blocked-by: [8232]
 *     ```yaml
 *     issuegraph:
 *       blocked-by: [8232]
 *     ```
 *
 * So `delimited` and `unrecoverable` are distinguishable at this boundary and
 * nowhere else. A backlog-repair caller — write this body, skip that one,
 * escalate the third — branches on exactly that distinction, which is why one
 * could not adopt this binary at all before the flag existed.
 *
 * THE EXIT CODE IS UNCHANGED BY THE FLAG, deliberately. `exit.ts` states the
 * contract: the code carries the COMMAND'S DECISION and the payload carries the
 * declaration's state. `unrecoverable` is a refused write whether or not the
 * caller asked for JSON, so a flag that softened it to `ok` would make the
 * shell reading and the program reading disagree about the same run.
 *
 * `body` IS OMITTED ON A REFUSAL, at the wire level as well as the type level —
 * the same shape `parse` uses for `unread`. The input was NOT repaired, so a
 * `body` key here is a value a caller could write back believing it had been.
 * There is nothing to emit, so nothing is emitted.
 */
export function backfill(body: string, options: BackfillOptions = { json: false }): VerbResult {
  const result = backfillFrontmatter(body);
  const notes = result.diagnostics.map((d) => `  ${d}`);
  const stderr = [BACKFILL_NOTE[result.outcome], ...notes];
  const refused = result.outcome === 'unrecoverable';
  const code = refused ? EXIT.refusedWrite : EXIT.ok;

  if (options.json) {
    return {
      stdout: toJson(
        refused
          ? { outcome: result.outcome, diagnostics: result.diagnostics }
          : { outcome: result.outcome, body: result.body, diagnostics: result.diagnostics },
      ),
      stderr,
      code,
    };
  }

  return { stdout: refused ? '' : result.body, stderr, code };
}
