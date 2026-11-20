# eventline performance standards

> A model is checked and drawn while you type, so the edit loop must feel instant at the size people really write.

Stack: plain CommonJS on Node 22 with one runtime dependency (`commander`), and the same `lib/` bundled for the browser as `site/eventline.js`.
There is no server, database or cache.
Domain: a developer tool, so the internal-tools tiers apply, with a tighter P0 because the playground and the modeling app run on every edit.

## Tiers

| Tier | Budget | Operations here |
|---|---|---|
| P0 Interactive | < 50 ms at 30 kB of DSL | `parse`, `check` and one `render` together: the playground and app edit loop |
| P1 Responsive | < 300 ms | one CLI command end to end, Node start included (`validate`, `commands`, `deps`, `diagram`) |
| P2 Background | < 2 s | `diagrams` (all six), `node scripts/build-site.js`, `node scripts/build-rules-doc.js` |
| P3 Batch | < 5 min | `npm test`, the docs site build, a CI run |

### Scaling targets for P0

Sizes are copies of `examples/twitter-pure.dsl` (2.7 kB), made by `scripts/bench.js`.

| Size | Budget for parse + check + board |
|---|---|
| 3 kB (one example) | < 5 ms |
| 30 kB (10x) | < 50 ms |
| 130 kB (50x) | < 250 ms |

P0 must stay close to linear in model size: the work per edit grows with the model, never with the square of it.

### Bundle budget

`site/eventline.js` is loaded by the landing page and the app before anything can be checked.
Keep it at or under 60 kB gzip.
It may only grow when `lib/` gains a feature, and the PR says by how much.

## How each budget is measured

| Budget | Command | Notes |
|---|---|---|
| P0 and scaling | `node scripts/bench.js` | Prints parse, check, board and edit loop time at 1x, 10x and 50x, and the bundle size. The check and board columns include a parse; the loop column is the P0 number. |
| P1 | `/usr/bin/time -f %e node bin/eventline-axi validate examples/twitter-pure.dsl` | Take the slowest of three runs. |
| P2 | `/usr/bin/time -f %e node bin/eventline-axi diagrams examples/twitter-pure.dsl -o <dir>` | Same for the two build scripts. |
| P3 | The duration of the CI job | No local command; read it from the workflow run. |
| CC, branch coverage and CRAP per function | `node scripts/measure.js` | Lists every function over its tier's limits, worst CRAP first; `--all` lists every function, `--json` prints JSON, and `--max-cc N` exits 1 above N. It runs ESLint 9 through `npx` and the tests with V8 coverage. |

Timings are not asserted in `npm test`, because shared CI runners make them flaky.
Run the bench before and after a change to `lib/parser.js`, `lib/rules/` or `lib/diagram/`, and put both tables in the PR.

## Complexity budget

- `parse` is one pass over the text: O(n) in characters.
- `check` and `render` index the model once (`Model.finalize()` builds the event index) and then look things up.
  Never rescan every command or event inside a loop over commands, events or boundaries.
- A rule or a diagram builder that needs "all X for this Y" builds a map once per call, not a filter per Y.
- Layout may be superlinear in the nodes of one diagram, but must not be in the size of the whole model.

## Change risk (CRAP)

CRAP(m) = comp(m)² × (1 − cov(m))³ + comp(m), where comp is cyclomatic complexity and cov is branch coverage.

| Tier | Max CC | Min branch coverage | Max CRAP |
|---|---|---|---|
| P0 (`lib/parser.js`, `lib/rules/`, `lib/diagram/`) | 8 | 90% | 10 |
| P1 (`lib/commands/`, `bin/`) | 12 | 80% | 15 |
| P2 (`scripts/`, `lib/folder.js`) | 15 | 70% | 25 |

The hard ceiling is CRAP 30 everywhere, so any function with CC above 30 must be split.
Measure CC, coverage and CRAP per function with `node scripts/measure.js`.
Every rule already needs a test (see [CONTRIBUTING.md](./CONTRIBUTING.md)); a new branch in a rule needs a case in that test.

## Annotation format

Every exported function and every hot-path function carries a budget block in its doc comment.
A function you add or change gets one too; trivial accessors, generated code and test helpers are exempt.

```js
/**
 * Events each command in the boundary emits.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c) where c = commands (derived by reading the code)
 * - Cyclomatic Complexity (CC): 3 measured; target <= 8
 * - Branch Coverage: 95% measured; target >= 90%
 * - CRAP Score: 3.0 measured; threshold <= 10
 * - Caching: none
 */
```

Keep targets apart from measurements: write "measured" only for a value a tool produced, and give the target beside it.
CC comes from ESLint's `complexity` rule and branch coverage from V8 block coverage over `npm test`, counted as c8 counts it; `node scripts/measure.js` produces both, and a value no tool produced is a target.
`scripts/build-site.js` strips these blocks from `site/eventline.js`, so they never grow the bundle.

## Red flags in review

1. `model.commands.filter(...)` or `.find(...)` inside a loop over commands, events, boundaries or policies.
2. A rule that calls a diagram builder per statement instead of once per check.
3. A new runtime dependency, or file system access in the library path from `lib/index.js` (it breaks the browser bundle).
4. A bundle that grows with no feature to show for it.
5. A changed P0 function with no bench numbers in the PR.

## Audit

| Component | Tier | Last measured | Result | Status |
|---|---|---|---|---|
| `parse` | P0 | 2026-11-20 | 0.7 ms at 3 kB, 2 ms at 30 kB, 7 to 9 ms at 130 kB | Pass |
| board (`render` eventmodel) | P0 | 2026-11-20 | 0.7 ms at 3 kB, 10 ms at 30 kB, 130 ms at 130 kB | Pass, superlinear |
| `check` | P0 | 2026-11-20 | 0.5 to 0.6 ms at 3 kB, 2.7 to 3.9 ms at 30 kB, 13 to 16 ms at 130 kB (no `@link`) | Pass |
| edit loop (parse, check, board on one model) | P0 | 2026-11-20 | 0.7 to 0.9 ms at 3 kB, 10 to 11 ms at 30 kB, 142 to 178 ms at 130 kB (no `@link`) | Pass |
| CLI `validate` | P1 | 2026-11-20 | 40 to 70 ms | Pass |
| CLI `diagrams` | P2 | 2026-11-20 | 50 ms | Pass |
| CI build job (`npm test`, docs site build) | P3 | 2026-11-20 | 29 s | Pass |
| `site/eventline.js` | Bundle | 2026-11-20 | 161.7 kB raw, 45.3 kB gzip | Pass |
| Per-function CC and CRAP | All | 2026-11-20 | `node scripts/measure.js`: 647 functions in `lib/` and `scripts/`, 124 over their tier's limits, 5 above CC 30 | Fail: the refactor plan is PR #45 |

Ranges are three runs of `node scripts/bench.js` on Node 22 under WSL2; the CI number is the job duration on a GitHub runner.
`check` builds a diagram only for an `@link` that names it.
`deployment` indexes boundaries by the events they emit, so a model with an `@link` to it checks in 40 to 60 ms at 130 kB.
