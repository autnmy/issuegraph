/**
 * WCAG 2.x relative luminance and contrast ratio, for tests only.
 *
 * It lives beside the fixtures rather than in the package because the viewer
 * RENDERS, it does not audit. Shipping a contrast function would invite a host
 * to gate on it, and the claim being tested is about the themes THIS package
 * documents — not about every palette a host might supply.
 */

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** The three surfaces every foreground token is measured against. */
export const SURFACE_TOKENS = Object.freeze(['--ig-bg', '--ig-surface', '--ig-surface-2'] as const);

/** Foreground tokens held to the 4.5:1 text minimum. */
export const TEXT_TOKENS = Object.freeze([
  '--ig-text',
  '--ig-text-body',
  '--ig-text-muted',
] as const);

/**
 * Edge hues, held to the 3:1 NON-TEXT minimum. An edge is a line and a badge
 * outline — a graphical object — so 1.4.11 applies rather than the text bar.
 * Stating the different bar explicitly is what stops the looser number leaking
 * onto text later.
 */
export const EDGE_TOKENS = Object.freeze([
  '--ig-edge-blocked-by',
  '--ig-edge-serialize-with',
  '--ig-edge-together-with',
  '--ig-edge-duplicate-of',
  '--ig-edge-decomposed-from',
] as const);

/**
 * Edit-state hues, held to the same 3:1 NON-TEXT minimum and for the same
 * reason: an overlay is a stroke, a ghost line or a terminal mark — a graphical
 * object, never text.
 *
 * They are a SEPARATE list rather than more entries in `EDGE_TOKENS` because
 * the two answer different questions, and a reader of a failure message needs
 * to know which. Both lists are swept, so nothing is measured less strictly by
 * being here.
 */
export const STATE_TOKENS = Object.freeze([
  '--ig-state-invalid',
  '--ig-state-failed',
  '--ig-state-conflict',
] as const);

/**
 * The state tokens this package expects a consumer to draw GHOSTED, and the
 * strongest fade it expects them to survive.
 *
 * Stated here rather than imported, because the opacity itself belongs to the
 * consumer's own treatment table and a copy of that number would drift. What
 * this expresses is the viewer's side of the bargain: a token named for a
 * refused or rejected edit has to stay legible when it is faded, so its VALUE
 * is chosen for that. A consumer that fades harder than this fails its own
 * composited test rather than silently passing ours.
 *
 * `--ig-state-conflict` is absent on purpose: two held versions are drawn at
 * full strength, because a conflict is not a fade — it is two things to
 * compare.
 */
export const GHOSTED_STATE_TOKENS = Object.freeze([
  '--ig-state-invalid',
  '--ig-state-failed',
] as const);

/** The strongest fade {@link GHOSTED_STATE_TOKENS} are expected to survive. */
export const GHOST_ALPHA = 0.5;

/**
 * `fg` drawn at `alpha` over `bg` — what the compositor actually produces.
 *
 * Contrast is a property of what LANDS on the surface, and a hue drawn at half
 * opacity is not the hue the token names: a value measuring a comfortable
 * 5.31:1 on its own composited to 2.18:1 once it was ghosted, under the
 * non-text bar, while the uncomposited assertion stayed green.
 */
export function composite(fg: string, bg: string, alpha: number): string {
  const front = Number.parseInt(fg.slice(1), 16);
  const back = Number.parseInt(bg.slice(1), 16);
  const mix = (shift: number): number =>
    Math.round(alpha * ((front >> shift) & 255) + (1 - alpha) * ((back >> shift) & 255));
  return `#${[mix(16), mix(8), mix(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
