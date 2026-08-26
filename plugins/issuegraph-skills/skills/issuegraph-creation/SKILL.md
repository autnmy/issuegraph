---
name: issuegraph-creation
description: Render a fresh Issuegraph frontmatter block for a NEW issue using the issuegraph CLI's `set` verb — blocked-by, serialize-with, decomposed-from, duplicate-of, together-with, priority and evidence. Use when filing an issue, decomposing one into sub-issues, or adding declarations to a body that has no block yet, instead of hand-writing the YAML.
---

# Issuegraph — creation

**The question this answers: _how do I put a correct block on an issue I am about to file?_**

**Never hand-write the block.** Every field below has a spelling that looks right
and silently declares nothing, and the CLI knows all of them.

```sh
npm i -g @issuegraph/cli     # `issuegraph` on PATH
```

## The one call

`set` renders a block when the body has none:

```console
$ printf 'The issue body.\n' | issuegraph set --blocked-by 8232 --priority 1 --evidence asserted
---
issuegraph:
  blocked-by:
    - "#8232"
  priority: 1
  evidence: asserted

---

The issue body.
```

Then file it:

```sh
printf '%s\n' "$BODY" \
  | issuegraph set --blocked-by 8232 --evidence asserted > /tmp/body.md
gh issue create -R owner/repo --title "…" --body-file /tmp/body.md
```

**References take any spelling** — `123`, `#123`, `owner/repo#123` — and the CLI
emits the quoted, sigilled form. **`--blocked-by` is the only repeatable one**;
give it once per entry:

```sh
issuegraph set --blocked-by 123 --blocked-by owner/repo#654 < body.md
```

## What each field is for

| field | means | write it when |
|---|---|---|
| `blocked-by` | this cannot start until those close | there is a real order |
| `serialize-with` | these may not be worked *at the same time* | two issues gut the same surface |
| `decomposed-from` | this is a leaf of that parent | you split a parent |
| `duplicate-of` | this is the same question as that | you dedupe; the survivor is the target |
| `together-with` | these are one unit, claimed as one | neither half stands alone |
| `priority` | 0–3 | the tracker has no priority label |
| `evidence` | `asserted` \| `verified` | **always** |

**`evidence` takes exactly two values and anything else is dropped silently**, leaving the block looking complete.

- **`asserted`** — you did not reproduce the claim. The next worker verifies
  first. **This is what every machine-filed issue carries.**
- **`verified`** — you reproduced it *or otherwise confirmed it* (a measurement
  counts). Say **how**, in the body.

A finding you never verified is a hypothesis. Label it as one.

## ⚠ Three fields can only be written on a body with NO block

`together-with`, `priority` and `evidence` are **render-only**. The writer's
splice surface owns generated edges only, so on a body that already has a block
they are refused — loudly, with the reason:

```console
$ issuegraph set --evidence verified < body-that-has-a-block.md
issuegraph: refusing to write evidence into an existing block — the writer's splice surface owns
generated edges only (blocked-by, serialize-with, decomposed-from, duplicate-of).
```

That refusal is the feature. **A write command that exits 0 having changed
nothing tells its caller a thing happened that did not.** Get these three right
at creation time — that is what this skill is for.

## ⚠ Why hand-writing fails, concretely

Four ways, all silent, all of which the CLI gets right for you:

1. **An unquoted `#` opens a YAML comment.** `- #123` parses to `[None]` —
   successfully and empty. An issue with two hard blockers reads as one with
   none. The CLI emits `- "#123"`.
2. **A code fence is armor, not a delimiter.** A block wrapped in ` ``` ` with
   the `---` pair omitted is **inert**: nothing reads it, and it looks exactly
   like an issue with no block. If your tracker needs the fence for rendering,
   wrap the CLI's output — keeping the `---` pair *inside* it.
3. **The blank line before the closing `---` is load-bearing** on GitHub —
   without it the block renders as a heading. The CLI emits it.
4. **An invented `evidence` value is dropped**, not rejected. `measured`,
   `observed` and `reasoned` have all been filed; all three vanished.

## Decomposing a parent — write the edges at split time

The split's deliverable is **the leaves plus their edges**. Write them as you
create each leaf, never "later":

```sh
PREV=                                   # empty: the first leaf blocks on nothing
for leaf in "$@"; do
  printf '%s\n' "$(leaf_body "$leaf")" \
    | issuegraph set --decomposed-from "$PARENT" \
                     ${PREV:+--blocked-by "$PREV"} \
                     --evidence asserted > /tmp/leaf.md
  # `gh issue create` prints the new issue's URL — take the number off the end
  # and CARRY IT, or the chain is never written.
  url=$(gh issue create -R "$REPO" --title "$(leaf_title "$leaf")" --body-file /tmp/leaf.md) || break
  PREV=${url##*/}
done
```

⚠ **`PREV` has to be assigned from each creation, and that line is the whole
chain.** Left unassigned it is empty on every iteration, so `${PREV:+…}` expands
to nothing and **not one `blocked-by` is written** — a decomposition with a real
order ships with no order, silently. Pre-set to some earlier issue instead and it
is worse: every leaf points at that same issue rather than at its predecessor.

**Only chain leaves that genuinely must run in order.** If they are independent,
leave `PREV` empty and write no `blocked-by` at all — a false chain is the "one
issue in disguise" shape, and it serialises work that could have run in parallel.

- `blocked-by` only where a **real** order exists. Do not fake mutual exclusion
  with a false `blocked-by` — that is what `serialize-with` is for.
- `serialize-with` where you forecast a conflict: two leaves gutting one surface.
- **Do not `together-with` leaves of your own split.** If two halves cannot stand
  alone, do not split them.
- Give every leaf a priority.

## Verify what you wrote, before you file it

The block is worthless if it does not read. One call, and it is free:

```sh
issuegraph set --blocked-by 8232 --evidence asserted < body.md > /tmp/body.md
issuegraph parse --body-file /tmp/body.md | jq -e '.state == "read"' >/dev/null \
  || { echo "the block does not read — do not file this"; exit 1; }
```

**Check `state`, not the exit code** — `parse` exits 0 even when the block is
unreadable. That is the single most expensive mistake available here.

## Related

- **issuegraph-selection** — order candidates and see what is ready
- **issuegraph-grooming** — validate, repair and amend blocks that already exist
- **issuegraph** — the full CLI reference
