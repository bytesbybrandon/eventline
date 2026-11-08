# Contributing

Thanks for helping improve eventline.

## Scope

eventline is a notation for event models, a CLI that checks and draws them, and the documentation that teaches both.
Contributions should stay focused on clarity, correctness and examples.

## Workflow

1. Fork the repo or branch from `main`.
2. Make one focused change.
3. Run `npm test`.
4. Update the docs and examples when syntax or behavior changes.
5. Open a pull request. `main` accepts changes through pull requests only.

## Standards

- Prefer concrete examples over abstract prose.
- Keep the examples in `examples/` valid: `npx eventline-axi validate examples/<file>` should report no errors.
- Keep the README, `docs/LANGUAGE.md` and `docs/EXAMPLES.md` consistent with the examples they quote.
- After changing an example or the diagram code, run `node scripts/build-site.js`. The site tests fail if you forget.
- Write documentation with one sentence per line.
- Keep local machine paths, secrets and session artifacts out of the repo.

## Where things are

[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) maps the code.
[docs/README.md](./docs/README.md) maps the documentation.

## Pull requests

Include a short summary of what changed, why, and which examples or docs you updated.
