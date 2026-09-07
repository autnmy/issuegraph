/**
 * Graph geometry, computed — never eyeballed.
 *
 * Three columns, three jobs: the LEFT GUTTER holds open issues outside the
 * order that explain a hold, the CENTRE SPINE is the work order itself, and the
 * RIGHT GUTTER holds issues the order never works. Sequence is vertical
 * position on the spine; dependency is everything off it.
 *
 * Two rules carry most of the weight, and both come from the design's
 * implementation note rather than from taste:
 *
 *  - **Every edge endpoint is derived from a node's computed bounds.** An edge
 *    terminates ON a bound, never at a remembered offset, so a node that
 *    changes size moves its edges with it.
 *  - **Arcs stay out of the occupied x-ranges** and out of the station band.
 *    The colour-blind-safety claim rests on four redundant channels, and the
 *    terminal marker is the one that separates `decomposed-from` from
 *    `duplicate-of` — a marker hidden under an opaque card silently drops the
 *    encoding to three.
 *
 * Deterministic by construction: no measurement, no randomness, no clock. The
 * same document always produces the same coordinates, which is what lets a
 * panel whose job is to be authoritative be trusted between refreshes.
 */

import type { NormalizedDocument, ViewerEdge } from './document.ts';
import { cardBlocks, cardText } from './parts.ts';
import { type MetricToken, type Theme, defaultTheme } from './theme.ts';

/**
 * Custom properties carrying LAYOUT OUTPUT rather than theme input.
 *
 * A theme token is a value a host chooses; these are values this module
 * COMPUTES and writes onto individual elements, so the rail can sit on the node
 * it names without either side hard-coding a coordinate. They are declared here
 * so `styles.test.ts` can tell the two kinds apart — a `var()` naming neither a
 * theme token nor one of these is still a defect, and still fails.
 */
export const LAYOUT_PROPERTIES: readonly string[] = Object.freeze([
  '--ig-stage-w',
  '--ig-stage-h',
  '--ig-row-x',
  '--ig-row-y',
  '--ig-row-w',
  '--ig-row-h',
  // §16b's station column: a disc ON the spine line, to the LEFT of the card it
  // numbers. It was drawn inside the card, which is what made the picture a
  // column of rectangles rather than a spine — the sequence has to be readable
  // off one vertical line, and a number inside a box is not on a line.
  '--ig-station-x',
  '--ig-station-y',
  // Where each of the three column headings sits.
  '--ig-col-x',
]);

/** Which column a node sits in. */
export type Column = 'left' | 'spine' | 'right';

export interface NodeBox {
  readonly key: string;
  readonly column: Column;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The slot this node belongs to, when it is on the spine. */
  readonly rank: number | null;
  readonly held: boolean;
  /**
   * The runner is working this one NOW.
   *
   * §16b gives it the top station on the spine, above rank 1, because "what is
   * running" and "what is next" are the same question asked one step apart —
   * and a NOW row rendered above the canvas, which is what shipped, is off the
   * one line the whole sequence is supposed to read down.
   */
  readonly now?: boolean;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface GraphLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: ReadonlyMap<string, NodeBox>;
  /** Spine keys in RANK order — the order navigation walks. */
  readonly spineOrder: readonly string[];
  /** Slot lead -> the members drawn under it, in document order. */
  readonly slotMembers: ReadonlyMap<string, readonly string[]>;
  /** The free vertical channels arcs route through. */
  readonly leftChannel: number;
  readonly rightChannel: number;
  /**
   * The x of the spine LINE — the one vertical the whole sequence reads off.
   * Stations are centred on it and the cards sit to its right.
   */
  readonly spineLineX: number;
  /** Where the spine line starts and ends, so it spans the stations and no more. */
  readonly spineTop: number;
  readonly spineBottom: number;
  /** The x each of the three column headings is set at. */
  readonly columnX: Readonly<Record<Column, number>>;
  /**
   * The slot leads the canvas draws NOWHERE — runner-held, and blocking nothing
   * on the spine, so they explain nothing about the order. They are the graph's
   * half of §16a's footer group, and the projection renders them beneath the
   * stage as that group rather than on a column.
   */
  readonly footer: readonly string[];
  /** Whether this layout is the in-column preview or the full-width picture. */
  readonly compact: boolean;
}

function metric(theme: Theme, token: MetricToken): number {
  // FALLS BACK TO THE DEFAULT, AS A BACKSTOP RATHER THAN AS THE FIX.
  // `resolveTheme` fills a caller's theme at the entry points, which is where a
  // hole belongs closed; this covers the exported low-level functions a consumer
  // can reach directly with a theme built against an EARLIER version.
  //
  // A MISSING METRIC DOES NOT FAIL LOUDLY, which is what makes it worth a line:
  // it reads `undefined`, arithmetic on it yields `NaN`, and every comparison
  // against `NaN` is false — so a fitting check silently passes everything.
  // Measured when `--ig-label-char-width` was added: a 0.1.0 theme made every
  // measured width `NaN`, so a card's height came out `NaN` and every station
  // in the spine stacked at the same y.
  return theme.metrics[token] ?? defaultTheme.metrics[token];
}

/*
 * A CARD FILLS ITS COLUMN. It used to be sized to its own label and clamped to
 * the column, which made every card a different width and every edge terminate
 * at a different x — and the label was then fitted to that width and truncated.
 * §16b draws one width per column and lets the card grow DOWNWARDS instead, so
 * the arcs arrive on one vertical and nothing is cut.
 */
/**
 * The label as it fits the box the layout gave it.
 *
 * `boxWidth` CLAMPS to the column, so a title longer than the column gets a box
 * narrower than its text — and an SVG `<text>` neither wraps nor clips, so the
 * overflow ran straight across the routing channel and the neighbouring nodes,
 * hiding the edges and labels the graph exists to show. Long issue titles are
 * ordinary, so this was the common case rather than an edge one.
 *
 * IT MEASURES WITH THE LABEL'S OWN METRIC, WHICH `boxWidth` DELIBERATELY DOES
 * NOT. Both used to read `--ig-char-width` — documented as the MONO advance at
 * `--ig-font-size` — while `.ig-node-label` renders in `--ig-font-ui` at
 * `--ig-font-size-small`. That under-estimated wide glyphs and put the overflow
 * back: a 24-character all-capitals label "fitted" 187.2px of room and drew
 * about 240px, straight across the routing channel.
 *
 * THE ASYMMETRY IS PRINCIPLED RATHER THAN AN OVERSIGHT. Sizing a box wants a
 * TYPICAL width, so a box tracks its contents; deciding how much text to KEEP
 * must not overflow, so it wants a CEILING. `--ig-label-char-width` is that
 * ceiling, which makes this strictly more conservative than the box it draws
 * into — it can truncate a little early, and it cannot spill.
 *
 * IT IS STILL AN ESTIMATE, and the honest end state is not to have one: SVG
 * `<text>` neither wraps nor clips, so a canvas label positioned as HTML — the
 * way the rail's rows already are — would let CSS `text-overflow: ellipsis` use
 * the real font metrics and be Unicode-safe with no constant at all. That is a
 * layout change rather than a measurement one; see #44.
 *
 * THE ELLIPSIS IS THIS PACKAGE'S OWN TREATMENT, not a new convention: the rail's
 * HTML rows already resolve an over-long title with `text-overflow: ellipsis`,
 * so a canvas label that simply stopped mid-word would make the two surfaces
 * disagree about what a truncated title looks like.
 *
 * NOTHING IS LOST TO A READER — the full title stays in the node's accessible
 * name and its `<title>`, so this shortens what is DRAWN and never what is
 * available.
 */
/**
 * How wide one character runs, relative to the label face's AVERAGE advance.
 *
 * A COARSE MODEL OF A PROPORTIONAL FACE, and coarse is the point: a single
 * number cannot be right for both `WWWW` and `illi`, and picking one is how
 * this overflowed. Three classes are enough to make the two errors small in
 * the direction each matters.
 *
 * THE WIDE CLASS IS DELIBERATELY OVER-STATED. Truncating slightly early costs
 * a character; under-stating runs the label across the routing channel and
 * hides the edges the graph exists to show. `1.7` puts a capital near 10px at
 * the default 6px average, which is about what a UI sans draws at 11px.
 */
const WIDE_GLYPH = /[ABCDEFGHKLNOPQRSTUVXYZmw@%&MW]/u;
const NARROW_GLYPH = /[iIjl|!.,;:'`()[\]{} \t-]/u;

/**
 * A glyph that renders at roughly the full font size — CJK, Hangul, fullwidth
 * forms, and everything in the supplementary planes (emoji, mathematical
 * alphanumerics).
 *
 * WITHOUT THIS THE CLASSES ARE ASCII-ONLY, and a code point matching neither
 * was charged the plain average — so an emoji title was measured at 6px a
 * glyph while it draws near 11px. Measured: 31 emoji "fitted" 187.2px of room
 * and draw about 341px. That is a REGRESSION on the count this replaced, which
 * charged a supplementary character twice by accident of UTF-16 length; a model
 * has to earn that conservatism deliberately rather than inherit it.
 *
 * THE SUPPLEMENTARY TEST IS THE BROAD ONE ON PURPOSE. Emoji, and the alphabets
 * a title is most likely to reach this with, live above the BMP, and charging a
 * rare narrow supplementary glyph too much costs a character while charging an
 * emoji too little runs the label across the graph.
 */
function isFullWidth(glyph: string): boolean {
  const cp = glyph.codePointAt(0) ?? 0;
  return (
    cp > 0xffff ||
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  );
}

function labelWidth(glyphs: readonly string[], average: number): number {
  let total = 0;
  for (const glyph of glyphs) {
    // FULL-WIDTH FIRST: it is the only class that can overflow badly, and a
    // supplementary glyph must not fall through to the plain average because
    // the ASCII classes cannot see it.
    const scale = isFullWidth(glyph) ? 1.9 : WIDE_GLYPH.test(glyph) ? 1.7 : NARROW_GLYPH.test(glyph) ? 0.55 : 1;
    total += average * scale;
  }
  return total;
}

/**
 * How wide a drawn label runs.
 *
 * NOTHING TRUNCATES ANY MORE, and this is what replaced the function that did.
 * A node is an HTML card whose title wraps, so the question stopped being "how
 * much of this fits on one line" and became "how many lines does this need" —
 * which is what {@link layoutGraph} asks it, to give a card a height before
 * anything is rendered. `fitLabel` went with the truncation it existed to
 * perform: §16b's acceptance is that nothing truncates that the design draws in
 * full, and a helper that shortens a title had no caller left.
 *
 * IT IS A CEILING, per character class rather than a flat average — see
 * `labelWidth`. A card that reserves slightly too much leaves a gap; one that
 * reserves too little is overlapped by the next rank.
 */
export function measureLabel(theme: Theme, label: string): number {
  return labelWidth([...label], metric(theme, '--ig-label-char-width'));
}



/**
 * Assign every key that needs a box to a column.
 *
 * Totality is the requirement, not a nicety: every kept edge's endpoints must
 * have bounds or its geometry is undefined, and `normalizeDocument` has already
 * dropped the edges whose ends this document does not carry. Anything touched
 * by an edge and not on the spine therefore lands in a gutter — the right one
 * when the order deliberately never works it, the left one when it is an open
 * issue standing in the way.
 */
function assignColumns(
  document: NormalizedDocument,
  /**
   * The slot leads the runner is working right now.
   *
   * They are placed by {@link layoutGraph} at the top of the spine as §16b's
   * NOW station, so this pass must not ALSO place them — a key with two boxes
   * is the one-element-per-key rule broken, whichever column the second one
   * lands in.
   */
  running: ReadonlySet<string>,
): {
  spine: string[];
  left: string[];
  right: string[];
  footer: string[];
  slotMembers: Map<string, readonly string[]>;
} {
  // ONE BOX PER SLOT, NOT PER MEMBER. §16b draws a together unit as ONE card
  // with the members listed inside it, and the frame's own vocabulary table
  // calls the enclosure "distinct issues forming one unit of work". Giving each
  // member its own box and drawing a dashed rectangle round the pair says
  // something weaker and costs the spine a station: the unit occupied two rows
  // of a column whose vertical position IS the rank, so two boxes claimed two
  // ranks for one. `slotMembers` is how the card knows what to list.
  //
  // AND ONLY THE SLOTS THAT ARE IN THE ORDER. A slot the RUNNER holds — claimed,
  // parked — is not a fact about the work and earns no rank, which §16a says by
  // collecting it in a footer group. Drawing it on the spine gave it a position
  // in a column whose vertical position IS the sequence, so a parked issue was
  // drawn as a step in the work order with a dash where its number should be.
  const spine: string[] = [];
  const footerLeads: string[] = [];
  const slotMembers = new Map<string, readonly string[]>();
  const placed = new Set<string>();
  for (const slot of document.order.slots) {
    slotMembers.set(slot.lead, slot.members);
    for (const member of slot.members) placed.add(member);
    if (running.has(slot.lead)) continue;
    (slot.holds.some((hold) => hold.family === 'tracker') ? footerLeads : spine).push(slot.lead);
  }

  const neverWorked = new Set(document.order.excluded.map((exclusion) => exclusion.key));
  for (const edge of document.edges) {
    if (edge.field !== 'decomposed-from') continue;
    const origin = document.byKey.get(edge.to);
    if (origin !== undefined && !origin.open && !placed.has(edge.to)) neverWorked.add(edge.to);
  }

  // Which keys stand on the spine, for the "does this explain a hold" test
  // below. A member is represented by its slot's lead.
  const onSpine = new Set<string>();
  for (const lead of spine) for (const member of slotMembers.get(lead) ?? [lead]) onSpine.add(member);

  // EVERY MEMBER'S EDGES, NOT JUST THE LEAD'S. A together unit is one card and
  // its partners get no card of their own, so a unit that blocks a ranked issue
  // THROUGH its partner read as touching nothing and was sent to the footer —
  // the graph then lost both the gutter card and the arc that explains the
  // hold. The same rule the lateral axis already applies for the same reason.
  const touchesSpine = (lead: string): boolean =>
    (slotMembers.get(lead) ?? [lead]).some((member) =>
      (document.edgesOf.get(member) ?? []).some((edge) =>
        onSpine.has(edge.from === member ? edge.to : edge.from),
      ),
    );

  const left: string[] = [];
  const right: string[] = [];
  const footer: string[] = [];

  // A HELD SLOT THE ORDER DOES NOT RANK IS EITHER AN EXPLANATION OR A FOOTNOTE,
  // and §16b's left column heading — "Explains the order" — is the test. A
  // parked issue that BLOCKS a ranked one is the answer to "why isn't my P1
  // running", so it is drawn beside the spine; one that blocks nothing on the
  // spine explains nothing about it, and belongs in the footer group with the
  // duplicates. That is the documented reading of §16b's "open issues outside
  // the order that explain a hold" — outside the order is the runner's hold,
  // and explaining is the edge.
  for (const lead of footerLeads) {
    (touchesSpine(lead) ? left : footer).push(lead);
  }

  // THE RUNNING KEYS TOO. A job with no slot is placed by `layoutGraph` as the
  // NOW station and is therefore absent from `placed` — so an edge touching it
  // sent it to a gutter as well. In the expanded graph the gutter box then
  // overwrote the spine one and the NOW marker vanished; in compact mode, where
  // the gutters are not drawn, the key appeared as a card AND as a footer row.
  // Both are the same fault: one key, two boxes.
  const seen = new Set([...placed, ...running, ...left, ...footer]);
  for (const edge of document.edges) {
    for (const end of [edge.from, edge.to]) {
      if (seen.has(end)) continue;
      seen.add(end);
      (neverWorked.has(end) ? right : left).push(end);
    }
  }
  for (const key of neverWorked) {
    if (seen.has(key)) continue;
    seen.add(key);
    right.push(key);
  }

  return { spine, left, right, footer, slotMembers };
}

/**
 * How tall a card is, counted rather than measured.
 *
 * COUNTED FROM THE CARD'S OWN DESCRIPTION — see `CardBlock`. It used to be
 * counted from a second reading of what the projection draws, and four times
 * running a block was added to the drawing and not to the count: the badge row
 * wrapped and was charged one line, a unit in the gutter was sized as a single
 * issue, the unit branch returned before the notes, and the NOW banner was
 * added with no allowance at all. Each time the card overran its box, the next
 * card was drawn over the overflow, and the arcs stayed anchored to geometry
 * nobody drew. A block added to `cardBlocks` now reaches this by construction.
 *
 * Counted rather than MEASURED because this module is pure and deterministic:
 * the same document must produce the same coordinates on a server with no fonts
 * as in a browser with them. It rounds up, for the reason {@link measureLabel}
 * gives about its own metric — a card that reserves slightly too much leaves a
 * gap, and one that reserves too little is overlapped by the next rank.
 */
function cardHeight(
  theme: Theme,
  document: NormalizedDocument,
  key: string,
  width: number,
  members: readonly string[],
  onSpine: boolean,
  now: boolean,
): number {
  const pad = metric(theme, '--ig-space') * 2;
  const line = metric(theme, '--ig-card-line');
  const gap = metric(theme, '--ig-space-tight');
  const memberPad = metric(theme, '--ig-space-snug') * 2;
  const inner = Math.max(1, width - metric(theme, '--ig-space') * 2);
  // A UNIT'S TITLES SIT INSIDE ANOTHER BOX. `.ig-unit` has its own border and
  // `.ig-unit-member` its own inline padding, so measuring a member's title at
  // the CARD's inner width let a title near the boundary take a line the
  // reservation did not have.
  const unitInner = Math.max(
    1,
    inner - memberPad - metric(theme, '--ig-stroke-connector') * 2,
  );

  const blocks = cardBlocks(document, key, members, onSpine, now);
  let height = pad;
  blocks.forEach((block, index) => {
    if (index > 0) height += gap;
    if (block.kind === 'badges') {
      // A CHIP IS TALLER THAN ITS TEXT, and the rows are spaced. `.ig-badge`
      // adds its own vertical padding and border, and `.ig-badges` puts a gap
      // between wrapped rows — so `rows * line` under-reserved a wrapping badge
      // row by more than the gap between cards, and the card beneath was drawn
      // over it.
      const rows = packedRows(theme, block.texts, inner);
      const chipHeight =
        line + metric(theme, '--ig-space-micro') * 2 + metric(theme, '--ig-stroke') * 2;
      height += rows * chipHeight + Math.max(0, rows - 1) * gap;
      return;
    }
    const width = block.kind === 'unit' ? unitInner : inner;
    height += cardText(document, block).reduce(
      (total, text) => total + Math.max(1, Math.ceil(measureLabel(theme, text) / width)) * line,
      0,
    );
    if (block.kind === 'unit') {
      // The enclosure pads each member's pair on both sides, puts a gap between
      // the title and the identity, and rules between members.
      height +=
        block.members.length * (memberPad + metric(theme, '--ig-space-micro')) +
        Math.max(0, block.members.length - 1) * metric(theme, '--ig-stroke');
    }
  });
  // A DELIBERATE OVER-RESERVATION, and it is the structural half of this rule.
  // A pure layout cannot MEASURE text, so every height here is an estimate, and
  // an estimate can always be wrong by some box-model detail the counter does
  // not mirror — six review rounds found six of them. What matters is which way
  // it is wrong: a card positioned absolutely that reserves too little is
  // OVERLAPPED by the next rank, which is a legibility failure, while one that
  // reserves too much leaves a gap nobody minds. One line of slack per card
  // turns the next such miss into the harmless kind.
  return height + line;
}

/**
 * How many rows a wrapping row of chips takes.
 *
 * THE BADGE ROW WRAPS, AND IT IS WHAT OVERFLOWED FIRST. A row of chips was
 * counted as one line however many chips it held, so a card with four
 * relationships reserved the height of a card with one and the two beneath it
 * were drawn over. Packed here rather than assumed: each chip is its own text
 * plus its padding, laid into the card's inner width.
 */
function packedRows(theme: Theme, texts: readonly string[], inner: number): number {
  if (texts.length === 0) return 0;
  const gap = metric(theme, '--ig-space-tight');
  // THE CHIP'S OWN INNER GAP, TOO. A relationship or status chip is a glyph and
  // a label — two children with `gap: var(--ig-space-tight)` between them — and
  // measuring the concatenated text plus the outer padding alone under-measured
  // every one of them. Near a row boundary the browser then wrapped a chip this
  // packer had kept on the previous row, the height omitted that whole row, and
  // the cards beneath were drawn over it.
  const chipPadding = gap * 3 + metric(theme, '--ig-stroke') * 2;
  let used = 0;
  let rows = 1;
  for (const text of texts) {
    const chip = measureLabel(theme, text) + chipPadding;
    if (used > 0 && used + gap + chip > inner) {
      rows += 1;
      used = chip;
    } else {
      used += (used > 0 ? gap : 0) + chip;
    }
  }
  return rows;
}

/**
 * Lay a document out. Pure: coordinates depend only on the document, the theme
 * and the size.
 *
 * COMPACT IS A SIZE, NOT A DEGRADED MODE. §16b is explicit that at a settings
 * column's width the arcs and both gutters cannot be drawn legibly, so the
 * in-column case is a spine-only preview with an expand affordance rather than
 * the same picture squeezed. Expressed as a zero-width gutter, so exactly one
 * layout computes both and the spine's own geometry cannot differ between them.
 */
export function layoutGraph(
  document: NormalizedDocument,
  theme: Theme,
  compact = false,
): GraphLayout {
  const gap = metric(theme, '--ig-space-loose');
  const gutterWidth = compact ? 0 : metric(theme, '--ig-gutter-width');
  const spineWidth = metric(theme, '--ig-spine-width');
  const channelWidth = compact ? metric(theme, '--ig-space') : metric(theme, '--ig-gutter-width') / 2;
  const stationBox = metric(theme, '--ig-station-box');
  // Room above the first card for the three column headings, which say what
  // each column is FOR. Without them the gutters read as two more piles of
  // issues rather than as the two answers the spine deliberately keeps off it.
  const headroom = metric(theme, '--ig-space-wide') + metric(theme, '--ig-space-loose');
  // THE CANVAS RESERVES WHAT THE ENCLOSURE NEEDS, AND WHAT THE FOCUS RING DOES.
  // The focus ring sits `--ig-space-tight` clear of an element and is
  // `--ig-focus-ring` thick, so it extends their SUM outward and was clipped by
  // the stage, which hides its overflow. A partial ring is exactly the indicator
  // a keyboard reader depends on.
  // SUMMED FROM THE TOKENS, never written as 8: geometry is theme data in this
  // package, so a retheme that changes either token moves the reservation with
  // it instead of silently reintroducing the clip.
  const pad = metric(theme, '--ig-space-tight') + metric(theme, '--ig-focus-ring');

  // THE RUNNING JOBS LEAD THE SPINE — §16b's NOW station, above rank 1, because
  // "what is running" and "what is next" are one question asked a step apart.
  //
  // WHATEVER SLOT THEY HOLD. A job is usually running BECAUSE a runner claimed
  // it, so its slot is tracker-held and off the spine by construction. Skipping
  // a job that held any slot kept it out of two boxes and left it in NO NOW
  // state at all: the graph drew a generic footer row for the one issue the
  // panel exists to say is in flight. Placing it here and skipping it in
  // `assignColumns` is what gives it exactly one box, which is the rule `mount`
  // indexes on.
  //
  // BY THE SLOT'S LEAD. A together unit is one card, so a running PARTNER marks
  // the unit rather than taking a card the projection has no station for.
  const nowKeys: string[] = [];
  for (const job of document.host.running) {
    const lead = document.order.slots.find((slot) => slot.members.includes(job.key))?.lead ?? job.key;
    if (!nowKeys.includes(lead)) nowKeys.push(lead);
  }
  const { spine, left, right, footer, slotMembers } = assignColumns(document, new Set(nowKeys));

  const leftX = pad;
  // THE STATION COLUMN SITS BETWEEN THE CHANNEL AND THE CARDS, and the spine
  // line runs down its centre. §16b puts the line at x=392, the 26px station at
  // 379 (so the line bisects it) and the card at 418 — the card starts where
  // the station ends. Expressed from the tokens so a retheme moves all three.
  const spineLineX = pad + gutterWidth + channelWidth + stationBox / 2;
  const spineX = spineLineX + stationBox / 2 + metric(theme, '--ig-space');
  const rightX = spineX + spineWidth + channelWidth;
  const width = compact ? spineX + spineWidth + pad : rightX + gutterWidth + pad;

  // The channels sit between the columns, so no arc routed through one can
  // cross an occupied x-range.
  const leftChannel = pad + gutterWidth + channelWidth / 2;
  const rightChannel = spineX + spineWidth + channelWidth / 2;

  const rankOf = new Map<string, number | null>();
  const heldOf = new Map<string, boolean>();
  for (const slot of document.order.slots) {
    for (const member of slot.members) {
      rankOf.set(member, slot.rank);
      heldOf.set(member, !slot.ready);
    }
  }

  const nodes = new Map<string, NodeBox>();

  // THE SPINE IS STACKED FIRST, because it is the sequence and everything else
  // is positioned against it. Each card takes the height its own contents need,
  // so the gaps between stations vary — which is what §16b draws, and what a
  // fixed row height cannot express once a unit card lists two issues.
  let y = pad + headroom;
  const stacked = [...nowKeys, ...spine];
  for (const key of stacked) {
    const members = slotMembers.get(key) ?? [key];
    const height = cardHeight(theme, document, key, spineWidth, members, true, nowKeys.includes(key));
    nodes.set(key, {
      key,
      column: 'spine',
      x: spineX,
      y,
      width: spineWidth,
      height,
      rank: rankOf.get(key) ?? null,
      held: heldOf.get(key) ?? false,
      now: nowKeys.includes(key),
    });
    y += height + gap;
  }
  const spineBottom = stacked.length === 0 ? pad + headroom : y - gap;

  // A GUTTER CARD SITS BESIDE THE SPINE ROW IT EXPLAINS. Stacking the gutters
  // from the top independently, which is what shipped, drew #470 beside rank 3
  // and its arc across four cards to reach rank 1 — the arcs then crossed the
  // spine, which is the one thing §16b's whole layout exists to prevent. The
  // partner is whichever spine node an edge joins it to; a gutter node with no
  // spine partner falls in behind the ones that have one.
  const partnerY = (key: string): number | undefined => {
    // EVERY MEMBER'S EDGES, as the classification and the lateral axis already
    // do. A tracker-held unit reaches the gutter because a NON-LEAD member
    // blocks a ranked row — that is the whole case — and looking the partner up
    // through the lead alone then found nothing, dropped the card at the
    // fallback top row, and drew exactly the long cross-row arc this pass
    // exists to prevent. Three passes asking the same question about a unit
    // have to ask it the same way.
    const mine = new Set(slotMembers.get(key) ?? [key]);
    for (const edge of document.edges) {
      const other = mine.has(edge.from) ? edge.to : mine.has(edge.to) ? edge.from : undefined;
      if (other === undefined || mine.has(other)) continue;
      // THE SLOT'S LEAD, OR THE KEY ITSELF. An unslotted running job has a
      // spine box of its own — it is the NOW station — and searching `slots`
      // alone could not resolve it, so a gutter card explaining the SECOND of
      // two running jobs fell back beside the first row and drew exactly the
      // cross-row arc this pass exists to prevent.
      const station = document.order.slots.find((slot) => slot.members.includes(other))?.lead ?? other;
      const box = nodes.get(station);
      // A SPINE PARTNER, NEVER A GUTTER ONE. The right gutter is placed after
      // the left, so by then a left card has a box too — and aligning a right
      // card to a left one would chain two alignments and drift both away from
      // the row they are supposed to explain.
      if (box !== undefined && box.column === 'spine') return box.y;
    }
    return undefined;
  };

  const placeGutter = (keys: readonly string[], column: Column, x: number): void => {
    let fallback = pad + headroom;
    // SORTED BY THE ROW THEY EXPLAIN, so two gutter cards never swap places
    // relative to the spine and then need arcs that cross each other.
    const ordered = [...keys].sort(
      (a, b) => (partnerY(a) ?? Number.POSITIVE_INFINITY) - (partnerY(b) ?? Number.POSITIVE_INFINITY),
    );
    let lowest = pad + headroom;
    for (const key of ordered) {
      // THE SLOT'S MEMBERS, as the spine placement already does. A tracker-held
      // together unit can land in the gutter, and `nodeCard` reads
      // `slotMembers` there too — so sizing it as a single issue reserved a
      // fraction of the markup it draws, and the next gutter card was placed on
      // top of the difference.
      const height = cardHeight(theme, document, key, gutterWidth, slotMembers.get(key) ?? [key], false, false);
      // Never above the previous card in the same gutter: an alignment that
      // would overlap gives way to the stack, because a hidden card explains
      // nothing at all.
      const wanted = partnerY(key) ?? fallback;
      const top = Math.max(wanted, lowest);
      nodes.set(key, {
        key,
        column,
        x,
        y: top,
        width: gutterWidth,
        height,
        rank: null,
        held: heldOf.get(key) ?? false,
      });
      lowest = top + height + gap;
      fallback = lowest;
    }
  };

  // NOTHING SITS IN A GUTTER THAT HAS NO WIDTH. In compact mode the gutter
  // cards and every arc are dropped rather than drawn at a width that cannot
  // carry them — the expand affordance is how a reader gets to them, which is
  // what §16b says in as many words.
  if (!compact) {
    placeGutter(left, 'left', leftX);
    placeGutter(right, 'right', rightX);
  }

  let bottom = spineBottom;
  for (const box of nodes.values()) bottom = Math.max(bottom, box.y + box.height);
  const height = nodes.size === 0 ? 0 : bottom + pad;

  return {
    width,
    height,
    nodes,
    spineOrder: stacked,
    slotMembers,
    leftChannel,
    rightChannel,
    spineLineX,
    spineTop: pad + headroom,
    spineBottom,
    columnX: Object.freeze({ left: leftX, spine: spineX, right: rightX }),
    // In compact mode the gutters are not drawn, so the issues that would have
    // sat in them join the footer group — absent from the picture, present in
    // the panel, which is the difference between a smaller view and a lying one.
    footer: compact ? [...footer, ...left, ...right] : footer,
    compact,
  };
}

export interface EdgeGeometry {
  /** The SVG path. Always a quadratic through one of the free channels. */
  readonly d: string;
  readonly start: Point;
  readonly end: Point;
  /**
   * The quadratic's control point — the one `d` bows through.
   *
   * Published so a caller that needs a point ON the curve can solve for one
   * rather than estimate it from the chord. The midpoint of a quadratic is
   * `¼P₀ + ½C + ¼P₂`, which is a different point from the chord's midpoint
   * wherever the curve actually bows, and the difference is the whole width of
   * a channel.
   */
  readonly control: Point;
  /** Radians. Orients the terminal marker along the path's own tangent. */
  readonly endAngle: number;
}

/**
 * Where an edge leaves and enters, in the fraction of a box's height it uses.
 *
 * Departures leave low and arrivals enter high, so a path never runs along the
 * centre line where the readiness station sits. That is the design's
 * station-collision rule expressed as two numbers instead of a special case.
 */
const DEPART_FRACTION = 0.75;
const ARRIVE_FRACTION = 0.25;

/**
 * Which bound of `box` the edge should leave from or arrive at.
 *
 * PAIRWISE, NOT PER-COLUMN, and the difference is the whole correctness of the
 * drawing. Deciding from a box's own column alone made every spine endpoint the
 * LEFT bound — so an arc to the right gutter left the spine on its far side and
 * had to cross the node to reach its own terminal, occluding exactly the marker
 * the colour-blind-safety claim depends on.
 *
 * ON A TIE, FACE THE CHANNEL. Two nodes in the same column have the same x, so
 * "face the other" says nothing — and defaulting LEFT was right for the spine
 * only by coincidence: the left channel happens to sit left of it. For two
 * left-gutter nodes the same channel is on their RIGHT, so the default sent
 * both endpoints out of the canvas and dragged the path back across the boxes.
 * Facing the channel is the rule the spine case was an instance of, so it keeps
 * "arcs bow left of the spine" while fixing the gutter.
 */
function facingSide(box: NodeBox, other: NodeBox, channelX: number): 'left' | 'right' {
  const centre = box.x + box.width / 2;
  const otherCentre = other.x + other.width / 2;
  if (otherCentre !== centre) return otherCentre > centre ? 'right' : 'left';
  return channelX > centre ? 'right' : 'left';
}

function anchor(box: NodeBox, fraction: number, side: 'left' | 'right'): Point {
  return {
    x: side === 'left' ? box.x : box.x + box.width,
    y: box.y + box.height * fraction,
  };
}

/**
 * The geometry for one edge, derived entirely from the two boxes' bounds.
 *
 * Returns `null` when either end has no box — which `normalizeDocument` has
 * already made impossible for a kept edge, so a `null` here means a caller
 * built a layout from a different document than the edge came from. Refusing is
 * better than drawing at coordinates nobody computed.
 */
/** The box a key is drawn on: its own, or the card of the unit it belongs to. */
function stationFor(layout: GraphLayout, key: string): string {
  if (layout.nodes.has(key)) return key;
  for (const [lead, members] of layout.slotMembers) {
    if (members.includes(key)) return lead;
  }
  return key;
}

export function edgeGeometry(
  layout: GraphLayout,
  edge: ViewerEdge,
): EdgeGeometry | null {
  // AN ENDPOINT IS RESOLVED TO THE BOX THAT REPRESENTS IT. With one card per
  // slot, a together unit's partner has no box of its own — so an edge naming
  // the partner looked up `undefined` and was silently dropped, and the
  // fixture's `104 decomposed-from 107` disappeared from the canvas entirely.
  // The card is what stands for the member, so the card is what the arc lands
  // on. An edge whose two ends resolve to the SAME card is drawn inside it, and
  // answers `null` here rather than as a zero-length arc.
  const from = layout.nodes.get(stationFor(layout, edge.from));
  const to = layout.nodes.get(stationFor(layout, edge.to));
  if (from === undefined || to === undefined || from.key === to.key) return null;

  // The channel is chosen FIRST, because on a same-column tie it is what
  // decides which bound each endpoint uses. A pair of spine nodes bows LEFT, as
  // the design fixes; anything touching the right gutter uses the right channel
  // so the two families never tangle.
  const usesRight = from.column === 'right' || to.column === 'right';
  const controlX = usesRight ? layout.rightChannel : layout.leftChannel;

  const start = anchor(from, DEPART_FRACTION, facingSide(from, to, controlX));
  const end = anchor(to, ARRIVE_FRACTION, facingSide(to, from, controlX));
  const controlY = (start.y + end.y) / 2;

  const round = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);
  const d = `M ${round(start.x)} ${round(start.y)} Q ${round(controlX)} ${round(controlY)} ${round(end.x)} ${round(end.y)}`;

  return {
    d,
    start,
    end,
    control: { x: controlX, y: controlY },
    endAngle: Math.atan2(end.y - controlY, end.x - controlX),
  };
}
