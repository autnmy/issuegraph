import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ViewerDocument, normalizeDocument } from '../document.ts';
import { renderMarkup } from '../element.ts';
import { fixtureDocument } from '../testing/fixtures.ts';
import { treeScene } from './tree.ts';

const emptyOrder = { slots: [], excluded: [] };

function issue(key: string) {
  return { key, title: `Issue ${key}`, open: true, priority: 2 };
}

function scene(input: ViewerDocument = fixtureDocument, options = {}) {
  return treeScene(normalizeDocument(input).document, options);
}

function render(input: ViewerDocument = fixtureDocument, options = {}): string {
  return renderMarkup(scene(input, options).root);
}

/** The `aria-level` an item was rendered at. */
function levelOf(markup: string, key: string): string {
  const match = new RegExp(`data-ig-key="${key}"[^>]*data-level="(\\d+)"`).exec(markup);
  assert.ok(match !== null, `no tree item for ${key}`);
  return match[1] as string;
}

describe('the tree projection', () => {
  it('nests a chain to the depth it declares', () => {
    const markup = render({
      issues: [issue('1'), issue('2'), issue('3')],
      edges: [
        { field: 'decomposed-from', from: '2', to: '1' },
        { field: 'decomposed-from', from: '3', to: '2' },
      ],
      order: emptyOrder,
    });

    assert.equal(levelOf(markup, '1'), '1');
    assert.equal(levelOf(markup, '2'), '2');
    assert.equal(levelOf(markup, '3'), '3');
  });

  it('conveys hierarchy with nested lists rather than an ARIA tree', () => {
    // `role="treeitem"` forbids a focusable descendant and every item carries a
    // deep-link chip. A nested list is announced with its depth natively, needs
    // no ARIA to say so, and leaves the link legal.
    const markup = render();
    assert.equal(/role="tree"/.test(markup), false);
    assert.equal(/role="treeitem"/.test(markup), false);
    assert.equal(/role="group"/.test(markup), false);
    assert.match(markup, /<ul class="ig-list"><li class="ig-tree-item"/);
    assert.match(markup, /<a class="ig-link"/);
  });

  it('nests a parent and leaves a leaf flat', () => {
    const markup = render();
    const parent = markup.slice(markup.indexOf('data-ig-key="107"'));
    assert.match(parent.slice(0, parent.indexOf('</li>')), /<ul class="ig-list">/);
  });

  it('keeps siblings in document order', () => {
    const markup = render();
    assert.ok(markup.indexOf('data-ig-key="103"') < markup.indexOf('data-ig-key="104"'));
  });

  it('renders an issue with no decomposed-from edge as a root', () => {
    assert.equal(levelOf(render(), '105'), '1');
  });

  it('says so when an origin is outside the document instead of implying none', () => {
    // An absence rendered as a value licenses a false conclusion — here, that
    // an issue has no provenance when its provenance simply was not supplied.
    const markup = render({
      issues: [issue('1')],
      edges: [{ field: 'decomposed-from', from: '1', to: '900' }],
      order: emptyOrder,
    });

    assert.equal(levelOf(markup, '1'), '1');
    assert.match(markup, /decomposed from 900, which is outside this document/);
  });

  it('draws every member once and diagnoses a malformed cycle rather than recursing', () => {
    const cyclic = scene({
      issues: [issue('1'), issue('2'), issue('3')],
      edges: [
        { field: 'decomposed-from', from: '1', to: '2' },
        { field: 'decomposed-from', from: '2', to: '3' },
        { field: 'decomposed-from', from: '3', to: '1' },
      ],
      order: emptyOrder,
    });
    const markup = renderMarkup(cyclic.root);

    assert.equal(cyclic.diagnostics.length, 1);
    assert.match(cyclic.diagnostics[0] as string, /decomposed-from cycle/);
    for (const key of ['1', '2', '3']) {
      assert.equal([...markup.matchAll(new RegExp(`data-ig-key="${key}"`, 'g'))].length, 1);
    }
    assert.deepEqual([...cyclic.focusOrder].sort(), ['1', '2', '3']);
  });

  it('keeps the first of two declared origins, whichever one resolves', () => {
    // The format makes `decomposed-from` single-cardinality and
    // `normalizeDocument` applies that where the edges are read, so the tree
    // cannot see a second origin at all.
    const first = normalizeDocument({
      issues: [issue('1'), issue('2'), issue('3')],
      edges: [
        { field: 'decomposed-from', from: '3', to: '1' },
        { field: 'decomposed-from', from: '3', to: '2' },
      ],
      order: emptyOrder,
    });

    assert.ok(
      first.diagnostics.some((line) => /more than one decomposed-from origin/.test(line)),
    );
    assert.equal(levelOf(renderMarkup(treeScene(first.document).root), '3'), '2');
  });

  it('does not both nest an issue and claim its origin is missing', () => {
    // A missing FIRST origin and a resolving second used to be recorded
    // independently: the tree nested the issue under the second parent while
    // printing that it came from the first, which is two contradictory claims
    // about one single-cardinality field.
    const missingFirst = normalizeDocument({
      issues: [issue('1'), issue('3')],
      edges: [
        { field: 'decomposed-from', from: '3', to: '900' },
        { field: 'decomposed-from', from: '3', to: '1' },
      ],
      order: emptyOrder,
    });
    const markup = renderMarkup(treeScene(missingFirst.document).root);

    // The FIRST origin wins even though it does not resolve, so `3` is a root
    // that says where it came from — and is not also nested under `1`.
    assert.equal(missingFirst.document.outOfSetOrigins.get('3'), '900');
    assert.equal(levelOf(markup, '3'), '1');
    assert.match(markup, /decomposed from 900, which is outside this document/);

    // And the reverse order resolves the other way, with no out-of-set claim.
    const presentFirst = normalizeDocument({
      issues: [issue('1'), issue('3')],
      edges: [
        { field: 'decomposed-from', from: '3', to: '1' },
        { field: 'decomposed-from', from: '3', to: '900' },
      ],
      order: emptyOrder,
    });

    assert.equal(presentFirst.document.outOfSetOrigins.get('3'), undefined);
    assert.equal(levelOf(renderMarkup(treeScene(presentFirst.document).root), '3'), '2');
  });

  it('renders every issue as a root when nothing declares provenance', () => {
    const flat = scene({
      issues: [issue('1'), issue('2')],
      edges: [{ field: 'blocked-by', from: '1', to: '2' }],
      order: emptyOrder,
    });

    assert.deepEqual([...flat.focusOrder], ['1', '2']);
    assert.equal(/role="group"/.test(renderMarkup(flat.root)), false);
  });

  it('renders an empty state rather than an empty container', () => {
    const markup = render({ issues: [], edges: [], order: emptyOrder });
    assert.match(markup, /class="ig-empty"/);
  });

  it('walks depth-first, so the focus order matches what a reader sees', () => {
    assert.deepEqual(
      [...scene().focusOrder],
      ['101', '102', '105', '106', '107', '103', '104', 'other/repo#7', '110'],
    );
  });

  it('gives the tab stop to a supplied focus only when it draws that key', () => {
    assert.match(render(fixtureDocument, { focused: '107' }), /data-ig-key="107"[^>]*tabindex="0"/);

    const unknown = render(fixtureDocument, { focused: 'nope' });
    assert.match(unknown, /data-ig-key="101"[^>]*tabindex="0"/);
    assert.equal([...unknown.matchAll(/tabindex="0"/g)].length, 1);
  });

  it('renders a chain far deeper than any call stack would hold', () => {
    // Nothing bounds how deep a host's `decomposed-from` chain runs, and
    // `renderViewer` documents itself as TOTAL — a document that makes it throw
    // falsifies that claim whatever the depth was. Both the order walk and the
    // element build are iterative for this reason.
    const depth = 20_000;
    const issues = Array.from({ length: depth }, (_, index) => issue(String(index + 1)));
    const edges = issues.slice(1).map((child, index) => ({
      field: 'decomposed-from' as const,
      from: child.key,
      to: String(index + 1),
    }));
    const built = scene({ issues, edges, order: emptyOrder });

    assert.equal(built.focusOrder.length, depth);
    assert.equal(built.focusOrder[0], '1');
    assert.equal(built.focusOrder[depth - 1], String(depth));
    const markup = renderMarkup(built.root);
    assert.match(markup, new RegExp(`data-ig-key="${String(depth)}" data-level="${String(depth)}"`));
  });

  it('is deterministic — two renders of one document agree byte for byte', () => {
    assert.equal(render(), render());
  });
});
