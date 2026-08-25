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
