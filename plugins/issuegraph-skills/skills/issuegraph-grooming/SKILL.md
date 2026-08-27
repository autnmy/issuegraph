---
name: issuegraph-grooming
description: Validate, repair and amend the Issuegraph block on issues that already exist, using the issuegraph CLI's `validate`, `backfill`, `splice` and `set` verbs. Use when auditing a backlog for unreadable blocks, repairing a block a code fence left inert, refreshing generated edges, or clearing an edge — instead of editing the YAML by hand.
---

# Issuegraph — grooming

**The question this answers: _is this issue's block actually being read, and how do I fix it if not?_**

An issue whose block does not read is worse than one with no block: it looks
declared and behaves undeclared, so its blockers are invisible to selection and
the work gets handed to whoever asked.

```sh
npm i -g @issuegraph/cli     # `issuegraph` on PATH
```

## How to read the recipes here

**They are fragments, not programs.** Each one shows the CLI call it is about;
none of them is a hardened script, and dropping one into automation unchanged is
your decision to make, not mine.

**Three rules bind all of them, so they are stated once here rather than
re-derived in each.** Every one is the same mistake this whole toolchain is
about — an absence rendered as a value — arriving through a different door:

1. **A fetch that fails must not read as an empty result.** `gh issue list`
   failing on auth or connectivity yields no rows, and a loop over no rows
   reports a clean corpus. Capture its status before you use its output.
2. **Never consume a file you have not proved non-empty.** A redirection creates
   the file even when the command wrote nothing, so `cmd > f` followed by
   `--body-file f` can write an empty body over a real one.
3. **Never accumulate a count or a flag inside a pipe.** `… | while` runs in a
   subshell; the variable you set there does not survive, so the check reports
   the state it would have had if it found nothing.

**Where the rules are applied in full, and where they are not.** Every recipe that
can **WRITE** — an issue edit, an issue create — implements all three inline,
because a copied recipe that writes is one that can destroy something. The
one-shot **read** examples (`… | issuegraph parse`) are shown bare: their failure
prints on your terminal, and there is nothing to corrupt. If you lift a read
example into automation, rule 1 becomes yours to add.

## 1. Audit — what is wrong with this block?

```sh
gh issue view 1234 -R owner/repo --json body -q .body | issuegraph validate
```

```json
{ "state": "read", "ok": true, "diagnostics": [] }
```

## ⚠ Read `state`, NEVER the exit code

The exit code is **not** a substitute for `state`, and the reason is sharper than
"it might not be": the two verbs answer differently for the same body, and the
one cell that fails **open** is the one a caller is most likely to hit.

Measured on the built binary:

| `state` | means | `parse` | `validate` | do |
|---|---|---|---|---|
| `read` | the block parsed | `0` | `0` | use `data` |
| `absent` | there is genuinely no block | `0` | `0` | nothing to do |
| `unread` | delimited, and its contents could not be read — **edges were NOT reported** | `3` | `3` | treat as UNKNOWN, **never** as "no edges" |
| `inert` | a key exists but **no `---` pair delimits it**, so nothing reads it | **`0`** ⚠ | `5` | `backfill` (see below) |

**`parse` on an `inert` block exits 0.** That is the cell that costs you: an
undelimited block is the shape hand-authored blocks overwhelmingly take, and a
caller checking only `parse`'s exit code reads it as success and its payload as
"this issue has no dependencies". `state` is the field that says otherwise.

Branching on the code is also not *portable between the two verbs* — the same
`inert` body is `0` from one and `5` from the other — so a recipe that swaps
`parse` for `validate` silently changes meaning. Read `state` in both.

## 2. Repair — `backfill`

`backfill` inserts the two missing delimiter lines and **changes nothing else**.
It never re-spells or removes a line, and it refuses outright any shape it cannot
establish with certainty.

```sh
# A PRIVATE DIRECTORY, because this recipe WRITES. `/tmp` is shared, so two people
# — or two jobs — repairing DIFFERENT issues at the same time collide on these
# paths, and one can transform the other's fetched body and then write it back to
# the wrong issue. Being a one-shot does not help: it is concurrency, not looping,
# that collides.
d=$(mktemp -d) || exit 1

# The fetch goes to a FILE and its status is checked, and the body is extracted
# with `jq -j` — never through `$(…)`. Both halves matter and they fail
# differently; see below.
gh issue view 1234 -R owner/repo --json body > "$d/issue.json" \
  || { echo "could not read the issue; nothing was written" >&2; rm -rf "$d"; exit 1; }
jq -j .body "$d/issue.json" > "$d/orig.md" || { rm -rf "$d"; exit 1; }

# BRANCH ON THE OUTCOME, NOT ON WHETHER BYTES CAME BACK. `--json` reports which
# of the four outcomes happened, and only `delimited` changed anything — so it is
# the only one that may reach `gh issue edit`.
#
# A SIZE CHECK CANNOT STAND IN FOR THAT, and the case it gets wrong is ordinary:
# an issue whose body is genuinely EMPTY yields `no-block` at exit 0 with a
# zero-byte body, which is a correct no-op. A `[ -s ]` gate reads that as failure
# and reports a grooming run that broke on an issue there was nothing to repair.
#
# THE STATUS IS CAPTURED BEFORE THE CLEANUP AND RETURNED AFTER IT. `rm -rf`
# succeeds, so an unconditional cleanup would make IT the recipe's exit status,
# and a failed `gh issue edit` would report 0 while the issue was never updated.
rc=0
if issuegraph backfill --json --body-file "$d/orig.md" > "$d/out.json"; then
  outcome=$(jq -r .outcome "$d/out.json") || outcome=
  case "$outcome" in
    delimited)
      # The ONLY outcome that rewrote the body, so the only one that writes.
      jq -j .body "$d/out.json" > "$d/body.md" \
        && [ -s "$d/body.md" ] \
        && gh issue edit 1234 -R owner/repo --body-file "$d/body.md" || rc=$?
      ;;
    already-canonical|no-block)
      # Nothing to repair. A successful no-op, not a failure.
      echo "#1234: nothing to repair ($outcome)"
      ;;
    *)
      echo "#1234: unexpected outcome '${outcome:-<unreadable>}'; nothing written" >&2
      rc=1
      ;;
  esac
else
  # Exit 4 is `unrecoverable` — the block cannot be repaired without guessing.
  # Reported, never written, and it needs a human.
  rc=$?
  echo "#1234: backfill refused (exit $rc); needs a human" >&2
  jq -r '.diagnostics[]?' "$d/out.json" 2>/dev/null >&2
fi
rm -rf "$d"
exit "$rc"
```

⚠ **This recipe can wipe an issue through TWO different doors, and both are
measured.** They are worth separating because guarding one leaves the other open
— which is exactly what an earlier revision of this block did.

**The transform refusing.** On `unrecoverable`, `backfill` exits **4** having
written nothing, while the redirection has *already* created `/tmp/body.md` as a
**0-byte file**. Without the `&&`, the next line replaces the whole body with
nothing.

**The fetch failing.** This is the subtler one. If `gh issue view` fails, the
pipeline hands `backfill` an **empty input** — and backfill answers `no-block` at
exit **0**, because an empty body genuinely has no block. So the `&&` *passes*,
the file is empty, and the edit runs. Measured end to end: fetch fails → backfill
rc **0**, output **0 bytes** → the edit fires. Guarding the transform does not
guard the fetch; only reading the fetch's own status does.

`[ -s ]` is the belt behind both.

⚠ **And the body never passes through `$(…)`, which is why the fetch lands in a
file.** A command substitution **strips every trailing newline**, so
`body=$(gh issue view …)` silently deletes them and the edit writes back a body
that differs from the original — the same content modification `jq -j` exists to
prevent, arriving from the opposite direction. Measured: a 20-byte body ending in
three newlines comes back **17 bytes** through `$(…)` and **20** through
`jq -j` to a file. `backfill` promises to insert two delimiter lines and change
nothing else; a substitution anywhere on the path breaks that promise.

In a loop, gate on the outcome instead — see below.

### Grooming a whole backlog? Use `--json`

In a loop you must branch on **which** outcome you got, and the plain form
publishes that only as prose on stderr. `--json` puts it on stdout as data:

```console
$ issuegraph backfill --json --body-file body.md
{ "outcome": "delimited",
  "body": "…the repaired body…",
  "diagnostics": [] }
```

| `outcome` | means | do |
|---|---|---|
| `delimited` | repaired | **write `body` back** |
| `already-canonical` | the block was fine | nothing |
| `no-block` | there is no block | nothing |
| `unrecoverable` | cannot be repaired without guessing | **leave it; a human decides** — exits `4` |

**`validate` cannot substitute for this, and that is measured, not assumed.**
These two bodies produce byte-identical `validate` output —
`{"state":"inert","ok":false,"blockDefect":"undelimited"}` — while `backfill`
repairs the first and refuses the second:

````
x                                      issuegraph:
                                         blocked-by: [8232]
```yaml
issuegraph:
  blocked-by: [8232]
```
````

**On `unrecoverable` there is no `body` key in the JSON at all** — the input was
not repaired, so there is nothing you could write back believing it had been.

```sh
# `if out=$(...)` — NOT `out=$(...); rc=$?`. Under `set -e` a plain assignment
# inherits the command's status, so an `unrecoverable` body (exit 4) aborts the
# whole sweep before the `case` ever runs: one unrepairable issue kills the
# backlog pass instead of reaching the escalation branch. Verified both ways.
# A PRIVATE SCRATCH FILE: this runs over a whole backlog and EDITS issues, and
# `/tmp` is shared — two sweeps at once on different repos would collide on one
# fixed path and write each other's bodies. The single-shot repair above may use
# a private directory. There is NO carve-out for one-shots or for read-only
# examples: the first produced a cross-issue write, and the second a verification
# that could report on somebody else's body — and that verdict gates a filing.
new=$(mktemp) || exit 1
if out=$(issuegraph backfill --json --body-file body.md); then rc=0; else rc=$?; fi
case "$(printf '%s' "$out" | jq -r '.outcome // ""')" in
  delimited)                  # `jq -j`, NOT `-r`: `-r` appends its own newline, so every
                              # repaired body would gain one — changing user content beyond
                              # the two delimiter lines `backfill` promises to insert.
                              # Measured: 51-byte body -> 52 with `-r`, 51 with `-j`.
                              # ONE conditional, and the EXTRACTION is inside it. `[ -s ]`
                              # proves the file is non-empty, which is not the same as proving
                              # the render finished: a `jq` that dies part-way (a full disk)
                              # leaves a NON-EMPTY truncated file, and the edit would then
                              # overwrite a real issue with half a body. Non-emptiness is a
                              # belt; the producer's status is the braces.
                              # The write's own failure is recorded too — a transient API or
                              # permission error must not leave the sweep reporting success
                              # over an issue it did not repair.
                              if printf '%s' "$out" | jq -j .body > "$new" \
                                   && [ -s "$new" ] \
                                   && gh issue edit "$n" -R "$REPO" --body-file "$new"
                              then :
                              else echo "#$n: repaired body was NOT written" >&2; broke=1
                              fi ;;
  already-canonical|no-block) : ;;                       # genuinely nothing to do
  unrecoverable)              echo "#$n needs a human (exit $rc)" >&2; human=1 ;;
  *)                          echo "#$n: backfill did not answer (exit $rc) — NOT skipped" >&2; broke=1 ;;
esac
# ...after the sweep:
rm -f "$new"
[ "${broke:-0}" -eq 0 ] && [ "${human:-0}" -eq 0 ] || exit 1
```

⚠ **The wildcard must not mean "nothing to do".** `backfill` failing for any
reason that is *not* its structured refusal — an unreadable `--body-file`, an
option an older binary does not have, an internal error — leaves `out` **empty**,
so `jq` yields an empty outcome and a `*) : ;;` arm silently skips that issue
while the sweep reports success. **Enumerate the outcomes you handle and treat
everything else as an error**, which is what makes the two arms above different:
`already-canonical` and `no-block` really are nothing to do; an empty outcome is
"I could not tell", and the two must not share a branch.

⚠ **The sweep exits nonzero at the END, not on the first bad issue.** Aborting
inside the loop is the `set -e` defect one section up, inverted — one unrepairable
issue would take the whole pass down. Completing the pass and failing afterwards
gives you both: every issue attempted, and a status a caller can branch on.

**Never match the stderr prose to recover the outcome.** A reworded message stops
matching silently and fails open — which is how a repairable block gets skipped
forever and an unrepairable one gets written back unchanged.

## 3. Amend — `splice` for generated edges, `set` for the rest

**Prefer `splice` when a tool maintains edges automatically.** It refreshes only
the *owned generated* edges and leaves hand-written content alone: a field you
give it is owned (existing entries replaced), a field you omit is untouched.

````console
$ issuegraph splice --edges '{"blockedBy":["#9"]}' --body-file body.md
```
---
issuegraph:
  blocked-by:
    - "#9"
  evidence: verified

---
```
````

`--evidence` survived untouched because splice was not given it.

**Clearing an edge** — `--no-blocked-by` and `--no-serialize-with` only:

```sh
issuegraph set --no-blocked-by --body-file body.md
```

`decomposed-from` and `duplicate-of` **cannot be cleared**, deliberately: they
carry provenance and a dedupe verdict, not scheduling state, and a machine
refreshing its owned edges must not erase them by omission. `together-with`,
`priority` and `evidence` cannot be amended at all once a block exists — they are
render-only. Every one of these is **refused with the reason**, never silently
dropped.

## ⚠ An edge is provenance. A label is state.

**A `blocked-by` naming a now-closed issue is correct history and stays.** What
comes off when the gate clears is the **`blocked` label**.

Deleting edges to unblock work destroys the record of why the work was ordered
that way, and the next reader cannot tell a discharged dependency from one that
never existed.

## Sweeping a backlog

```sh
# Rule 1: the fetch's status, captured BEFORE anything reads its output.
limit=1000
rows=$(gh issue list -R owner/repo --state open --limit "$limit" \
         --json number,body --jq '.[] | @json') \
  || { echo "could not list issues — this says NOTHING about the corpus" >&2; exit 1; }

# A CAP THAT BINDS IS NOT A CLEAN CORPUS. `--limit` is a maximum, so a backlog
# larger than it is silently truncated and everything past the cap goes
# uninspected — while the sweep still prints "0 unreadable" and exits 0. If the
# fetch came back exactly at the limit, say so rather than reporting a result
# about a set you did not see.
[ "$(printf '%s\n' "$rows" | grep -c .)" -lt "$limit" ] \
  || { echo "fetched exactly $limit issues — the backlog may be larger; this result is NOT a clean corpus" >&2; exit 1; }

found=0
while IFS= read -r row; do
  [ -n "$row" ] || continue
  n=$(printf '%s' "$row" | jq -r .number)
  state=$(printf '%s' "$row" | jq -r '.body // ""' | issuegraph validate | jq -r .state)
  case "$state" in
    read|absent) : ;;
    *) echo "#$n is $state"; found=$((found + 1)) ;;
  esac
done <<EOF
$rows
EOF
echo "$found unreadable"
[ "$found" -eq 0 ]      # exit status IS the answer: 0 = the corpus is clean
```

This one shows rules 1 and 3 together because it is where they bite hardest — the
sweep's **exit status is its answer**, so either mistake reports a clean corpus it
never looked at. A failed `gh` expands to nothing, the loop sees no rows, and
`found=0` is indistinguishable from a healthy backlog; and inside a pipe the
counter would be zero however many rows it printed. Measured both ways.

Two things to hold on to:

- **Report before you write.** Run the sweep read-only first; a repair pass over
  a backlog you have not looked at is how a bad transform reaches a thousand
  issues.
- **Re-read each body immediately before you write it.** A backlog is edited
  continuously, and a tracker offers no compare-and-swap on a body, so a write
  from a read taken minutes ago silently clobbers whatever changed in between.
  `backfill` is idempotent, so re-deriving from a fresh read is always safe.

## Related

- **issuegraph-selection** — order candidates and see what is ready
- **issuegraph-creation** — render a block on a new issue
- **issuegraph** — the full CLI reference
