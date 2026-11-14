/**
 * A reading of the cascade for one element, shared by the tests that pin the
 * type of every count the editor draws.
 *
 * THE RULE (#254, as the redesign lead ruled it): the counts the packages
 * render, and every issue number, use the body sans at the body size with
 * tabular figures, not 11px mono; the keys line and the legend take the small
 * role in the same sans. Mono is kept only for keys a reader copies, such as
 * label:P0. Each sheet's test names its own selectors and asks what the cascade gives each one,
 * in that sheet alone and after the viewer sheet the editor installs first — so
 * a later or more specific rule that puts mono or a smaller size back fails in
 * the test of the sheet that wrote it.
 *
 * jsdom applies no stylesheet, so this evaluates the sheet itself, and it reads
 * PESSIMISTICALLY: a rule counts when its last compound can select the element,
 * whatever its ancestors are and whatever state it names, because a count that
 * reads mono in one context is the defect. A container query is taken to hold.
 * A pseudo-element styles another box, so it never counts.
 *
 * Its own file because five sheets' tests read it. The viewer's sheet test
 * carries its own copy: a package test reaching into a sibling's source is the
 * seam `check:isolation` keeps.
 */

/** The type a role sets: each property and the value the cascade must give it. */
export type RoleType = Readonly<Record<string, string>>;

/** The three declarations every count carries. */
export const COUNT_TYPE: RoleType = Object.freeze({
  'font-family': 'var(--ig-font-ui)',
  'font-size': 'var(--ig-font-size)',
  'font-variant-numeric': 'tabular-nums',
});

/**
 * The small role the keys line, the legend and the explanation lines take
 * (provenance, hold, caveat, freshness): the same sans, a step below the body.
 */
export const SMALL_TYPE: RoleType = Object.freeze({
  'font-family': 'var(--ig-font-ui)',
  'font-size': 'var(--ig-font-size-small)',
  'font-variant-numeric': 'tabular-nums',
});

/**
 * What an issue number keeps in EVERY context: the sans and tabular figures.
 * Its size and colour are the base rule's, and a context may set its own — a
 * card's identity line is smaller — so only these two are read pessimistically.
 */
export const ISSUE_NUMBER_TYPE: RoleType = Object.freeze({
  'font-family': 'var(--ig-font-ui)',
  'font-variant-numeric': 'tabular-nums',
});

/** The base `.ig-id` rule, as the design's muted number draws it. */
export const ISSUE_NUMBER_BASE: RoleType = Object.freeze({
  color: 'var(--ig-text-muted)',
  'font-family': 'var(--ig-font-ui)',
  'font-size': 'var(--ig-font-size)',
  'font-variant-numeric': 'tabular-nums',
});

/**
 * The counts the VIEWER draws. The editor installs the viewer's sheet beneath
 * its own, so the workspace test asks that no editor sheet puts mono or a
 * smaller size back on any of them either.
 */
export const VIEWER_COUNTS: readonly string[] = Object.freeze([
  '.ig-count-chip',
  '.ig-count',
  '.ig-notice-progress',
  '.ig-unit-count',
  '.ig-badge[data-omitted]',
]);

/** The viewer's legend bar, at the small role, read the same way. */
export const VIEWER_SMALL: readonly string[] = Object.freeze(['.ig-legend-item', '.ig-legend-keys']);

/**
 * The viewer's explanation lines, at the small role: one face and one size per
 * line. A number inside one inherits the line's size, and a copied key inside
 * one is mono at it.
 */
export const VIEWER_LINES: readonly string[] = Object.freeze(['.ig-provenance', '.ig-hold', '.ig-caveat', '.ig-freshness']);

/** A later rule that puts the mono face back. */
export const MONO_BACK: readonly (readonly [string, string])[] = [['font-family', 'var(--ig-font-mono)']];

/** Later rules that put the old type back on a count: the mono face, and the small size. */
export const COUNT_BACK: readonly (readonly [string, string])[] = [
  ['font-family', 'var(--ig-font-mono)'],
  ['font-size', 'var(--ig-font-size-small)'],
];

/** Later rules that move the small role off it: the mono face, and the smaller micro size. */
export const SMALL_BACK: readonly (readonly [string, string])[] = [
  ['font-family', 'var(--ig-font-mono)'],
  ['font-size', 'var(--ig-font-size-micro)'],
];

/** One attribute selector, or one attribute an element carries. */
interface Attribute {
  readonly name: string;
  readonly operator: string | null;
  readonly value: string | null;
}

/** One compound selector: what an element must be to match it. */
interface Compound {
  /** `null` matches any tag; a target with no tag matches no rule that names one. */
  readonly tag: string | null;
  readonly classes: readonly string[];
  readonly attributes: readonly Attribute[];
}

/** One declaration and the rule it came from. */
export interface Declared {
  readonly value: string;
  readonly selector: string;
}

/** How an attribute selector's operator compares the value it names with the one the element holds. */
const OPERATORS: Readonly<Record<string, (wanted: string, held: string) => boolean>> = {
  '=': (wanted, held) => held === wanted,
  '~=': (wanted, held) => held.split(/\s+/).includes(wanted),
};

/** `text` split at `separator` wherever it is outside every bracket and parenthesis. */
function splitOutside(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  [...text].forEach((char, index) => {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (depth === 0 && separator.test(char)) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  });
  return [...parts, text.slice(start)].map((part) => part.trim()).filter((part) => part !== '');
}

/** A selector's compounds, outermost first, split outside every `:not(…)` and attribute value. */
function compoundsOf(selector: string): string[] {
  return splitOutside(selector, /[\s>+~]/);
}

/** The compound a selector styles: its last. */
function lastCompound(selector: string): string {
  return compoundsOf(selector).at(-1) ?? '';
}

/**
 * Whether a selector's ancestor compounds can all be found, in order, among
 * `ancestors` (outermost first). Every combinator is read as a descendant one,
 * which only ever lets a rule match more.
 */
function withinAncestors(selector: string, ancestors: readonly Compound[]): boolean {
  const wanted = compoundsOf(selector).slice(0, -1);
  let at = ancestors.length - 1;
  for (let index = wanted.length - 1; index >= 0; index -= 1) {
    const compound = compoundOf(wanted[index] ?? '');
    if (compound === null) return false;
    while (at >= 0 && !canStyle(compound, ancestors[at] ?? { tag: null, classes: [], attributes: [] })) at -= 1;
    if (at < 0) return false;
    at -= 1;
  }
  return true;
}

/** A compound with every pseudo-class removed, balanced parentheses and all. A state is taken as reachable. */
function withoutStates(compound: string): string {
  let bare = '';
  let at = 0;
  while (at < compound.length) {
    if (compound[at] !== ':') {
      bare += compound[at] ?? '';
      at += 1;
      continue;
    }
    at += 1;
    while (at < compound.length && /[\w-]/.test(compound[at] ?? '')) at += 1;
    if (compound[at] !== '(') continue;
    let depth = 0;
    do {
      if (compound[at] === '(') depth += 1;
      if (compound[at] === ')') depth -= 1;
      at += 1;
    } while (at < compound.length && depth > 0);
  }
  return bare;
}

function attributeOf(text: string): Attribute | null {
  const match = /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:'([^']*)'|"([^"]*)"|([^\s\]]+)))?\s*\]$/.exec(text);
  if (match === null) return null;
  return { name: match[1] ?? '', operator: match[2] ?? null, value: match[3] ?? match[4] ?? match[5] ?? null };
}

/** A compound selector's parts, or `null` when it is not one this reading understands, which then styles nothing. */
function compoundOf(text: string): Compound | null {
  const bare = withoutStates(text);
  const tag = /^(?:\*|[a-z][\w-]*)/i.exec(bare)?.[0] ?? null;
  const rest = bare.slice(tag?.length ?? 0);
  const parts = rest.match(/\.[\w-]+|\[[^\]]*\]/g) ?? [];
  if (parts.join('') !== rest || (tag === null && parts.length === 0)) return null;
  const attributes = parts.filter((part) => part.startsWith('[')).map(attributeOf);
  if (attributes.some((one) => one === null)) return null;
  return {
    tag: tag === '*' ? null : tag,
    classes: parts.filter((part) => part.startsWith('.')).map((part) => part.slice(1)),
    attributes: attributes.filter((one): one is Attribute => one !== null),
  };
}

/** Whether a rule's compound can select an element that is exactly `element`. */
function canStyle(rule: Compound, element: Compound): boolean {
  if (rule.tag !== null && rule.tag !== element.tag) return false;
  return (
    rule.classes.every((name) => element.classes.includes(name)) &&
    rule.attributes.every((wanted) =>
      element.attributes.some((held) => {
        if (held.name !== wanted.name) return false;
        const compare = wanted.operator === null ? undefined : OPERATORS[wanted.operator];
        // AN OPERATOR THIS READING DOES NOT MODEL MATCHES ON PRESENCE, so it
        // over-counts a rule rather than missing one.
        return compare === undefined || compare(wanted.value ?? '', held.value ?? '');
      }),
    )
  );
}

/**
 * A selector's specificity, folded to one comparable number: ids, then classes,
 * attributes and pseudo-classes, then tags. `:not(…)`, `:is(…)` and `:has(…)`
 * take their argument's, which the counts below reach because the argument is
 * in the same string.
 */
function specificity(selector: string): number {
  const count = (pattern: RegExp): number => (selector.match(pattern) ?? []).length;
  return (
    count(/#[\w-]+/g) * 10000 +
    count(/\.[\w-]+|\[[^\]]*\]|:(?!not\(|is\(|has\(|where\()[\w-]+/g) * 100 +
    count(/(?:^|[\s>+~(,])[a-z][\w-]*/gi)
  );
}

/** Every rule of a sheet, in source order, with a container query's rules among them. */
function rulesOf(css: string): { readonly selectors: readonly string[]; readonly body: string }[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selectors: splitOutside((match[1] ?? '').trim(), /,/), body: match[2] ?? '' }))
    .filter((rule) => !rule.selectors.some((selector) => selector.startsWith('@')));
}

/**
 * What the cascade gives `property` on an element that is exactly `target`:
 * the most specific rule that can style it, and of those the last. The `font`
 * shorthand resets all three properties, so it is read as setting each of them.
 *
 * WITH `ancestors` (outermost first) the element sits inside exactly those, and
 * a rule whose ancestor compounds they cannot supply does not apply — so a
 * number INSIDE a provenance line is read as that line's number, and a rule for
 * a number on a card does not stand in for it. Without them, any ancestor is
 * taken as present.
 */
export function declaredOn(
  css: string,
  target: string,
  property: string,
  ancestors?: readonly string[],
): Declared | undefined {
  const element = compoundOf(target);
  if (element === null) throw new Error(`${target} is not a compound selector`);
  const context = ancestors?.map((one) => {
    const compound = compoundOf(one);
    if (compound === null) throw new Error(`${one} is not a compound selector`);
    return compound;
  });
  let winner: (Declared & { readonly rank: number }) | undefined;
  for (const rule of rulesOf(css)) {
    const declarations = rule.body
      .split(';')
      .filter((line) => line.includes(':'))
      .map((line) => ({ name: line.slice(0, line.indexOf(':')).trim(), value: line.slice(line.indexOf(':') + 1).trim() }))
      .filter(({ name }) => name === property || name === 'font');
    for (const selector of rule.selectors) {
      if (selector.includes('::')) continue;
      const styled = compoundOf(lastCompound(selector));
      if (styled === null || !canStyle(styled, element)) continue;
      if (context !== undefined && !withinAncestors(selector, context)) continue;
      for (const { name, value } of declarations) {
        const rank = specificity(selector) + (value.includes('!important') ? 1_000_000 : 0);
        if (winner === undefined || rank >= winner.rank) {
          winner = { rank, selector, value: name === 'font' ? `font: ${value}` : value };
        }
      }
    }
  }
  return winner === undefined ? undefined : { value: winner.value, selector: winner.selector };
}

/** Every one of `targets` the cascade does not give {@link COUNT_TYPE}, one line per property. */
export function countTypeMisses(css: string, targets: readonly string[]): string[] {
  return typeMisses(css, targets, COUNT_TYPE);
}

/** Every one of `targets` the cascade does not give `type`, one line per property. */
export function typeMisses(css: string, targets: readonly string[], type: RoleType): string[] {
  return targets.flatMap((target) =>
    Object.entries(type).flatMap(([property, expected]) => {
      const declared = declaredOn(css, target, property);
      return declared?.value === expected
        ? []
        : [`${target} reads ${property}: ${declared?.value ?? 'nothing'} (from ${declared?.selector ?? 'no rule'})`];
    }),
  );
}

/**
 * Later rules that each put a wrong type back on `target` — by default the
 * mono face and the small size a count used to take — written on the selector
 * that wins today, so each ties it on specificity and wins on order. A reading
 * that passes any of them is blind.
 */
export function regressionsOf(
  css: string,
  target: string,
  wrong: readonly (readonly [string, string])[] = COUNT_BACK,
): string[] {
  return wrong.map(([property, value]) => {
    const winner = declaredOn(css, target, property);
    if (winner === undefined) throw new Error(`no rule sets ${property} on ${target}`);
    return `${css}\n${winner.selector} {\n  ${property}: ${value};\n}\n`;
  });
}

/**
 * What the rules written on exactly `selector` declare, later declarations
 * winning — the base rule, read apart from any context that narrows it.
 */
export function baseRule(css: string, selector: string): ReadonlyMap<string, string> {
  const declared = new Map<string, string>();
  for (const rule of rulesOf(css)) {
    if (!rule.selectors.includes(selector)) continue;
    for (const line of rule.body.split(';').filter((one) => one.includes(':'))) {
      declared.set(line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim());
    }
  }
  return declared;
}
