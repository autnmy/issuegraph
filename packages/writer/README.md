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
  blockedBy: [{ repo: null, id: '231' }, { repo: 'acme/widgets', id: '7' }],
  decomposedFrom: { repo: null, id: 'ABC-12' },   // ids are opaque — not just integers
  evidence: 'asserted',
});

await tracker.update(issue, `${block}\n\n${issue.body}`);
```

The default output is **bare**, with a blank line before the closing `---`, and every reference written as a quoted `"#231"`:

```yaml
---
issuegraph:
  blocked-by:
    - "#231"
    - "acme/widgets#7"

---
```

Each of those three details is load-bearing. The **blank line** stops a markdown renderer reading the closing `---` as a setext heading underline, which is what used to turn a bare block into a banner of YAML. The **`#` sigil** is what makes a tracker auto-link the reference — and an auto-linked reference stamps a cross-reference on the *target* issue, which is the only surface anywhere showing what an issue is **blocking**, since §4.3.1 has no `blocks` field. The **quoting** is mandatory, not style: `#` opens a comment in YAML, so `[#231]` is a parse error and `- #231` parses to `null` *silently*.

Pass `{ fenceWrapped: true }` for a host whose renderer still mangles bare frontmatter — §4.1's display armor, which every conforming reader sees through.

An input with nothing to say renders `null`, never an empty `issuegraph:` stub.

## Refreshing only the edges you own

A tracker's issue body is a document a human edits. If you own the scheduling edges but not the rest, `spliceGeneratedEdges` refreshes yours and leaves **every other byte alone** — unknown children, sibling top-level keys, comments, the fence armor.

```ts
import { spliceGeneratedEdges } from '@issuegraph/writer';

const result = spliceGeneratedEdges(issue.body, {
  blockedBy: [{ repo: null, id: '231' }],
  serializeWith: null,          // scheduling edge, present: remove it
  // duplicateOf omitted        // absent: not mine, do not touch
});

switch (result.outcome) {
  case 'spliced':
    return result.body;
  case 'no-block':
    // Nothing readable to edit — prepend a fresh block. Lossless, and ONLY here.
    return renderFrontmatter(edges) + '\n\n' + issue.body;
  case 'uneditable-block':
  case 'not-written':
    // `result.data` is the block's parsed value. Re-render it plus your own
    // edges, or leave the body alone — see below.
    return null;
}
```

**Four outcomes, because two of them need opposite repairs.**

| outcome | what happened | what to do |
|---|---|---|
| `spliced` | the edit was made **and verified** | use `body` |
| `no-block` | nothing readable to edit | prepend a fresh block — lossless, and only here |
| `uneditable-block` | readable but not line-editable (a flow mapping, which is what a YAML serializer emits in flow style) **and** it carries entries you do not own | re-render from `data` plus your edges, or leave it alone |
| `not-written` | the edit was attempted and did not land | same, and report it: this is a writer defect, not a bad input |

**Prepending is safe only on `no-block`.** Under §4.1's first-block rule, prepending in front of a block you could not edit **demotes** it, and every field the call did not own goes with it. That is why these are four outcomes rather than one nullable string.

**Re-rendering from `data` is lossy for unrecognised fields** — a renderer emits only what the parser models. If you cannot accept that loss, leave the body alone.

**`spliced` is verified on both questions**: the result still reads, *and* every field the call owns is what the call asked for. A body can parse perfectly while containing none of the edit, which is a class this package used to ship one fix at a time.

**Ownership is per field and opt-in.** A field you *omit* is left byte-untouched. That distinction is load-bearing — round-tripping parsed values back through a splice would silently launder away unparseable items and exotic spellings the parser tolerates with a diagnostic, so omission is the honest "not mine" signal.

**What a present `null` means is not uniform**, and the asymmetry is deliberate:

| field | omitted | present |
|---|---|---|
| `blockedBy` | untouched | replaced; `[]` removes |
| `serializeWith` | untouched | replaced; `null` removes |
| `decomposedFrom` | untouched | a ref replaces or inserts; **`null` also leaves it untouched** |
| `duplicateOf` | untouched | a ref replaces or inserts; **`null` also leaves it untouched** |

The bottom two are provenance and a verdict, where the established caller shape is *write it when the block lacks one, never clobber one that is already there* — such a caller passes `null` precisely to mean **leave it alone**, so spending `null` on removal would delete provenance on every refresh of a block that has it. The cost is real and stated rather than hidden: **there is currently no way to clear `decomposed-from` or `duplicate-of` through this call.**

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
renderFrontmatter({ blockedBy: [{ repo: 'x y', id: '1' }] });   // throws: not owner/repo-shaped
renderFrontmatter({ blockedBy: [{ repo: null, id: 'a ref' }] }); // throws: not a valid tracker identifier
```

## Versioning

`0.x`, and unstable. This package tracks a draft specification, so breaking changes before `1.0` are expected and a minor bump may break you — pin exactly if that matters.

## License

Apache-2.0.
