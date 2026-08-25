# Issuegraph

**A specification for machine-readable work relationships and ordering — written directly onto the issues you already have.**

A backlog is a list, and a list doesn't say what order to do things in, what can run in parallel, or which small issue is secretly the most urgent thing in the system because everything else is waiting on it. Humans carry that knowledge in conversation. Schedulers and autonomous agents can't — **a scheduler cannot act on prose**.

Issuegraph puts the ordering knowledge on the issues themselves, as plain YAML frontmatter any tracker can store and any tool already knows how to read:

```markdown
---
issuegraph:
  blocked-by: ["#231", "#234"]
  decomposed-from: "#230"
  serialize-with: "#232"
  priority: 1

---
```

A reference is whatever your tracker calls an issue — `231`, `#231`, `ABC-231`, or `owner/repo#231`. Writing it with the `#` sigil makes the tracker **auto-link** it, which stamps a cross-reference on the *target* issue: the one place you can see what an issue is **blocking**, since the format deliberately has no `blocks` field. Quote the sigil — `#` starts a comment in YAML — and leave a blank line before the closing `---`, or a markdown renderer reads it as a heading underline.

Seven fields. Three chapters of rules. No server, no new tool, no migration — your tracker remains the source of truth.

## What it gives you

- **A ready set.** An issue is *ready* when nothing it's blocked by is still open and nothing it's serialized with is running. Unready work is invisible to selection — no pre-claiming, no polling for closures.
- **Effective priority.** Importance flows backward along blocking edges: a P3 blocking a P0 *is* a P0. The critical path surfaces itself.
- **Safe parallelism.** Ready issues with no path between them are concurrency-safe by construction; `serialize-with` covers the known-conflict case (two features gutting the same files) without inventing a false ordering.
- **Decomposition with a deliverable.** An issue is either small enough to work or its only permitted work is splitting it — and the split's output is the smaller issues *plus their edges*, written at split time. No more container issues that rot: provenance (`decomposed-from`) and queries replace the tracking issue entirely.

## What it refuses to do

Issuegraph describes **work, never execution** — no claims, leases, statuses, or logs. Those belong to the system doing the work, and embedding them couples a format to one executor's lifetime. The full reasoning, field semantics, writing rules, and reader algorithms are in the spec:

**→ [SPEC.md](./SPEC.md)** · [worked example](./examples/decomposition.md) · [changelog](./CHANGELOG.md)

## Packages

The reference implementation lives here as a pnpm workspace under [`packages/`](./packages), published to npm under the `@issuegraph` scope.

| package | what it is |
|---|---|
| [`@issuegraph/core`](./packages/core) | the specification's vocabulary as frozen constants and derived types — field names, cardinality, value sets, documented defaults. No parsing, no I/O. |
| [`@issuegraph/reader`](./packages/reader) | reads the block out of an issue body and derives the graph — ready set, effective priority, serialize and together components, duplicate resolution, cycles. No writes, no network. |
| [`@issuegraph/writer`](./packages/writer) | writes the block back — render a fresh one, splice the edges one writer owns without disturbing anything else, or re-delimit a block a code fence left inert. Pure string work; no reads, no network. |
| [`@issuegraph/derive`](./packages/derive) | the selection order that follows from a model — ranked slots, held slots with the reason each is held, together units as one slot, priority promotions — plus the pre-write refusal for a `blocked-by` edge that would close a cycle. |
| [`@issuegraph/cli`](./packages/cli) | one command over the packages above — read a body's block, derive the order over a set of issues you supply, edit the block in place. Composes them and parses nothing itself; the outermost input and output is the ticket body, so it runs in a workflow with no token. |
| [`@issuegraph/store`](./packages/store) | a framework-free client store for a document, and the data-source port a host plugs its tracker in through. Renders edits optimistically, dispatches every one outward, and never re-evaluates the selection order until the write lands. |
| [`@issuegraph/viewer`](./packages/viewer) | render a document as a work order — the ordered spine with readiness stations, the five edge treatments, and three projections. Rendering only: no fetching, no mutation, no auth, and every value themeable through CSS custom properties. |

**Versioning: `0.x`, and unstable.** These packages track a draft specification, so breaking changes before `1.0` are expected and a minor bump may break you — pin exactly if that matters. A published version is a public commitment and npm does not allow an unpublish after 72 hours, so nothing is published on a merge: publishing happens on an explicit GitHub release.

**Imports are linted, not pattern-matched.** `pnpm run lint` runs ESLint over `packages/`, which parses the real syntax tree: a forbidden consumer import, an absolute path (static or dynamic), and a relative import reaching into a sibling package all fail the build. Each rule is proved by a fixture written to break it, including a control that the config matches the file at all — a green lint run means nothing if it linted nothing.

**Isolation is mechanical, not a convention.** Nothing in this repository may reach into a consumer's codebase — a package that depends on one consumer is a private library wearing a public name. `pnpm run check:isolation` fails the build on a forbidden dependency — named by a key, an `npm:` alias, or a git URL — on a relative import escaping its own package, and on a consumer's brand token in **any text a package ships**: source, README, a JSON schema, a NOTICE, or `package.json` metadata. There is no extension allowlist and no exemption for built output, because what a package can publish is an open set — and `dist`, with the sources its maps embed, is the part that actually ships. The guard is proved by [`scripts/check-isolation.test.ts`](./scripts/check-isolation.test.ts), which builds packages that break each rule and asserts it reports exactly that rule.

Working on them:

```sh
pnpm install
pnpm run ci   # build, typecheck, lint, test, isolation
```

## Status

**v0.3.0 draft.** Published for implementation, not adoption claims: the spec is being implemented against a real backlog by a real autonomous pipeline, and will be amended from what breaks before any 1.0. Expect changes.

## Implementations

- **Descant** (autonomous software-delivery pipeline) — in progress: graph parsing, ready-set + effective-priority selection, decomposition stage, and back-of-pipeline writers (grooming, residual filing).

---

Stewarded by [Autonomy LLC](https://github.com/autnmy). Apache-2.0.
