---
name: issuegraph-grooming
description: Validate, amend and repair Issuegraph blocks on issues that already exist, using the issuegraph CLI's validate, backfill, set and splice verbs. Use when a declaration will not parse, when an edge must be added or removed, when a tool maintains generated edges, or when auditing a corpus for unreadable blocks.
---

# Issuegraph grooming

Everything you do to a block that **already exists**: check it, repair it, amend it, or refresh the edges a tool owns.

```sh
npm i -g @issuegraph/cli     # `issuegraph` on PATH
```

## Start by asking what is wrong

```sh
gh issue view 1234 -R owner/repo --json body -q .body | issuegraph validate
```

```json
{
  "state": "inert",
  "ok": false,
  "blockDefect": "undelimited",
  "diagnostics": [
    "issuegraph: an issuegraph key is present but no `---` pair delimits it (a code fence is armor, not a delimiter); block ignored"
  ]
}
```

`validate` is the diagnosis verb: it names the defect and tells you which repair applies. Unlike `parse`, it **does** set a distinguishing exit code — `5` for inert, `3` for unread, `0` for readable — so it is the one verb you may branch on. Even so, prefer `state`: it carries the same fact and cannot be confused with a usage error.

| `state` | means | repair |
|---|---|---|
| `read` | the block parsed | nothing to do |
| `absent` | no block at all | `issuegraph-creation`, if it needs one |
| `inert` | an `issuegraph:` key exists but **no `---` pair delimits it** | `backfill` |
| `unread` | delimited, but its contents could not be read — **edges were NOT reported** | try `backfill`; if it changes nothing, read it by hand |

**`unread` and `inert` both look exactly like "this issue has no dependencies"** to anything that only checks the command succeeded. That is the most expensive mistake available here.

## Repair: `backfill`

`backfill` only ever **inserts the two missing delimiter lines**. It never re-spells a line, never removes one, and refuses outright any shape it cannot establish with certainty. That is what makes it safe to run on anything — the outcome decides, not your guess about the state.

```sh
gh issue view 1234 -R owner/repo --json body -q .body > /tmp/in.md
issuegraph backfill --body-file /tmp/in.md > /tmp/out.md \
  && [ -s /tmp/out.md ] \
  && gh issue edit 1234 -R owner/repo --body-file /tmp/out.md
```

Before and after, on a real body:

```
 Intro.                        Intro.
                       ⟶
 ```yaml                       ```
 issuegraph:                   ---
   blocked-by: ["#42"]         issuegraph:
 ```                             blocked-by: ["#42"]
                               ---
                               ```
```

Four bytes and a fence rewrite, and the block goes from invisible to `read`.

> ⚠️ **The `&&` chain is the safety, not the style.** On a refusal `backfill` writes nothing — but the redirection has **already created `/tmp/out.md` as a 0-byte file**. Unchained, the next line replaces the whole issue body with nothing. `[ -s ]` is the second belt.

**Try the repair before you park anything.** Attempting it costs one command and the outcome is the answer. Measured over one repository's P0 corpus, two issues were `unread`: one was genuinely unrepairable, and the other was repaired by `backfill` in four bytes — an open P0 that a "state name says unrepairable" rule would have parked indefinitely.

**Ask the reader whether the repair worked** rather than trusting the exit code:

```sh
issuegraph validate --body-file /tmp/out.md | jq -e '.state == "read"' > /dev/null \
  && echo repaired || echo "still not readable — read it by hand"
```

## Amend: `set`

Adding and removing edges on an existing block:

```sh
gh issue view 1234 -R owner/repo --json body -q .body \
  | issuegraph set --blocked-by 987 --blocked-by owner/repo#654 > /tmp/body.md \
  && [ -s /tmp/body.md ] \
  && gh issue edit 1234 -R owner/repo --body-file /tmp/body.md
```

- **Repeat `--blocked-by` for each entry** — the flag builds a list, it does not accumulate across runs. What you pass is what the field becomes.
- `--no-blocked-by` / `--no-serialize-with` remove an entry.
- `--priority`, `--evidence` and `--together-with` are refused on a body that already has a block. Changing what a claim asserts is a decision, not an edit; make it deliberately.

**An edge is provenance; a label is state.** A `blocked-by` naming a now-closed issue is *correct history* and should stay. What comes off when the gate clears is the **`blocked` label**. Deleting edges to unblock work destroys the record of why the work was ordered that way.

## Refresh generated edges: `splice`

When a *tool* maintains edges automatically, `splice` rewrites only the fields that tool owns and leaves hand-written ones untouched. Prefer it over `set` for anything automated.

```sh
issuegraph splice --body-file /tmp/in.md --edges '{"blockedBy":["#999"]}' > /tmp/out.md
```

> ⚠️ **`--edges` keys are camelCase, not the YAML spelling.** `blockedBy`, `serializeWith`, `decomposedFrom`, `duplicateOf` — **not** `blocked-by`. The kebab spelling is refused with exit `2` and a message naming the allowed keys, so this fails loudly rather than silently; it is still the first thing everyone gets wrong.

## Auditing a corpus

The one question worth asking across a whole board is *how much of the declared graph is actually visible*:

```sh
gh issue list -R owner/repo --state open --limit 1000 --json number,body \
  | jq -c '.[]' \
  | while read -r row; do
      printf '%s\t%s\n' \
        "$(printf '%s' "$row" | jq -r .body | issuegraph parse | jq -r .state)" \
        "$(printf '%s' "$row" | jq -r .number)"
    done | tee /tmp/audit.tsv | cut -f1 | sort | uniq -c
```

`/tmp/audit.tsv` keeps the per-issue rows so you can pull the numbers for one state
(`awk -F'\t' '$1=="inert"{print $2}' /tmp/audit.tsv`) and feed them straight to the repair above.
`cut | sort | uniq -c` rather than `uniq -w`: BSD `uniq` (macOS) has no `-w`, and the loop is
worth running on a laptop.

Counts by state tell you whether selection is running on a dense graph or a sparse one. A board where most blocks are `inert` is a board whose ordering is confidently wrong, and `backfill` is the drain.

**Re-read immediately before you write.** `gh issue edit` sets the *whole* body, and a backlog is edited continuously — so a write derived from a body you read minutes ago silently clobbers whatever changed in between. There is no compare-and-swap on an issue body; re-deriving from a body read one round-trip earlier is the mitigation, and `backfill` is idempotent so re-running it is always safe.

## Never hand-edit the block

Hand-editing is how a block ends up undelimited, duplicated or unreadable — the states this skill exists to repair. Every write goes through the CLI, including the ones that look too small to bother with.

## Related

- `issuegraph` — the full CLI reference and exit-code table.
- `issuegraph-creation` — writing a block onto a body that has none.
- `issuegraph-selection` — the derivation that refuses the nodes you have not repaired yet.
