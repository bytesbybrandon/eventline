# eventline agent instructions

eventline is a public, MIT-licensed notation for event models, the `eventline-axi` CLI that checks and draws them, and the site and docs that teach both.
Follow the owner's global agent instructions; this file adds only what is specific to this repository.

## Rules

- `main` accepts changes only through pull requests.
- The library path from `lib/index.js` stays pure: no file system or network access, because it is bundled for the browser as `site/eventline.js`.
  Only the CLI side (`lib/commands/`, `lib/folder.js`) may touch files.
- A diagram draws only what the model states; see the "One rule" section of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- The disclosure check in `.github/workflows/ci.yml` scans the site, the docs site and the npm package.
  Never remove it or make it optional.
- Docs use one sentence per line and no em dashes.

## Load context by task

| When you | Read first |
|---|---|
| Change the language or the parser | [docs/LANGUAGE.md](docs/LANGUAGE.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Add or change a validation rule | `lib/rules/catalogue.js`, then run `node scripts/build-rules-doc.js` |
| Change a function in `lib/parser.js`, `lib/rules/` or `lib/diagram/` | [PERFORMANCE-STANDARDS.md](PERFORMANCE-STANDARDS.md) |
| Change a CLI command | [EVENTLINE-AXI.md](EVENTLINE-AXI.md) |
| Add a file to `docs/` | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (it needs a docs site page entry) |
| Anything else | [CONTRIBUTING.md](CONTRIBUTING.md) |

## Verify the affected scope

- `npm test` from the root. CI runs it on every pull request.
- After changing an example, the diagram code or anything in `lib/`: `node scripts/build-site.js`. The site tests fail if you forget.
- After changing a P0 function: `node scripts/bench.js` before and after, and put both tables in the PR.
- After changing docs: run the `docs-steward` skill in maintain mode to refresh `.documentation/project.json`.
