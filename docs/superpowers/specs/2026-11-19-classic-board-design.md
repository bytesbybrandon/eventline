# Classic event model board and read models: design

Date: 2026-11-19
Status: awaiting owner approval (builder check done)
Issues: #36, #37

## Intent

eventline's event model board differs from a classic Event Modeling board, and from SliceRM's, in ways practitioners notice first:

- automations sit in a policy lane of their own, not beside screens and actors;
- an event can arrow straight into an automation, which makes events look handled one at a time instead of folded;
- a command's `on [...]` facts arrow from events into the command, which reads as "this event causes that command";
- read models are called views, which is easy to confuse with screens.

This batch makes the board show the classic shape, so eventline and SliceRM show the same picture of a model, and renames views to read models everywhere people read the word.

The governing rule, decided with the owner: **syntax stays fast; fidelity comes from what the diagrams draw and what the stricter profiles require.** No existing model may stop parsing.

## Goals

- The event model board has three rows: actors and processors, commands and read models, events.
- The event model board never shows an event feeding an automation or a command directly. Events reach automations through a read model, and commands through their decision model. (The containers and data flow diagrams describe infrastructure, where a worker really does consume the event log; their edges stay, and only their labels change. Designer's call.)
- The `eventmodeling` and `slicerm` profiles ask for the read model an event-triggered automation implies.
- "Read model" replaces "view" in every word a person reads: board, legends, diagram labels, check messages, CLI text, the app, the homepage and the docs.

## Non-goals

- Offering to write an implied read model out automatically, in the CLI or the app.
- Predefined events. That is the next step, designed separately.
- Named policies (#33), flows (#34), short guard arrows (#35) and the formatter (#30).
- Any change to what a model means, or to which models are valid under `core`.

## Anti-goals

The batch has failed, even if every feature exists, if:

- a model that parses today stops parsing;
- writing a model takes more typing than today;
- SliceRM's use of the library breaks. It calls `parse`, `check` and `render(model, kind, 'svg', theme)`, reads `model.views`, `model.policies`, `model.events`, `model.contexts` and `model.boundaries`, and shows the rendered SVG as a picture. It does not parse the SVG's structure, so lane names, `data-*` attributes and the internal board graph are not a contract. The board graph is not public API;
- the homepage demo regresses.

## Constraints

- `lib/` stays pure and dependency-free, so `site/eventline.js` can keep bundling it.
- The library API, the node ids used to link diagrams (`view:`, `pol:`, `cmd:`, `evt:`), JSON and toon output keys, the `@projection` annotation and the `from [...]` syntax keep their names. Only words people read change.
- `node scripts/build-site.js` regenerates the homepage board image and the browser bundle, and `test/site.test.js` must pass afterwards.
- `npm test` passes. The rules page is regenerated with `node scripts/build-rules-doc.js`.

## Approaches considered

1. **Change the event model board itself. Chosen.** Every consumer (app, homepage, CLI, docs) shows the classic shape. Nobody depends on the current layout except the homepage image, which is regenerated from the examples.
2. **Add a second, classic board beside the current one.** Two pictures of the same model, against the goal of matching SliceRM, and twice the layout code.

For the rename, three options were considered: rename only the words people read (cheapest, but the syntax still says `view`); add a new keyword and keep `view` as a short alias (chosen: nothing breaks, the precise word leads, the short form stays for speed); or replace the keyword (breaks every model, longest to type).

## Design

### Board rows

| Row label | What sits there |
|---|---|
| `ACTOR` | actors, timers and processors; a screen or other trigger names the actor's arrow |
| `COMMAND · READ MODEL` | commands and read models, interleaved left to right in time |
| `EVENT` | events |

The policy lane and the separate view lane are removed. Columns still come from causality, as today. A read model sits right of the latest event that feeds it, in the middle row.

```
ACTOR                 Customer                      fulfilment-worker
COMMAND · READ MODEL  addItem   CartSummary  (order-placed)   shipOrder
EVENT                 item-added             order-placed
```

### Processors

- A policy's worker is drawn in the actor row, at the point in the timeline where it acts, in the existing policy style.
- Its id stays `pol:<worker>`, so links to the containers and data flow diagrams keep working.
- A policy rule with no worker (`--[guard]--> [events]`) gets an unnamed processor labelled `automation`, so an event never reaches other events without one. Its id is `auto:<policy line>:<rule index>`, one per rule, so unrelated rules never merge and no worker name can collide with it. It takes the policy's source lines for click-to-source and tracing, and has no links to other diagrams.

### Implied read models

- When a policy is triggered by an event, the board draws an implied read model between them: fed by the event, read by the processor.
- One implied read model per triggering event, shared by every policy that event triggers.
- It is labelled with the event's name, with the sub-label `implied read model`, and drawn with a dashed outline so it reads as derived, not declared. Its id is `implied:<event>`, it takes the source lines of the policies that imply it, and it has no links to other diagrams.
- Timer-triggered policies are unchanged: they already read through `from [...]`.
- No implied read model is drawn when the policy already reads, with `from [...]`, a read model whose sources include the trigger event. That read model takes its place: fed by the event, read by the processor.
- Any other `from [...]` read models the policy reads are drawn as well, as today.

### Decision models

- The dashed arrows from `on [...]` events into commands are removed.
- Each command carries a note listing its decision model: `checks item-added*`.
- Facts nothing in the model records are marked in the same note: `checks cart-opened (assumed)`. This replaces today's separate `assumes ...` note.
- Command ordering still uses these facts, as today.
- The legend changes to match: the dashed arrow means "read model read", and there is an entry for implied read models.

### Automations that start from a read model (owner's decision)

Two ways to write an automation that reads through a read model, both accepted:

1. **Event as the wake-up, then the read model.** Valid today:
   ```
   order-placed from [OrdersToShip] -> fulfilment-worker -> shipOrder(cartId)
   ```
2. **The read model alone.** New: a policy statement may start with `from [...]`, meaning "whenever these read models change":
   ```
   from [OrdersToShip] -> fulfilment-worker -> shipOrder(cartId)
   ```
   - Guards and every rule shape work as for other policies: `from [OrdersToShip] --[guard]--> worker -> command()`.
   - In the model, such a policy has `trigger.event === null`, `trigger.schedule === null` and a new `trigger.readModels: true`. Existing triggers get `readModels: false`, so code that checks `trigger.schedule` or `trigger.event` keeps working. SliceRM's importer should learn the new shape (comment on ByteQuilt/SliceRM#1).
   - On the board, the processor sits right of the latest read model it reads, and each read model has a dashed "reads" arrow into it. There is no event and no implied read model.
   - A statement starting `from` without `[` is still an error, with a message that shows both forms.
   - The parse error that lists how a statement can start mentions `from [...]`.
   - Docs: `docs/LANGUAGE.md` shows both forms next to the event shorthand, and says which the stricter profiles expect. The docs' code-shape check already accepts a line starting `from [`.

### The new check

- Rule `automation-reads-event`, profile `eventmodeling` at severity `info`, raised to `warn` under `slicerm`.
- It reports, once per policy statement, a policy triggered by an event that does not read, with `from [...]`, a read model whose sources include that event. Rules with no worker count the same.
- It passes when such a read model is read (form 1), which is exactly when the board draws no implied read model. Policies that start from read models (form 2) or a timer never trigger it.
- Its message names the read model to write and the `from [...]` to read it with.
- The catalogue entry has a passing and a failing example, like every other rule, and `docs/RULES.md` is regenerated.

### Read models

- New statement form: `readmodel Name(params) = [events] => { fields }`. One word, like every other keyword (owner's choice). `read-model` is avoided because lowercase hyphenated words are events.
- `view` keeps working as a short form, with the same meaning.
- Examples, docs, the homepage listings and the app's "Start small" model use `readmodel`.
- The CLI gains a `readmodels` command; `views` keeps working.
- Words people read change from "view" to "read model": board labels and legend, the system diagrams' labels, check messages, CLI help and human-readable output, the app's text, the homepage copy, and the docs (`docs/LANGUAGE.md`, `docs/GLOSSARY.md`, `docs/EVENT-MODELING.md`, `README.md`, `EVENTLINE-AXI.md`).
- Machine-readable output keys stay `views`.
- Rule ids stay as they are (`view-sources`, `unsourced-view-field` and the rest), because models reference them in `@accept(rule=...)`. Rule titles, explanations and fixes change their wording, since `docs/RULES.md` is read by people.
- "State view" stays, on the board and in the `slice` value, because it is Event Modeling's own name for that slice pattern.

### Documenting read models and screens (added by the owner)

"View" means a screen to many Event Modeling practitioners, so the docs say plainly which is which:

- **A read model** is data folded from events: what a screen shows, what a query returns, or a projection no screen shows (`@projection`). It is written with `readmodel` and drawn in the middle row.
- **A screen** is where a person sees a read model or starts a command. eventline writes it as `@trigger(type=ui, name="CartScreen", part="Checkout button")` on a command or a read model, and the board shows it on the arrow from the actor (for a command) or as `read in CartScreen` (for a read model).
- The same distinction covers the other trigger types: an endpoint, a command line tool or an agent is where something is read or started, never a read model itself.

Where this goes:

- a short section, "Read models and screens", in `docs/LANGUAGE.md`, with one example showing a screen that reads a read model and starts a command;
- glossary entries for **Read model** and **Screen** (with "View" pointing to Read model), in `docs/GLOSSARY.md`;
- a vocabulary table in `docs/EVENT-MODELING.md` mapping classic Event Modeling, SliceRM and eventline words: read model / view model / query / view; screen / wireframe / trigger; automation / processor / policy and worker; translation / translator;
- one homepage FAQ answer: "Is a read model a screen?"
- The playground highlighter, the docs grammar (`docs-site/src/code/eventline.tmLanguage.json`), the docs' code-shape check (`docs-site/src/code/eventline-source.mjs`) and the app's autocomplete snippet learn `readmodel`.

### Homepage

The homepage's board image is regenerated, and its description, which mentions the policy lane, is rewritten. Copy that says "views" says "read models". The proof scene's hand-written listing of `twitter-pure.dsl` is updated to match the example, line for line.

## Testing

- Parser: a policy starting `from [...]`, with and without a guard; its trigger shape; `from` without `[` is an error.
- Board: three rows; processors in the actor row; a read-model-started processor placed after its read models with no event or implied node; one implied read model per triggering event, fed by the event and read by the processor; no edge from an event into a command or a processor; the `checks` note, including `(assumed)`.
- Parser: `readmodel` and `view` produce the same model.
- Rule: the catalogue examples, plus the severity under each profile.
- Site: the existing tests, after `node scripts/build-site.js`.
- In a browser: the app and the homepage boards for all four examples, the board tracing, and the links between diagrams.

## Decisions made by the designer

The owner chose the approach, layout B (read models share the command row), "read model" as the name, `readmodel` as the keyword, documenting read models versus screens, both automation forms (event then read model, and read model alone), and that predefined events are a separate step. These were settled during design and can be changed on review:

- Row labels `ACTOR`, `COMMAND · READ MODEL`, `EVENT`.
- One implied read model per triggering event, labelled with the event's name.
- An unnamed `automation` processor for policy rules with no worker.
- `info` under `eventmodeling`, `warn` under `slicerm` for the new check.
- Machine-readable output keys and the library API keep the word `views`.
- Only the event model board changes shape; the system diagrams keep their edges.
- Ids `implied:<event>` and `auto:<policy line>:<rule index>`, with the policies' source lines and no links to other diagrams.
- The new check passes exactly when the board draws no implied read model, and reports once per policy statement.
- Rule ids and the "state view" pattern name stay.

## Left to the builder

- How implied read models and decision-model notes are styled within the existing look.
- Column placement details when several processors or implied read models land in one column.
- The rule's exact message wording.
