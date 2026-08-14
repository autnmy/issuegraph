# Changelog

All notable changes to the Issuegraph specification are recorded here. Until 1.0, breaking changes are expected and versioned as minor bumps.

## 0.1.0 — 2026-08-14

Initial draft.

- Format: `issuegraph:` fenced YAML block in the issue body; canonical over any native-feature mirror.
- Fields: `blocked-by`, `decomposed-from`, `duplicate-of`, `serialize-with`, `priority`, `evidence`.
- No container issues: `decomposed-from` is provenance, tracking issues are replaced by queries, whole-feature gates are ordinary issues blocked by their siblings.
- `serialize-with` groups as connected components (width-1 semaphore, claim-time direction, fail-safe merge).
- Writing rules: graph data written at creation time by every writer (decomposers, groomers, triage, residual filers, humans); the size rule; closure semantics (any closure unblocks; non-completed closure flags dependents for re-groom).
- Reading rules: ready set, backward-flowing effective priority, oldest-first tiebreak, detect-on-read cycles, fail-safe unresolvable references.
- Scope rule: the format describes work, never execution.
