# Worked example: a decomposition with ordering, a conflict forecast, and a gate

Issue **#230 — "Add usage-based billing"** is too big to work. Under the size rule (SPEC §5.2), the only work permitted on it is decomposition. The decomposer produces four leaves and a verification gate, writes every edge at split time, and closes #230 when the split is complete. No tracking issue exists afterward — provenance and queries carry the story.

## The produced issues

**#231 — "Billing: metering schema and write path"**

```yaml
issuegraph:
  decomposed-from: 230
  priority: 1
```

**#232 — "Billing: rating engine over metered usage"**

```yaml
issuegraph:
  decomposed-from: 230
  blocked-by: [231]
  priority: 1
```

**#233 — "Billing: invoice rendering"**

```yaml
issuegraph:
  decomposed-from: 230
  blocked-by: [232]
  priority: 2
```

**#234 — "Billing: usage dashboard widgets"**

```yaml
issuegraph:
  decomposed-from: 230
  blocked-by: [231]
  serialize-with: 233
  priority: 2
```

*#234 has no logical dependency on #233 — but both are known to rework the same rendering layer, so the decomposer records a conflict forecast. Whichever is claimed first excludes the other until it completes (SPEC §4.3.4). No false `blocked-by` is invented to fake the constraint.*

**#235 — "Billing: end-to-end verification of the composed flow"**

```yaml
issuegraph:
  decomposed-from: 230
  blocked-by: [231, 232, 233, 234]
  evidence: asserted
  priority: 1
```

*The old "tracking issue" job — knowing when the whole is done — is an ordinary workable issue blocked by all its siblings.*

## What a reader does with this

Initially: ready = **{#231}** (everything else blocked). Effective priority of #231 is 1 — but note that if #235 were declared P0, #231 would *become* effectively P0, because importance flows backward along blocking edges (SPEC §6.3).

When #231 closes: #232 and #234 become ready simultaneously — no path connects them, so they may run in parallel. When #232 closes: #233 becomes ready, but if #234 is actively claimed, the serialize group holds #233 out until #234 completes (or vice versa — direction emerged at claim time).

When all four close: #235 becomes ready, is worked, and the feature's subgraph is closed. "How far along is billing?" was, at every moment, the query *open issues where decomposed-from resolves to #230* — computed, never maintained.
