/**
 * The accessible contract of every command control, read off a rendered
 * surface — so it is committed as an artifact rather than asserted in prose.
 *
 * ## Why a DOM node and not an `ElementSpec`
 *
 * There is no spec tree for the workspace to walk. `renderWorkspace` returns
 * `markup: string`; it composes its four zones by joining independently
 * rendered strings, the `data-zone` wrapper is the one tag written by hand in
 * that file, and every `…Spec` builder is module-private. Worse for a spec
 * walk, a substantial part of the interactive surface never passes a renderer
 * at all — `mountWorkspace` builds the kind chooser, the target search and its
 * match list with `createElement`, and says so ("WHAT IS LEFT HERE IS WHAT
 * NEEDS A DOM"). A baseline taken over specs would silently omit exactly the
 * keyboard-relevant controls.
 *
 * The rendered DOM has all of it, and it is also what a screen reader actually
 * meets.
 *
 * ## Structurally typed, so this module still touches no global
 *
 * {@link SurfaceElement} is declared by what it must answer rather than as
 * `Element`, which is `element.ts`'s own `SpecDocument` idiom — "declared
 * structurally rather than as `Document` so a host can pass any implementation
 * that answers these five calls, and so this module stays honest about how
 * little of the DOM it actually needs". `purity.test.ts` imports every shipped
 * module with the browser globals removed; nothing here reaches for one.
 *
 * ## What is recorded, and what is deliberately not
 *
 * VALUES ARE KEPT FOR MACHINE STATES AND DROPPED FOR HUMAN-READABLE NAMES.
 * That split is by provenance, not one blanket rule, because the two fail
 * differently. `aria-pressed` is rendered as `cond ? 'true' : 'false'`, so a
 * baseline holding only the attribute NAME is byte-identical when a toggle
 * inverts — the regression it exists to catch. A label, meanwhile, is often
 * the host's word (`picker/words.ts`, `reevaluate/words.ts` and
 * `firstpass/words.ts` all require a `Record<K, string>` from the host and
 * default none), so pinning the string would fail any host that translated it.
 *
 * An earlier draft justified dropping every value with "the package ships no
 * English", which is false: `scale/render.ts` writes `'connected components'`,
 * `'what to do next'`, `'search matches'` and `'isolated issues'` itself, and
 * the viewer ships more landmark names. The true, narrower claim is the one
 * above.
 *
 * AN IDREF IS RECORDED BY WHETHER IT RESOLVES, never by its value. The
 * disclosure's `aria-controls` names `diffRegionId(recovery.mutationId)`, and a
 * mutation id is generated per run — pinning it would make the artifact churn
 * on every render for no signal. What is worth pinning is the fact a reader
 * depends on: that the id names a region that is actually there. A dangling
 * `aria-controls` is a real defect and a stable one to record.
 */

/** A text node, or anything else with no tag. */
export interface SurfaceNode {
  readonly nodeType: number;
  readonly nodeValue: string | null;
}

/** The slice of `Element` this module reads. */
export interface SurfaceElement extends SurfaceNode {
  readonly tagName: string;
  readonly childNodes: ArrayLike<SurfaceNode>;
  getAttribute(name: string): string | null;
  closest(selectors: string): SurfaceElement | null;
  querySelectorAll(selectors: string): Iterable<SurfaceElement>;
}

/**
 * Where a control's accessible name comes from, or why it has none.
 *
 * `label` IS A REAL NAME AND WAS MISSING. `scale/render.ts` wraps its search
 * input in a `<label>` carrying the text — the input has a genuine accessible
 * name and no text of its own, no `aria-label` and no `aria-labelledby`. Read
 * without this, it came back `none`, so the naming rule reported a false
 * failure on correct markup and the control could not join the baseline at all.
 * An exported reader that is wrong about native HTML is worse than no reader.
 *
 * `empty` IS ITS OWN ANSWER, not a kind of `none`. An `aria-label=""` is an
 * author who meant to supply a name and supplied nothing — a different defect
 * from a control nobody labelled, and one that reads as deliberate in the
 * markup. Recording it separately is what lets a rule name it. THE VALUE IS
 * NEVER RECORDED: a label is routinely the host's own word (`picker/words.ts`
 * and `reevaluate/words.ts` both require a `Record<K, string>` from the host
 * and default none), so pinning the string would fail any host that translated
 * it. Whether one was supplied is a fact about the markup; what it says is not.
 */
export type NameSource = 'aria-label' | 'aria-labelledby' | 'label' | 'text' | 'empty' | 'none';

/**
 * How the keyboard reaches a control.
 *
 * NOT A BOOLEAN, and that is the whole point of the field. This package uses a
 * roving tab stop — the projections render `tabindex: focused ? 0 : -1` — and
 * the viewer's own focusability predicate counts `tabindex="-1"` as focusable.
 * So a boolean "focusable" is satisfied by a control reachable only by pointer
 * and by programmatic focus, which is precisely the defect a keyboard record
 * exists to catch.
 */
export type TabStop = 'tab' | 'programmatic' | 'none';

/** One control's accessible contract. */
export interface ControlEntry {
  readonly zone: string | null;
  /** Which attribute published it — see {@link CONTROL_ATTRIBUTES}. */
  readonly channel: string;
  /** That attribute's value: the command, the answer, or the filter's state. */
  readonly control: string;
  /**
   * What the control acts on, and which option it is.
   *
   * RECORDED BECAUSE THEY SEPARATE OTHERWISE IDENTICAL ROWS. Every relationship
   * row publishes `select-edge`, and the kind list publishes `kind` several
   * times — without these, N controls collapse to N byte-identical entries and
   * losing one of them is invisible in the artifact's diff.
   */
  readonly target: string | null;
  readonly value: string | null;
  readonly tag: string;
  /** `null` where this module has no mapping, which is a fact; a guess would not be. */
  readonly role: string | null;
  readonly tabStop: TabStop;
  readonly name: NameSource;
  /** Enumerated ARIA states with their values, and IDREFs by whether they resolve. */
  readonly aria: Readonly<Record<string, string>>;
}

/**
 * Every attribute a control publishes itself on.
 *
 * THREE CHANNELS, NOT ONE, and reading only the first is how a record comes to
 * claim a surface it never saw. `data-ig-command` is the general one, but the
 * first pass's y/n/s answers carry `data-ig-answer` and the audit header's
 * toggle carries `data-ig-audit-filter` — `firstpass/render.ts` and
 * `audit/surface.ts` each say so where they declare theirs. Keyed on the
 * command alone, this would have recorded `null` for the audit toggle and for
 * every answer, and the rules below would have skipped exactly the controls a
 * keyboard reader depends on most.
 */
export const CONTROL_ATTRIBUTES: readonly string[] = Object.freeze([
  'data-ig-command',
  'data-ig-answer',
  'data-ig-audit-filter',
]);

/**
 * Implicit roles, for the tags this package actually renders.
 *
 * Closed and small on purpose. A general HTML-AAM table would be a second
 * implementation of a specification this package does not own, and every entry
 * beyond what is rendered here would be untested. An unmapped tag records
 * `null` rather than a guess — including everything in the SVG namespace,
 * where the HTML implicit roles do not apply and `path` has none at all.
 */
const IMPLICIT_ROLES: Readonly<Record<string, string>> = Object.freeze({
  button: 'button',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  li: 'listitem',
  ol: 'list',
  ul: 'list',
});

/**
 * The two tags whose implicit role depends on more than the tag.
 *
 * `a` is a `link` only with an `href` — without one it is not a link and not
 * focusable. `section` is a `region` only when it has an accessible name;
 * unnamed it exposes no role at all. Both were mapped unconditionally in an
 * earlier revision, which recorded a role the accessibility tree does not have.
 */
/**
 * `input`'s implicit role, which is its `type`'s rather than its tag's.
 *
 * The mounted target search is `<input type="search">` — `searchbox`, not
 * nothing — and recording `null` for a control this package itself renders
 * means the role column could not notice it being changed into a semantically
 * different control. Only the types rendered here are mapped; the rest stay
 * `null`, on the same rule as every other unmapped tag.
 */
const INPUT_ROLES: Readonly<Record<string, string>> = Object.freeze({
  button: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  text: 'textbox',
});

function conditionalRole(
  root: SurfaceElement,
  element: SurfaceElement,
  tag: string,
): string | null {
  if (tag === 'a') return element.getAttribute('href') === null ? null : 'link';
  if (tag === 'section') return nameSource(root, element) === 'none' ? null : 'region';
  // NO `type` IS `type="text"`, which is HTML's own default rather than an
  // assumption: an `<input>` with no type is a text field.
  if (tag === 'input') return INPUT_ROLES[element.getAttribute('type') ?? 'text'] ?? null;
  return null;
}

/** ARIA attributes whose value is drawn from a fixed set, so the value is data. */
const ENUMERATED_ARIA: readonly string[] = Object.freeze([
  'aria-busy',
  'aria-checked',
  'aria-current',
  'aria-expanded',
  'aria-hidden',
  'aria-live',
  'aria-modal',
  'aria-pressed',
  'aria-selected',
]);

/** ARIA attributes whose value is an id, recorded by whether it resolves. */
const IDREF_ARIA: readonly string[] = Object.freeze([
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
]);

const TEXT_NODE = 3;

function isElement(node: SurfaceNode): node is SurfaceElement {
  return 'tagName' in node;
}

/**
 * The text a screen reader would announce for this element.
 *
 * SUBTREES MARKED `aria-hidden` CONTRIBUTE NOTHING, which is the case a naive
 * "does it have a text child" test gets wrong. `parts.ts` renders a command
 * button as a hidden glyph beside its label; delete the label and the button
 * still has a text descendant while its accessible name is empty. That is a
 * name loss no presence check would report.
 */
function visibleText(element: SurfaceElement): string {
  let out = '';
  const walk = (node: SurfaceNode): void => {
    if (!isElement(node)) {
      if (node.nodeType === TEXT_NODE) out += node.nodeValue ?? '';
      return;
    }
    if (node.getAttribute('aria-hidden') === 'true') return;
    for (let index = 0; index < node.childNodes.length; index += 1) {
      const child = node.childNodes[index];
      if (child !== undefined) walk(child);
    }
  };
  walk(element);
  return out.trim();
}

/**
 * Whether a `<label>` names this control, by either association HTML defines.
 *
 * WRAPPING FIRST, then `for`. `scale/render.ts` uses the wrapping form and says
 * why in as many words — two search boxes side by side with one `id` would make
 * `for` resolve to whichever came first, so one would silently lose its label.
 *
 * THE `for` LOOKUP WALKS AND COMPARES rather than building `label[for="..."]`:
 * an id is host data, and interpolating one into a selector is the injection
 * this module already had to remove once.
 */
function labelNames(root: SurfaceElement, element: SurfaceElement): boolean {
  const wrapping = element.closest('label');
  if (wrapping !== null && visibleText(wrapping) !== '') return true;
  const id = element.getAttribute('id');
  if (id === null || id === '') return false;
  for (const label of root.querySelectorAll('label')) {
    if (label.getAttribute('for') === id && visibleText(label) !== '') return true;
  }
  return false;
}

function nameSource(root: SurfaceElement, element: SurfaceElement): NameSource {
  // AN EMPTY VALUE IS NOT A NAME, and it is not the same as no attribute.
  // `renderMarkup` omits only `undefined`, `null` and `false`, so
  // `aria-label=""` does reach the markup — the case the "omitted, never empty"
  // rule `holdLine` states for `data-code` exists to prevent.
  for (const attribute of ['aria-label', 'aria-labelledby'] as const) {
    const value = element.getAttribute(attribute);
    if (value === null) continue;
    return value === '' ? 'empty' : attribute;
  }
  if (visibleText(element) !== '') return 'text';
  return labelNames(root, element) ? 'label' : 'none';
}

function tabStopOf(element: SurfaceElement): TabStop {
  // DISABLED AND INERT ARE NOT TAB STOPS, whatever the tag says. The mount sets
  // `inert` on every zone while the first-pass overlay is up — "the zones go
  // inert under it" — so without this every covered control recorded `tab` and
  // passed a rule asserting the keyboard can reach it, while the browser was
  // refusing focus to all of them.
  if (element.getAttribute('disabled') !== null) return 'none';
  if (element.closest('[inert]') !== null) return 'none';
  const raw = element.getAttribute('tabindex');
  if (raw === null) {
    // NATIVELY IN THE TAB ORDER. `a` only with an `href`: without one it is not
    // focusable, and recording it as a tab stop would claim a reachability the
    // markup does not have.
    const tag = element.tagName.toLowerCase();
    if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') return 'tab';
    return tag === 'a' && element.getAttribute('href') !== null ? 'tab' : 'none';
  }
  const index = Number(raw);
  if (!Number.isInteger(index)) return 'none';
  return index < 0 ? 'programmatic' : 'tab';
}

/**
 * Every id under `root`, gathered once.
 *
 * A SET RATHER THAN A QUERY PER TOKEN, and that is a correctness fix, not a
 * speed one. An earlier revision resolved each IDREF with
 * `` querySelectorAll(`[id="${id}"]`) `` — interpolating a value read off the
 * DOM straight into a selector, which is verbatim the class the mount's focus
 * token was written to avoid. Measured: `aria-describedby='a"]'` made this
 * function THROW, and a token containing `],[id` resolved against the wrong
 * elements. `controlSurface` is exported for hosts to run over their own
 * chrome, where ids are tracker-derived, so the injection was reachable.
 *
 * SCOPED TO `root`, which is a real bound and is stated rather than hidden: an
 * IDREF pointing into the host's own chrome outside the mounted surface reads
 * as `dangling` here. That is the right default for a record ABOUT this
 * surface, and a host taking it over its whole page gets the wider answer.
 */
function idsUnder(root: SurfaceElement): ReadonlySet<string> {
  const ids = new Set<string>();
  // `root` ITSELF IS NOT IN ITS OWN `querySelectorAll`, so it is added by hand:
  // a host may well hang the surface off an element that carries an id.
  const own = root.getAttribute('id');
  if (own !== null) ids.add(own);
  for (const element of root.querySelectorAll('[id]')) {
    const id = element.getAttribute('id');
    if (id !== null) ids.add(id);
  }
  return ids;
}

function ariaOf(ids: ReadonlySet<string>, element: SurfaceElement): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const attribute of ENUMERATED_ARIA) {
    const value = element.getAttribute(attribute);
    if (value !== null) out[attribute] = value;
  }
  for (const attribute of IDREF_ARIA) {
    const value = element.getAttribute(attribute);
    if (value === null) continue;
    // EVERY id IT NAMES, because the attribute takes a list and a half-resolved
    // reference is still broken for the token that dangles.
    const named = value.split(/\s+/).filter((token) => token !== '');
    out[attribute] =
      named.length > 0 && named.every((id) => ids.has(id)) ? 'resolves' : 'dangling';
  }
  return out;
}

/**
 * Every control under `root`, in document order, sorted so the record is stable.
 *
 * Pure and total. SORTED RATHER THAN LEFT IN DOCUMENT ORDER: a baseline is
 * diffed by people, and a control moving between zones should read as one
 * changed line rather than as a reordering of the whole file. Document order is
 * a fact about layout, which the zone already carries.
 *
 * The bound it does NOT cover is stated where it can be checked: a control
 * publishing itself on some fourth attribute is invisible here, and
 * {@link CONTROL_ATTRIBUTES} is the list to extend.
 */
export function controlSurface(root: SurfaceElement): readonly ControlEntry[] {
  const entries: ControlEntry[] = [];
  const seen = new Set<SurfaceElement>();
  const ids = idsUnder(root);
  for (const channel of CONTROL_ATTRIBUTES) {
    for (const element of root.querySelectorAll(`[${channel}]`)) {
      const control = element.getAttribute(channel);
      // ONE ENTRY PER ELEMENT, even where a control carries two channels: the
      // record is about the control, and a second row for one button would
      // make every rule below count it twice.
      if (control === null || seen.has(element)) continue;
      seen.add(element);
      const tag = element.tagName.toLowerCase();
      entries.push({
        zone: element.closest('.ig-zone')?.getAttribute('data-zone') ?? null,
        channel,
        control,
        target: element.getAttribute('data-ig-target'),
        value: element.getAttribute('data-ig-value') ?? element.getAttribute('data-ig-kind'),
        tag,
        role:
          element.getAttribute('role') ??
          IMPLICIT_ROLES[tag] ??
          conditionalRole(root, element, tag),
        tabStop: tabStopOf(element),
        name: nameSource(root, element),
        aria: ariaOf(ids, element),
      });
    }
  }
  // FIELD BY FIELD, BY CODE POINT. `localeCompare` was both non-total and
  // machine-dependent here: it treats `\u0000` as ignorable, so the separator
  // bought nothing and distinct keys compared EQUAL, and with no locale it
  // follows the runner's own ICU build — which would reorder a committed
  // artifact that is compared with an order-sensitive `deepEqual`.
  const key = (entry: ControlEntry): readonly string[] => [
    entry.zone ?? '',
    entry.channel,
    entry.control,
    entry.target ?? '',
    entry.value ?? '',
  ];
  return [...entries].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    for (let index = 0; index < left.length; index += 1) {
      const one = left[index] ?? '';
      const other = right[index] ?? '';
      if (one !== other) return one < other ? -1 : 1;
    }
    return 0;
  });
}
