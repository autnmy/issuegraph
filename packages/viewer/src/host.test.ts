import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeDocument } from './document.ts';
import { renderMarkup } from './element.ts';
import { mountViewer } from './mount.ts';
import { COMMAND_ATTRIBUTE } from './parts.ts';
import { linearScene } from './projections/linear.ts';
import { renderViewer } from './render.ts';
import { GROUP_ATTRIBUTE, KEY_ATTRIBUTE, type Projection } from './scene.ts';
import { TestDocument } from './testing/document.ts';
import { fixtureDocument, hostedFixtureDocument } from './testing/fixtures.ts';

const PROJECTIONS: readonly Projection[] = ['linear', 'graph', 'tree'];
const HOST_CLASSES = ['ig-header', 'ig-summary', 'ig-freshness', 'ig-now', 'ig-caveat', 'ig-refresh'];

describe('the host-facts port', () => {
  it('renders exactly what shipped before the port when the host states nothing', () => {
    // Done-when 2, pinned: a document with no `host` and no per-issue fact is
    // byte-identical to one with an empty host, and carries none of the new
    // classes — so a host that has no runner sees the pure-graph view.
    for (const projection of PROJECTIONS) {
      const bare = renderViewer(fixtureDocument, { projection }).markup;
      assert.equal(renderViewer({ ...fixtureDocument, host: {} }, { projection }).markup, bare, projection);
      assert.equal(renderViewer({ ...fixtureDocument, host: { running: [] } }, { projection }).markup, bare, projection);
      for (const cls of HOST_CLASSES) {
        assert.equal(bare.includes(cls), false, `${projection} draws ${cls} with no host facts`);
      }
    }
  });

  it('prints the summary line from the host numbers, in the design order', () => {
    const markup = renderViewer(hostedFixtureDocument).markup;
    assert.match(markup, /<p class="ig-summary">2 ranked · 2 ready now · cap 2 · 2 held<\/p>/);
    const capOnly = renderViewer({ ...fixtureDocument, host: { concurrencyCap: 3 } }).markup;
    assert.match(capOnly, /<p class="ig-summary">cap 3<\/p>/);
    assert.equal(capOnly.includes('ranked'), false);
    // The line is a whole-order fact, so every projection carries it.
    for (const projection of PROJECTIONS) {
      assert.match(renderViewer(hostedFixtureDocument, { projection }).markup, /class="ig-header"/, projection);
    }
  });

  it('prints the freshness stamp verbatim and marks it stale only when the host says so', () => {
    const fresh = renderViewer(hostedFixtureDocument).markup;
    assert.match(fresh, /<p class="ig-freshness" data-stale="false">as of <span class="ig-id">14:32<\/span> · 2m ago<button class="ig-refresh" type="button" data-ig-command="refresh">refresh<\/button><\/p>/);
    const stale = renderViewer({
      ...fixtureDocument,
      host: { freshness: { asOf: '09:04', age: '5h ago', stale: true } },
    }).markup;
    assert.match(stale, /<p class="ig-freshness" data-stale="true">as of <span class="ig-id">09:04<\/span> · 5h ago · stale<\/p>/);
    assert.equal(stale.includes('ig-refresh'), false, 'a refresh control was drawn with no label to draw it from');
  });

  it('draws a NOW row per running job above the order, on a pointer identity only', () => {
    const markup = renderViewer(hostedFixtureDocument).markup;
    const now = markup.indexOf('<ol class="ig-now"');
    const order = markup.indexOf('<ol class="ig-list" aria-label="work order"');
    assert.notEqual(now, -1);
    assert.ok(now < order, 'the NOW list is not above the order');
    assert.match(markup, /<li class="ig-now-row" data-ig-group="110" aria-label="Tidy the changelog — Review · 12m">/);
    assert.match(markup, /<span class="ig-now-mark" aria-hidden="true">now<\/span><span class="ig-title">Tidy the changelog<\/span>/);
    assert.match(markup, /<span class="ig-now-phase">· Review · 12m<\/span>/);
    // ONE ELEMENT PER KEY CARRIES THE FOCUS ATTRIBUTE. 110 also holds no slot
    // here, but a running issue that did would otherwise be indexed twice.
    const focusRows = markup.match(/data-ig-key="110"/g) ?? [];
    assert.equal(focusRows.length, 0, 'the NOW row entered the focus index');
    // The graph draws it above the stage, never inside the positioned rail.
    const graph = renderViewer(hostedFixtureDocument, { projection: 'graph' }).markup;
    assert.ok(graph.indexOf('<ol class="ig-now"') < graph.indexOf('class="ig-stage"'), 'the NOW list is not above the stage');
    assert.equal(/ig-rail[^>]*>(?:(?!<\/ol>).)*ig-now-row/s.test(graph), false, 'a NOW row landed inside the rail');
  });

  it('keeps the NOW row out of the focus order and the navigable set', () => {
    const scene = linearScene(normalizeDocument(hostedFixtureDocument).document);
    assert.equal(scene.focusOrder.includes('110'), false);
    assert.equal(scene.navigable.includes('110'), false);
  });

  it('draws each caveat as one row child, striking only the losing value', () => {
    const markup = renderViewer(hostedFixtureDocument).markup;
    assert.match(
      markup,
      /<p class="ig-caveat" data-caveat="preview-only"><span class="ig-badge" data-caveat="preview-only"><span class="ig-glyph" aria-hidden="true">◐<\/span><span>preview-only<\/span><\/span> query 5 \(involves:@me\) can(?:&#39;|')t be evaluated locally yet — ranked by the unlabeled tail instead<\/p>/,
    );
    // The disagreement sits on 110, which the fixture places in no slot, so it
    // is the tree — every issue its own item — that draws it.
    const tree = renderViewer(hostedFixtureDocument, { projection: 'tree' }).markup;
    assert.match(
      tree,
      /<p class="ig-caveat" data-caveat="disagree"><span class="ig-badge" data-caveat="disagree"><span class="ig-glyph" aria-hidden="true">◆<\/span><span>signals disagree<\/span><\/span> ranked by label:P3 \(your mapping\) · frontmatter declares <s class="ig-strike">priority: 1<\/s><\/p>/,
    );
    // The graph rail has no room for a block, so the caveat rides the label.
    const graph = renderViewer(hostedFixtureDocument, { projection: 'graph' }).markup;
    assert.match(graph, /data-ig-key="103"[^>]*aria-label="[^"]*preview-only: query 5/);
    assert.match(graph, /data-ig-key="103"[^>]*title="preview-only: query 5/);
    // AND A NODE THE RAIL DOES NOT LABEL carries it too: a footer (tracker-held)
    // issue has no rail row, so its canvas node is the only mark the graph draws
    // for it — the caveat rides that node's name beside the hold reason.
    const footerCaveat = {
      ...hostedFixtureDocument,
      issues: hostedFixtureDocument.issues.map((issue) =>
        issue.key === '105' ? { ...issue, previewOnly: { note: 'query 2 fell back' } } : issue,
      ),
    };
    const canvas = renderViewer(footerCaveat, { projection: 'graph' }).markup;
    const node = canvas.match(/<g class="ig-node-group" data-ig-key="105"[^>]*>/)?.[0] ?? '';
    assert.match(node, /aria-label="[^"]*claimed by another run · preview-only: query 2 fell back/);
    assert.equal(canvas.includes('data-ig-key="105"') && canvas.indexOf('data-ig-key="105"') === canvas.lastIndexOf('data-ig-key="105"'), true, 'the footer issue was railed after all');
  });

  it('labels a tracker hold with the runner word and names the words in the footer title', () => {
    const markup = renderViewer(hostedFixtureDocument).markup;
    assert.match(markup, /<p class="ig-hold" data-family="tracker"><span class="ig-badge" data-hold="claimed">claimed<\/span> claimed by another run<\/p>/);
    assert.match(markup, /Held outside the order — claimed, parked, or never worked · claimed</);
    assert.match(renderViewer(fixtureDocument).markup, /Held outside the order — claimed, parked, or never worked</);
  });

  it('selects the running issue on a NOW row click and leaves the refresh control alone', () => {
    const doc = new TestDocument();
    const container = doc.createContainer();
    const selected: (string | null)[] = [];
    const hovered: (string | null)[] = [];
    const handle = mountViewer(container, hostedFixtureDocument, {
      onSelect: (key: string | null) => selected.push(key),
      onHover: (key: string | null) => hovered.push(key),
    });
    const now = container.find(GROUP_ATTRIBUTE, '110');
    assert.ok(now !== undefined, 'no NOW row was drawn');
    assert.equal(now.getAttribute(KEY_ATTRIBUTE), null);
    container.dispatch('pointerover', { target: now });
    container.dispatch('click', { target: now });
    assert.deepEqual(hovered, ['110']);
    assert.deepEqual(selected, ['110']);
    assert.equal(handle.state.selected, '110');

    // A BUTTON OWNS ITS OWN ACTIVATION: the click is the host's to hear through
    // the command attribute, and it neither selects nor clears anything.
    const refresh = container.find(COMMAND_ATTRIBUTE, 'refresh');
    assert.ok(refresh !== undefined, 'no refresh control was drawn');
    container.dispatch('click', { target: refresh });
    assert.deepEqual(selected, ['110']);
    assert.equal(handle.state.selected, '110');
  });

  it('leaves the keyboard tab stop where it was when a NOW-only issue is selected', () => {
    // 110 runs but holds no slot, so the NOW row is its only mark and it is in
    // no navigable order. Adopting it as the tab stop made `reconcile` fall to
    // the FIRST navigable key: focus jumped to an unrelated row at the top.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, hostedFixtureDocument, {});
    const third = container.find(KEY_ATTRIBUTE, '103');
    assert.ok(third !== undefined);
    container.dispatch('click', { target: third });
    assert.equal(handle.state.focused, '103');

    const now = container.find(GROUP_ATTRIBUTE, '110');
    assert.ok(now !== undefined);
    container.dispatch('click', { target: now });
    assert.equal(handle.state.selected, '110');
    assert.equal(handle.state.focused, '103', 'selecting the NOW row moved the tab stop');
    // AND NO DOM FOCUS MOVES AT ALL: the redraw rebuilt every row, and neither
    // the first row nor the row the reader was on is focused by a click on a
    // mark that could take no focus itself.
    assert.equal(container.find(KEY_ATTRIBUTE, '102')?.focusCount ?? 0, 0, 'focus landed on the first row');
    assert.equal(container.find(KEY_ATTRIBUTE, '103')?.focusCount ?? 0, 0, 'focus was moved by a NOW-row click');
  });

  it('does not focus the default row when the very first click is a NOW-only issue', () => {
    // `reconcile` seeds the logical tab stop with the first row before any
    // element has DOM focus; a first click on the NOW row must not turn that
    // seed into a real focus move.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, hostedFixtureDocument, {});
    const now = container.find(GROUP_ATTRIBUTE, '110');
    assert.ok(now !== undefined);
    container.dispatch('click', { target: now });
    assert.equal(handle.state.selected, '110');
    for (const row of container.descendants()) {
      assert.equal(row.focusCount, 0, `${row.getAttribute(KEY_ATTRIBUTE) ?? row.tag} took focus`);
    }
  });

  it('serialises the hosted scene the same way from the pure and the mounted paths', () => {
    // The mount builds from the same specs `renderViewer` serialises, so the
    // new parts cannot draw one way in tests and another in a browser.
    const scene = linearScene(normalizeDocument(hostedFixtureDocument).document);
    assert.equal(renderMarkup(scene.root), renderViewer(hostedFixtureDocument).markup);
  });
});
