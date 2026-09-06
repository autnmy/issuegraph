/**
 * §16 beside its frames: the viewer with no editor attached.
 *
 * `main.ts` mounts the grooming WORKSPACE — three zones, with the viewer inside
 * two of them — which is the right surface for the sandbox and the wrong one
 * for a fidelity comparison: the frames draw one panel at fixed widths, and a
 * screenshot has to be of that. autnmy/descant#9097's done-when named the same
 * thing: "§16 IS that test — the viewer with no editor attached."
 *
 * IT IS A HOST, LIKE EVERY OTHER PAGE HERE, and re-implements nothing. The
 * document is the sandbox's own comp scenario, run through the same
 * `explainDocument` the store's deriver runs; the clock is FIXED so a
 * screenshot is a reproduction rather than a moment.
 */

import { type HostFacts, type Scene, initialNavigationState, navigate, renderViewer } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import { type DemoStateName, hostFacts, runningSince, showsOrder } from './host.ts';
import { explainDocument } from './order.ts';
import { SCENARIOS, type ScenarioName, adoptionFor } from './seed.ts';

/**
 * The moment the page draws itself at.
 *
 * FIXED, and that is the point. The frames print `as of 14:32 · 2m ago`, and a
 * comparison whose freshness stamp moves between screenshots is a comparison
 * with a moving part in it.
 */
const OBSERVED_AT = new Date('2026-09-06T14:30:00Z');
const NOW = new Date('2026-09-06T14:32:00Z');

/**
 * The one panel whose frame draws its own refresh control.
 *
 * §16g's freshness card is a two-up comparison, and the stale half of it is
 * drawn WITH the inline refresh — the affordance is part of what the state is.
 * So this page's standing "no refresh on a fixed clock" rule carves out exactly
 * this panel: a control on a fidelity surface with nothing behind it is a
 * reproduction of a frame, and the alternative is a panel that cannot be judged
 * against the frame it sits beside. Every other panel keeps the rule.
 */
const KEEPS_REFRESH = 's16g-stale';

function projectionFor(panel: PanelState, id: string): ReturnType<typeof projectDocument> {
  const scenario = SCENARIOS[panel.scenario];
  const document = scenario.document();
  // SEE `showsOrder`. The empty frame draws an empty card, and a panel that
  // said "nothing is eligible" over eleven ranked rows would be reproducing
  // nothing at all — which is what this page exists to make visible.
  const shown = showsOrder(panel.state);
  // See `workspace.ts`: adoption and the audit are read over the whole document,
  // the order over what this panel draws. Blanking the order must not blank the
  // backlog.
  const held = { issues: document.issues, edges: document.edges };
  const landed = shown ? held : { issues: [], edges: [] };
  const explained = explainDocument(landed, scenario.holds, scenario.ranking);
  const host = hostFacts({
    rows: explained.rows,
    observedAt: OBSERVED_AT,
    now: NOW,
    running: !shown || scenario.running === undefined ? undefined : runningSince(scenario.running, NOW),
    state: panel.state,
    // Measured from the document this panel draws — see `adoptionFor`.
    adoption: adoptionFor(scenario, held, false),
  });
  const audited = shown
    ? { document: held, explained }
    : { document: held, explained: explainDocument(held, scenario.holds, scenario.ranking) };
  return projectDocument(explained, landed, asReproduction(host, id), scenario.caveats, audited);
}

/**
 * The host facts a fixed-clock surface can honestly state.
 *
 * NO CONTROL THIS PAGE CANNOT PERFORM. The viewer draws one only where a host
 * supplied a word for it, and this page has nothing to re-read, nowhere to
 * route and nothing to remember: its clock is a constant so that a screenshot
 * is a reproduction. An enabled control that does nothing is worse than its
 * absence — the same rule the graph's refusal states about its own capsules,
 * and the rule this page already applied to `refresh` alone until the states
 * arrived with three more controls beside it.
 *
 * STATED ONCE, OVER EVERY WORD. Dropping them one at a time is how `refresh`
 * came to be handled and Retry, Review and Dismiss came to be drawn dead.
 *
 * OMITTED, NEVER REBUILT FROM A LIST OF KEEPERS. Naming the fields to keep
 * silently dropped `stale` the moment a third one mattered, so the stale panel
 * drew a current-looking stamp with no gold and no word, and the build stayed
 * green.
 */
function asReproduction(host: HostFacts, id: string): HostFacts {
  const condition =
    host.condition === undefined
      ? undefined
      : host.condition.kind === 'empty'
        ? (({ action: _routed, ...rest }) => rest)(host.condition)
        : host.condition.kind === 'error'
          ? (({ retry: _reread, ...rest }) => rest)(host.condition)
          : host.condition;
  const freshness =
    host.freshness === undefined || id === KEEPS_REFRESH
      ? host.freshness
      : (({ refresh: _reread, ...rest }) => rest)(host.freshness);
  const note = host.adoption?.note === undefined
    ? host.adoption?.note
    : (({ dismiss: _hidden, ...rest }) => rest)(host.adoption.note);
  return {
    ...host,
    ...(condition === undefined ? {} : { condition }),
    ...(freshness === undefined ? {} : { freshness }),
    ...(host.adoption === undefined ? {} : { adoption: { ...host.adoption, ...(note === undefined ? {} : { note }) } }),
  };
}

/** What each panel is showing right now — the state a control moves. */
interface PanelState {
  projection: 'linear' | 'graph';
  compact: boolean;
  /** Which document the panel draws. The §16a/§16b frames are all the comp. */
  scenario: ScenarioName;
  /** Which §16g state, or `live` for the frames that draw a populated panel. */
  state: DemoStateName;
}

/**
 * Every panel this page draws, and what it is a reproduction OF.
 *
 * Exported as a plain value, and `draw()` guarded below, so the panels can be
 * asserted against without a DOM: this module used to run itself at import and
 * dereference `document`, which made every one of its readings untestable.
 */
export const PANELS: ReadonlyMap<string, PanelState> = new Map([
  ['s16a-rail', { projection: 'linear', compact: false, scenario: 'comp', state: 'live' }],
  ['s16a-column', { projection: 'linear', compact: false, scenario: 'comp', state: 'live' }],
  ['s16b-column', { projection: 'graph', compact: true, scenario: 'comp', state: 'live' }],
  ['s16b-expanded', { projection: 'graph', compact: false, scenario: 'comp', state: 'live' }],
  ['s16g-importing', { projection: 'linear', compact: false, scenario: 'comp', state: 'importing' }],
  ['s16g-empty', { projection: 'linear', compact: false, scenario: 'comp', state: 'empty' }],
  ['s16g-error', { projection: 'linear', compact: false, scenario: 'comp', state: 'error' }],
  ['s16g-fresh', { projection: 'linear', compact: false, scenario: 'comp', state: 'live' }],
  ['s16g-stale', { projection: 'linear', compact: false, scenario: 'comp', state: 'stale' }],
  ['s16h-adoption', { projection: 'linear', compact: false, scenario: 'adoption', state: 'live' }],
]);

/** The viewer document one panel draws, at this page's fixed clock. */
export function panelDocument(id: string): ReturnType<typeof projectDocument>['viewer'] {
  const panel = PANELS.get(id);
  if (panel === undefined) throw new Error(`no such panel: ${id}`);
  return projectionFor(panel, id).viewer;
}

/**
 * Draw every panel, and perform what its header publishes.
 *
 * THE COMMANDS ARE THE HOST'S TO PERFORM, on BOTH channels. The viewer draws a
 * control only for a host that has said it will complete the command, and §16e
 * puts the same command on a KEY — so a page that watched for clicks alone got
 * the toggle and lost `g`, advertising a shortcut that published nothing. The
 * key decision comes from the package's own `navigate`, not from a second
 * reading of what `g` means here.
 */
export function draw(): void {
  let styled = false;

  const render = (id: string, state: PanelState): void => {
    const host = document.getElementById(id);
    if (host === null) return;
    // PER PANEL, NOT ONCE FOR THE PAGE. Each panel is a reproduction of its own
    // frame now, and the state and the document are what differ between them.
    const result = renderViewer(panelDocument(id), {
      projection: state.projection,
      compact: state.compact,
      // The page performs what the header publishes, so it says so — the viewer
      // draws no control for a host that has not.
      switchable: true,
    });
    // ONE STYLESHEET FOR THE PAGE. The viewer emits the same bytes every time,
    // so installing it per panel would be one identical copy per panel.
    if (!styled) {
      const style = document.createElement('style');
      style.textContent = result.styles;
      document.head.append(style);
      styled = true;
    }
    host.innerHTML = result.markup;
    scenes.set(id, result.scene);
  };

  const scenes = new Map<string, Scene>();

  /** Apply one published command to the panel it came from. */
  const perform = (id: string, command: string): void => {
    const state = PANELS.get(id);
    if (state === undefined) return;
    if (command === 'projection:linear') state.projection = 'linear';
    else if (command === 'projection:graph') state.projection = 'graph';
    else if (command === 'expand') state.compact = false;
    else if (command === 'collapse') state.compact = true;
    else return;
    render(id, state);
  };

  const panelOf = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const panel = target.closest('[id]');
    return panel !== null && PANELS.has(panel.id) ? panel.id : null;
  };

  for (const [id, state] of PANELS) render(id, state);

  document.addEventListener('click', (event) => {
    const id = panelOf(event.target);
    if (id === null || !(event.target instanceof Element)) return;
    const command = event.target.closest('[data-ig-command]')?.getAttribute('data-ig-command');
    if (command !== null && command !== undefined) perform(id, command);
  });

  document.addEventListener('keydown', (event) => {
    const id = panelOf(event.target);
    const scene = id === null ? undefined : scenes.get(id);
    if (id === null || scene === undefined) return;
    // THROUGH THE PACKAGE'S OWN REDUCER, so what `g` means here and what it
    // means in a mounted viewer are one answer rather than two.
    const result = navigate(scene, initialNavigationState, event.key);
    if (result.command.kind !== 'command') return;
    event.preventDefault();
    perform(id, result.command.command);
  });
}

// AN ENTRY GUARD, so importing this module reads its panels instead of drawing
// them. It used to call `draw()` at import and dereference the bare `document`
// global, which meant every reading on this page — which state each panel
// reproduces, whether the stale one keeps its refresh — could only be checked
// by looking at it.
if (typeof document !== 'undefined') draw();
