# Classic Board and Read Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the event model board in the classic Event Modeling shape (three rows, processors with actors, implied read models, decision models on commands), add `readmodel` and read-model-started automations, and rename views to read models wherever people read the word.

**Architecture:** The parser gains two statement forms. `lib/diagram/board.js` changes its rows and nodes, and `lib/diagram/svg.js` draws them. A new rule joins the `eventmodeling` profile. Words change across `lib/`, `bin/`, `site/`, `docs-site/` and `docs/`, while ids, API names and output keys stay.

**Tech Stack:** Plain JavaScript (CommonJS) in `lib/` and `bin/`, static `site/`, Astro Starlight in `docs-site/`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-19-classic-board-design.md`

## Global Constraints

- No model that parses today may stop parsing. Writing a model never takes more typing than today.
- `lib/` stays pure and dependency-free.
- Library API names (`model.views`, `model.policies`, `ParsedView`), node ids (`view:`, `pol:`, `cmd:`, `evt:`), JSON and toon output keys, rule ids, the `@projection` annotation and the `from [...]` syntax keep their names.
- "State view" stays as the slice pattern name, on the board and in `slice` values.
- Words people read say "read model", not "view".
- New ids: `implied:<event>` for implied read models, `auto:<policy line>:<rule index>` for unnamed processors.
- New rule `automation-reads-event`: profile `eventmodeling`, severity `info`, `slicerm` severity `warn`.
- Row labels: `ACTOR`, `COMMAND · READ MODEL`, `EVENT`.
- After any change to `lib/` or `examples/`, run `node scripts/build-site.js`. After a catalogue change, run `node scripts/build-rules-doc.js`.
- `npm test` passes at the end of every task. Baseline: 226.

## Review Focus

1. A policy triggered by an event nothing records: the event is drawn as assumed, and the implied read model still sits between it and the processor (test in Task 2).
2. Two policies triggered by one event share a single implied read model, and a policy that reads a read model fed by its trigger gets none (test in Task 2).
3. `readmodel` and `view` mixed in one model, and an actor named `readmodel` or `from` issuing a command, still parse as before (test in Task 1).
4. A policy starting `from [X]` where `X` is not declared: the read model is drawn as not declared and the processor still sits after it (test in Task 2).
5. Click-to-source and tracing: implied read models and unnamed processors carry their policy's source lines in the SVG, and `pol:` nodes still link to the containers diagram (test in Task 3).

---

### Task 1: Parser: `readmodel` and read-model-started policies

**Files:**
- Modify: `lib/parser.js` (`parseOne` around lines 524-566, `parsePolicy` around 400)
- Test: `test/parser.test.js`

**Interfaces:**
- Produces: `readmodel Name(params) = [...] => {...}` parses exactly like `view`. A statement starting `from [...]` parses as a policy with `trigger = { event: null, schedule: null, readModels: true, fields: [] }` and `policy.from` holding the read models. Every other trigger gains `readModels: false`.

- [ ] **Step 1: Write the failing tests**

```js
test('readmodel is the keyword for a read model, and view still works', () => {
  const a = parse('readmodel Cart(cartId) = [item-added*(cartId)] => { items: count(item-added*(cartId)) }');
  const b = parse('view Cart(cartId) = [item-added*(cartId)] => { items: count(item-added*(cartId)) }');
  assert.deepEqual(a.views.map(({ line, endLine, ...v }) => v), b.views.map(({ line, endLine, ...v }) => v));
  const mixed = parse('view A(id) = [x-happened*(id)] => { n: count(x-happened*(id)) }\nreadmodel B(id) = [x-happened*(id)] => { n: count(x-happened*(id)) }');
  assert.deepEqual(mixed.views.map((v) => v.name), ['A', 'B']);
});
test('an actor called readmodel or from still issues commands', () => {
  assert.equal(parse('readmodel -> refresh(id)\n  --[default]--> [x-refreshed { id }]').commands[0].actor, 'readmodel');
  assert.equal(parse('from -> send(id)\n  --[default]--> [x-sent { id }]').commands[0].actor, 'from');
});
test('a policy can start from read models alone', () => {
  const m = parse('from [OrdersToShip] -> fulfilment-worker -> shipOrder(cartId)');
  assert.deepEqual(m.policies[0].trigger, { event: null, schedule: null, readModels: true, fields: [] });
  assert.deepEqual(m.policies[0].from.map((f) => f.name), ['OrdersToShip']);
  assert.equal(m.policies[0].rules[0].worker, 'fulfilment-worker');
  const g = parse('from [OrdersToShip] --[ready]--> fulfilment-worker -> shipOrder(cartId)');
  assert.equal(g.policies[0].rules[0].guard, 'ready');
});
test('event and timer triggers say they do not start from read models', () => {
  assert.equal(parse('x-happened { id } -> w -> go(id)').policies[0].trigger.readModels, false);
  assert.equal(parse('every 5 minutes -> w -> go()').policies[0].trigger.readModels, false);
});
test('from without a list is an error that shows both automation forms', () => {
  assert.throws(() => parse('from OrdersToShip -> w -> go()'), /from \[/);
  assert.throws(() => parse('nonsense'), /readmodel/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/parser.test.js`
Expected: FAIL. `readmodel` and `from [` are "Unexpected".

- [ ] **Step 3: Implement in `lib/parser.js`**

In `parseOne`, treat `word === 'readmodel'` followed by an identifier like `view`. Treat `word === 'from'` followed by `[` (after whitespace) as `parsePolicy(sc, model, { event: null, schedule: null, readModels: true, fields: [] }, line)`, with the cursor left on `from` so `parsePolicy` reads the list through its existing `keywordBracket('from')` branch. `from` followed by anything else that is not `->` throws `ParseError` with both forms, for example `An automation reads read models: write from [ReadModel] -> worker -> command(), or event from [ReadModel] -> worker -> command()`. Add `readModels: false` to the event and timer triggers. Mention `readmodel` and `from [...]` in the "A statement starts with" error. The policy error text `on "${trigger.event}"` gains a read-model case.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/parser.test.js` then `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/parser.js test/parser.test.js
git commit -m "Add readmodel and automations that start from read models"
```

---

### Task 2: Board: three rows, processors, implied read models, decision models

**Files:**
- Modify: `lib/diagram/board.js`
- Test: `test/diagram.test.js` (update the tests at lines 48-63), `test/syntax.test.js` (the timer board test at line 97 if it asserts lanes)

**Interfaces:**
- Consumes: the trigger shape from Task 1.
- Produces: `LANES = ['actor', 'command', 'event']` and `LANE_LABELS = { actor: 'ACTOR', command: 'COMMAND · READ MODEL', event: 'EVENT' }`, both exported. Read model nodes have `lane: 'command'`, `kind: 'view'`. Processor nodes have `lane: 'actor'`, `kind: 'policy'`. Implied read models: `{ id: 'implied:<event>', lane: 'command', kind: 'view', implied: true, label: '<event>', sub: 'implied read model', ranges }`. Unnamed processors: `{ id: 'auto:<policy line>:<rule index>', lane: 'actor', kind: 'policy', label: 'automation', ranges }`. Commands have `checks: string[]` and a note `checks a, b* (assumed)`. No edge has `kind: 'given'`.

- [ ] **Step 1: Write the failing tests**

```js
test('board: three rows, with read models beside commands and processors beside actors', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  assert.deepEqual(LANES, ['actor', 'command', 'event']);
  assert.equal(LANE_LABELS.command, 'COMMAND · READ MODEL');
  assert.equal(byId(b, 'view:TweetDetails').lane, 'command');
  assert.equal(byId(b, 'pol:notification-worker').lane, 'actor');
});
test('board: an event reaches an automation only through a read model', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  const imp = byId(b, 'implied:tweet-liked');
  assert.equal(imp.implied, true); assert.equal(imp.sub, 'implied read model');
  assert.ok(b.edges.some((e) => e.from === 'evt:tweet-liked' && e.to === imp.id && e.kind === 'projects'));
  assert.ok(b.edges.some((e) => e.from === imp.id && e.to === 'pol:notification-worker' && e.kind === 'reads'));
  const into = (id) => id.startsWith('pol:') || id.startsWith('auto:') || id.startsWith('cmd:');
  for (const e of b.edges) assert.ok(!(e.from.startsWith('evt:') && into(e.to)), `${e.from} -> ${e.to}`);
});
test('board: two policies on one event share an implied read model; reading a read model fed by the trigger needs none', () => {
  const two = buildBoard(parse('x-happened { id } -> a-worker -> goA(id)\nx-happened { id } -> b-worker -> goB(id)'));
  assert.equal(two.nodes.filter((n) => n.id.startsWith('implied:')).length, 1);
  const read = buildBoard(parse('user -> start(id)\n  --[default]--> [x-happened { id }]\nreadmodel Todo(id) = [x-happened*(id)] => { id }\nx-happened from [Todo] -> w -> go(id)'));
  assert.equal(read.nodes.some((n) => n.id.startsWith('implied:')), false);
  assert.ok(read.edges.some((e) => e.from === 'view:Todo' && e.to === 'pol:w'));
});
test('board: an event nobody records still reaches its automation through an implied read model', () => {
  const b = buildBoard(parse('ghost-seen { id } -> w -> go(id)'));
  assert.equal(byId(b, 'evt:ghost-seen').assumed, true);
  assert.ok(byId(b, 'implied:ghost-seen'));
});
test('board: an automation that starts from read models sits after them, with no event', () => {
  const b = buildBoard(parse('from [OrdersToShip] -> fulfilment-worker -> shipOrder(cartId)'));
  const w = byId(b, 'pol:fulfilment-worker'); const v = byId(b, 'view:OrdersToShip');
  assert.equal(v.sub, 'not declared'); assert.ok(w.col > v.col);
  assert.equal(b.nodes.some((n) => n.id.startsWith('implied:') || n.id.startsWith('evt:')), false);
});
test('board: a rule with no worker gets its own unnamed processor', () => {
  const b = buildBoard(parse('x-happened { id }\n  --[a]--> [y-happened { id }]\n  --[b]--> [z-happened { id }]'));
  const autos = b.nodes.filter((n) => n.id.startsWith('auto:'));
  assert.equal(autos.length, 2); assert.equal(autos[0].label, 'automation'); assert.equal(autos[0].lane, 'actor');
});
test('board: a command shows its decision model instead of arrows from events', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  assert.equal(b.edges.some((e) => e.kind === 'given'), false);
  assert.match(byId(b, 'cmd:likeTweet').notes.join(' '), /checks .*tweet-exists \(assumed\)/);
});
```

Update the existing tests at `test/diagram.test.js:48` and `:58` to the new shapes: the worker sits right of the implied read model, and the `assumes` note becomes `checks ... (assumed)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/diagram.test.js`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement in `lib/diagram/board.js`**

Put read models in the `command` lane, using `free('command', ...)` so they interleave with commands in time. Put workers, timers and unnamed processors in the `actor` lane. For an event-triggered policy, reuse a `from` read model whose `sources` include the trigger event when there is one; otherwise create or reuse `implied:<event>` in the `command` lane right of the event, with `projects` from the event and `reads` into the processor. Place the processor right of whatever it reads. For a `readModels` trigger, place the processor right of the latest read model in `pol.from`. Replace the `given` edges and the `assumes` note with `checks` (all `on` facts, starred when the fact is starred, `(assumed)` after ones nothing records). Keep `orderCommands` as it is. Update the header comment to describe the three rows.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/diagram.test.js test/syntax.test.js` then `npm test`
Expected: all pass. `test/site.test.js` will fail on the stale homepage board until Task 6 rebuilds it; that is expected here, and only that test may fail.

- [ ] **Step 5: Commit**

```bash
git add lib/diagram/board.js test/diagram.test.js test/syntax.test.js
git commit -m "Draw the event model board in the classic three-row shape"
```

---

### Task 3: SVG drawing of the new board

**Files:**
- Modify: `lib/diagram/svg.js` (lane labels at :170-173, node styles at :48-60, legend at :222, description at :233-234), `lib/diagram/board.js` (`boardToGraph` edge styles)
- Test: `test/diagram.test.js`

**Interfaces:**
- Consumes: `LANES`, `LANE_LABELS` and the node shapes from Task 2.

- [ ] **Step 1: Write the failing tests**

```js
test('board svg: row labels, implied read models drawn dashed, and source lines on new nodes', () => {
  const svg = render(load('twitter-pure.dsl'), 'eventmodel', 'svg', 'dark');
  for (const l of ['ACTOR', 'COMMAND · READ MODEL', 'EVENT']) assert.ok(svg.includes(`>${l}<`), l);
  assert.ok(!/>POLICY<|>VIEW</.test(svg));
  const imp = svg.slice(svg.indexOf('data-id="implied:tweet-liked"'), svg.indexOf('data-id="implied:tweet-liked"') + 400);
  assert.match(imp, /data-lines="\d+-\d+"/); assert.match(imp, /stroke-dasharray/);
  assert.match(svg, /implied read model/); assert.match(svg, /read model/);
  assert.ok(!/fact or view the command reads/.test(svg));
});
test('board links: a processor still links to its worker in the containers diagram', () => {
  const svg = render(load('twitter-pure.dsl'), 'eventmodel', 'svg', 'dark', { links: true });
  assert.match(svg.slice(svg.indexOf('data-id="pol:notification-worker"'), svg.indexOf('data-id="pol:notification-worker"') + 1500), /containers/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/diagram.test.js`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement in `lib/diagram/svg.js`**

Draw lane labels from `LANE_LABELS`. Draw implied read models in the read model style with a dashed outline. Give implied and unnamed processor nodes `data-lines` from their `ranges`. The legend reads: command, event, read model, implied read model, processor, assumed event (nothing records it), and "dashed arrow = read model read". The description and counts say "read model" and "processor", and name the three rows. In `boardToGraph`, only `reads` edges are dashed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/diagram.test.js test/links.test.js` then `npm test`
Expected: all pass except the stale homepage board in `test/site.test.js`.

- [ ] **Step 5: Commit**

```bash
git add lib/diagram/svg.js lib/diagram/board.js test/diagram.test.js
git commit -m "Draw the classic board's rows, implied read models and legend"
```

---

### Task 4: The `automation-reads-event` rule

**Files:**
- Modify: `lib/rules/catalogue.js`, `lib/rules/profile.js`, `docs/RULES.md` (generated)
- Test: `test/rules.test.js`

**Interfaces:**
- Consumes: the trigger shape from Task 1. The pass condition is the same as Task 2's "no implied read model is drawn".

- [ ] **Step 1: Write the failing test**

```js
test('automation-reads-event: an event-started automation should read a read model fed by that event', () => {
  const bad = 'user -> start(id)\n  --[default]--> [x-happened { id }]\nx-happened { id } -> w -> go(id)';
  const good = 'user -> start(id)\n  --[default]--> [x-happened { id }]\nreadmodel Todo(id) = [x-happened*(id)] => { id }\nx-happened from [Todo] -> w -> go(id)';
  const alone = 'user -> start(id)\n  --[default]--> [x-happened { id }]\nreadmodel Todo(id) = [x-happened*(id)] => { id }\nfrom [Todo] -> w -> go(id)';
  assert.ok(!ids(bad, 'core').includes('automation-reads-event'));
  const em = found(bad, 'eventmodeling').filter((i) => i.rule === 'automation-reads-event');
  assert.equal(em.length, 1); assert.equal(em[0].severity, 'info'); assert.match(em[0].message, /from \[/);
  assert.equal(found(bad, 'slicerm').find((i) => i.rule === 'automation-reads-event').severity, 'warn');
  for (const text of [good, alone]) assert.ok(!ids(text, 'slicerm').includes('automation-reads-event'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/rules.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the catalogue entry with `slicerm: 'warn'`, category `slices`, title "An automation starts straight from an event", a `why` that says an event reaches an automation through a read model, a `fix` that shows both forms, and an `example` with `bad` and `good` like its neighbours. Add `automationReadsEvent(model)` to `eventmodelingIssues` in `lib/rules/profile.js`: one issue per policy whose trigger is an event and none of whose `from` read models has a source with that event's name. Its message names a read model to write, built from the worker, for example `Pending<Worker>`. Run `node scripts/build-rules-doc.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass except the stale homepage board.

- [ ] **Step 5: Commit**

```bash
git add lib/rules docs/RULES.md test/rules.test.js
git commit -m "Ask for the read model in front of an event-started automation"
```

---

### Task 5: "Read model" in the library, CLI and editors

**Files:**
- Modify: `lib/rules/catalogue.js` (titles, why, fix text; not ids), `lib/rules/profile.js` and `lib/rules/index.js` (messages), `lib/diagram/system.js` (labels), `lib/summary.js` and `lib/output.js` (human-readable text only), `lib/commands/views.js`, `bin/eventline-axi`, `site/playground.js` (highlighter `HEAD` regex, status line), `site/app/complete.js` (snippet and name kind label), `docs-site/src/code/eventline.tmLanguage.json`, `docs-site/src/code/eventline-source.mjs`, `docs/RULES.md` (generated)
- Test: `test/cli.test.js`, `test/app-complete.test.js`, `test/playground.test.js`, `test/docs-site.test.js`

**Interfaces:**
- Produces: CLI command `readmodels <file>`, with `views <file>` kept as an alias. Autocomplete snippet `readmodel` (`readmodel |(id) = [event-name*(id)] => {\n  total: count(event-name*(id))\n}`), with the `view` snippet kept.

- [ ] **Step 1: Write the failing tests**

```js
// test/cli.test.js
test('readmodels lists read models, and views still works', () => { /* run both on examples/twitter-pure.dsl; same stdout, exit 0 */ });
// test/app-complete.test.js
test('readmodel has a snippet', () => { assert.ok(SNIPPETS.some((s) => s.label === 'readmodel')); });
// test/playground.test.js
test('the highlighter knows readmodel', () => { assert.match(read('site/playground.js'), /readmodel/); });
// test/docs-site.test.js
test('docs grammar and code-shape check know readmodel and from [', async () => { /* looksLikeEventline('readmodel A(id) = [x-y*(id)] => { id }') and the tmLanguage contains readmodel */ });
// test/rules.test.js
test('no rule text people read says view where it means a read model', () => {
  for (const r of RULES) for (const k of ['title', 'why', 'fix']) assert.doesNotMatch(r[k].replace(/state view/gi, '').replace(/`view [^`]*`/g, ''), /\bviews?\b(?! model)/i, `${r.id}.${k}`);
});
```

Write the CLI and docs-site tests in the style of their files' existing tests. If a rule text uses "view" for a screen, reword it to "screen".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cli.test.js test/app-complete.test.js test/playground.test.js test/docs-site.test.js test/rules.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Change words people read from "view" to "read model". Do not change ids, keys, `model.views`, `@projection` or "state view". Run `node scripts/build-rules-doc.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass except the stale homepage board.

- [ ] **Step 5: Commit**

```bash
git add lib bin site/playground.js site/app/complete.js docs-site/src/code docs/RULES.md test
git commit -m "Say read model wherever people read it"
```

---

### Task 6: Examples, homepage and app text

**Files:**
- Modify: `examples/*.dsl` (`view` to `readmodel` only; automations keep their current form), `site/playground.js` (Start small text), `site/index.html` (proof listing, board alt text, copy, FAQ), `site/app/prompts.json` (only if it says "view"), generated `site/` files via `node scripts/build-site.js`
- Test: `test/site.test.js`, `test/playground.test.js`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing test**

```js
// test/playground.test.js
test('the homepage explains read models and screens, and never mentions a policy lane', () => {
  assert.match(html, /Is a read model a screen\?/);
  assert.doesNotMatch(html, /lane below|policy lane/i);
  assert.doesNotMatch(read('examples/twitter-pure.dsl'), /^view /m);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/playground.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Change `view` to `readmodel` in the four examples and in Start small. Rebuild with `node scripts/build-site.js`. Update the proof scene's hand-written listing in `site/index.html` so it matches `examples/twitter-pure.dsl` line for line, with `readmodel` highlighted as a keyword. Rewrite the board image's `alt` text for the three rows and the processors. Replace "views" with "read models" in the homepage copy, including "Describe any system as commands, events and read models" and the proof scene's view labels. Add the FAQ entry:

> **Is a read model a screen?**
> No. A read model is data folded from events: what a screen shows, what a query returns, or a projection no screen shows. A screen is where someone sees it or starts a command. eventline writes it as `@trigger(type=ui, name="CartScreen")` on a command or read model.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass, including `test/site.test.js`.

- [ ] **Step 5: Check the homepage and the app in a browser**

Serve with `SERVE=$(mktemp -d) && ln -s "$PWD/site" "$SERVE/eventline" && python3 -m http.server 4173 --directory "$SERVE"`. Confirm: the board shows three rows on the homepage and in the app for all four examples; implied read models appear where an event starts an automation; tracing lights a processor's lineage through its read model; clicking an implied read model highlights its policy's lines; Links between diagrams still work; the hero, proof and model scenes run; no console errors.

- [ ] **Step 6: Commit**

```bash
git add examples site test/playground.test.js
git commit -m "Write read models as readmodel in the examples and on the homepage"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/LANGUAGE.md`, `docs/GLOSSARY.md`, `docs/EVENT-MODELING.md`, `README.md`, `EVENTLINE-AXI.md`, `docs/ARCHITECTURE.md`, and any other `docs/*.md` that writes `view` statements
- Test: `test/docs-site.test.js`, plus the docs build

- [ ] **Step 1: Write the failing test**

```js
// test/docs-site.test.js
test('the docs explain read models, screens and both automation forms', () => {
  const lang = read('docs/LANGUAGE.md');
  assert.match(lang, /## Read models and screens/); assert.match(lang, /^readmodel /m);
  assert.match(lang, /from \[[A-Za-z]+\] -> /); assert.match(lang, /[a-z]+-[a-z]+ from \[/);
  assert.match(read('docs/GLOSSARY.md'), /### Read model[\s\S]*### Screen/);
  assert.match(read('docs/EVENT-MODELING.md'), /\| *SliceRM *\|/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/docs-site.test.js`
Expected: FAIL.

- [ ] **Step 3: Write the docs**

In `docs/LANGUAGE.md`: write read models with `readmodel`, note `view` as the short form, add "Read models and screens" (the spec's section, with one example of a screen that reads a read model and starts a command), and show the event shorthand next to both read-model forms, saying the stricter profiles expect a read model. In `docs/GLOSSARY.md`: entries for Read model and Screen, and "View" pointing to Read model. In `docs/EVENT-MODELING.md`: the three-row board and the vocabulary table (classic Event Modeling, SliceRM, eventline): read model / view model / query / `readmodel` (`view`); screen / wireframe / trigger / `@trigger(type=ui)`; automation / processor / policy and worker; translation / translator. In `docs/ARCHITECTURE.md`: the board's rows and the new node ids. `README.md` and `EVENTLINE-AXI.md`: "read model" and the `readmodels` command.

- [ ] **Step 4: Run the tests and the docs build**

Run: `npm test`, then `npm ci && npm run build` in `docs-site/`
Expected: all pass; the build succeeds with no broken links.

- [ ] **Step 5: Commit**

```bash
git add docs README.md EVENTLINE-AXI.md test/docs-site.test.js
git commit -m "Document read models, screens and the classic board"
```

---

### Task 8: Final verification and SliceRM note

- [ ] **Step 1:** Run `node scripts/build-site.js && node scripts/build-rules-doc.js && npm test && git status --short`. Expected: all pass, nothing regenerated.
- [ ] **Step 2:** Walk the spec's Testing section in a browser, as in Task 6 Step 5, on the app with each example and the Start small model, at 1920px and 800px.
- [ ] **Step 3:** Comment on ByteQuilt/SliceRM#1 that a policy can now start from read models alone, with `trigger.event === null`, `trigger.schedule === null` and `trigger.readModels === true`, and that every other trigger has `readModels: false`.
- [ ] **Step 4:** Commit any fixes with a clear message.
