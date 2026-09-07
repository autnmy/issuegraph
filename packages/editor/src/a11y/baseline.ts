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

/** Where a control's accessible name comes from, or that it has none. */
export type NameSource = 'aria-label' | 'aria-labelledby' | 'text' | 'none';

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
const CONTROL_ATTRIBUTES: readonly string[] = Object.freeze([
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
  a: 'link',
  button: 'button',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  li: 'listitem',
  ol: 'list',
  section: 'region',
  ul: 'list',
});

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

function nameSource(element: SurfaceElement): NameSource {
  // AN EMPTY VALUE IS NOT A NAME. `renderMarkup` omits only `undefined`, `null`
  // and `false`, so `aria-label=""` reaches the markup and would otherwise be
  // recorded as a supplied name — the same "omitted, never empty" rule
  // `holdLine` states for `data-code`.
  if ((element.getAttribute('aria-label') ?? '') !== '') return 'aria-label';
  if ((element.getAttribute('aria-labelledby') ?? '') !== '') return 'aria-labelledby';
  return visibleText(element) === '' ? 'none' : 'text';
}

function tabStopOf(element: SurfaceElement): TabStop {
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

function ariaOf(root: SurfaceElement, element: SurfaceElement): Readonly<Record<string, string>> {
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
    const ids = value.split(/\s+/).filter((token) => token !== '');
    const resolved =
      ids.length > 0 &&
      ids.every((id) => [...root.querySelectorAll(`[id="${id}"]`)].length > 0);
    out[attribute] = resolved ? 'resolves' : 'dangling';
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
        tag,
        role: element.getAttribute('role') ?? IMPLICIT_ROLES[tag] ?? null,
        tabStop: tabStopOf(element),
        name: nameSource(element),
        aria: ariaOf(root, element),
      });
    }
  }
  return [...entries].sort((a, b) =>
    `${a.zone ?? ''}\u0000${a.channel}\u0000${a.control}`.localeCompare(
      `${b.zone ?? ''}\u0000${b.channel}\u0000${b.control}`,
    ),
  );
}
