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

parse.data?.blockedBy;   // [{ repo: null, id: '231' }, …]
parse.diagnostics;       // human-readable reasons a field or the block was dropped
parse.blockDefect;       // 'undelimited' | 'unterminated' | null
```

It never throws, on any input. A body with no block returns `data: null` with no diagnostics — a valid issue with no edges, not an error.

**`data` alone cannot tell you whether the declaration was fully read**, and this is the mistake that costs money. `blocked-by: [231, "a ref"]` returns a list carrying only `231`, and `blocked-by: ["a ref"]` returns an **empty** list that reads exactly like a body declaring no edge at all. Ask through `isUnreadDeclaration`:

```ts
if (isUnreadDeclaration(parse)) {
  // A delimited block was found and something inside it could not be read.
  // What you DO about that is yours — refuse to clear, drop the candidate,
  // refuse the write, report it. The question is what this answers.
}
```

## Deriving the graph

```ts
import { buildModel, isUnreadDeclaration, parseFrontmatter } from '@issuegraph/reader';

const model = buildModel(
  issues.map((i) => {
    const parse = parseFrontmatter(i.body);
    return {
      id: String(i.number),      // the tracker's own id — a STRING, and opaque
      repo: i.repo,              // null for the home repo
      open: i.state === 'open',
      closedStateReason: i.stateReason,
      labels: i.labels,
      assigneeCount: i.assignees.length,
      data: parse.data,
      // Carry the ANSWER, not just the data. Required, so you cannot forget.
      declarationRead: isUnreadDeclaration(parse) ? 'under-read' : 'read',
    };
  }),
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

**What the axis does NOT protect, stated plainly.** The refusals cover nodes the model can **name** — the under-read node, its serialize component, and anything whose edge resolved to it. They cannot cover a node it cannot name. When the dropped field is *itself an edge* (`#1` declares `together-with: 2` and the parser rejects that line), the relationship never enters edge collection, so `#2` is an ordinary ready singleton. The peer's identity is what the parse destroyed, and the only sound refusal would be "refuse everything while any declaration is under-read" — a global stall on one malformed body.

So that policy is **yours**, and `model.underReadKeys` is the seam for it: hold selection while it is non-empty for the strict §4.3.7 guarantee, or read it for triage. Read it structurally — never match the diagnostic prose, which a rewording silently breaks. This is the same split `isUnreadDeclaration` draws one layer down: the question factors, the policy does not.

**`declarationRead` is required, and that is the mechanism.** `data` cannot carry the answer — a dropped field returns non-null `data` that looks complete — so the fact has to travel *with* the node. An optional field would let a producer omit it and restore the defect as an unstated one, since the omission would compile. A node marked `'under-read'` is refused, and so is any node sharing its `serialize-with` component, because a dropped `serialize-with` means the component's true extent is unknown. Effective priority is deliberately untouched: an under-read node under-reports a blocker's urgency, which reorders work but never admits any.

**It is fail-safe in one direction, deliberately.** The costs are not symmetric — over-blocking delays work, under-blocking ships it in the wrong order — so where the spec leaves a choice, this resolves toward refusing: an ambiguous component merge over-serializes, and an unresolvable `together-with` refuses its declarer.

**Where the spec makes the choice, the spec wins, and §6.7 makes two of them.** An unresolvable `blocked-by` **blocks** — unknown state is not "closed". An unresolvable `serialize-with` **contributes no linkage**: it is surfaced in `diagnostics` and refuses nobody, neither the declarer nor its component.

That second one matters if you fetch a partial neighbourhood. It is deliberately *not* a refusal, so if your traversal has a horizon and you want unresolved links to hold work back, compose that yourself around the model — the way §6.8 composes eligibility with readiness. You know your horizon; the reader does not.

If you hand it a partial node set, expect it to say so in `diagnostics` rather than to guess.

## The parser is a restricted subset reader, on purpose

Issue bodies are untrusted: anyone who can file an issue can author one. The specification (§4.1) requires a plain YAML data parser — no anchors resolving to arbitrary object construction, no custom tags — and the recognised field grammar is a small closed subset. So this is a short, auditable, hand-rolled parser that constructs no objects, and this package has **no runtime dependencies** beyond `@issuegraph/core`.

The format stays standard YAML. Anything outside the subset the spec's fields can express degrades to a dropped field with a diagnostic, never a throw.

## What it does not do

No writing. Edits to the block go through `@issuegraph/writer`. No tracker access, no network, no auth, no caching — a host supplies the bodies.

## Stability

`0.x`, and unstable. It tracks a draft specification (SPEC.md §8), so breaking changes before `1.0` are expected and a minor bump may break you. Pin exactly if that matters.

## Licence

Apache-2.0. Stewarded by [Autonomy LLC](https://github.com/autnmy).
