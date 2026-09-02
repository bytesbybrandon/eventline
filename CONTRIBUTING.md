# Contributing

Thanks for helping improve Eventline.

## Scope

This repo is a lightweight reference and explainer for an event-modeling DSL. Contributions should stay focused on clarity, correctness, and examples.

## Workflow

1. Fork or branch from the main branch.
2. Make a focused change.
3. Update docs or examples when behavior or syntax changes.
4. Validate the repo hygiene checks and review the diff.

## Standards

- Prefer clear, concrete examples over abstract prose.
- Preserve the event-modeling semantics and naming conventions.
- Keep examples consistent across README, ADR docs, and the HTML explainer.
- Avoid leaking local machine paths, secrets, or session artifacts.

## Pull requests

Include a brief summary of:

- what changed,
- why it changed,
- any examples or docs updated.

## Local checks

Use the repo hygiene scan before opening a PR:

```bash
node ~/.agents/skills/public-repo-prep/scripts/scan-repo.js
```
