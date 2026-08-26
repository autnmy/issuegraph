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
  | issuegraph set --blocked-by 8232 --evidence asserted > /tmp/body.md \
  && gh issue create -R owner/repo --title "…" --body-file /tmp/body.md
```

⚠ **The `&&` is the whole safety of this.** When `set` refuses — an unwritable
field, a body that already carries a block — it exits non-zero having written
**nothing**, but the redirection has *already* created `/tmp/body.md` as a
**0-byte file**. Without the chain the next line files an **empty issue**.
Measured: `set` rc **4**, output file **0 bytes**.

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

**`evidence` takes exactly two values, and the CLI refuses anything else** — `--evidence measured` is a usage error at exit 2 with no body emitted. (A bad value already sitting in a hand-written body behaves oppositely: the reader drops it and the block reads `unread`. The two surfaces are set out under "Why hand-writing fails" below.)

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
4. **An invented `evidence` value vanishes from a hand-written body** — `measured`,
   `observed` and `reasoned` have all been filed, and all three were dropped.
   **The CLI is the half that refuses it**, which is the clearest single reason to
   write through it: `--evidence measured` is a usage error, **exit 2**, and no
   body is emitted at all.

   ```console
   $ issuegraph set --blocked-by 1 --evidence measured < body.md
   issuegraph: set: --evidence "measured" is not one of asserted, verified   # exit 2
   ```

   The two surfaces behave **oppositely**, and it is worth keeping them apart:
   the **flag** is validated and rejects; a value already sitting **in a body** is
   dropped by the reader with a diagnostic, which also makes the whole block
   `unread`. So hand-writing loses the field silently; the CLI will not let you.

## Decomposing a parent — write the edges at split time

The split's deliverable is **the leaves plus their edges**. Write them as you
create each leaf, never "later":

```sh
# A PRIVATE SCRATCH FILE, because this one is a LOOP that FILES ISSUES. `/tmp` is
# shared, so two decompositions running at once — different repos, different
# parents — collide on one fixed path, and the loser files the other's body.
# THE RULE IS "DOES IT WRITE", NOT "DOES IT LOOP". An earlier revision drew that
# line at looping and was wrong: two people running a one-shot repair at the same
# moment collide exactly as two loops do. Anything that WRITES gets its own
# directory; a read-only example may keep a fixed path, since the worst it can do
# is read somebody else's copy of a body it was only going to inspect.
scratch=$(mktemp -d) || exit 1
leaf_file=$scratch/leaf.md              # NOT `leaf` — the loop below binds that

PREV=                                   # empty: the first leaf blocks on nothing
LEAF_PRIORITY=2                         # see below — it can only be set HERE
made=0; total=$#
for leaf in "$@"; do
  # TWO EXPLICIT CALLS, not one with a conditional argument. `${PREV:+--blocked-by
  # "$PREV"}` expands to TWO words in bash and sh and to ONE in zsh, where the CLI
  # then rejects `--blocked-by 902` as an unknown option — so in zsh the loop
  # writes no edges at all while looking correct. Measured in all three shells.
  # EVERY caller-supplied value is resolved and checked HERE, before anything is
  # rendered or filed — so the write path below contains no helper call at all.
  # That is deliberate: guarding them one at a time is a list, and a list of
  # "which helpers need checking" is one somebody finishes wrong. Resolving them
  # all up front leaves nothing to enumerate.
  #
  # A helper's status is otherwise MASKED inside a command substitution: `--title
  # "$(leaf_title "$leaf")"` reports only `gh`'s status, so a helper that fails
  # after emitting partial output files an incorrectly titled issue and chains the
  # next leaf to it.
  text=$(leaf_body "$leaf")   || break
  title=$(leaf_title "$leaf") || break
  [ -n "$text" ] && [ -n "$title" ] || break
  if [ -n "$PREV" ]; then
    printf '%s\n' "$text" \
      | issuegraph set --decomposed-from "$PARENT" --blocked-by "$PREV" \
                       --priority "$LEAF_PRIORITY" --evidence asserted > "$leaf_file" || break
  else
    printf '%s\n' "$text" \
      | issuegraph set --decomposed-from "$PARENT" \
                       --priority "$LEAF_PRIORITY" --evidence asserted > "$leaf_file" || break
  fi
  # NEVER file a body you did not verify was written. A refused `set` exits
  # non-zero having written nothing, while the redirection has already made the
  # file — so without the `|| break` above and the `[ -s ]` below the loop files
  # an EMPTY leaf and then carries its number into the dependency chain.
  [ -s "$leaf_file" ] || break
  # `gh issue create` prints the new issue's URL — take the number off the end
  # and CARRY IT, or the chain is never written.
  url=$(gh issue create -R "$REPO" --title "$title" --body-file "$leaf_file") || break
  PREV=${url##*/}
  made=$((made + 1))
done
rm -rf "$scratch"
[ "$made" -eq "$total" ] || {
  echo "INCOMPLETE SPLIT: created $made of $total leaves; the chain stops there" >&2
  exit 1
}
```

⚠ **`break` succeeds, so the loop exits 0 however early it stopped.** Without the
count check a decomposition that filed three of seven leaves reports success — and
the leaves it did file carry a `blocked-by` chain that simply ends, which is worse
than none: it looks like a deliberate ordering. A partial split needs a human, so
it must exit nonzero and say how far it got.

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
- **Give every leaf a priority, and note it must be done in the `set` call above.**
  `priority` is render-only: once the block exists, `issuegraph set --priority`
  **refuses** it (exit 4, "cannot be amended in one that has"). So a leaf created
  without one cannot be given one through the CLI at all — the recipe passes
  `--priority` up front for exactly that reason. Where the tracker carries
  `p0`–`p3` labels those are canonical and the field is a mirror; where it does
  not, this call is the only chance to set it.

## Verify what you wrote, before you file it

The block is worthless if it does not read. One call, and it is free:

```sh
issuegraph set --blocked-by 8232 --evidence asserted < body.md > /tmp/body.md
issuegraph parse --body-file /tmp/body.md | jq -e '.state == "read"' >/dev/null \
  || { echo "the block does not read — do not file this"; exit 1; }
```

**Check `state`, not the exit code.** The codes are not uniform across verbs or
states — `parse` exits **0** on an `inert` block while `validate` exits **5** —
so a `state` test is the only reading that holds. The measured table lives in the
**issuegraph** reference skill; it is not restated here, because a contract
spelled in three places drifts in one of them (this paragraph was that one).

## Related

- **issuegraph-selection** — order candidates and see what is ready
- **issuegraph-grooming** — validate, repair and amend blocks that already exist
- **issuegraph** — the full CLI reference
