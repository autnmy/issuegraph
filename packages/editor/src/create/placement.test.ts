import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Bounds, type Size, pickerPlacement } from './placement.ts';

/** A measured canvas that is deliberately NOT at the origin. */
const CANVAS: Bounds = Object.freeze({ x: 50, y: 30, width: 800, height: 600 });
const PICKER: Size = Object.freeze({ width: 200, height: 150 });

describe('the picker opens at the drop point', () => {
  it('anchors its top-left corner there when it fits', () => {
    assert.deepEqual(pickerPlacement({ x: 100, y: 100 }, PICKER, CANVAS), {
      x: 100,
      y: 100,
      flippedX: false,
      flippedY: false,
    });
  });

  it('still fits when it ends exactly on the container edge', () => {
    // The boundary the flip test must not swallow: ending ON the edge is inside.
    // Off by one here and every drop in the last pixel column flips for nothing.
    assert.deepEqual(pickerPlacement({ x: 650, y: 480 }, PICKER, CANVAS), {
      x: 650,
      y: 480,
      flippedX: false,
      flippedY: false,
    });
  });
});

describe('it flips rather than sliding, so the drop point stays on a corner', () => {
  const cases = [
    {
      what: 'the right edge',
      drop: { x: 800, y: 100 },
      expected: { x: 600, y: 100, flippedX: true, flippedY: false },
    },
    {
      what: 'the bottom edge',
      drop: { x: 100, y: 560 },
      expected: { x: 100, y: 410, flippedX: false, flippedY: true },
    },
    {
      what: 'both edges at once',
      drop: { x: 800, y: 560 },
      expected: { x: 600, y: 410, flippedX: true, flippedY: true },
    },
  ] as const;

  for (const { what, drop, expected } of cases) {
    it(`flips back across ${what}`, () => {
      assert.deepEqual(pickerPlacement(drop, PICKER, CANVAS), expected);
    });
  }

  it('leaves the flipped picker fully inside the container', () => {
    const placement = pickerPlacement({ x: 840, y: 620 }, PICKER, CANVAS);
    assert.ok(placement.x >= CANVAS.x);
    assert.ok(placement.y >= CANVAS.y);
    assert.ok(placement.x + PICKER.width <= CANVAS.x + CANVAS.width);
    assert.ok(placement.y + PICKER.height <= CANVAS.y + CANVAS.height);
  });
});

describe('every coordinate is derived from the measurements, never assumed', () => {
  it('reads the container origin rather than assuming 0,0', () => {
    // The failure the kit's implementation note names: coordinates authored
    // against remembered positions. A container measured at an offset — which is
    // every real one, since the canvas sits beside the order rail — would place
    // the picker in the wrong place entirely if the origin were assumed.
    const shifted: Bounds = { ...CANVAS, x: CANVAS.x + 1000 };
    const placement = pickerPlacement({ x: 1800, y: 100 }, PICKER, shifted);
    assert.equal(placement.flippedX, true);
    assert.equal(placement.x, 1600);
  });

  it('scales with the picker it is given, holding no size of its own', () => {
    const wide: Size = { width: 400, height: 150 };
    assert.equal(pickerPlacement({ x: 800, y: 100 }, wide, CANVAS).x, 400);
    assert.equal(pickerPlacement({ x: 800, y: 100 }, PICKER, CANVAS).x, 600);
  });
});

describe('a picker larger than its container pins to the start edge', () => {
  it('keeps the options that exist reachable', () => {
    // Neither side fits, so the flip cannot save it and something has to decide.
    // Pinning to the start edge is that decision: the top-left of the picker —
    // where its first options are — stays on screen.
    const huge: Size = { width: 1000, height: 900 };
    assert.deepEqual(pickerPlacement({ x: 100, y: 100 }, huge, CANVAS), {
      x: CANVAS.x,
      y: CANVAS.y,
      flippedX: true,
      flippedY: true,
    });
  });
});
