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

A tracker's issue body is a document a human edits. If you own the scheduling edges but not the rest, `spliceGeneratedEdges` refreshes yours and leaves **every other byte alone** — unknown children, sibling top-level keys, comments, the fence armor. That holds for a comment *inside* an entry you own as well: an owner ruling written between `blocked-by:` and its items is kept, since the writer owns the edges and not the commentary — after a refresh it sits directly behind the rendered entry, and after a clear it sits where the entry was, re-indented to the section's child indent so it cannot read as a neighbour's continuation. The one edit that removes a comment is the whole-block removal — when your clear leaves the block with nothing else in it, the block goes, comments and all.

```ts
import { renderFrontmatter, spliceGeneratedEdges } from '@issuegraph/writer';

const edges = {
  blockedBy: { set: [{ repo: null, id: '231' }] },
  serializeWith: { clear: true },   // remove the entry
  duplicateOf: { clear: true },     // retract a dedupe verdict — same spelling
  // decomposedFrom omitted         // absent: not mine, do not touch
};

const result = spliceGeneratedEdges(issue.body, edges);

switch (result.outcome) {
  case 'spliced':
    return result.body;
  case 'no-block':
    // Nothing readable to edit — prepend a fresh block. Lossless, and ONLY here.
    //
    // `renderFrontmatter` takes a DIFFERENT input: flat values, and it also
    // accepts the render-only fields (`priority`, `evidence`, `together-with`)
    // that `GeneratedEdges` has no concept of. So state what the fresh block
    // should contain rather than reusing the splice's edges — a clear has
    // nothing to render, and passing the wrapper through reaches `renderRef`
    // as a ref and throws.
    return renderFrontmatter({ blockedBy: [{ repo: null, id: '231' }] }) + '\n\n' + issue.body;
  case 'uneditable-block':
  case 'not-written':
    // `result.data` is the block's parsed value. Re-render it plus your own
    // edges, or leave the body alone — see below.
    return null;
}
```

**The two inputs are deliberately different shapes.** `spliceGeneratedEdges` edits four fields in a block somebody else wrote, so it needs to say *clear this one* and *leave that one alone*. `renderFrontmatter` writes a whole block from nothing, where "clear" has no meaning and there is no existing entry to leave alone — so it takes the values directly, and takes the three render-only fields as well. Reusing one object for both reads as a convenience and is a category error.

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

**All four fields are written the same way.** Three states, three spellings, nothing overloaded:

| value | meaning |
|---|---|
| *omitted* | leave the entry byte-untouched — the only way to say *not mine* |
| `{ set: value }` | replace the entry, or insert one if the block lacks it |
| `{ clear: true }` | remove the entry |

`{ set: [] }` on `blockedBy` is the same edit as `{ clear: true }` — a list with no entries renders no lines — and a test pins that they agree.

**A malformed value throws**, before anything is read or written. `decomposedFrom: null`, `{ set: null }`, a bare ref, a bare array, `{ clear: false }`, and `{ set, clear }` together are all programmer errors, and this package throws on those rather than guessing, exactly as it does for a malformed ref. A caller that half-applies is worse than one that stops.

**The one mistake it cannot catch is a well-formed `{ clear: true }` you did not mean.** That is the migration hazard below, and it is the only way to lose data through this call.

### Migrating from `0.2.x`: omit the key, do not translate the `null`

Before `0.3.0`, `null` did two incompatible jobs one field apart. For `serializeWith` it **removed** the entry; for `decomposedFrom` and `duplicateOf` it meant **leave it alone**, because the established caller shape for provenance is *write it when the block lacks one, never clobber one that is already there*:

```ts
decomposedFrom: parsed.decomposedFrom === null ? ref : null,   // 0.2.x
```

That trailing `null` meant *leave it alone*, so **its replacement is absence** — not `{ clear: true }`:

```ts
...(parsed.decomposedFrom === null ? { decomposedFrom: { set: ref } } : {}),   // 0.3.0
```

A mechanical rewrite to `{ clear: true }` deletes provenance on every refresh of a block that has it — the exact data loss this release exists to make impossible. It is well-typed and the runtime guard cannot detect it, because a caller asking to clear and a caller who meant to leave the field alone send identical bytes. This is the one migration step to do by reading rather than by search-and-replace.

Everything else is mechanical: a ref becomes `{ set: ref }`, an array becomes `{ set: [...] }`, and a `serializeWith: null` that really did mean remove becomes `{ clear: true }`. TypeScript rejects every old spelling at the call site; JavaScript callers get a throw.

<details>
<summary>Why the gap existed before 0.3.0</summary>

`null` being taken is why `decomposed-from` and `duplicate-of` could be set and replaced but **never cleared**. A groomer that decided an issue was not a duplicate after all had to re-render the whole block — the lossy path this call exists to avoid, which discards extension fields, comments, and sibling top-level keys.

Two alternatives were rejected. A **distinct sentinel** (a `CLEAR` symbol, so `null` keeps its meaning) leaves three spellings of one concept — `[]`, `null`, `CLEAR` — and cannot cross a JSON boundary, so `@issuegraph/cli` would need a fourth. A **separate `clearGeneratedEdges` verb** forces a caller that sets one edge while clearing another into two calls with two independent results, where the second can fail after the first already moved the body.

</details>

It answers `no-block` rather than guessing whenever the block is one a parser would refuse — an inline value on the key, a child that is not a mapping entry. A body that comes back `spliced` and parses to nothing is the one failure a writer must never produce, which is why `spliced` is verified on both questions: that the result still reads, **and** that every field the call owns is what the call asked for.

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
