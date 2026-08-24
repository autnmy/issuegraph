# @issuegraph/writer

Put the [Issuegraph](https://github.com/autnmy/issuegraph) block into an issue body.

Three write modes, and the split is the point:

| | when you use it |
|---|---|
| `renderFrontmatter` | the body has no block, and you are writing one |
| `spliceGeneratedEdges` | the body has a block, and you own **some** of its edges |
| `backfillFrontmatter` | the body has a block a code fence left **inert**, and you are repairing it |

None of them fetches anything, authenticates anything, or talks to a tracker: a body goes in, a body comes out. Reading is [`@issuegraph/reader`](../reader), whose line grammar this package edits through — so a writer and a parser can never disagree about which bytes are a block.

```sh
npm install @issuegraph/writer
```

## Writing a fresh block

```ts
import { renderFrontmatter } from '@issuegraph/writer';

const block = renderFrontmatter({
  blockedBy: [{ repo: null, number: 231 }, { repo: 'acme/widgets', number: 7 }],
  decomposedFrom: { repo: null, number: 12 },
  evidence: 'asserted',
});

await tracker.update(issue, `${block}\n\n${issue.body}`);
```

The default output is **fence-wrapped** — SPEC §4.1's display armor, because a markdown-rendering tracker draws a bare `---` block as a broken table, and every conforming reader sees through the fence. Pass `{ fenceWrapped: false }` for a host that renders frontmatter natively.

An input with nothing to say renders `null`, never an empty `issuegraph:` stub.

## Refreshing only the edges you own

A tracker's issue body is a document a human edits. If you own the scheduling edges but not the rest, `spliceGeneratedEdges` refreshes yours and leaves **every other byte alone** — unknown children, sibling top-level keys, comments, the fence armor.

```ts
import { spliceGeneratedEdges } from '@issuegraph/writer';

const next = spliceGeneratedEdges(issue.body, {
  blockedBy: [{ repo: null, number: 231 }],
  serializeWith: null,          // explicit null: remove it
  // duplicateOf omitted        // absent: not mine, do not touch
});

if (next === null) {
  // No block this writer can edit — prepend a fresh one instead.
}
```

**Ownership is per field and opt-in.** A field you *omit* is left byte-untouched. A field you *pass* is replaced: an explicit `[]` or `null` removes it. That distinction is load-bearing — round-tripping parsed values back through a splice would silently launder away unparseable items and exotic spellings the parser tolerates with a diagnostic, so omission is the honest "not mine" signal.

It returns `null` rather than guessing whenever the block is one a parser would refuse — an inline value on the key, a child that is not a mapping entry. A body that comes back non-null and parses to nothing is the one failure a writer must never produce.

## Repairing an inert block

§4.1 lets a writer wrap the block in a code fence. Hand-authors read the fence **as** the delimiter and omit the `---` pair — which reads to a parser as no block at all. Measured on one real backlog: 336 of the 369 bodies carrying the key were written that way, and every edge in them was inert.

```ts
import { backfillFrontmatter } from '@issuegraph/writer';

const result = backfillFrontmatter(issue.body);

result.outcome;      // 'delimited' | 'already-canonical' | 'no-block' | 'unrecoverable'
result.body;         // byte-identical to the input unless the outcome is 'delimited'
result.data;         // what the repaired block declares
result.diagnostics;  // why it refused, or what the parse dropped
```

**It adds delimiters and nothing else.** The author's block is kept byte-for-byte; nothing is re-spelled and no line is ever removed. Re-rendering from the parsed value is the obvious alternative and it is lossy — a renderer can only emit what the parser models, so it silently deletes rejected field values, inert extension fields, and YAML comments.

**It repairs one shape and refuses everything else.** The block must be inside a code fence the walk can *establish*. An unfenced column-zero key proves nothing: an HTML comment, a `<details>` block, or anything else an author reaches for makes a key prose just as a fence does. Requiring the fence is positive evidence; enumerating containers is a list that grows a row per review. Every refusal returns the body untouched and says why.

## Reading and writing have opposite error disciplines

A parser takes untrusted issue text and must never throw — every anomaly becomes a diagnostic. A writer takes **your** control-plane data, so a contract violation is a programmer error and throws before anything is written: an issue filed with a graph that lies is worse than a loud failure.

```ts
renderFrontmatter({ priority: 5 });                       // throws: priority must be 0-3
renderFrontmatter({ blockedBy: [{ repo: 'x y', number: 1 }] }); // throws: not owner/repo-shaped
```

## Versioning

`0.x`, and unstable. This package tracks a draft specification, so breaking changes before `1.0` are expected and a minor bump may break you — pin exactly if that matters.

## License

Apache-2.0.
