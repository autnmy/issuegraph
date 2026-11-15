/**
 * The Inspector zone is a keyboard stop (#331).
 *
 * It scrolls, and with nothing selected it holds no control of its own, so a
 * host that bounds the workspace can make it overflow with nothing inside to
 * focus. These pin that the zone frame itself takes the focus, and that the
 * zones whose rows already carry the roving focus do not gain a second stop.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderWorkspace } from './render.ts';
import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';

/** The opening tag of one zone frame. */
function zoneTag(markup: string, zone: string): string {
  const start = markup.indexOf(`<section class="ig-zone" data-zone="${zone}"`);
  assert.notEqual(start, -1, `no ${zone} zone`);
  return markup.slice(start, markup.indexOf('>', start) + 1);
}

describe('zone frames and the keyboard (#331)', () => {
  const markup = renderWorkspace(backlogOf(6), { words: WORKSPACE_WORDS }).markup;

  it('makes the Inspector zone a tab stop, so a keyboard reader can scroll it', () => {
    assert.match(zoneTag(markup, 'inspector'), /\stabindex="0"/);
  });

  it('adds no stop to the rail or the canvas, whose rows carry the focus', () => {
    assert.doesNotMatch(zoneTag(markup, 'rail'), /tabindex/);
    assert.doesNotMatch(zoneTag(markup, 'canvas'), /tabindex/);
  });
});
