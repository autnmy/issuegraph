---
name: issuegraph-creation
description: Render an Issuegraph frontmatter block onto a new issue body using the issuegraph CLI's set verb — blocked-by, decomposed-from, serialize-with, together-with, duplicate-of, priority and evidence. Use when filing an issue, decomposing a parent into leaves, or adding a declaration to a body that has none.
---

# Issuegraph creation

Writes the block onto a body that does not have one yet. One verb does it:

```sh
npm i -g @issuegraph/cli     # `issuegraph` on PATH
```

```sh
issuegraph set --body-file draft.md \
  --blocked-by 231 --decomposed-from 200 --priority 1 --evidence asserted \
  > body.md
gh issue create -R owner/repo --title "…" --body-file body.md
```

The block lands at the top of the body and everything you wrote is preserved below it:

```
---
issuegraph:
  blocked-by:
    - "#231"
  decomposed-from: "#200"
  priority: 1
  evidence: asserted

---

Some new issue body.
```

## Never hand-author the block

This is the whole reason the skill exists. Hand-authored blocks are where the estate's declared graph went missing — the shapes below all *look* right and all declare nothing:

- **Drop the `---` pair** and the block is **inert**. A code fence is display armor, *not* a delimiter; a body carrying `issuegraph:` inside a bare ` ```yaml ` fence with no `---` reads as declared and behaves as undeclared.
- **Leave a `#`-ref unquoted** — a dash list of bare `- #123` — and YAML reads `#` as a comment, so the entry is empty. Under a plain YAML load that parses *successfully, silently, and empty*: an issue with two hard blockers reads as an issue with none. This reader refuses instead (`state: "unread"`, *"refusing to report edges"*) — which is the fail-safe working, not a pass. The block still declares nothing usable until it is repaired.
- **Omit the blank line** before the closing `---` and GitHub renders the block as a heading.

`set` cannot produce any of these. That is the argument for using it over a template you copy: the tool composes `@issuegraph/writer`, so the delimiters, the quoting and the spacing are not yours to get right.

## The fields

| flag | writes | notes |
|---|---|---|
| `--blocked-by <ref>` | a hard ordering edge | **repeat the flag for each entry** — it is a list |
| `--serialize-with <ref>` | forecast conflict; the group is worked one at a time | |
| `--decomposed-from <ref>` | provenance — this came from splitting that issue | not a scheduling edge |
| `--duplicate-of <ref>` | this issue is a duplicate of that one | |
| `--together-with <ref>` | this and that must be worked as one unit | **new blocks only** |
| `--priority 0..3` | priority in the block | **new blocks only** |
| `--evidence asserted\|verified` | how good the claim is | **new blocks only** |

References accept `123`, `#123`, or `owner/repo#123`.

**Three fields are new-block-only** — `--together-with`, `--priority` and `--evidence`. `set` refuses them on a body that already has a block, deliberately: changing what a claim asserts is an amendment, not a creation. Use the `issuegraph-grooming` skill for that.

## `evidence` takes exactly two values, and a third is dropped silently

- **`asserted`** — you did not reproduce or confirm the claim, so the next worker verifies first. **This is the default for anything filed by a machine**, including every residual finding.
- **`verified`** — you reproduced it, or otherwise confirmed it (a measurement counts). Say *how* in the body.

Any other value is discarded as quietly as a missing `---` pair, leaving the rest of the block looking complete. Write one of the two.

## Decomposing a parent into leaves

The deliverable of a split is **the leaves plus their edges**, written at split time. Nothing downstream can recover an edge you did not write.

```sh
for leaf in draft-a.md draft-b.md; do
  issuegraph set --body-file "$leaf" --decomposed-from 200 --priority 1 --evidence asserted \
    > "ready-$leaf"
done
# then, where real order exists between them:
issuegraph set --body-file ready-draft-b.md --blocked-by 501 > final-b.md
```

Three rules the tool will not enforce for you:

- **`decomposed-from` on every leaf**, so the split is traceable.
- **`blocked-by` only where real order exists.** Do not fake mutual exclusion with a false `blocked-by` — `serialize-with` is the field for "these two gut the same surface".
- **No `together-with` between leaves of your own split.** If two halves cannot stand alone, they were not two leaves.

Give every leaf a priority label too — the label is the canonical priority carrier for selection, and the block's `priority` is a second signal, not a replacement.

## Verify the round trip

`set` writing a block is not proof a reader will see it. Ask the reader:

```sh
issuegraph parse --body-file body.md \
  | jq -e '.state == "read"' > /dev/null \
  || echo "the block did not come back readable — do not file this body"
```

**Check `state`, never the exit code.** `parse` exits 0 on an unreadable block; the condition is reported in stdout. A caller that branches on the exit code alone reads failure as success.

## Filing against a still-open gate

Where the thing you depend on has not landed, the edge alone may not be enough — many estates gate selection on a **label** as well, and a reader that only writes the edge leaves the issue pickable. Write the edge with `set`, and apply whatever hold label your repository's selector reads. Check the repo's own working-agreements file for which mechanisms it requires; they are not interchangeable.

## Related

- `issuegraph` — the full CLI reference.
- `issuegraph-grooming` — amending or repairing a block that already exists.
- `issuegraph-selection` — what the edges you just wrote will do to the order.
