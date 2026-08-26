/**
 * Where the canvas path draws its type picker.
 *
 * §17b puts the picker "at the drop point", and the kit's implementation note
 * fixes how that coordinate is arrived at: *"Hand-authoring these coordinates
 * against remembered positions is the failure mode; compute them from layout."*
 * So this takes MEASURED bounds — the container's, and the picker's own — and
 * derives a position from them. It holds no constants about how big anything is.
 *
 * ## The one thing it adds to "at the drop point"
 *
 * A drop near the right or bottom edge would put a picker anchored there partly
 * outside the canvas, where the reader cannot reach the options. So the picker
 * FLIPS to the other side of the drop point rather than being nudged: a flip
 * keeps the drop point on a corner of the picker, so the picker still visibly
 * belongs to the gesture that opened it, while a nudge slides it off the point
 * and reads as landing somewhere arbitrary.
 *
 * A flip is reported rather than only applied ({@link AxisPlacement.flipped}),
 * because the side the picker opens on decides which corner its callout points
 * from — and a host that had to re-derive that from the coordinates would be
 * recomputing a decision already made here.
 *
 * ## It is geometry, so it is not in the draft
 *
 * The canvas is the only path with a drop point: the inspector opens its picker
 * in a panel and the keyboard never has a pointer position at all. That is the
 * whole of what distinguishes the three, and keeping it here — rather than as a
 * field on {@link ./draft.ts CreateDraft} — is what stops "which path started
 * this" from becoming state the rest of the create logic could branch on.
 *
 * Pure arithmetic on numbers, so it runs under the purity test like everything
 * else here: it never measures anything itself. Measuring is the shell's, from
 * `getBoundingClientRect` or its own layout output; both arrive as plain data.
 */

/** A measured rectangle, in whatever coordinate space the caller measured in. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A measured extent. The picker's own, once the host has laid it out. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where the drag was released, in the container's coordinate space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * One axis of the answer. Internal: `pickerPlacement` returns the flat
 * {@link PickerPlacement}, so nothing outside this module needs to name it, and
 * this package exports nothing before something is owed.
 */
interface AxisPlacement {
  readonly position: number;
  /**
   * Whether the picker was ANCHORED back towards the drop point on this axis.
   *
   * The anchoring decision, which is what a host needs to know to point a
   * callout at the right corner. The clamp below can still move the picker
   * afterwards — and in the one case where it moves it far, a picker larger
   * than its container, the flag describes a choice whose visible effect the
   * clamp has overridden. That case has no better answer to give: a picker
   * covering the whole container has no corner the drop point sits on.
   */
  readonly flipped: boolean;
}

/** Where to draw the picker, and which way it opened. */
export interface PickerPlacement {
  readonly x: number;
  readonly y: number;
  readonly flippedX: boolean;
  readonly flippedY: boolean;
}

/**
 * Place one axis: open forward from the drop, flip if that overflows, then clamp.
 *
 * ONE RULE APPLIED TWICE rather than written out for x and for y. The two axes
 * differ only in which measurements they read, and a second copy is a second
 * place for the arithmetic to drift — which on this surface would show up as a
 * picker correct horizontally and off-canvas vertically.
 *
 * The clamp is last and is not redundant with the flip. A picker LARGER than
 * its container overflows whichever way it opens, so the flip cannot save it and
 * something has to decide what it does instead: it pins to the container's start
 * edge, which keeps the options that exist reachable. `Math.min` before
 * `Math.max` is what produces that — with the picker oversized the inner term
 * lands before the start edge, and the outer `max` pulls it back — so the order
 * is load-bearing rather than stylistic.
 */
function place(drop: number, extent: number, start: number, span: number): AxisPlacement {
  const end = start + span;
  const flipped = drop + extent > end;
  const anchored = flipped ? drop - extent : drop;
  return { position: Math.max(start, Math.min(anchored, end - extent)), flipped };
}

/**
 * The picker's top-left corner for a drop at `drop`, inside `container`.
 *
 * Every input is measured by the caller; nothing here assumes a size, a margin
 * or a viewport. `container` is the canvas's own measured bounds rather than the
 * window's, because the canvas is the surface the drop happened on and a picker
 * escaping it would sit over the order rail beside it.
 */
export function pickerPlacement(drop: Point, picker: Size, container: Bounds): PickerPlacement {
  const horizontal = place(drop.x, picker.width, container.x, container.width);
  const vertical = place(drop.y, picker.height, container.y, container.height);
  return {
    x: horizontal.position,
    y: vertical.position,
    flippedX: horizontal.flipped,
    flippedY: vertical.flipped,
  };
}
