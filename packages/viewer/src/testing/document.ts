/**
 * A minimal stand-in for the handful of DOM calls this package makes.
 *
 * WHAT IT IS: enough of `Document` and `Element` to build a tree, index it,
 * attach listeners and dispatch to them. That is exactly the surface
 * `materialize` and `mountViewer` declare, and it exists so the shell's WIRING
 * can be asserted on a runtime with no DOM and with no test dependency — the
 * same runtime the published entry has to load on.
 *
 * WHAT IT IS NOT, stated plainly so nobody mistakes it for one: it is not a
 * DOM. It parses no markup, computes no layout or style, implements no
 * capturing or bubbling beyond calling the listeners registered on the node the
 * event is dispatched to, and models no node type beyond elements and text. It
 * is a test double for a declared interface, not an implementation of a
 * standard.
 *
 * The consequence is deliberate: nothing about WHAT is drawn is asserted
 * through it. That is `renderMarkup`'s job, and `element.test.ts` pins the two
 * walks against each other so a fact established on the string is a fact about
 * the nodes.
 */

import type { SpecDocument, SpecElement, SpecNode } from '../element.ts';
import type { MountElement, MountEvent } from '../mount.ts';

// No parameter properties anywhere in this file: the workspace compiles with
// `erasableSyntaxOnly`, so every construct has to survive Node's type stripping
// as plain JavaScript.
export class TestNode implements SpecNode {
  readonly nodeType = 3;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

export class TestElement implements MountElement {
  readonly nodeType = 1;
  readonly attributes = new Map<string, string>();
  readonly children: (TestElement | TestNode)[] = [];
  readonly listeners = new Map<string, ((event: MountEvent) => void)[]>();
  parent: TestElement | null = null;
  focusCount = 0;
  readonly tag: string;
  readonly ownerDocument: SpecDocument;
  readonly namespace: string | null;

  constructor(tag: string, ownerDocument: SpecDocument, namespace: string | null = null) {
    this.tag = tag;
    this.ownerDocument = ownerDocument;
    this.namespace = namespace;
  }

  get parentElement(): MountElement | null {
    return this.parent;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  // Narrowed with `instanceof` rather than a cast: this double only ever holds
  // nodes it made, and a foreign one is a caller bug worth surfacing.
  appendChild(child: SpecNode): void {
    if (child instanceof TestElement) {
      child.parent = this;
      this.children.push(child);
      return;
    }
    if (child instanceof TestNode) {
      this.children.push(child);
      return;
    }
    throw new Error('appendChild: not a node created by this document');
  }

  removeChild(child: SpecElement): void {
    if (!(child instanceof TestElement)) {
      throw new Error('removeChild: not a node created by this document');
    }
    const index = this.children.indexOf(child);
    if (index === -1) throw new Error('removeChild: not a child of this element');
    this.children.splice(index, 1);
    child.parent = null;
  }

  addEventListener(type: string, handler: (event: MountEvent) => void): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) this.listeners.set(type, [handler]);
    else existing.push(handler);
  }

  removeEventListener(type: string, handler: (event: MountEvent) => void): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) return;
    const index = existing.indexOf(handler);
    if (index !== -1) existing.splice(index, 1);
  }

  focus(): void {
    this.focusCount += 1;
  }

  /** Call the listeners registered on THIS node. No bubbling: see the header. */
  dispatch(type: string, event: MountEvent = {}): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
  }

  /** Depth-first, elements only — for assertions about the built tree. */
  descendants(): TestElement[] {
    const found: TestElement[] = [];
    for (const child of this.children) {
      if (!(child instanceof TestElement)) continue;
      found.push(child, ...child.descendants());
    }
    return found;
  }

  find(attribute: string, value: string): TestElement | undefined {
    return this.descendants().find((element) => element.getAttribute(attribute) === value);
  }

  /** Concatenated text, for coarse assertions that do not care about structure. */
  text(): string {
    return this.children
      .map((child) => (child instanceof TestNode ? child.text : child.text()))
      .join('');
  }
}

export class TestDocument implements SpecDocument {
  createElement(tag: string): SpecElement {
    return new TestElement(tag, this);
  }

  createElementNS(namespace: string, tag: string): SpecElement {
    return new TestElement(tag, this, namespace);
  }

  createTextNode(text: string): SpecNode {
    return new TestNode(text);
  }

  /** A detached container to mount into. */
  createContainer(): TestElement {
    return new TestElement('div', this);
  }
}
