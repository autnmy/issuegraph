import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffOrder } from '@issuegraph/store';
import type { ViewerDocument } from '@issuegraph/viewer';

import { renderWorkspace } from './render.ts';
import type { WorkspaceWords } from './render.ts';
import { WORDS as CHANGE_WORDS, editOf, orderOf, railOf } from '../testing/reevaluate.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';

/**
 * §17c in the mounted workspace: cause in the header, effect on the row.
 *
 * The rails here come from `testing/reevaluate.ts` rather than
 * `testing/workspace.ts`, for the reason that file states: these tests ask
 * WHERE A CHIP LANDS, so they need arbitrary keys that line up with an order's
 * refs, which the workspace builder's generated keys cannot give them.
 */

const WORDS: WorkspaceWords = { ...WORKSPACE_WORDS, change: CHANGE_WORDS };

/**
 * Every value `deltaKind` can return: a readiness, then a movement's direction,
 * then a presence.
 *
 * Spelled out rather than derived, and it is the one list here that is allowed
 * to be — it exists to CATCH a rule keyed on something outside it, so deriving
 * it from the same place the rules come from would make it agree by
 * construction and prove nothing.
 */
const DELTA_KINDS: ReadonlySet<string> = new Set([
  'promoted',
  'newly-held',
  'up',
  'down',
  'entered',
  'left',
]);

/** `a` and `b` swap; `c` and `d` do not move. */
const SWAPPED = diffOrder(
  orderOf(['a', 'b', 'c', 'd']),
  orderOf(['b', 'a', 'c', 'd']),
  editOf(),
);

function railZone(markup: string): string {
  const zone = /<section class="ig-zone" data-zone="rail">([\s\S]*?)<section class="ig-zone" data-zone="canvas">/.exec(
    markup,
  );
  assert.ok(zone !== null, 'no rail zone');
  return zone[1] ?? '';
}

function headerZone(markup: string): string {
  const zone = /<section class="ig-zone" data-zone="header">([\s\S]*?)<section class="ig-zone" data-zone="rail">/.exec(
    markup,
  );
  assert.ok(zone !== null, 'no header zone');
  return zone[1] ?? '';
}

/**
 * One rail row's markup, verbatim — INCLUDING any chip placed on it.
 *
 * A row's own children are spans and divs, and the placed chip is a `span`
 * appended among them, so the first `</li>` after the opening tag still closes
 * the row and now correctly encloses the chip. That is the whole point of the
 * change: the chip is part of the row, so a reader of one reads the other.
 */
function row(markup: string, key: string): string {
  const found = new RegExp(`<li class="ig-slot" data-ig-key="${key}"[\\s\\S]*?</li>`).exec(markup);
  assert.ok(found !== null, `no row for ${key}`);
  return found[0];
}

describe('§17c draws the effect on the row, not beside it', () => {
  it('puts a placed chip inside the rows that moved, and nowhere else', () => {
    const result = renderWorkspace(railOf(['b', 'a', 'c', 'd']), {
      words: WORDS,
      change: SWAPPED,
    });
    const rail = railZone(result.markup);

    for (const key of ['a', 'b']) {
      assert.match(row(rail, key), /<span class="ig-delta-chip" data-placed="true">/, key);
    }
    for (const key of ['c', 'd']) {
      assert.equal(/ig-delta-chip/.test(row(rail, key)), false, key);
    }
  });

  it('drops the key span on a placed chip, because the row already names it', () => {
    // `reevaluate/render.ts` names its row in text precisely BECAUSE it is
    // unpositioned. On the row that reasoning inverts: the key would be the one
    // span on the chip saying nothing the reader cannot already see.
    const rail = railZone(
      renderWorkspace(railOf(['b', 'a', 'c']), { words: WORDS, change: SWAPPED }).markup,
    );
    assert.equal(/ig-delta-key/.test(rail), false);
    // The words are still there, so the assertion above is not passing over a
    // chip that rendered nothing at all.
    assert.match(rail, /<span class="ig-change-word">up<\/span>/);
    assert.match(rail, /<span class="ig-change-word">down<\/span>/);
  });

  it('tints a moved row by KIND, and leaves an unmoved row with no attribute', () => {
    const rail = railZone(
      renderWorkspace(railOf(['b', 'a', 'c', 'd']), { words: WORDS, change: SWAPPED }).markup,
    );
    assert.match(row(rail, 'a'), /data-ig-delta="down"/);
    assert.match(row(rail, 'b'), /data-ig-delta="up"/);
    for (const key of ['c', 'd']) {
      assert.equal(/data-ig-delta/.test(row(rail, key)), false, key);
    }
  });

  it('tints with background-color, so a held row keeps layer 1\'s hatch', () => {
    // `newly-held` is the delta that co-occurs with data-held='true' BY
    // DEFINITION, so this overlap is the common case rather than a corner. The
    // background shorthand resets background-image, and layer 1 draws the held
    // row's hatch as a repeating-linear-gradient on exactly that property —
    // and these rules are both more specific and loaded later, so the shorthand
    // silently took the held channel off every newly-held row.
    //
    // EVERY DELTA RULE IS CHECKED, including the VALUED selectors. The first
    // version of this test split the sheet on the bare `[data-ig-delta]`
    // string, which does not occur in `[data-ig-delta='down']` at all — so it
    // examined two rules, missed the three that carry the tints, and stayed
    // green with the shorthand restored.
    const { styles } = renderWorkspace(railOf(['a', 'b']), { words: WORDS, change: SWAPPED });
    const rules = styles
      .split('}')
      .map((chunk) => chunk.split('{'))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .filter(([selector]) => selector.includes('data-ig-delta'));

    assert.equal(rules.length, 4, `expected the four delta rules, got ${rules.length}`);
    const tints = rules.filter(([, block]) => block.includes('color-mix'));
    assert.equal(tints.length, 3, 'expected three tint rules');
    for (const [selector, block] of tints) {
      assert.equal(
        /(^|[\s;])background\s*:/.test(block),
        false,
        `the background shorthand would clear the hatch on ${selector.trim()}`,
      );
    }
  });

  it('says the delta in the row\'s NAME, or a screen reader never hears it', () => {
    // An accessible name computed from `aria-label` wins over descendant text,
    // and layer 1 gives every row one — so a chip appended into the row is seen
    // and not heard. The rail is the surface a reader arrows through, and the
    // summary carries aggregate counts that cannot recover which row moved.
    const rail = railZone(
      renderWorkspace(railOf(['b', 'a', 'c']), { words: WORDS, change: SWAPPED }).markup,
    );
    const nameOf = (key: string): string =>
      /aria-label="([^"]*)"/.exec(row(rail, key))?.[1] ?? '';

    assert.match(nameOf('b'), / — 1 up$/);
    assert.match(nameOf('a'), / — 1 down$/);
    // Layer 1's own name is kept whole in front of it, not replaced.
    assert.match(nameOf('b'), /^Issue b/);
    // And an unmoved row's name is untouched.
    assert.equal(/ — 1 /.test(nameOf('c')), false);
  });

  it('leaves an unaffected row byte-identical across the edit', () => {
    // The design's rule — "unaffected rows are left completely alone" — asserted
    // over the WORKSPACE now that the workspace is what appends to a row.
    const before = renderWorkspace(railOf(['a', 'b', 'c', 'd']), { words: WORDS });
    const after = renderWorkspace(railOf(['b', 'a', 'c', 'd']), {
      words: WORDS,
      change: SWAPPED,
    });
    for (const key of ['c', 'd']) {
      assert.equal(row(railZone(after.markup), key), row(railZone(before.markup), key), key);
    }
    assert.notEqual(row(railZone(after.markup), 'a'), row(railZone(before.markup), 'a'));
  });
});

describe('a delta can land on either row shape, and every value it emits is styled', () => {
  /** The same rail with `c` taken out of the order and excluded — a footer row. */
  const withAnExclusion = (): ViewerDocument => {
    const base = railOf(['a', 'b', 'c']);
    return {
      ...base,
      order: {
        slots: base.order.slots.filter((slot) => slot.lead !== 'c'),
        excluded: [{ key: 'c', reason: 'duplicate-of', canonical: 'a' }],
      },
    };
  };

  const LEFT_THE_ORDER = diffOrder(orderOf(['a', 'b', 'c']), orderOf(['a', 'b']), editOf());

  it('marks an EXCLUDED row, which is a footer row and not a slot', () => {
    // An edit that turns an issue into a duplicate takes it out of the order
    // while the projection keeps it, so its chip lands on an `.ig-footer-row`.
    // A rule naming `.ig-slot` only gave that row its chip and its extended
    // name and no ground at all.
    const { markup } = renderWorkspace(withAnExclusion(), {
      words: WORDS,
      change: LEFT_THE_ORDER,
    });
    const footer = /<li class="ig-footer-row"[^>]*>/.exec(markup)?.[0] ?? '';
    assert.match(footer, /data-ig-delta="left"/);
  });

  it('pushes a footer chip to the trailing edge, which the grid column cannot do', () => {
    // A ranked row reaches the edge by the third grid column. A footer row is
    // layer 1's flex box, so a chip appended to it just follows the content it
    // came after — the auto inline margin is the flex idiom, and it is the
    // right tool here for the same reason it was the wrong one on the grid.
    const { styles } = renderWorkspace(withAnExclusion(), {
      words: WORDS,
      change: LEFT_THE_ORDER,
    });
    const rule = /\.ig-footer-row > \.ig-delta-chip\[data-placed\]\s*\{([^}]*)\}/.exec(styles);
    assert.ok(rule !== null, 'no trailing-edge rule for a chip on a footer row');
    assert.match(rule[1] ?? '', /margin-inline-start:\s*auto/);
  });

  it('styles every value the markup actually emits, and keys no rule on one it cannot', () => {
    // `absent` was keyed here once and is not a value any code path produces —
    // `RankDelta.presence` is 'entered' | 'left' — so the rule matched nothing
    // while reading as the neutral case, and a row that LEFT took the ready
    // tint from the bare fallback instead. Both directions are checked, so
    // neither a missing rule nor a dead one can come back.
    const renders = [
      renderWorkspace(railOf(['b', 'a', 'c', 'd']), { words: WORDS, change: SWAPPED }),
      renderWorkspace(withAnExclusion(), { words: WORDS, change: LEFT_THE_ORDER }),
    ];
    const emitted = new Set(
      renders.flatMap((result) => [...result.markup.matchAll(/data-ig-delta="([^"]+)"/g)].map((m) => m[1] ?? '')),
    );
    assert.ok(emitted.size >= 3, `too few delta kinds to prove anything: ${[...emitted].join(',')}`);

    const styles = renders[0]?.styles ?? '';
    const keyed = new Set(
      [...styles.matchAll(/\[data-ig-delta='([^']+)'\]/g)].map((m) => m[1] ?? ''),
    );
    assert.deepEqual(
      [...emitted].filter((kind) => !keyed.has(kind)).sort(),
      [],
      'a delta kind reaches the markup with no rule to tint it',
    );
    assert.deepEqual(
      [...keyed].filter((kind) => !DELTA_KINDS.has(kind)).sort(),
      [],
      'a rule is keyed on a value deltaKind cannot produce',
    );

    // AND THE ROW SHAPE, not only the value. A rule set naming every kind but
    // only `.ig-slot` still leaves the excluded row untinted, and the value
    // check above passes over that completely — which it did, until this.
    const shapes = new Set(
      renders.flatMap((result) =>
        [...result.markup.matchAll(/class="(ig-[a-z-]+)"[^>]*data-ig-delta=/g)].map((m) => m[1] ?? ''),
      ),
    );
    assert.ok(shapes.has('ig-slot') && shapes.has('ig-footer-row'), `shapes: ${[...shapes].join(',')}`);
    for (const shape of shapes) {
      assert.ok(
        new RegExp(`\\.${shape}\\[data-ig-delta`).test(styles),
        `${shape} carries a delta and no rule tints that shape`,
      );
    }
  });
});

describe('§17c puts the cause in the header, where it cannot scroll away', () => {
  it('draws the summary and its dismiss control in the header zone', () => {
    const result = renderWorkspace(railOf(['b', 'a', 'c']), { words: WORDS, change: SWAPPED });
    const header = headerZone(result.markup);
    assert.match(header, /class="ig-change-summary"/);
    assert.match(header, /data-ig-command="dismiss-change"/);
    // The rail zone is the scroller. A summary in there is one that survives a
    // dismiss but not a scroll, which is not what "persists" means.
    assert.equal(/ig-change-summary/.test(railZone(result.markup)), false);
  });

  it('draws the unchanged finding in the summary\'s own place', () => {
    const same = orderOf(['a', 'b']);
    const result = renderWorkspace(railOf(['a', 'b']), {
      words: WORDS,
      change: diffOrder(same, same, editOf()),
    });
    assert.match(headerZone(result.markup), /this edit changed nothing/);
  });
});

describe('the package invents no English, so no words means no loop', () => {
  it('draws neither summary nor chip when the host supplied no change words', () => {
    // `ChangeWords` refuses a default vocabulary because the store ships counts
    // so a host writes the sentence itself. A default here would take that
    // choice back one layer down, so absence draws nothing at all.
    const result = renderWorkspace(railOf(['b', 'a', 'c']), {
      words: WORKSPACE_WORDS,
      change: SWAPPED,
    });
    assert.equal(/ig-change-summary/.test(result.markup), false);
    assert.equal(/ig-delta-chip/.test(result.markup), false);
    assert.equal(/data-ig-delta/.test(result.markup), false);
  });

  it('renders identically to a workspace given no change at all', () => {
    const wordless = renderWorkspace(railOf(['b', 'a', 'c']), {
      words: WORKSPACE_WORDS,
      change: SWAPPED,
    });
    const changeless = renderWorkspace(railOf(['b', 'a', 'c']), { words: WORKSPACE_WORDS });
    assert.equal(wordless.markup, changeless.markup);
  });
});

describe('a write in flight labels the order and never re-ranks it', () => {
  it('publishes the held status on the root, for the stylesheet to grey', () => {
    const result = renderWorkspace(railOf(['a', 'b', 'c']), {
      words: WORDS,
      orderStatus: 'held',
    });
    assert.match(result.markup, /^<div class="ig-workspace" data-order="held">/);
  });

  it('draws the SAME ranks held as settled — optimistic rendering, never optimistic re-ordering', () => {
    // §122's non-negotiable. A pending write may show as pending; it may not
    // move a rank. Asserted by the ranks being byte-identical across the two
    // statuses over one document, while the status itself demonstrably differs.
    const document: ViewerDocument = railOf(['a', 'b', 'c']);
    const settled = renderWorkspace(document, { words: WORDS, orderStatus: 'settled' });
    const held = renderWorkspace(document, { words: WORDS, orderStatus: 'held' });

    const ranksOf = (markup: string): string[] =>
      [...markup.matchAll(/data-ig-key="([^"]+)"/g)].map((match) => match[1] ?? '');
    assert.deepEqual(ranksOf(railZone(held.markup)), ranksOf(railZone(settled.markup)));
    assert.notEqual(held.markup, settled.markup);
  });
});

describe('a held order is LABELLED, not merely greyed', () => {
  it('draws the computing word beside the greyed rail', () => {
    // "A stale-but-labelled order beats a half-computed one." Greying without
    // the label is the half that communicates nothing.
    const result = renderWorkspace(railOf(['a', 'b', 'c']), {
      words: WORDS,
      orderStatus: 'held',
    });
    assert.match(headerZone(result.markup), /class="ig-order-computing">write landed, order computing</);
  });

  it('draws it even with no summary, which is the state a write in flight leaves', () => {
    // The store clears `lastChange` before it sets the order to held, so this
    // label is the ONLY thing drawn exactly when the rail is greyest.
    const result = renderWorkspace(railOf(['a', 'b', 'c']), {
      words: WORDS,
      orderStatus: 'held',
      change: null,
    });
    assert.match(headerZone(result.markup), /ig-order-computing/);
  });

  it('greys nothing for a wordless host, rather than dimming with no explanation', () => {
    // The backwards-compatible path. `mountWorkspace` passes the store's status
    // whatever the host supplied, so without this the 0.12 host that omits
    // `words.change` gets the greying with the label suppressed — the exact
    // defect the label exists to prevent, on the one path the optional
    // vocabulary exists to keep working.
    const result = renderWorkspace(railOf(['a', 'b']), {
      words: WORKSPACE_WORDS,
      orderStatus: 'held',
    });
    assert.match(result.markup, /^<div class="ig-workspace">/);
    assert.equal(/data-order/.test(result.markup), false);
  });

  it('draws no label once the order settles', () => {
    const result = renderWorkspace(railOf(['a', 'b', 'c']), { words: WORDS, change: SWAPPED });
    assert.equal(/ig-order-computing/.test(result.markup), false);
  });

  it('greys the RAIL only, so the canvas keeps the hues its write states need', () => {
    // #164 put pending, failed and conflict on the canvas partly in hue. What
    // is stale while a write is in flight is the ORDER, so greying the canvas
    // would strip the colour channel off the very marks saying an edit is in
    // flight — the opposite of what the held state means.
    const { styles } = renderWorkspace(railOf(['a', 'b']), { words: WORDS, orderStatus: 'held' });
    assert.match(
      styles,
      /\.ig-workspace\[data-order='held'\] \.ig-zone\[data-zone='rail'\] \.ig-viewer/,
    );
    assert.equal(/\.ig-workspace\[data-order='held'\] \.ig-viewer/.test(styles), false);
  });
});

describe('a placement diagnostic means the projection disagrees, and nothing else', () => {
  it('reports a change naming a ref no row of the order carries', () => {
    const orphan = diffOrder(
      orderOf(['a', 'b', 'ghost']),
      orderOf(['ghost', 'a', 'b']),
      editOf(),
    );
    const result = renderWorkspace(railOf(['a', 'b']), { words: WORDS, change: orphan });
    assert.ok(
      result.diagnostics.some((line) => line.includes('ghost')),
      `expected a diagnostic naming ghost, got ${JSON.stringify(result.diagnostics)}`,
    );
  });

  it('stays silent about a changed row the WINDOW merely did not draw', () => {
    // The ordinary case: the rail windows, so a changed row off-window has
    // nowhere to attach and that is a fact about the window, not the change.
    // Reporting it would train a host to ignore the diagnostics that matter.
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const result = renderWorkspace(railOf(keys), {
      words: WORDS,
      rail: { start: 0, count: 2 },
      change: diffOrder(orderOf(keys), orderOf(['e', 'a', 'b', 'c', 'd']), editOf()),
    });
    assert.deepEqual(
      result.diagnostics.filter((line) => line.includes('nowhere to attach')),
      [],
    );
  });
});

describe('a placed chip is decoration, so it changes no tab order', () => {
  it('takes no tab stop and leaves the rail\'s stops exactly as they were', () => {
    // #155 is open on the control surface not seeing a tab-order change, so
    // this is asserted here rather than left to the baseline: an element
    // appended INTO a row is precisely the shape of change that bug hides.
    const before = renderWorkspace(railOf(['a', 'b', 'c', 'd']), { words: WORDS });
    const after = renderWorkspace(railOf(['b', 'a', 'c', 'd']), {
      words: WORDS,
      change: SWAPPED,
    });

    const stops = (markup: string): string[] =>
      [...markup.matchAll(/tabindex="(-?\d+)"/g)].map((match) => match[1] ?? '');
    assert.deepEqual(stops(railZone(after.markup)), stops(railZone(before.markup)));

    // And the chip itself carries neither a stop nor an interactive role.
    const chip = /<span class="ig-delta-chip" data-placed="true">/.exec(railZone(after.markup));
    assert.ok(chip !== null, 'no placed chip to check');
    const opening = chip[0];
    assert.equal(/tabindex/.test(opening), false);
    assert.equal(/role=/.test(opening), false);
  });
});

describe('nothing about the loop expires on its own', () => {
  it('schedules nothing and offers no clear but the command', () => {
    // The store's `dismissChange()` and the next edit are the only clears, and
    // this render holds no "has this been dismissed" of its own — so there is
    // nothing here for a timer to expire.
    const source = renderWorkspace(railOf(['b', 'a']), { words: WORDS, change: SWAPPED }).markup;
    for (const timer of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
      assert.equal(source.includes(timer), false, timer);
    }
  });
});
