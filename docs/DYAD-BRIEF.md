# Brief for Dyad: support the eventline language in SliceRM

Audience: Dyad, building SliceRM at `slice-rm`.
Owner: Brandon.
Language reference: [LANGUAGE.md](./LANGUAGE.md), section 9 for the newer constructs.
Reference output: [dyad/slicerm.dsl](./dyad/slicerm.dsl), SliceRM's own model written in eventline.
Reference converter: [dyad/convert-slicerm.js](./dyad/convert-slicerm.js).

---

## 1. What to build

SliceRM models a system as slices on an event-modeling board with dynamic consistency boundaries.
eventline is a plain-text language for the same thing.
Teach SliceRM to export a project as eventline text and to import eventline text as a project.

Why:

- A model becomes a file that diffs, reviews and lives in git.
- eventline derives diagrams from the file: the event model board, a context map, containers, dataflow and deployment.
- `eventline-axi validate` checks a model against rules SliceRM does not have yet.
- Other tools and people can write models without opening SliceRM.

## 2. Evidence that the language fits

SliceRM's own model (`sliceRmProject()` in `src/mock/slicerm-project.ts`) was converted with the reference converter.

| Measure | SliceRM | eventline result |
| :--- | :--- | :--- |
| Commands | 122 | 122 |
| Events | 125 | 125 |
| Read models | 22 with a view slice | 22 views |
| Automations | 2 | 2 timer policies |
| Contexts | 11 | 11 `context` blocks |
| Consistency tags | 16 roots | 16 boundaries |
| Rejections | 74 on 51 commands | 74 `reject` branches |

The file is 580 lines.
`eventline-axi diagrams` renders all six diagrams in 0.3 seconds.

Before the language additions the same conversion lost rejections (they became fake `-rejected` events, so 125 events became 196), contexts, automation schedules, typed fields, planned status and state-backed slices.
Those are now first-class.

## 3. The contract

A conforming SliceRM implementation does all of the following.

1. **Export** produces text that `eventline-axi` parses with no errors.
2. **Import** accepts any text that `eventline-axi validate` reports with no errors.
3. **Round trip**: export, import, export again gives identical text.
4. Anything the language cannot hold stays in SliceRM's own backup format and is never silently dropped on import.
5. The grammar and the meaning of every construct come from [LANGUAGE.md](./LANGUAGE.md).
   SliceRM does not extend the syntax privately.
   New needs come back to this repo as a language change.

The parser, model and diagram code in `lib/` are plain CommonJS with no runtime dependencies and no Node built-ins.
`parse(text)` returns the model, and `render(model, kind, format)` returns SVG, Mermaid or DOT as a string.
Vendor those files into SliceRM or call the CLI.
Brandon decides which.
A published `exports` map for `eventline-axi` would make the first option cleaner.

## 4. Mapping, SliceRM to eventline

| SliceRM | eventline | Notes |
| :--- | :--- | :--- |
| Project name | `system Name { }` | |
| `eventNaming.style` | `event-naming: none \| pascal \| kebab` | SliceRM's own model uses `none` |
| Context | `context Name { description, publishes, ... }` | `publishes` lists event names, not element ids |
| Lane (actor) | `actor Name { auth: ... }` | Translators are not actors; see below |
| Command, fields | `Actor -> verb(field: type)` | Name in lowerCamelCase; type is free text |
| Rejection `{code, rule}` | `--[rule]--> reject CODE` | Records no event |
| Event, fields | `[EventName { field: type }]` on the default branch | |
| Consistency tag `root:key` | `in Root(key)` plus `boundary Root(key)` | A boundary is not a context |
| Screen | `@note("Lane uses ScreenName")` on the command | No first-class screen yet; see section 6 |
| Slice name | `@slice("name")` | Identity for round trip |
| Slice `notes` | `@note("...")` | Repeatable |
| Slice `status: todo` | `@planned` | |
| Slice `storage: state` | `@state(model="...", result="...")` | |
| Story text | `@story("As a ...")` | One line |
| Evidence events | `on [Event, ...]` | |
| Read-model slice, query params, fields | `view Name(p: type) = [Events] => { f: type }` | |
| Translation slice, translator source | command with the translator as actor, `external: Name (translator)` in `system`, `@note("translates from System vN")` | |
| Automation, interval schedule | `every N unit` then `from [ReadModel]` then `-> Worker -> command()` | |
| Automation reads a read model | `from [View]` | |

## 5. What the language does not hold

These stay in SliceRM's own formats.
Export may write them as a sidecar file or leave them out, and import must keep whatever the project already has.

| Item | Why it stays out |
| :--- | :--- |
| Requirement hierarchy: epics, priority, status, links | Requirements are SliceRM's product, not part of describing a system |
| Gherkin scenarios (115 stories) | Multi-line; a candidate for a block syntax, see section 6 |
| Flows (story replay) | Presentation state |
| Plan levels and items (22) | Delivery planning |
| Review scores, draft elements, agents, personas, audit log | Collaboration state |
| Board layout: lanes order, beats, placements, parked lanes | Derived; eventline lays the board out itself |
| Named types and field definitions | Types are free text; definitions are not carried |
| Read-model query `returns` cardinality (3 cases) | No place for it yet |
| Read models used by an automation but with no view slice (2) | `validate` flags them as `from-facts`; declare a view for each |

## 6. Candidate SliceRM features

Each is independent.
Order is a suggestion.

### F1. Export to eventline

- Pure function `toEventline(project): string`, in `src/contexts/modeling/text/` beside the existing model text format.
- Acceptance: for `sliceRmProject()` it produces text with 122 commands, 125 events, 22 views, 2 timer policies, 11 contexts and 16 boundaries, as counted by `eventline-axi` on the output.
- Acceptance: the output equals `docs/dyad/slicerm.dsl` apart from ordering that the self-model itself changes.
- Acceptance: a unit test pins the counts and the rejection count.

### F2. Import from eventline

- `fromEventline(text, current?): ProjectDoc`, with the parse errors and their line numbers shown to the user, never swallowed.
- Rebuild lanes, beats, placements and element ids deterministically from the text.
- Slice identity comes from `@slice("name")`, then from the command name.
- Keep requirements, plan, flows and reviews from `current` when slices match by identity.
- Acceptance: export then import then export is byte identical for the self-model.
- Acceptance: a model with a syntax error leaves the project untouched and reports the line.

### F3. Validate in the app

- Run the `eventline-axi` rules on the exported text and show the issues next to the slices they name.
- Acceptance: the self-model shows the two `unpublished-event` warnings (`RequirementWithdrawn` from Requirements, `SliceDelivered` from Delivery) and the two `from-facts` warnings, and nothing else above `info`.
- Acceptance: fixing a warning in the model clears it without a reload.

### F4. Derived diagrams

- A view that renders `eventmodel`, `contextmap`, `containers`, `dataflow` and `deployment` from the exported text.
- Use palette tokens for colors, as `AI_RULES.md` requires, and map them onto the diagram themes.
- Acceptance: all five render for the self-model in under one second and match `eventline-axi diagram` output.
- Acceptance: unknown or empty diagrams (no contexts, no regions) say why instead of drawing an empty canvas.

### F5. Context contract

- Surface `publishes` in the Modeling UI and warn when a context reads an event it is not published for.
- Acceptance: adding an event to a context's `publishes` clears the matching `unpublished-event` warning.
- Acceptance: the context map shows a solid arrow for a published event and a dashed one for an unpublished event.

### F6. Notes as a first-class field

- A slice, view or automation can carry several notes, and screens can be recorded as notes today.
- Acceptance: a note written in the app appears as `@note("...")` on export and returns on import.
- Acceptance: quotes and line breaks in a note survive the round trip.

### F7. Scenarios in the language (decision for Brandon first)

The language has `@story` for one line and nothing for Gherkin.
If scenarios should travel with the model, add a block syntax to eventline first, then support it here.
Do not encode multi-line text in annotations.

## 7. New things from eventline worth adopting

| Idea | What it gives SliceRM |
| :--- | :--- |
| Derived diagrams | A context map and architecture views for free, with no hand drawing |
| Boundary brackets on the board | The DCB scope of each command is visible on the board |
| `reject CODE` | Refusals are not events, so the event list stays honest |
| Timers and `from [View]` on policies | Automations read what they need before acting |
| `validate` rules | Missing default branch, commands that record nothing, unpublished cross-context events, unknown boundaries |
| `event-naming` | One setting for the naming convention, enforced the same way everywhere |
| Role `core \| adapter` on a context | Lets a context declare whether it holds rules or wraps something outside; compatible with the code-generation note in `notes/code-generation-design.md` |

## 8. Findings in SliceRM's own model

`eventline-axi validate docs/dyad/slicerm.dsl` reports:

- `RequirementWithdrawn` crosses from Requirements to Delivery, but Requirements does not publish it.
- `SliceDelivered` crosses from Delivery to Traceability, but Delivery does not publish it.
- Two automations read read models (`IncomingChanges`, `LapsedLeases`) that no view slice defines.
- 122 info notes that commands list no `on` facts, which is expected for commands that start a flow.
- 29 info notes that a command has no consistency tag.

These are real gaps in the model, found by deriving the language form.

## 9. Conventions to respect in slice-rm

- Follow `AI_RULES.md`: colors from the palette only, and update `src/mock/slicerm-project.ts` when the self-model changes.
- Put new code under `src/contexts/modeling/text/` and keep deciders pure.
- Document the file format next to `docs/src/content/docs/reference/spec-format.md`.
- Hand-offs live in `notes/`; copy this brief there as `notes/eventline-handoff.md`.

## 10. Regenerate the reference output

```text
cd slice-rm
npx esbuild@0.24 dump.ts --bundle --platform=node --format=cjs --alias:@=./src > dump.cjs
node dump.cjs > project.json
node <eventline>/docs/dyad/convert-slicerm.js project.json slicerm.dsl
npx -y eventline-axi validate slicerm.dsl
```

`dump.ts` is three lines: import `sliceRmProject`, call it, print the JSON.
