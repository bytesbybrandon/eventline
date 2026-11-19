# Language Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add short guard arrows (#35), named policies (#33) and predefined events with a contract (#39) to the eventline language.

**Architecture:** Parser and model changes come first in each feature, then the board, links and CLI, then the rules. Highlighters, autocomplete and docs learn each form in the task that adds it, and one last task writes the language docs and rebuilds the site.

**Tech Stack:** Plain JavaScript (CommonJS) in `lib/` and `bin/`, static `site/`, Astro Starlight in `docs-site/`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-19-language-additions-design.md`

## Global Constraints

- Every `.dsl` that parses on `main` still parses, to the same model apart from additive fields. Check with `git show main:examples/<name>.dsl`.
- `lib/` stays pure and dependency-free.
- Existing ids (`cmd:`, `evt:`, `view:`, `pol:`, `implied:`, `auto:`), JSON and toon output keys, and rule ids keep their names. New fields are additive.
- Words people read say "read model", not "view".
- After `lib/` or `examples/` changes, run `node scripts/build-site.js`; after catalogue changes, `node scripts/build-rules-doc.js`. Files that differ only in line endings after a rebuild are restored with `git checkout -- <file>`, not committed.
- `test/site.test.js` may fail only on the stale homepage board image and the stale `site/eventline.js` bundle until Task 7 rebuilds them. Every other test passes at the end of every task. Baseline: 259.

## Review Focus

1. `policy -> go(id)`, `policy { id } -> w -> go(id)`, `event -> go(id)` and `event { id } -> w -> go(id)` keep parsing as on `main` (tests in Tasks 2 and 4).
2. A mixed guard (`--[x]->`, `-[x]-->`) is an error naming both forms, and `-[` inside a note or annotation argument is untouched (test in Task 1).
3. A policy named like a command or read model is an error, so `deps` is never ambiguous (test in Task 2).
4. Two recordings of a declared event, one matching and one not, give exactly one finding, at the wrong one's line (test in Task 6).
5. A declared event used only by `on [...]` appears on the board as declared; a declared event nothing uses does not appear (test in Task 5).

---

### Task 1: Short guard arrows (#35)

**Files:**
- Modify: `lib/parser.js` (`parseGuard` around 291-294 and every `peek('--[')`), `site/playground.js` (highlighter), `site/site.js:181-182`, `docs-site/src/code/eventline.tmLanguage.json`, `docs-site/src/code/eventline-source.mjs:11`
- Test: `test/parser.test.js`, `test/docs-site.test.js`, `test/playground.test.js`

**Interfaces:**
- Produces: `-[guard]->` parses everywhere `--[guard]-->` does, to the identical model.

- [ ] **Step 1: Write the failing tests**

```js
test('short guard arrows mean the same as long ones', () => {
  const long = 'user -> go(id)\n  --[bad]--> [x-failed { id }]\n  --[default]--> [x-done { id }]\nx-done { id } --[ok]--> w -> next(id)';
  const short = long.replace(/--\[/g, '-[').replace(/\]-->/g, ']->');
  const strip = (m) => JSON.stringify(m, (k, v) => (k === 'line' || k === 'endLine' ? undefined : v));
  assert.equal(strip(parse(short)), strip(parse(long)));
});
test('a guard must open and close with the same form', () => {
  assert.throws(() => parse('user -> go(id)\n  --[default]-> [x-done { id }]'), /--\[guard\]-->.*-\[guard\]->|-\[guard\]->.*--\[guard\]-->/);
  assert.throws(() => parse('user -> go(id)\n  -[default]--> [x-done { id }]'), /-\[guard\]->/);
});
test('-[ inside a note or annotation is untouched', () => {
  const m = parse('user -> go(id) @note("a -[b]-> c")\n  --[default]--> [x-done { id }]');
  assert.equal(m.commands[0].notes[0], 'a -[b]-> c');
});
// test/docs-site.test.js
test('the code-shape check knows the short guard', async () => { /* looksLikeEventline('user -> go(id)\n  -[default]-> [x-done { id }]') is true */ });
```

Add a `test/playground.test.js` assertion that `site/site.js` marks a short `-[default]->` line as the default branch, written in that file's style.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/parser.test.js test/docs-site.test.js test/playground.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `parseGuard`, accept `-[` as the opener and then require the matching closer (`]->` for `-[`, `]-->` for `--[`), throwing a `ParseError` that names both forms on a mismatch. Replace each `peek('--[')` guard check with one helper that accepts either opener. Teach the highlighters and the shape check the short form.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass except the two stale-artifact tests.

- [ ] **Step 5: Commit**

```bash
git add lib/parser.js site/playground.js site/site.js docs-site/src/code test
git commit -m "Accept -[guard]-> as a short form of --[guard]-->"
```

---

### Task 2: Named policies in the parser, model, CLI and checks (#33)

**Files:**
- Modify: `lib/parser.js` (`parseOne`, `parsePolicy`), `lib/model.js` (`policyName`, name checks), `lib/commands/policies.js`, `lib/commands/deps.js`, `lib/commands/parse.js`, `lib/rules/*.js` (messages)
- Test: `test/parser.test.js`, `test/cli.test.js`, `test/rules.test.js`

**Interfaces:**
- Consumes: Task 1's guard parsing.
- Produces: `policy.name: string | null`; `Model.policyName(p): string` (`policy <Name>` or `Model.policyLabel(p)`); `policyLabel` unchanged.

- [ ] **Step 1: Write the failing tests**

```js
test('policy Name = names a policy with any trigger', () => {
  const m = parse('policy NotifyLiker = tweet-liked { userId } -> notifier -> notify(userId)\npolicy ShipOrders = from [OrdersToShip] -> shipper -> ship(id)\npolicy Nightly = every 1 days -> reporter -> report()');
  assert.deepEqual(m.policies.map((p) => p.name), ['NotifyLiker', 'ShipOrders', 'Nightly']);
  assert.equal(m.policies[0].trigger.event, 'tweet-liked'); assert.equal(m.policies[1].trigger.readModels, true); assert.equal(m.policies[2].trigger.schedule, 'every 1 days');
  assert.equal(Model.policyName(m.policies[0]), 'policy NotifyLiker');
  assert.equal(Model.policyLabel(m.policies[0]), 'tweet-liked');
  assert.equal(parse('x-happened { id } -> w -> go(id)').policies[0].name, null);
});
test('policy and event keep their old meanings', () => {
  assert.equal(parse('policy -> go(id)\n  --[default]--> [x-done { id }]').commands[0].actor, 'policy');
  assert.equal(parse('policy { id } -> w -> go(id)').policies[0].trigger.event, 'policy');
  assert.equal(parse('policy --[g]--> w -> go(id)').policies[0].trigger.event, 'policy');
});
test('policy names are unique and never clash with commands or read models', () => {
  assert.throws(() => parse('policy A = x-y { id } -> w -> go(id)\npolicy A = x-z { id } -> w -> go(id)'), /policy A/);
  assert.throws(() => parse('user -> Ship(id)\n  --[default]--> [x-done { id }]\npolicy Ship = x-done { id } -> w -> go(id)'), /Ship/);
  assert.throws(() => parse('readmodel Ship(id) = [x-done*(id)] => { id }\npolicy Ship = x-done { id } -> w -> go(id)'), /Ship/);
});
// test/cli.test.js
test('policies shows a policy name and deps accepts it', () => { /* run policies and deps <file> NotifyLiker on a temp file; exit 0; stdout contains NotifyLiker */ });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/parser.test.js test/cli.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `parseOne`, treat `word === 'policy'` followed by an identifier and `=` as a named policy: read the name and `=`, then parse the rest exactly as an unnamed policy statement (event, timer or `from [...]` trigger), setting `name`. Unnamed policies get `name: null`. Check names after parsing: duplicates, and clashes with command or read model names, are `ParseError`s naming the policy and the line. Add `Model.policyName`. Use it in check messages, `policies` output and parse output; keep `emittedBy[].name` and `consumedBy[].name` on `policyLabel`. `deps <file> <Name>` resolves a policy name.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass except the two stale-artifact tests.

- [ ] **Step 5: Commit**

```bash
git add lib test
git commit -m "Name policies with policy Name ="
```

---

### Task 3: Named policies on the board, in links and in the editors (#33)

**Files:**
- Modify: `lib/diagram/board.js`, `lib/diagram/links.js`, `lib/diagram/svg.js` (only if a sub-label needs room), `site/playground.js` (highlighter keyword), `site/app/complete.js` (snippet), `docs-site/src/code/eventline.tmLanguage.json`, `docs-site/src/code/eventline-source.mjs`
- Test: `test/diagram.test.js`, `test/links.test.js`, `test/app-complete.test.js`, `test/docs-site.test.js`

**Interfaces:**
- Consumes: `policy.name`, `Model.policyName` from Task 2.
- Produces: board node `{ id: 'policy:<Name>', lane: 'actor', kind: 'policy', label: '<Name>', sub: '<worker, worker>' }`. Snippet `policy` inserting `policy |Name = event-name { id }\n  -> worker-name -> nextCommand(id)`.

- [ ] **Step 1: Write the failing tests**

```js
test('board: a named policy is one processor box listing its workers', () => {
  const b = buildBoard(parse('user -> go(id)\n  --[default]--> [x-done { id }]\npolicy Fan = x-done { id }\n  --[a]--> w1 -> one(id)\n  --[b]--> w2 -> two(id)'));
  const p = b.nodes.find((n) => n.id === 'policy:Fan');
  assert.equal(p.lane, 'actor'); assert.equal(p.label, 'Fan'); assert.match(p.sub, /w1.*w2/);
  assert.equal(b.nodes.some((n) => n.id === 'pol:w1' || n.id === 'pol:w2'), false);
  assert.ok(b.edges.some((e) => e.from === 'policy:Fan' && e.to === 'cmd:one'));
  assert.ok(b.edges.some((e) => e.from === 'policy:Fan' && e.to === 'cmd:two'));
});
test('links: a named policy leads to each of its workers', () => {
  const map = linkMap(parse('user -> go(id)\n  --[default]--> [x-done { id }]\npolicy Fan = x-done { id }\n  --[a]--> w1 -> one(id)\n  --[b]--> w2 -> two(id)'));
  const to = (map.eventmodel['policy:Fan'] || []).filter((l) => l.diagram === 'containers').map((l) => l.node);
  assert.deepEqual(to.sort(), ['worker:w1', 'worker:w2']);
});
test('policy snippet writes a named policy', () => { assert.ok(SNIPPETS.some((s) => s.label === 'policy' && /^policy /.test(s.insert))); });
```

Add highlighter and docs grammar assertions for `policy` as a statement keyword when followed by a name and `=`, in each file's style.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/diagram.test.js test/links.test.js test/app-complete.test.js test/docs-site.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `board.js`, when a policy has a name, place one `policy:<Name>` processor instead of one `pol:<worker>` or `auto:` box per rule, with every rule's results hanging off it; everything else (implied read models, `from` reads, timers, sibling order) is as for unnamed policies. In `links.js`, map `policy:<Name>` to each worker's `worker:<w>` in containers and data flow, and back. Replace the existing `policy` snippet if one exists.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass except the two stale-artifact tests.

- [ ] **Step 5: Commit**

```bash
git add lib site/playground.js site/app/complete.js docs-site/src/code test
git commit -m "Draw a named policy as one processor and link it to its workers"
```

---

### Task 4: Event declarations in the parser, model and CLI (#39 phase 1)

**Files:**
- Modify: `lib/parser.js`, `lib/model.js` (`finalize`, event index), `lib/commands/events.js`, `lib/rules/catalogue.js`, `lib/rules/profile.js` (`event-declared-unused`), `site/playground.js` (highlighter keyword), `site/app/complete.js` (snippet), `docs-site/src/code/*`, `docs/RULES.md` (generated)
- Test: `test/parser.test.js`, `test/cli.test.js`, `test/rules.test.js`, `test/app-complete.test.js`

**Interfaces:**
- Produces: `model.events.get(name).declared: { fields: string[] | null, line, context } | null` (`fields: null` when no list was written). `Model.isUsed(model, eventName): boolean`, true when something records it (a command branch or policy rule), checks it with `on [...]`, folds it in a read model, or starts an automation from it. Snippet `event` inserting `event |event-name { id }`. Rule `event-declared-unused`: profile `workshop` and `eventmodeling`, severity `info`.

- [ ] **Step 1: Write the failing tests**

```js
test('event declarations, with and without fields, inside contexts', () => {
  const m = parse('event item-added { cartId, sku, addedAt: clock.wall() }\nevent order-placed\ncontext Shop {\n  event cart-opened { cartId }\n}');
  assert.deepEqual(m.events.get('item-added').declared.fields, ['cartId', 'sku', 'addedAt']);
  assert.equal(m.events.get('order-placed').declared.fields, null);
  assert.equal(m.events.get('cart-opened').declared.context, 'Shop');
  assert.equal(m.events.get('item-added').emittedBy.length, 0);
});
test('a declaration with fields is the event known payload', () => {
  const m = parse('event item-added { cartId, sku }\nuser -> add(cartId)\n  --[default]--> [item-added { cartId }]');
  assert.deepEqual(m.events.get('item-added').fields.map((f) => f.name ?? f), ['cartId', 'sku']);
});
test('event keeps its old meanings, and a second declaration is an error', () => {
  assert.equal(parse('event -> go(id)\n  --[default]--> [x-done { id }]').commands[0].actor, 'event');
  assert.equal(parse('event { id } -> w -> go(id)').policies[0].trigger.event, 'event');
  assert.throws(() => parse('event x-done { id }\ncontext A {\n  event x-done { id }\n}'), /x-done/);
});
test('event-declared-unused hints at a declaration nothing uses', () => {
  const t = 'event ghost-seen { id }\nevent x-done { id }\nuser -> go(id)\n  --[default]--> [x-done { id }]';
  const hits = found(t, 'eventmodeling').filter((i) => i.rule === 'event-declared-unused');
  assert.equal(hits.length, 1); assert.match(hits[0].message, /ghost-seen/); assert.equal(hits[0].severity, 'info');
  assert.ok(!ids(t, 'core').includes('event-declared-unused'));
});
// test/cli.test.js
test('events lists declared events, unused and unrecorded', () => { /* temp file with one used-but-unrecorded and one unused declaration; text output names both states; -f json keeps existing keys and adds declared */ });
```

Match the existing shape of `events[].fields` in the second test; adjust the `map` if fields are plain strings.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/parser.test.js test/cli.test.js test/rules.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `parseOne`, treat `word === 'event'` followed by an event name (and then `{`, a newline or the end) as a declaration; `event {`, `event --[`, `event @`, `event from [` and `event ->` keep their current meanings. Record declarations on the event index in `finalize`, and when `declared.fields` is a list, use it as the event's `fields`. A second declaration anywhere is a `ParseError`. Add `Model.isUsed`. Add the catalogue entry with bad and good examples, the rule, and the CLI listing. Run `node scripts/build-rules-doc.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass except the two stale-artifact tests.

- [ ] **Step 5: Commit**

```bash
git add lib site/playground.js site/app/complete.js docs-site/src/code docs/RULES.md test
git commit -m "Declare events with event name { fields }"
```

---

### Task 5: Declared events on the board (#39 phase 1)

**Files:**
- Modify: `lib/diagram/board.js`, `lib/diagram/svg.js` (declared style)
- Test: `test/diagram.test.js`

**Interfaces:**
- Consumes: `declared` and `Model.isUsed` from Task 4.

- [ ] **Step 1: Write the failing tests**

```js
test('board: a used declared event is styled declared; an unused one is absent', () => {
  const b = buildBoard(parse('event cart-opened { cartId }\nevent ghost-seen { id }\nuser -> add(cartId)\non [cart-opened(cartId)]\n  --[default]--> [item-added { cartId }]\ncart-opened { cartId } -> w -> go(cartId)'));
  const ev = b.nodes.find((n) => n.id === 'evt:cart-opened');
  assert.equal(ev.sub, 'declared'); assert.ok(!ev.assumed);
  assert.equal(b.nodes.some((n) => n.id === 'evt:ghost-seen'), false);
  assert.match(b.nodes.find((n) => n.id === 'cmd:add').notes.join(' '), /checks cart-opened \(declared\)/);
});
test('board: an undeclared event nothing records is still assumed', () => {
  const b = buildBoard(parse('user -> add(cartId)\non [cart-opened(cartId)]\n  --[default]--> [item-added { cartId }]'));
  assert.match(b.nodes.find((n) => n.id === 'cmd:add').notes.join(' '), /checks cart-opened \(assumed\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/diagram.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Where the board marks an unrecorded event as assumed, mark it `declared` instead when it has a declaration, in event nodes and in `checks` notes. Draw declared event boxes in the event style with the `declared` sub-label. Unused declarations add nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass except the two stale-artifact tests.

- [ ] **Step 5: Commit**

```bash
git add lib/diagram test/diagram.test.js
git commit -m "Show used declared events on the board as declared"
```

---

### Task 6: The event contract check (#39 phase 2)

**Files:**
- Modify: `lib/rules/catalogue.js`, `lib/rules/profile.js`, `docs/RULES.md` (generated)
- Test: `test/rules.test.js`

**Interfaces:**
- Consumes: `declared` from Task 4.
- Produces: rule `event-contract-mismatch`: profile `eventmodeling`, severity `warn`, `slicerm` severity `warn`.

- [ ] **Step 1: Write the failing test**

```js
test('event-contract-mismatch checks each recording against the declaration', () => {
  const base = 'event item-added { cartId, sku, addedAt }\n';
  const good = base + 'user -> add(cartId, sku)\n  --[default]--> [item-added { cartId, sku, addedAt: clock.wall(), note: "x" }]';
  const bad = base + 'user -> add(cartId, sku)\n  --[default]--> [item-added { cartId, sku, addedAt: clock.wall() }]\nuser -> add2(cartId, colour)\n  --[default]--> [item-added { cartId, colour }]';
  assert.ok(!ids(good, 'slicerm').includes('event-contract-mismatch'));
  const hits = found(bad, 'eventmodeling').filter((i) => i.rule === 'event-contract-mismatch');
  assert.equal(hits.length, 1); assert.equal(hits[0].line, 5); assert.equal(hits[0].severity, 'warn');
  assert.match(hits[0].message, /colour/); assert.match(hits[0].message, /sku/); assert.match(hits[0].message, /addedAt/);
  assert.ok(!ids(bad, 'core').includes('event-contract-mismatch'));
  const noList = 'event item-added\nuser -> add(cartId)\n  --[default]--> [item-added { cartId }]';
  const noPayload = base + 'user -> add(cartId)\n  --[default]--> [item-added]';
  for (const t of [noList, noPayload]) assert.ok(!ids(t, 'slicerm').includes('event-contract-mismatch'));
  const policyRecords = base + 'x-done { id } -> w -> [item-added { cartId }]';
  assert.ok(ids(policyRecords, 'eventmodeling').includes('event-contract-mismatch'));
});
test('a read model reading an undeclared field is reported by unsourced-view-field', () => {
  const t = 'event item-added { cartId }\nuser -> add(cartId)\n  --[default]--> [item-added { cartId }]\nreadmodel Cart(cartId) = [item-added*(cartId)] => { cartId, sku }';
  assert.ok(ids(t, 'eventmodeling').includes('unsourced-view-field'));
});
```

Match the line the test expects to the actual line of the `--[default]-->` branch that records the bad payload; adjust the number if the parser reports branch lines differently.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/rules.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

For each command branch and policy rule that records a declared event with a field list, compare the recording's fields with the declaration: a plain field the declaration lacks, or a declared field the recording does not carry (a computed field of the same name counts as carrying it), is one finding for that recording, at its line. Computed fields the declaration lacks are allowed. Recordings without a payload, and declarations without a field list, are skipped. Add the catalogue entry with bad and good examples and run `node scripts/build-rules-doc.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass except the two stale-artifact tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rules docs/RULES.md test/rules.test.js
git commit -m "Check recorded events against their declaration"
```

---

### Task 7: Docs, rebuild and final verification

**Files:**
- Modify: `docs/LANGUAGE.md`, `docs/GLOSSARY.md`, `EVENTLINE-AXI.md`, `docs/ARCHITECTURE.md`, generated `site/` files
- Test: `test/docs-site.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('the docs cover short guards, named policies and declared events', () => {
  const lang = read('docs/LANGUAGE.md');
  assert.match(lang, /-\[[^\]]+\]->/); assert.match(lang, /^policy [A-Z]\w* = /m); assert.match(lang, /^event [a-z]+-[a-z-]+ \{/m);
  assert.match(lang, /## Named policies/); assert.match(lang, /## Predefined events/);
  const g = read('docs/GLOSSARY.md'); assert.match(g, /### Named policy/); assert.match(g, /### Declared event/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/docs-site.test.js`
Expected: FAIL.

- [ ] **Step 3: Write the docs and rebuild**

`docs/LANGUAGE.md`: the short guard as the short form of `--[...]-->`; "Named policies" (syntax with each trigger, uniqueness, the board box); "Predefined events" (declaring, off the board until used, declared versus assumed, the contract, computed fields, a declaration without fields). `docs/GLOSSARY.md`: Named policy, Declared event. `EVENTLINE-AXI.md`: `policies`, `deps <Name>`, `events`. `docs/ARCHITECTURE.md`: the `policy:` id and its links. Then `node scripts/build-site.js`.

- [ ] **Step 4: Verify**

Run: `npm test` (all pass, including `test/site.test.js`), `npm ci && npm run build` in `docs-site/` (no broken links), and parse every `git show main:examples/*.dsl` with this branch's parser. Serve `site/` (`SERVE=$(mktemp -d) && ln -s "$PWD/site" "$SERVE/eventline" && python3 -m http.server 4173 --directory "$SERVE"`) and check, in the app, a model using a short guard, a named policy with two workers, and a used and an unused declared event: the board, tracing, Links to containers, autocomplete for `policy` and `event`, and highlighting. Check the homepage still works. No console errors.

- [ ] **Step 5: Commit**

```bash
git add docs EVENTLINE-AXI.md site test/docs-site.test.js
git commit -m "Document short guards, named policies and declared events"
```
