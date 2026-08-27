# issuegraph-skills

Skills over the `issuegraph` CLI, packaged so agents install them from a
marketplace instead of copying `SKILL.md` into each agent home.

## Install

```sh
/plugin marketplace add autnmy/issuegraph
/plugin install issuegraph-skills@issuegraph
```

## What is in it

Three **task-shaped** skills, plus the reference. The task-shaped ones exist so
the things done constantly are a call with a memorable name rather than a
recalled invocation:

| skill | the question it answers |
|---|---|
| `issuegraph-selection` | *what should I pick up, and why is that P0 not on the list?* |
| `issuegraph-creation` | *how do I put a correct block on an issue I am about to file?* |
| `issuegraph-grooming` | *is this issue's block actually being read, and how do I fix it if not?* |
| `issuegraph` | the full CLI reference — every verb, every flag |

## They wrap the CLI. That is the rule, not an implementation note

**A skill that shells out to `sed`, `awk` or a YAML load is the hand-rolled
grammar this whole toolchain exists to delete, reintroduced one layer up.** Every
recipe in these skills composes a CLI verb; none of them reads the grammar.

That matters because the grammar has several shapes that are legal and several
that look legal and declare nothing — an unquoted `#` that opens a YAML comment,
a code fence with no `---` pair inside it, a flow sequence beside a dash list. A
reader that handles some of them under-reports the rest, silently, and reports a
blocked issue as free.

## Layout

| path | holds |
|---|---|
| `.claude-plugin/plugin.json` | the plugin manifest |
| `skills/issuegraph/SKILL.md` | the CLI reference |
| `skills/issuegraph-selection/SKILL.md` | order and readiness |
| `skills/issuegraph-creation/SKILL.md` | rendering a block on a new issue |
| `skills/issuegraph-grooming/SKILL.md` | validate, repair, amend |

The marketplace manifest that publishes this plugin lives at the repository
root, in `.claude-plugin/marketplace.json`.

## Why a plugin and not a file copy

A copied `SKILL.md` is a snapshot. Nine copies are nine snapshots that drift
apart silently, and nothing records which revision an agent is running. Installed
from this marketplace, every agent resolves the same commit and `/plugin update`
moves them together.
