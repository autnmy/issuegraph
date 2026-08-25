/**
 * The demo's rendering — plain DOM, and deliberately a LIST rather than the
 * ordered spine.
 *
 * The spine, its arcs and its layout maths belong to the viewer package, and
 * drawing them here would make this the second implementation of the grammar
 * that package exists to have one of. What the list still shows is everything
 * the port has to be able to express: every edge type, both hold families, the
 * three readiness stations, the three rank-provenance forms and every edge
 * state.
 *
 * EVERY COLOUR AND DIMENSION IS A CSS CUSTOM PROPERTY, set in `styles.css` and
 * never here — and `theme.test.ts` fails the build if a length literal
 * reappears in a rule. That is BYO-Theme demonstrated rather than asserted: a
 * host retheming this page redeclares one block and touches no markup, no
 * script and no rule. The hue is never load-bearing — each edge carries a glyph
 * and a written kind, so the page reads identically in monochrome.
 *
 * Text is written with `textContent`, never `innerHTML`. An issue title is data
 * an adapter supplied, and a page that interpolates it into markup is a page
 * that renders whatever the tracker was told to store.
 */

import type { EdgeKind, ProjectedEdge, Store, StoreSnapshot } from '@issuegraph/store';
import { findEdge } from '@issuegraph/store';

import {
  DEFAULT_CONCURRENCY_CAP,
  type ExplainedRow,
  type Hold,
  type Provenance,
  type Station,
  slotCount,
} from './order.ts';

/** The design's vocabulary: each kind separable by glyph as well as by hue. */
const GLYPH: Readonly<Record<EdgeKind, string>> = {
  'blocked-by': '⊘',
  'serialize-with': '⇄',
  'together-with': '⧉',
  'duplicate-of': '≡',
  'decomposed-from': '⑃',
};

const STATION_MARK: Readonly<Record<Station, string>> = {
  filled: '●',
  hollow: '○',
  dashed: '◌',
};

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, className = 'button'): HTMLButtonElement {
  const node = document.createElement('button');
  node.className = className;
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

/** The rank as the design draws it: `—` for anything holding no rank slot. */
function rankLabel(row: ExplainedRow): string {
  return row.showRank ? String(row.rank + 1) : '—';
}

function provenanceLabel(provenance: Provenance): string {
  switch (provenance.form) {
    case 'declared':
      return `P${provenance.priority} declared`;
    case 'default-tier':
      return `P${provenance.priority} spec default tier`;
    case 'promoted':
      // The spec's own notation, which doubles as the explanation.
      return `P${provenance.declared} → ${provenance.effective} from ${provenance.from}`;
  }
}

function holdChip(hold: Hold): HTMLElement {
  // A NON-BLOCKING REASON IS NOT A HOLD, and drawing it as one says the row is
  // stuck when it is ready. §6.7's unresolved symmetric reference is surfaced
  // for grooming and excludes nothing, so it is drawn as a note.
  const blocking = hold.blocking !== false;
  const chip = el('span', `hold hold-${hold.family}${blocking ? '' : ' hold-note'}`);
  chip.append(el('span', 'hold-label', hold.label));
  chip.append(el('span', 'hold-detail', hold.detail));
  chip.title = blocking
    ? `${hold.family}-derived hold: ${hold.detail}`
    : `surfaced for grooming, and blocking nothing: ${hold.detail}`;
  return chip;
}

function stationLabel(row: ExplainedRow): string {
  if (row.station === 'filled') return 'ready now';
  if (row.station === 'hollow') return `ready after rank ${(row.readyAfterRank ?? 0) + 1}`;
  return 'held';
}

function renderRow(row: ExplainedRow): HTMLElement {
  const node = el('li', `row row-${row.station}`);

  const station = el('span', 'station', STATION_MARK[row.station]);
  station.title = stationLabel(row);
  node.append(station);

  node.append(el('span', 'rank', rankLabel(row)));

  const body = el('div', 'row-body');
  const heading = el('div', 'row-heading');
  // Title leads, the reference qualifies — a person recognises the work by its
  // words, not by its number.
  heading.append(el('span', 'title', row.issue.title));
  heading.append(el('span', 'ref', `#${row.issue.ref}`));
  if (row.issue.state === 'closed') heading.append(el('span', 'badge', 'closed'));
  if (row.togetherGroupSize > 1) {
    // Groups are never written down (§6.1), so the size is computed.
    heading.append(el('span', 'badge', `together, group of ${row.togetherGroupSize}`));
  }
  // COMPARED AGAINST THE UNIT, NOT AGAINST 1. A slot's serialize footprint is
  // the union over its MEMBERS' components and each member's component includes
  // itself, so a together unit of two with no `serialize-with` edge anywhere
  // reads 2 — under the same rule that makes a lone issue read 1. Tested
  // against 1, that drew "serialized, group of 2" on a pair nothing serializes,
  // which is a relationship the page invented.
  //
  // The number is the derivation's and is correct; what is a rendering decision
  // is whether the group reaches BEYOND its own members, and that is this
  // comparison. `order.test.ts` pins the property it rests on.
  if (row.serializeGroupSize > Math.max(row.togetherGroupSize, 1)) {
    heading.append(el('span', 'badge', `serialized, group of ${row.serializeGroupSize}`));
  }
  body.append(heading);

  const meta = el('div', 'row-meta');
  meta.append(el('span', 'provenance', provenanceLabel(row.provenance)));
  meta.append(el('span', 'station-word', stationLabel(row)));
  body.append(meta);

  if (row.holds.length > 0) {
    const holds = el('div', 'holds');
    for (const hold of row.holds) holds.append(holdChip(hold));
    body.append(holds);
  }

  node.append(body);
  return node;
}

/**
 * Whether the relationships panel should offer to DELETE this edge.
 *
 * Only a LANDED one, because that is exactly what the store will accept: every
 * non-create mutation is validated against the landed document, so an edge that
 * exists only as an optimistic overlay — a create that was rejected, that
 * conflicted, or that a guard refused — comes back `unknown-edge`.
 *
 * OFFERING IT ANYWAY WAS NOT A HARMLESS DEAD CONTROL, which is why this is a
 * guard rather than a tidy-up. The refusal is itself a write, so one click
 * stacked an `invalid` state and a second `discard mine` onto a row that was
 * already `failed`, and the edge did not move — a page whose entire subject is
 * the edge states behaving as designed, showing two of them at once for a
 * reason that was the page's own doing. Reproduced in a browser before the fix
 * and after it.
 *
 * The right control for an unlanded edge is `discard mine`, which the row
 * already offers for every settled write. A PENDING one correctly offers
 * neither: there is nothing to discard until it settles.
 *
 * ASKED THROUGH THE STORE'S OWN `findEdge`, never a hand-rolled id comparison.
 * Edge identity is derived from content and the symmetric kinds collapse two
 * spellings onto one id (`edgeId`) — rules the store owns — so asking it is what
 * stops this predicate and the validator disagreeing about what "in this
 * document" means.
 */
export function offersDelete(edge: ProjectedEdge, snapshot: StoreSnapshot): boolean {
  // AN EDIT IN FLIGHT MAKES THE LANDED ANSWER STALE, which is the half the first
  // version of this guard missed. A pending DELETE leaves its edge in `landed`
  // until it settles, so the landed test alone kept the button up through the
  // whole dispatch — and a second click queued a delete that the store then
  // revalidated against the updated document and refused `unknown-edge`,
  // reproducing the very state this predicate was added to prevent.
  //
  // A PENDING DELETE IS THE ONLY EDIT THAT REACHES THIS TEST TODAY, and saying so
  // is more useful than implying a wider population. An edge's identity is
  // derived from its kind and endpoints, so a `retype` or a `flip` projects
  // under a NEW id while the old id LEAVES the projection entirely — measured:
  // with a retype in flight the old id is no longer drawn at all, and the new
  // one is not in `landed`, so the landed test below refuses it without this
  // clause. Delete is the one operation that keeps its id and stays landed while
  // it is in flight, which is exactly the stale-landed shape.
  //
  // The test is still written on the EDIT rather than on the verb, so an
  // operation that later shares delete's shape is covered without an edit here —
  // but it is a restatement of the row's own rule, not a guard against something
  // reachable that the landed test misses.
  //
  // It also matches what the row already does: a pending write offers no
  // `retry` and no `discard mine`, because there is nothing to act on until it
  // settles. Delete was the one control that ignored that.
  const pending = edge.writes.some(
    (mutationId) =>
      snapshot.writes.find((write) => write.mutationId === mutationId)?.state === 'pending',
  );
  if (pending) return false;
  return findEdge({ issues: snapshot.issues, edges: snapshot.landed }, edge.id) !== undefined;
}

function renderEdge(edge: ProjectedEdge, store: Store, snapshot: StoreSnapshot): HTMLElement {
  const node = el('li', `edge edge-${edge.kind}`);
  // `selected` is the one state that is not about a write, so it has to be
  // reachable the way a person reaches it — by choosing the thing. The guard on
  // the target is what keeps `retry` and `delete` from also toggling selection.
  //
  // Reachable by KEYBOARD as well as by pointer. A row that only answers a
  // click puts one of the five states behind a mouse, which would make "every
  // state is reachable" true only for some visitors.
  const selected = snapshot.selection.includes(edge.id);
  node.setAttribute('role', 'button');
  node.setAttribute('aria-pressed', String(selected));
  node.tabIndex = 0;
  const toggle = (): void => {
    store.select(
      selected ? snapshot.selection.filter((id) => id !== edge.id) : [...snapshot.selection, edge.id],
    );
  };
  node.addEventListener('click', (event) => {
    if (event.target instanceof HTMLButtonElement) return;
    toggle();
  });
  node.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLButtonElement) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Space scrolls the page by default, which would move the board out from
    // under the row the visitor just chose.
    event.preventDefault();
    toggle();
  });
  node.append(el('span', 'glyph', GLYPH[edge.kind]));
  node.append(el('span', 'edge-kind', edge.kind));
  node.append(el('span', 'edge-pair', `#${edge.from} → #${edge.to}`));

  for (const state of edge.states) node.append(el('span', `state state-${state}`, state));

  for (const mutationId of edge.writes) {
    const record = snapshot.writes.find((write) => write.mutationId === mutationId);
    if (record === undefined) continue;
    if (record.state === 'invalid') {
      node.append(el('span', 'reason', record.reason.message));
    }
    if (record.state === 'failed') {
      node.append(el('span', 'reason', record.reason));
      node.append(button('retry', () => void store.retry(mutationId), 'button button-inline'));
    }
    if (record.state === 'conflict') {
      const upstream = record.upstream;
      node.append(
        el('span', 'reason', `upstream moved: it now holds ${upstream.edges.length} edges`),
      );
      node.append(button('retry', () => void store.retry(mutationId), 'button button-inline'));
    }
    if (record.state !== 'pending') {
      node.append(
        button(
          'discard mine',
          () => {
            // COMPOSED WITH A REHYDRATE, because discarding the local side of a
            // conflict is accepting the other one — and the demo's upstream is
            // genuinely installed in the source rather than merely described,
            // so the store is holding a document that is now out of date.
            // Without this the edge the visitor just accepted stays invisible
            // until some unrelated write happens to refresh it.
            //
            // Safe to compose here, unlike "retry on latest": there is no user
            // intent left to sequence against once the overlay is gone.
            store.discardMine(mutationId);
            void store.rehydrate();
          },
          'button button-inline',
        ),
      );
    }
  }

  if (offersDelete(edge, snapshot)) {
    node.append(
      button(
        'delete',
        () => void store.propose({ op: 'delete', edgeId: edge.id }),
        'button button-inline button-quiet',
      ),
    );
  }
  return node;
}

/** Everything the page draws, from one snapshot. */
export function render(
  root: HTMLElement,
  store: Store,
  rows: readonly ExplainedRow[],
  snapshot: StoreSnapshot,
): void {
  root.replaceChildren();

  const orderPanel = el('section', 'panel');
  const orderHead = el('header', 'panel-head');
  orderHead.append(el('h2', undefined, 'The order'));
  // The glance-count the filled stations exist for: how much could run right
  // now, against the number the executor will actually dispatch.
  //
  // COUNTED IN SLOTS, NOT ROWS — see `slotCount`, which is where the rule and
  // its test live, so the header cannot drift from the stations beneath it.
  const readyNow = slotCount(rows.filter((each) => each.station === 'filled'));
  const readyTotal = slotCount(rows.filter((each) => each.ready && each.placement === 'spine'));
  orderHead.append(
    el('span', 'muted', `${readyTotal} ready · cap ${DEFAULT_CONCURRENCY_CAP} · ${readyNow} running`),
  );
  const status = el(
    'span',
    `order-status order-status-${snapshot.order.status}`,
    snapshot.order.status === 'held'
      ? 'held — a write is in flight, so the order has not re-evaluated'
      : 'settled',
  );
  orderHead.append(status);
  orderPanel.append(orderHead);

  const spine = el('ol', 'rows');
  for (const row of rows.filter((each) => each.placement === 'spine')) {
    spine.append(renderRow(row));
  }
  orderPanel.append(spine);

  const footerRows = rows.filter((each) => each.placement === 'footer');
  if (footerRows.length > 0) {
    const details = document.createElement('details');
    details.className = 'footer-group';
    const summary = document.createElement('summary');
    // The second hold family, and duplicates: collapsed, with no rank slot,
    // because they are not facts about the work.
    summary.textContent = `${footerRows.length} never in the order — held by the executor, duplicate, or closed`;
    details.append(summary);
    const list = el('ol', 'rows');
    for (const row of footerRows) list.append(renderRow(row));
    details.append(list);
    orderPanel.append(details);
  }
  root.append(orderPanel);

  const edgePanel = el('section', 'panel');
  const edgeHead = el('header', 'panel-head');
  edgeHead.append(el('h2', undefined, 'Relationships'));
  edgeHead.append(
    el('span', 'muted', `${snapshot.projected.length} drawn · ${snapshot.landed.length} landed`),
  );
  edgePanel.append(edgeHead);
  const edges = el('ul', 'edges');
  for (const edge of snapshot.projected) edges.append(renderEdge(edge, store, snapshot));
  edgePanel.append(edges);
  root.append(edgePanel);

  if (snapshot.lastChange !== undefined) {
    const change = snapshot.lastChange;
    const banner = el('div', 'change');
    // The counts ship as numbers so a host writes the sentence in its own
    // language. This is the demo writing one.
    const { moved, promoted, newlyHeld, entered, left } = change.counts;
    banner.append(
      el(
        'span',
        undefined,
        `The last edit moved ${moved} row(s): ${promoted} promoted, ${newlyHeld} newly held, ` +
          `${entered} entered the order, ${left} left it.`,
      ),
    );
    banner.append(button('dismiss', () => store.dismissChange(), 'button button-inline'));
    root.append(banner);
  }

  if (snapshot.hydrationError !== undefined) {
    root.append(el('div', 'error', `hydration failed: ${snapshot.hydrationError}`));
  }
  if (snapshot.orderError !== undefined) {
    root.append(el('div', 'error', `the order is stale: ${snapshot.orderError}`));
  }
}
