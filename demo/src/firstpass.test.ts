/**
 * The sandbox's candidate detector.
 *
 * What is worth pinning about a deliberately weak heuristic is not its taste but
 * its HONESTY: that it never offers a relationship the document already carries,
 * that the sentence it writes claims only what it measured, and that the same
 * document produces the same queue — because the sandbox is a comparison surface
 * and a screenshot has to be a reproduction.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import { candidateSource, candidatesIn } from './firstpass.ts';

const document: GraphDocument = {
  issues: [
    { ref: '1', title: 'Token refresh drops the session on 401', state: 'open' },
    { ref: '2', title: 'Session expires randomly after a refresh', state: 'open' },
    { ref: '3', title: 'Rename the config flag', state: 'open' },
    { ref: '4', title: 'Publish the release notes', state: 'closed' },
    { ref: '5', title: 'Publish the release changelog', state: 'closed' },
  ],
  edges: [],
};

describe('the sandbox finds candidates in what it can actually see', () => {
  it('offers a pair that shares an uncommon title word, and says which word', () => {
    const found = candidatesIn(document);
    assert.equal(found.length, 1);
    const only = found[0];
    assert.equal(only?.kind, 'duplicate-of');
    // `duplicate-of` points at the canonical, and the canonical is the one the
    // document reaches first.
    assert.equal(only?.from, '2');
    assert.equal(only?.to, '1');
    assert.deepEqual(
      only?.evidence.map((item) => item.text),
      // The shared words in the OTHER issue's own order, which is the order a
      // reader scanning the two titles meets them in.
      ['both titles use the word “session”', 'both titles use the word “refresh”'],
    );
    assert.ok(only?.evidence.every((item) => item.token === 'shared-title-word'));
  });

  it('offers nothing about issues that are closed', () => {
    // #4 and #5 share two words and are both closed; a first pass is about work
    // that is still in the order.
    assert.ok(candidatesIn(document).every((found) => found.from !== '5' && found.to !== '5'));
  });

  it('never offers a relationship the document already carries', () => {
    // The reader's one keystroke of consent must not be spent on a write the
    // store would refuse as a duplicate.
    const joined: GraphDocument = {
      ...document,
      edges: [makeEdge('duplicate-of', '2', '1')],
    };
    assert.deepEqual(candidatesIn(joined), []);
    // And in either direction — the pair is what is already stated, not the
    // arrow.
    const flipped: GraphDocument = { ...document, edges: [makeEdge('blocked-by', '1', '2')] };
    assert.deepEqual(candidatesIn(flipped), []);
  });

  it('bounds the queue, so first pass has an end', () => {
    const many: GraphDocument = {
      issues: Array.from({ length: 12 }, (_unused, index) => ({
        ref: String(index + 1),
        title: `Rewrite the scheduler pass ${String(index)}`,
        state: 'open' as const,
      })),
      edges: [],
    };
    // 12 issues all sharing words is 66 pairs; the limit is what the host offers.
    assert.equal(candidatesIn(many, 5).length, 5);
  });

  it('answers the same queue for the same document', () => {
    assert.deepEqual(candidatesIn(document), candidatesIn(document));
  });

  it('reads the document at scan time, not at wiring time', async () => {
    // The store moves under the sandbox: writes land, the scenario changes. A
    // scan taken against the boot document would offer relationships the reader
    // has since made.
    let current: GraphDocument = { issues: [], edges: [] };
    const source = candidateSource(() => current);
    assert.deepEqual(await source.findCandidates(), []);
    current = document;
    assert.equal((await source.findCandidates()).length, 1);
  });
});
