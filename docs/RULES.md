# Validation rules

`eventline-axi validate` checks a model against these rules, and `check(model, { profile })` does the same in code.
Each finding says what is wrong, where, and why it matters.

## Profiles

| Profile | Includes | Use it when |
| :--- | :--- | :--- |
| `core` (default) | the language rules | You want to know the file is sound |
| `workshop` | core, plus the guidelines, all as info | You are still exploring and want hints, not warnings |
| `eventmodeling` | core, plus the guidelines | You are designing a system and want the method checked |
| `slicerm` | eventmodeling, stricter | A slice is a unit of delivery that someone plans and builds |

```bash
npx -y eventline-axi validate model.dsl --profile eventmodeling
npx -y eventline-axi rules --profile slicerm
```

## What a finding holds

| Field | Meaning |
| :--- | :--- |
| `severity` | `error` cannot mean what it says, `warn` is almost always a mistake, `info` is worth a second look |
| `rule`, `category`, `profile` | which rule, what kind of problem, and which profile it belongs to |
| `line`, `endLine` | where it starts and ends in the file |
| `subject` | the command, view, policy or boundary it is about, with its own `line` and `endLine` |
| `slice` | the `@slice` name of that statement, when it has one |
| `docs` | the link to this page |

## Categories

| Category | What it covers |
| :--- | :--- |
| `structure` | A statement is missing something it needs |
| `order` | Things depend on each other in a way no order can satisfy |
| `boundary` | Consistency scopes and the edges between contexts |
| `fields` | Information that appears from nowhere |
| `references` | A name points at something that is not there |
| `naming` | Names that break the project convention |
| `routes` | How triggers reach commands and views |
| `schedule` | When timers fire |
| `scenarios` | Given, when, then examples |
| `triggers` | What a person or system uses to reach a command or view |
| `links` | Links between diagrams |
| `slices` | What belongs together in one unit of delivery |
| `hints` | Allowed, but often worth a second look |

## Core rules

These are always on.
They report a language that is wrong or inconsistent: a statement that cannot mean what it says.

### on-facts

**A view listed in on [...].**
Severity: error.
Category: references.

on [...] lists the events a command needs.
A view is read with from [...], not on.

How to fix it: Move the view to from [...], or list the event the view is built from.

### from-facts

**Reads a view that is not declared.**
Severity: warn.
Category: references.

from [...] names a view that no view statement defines, so nothing says what it holds.

How to fix it: Declare the view, or fix the name.

### unknown-boundary

**Command is in a boundary that is not declared.**
Severity: error.
Category: boundary.

in Name(key) scopes a command to a boundary, and no boundary statement defines it.

How to fix it: Add boundary Name(key), or fix the name.

### view-from-view

**A view projects from a view.**
Severity: error.
Category: references.

Views are folds over events.
A view cannot be built from another view.

How to fix it: List the events the second view needs, not the view.

### view-sources

**A view has no source events.**
Severity: warn.
Category: structure.

A view with no events folds nothing.

How to fix it: List the events it projects from between the brackets.

### no-events

**A command never records an event.**
Severity: warn.
Category: structure.

Every command records at least one event on its happy path, or nothing happened.

How to fix it: Add events to the --[default]--> branch.

### missing-default

**A command has no default branch.**
Severity: warn.
Category: structure.

The default branch is the happy path.
Without it a reader cannot tell what success looks like.

How to fix it: Add --[default]--> [ ... ] as the last branch.

### default-rejects

**The default branch refuses.**
Severity: warn.
Category: structure.

The default branch should record events.
A refusal belongs on a guarded branch.

How to fix it: Put the refusal on a --[guard]--> reject CODE branch.

### rejection-as-event

**A rejection written as an event.**
Severity: info.
Category: structure.

An event named ...-rejected usually means nothing was recorded, and then it is a refusal, not an event.

How to fix it: Write --[guard]--> reject CODE when nothing is recorded.

### optional-on

**An on fact marked optional.**
Severity: warn.
Category: references.

Only from [...] reads can come back empty.
A fact in on [...] must have happened.

How to fix it: Move it to from [...] or drop @optional.

### command-inputs

**A command lists no facts it needs.**
Severity: info.
Category: structure.

Fine for a command that starts something.
Worth a look for one that should depend on what happened before.

How to fix it: Add on [...] or from [...], or leave it if the command creates something.

### command-boundary

**A command does not say which boundary it is in.**
Severity: info.
Category: boundary.

When the model has boundaries, each command should say which one its decision is scoped to.

How to fix it: Add in BoundaryName(key).

### boundaries

**No boundary declared.**
Severity: info.
Category: boundary.

Commands have no stated consistency scope.

How to fix it: Add boundary Name(key) and put commands in it.

### unknown-actor

**A command actor is not declared.**
Severity: info.
Category: references.

The actor is neither a declared actor nor a system external.

How to fix it: Declare it with actor Name { ... } or list it under external in the system block.

### freshness

**A view is read without a freshness stance.**
Severity: info.
Category: references.

A command that reads a view decides on something that may be stale.

How to fix it: Add @fresh<10s>, @eventual or @strong to the fact.

### policy-guard

**A policy rule has no guard.**
Severity: info.
Category: structure.

An event-triggered rule with no guard runs on every occurrence.

How to fix it: Add --[condition]--> or leave it if that is intended.

### unpublished-event

**An event crosses a context without being published.**
Severity: warn.
Category: boundary.

A context reads an event another context records but does not list in publishes.

How to fix it: Add the event to publishes of the context that records it, or stop reading it.

### assumed-events

**Events nothing records.**
Severity: info.
Category: references.

No command or policy records these, so the model assumes the facts exist.

How to fix it: Fine for facts from outside.
Otherwise add the command that records them.

### event-naming

**An event name breaks the convention.**
Severity: warn.
Category: naming.

The system block sets event-naming (kebab or pascal) and this event does not follow it.

How to fix it: Rename the event, or set event-naming: none.

### query-returns

**@query returns is not one, list or page.**
Severity: warn.
Category: structure.

The cardinality of a query has three values.

How to fix it: Use returns=one, list or page.

### projection-trigger

**A projection with a trigger.**
Severity: warn.
Category: triggers.

A @projection is never shown, so nothing reaches it through a screen or endpoint.

How to fix it: Remove @trigger or @projection.

### source-system

**@source has no system.**
Severity: warn.
Category: structure.

A translation says where it comes from.

How to fix it: Add system="Name" to @source.

### command-trigger

**A command does not say what is used to reach it.**
Severity: info.
Category: triggers.

Other commands in the model say.
This one does not, and no policy calls it.

How to fix it: Add @trigger(type=ui, name="...").

### trigger-name

**A trigger has no name.**
Severity: warn.
Category: triggers.

A @trigger names the screen, endpoint, command or agent.

How to fix it: Add name="..."

### trigger-type

**A trigger has an unknown type.**
Severity: warn.
Category: triggers.

Types are ui, endpoint, cli and agent.

How to fix it: Use one of them.

### trigger-route

**A trigger route is not METHOD /path.**
Severity: warn.
Category: routes.

Only ui and endpoint triggers have a route, written as METHOD /path.

How to fix it: Write route="POST /audits/{id}/fail", or drop it.

### scenario-name

**A scenario has no name.**
Severity: warn.
Category: scenarios.

Names make scenarios findable.

How to fix it: Name it: scenario "name" {

### scenario-empty

**A scenario has no lines.**
Severity: warn.
Category: scenarios.

An empty scenario checks nothing.

How to fix it: Add its Given, When and Then lines.

### scenario-duplicate

**Two scenarios share a name under one command or view.**
Severity: warn.
Category: scenarios.

Names must tell scenarios apart.

How to fix it: Rename one.

### link-target

**An @link cannot work.**
Severity: warn.
Category: links.

It names a diagram or box that is not there, or none at all, or a diagram this model cannot draw yet.

How to fix it: Check to= and node= against the diagram.

### link-url

**An @link url is not an address.**
Severity: warn.
Category: links.

A url is an http(s) address or a path.

How to fix it: Write https://... or a path.

### schedule-invalid

**A timer cannot fire.**
Severity: warn.
Category: schedule.

An interval needs a whole number above zero.
A cron expression has five fields, each in range.

How to fix it: Write every 5 minutes, or cron "0 9 * * 1" (minute hour day-of-month month day-of-week).

Instead of:

```text
every 0 minutes
  -> reminder -> sendReminder()
```

write:

```text
every 5 minutes
  -> reminder -> sendReminder()
```

### accept-invalid

**An @accept that cannot work.**
Severity: warn.
Category: structure.

An @accept says the team knowingly keeps something a rule reports, and why.
It needs rule="..." naming a rule in the catalogue, and a reason.

How to fix it: Write @accept(rule="many-events", reason="One fact told in two parts").

### accept-unused

**An @accept that accepts nothing.**
Severity: info.
Category: hints.

The rule it names reports nothing on this statement, so the acceptance is out of date or on the wrong statement.

How to fix it: Remove it, or move it to the statement the rule reports on.

### hotspot-invalid

**A @hotspot that cannot work.**
Severity: warn.
Category: structure.

A hotspot is an open question: @hotspot("text") with an optional kind (question, assumption, request), category (action, data, next, rule, example, view, who, time) and status (open, resolved).
A request says what must change with concerns="...".

How to fix it: Write @hotspot("Does the guest lose the deposit?", kind=assumption, category=rule).

## Event Modeling rules

These apply the Event Modeling guidelines.
Turn them on with `--profile eventmodeling`.
They check that information has a source, that work has an order, and that a slice holds what a slice should.

### hotspot-open

**A hotspot is still open.**
Severity: info.
Category: hints.

Someone wrote down something the model does not answer yet.

How to fix it: Answer it in the model, then set status=resolved, or keep it as a known gap.

### unsourced-event-field

**An event carries a field nothing supplies.**
Severity: warn.
Category: fields.

Information flows one way.
An event can only hold what its command was given: its parameters, the boundary key, the facts it needs, or a value it computes.

How to fix it: Add the field to the command, to a fact it needs, or compute it with name: expression.

Instead of:

```text
user -> addItem(cartId) in Cart(cartId)
  --[default]--> [item-added { cartId, sku }]
```

write:

```text
user -> addItem(cartId, sku) in Cart(cartId)
  --[default]--> [item-added { cartId, sku }]
```

### unsourced-view-field

**A view shows a field no event carries.**
Severity: warn.
Category: fields.

A view is a fold over events, so every plain field must be in the payload of an event it projects from.
Computed fields are exempt.

How to fix it: Add the field to an event it reads, or compute it, as in total: count(order-placed*(id)).

Instead of:

```text
user -> addItem(cartId, sku)
  --[default]--> [item-added { cartId, sku }]
view Cart(cartId) = [item-added*(cartId)] => { cartId, total }
```

write:

```text
user -> addItem(cartId, sku)
  --[default]--> [item-added { cartId, sku }]
view Cart(cartId) = [item-added*(cartId)] => { cartId, items: count(item-added*(cartId)) }
```

### dependency-cycle

**Commands depend on each other in a loop.**
Severity: warn.
Category: order.

Commands wait for events that others record.
If they wait on each other in a loop, no order of work can start.
A command that reads events it records itself is fine: that is how a decision checks what already happened.

How to fix it: Break the loop with an event that does not depend on the others, or mark one fact as coming from outside.

### slice-multiple-commands

**One slice holds several commands.**
Severity: warn.
Category: slices.

A write slice has one command.
A command can record several events.
Two commands are two slices.

How to fix it: Give each command its own @slice name.

### slice-multiple-views

**One slice defines several read models.**
Severity: info, warn with `--profile slicerm`.
Category: slices.

A slice owns one query.
Several read models in one slice invite several queries where one shaped for the reader would do.
Reading views that other slices define is always fine.

How to fix it: Fold them into one view shaped for how it is read, or give each its own @slice.

### slice-no-scenario

**Commands and views have no scenario.**
Severity: info.
Category: scenarios.

A slice is specified with a given, when, then example.
This counts the commands and views that have none.
Models that keep scenarios elsewhere can ignore it.

How to fix it: Add scenario "name" { ... } under the command or view.

### translation-no-dedupe

**An outside fact has no deduplication key.**
Severity: info.
Category: fields.

A command issued by an outside system is a fact someone else recorded.
It can be delivered twice, so the model says which field tells a repeat from a new one. @dedupe names it, and @correlate names the field that ties the fact to something here.
Both count as supplying that field to the events and views that carry it.

How to fix it: Add @dedupe(eventId) to the command, view or policy that consumes the fact.

Instead of:

```text
system S { external: carrier (translator) }
carrier -> scanReceived(parcelId)
  --[default]--> [parcel-scanned { parcelId }]
```

write:

```text
system S { external: carrier (translator) }
carrier -> scanReceived(parcelId) @dedupe(scanId)
  --[default]--> [parcel-scanned { parcelId, scanId }]
```

### many-events

**A happy path records several events.**
Severity: info.
Category: hints.

Right when they are one fact told in parts.
If they are two steps, a policy can take the second.

How to fix it: Keep them if they are one fact, otherwise split the second into a policy.

### view-many-sources

**Four or more events feed one view.**
Severity: info.
Category: hints.

Combining streams is fine, but each event ties the view to the command that records it, so fewer is easier to change.

How to fix it: Check that every source is needed.

## Stricter rules

These are for tools where a slice is one unit of delivery, such as SliceRM.
Turn them on with `--profile slicerm`, which includes the Event Modeling rules.
The profile also raises a few Event Modeling rules from a hint to a warning.

### rejection-uncovered

**A rejection code has no scenario.**
Severity: warn.
Category: scenarios.

Each way a command can refuse is a behaviour to specify.
Only checked when the model has scenarios at all.

How to fix it: Add a scenario whose text names the code.

### route-duplicate

**Two commands or views share a method and route.**
Severity: warn.
Category: routes.

One route in one context should reach one thing.
Two triggers reaching the same command are fine.

How to fix it: Give one of them its own route.
