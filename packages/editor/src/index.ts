/**
 * `@issuegraph/editor` — everything that mutates an Issuegraph document.
 *
 * Layer 2 of the three-layer seam. Its whole contract is a composition:
 *
 *     composes  @issuegraph/viewer  (layer 1) — the node, edge and badge grammar
 *     composes  @issuegraph/store            — the document, the edit set, the port
 *     never     fetching, auth, persistence, or a write of its own
 *
 * An edit is a `Proposal` handed to the store, which dispatches it to the host's
 * injected `DataSource`. The editor performs none of that itself, which is what
 * lets it be published: what editing drags in — auth, network, the
 * fail-or-conflict state machine — is host-shaped and injected.
 *
 * ## The seam, and why it is a test rather than a sentence
 *
 * Layer 1 and layer 2 ship as separate packages, so the boundary between them is
 * no longer enforced by a repository line. The design says so in as many words:
 * the seam "stops being enforced by construction and becomes discipline — layer 2
 * composes layer 1 through its public surface and never reaches past it."
 *
 * Discipline that nothing checks is a comment. The check is in
 * `eslint.config.mjs`, over the AST: every import of a sibling package must be
 * its BARE specifier, and `require()` is banned outright because it is the one
 * call that walks past every import rule. A reach into
 * `@issuegraph/viewer/src/...` fails lint rather than a code review that might
 * not happen, and `scripts/eslint-rules.test.mjs` proves the rules fire by
 * running them against deliberate violations.
 *
 * The same config carries the purity claim for this package and the viewer — no
 * fetch, no storage, no credentials, no Node builtin. `purity.test.ts` keeps the
 * half no static rule can do: it loads every shipped module with the browser
 * globals removed, which is what catches a computed access like
 * `globalThis['fet' + 'ch']`.
 *
 * ## The one declared crossing
 *
 * The `together-with` connector lives in the VIEWER, not here. A `together-with`
 * edge must be individually selectable, retypeable and deletable, and an
 * enclosure has no edge to click — so the connector is a hit target, and only
 * the layer that computes the layout knows where its endpoints are. Adding it
 * from out here would mean re-deriving positions layer 1 already has, which is
 * the drifting second implementation the package split exists to avoid.
 *
 * It is written down as a declared crossing rather than discovered later. Treat
 * it as the precedent for DECLARING a crossing, never as permission for more.
 *
 * ## The surface
 *
 * Deliberately empty. The overlays, the picker, the create paths, the
 * re-evaluate surface, the audit, the scale ladder and the first-pass queue each
 * land as their own change, and the final shape of this file is decided by the
 * one that assembles the workspace.
 *
 * A published package can add an export later and can never take one back, so
 * nothing is exported before something is owed.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export {};
