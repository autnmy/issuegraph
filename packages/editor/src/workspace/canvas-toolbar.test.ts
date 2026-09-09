/**
 * §17f's canvas caption, and the one tier it is true on.
 *
 * The zone was never silent in general — the ladder's chrome already draws a
 * clear-focus button, a counted refusal and the isolated chip. What it never
 * said is the RATIO on the tier where the canvas succeeds, and that is what
 * these pin, together with the states where the row must not be drawn at all.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ViewerDocument } from '@issuegraph/viewer';

import { INITIAL_SCALE_STATE } from '../scale/commands.ts';
import { renderWorkspace } from './render.ts';
import { WORKSPACE_WORDS, backlogOf, keysOf } from '../testing/workspace.ts';

const CANVAS = WORKSPACE_WORDS.canvas;

/**
 * The canvas zone alone. The zones are emitted in a fixed order — header, rail,
 * canvas, inspector — so the slice ends where the inspector begins rather than
 * running to the end of the document.
 */
function canvasZone(markup: string): string {
  const start = markup.indexOf('<section class="ig-zone" data-zone="canvas">');
  assert.notEqual(start, -1, 'no canvas zone');
  const end = markup.indexOf('<section class="ig-zone" data-zone="inspector">', start);
  assert.notEqual(end, -1, 'no inspector zone after the canvas');
  return markup.slice(start, end);
}

/**
 * The focus clause alone. Sliced rather than matched: the clause holds nested
 * spans, so a lazy `</span>` pattern closes on the first inner one.
 */
function focusClause(zone: string): string {
  const start = zone.indexOf('<span class="ig-canvas-focus">');
  if (start === -1) return '';
  const end = zone.indexOf('<span class="ig-canvas-shown">', start);
  return zone.slice(start, end === -1 ? undefined : end);
}

/**
 * A backlog of `total` issues where exactly `related` of them carry an edge.
 *
 * The ladder's tier is chosen from the RELATED count, never the backlog's, so a
 * fixture that wants a refusing tier has to grow the edges rather than the
 * issues — which is the same asymmetry §17f is about.
 */
function backlogWithRelated(total: number, related: number): ViewerDocument {
  const keys = keysOf(total);
  const edges: (readonly ['blocked-by', string, string])[] = [];
  for (let index = 1; index < related; index += 1) {
    const from = keys[index];
    const to = keys[index - 1];
    if (from === undefined || to === undefined) continue;
    edges.push(['blocked-by', from, to]);
  }
  return backlogOf(total, { edges });
}

/** 312 issues, six of them in one chain — frame 17a's own numbers. */
const FRAME = backlogWithRelated(312, 6);

describe('§17f’s caption says what the canvas is drawing', () => {
  /**
   * AE1. The frame reads `focus: #512 · 1 hop · 6 of 312 shown`; the hop clause
   * is deliberately absent (see `CanvasWords`), and everything else is here.
   */
  it('names the focused issue and the ratio, in the host’s words', () => {
    const zone = canvasZone(
      renderWorkspace(FRAME, {
        words: WORKSPACE_WORDS,
        scale: { ...INITIAL_SCALE_STATE, focus: 'i0002' },
      }).markup,
    );

    assert.match(zone, /class="ig-canvas-toolbar"/, 'no toolbar row');
    assert.match(zone, /class="ig-canvas-focus"/, 'no focus clause');
    assert.ok(CANVAS !== undefined);
    assert.ok(zone.includes(CANVAS.focus), 'the host’s focus word is not drawn');
    assert.ok(zone.includes(CANVAS.of), 'the host’s `of` word is not drawn');
    assert.ok(zone.includes(CANVAS.shown), 'the host’s trailing word is not drawn');

    // THE COUNTS, AND WHOSE THEY ARE. Six is the component the ladder narrowed
    // to; 312 is the whole normalized document, not the narrowed canvas — a
    // caption reading `6 of 6` would be true of the wrong document.
    const caption = /<p class="ig-canvas-caption">([\s\S]*?)<\/p>/.exec(zone)?.[1] ?? '';
    assert.match(caption, /<span class="ig-canvas-count">6<\/span>/, 'the drawn count is not 6');
    assert.match(caption, /<span class="ig-canvas-count">312<\/span>/, 'the total is not 312');
  });

  /**
   * AE5 and R4 together. The key is the ladder's, verbatim, inside layer 1's own
   * identity chip — and the sentence is assembled from spans, so no host word
   * arrives with a number substituted into it.
   */
  it('prints the ladder’s key through layer 1’s chip, and interpolates nothing', () => {
    const zone = canvasZone(
      renderWorkspace(FRAME, {
        words: WORKSPACE_WORDS,
        scale: { ...INITIAL_SCALE_STATE, focus: 'i0002' },
      }).markup,
    );

    assert.match(
      focusClause(zone),
      /<span class="ig-id">i0002<\/span>/,
      'the key is not layer 1’s chip',
    );

    // Every host word stands alone in its own element. A word that arrived with
    // a count inside it would mean this package had grown a template language,
    // which is the failure `CanvasWords` is shaped to prevent.
    assert.ok(CANVAS !== undefined);
    for (const word of [CANVAS.focus, CANVAS.of, CANVAS.shown]) {
      assert.ok(
        zone.includes(`<span>${word}</span>`),
        `\`${word}\` is not drawn as a word on its own`,
      );
    }
  });

  /**
   * THE PUNCTUATION IS THE PACKAGE'S, AND THE CONTRACT SAYS SO. `CanvasWords`
   * tells a host to omit the colon because this package draws it. An earlier
   * revision made that promise and emitted only a space, so a host that obeyed
   * the contract got `focus #512`.
   */
  it('draws the colon its own contract tells the host to omit', () => {
    const zone = canvasZone(
      renderWorkspace(FRAME, {
        words: WORKSPACE_WORDS,
        scale: { ...INITIAL_SCALE_STATE, focus: 'i0002' },
      }).markup,
    );

    assert.ok(CANVAS !== undefined);
    assert.ok(
      focusClause(zone).includes(`<span>${CANVAS.focus}</span>: `),
      'the label is not followed by the colon the interface promises',
    );
  });

  /**
   * THE CAPTION TAKES NO FOCUS, and a url is the state where it nearly did.
   * `identity()` renders an ANCHOR when the host supplied one, and an anchor
   * here sits inside a region the mount replaces wholesale on every redraw —
   * `focusedKey()` and `commandFocusToken()` both read null for it, so the
   * restore falls through to the first rail row and `WorkspaceHandle.update`'s
   * promise to keep focus is broken by a read-out.
   */
  it('draws the key as text even when the host supplied a url', () => {
    const linked: ViewerDocument = {
      ...FRAME,
      issues: FRAME.issues.map((issue) =>
        issue.key === 'i0002' ? { ...issue, url: 'https://example.invalid/i0002' } : issue,
      ),
    };
    const zone = canvasZone(
      renderWorkspace(linked, {
        words: WORKSPACE_WORDS,
        scale: { ...INITIAL_SCALE_STATE, focus: 'i0002' },
      }).markup,
    );

    const clause = focusClause(zone);
    assert.match(clause, /<span class="ig-id">i0002<\/span>/, 'the key is not drawn at all');
    assert.equal(/<a[\s>]/.test(clause), false, 'the caption drew a focusable link');
    assert.equal(clause.includes('example.invalid'), false, 'the caption drew the url');
  });

  /**
   * AE2. An unfocused canvas draws every component, which the counts already
   * say — so the label with nothing after it would be the only untrue part.
   */
  it('draws no focus clause when the ladder resolved no focus', () => {
    const zone = canvasZone(renderWorkspace(FRAME, { words: WORKSPACE_WORDS }).markup);

    assert.match(zone, /class="ig-canvas-toolbar"/, 'the row went missing with the focus');
    assert.equal(/class="ig-canvas-focus"/.test(zone), false, 'a focus clause with no focus');
    assert.ok(CANVAS !== undefined);
    assert.equal(zone.includes(CANVAS.focus), false, 'the focus label is drawn with no key');
    assert.match(zone, /<span class="ig-canvas-count">312<\/span>/, 'the total is not the whole backlog');
  });
});

describe('§17f’s caption is scoped to the tier that actually draws', () => {
  /**
   * AE3, AND IT IS THE FINDING THAT SHAPED THIS FUNCTION. Above the node budget
   * `renderScaleLadder` draws NO graph — the canvas is null and the refusal
   * takes its place — so a caption saying `n of m drawn here` would state a
   * thing the surface does not do. The refusal already carries the count.
   */
  it('states no ratio on a tier whose canvas is a refusal', () => {
    const declining = backlogWithRelated(312, 80);
    const zone = canvasZone(renderWorkspace(declining, { words: WORKSPACE_WORDS }).markup);

    assert.match(zone, /class="ig-refusal"/, 'the fixture did not reach a refusing tier');
    assert.equal(
      /class="ig-canvas-caption"/.test(zone),
      false,
      'the caption claims nodes are drawn on a tier that draws none',
    );
  });

  /**
   * AE6. The pill is a property of the surface, not of the tier, so a refusing
   * canvas keeps it — and the row survives to carry it.
   */
  it('keeps the edit-mode pill on a refusing tier, where the caption is gone', () => {
    const declining = backlogWithRelated(312, 80);
    const zone = canvasZone(renderWorkspace(declining, { words: WORKSPACE_WORDS }).markup);

    assert.ok(CANVAS?.editMode !== undefined);
    assert.match(zone, /class="ig-canvas-toolbar"/, 'the row went with the caption');
    assert.ok(zone.includes(`<span class="ig-edit-mode">${CANVAS.editMode}</span>`));
  });
});

describe('§17f’s row is drawn from what the host said, and nothing else', () => {
  /**
   * AE6's other half. The pill names a state; a `button` would be the dead
   * control `headerControls` refuses to draw, and `aria-hidden` would take the
   * host's own word back off the surface.
   */
  it('draws the pill as announced text, never as a control', () => {
    const zone = canvasZone(renderWorkspace(FRAME, { words: WORKSPACE_WORDS }).markup);
    const pill = /<span class="ig-edit-mode"[^>]*>([\s\S]*?)<\/span>/.exec(zone);

    assert.ok(pill !== null, 'no edit-mode pill');
    assert.ok(CANVAS?.editMode !== undefined);
    assert.equal(pill[1], CANVAS.editMode, 'the pill is not the host’s word');
    assert.equal(/<button[^>]*class="ig-edit-mode"/.test(zone), false, 'the pill is a button');
    assert.equal(
      /class="ig-edit-mode"[^>]*aria-hidden/.test(zone),
      false,
      'the pill is hidden from the reader it is for',
    );
  });

  /**
   * THE TWO HALVES ARE INDEPENDENT. `renderWorkspace` returns markup, and markup
   * can be served without `mountWorkspace` — nothing on such a surface is
   * editable, so a host that did not mount must be able to caption the canvas
   * without also claiming it can be edited.
   */
  it('draws the caption without the pill when the host worded no edit mode', () => {
    assert.ok(CANVAS !== undefined);
    const { editMode: _editMode, ...withoutPill } = CANVAS;
    const zone = canvasZone(
      renderWorkspace(FRAME, { words: { ...WORKSPACE_WORDS, canvas: withoutPill } }).markup,
    );

    assert.match(zone, /class="ig-canvas-caption"/, 'the caption went with the pill');
    assert.equal(/class="ig-edit-mode"/.test(zone), false, 'a pill the host never worded');
  });

  /**
   * AE4 and R5. Absence draws nothing rather than drawing a default, so every
   * host built against the current version renders exactly as it did.
   */
  it('draws no row at all when the host worded none, and changes nothing else', () => {
    const { canvas: _canvas, ...wordsWithoutCanvas } = WORKSPACE_WORDS;
    const without = canvasZone(renderWorkspace(FRAME, { words: wordsWithoutCanvas }).markup);

    assert.equal(/class="ig-canvas-toolbar"/.test(without), false, 'a row nobody worded');
    assert.equal(/class="ig-edit-mode"/.test(without), false, 'a pill nobody worded');

    // AND THE ZONE STILL LEADS WITH THE LADDER, which is the claim a host built
    // against the current version relies on: not merely that the row is absent,
    // but that nothing was inserted ahead of the canvas it already had.
    assert.ok(
      without.startsWith('<section class="ig-zone" data-zone="canvas"><section class="ig-viewer'),
      'something other than the ladder now leads the zone',
    );
  });

  /** The row leads the zone, above the graph, exactly as frame 17a draws it. */
  it('is the canvas zone’s first child', () => {
    const zone = canvasZone(renderWorkspace(FRAME, { words: WORKSPACE_WORDS }).markup);
    assert.ok(
      zone.startsWith('<section class="ig-zone" data-zone="canvas"><div class="ig-canvas-toolbar">'),
      'the row does not lead the zone',
    );
  });

  /**
   * THE KEY IS THE LADDER'S, NOT THE SELECTION'S. They are different questions —
   * the canvas is narrowed to a component, the inspector is filtered to a
   * selection — and a row reading the wrong one would name an issue the canvas
   * is not centred on.
   */
  it('names the ladder’s focus even when another issue is selected', () => {
    const zone = canvasZone(
      renderWorkspace(FRAME, {
        words: WORKSPACE_WORDS,
        scale: { ...INITIAL_SCALE_STATE, focus: 'i0002' },
        selection: { kind: 'issue', keys: ['i0005'] },
      }).markup,
    );

    const clause = focusClause(zone);
    assert.match(clause, /<span class="ig-id">i0002<\/span>/);
    assert.equal(clause.includes('i0005'), false, 'the row followed the selection');
  });
});
