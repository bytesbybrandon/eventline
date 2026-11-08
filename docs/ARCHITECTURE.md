# Architecture

A short map of the code, for people changing it.

## The pipeline

```text
.dsl text  ->  parser  ->  Model  ->  commands (inspect, validate, deps)
                                  ->  diagram builders  ->  svg | mermaid | dot
```

| Piece | File | Job |
| :--- | :--- | :--- |
| Parser | `lib/parser.js` | A recursive-descent parser. Reads statements in any order and reports the line and what it expected. |
| Model | `lib/model.js` | Holds the statements and, after `finalize()`, an event index: who emits each event, who reads it, which facts nobody emits. |
| Commands | `lib/commands/*.js` | One file per CLI command. They read the model and print. |
| Board | `lib/diagram/board.js` | Builds the Event Modeling board: lanes, columns, slices, boundary brackets. |
| System diagrams | `lib/diagram/system.js` | Builds context, containers, data flow, deployment and the context map as one generic graph. |
| Layout | `lib/diagram/layout.js` | Layering shared by the diagrams. Edges that close a loop are set aside, so loops never break placement. |
| Renderers | `lib/diagram/svg.js`, `export.js` | SVG with no dependencies. Mermaid and DOT from the same graph. |
| Library entry | `lib/index.js`, `lib/diagram/index.js` | The public API: `parse`, `check`, `render`. Nothing in this path touches the file system. |

## One rule

A diagram draws only what the model states.

- Facts nobody emits show as a note under the command, not as nodes.
- A command that a policy calls but nobody declared is drawn dashed and marked "not modeled".
- The model does not say which container calls an outside service, so no arrow is drawn into one.
- The deployment view stops with a message when the system has no `region:`, instead of guessing.

If a diagram needs something the model cannot say, change the language, not the diagram.
That is how `in Boundary(key)` came to exist.

## The site

`site/` is the GitHub Pages site and is published by `.github/workflows/pages.yml`.
Its example file and its board image come from the model, so run this after changing an example or the diagram code:

```bash
node scripts/build-site.js
```

`test/site.test.js` fails when the page's counts, DSL listing or board drift from `examples/twitter-pure.dsl`.

## Tests

`npm test` runs the parser, diagram, CLI and site tests with Node's built-in runner.
