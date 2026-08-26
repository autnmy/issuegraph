import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';

import { renderMarkup } from './element.ts';
import { type ViewerHandle, mountViewer } from './mount.ts';
import { renderViewer } from './render.ts';
import { GROUP_ATTRIBUTE, KEY_ATTRIBUTE, type Projection } from './scene.ts';
import { TestDocument, TestElement, TestNode } from './testing/document.ts';
import { fixtureDocument, heldTogetherDocument } from './testing/fixtures.ts';

function mounted(options = {}) {
  const doc = new TestDocument();
  const container = doc.createContainer();
  const handle = mountViewer(container, fixtureDocument, options);
  return { container, handle };
}

/** Serialize a built tree the way `renderMarkup` would, to compare the two walks. */
function reserialize(node: TestElement | TestNode): string {
  if (node instanceof TestNode) {
    return node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const attrs = [...node.attributes]
    .map(
      ([name, value]) =>
        ` ${name}="${value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')}"`,
    )
    .join('');
  if (node.children.length === 0) {
    const voidTags = new Set(['br', 'hr', 'img', 'input']);
    return node.namespace !== null || voidTags.has(node.tag)
      ? `<${node.tag}${attrs} />`
      : `<${node.tag}${attrs}></${node.tag}>`;
  }
  return `<${node.tag}${attrs}>${node.children.map(reserialize).join('')}</${node.tag}>`;
}

describe('mountViewer', () => {
  it('builds the same tree renderViewer describes', () => {
    const { container } = mounted();
    const root = container.children[0];

    assert.ok(root instanceof TestElement);
    assert.equal(reserialize(root), renderViewer(fixtureDocument).markup);
  });

  it('appends exactly one element to the container', () => {
    assert.equal(mounted().container.children.length, 1);
  });

  it('calls onSelect once with the key of the element clicked', () => {
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });
    const target = container.find(KEY_ATTRIBUTE, '101');

    assert.ok(target !== undefined);
    container.dispatch('click', { target });
    assert.deepEqual(selected, ['101']);
  });

  it('resolves the key by walking up from a nested target', () => {
    // Delegation without `closest`: the walk is the same one a real DOM would
    // do, and it keeps the shell testable on a document double.
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });
    const row = container.find(KEY_ATTRIBUTE, '102');
    const nested = row?.descendants().find((element) => element.tag === 'span');

    assert.ok(nested !== undefined);
    container.dispatch('click', { target: nested });
    assert.deepEqual(selected, ['102']);
  });

  it('resolves the enclosure to its slot and the connector to its edge', () => {
    // The enclosure and its connector are deliberately OUTSIDE the focus index
    // — one element per key, or `focus()` lands on the non-tabbable rect
    // painted behind the node. They are still visible marks a reader can click,
    // and the design states the connector IS a click target, so they keep
    // POINTER identity through a separate attribute.
    //
    // THEY DECORATE DIFFERENT SUBJECTS, which is why they no longer answer
    // alike. The enclosure is the unit, so it names the slot's lead. The
    // connector is the line joining two members, so it names the EDGE — the
    // same identity `@issuegraph/store` derives `StoredEdge.id` with, so a host
    // resolves it with `findEdge` rather than being taught a second format.
    // Answering with the lead made every connector in a unit indistinguishable
    // from the enclosure and from each other.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const selected: (string | null)[] = [];
    mountViewer(container, heldTogetherDocument, {
      projection: 'graph',
      onSelect: (key: string | null) => selected.push(key),
    });

    const enclosure = container
      .descendants()
      .find((element) => element.getAttribute('class') === 'ig-enclosure');
    const connector = container
      .descendants()
      .find((element) => element.getAttribute('class') === 'ig-connector');

    assert.ok(enclosure !== undefined, 'no enclosure was drawn');
    assert.ok(connector !== undefined, 'no connector was drawn');
    assert.equal(enclosure.getAttribute(KEY_ATTRIBUTE), null, 'decoration is in the focus index');

    container.dispatch('click', { target: enclosure });
    container.dispatch('click', { target: connector });
    assert.deepEqual(selected, ['1', edgeIdentity('together-with', '1', '2')]);
  });

  it('leaves focus where it was when a connector is selected', () => {
    // THE GUARD THAT REPLACES THE OLD FLAT INVARIANT, and it has to exist for
    // the graph projection to be allowed to publish a pointer identity that
    // `navigable` does not hold. `navigable` lists issues; an edge identity is
    // absent from it by construction, and `navigate` resolves a key it cannot
    // find to -1 and throws the reader back to the top of the order — the exact
    // failure `onKeyDown` already narrows to `KEY_ATTRIBUTE` to avoid.
    //
    // So selecting a connector must move the SUBJECT without moving the TAB
    // STOP. Written against the handle's own reported focus rather than against
    // a `focus()` spy, because what must not change is the state a later arrow
    // key navigates from.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, heldTogetherDocument, { projection: 'graph' });

    // FOCUS IS MOVED OFF THE FIRST ENTRY FIRST, and that is the whole
    // difference between this test and a vacuous one. `reconcile` resolves a
    // focus key it cannot find to `navigable[0]` — so with focus already
    // sitting there, the broken behaviour and the correct one produce the SAME
    // reported state and the assertion cannot see the defect. Measured: the
    // first draft of this test passed with the narrowing reverted.
    const elsewhere = container
      .descendants()
      .find((element) => {
        const key = element.getAttribute(KEY_ATTRIBUTE);
        return key !== null && key !== '' && key !== handle.state.focused;
      });
    assert.ok(elsewhere !== undefined, 'only one key is drawn, so this proves nothing');
    container.dispatch('click', { target: elsewhere });
    const away = handle.state.focused;
    assert.notEqual(away, null, 'focus did not move, so the guard is untested');

    const connector = container
      .descendants()
      .find((element) => element.getAttribute('class') === 'ig-connector');
    assert.ok(connector !== undefined, 'no connector was drawn');

    container.dispatch('click', { target: connector });

    assert.equal(handle.state.selected, edgeIdentity('together-with', '1', '2'));
    assert.equal(handle.state.focused, away, 'selecting an edge moved the keyboard tab stop');
  });

  it('restores a connector selection passed in at mount', () => {
    // THE FIRST DRAW HAS NO PRIOR SCENE, so `pointable` is empty and the
    // pre-scene check had no evidence about a decoration identity — it cleared
    // one before the graph was ever materialized. Every LATER redraw preserved
    // it, so a host could hold a connector selection for as long as it stayed
    // mounted and could never restore one across a remount, which is exactly
    // the case a host restoring saved state hits.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const edge = edgeIdentity('together-with', '1', '2');
    const handle = mountViewer(container, heldTogetherDocument, {
      projection: 'graph',
      selected: edge,
    });

    assert.equal(handle.state.selected, edge);
  });

  it('still clears a selection passed in at mount that nothing draws', () => {
    // THE OTHER HALF, and without it the fix above is indistinguishable from
    // simply not checking. Deferring the decoration question to after
    // materialize must not become "accept anything a host passes": an identity
    // no scene drew is a selection of nothing and has to be cleared, and the
    // host has to be TOLD rather than left holding it.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const selected: (string | null)[] = [];
    const handle = mountViewer(container, heldTogetherDocument, {
      projection: 'graph',
      selected: edgeIdentity('together-with', '404', '405'),
      onSelect: (key: string | null) => selected.push(key),
    });

    assert.equal(handle.state.selected, null);
    assert.deepEqual(selected, [null], 'the host was not told the selection was refused');
  });

  it('keeps a connector selection across a redraw, and drops it when one stops drawing it', () => {
    // A decoration identity is absent from `byKey` by construction, so the
    // document-membership drop in `draw()` deselected it on the very next
    // redraw — a selection that could not survive the frame after it was made.
    // The question a redraw must actually ask is whether THIS scene still drew
    // the mark, which is the same question the hover clear asks and is answered
    // from the same set.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const selected: (string | null)[] = [];
    const handle = mountViewer(container, heldTogetherDocument, {
      projection: 'graph',
      onSelect: (key: string | null) => selected.push(key),
    });

    const connector = container
      .descendants()
      .find((element) => element.getAttribute('class') === 'ig-connector');
    assert.ok(connector !== undefined, 'no connector was drawn');
    container.dispatch('click', { target: connector });

    const edge = edgeIdentity('together-with', '1', '2');
    assert.equal(handle.state.selected, edge);

    // An unrelated redraw: the same document again. The mark is still drawn, so
    // the subject survives and the host is told nothing new.
    const announced = selected.length;
    handle.update(heldTogetherDocument);
    assert.equal(handle.state.selected, edge, 'a redraw that still draws the connector dropped it');
    assert.equal(selected.length, announced, 'an unchanged selection was re-announced');

    // The linear projection draws no canvas, so the connector is gone. The
    // subject goes with it, and the host is TOLD rather than left holding a key
    // for a mark that is no longer on screen.
    handle.setProjection('linear');
    assert.equal(handle.state.selected, null, 'a projection that draws no connector kept the selection');
    assert.equal(selected.at(-1), null, 'the host was not told the selection ended');
  });

  it("resolves a pointer on a unit's partner to the unit's own station", () => {
    // A together unit is ONE station with one focus key, so the partner's node
    // must answer a pointer with the LEAD. It used to answer with itself:
    // clicking `104` emitted `104`, selected `104`, and threw focus to `102` —
    // not even the unit clicked, because neither the selection nor the
    // requested key is in the order and focus fell back to its first entry.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const selected: (string | null)[] = [];
    const handle = mountViewer(container, fixtureDocument, {
      projection: 'graph',
      onSelect: (key: string | null) => selected.push(key),
    });

    const partner = container
      .descendants()
      .find(
        (element) =>
          element.getAttribute('class') === 'ig-node-group' &&
          element.getAttribute(GROUP_ATTRIBUTE) === '103',
      );

    assert.ok(partner !== undefined, "the unit's partner drew no node");
    assert.equal(partner.getAttribute(KEY_ATTRIBUTE), null, 'the partner is in the focus index');

    container.dispatch('click', { target: partner });
    assert.deepEqual(selected, ['103']);
    // BOTH, because the defect was the disagreement between them rather than
    // either value on its own.
    assert.equal(handle.state.selected, '103');
    assert.equal(handle.state.focused, '103');
  });

  it('never holds a selection the active projection cannot reach — every entry point', () => {
    // THE INVARIANT, NOT THE CASE. Three rounds found this same class through
    // three different doors — a pointer, `handle.select`, a projection switch —
    // each time because the guard named the door. What is actually true is that
    // `state.selected` is either null or a key the ACTIVE projection publishes
    // in `navigable`; anything else is a subject focus cannot follow, and
    // `resolveFocusKey` then falls to the first entry, an unrelated issue.
    // `104` is the probe: a together unit's partner, absent from the linear and
    // graph orders, and its own row in the tree.
    const doors = [
      {
        name: 'handle.select',
        ends: null,
        run: (handle: ViewerHandle): void => handle.select('104'),
      },
      {
        name: 'a pointer on whatever draws 104',
        ends: null,
        run: (_handle: ViewerHandle, container: TestElement): void => {
          const target = container
            .descendants()
            .find(
              (element) =>
                element.getAttribute(KEY_ATTRIBUTE) === '104' ||
                element.getAttribute(GROUP_ATTRIBUTE) === '104',
            );
          if (target !== undefined) container.dispatch('click', { target });
        },
      },
      {
        // The one that CHANGES the active projection mid-test, which is why the
        // invariant is checked against where the handle ended rather than where
        // it started.
        name: 'select, then switch to graph',
        ends: 'graph',
        run: (handle: ViewerHandle): void => {
          handle.select('104');
          handle.setProjection('graph');
        },
      },
    ] as const;

    for (const start of ['linear', 'graph', 'tree'] as const) {
      for (const door of doors) {
        const doc = new TestDocument();
        const container = doc.createContainer();
        const reported: (string | null)[] = [];
        const handle = mountViewer(container, fixtureDocument, {
          projection: start,
          onSelect: (key: string | null) => reported.push(key),
        });

        door.run(handle, container);

        const ended: Projection = door.ends ?? start;
        const live = renderViewer(fixtureDocument, { projection: ended }).scene;
        const where = `${start} / ${door.name}`;
        const selected = handle.state.selected;

        if (selected !== null) {
          assert.ok(
            live.navigable.includes(selected),
            `${where}: selected ${selected}, which ${ended} cannot reach`,
          );
          assert.equal(handle.state.focused, selected, `${where}: focus left the selection`);
          // AND THE DOM SAYS THE SAME THING. Checking only `handle.state` is
          // what let a whole round through: the state was canonicalized after
          // the markup had already been built from the un-canonicalized key, so
          // the station's row was never marked and the tab stop sat on the
          // fallback. A viewer whose reported state and rendered DOM disagree is
          // the defect, whichever half happens to be right.
          const marked = new Set(
            container
              .descendants()
              .filter((element) => element.getAttribute('aria-current') === 'true')
              .map((element) => element.getAttribute(KEY_ATTRIBUTE)),
          );
          const tabStops = new Set(
            container
              .descendants()
              .filter((element) => element.getAttribute('tabindex') === '0')
              .map((element) => element.getAttribute(KEY_ATTRIBUTE)),
          );
          assert.deepEqual([...marked], [selected], `${where}: the DOM marks a different selection`);
          assert.deepEqual([...tabStops], [selected], `${where}: the tab stop is not on the selection`);
        }
        // AND THE HOST WAS TOLD THE SAME THING. A handle holding one key while
        // `onSelect` reported another is the same disagreement in a new place.
        if (reported.length > 0) {
          assert.equal(reported[reported.length - 1], selected, `${where}: onSelect disagreed`);
        }
      }
    }
  });

  it('ignores a click that lands on nothing keyed', () => {
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });

    container.dispatch('click', { target: container });
    assert.deepEqual(selected, []);
  });

  it('marks the selected row after a click', () => {
    const { container } = mounted();
    const target = container.find(KEY_ATTRIBUTE, '101');
    assert.ok(target !== undefined);
    container.dispatch('click', { target });

    assert.equal(container.find(KEY_ATTRIBUTE, '101')?.getAttribute('aria-current'), 'true');
  });

  it('honours a selection and a focus the caller mounted with', () => {
    // `MountOptions` carries both because it extends the render options, so a
    // caller restoring a view passes them here. Starting empty discarded them
    // and dropped the reader back to the top of the order.
    const { container, handle } = mounted({ selected: '103', focused: '105' });

    assert.equal(handle.state.selected, '103');
    assert.equal(handle.state.focused, '105');
    assert.equal(container.find(KEY_ATTRIBUTE, '103')?.getAttribute('aria-current'), 'true');
    assert.equal(container.find(KEY_ATTRIBUTE, '105')?.getAttribute('tabindex'), '0');
  });

  it('stops the delegation walk at the container, never climbing into the host', () => {
    const doc = new TestDocument();
    const host = doc.createContainer();
    host.setAttribute(KEY_ATTRIBUTE, 'not-ours');
    const container = doc.createContainer();
    host.appendChild(container);

    const selected: (string | null)[] = [];
    mountViewer(container, fixtureDocument, {
      onSelect: (key: string | null) => selected.push(key),
    });

    container.dispatch('click', { target: container });
    assert.deepEqual(selected, [], 'a host ancestor answered for a click on nothing of ours');
  });

  it('leaves keyboard activation to a nested link', () => {
    // `keydown` bubbles, so the viewer's own Enter handling ran while focus was
    // on a row's deep-link chip, called `preventDefault()` and suppressed the
    // link. A projection that exposes a link a keyboard cannot follow has not
    // exposed it.
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });
    const link = container.descendants().find((element) => element.tag === 'a');
    assert.ok(link !== undefined, 'no deep link was rendered');

    let prevented = 0;
    container.dispatch('keydown', {
      key: 'Enter',
      target: link,
      preventDefault: () => (prevented += 1),
    });

    assert.equal(prevented, 0, 'the viewer suppressed the link');
    assert.deepEqual(selected, [], 'the viewer selected instead of following the link');
  });

  it('still moves focus when the arrow keys arrive on a link', () => {
    // Only ACTIVATION belongs to the control — a reader focused on a link must
    // still be able to arrow away from it.
    const { container, handle } = mounted();
    const link = container.descendants().find((element) => element.tag === 'a');
    assert.ok(link !== undefined);

    container.dispatch('keydown', { key: 'ArrowDown', target: link });
    assert.equal(handle.state.focused, '101');
  });

  it('moves from the row the reader is STANDING in, not the last one it moved to', () => {
    // Native Tab walks the deep-link chips, and the viewer never hears about it:
    // `state.focused` only tracks the viewer's own moves. So tabbing into the
    // a row's link and pressing ArrowDown moved relative to the row focus had
    // been left on rather than the one the reader is in.
    // The fixture's order is 102, 101, 103, 105, 106, and focus is seeded on
    // 102. Tabbing to 101's link and pressing ArrowDown must reach 103; reading
    // the stale 102 lands on 101 — the row already being stood in, so the key
    // press appears to do nothing at all.
    const { container, handle } = mounted();
    const row = container.find(KEY_ATTRIBUTE, '101');
    assert.ok(row !== undefined, 'no row for 101');
    const link = row.descendants().find((element) => element.tag === 'a');
    assert.ok(link !== undefined, 'row 101 rendered no deep link');
    assert.equal(
      handle.state.focused,
      '102',
      'the fixture no longer seeds focus where this test assumes',
    );

    container.dispatch('keydown', { key: 'ArrowDown', target: link });

    assert.equal(handle.state.focused, '103', 'moved from the stale row, not from 101');
  });

  it('does NOT adopt a decoration key, which is outside the focus index', () => {
    // `data-ig-group` marks something a reader can point at but never focus, so
    // adopting one would set `focused` to a key `navigate` cannot resolve — it
    // indexes to -1 and throws the reader back to the top of the order, which is
    // the very bug the sync above fixes, arriving through the fix.
    const { container, handle } = mounted({ projection: 'graph' });
    const decoration = container
      .descendants()
      .find(
        (element) =>
          element.getAttribute(GROUP_ATTRIBUTE) !== null &&
          element.getAttribute(KEY_ATTRIBUTE) === null,
      );
    if (decoration === undefined) return; // this fixture drew no decoration; nothing to assert

    const before = handle.state.focused;
    container.dispatch('keydown', { key: 'ArrowDown', target: decoration });

    assert.notEqual(handle.state.focused, decoration.getAttribute(GROUP_ATTRIBUTE));
    assert.ok(before !== null);
  });

  it('keeps focus on the row it just selected with the keyboard', () => {
    // `draw()` destroys the subtree holding focus and mounts a replacement, and
    // only the movement branch was refocusing it — so pressing Enter dropped
    // focus out of the viewer and no later arrow key reached the container.
    const { container, handle } = mounted();
    const before = container.find(KEY_ATTRIBUTE, '102');
    assert.ok(before !== undefined);

    container.dispatch('keydown', { key: 'Enter', target: before });

    const after = container.find(KEY_ATTRIBUTE, handle.state.selected as string);
    assert.ok(after !== undefined, 'the selected row was not rebuilt');
    assert.equal(after.focusCount, 1, 'the rebuilt row was never focused');
    // And the reader can still move, which is what the lost focus cost them.
    container.dispatch('keydown', { key: 'ArrowDown' });
    assert.notEqual(handle.state.focused, before.getAttribute(KEY_ATTRIBUTE));
  });

  it('clears a hover the redraw removed, and tells the host', () => {
    // `pointerleave` does not fire when the hovered element is destroyed under a
    // stationary pointer, so the host was left holding a key for an issue the
    // document no longer carries.
    const hovered: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '103');
    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });
    assert.deepEqual(hovered, ['103']);

    handle.update({
      issues: fixtureDocument.issues.filter((issue) => issue.key !== '103'),
      edges: fixtureDocument.edges.filter(
        (edge) => edge.from !== '103' && edge.to !== '103',
      ),
      order: { slots: [], excluded: [] },
    });

    assert.deepEqual(hovered, ['103', null], 'the host was never told the hover ended');
  });

  it('does NOT clear a hover the redraw kept', () => {
    // The clear must key on the DOCUMENT, not on the focus index: decoration
    // hovers are absent from `keyed` on every redraw and are perfectly live.
    const hovered: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '103');
    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });

    handle.update(fixtureDocument);

    assert.deepEqual(hovered, ['103'], 'a live hover was cleared by an unrelated redraw');
  });

  it('focuses the element that can actually take focus, not its canvas twin', () => {
    // A RAILED LEAD IS EMITTED TWICE with `data-ig-key`: the canvas `<g>`, which
    // carries no `tabindex` because the rail row owns the tab stop, and then the
    // row itself. The focus index kept the FIRST it met and the canvas comes
    // first, so every `focus()` for a ranked row landed on an element a browser
    // ignores — arrow navigation moved nothing and post-selection focus dropped
    // out of the viewer entirely.
    // ASSERTED THROUGH `refusedFocusCount`, which is what makes this checkable:
    // the test double used to count every call, so the old assertions passed on
    // exactly the element that does nothing.
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, { projection: 'graph' });

    // Move to a railed lead, then select one, exercising both focus call sites.
    container.dispatch('keydown', { key: 'ArrowDown', target: container });
    handle.select('103');

    const refused = container
      .descendants()
      .filter((element): element is TestElement => element instanceof TestElement)
      .reduce((total, element) => total + element.refusedFocusCount, 0);
    assert.equal(refused, 0, 'focus was called on an element a browser would ignore');
    assert.ok(handle.state.focused !== null, 'nothing ended up focused');
  });

  it('resolves a key this document does not carry to no selection at all', () => {
    // `select()` is documented to fire `onSelect` exactly as a click does, and a
    // click can only land on a key the canvas drew — so an unknown key has no
    // click to be equivalent to. A host holding a stale key from its own list is
    // the ordinary way one arrives.
    // Before this, the state took the key, `draw()` reconciled it away and
    // reported null, and then the selection reported the key: the host was told
    // TWICE, ending on a key that does not exist, while the handle read null.
    const selected: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      onSelect: (key: string | null) => selected.push(key),
    });

    handle.select('no-such-issue');

    assert.equal(handle.state.selected, null);
    assert.deepEqual(selected, [null], 'the host was told twice, or told the wrong key');

    // And a real key still selects, so the guard is a resolution and not a veto.
    handle.select('101');
    assert.equal(handle.state.selected, '101');
    assert.deepEqual(selected, [null, '101']);
  });

  it('drops a selection the updated document no longer carries, and says so', () => {
    // `reconcile` carries the selection through whole, which is right for a
    // PROJECTION switch and wrong for a document REPLACEMENT: the subject can
    // genuinely be gone, and the handle went on reporting a key this document
    // does not carry, against `update`'s own promise that a STILL-PRESENT
    // selection survives.
    const selected: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      onSelect: (key: string | null) => selected.push(key),
    });
    handle.select('101');
    assert.equal(handle.state.selected, '101');

    handle.update({
      ...fixtureDocument,
      issues: fixtureDocument.issues.filter((issue) => issue.key !== '101'),
      edges: fixtureDocument.edges.filter((edge) => edge.from !== '101' && edge.to !== '101'),
      order: {
        ...fixtureDocument.order,
        slots: fixtureDocument.order.slots.filter((slot) => slot.lead !== '101'),
      },
    });

    assert.equal(handle.state.selected, null, 'the handle still reports a removed issue');
    assert.deepEqual(selected, ['101', null], 'the host was never told the selection ended');
  });

  it('keeps a still-present selection across a projection switch', () => {
    // The other half of the same rule, and the reason the test is document
    // membership rather than "is it drawn": a switch changes representation, not
    // subject, so a selection the new projection does not draw must survive.
    const selected: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      projection: 'linear',
      onSelect: (key: string | null) => selected.push(key),
    });
    handle.select('101');

    handle.setProjection('graph');

    assert.equal(handle.state.selected, '101', 'a projection switch dropped the subject');
    assert.deepEqual(selected, ['101'], 'a projection switch told the host the selection ended');
  });

  it('does not select a row when the click belongs to its deep link', () => {
    // Returning from the keydown handler does NOT suppress the click the browser
    // synthesizes afterwards, so following a link also selected its row and told
    // the host about a selection the anchor owned.
    const selected: (string | null)[] = [];
    const { container } = mounted({ onSelect: (key: string | null) => selected.push(key) });
    const link = container.descendants().find((element) => element.tag === 'a');
    assert.ok(link !== undefined, 'no deep link was rendered');

    container.dispatch('click', { target: link });

    assert.deepEqual(selected, [], 'following a link also selected its row');
  });

  it('clears a hover the new projection does not draw', () => {
    // An off-order edge endpoint is drawn on the graph canvas and has no row in
    // the linear projection, so a switch destroys the element while its issue
    // stays in `byKey` — the document test preserved the hover, and the host was
    // never told it ended until the pointer left the whole viewer.
    const hovered: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      projection: 'graph',
      onHover: (key: string | null) => hovered.push(key),
    });
    // `107` is an edge endpoint the graph draws and the linear projection does not.
    const target = container.find(KEY_ATTRIBUTE, '107');
    assert.ok(target !== undefined, 'the fixture no longer has a graph-only node');
    container.dispatch('pointerover', { target });
    assert.deepEqual(hovered, ['107']);

    handle.setProjection('linear');

    assert.deepEqual(hovered, ['107', null], 'the host still holds a hover on a destroyed node');
  });

  it('keeps a hover the new scene still draws', () => {
    // The other half, and the reason the test is the DRAWN set rather than
    // `keyed`: decoration never enters the focus index, so a narrower test would
    // clear a live hover on every redraw.
    const hovered: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      projection: 'graph',
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '101');
    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });

    handle.setProjection('linear');

    assert.deepEqual(hovered, ['101'], 'a hover both projections draw was cleared');
  });

  it('clears an active hover on destroy, so the host is not left holding a dead key', () => {
    // Teardown removes the listeners and then the root, so no `pointerleave` can
    // fire — and destruction bypasses `draw()` entirely, so the redraw
    // reconciliation never sees this path. The host was left with a tooltip
    // pinned to an element that no longer exists.
    const hovered: (string | null)[] = [];
    const doc = new TestDocument();
    const container = doc.createContainer();
    const handle = mountViewer(container, fixtureDocument, {
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '103');
    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });
    assert.deepEqual(hovered, ['103']);

    handle.destroy();

    assert.deepEqual(hovered, ['103', null], 'the host was never told the hover ended');
  });

  it('reports a hover, and reports null when the pointer leaves', () => {
    const hovered: (string | null)[] = [];
    const { container } = mounted({ onHover: (key: string | null) => hovered.push(key) });
    const target = container.find(KEY_ATTRIBUTE, '103');

    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });
    container.dispatch('pointerleave', {});
    assert.deepEqual(hovered, ['103', null]);
  });

  it('does not repeat a hover for the same key', () => {
    const hovered: (string | null)[] = [];
    const { container } = mounted({ onHover: (key: string | null) => hovered.push(key) });
    const target = container.find(KEY_ATTRIBUTE, '103');

    assert.ok(target !== undefined);
    container.dispatch('pointerover', { target });
    container.dispatch('pointerover', { target });
    assert.deepEqual(hovered, ['103']);
  });

  it('moves focus on an arrow key and calls focus on the new element', () => {
    const { container, handle } = mounted();
    container.dispatch('keydown', { key: 'ArrowDown' });

    assert.equal(handle.state.focused, '101');
    assert.equal(container.find(KEY_ATTRIBUTE, '101')?.focusCount, 1);
  });

  it('selects on Enter and tells the host', () => {
    const selected: (string | null)[] = [];
    const { container, handle } = mounted({ onSelect: (key: string | null) => selected.push(key) });

    container.dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(selected, ['102']);
    assert.equal(handle.state.selected, '102');
  });

  it('prevents the default only for a key it handled', () => {
    const { container } = mounted();
    let prevented = 0;
    const event = { key: 'ArrowDown', preventDefault: () => (prevented += 1) };
    container.dispatch('keydown', event);
    container.dispatch('keydown', { key: 'g', preventDefault: () => (prevented += 1) });

    assert.equal(prevented, 1);
  });

  it('selects programmatically exactly as a click does', () => {
    const selected: (string | null)[] = [];
    const { container, handle } = mounted({ onSelect: (key: string | null) => selected.push(key) });

    handle.select('105');
    assert.deepEqual(selected, ['105']);
    assert.equal(container.find(KEY_ATTRIBUTE, '105')?.getAttribute('aria-current'), 'true');
  });

  it('keeps a still-present selection across an update', () => {
    const { container, handle } = mounted();
    handle.select('103');
    handle.update(fixtureDocument);

    assert.equal(handle.state.selected, '103');
    assert.equal(container.find(KEY_ATTRIBUTE, '103')?.getAttribute('aria-current'), 'true');
    assert.equal(container.children.length, 1, 'update left the previous tree behind');
  });

  it('keeps the subject across a projection change', () => {
    const { container, handle } = mounted();
    handle.select('103');
    handle.setProjection('tree');

    assert.equal(handle.state.selected, '103');
    const root = container.children[0];
    assert.ok(root instanceof TestElement);
    assert.equal(root.getAttribute('data-projection'), 'tree');
  });

  it('removes every listener and empties the container on destroy', () => {
    const selected: (string | null)[] = [];
    const hovered: (string | null)[] = [];
    const { container, handle } = mounted({
      onSelect: (key: string | null) => selected.push(key),
      onHover: (key: string | null) => hovered.push(key),
    });
    const target = container.find(KEY_ATTRIBUTE, '101');
    assert.ok(target !== undefined);

    handle.destroy();

    assert.equal(container.children.length, 0);
    container.dispatch('click', { target });
    container.dispatch('pointerover', { target });
    container.dispatch('keydown', { key: 'ArrowDown' });
    assert.deepEqual(selected, []);
    assert.deepEqual(hovered, []);
    for (const handlers of container.listeners.values()) assert.deepEqual(handlers, []);
  });

  it('is inert after destroy', () => {
    const { container, handle } = mounted();
    handle.destroy();
    handle.update(fixtureDocument);
    handle.setProjection('graph');
    handle.select('101');

    assert.equal(container.children.length, 0);
  });

  it('mounts a graph without a DOM, which is where the SVG path is exercised', () => {
    const doc = new TestDocument();
    const container = doc.createContainer();
    mountViewer(container, fixtureDocument, { projection: 'graph' });
    const root = container.children[0];

    assert.ok(root instanceof TestElement);
    assert.equal(reserialize(root), renderMarkup(renderViewer(fixtureDocument, { projection: 'graph' }).scene.root));
  });
});
