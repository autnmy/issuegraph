---
module: packages/viewer and packages/editor stylesheets
date: 2026-11-13
problem_type: convention
component: frontend
severity: medium
audience: both
related_components:
  - packages/viewer
  - packages/editor
tags:
  - css-scope
  - recede
  - footer-row
  - linear-projection
  - graph-projection
applies_when:
  - A rule styles .ig-footer-row, or another row class that a list row builder emits, for the list only
  - A rule in the editor workspace sheet copies a rule from the viewer sheet
  - A test claims a stylesheet rule does not reach the graph
---

# A list-only rule on `.ig-footer-row` names the list root, `.ig-linear`

## Context

The graph does not have its own footer row. Its footer group in `packages/viewer/src/projections/graph.ts` calls the row builders from `packages/viewer/src/projections/linear.ts`, so the graph's runner-held rows and the list's footer rows carry the same class, `ig-footer-row`. A rule written as `.ig-footer-row[...]` therefore styles both projections, even when its author meant the list.

This pull request gives a receded list row the card's ground, `background-color: var(--ig-surface-2)`. The graph draws its footer rows with no ground, so that rule must not reach them. The viewer sheet scopes it to the list. The editor workspace sheet needs the same rule. Scoped only to `.ig-workspace`, it would also give the canvas graph's receded footer rows a ground, because the workspace contains the graph as well as the list.

## Solution

Scope a list-only footer rule to `.ig-linear`. Both the list root and its detached footer carry that class, and the graph's footer does not:

```css
/* packages/viewer/src/styles.ts */
.ig-viewer .ig-slot[data-recede='true'],
.ig-linear .ig-footer-row[data-recede='true'] {
  background-color: var(--ig-surface-2);
}

/* packages/editor/src/workspace/styles.ts */
.ig-workspace .ig-slot[data-recede='true'],
.ig-workspace .ig-linear .ig-footer-row[data-recede='true'] {
  background-color: var(--ig-surface-2);
}
```

When you copy such a rule into another sheet, keep the `.ig-linear` part. A wider root such as `.ig-workspace` does not stand in for it, because the workspace draws a graph as well as a list.

Scope only what is list-only. In this change the muted title, `.ig-footer-row[data-recede='true'] .ig-title`, stays unscoped on purpose: a receded graph footer row mutes its title too. Only the ground and the muted id are list-only.

A test that holds this scope must draw a graph footer row. A list or workspace fixture that has no runner-held slots draws none, so the test passes with or without the scope. The editor test builds the element itself, an `li.ig-footer-row[data-recede="true"]` inside `.ig-workspace .ig-graph`, and checks that it reads no `--ig-surface-2` ground.

## Why it matters

The class name does not say which projection drew the row. Nothing in `styles.ts` shows that the graph reuses the list's builders; you see it only in the imports of `graph.ts`. A reviewer who reads the selector against the list markup sees a correct rule. The defect shows only on the canvas, as a grey band behind a held row that should have no ground.

## Evidence

- PR #274, `packages/viewer/src/projections/graph.ts`: the diff removes the comment in `footerKeys` that said the graph stamps the footer row it returns "because the list draws the same three row builders", and keeps the stamp at that call site through `withRecede`.
- PR #274, `packages/viewer/src/styles.ts`: the new list ground rule uses `.ig-linear .ig-footer-row[data-recede='true']`, and its comment says the rule is scoped to the list because the graph draws its footer rows without a ground. The muted `.ig-title` selector stays unscoped, and the muted `.ig-id` selector is scoped to `.ig-linear`.
- PR #274, `packages/editor/src/workspace/styles.ts`: the receded-row rule uses `.ig-workspace .ig-linear .ig-footer-row[data-recede='true']`, and its comment says the canvas graph draws footer rows too.
- PR #274, `packages/editor/src/workspace/styles.test.ts`: the test 'draws a receded rail row on --ig-surface-2 over a delta tint, with --ig-text-muted text and no opacity' ends by building a graph footer row inside `.ig-workspace .ig-graph` and asserting that its background does not match `var(--ig-surface-2)`.
