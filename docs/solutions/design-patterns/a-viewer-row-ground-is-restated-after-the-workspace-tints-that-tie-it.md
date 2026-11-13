---
module: packages/editor workspace styles
date: 2026-11-13
problem_type: design_pattern
component: frontend
severity: medium
audience: both
related_components:
  - packages/viewer
  - packages/editor
tags:
  - css-cascade
  - specificity
  - recede
  - delta-tint
  - stylesheet-order
applies_when:
  - The viewer stylesheet adds a rule that sets a row's ground from a state stamp such as data-recede
  - The editor workspace stylesheet sets background-color on .ig-slot or .ig-footer-row
  - A test asserts that one stylesheet rule wins over another
---

# A viewer row ground is restated after the workspace tints that tie it

## Context

The editor workspace installs the viewer's stylesheet first and its own sheet after it. The workspace sheet tints a row that an edit changed, through `background-color` on `.ig-workspace .ig-slot[data-ig-delta=...]` and the same rules on `.ig-footer-row`. These selectors have the same specificity as the viewer's new receded-row ground, `.ig-viewer .ig-slot[data-recede='true']`. With equal specificity the later sheet wins. So a row that the selection receded and the edit also changed kept its tint, and it looked like a row the selection touches.

## Solution

Restate the viewer's ground in the workspace sheet, after every tint, at no less specificity than the tint it must beat:

```css
.ig-workspace .ig-slot[data-recede='true'],
.ig-workspace .ig-linear .ig-footer-row[data-recede='true'] {
  background-color: var(--ig-surface-2);
}
```

The `.ig-slot` selector ties the tints on specificity and wins because it comes after them. The footer selector also names `.ig-linear`, so it carries one more class than a `.ig-workspace .ig-footer-row[data-ig-delta=...]` tint and wins on specificity. It sets `background-color`, not the `background` shorthand, so the hatch on a held row, which is a `background-image`, stays. The delta chip and the row's accessible name still tell the reader what the edit changed.

Test the order with a control case. The test in `packages/editor/src/workspace/styles.test.ts` reads the cascade in two steps:

1. It selects `i0001`, which keeps the tinted rows `i0001` and `i0002`. It asserts that at least one tinted row that is not receded reads a `color-mix` tint. If the cascade reader found no tint here, a later pass would prove nothing.
2. It selects `i0005`, which has no relationships, so every other row recedes, tinted rows included. It asserts that each receded row reads `var(--ig-surface-2)`, that each title and id reads `var(--ig-text-muted)`, and that no element sets `opacity` or `filter`.

## Why it matters

The viewer's rule looks correct when you read the viewer alone, and the viewer's own tests pass. The conflict exists only when both sheets are installed, which is in the editor. Each new state rule in `packages/viewer/src/styles.ts` that sets a row's ground has the same problem. That includes any stamp other than `data-recede`. Check the workspace sheet for a tint that ties it, and restate the ground after that tint.

## Evidence

- PR #274, `packages/editor/src/workspace/styles.ts`: the new rule comes after the delta tints. Its comment says the tints tie layer 1's recede ground on specificity, that this sheet loads after it, and that without the rule a receded row the edit changed kept its tint.
- PR #274, `packages/viewer/src/styles.ts`: the new layer-1 ground rule is `.ig-viewer .ig-slot[data-recede='true']`, `.ig-linear .ig-footer-row[data-recede='true']` with `background-color: var(--ig-surface-2)`.
- PR #274, `packages/editor/src/workspace/styles.test.ts`: the test 'draws a receded rail row on --ig-surface-2 over a delta tint, with --ig-text-muted text and no opacity' runs the `i0001` control and the `i0005` check described above. The shared `declaredOf` reader in that file now ranks a declaration by `!important` first, then specificity, then source order.
