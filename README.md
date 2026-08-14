# Issuegraph

**A specification for machine-readable work relationships and ordering — written directly onto the issues you already have.**

A backlog is a list, and a list doesn't say what order to do things in, what can run in parallel, or which small issue is secretly the most urgent thing in the system because everything else is waiting on it. Humans carry that knowledge in conversation. Schedulers and autonomous agents can't — **a scheduler cannot act on prose**.

Issuegraph puts the ordering knowledge on the issues themselves, as plain YAML frontmatter any tracker can store and any tool already knows how to read:

```markdown
---
issuegraph:
  blocked-by: [231, 234]
  decomposed-from: 230
  serialize-with: 232
  priority: 1
---
```

Seven fields. Three chapters of rules. No server, no new tool, no migration — your tracker remains the source of truth.

## What it gives you

- **A ready set.** An issue is *ready* when nothing it's blocked by is still open and nothing it's serialized with is running. Unready work is invisible to selection — no pre-claiming, no polling for closures.
- **Effective priority.** Importance flows backward along blocking edges: a P3 blocking a P0 *is* a P0. The critical path surfaces itself.
- **Safe parallelism.** Ready issues with no path between them are concurrency-safe by construction; `serialize-with` covers the known-conflict case (two features gutting the same files) without inventing a false ordering.
- **Decomposition with a deliverable.** An issue is either small enough to work or its only permitted work is splitting it — and the split's output is the smaller issues *plus their edges*, written at split time. No more container issues that rot: provenance (`decomposed-from`) and queries replace the tracking issue entirely.

## What it refuses to do

Issuegraph describes **work, never execution** — no claims, leases, statuses, or logs. Those belong to the system doing the work, and embedding them couples a format to one executor's lifetime. The full reasoning, field semantics, writing rules, and reader algorithms are in the spec:

**→ [SPEC.md](./SPEC.md)** · [worked example](./examples/decomposition.md) · [changelog](./CHANGELOG.md)

## Status

**v0.1.0 draft.** Published for implementation, not adoption claims: the spec is being implemented against a real backlog by a real autonomous pipeline, and will be amended from what breaks before any 1.0. Expect changes.

## Implementations

- **Descant** (autonomous software-delivery pipeline) — in progress: graph parsing, ready-set + effective-priority selection, decomposition stage, and back-of-pipeline writers (grooming, residual filing).

---

Stewarded by [Autonomy LLC](https://github.com/autnmy). Apache-2.0.
