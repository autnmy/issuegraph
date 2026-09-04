# @issuegraph/cli

One command over the [Issuegraph](https://github.com/autnmy/issuegraph) packages. Read the block out of an issue body, derive the selection order over a set of issues, and edit the block in place.

```sh
npm install -g @issuegraph/cli
issuegraph parse < issue-body.md
```

It composes `@issuegraph/reader`, `@issuegraph/derive` and `@issuegraph/writer`, and **implements no parsing and no ordering of its own**. If it needs a behaviour the libraries lack, the library grows.

## The boundary

**The outermost input and output is the ticket body.** Text in, text or JSON out.

Nothing here reaches the network, holds a credential, or knows what a tracker is. Closure state, labels and assignee counts are **inputs you supply** to `order`, never things this command fetches — which is exactly what lets it run inside a workflow that holds issue bodies and no token.

## Absence is not malformation

This is the reason the command exists.

A plain YAML load of the unquoted block-sequence form yields `[None, None]` — successfully, silently, and empty, because `#` opens a YAML comment:

```yaml
blocked-by:
  - #123
  - #124
```

An issue with two hard blockers reads as an issue with none, and blocked work is handed to whoever asked. So every answer names one of four states, and the one that cannot be represented honestly refuses:

| state | what it means | `parse` | `validate` |
|---|---|---|---|
| `read` | a delimited block, fully read | `0` | `0` |
| `absent` | no block at all — a valid issue that declares no edges | `0` | `0` |
| `inert` | a key is present but no `---` pair delimits it | `0` | `5` |
| `unread` | a **delimited** block, and something inside it could not be read | **`3`** | **`3`** |

On `unread` the JSON carries **no `data` field at all** — not `data: null`, which a caller could read as "no edges" — and the exit code is non-zero. A program reads the value; a shell reads the code.

`inert` is reported but not refused by `parse`: a key with no delimiters is how hand-authored blocks are overwhelmingly written, so refusing it would refuse nearly every real declaration. `validate` gives it its own code, and `backfill` repairs it.

## Verbs

Input arrives on **stdin** unless a file option is given. Data verbs write **JSON to stdout**; body verbs write **the resulting body to stdout and nothing else**, so redirection is safe. Every note, warning and error goes to stderr.

**One opt-in exception:** `backfill --json` emits the outcome as JSON instead of the body — see below. The default is unchanged, so a caller only ever sees JSON by asking for it.

| verb | what it does |
|---|---|
| `parse` | read one issue body and report what it declares |
| `validate` | check one body's block and report what is wrong with it |
| `order` | derive the selection order over a set of issues you supply |
| `ready` | the same derivation, filtered to the slots that are ready |
| `set` | write fields into one body, rendering a block if it has none |
| `splice` | refresh the owned generated edges inside an existing block |
| `backfill` | repair a block a code fence left undelimited |

Run `issuegraph --help` for the options; it renders the verb and exit tables from the same data the parser reads, so it cannot drift from them.

### Reading

```sh
issuegraph parse < issue-body.md
issuegraph validate --body-file issue-body.md
```

### Ordering

`order` and `ready` take a document carrying each issue's **body** plus the tracker facts this command does not fetch:

```json
{
  "homeRepo": "owner/repo",
  "baseRanking": {
    "source": "config",
    "order": [{ "key": "1", "matchedOrderIndex": 0 }]
  },
  "issues": [
    {
      "number": 1,
      "open": true,
      "labels": ["P1"],
      "assigneeCount": 0,
      "body": "---\nissuegraph:\n  blocked-by:\n    - \"#2\"\n---\n"
    }
  ]
}
```

**An issue is identified by `id` or by `number`.** `number` is the original spelling and every existing caller may keep it. `id` accepts an **opaque tracker-scoped identifier** as SPEC §4.2 defines one — `ABC-123`, `ENG-456` — so a Jira or Linear corpus can be ordered:

```json
{ "id": "ABC-123", "open": true, "labels": ["P1"], "assigneeCount": 0, "body": "…" }
```

Supply one or the other. Both is accepted while they agree, so a migration from `number` to `id` need not be a flag day; both disagreeing is refused, because one issue named two ways has no correct reading. Neither is refused too — an issue with no identifier cannot be named by any body in the corpus. Whichever you send is the key every `blocked-by` in the corpus resolves against, and the key the output's `lead` and `members` report.

```sh
issuegraph ready --input issues.json
```

The document carries **bodies, never pre-parsed data**. Accepting a caller's own edge objects would let it hand-roll the grammar and feed the result in, which is the defect this package exists to end.

Each slot in the output carries `holdReasons` — the sentences naming why it is held — and `holds`, the same conditions as `{ code, subject?, text }` from the reader's closed vocabulary, so a consumer groups or filters holds by `code` and links `subject` rather than matching prose.

A body that could not be fully read is listed under `underRead` and carried into the derivation as under-read rather than edge-free — so it is **held, not ranked ready**. That does not fail the run: on a real corpus, unreadable bodies are common, and refusing the whole set would make the command unusable.

### Writing

```sh
issuegraph set --blocked-by 123 --blocked-by 124 --evidence verified < body.md > new-body.md
issuegraph splice --edges '{"blockedBy":["7"],"serializeWith":null}' < body.md
issuegraph backfill < body.md
```

### `backfill --json` — the outcome as data

`backfill` normally writes the repaired body, and reports which of its four
outcomes happened only as prose on stderr. That is fine at a prompt and unusable
in a loop: branching on it would mean matching another package's message text,
which stops matching silently when the wording changes.

`--json` puts the outcome on stdout instead:

```console
$ issuegraph backfill --json --body-file body.md
{
  "outcome": "delimited",
  "body": "…the repaired body…",
  "diagnostics": []
}
```

| `outcome` | means | do |
|---|---|---|
| `delimited` | repaired | write `body` back |
| `already-canonical` | the block was already fine | nothing |
| `no-block` | there is no block | nothing |
| `unrecoverable` | cannot be repaired without guessing | leave it; a human decides |

**On `unrecoverable` there is no `body` key at all** — not an empty string, and
not `null`. The input was not repaired, so there is nothing a caller could write
back believing it had been. That is the same shape `parse` uses for `unread`.

**The exit code is unchanged by the flag.** `unrecoverable` is a refused write
either way, so it still exits `4`; the payload carries the outcome and the code
carries the decision. A shell reads the code, a program reads the value.

**`validate` cannot substitute for this.** A repairable block and an unrepairable
one produce byte-identical `validate` output — `{"state":"inert","ok":false,
"blockDefect":"undelimited"}` — so this boundary is the only place they differ.

References take any spelling the reader accepts: `123`, `#123`, or `owner/repo#123`.

`set` renders a fresh block when the body has none and splices when it has one. `splice` only ever edits an existing block, and refuses when there is none.

### What a write cannot do

The writer's capabilities differ per field, and the CLI refuses what it cannot perform rather than exiting `0` having changed nothing.

| field | can be written into an existing block | can be **removed** from one |
|---|---|---|
| `blocked-by` | yes | yes — `--no-blocked-by` |
| `serialize-with` | yes | yes — `--no-serialize-with` |
| `decomposed-from` | yes | yes — `--no-decomposed-from` |
| `duplicate-of` | yes | yes — `--no-duplicate-of` |
| `together-with` | **no** | no |
| `priority` | **no** | no |
| `evidence` | **no** | no |

The last three reach a body that has **no block yet** (rendered) and cannot be amended in one that has: the specification makes a tracker's own convention canonical for them and the frontmatter field a mirror. There is no `--no-` form for them because there is nothing for it to remove.

The four edges the splice owns can each be written *and* removed. That is new in `0.3.0`: before it, `decomposed-from` and `duplicate-of` could be written but not cleared, because the writer read an empty value there as *leave untouched* — deliberately, so a machine refreshing its own edges could not erase provenance by omission, and at the cost of no way to retract a dedupe verdict at all. The writer gave removal its own spelling, so omission still means *not mine* and both `--no-` flags exist now.

**Omitting a key is still the only way to say *leave it alone*.** A key you name is a key this command will write or remove.

An **unrecognised `--edges` key is refused** rather than ignored. That refusal lives on the operation, so it holds for `setFields` and `spliceEdges` alike when you call them as a library.

**`--edges` takes the same flat shape it always did**, and the wrapping happens inside. `{"duplicateOf": "#5"}` writes, `{"duplicateOf": null}` clears, `{"blockedBy": []}` clears. Only the last of those changed meaning in `0.3.0`, and only from a refusal — no invocation that used to succeed behaves differently.

The `order` document must also name each issue **once**: two entries for one key are refused rather than deduplicated, because the derivation keeps the first and this package restating that rule is how the two drift. A write command that exits `0` having silently done nothing tells its caller a thing happened that did not, and automation cannot detect it — which is the same defect this package exists to refuse, one layer up.

Both write verbs also **refuse an unread block**: editing entries nobody could read would replace edges the run never saw.

## Exit codes

| code | name | meaning |
|---|---|---|
| `0` | `ok` | the command answered |
| `1` | `internal` | an unexpected error escaped; a bug in this package |
| `2` | `usage` | unknown verb or option, missing required input, or unreadable input file |
| `3` | `unreadDeclaration` | a delimited block was found and something inside it could not be read; edges were **not** reported |
| `4` | `refusedWrite` | the write was declined — no block to edit, or the edit was not representable |
| `5` | `inertDeclaration` | `validate` only: a key is present but no `---` pair delimits it |

The exit code describes **the command's outcome**, never the declaration's state — the state is always named in the JSON, which frees the code to carry the decision a caller can branch on without parsing anything.

## Using it as a library

Every verb is a pure function from text to `{ stdout, stderr, code }`, so a program already in a process need not spawn one:

```ts
import { parseBody, classifyDeclaration, EXIT } from '@issuegraph/cli';

const result = parseBody(issue.body);
if (result.code === EXIT.unreadDeclaration) {
  // The block was there and could not be read. Do not treat it as edge-free.
}
```

Importing this package runs no command: the binary is a separate entry.

## License

Apache-2.0
