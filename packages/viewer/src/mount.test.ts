import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMarkup } from './element.ts';
import { mountViewer } from './mount.ts';
import { renderViewer } from './render.ts';
import { GROUP_ATTRIBUTE, KEY_ATTRIBUTE } from './scene.ts';
import { TestDocument, TestElement, TestNode } from './testing/document.ts';
import { fixtureDocument, heldTogetherDocument } from './testing/fixtures.ts';

function mounted(options = {}) {
  const doc = new TestDocument();
  const container = doc.createContainer();
  const handle = mountViewer(container, fixtureDocument, options);
  return { container, handle };
}

/** Serialize a built tree the way `renderMarkup` would, to compare the two walks. */
function reserialize(node: TestElement | TestNode): string {
  if (node instanceof TestNode) {
    return node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const attrs = [...node.attributes]
    .map(
      ([name, value]) =>
        ` ${name}="${value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')}"`,
    )
    .join('');
  if (node.children.length === 0) {
    const voidTags = new Set(['br', 'hr', 'img', 'input']);
    return node.namespace !== null || voidTags.has(node.tag)
      ? `<${node.tag}${attrs} />`
      : `<${node.tag}${attrs}></${node.tag}>`;
  }
  return `<${node.tag}${attrs}>${node.children.map(reserialize).join('')}</${node.tag}>`;
}

describe('mountViewer', () => {
  it('builds the same tree renderViewer describes', () => {
    const { container } = mounted();
    const root = container.children[0];

    assert.ok(root instanceof TestElement);
    assert.equal(reserialize(root), renderViewer(fixtureDocument).markup);
  });

  it('appends exactly one element to the container', () => {
    assert.equal(mounted().container.children.length, 1);
  });

  it('calls onSelect once with the key of the element clicked', () => {
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });
    const target = container.find(KEY_ATTRIBUTE, '101');

    assert.ok(target !== undefined);
    container.dispatch('click', { target });
    assert.deepEqual(selected, ['101']);
  });

  it('resolves the key by walking up from a nested target', () => {
    // Delegation without `closest`: the walk is the same one a real DOM would
    // do, and it keeps the shell testable on a document double.
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });
    const row = container.find(KEY_ATTRIBUTE, '102');
    const nested = row?.descendants().find((element) => element.tag === 'span');

    assert.ok(nested !== undefined);
    container.dispatch('click', { target: nested });
    assert.deepEqual(selected, ['102']);
  });

  it('resolves a pointer on decoration to the slot it decorates', () => {
    // The enclosure and its connector are deliberately OUTSIDE the focus index
    // — one element per key, or `focus()` lands on the non-tabbable rect
    // painted behind the node. They are still visible marks a reader can click,
    // and the design states the connector IS a click target, so they keep
    // POINTER identity through a separate attribute.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const selected: (string | null)[] = [];
    mountViewer(container, heldTogetherDocument, {
      projection: 'graph',
      onSelect: (key: string | null) => selected.push(key),
    });

    const enclosure = container
      .descendants()
      .find((element) => element.getAttribute('class') === 'ig-enclosure');
    const connector = container
      .descendants()
      .find((element) => element.getAttribute('class') === 'ig-connector');

    assert.ok(enclosure !== undefined, 'no enclosure was drawn');
    assert.ok(connector !== undefined, 'no connector was drawn');
    assert.equal(enclosure.getAttribute(KEY_ATTRIBUTE), null, 'decoration is in the focus index');

    container.dispatch('click', { target: enclosure });
    container.dispatch('click', { target: connector });
    assert.deepEqual(selected, ['1', '1']);
  });

  it('ignores a click that lands on nothing keyed', () => {
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });

    container.dispatch('click', { target: container });
    assert.deepEqual(selected, []);
  });

  it('marks the selected row after a click', () => {
    const { container } = mounted();
    const target = container.find(KEY_ATTRIBUTE, '101');
    assert.ok(target !== undefined);
    container.dispatch('click', { target });

    assert.equal(container.find(KEY_ATTRIBUTE, '101')?.getAttribute('aria-current'), 'true');
  });

  it('honours a selection and a focus the caller mounted with', () => {
    // `MountOptions` carries both because it extends the render options, so a
    // caller restoring a view passes them here. Starting empty discarded them
    // and dropped the reader back to the top of the order.
    const { container, handle } = mounted({ selected: '103', focused: '105' });

    assert.equal(handle.state.selected, '103');
    assert.equal(handle.state.focused, '105');
    assert.equal(container.find(KEY_ATTRIBUTE, '103')?.getAttribute('aria-current'), 'true');
    assert.equal(container.find(KEY_ATTRIBUTE, '105')?.getAttribute('tabindex'), '0');
  });

  it('stops the delegation walk at the container, never climbing into the host', () => {
    const doc = new TestDocument();
    const host = doc.createContainer();
    host.setAttribute(KEY_ATTRIBUTE, 'not-ours');
    const container = doc.createContainer();
    host.appendChild(container);

    const selected: (string | null)[] = [];
    mountViewer(container, fixtureDocument, {
      onSelect: (key: string | null) => selected.push(key),
    });

    container.dispatch('click', { target: container });
    assert.deepEqual(selected, [], 'a host ancestor answered for a click on nothing of ours');
  });

  it('leaves keyboard activation to a nested link', () => {
    // `keydown` bubbles, so the viewer's own Enter handling ran while focus was
    // on a row's deep-link chip, called `preventDefault()` and suppressed the
    // link. A projection that exposes a link a keyboard cannot follow has not
    // exposed it.
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });
    const link = container.descendants().find((element) => element.tag === 'a');
    assert.ok(link !== undefined, 'no deep link was rendered');

    let prevented = 0;
    container.dispatch('keydown', {
      key: 'Enter',
      target: link,
      preventDefault: () => (prevented += 1),
    });

    assert.equal(prevented, 0, 'the viewer suppressed the link');
    assert.deepEqual(selected, [], 'the viewer selected instead of following the link');
  });

  it('still moves focus when the arrow keys arrive on a link', () => {
    // Only ACTIVATION belongs to the control — a reader focused on a link must
    // still be able to arrow away from it.
    const { container, handle } = mounted();
    const link = container.descendants().find((element) => element.tag === 'a');
    assert.ok(link !== undefined);

    container.dispatch('keydown', { key: 'ArrowDown', target: link });
    assert.equal(handle.state.focused, '101');
  });

  it('moves from the row the reader is STANDING in, not the last one it moved to', () => {
    // Native Tab walks the deep-link chips, and the viewer never hears about it:
    // `state.focused` only tracks the viewer's own moves. So tabbing into the
    // a row's link and pressing ArrowDown moved relative to the row focus had
    // been left on rather than the one the reader is in.
    // The fixture's order is 102, 101, 103, 105, 106, and focus is seeded on
    // 102. Tabbing to 101's link and pressing ArrowDown must reach 103; reading
    // the stale 102 lands on 101 — the row already being stood in, so the key
    // press appears to do nothing at all.
    const { container, handle } = mounted();
    const row = container.find(KEY_ATTRIBUTE, '101');
    assert.ok(row !== undefined, 'no row for 101');
    const link = row.descendants().find((element) => element.tag === 'a');
    assert.ok(link !== undefined, 'row 101 rendered no deep link');
    assert.equal(
      handle.state.focused,
      '102',
      'the fixture no longer seeds focus where this test assumes',
    );

    container.dispatch('keydown', { key: 'ArrowDown', target: link });

    assert.equal(handle.state.focused, '103', 'moved from the stale row, not from 101');
  });

  it('does NOT adopt a decoration key, which is outside the focus index', () => {
    // `data-ig-group` marks something a reader can point at but never focus, so
    // adopting one would set `focused` to a key `navigate` cannot resolve — it
    // indexes to -1 and throws the reader back to the top of the order, which is
    // the very bug the sync above fixes, arriving through the fix.
    const { container, handle } = mounted({ projection: 'graph' });
    const decoration = container
      .descendants()
      .find(
        (element) =>
          element.getAttribute(GROUP_ATTRIBUTE) !== null &&
          element.getAttribute(KEY_ATTRIBUTE) === null,
      );
    if (decoration === undefined) return; // this fixture drew no decoration; nothing to assert

    const before = handle.state.focused;
    container.dispatch('keydown', { key: 'ArrowDown', target: decoration });

    assert.notEqual(handle.state.focused, decoration.getAttribute(GROUP_ATTRIBUTE));
    assert.ok(before !== null);
  });

  it('keeps focus on the row it just selected with the keyboard', () => {
    // `draw()` destroys the subtree holding focus and mounts a replacement, and
    // only the movement branch was refocusing it — so pressing Enter dropped
    // focus out of the viewer and no later arrow key reached the container.
    const { container, handle } = mounted();
    const before = container.find(KEY_ATTRIBUTE, '102');
    assert.ok(before !== undefined);

    container.dispatch('keydown', { key: 'Enter', target: before });

    const after = container.find(KEY_ATTRIBUTE, handle.state.selected as string);
    assert.ok(after !== undefined, 'the selected row was not rebuilt');
    assert.equal(after.focusCount, 1, 'the rebuilt row was never focused');
    // And the reader can still move, which is what the lost focus cost them.
    container.dispatch('keydown', { key: 'ArrowDown' });
    assert.notEqual(handle.state.focused, before.getAttribute(KEY_ATTRIBUTE));
  });

  it('clears a hover the redraw removed, and tells the host', () => {
    // `pointerleave` does not fire when the hovered element is destroyed under a
    // stationary pointer, so the host was left holding a key for an issue the
    // document no longer carries.
    const hovered: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '103');
    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });
    assert.deepEqual(hovered, ['103']);

    handle.update({
      issues: fixtureDocument.issues.filter((issue) => issue.key !== '103'),
      edges: fixtureDocument.edges.filter(
        (edge) => edge.from !== '103' && edge.to !== '103',
      ),
      order: { slots: [], excluded: [] },
    });

    assert.deepEqual(hovered, ['103', null], 'the host was never told the hover ended');
  });

  it('does NOT clear a hover the redraw kept', () => {
    // The clear must key on the DOCUMENT, not on the focus index: decoration
    // hovers are absent from `keyed` on every redraw and are perfectly live.
    const hovered: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '103');
    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });

    handle.update(fixtureDocument);

    assert.deepEqual(hovered, ['103'], 'a live hover was cleared by an unrelated redraw');
  });

  it('does not select a row when the click belongs to its deep link', () => {
    // Returning from the keydown handler does NOT suppress the click the browser
    // synthesizes afterwards, so following a link also selected its row and told
    // the host about a selection the anchor owned.
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });
    const link = container.descendants().find((element) => element.tag === 'a');
    assert.ok(link !== undefined, 'no deep link was rendered');

    container.dispatch('click', { target: link });

    assert.deepEqual(selected, [], 'following a link also selected its row');
  });

  it('clears an active hover on destroy, so the host is not left holding a dead key', () => {
    // Teardown removes the listeners and then the root, so no `pointerleave` can
    // fire — and destruction bypasses `draw()` entirely, so the redraw
    // reconciliation never sees this path. The host was left with a tooltip
    // pinned to an element that no longer exists.
    const hovered: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '103');
    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });
    assert.deepEqual(hovered, ['103']);

    handle.destroy();

    assert.deepEqual(hovered, ['103', null], 'the host was never told the hover ended');
  });

  it('reports a hover, and reports null when the pointer leaves', () => {
    const hovered: (string | null)[] = [];
    const { container } = mounted({ onHover: (key: string | null) => hovered.push(key) });
    const target = container.find(KEY_ATTRIBUTE, '103');

    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });
    container.dispatch('pointerleave', {});
    assert.deepEqual(hovered, ['103', null]);
  });

  it('does not repeat a hover for the same key', () => {
    const hovered: (string | null)[] = [];
    const { container } = mounted({ onHover: (key: string | null) => hovered.push(key) });
    const target = container.find(KEY_ATTRIBUTE, '103');

    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });
    container.dispatch('pointerover', { target });
    assert.deepEqual(hovered, ['103']);
  });

  it('moves focus on an arrow key and calls focus on the new element', () => {
    const { container, handle } = mounted();
    container.dispatch('keydown', { key: 'ArrowDown' });

    assert.equal(handle.state.focused, '101');
    assert.equal(container.find(KEY_ATTRIBUTE, '101')?.focusCount, 1);
  });

  it('selects on Enter and tells the host', () => {
    const selected: (string | null)[] = [];
    const { container, handle } = mounted({ onSelect: (key: string | null) => selected.push(key) });

    container.dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(selected, ['102']);
    assert.equal(handle.state.selected, '102');
  });

  it('prevents the default only for a key it handled', () => {
    const { container } = mounted();
    let prevented = 0;
    const event = { key: 'ArrowDown', preventDefault: () => (prevented += 1) };
    container.dispatch('keydown', event);
    container.dispatch('keydown', { key: 'g', preventDefault: () => (prevented += 1) });

    assert.equal(prevented, 1);
  });

  it('selects programmatically exactly as a click does', () => {
    const selected: (string | null)[] = [];
    const { container, handle } = mounted({ onSelect: (key: string | null) => selected.push(key) });

    handle.select('105');
    assert.deepEqual(selected, ['105']);
    assert.equal(container.find(KEY_ATTRIBUTE, '105')?.getAttribute('aria-current'), 'true');
  });

  it('keeps a still-present selection across an update', () => {
    const { container, handle } = mounted();
    handle.select('103');
    handle.update(fixtureDocument);

    assert.equal(handle.state.selected, '103');
    assert.equal(container.find(KEY_ATTRIBUTE, '103')?.getAttribute('aria-current'), 'true');
    assert.equal(container.children.length, 1, 'update left the previous tree behind');
  });

  it('keeps the subject across a projection change', () => {
    const { container, handle } = mounted();
    handle.select('103');
    handle.setProjection('tree');

    assert.equal(handle.state.selected, '103');
    const root = container.children[0];
    assert.ok(root instanceof TestElement);
    assert.equal(root.getAttribute('data-projection'), 'tree');
  });

  it('removes every listener and empties the container on destroy', () => {
    const selected: (string | null)[] = [];
    const hovered: (string | null)[] = [];
    const { container, handle } = mounted({
      onSelect: (key: string | null) => selected.push(key),
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '101');
    assert.ok(target !== undefined);

    handle.destroy();

    assert.equal(container.children.length, 0);
    container.dispatch('click', { target });
    container.dispatch('pointerover', { target });
    container.dispatch('keydown', { key: 'ArrowDown' });
    assert.deepEqual(selected, []);
    assert.deepEqual(hovered, []);
    for (const handlers of container.listeners.values()) assert.deepEqual(handlers, []);
  });

  it('is inert after destroy', () => {
    const { container, handle } = mounted();
    handle.destroy();
    handle.update(fixtureDocument);
    handle.setProjection('graph');
    handle.select('101');

    assert.equal(container.children.length, 0);
  });

  it('mounts a graph without a DOM, which is where the SVG path is exercised', () => {
    const doc = new TestDocument();
    const container = doc.createContainer();
    mountViewer(container, fixtureDocument, { projection: 'graph' });
    const root = container.children[0];

    assert.ok(root instanceof TestElement);
    assert.equal(reserialize(root), renderMarkup(renderViewer(fixtureDocument, { projection: 'graph' }).scene.root));
  });
});
