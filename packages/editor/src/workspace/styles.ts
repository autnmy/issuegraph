/**
 * The workspace's structural stylesheet: three fixed zones, and nothing else.
 *
 * Same contract as the viewer's, the ladder's and the re-evaluate surface's —
 * layout, weight and state, never a value. Every colour, length and font is a
 * `var(--ig-…)` the host's theme resolves, and `styles.test.ts` scans these
 * bytes for a literal or an unresolvable token.
 *
 * ## Fixed, and that is the requirement
 *
 * §17f gives the rail and the canvas opposite obligations — the rail is
 * complete at any backlog size, the canvas refuses above its budget — and
 * assembling them must not average the two. Positions are therefore FIXED
 * rather than negotiated: `grid-template-columns` gives the rail and the
 * inspector their own tracks and the canvas the remaining `1fr`, so a large
 * document grows the canvas's refusal rather than squeezing the rail out of
 * the layout.
 *
 * The rail scrolls in its own track. That is what makes windowing a rendering
 * decision rather than a visible one: the reader scrolls a complete order, and
 * which slice is currently drawn is the host's business.
 *
 * ## Dark only, with no forked token set
 *
 * Light was cut after pass 1, so there is no second palette here and no
 * `prefers-color-scheme` block. The single palette is the viewer's, reached
 * through its custom properties — a forked set would be exactly the drifting
 * second implementation the package split exists to remove.
 *
 * ## No animation, anywhere
 *
 * §17a: the audit is ambient, and a count that animates is a count demanding
 * attention it has not earned. The re-evaluate surface already rejected the
 * animated re-sort for a stronger reason — rows moving under the cursor mean
 * the next edit targets the wrong thing — and this is the file where both
 * could creep back in without touching a line of TypeScript.
 */

export const workspaceStylesheet = `
.ig-workspace {
  display: grid;
  /* HEADER SPANS, THE THREE ZONES SIT UNDER IT. The audit count is ambient: it
     belongs to the whole workspace rather than to one zone, and putting it in a
     zone's own track would make it move when that zone resized. */
  grid-template-areas:
    'header header header'
    'rail canvas inspector';
  /* The rail and the inspector are sized in TYPE, not in pixels: a host that
     scales the type scales the zones with it, which a fixed track would not.

     A LENGTH TIMES A UNITLESS COUNT, which is the viewer's own idiom
     (styles.ts writes min-width: calc(var(--ig-char-width) * 4)). An earlier
     version multiplied --ig-char-width by --ig-label-char-width, having read
     the second as "how many characters wide a label is". It is not: it is the
     average width OF one character, and themeCss renders every metric with px
     — so the expression was calc(7.8px * 6px), which is not a length. CSS
     discards a declaration it cannot parse, so the whole template went with it
     and all three zones fell back to auto columns: long content could then
     squeeze the canvas, which is the one thing fixed positions exist to stop.
     Nothing failed loudly, because an invalid declaration is simply absent.

     40 is a reading measure for a title plus its id, in characters. */
  grid-template-columns:
    calc(var(--ig-char-width) * 40)
    1fr
    calc(var(--ig-char-width) * 40);
  grid-template-rows: auto 1fr;
  gap: var(--ig-space);
  background: var(--ig-bg);
  color: var(--ig-text-body);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
}

.ig-zone {
  min-width: 0;
  /* Without this a long title in any zone sets that track's minimum width and
     the grid stops honouring its own template. */
  min-height: 0;
}

.ig-zone[data-zone='header'] {
  grid-area: header;
}

/* SECTION 17a's HEADER: what backlog this is, how much of it is encoded, what
   is wrong with it, how fresh the read is, and the way into a first pass. One
   row, baseline-aligned, with the first-pass entry pushed to the far end --
   the frame's only primary action on this surface.

   NOTHING HERE MOVES, for the reason the whole sheet holds: the audit count
   lives in this row, and section 17d asks for a count that never does. The
   guard on that is a literal scan over these bytes, comments included, so the
   words it looks for must not appear even in prose explaining their absence. */
.ig-workspace-header {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--ig-space);
  padding: var(--ig-space-tight) var(--ig-space);
  border-bottom: var(--ig-stroke) solid var(--ig-line);
}

.ig-workspace-identity {
  color: var(--ig-text);
  font-family: var(--ig-font-mono);
}

/* The one place the accent is spent on this surface, on the only action that
   starts something. The frame draws it as the header's primary control. */
.ig-workspace-firstpass {
  margin-left: auto;
  background: var(--ig-accent);
  color: var(--ig-bg);
  border: none;
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight) var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  cursor: pointer;
}

.ig-zone[data-zone='rail'] {
  grid-area: rail;
  /* The rail scrolls; the window slides underneath. */
  overflow-y: auto;
  border-right: var(--ig-stroke) solid var(--ig-line);
}

.ig-zone[data-zone='canvas'] {
  grid-area: canvas;
  overflow: auto;
}

.ig-zone[data-zone='inspector'] {
  grid-area: inspector;
  overflow-y: auto;
  border-left: var(--ig-stroke) solid var(--ig-line);
}

/* THE AMBIENT LEFT-BAR. A 2px gold rule on the affected row and nothing else —
   no fill, no icon, no badge. §17a's whole ask is that encoding errors stay
   visible while you work rather than pulling you out of it.

   An inset box-shadow rather than a border: a border changes the row's box and
   would shift every marked row against its neighbours, which is a layout jump
   the eye reads as movement.

   IT DREW A 330px CYAN BLOCK UNTIL #122, and the comment above it — unchanged
   here because it was right — is how the defect survived. --ig-spine-width is
   §16b's SPINE CARD WIDTH (330), not a stroke; the sentence "the width is the
   theme's spine, so the bar scales with the rest of the rail" reads as a
   scaling argument and is a token mix-up. --ig-accent is the cyan the panel
   spends once on the number an operator acts on, and it is not the attention
   colour. This rule is more specific than audit/styles.ts's correct one, so
   it silently won.

   AND ITS TEST PASSED THROUGHOUT. styles.test.ts matched the rule and
   asserted it EXISTED; it never asserted what the declaration resolves to, so
   it was green about a string rather than about a property. The test below it
   now reads the values.

   ONE TREATMENT FOR ALL FOUR SEVERITIES, which is also a correction. §17d
   names exactly one ambient mark — "a 2px gold left-bar on the affected rail
   row" — and puts the severity distinction in the findings list, which is
   host-side. The misleading variant this replaces gave the LEAST urgent
   severity ("clearing is bookkeeping, not urgency") the alarm colour while
   every other finding got cyan, inverting the design it came from. */
.ig-zone[data-zone='rail'] [data-ig-audit] {
  box-shadow: inset var(--ig-stroke-audit) 0 0 0 var(--ig-edge-serialize-with);
}

/* THE ROWS OUTSIDE THE WINDOW, AS HEIGHT. The rail scrolls, so without a spacer
   at each end the container is exactly as tall as the drawn rows and native
   scrolling stops at the end of the first window — leaving a host no offset to
   turn into the next start, and a reader no way to reach rank 287 of 312.

   NO BACKTICKS ANYWHERE IN THIS FILE'S COMMENTS. The stylesheet is a template
   literal, so a backtick closes it — and the failure is a parse error pages
   away from the character that caused it.

   THE PITCH IS THE OUTER BOX, NOT THE ROW HEIGHT. A .ig-slot is
   min-height: --ig-row-height PLUS margin-bottom: --ig-space-tight, so
   row-to-row is the sum of the two. Sized on --ig-row-height alone, this
   undercounted EVERY omitted row by the gap — 44 of a 50px pitch on the default
   theme, so 300 omitted rows left the scroll extent 1,800px short and a host
   dividing its scroll position by the measured pitch could reach about offset
   264 of 300. The tail of the order became unreachable by the very mechanism
   added to make it reachable.

   That is a SYSTEMATIC undercount, not the approximation below, which is why it
   is corrected exactly rather than tolerated: the gap is constant per row and
   both terms are theme metrics.

   --ig-rail-rows is the count, set inline by the renderer. What remains
   approximate is only VARIABLE row height — a row carrying holds is taller than
   a bare one — so the scrollbar stays proportional rather than exact. Measuring
   that needs a mount, which this package does not have.

   THE PITCH IS THE FLOOR ALONE NOW. Layer 1's section 16 pass separates its rows
   with the panel's own hairlines instead of a margin — a row is
   --ig-row-min-height of content and a hairline, with no gap to add — so the sum
   this used to take double-counted a gap that is no longer there. The row is
   content-sized above that floor, which is the same approximation the note above
   already describes, at a slightly larger typical size. */
.ig-rail-spacer {
  height: calc(var(--ig-row-min-height) * var(--ig-rail-rows, 0));
}

.ig-inspector {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space);
  padding: var(--ig-space);
}

/* TWO EMPTIES, ONE TREATMENT. "Nothing is selected" and "this issue is related
   to nothing" are different facts and the panel states each in its own place —
   but they are the same KIND of statement, a quiet line where content would be,
   and giving them separate looks would suggest a distinction that is not
   there. */
.ig-inspector-empty,
.ig-inspector-none {
  margin: 0;
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
}

/* The panel's heading row: the name at one end, the way out at the other.
   Baseline-aligned rather than centred, so a heading in caps and a button in
   sentence case sit on one line rather than on two optical ones. */
.ig-inspector-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--ig-space-tight);
}

.ig-inspector-issue {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-inspector-title {
  margin: 0;
  font-size: var(--ig-font-size);
  color: var(--ig-text);
}

.ig-inspector-holds {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

/* The two hold families never share a treatment — layer 1's rule, carried
   across so the inspector cannot contradict the rail it sits beside. */
.ig-inspector-hold[data-family='graph'] {
  color: var(--ig-station-held);
}

.ig-inspector-hold[data-family='tracker'] {
  color: var(--ig-text-muted);
}

/* The holder, as a control: inline with the sentence that names it, drawn as
   the same kind of button the relationship rows use so a reader learns one
   affordance for "take me to that issue". */
.ig-inspector-hold-subject {
  margin-left: var(--ig-space-tight);
  background: var(--ig-surface-2);
  color: inherit;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: 0 var(--ig-space-tight);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  cursor: pointer;
}

.ig-inspector-hold-subject:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-inspector-relationships {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

/* SECTION 17a DRAWS EVERY INSPECTOR HEADING IN CAPS -- WHY RANK 2,
   RELATIONSHIPS, ADD RELATIONSHIP -- so the treatment is shared rather than
   spelled per heading. Tracking widens with the caps because letterforms at a
   small size need it; that is what --ig-tracking-label is for. */
.ig-inspector-heading,
.ig-inspector-name,
.ig-why-rank-heading {
  margin: 0;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
  text-transform: uppercase;
  letter-spacing: var(--ig-tracking-label);
}

/* THE EXPLANATION, SECTION 17a's WHOLE POINT FOR THIS ZONE. The clauses are
   inline spans so the block reads as one sentence rather than a list of
   findings: the reader asked one question. */
.ig-why-rank {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-why-rank-sentence {
  margin: 0;
  color: var(--ig-text-body);
}

/* Each clause keeps a space after it so the sentence does not run together.
   A margin rather than a literal space in the markup: the text is host-authored
   and the package does not add characters to it. */
.ig-why-rank-sentence > * + * {
  margin-left: var(--ig-space-micro);
}


/* THE PANEL'S THREE QUIET BUTTONS SHARE ONE TREATMENT — clear, '+ add' and
   cancel. They are the same affordance at three moments (leave this selection,
   begin a relationship, abandon the draft) and drawing them three ways would
   invent a hierarchy the design does not state. The destructive controls are
   deliberately NOT in this set: a row's '✕' is a glyph in the row's own slot,
   and the mount's delete button carries its own danger treatment.

   ALIGNMENT IS NOT PART OF THE TREATMENT, and putting it here was a silent
   contradiction. 'align-self: flex-start' belongs to the two buttons in
   '.ig-inspector-add', a COLUMN, where without it they stretch to the panel's
   full width. The clear button sits in '.ig-inspector-head', a baseline row —
   and 'align-self' beats the container's 'align-items', so it overrode the
   baseline that rule's own comment says it is there to get. Declared where each
   is true instead. */
.ig-inspector-clear,
.ig-inspector-addbutton,
.ig-inspector-cancel {
  background: var(--ig-surface-2);
  color: var(--ig-text-body);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight) var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  cursor: pointer;
}

.ig-inspector-clear:focus-visible,
.ig-inspector-addbutton:focus-visible,
.ig-inspector-cancel:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-relationship-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-relationship {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
  padding: var(--ig-space-tight);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  background: var(--ig-surface);
}

/* HUE BY FIELD, ONCE, FOR EVERY ELEMENT THAT CARRIES 'data-edge'. From the
   theme's own edge tokens — the same channel layer 1 uses — so a relationship
   reads the same colour in the row and in the kind-list entry it was chosen
   from as it does on the canvas. The refusal capsule is deliberately NOT in
   this set: its whole border is the invalid state's dotted stroke, and a hue on
   its left edge would overwrite the half of that a reader looks for first.

   WRITTEN PER FIELD RATHER THAN FROM A 'data-edge'-KEYED TOKEN, because CSS has
   no way to build 'var(--ig-edge-' + attr() + ')': 'attr()' is usable in
   'content' and nowhere a custom property name is read. Five rules is the cost
   of that, and the alternative the package rejected is a token per hue set
   inline by the renderer, which moves a theme value into markup.

   ONE SELECTOR LIST PER FIELD, AND THAT IS THE POINT OF THIS BLOCK. The kind
   list arrived with a verbatim second copy of these five rules under
   '.ig-kind-option' — same five fields, same five tokens — under a comment
   claiming the file should not hold two ways of reading the theme while it
   held the same way twice. A sixth field is now one line here, not two. */
.ig-relationship[data-edge='blocked-by'],
.ig-kind-option[data-edge='blocked-by'] {
  border-left-color: var(--ig-edge-blocked-by);
}

.ig-relationship[data-edge='duplicate-of'],
.ig-kind-option[data-edge='duplicate-of'] {
  border-left-color: var(--ig-edge-duplicate-of);
}

.ig-relationship[data-edge='serialize-with'],
.ig-kind-option[data-edge='serialize-with'] {
  border-left-color: var(--ig-edge-serialize-with);
}

.ig-relationship[data-edge='together-with'],
.ig-kind-option[data-edge='together-with'] {
  border-left-color: var(--ig-edge-together-with);
}

.ig-relationship[data-edge='decomposed-from'],
.ig-kind-option[data-edge='decomposed-from'] {
  border-left-color: var(--ig-edge-decomposed-from);
}

/* THE DESCRIPTION'S BOX, WHETHER OR NOT A CONTROL IS WRAPPING IT. A row's head
   is a button and a phantom capsule's is a plain span -- 'render.ts' withholds
   the selector for an edge the landed document does not carry -- and the two
   occupy the row identically: they fill it, so the reason wraps under them
   rather than squeezing the reference out, and their parts sit on one baseline.
   Declared once, so the capsule cannot come to sit differently from the row it
   stands in for. */
.ig-relationship-select,
.ig-relationship-name {
  flex: 1;
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
}

/* The button fills its row, so the whole relationship is the hit target rather
   than the words inside it. Transparent and borderless: the li already carries
   the border and the hue, and a second box around it would read as two
   controls. */
.ig-relationship-select {
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ig-relationship-select:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

/* The glyph and its word are one phrase, so they get their own gap rather than
   inheriting the row's — which spaces the phrase from the reference beside it,
   a wider relationship. NOT a literal space character in the markup: the word
   is the vocabulary's and this package does not add characters to it, which is
   the same rule the why-rank sentence's clauses are spaced by. */
.ig-relationship-kind {
  display: inline-flex;
  gap: var(--ig-space-micro);
  align-items: baseline;
  color: var(--ig-text-body);
}

.ig-relationship-ref {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
}

/* THE RIGHT-HAND SLOT, WHOSE THREE OCCUPANTS ARE EXCLUSIVE. Two of them are
   statements and one is a control, and they are drawn as such: the state and
   the inbound marker are quiet label text, the remove is a button.
   '.ig-relationship-flip' below is NOT one of the three: it sits beside the
   slot on the selected row, because it is neither a statement about the row nor
   a destructive act on it. */
.ig-relationship-state,
.ig-relationship-inbound {
  align-self: center;
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
  text-transform: uppercase;
  letter-spacing: var(--ig-tracking-label);
}

/* The selected row names the state the canvas is drawing a halo for, so it
   takes the focus hue rather than the muted one — one selection, one colour,
   across the zones. */
.ig-relationship-state[data-ig-state='selected'] {
  color: var(--ig-focus);
}

/* A GLYPH BUTTON, SIZED BY ITS GLYPH. No border and no fill: the row already
   carries a border, and a second box inside it would read as two controls —
   the same reasoning '.ig-relationship-select' records. */
.ig-relationship-remove {
  align-self: center;
  background: none;
  border: none;
  padding: 0 var(--ig-space-tight);
  color: var(--ig-text-muted);
  font-family: inherit;
  font-size: inherit;
  line-height: 1;
  cursor: pointer;
}

.ig-relationship-remove:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

/* §17b's FLIP, AT THE ROW'S END. It is drawn last and needs no margin of its
   own to get there: '.ig-relationship-select' above carries 'flex: 1', so the
   statement takes the free space and everything after it is already pushed to
   the end — which is where frame 17b draws this control. A 'margin-left: auto'
   here would be inert, and a comment crediting it would be an explanation that
   outlived the thing it explained.

   A BORDERED CONTROL RATHER THAN THE REMOVE'S BARE GLYPH, which is the frame's
   own distinction and not decoration: '✕' is a mark a reader recognises without
   a box, and 'flip' is a word that would otherwise read as part of the sentence
   it sits beside. The border is what says it is pressable.

   ITS FOCUS RING IS NOT OPTIONAL, and it takes the offset the row's OTHER two
   controls already use rather than the one it was born with. This rule came
   from the picker's sheet, where the ring sat a hairline out;
   '.ig-relationship-select' and '.ig-relationship-remove' share this row and
   both ring at '--ig-space-tight', and one control ringing tighter than its
   neighbours reads as a rendering fault rather than as a distinction. This is
   the control §17b calls the guard against the most common encoding mistake; a
   keyboard reader who cannot see where they are has it and not its affordance. */
.ig-relationship-flip {
  align-self: center;
  background: var(--ig-surface);
  color: var(--ig-text-body);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: 0 var(--ig-space-tight);
  font-family: inherit;
  font-size: var(--ig-font-size-small);
  line-height: inherit;
  cursor: pointer;
}

.ig-relationship-flip:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

/* A REFUSED EDIT, IN THE ROW IT WOULD HAVE BEEN. It borrows the ghost the
   canvas draws for the same state — a dotted edge in the invalid hue — so the
   line and the row a reader looks between are recognisably one fact.
   NO OPACITY HERE. 'overlay/grammar.ts' holds the opacity every write state is
   drawn at, on the record that a second copy would drift; what this sheet
   contributes is the structure. */
.ig-relationship-refused {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
  align-items: baseline;
  padding: var(--ig-space-tight);
  border: var(--ig-stroke) dotted var(--ig-state-invalid);
  border-radius: var(--ig-radius);
  background: var(--ig-surface);
}

.ig-relationship-reason {
  color: var(--ig-state-invalid);
  font-size: var(--ig-font-size-small);
}

/* A REFUSAL ON A RELATIONSHIP THAT IS STILL THERE. The row stays — it names a
   real edge and its remove control still works — so this marks it rather than
   replacing it: the capsule's dotted stroke, and room for the reason to wrap
   under the row rather than squeezing the reference out of it.
   BORDER-STYLE ONLY, NOT BORDER-COLOR: the field's hue is on the left edge from
   the block above, and a shorthand here would overwrite it and take the row's
   one colour channel away on exactly the rows carrying the most information. */
.ig-relationship[data-ig-code] {
  flex-wrap: wrap;
  border-style: dotted;
}

/* THE CREATE STEP, WHICHEVER STEP IT IS. One box holds '+ add' on its own and
   the numbered list with its cancel, because they are one place in the panel
   the reader returns to rather than two that happen to alternate. */
.ig-inspector-add {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

/* Sized by their own words rather than stretched across the column — see the
   quiet-button rule above, which deliberately does not carry this. */
.ig-inspector-addbutton,
.ig-inspector-cancel {
  align-self: flex-start;
}

/* WHOSE DRAFT THIS IS, drawn only when it is not the panel's subject. Quiet and
   small, like every other line that states a fact rather than offering an act:
   it is a caption on the step below it, not a heading over it. The reference
   inside keeps layer 1's '.ig-id' treatment, so the issue reads the same here
   as it does in the why-rank sentence. */
.ig-inspector-source {
  margin: 0;
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
}

.ig-kind-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-micro);
}

/* Full width, so the whole entry is the hit target and the digits form a
   readable column down the left — which is what makes the list legible as a
   set of KEYS rather than as five buttons that happen to start with a number. */
.ig-kind-option {
  width: 100%;
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
  background: var(--ig-surface);
  color: var(--ig-text-body);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight);
  font-family: inherit;
  font-size: var(--ig-font-size-small);
  text-align: left;
  cursor: pointer;
}

.ig-kind-option:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-kind-digit {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
}

/* §17b's RECOVERY CARDS. An unsettled write the reader can still act on, drawn
   where they made it.
   THE HUE COMES FROM THE STATE, through the same custom properties the canvas
   draws the line with — so a card and the edge it is about are recognisably one
   fact, and a host retheming the palette moves both at once. The tokens are
   named per state below rather than set once, because '--ig-state-failed' and
   '--ig-state-conflict' are different channels and a shared variable here would
   be a third place the pairing could drift.
   NO OPACITY, for the reason the refusal capsule states: 'overlay/grammar.ts'
   holds what each write state is drawn at, and this sheet contributes structure. */
.ig-recovery-region {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  margin-top: var(--ig-space);
}

.ig-recovery-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-recovery {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  padding: var(--ig-space-tight);
  border-radius: var(--ig-radius);
  background: var(--ig-surface);
  border: var(--ig-stroke) solid var(--ig-line);
}

/* GHOST + THE ✕ THE CANVAS DRAWS. §17b gives a failed write a ghosted line with
   a cross terminal; the card carries the same hue so the two read together. */
.ig-recovery[data-ig-state='failed'] {
  border-color: var(--ig-state-failed);
  border-style: dashed;
}

/* THE GOLD DOUBLE RULE. §17b draws a conflict as a doubled line holding two
   versions. 'border-style: double' is the card's half of that grammar — the
   LINE's half is the 'second-version' mark, which needs a position this layer
   does not have and is issue #102's. */
.ig-recovery[data-ig-state='conflict'] {
  border-color: var(--ig-state-conflict);
  border-style: double;
  border-width: calc(var(--ig-stroke) * 3);
}

.ig-recovery-name {
  margin: 0;
  font-size: var(--ig-font-size-small);
  font-weight: 600;
}

.ig-recovery[data-ig-state='failed'] .ig-recovery-name {
  color: var(--ig-state-failed);
}

.ig-recovery[data-ig-state='conflict'] .ig-recovery-name {
  color: var(--ig-state-conflict);
}

.ig-recovery-reason,
.ig-recovery-refresh-error {
  margin: 0;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
}

.ig-recovery-refresh-detail {
  font-family: var(--ig-font-mono);
}

/* THE THREE RESOLUTIONS, IN A ROW AND NEVER IN A MENU. §17b lists them as
   peers; nesting one behind a disclosure would rank them, and the one that
   would end up hidden is 'view diff' — the one that lets a reader decide
   between the other two. */
.ig-recovery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
}

.ig-recovery-action {
  background: var(--ig-surface);
  color: var(--ig-text-body);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight);
  font-family: inherit;
  font-size: var(--ig-font-size-small);
  cursor: pointer;
}

.ig-recovery-action:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-recovery-action[aria-pressed='true'] {
  border-color: var(--ig-focus);
}

/* TWO SIDES, SIDE BY SIDE, AND NOTHING BETWEEN THEM THAT COMBINES THEM. The
   layout is the design constraint: there is no column for a merged result,
   because there is no merged result to put in one. */
.ig-recovery-diff {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  padding-top: var(--ig-space-tight);
  border-top: var(--ig-stroke) solid var(--ig-line);
}

/* ONE SIDE OF THE DIFFERENCE. Stacked rather than columned: at a panel's width
   two columns give each side about half of an already narrow zone, and a
   relationship row is a sentence rather than a cell. */
.ig-recovery-side {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-recovery-side-name {
  margin: 0;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
  font-weight: 400;
}

.ig-recovery-edges,
.ig-recovery-issues {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-recovery-edge,
.ig-recovery-issue {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
  align-items: baseline;
  font-size: var(--ig-font-size-small);
}

/* BOTH TITLES, NEITHER STRUCK THROUGH. A strike-out would say the old one is
   gone, which is exactly the judgement this card must not make for the reader. */
.ig-recovery-was,
.ig-recovery-now {
  color: var(--ig-text-muted);
}

.ig-recovery-now {
  color: var(--ig-state-conflict);
}

.ig-recovery-diff-empty {
  margin: 0;
  padding-top: var(--ig-space-tight);
  border-top: var(--ig-stroke) solid var(--ig-line);
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
}
`;
