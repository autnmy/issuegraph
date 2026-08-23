# @issuegraph/spec

The [Issuegraph](https://github.com/autnmy/issuegraph) specification's vocabulary, as data.

This package holds what the spec *fixes* and nothing it *derives*: the field names, their cardinality, the value sets, and the documented defaults. It parses nothing, reads nothing and builds no graph — those are a reader's and a writer's jobs, and keeping them apart is what lets you depend on the vocabulary without taking on either.

```sh
npm install @issuegraph/spec
```

```ts
import { FIELDS, EDGE_CARDINALITY, DEFAULT_PRIORITY, isField, isPriority } from '@issuegraph/spec';

FIELDS;                          // the seven recognised fields, frozen
EDGE_CARDINALITY['blocked-by'];  // 'list' — every other edge field is 'single'
DEFAULT_PRIORITY;                // 2, per SPEC.md §4.3.5
isField('blocks');               // false — there is no `blocks` field; see §4.3.1
isPriority('2');                 // false — YAML hands you strings; a priority is an integer 0–3
```

Every export is frozen. A shared vocabulary a consumer can mutate is a vocabulary that disagrees with itself in the next process.

## What it does not do

No frontmatter parsing, no graph construction, no readiness or effective-priority computation, no tracker access. Those arrive as separate packages.

## Stability

`0.x`, and unstable. It tracks a draft specification (SPEC.md §8), so breaking changes before `1.0` are expected and a minor bump may break you. Pin exactly if that matters.

## Licence

Apache-2.0. Stewarded by [Autonomy LLC](https://github.com/autnmy).
