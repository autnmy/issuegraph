# Changelog

Releases are recorded here. While the spec is a pre-1.0 draft, drafting churn lives in git history, not in version bumps — the version moves when there is a consumer-visible reason for it to move.

## Unreleased

- **Packages workspace.** The repository is now a pnpm workspace publishing `@issuegraph/*` to npm, with CI that typechecks, builds, tests and enforces isolation, and a publish workflow that runs on an explicit GitHub release.
- **`@issuegraph/core` 0.1.0** — the specification's vocabulary as frozen constants and derived types. Its tests read SPEC.md §4.3 directly, so a field added to the spec and not to the package fails the build.
- **`@issuegraph/reader` 0.1.0** — `parseFrontmatter` reads one issue body; `buildModel` derives the ready set, effective priority, serialize and together components, duplicate resolution and cycles from a set of them. Both are pure and total: neither throws on any input, and every anomaly becomes a diagnostic. The parser is a hand-rolled restricted-subset reader with no runtime dependencies, because issue bodies are untrusted and §4.1 requires plain data parsing anyway. `isUnreadDeclaration` is the question a reader must ask before treating a declaration as complete — a dropped field leaves `data` non-null and looking finished.
- **Import linting.** ESLint over `packages/` with `no-restricted-imports`, `import-x/no-absolute-path` and `import-x/no-relative-packages`. A real parser rather than a pattern, so template literals and comments are handled by construction. Each rule has a deliberate-violation test, and a control asserting the config matches the file.
- **Isolation guard.** `pnpm run check:isolation` refuses a forbidden dependency — by key, `npm:` alias target, or git URL — a relative import escaping its own package, and a consumer's brand token in any text a package ships, `package.json` metadata included. It scans by content rather than by an extension list, and does not exempt built output, because what a package can publish is an open set. Proved by tests that break each rule deliberately.
- **Version consistency.** SPEC.md §8 and the README both still said `v0.1.0` while the spec's own version header and this changelog said `0.2.0`. Corrected, and pinned by a test so the header and §8 cannot drift apart again.

## 0.2.0 — 2026-08-15

- §6.4 selection tiebreak: **newest first** is the default (was oldest first), with rationale — starvation avoidance now belongs to effective priority (an old issue that matters inherits urgency from its dependents), while recency buys premise freshness against issue-body rot. A deterministic executor-chosen tiebreak remains conformant.

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
