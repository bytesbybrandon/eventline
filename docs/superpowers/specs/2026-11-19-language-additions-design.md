# Language additions: short guard arrows, named policies, predefined events

Date: 2026-11-19
Status: approved by the owner in conversation; builder check done
Issues: #35, #33, #39

## Intent

Three additions to the eventline language, built together because each touches the same places: the parser, the highlighters, the app's autocomplete, the docs grammar and code-shape check, the language reference and the board.

- **#35:** some people find `--[guard]-->` slow to type. Accept `-[guard]->` too.
- **#33:** a policy has no name of its own. The board names it after its worker, so a policy with several workers splits into several boxes, two policies sharing a worker merge, and nothing else in a model can refer to a policy. Flows (#34) will need policy names.
- **#39:** teams often write events down before anything records them. Let a model declare an event on its own, and later hold recorded events to that declaration.

The governing rule, decided with the owner: syntax stays fast; fidelity comes from the diagrams and the stricter profiles.

## Goals

- `-[guard]->` means exactly what `--[guard]-->` means, everywhere a guard is written.
- `policy Name = <trigger> ...` names a policy, with any trigger: an event, a timer, or `from [...]`.
- `event <name> { fields }` declares an event, which then acts as the event's contract.

## Non-goals

- Flows (#34), the formatter (#30).
- Rewriting existing examples to use any of the new forms, beyond one example of each in the docs.
- Types on declared fields.

## Anti-goals

- A model that parses on `main` stops parsing.
- Writing a model takes more typing than today.
- SliceRM's use of the library breaks. It calls `parse`, `check` and `render`, and reads `model.policies`, `model.events`, `model.views`, `model.contexts` and `model.boundaries`.
- The homepage demo regresses.

## Constraints

- `lib/` stays pure and dependency-free.
- Existing ids (`cmd:`, `evt:`, `view:`, `pol:`, `implied:`, `auto:`), JSON and toon output keys, and rule ids keep their names. New fields are additive.
- `node scripts/build-site.js` after `lib/` or `examples/` changes; `node scripts/build-rules-doc.js` after catalogue changes. Generated files that differ only in line endings are restored, not committed.
- `npm test` passes, and the docs build passes.

## Approaches

Each issue has one sensible way to build it, given the parser and board as they are. Building the three in one branch, rather than one branch each, updates the shared places (highlighters, autocomplete, docs grammar, language reference) once instead of three times.

## Design

### #35 Short guard arrows

- The parser accepts `-[guard]->` wherever it accepts `--[guard]-->`: command branches, policy rules, `default` branches. The two forms produce identical models.
- The parser only looks for `-[` where a guard can start, so `-[` inside notes, strings or annotation arguments is unaffected. A sweep of every `.dsl` on `main` plus tests with `-[` inside a note and an annotation is enough to show this (designer's call).
- A guard opened with one form may not be closed with the other (`--[x]->` and `-[x]-->` are errors), with a message naming both forms.
- Every highlighter and shape check learns the short form: the playground highlighter, the homepage hero's branch markers (`site/site.js`), the docs grammar (`docs-site/src/code/eventline.tmLanguage.json`) and code-shape check (`docs-site/src/code/eventline-source.mjs`).
- Parse error messages that show a guard show `--[guard]-->` and mention `-[guard]->`.
- `docs/LANGUAGE.md` keeps `--[...]-->` as the main form and says `-[...]->` is the short form.

### #33 Named policies

- `policy Name = <trigger> <rest of policy>`, where the trigger and the rest are exactly what an unnamed policy allows today:
  ```
  policy NotifyLiker = tweet-liked { userId, tweetId } -> notification-worker -> sendLikeNotification(tweetId, userId)
  policy ShipOrders = from [OrdersToShip] -> fulfilment-worker -> shipOrder(cartId)
  policy NightlyReport = every 1 days -> reporter -> buildReport()
  ```
- `Name` is a PascalCase-style identifier, like a read model name. The model gains `policy.name` (string or `null`).
- Policy names are unique across the whole model, contexts included. A policy name that equals a command or read model name is also a `ParseError`, so `deps <file> <Name>` is never ambiguous (designer's call).
- `Model.policyLabel(p)` keeps returning the trigger, and `emittedBy[].name` and `consumedBy[].name` keep holding it, so their values and the cycle check don't change. A new `Model.policyName(p)` returns `policy NotifyLiker` for a named policy and the trigger label otherwise; messages, the `policies` output and the board use it (designer's call).
- Compatibility: `policy -> cmd(...)` stays an actor called `policy` issuing a command; `policy { ... } -> ...` and `policy --[...]-->` stay policies on an event named `policy`. The new statement is `policy` followed by an identifier and `=`.
- **Board:** a named policy is one processor box, id `policy:<Name>`, label `Name`, sub-label listing its workers (`notification-worker`, or `automation` when a rule has none). All its rules hang off that one box. Unnamed policies are drawn exactly as today (`pol:<worker>`, `auto:...`). Implied read models, `from [...]` reads and timer placement work the same for named policies.
- **Links:** `policy:<Name>` links to each of its workers' boxes in the containers and data flow diagrams (`worker:<w>`), as `pol:<w>` does today. `@link` on a named policy works as on any policy.
- **CLI:** `policies` shows the name when there is one; `deps <file> <Name>` accepts a policy name.
- **Checks:** messages about a named policy say `policy NotifyLiker` instead of the trigger. `@slice` on a named policy works as today.
- Autocomplete gets a `policy` snippet that writes the named form.

### #39 Predefined events

**Phase 1: declare.**

- `event <event-name> { fields }` declares an event. The field list is optional. Field syntax is the same as in a recorded event's payload; a declared `name: expr` counts as the field `name`.
- `event item-added` with no field list declares the event without a contract: phase 2 checks nothing for it (designer's call).
- The model's event index (`model.events`) gains `declared: { fields, line, context } | null` on each entry. A declared event that nothing records has `emittedBy` empty, as today.
- When an event is declared with fields, those fields are its known payload: `events[].fields` is the declared list, not the fields merged from recordings. So the existing `unsourced-view-field` rule checks read models against the declaration, and a declared event nothing records is no longer "unknown" to it (designer's call).
- Declarations are unique across the whole model; a second one, in any context, is a `ParseError`. The declaring context is shown on the board and in the CLI, and counts as the event's owner only when nothing records it. The existing cross-context rules keep using the recording commands' contexts (designer's call).
- Compatibility: `event { id } -> w -> go(id)` stays a policy on an event named `event`; `event -> doThing(id)` stays an actor called `event`. The new statement is `event` followed by an event name.
- Works inside `context` blocks: the event belongs to the context that declares it. A second declaration of the same event is a `ParseError`.
- **Used** means: something records it (a command branch or a policy rule), checks it with `on [...]`, folds it in a read model, or starts an automation from it. Scenario steps and annotations don't count. The board and `event-declared-unused` use this one definition (designer's call).
- **Board:** a declared event does not appear until it is used. When a used event is declared but nothing records it, it is styled as declared (sub-label `declared`) and a command's note says `checks item-added (declared)`. "Assumed" stays for events nothing records and nothing declares.
- **CLI:** `events` lists declared events and says which are not used and which are not recorded; machine-readable output gains a `declared` field and keeps its existing keys.
- **Check `event-declared-unused`:** profile `workshop` and `eventmodeling`, severity `info`. A declared event nothing uses.

**Phase 2: the contract.**

- **Check `event-contract-mismatch`:** profile `eventmodeling`, severity `warn` (and `warn` under `slicerm`). Every recording is checked on its own, at its own line: each command branch and each policy rule that records a declared event with fields. It reports a plain field the declaration lacks, and a declared field the recording does not carry.
- A recording's computed field (`addedAt: clock.wall()`) supplies a declared field of the same name, and computed fields the declaration does not list are allowed (owner's decision). A recording written with no payload (`[item-added]`) is not checked (designer's call).
- A read model that reads a field a declared event lacks is reported by the existing `unsourced-view-field` rule, because the declaration is the event's known payload. There is no separate rule for it (designer's call).
- Each new rule has a catalogue entry with a bad and a good example, and `docs/RULES.md` is regenerated.

### Docs

- `docs/LANGUAGE.md`: the short guard form; a "Named policies" section; a "Predefined events" section covering both phases.
- `docs/GLOSSARY.md`: entries for Named policy and Declared event.
- `EVENTLINE-AXI.md`: the `policies`, `deps` and `events` changes.
- `docs/ARCHITECTURE.md`: the `policy:` id and how it links.
- One example of each new form in the docs. Existing examples are not rewritten.

## Testing

- Parser: both guard forms give identical models; mixed forms are errors; `policy Name = ...` with each trigger; `event` declarations with and without fields, inside contexts; duplicates error; every compatibility form above still parses as on `main`; every `.dsl` on `main` parses.
- Board: a named policy with two workers is one box with links to both workers; unnamed policies unchanged; a used declared event is styled declared; an unused one is absent.
- Rules: catalogue examples, severities per profile, computed fields supplying declared ones, extra computed fields allowed, a payload-less recording not checked, a declaration with no fields not checked, two recordings checked separately, a read model reading an undeclared field reported by `unsourced-view-field`.
- CLI: `policies`, `deps <Name>`, `events`.
- Browser: the app with a model using all three additions; the homepage unchanged.

## Decisions made by the designer

- The id prefix `policy:<Name>` for named policies.
- `warn` for the contract checks under `eventmodeling` and `slicerm`; `info` for an unused declaration under `workshop` and `eventmodeling`.
- Mixed guard forms (`--[x]->`) are errors.
- Duplicate policy names and duplicate event declarations are parse errors, model-wide; a policy name may not equal a command or read model name.
- `Model.policyLabel` keeps returning the trigger; a new `Model.policyName` gives the name people read.
- `-[` is only looked for where a guard can start.
- A declaration with no field list has no contract; a recording with no payload is not checked.
- Declared fields become the event's known payload, so `unsourced-view-field` covers read models and there is no separate unread-field rule.
- Declarations are model-wide; the declaring context owns the event only when nothing records it.
- One definition of "used" for the board and the unused-declaration check.

## Left to the builder

- The exact wording of messages and docs, within the existing voice.
- How the declared style looks, within the existing board look.
