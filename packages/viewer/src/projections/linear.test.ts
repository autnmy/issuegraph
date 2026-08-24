import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeDocument } from '../document.ts';
import { renderMarkup } from '../element.ts';
import { fixtureDocument } from '../testing/fixtures.ts';
import { linearScene } from './linear.ts';

function render(input = fixtureDocument, options = {}): string {
  return renderMarkup(linearScene(normalizeDocument(input).document, options).root);
}

/** The `<li>` markup for one key, so an assertion cannot match a neighbour's. */
function row(markup: string, key: string): string {
  const start = markup.indexOf(`data-ig-key="${key}"`);
  assert.notEqual(start, -1, `no row for ${key}`);
  const open = markup.lastIndexOf('<li', start);
  return markup.slice(open, markup.indexOf('</li>', start) + 5);
}

describe('the linear projection', () => {
  it('renders slots in the order supplied and never re-sorts them', () => {
    const markup = render();
    const positions = ['102', '101', '103'].map((key) => markup.indexOf(`data-ig-key="${key}"`));

    assert.ok(positions.every((position) => position !== -1));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  });

  it('prints a rank for a ranked slot', () => {
    assert.match(row(render(), '102'), /class="ig-rank"[^>]*>1</);
  });

  it('prints an em dash and a dashed station for a graph-held slot, in place', () => {
    // The rule this projection exists for: the hold stays at the rank the work
    // would have taken, so "why isn't my P1 running" is answerable there.
    const markup = render();
    const held = row(markup, '101');

    assert.match(held, /class="ig-rank"[^>]*>—</);
    assert.match(held, /data-fill="dashed"/);
    assert.ok(
      markup.indexOf('data-ig-key="101"') < markup.indexOf('data-ig-key="103"'),
      'the held slot lost its position in the order',
    );
    assert.match(held, /blocked by 102, which is open/);
  });

  it('moves a tracker-held slot to the footer and gives it no rank', () => {
    const markup = render();
    const footerAt = markup.indexOf('ig-footer');
    const trackerHeld = markup.indexOf('data-ig-key="105"');

    assert.notEqual(footerAt, -1);
    assert.ok(trackerHeld > footerAt, 'a tracker-held slot stayed in the ranked list');
    assert.equal(/class="ig-rank"/.test(row(markup, '105')), false);
    assert.match(row(markup, '105'), /claimed by another run/);
  });

  it('renders a duplicate in the footer naming its canonical', () => {
    const markup = render();
    assert.ok(markup.indexOf('data-ig-key="106"') > markup.indexOf('ig-footer'));
    assert.match(row(markup, '106'), /duplicate of 105 — never worked/);
  });

  it('renders a together unit as one row naming both members', () => {
    const markup = render();
    const unit = row(markup, '103');

    assert.match(unit, /Split the invoice writer · Split the invoice reader/);
    assert.equal(markup.includes('data-ig-key="104"'), false, '104 rendered as its own row');
  });

  it('renders a promotion in the spec notation, naming the dependent', () => {
    assert.match(row(render(), '102'), /P3 -&gt; 0.*inherited from 101/s);
  });

  it('renders the other two provenance forms', () => {
    const markup = render();
    assert.match(row(markup, '101'), /matched ordered query 1/);
    assert.match(row(markup, '103'), /priority tier P2/);
  });

  it('links an issue only when the host supplied a URL', () => {
    const markup = render();
    assert.match(row(markup, '102'), /<a class="ig-link" href="https:\/\/example.test\/issues\/102"/);
    assert.equal(/<a /.test(row(markup, '103')), false, 'a link was invented for a URL-less issue');
  });

  it('gives every row an accessible name carrying the title and the key', () => {
    const markup = render();
    for (const key of ['102', '101', '103', '105', '106']) {
      assert.match(row(markup, key), /aria-label="[^"]+"/);
    }
    assert.match(row(markup, '102'), /aria-label="Backfill the ledger — 102 — rank 1"/);
  });

  it('marks the readiness station filled, hollow and dashed as the slot demands', () => {
    const markup = render();
    assert.match(row(markup, '102'), /data-fill="filled"/);
    assert.match(row(markup, '103'), /data-fill="hollow"/);
    assert.match(row(markup, '101'), /data-fill="dashed"/);
  });

  it('renders an empty state rather than an empty container', () => {
    const markup = render({ issues: [], edges: [], order: { slots: [], excluded: [] } });
    assert.match(markup, /class="ig-empty"/);
    assert.match(markup, /Nothing is in the order right now/);
  });

  it('counts isolated issues into one chip instead of rendering them', () => {
    // 110 is in no slot and on no edge: 248 such dots carry no information, so
    // the design collapses them to a count.
    assert.match(render(), /1 issue is in no slot and declare/);
  });

  it('is deterministic — two renders of one document agree byte for byte', () => {
    assert.equal(render(), render());
  });

  it('publishes a focus order that follows the order, not the markup', () => {
    const scene = linearScene(normalizeDocument(fixtureDocument).document);
    assert.deepEqual([...scene.focusOrder], ['102', '101', '103', '105', '106']);
  });

  it('uses plain list semantics so a deep-link chip inside a row stays legal', () => {
    // `role="option"` forbids a focusable descendant, and every row carries a
    // link. Selection is announced with `aria-current`, which any element may
    // carry, rather than with a role that makes the link a violation.
    const markup = render();
    assert.equal(/role="listbox"/.test(markup), false);
    assert.equal(/role="option"/.test(markup), false);
    assert.match(markup, /<a class="ig-link"/);
    assert.match(markup, /aria-current="/);
  });

  it('names a duplicate with the vocabulary label rather than a second spelling', () => {
    assert.match(row(render(), '106'), /duplicate of 105 — never worked/);
  });

  it('marks the selected row and gives the focused row the tab stop', () => {
    const markup = render(fixtureDocument, { selected: '101', focused: '103' });
    assert.match(row(markup, '101'), /aria-current="true"/);
    assert.match(row(markup, '103'), /tabindex="0"/);
    assert.match(row(markup, '102'), /tabindex="-1"/);
  });
});
