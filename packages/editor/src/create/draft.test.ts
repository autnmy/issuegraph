import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS } from '@issuegraph/core';
import type { EdgeKind, Proposal } from '@issuegraph/store';

import {
  type CreateCommand,
  type CreateResult,
  IDLE_CREATE_DRAFT,
  createReducer,
} from './draft.ts';
import { OBJECT, SUBJECT } from '../testing/picker.ts';

/** Drive a whole command sequence, returning the last result. */
function run(commands: readonly CreateCommand[]): CreateResult {
  return commands.reduce<CreateResult>(
    (result, command) => createReducer(result.draft, command),
    { draft: IDLE_CREATE_DRAFT, proposal: null },
  );
}

/** Every proposal a sequence emitted, in order. */
function emitted(commands: readonly CreateCommand[]): readonly Proposal[] {
  const proposals: Proposal[] = [];
  let draft = IDLE_CREATE_DRAFT;
  for (const command of commands) {
    const result = createReducer(draft, command);
    draft = result.draft;
    if (result.proposal !== null) proposals.push(result.proposal);
  }
  return proposals;
}

const begin = (source: string): CreateCommand => ({ kind: 'begin', source });
const target = (ref: string): CreateCommand => ({ kind: 'target', ref });
const type = (edgeKind: EdgeKind): CreateCommand => ({ kind: 'type', edgeKind });
const CANCEL: CreateCommand = { kind: 'cancel' };

describe('the draft is a SET of facts, so the gather order cannot matter', () => {
  // The two orders the three paths actually use: canvas gathers the target by
  // dragging to it and only then asks for a type, while the inspector and the
  // keyboard both choose a type before naming a target.
  const orders = [
    { path: 'canvas', commands: [begin(SUBJECT), target(OBJECT), type('blocked-by')] },
    { path: 'inspector/keyboard', commands: [begin(SUBJECT), type('blocked-by'), target(OBJECT)] },
  ] as const;

  for (const { path, commands } of orders) {
    it(`emits the same proposal gathering in ${path} order`, () => {
      assert.deepEqual(run(commands).proposal, {
        op: 'create',
        kind: 'blocked-by',
        from: SUBJECT,
        to: OBJECT,
      });
    });
  }

  it('emits on whichever command completes the set, and not before', () => {
    // The discriminating assertion: the FIRST two commands of each order emit
    // nothing, so the emission is genuinely tied to completeness rather than to
    // a particular command happening to be last.
    for (const { commands } of orders) {
      const [first, second] = commands;
      assert.ok(first !== undefined && second !== undefined);
      assert.equal(emitted([first]).length, 0);
      assert.equal(emitted([first, second]).length, 0);
      assert.equal(emitted(commands).length, 1);
    }
  });

  it('carries the gather order into the pair, so direction is stated not inferred', () => {
    // Reversing the two issues reverses the edge. Nothing in the reducer sorts,
    // canonicalizes or guesses which way a `blocked-by` "should" read — §17b
    // states direction and offers a flip, and this is the half that stays put.
    const forward = run([begin(SUBJECT), target(OBJECT), type('blocked-by')]).proposal;
    const backward = run([begin(OBJECT), target(SUBJECT), type('blocked-by')]).proposal;
    assert.deepEqual(forward, { op: 'create', kind: 'blocked-by', from: SUBJECT, to: OBJECT });
    assert.deepEqual(backward, { op: 'create', kind: 'blocked-by', from: OBJECT, to: SUBJECT });
  });

  for (const kind of EDGE_FIELDS) {
    it(`carries the pair for the symmetric-or-not kind ${kind}`, () => {
      // A symmetric kind keeps its pair too — `StoredEdge` does, precisely so an
      // editor knows which issue carries the field — so the reducer must not
      // start normalizing one away.
      assert.deepEqual(run([begin(SUBJECT), target(OBJECT), type(kind)]).proposal, {
        op: 'create',
        kind,
        from: SUBJECT,
        to: OBJECT,
      });
    });
  }
});

describe('one user act, one proposal', () => {
  it('resets on emission, so a further command cannot re-emit', () => {
    const complete = [begin(SUBJECT), target(OBJECT), type('blocked-by')] as const;
    const result = run([...complete]);
    assert.deepEqual(result.draft, IDLE_CREATE_DRAFT);

    // The regression this guards: were the draft left full, ANY later command
    // would complete it again. A second `type` is the cheapest way to ask.
    assert.deepEqual(emitted([...complete, type('duplicate-of')]), [
      { op: 'create', kind: 'blocked-by', from: SUBJECT, to: OBJECT },
    ]);
  });

  it('emits exactly once across a long, indecisive gather', () => {
    assert.deepEqual(
      emitted([
        begin(SUBJECT),
        type('blocked-by'),
        type('duplicate-of'),
        target('999'),
        target(OBJECT),
      ]),
      // Re-choosing overwrites the slot; only the completing command emits, and
      // it carries the LATEST value of each slot.
      [{ op: 'create', kind: 'duplicate-of', from: SUBJECT, to: '999' }],
    );
  });
});

describe('withdrawal and restart', () => {
  it('cancel emits nothing even from a draft one command short', () => {
    assert.deepEqual(emitted([begin(SUBJECT), type('blocked-by'), CANCEL, target(OBJECT)]), []);
  });

  it('cancel emits nothing when the draft is already complete-able', () => {
    // The sharp case: `cancel` arriving where a `target` would have completed
    // the set. A reducer that emitted on any transition with three slots filled
    // would fire the edit the reader just withdrew.
    const result = run([begin(SUBJECT), target(OBJECT), type('blocked-by'), CANCEL]);
    assert.equal(result.proposal, null);
    assert.deepEqual(result.draft, IDLE_CREATE_DRAFT);
  });

  it('begin clears a half-built draft rather than inheriting its target', () => {
    // Changing your mind about the subject must not build an edge out of two
    // halves of two intentions.
    assert.deepEqual(emitted([begin(SUBJECT), target(OBJECT), begin('42')]), []);
    assert.deepEqual(run([begin(SUBJECT), target(OBJECT), begin('42')]).draft, {
      source: '42',
      target: null,
      kind: null,
    });
  });
});

describe('an incomplete draft is inert, never a guess', () => {
  const partials: readonly (readonly CreateCommand[])[] = [
    [begin(SUBJECT)],
    [target(OBJECT)],
    [type('blocked-by')],
    [begin(SUBJECT), type('blocked-by')],
    [target(OBJECT), type('blocked-by')],
  ];

  for (const commands of partials) {
    it(`emits nothing for [${commands.map((c) => c.kind).join(', ')}]`, () => {
      assert.deepEqual(emitted(commands), []);
    });
  }

  it('never mutates the draft it was given', () => {
    const before = { source: SUBJECT, target: null, kind: null } as const;
    createReducer(before, target(OBJECT));
    assert.deepEqual(before, { source: SUBJECT, target: null, kind: null });
  });
});
