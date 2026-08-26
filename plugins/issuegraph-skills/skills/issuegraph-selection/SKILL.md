---
name: issuegraph-selection
description: Order a set of candidate issues and answer which of them are ready to work, using the issuegraph CLI's `order` and `ready` verbs. Use when picking the next issue, asking why a high-priority issue is not running, or filtering a candidate set down to what can start now — instead of hand-walking blocked-by edges.
---

# Issuegraph — selection

**The question this answers: _what should I pick up, and why is that P0 not on the list?_**

It replaces a hand-walked `blocked-by` sweep. Hand-walking is where the estate's
readable-block rate went: a reader that mishandles one shape of the grammar
reports "no dependencies" for a body that declares two.

```sh
npm i -g @issuegraph/cli     # `issuegraph` on PATH
```

## The one call

`order` and `ready` are **one derivation, two views**. `ready` is `order`
filtered to the slots that can start now — never a second computation.

```sh
issuegraph ready --input candidates.json      # what can I start?
issuegraph order --input candidates.json      # the whole order, held issues included
```

## What you feed it — and why it never fetches

**The CLI takes no credential and makes no network call.** Readiness needs
closure state, and closure state lives in the tracker, so **you supply it**. That
is exactly what lets this run in a GitHub Action holding only issue bodies.

```json
{
  "homeRepo": "owner/repo",
  "baseRanking": { "source": "config", "order": [
    { "key": "3", "matchedOrderIndex": 0 },
    { "key": "1", "matchedOrderIndex": 1 }
  ] },
  "issues": [
    { "number": 3, "open": true, "labels": ["p0"], "assigneeCount": 0, "body": "<the issue body>" },
    { "number": 1, "open": true, "labels": ["p1"], "assigneeCount": 0, "body": "<the issue body>" }
  ]
}
```

- **`body` is the only edge source.** There is no field for pre-parsed edges, on
  purpose — handing in your own `data` object is the hand-rolled grammar this
  package exists to end.
- **`baseRanking.order` must already be in rank order**; the array index *is* the
  position. It is your tracker's own `ORDER BY`, not something to re-sort.
- `id` (an opaque tracker token like `ENG-456`) works wherever `number` does.
- `closedStateReason` matters: an issue closed *not planned* had its question
  withdrawn, not answered.

Build it from `gh` like this:

```sh
gh issue list -R owner/repo --state all --limit 500 \
  --json number,state,stateReason,labels,assignees,body \
  | jq '{homeRepo:"owner/repo",
         baseRanking:{source:"config", order:[to_entries[]|{key:(.value.number|tostring), matchedOrderIndex:.key}]},
         issues:[.[]|{number, open:(.state=="OPEN"),
                      labels:[.labels[].name], assigneeCount:(.assignees|length), body:(.body//""),
                      closedStateReason:(if (.stateReason // "") == "" then null
                                         else (.stateReason|ascii_downcase) end)}]}' \
  | issuegraph ready
```

**`stateReason` has to be requested and normalised**, or the closure-reason
diagnostic can never fire. `gh` returns it **upper case** (`COMPLETED`,
`NOT_PLANNED`) and `""` for an open issue, while the derivation compares against
lower-case `completed` — so `ascii_downcase` and the `"" -> null` arm are both
load-bearing. Get it wrong and every closed blocker reads as *not* completed, or
as completed, depending on which half you skip.

## ⚠ The trap: `"slots": []` does NOT mean "nothing is ready"

**This is the one that costs you.** When a body's block is found but cannot be
fully read, the derivation refuses that node **fail-safe** — its silence about an
edge is not evidence that it has none. The run still **exits 0**, and `slots`
comes back **empty**:

```json
{ "view": "ready", "slots": [], "underRead": ["1"],
  "diagnostics": ["1: its own issuegraph declaration was not fully read; its silence about an edge is not evidence (fail-safe: refusing the node and its serialize component)"] }
```

An empty `slots` with a non-empty `underRead` means **"I could not tell"**, which
is a different fact from **"nothing is ready"** — and the two are byte-identical
if you only look at `slots`.

**Always read `underRead` before you act on an empty result:**

```sh
issuegraph ready --input candidates.json > out.json
jq -e '(.underRead|length) == 0' out.json >/dev/null \
  || { echo "REFUSING: $(jq -c .underRead out.json) could not be read — repair them first" >&2; exit 1; }
```

⚠ **The `exit 1` is the guard.** `echo` returns **0**, so a refusal branch that
only prints leaves the snippet exiting successfully — and a caller using it to
decide whether to act on `out.json` proceeds into exactly the indeterminate order
it just refused. **A check that detects the bad state and returns success is not
a check**, which is this skill's own subject arriving one layer up. The message
goes to stderr for the same reason: stdout is the answer.

**`backfill` will NOT repair these.** `underRead` is the `unread` state — a block
whose **delimiters are fine** and whose *contents* did not parse, most often
unquoted `#`-refs. `backfill` only inserts missing delimiters, so on such a body
it reports `already-canonical` and changes nothing (measured). The fix is to
correct the block's contents — quote the refs — which the **grooming** skill
covers. Then re-derive.

## ⚠ And `underRead` does not catch everything — an INERT block ranks as READY

This is the gap to know about, because the fail-safe does not cover it.

`underRead` carries the `unread` state only. A body whose block is **inert** — an
`issuegraph:` key inside a fence with no `---` pair, the shape hand-authored
blocks overwhelmingly take — declares nothing *to the reader*, so the derivation
sees a node with no edges and **ranks it `ready: true`**. It never appears in
`underRead`.

Measured on two nodes, both declaring `blocked-by: "#9"`:

```console
$ issuegraph ready --input two.json | jq -c '{slots:[.slots[]|{lead,ready}], underRead}'
{"slots":[{"lead":"1","ready":true}],"underRead":["2"]}
```

`1` is inert and `2` is unread. **They declare the same blocker and only one of
them is refused.**

So `underRead` is necessary and not sufficient. **Before you trust an ordering,
check each body's `state`** — one `validate` per body, branching on `state` and
not on the exit code, for the reason the grooming skill sets out:

```sh
bad=0
while IFS= read -r row; do
  [ -n "$row" ] || continue
  body=$(printf '%s' "$row" | base64 --decode | jq -r .body)
  state=$(printf '%s' "$body" | issuegraph validate | jq -r .state)
  case "$state" in
    read|absent) : ;;
    *) echo "REFUSING: an issue's block is $state — repair before trusting the order" >&2; bad=1 ;;
  esac
done <<EOF
$(jq -r '.issues[] | @base64' candidates.json)
EOF
[ "$bad" -eq 0 ] || exit 1
```

⚠ **Two shapes here are load-bearing and neither is stylistic.**

**The loop is fed by a here-doc, not by a pipe.** `… | while read` runs the loop
in a **subshell**, so `bad=1` is set on a copy and vanishes when the loop ends —
the preflight would detect every unsafe body and still exit 0. Feeding it with a
here-doc keeps the loop in the current shell, where the flag survives.

**The refusal exits nonzero after the loop, rather than aborting inside it.** A
caller runs this to decide whether the derived ordering is trustworthy, and that
is a property of the whole set — so the useful behaviour is to report *every*
unsafe body and then fail, not to stop at the first.

## Why your P0 is not on the list

Use `order`, not `ready`. **`order` keeps held issues in place at `rank: null`
and tells you what is holding them**; `ready` deletes exactly that information.

```console
$ issuegraph order --input candidates.json | jq -c '[.slots[]|{rank,lead,ready,holdReasons}]'
[{"rank":null,"lead":"3","ready":false,"holdReasons":["blocked-by 4 is open"]},
 {"rank":1,"lead":"4","ready":true,"holdReasons":[]},
 {"rank":2,"lead":"1","ready":true,"holdReasons":[]}]
```

*"Why isn't my P1 running"* is answerable in place. That is the whole reason the
held slot is kept rather than dropped.

## Effective priority — the blocker inherits the urgency

A P3 blocking a P0 **is** effectively P0, and the derivation says so rather than
leaving you to notice. In the run above, `#4` is labelled `p3` and ranked first:

```console
$ issuegraph ready --input candidates.json | jq -c '.priority["4"]'
{"declared":3,"effective":0,"promoted":true,"promotedBy":["3"],"notation":"P3 -> 0", …}
```

`promotedBy` names who lent it the urgency. **Working the blocker is working the
blocked tier** — so do not drop to a lower tier while a tier's unready issues
have ready blockers behind them.

## Reading the rest of the answer

| field | what it carries |
|---|---|
| `slots[]` | one slot per unit — a `together-with` group is **one** slot with several `members` |
| `slots[].lead` | the member to address the slot by |
| `slots[].rank` | the position; **`null` means held** (`order` only) |
| `slots[].holdReasons` | why it is held, in words |
| `priority` | declared vs effective, with `promotedBy` |
| `underRead` | ⚠ nodes refused fail-safe — read this first |
| `excluded` | nodes left out of the derivation entirely |
| `diagnostics` | everything the derivation wants to say |

## Rules

- **Never hand-roll the walk.** No `grep blocked-by`, no YAML load, no
  `jq`-over-frontmatter. Quoted historical frontmatter inside a `>` blockquote
  matches a grep and reports a dependency discharged months ago; both the flow
  form (`blocked-by: [1, 2]`) and the dash form are legal and a reader that
  handles one under-reports the other.
- **An edge is provenance, a label is state.** A `blocked-by` naming a closed
  issue is correct history. What comes off when the gate clears is the `blocked`
  **label** — never the edge.
- Refuse a document that names one issue twice; there is no correct reading, and
  the CLI refuses it rather than silently keeping the first.

## Related

- **issuegraph-creation** — render a block on a new issue
- **issuegraph-grooming** — validate, repair and edit blocks that already exist
- **issuegraph** — the full CLI reference
