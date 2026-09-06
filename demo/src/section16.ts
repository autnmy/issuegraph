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

import { renderViewer } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import { hostFacts, runningSince } from './host.ts';
import { explainDocument } from './order.ts';
import { SCENARIOS } from './seed.ts';

/**
 * The moment the page draws itself at.
 *
 * FIXED, and that is the point. The frames print `as of 14:32 · 2m ago`, and a
 * comparison whose freshness stamp moves between screenshots is a comparison
 * with a moving part in it.
 */
const OBSERVED_AT = new Date('2026-09-06T14:30:00Z');
const NOW = new Date('2026-09-06T14:32:00Z');

function projection(): ReturnType<typeof projectDocument> {
  const scenario = SCENARIOS.comp;
  const document = scenario.document();
  const landed = { issues: document.issues, edges: document.edges };
  const explained = explainDocument(landed, scenario.holds, scenario.ranking);
  const host = hostFacts({
    rows: explained.rows,
    observedAt: OBSERVED_AT,
    now: NOW,
    running: scenario.running === undefined ? undefined : runningSince(scenario.running, NOW),
  });
  return projectDocument(explained, landed, host, scenario.caveats);
}

/** What each panel is showing right now — the state a toggle moves. */
interface PanelState {
  projection: 'linear' | 'graph';
  compact: boolean;
}

const PANELS: ReadonlyMap<string, PanelState> = new Map([
  ['s16a-rail', { projection: 'linear', compact: false }],
  ['s16a-column', { projection: 'linear', compact: false }],
  ['s16b-column', { projection: 'graph', compact: true }],
  ['s16b-expanded', { projection: 'graph', compact: false }],
]);

let styled = false;

function drawPanel(id: string, viewer: ReturnType<typeof projection>['viewer']): void {
  const host = document.getElementById(id);
  const state = PANELS.get(id);
  if (host === null || state === undefined) return;
  // `switchable`, because THIS PAGE WIRES THE COMMAND — see the listener below.
  // The viewer draws the toggle only for a host that says it will complete what
  // the button publishes, so a page that ignored it would draw no toggle at all
  // rather than a dead one.
  const result = renderViewer(viewer, {
    projection: state.projection,
    compact: state.compact,
    switchable: true,
  });
  // ONE STYLESHEET FOR THE PAGE. The viewer emits the same bytes every time, so
  // installing it per panel would be four identical copies of one rule set.
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = result.styles;
    document.head.append(style);
    styled = true;
  }
  host.innerHTML = result.markup;
}

function draw(): void {
  const { viewer } = projection();
  for (const id of PANELS.keys()) drawPanel(id, viewer);

  // THE HOST COMPLETES WHAT THE VIEWER PUBLISHES. `projection:*`, `expand` and
  // `collapse` are commands this package cannot perform on itself — it is a
  // pure renderer — so the page listens for them and re-renders the panel the
  // click came from with a different option. That is the whole contract, and
  // wiring it here is what makes the toggle on these panels a real control.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest('[data-ig-command]');
    const panel = target.closest('[id]');
    if (control === null || panel === null) return;
    const state = PANELS.get(panel.id);
    if (state === undefined) return;
    const command = control.getAttribute('data-ig-command');
    if (command === 'projection:linear') state.projection = 'linear';
    else if (command === 'projection:graph') state.projection = 'graph';
    else if (command === 'expand') state.compact = false;
    else if (command === 'collapse') state.compact = true;
    else return;
    drawPanel(panel.id, viewer);
  });
}

draw();
