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
gh issue view 1234 -R owner/repo --json body -q .body | issuegraph backfill > /tmp/body.md \
  && gh issue edit 1234 -R owner/repo --body-file /tmp/body.md
```

⚠ **The `&&` is not style — without it this recipe wipes the issue.** On
`unrecoverable` the command exits **4** and writes nothing to stdout, but the
redirection has *already* created `/tmp/body.md` as a **0-byte file**. In an
ordinary shell (no `set -e`) the next line then runs and replaces the entire
issue body with nothing. Measured: `backfill` rc **4**, output file **0 bytes**.

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

```
x                                      issuegraph:
                                         blocked-by: [8232]
```yaml
issuegraph:
  blocked-by: [8232]
```
```

**On `unrecoverable` there is no `body` key in the JSON at all** — the input was
not repaired, so there is nothing you could write back believing it had been.

```sh
out=$(issuegraph backfill --json --body-file body.md); rc=$?
case "$(printf '%s' "$out" | jq -r .outcome)" in
  delimited)     printf '%s' "$out" | jq -r .body > /tmp/new.md
                 gh issue edit "$n" -R "$REPO" --body-file /tmp/new.md ;;
  unrecoverable) echo "#$n needs a human (exit $rc)" ;;
  *)             : ;;   # nothing to do
esac
```

**Never match the stderr prose to recover the outcome.** A reworded message stops
matching silently and fails open — which is how a repairable block gets skipped
forever and an unrepairable one gets written back unchanged.

## 3. Amend — `splice` for generated edges, `set` for the rest

**Prefer `splice` when a tool maintains edges automatically.** It refreshes only
the *owned generated* edges and leaves hand-written content alone: a field you
give it is owned (existing entries replaced), a field you omit is untouched.

```console
$ issuegraph splice --edges '{"blockedBy":["#9"]}' --body-file body.md
```
---
issuegraph:
  blocked-by:
    - "#9"
  evidence: verified

---
```
```

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
gh issue list -R owner/repo --state open --limit 1000 --json number,body \
  | jq -c '.[]' \
  | while read -r row; do
      n=$(printf '%s' "$row" | jq -r .number)
      state=$(printf '%s' "$row" | jq -r '.body // ""' | issuegraph validate | jq -r .state)
      [ "$state" = "read" ] || [ "$state" = "absent" ] || echo "#$n is $state"
    done
```

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
