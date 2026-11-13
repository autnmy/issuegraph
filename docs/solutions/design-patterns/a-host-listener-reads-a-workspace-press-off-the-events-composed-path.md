---
module: demo workspace host
date: 2026-11-13
problem_type: design_pattern
component: frontend
severity: high
audience: both
related_components:
  - packages/editor
tags:
  - event-handling
  - composed-path
  - microtask
  - mount-workspace
  - host-chrome
applies_when:
  - A host listens for clicks or keys on an element that contains a mounted workspace
  - A host reacts to a command control drawn inside the workspace
---

# A host listener reads a workspace press off the event's composed path

## Context

`mountWorkspace` in `packages/editor/src/workspace/mount.ts` listens for clicks on the mounted element. When it reduces a command, it queues a redraw through `schedule`, which calls `queueMicrotask`. The redraw replaces the surface's markup, so the button the reader pressed is swapped for a new one. A host that listens on an ancestor, as `mountSandbox` in `demo/src/workspace.ts` does on `root`, receives the same click after the mount's listener has run.

Premise about browsers, not shown by this repository's tests: for a real user press, the browser runs pending microtasks after each listener returns. So when the click bubbles up to the host, the redraw has already run. `event.target`, and the control found from it with `closest('[data-ig-command]')`, are now detached from the page, and `root.contains(control)` answers false. The host drops the press. For a click dispatched from script (`element.click()` or `dispatchEvent`), the calling script is still running, so microtasks wait until every listener has returned. A test that dispatches the click sees the control still attached and passes.

## Solution

Read the press off `event.composedPath()`. The browser fixes that list when dispatch starts, and removing nodes later does not change it. Find the command control's index in the path, and decide where it sits by comparing indexes, not by asking the document:

- the control belongs to `root` when its index is below the index of `root`;
- it is inside the mounted workspace when its index is below the index of `workspace`.

`pressOf` in `demo/src/workspace.ts` does exactly this, and both the host's `onClick` and its `onKeydown` read presses through it. The mount's own `onClick` can keep reading `event.target`, because it is the listener that queues the redraw, so nothing is replaced yet when it runs.

Do not count on a dispatched click to cover this in a test. To reproduce it, the control has to be replaced before the host's listener runs, for example by a listener lower on the path that removes it synchronously.

## Why it matters

The failure shows only on real presses. The suite stays green while every command inside the workspace does nothing for a user of the host. Any host that adds its own chrome around the mount and reacts to commands drawn inside it meets this: in the demo, that is `HOST_COMMANDS_FROM_WORKSPACE` and the refresh after a narrow tab press.

## Evidence

- PR #255 replaces the `root.contains(control)` and `workspace.contains(control)` checks in `demo/src/workspace.ts` with `pressOf`, which finds the control in `event.composedPath()` and compares its index with the indexes of `root` and `workspace`. Its doc comment records that the mount's redraw replaces the control before the press bubbles to the host, and that a press dispatched from script does not show it.
- The same pull request adds `onKeydown` in `demo/src/workspace.ts`, which reads its press through the same `pressOf`.
- `packages/editor/src/workspace/mount.ts`, which this pull request also changes, queues each redraw through `schedule`, and `schedule` calls `queueMicrotask`.
- No test in this pull request drives a real user press. The browser ordering in Context is a premise, not a result of this change's tests.
