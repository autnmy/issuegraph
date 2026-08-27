# issuegraph-skills

The `issuegraph` skill, packaged so agents install it from a marketplace instead
of copying `SKILL.md` into each agent home.

## Install

```sh
/plugin marketplace add autnmy/issuegraph
/plugin install issuegraph-skills@issuegraph
```

## Why a plugin and not a file copy

A copied `SKILL.md` is a snapshot. Nine copies are nine snapshots that drift
apart silently, and nothing records which revision an agent is running. Installed
from this marketplace, every agent resolves the same commit and `/plugin update`
moves them together.

## The skills

One reference skill and three task skills. The task skills are the layer-3
wrappers from [#14](https://github.com/autnmy/issuegraph/issues/14) — the three
things callers do constantly, each a call with a memorable name rather than a
recalled invocation.

| skill | answers |
|---|---|
| `issuegraph` | the full CLI reference — every verb, the exit codes, and the `state`-not-exit-code trap |
| `issuegraph-selection` | *what should I work, and why is that one not ready?* — `order` and `ready` |
| `issuegraph-creation` | *how do I put a correct block on a new issue?* — `set` on a blockless body |
| `issuegraph-grooming` | *this block will not parse / this edge must change* — `validate`, `backfill`, `set`, `splice` |

**They wrap the CLI and re-implement nothing.** A skill that shells out to `sed`,
`awk` or a YAML load is the hand-rolled grammar this toolchain exists to delete,
reintroduced one layer up.

## Layout

| path | holds |
|---|---|
| `.claude-plugin/plugin.json` | the plugin manifest |
| `skills/issuegraph/SKILL.md` | the CLI reference skill |
| `skills/issuegraph-selection/SKILL.md` | ordering and readiness |
| `skills/issuegraph-creation/SKILL.md` | writing a block on a new issue |
| `skills/issuegraph-grooming/SKILL.md` | validating, repairing and amending existing blocks |

The marketplace manifest that publishes this plugin lives at the repository
root, in `.claude-plugin/marketplace.json`.
