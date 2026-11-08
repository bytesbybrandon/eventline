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

# Validate against checklist
npx eventline-axi validate <file>

# Derive diagrams (eventmodel | context | containers | dataflow | deployment)
npx eventline-axi diagram eventmodel <file> -o board.svg
npx eventline-axi diagram containers <file> -f mermaid

# Every diagram, as svg + mermaid + dot, into a folder
npx eventline-axi diagrams <file> -o diagrams
```

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
