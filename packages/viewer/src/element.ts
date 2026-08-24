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
 */
export function renderMarkup(spec: ElementSpec, inheritedNs?: 'svg' | undefined): string {
  const ns = spec.ns ?? inheritedNs;
  const open = `<${spec.tag}${renderAttrs(spec.attrs)}`;
  const children = spec.children ?? [];
  if (children.length === 0) {
    if (ns === 'svg' || VOID_HTML_TAGS.has(spec.tag)) return `${open} />`;
    return `${open}></${spec.tag}>`;
  }
  const inner = children
    .map((child) => (isSpec(child) ? renderMarkup(child, ns) : escapeText(child)))
    .join('');
  return `${open}>${inner}</${spec.tag}>`;
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
  const ns = spec.ns ?? options.ns;
  const element =
    ns === 'svg' ? doc.createElementNS(SVG_NAMESPACE, spec.tag) : doc.createElement(spec.tag);

  if (spec.attrs !== undefined) {
    for (const [name, value] of Object.entries(spec.attrs)) {
      if (value === undefined || value === null || value === false) continue;
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }

  options.onElement?.(spec, element);

  for (const child of spec.children ?? []) {
    element.appendChild(
      isSpec(child) ? materialize(doc, child, { ...options, ns }) : doc.createTextNode(child),
    );
  }
  return element;
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
