---
module: store
date: 2026-11-14
problem_type: design_pattern
component: store-held-order
severity: medium
audience: both
related_components:
  - editor
tags:
  - held-order
  - change-summary
  - lastChange
  - attribution
applies_when:
  - a derived view is held still while writes are pending and summarised once they settle
  - a read or an unchanged answer can adopt another person's change inside a held period
---

# A held summary diffs against the order of any foreign change adopted before the first save

## Context

`@issuegraph/store` holds the order still while any write is pending, then derives it once and records `lastChange`, what the saved writes did to the order. The first version diffed the new order against the rows held since the period began. But a held period can also adopt documents that are not the reader's save: the read inside "Redo on the latest version", or an `unchanged` answer. Their movement was then counted in "Saved: N moved" and credited to the reader. Before the hold existed, each adoption re-derived at once, which reset the baseline, so the bug only appeared when the hold was added.

## Solution

Keep the summary's baseline apart from the published rows. When a foreign document is adopted inside a held period before any write lands, derive its order privately (`privateDerive`), store it on the owed derivation as `baseline`, and leave the published rows alone so the order still holds. At the end of the period, diff against `baseline ?? rows`. If that private derivation throws, store `'underivable'` and claim no summary. A period whose own derivation throws, or that recovers from one, clears `lastChange` rather than leaving an older save's summary beside the new order.

## Why it matters

A summary is evidence about one person's edit. Holding a view still separates two things that used to happen together: what the reader sees and what the next diff is measured from. Moving one without the other credits someone else's change to the reader, and the rows on screen give no sign of it. A foreign change adopted after a landing in the same period still cannot be told apart from the save's own movement; the store's comment on `owed` says so.

## Evidence

- PR #284 in autnmy/issuegraph, commit e8188a6: `owe` in `packages/store/src/store.ts` records a privately derived `baseline` for a foreign adoption before any landing, and `reDerive` diffs against it. The test "a redo on the latest version credits only its own movement, not the upstream change it read" in `packages/store/src/store.test.ts` failed on the previous store and passes with the change.
- The same PR, commit fac06dd: `privateDerive` returns `'underivable'` when the deriver throws, and the test "a redo whose upstream order cannot be derived claims no summary rather than crediting the upstream change" pins that no summary is claimed.
- Commit e8188a6 also adds "a save the deriver could not summarise clears the old summary, and so does the recovery after it".
