/**
 * The dense layer's coverage claim, executable.
 *
 * `seed.ts` says the generated layer exists so the packages are exercised at
 * the size they are built for: a canvas that refuses, capsules to focus, a
 * component too large even when focused, an audit with something to find, a
 * rail longer than its window. Each of those is a property of the seed that a
 * careless edit can quietly remove, so each is pinned here against the
 * package constants that decide it rather than against numbers copied from
 * them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS } from '@issuegraph/core';
import { auditDocument, scaleLadder, INITIAL_SCALE_STATE, RAIL_WINDOW } from '@issuegraph/editor';
import { GRAPH_NODE_BUDGET } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import { explainDocument } from './order.ts';
import {
  DENSE_FIRST_REF,
  DENSE_ISOLATED_COUNT,
  DENSE_LARGEST_COMPONENT,
  coverageSeed,
  denseSeed,
  seedDocument,
  seedHolds,
} from './seed.ts';

const seeded = seedDocument();
const explained = explainDocument(seeded, seedHolds());
const { viewer, audit } = projectDocument(explained, seeded);

describe('the seed is deterministic and layered', () => {
  it('produces the same document on every call', () => {
    assert.deepEqual(seedDocument(), seeded);
  });

  it('keeps the coverage seed below the dense layer, with no reference shared', () => {
    const coverage = coverageSeed();
    const dense = denseSeed();
    for (const issue of coverage.issues) assert.ok(Number(issue.ref) < DENSE_FIRST_REF, issue.ref);
    for (const issue of dense.issues) assert.ok(Number(issue.ref) >= DENSE_FIRST_REF, issue.ref);
    assert.equal(seeded.issues.length, coverage.issues.length + dense.issues.length);
  });

  it('issues no reference twice and points every dense edge at a seeded issue', () => {
    const refs = new Set(seeded.issues.map((issue) => issue.ref));
    assert.equal(refs.size, seeded.issues.length);
    for (const edge of denseSeed().edges) {
      assert.ok(refs.has(edge.from), `${edge.id} from`);
      assert.ok(refs.has(edge.to), `${edge.id} to`);
    }
  });
});

describe('the dense layer reaches the surfaces the sandbox exists for', () => {
  it('is a few hundred issues, most of them edge-free', () => {
    assert.ok(seeded.issues.length >= 250, String(seeded.issues.length));
    const onAnEdge = new Set(seeded.edges.flatMap((edge) => [edge.from, edge.to]));
    const isolated = seeded.issues.filter((issue) => !onAnEdge.has(issue.ref));
    assert.ok(isolated.length >= DENSE_ISOLATED_COUNT, String(isolated.length));
  });

  it('carries every edge type in the dense layer alone', () => {
    const kinds = new Set(denseSeed().edges.map((edge) => edge.kind));
    assert.deepEqual([...kinds].sort(), [...EDGE_FIELDS].sort());
  });

  it('makes the canvas refuse at the top and still refuse on its largest component', () => {
    const top = scaleLadder(viewer, INITIAL_SCALE_STATE);
    assert.notEqual(top.tier, 'direct', `tier ${top.tier} for ${String(top.nodeCount)} nodes`);
    assert.ok(top.nodeCount > GRAPH_NODE_BUDGET);
    const largest = [...top.capsules].sort((a, b) => b.size - a.size)[0];
    assert.ok(largest !== undefined);
    assert.ok(largest.size >= DENSE_LARGEST_COMPONENT, String(largest.size));
    const focused = scaleLadder(viewer, { ...INITIAL_SCALE_STATE, focus: largest.lead });
    assert.notEqual(focused.tier, 'direct', 'the largest component draws when it should refuse');
  });

  it('offers a component small enough to draw when focused', () => {
    const top = scaleLadder(viewer, INITIAL_SCALE_STATE);
    const small = top.capsules.find((capsule) => capsule.size <= GRAPH_NODE_BUDGET);
    assert.ok(small !== undefined, 'every component is past budget, so focus never draws');
    assert.equal(scaleLadder(viewer, { ...INITIAL_SCALE_STATE, focus: small.lead }).tier, 'direct');
  });

  it('flags a cycle on a capsule, so the cycle flag is reachable without editing', () => {
    const top = scaleLadder(viewer, INITIAL_SCALE_STATE);
    assert.ok(top.capsules.some((capsule) => capsule.hasCycle));
  });

  it('gives the audit every class to find', () => {
    const kinds = new Set(auditDocument(audit).map((finding) => finding.kind));
    for (const kind of ['cycle', 'dead-duplicate-ref', 'stale-blocker'] as const) {
      assert.ok(kinds.has(kind), `no ${kind} finding`);
    }
  });

  it('is longer than one rail window', () => {
    assert.ok(viewer.order.slots.length > RAIL_WINDOW * 2, String(viewer.order.slots.length));
  });

  it('has closed origins for the tree projection and promotions for the rail', () => {
    const closed = new Set(seeded.issues.filter((issue) => issue.state === 'closed').map((issue) => issue.ref));
    assert.ok(
      seeded.edges.some((edge) => edge.kind === 'decomposed-from' && closed.has(edge.to)),
      'no decomposed-from edge points at a closed origin',
    );
    assert.ok(viewer.issues.some((issue) => issue.provenance?.kind === 'promotion'));
  });
});
