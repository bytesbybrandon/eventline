# eventline-axi

Agent-ergonomic CLI for the System Design DSL (`eventline`).

Reads `.dsl` files and exposes actors, commands, views, boundaries, policies, and events as structured TOON output optimized for LLM agents.
It also derives Event Modeling and system diagrams from a model.

## Install

```bash
npm install
```

## Usage

```bash
# Home view (overview)
npx eventline-axi examples/twitter-pure.dsl

# Parse structure
npx eventline-axi parse examples/twitter-pure.dsl

# List entities
npx eventline-axi actors <file>
npx eventline-axi commands <file>
npx eventline-axi events <file>
npx eventline-axi views <file>
npx eventline-axi boundaries <file>
npx eventline-axi policies <file>

# Trace dependencies
npx eventline-axi deps <file> <entity>

# Validate against checklist (core), or the Event Modeling guidelines, or the stricter set
npx eventline-axi validate <file>
npx eventline-axi validate <file> --profile eventmodeling
npx eventline-axi validate <file> --profile slicerm

# Every rule, with why and how to fix it
npx eventline-axi rules

# What screens, endpoints and other triggers people and systems use
npx eventline-axi triggers <file>

# Derive diagrams (eventmodel | context | containers | dataflow | deployment | contextmap)
npx eventline-axi diagram eventmodel <file> -o board.svg
npx eventline-axi diagram containers <file> -f mermaid

# Every diagram, as svg + mermaid + dot, into a folder
npx eventline-axi diagrams <file> -o diagrams
```

## A model in several files

Every command that takes a file also takes a folder.
A folder model is every `.dsl` file directly in it, read as one model: references resolve across files, so you can split a model whenever it grows and move statements between files without rewriting anything.
There is no `include`, subfolders and dot files are ignored, and findings and parse errors name the file and the line inside it.

```bash
npx eventline-axi validate model/ --profile eventmodeling
```

## Derived diagrams

The notation is enough to draw the system.
`eventline-axi` reads a model and derives the diagrams, so they never drift from the file.

```bash
npx eventline-axi diagram eventmodel examples/twitter-pure.dsl -o board.svg
npx eventline-axi diagrams examples/twitter-pure.dsl -o diagrams
```

| Diagram | Shows | Comes from |
| :--- | :--- | :--- |
| `eventmodel` | The Event Modeling board: actor, command, event, view and policy lanes, with consistency boundaries bracketed | commands, events, views, policies, `in Boundary(key)` |
| `context` | The system, who uses it, and what it depends on | `actor`, `system { external }`, commands per actor |
| `containers` | Command API, event store, read models, workers, outside systems | commands, `@partition`, views and `@cache`, policy workers |
| `dataflow` | Commands and workers as processes, the event log and views as stores | the same, drawn as flows |
| `deployment` | Each region with its shards, read models and workers | `system { region }`, boundaries, `@cost(regions=n)` |
| `contextmap` | Contexts as boxes and the events that cross between them; dashed means the sender does not publish the event | `context` blocks, `publishes` |

Each diagram is available as `svg`, `mermaid` or `dot` (`-f`), and `-t dark` gives a dark theme.

`--links` makes the diagrams navigable: each box that leads somewhere links to the same thing in another diagram, as `<diagram>.<ext>#<box>` beside the file.
`diagrams <file> --links` writes the whole set so the links resolve, and `--link-base` puts a prefix in front of every link, such as a site path.
SVG boxes carry an arrow badge per target, Mermaid gets `click` lines and DOT gets `URL` attributes (those two link once).
The links come from the model; `@link` on a command, view, policy or boundary overrides them (see the language reference).
Links in an SVG work when it is opened directly or inlined in a page, not inside an `<img>` tag.

Order on the board comes from causality, because a model has no clock.
A command sits after the commands whose events or views it reads.
A view sits right of the events that feed it, and a worker right of the event that wakes it.

The diagrams only draw what the model says.
Facts nobody emits show as a note under the command.
A command a policy calls but nobody declared is drawn dashed and marked "not modeled".
The model does not say which container calls an outside service, so no arrow is drawn into one.
The deployment view needs `region:` in the system block and assumes each region runs the whole stack unless a boundary says `@cost(regions=n)`.

## Use as a library

```js
import { parse, check, render, linkMap, ParseError, KINDS } from 'eventline-axi';

const model = parse(text);              // throws ParseError with .line on bad input
const issues = check(model);            // same rules as `validate`; check(model, { profile: 'eventmodeling' }) adds the guidelines
const svg = render(model, 'contextmap'); // kinds: KINDS; formats: svg (default), mermaid, dot
const linked = render(model, 'containers', 'svg', 'dark', { links: true }); // linkBase, href(target) tune the addresses
const map = linkMap(model); // { diagram: { boxId: [{ diagram, node, label, url }] } }
```

Each finding from `check` has `severity`, `rule`, `category`, `profile`, `message`, `line`, `endLine`, `subject` (the command, view, policy or boundary it is about, with its own `line` and `endLine`), `slice` (its `@slice` name) and `docs`.
A tool can show a finding next to the right slice without mapping lines itself.
The rules and profiles are in [RULES.md](./docs/RULES.md).

These are pure functions with no I/O, no Node built-ins and no dependencies, so they bundle for a browser.
`render` throws an error with `code` `NO_REGIONS` or `NO_CONTEXTS` when there is nothing to draw.

## Output Formats

- `toon` (default) - Token-efficient structured output
- `json` - Full JSON
- `text` - Human-readable text

```bash
npx eventline-axi actors examples/twitter-pure.dsl -f json
```

## Design Principles

Follows the [AXI](http://axi.md) 10 principles for agent-ergonomic CLI:
- Token-efficient TOON output
- Minimal default schemas (3-4 fields)
- Pre-computed aggregates (counts)
- Definitive empty states
- Contextual disclosure (next-step hints)
- Content-first home view
