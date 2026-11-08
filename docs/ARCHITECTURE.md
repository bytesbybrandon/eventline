# Architecture

A short map of the code, for people changing it.

## The pipeline

```text
.dsl text  ->  parser  ->  Model  ->  commands (inspect, validate, deps, triggers, scenarios)
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
Its example file, its board image and the playground's bundle come from the model, so run this after changing an example, the diagram code or anything in `lib/`:

```bash
node scripts/build-site.js
```

The playground on the landing page runs `site/eventline.js`, which is `lib/index.js` bundled for the browser, so it uses the same parser, checks and board renderer as the CLI.
The board SVG tags every node and edge with `data-id`, `data-from` and `data-to`, which the page uses to light a box's lineage.
Command, view and policy nodes also carry `data-lines`, the source lines the parser recorded (`line` to `endLine`), so a click on a box finds its text in the playground editor and the caret finds its box.
`test/site.test.js` fails when the page's counts, DSL listing, board, bundle or example copies drift from `examples/`.
A model can be shared as `/eventline/#play=<base64url of the text>`; the docs use the same link.

## The docs site

`docs-site/` builds the documentation site at `/eventline/docs/` with Astro Starlight.
The Markdown in `docs/`, `EVENTLINE-AXI.md` and `CONTRIBUTING.md` stays the source.
`docs-site/scripts/sync-docs.mjs` turns it into Starlight pages when the site builds:
it takes the title from the first heading, turns links between docs into site routes, tags code blocks that hold eventline source so they are highlighted, and renders the diagrams derived from `examples/billing.dsl`.
A block that parses as a model with a command, view or policy also gets an Open in playground link.
Nothing it writes is committed.
The build fails on a broken link between pages.
`.github/workflows/pages.yml` builds the docs next to the landing page and deploys both as one Pages artifact.

To preview locally, run `npm ci && npm run build` in `docs-site/` and serve `dist/` under `/eventline/docs/`.
A new file in `docs/` needs an entry in `PAGES` in the sync script and in the sidebar in `docs-site/astro.config.mjs`. `test/docs-site.test.js` fails if either is missing.

## Tests

`npm test` runs the parser, diagram, CLI and site tests with Node's built-in runner.
