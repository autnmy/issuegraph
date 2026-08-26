---
name: issuegraph
description: Read and write the Issuegraph block in a GitHub issue body using the issuegraph CLI — dependency edges (blocked-by, serialize-with, decomposed-from, duplicate-of, together-with), priority, evidence, and the derived selection order. Use whenever you need to know what blocks an issue, what is ready to work, or to edit those declarations safely.
---

# Issuegraph

> **This is the reference — every verb and every flag.** For the three things
> done constantly there are task-shaped skills that are usually the better entry
> point: **issuegraph-selection** (what should I pick up, and why is that P0
> held?), **issuegraph-creation** (put a correct block on a new issue), and
> **issuegraph-grooming** (is this block being read, and how do I repair it?).

`issuegraph` reads and edits the **Issuegraph block** inside an issue body — the machine-readable declaration of what an issue is waiting on.

**It never touches the network and takes no credential.** The body goes in on stdin, the answer comes out on stdout. Closure state and labels are *inputs you supply*, which is what lets it run in a workflow with no token. Fetch the body with `gh`, pipe it in.

```sh
npm i -g @issuegraph/cli     # `issuegraph` on PATH
```

## Reading

```sh
# what does this issue declare?
gh issue view 1234 -R owner/repo --json body -q .body | issuegraph parse

# is the block well-formed? what is wrong with it?
gh issue view 1234 -R owner/repo --json body -q .body | issuegraph validate
```

`parse` emits JSON: `blockedBy`, `serializeWith`, `decomposedFrom`, `duplicateOf`, `togetherWith`, `priority`, `evidence`. Each reference carries `{repo, id}` — `repo` is `null` for a same-repo reference.

## Selection order

`order` and `ready` take a **document describing a set of issues**, not a single body, and derive the order to work them. `ready` is the same derivation filtered to what can start now.

```sh
issuegraph order --input issues.json
issuegraph ready --input issues.json
```

Use `ready` to answer *"what should I pick up?"* rather than hand-rolling a blocked-by walk.

## Writing

```sh
d=$(mktemp -d) || exit 1
gh issue view 1234 -R owner/repo --json body > "$d/issue.json" \
  || { echo "could not read the issue; nothing was written" >&2; rm -rf "$d"; exit 1; }
jq -j .body "$d/issue.json" > "$d/orig.md" || { rm -rf "$d"; exit 1; }

issuegraph set --blocked-by 987 --blocked-by owner/repo#654 --body-file "$d/orig.md" \
  > "$d/new-body.md" \
  && [ -s "$d/new-body.md" ] \
  && gh issue edit 1234 -R owner/repo --body-file "$d/new-body.md"
rm -rf "$d"
```

⚠ **Four guards, and each one stops a different way of destroying the issue.**

**A private directory**, because two people running this at the same moment on
different issues would otherwise share `new-body.md` in whatever directory they
happened to be in — and one can then write the other's body to the wrong issue.

**The fetch is checked** because a failed `gh issue view` feeds `set` an *empty*
input — and `set` then happily renders a fresh block onto nothing and exits **0**,
so the chain continues and the edit replaces the entire body with just that block.
Measured: fetch fails → `set` rc **0**, output **49 bytes** of block and no body.

**The body never passes through `$(…)`**, which strips every trailing newline and
would silently write back a body that differs from the original.

**The `&&` and `[ -s ]`** cover the other end: a refused `set` exits non-zero
having written nothing, while the redirection has already created the file — so
an unchained edit replaces the body with **0 bytes**.

- References accept `123`, `#123`, or `owner/repo#123`. **Repeat `--blocked-by` for each entry** — it is a list.
- `--no-blocked-by` / `--no-serialize-with` remove an entry.
- `--priority` (0–3), `--evidence` (`asserted`|`verified`) and `--together-with` may only be set **when the body has no block yet**.
- `splice --edges <json>` refreshes only the *owned generated* edges, leaving hand-written ones alone. Prefer it over `set` when a tool is maintaining edges automatically.
- `backfill` repairs a block that a code fence left undelimited. **In a loop, use
  `backfill --json`**: it puts the outcome (`delimited` / `already-canonical` /
  `no-block` / `unrecoverable`) on stdout as data, so a caller can branch on it
  without string-matching the stderr prose. On `unrecoverable` there is no `body`
  key at all — nothing was repaired, so there is nothing to write back.
  `validate` cannot substitute for it: a repairable block and an unrepairable one
  produce byte-identical `validate` output.

**Always write through the CLI rather than editing the block by hand.** Hand-editing is how a block ends up undelimited, duplicated, or unreadable.

## Read the `state` field, NOT the exit code

**The exit code is not a substitute for `state`, and not because it "might" differ — the two read verbs answer DIFFERENTLY for the same body.** Measured on the built binary:

| `state` | `parse` | `validate` |
|---|---|---|
| `read` | `0` | `0` |
| `absent` | `0` | `0` |
| `unread` | `3` | `3` |
| `inert` | **`0`** ⚠ | `5` |

**`parse` on an `inert` block exits 0** — and undelimited is the shape hand-authored blocks overwhelmingly take, so that is the cell that fails open: the caller reads success, and the payload reads like an issue with no dependencies. The two verbs also **disagree** on that row, so a recipe that swaps one for the other silently changes meaning.

This table is the authority; the task-shaped skills point at it rather than restate it.

The condition is always reported in stdout:

| `state` | means | what to do |
|---|---|---|
| `read` | the block parsed | use `data` |
| `unread` | a delimited block was found and its YAML could not be read — **edges were NOT reported** | treat as UNKNOWN, never as "no edges" |
| `inert` | an `issuegraph:` key exists but **no `---` pair delimits it**, so nothing reads it. Carries `blockDefect: "undelimited"` | run `backfill` |

```sh
STATE=$(gh issue view 1234 -R owner/repo --json body -q .body \
        | issuegraph parse | python3 -c 'import sys,json;print(json.load(sys.stdin)["state"])')
[ "$STATE" = "read" ] || echo "block is $STATE — do not treat as dependency-free"
```

**`unread` and `inert` both look exactly like "this issue has no dependencies"** if you only check that the command succeeded. That is the single most expensive mistake available here: an absence rendered as a value licenses a false conclusion.

Note also that **a code fence is armor, not a delimiter** — the CLI says so in its own diagnostic. A block wrapped in ``` but missing its `---` pair is inert, and inert blocks are invisible to every reader.

The documented exit codes are `1` internal, `2` usage, `3` unreadDeclaration, `4` refusedWrite, `5` inertDeclaration — but **do not assume a given verb reaches the one you expect**: the table above is what each verb actually returns, and `parse` reports `inert` through `state` at exit **0** while `validate` returns `5` for it. Check `state` first; use the exit code to catch usage errors and crashes, and — for a write verb — to tell a refusal from a success before you consume its output.

## Traps worth knowing

**A quoted `blocked-by:` is not a live edge.** Issue bodies routinely quote historical frontmatter inside `>` blockquotes. Grepping for `blocked-by` matches those and reports a dependency that was discharged long ago. The CLI reads the delimited block; a hand-rolled grep does not.

**Both notations are valid.** An edge list may be a YAML flow sequence on one line or a dash list over several:

```yaml
blocked-by: [123, 456]
blocked-by:
  - "#123"
```

A parser that handles only one of these silently under-reports. This is not hypothetical — a hand-rolled check that matched only dash-lists once reported 88 edgeless issues where the real figure was 37.

**An edge is provenance; a label is state.** A `blocked-by` naming a now-closed issue is correct history and should stay. What comes off when the gate clears is the **`blocked` label**. Do not delete edges to unblock work.
