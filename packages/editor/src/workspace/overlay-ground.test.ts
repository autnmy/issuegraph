/**
 * An overlay over the graph stands on the card's own ground (#340).
 *
 * `--ig-surface` is also the ground of a filled control and a selected tab, and
 * a host may map it to a translucent fill, so an overlay painted with it showed
 * the graph through it. These pin that both overlays take `--ig-bg`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { workspaceStylesheet } from './styles.ts';

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const start = workspaceStylesheet.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `no rule for ${selector}`);
  return workspaceStylesheet.slice(start, workspaceStylesheet.indexOf('}', start));
}

describe('overlay grounds (#340)', () => {
  it('paints the audit overlay on the card ground', () => {
    const body = ruleBody('.ig-workspace > .ig-audit-overlay');
    assert.match(body, /background:\s*var\(--ig-bg\)/);
    assert.doesNotMatch(body, /var\(--ig-surface\)/);
  });

  it('paints the open work-order panel on the card ground', () => {
    const body = ruleBody(".ig-workspace[data-inspector='lifted'][data-order-panel='open'] .ig-zone[data-zone='rail']");
    assert.match(body, /background:\s*var\(--ig-bg\)/);
    assert.doesNotMatch(body, /var\(--ig-surface\)/);
  });
});
