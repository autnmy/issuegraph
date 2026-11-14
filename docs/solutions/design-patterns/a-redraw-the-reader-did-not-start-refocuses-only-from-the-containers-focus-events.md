---
module: packages/viewer
date: 2026-11-14
problem_type: design_pattern
component: viewer
severity: medium
audience: both
related_components:
  - editor
tags:
  - focus
  - redraw
  - resize
  - accessibility
  - mount
applies_when:
  - A redraw the reader did not start (a resize, a host update) removes the subtree that holds focus
  - A mount decides whether to put focus back on a row after it redraws
---

# A redraw the reader did not start puts focus back only from the container's own focus events

## Context

`mountViewer` in `packages/viewer/src/mount.ts` redraws by removing its whole subtree and building a new one. When the reader causes the redraw, with a click or an arrow key, the mount knows focus is on a row and puts it back on `state.focused`. A resize is different. The reader did not press anything, focus can be anywhere on the host page, and `state.focused` only tracks the viewer's own moves. Native Tab is not one of those moves.

The first version of the narrow-width rule refocused `state.focused` after the resize redraw. That sent focus to a stale tab stop (row 33) instead of the row the reader had tabbed to (row 31). It also risked pulling focus out of a host field into the viewer.

## Solution

Three rules, all in `packages/viewer/src/mount.ts`:

1. **Know whether focus is inside from the container's own events, not from the host.** A `focusin` listener sets `focusInside = true`. A `focusout` listener sets it to whether `relatedTarget` is inside the container (`container.contains?.(to) === true`). The module never asks the host for `activeElement`, so it still reaches no global.
2. **Every `focusin` adopts the row it landed on.** The Tab-sync logic that used to live only in `onKeyDown` moved into `adoptFocusFrom(target)`, and `onFocusIn` calls it. So `state.focused` names the row the reader stands on, not the last row the viewer moved to.
3. **`draw()` clears the flag itself.** Removing a focused subtree takes focus with it, and not every engine fires `focusout` when that happens. So `draw()` sets `focusInside = false`, and every caller that puts focus back on a row sets it to `true` beside that `focus()` call. The resize handler reads the flag before it draws (`const refocus = focusInside;`), refocuses only when it was set, and sends the selection notice after refocusing, so a host that moves focus from its callback keeps that move.

The element test double counts `focus()` calls and fires no focus events. It cannot show what a real removal does to `activeElement`. So one case mounts into a real DOM document built with `jsdom`, focuses a row, fires the resize, and checks that `activeElement` is back inside the viewer on the row the reader stood on.

## Why it matters

Each wrong choice fails quietly. Refocusing `state.focused` without adopting `focusin` returns a keyboard user to a row they already left. Refocusing without knowing whether focus was inside steals focus from whatever the reader is typing into elsewhere on the page. Trusting `focusout` alone leaves the flag stuck at `true` after a host redraw in an engine that fires no event, so a later resize pulls focus in from the page. The element double still catches the stale-row case when a test dispatches `focusin` by hand and counts `focus()` calls, as `packages/viewer/src/mount.test.ts` does; only what a real removal does to `activeElement` needs the real-document case in `packages/viewer/src/mount-dom.test.ts`.

The same three rules apply to any future redraw the reader did not start, in this mount or the editor's.

## Evidence

- PR #289 adds `focusInside`, `onFocusIn`, `onFocusOut`, `adoptFocusFrom` and `onResize` to `packages/viewer/src/mount.ts`, and the `focusInside = false;` line in `draw()` with its comment that removal does not always fire `focusout`.
- PR #289 adds optional `contains?(other)` to `MountElement` and `relatedTarget` to `MountEvent` in `packages/viewer/src/mount.ts`, and `TestElement.contains` in `packages/viewer/src/testing/document.ts`.
- The PR body's test-change record says two resize-focus tests in `packages/viewer/src/mount.test.ts` were changed to expect focus on row 31 (the row the reader focused) and row 34 (the row focus moved to), not the stale row 33.
- `packages/viewer/src/mount.test.ts` covers focus leaving the viewer, a host redraw with no `focusout`, and a callback that moves focus during the reduction.
- `packages/viewer/src/mount-dom.test.ts` adds the real-document case, and its header explains that the element double cannot answer focus.
