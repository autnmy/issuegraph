import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMarkup } from './element.ts';
import { mountViewer } from './mount.ts';
import { renderViewer } from './render.ts';
import { KEY_ATTRIBUTE } from './scene.ts';
import { TestDocument, TestElement, TestNode } from './testing/document.ts';
import { fixtureDocument } from './testing/fixtures.ts';

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
