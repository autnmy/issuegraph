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
- **Holds are tracker/executor policy, not format.** Trackers already have conventions that pause work on a single issue pending attention — a `needs-human` label, a "waiting" state. These gate workability without referencing any other issue, and they stay out of the format: a `hold:` field would duplicate tracker-native machinery and rot beside it. The format's contributions to the problem are the composition rule (§6.8) and the decision-issue pattern (§5.5), which turns the *nameable* subset of human blockers into ordinary graph nodes.
- **Concurrency rate is scheduler policy, not format.** The graph defines which issues *may* run concurrently; how many run at once is a knob on the scheduler.
- **Progress roll-ups are queries, not data.** "How far along is the feature" is computed from the graph; it is never stored where it can rot.

Issuegraph is a **specification** — a data format plus rules for reading and writing it. It is not a protocol (nothing exchanges messages) and does not call itself a standard (a title earned by adoption, not claimed at birth).

## 3. Conformance language

MUST, MUST NOT, SHOULD, and MAY are used as in RFC 2119. Two conformance roles exist:

- A **writer** is anything that creates or edits issues: a human, a decomposing agent, a triage bot, a grooming pass, a residual filer.
- A **reader** is anything that consumes the graph to select or order work: a scheduler, a selection query, a dashboard.

## 4. The format

### 4.1 Location

Issuegraph data is **YAML frontmatter** on the issue body — the standard `---`-delimited block at the top, the same convention markdown files and their entire tooling ecosystem already read and write — containing a top-level `issuegraph` key:

```markdown
---
issuegraph:
  blocked-by: [123, 124]
  priority: 1
---
```

Nothing bespoke is introduced here, deliberately: the delimiters, the YAML, and the top-of-document placement are the existing universal convention, chosen because every human, model, and parser already knows it. Rules:

- Writers SHOULD open the body with the frontmatter. Readers MUST be tolerant of prefixed and wrapping content (a bot's banner, a callout, a code fence): the canonical data is the **first** `---`-delimited YAML block in the body containing a top-level `issuegraph` key; later claimants MUST be ignored.
- On trackers that render the body as markdown — where a bare `---` renders as a rule and the line above one as a heading — writers SHOULD wrap the frontmatter in a plain code fence. The fence is display armor only: the frontmatter text inside is unchanged and byte-portable, and readers see through it via the tolerance rule above.

  ````markdown
  ```
  ---
  issuegraph:
    blocked-by: [123, 124]
    priority: 1
  ---
  ```
  ````
- The `issuegraph` key namespaces this specification's data. Other tools' keys MAY coexist in the same frontmatter and MUST be treated as inert by issuegraph readers.
- The frontmatter MUST NOT be hidden from rendering (e.g. inside an HTML comment): invisible data is data nobody maintains, and human writers cannot correct what they cannot see.
- Issue body text is untrusted input in most pipelines. Readers MUST parse the frontmatter with a plain YAML data parser (no anchors resolving to arbitrary object construction, no custom tags) and MUST treat everything outside the recognized fields as inert.
- Trackers with native equivalents (sub-issue APIs, dependency features, priority labels) MAY mirror issuegraph fields into native features for human ergonomics. **For relationship fields, the frontmatter is canonical**; on disagreement, the frontmatter wins, and the disagreement SHOULD be surfaced by grooming. The scalar fields (`priority`, `evidence`) run the other way — see 4.3.5 for the carrier-precedence rule.

### 4.2 Issue references

A reference is either a bare integer (`123` — an issue in the same repository/project) or a qualified form (`owner/repo#123`). Readers MUST support both. All fields that carry relationships carry issue references — no other identifier type exists in the format.

### 4.3 Fields

All fields are optional. An issue with no issuegraph frontmatter is a valid node with no edges and default priority.

| Field | Type | Meaning |
|---|---|---|
| `blocked-by` | list of refs | These issues must reach closure before this one may start. The only hard ordering fact. |
| `decomposed-from` | ref | Provenance: this issue was produced by decomposing that one. Not a scheduling edge. |
| `duplicate-of` | ref | This issue is the same work as that one; readers ignore this issue and treat the target as canonical. |
| `serialize-with` | ref | This issue must not run concurrently with the referenced issue or anything transitively linked to it (see 4.3.4). No ordering implied. |
| `together-with` | ref | This issue and the referenced issue (and anything transitively linked) are distinct issues forming **one unit of work** — selected, claimed, and worked together (see 4.3.7). |
| `priority` | integer 0–3 | 0 is most urgent. Absent means 2. Carrier precedence in 4.3.5. |
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

`serialize-with` earns its place only because a conflict forecast is knowledge the scheduler cannot derive — file overlap is only computable after the diffs exist, which is after the work is done. Together with `together-with` (4.3.7) it forms the format's complete coordination vocabulary beyond `blocked-by`, and both are **hard constraints with exact reader behavior**. Implementers are urged to resist preference-shaped additions ("affinity," "prefer-after," "not-near"): a preference a scheduler may ignore is a field that will go stale and mislead the reader that eventually honors it.

#### 4.3.5 `priority`

An integer 0–3, 0 most urgent, matching the common P0–P3 convention; absent means 2. This is the *declared* priority; readers compute *effective* priority from it (6.3).

**Carrier precedence — the rule for scalar fields, the reverse of the relationship fields.** The scalar fields (`priority`, and `evidence` in 4.3.6) annotate a single issue with a value a human might flip; relationship fields carry references between issues. The precedence rule: **where the tracker has an established convention for a scalar field (priority labels, an evidence label pair), the native convention is canonical** and the frontmatter's field is an optional mirror; where no convention is established, the frontmatter carries the value. The reasoning is the same one that keeps holds out of the format (§2, 6.8): truth belongs in the carrier people actually edit. Humans and triage tooling flip labels; nobody re-edits YAML in an issue body to bump a priority — a frontmatter-canonical rule for scalars would put the authoritative value in the carrier guaranteed to go stale. Relationship fields don't have this problem (most trackers have no native edge convention worth the name), which is why the frontmatter stays canonical for them (4.1).

Readers resolve declared priority: the tracker's established convention if one exists, else the frontmatter field, else 2. Grooming surfaces disagreements between carriers (5.4).

#### 4.3.6 `evidence`

Machine-filed issues are hypotheses. Operational experience shows agents filing issues whose central claims are false — a function said to misbehave that did not, a component said to be dead that was referenced, a dependency said to exist that was absent — each caught only because the next agent re-verified before acting. A human-written issue carries implicit authority; a machine-written one has not earned it. `evidence: asserted` tells the next worker to verify before building; `verified` says the writer reproduced or otherwise confirmed the claim, and SHOULD be accompanied in the body by how.

As a scalar field, `evidence` follows the carrier-precedence rule (4.3.5): an executor that establishes a native convention for it (e.g. an `evidence:verified` label an agent flips after reproducing the claim) makes that convention canonical, with the frontmatter as fallback where none exists. The flip from `asserted` to `verified` is exactly the kind of single-value edit label conventions handle better than body-YAML edits.

#### 4.3.7 `together-with`

Expresses a **unit of work spanning distinct issues**: "these are separate issues, but they must be selected, claimed, and worked as one." Two canonical uses:

- **Cross-repository coupling** — one logical change that necessarily spans trackers: a spec change and its implementation, an API and its client. Merging them into one issue is impossible; working them separately produces broken intermediate states.
- **Shared-fix coupling** — independently-filed issues describing *different* problems resolved by one change (two distinct defects, one refactor fixes both). `duplicate-of` would be false — they are not the same work and each needs its own closure trail — but working them apart is waste or conflict.

Encoding mirrors `serialize-with`: symmetric, one edge per joining issue pointing at any existing member; the **together group** is the connected component; joining is one write on the joiner, leaving is deleting your own field; accidental linkage merges groups.

Reader semantics — a together group is one schedulable unit:

- **Readiness**: the group is ready when every open member is ready per §6.2, evaluating `blocked-by` over **boundary-crossing edges only**. Internal `blocked-by` edges (member blocking member) are not readiness inputs — they would deadlock the group against itself — and are surfaced to the worker as advisory ordering and to grooming as a possible smell.
- **Claim**: atomic — claiming any member claims the group. For serialize admission (4.3.4), the whole group is one claim.
- **Effective priority**: the maximum (numerically lowest) over members, composed with §6.3's backward flow.
- **Closure**: members close individually as their deliverables land; the unit constraint is about *working*, not about closing in the same instant.

Boundaries with neighbors, in one line each: `duplicate-of` says *same work — keep one*; `together-with` says *different work — one unit*; `serialize-with` says *either order — never overlapping*; `blocked-by` says *this order — no overlap question*.

A caution symmetric to 4.3.4's: `together-with` inside a single repository is often a **decomposition smell** — if two halves of a split cannot stand alone, ask whether the split was right before coupling them back together. Its home ground is coupling that cannot be merged into one issue.

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
- disagreements between the canonical frontmatter and any native-feature mirror (4.1),
- dependents unblocked by non-completed closures (5.3),
- issues held ineligible by executor conventions (§6.8) for an extended period — a hold that never lifts is a decision nobody is making,
- internal `blocked-by` edges within a together group (advisory ordering or a sign the coupling is wrong — 4.3.7), and together groups too large to work as one unit (a decomposition problem wearing a coupling costume).

### 5.5 Human gates: name the question

Work is often blocked on a person rather than on another issue: a decision to make, an approval to grant, an account action only a human can take. Two mechanisms exist, and choosing between them follows one rule: **if you can name the question, make it a node; if you can't, hold the issue.**

- **A decision issue** (RECOMMENDED whenever the blocker is a specific, answerable question). Write the question as its own issue — "Decide: adopt X or build Y," "Approve the ceiling change" — and put it in the dependent work's `blocked-by`. The gate is now an ordinary graph node: it lifts by ordinary closure, dependents become ready by the ordinary rule, and — the property that makes this worth the ceremony — **effective priority flows backward into it** (§6.3). The humans answering questions get a queue ordered by how urgent the work behind each question is, instead of a flat pile of flagged issues. Executors classify a decision issue's deliverable as human-performed (§2) and route it to their human-attention surface rather than to automated work.
- **A hold** (a tracker-native label or state, per §6.8) for diffuse attention that has no single answerable question — "this RFC needs discussion," "customer escalation, handle manually." Holds are the honest representation of *unstructured* human involvement; converting them into vague decision issues ("figure this out") adds nodes without adding information.

A hold that turns out to contain a specific question SHOULD be converted: file the decision issue, add the edge, drop the hold.

## 6. Reading rules

### 6.1 Graph construction

A reader parses the canonical frontmatter from each issue in its scope, resolves references, and builds: the dependency graph (`blocked-by`), the duplicate mapping (`duplicate-of` closure to canonical), the serialize components (`serialize-with`, undirected, union-find), and provenance (`decomposed-from`). Readers maintain whatever indexes they need; the format never stores derived data.

### 6.2 The ready set

An issue is **ready** when all of the following hold:

1. it is open;
2. it is not a duplicate (no `duplicate-of`, directly or transitively);
3. every issue in its `blocked-by` list is closed — for members of a together group, evaluated over boundary-crossing edges only (4.3.7);
4. its serialize group (if any) has no actively-claimed member;
5. if it belongs to a together group, every other open member also satisfies 1–4 (the group is ready as a unit or not at all).

Issues that are not ready MUST be invisible to selection. This retires pre-claiming: unready work needs no protection from an eager scheduler, because the scheduler cannot see it.

### 6.3 Effective priority

**Importance flows backward along blocking edges.** If a minor issue blocks an urgent one, it is not minor — it is the most urgent thing in the system, because nothing else unblocks the urgent one.

The **effective priority** of an issue is the highest declared priority (numerically lowest value) among itself and every open issue that transitively depends on it through `blocked-by`. A together group's effective priority is the highest over its members. Readers MUST select by effective priority, not declared priority. A naive scheduler that sorts by declared priority finds the urgent item blocked, moves on to the next-most-urgent thing it *can* do, and leaves the actual critical path at the bottom of the queue while everything looks busy.

### 6.4 Selection

> A reader selects work by: **effective priority** among **ready, eligible** issues, oldest first as the tiebreak.

Readiness is the graph's verdict (§6.2); eligibility is the executor's (§6.8). Both must hold. Together groups enter selection as single units: one candidate, one claim, group effective priority (4.3.7).

This is deliberately a cheap query: one indexed pass, incrementally recomputable on events (an issue closed, an edge written). "Issue closed" is the event that moves the frontier: dependents whose last blocker closed *become ready* at that moment — no polling.

### 6.5 Parallelism

Ready issues are safe to run concurrently **by construction** — anything unsafe is either blocked (not ready) or serialized (group admission). How many ready issues to dispatch at once is scheduler policy, out of scope (§2).

### 6.6 Cycles

A `blocked-by` cycle is detected **on read** and surfaced as a stuck group; writers are not required to prevent it at write time. Write-time rejection pushes writers into describing the dependency in prose instead, which is strictly worse than a cycle a groomer can see. Issues in a cycle are not ready.

### 6.7 Unresolvable references

A `blocked-by` reference that cannot be resolved MUST be treated as **blocking** (fail-safe: unknown state is not "closed") and MUST be surfaced for grooming. Unresolvable `serialize-with` references contribute no linkage but are likewise surfaced.

### 6.8 Holds and eligibility

The ready set (§6.2) is the graph's answer to "may this start?" — it is **necessary, not sufficient**. Executors compose it with their own **eligibility** gates: tracker-native hold conventions (a `needs-human` label, a paused state), claim protocols, capability classifications (§2), operational switches. A held issue is *ready but ineligible*: invisible to selection, exactly like an unready one.

Two rules keep the composition clean:

- Hold semantics MUST NOT be encoded as format fields (§2). The format never learns why an executor declines ready work.
- Effective priority (§6.3) is computed from the graph **regardless of holds** — a held issue that blocks urgent work still propagates that urgency. This is deliberate: it is what surfaces "the most urgent thing in the system is waiting on a hold nobody is looking at," which grooming (§5.4) and human-attention surfaces consume. Compare §5.5: when the hold is really a nameable question, a decision issue represents it better.

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
