# Changelog

All notable changes to the Issuegraph specification are recorded here. Until 1.0, breaking changes are expected and versioned as minor bumps.

## 0.2.1 — 2026-08-14

- §4.1 placement: the block goes at the **end** of the issue body (prose leads, graph data trails), optionally in a `<details>` collapse — and MUST NOT be hidden from rendering entirely (HTML comments): invisible data is data nobody maintains.

## 0.2.0 — 2026-08-14

A new coordination field and a carrier-precedence flip for scalars.

- **`together-with` added (§4.3.7):** distinct issues forming one unit of work — selected, claimed, and worked together. Same connected-component encoding as `serialize-with`. Group readiness is all-members-ready over boundary-crossing edges (internal `blocked-by` is advisory, never a readiness input); claims are atomic; group effective priority is the max over members; members still close individually. Canonical uses: cross-repository coupling, and shared-fix coupling (distinct defects, one change — where `duplicate-of` would be false). In-repo use is flagged as a decomposition smell.
- **Scalar carrier precedence (§4.3.5–4.3.6, §4.1):** for `priority` and `evidence`, an established tracker-native convention (priority labels; an evidence label pair) is **canonical**, with the block as mirror/fallback — the reverse of relationship fields. Truth belongs in the carrier people actually edit; nobody bumps a priority by editing body YAML. Relationship fields keep block-canonical (trackers have no native edge convention worth the name).
- §4.3.4 rewording: `serialize-with` + `together-with` are the complete coordination vocabulary beyond `blocked-by`; both are hard constraints; preference-shaped fields remain rejected.
- Grooming (§5.4): surface internal together-group `blocked-by` edges and oversized together groups.

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
