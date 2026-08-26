/**
 * The theme: every value the viewer draws with, in one place, emitted as CSS
 * custom properties.
 *
 * THE SHIPPED PALETTE IS THE DEFAULT THEME, NOT THE STYLING. It is dark, and
 * light mode is deliberately absent rather than forgotten — a host that wants
 * one supplies it through these same properties, which is exactly what makes
 * this a theme rather than a look. The forcing function is that the package has
 * to render two of them from one set of components; if a value cannot be
 * overridden here, it is a bug in this file and not a styling choice elsewhere.
 *
 * GEOMETRY IS SINGLE-SOURCED AS NUMBERS. Layout maths needs real numbers (an
 * SVG endpoint is a coordinate, not a `var()`), and CSS needs custom
 * properties. Declaring both by hand would be two sources that drift, so the
 * numbers are canonical and {@link themeCss} renders the properties FROM them.
 * Retheming geometry therefore moves the drawing and the stylesheet together.
 */

/**
 * Every colour the viewer uses, by token name. Declared as a tuple so the
 * token list and the theme type cannot disagree: a colour added here is a
 * compile error in every theme that does not supply it.
 */
export const COLOR_TOKENS = Object.freeze([
  '--ig-bg',
  '--ig-surface',
  '--ig-surface-2',
  '--ig-line',
  '--ig-text',
  '--ig-text-body',
  '--ig-text-muted',
  '--ig-accent',
  '--ig-focus',
  '--ig-station-ready',
  '--ig-station-pending',
  '--ig-station-held',
  '--ig-edge-blocked-by',
  '--ig-edge-serialize-with',
  '--ig-edge-together-with',
  '--ig-edge-duplicate-of',
  '--ig-edge-decomposed-from',
] as const);

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** Type tokens. `lineHeight` is unitless; the rest carry their own units. */
export const TYPE_TOKENS = Object.freeze([
  '--ig-font-ui',
  '--ig-font-mono',
  '--ig-font-size',
  '--ig-font-size-small',
  '--ig-line-height',
] as const);

export type TypeToken = (typeof TYPE_TOKENS)[number];

/** Geometry tokens. Every value is a number of CSS pixels. */
export const METRIC_TOKENS = Object.freeze([
  '--ig-space',
  '--ig-space-tight',
  '--ig-radius',
  '--ig-row-height',
  '--ig-station-size',
  '--ig-station-halo',
  '--ig-stroke',
  '--ig-stroke-connector',
  '--ig-terminal-length',
  '--ig-terminal-width',
  '--ig-gutter-width',
  '--ig-spine-width',
  '--ig-char-width',
  '--ig-label-char-width',
  '--ig-focus-ring',
] as const);

export type MetricToken = (typeof METRIC_TOKENS)[number];

/** Every custom property the stylesheet may reference. */
export const THEME_TOKENS: readonly string[] = Object.freeze([
  ...COLOR_TOKENS,
  ...TYPE_TOKENS,
  ...METRIC_TOKENS,
]);

export interface Theme {
  readonly colors: Readonly<Record<ColorToken, string>>;
  readonly type: Readonly<Record<TypeToken, string>>;
  /** Numbers, in CSS pixels. Layout reads these; `themeCss` renders them. */
  readonly metrics: Readonly<Record<MetricToken, number>>;
}

/**
 * The default theme.
 *
 * Contrast is a claim this palette makes and `theme.test.ts` measures: every
 * text colour clears WCAG AA's 4.5:1 against all three surfaces, and every edge
 * hue clears the 3:1 non-text bar that applies to a line or a badge outline.
 * `--ig-text-muted` is the tight one — it carries sentence-length copy at small
 * sizes, which is why it is the value the tests pin most precisely.
 */
export const defaultTheme: Theme = Object.freeze({
  colors: Object.freeze({
    '--ig-bg': '#0B0D0F',
    '--ig-surface': '#11181C',
    '--ig-surface-2': '#0E1519',
    '--ig-line': '#232D34',
    '--ig-text': '#E8EDF0',
    '--ig-text-body': '#AEB9C0',
    '--ig-text-muted': '#75848E',
    '--ig-accent': '#17BCEE',
    '--ig-focus': '#17BCEE',
    '--ig-station-ready': '#17BCEE',
    '--ig-station-pending': '#AEB9C0',
    '--ig-station-held': '#75848E',
    '--ig-edge-blocked-by': '#EF6B6B',
    '--ig-edge-serialize-with': '#E2B912',
    '--ig-edge-together-with': '#17BCEE',
    '--ig-edge-duplicate-of': '#B037F1',
    '--ig-edge-decomposed-from': '#E7317A',
  }),
  type: Object.freeze({
    '--ig-font-ui': "Geist, ui-sans-serif, system-ui, sans-serif",
    // Tabular numerals are what let a rank column line up; a proportional
    // fallback would make the spine's numbers wander.
    '--ig-font-mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    '--ig-font-size': '13px',
    '--ig-font-size-small': '11px',
    '--ig-line-height': '1.45',
  }),
  metrics: Object.freeze({
    '--ig-space': 12,
    '--ig-space-tight': 6,
    '--ig-radius': 6,
    '--ig-row-height': 44,
    '--ig-station-size': 12,
    // A halo wide enough that a crossing edge reads as passing behind the
    // station rather than through it.
    '--ig-station-halo': 4,
    '--ig-stroke': 1.5,
    // The `together-with` hairline connector, which is deliberately finer than
    // an ordinary edge so the enclosure stays the primary read.
    '--ig-stroke-connector': 1.6,
    // The terminal marker's own box. It is theme data rather than a constant
    // in the drawing code because it is a SIZE, and R5 admits no exceptions:
    // a host scaling the type up needs the arrowheads to follow.
    '--ig-terminal-length': 9,
    '--ig-terminal-width': 8,
    '--ig-gutter-width': 208,
    '--ig-spine-width': 360,
    // The advance width of one character at `--ig-font-size` in the mono face.
    // Layout measures text with it, so a host changing the type scale changes
    // this too and the boxes stay around their contents.
    '--ig-char-width': 7.8,
    // The AVERAGE advance of one character in the LABEL face at
    // `--ig-font-size-small` — a different face and a different size from
    // `--ig-char-width`, which is documented as the MONO advance at
    // `--ig-font-size`. Measuring one with the other is what let a wide-glyph
    // title overflow its node: 24 all-capital characters "fitted" 187.2px of
    // room and drew about 240px, straight across the routing channel.
    //
    // AN AVERAGE, because `fitLabel` scales it per character class rather than
    // assuming every glyph is the same width — see `labelWidth` there. A flat
    // CEILING was tried and is wrong in the other direction: at the widest
    // glyph's advance, ordinary titles truncate at roughly half their length,
    // which this package's own fixtures caught immediately.
    '--ig-label-char-width': 6,
    '--ig-focus-ring': 2,
  }),
});

/** Everything a caller may override, with every field optional. */
export interface ThemeOverride {
  readonly colors?: Partial<Record<ColorToken, string>> | undefined;
  readonly type?: Partial<Record<TypeToken, string>> | undefined;
  readonly metrics?: Partial<Record<MetricToken, number>> | undefined;
}

/**
 * Merge an override onto a base theme, per token.
 *
 * A partial override is the shape a second theme actually takes — changing a
 * palette rarely means restating the geometry — and requiring a whole `Theme`
 * would make the cheap case impossible to express.
 */
export function extendTheme(base: Theme, override: ThemeOverride): Theme {
  return Object.freeze({
    colors: Object.freeze({ ...base.colors, ...override.colors }),
    type: Object.freeze({ ...base.type, ...override.type }),
    metrics: Object.freeze({ ...base.metrics, ...override.metrics }),
  });
}

/**
 * Render a theme as one CSS rule of custom properties.
 *
 * Values are emitted verbatim for colours and type — a theme's author owns
 * their spelling — and metrics gain a `px` unit here, which is the single place
 * the numbers become CSS.
 */
export function themeCss(theme: Theme, selector = ':root'): string {
  const lines: string[] = [];
  for (const token of COLOR_TOKENS) lines.push(`  ${token}: ${theme.colors[token]};`);
  for (const token of TYPE_TOKENS) lines.push(`  ${token}: ${theme.type[token]};`);
  for (const token of METRIC_TOKENS) lines.push(`  ${token}: ${String(theme.metrics[token])}px;`);
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}
