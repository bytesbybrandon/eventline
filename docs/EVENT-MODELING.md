# Event storming, Event Modeling and DCB

Three ideas come up together when people design event-driven systems: event storming, Event Modeling and Dynamic Consistency Boundaries (DCB).
They solve different problems, and they fit together.
This page says what each one is for, and where eventline sits.

## Event storming: finding out what happens

Event storming is a workshop format created by Alberto Brandolini.
People who know different parts of a business put orange sticky notes on a long wall, one for each thing that happens, such as "order placed" or "payment failed".
They add the commands that cause those events, the people involved, and the rules they find along the way.

The result is shared understanding and a list of questions.
It is made to explore a domain quickly, with everyone in the room, and it does not need tools.
It is not meant to be a design you build from.
The notes are loose, they are not strictly ordered, and the wall is usually photographed and left behind.

## Event Modeling: turning that into a design

Event Modeling was developed by Adam Dymitruk, and it grew out of the same family of workshops.
It keeps the idea that a system is a series of events, and it adds what a team needs to build from them.

An Event Modeling board is a timeline, read from left to right:

- **Screens and actors** at the top: who or what starts something.
- **Commands**: the requests an actor makes.
- **Events**: the facts that are recorded as a result.
- **Read models**: what a screen shows, built from events.
- **Automations**: work that starts when an event happens.

Every piece connects to the next one, so a gap shows up as a missing arrow.
A team can work through the board one slice at a time, and each slice is small enough to build and test on its own.
The model is detailed enough to build from, which an event storm usually is not.

Teams often do both.
They storm to find the events and the questions, and then they model to settle the design.
If you have run an event storm and asked "now what do we build from this?", Event Modeling is the usual next step.
The [eventline language](./LANGUAGE.md) writes an Event Modeling board as text.

## How eventline draws the board

`eventline-axi diagram eventmodel` draws the board with three rows, read left to right in time:

| Row | What sits there |
| :--- | :--- |
| `ACTOR` | Actors, timers and processors; a screen or other trigger names the actor's arrow |
| `COMMAND · READ MODEL` | Commands and read models, side by side in time |
| `EVENT` | Events |

- An event never feeds an automation or a command directly on the board.
  An automation reads through a read model, so the board draws one between the event and the processor when the model does not name one.
  That read model is dashed and labelled `implied read model`.
- A command's `on [...]` facts are written on the command as a `checks ...` note, such as `checks item-added*`, and not as arrows.
  A fact nothing in the model records reads `checks cart-opened (assumed)`.
- The dashed arrow means "read model read".

### Words for the same thing

Event Modeling, SliceRM and eventline do not always use the same word.
This table maps them.

| Classic Event Modeling | SliceRM | eventline |
| :--- | :--- | :--- |
| Read model | Read model, labelled "Query" in DCB mode and "View model" in classic mode | `readmodel` (`view` is the short form) |
| Screen | Trigger, the generic element for a screen, endpoint, CLI or agent | `@trigger(type=ui)` |
| Automation | Automation | The board draws a processor; the text writes a policy with a worker |
| Translation | Translator | Translation, with the translator declared in `system` |

Many practitioners say "view" for a screen, which is why eventline says read model for the data and screen for where it is shown.
See [Read models and screens](./LANGUAGE.md#read-models-and-screens).

## DCB: how big a decision is

A system that records events still has to decide which events a command may rely on, and what must not change while it decides.
The classic answer is the aggregate: one object owns a group of events, and a command locks the whole group.

Dynamic Consistency Boundaries, described by Sara Pellegrini and Milan Savic, scope a decision by what it reads instead.
A command names the events that matter to it, by a key such as `userId`.
It checks that nothing relevant to that key has changed, and it records its own events.
Two commands for different keys never contend, and one command can use facts from more than one kind of entity without a fixed aggregate in the way.

In eventline, a command states its boundary with `in Boundary(key)`.
The board draws a bracket around the command and its events.
See [the glossary entry on boundaries](./GLOSSARY.md#boundary-dynamic-consistency-boundary).

## Where eventline fits

| Idea | What it gives you | In eventline |
| :--- | :--- | :--- |
| Event storming | A shared view of the domain | The events and commands you find become the first lines of a model |
| Event Modeling | A blueprint you can build from | Commands, events, read models and policies, drawn as a board by `eventline-axi diagram eventmodel` |
| DCB | A decision scoped by a key | `in Boundary(key)` on a command, bracketed on the board and checked by `validate` |
| System design | A design you can explain and defend | The same model, plus context, containers, data flow and deployment diagrams derived from it |

eventline is a notation and a command line tool.
It does not run your system and it does not replace the workshop.
It gives you a text form of the design, so it can be reviewed, kept in git and checked.

## Where to go next

- If you want to write a first model, read the [language reference](./LANGUAGE.md) and then the [worked examples](./EXAMPLES.md).
- If you are preparing for a system design interview, start with the [thinking guide](./THINKING-GUIDE.md).
- To look up a term, use the [glossary](./GLOSSARY.md).
- Event Modeling itself is described at [eventmodeling.org](https://eventmodeling.org).
