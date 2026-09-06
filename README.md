# §16 fidelity screenshots — autnmy/issuegraph#120

An orphan branch carrying only the before/after pairs the pull request references.
It is **not** merged and nothing on `main` depends on it: images live here rather
than in the repository tree so that a fidelity claim is verifiable without adding
1.9 MB of binaries to every clone forever.

Reproduce them yourself: `pnpm build`, `pnpm --filter @issuegraph/demo serve`, then
open `/demo/section16.html`. The clock is fixed, so a screenshot is a reproduction.

- `frame-16a.png` / `frame-16b.png` — §16a and §16b extracted verbatim from
  `Descant Dashboard.dc.html` (2026-09-05 build) and rendered at their own widths.
- `viewer-16a.png` — the viewer's list at 760.
- `viewer-16a-rail.png` — the same list at the 330 rail width §18 fixes.
- `viewer-16b.png` — the expanded graph at 1180.
- `viewer-16b-compact.png` — the in-column spine-only preview.
