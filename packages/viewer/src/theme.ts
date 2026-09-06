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
  // EDIT-STATE HUES, and they are deliberately NOT the edge-kind hues above.
  // An overlay states what is happening to an edge; a kind hue states what the
  // edge IS. Spending `--ig-edge-blocked-by` on "invalid" would make one token
  // mean two things — a host retheming the relationship would silently
  // recolour the state, and an invalid `duplicate-of` would read as a
  // `blocked-by`. That collapses the hue channel the colour-blind-safety claim
  // rests on, so the states get their own.
  //
  // `selected` and `pending-write` are absent BY DESIGN rather than forgotten:
  // selection is `--ig-focus`, which already carries exactly that meaning, and
  // a pending write is drawn with opacity and a dash and asks for no hue at all.
  '--ig-state-invalid',
  '--ig-state-failed',
  '--ig-state-conflict',
] as const);

export type ColorToken = (typeof COLOR_TOKENS)[number];

/**
 * Type tokens. `lineHeight` is unitless; the rest carry their own units.
 *
 * WEIGHT AND TRACKING ARE TYPE, NOT GEOMETRY, even though a reader might file
 * them under either. They are emitted VERBATIM, which is the property that
 * settles it: a weight is a unitless number and a tracking value is an `em`,
 * and {@link METRIC_TOKENS} would give both a `px` unit and silently void the
 * declaration.
 */
export const TYPE_TOKENS = Object.freeze([
  '--ig-font-ui',
  '--ig-font-mono',
  '--ig-font-size',
  '--ig-font-size-small',
  '--ig-line-height',
  // ADDED IN SOURCE ORDER, AFTER THE ONES THAT SHIPPED, in this group and in
  // {@link METRIC_TOKENS} both. `themeCss` emits in list order, so appending
  // rather than interleaving keeps every declaration a host already had in the
  // position it already had — the emitted rule stays a strict superset instead
  // of a reshuffle a snapshotting consumer has to re-approve. Reading order
  // loses a little; the diff a host sees loses nothing.
  //
  // TWO SIZE STEPS BELOW `--ig-font-size-small`, because the design draws two
  // and this file named neither. A relationship badge is 10px and an uppercase
  // status pill is 9.5px (§16a); with 11px as the smallest token, both had to
  // be drawn a size too large, which is why the badge row reads as body copy.
  '--ig-font-size-micro',
  '--ig-font-size-pill',
  // THE FOUR WEIGHTS THE DESIGN USES, and the reason a rail row read as one
  // undifferentiated object: with no weight token every string rendered at
  // 400, so a row's title and its metadata carried the same emphasis.
  '--ig-weight-regular',
  '--ig-weight-medium',
  '--ig-weight-strong',
  '--ig-weight-heavy',
  // Uppercase labels are TRACKED in this design, and tracking is NOT derivable
  // from the size — §16a sets `.06em` and `.08em` on two pills of the same
  // 9.5px sitting in the same list. One token reused for all of them is the
  // approximation that makes uppercase type look mechanically stretched, so
  // there is one per value the frames draw.
  '--ig-tracking-label',
  '--ig-tracking-group',
  '--ig-tracking-pill',
  '--ig-tracking-badge',
  // THE FOUR STEPS BETWEEN `--ig-font-size-micro` AND `--ig-font-size`, for the
  // same reason the two below `small` were added: the frames draw them and this
  // file named none of them, so every one had to be approximated by 11px or
  // 13px. §16a alone spends 10.5 (a footer row's id), 12.5 (a footer row's
  // title and §16b's node title), 13.5 (a rank row's title) and 14 (the rank
  // number itself) — four values in one frame, none of them derivable from the
  // two that shipped. Approximating them is what made a rank row read as one
  // undifferentiated block of body copy: with title, id and provenance all at
  // 11-13px, the row had no type hierarchy to see.
  '--ig-font-size-meta',
  '--ig-font-size-compact',
  '--ig-font-size-row',
  '--ig-font-size-rank',
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
  // Appended, for the reason {@link TYPE_TOKENS} gives.
  //
  // SIX SPACING STEPS, WHICH IS A CHOICE AND SAYS SO. §16a and §16b do not run
  // a scale — they spend a near-continuum from 2px to 20px, with 7px and 9px
  // as common as any tokenised step — so a token set has to pick, and the
  // honest statement is which values it rounds. These six span the range the
  // frames spend and keep the two that shipped exactly where they were: a
  // chip's `2px 7px` padding draws its inline half at `--ig-space-tight`, and
  // a 9px or 10px gap at `--ig-space-snug` or `--ig-space`. What two steps
  // could not do is span it at all — a 2px gap between a title and its
  // metadata and a 20px panel inset both resolved to 6px or 12px, and the rail
  // lost its grouping.
  '--ig-space-micro',
  '--ig-space-snug',
  '--ig-space-loose',
  '--ig-space-wide',
  '--ig-radius-small',
  '--ig-radius-large',
  // A ROW WHOSE HEIGHT CAN FOLLOW ITS CONTENT. `--ig-row-height` stays what it
  // has always been — the FIXED height of a rail row — because a host has that
  // number and its meaning must not move under them. These two are the
  // vocabulary a content-sized row needs instead: a floor, and the padding its
  // content grows against.
  '--ig-row-min-height',
  '--ig-row-padding-block',
  // The accent rail a banded row carries down its leading edge (§16a's
  // WORKING NOW band, `inset 3px 0 0`). It pairs with `--ig-tint-wash`: the
  // wash is the band's fill and this is its edge.
  '--ig-band-rail',
  // §16a's rank TRACK, `grid-template-columns: 34px 1fr`. It is a column width
  // rather than a derived one because the frame fixes it: the rank figure and
  // the readiness dot stack inside it and the title column starts at the same
  // x on every row, held or not. Deriving it from the station size and a gap
  // would make the alignment grid move whenever either did, which is the one
  // thing this column exists to prevent.
  '--ig-rank-column',
  // §16b's spine furniture: the station disc that sits ON the spine line, and
  // the line height a card's own height is counted in.
  '--ig-station-box',
  '--ig-card-line',
] as const);

export type MetricToken = (typeof METRIC_TOKENS)[number];

/**
 * Surface-treatment tokens: values that are none of a colour, a type value or
 * a pixel length, and so belong to none of the three groups above.
 *
 * A FOURTH GROUP RATHER THAN A HOME OF CONVENIENCE IN AN EXISTING ONE. A tint
 * strength is a proportion and an elevation is a whole `box-shadow`; put
 * either in {@link METRIC_TOKENS} and `themeCss` appends `px` to it, which is
 * not a value any browser reads. Put them in {@link TYPE_TOKENS} and the group
 * that documents itself as "type" starts carrying shadows — the same
 * one-token-two-meanings problem the edit-state hues are kept apart from.
 *
 * NO TINT CARRIES A COLOUR. A tint is a PROPORTION, applied by the consumer
 * against a colour token that already exists — `color-mix(in srgb,
 * var(--ig-edge-blocked-by) var(--ig-tint-fill), transparent)` — so the
 * palette stays fixed and a host retheming a relationship retints it too. The
 * two ELEVATIONS are the exception and the only values here that name a
 * colour; `theme.test.ts` pins that split rather than checking the tints
 * alone, so a colour cannot arrive in this group unannounced.
 */
export const EFFECT_TOKENS = Object.freeze([
  // Read from §16a's badge row, where a relationship chip is a fill of its own
  // hue inside a heavier border of the same hue. That is what "badges with
  // tinted fills rather than bare borders" costs in tokens, and with no way to
  // express it every badge shipped as a bare outline.
  '--ig-tint-fill',
  '--ig-tint-border',
  // Two washes, and they are not interchangeable: the band marking the row
  // being worked NOW sits at 5% of the accent, and the together-unit row at
  // 3%. Collapsing them to one value either loses the band or draws every
  // compound station as loud as the one in flight.
  '--ig-tint-wash',
  '--ig-tint-unit',
  // Elevation, and it is the one pair here NOT read from a §16 frame — §16
  // draws no drop shadow at all, separating its panels with `1px solid
  // var(--ig-line)`. The values are the kit's own two, from the surfaces that
  // do float: the device frame the comps sit in, and a floating toast. They
  // are here because the token set is the whole visual vocabulary and an
  // overlay has nowhere else to come from; a §16 panel keeps its border, and
  // reaching for one of these to lift a panel is a decision, not a default.
  '--ig-elevation-raised',
  '--ig-elevation-overlay',
] as const);

export type EffectToken = (typeof EFFECT_TOKENS)[number];

/** Every custom property the stylesheet may reference. */
export const THEME_TOKENS: readonly string[] = Object.freeze([
  ...COLOR_TOKENS,
  ...TYPE_TOKENS,
  ...METRIC_TOKENS,
  ...EFFECT_TOKENS,
]);

export interface Theme {
  readonly colors: Readonly<Record<ColorToken, string>>;
  readonly type: Readonly<Record<TypeToken, string>>;
  /** Numbers, in CSS pixels. Layout reads these; `themeCss` renders them. */
  readonly metrics: Readonly<Record<MetricToken, number>>;
  /** Strings, emitted verbatim — proportions and whole shadow values. */
  readonly effects: Readonly<Record<EffectToken, string>>;
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
    // Refused before any write, and rejected by the write — a shared red
    // family, because what separates them for a reader is SHAPE (dotted ghost
    // versus the ✕ terminal), not hue. They stay separate tokens so a host that
    // wants to separate them by colour can, without redefining a relationship.
    //
    // LIGHTER THAN THEY LOOK THEY SHOULD BE, and deliberately. Both states draw
    // at reduced opacity, and contrast is a property of what LANDS on the
    // surface rather than of the value written here: at 0.5 opacity a saturated
    // `#F2555A` composites to 2.18:1 — under the 3:1 non-text bar — while
    // measuring a perfectly respectable 5.31:1 uncomposited. The editor's
    // grammar test measures the composite, because that is where the opacity
    // this pairs with is declared.
    '--ig-state-invalid': '#FFA8AD',
    '--ig-state-failed': '#FFAF8E',
    // Two versions are held and neither is adopted. Gold rather than red: a
    // conflict is not a failure, and the design's own table says so.
    '--ig-state-conflict': '#F5C542',
  }),
  type: Object.freeze({
    '--ig-font-ui': "Geist, ui-sans-serif, system-ui, sans-serif",
    // Tabular numerals are what let a rank column line up; a proportional
    // fallback would make the spine's numbers wander.
    '--ig-font-mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    '--ig-font-size': '13px',
    '--ig-font-size-small': '11px',
    '--ig-line-height': '1.45',
    // §16a draws a relationship badge at 10px and an uppercase status pill
    // ("now", "⧉ one unit · 2 issues") at 9.5px. Both are read values, not a
    // ratio continued downward — the design does not run a scale here.
    '--ig-font-size-micro': '10px',
    '--ig-font-size-pill': '9.5px',
    // Regular is the ground the file already rendered everything at; medium is
    // §16's emphasis weight; strong is §16a's list rank number, its active
    // toggle and its pills, and is the most-used weight in the frames. Heavy
    // is §16b's STATION rank numbers, which are 700 where §16a's list numbers
    // are 600 — the same figure at two weights in two projections, so three
    // weights could not draw both.
    '--ig-weight-regular': '400',
    '--ig-weight-medium': '500',
    '--ig-weight-strong': '600',
    '--ig-weight-heavy': '700',
    // "Order preview", the panel's own label, at 11px uppercase.
    '--ig-tracking-label': '0.14em',
    // §16b's column headers — "The work order ↓", "Explains the order", "Not
    // worked" — which name a group WITHIN a frame rather than the frame.
    '--ig-tracking-group': '0.1em',
    // §16a's status pill ("now") and its unit badge ("⧉ one unit · 2 issues"),
    // both 9.5px uppercase and sitting in the same list at DIFFERENT tracking.
    // That pair is the reason tracking is its own axis here: it cannot be
    // derived from the size, because these two share one.
    '--ig-tracking-pill': '0.08em',
    '--ig-tracking-badge': '0.06em',
    // Read values, in the same sense as `micro` and `pill`: §16a's footer row
    // prints its id at 10.5 and its title at 12.5, its rank rows print titles
    // at 13.5, and the rank figure itself is 14. §16b reuses `compact` for a
    // node title and `meta` for a node id, which is why they are named for
    // their ROLE rather than for a position in a scale — there is no scale
    // here to be a position in.
    '--ig-font-size-meta': '10.5px',
    '--ig-font-size-compact': '12.5px',
    '--ig-font-size-row': '13.5px',
    '--ig-font-size-rank': '14px',
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
    // §16b's own column widths: a 250px left gutter, a 330px spine card and a
    // 270px right gutter, inside an 1180px panel. One gutter token serves both
    // sides — the frame's 20px difference between them carries no stated
    // meaning, and two tokens would ask a host to reproduce an asymmetry it
    // cannot read a reason for. The sum lands the canvas at 1164, which is the
    // frame's panel less its own border and scroll allowance.
    '--ig-gutter-width': 260,
    '--ig-spine-width': 330,
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
    // AN AVERAGE, because `labelWidth` scales it per character class rather than
    // assuming every glyph is the same width — see `labelWidth` there. A flat
    // CEILING was tried and is wrong in the other direction: at the widest
    // glyph's advance, ordinary titles truncate at roughly half their length,
    // which this package's own fixtures caught immediately.
    '--ig-label-char-width': 6,
    '--ig-focus-ring': 2,
    // Read off §16a: 2px between a row title and its metadata, 8px between the
    // row's blocks, 16px and 20px for the panel's own inset
    // (`padding: 16px 20px`). 6px and 12px are the two that already shipped
    // and did not move.
    '--ig-space-micro': 2,
    '--ig-space-snug': 8,
    '--ig-space-loose': 16,
    '--ig-space-wide': 20,
    // §16a's micro badge is 4px and its outer panel 14px. The existing 6px
    // sits between them and is the chip's, so neither end could be drawn.
    '--ig-radius-small': 4,
    '--ig-radius-large': 14,
    // The FLOOR, matching today's fixed height so a row that grows starts from
    // exactly where a rail row sits now; the same number carries a different
    // meaning, which is why it is a different token rather than a reuse.
    '--ig-row-min-height': 44,
    // §16a's rank row is `padding: 13px 20px`. The block half is what a
    // content-sized row grows against; the inline half is `--ig-space-wide`.
    '--ig-row-padding-block': 13,
    // §16a's WORKING NOW band, `box-shadow: inset 3px 0 0 var(--cyan)`.
    '--ig-band-rail': 3,
    // §16a's rank track, read straight off `grid-template-columns: 34px 1fr`.
    '--ig-rank-column': 34,
    // §16b's station disc, 26px across on the spine.
    '--ig-station-box': 26,
    // One line of text inside a §16b node card, which is what lets the layout
    // give a card a height WITHOUT measuring one. A card's contents are known
    // — a title that may wrap, an identity, a badge row — so its height is a
    // count of lines times this. Chosen as a CEILING on the compact size times
    // the line height (12.5 x 1.45 = 18.1), for the reason `measureLabel` gives
    // about its own metric: a card that reserves slightly too much leaves a
    // gap, and one that reserves too little overlaps the row beneath it.
    '--ig-card-line': 18,
  }),
  effects: Object.freeze({
    // ONE PAIR FOR ALL FIVE RELATIONSHIP CHIPS, at the value §16a draws most
    // often: the fills across its chips are `.08 .08 .08 .09 .09 .10` and the
    // borders `.28 .28 .30 .30 .30 .30 .30 .35 .35 .35`, so the mode is 8% and
    // 30%. Five hues at five alphas would be a palette rather than a
    // treatment, and the chips that draw hotter are the ACCENT ones — a host
    // wanting that emphasis raises the pair rather than being given it by
    // default on a blocked-by.
    '--ig-tint-fill': '8%',
    '--ig-tint-border': '30%',
    // §16a's WORKING NOW band, `background: rgba(23,188,238,.05)`.
    '--ig-tint-wash': '5%',
    // §16a's rank-2 row, `background: rgba(23,188,238,.03)` — the ONE row that
    // carries a fill, and it carries it because it is the `together-with`
    // compound station. The other four rank rows have no background: this is
    // not a zebra stripe and drawing it as one would invent a treatment §16
    // does not have.
    '--ig-tint-unit': '3%',
    // The kit's own two drop shadows, verbatim: the floating toast, and the
    // device frame the comps are mounted in. See EFFECT_TOKENS on why they are
    // here rather than read from a §16 frame.
    //
    // DELIBERATELY LITERAL rather than mixed against `--ig-bg`. A shadow is
    // dark on a light ground as well as a dark one, so expressing it against
    // the background would turn it white on the documented paper theme and
    // delete it. These two are the only values in this group that carry a
    // colour, and a host retheming to a light palette owns them.
    '--ig-elevation-raised': '0 16px 40px -16px rgba(0, 0, 0, 0.9)',
    '--ig-elevation-overlay': '0 30px 80px -40px rgba(0, 0, 0, 0.8)',
  }),
});

/** Everything a caller may override, with every field optional. */
export interface ThemeOverride {
  readonly colors?: Partial<Record<ColorToken, string>> | undefined;
  readonly type?: Partial<Record<TypeToken, string>> | undefined;
  readonly metrics?: Partial<Record<MetricToken, number>> | undefined;
  readonly effects?: Partial<Record<EffectToken, string>> | undefined;
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
    effects: Object.freeze({ ...base.effects, ...override.effects }),
  });
}

/**
 * A caller's theme, with anything it does not carry filled from the default.
 *
 * EVERY ENTRY POINT THAT ACCEPTS A THEME GOES THROUGH THIS, because a `Theme`
 * is a plain object a host may have built against an EARLIER version of this
 * package and stored. Adding a token then puts a hole in it, and the hole does
 * not fail loudly: a missing metric reads `undefined`, arithmetic on it yields
 * `NaN`, and every comparison against `NaN` is false. Measured when
 * `--ig-label-char-width` was added — a 0.1.0 theme made every measured width
 * `NaN`, so a card's height came out `NaN` and every station stacked at the
 * same y, and `themeCss` emitted `undefinedpx`.
 *
 * A TypeScript caller is told about a new token by the compiler; a JavaScript
 * one is not, and neither is a theme deserialized from storage. This is the
 * boundary where that difference stops mattering.
 *
 * IT REUSES `extendTheme` rather than merging again — a full `Theme` is a valid
 * `ThemeOverride`, and a second merge is a second rule to keep in step.
 */
export function resolveTheme(theme?: Theme | undefined): Theme {
  return theme === undefined ? defaultTheme : extendTheme(defaultTheme, theme);
}

/**
 * Render a theme as one CSS rule of custom properties.
 *
 * Values are emitted verbatim for colours, type and effects — a theme's author
 * owns their spelling — and metrics gain a `px` unit here, which is the single
 * place the numbers become CSS.
 */
export function themeCss(theme: Theme, selector = ':root'): string {
  // RESOLVED HERE TOO: this is an exported entry point taking a caller's theme
  // and emitting the CSS a host installs, and an absent token wrote a literal
  // `undefinedpx`, which is not a value any browser reads.
  const filled = resolveTheme(theme);
  const lines: string[] = [];
  for (const token of COLOR_TOKENS) lines.push(`  ${token}: ${filled.colors[token]};`);
  for (const token of TYPE_TOKENS) lines.push(`  ${token}: ${filled.type[token]};`);
  for (const token of METRIC_TOKENS) lines.push(`  ${token}: ${String(filled.metrics[token])}px;`);
  for (const token of EFFECT_TOKENS) lines.push(`  ${token}: ${filled.effects[token]};`);
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}
