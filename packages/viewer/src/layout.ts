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
import { badgeTexts } from './parts.ts';
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
  // Measured when `--ig-label-char-width` was added: a 0.1.0 theme made
  // `fitLabel` return a 60-character title with an ellipsis APPENDED, which is
  // worse overflow than the defect that token was added to fix.
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
function assignColumns(document: NormalizedDocument): {
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

  const touchesSpine = (key: string): boolean =>
    (document.edgesOf.get(key) ?? []).some((edge) =>
      onSpine.has(edge.from === key ? edge.to : edge.from),
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

  const seen = new Set([...placed, ...left, ...footer]);
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
 * A card's contents are known — a title that may wrap, an identity line, a
 * badge row, and for a unit one pair of lines per member — so its height is a
 * count of lines times `--ig-card-line`. Counted, not measured, because this
 * module is pure and deterministic: the same document must produce the same
 * coordinates on a server with no fonts as in a browser with them.
 *
 * IT ROUNDS UP, for the reason {@link fitLabel} gives about its own metric. A
 * card that reserves slightly too much leaves a gap; one that reserves too
 * little is overlapped by the row beneath it, and the row beneath it is the
 * next rank.
 */
function cardHeight(
  theme: Theme,
  document: NormalizedDocument,
  key: string,
  width: number,
  members: readonly string[],
  onSpine: boolean,
): number {
  const pad = metric(theme, '--ig-space') * 2;
  const line = metric(theme, '--ig-card-line');
  const gap = metric(theme, '--ig-space-tight');
  const inner = Math.max(1, width - metric(theme, '--ig-space') * 2);
  const lines = (text: string): number =>
    Math.max(1, Math.ceil(measureLabel(theme, text) / inner));

  const slot = document.order.slots.find((candidate) => candidate.lead === key);
  const issue = document.byKey.get(key);
  // THE BADGE ROW WRAPS, AND IT IS WHAT OVERFLOWED. A row of chips was counted
  // as one line however many chips it held, so a card with four relationships
  // reserved the height of a card with one and the two beneath it were drawn
  // over. Packed here rather than assumed: each chip is its own text plus its
  // padding, laid into the card's inner width.
  const chips = badgeTexts(document, slot, issue, members);
  const chipPadding = metric(theme, '--ig-space-tight') * 2 + metric(theme, '--ig-stroke') * 2;
  let used = 0;
  let badgeRows = chips.length === 0 ? 0 : 1;
  for (const chip of chips) {
    const chipWidth = measureLabel(theme, chip) + chipPadding;
    if (used > 0 && used + gap + chipWidth > inner) {
      badgeRows += 1;
      used = chipWidth;
    } else {
      used += (used > 0 ? gap : 0) + chipWidth;
    }
  }
  const badgeBlock = badgeRows === 0 ? 0 : gap + badgeRows * line;

  // A UNIT'S CARD IS ITS PILL, ITS ENCLOSURE AND ITS MEMBERS. Sizing it as an
  // ordinary card is what let two issues be drawn in the space of one title.
  if (members.length > 1) {
    const memberPad = metric(theme, '--ig-space-snug') * 2;
    const enclosure = members.reduce(
      (total, member) =>
        total +
        memberPad +
        (lines(document.byKey.get(member)?.title ?? member) + 1) * line,
      0,
    );
    return pad + line + gap + enclosure + badgeBlock;
  }

  const title = document.byKey.get(key)?.title ?? key;
  // THE SENTENCES A GUTTER CARD PRINTS. A spine card carries its hold on a chip
  // and a tooltip, because the list beside it prints the sentence — but a
  // gutter card is the ONLY mark this projection draws for its issue, and §16b
  // prints "open · not eligible" on it in as many words. Counted here or the
  // sentence is drawn over the card beneath.
  const sentences = onSpine ? 0 : notes(document, key).length;
  return pad + lines(title) * line + line + badgeBlock + (sentences === 0 ? 0 : gap + sentences * line);
}

/**
 * The sentences a card off the spine prints: why it is held, and what it
 * duplicates.
 *
 * ONE RULE, TWO READERS — the layout counts them and the projection draws them,
 * so a card cannot reserve room for one sentence and print two.
 */
export function notes(document: NormalizedDocument, key: string): readonly string[] {
  const lines: string[] = [];
  for (const slot of document.order.slots) {
    if (slot.lead !== key) continue;
    for (const hold of slot.holds) lines.push(hold.reason);
  }
  for (const exclusion of document.order.excluded) {
    // THE BADGE ALREADY NAMES THE CANONICAL, so the sentence says only what the
    // badge cannot: that this issue is never worked at all.
    if (exclusion.key === key) lines.push('never worked — the canonical is worked instead');
  }
  return lines;
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

  const { spine, left, right, footer, slotMembers } = assignColumns(document);

  // THE RUNNING JOBS LEAD THE SPINE. `normalizeHost` has already dropped any
  // job this document does not carry, and a job that also holds a slot keeps
  // its slot — the station it already has is the one the sequence reads.
  const nowKeys = document.host.running
    .map((job) => job.key)
    .filter((key) => !spine.includes(key));

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
    const height = cardHeight(theme, document, key, spineWidth, members, true);
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
    for (const edge of document.edges) {
      const other = edge.from === key ? edge.to : edge.to === key ? edge.from : undefined;
      if (other === undefined) continue;
      const station = document.order.slots.find((slot) => slot.members.includes(other))?.lead;
      const box = station === undefined ? undefined : nodes.get(station);
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
      const height = cardHeight(theme, document, key, gutterWidth, [key], false);
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
    endAngle: Math.atan2(end.y - controlY, end.x - controlX),
  };
}
