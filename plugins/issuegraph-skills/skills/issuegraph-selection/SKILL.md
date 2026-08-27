---
name: issuegraph-selection
description: Order a candidate set of issues and answer which are ready to work, using the issuegraph CLI's order and ready verbs — dependency order, effective priority, serialize and together groups, and the hold reasons behind each refusal. Use when picking up work, building a selection pool, or explaining why an issue is not workable yet.
---

# Issuegraph selection

Answers two questions over a **set** of issues: *what order should these be worked in*, and *which of them can start now*.

Both come from one derivation. `order` returns every slot; `ready` returns the same derivation filtered to the slots that can start. Neither re-implements anything — they call `@issuegraph/reader`'s `buildModel`, which is the same code every other consumer uses.

```sh
npm i -g @issuegraph/cli     # `issuegraph` on PATH
```

## The boundary that shapes the whole input

**The CLI never reaches the network and takes no credential.** Closure state, labels and assignee counts live in the tracker, not in the ticket body — so **you supply them**. That is what lets this run inside a GitHub Action that holds nothing but the bodies.

The practical consequence: you cannot hand it an issue number and get an answer. You build a document.

## The input document

`order` and `ready` read one JSON document, from stdin or `--input`. Every field below is required unless marked optional; the CLI names the exact path of anything missing (`input.issues[0].assigneeCount: expected an integer within the safe range`), so build it incrementally and let the errors drive.

```json
{
  "baseRanking": { "source": "fixture-parity", "createdAt": { "1": 1000, "2": 2000 } },
  "issues": [
    {
      "number": 1,
      "body": "```\n---\nissuegraph:\n  blocked-by: [\"#2\"]\n---\n```\n",
      "open": true,
      "labels": ["p1"],
      "assigneeCount": 0
    },
    {
      "number": 2,
      "body": "plain body",
      "open": true,
      "labels": ["p2"],
      "assigneeCount": 0
    }
  ]
}
```

| field | holds |
|---|---|
| `baseRanking` | how to break ties among equally-ready slots. `{"source":"fixture-parity","createdAt":{<id>:<epoch>}}` ranks by creation time; `{"source":"config","order":[{"key":"…","matchedOrderIndex":0}]}` takes an explicit list. |
| `issues[].number` *or* `issues[].id` | the tracker's identifier. `id` is an **opaque token**, so `ABC-123` works as well as `231` — a Jira or Linear corpus is addressable. Supply one or the other; both is fine only when they agree. |
| `issues[].body` | the ticket body — **the only edge source**. |
| `issues[].open` | closure state, from the tracker. |
| `issues[].labels` | used for priority (`p0`–`p3`). |
| `issues[].assigneeCount` | how many people hold it. Drives serialize-group exclusion. |
| `issues[].repo` | optional; for cross-repo references. |
| `issues[].closedStateReason` | optional, and it matters — see *A closed gate is not always discharged*. |

Build it from `gh` in one pass:

```sh
gh issue list -R owner/repo --state all --limit 1000 \
  --json number,body,state,labels,assignees,createdAt \
  | jq '{
      baseRanking: { source: "fixture-parity",
                     createdAt: (map({ key: (.number|tostring),
                                       value: (.createdAt|fromdate) }) | from_entries) },
      issues: map({ number, body, open: (.state == "OPEN"),
                    labels: [.labels[].name], assigneeCount: (.assignees|length) })
    }' \
  | issuegraph ready
```

## Reading the answer

```sh
issuegraph ready --input issues.json
```

```json
{
  "view": "ready",
  "slots": [
    { "rank": 1, "lead": "2", "members": ["2"], "ready": true,
      "holdReasons": [], "togetherGroupSize": 1, "serializeGroupSize": 1 }
  ],
  "priority": {
    "2": { "declared": 2, "effective": 1, "promoted": true,
           "promotedBy": ["1"], "notation": "P2 -> 1" }
  },
  "excluded": [], "underRead": [], "diagnostics": []
}
```

- **`slots`** — the unit of work, not the issue. A `together-with` group is **one slot with several `members`**; claim it whole or not at all. `lead` is the member to name.
- **`rank`** — position in the order. `null` under `order` means not ready.
- **`holdReasons`** — why a slot cannot start, in plain words (`"blocked-by 2 is open"`). This is the field to quote when you tell someone their issue is not workable; it beats re-deriving the reason.
- **`priority`** — **effective** priority, which is the part worth understanding. Above, issue 2 is labelled `p2` but blocks a `p1`, so it is promoted to effective 1 (`"notation": "P2 -> 1"`, `promotedBy: ["1"]`). **Importance flows backward along blocking edges.** A `p3` blocking your only `p0` is effectively `p0`, and working it *is* working the `p0` tier. Sort on `effective`, never on the label.
- **`underRead`** — nodes whose declaration could not be fully read. See below; this is the field that decides whether the answer is trustworthy.

## `underRead` is the fail-safe — read it before you act on `slots`

A node whose block did not fully parse has **unknown** edges. It is listed in `underRead` and refused rather than being reported as edgeless, because an unreadable declaration and a genuine absence are different facts and only one of them is safe to schedule against.

```sh
issuegraph ready --input issues.json \
  | jq -e '.underRead | length == 0' > /dev/null \
  || echo "some declarations could not be read — repair them before trusting this order"
```

Repair those with the `issuegraph-grooming` skill, then re-run. Do **not** work around them by treating the node as free; that is the exact failure this field exists to prevent.

## Two things the derivation cannot tell you

**A closed gate is not always a discharged one.** An issue closed as *not planned* means the question was withdrawn, not answered. Ordering from closure state alone will confidently sort an issue to the top whose premise no longer holds. Supply `closedStateReason` where you have it, and re-read the premise of anything whose blocker closed as not-planned or duplicate before working it.

**Labels are still holds, and the graph does not carry them.** `blocked`, `waiting` and `needs-human` are executor policy, and the derivation knows nothing about them. A slot can be `ready: true` and still be parked by a label. Compose both: ready **and** unheld.

## Do not hand-roll this

A `blocked-by` walk written by hand is where selection goes wrong, and the failures are quiet:

- **Both edge notations are legal.** `blocked-by: [123, 456]` and a dash list are the same edge. A check that matched only dash lists once reported 88 edgeless issues where the real figure was 37.
- **Quoted history matches a grep.** Bodies routinely quote old frontmatter inside `>` blockquotes; the CLI reads the delimited block, a grep reads the quotation too.
- **Effective priority is not derivable from a label.** Promotion needs the whole graph, so per-issue reasoning cannot reach it.
- **`together-with` is transitive.** The unit is the closure, not the pair.

## Related

- `issuegraph` — the full CLI reference and the `state`-not-exit-code trap.
- `issuegraph-creation` — writing a block on a new issue.
- `issuegraph-grooming` — repairing the blocks this skill refuses to read.
