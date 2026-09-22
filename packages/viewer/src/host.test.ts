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
// THE HOST'S FACTS, NOT THE PANEL'S CHROME. `ig-header` left this list when the
// §16 fidelity pass gave the header bar the panel's own name and its projection
// toggle: neither is a fact a host states, and the toggle is how a reader moves
// between two projections this package owns. What the pure-graph promise is
// actually about is the FACTS — a host with no runner must not see a count, a
// stamp, a NOW row or a caveat it never supplied — and that is what this list is.
const HOST_CLASSES = ['ig-counts', 'ig-freshness', 'ig-now', 'ig-caveat', 'ig-refresh'];

/** The header's own controls, which a host opts into rather than inherits. */
const CONTROL_CLASSES = ['ig-toggle', 'ig-size'];

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

  it('draws the projection toggle only for a host that says it will switch', () => {
    // A CONTROL NOBODY WIRED IS WORSE THAN NO CONTROL, which is the rule the
    // graph's refusal already states about its own capsules. This package
    // cannot switch its own projection — `g` and the toggle both publish
    // `projection:*` and the HOST re-renders — so drawn by default, every host
    // that had not wired the command displayed two buttons that do nothing.
    for (const projection of PROJECTIONS) {
      const off = renderViewer(hostedFixtureDocument, { projection }).markup;
      for (const cls of CONTROL_CLASSES) {
        assert.equal(off.includes(cls), false, `${projection} drew ${cls} unasked`);
      }
      const on = renderViewer(hostedFixtureDocument, { projection, switchable: true }).markup;
      assert.match(on, /data-ig-command="projection:linear"/, projection);
      assert.match(on, /data-ig-command="projection:graph"/, projection);
      // The current projection is the pressed one, so the pair is a state and
      // not two equal buttons.
      const pressed = [...on.matchAll(/data-ig-command="projection:(\w+)"/g)].filter((match) =>
        on.slice(Math.max(0, match.index - 120), match.index).includes('aria-pressed="true"'),
      );
      assert.equal(pressed.length <= 1, true);
    }
    // The size affordance belongs to the graph, which is the only projection
    // that HAS two sizes.
    const graph = renderViewer(hostedFixtureDocument, { projection: 'graph', switchable: true, compact: true }).markup;
    assert.match(graph, /data-ig-command="expand"/);
    assert.equal(
      renderViewer(hostedFixtureDocument, { projection: 'linear', switchable: true }).markup.includes('ig-size'),
      false,
      'the list drew a size control it has no second size for',
    );
  });

  it('prints the host numbers as the three chips the design draws, cap on the ready one', () => {
    // §16a outlines each tally separately and tints only "how many could run
    // right now, against the cap" — the number an operator acts on. As one
    // muted sentence, which is what shipped, every figure looked equally worth
    // reading and the accent was spent nowhere.
    const markup = renderViewer(hostedFixtureDocument).markup;
    assert.match(markup, /<span class="ig-count-chip" data-count="ranked">2 ranked<\/span>/);
    assert.match(markup, /<span class="ig-count-chip" data-count="ready">2 ready now · 2 at a time<\/span>/);
    assert.match(markup, /<span class="ig-count-chip" data-count="held">2 held<\/span>/);
    const capOnly = renderViewer({ ...fixtureDocument, host: { concurrencyCap: 3 } }).markup;
    assert.match(capOnly, /<span class="ig-count-chip" data-count="ready">3 at a time<\/span>/);
    // THE COUNT CHIP, not the word. A provenance sentence says "ranked in tier"
    // now, so a bare substring search reads the explanation as a tally.
    assert.equal(capOnly.includes('data-count="ranked"'), false);
    // The line is a whole-order fact, so every projection carries it.
    for (const projection of PROJECTIONS) {
      assert.match(renderViewer(hostedFixtureDocument, { projection }).markup, /class="ig-header"/, projection);
    }
  });

  it('prints the freshness stamp verbatim and marks it stale only when the host says so', () => {
    const fresh = renderViewer(hostedFixtureDocument).markup;
    assert.match(fresh, /<p class="ig-freshness" data-stale="false"><span>as of <span class="ig-id">14:32<\/span> · 2m ago<\/span><button class="ig-refresh" type="button" data-ig-command="refresh">refresh<\/button><\/p>/);
    const stale = renderViewer({
      ...fixtureDocument,
      host: { freshness: { asOf: '09:04', age: '5h ago', stale: true } },
    }).markup;
    assert.match(stale, /<p class="ig-freshness" data-stale="true"><span>as of <span class="ig-id">09:04<\/span> · 5h ago · stale<\/span><\/p>/);
    assert.equal(stale.includes('ig-refresh'), false, 'a refresh control was drawn with no label to draw it from');
  });

  it('draws a NOW row per running job above the order, on a pointer identity only', () => {
    const markup = renderViewer(hostedFixtureDocument).markup;
    const now = markup.indexOf('<ol class="ig-now"');
    const order = markup.indexOf('<ol class="ig-list" aria-label="work order"');
    assert.notEqual(now, -1);
    assert.ok(now < order, 'the NOW list is not above the order');
    assert.match(markup, /<li class="ig-now-row" data-ig-group="110" aria-label="Tidy the changelog — Review · 12m">/);
    // §16a's band is a two-line head like every other row: the title, and the
    // identity and phase 2px beneath it. On one line at three different ends of
    // the band — which is what shipped — the row being worked read as LESS
    // structured than the queued rows under it.
    assert.match(markup, /<span class="ig-now-mark" aria-hidden="true">now<\/span><div class="ig-row-head"><span class="ig-title">Tidy the changelog<\/span>/);
    assert.match(markup, /· Review · 12m<\/span><\/div>/);
    assert.match(markup, /<span class="ig-now-phase"><span class="ig-now-pulse" aria-hidden="true"><\/span>working<\/span>/);
    // ONE ELEMENT PER KEY CARRIES THE FOCUS ATTRIBUTE. 110 also holds no slot
    // here, but a running issue that did would otherwise be indexed twice.
    const focusRows = markup.match(/data-ig-key="110"/g) ?? [];
    assert.equal(focusRows.length, 0, 'the NOW row entered the focus index');
    // ON THE GRAPH IT IS A STATION, NOT A BAND. §16b gives the running job the
    // top station on the spine, above rank 1, because "what is running" and
    // "what is next" are one question asked a step apart — and a band above the
    // canvas is off the single line the sequence is supposed to read down.
    const graph = renderViewer(hostedFixtureDocument, { projection: 'graph' }).markup;
    assert.equal(graph.includes('<ol class="ig-now"'), false, 'the graph still draws the NOW band');
    assert.match(graph, /<div class="ig-card" data-column="spine" data-held="false" data-now="true"/);
    assert.match(graph, /<span class="ig-spine-station" data-fill="filled"[^>]*aria-label="working now"/);
  });

  it('keeps the NOW row out of the focus order and the navigable set', () => {
    const scene = linearScene(normalizeDocument(hostedFixtureDocument).document);
    assert.equal(scene.focusOrder.includes('110'), false);
    assert.equal(scene.navigable.includes('110'), false);
  });

  it('draws each caveat as a chip on the badge row and a sentence beneath, striking only the losing value', () => {
    // §16a treats a caveat exactly like a relationship: a chip a scanner sees,
    // and a sentence a reader reads. Inline in the sentence — which is what
    // shipped — the badge row was incomplete and the sentence lumpy, because a
    // chip is a fact ABOUT the row rather than the first two words of one.
    const markup = renderViewer(hostedFixtureDocument).markup;
    assert.match(
      markup,
      /<span class="ig-badge" data-caveat="preview-only"><span class="ig-glyph" aria-hidden="true">◐<\/span><span>estimated<\/span><\/span>/,
    );
    assert.match(
      markup,
      /<p class="ig-caveat" data-caveat="preview-only"><span class="ig-turn" aria-hidden="true">↳<\/span><span>query 5 \(involves:@me\) can(?:&#39;|')t be evaluated locally yet — ranked by the unlabeled tail instead<\/span><\/p>/,
    );
    // The disagreement sits on 110, which the fixture places in no slot, so it
    // is the tree — every issue its own item — that draws it.
    const tree = renderViewer(hostedFixtureDocument, { projection: 'tree' }).markup;
    assert.match(
      tree,
      /<p class="ig-caveat" data-caveat="disagree"><span class="ig-turn" aria-hidden="true">↳<\/span><span>Using label:P3 \(your mapping\) · frontmatter says <s class="ig-strike">priority: 1<\/s><\/span><\/p>/,
    );
    // A GRAPH CARD DRAWS THE CHIP AND CARRIES THE SENTENCE ON ITS NAME. The
    // card grows with its contents now, so the chip fits; the sentence stays on
    // the label and the tooltip, because the list projection prints it and
    // §16b's spine card draws a chip.
    const graph = renderViewer(hostedFixtureDocument, { projection: 'graph' }).markup;
    assert.match(graph, /data-ig-key="103"[^>]*aria-label="[^"]*estimated: query 5/);
    assert.match(graph, /data-ig-key="103"[^>]*title="estimated: query 5/);
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
    const node = canvas.match(/<li class="ig-rail-row" data-ig-key="105"[^>]*>/)?.[0] ?? '';
    assert.match(node, /aria-label="[^"]*claimed by another run · estimated: query 2 fell back/);
    assert.equal(canvas.indexOf('data-ig-key="105"') === canvas.lastIndexOf('data-ig-key="105"'), true, 'the footer issue was drawn twice');
  });

  it('labels a footer entry with the runner word and says why, on screen', () => {
    // A LABEL CHIP, THE NAME, AND THE HOST'S REASON AS A VISIBLE LINE. The
    // reason used to ride only the row's `title`, so the group showed issues a
    // reader could not account for — nothing on screen said one was taken and
    // another waiting on a person.
    const markup = renderViewer(hostedFixtureDocument).markup;
    assert.match(markup, /<span class="ig-badge" data-hold="claimed">claimed<\/span>/);
    assert.match(markup, /<p class="ig-footer-why">[^<]+<\/p>/, 'the reason is not drawn');
    // THE HEADING COVERS BOTH FAMILIES. §16d's table is explicit that a
    // duplicate is a different fact from a hold, so the sentence names both.
    assert.match(markup, /<p class="ig-header-label ig-footer-title">Not in the order<\/p><span class="ig-count-chip" data-count="footer">2 held<\/span>/);
    assert.match(
      markup,
      /<p class="ig-footer-note">Held back, or a copy of another issue\. Pick one to see why\.<\/p>/,
    );
    // THE FLOATING LEGEND OF HOLD LABELS IS GONE: every row carries its own.
    assert.equal(markup.includes('ig-footer-labels'), false);
    const bare = renderViewer(fixtureDocument).markup;
    assert.match(bare, /<p class="ig-header-label ig-footer-title">Not in the order<\/p>/);
    assert.equal(bare.includes('ig-footer-labels'), false);
  });

  it('names a duplicate\u2019s canonical once, in words', () => {
    // The `→ 512` chip and the sentence said the same thing twice, and the
    // arrow read as a relationship of its own.
    const markup = renderViewer(fixtureDocument).markup;
    assert.match(markup, /<p class="ig-footer-why">The original gets worked instead\.<\/p>/);
    assert.equal(/<span class="ig-id">→ /.test(markup), false);
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
