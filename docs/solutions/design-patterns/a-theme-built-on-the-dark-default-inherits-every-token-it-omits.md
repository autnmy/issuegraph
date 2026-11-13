---
module: demo
date: 2026-11-13
problem_type: design_pattern
component: demo-theme
severity: medium
audience: both
related_components:
  - viewer
  - editor
tags:
  - theme
  - extendTheme
  - colour-tokens
  - contrast
applies_when:
  - a theme is built with extendTheme from defaultTheme
  - the viewer adds a colour token
---

# A theme built on the dark default inherits a dark value for every token it leaves out

## Context

The demo's Light theme, `PAPER_THEME` in `demo/src/workspace.ts`, is built with `extendTheme(defaultTheme, { colors: { ... } })`. It set 17 colour tokens and left out `--ig-state-invalid`, `--ig-state-failed` and `--ig-state-conflict`. Those three fell back to the dark default's pale hues, which nearly vanish on the light page. No test noticed, because the viewer's own "every colour token" test reads only the viewer's copy of the light palette, not the demo's. The comment above the copy said it "cannot drift from what is tested", and nothing held it to that.

## Solution

Test the theme the host actually hands the packages, through the function that builds it (`themeFor('paper')`), against the viewer's exported `COLOR_TOKENS` list: every entry must differ from `defaultTheme`'s value. A token the viewer adds later then fails the host's test until the host sets it. For state hues, also check contrast at the opacity the editor draws each state with (`OVERLAY_TREATMENTS`), not only at full strength, since a faded hue is what lands on the surface.

## Why it matters

`extendTheme` makes a partial theme legal and silent: a missing token is not an error, it is the dark value. A copy of a palette in a second package drifts the moment the source gains a token, and a test in the source package cannot see the copy. The check has to live beside the copy.

## Evidence

- PR #262 (head commit 49ba9ab) adds `--ig-state-invalid` `#5A0000`, `--ig-state-failed` `#3D0F00` and `--ig-state-conflict` `#5C4300` to `PAPER_THEME` in `demo/src/workspace.ts`, and rewrites the comment that claimed the copy could not drift.
- The same PR adds tests in `demo/src/theme.test.ts` that import `COLOR_TOKENS` and `defaultTheme` from `@issuegraph/viewer` and `OVERLAY_TREATMENTS` from `@issuegraph/editor`, and check `themeFor('paper')` token by token and for 3:1 contrast at full strength and at each treatment's opacity.
