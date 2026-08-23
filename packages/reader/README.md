# @issuegraph/reader

Read the [Issuegraph](https://github.com/autnmy/issuegraph) block out of an issue body, and derive the graph it declares.

Two halves, and the split is the point. `parseFrontmatter` reads **one** body and answers what that issue declared. `buildModel` takes **a set** of parsed issues and answers what follows from them: the ready set, effective priority, serialize and together components, duplicate resolution, and cycles.

Neither half fetches anything, authenticates anything, or writes anything. You bring the bodies and the labels from whatever tracker you have.

```sh
npm install @issuegraph/reader
```

## Reading one issue

```ts
import { parseFrontmatter, isUnreadDeclaration } from '@issuegraph/reader';

const parse = parseFrontmatter(issue.body);

parse.data?.blockedBy;   // [{ repo: null, number: 231 }, …]
parse.diagnostics;       // human-readable reasons a field or the block was dropped
parse.blockDefect;       // 'undelimited' | 'unterminated' | null
```

It never throws, on any input. A body with no block returns `data: null` with no diagnostics — a valid issue with no edges, not an error.

**`data` alone cannot tell you whether the declaration was fully read**, and this is the mistake that costs money. `blocked-by: [231, not-a-ref]` returns a list carrying only `#231`, and `blocked-by: [not-a-ref]` returns an **empty** list that reads exactly like a body declaring no edge at all. Ask through `isUnreadDeclaration`:

```ts
if (isUnreadDeclaration(parse)) {
  // A delimited block was found and something inside it could not be read.
  // What you DO about that is yours — refuse to clear, drop the candidate,
  // refuse the write, report it. The question is what this answers.
}
```

## Deriving the graph

```ts
import { buildModel } from '@issuegraph/reader';

const model = buildModel(
  issues.map((i) => ({
    number: i.number,
    repo: i.repo,              // null for the home repo
    open: i.state === 'open',
    closedStateReason: i.stateReason,
    labels: i.labels,
    assigneeCount: i.assignees.length,
    data: parseFrontmatter(i.body).data,
  })),
  { homeRepo: 'acme/backlog' },
);

model.readiness('231');          // { ready: false, reasons: ['blocked-by 230 is open'] }
model.effectivePriority('230');  // a P3 blocking a P0 comes back 0
model.serializeComponent('231'); // the computed group — groups are never written down
model.duplicateCanonical('240'); // where a duplicate-of chain lands
model.cycles;                    // blocked-by cycles among open nodes
model.diagnostics;               // unresolvable refs, carrier disagreements, dead chains
```

`buildModel` is pure and total: it never throws, and every anomaly becomes a diagnostic instead of an exception.

**It is fail-safe in one direction, deliberately.** An unresolvable `blocked-by` blocks; an unresolvable `serialize-with` or `together-with` refuses its declarer; an ambiguous component merge over-serializes. The costs are not symmetric — over-blocking delays work, under-blocking ships it in the wrong order — so every ambiguity resolves toward refusing. If you hand it a partial node set, expect it to say so rather than to guess.

## The parser is a restricted subset reader, on purpose

Issue bodies are untrusted: anyone who can file an issue can author one. The specification (§4.1) requires a plain YAML data parser — no anchors resolving to arbitrary object construction, no custom tags — and the recognised field grammar is a small closed subset. So this is a short, auditable, hand-rolled parser that constructs no objects, and this package has **no runtime dependencies** beyond `@issuegraph/core`.

The format stays standard YAML. Anything outside the subset the spec's fields can express degrades to a dropped field with a diagnostic, never a throw.

## What it does not do

No writing. Edits to the block go through `@issuegraph/writer`. No tracker access, no network, no auth, no caching — a host supplies the bodies.

## Stability

`0.x`, and unstable. It tracks a draft specification (SPEC.md §8), so breaking changes before `1.0` are expected and a minor bump may break you. Pin exactly if that matters.

## Licence

Apache-2.0. Stewarded by [Autonomy LLC](https://github.com/autnmy).
