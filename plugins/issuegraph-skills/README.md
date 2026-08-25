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

## Layout

| path | holds |
|---|---|
| `.claude-plugin/plugin.json` | the plugin manifest |
| `skills/issuegraph/SKILL.md` | the skill itself |

The marketplace manifest that publishes this plugin lives at the repository
root, in `.claude-plugin/marketplace.json`.
