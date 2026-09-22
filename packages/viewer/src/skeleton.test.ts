import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderViewerSkeleton } from './skeleton.ts';
import { viewerStylesheet } from './styles.ts';

describe('the loading placeholder', () => {
  it('is a busy region, named only by the host', () => {
    const bare = renderViewerSkeleton().markup;
    assert.match(bare, /aria-busy="true"/);
    assert.match(bare, /data-ig-loading="true"/);
    assert.equal(/role="status"/.test(bare), false, 'a status region with no name');
    assert.equal(/aria-label=/.test(bare), false, 'the package wrote a word of its own');

    const named = renderViewerSkeleton({ label: 'Loading your issues' }).markup;
    assert.match(named, /role="status"/);
    assert.match(named, /aria-label="Loading your issues"/);
  });

  it('draws rows on the order row geometry, so nothing moves when the data lands', () => {
    // `.ig-slot` IS THE POINT. The placeholder row takes the real row's grid,
    // padding and density rules, so it is exactly as tall as the row that
    // replaces it at every width the container picks.
    const markup = renderViewerSkeleton({ rows: 5 }).markup;
    assert.equal(markup.match(/class="ig-slot ig-skeleton-row"/g)?.length, 5);
    assert.match(markup, /aria-hidden="true"/, 'the shapes are read out as content');
  });

  it('draws spine cards for the graph, with no header of its own', () => {
    const markup = renderViewerSkeleton({ projection: 'graph', rows: 2 }).markup;
    assert.equal(markup.match(/class="ig-skeleton-card"/g)?.length, 2);
    assert.equal(/class="ig-header"/.test(markup), false);
  });

  it('declines the frame the way the viewer does, for a composing container', () => {
    assert.match(renderViewerSkeleton({ frame: false }).markup, /data-frame="none"/);
    assert.equal(/data-frame=/.test(renderViewerSkeleton().markup), false);
  });

  it('ships no motion — the pulse is the host’s to add', () => {
    // Option C's split: the package owns the SHAPE, the host owns the LOOK. A
    // pulse in here would be a look every host inherits and has to fight.
    const css = viewerStylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/\banimation\b|@keyframes|\btransition\b/.test(css), false);
    assert.match(css, /\.ig-skeleton-block \{/, 'the host hook is not styled');
  });
});
