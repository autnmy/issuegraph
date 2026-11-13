---
module: packages/editor test fixtures
date: 2026-11-13
problem_type: convention
component: testing_framework
severity: medium
audience: both
related_components:
  - packages/viewer
  - packages/core
tags:
  - test-fixtures
  - serialize-with
  - edge-cardinality
  - normalize-document
applies_when:
  - A test builds a document with many relationships on one issue
  - A test depends on a relationship count passing a limit, such as the Related groups list's 60 and 300
---

# A test fixture declares a single-reference relationship once per issue

## Context

The format lets an issue declare `blocked-by` many times, but `decomposed-from`, `duplicate-of`, `serialize-with` and `together-with` only once each. `EDGE_CARDINALITY` in `packages/core/src/index.ts` records this. When the viewer reads a document (`normalizeDocument` in `packages/viewer/src/document.ts`), it keeps the first such declaration from an issue and drops the rest. It records a diagnostic for each dropped edge, but nothing throws, and a test that only counts rows never reads the diagnostics.

So a fixture that declares 30 `serialize-with` edges from one hub issue gives a document with one. The Related groups tests in PR #255 needed 61 and 301 relationships on one issue. Written from the hub, the fixture never reached the grouped or searched cases: the test ran a smaller case than the one it named.

## Solution

Build the hub so that each single-reference edge is declared by the other issue. `relatedHubEdges` in `packages/editor/src/testing/workspace.ts` does this. The hub `i0001` declares every `blocked-by` itself, and each other issue declares its own `serialize-with` pointing at `i0001`:

```ts
index % 2 === 0 ? ['blocked-by', 'i0001', key] : ['serialize-with', key, 'i0001'],
```

This works for `serialize-with` because the field has no direction. `SYMMETRIC_EDGE_FIELDS` in `packages/core/src/index.ts` names it, so `A serialize-with B` and `B serialize-with A` state the same fact. The trick does not carry to the whole family:

- `duplicate-of` and `decomposed-from` are directed. Declared from the other end, they state a different relationship.
- `together-with` has no direction, but the viewer also drops a `together-with` edge whose two ends are not in one order slot. A fixture for it must put both ends in one slot as well.

When a test depends on a fixture passing a count, assert the count the reader kept, not the count the fixture wrote. The Related groups test checks that 61 relationships group as 31 `blocked-by` and 30 `serialize-with`, so a fixture that lost edges fails there instead of quietly testing a smaller case.

## Why it matters

A dropped edge does not fail the fixture. It makes the document smaller, and a limit test then checks the wrong side of its limit. Every view that reads relationships per issue (the Inspector, the canvas, the Related groups list) needs large hubs to test its limits, and the cap is easy to forget when the most common field, `blocked-by`, takes many.

## Evidence

- PR #255 adds `relatedHubEdges` to `packages/editor/src/testing/workspace.ts`. Its doc comment states that an issue declares only one `serialize-with`, that the viewer keeps the first and drops the rest, and that each `serialize-with` is therefore declared by the other issue.
- In the same pull request, `packages/editor/src/workspace/related.test.ts` builds its hub from `relatedHubEdges` and asserts that 61 relationships group as 31 `blocked-by` and 30 `serialize-with`.
- Verification step, outside this change: read `EDGE_CARDINALITY` and `SYMMETRIC_EDGE_FIELDS` in `packages/core/src/index.ts`, and the single-cardinality and `together-with` slot checks in `indexEdges` in `packages/viewer/src/document.ts`.
