/**
 * The layer agreement contract: every value layer 2 derives from a
 * `ViewerDocument` agrees with what layer 1 draws from the same one.
 *
 * ## Why this is one test rather than six
 *
 * `@issuegraph/editor` composes `@issuegraph/viewer` and, in the places layer 1
 * publishes no value for, RESTATES one of its rules. Three restatements are
 * live on this surface today: `railWindow` restates which `together-with` edges
 * the linear projection can draw and which issues it counts as isolated, and
 * `inspectorView` restates the canonicalization `stationsOf` performs before a
 * projection draws. Each restatement is correct as written and none of them is
 * connected to the rule it restates by anything a compiler or a test can see.
 *
 * That disconnection is the defect CLASS, and it arrives one instance per
 * review round: six of the twenty findings on #76 were members of it, each
 * correct, each fixed, the class untouched. A test per instance is what that
 * shape produces and it never converges, because the next instance is a rule
 * nobody has restated yet.
 *
 * So this file asserts the INVARIANT the instances were all violations of,
 * over a corpus rather than a fixture. A future restatement that drifts from
 * layer 1 breaks a property here on the round it is written, not on the round a
 * reader happens to notice.
 *
 * ## What it does NOT do, stated so nobody reads more into a green run
 *
 * It cannot prove layer 2 restates a rule CORRECTLY in a case the corpus does
 * not carry. It proves the two layers agree on the documents below, and its
 * value is proportional to what those documents contain — which is why the
 * corpus deliberately holds malformed shapes (a duplicate placement, a
 * self-edge, an edge naming an issue the document does not carry) rather than
 * only well-formed ones. Every recorded instance of this class was a
 * disagreement that only appeared on an input layer 1 had to drop something
 * from, or on a window that cut a relationship in half.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';
import type { ViewerDocument } from '@issuegraph/viewer';
import { normalizeDocument, renderViewer } from '@issuegraph/viewer';

import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';
import { inspectorView } from './inspector.ts';
import { type RailWindowOptions, railWindow } from './rail.ts';
import { renderWorkspace } from './render.ts';

interface CorpusCase {
  readonly name: string;
  readonly document: ViewerDocument;
}

/**
 * A document with extra `blocked-by` edges spliced in.
 *
 * `backlogOf` refuses to build a malformed document — its edges name keys it
 * has created — which is the right default for every other fixture and exactly
 * wrong here: the disagreements this file is about only appear on inputs layer
 * 1 has to drop something from. So the malformed shapes are made by splicing
 * rather than by widening the builder.
 */
function withEdges(
  document: ViewerDocument,
  edges: readonly (readonly [string, string])[],
): ViewerDocument {
  return {
    ...document,
    edges: [
      ...document.edges,
      ...edges.map(([from, to]) => ({ field: 'blocked-by' as const, from, to })),
    ],
  };
}

/**
 * The corpus.
 *
 * Each entry names the shape it contributes rather than describing itself, so a
 * failure report says which property of a document broke the agreement.
 */
const CORPUS: readonly CorpusCase[] = [
  { name: 'a flat backlog', document: backlogOf(8) },
  { name: 'a backlog longer than one window', document: backlogOf(64) },
  {
    name: 'held slots, which have no rank to slice on',
    document: backlogOf(12, { held: ['i0003', 'i0007', 'i0012'] }),
  },
  {
    name: 'a together unit, which is one row and two members',
    document: backlogOf(10, {
      unitOf: { i0004: 'i0003' },
      edges: [['together-with', 'i0003', 'i0004']],
    }),
  },
  {
    name: 'a together unit whose partner sorts before its lead',
    document: backlogOf(10, {
      unitOf: { i0003: 'i0004' },
      edges: [['together-with', 'i0004', 'i0003']],
    }),
  },
  {
    name: 'a unit straddling a window boundary',
    document: backlogOf(64, {
      unitOf: { i0004: 'i0003' },
      edges: [['together-with', 'i0003', 'i0004']],
    }),
  },
  {
    name: 'an edge reaching from inside a window to outside it',
    document: backlogOf(64, { edges: [['blocked-by', 'i0002', 'i0064']] }),
  },
  {
    // Layer 1 refuses this one outright — a `together-with` draws as an
    // enclosure around ONE slot's members, so an edge naming two slots has
    // nothing to draw it. It is in the corpus because the rail's own rule for
    // that edge is a RESTATEMENT of layer 1's, and a restatement is only worth
    // testing against inputs the rule is about.
    name: 'a together-with edge whose ends sit in different slots',
    document: backlogOf(10, { edges: [['together-with', 'i0002', 'i0009']] }),
  },
  {
    name: 'a symmetric edge, which has no direction to read off its endpoints',
    document: backlogOf(10, { edges: [['serialize-with', 'i0009', 'i0002']] }),
  },
  {
    name: 'a self-edge, which layer 1 drops',
    document: withEdges(backlogOf(8), [['i0004', 'i0004']]),
  },
  {
    name: 'an edge naming an issue the document does not carry',
    document: withEdges(backlogOf(8), [['i0004', 'nowhere']]),
  },
  {
    name: 'the same edge twice',
    document: withEdges(backlogOf(8), [
      ['i0002', 'i0005'],
      ['i0002', 'i0005'],
    ]),
  },
  {
    name: 'a duplicate placement straddling a window boundary',
    document: (() => {
      const base = backlogOf(64);
      const repeated = base.order.slots[2];
      if (repeated === undefined) throw new Error('the fixture lost its third slot');
      return {
        ...base,
        order: { ...base.order, slots: [...base.order.slots, repeated] },
        cycles: [],
      };
    })(),
  },
  {
    name: 'issues in no slot and on no edge',
    document: (() => {
      const base = backlogOf(8);
      return {
        ...base,
        issues: [
          ...base.issues,
          { key: 'loose-1', title: 'Issue loose-1', open: true, priority: 2 },
          { key: 'loose-2', title: 'Issue loose-2', open: true, priority: 2 },
        ],
      };
    })(),
  },
  {
    name: 'an exclusion, which renders a row and holds no rank',
    document: (() => {
      const base = backlogOf(8);
      const dropped = base.order.slots[5];
      if (dropped === undefined) throw new Error('the fixture lost its sixth slot');
      return {
        ...base,
        edges: [...base.edges, { field: 'duplicate-of' as const, from: dropped.lead, to: 'i0001' }],
        order: {
          slots: base.order.slots.filter((slot) => slot.lead !== dropped.lead),
          excluded: [{ key: dropped.lead, canonical: 'i0001', reason: 'duplicate-of' as const }],
        },
        cycles: [],
      };
    })(),
  },
];

/**
 * The windows every document is put through.
 *
 * A window is layer 2's own decision and it is the input to layer 1, so it is
 * where a restatement of a layer-1 rule most easily drifts: every recorded
 * instance that involved the rail involved one of these edges. Out-of-range and
 * empty windows are included because `railWindow` clamps rather than refusing,
 * so they are reachable states rather than illegal ones.
 */
const WINDOWS: readonly RailWindowOptions[] = [
  {},
  { start: 0, count: 0 },
  { start: 0, count: 3 },
  { start: 1, count: 2 },
  { start: 2, count: 4 },
  { start: 5, count: 50 },
  { start: 100, count: 10 },
  { start: 1_000, count: 10 },
];

/** The key layer 1 draws as current in a rail's markup, if any. */
function currentRailKey(markup: string): string | null {
  for (const match of markup.matchAll(/<li class="ig-slot"[^>]*>/g)) {
    const tag = match[0];
    if (!tag.includes('aria-current="true"')) continue;
    return /data-ig-key="([^"]+)"/.exec(tag)?.[1] ?? null;
  }
  return null;
}

/** Every key layer 1 drew a rail row for, in document order. */
function drawnRailKeys(markup: string): readonly string[] {
  return [...markup.matchAll(/<li class="ig-slot"[^>]*data-ig-key="([^"]+)"/g)].map(
    (match) => match[1] ?? '',
  );
}

describe('the rail hands layer 1 a document it can draw whole', () => {
  // THE PROPERTY, NOT AN INSTANCE OF IT. `railWindow` decides which edges and
  // which issues a windowed document keeps, and it decides that by RESTATING
  // layer 1's rules — the `together-with` enclosure needs both members in one
  // drawn slot, an issue is kept when a drawn row needs it. A diagnostic from
  // the render below means layer 1 had to drop something layer 2 handed it,
  // which is exactly what a drifted restatement produces and the only signal
  // available before a reader notices a missing badge.
  for (const { name, document } of CORPUS) {
    it(`draws every windowed row of ${name} without a diagnostic`, () => {
      for (const window of WINDOWS) {
        const rail = railWindow(document, window);
        const drawn = renderViewer(rail.document, { projection: 'linear' });
        assert.deepEqual(
          drawn.diagnostics,
          [],
          `window ${JSON.stringify(window)} handed layer 1 something it dropped`,
        );
      }
    });
  }
});

describe('windowing never invents an isolated issue', () => {
  // The recorded instance: the rail kept the whole issue list, so every
  // edgeless issue OUTSIDE the window was counted into the footer layer 1 draws
  // for keys that appear in no slot and on no edge — the rail describing the
  // reader's scroll position as though it were the document. Stated as a
  // containment rather than an equality, because a window legitimately drops an
  // isolated issue it does not draw; what it may never do is add one.
  for (const { name, document } of CORPUS) {
    it(`reports no isolated issue for ${name} that the whole document does not`, () => {
      const whole = new Set(normalizeDocument(document).document.isolated);
      for (const window of WINDOWS) {
        const rail = railWindow(document, window);
        for (const key of normalizeDocument(rail.document).document.isolated) {
          assert.ok(
            whole.has(key),
            `window ${JSON.stringify(window)} reported ${key} as isolated; the document does not`,
          );
        }
      }
    });
  }
});

describe('the inspector names the subject layer 1 draws as current', () => {
  // The recorded instance: `ViewerSlot.lead` is "the detail surface's subject"
  // and both projections canonicalize through `atStations` before drawing, so
  // selecting a unit PARTNER marked the lead current in the rail while the
  // panel showed the partner. `Scene.stationOf` is the map layer 1 published
  // for exactly this — it is the one it canonicalized WITH — so asking it is
  // asking layer 1 rather than agreeing with it by coincidence.
  for (const { name, document } of CORPUS) {
    it(`resolves every key in ${name} to layer 1's station`, () => {
      const sound = normalizeDocument(document).document;
      // ONE SCENE PER DOCUMENT, not one per key. `stationOf` is a function of
      // the document alone — `stationsOf` reads `slot.lead` and never looks at
      // `selected` — so rendering per key would build the same map n times to
      // answer n questions about it.
      const { stationOf } = renderViewer(document, { projection: 'linear' }).scene;
      for (const issue of sound.issues) {
        const station = stationOf.get(issue.key) ?? issue.key;
        const subject = inspectorView(document, { kind: 'issue', key: issue.key }).subject;
        assert.equal(subject.kind, 'issue', `selecting ${issue.key} resolved to nothing`);
        if (subject.kind !== 'issue') continue;
        assert.equal(
          subject.issue.key,
          station,
          `selecting ${issue.key} inspects ${subject.issue.key}; layer 1 draws ${station}`,
        );
      }
    });
  }
});

describe('the inspector offers no edge layer 1 dropped', () => {
  // The recorded instance: reading the RAW edges published relationships layer
  // 1 had already dropped — a dangling edge, a repeated one, a self-edge — each
  // carrying a live `select-edge` command, so the panel offered the reader an
  // edge that exists on no other surface. Every corpus entry that carries a
  // malformed edge is a live case of this.
  for (const { name, document } of CORPUS) {
    it(`lists only edges layer 1 kept for ${name}`, () => {
      const sound = normalizeDocument(document).document;
      const kept = new Set(
        sound.edges.map((edge) => edgeIdentity(edge.field, edge.from, edge.to)),
      );
      for (const issue of sound.issues) {
        for (const relationship of inspectorView(document, { kind: 'issue', key: issue.key })
          .relationships) {
          assert.ok(
            kept.has(relationship.edgeId),
            `selecting ${issue.key} offered ${relationship.edgeId}, which layer 1 does not draw`,
          );
        }
      }
    });
  }
});

describe('the workspace zones name one subject', () => {
  // The assembled statement of the class: whatever each zone derives, a reader
  // looking at the rail and a reader reading the inspector must be looking at
  // the same issue. Two of the six recorded instances were this disagreement
  // reached by different routes — one through the canvas never being told what
  // was selected, one through the panel keeping the raw key.
  //
  // The window is the whole order, so a row is never absent merely for being
  // scrolled past; that case is the rail's own and is covered above.
  for (const { name, document } of CORPUS) {
    it(`draws and inspects one issue for every selection in ${name}`, () => {
      const sound = normalizeDocument(document).document;
      const total = sound.order.slots.length;
      // PIN THE MARKUP READERS BEFORE TRUSTING THEM, because both of them read
      // the same shape and they would therefore break TOGETHER — and this suite
      // reads a null from `currentRailKey` as "no row was marked", whose only
      // other reading is "the helper matched nothing at all". With both silent,
      // every assertion below would pass on a rail nobody parsed: green, over no
      // coverage, on the one file whose whole job is to detect a silent class.
      //
      // So the rows are established positively, once per document. Layer 1 keys
      // a slot row by its LEAD and draws an exclusion as a row of its own, both
      // as `li.ig-slot` — so this is also where a change to that grammar
      // surfaces, as a failure naming what it expected rather than as silence.
      const rows = renderWorkspace(document, {
        words: WORKSPACE_WORDS,
        rail: { start: 0, count: Math.max(total, 1) },
      });
      assert.deepEqual(
        [...drawnRailKeys(rows.markup)].sort(),
        [
          ...sound.order.slots.map((slot) => slot.lead),
          ...sound.order.excluded.map((exclusion) => exclusion.key),
        ].sort(),
        'the rail rows this suite reads are not the rows layer 1 drew',
      );

      for (const issue of sound.issues) {
        const result = renderWorkspace(document, {
          words: WORKSPACE_WORDS,
          selection: { kind: 'issue', key: issue.key },
          rail: { start: 0, count: Math.max(total, 1) },
        });
        const current = currentRailKey(result.markup);
        const subject = result.view.inspector.subject;
        // An excluded or unplaced issue draws no slot row, so there is nothing
        // for the rail to mark. The inspector still has a subject for it — that
        // is `slotFor`'s documented fallback — and the two are in agreement
        // precisely because neither claims a position.
        if (current === null) {
          assert.ok(
            !drawnRailKeys(result.markup).includes(issue.key),
            `${issue.key} has a rail row and the rail marked nothing current`,
          );
          continue;
        }
        assert.equal(subject.kind, 'issue', `the rail drew ${current}; the inspector has nothing`);
        if (subject.kind !== 'issue') continue;
        assert.equal(
          subject.issue.key,
          current,
          `selecting ${issue.key}: the rail draws ${current}, the inspector shows ${subject.issue.key}`,
        );
      }
    });
  }
});
