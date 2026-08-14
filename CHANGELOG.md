# Changelog

Releases are recorded here. While the spec is a pre-1.0 draft, drafting churn lives in git history, not in version bumps — the version moves when there is a consumer-visible reason for it to move.

## 0.1.0 — 2026-08-14

Initial draft.

- Carrier: standard YAML **frontmatter** on the issue body (`---`-delimited, top of body, never hidden), namespaced under a top-level `issuegraph` key. Nothing bespoke: the universal convention, on purpose.
- Fields: `blocked-by`, `decomposed-from`, `duplicate-of`, `serialize-with`, `together-with`, `priority`, `evidence`.
- No container issues: `decomposed-from` is provenance; tracking issues are replaced by queries; whole-feature gates are ordinary issues blocked by their siblings.
- `serialize-with` groups (connected components, width-1 semaphore, claim-time direction) and `together-with` units (group readiness over boundary-crossing edges, atomic claim, max effective priority, individual closure). The coordination vocabulary is closed at these two; preference fields are rejected.
- Scalar carrier precedence: established tracker conventions (priority labels, an evidence label pair) are canonical over the frontmatter; relationship fields are frontmatter-canonical.
- Writing rules bind every writer; the size rule; closure semantics (any closure unblocks, non-completed closure flags dependents for re-groom); the decision-issue pattern for nameable human gates; holds as executor policy composed via ready-and-eligible selection.
- Reading rules: ready set, backward-flowing effective priority, oldest-first tiebreak, detect-on-read cycles, fail-safe unresolvable references.
- Scope rule: the format describes work, never execution.
