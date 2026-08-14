# Issuegraph — Specification

**Version:** 0.1.0 (draft)
**Status:** Draft for implementation. Not stable. Field names and semantics may change until 1.0. See [Versioning](#8-versioning-and-stability).

Issuegraph is a specification for machine-readable work relationships and ordering, written directly onto the issues of an existing issue tracker. It defines a small data format (what you can write on an issue), writing rules (who writes it and when), and reading rules (how a scheduler turns a backlog into correctly ordered, safely parallel work).

---

## 1. Motivation

A list of tasks does not tell you what order to do them in.

Human teams solve ordering by talking. The knowledge — "don't start the invoice screen until the money rounding is fixed" — lives in conversations and in people's heads. That works because a team of five has a shared head. A fleet of autonomous agents has none: an agent picks an issue, reads it, and starts. If issue B secretly needed issue A to land first, nothing stops it. Best case, a wasted run. Worst case, work that looks right, passes tests, and is wrong, because it was built on an assumption about to change.

In practice, operating an autonomous development pipeline without machine-readable ordering produces a recognizable set of workarounds, each of which this specification exists to retire:

- **The global kill-switch.** When per-edge ordering cannot be expressed, the only available control is "nobody starts anything." Operators end up gating an entire fleet on one variable because they cannot gate one issue on another.
- **Pre-claiming.** Batches of related work get claimed by a human so automated selection will not touch them, then hand-fed to workers in the correct order — a person simulating a scheduler.
- **Poll chains.** Agents standing watch on an issue, waiting for it to close so they can fire the next tranche. The ordering knowledge lives in agents' standing instructions; one crashed agent silently breaks the chain.
- **Improvised decomposition.** Large work gets split into sub-issues under rules invented at split time and changed at the next split. The structure rots because it was never written down.

Ordering knowledge written as prose — "blocked on #123", "do this after the auth work" — is readable by humans and useless to schedulers. **A scheduler cannot act on prose.** Issuegraph makes the same knowledge machine-readable, in place, on the tracker the work already lives in.

## 2. Scope and non-goals

**Issuegraph describes work. It never describes execution.**

No claims, no leases, no in-progress states, no retries, no heartbeats, no logs, no "who is working on this right now." Those are properties of the *system doing the work*, not of the work itself, and embedding them couples the format to one executor's lifetime. The test for any proposed field: *would a perfect execution system still need this written on the issue?* If a sufficiently good scheduler could derive it or tolerate its absence, it does not go in.

Consequences of that test, recorded here so they are not relitigated field by field:

- **Work-type classification is executor policy, not format.** Whether an issue's deliverable is a code change, a decomposition, or something no automated pipeline can perform at all ("pay the vendor invoice," "migrate the repository") is a judgment each executor makes against its own capabilities. The format does not carry it.
- **Concurrency rate is scheduler policy, not format.** The graph defines which issues *may* run concurrently; how many run at once is a knob on the scheduler.
- **Progress roll-ups are queries, not data.** "How far along is the feature" is computed from the graph; it is never stored where it can rot.

Issuegraph is a **specification** — a data format plus rules for reading and writing it. It is not a protocol (nothing exchanges messages) and does not call itself a standard (a title earned by adoption, not claimed at birth).

## 3. Conformance language

MUST, MUST NOT, SHOULD, and MAY are used as in RFC 2119. Two conformance roles exist:

- A **writer** is anything that creates or edits issues: a human, a decomposing agent, a triage bot, a grooming pass, a residual filer.
- A **reader** is anything that consumes the graph to select or order work: a scheduler, a selection query, a dashboard.

## 4. The format

### 4.1 Location

Issuegraph data lives in a fenced YAML block in the issue body whose top-level key is `issuegraph`:

````markdown
```yaml
issuegraph:
  blocked-by: [123, 124]
  priority: 1
```
````

Rules:

- The **first** fenced block in the body containing a top-level `issuegraph` key is canonical. Later blocks with that key MUST be ignored by readers.
- The block MAY appear anywhere in the body, but writers SHOULD place it at the top.
- Issue body text is untrusted input in most pipelines. Readers MUST parse the block with a plain YAML data parser (no anchors resolving to arbitrary object construction, no custom tags) and MUST treat everything outside the recognized fields as inert.
- Trackers with native equivalents (sub-issue APIs, dependency features, priority labels) MAY mirror issuegraph fields into native features for human ergonomics. **The frontmatter block is canonical**; on disagreement, the block wins, and the disagreement SHOULD be surfaced by grooming.

### 4.2 Issue references

A reference is either a bare integer (`123` — an issue in the same repository/project) or a qualified form (`owner/repo#123`). Readers MUST support both. All fields that carry relationships carry issue references — no other identifier type exists in the format.

### 4.3 Fields

All fields are optional. An issue with no issuegraph block is a valid node with no edges and default priority.

| Field | Type | Meaning |
|---|---|---|
| `blocked-by` | list of refs | These issues must reach closure before this one may start. The only hard ordering fact. |
| `decomposed-from` | ref | Provenance: this issue was produced by decomposing that one. Not a scheduling edge. |
| `duplicate-of` | ref | This issue is the same work as that one; readers ignore this issue and treat the target as canonical. |
| `serialize-with` | ref | This issue must not run concurrently with the referenced issue or anything transitively linked to it (see 4.3.4). No ordering implied. |
| `priority` | integer 0–3 | 0 is most urgent. Absent means 2. |
| `evidence` | `asserted` \| `verified` | Whether the issue's factual claims were verified by the writer or merely asserted. Absent means `asserted` for machine-written issues. |

#### 4.3.1 `blocked-by`

Stored on the **blocked** issue, never the blocker — the fact lives where the decision ("can I start this?") is read. There is no `blocks` field; a reverse index is the reader's job. Everything else about sequencing reduces to this field.

#### 4.3.2 `decomposed-from`

Provenance, not hierarchy. Issuegraph has **no container issues**: there is no issue kind that exists only to hold other issues. What legacy processes called a "tracking issue" is, under this specification, an ordinary issue whose work product was a decomposition (see 5.2) — it closes when the split is done, like any other issue. The story it used to hold is carried by `decomposed-from` edges and reconstructed by query. A "verify the composed whole" gate, when one is wanted, is an ordinary workable issue `blocked-by` all its siblings.

Because there are no containers, there is no containment-inheritance question: blocking never inherits "downward," because there is no downward.

#### 4.3.3 `duplicate-of`

Points at the canonical issue. The set of duplicates is derived by readers (everything pointing, transitively, at the canonical node); it is never maintained as a roster. Writers detecting a duplicate MUST point the *newer* issue at the *older* unless there is a specific reason to prefer otherwise, and SHOULD say why when they deviate.

#### 4.3.4 `serialize-with`

Expresses mutual exclusion without ordering: "these must not run at the same time, in whatever order they happen to run." The canonical use is a **conflict forecast** — two features known to gut the same code, where concurrent runs produce rebase disasters despite no logical dependency either way.

Semantics: the **serialize group** is the connected component over `serialize-with` edges, treated as undirected. A writer joins a group by pointing at *any one* existing member; it does not matter which, and chains (`B→A`, `C→B`, `D→C`) produce the same component as stars (`B→A`, `C→A`, `D→A`). Leaving a group is deleting your own field. No issue ever edits another issue's data to maintain a group, and no roster exists anywhere.

Readers MUST admit at most one actively-claimed issue per serialize group at a time (a width-1 semaphore). Direction therefore emerges at claim time: whichever member is picked up first excludes the rest until it completes. Members that close leave the *active* group automatically (only open issues count) but remain valid anchors for other members' edges — no cleanup is required or expected.

Accidentally linking two groups merges them. This is deliberate fail-safety: the error direction is *more* serialization, which costs throughput, never correctness.

`serialize-with` is the only soft-coordination construct in the format, and it earns its place only because a conflict forecast is knowledge the scheduler cannot derive — file overlap is only computable after the diffs exist, which is after the work is done. Implementers are urged to resist growing this into a family ("affinity," "prefer-after," "not-near"): every such field is a field that will go stale and mislead a scheduler.

#### 4.3.5 `priority`

An integer 0–3, 0 most urgent, matching the common P0–P3 convention. This is the *declared* priority; readers compute *effective* priority from it (6.3). Trackers carrying priority as labels MAY treat the label as a mirror (4.1).

#### 4.3.6 `evidence`

Machine-filed issues are hypotheses. Operational experience shows agents filing issues whose central claims are false — a function said to misbehave that did not, a component said to be dead that was referenced, a dependency said to exist that was absent — each caught only because the next agent re-verified before acting. A human-written issue carries implicit authority; a machine-written one has not earned it. `evidence: asserted` tells the next worker to verify before building; `verified` says the writer reproduced or otherwise confirmed the claim, and SHOULD be accompanied in the body by how.

## 5. Writing rules

These rules bind **every** writer — human or machine, front-of-pipeline or back. A pipeline's grooming pass, residual filer, and triage bot are writers in exactly the sense a decomposing agent is, and emit graph data under the same rules. Writing the graph is not a special activity; it is part of writing any issue.

### 5.1 Write at creation time

Graph fields are written when the issue is written, by the writer that has the knowledge, not retrofitted later by someone reconstructing intent. A triage pass that assigns priority writes `priority`. A grooming pass that detects duplication writes `duplicate-of` — a dedupe verdict *is* an edge; discarding the relationship and keeping only a close-action throws structure away. A residual filer creating follow-up work writes `blocked-by` when the follow-up genuinely cannot land first.

### 5.2 The size rule

**An issue is either small enough to work, or the only work permitted on it is decomposition.**

Decomposition is a defined job with a defined deliverable: the smaller issues **plus the edges between them** — `blocked-by` where order exists, `serialize-with` where a conflict forecast exists, `decomposed-from` on every produced issue — written at split time, by the splitter. An issue that was decomposed closes when its decomposition is complete; it does not linger as a container (4.3.2).

What counts as "small enough" is executor policy (a pipeline that wants small PRs draws the line accordingly); *that the line exists and that crossing it produces edges* is what this specification fixes.

### 5.3 Closure semantics

`blocked-by` is satisfied by **closure**, of any kind. A dependent MUST NOT remain blocked on an issue that will never be worked.

However, closure kinds differ in what they imply for dependents:

- **Completed** closure satisfies the dependency with no further obligation.
- **Non-completed** closure (won't-do, superseded, closed as duplicate) also unblocks — but it may invalidate the dependent's premise. Writers closing an issue as superseded SHOULD rewire dependents' `blocked-by` to the superseding issue where the dependency genuinely transfers. Readers and grooming passes MUST treat "unblocked by a non-completed closure" as a signal to re-examine the dependent before it is worked.

### 5.4 Grooming obligations

A conforming grooming pass (any recurring maintenance process, human or machine) SHOULD surface:

- unresolvable references (targets deleted, moved, or unreachable),
- dependency cycles (6.6),
- serialize groups whose members have all been open and untouched for an extended period (stale forecasts),
- disagreements between the canonical block and any native-feature mirror (4.1),
- dependents unblocked by non-completed closures (5.3).

## 6. Reading rules

### 6.1 Graph construction

A reader parses the canonical block from each issue in its scope, resolves references, and builds: the dependency graph (`blocked-by`), the duplicate mapping (`duplicate-of` closure to canonical), the serialize components (`serialize-with`, undirected, union-find), and provenance (`decomposed-from`). Readers maintain whatever indexes they need; the format never stores derived data.

### 6.2 The ready set

An issue is **ready** when all of the following hold:

1. it is open;
2. it is not a duplicate (no `duplicate-of`, directly or transitively);
3. every issue in its `blocked-by` list is closed;
4. its serialize group (if any) has no actively-claimed member.

Issues that are not ready MUST be invisible to selection. This retires pre-claiming: unready work needs no protection from an eager scheduler, because the scheduler cannot see it.

### 6.3 Effective priority

**Importance flows backward along blocking edges.** If a minor issue blocks an urgent one, it is not minor — it is the most urgent thing in the system, because nothing else unblocks the urgent one.

The **effective priority** of an issue is the highest declared priority (numerically lowest value) among itself and every open issue that transitively depends on it through `blocked-by`. Readers MUST select by effective priority, not declared priority. A naive scheduler that sorts by declared priority finds the urgent item blocked, moves on to the next-most-urgent thing it *can* do, and leaves the actual critical path at the bottom of the queue while everything looks busy.

### 6.4 Selection

> A reader selects work by: **effective priority** among **ready** issues, oldest first as the tiebreak.

This is deliberately a cheap query: one indexed pass, incrementally recomputable on events (an issue closed, an edge written). "Issue closed" is the event that moves the frontier: dependents whose last blocker closed *become ready* at that moment — no polling.

### 6.5 Parallelism

Ready issues are safe to run concurrently **by construction** — anything unsafe is either blocked (not ready) or serialized (group admission). How many ready issues to dispatch at once is scheduler policy, out of scope (§2).

### 6.6 Cycles

A `blocked-by` cycle is detected **on read** and surfaced as a stuck group; writers are not required to prevent it at write time. Write-time rejection pushes writers into describing the dependency in prose instead, which is strictly worse than a cycle a groomer can see. Issues in a cycle are not ready.

### 6.7 Unresolvable references

A `blocked-by` reference that cannot be resolved MUST be treated as **blocking** (fail-safe: unknown state is not "closed") and MUST be surfaced for grooming. Unresolvable `serialize-with` references contribute no linkage but are likewise surfaced.

## 7. Prior art

- **ForgeFed** defines ticket-dependency vocabulary for federated forges; where relation semantics coincide, this specification prefers compatible naming rather than a private dialect.
- **wg** (graphwork) is a dependency-graph orchestration tool coordinating humans and AI agents — a standalone work-OS with its own store, its own coordinator, and execution state (claims, progress, logs) embedded in its graph. It is the closest system in spirit, and the sharpest contrast in design: Issuegraph annotates existing trackers and excludes execution state entirely (§2), precisely so the format is not coupled to any executor. An Issuegraph-annotated backlog could be exported to wg's format for its tooling; the reverse is not generally true.
- **Asana's Work Graph®** is a commercial work-management data model; the name and the containerless direction here are unrelated developments, and the trademark is one reason this specification is not called a work graph.
- **OSLC** is the only genuinely vendor-neutral standard in this space and is far too heavy for the problem; worth knowing exists, not worth adopting.
- **Native tracker features** (sub-issues, dependency links, priority labels) are mirrors, not competitors (4.1): they carry parts of the graph for human ergonomics wherever the tracker supports them.

## 8. Versioning and stability

This is **v0.1.0, a draft**. It is published for implementation, not for adoption claims: the intent is to implement it against at least one real backlog with a real automated pipeline, amend it from what breaks, and only then stamp 1.0. Fields that survive contact stay; fields nobody writes get cut. Breaking changes before 1.0 are expected and will be recorded in the changelog.

---

*Stewarded by Autonomy LLC. Licensed under Apache-2.0.*
