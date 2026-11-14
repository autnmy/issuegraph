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
  - resize-observer
  - no-globals
  - default-view
  - testing
  - mount
applies_when:
  - A mount that must reach no global needs a browser API such as ResizeObserver
  - A rule depends on a measured box and also on watching it change
---

# A global-free mount takes its observer from the element's own document, and measures without it

## Context

`packages/viewer/src/mount.ts` reaches no global. It takes its document from the container the caller passed. That keeps the module importable on a runtime with no DOM. The narrow-width rule in PR #289 needed a `ResizeObserver`, which in a browser is a window global. Reading `globalThis.ResizeObserver` would break the property, and it would also make tests depend on patching the global.

## Solution

- **Take the observer from the element's own document.** Both mounts read `ownerDocument.defaultView?.ResizeObserver`. In the viewer that is `doc.defaultView?.ResizeObserver`. `SpecDocument` in `packages/viewer/src/element.ts` gains an optional `defaultView` typed as only the slice the mount reads. In a browser this is the same constructor as the global. A test injects a fake on the document (`TestDocument.defaultView`, `testResizeObservers()` in `packages/viewer/src/testing/document.ts`) or on the jsdom window, which is the element's `defaultView`.
- **Keep measuring separate from watching.** Each mount measures its box with `getBoundingClientRect` and applies the rule before the first draw, whether or not an observer exists. It attaches the observer only when the document offers one. A document with no view, or a view with no observer, still gets the rule at mount and loses only the resize watch. A missing `getBoundingClientRect` means "never narrow", not an error.
- **Prove the global is not used.** The viewer tests install a counting `ResizeObserver` on `globalThis` and assert it recorded no use, including for documents whose `defaultView` is unset, `null`, or `{}`. Without that, a fallback to the global passes every other test.
- **Give the root its own observer in the editor.** `packages/editor/src/workspace/mount.ts` builds `rootResize` instead of reusing `railResize`, because `dockRailLegend` disconnects and re-observes `railResize` on every redraw.
- **Ignore a callback after `destroy`.** Both callbacks start with `if (destroyed) return;`, because a browser can deliver a callback it queued before `disconnect()`. The fake's `fire()` still runs after `disconnect()` so a test can check this.

## Why it matters

Tying the rule to the observer would leave a server-built or older document with no rule at all. Reading the global would quietly break the viewer's no-global property, and only a test that watches the global would catch it. The same approach fits the next browser API a global-free mount needs.

## Evidence

- PR #289 adds `defaultView?: { ResizeObserver?: ... } | null` to `SpecDocument` in `packages/viewer/src/element.ts`.
- `packages/viewer/src/mount.ts` measures with `measuresNarrow()` before `draw()`, then builds `resizeWatch` from `doc.defaultView?.ResizeObserver` only when defined, and disconnects it in `destroy()`.
- `packages/editor/src/workspace/mount.ts` builds `rootResize` from `doc.defaultView?.ResizeObserver`, with a comment naming why it is not `railResize`.
- `packages/viewer/src/mount.test.ts` adds the tests that take the observer only from the container document and that reduce at mount with no observer, each asserting the counting global saw no use.
- `packages/viewer/src/testing/document.ts` adds `MeasuredTestElement`, `createMeasuredContainer` and `testResizeObservers()`.
