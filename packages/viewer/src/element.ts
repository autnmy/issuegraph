/**
 * One description of rendered structure, and the two renderers that consume it.
 *
 * A projection returns an {@link ElementSpec} tree. {@link renderMarkup} turns
 * it into a string — server rendering, and every test in this package that
 * asserts what is drawn. {@link materialize} builds the same tree out of real
 * nodes for {@link ../mount.ts mountViewer}.
 *
 * THE POINT IS THAT THEY CANNOT DISAGREE. The obvious alternative — build
 * markup, then set `innerHTML` — makes the string path and the node path one
 * implementation but leaves the package unable to render without a parser; the
 * other obvious alternative, writing the DOM path separately, makes them two
 * implementations that drift. One spec with two total walks over it is the only
 * arrangement where a test on the markup is evidence about the nodes.
 *
 * Nothing here reaches a global. {@link materialize} takes the document it
 * builds into, which is what keeps this module importable on a runtime that has
 * no DOM at all.
 */

/** Attribute values a spec may carry. `false`, `null` and `undefined` omit it. */
export type AttrValue = string | number | boolean | null | undefined;

export interface ElementSpec {
  readonly tag: string;
  /** `svg` puts this element and its subtree in the SVG namespace. */
  readonly ns?: 'svg' | undefined;
  readonly attrs?: Readonly<Record<string, AttrValue>> | undefined;
  readonly children?: readonly SpecChild[] | undefined;
}

export type SpecChild = ElementSpec | string;

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * HTML elements that may not carry children and must not be given a closing
 * tag. An empty non-void element still renders `<div></div>`, because
 * `<div/>` is not self-closing in HTML and browsers nest whatever follows it.
 */
const VOID_HTML_TAGS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function isSpec(child: SpecChild): child is ElementSpec {
  return typeof child !== 'string';
}

function renderAttrs(attrs: Readonly<Record<string, AttrValue>> | undefined): string {
  if (attrs === undefined) return '';
  const parts: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      parts.push(` ${name}`);
      continue;
    }
    parts.push(` ${name}="${escapeAttr(typeof value === 'number' ? String(value) : value)}"`);
  }
  return parts.join('');
}

/**
 * Render a spec tree to markup.
 *
 * Pure and deterministic: attribute order follows the spec's own key order, so
 * the same tree always produces the same bytes. That is what makes a
 * two-themes-one-markup assertion possible.
 *
 * ITERATIVE, LIKE EVERY OTHER WALK IN THIS PACKAGE. A recursive renderer costs
 * one call frame per level of nesting, and the tree projection's depth is the
 * host's `decomposed-from` chain — which nothing bounds. `renderViewer`
 * documents itself as TOTAL, so a document that makes it throw falsifies the
 * claim whatever the depth was. This was the third stack-depth finding on this
 * package; making the traversal iterative removes the class rather than
 * capping the input, which would have invented a product rule the design does
 * not have.
 */
export function renderMarkup(spec: ElementSpec, inheritedNs?: 'svg' | undefined): string {
  type Frame =
    | { readonly kind: 'open'; readonly spec: ElementSpec; readonly ns: 'svg' | undefined }
    | { readonly kind: 'close'; readonly tag: string }
    | { readonly kind: 'text'; readonly text: string };

  const out: string[] = [];
  const stack: Frame[] = [{ kind: 'open', spec, ns: inheritedNs }];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    if (frame.kind === 'close') {
      out.push(`</${frame.tag}>`);
      continue;
    }
    if (frame.kind === 'text') {
      out.push(escapeText(frame.text));
      continue;
    }

    const ns = frame.spec.ns ?? frame.ns;
    const open = `<${frame.spec.tag}${renderAttrs(frame.spec.attrs)}`;
    const children = frame.spec.children ?? [];
    if (children.length === 0) {
      out.push(
        ns === 'svg' || VOID_HTML_TAGS.has(frame.spec.tag)
          ? `${open} />`
          : `${open}></${frame.spec.tag}>`,
      );
      continue;
    }

    out.push(`${open}>`);
    stack.push({ kind: 'close', tag: frame.spec.tag });
    // Pushed in reverse so they pop in document order.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index] as SpecChild;
      stack.push(isSpec(child) ? { kind: 'open', spec: child, ns } : { kind: 'text', text: child });
    }
  }
  return out.join('');
}

/**
 * The slice of `Document` this package builds with.
 *
 * Declared structurally rather than as `Document` so a host can pass any
 * implementation that answers these five calls — and so this module stays
 * honest about how little of the DOM it actually needs.
 */
export interface SpecDocument {
  createElement(tag: string): SpecElement;
  createElementNS(namespace: string, tag: string): SpecElement;
  createTextNode(text: string): SpecNode;
}

export interface SpecNode {
  readonly nodeType?: number;
}

export interface SpecElement extends SpecNode {
  setAttribute(name: string, value: string): void;
  appendChild(child: SpecNode): void;
  /**
   * Optional because building a tree never needs it — only the shell's roving
   * tab stop does, and an implementation that cannot move focus should be able
   * to say so by omitting it rather than by throwing.
   */
  focus?(): void;
}

export interface MaterializeOptions {
  readonly ns?: 'svg' | undefined;
  /**
   * Called for every element as it is built. `mount` uses it to index the
   * elements carrying a key, which is cheaper and less brittle than walking the
   * finished tree back down — and it keeps this module to ONE traversal, so the
   * markup and the node paths cannot diverge in how they descend.
   */
  readonly onElement?: ((spec: ElementSpec, element: SpecElement) => void) | undefined;
}

/**
 * Build a spec tree as nodes in the supplied document.
 *
 * Attributes follow `renderMarkup`'s rules exactly — same omissions, same
 * number coercion, same bare-attribute handling for `true` — because the two
 * walks are only useful as one grammar.
 */
export function materialize(
  doc: SpecDocument,
  spec: ElementSpec,
  options: MaterializeOptions = {},
): SpecElement {
  type Frame =
    | {
        readonly kind: 'element';
        readonly spec: ElementSpec;
        readonly ns: 'svg' | undefined;
        readonly parent: SpecElement | null;
      }
    | { readonly kind: 'text'; readonly text: string; readonly parent: SpecElement };

  // Iterative for the reason `renderMarkup` is: the two walks are only useful
  // as one grammar, so they have to share the depth behaviour too.
  const stack: Frame[] = [{ kind: 'element', spec, ns: options.ns, parent: null }];
  let root: SpecElement | null = null;

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    if (frame.kind === 'text') {
      frame.parent.appendChild(doc.createTextNode(frame.text));
      continue;
    }

    const ns = frame.spec.ns ?? frame.ns;
    const built =
      ns === 'svg'
        ? doc.createElementNS(SVG_NAMESPACE, frame.spec.tag)
        : doc.createElement(frame.spec.tag);

    if (frame.spec.attrs !== undefined) {
      for (const [name, value] of Object.entries(frame.spec.attrs)) {
        if (value === undefined || value === null || value === false) continue;
        built.setAttribute(name, value === true ? '' : String(value));
      }
    }

    options.onElement?.(frame.spec, built);

    // Appended on the way DOWN, so a node is in place before its own children
    // are popped. That is what keeps sibling order right without holding the
    // parent's frame open, which is the whole point of dropping the recursion.
    if (frame.parent === null) root = built;
    else frame.parent.appendChild(built);

    const children = frame.spec.children ?? [];
    // Pushed in reverse so they pop in document order.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index] as SpecChild;
      stack.push(
        isSpec(child)
          ? { kind: 'element', spec: child, ns, parent: built }
          : { kind: 'text', text: child, parent: built },
      );
    }
  }
  // The seed frame always builds an element, so this is set by the first pass.
  return root as SpecElement;
}

/** A spec, with `undefined` children dropped — the common conditional-child case. */
export function element(
  tag: string,
  attrs: Readonly<Record<string, AttrValue>>,
  children: readonly (SpecChild | null | undefined | false)[] = [],
): ElementSpec {
  return {
    tag,
    attrs,
    children: children.filter(
      (child): child is SpecChild => child !== null && child !== undefined && child !== false,
    ),
  };
}

/** The same, in the SVG namespace. */
export function svg(
  tag: string,
  attrs: Readonly<Record<string, AttrValue>>,
  children: readonly (SpecChild | null | undefined | false)[] = [],
): ElementSpec {
  return { ...element(tag, attrs, children), ns: 'svg' };
}
