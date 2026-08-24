import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ElementSpec,
  SVG_NAMESPACE,
  element,
  materialize,
  renderMarkup,
  svg,
} from './element.ts';
import { TestDocument, TestElement, TestNode } from './testing/document.ts';

describe('renderMarkup', () => {
  it('escapes markup in a text child', () => {
    const markup = renderMarkup(element('p', {}, ['<script>alert(1)</script>']));
    assert.equal(markup, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('escapes markup and quotes in an attribute value', () => {
    const markup = renderMarkup(element('a', { title: 'a "quoted" <tag> & more' }));
    assert.equal(markup, '<a title="a &quot;quoted&quot; &lt;tag&gt; &amp; more"></a>');
  });

  it('escapes an ampersand exactly once', () => {
    assert.equal(renderMarkup(element('p', {}, ['a & b'])), '<p>a &amp; b</p>');
  });

  it('self-closes a void element and closes an empty ordinary one', () => {
    assert.equal(renderMarkup(element('br', {})), '<br />');
    assert.equal(renderMarkup(element('div', {})), '<div></div>');
  });

  it('self-closes an empty SVG element', () => {
    assert.equal(renderMarkup(svg('rect', { x: 1 })), '<rect x="1" />');
  });

  it('inherits the SVG namespace into children', () => {
    const spec = svg('g', {}, [svg('circle', { r: 2 }), { tag: 'path', attrs: { d: 'M0 0' } }]);
    assert.equal(renderMarkup(spec), '<g><circle r="2" /><path d="M0 0" /></g>');
  });

  it('omits false, null and undefined attributes and renders true bare', () => {
    const markup = renderMarkup(
      element('input', { disabled: true, hidden: false, name: null, id: undefined, type: 'text' }),
    );
    assert.equal(markup, '<input disabled type="text" />');
  });

  it('is deterministic — the same spec always produces the same bytes', () => {
    const spec = element('div', { class: 'a', id: 'b' }, ['x', element('span', {}, ['y'])]);
    assert.equal(renderMarkup(spec), renderMarkup(spec));
  });
});

describe('materialize', () => {
  it('builds elements, attributes and text in the supplied document', () => {
    const doc = new TestDocument();
    const built = materialize(doc, element('div', { class: 'x' }, ['hello']));

    assert.ok(built instanceof TestElement);
    assert.equal(built.tag, 'div');
    assert.equal(built.getAttribute('class'), 'x');
    assert.equal(built.children.length, 1);
    assert.ok(built.children[0] instanceof TestNode);
  });

  it('uses the SVG namespace for an SVG subtree', () => {
    const doc = new TestDocument();
    const built = materialize(doc, svg('g', {}, [svg('circle', { r: 1 })]));

    assert.ok(built instanceof TestElement);
    assert.equal(built.namespace, SVG_NAMESPACE);
    const child = built.children[0];
    assert.ok(child instanceof TestElement);
    assert.equal(child.namespace, SVG_NAMESPACE);
  });

  it('applies the same attribute rules as the markup renderer', () => {
    const doc = new TestDocument();
    const built = materialize(
      doc,
      element('input', { disabled: true, hidden: false, name: null, count: 3 }),
    );

    assert.ok(built instanceof TestElement);
    assert.equal(built.getAttribute('disabled'), '');
    assert.equal(built.getAttribute('hidden'), null);
    assert.equal(built.getAttribute('name'), null);
    assert.equal(built.getAttribute('count'), '3');
  });

  it('reports every element it builds to onElement', () => {
    const doc = new TestDocument();
    const seen: string[] = [];
    materialize(doc, element('div', {}, [element('span', {}, ['x']), element('b', {})]), {
      onElement: (spec) => seen.push(spec.tag),
    });

    assert.deepEqual(seen, ['div', 'span', 'b']);
  });

  it('produces the same tree the markup renderer describes', () => {
    // The load-bearing test of the two-renderer design: walk the built nodes
    // back into markup and require byte equality with the direct render. Once
    // this holds, every assertion made on a string is a fact about the nodes.
    const spec: ElementSpec = element('section', { class: 'root', 'data-x': 1 }, [
      'text & more',
      element('ul', {}, [element('li', { id: 'a' }, ['one']), element('li', { id: 'b' }, ['two'])]),
      svg('svg', { viewBox: '0 0 10 10' }, [svg('rect', { x: 0, y: 0 })]),
      element('br', {}),
    ]);

    const doc = new TestDocument();
    const built = materialize(doc, spec);
    assert.ok(built instanceof TestElement);

    const reserialize = (node: TestElement | TestNode): string => {
      if (node instanceof TestNode) {
        return node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      const attrs = [...node.attributes]
        .map(([name, value]) => ` ${name}="${value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"`)
        .join('');
      if (node.children.length === 0) {
        const selfClosing = node.namespace !== null || node.tag === 'br';
        return selfClosing ? `<${node.tag}${attrs} />` : `<${node.tag}${attrs}></${node.tag}>`;
      }
      return `<${node.tag}${attrs}>${node.children.map(reserialize).join('')}</${node.tag}>`;
    };

    assert.equal(reserialize(built), renderMarkup(spec));
  });
});

describe('element and svg helpers', () => {
  it('drop null, undefined and false children so a conditional child needs no filter', () => {
    const spec = element('div', {}, ['a', null, undefined, false, 'b']);
    assert.equal(renderMarkup(spec), '<div>ab</div>');
  });

  it('mark an svg helper subtree as SVG', () => {
    assert.equal(svg('rect', {}).ns, 'svg');
    assert.equal(element('div', {}).ns, undefined);
  });
});
