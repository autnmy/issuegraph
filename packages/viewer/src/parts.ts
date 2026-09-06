/**
 * The pieces every projection draws the same way.
 *
 * Identity, provenance, holds, readiness stations and edge badges are one
 * grammar, not three — the design's extensibility clause turns on that. Putting
 * them here means a projection cannot invent a second spelling of "this issue
 * is held", and a change to the grammar lands in every projection at once.
 */

import { type EdgeField, edgeIdentity } from '@issuegraph/core';

import type {
  NormalizedDocument,
  RankProvenance,
  ViewerHold,
  ViewerIssue,
  ViewerSlot,
} from './document.ts';
import { type ElementSpec, element, svg } from './element.ts';
import { GROUP_ATTRIBUTE } from './scene.ts';
import { EDGE_ORDER, type EdgeTerminal, dashArrayFor, treatmentFor } from './vocabulary.ts';

/**
 * The attribute a control the viewer publishes but does not wire carries. The
 * same one `@issuegraph/editor` reads for its own controls, so a host that
 * already listens for the editor's commands hears this one through the same
 * listener.
 */
export const COMMAND_ATTRIBUTE = 'data-ig-command';

/** A badge's inner pair — the glyph a reader can see and the word a reader can hear. */
function glyphAndLabel(glyph: string, label: string): readonly ElementSpec[] {
  return [
    element('span', { class: 'ig-glyph', 'aria-hidden': 'true' }, [glyph]),
    element('span', {}, [label]),
  ];
}

/** How a readiness station is filled — the parallelism channel. */
export type StationFill = 'filled' | 'hollow' | 'dashed';

/**
 * Filled = ready now. Hollow = ready once a named rank lands. Dashed = held.
 *
 * The hollow case needs the host to have told us the rank; without it a ready
 * slot is simply ready, and inventing a pending state would claim a dependency
 * nobody declared.
 */
export function stationFill(slot: ViewerSlot): StationFill {
  if (!slot.ready) return 'dashed';
  const after = slot.readyAfterRank;
  return after === undefined || after === null ? 'filled' : 'hollow';
}

const STATION_LABEL: Readonly<Record<StationFill, string>> = Object.freeze({
  filled: 'ready now',
  hollow: 'ready after an earlier rank',
  dashed: 'held',
});

export function station(fill: StationFill): ElementSpec {
  return element('span', {
    class: 'ig-station',
    'data-fill': fill,
    role: 'img',
    'aria-label': STATION_LABEL[fill],
  });
}

/**
 * The identity chip: the qualified reference, linked only when the host gave us
 * a URL. The viewer never constructs one — knowing a tracker's URL shape is the
 * kind of knowledge this layer exists not to have.
 */
export function identity(issue: ViewerIssue): ElementSpec {
  if (issue.url === undefined || issue.url === '') {
    return element('span', { class: 'ig-id' }, [issue.key]);
  }
  return element('span', { class: 'ig-id' }, [
    element(
      'a',
      {
        class: 'ig-link',
        href: issue.url,
        rel: 'noreferrer',
        'aria-label': `open ${issue.key}`,
      },
      [`${issue.key} ↗`],
    ),
  ]);
}

/**
 * The provenance line, in the three forms the design fixes: a matched ordering
 * query, the declared tier, and an effective-priority promotion that names the
 * dependent the urgency arrived through.
 */
export function provenanceLine(provenance: RankProvenance | undefined): ElementSpec | null {
  if (provenance === undefined) return null;
  switch (provenance.kind) {
    case 'matched-query':
      return element('p', { class: 'ig-provenance' }, [
        turn(),
        element('span', {}, [
          `matched ordered query ${String(provenance.index)} · `,
          element('span', { class: 'ig-id' }, [provenance.label]),
        ]),
      ]);
    case 'declared-tier':
      return element('p', { class: 'ig-provenance' }, [
        turn(),
        element('span', {}, [
          'no declared priority — spec default ',
          element('span', { class: 'ig-id' }, [`P${String(provenance.priority)}`]),
        ]),
      ]);
    case 'promotion': {
      const via =
        provenance.promotedBy.length === 0
          ? null
          : element('span', {}, [
              ' — inherited from ',
              element('span', { class: 'ig-id' }, [provenance.promotedBy.join(', ')]),
              ', which it blocks',
            ]);
      return element('p', { class: 'ig-provenance' }, [
        turn(),
        element('span', {}, [
          'effective priority ',
          element('span', { class: 'ig-id' }, [provenance.notation]),
          via,
        ]),
      ]);
    }
  }
}

/**
 * The turnstile every explanation line hangs off.
 *
 * §16a puts one in front of the provenance sentence, the hold sentence and the
 * caveat note alike, and it is what makes those lines read as subordinate to
 * the row above WITHOUT dimming them. The line that shipped was muted instead,
 * which files the panel's own reason for existing — why is this here — under
 * decoration.
 */
function turn(): ElementSpec {
  return element('span', { class: 'ig-turn', 'aria-hidden': 'true' }, ['↳']);
}

/**
 * The priority chip a row wears on its badge row, derived from the same
 * provenance the sentence beneath it explains.
 *
 * ONE FACT, TWO READS, and the frame draws both on purpose: the chip is what a
 * reader scanning a column of rows sees, and the sentence is what they read
 * when the chip surprises them. A promotion is the one chip the design accents,
 * because a low tier pulled to the top because it blocks a high one is the most
 * interesting thing the panel can say.
 */
export function priorityBadge(provenance: RankProvenance | undefined): ElementSpec | null {
  if (provenance === undefined) return null;
  switch (provenance.kind) {
    case 'matched-query':
      return element('span', { class: 'ig-badge', 'data-priority': 'query' }, [provenance.label]);
    case 'declared-tier':
      return element('span', { class: 'ig-badge', 'data-priority': 'tier' }, [
        `P${String(provenance.priority)} · default`,
      ]);
    case 'promotion':
      return element('span', { class: 'ig-badge', 'data-priority': 'promoted' }, [
        provenance.notation,
      ]);
  }
}

/**
 * The evidence chip: `✓ verified`, or nothing.
 *
 * ABSENT READS `asserted`, which §16d states in those words, so an absent field
 * draws no chip rather than a muted one — a panel that prints "asserted" on
 * every row has spent a chip slot on the default.
 */
export function evidenceBadge(issue: ViewerIssue | undefined): ElementSpec | null {
  if (issue?.evidence !== 'verified') return null;
  return element(
    'span',
    { class: 'ig-badge', 'data-evidence': 'verified', title: 'evidence: verified' },
    glyphAndLabel('✓', 'verified'),
  );
}

/**
 * One hold, rendered with the family it belongs to visible in the markup — and
 * its cause and subject beside it when the host supplied them, so a host reads
 * WHY off an attribute instead of matching the sentence. Omitted, never empty,
 * when absent: `data-code=""` would claim a cause the host did not state.
 */
export function holdLine(hold: ViewerHold): ElementSpec {
  // THE LABEL IS THE TRACKER ARM'S ALONE, and the union is what lets this read
  // it without asking: a graph hold has no `label` to read. Drawn INSIDE the
  // paragraph, so a labelled hold is still one row child and the slot grid's
  // column rule holds without a second placement.
  const label =
    hold.family === 'tracker' && hold.label !== undefined && hold.label !== ''
      ? element('span', { class: 'ig-badge', 'data-hold': hold.label }, [hold.label])
      : null;
  return element(
    'p',
    {
      class: 'ig-hold',
      'data-family': hold.family,
      'data-code': hold.code,
      'data-subject': hold.subject,
    },
    [turn(), label, element('span', {}, [hold.reason])],
  );
}

/**
 * The runner's own words for the holds a footer collects — `claimed · parked` —
 * so the footer title can name them the way the design does. Empty when no
 * hold carries a label, which keeps the title exactly as it was before labels
 * existed.
 */
export function footerLabels(slots: readonly ViewerSlot[]): string {
  const labels: string[] = [];
  for (const slot of slots) {
    for (const hold of slot.holds) {
      if (hold.family !== 'tracker' || hold.label === undefined || hold.label === '') continue;
      if (!labels.includes(hold.label)) labels.push(hold.label);
    }
  }
  return labels.join(' · ');
}

/**
 * The summary line and the freshness stamp — the host's numbers and the host's
 * clock, printed verbatim.
 *
 * NOTHING HERE IS COUNTED. `counts` is the host's tally over the whole order
 * (see `OrderCounts` for why a count over this document's slots would be a
 * count over a window), and the stamp is text the host formatted. `null` when
 * the host stated neither, so a document with no host facts draws no header.
 */
export interface HeaderControls {
  /** Which projection is drawn now, so the toggle can mark it. */
  readonly projection: 'linear' | 'graph' | 'tree';
  /**
   * Whether the host wired the view commands — `projection:*`, `expand` and
   * `collapse`. See `SceneOptions.switchable`.
   */
  readonly switchable: boolean;
  /**
   * Whether the graph is drawn in a column or at full width. Absent for the
   * projections where the question does not arise.
   */
  readonly compact?: boolean | undefined;
}

/**
 * The projection toggle and the size affordance — controls the viewer PUBLISHES
 * and does not wire, exactly like the refresh button beside them.
 *
 * THE VIEWER CANNOT SWITCH ITS OWN PROJECTION. It is a pure renderer: the host
 * re-renders it with a different option, which is the same shape `refresh`
 * already has. So the toggle is drawn here — §16a and §16b both draw it, and a
 * panel whose two views are its whole point cannot leave the way between them
 * to the host's imagination — and the command travels on the attribute the host
 * is already listening to.
 */
function headerControls(controls: HeaderControls | undefined): ElementSpec | null {
  // A CONTROL NOBODY WIRED IS WORSE THAN NO CONTROL. This package cannot switch
  // its own projection, so the host says whether it will — and until it does,
  // the button is not drawn rather than drawn dead.
  if (controls === undefined || !controls.switchable) return null;
  const toggle = (
    projection: 'linear' | 'graph',
    glyph: string,
    label: string,
  ): ElementSpec =>
    element(
      'button',
      {
        class: 'ig-toggle-option',
        type: 'button',
        'aria-pressed': controls.projection === projection ? 'true' : 'false',
        [COMMAND_ATTRIBUTE]: `projection:${projection}`,
      },
      [element('span', { class: 'ig-glyph', 'aria-hidden': 'true' }, [glyph]), label],
    );
  return element('span', { class: 'ig-toggle', role: 'group', 'aria-label': 'projection' }, [
    toggle('linear', '☰', 'List'),
    toggle('graph', '⛓', 'Graph'),
  ]);
}

/**
 * The expand / collapse affordance the graph's two sizes need.
 *
 * GATED THE SAME WAY THE TOGGLE IS, and for the same reason: `expand` and
 * `collapse` are published commands this package cannot perform on itself, so a
 * host that has not wired them would be given a button that does nothing.
 */
function sizeControl(controls: HeaderControls | undefined): ElementSpec | null {
  if (controls === undefined || !controls.switchable || controls.compact === undefined) return null;
  // ITS OWN CLASS, NOT THE REFRESH BUTTON'S. They look alike and they are not
  // the same thing: refresh is drawn only when a host supplied a word for it,
  // and this is drawn whenever the graph is, so sharing a class made a document
  // with no host facts render `ig-refresh` and broke the pure-graph promise.
  return element(
    'button',
    {
      class: 'ig-size',
      type: 'button',
      [COMMAND_ATTRIBUTE]: controls.compact ? 'expand' : 'collapse',
    },
    [controls.compact ? '⤢ Expand' : '⤡ Collapse'],
  );
}

export function hostHeader(
  document: NormalizedDocument,
  controls?: HeaderControls,
): ElementSpec | null {
  const { concurrencyCap, counts, freshness } = document.host;

  // THREE CHIPS, NOT ONE SENTENCE, and the middle one carries the accent. §16a
  // outlines each tally separately and tints only "how many could run right
  // now, against the cap" — the number an operator acts on — so the panel
  // spends its accent once instead of on a line of muted prose in which every
  // figure looks equally worth reading. The cap rides on that chip because the
  // comparison is the point: four ready against a cap of two says something
  // neither number says alone.
  const chips: ElementSpec[] = [];
  if (counts !== undefined) {
    chips.push(
      element('span', { class: 'ig-count-chip', 'data-count': 'ranked' }, [
        `${String(counts.ranked)} ranked`,
      ]),
      element('span', { class: 'ig-count-chip', 'data-count': 'ready' }, [
        concurrencyCap === undefined
          ? `${String(counts.readyNow)} ready now`
          : `${String(counts.readyNow)} ready now · cap ${String(concurrencyCap)}`,
      ]),
      element('span', { class: 'ig-count-chip', 'data-count': 'held' }, [
        `${String(counts.held)} held`,
      ]),
    );
  } else if (concurrencyCap !== undefined) {
    chips.push(
      element('span', { class: 'ig-count-chip', 'data-count': 'ready' }, [
        `cap ${String(concurrencyCap)}`,
      ]),
    );
  }
  const summary =
    chips.length === 0
      ? null
      : element('p', { class: 'ig-counts', 'aria-label': 'order summary' }, chips);

  const stamp =
    freshness === undefined
      ? null
      : element('p', { class: 'ig-freshness', 'data-stale': freshness.stale === true ? 'true' : 'false' }, [
          element('span', {}, [
            'as of ',
            element('span', { class: 'ig-id' }, [freshness.asOf]),
            freshness.age === undefined || freshness.age === '' ? null : ` · ${freshness.age}`,
            freshness.stale === true ? ' · stale' : null,
          ]),
          // A CONTROL THE VIEWER PUBLISHES AND DOES NOT WIRE. Refreshing a mirror
          // is fetching, which this layer never does; the host that can listens
          // for the command. A real button rather than a styled span, so the
          // mount's own click and Enter handling leave it alone the way they
          // leave a deep link alone.
          freshness.refresh === undefined || freshness.refresh === ''
            ? null
            : element(
                'button',
                { class: 'ig-refresh', type: 'button', [COMMAND_ATTRIBUTE]: 'refresh' },
                [freshness.refresh],
              ),
        ]);

  const toggle = headerControls(controls);
  const size = sizeControl(controls);
  if (summary === null && stamp === null && toggle === null) return null;
  // THE PANEL'S OWN NAME IS PART OF THE HEADER BAR. §16a leads with it, and it
  // is what tells a reader that the rows beneath are a PREVIEW of an order
  // rather than the tracker's own list.
  return element('header', { class: 'ig-header' }, [
    element('div', { class: 'ig-header-top' }, [
      element('span', { class: 'ig-header-lead' }, [
        element('span', { class: 'ig-header-label' }, ['Order preview']),
        toggle,
      ]),
      element('span', { class: 'ig-header-lead' }, [stamp, size]),
    ]),
    summary,
  ]);
}

/**
 * The NOW rows: what the runner is working this moment, drawn above the order.
 *
 * A POINTER IDENTITY, NEVER A FOCUS ONE. The running issue may also hold a slot
 * — a claimed row in the footer, say — and exactly one element per key carries
 * `data-ig-key` or `focus()` lands on whichever the renderer emitted first. So
 * the row announces itself through {@link GROUP_ATTRIBUTE}, the way an
 * enclosure does: clickable and hoverable, resolving to the issue through the
 * document, and absent from the focus index. The title and identity are the
 * ISSUE'S, looked up here; only the phase and the elapsed time are the host's
 * words, because only the host has the clock.
 */
export function nowRows(document: NormalizedDocument): ElementSpec | null {
  if (document.host.running.length === 0) return null;
  return element(
    'ol',
    { class: 'ig-now', 'aria-label': 'working now' },
    document.host.running.map((job) => {
      // Present by construction: `normalizeHost` dropped any job the document
      // does not carry. The fallback keeps this total rather than trusting it.
      const issue = document.byKey.get(job.key);
      return element(
        'li',
        {
          class: 'ig-now-row',
          [GROUP_ATTRIBUTE]: job.key,
          // The list already announces "working now"; the row says what and how long.
          'aria-label': `${issue?.title ?? job.key} — ${job.phase} · ${job.elapsed}`,
        },
        [
          element('span', { class: 'ig-now-mark', 'aria-hidden': 'true' }, ['now']),
          // THE SAME TWO-LINE HEAD EVERY ROW HAS. The band that shipped put the
          // title, the identity and the phase on one line at three different
          // ends of it, so the row being worked read as less structured than
          // the queued rows beneath it — the opposite of what the frame does.
          element('div', { class: 'ig-row-head' }, [
            element('span', { class: 'ig-title' }, [issue?.title ?? job.key]),
            element('span', { class: 'ig-id' }, [
              issue === undefined ? job.key : identity(issue),
              ` · ${job.phase} · ${job.elapsed}`,
            ]),
          ]),
          element('span', { class: 'ig-now-phase' }, [
            element('span', { class: 'ig-now-pulse', 'aria-hidden': 'true' }),
            'working',
          ]),
        ],
      );
    }),
  );
}

/**
 * A together unit's members, one line each.
 *
 * THE UNIT IS THE ONE PLACE THE DESIGN DRAWS AN ENCLOSURE, and it draws it to
 * say that two distinct issues are one unit of work. Joining their titles with
 * a separator — which is what shipped — says the opposite: a reader sees one
 * issue with an unusually long name, and the second issue's own identity and
 * tier vanish. Returns `null` for a single-member slot, so an ordinary row is
 * unchanged by construction.
 */
export function unitBlock(document: NormalizedDocument, slot: ViewerSlot): ElementSpec | null {
  if (slot.members.length < 2) return null;
  return element(
    'ul',
    { class: 'ig-unit', 'aria-label': `one unit of ${String(slot.members.length)} issues` },
    slot.members.map((member) => {
      const issue = document.byKey.get(member);
      return element('li', { class: 'ig-unit-member' }, [
        element('span', { class: 'ig-title' }, [issue?.title ?? member]),
        element('span', { class: 'ig-id' }, [
          issue === undefined ? member : `${member} · P${String(issue.priority)}`,
        ]),
      ]);
    }),
  );
}

/** The unit's own pill, above the enclosure: what it is, and how many. */
export function unitMark(slot: ViewerSlot): ElementSpec | null {
  if (slot.members.length < 2) return null;
  return element('div', { class: 'ig-unit-mark' }, [
    element('span', { class: 'ig-unit-pill' }, [
      `⧉ one unit · ${String(slot.members.length)} issues`,
    ]),
    element('span', { class: 'ig-unit-note' }, ['worked together']),
  ]);
}

/**
 * The two caveats a host can put on a row, each ONE row child so the slot grid
 * places it like provenance.
 *
 * `preview-only`: the host's engine could not evaluate a pick-order query, and
 * the note says what it fell back to. `signals disagree`: two ordering signals
 * named different priorities, the host chose one, and the design's rule is
 * that the loser stays visible — struck through, never hidden — because a panel
 * whose job is explaining the order cannot silently pick a winner.
 */
export function caveatLines(issue: ViewerIssue | undefined): ElementSpec[] {
  if (issue === undefined) return [];
  const lines: ElementSpec[] = [];
  if (issue.previewOnly !== undefined) {
    lines.push(
      element('p', { class: 'ig-caveat', 'data-caveat': 'preview-only' }, [
        turn(),
        element('span', {}, [issue.previewOnly.note]),
      ]),
    );
  }
  if (issue.disagreement !== undefined) {
    const { used, ignored } = issue.disagreement;
    lines.push(
      element('p', { class: 'ig-caveat', 'data-caveat': 'disagree' }, [
        turn(),
        element('span', {}, [
          `ranked by ${used} · ${ignored.carrier} declares `,
          element('s', { class: 'ig-strike' }, [ignored.value]),
        ]),
      ]),
    );
  }
  return lines;
}

/**
 * The caveat CHIPS, which sit on the badge row rather than in front of the note.
 *
 * §16a treats a caveat exactly like a relationship: a chip a scanner sees, and
 * a sentence a reader reads. Leaving the chip inline in the sentence made the
 * badge row incomplete and the sentence lumpy — the chip is a fact ABOUT the
 * row, not the first two words of an explanation.
 */
export function caveatBadges(issue: ViewerIssue | undefined): readonly ElementSpec[] {
  if (issue === undefined) return [];
  const chips: ElementSpec[] = [];
  if (issue.previewOnly !== undefined) {
    chips.push(
      element('span', { class: 'ig-badge', 'data-caveat': 'preview-only' }, glyphAndLabel('◐', 'preview-only')),
    );
  }
  if (issue.disagreement !== undefined) {
    chips.push(
      element('span', { class: 'ig-badge', 'data-caveat': 'disagree' }, glyphAndLabel('◆', 'signals disagree')),
    );
  }
  return chips;
}

/**
 * The `⊘ not ready` chip a graph-held row wears.
 *
 * The frame puts it on the badge row beside the tier, so "held" is legible in
 * the same scan as "P1" rather than only from the hatched ground or the
 * sentence underneath.
 */
export function notReadyBadge(slot: ViewerSlot): ElementSpec | null {
  if (slot.ready) return null;
  if (!slot.holds.some((hold) => hold.family === 'graph')) return null;
  return element(
    'span',
    { class: 'ig-badge', 'data-not-ready': 'true' },
    glyphAndLabel('⊘', 'not ready'),
  );
}

/**
 * The caveats as one sentence, for a row that has no room for a block — the
 * graph rail positions its rows onto layout boxes, so it carries text on the
 * label and the tooltip instead (the same choice it makes for holds).
 */
export function caveatText(issue: ViewerIssue | undefined): string {
  if (issue === undefined) return '';
  const parts: string[] = [];
  if (issue.previewOnly !== undefined) parts.push(`preview-only: ${issue.previewOnly.note}`);
  if (issue.disagreement !== undefined) {
    const { used, ignored } = issue.disagreement;
    parts.push(`signals disagree: ranked by ${used}, ${ignored.carrier} declares ${ignored.value}`);
  }
  return parts.join(' · ');
}

/**
 * A badge naming one relationship, on all four channels at once.
 *
 * IT CARRIES THE EDGE'S POINTER IDENTITY, the same one the canvas publishes.
 * `mount`'s `pointable` set is built from `data-ig-key` and this attribute, and
 * an edge identity is in no document — so `data-ig-group` is its ONLY route
 * into that set. Without it an edge was pointable on the graph canvas and
 * nowhere else, and `stillDrawn` therefore answered `false` the moment a switch
 * to the linear or tree projection redrew the scene: the selection was cleared
 * and the host told `onSelect(null)`, contradicting `setProjection`'s own
 * promise that only the representation changes.
 *
 * THE BADGE IS WHAT REPRESENTS AN EDGE HERE. These projections draw no arc, but
 * they do draw the relationship — so the honest answer to "is this subject still
 * on screen" is yes, and naming it is what makes that answer readable. This is
 * the same move `Scene.stationOf` makes for a `together-with` partner: MAP the
 * subject onto what represents it, rather than exempt it from the drawn-check.
 * One mechanism in the parts every projection shares, rather than a special case
 * in the shell.
 *
 * `data-ig-GROUP`, not `data-ig-key`, for the reason `graph.ts` gives at length
 * where it makes the same choice: an edge is not a navigation target, so it must
 * not enter the focus index.
 *
 * A CLICK ON A BADGE NOW NAMES THE EDGE rather than the row carrying it, because
 * `keyAt` walks target-upward. That is the intended half of "an edge is pointable
 * in every projection", and it is what the canvas already does for an arc.
 */
function edgeBadge(field: EdgeField, edgeId: string, label: string, other: string): ElementSpec {
  const treatment = treatmentFor(field);
  return element(
    'span',
    {
      class: 'ig-badge',
      'data-edge': field,
      [GROUP_ATTRIBUTE]: edgeId,
      title: `${label} ${other}`,
      'aria-label': `${label} ${other}`,
    },
    // WORDED, NOT GLYPH-AND-NUMBER. `⊘ 512` asks a reader to hold a five-glyph
    // legend in their head while scanning a column of rows; `⊘ blocked by #512`
    // does not, and §16a and §16b both draw the word. The glyph stays — it is
    // one of the four channels the colour-blind-safety claim rests on — and the
    // label it now shows is the same string the accessible name already used,
    // so what is announced and what is drawn cannot drift.
    glyphAndLabel(treatment.glyph, `${label} ${other}`),
  );
}

/**
 * How many relationship badges one row draws before the rest collapse into a
 * count.
 *
 * THE ROW IS THE UNIT, NOT THE DOCUMENT. The graph refuses past a node budget
 * because a canvas is a local instrument; the linear and tree projections are
 * not — the refusal's own last sentence promises that the order list is
 * complete at any size, so a document-level budget here would break the one
 * promise the refusal routes a reader to. What grows without bound on a dense
 * document is not the row count, which these projections already draw in
 * full, but the relationships PER row: `blocked-by` is a list field, so a
 * valid document of a few hundred nodes admits tens of thousands of edges and
 * every one of them was badged on both endpoint rows. Capping per row bounds
 * the total at rows × budget, which is proportionate to what is drawn anyway.
 *
 * Twelve is the size the graph's refusal already lists its components at, and
 * for the same reason: past that many chips a row is a wall, not a summary,
 * whatever the exact count. It is a separate constant rather than that one
 * imported, because this file sits beneath the projections and the refusal's
 * limit is private to `graph.ts`; the two agree by choice, not by reference.
 * Exported so a host reads it instead of restating it.
 */
export const ROW_BADGE_BUDGET = 12;

/**
 * The chip a row draws in place of the badges past its budget.
 *
 * IT SAYS WHAT WAS OMITTED. A silent cut would leave a reader unable to tell
 * a row with twelve relationships from one with three hundred — the same
 * under-reporting the refusal declines to do for its component list. It
 * carries NO edge identity: it names no single edge, so it must not enter the
 * pointer set as if it did. An omitted edge stays selectable regardless —
 * `mount`'s drawn-check answers from the document first for an edge id.
 */
function overflowBadge(omitted: number): ElementSpec {
  // THE WHOLE PHRASE IS THE VISIBLE TEXT, and there is no `aria-label`. A
  // plain span has the generic role, on which ARIA prohibits naming, so an
  // attribute name here may be ignored and the announcement would be a bare
  // "+N more" with nothing saying what was left out. Visible text is the one
  // name every reader gets; `title` stays as a tooltip only.
  const noun = omitted === 1 ? 'relationship' : 'relationships';
  return element(
    'span',
    { class: 'ig-badge', 'data-omitted': omitted, title: `${String(omitted)} more ${noun} not shown` },
    [`+${String(omitted)} more ${noun}`],
  );
}

/**
 * Every relationship touching a ROW, as badges in the format's own field order
 * — so two rows with the same relationships always read identically.
 *
 * TAKES THE ROW'S WHOLE KEY SET, NOT ONE KEY, because a together unit is ONE
 * row and its partners get no row of their own. Reading only the lead dropped
 * every relationship a partner owned: a unit blocked through its partner
 * rendered no blocking badge at all, so the order UI showed a held unit and
 * silently withheld what was holding it. The keys are the row's identity, so
 * `other` is whichever endpoint is OUTSIDE the set, and an edge internal to the
 * unit still reads from its `from` end exactly as it did when the set was one
 * key — a single-key row is unchanged by construction.
 */
export function edgeBadges(document: NormalizedDocument, keys: readonly string[]): ElementSpec | null {
  const badges = edgeBadgeList(document, keys);
  return badges.length === 0 ? null : element('span', { class: 'ig-badges' }, badges);
}

/**
 * The same badges, unwrapped, for a row that builds ONE badge row out of
 * several sources — a priority chip, an evidence chip, a caveat chip and the
 * relationships — which is what §16a draws. Returning the wrapper to such a
 * caller left it either nesting one flex row inside another or reaching into
 * the spec's children, and the second is how markup and its published
 * behaviour drift.
 */
export function edgeBadgeList(
  document: NormalizedDocument,
  keys: readonly string[],
): readonly ElementSpec[] {
  const mine = new Set(keys);
  const badges: ElementSpec[] = [];
  // COUNTED PAST THE BUDGET, NOT BUILT. The walk still visits every edge so
  // the chip can name how many it left out, but it materialises nothing for
  // them — which is the whole saving on a row with thousands of relationships.
  let omitted = 0;
  // ONE EDGE, ONE BADGE. Both endpoints of an intra-unit edge are members, so
  // it appears in two `edgesOf` entries and would otherwise render twice on the
  // row that owns both ends.
  const seen = new Set<string>();
  for (const field of EDGE_ORDER) {
    for (const key of keys) {
      for (const edge of document.edgesOf.get(key) ?? []) {
        if (edge.field !== field) continue;
        // THE SAME IDENTITY THE BADGE PUBLISHES, so this function holds ONE
        // spelling of "which edge is this" rather than two that can drift apart
        // the first time either is touched.
        // IT IS NOT A BEHAVIOUR CHANGE, and saying so is the point: the private
        // key it replaces deduped exactly the same set here, because
        // `normalizeDocument` has ALREADY collapsed a symmetric field's reverse
        // declaration before an edge reaches `edgesOf`. What this buys is that
        // the value the dedupe reasons about and the value the markup publishes
        // are the same value, so neither can answer for one edge while the other
        // answers for two.
        const edgeId = edgeIdentity(edge.field, edge.from, edge.to);
        if (seen.has(edgeId)) continue;
        seen.add(edgeId);
        // AFTER the dedupe, so the count is of edges and never of a unit's
        // second `edgesOf` entry for the same edge. BEFORE the field loop
        // reaches later fields, so the budget is spent in the format's own
        // order: `blocked-by` first, because that is the relationship a
        // reader asking "why is this held" is looking for.
        if (badges.length >= ROW_BADGE_BUDGET) {
          omitted += 1;
          continue;
        }
        const treatment = treatmentFor(field);
        // A symmetric edge states one fact whichever end you read it from, so it
        // is announced as one relationship rather than as two directions.
        const outgoing = mine.has(edge.from);
        const other = outgoing ? edge.to : edge.from;
        // THE VERB CHANGES, NOT THE NOUN. Read from the far end an asymmetric
        // edge has its own plain wording, and the vocabulary carries it, so a
        // row never has to say "(incoming)" and leave the reader to invert it.
        const label =
          outgoing || treatment.symmetric ? treatment.label : (treatment.reverseLabel ?? treatment.label);
        badges.push(edgeBadge(field, edgeId, label, other));
      }
    }
  }
  if (omitted > 0) badges.push(overflowBadge(omitted));
  return badges;
}

/**
 * The VISIBLE TEXT of every chip a row's badge row draws, in order.
 *
 * EXPORTED FOR THE LAYOUT, which has to know how tall a card is before anything
 * is rendered and cannot measure the DOM — this package is pure and its
 * coordinates have to be the same on a server with no fonts as in a browser
 * with them. Deriving the strings here rather than re-deriving them there is
 * what keeps the reserved height and the drawn height about the same thing: a
 * badge whose wording changes moves the geometry with it.
 */
export function badgeTexts(
  document: NormalizedDocument,
  slot: ViewerSlot | undefined,
  issue: ViewerIssue | undefined,
  keys: readonly string[],
): readonly string[] {
  const texts: string[] = [];
  const priority = priorityBadge(issue?.provenance);
  if (priority !== null) texts.push(textOf(priority));
  if (evidenceBadge(issue) !== null) texts.push('verified');
  if (slot !== undefined && notReadyBadge(slot) !== null) texts.push('not ready');
  for (const chip of caveatBadges(issue)) texts.push(textOf(chip));
  for (const chip of edgeBadgeList(document, keys)) texts.push(textOf(chip));
  return texts;
}

/** Every string inside one spec, concatenated — what a reader sees on it. */
function textOf(spec: ElementSpec): string {
  let text = '';
  for (const child of spec.children ?? []) {
    if (child === null || child === undefined) continue;
    text += typeof child === 'string' ? child : textOf(child);
  }
  return text;
}

/**
 * The legend: a footer bar under the drawing it explains.
 *
 * IT DRAWS THE LINE, NOT A CHIP OF IT. The claim this package makes about
 * colour-blind safety is that each relationship is separable by dash pattern,
 * terminal marker and glyph as well as hue — and a legend of five outlined
 * chips shows none of the first two, so a reader meeting a dotted arc has
 * nothing to match it against. Each sample is the same stroke and the same
 * dash array the canvas uses, taken from `vocabulary.ts` rather than restated,
 * and the terminal is the marker that edge actually ends in.
 *
 * THE READINESS KEY RIDES ALONG. The station fill is the parallelism channel —
 * filled, hollow, dashed — and it is the one part of the grammar the edge table
 * cannot explain, so §16b keys it at the far end of the same bar.
 */
export function legend(): ElementSpec {
  return element('fieldset', { class: 'ig-legend' }, [
    element('legend', { class: 'ig-legend-caption' }, ['relationships']),
    ...EDGE_ORDER.map((field) => {
      const treatment = treatmentFor(field);
      return element('span', { class: 'ig-legend-item' }, [
        legendSample(field),
        element('span', { class: 'ig-glyph', 'aria-hidden': 'true' }, [treatment.glyph]),
        element('span', {}, [treatment.label]),
      ]);
    }),
    element('span', { class: 'ig-legend-keys' }, [
      ...STATION_KEYS.map(([fill, label]) =>
        element('span', { class: 'ig-legend-item' }, [station(fill), element('span', {}, [label])]),
      ),
    ]),
  ]);
}

const STATION_KEYS: readonly (readonly [StationFill, string])[] = Object.freeze([
  ['filled', 'ready now'],
  ['hollow', 'ready after'],
  ['dashed', 'held'],
] as const);

/** The width and height of one drawn legend sample, in CSS pixels. */
const SAMPLE_WIDTH = 34;
const SAMPLE_HEIGHT = 10;

/**
 * One relationship, drawn the way the canvas draws it.
 *
 * `together-with` is an enclosure rather than a line, so its sample is the
 * rounded outline the canvas puts around a unit — drawing it as a line would
 * be the legend teaching a shape the picture never uses.
 */
function legendSample(field: EdgeField): ElementSpec {
  const treatment = treatmentFor(field);
  const dash = dashArrayFor(treatment.dash);
  const box = { width: String(SAMPLE_WIDTH), height: String(SAMPLE_HEIGHT), 'aria-hidden': 'true' };
  const mid = SAMPLE_HEIGHT / 2;
  // BUILT IN THE SVG NAMESPACE, and `element` does not put it there. That works
  // by accident through `renderViewer`, whose output a host parses as HTML —
  // but `mountViewer` materializes the same spec with `createElement`, which
  // builds an HTML `<svg>` and HTML `<line>` children that draw nothing at all.
  // So a mounted viewer showed five blank boxes where the legend's samples are,
  // which is the whole of what the samples were added for.
  if (treatment.dash === 'enclosure') {
    return svg('svg', box, [
      svg('rect', {
        class: 'ig-enclosure',
        'data-edge': field,
        x: '1',
        y: '1',
        width: String(SAMPLE_WIDTH - 2),
        height: String(SAMPLE_HEIGHT - 2),
        rx: '3',
      }),
    ]);
  }
  const lines: ElementSpec[] =
    treatment.dash === 'double'
      ? [
          lineSample(field, 1, SAMPLE_WIDTH, mid - 2, dash),
          lineSample(field, 1, SAMPLE_WIDTH, mid + 2, dash),
        ]
      : [lineSample(field, 1, SAMPLE_WIDTH - 7, mid, dash)];
  return svg('svg', box, [...lines, terminalSample(field, treatment.terminal, mid)]);
}

function lineSample(
  field: EdgeField,
  x1: number,
  x2: number,
  y: number,
  dash: string | null,
): ElementSpec {
  return svg('line', {
    class: 'ig-edge',
    'data-edge': field,
    x1: String(x1),
    y1: String(y),
    x2: String(x2),
    y2: String(y),
    ...(dash === null ? {} : { 'stroke-dasharray': dash }),
  });
}

/** The sample's pointed end, in the shape the vocabulary names for that edge. */
function terminalSample(field: EdgeField, terminal: EdgeTerminal, y: number): ElementSpec | null {
  const tip = SAMPLE_WIDTH;
  switch (terminal) {
    case 'arrow':
      return svg('path', {
        class: 'ig-terminal',
        'data-edge': field,
        fill: 'currentColor',
        d: `M${String(tip - 7)},${String(y - 3)} L${String(tip)},${String(y)} L${String(tip - 7)},${String(y + 3)} z`,
      });
    case 'hollow-circle':
      return svg('circle', {
        class: 'ig-terminal',
        'data-edge': field,
        fill: 'none',
        stroke: 'currentColor',
        cx: String(tip - 3),
        cy: String(y),
        r: '3',
      });
    case 'tee':
      return svg('line', {
        class: 'ig-terminal',
        'data-edge': field,
        stroke: 'currentColor',
        x1: String(tip - 2),
        y1: String(y - 4),
        x2: String(tip - 2),
        y2: String(y + 4),
      });
    case 'none':
    case 'enclosure':
      return null;
  }
}

/**
 * Every key a projection draws under some OTHER key's station, mapped to it.
 *
 * One rule for the linear and graph projections, which both render a together
 * unit as a single row or node keyed by its lead. Written once because two
 * copies of "which key stands in for which" is exactly how a projection's
 * markup and its published `navigable` came to disagree in the first place.
 *
 * Only non-identity entries, so a lookup that misses means "represents itself"
 * and no projection has to enumerate the keys that are already their own.
 */
export function stationsOf(document: NormalizedDocument): ReadonlyMap<string, string> {
  const stations = new Map<string, string>();
  for (const slot of document.order.slots) {
    for (const member of slot.members) {
      if (member !== slot.lead) stations.set(member, slot.lead);
    }
  }
  return stations;
}

/**
 * The caller's options, with `selected` and `focused` named the way THIS
 * projection names them.
 *
 * APPLIED BEFORE THE SCENE IS BUILT, and that is the whole point of it being
 * here rather than only in `reconcile`. Reconciling afterwards fixed the state
 * a handle reports and left the MARKUP built from the un-canonicalized key: the
 * station's row was never marked `aria-current`, the roving tab stop stayed on
 * whatever the fallback resolved to, and `renderViewer` — which never calls
 * `reconcile` at all — was simply wrong. A viewer whose reported state and
 * rendered DOM disagree is the defect, whichever half is right.
 *
 * The projection publishes the SAME map it canonicalized with, so `reconcile`
 * cannot reach a different answer than the markup did.
 */
export function atStations<T extends { selected?: string | null | undefined; focused?: string | null | undefined }>(
  options: T,
  stations: ReadonlyMap<string, string>,
): T {
  if (stations.size === 0) return options;
  const at = (key: string | null | undefined): string | null | undefined =>
    key === null || key === undefined ? key : (stations.get(key) ?? key);
  return { ...options, selected: at(options.selected), focused: at(options.focused) };
}

/** The title of a slot, naming every member — a together unit is one row. */
export function slotTitle(document: NormalizedDocument, slot: ViewerSlot): string {
  return slot.members
    .map((member) => document.byKey.get(member)?.title ?? member)
    .join(' · ');
}

/** A slot's accessible name: what it is, where it sits, and whether it is held. */
export function slotLabel(document: NormalizedDocument, slot: ViewerSlot): string {
  const position = slot.rank === null ? 'held, no rank' : `rank ${String(slot.rank)}`;
  return `${slotTitle(document, slot)} — ${slot.members.join(', ')} — ${position}`;
}

/** The empty state. A container with nothing in it reads as a bug. */
export function emptyState(message: string): ElementSpec {
  return element('p', { class: 'ig-empty' }, [message]);
}
