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
  /** Calls a browser would have ignored — see `focus()`. */
  refusedFocusCount = 0;
  /**
   * How many times the shell asked to bring this element into view.
   *
   * NO PRECONDITION, UNLIKE `focus`. Every element can be scrolled to; the
   * question §16f asks is only whether the shell found the right one, and the
   * answer used to be "no" for exactly the subjects that need it — an edge and
   * a NOW row carry a pointer identity and no focus key, so a lookup in the
   * focus index always missed and the promised scroll silently did nothing.
   */
  scrollCount = 0;
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

  /** Upper-case, as the DOM reports it. */
  get tagName(): string {
    return this.tag.toUpperCase();
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

  /**
   * Focus, WITH THE BROWSER'S PRECONDITION — which is the point of the counter.
   *
   * This used to count every call unconditionally, and that made it lie in the
   * one direction a focus test cannot afford: an element with no `tabindex` and
   * no natively focusable tag cannot take focus in a browser, so `focus()` on it
   * is a no-op. Counting it anyway let a whole class of defect pass 258 tests —
   * the focus index held a canvas `<g>` for a railed key, every assertion of the
   * form "focus was called on the element for this key" passed, and keyboard
   * navigation did nothing at all in a real document.
   * `refusedFocusCount` rather than a throw: a refusal is a fact a test may want
   * to assert, and throwing from a DOM method the real one does not throw from
   * would be a different lie.
   */
  focus(): void {
    const tabindex = this.attributes.get('tabindex');
    const naturallyFocusable = this.tag === 'a' || this.tag === 'button';
    if (tabindex === undefined && !naturallyFocusable) {
      this.refusedFocusCount += 1;
      return;
    }
    this.focusCount += 1;
  }

  scrollIntoView(): void {
    this.scrollCount += 1;
  }

  /** Whether `other` is this element or one of its descendants, as `Node.contains` answers. */
  contains(other: SpecNode | null): boolean {
    let cursor: TestElement | null = other instanceof TestElement ? other : null;
    while (cursor !== null && cursor !== this) cursor = cursor.parent;
    return cursor === this;
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

/** A box, as `getBoundingClientRect` reports the two sides the mount reads. */
export interface TestBox {
  width: number;
  height: number;
}

/**
 * A container with a laid-out box. No layout is computed: `box` is whatever
 * the test last set, so a test changes it and then fires a resize.
 */
export class MeasuredTestElement extends TestElement {
  box: TestBox;

  constructor(box: TestBox, ownerDocument: SpecDocument) {
    super('div', ownerDocument);
    this.box = box;
  }

  getBoundingClientRect(): TestBox {
    return this.box;
  }
}

export class TestDocument implements SpecDocument {
  /** Unset, as on a document built for a test; a test sets it to offer an observer. */
  defaultView?: Exclude<SpecDocument['defaultView'], undefined>;

  createElement(tag: string): SpecElement {
    return new TestElement(tag, this);
  }

  createElementNS(namespace: string, tag: string): SpecElement {
    return new TestElement(tag, this, namespace);
  }

  createTextNode(text: string): SpecNode {
    return new TestNode(text);
  }

  /** A detached container to mount into. It has no box, so it is never narrow. */
  createContainer(): TestElement {
    return new TestElement('div', this);
  }

  /** A detached container whose box is `box` until the test changes it. */
  createMeasuredContainer(box: TestBox): MeasuredTestElement {
    return new MeasuredTestElement(box, this);
  }
}

/** One observer the mount built: what it watches, how often it was disconnected. */
export interface TestResizeObserver {
  readonly observed: MountElement[];
  disconnects: number;
  observe(target: MountElement): void;
  disconnect(): void;
  /** Run the mount's callback, as a browser does after a resize. */
  fire(): void;
}

/**
 * A `ResizeObserver` class to hand a `TestDocument` as its view's, and every
 * observer built from it, in build order.
 *
 * `fire()` still runs the callback after `disconnect()`, because a browser can
 * deliver a callback it queued before the disconnect, and the mount has to
 * ignore it.
 */
export function testResizeObservers(): {
  readonly ResizeObserver: new (callback: () => void) => TestResizeObserver;
  readonly built: readonly TestResizeObserver[];
} {
  const built: TestResizeObserver[] = [];
  class FakeResizeObserver implements TestResizeObserver {
    readonly observed: MountElement[] = [];
    disconnects = 0;
    readonly #callback: () => void;

    constructor(callback: () => void) {
      this.#callback = callback;
      built.push(this);
    }

    observe(target: MountElement): void {
      this.observed.push(target);
    }

    disconnect(): void {
      this.disconnects += 1;
    }

    fire(): void {
      this.#callback();
    }
  }
  return { ResizeObserver: FakeResizeObserver, built };
}
