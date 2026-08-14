# Changelog

All notable changes to the Issuegraph specification are recorded here. Until 1.0, breaking changes are expected and versioned as minor bumps.

## 0.1.1 — 2026-08-14

Holds and human gates — issues can be unworkable for non-inter-issue reasons, and the spec now says where that lives.

- §2: hold conventions (e.g. a `needs-human` label) are tracker/executor policy, never format fields.
- §6.8 (new): selection composes **graph readiness** with **executor eligibility**; a held issue is ready-but-ineligible and invisible to selection. Effective priority still propagates through held issues — urgency trapped behind an unattended hold is surfaced, not hidden.
- §5.5 (new): the decision-issue pattern — *if you can name the question, make it a node; if you can't, hold the issue.* A nameable human blocker becomes an ordinary issue in `blocked-by`, routed to humans by the executor's capability classification, with effective priority ordering the human's decision queue. Holds convert to decision issues when the question crystallizes.
- §5.4: grooming also surfaces long-lived holds.
- §6.4: selection rule restated over ready **and eligible** issues.

## 0.1.0 — 2026-08-14

Initial draft.

- Format: `issuegraph:` fenced YAML block in the issue body; canonical over any native-feature mirror.
- Fields: `blocked-by`, `decomposed-from`, `duplicate-of`, `serialize-with`, `priority`, `evidence`.
- No container issues: `decomposed-from` is provenance, tracking issues are replaced by queries, whole-feature gates are ordinary issues blocked by their siblings.
- `serialize-with` groups as connected components (width-1 semaphore, claim-time direction, fail-safe merge).
- Writing rules: graph data written at creation time by every writer (decomposers, groomers, triage, residual filers, humans); the size rule; closure semantics (any closure unblocks; non-completed closure flags dependents for re-groom).
- Reading rules: ready set, backward-flowing effective priority, oldest-first tiebreak, detect-on-read cycles, fail-safe unresolvable references.
- Scope rule: the format describes work, never execution.
