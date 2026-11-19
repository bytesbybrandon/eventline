# Eventline Modeling App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local-first modeling app at `/eventline/app/` with saved models, faster editing, client-session layouts and a timed practice mode, sharing one playground with the homepage.

**Architecture:** The playground moves out of `site/site.js` into `site/playground.js`, mounted by the homepage and the app. App logic with real rules (saving, conflicts, addresses, autocomplete, zip, timer) lives in small DOM-free modules tested under Node. Thin UI files wire those modules to the page.

**Tech Stack:** Plain browser JavaScript, HTML and CSS; `localStorage`; Node's built-in test runner. No new dependencies and no new build step.

**Spec:** `docs/superpowers/specs/2026-11-18-modeling-app-design.md`

## Global Constraints

- `site/` stays static. No server code, no new runtime dependencies, no new build step.
- Model text is never sent off the machine: no analytics, no network calls carrying model text.
- The app never reports Saved when a save did not succeed.
- Generated IDs are UUIDv7.
- Autosave runs about 500ms after typing stops. Delete Undo lasts 10 seconds. Share links over 6,000 characters warn.
- Below 900px wide the app shows one pane at a time.
- `npm test` passes at the end of every task. Baseline today: 107 passing.
- Pure modules use this wrapper so Node tests can `require` them and pages can load them with a script tag:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventlineStore = factory(); // each module names its own global
})(typeof globalThis !== 'undefined' ? globalThis : this, function () { 'use strict'; /* ... */ return { /* exports */ }; });
```

- To view the site locally, with paths matching production:

```bash
SERVE=$(mktemp -d) && ln -s "$PWD/site" "$SERVE/eventline" && python3 -m http.server 4173 --directory "$SERVE"
# open http://localhost:4173/eventline/ and http://localhost:4173/eventline/app/
```

## Review Focus

1. Two saved models whose names collide or contain characters like `/` must both survive Export all under distinct, safe file names (test in Task 4).
2. Corrupt or partly cleared `localStorage` must not stop the app opening. Unreadable entries are skipped and the rest still list (test in Task 2).
3. A computer that sleeps mid-attempt must not charge the sleep time to the clock (test in Task 9).
4. A malformed `#play=` link or an `#m=` id that no longer exists opens a blank draft with a notice, and never throws (test in Task 5).
5. Opening a huge, empty or binary file gives a clear refusal and leaves saved models untouched. Windows line endings are normalized so line highlights stay correct (test in Task 5).

---

### Task 1: Extract the shared playground

**Files:**
- Create: `site/playground.js`, `site/playground.css`
- Modify: `site/site.js` (remove lines 595-666 and 679-1224, keep the Event Modeling board at 668-677 and the flat-layout code at 1226-1235), `site/site.css`, `site/index.html`
- Test: `test/playground.test.js`

**Interfaces:**
- Produces, on `window.EventlinePlayground`:
  - `mount(root: Element, options) -> api`
  - `options`: `{ text?: string, base?: string ('' default, '../' from the app), address?: 'home' | 'none', load?: 'visible' | 'now', theme?: 'dark' | 'light', onChange?: (text: string, meta: { fromUser: boolean }) => void, onView?: (view: { kind, node, links, profile }) => void }`
  - `api`: `{ getText(): string, setText(text: string, fromUser?: boolean): void, setReadOnly(on: boolean): void, setTheme(theme): void, getView(): { kind, node, links, profile }, setView(view): void, shareHash(): string, getModel(): object | null, textarea: HTMLTextAreaElement, ready: Promise<void> }`
  - `drawStatic(host: Element, text: string, kind: string, theme: string, base?: string): Promise<boolean>` draws a read-only traced board for the review screen
  - `inlineSvg(text)`, `traceBoard(svg, readout, idle, opts)`, `copyText(text, field?)`, `b64: { enc, dec }`
  - `REQUIRED_IDS: string[]`, every element id `mount` needs
- `address: 'home'` keeps today's `#play` handling, hash listeners and scrolling. `address: 'none'` leaves the address to the host.

- [ ] **Step 1: Create the branch and commit the design documents**

```bash
git switch -c feat/modeling-app
git add docs/superpowers
git commit -m "Add the modeling app design and plan"
```

- [ ] **Step 2: Write the failing tests in `test/playground.test.js`**

```js
test('the homepage loads the shared playground before its own script', () => {
  assert.ok(html.indexOf('src="playground.js"') > -1);
  assert.ok(html.indexOf('src="playground.js"') < html.indexOf('src="site.js"'));
  assert.ok(html.indexOf('href="playground.css"') < html.indexOf('href="site.css"'));
});
test('the playground code lives in one place', () => {
  assert.ok(!read('site/site.js').includes('function drawBoard'));
  assert.ok(read('site/playground.js').includes('function drawBoard'));
});
test('the homepage has every element the playground needs', () => {
  const ids = [...read('site/playground.js').match(/REQUIRED_IDS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 15);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/playground.test.js`
Expected: FAIL, `playground.js` does not exist.

- [ ] **Step 4: Move the code into `site/playground.js` behind `mount`**

Move the code without rewriting it. Replace the hard-coded `'dark'` in the board and SVG download `render` calls with the `theme` option. Prefix `eventline.js` and `examples/` fetches with `base`. Only run hash handling, `#play` scrolling and the `#play` IntersectionObserver when `address === 'home'`. In `site/site.js`, call `EventlinePlayground.mount(document.querySelector('#play'), { address: 'home', load: 'visible' })` and take `inlineSvg`, `traceBoard` and `copyText` from the global.

- [ ] **Step 5: Move the styles into `site/playground.css`**

Move the two `@font-face` rules, the `:root` tokens, `.btn*`, `.t-*`, the board tracing rules and every `.pg*` rule. In `site/index.html`, load `frontstage.css`, `playground.css`, `site.css`, in that order, and add `<script src="playground.js"></script>` before `site.js`.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Check the homepage in a real browser**

Serve the site. Confirm: no console errors, typing redraws the board, presets load, diagram tabs work, clicking a box highlights its lines, zoom works, Copy share link round-trips through a reload, `/eventline/#play=<link>` opens that model, the hero and proof scenes still run, and the Event Modeling board still traces. Compare screenshots of the playground section against `main`.

- [ ] **Step 8: Commit**

```bash
git add site test/playground.test.js
git commit -m "Move the playground into a shared module"
```

---

### Task 2: Model storage

**Files:**
- Create: `site/app/store.js` (global `EventlineStore`)
- Test: `test/app-store.test.js`

**Interfaces:**
- Produces:
  - `uuidv7(nowMs: number, randomBytes: (n: number) => Uint8Array): string`
  - `modelName(text: string): string`, the `system` name, otherwise `'Untitled'`
  - `createStore(storage, { now: () => number, uuid: () => string }) -> store`
  - Model: `{ id, name, text, rev: number, createdAt, updatedAt, practice?: object }`
  - Write results: `{ ok: true, model } | { ok: false, reason: 'conflict' | 'deleted' | 'storage', current?: model }`
  - `store.list()`: summaries without `text`, newest edit first
  - `store.get(id)`, `store.findByText(text)`, `store.activeAttempt()`
  - `store.create({ name?, text, practice? })`
  - `store.save(id, text, baseRev)`, `store.overwrite(id, text)`
  - `store.update(id, fields)`, for `name` and `practice`
  - `store.duplicate(id)`
  - `store.remove(id) -> { ok, restore: () => Result }`
  - `store.meta() -> { lastExportAt?, lastOpenedId? }`, `store.setMeta(fields)`
  - `store.isModelKey(key: string): boolean`
- Keys: `eventline.app.v1.index`, `eventline.app.v1.meta`, `eventline.app.v1.model.<id>`

- [ ] **Step 1: Write the failing tests**

Use an in-memory fake with `getItem`, `setItem`, `removeItem`, `key`, `length`, and a `failWrites` switch that throws from `setItem`.

```js
test('a save with the current revision succeeds and bumps the revision', () => {
  const m = store.create({ text: 'a' }).model;
  const r = store.save(m.id, 'b', m.rev);
  assert.equal(r.ok, true); assert.equal(r.model.rev, m.rev + 1); assert.equal(store.get(m.id).text, 'b');
});
test('a save from a stale revision reports a conflict and changes nothing', () => {
  const m = store.create({ text: 'a' }).model;
  store.save(m.id, 'theirs', m.rev);
  const r = store.save(m.id, 'mine', m.rev);
  assert.equal(r.reason, 'conflict'); assert.equal(r.current.text, 'theirs'); assert.equal(store.get(m.id).text, 'theirs');
});
test('a save to a deleted model reports deleted and does not bring it back', () => { /* reason === 'deleted', get(id) === null */ });
test('a failed write reports storage and keeps the previous text', () => { /* failWrites = true; reason === 'storage'; get(id).text unchanged */ });
test('remove can be undone', () => { /* restore() brings back the same id, text and rev */ });
test('modelName uses the system block', () => { assert.equal(modelName('system Shop {\n}'), 'Shop'); assert.equal(modelName('// system Nope'), 'Untitled'); });
test('uuidv7 is version 7 and sorts by time', () => { /* /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/ and earlier < later */ });
test('corrupt entries are skipped and the rest still list', () => {
  const a = store.create({ text: 'a' }).model; const b = store.create({ text: 'b' }).model;
  storage.setItem('eventline.app.v1.model.' + a.id, '{not json');
  assert.deepEqual(store.list().map((m) => m.id), [b.id]);
});
test('an unreadable index is rebuilt from the model entries', () => {
  const a = store.create({ text: 'a' }).model;
  storage.setItem('eventline.app.v1.index', 'nope');
  assert.deepEqual(store.list().map((m) => m.id), [a.id]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app-store.test.js`
Expected: FAIL, cannot find `site/app/store.js`.

- [ ] **Step 3: Implement `site/app/store.js`**

Write the model entry first and the index second, so an interrupted write leaves a model the index rebuild can find. Catch every storage exception and return `reason: 'storage'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/app-store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/app/store.js test/app-store.test.js
git commit -m "Add model storage for the app"
```

---

### Task 3: Autocomplete suggestions

**Files:**
- Create: `site/app/complete.js` (global `EventlineComplete`)
- Test: `test/app-complete.test.js`

**Interfaces:**
- Produces:
  - `namesFrom(model): { label: string, kind: 'event' | 'command' | 'view' | 'boundary' | 'actor' }[]`
  - `suggest({ text, caret, names, forced }) -> { from: number, to: number, items: Item[] } | null`
  - `Item`: `{ label, kind, insert: string, caretOffset: number }`, where `caretOffset` is the caret position inside `insert`
  - `SNIPPETS: Item[]`

Snippets (`|` marks the caret, and is not part of `insert`):

| Label | Insert |
|---|---|
| `system` | `system \| {\n  slo: 99.9% uptime\n}` |
| `actor` | `actor \| { auth: session }` |
| `boundary` | `boundary \|(id) @partition(shardKey="id")` |
| `view` | `view \|(id) = [event-name*(id)] => {\n  total: count(event-name*(id))\n}` |
| `context` | `context \| {\n}` |
| `scenario` | `scenario "\|" {\n}` |
| `command` | `Actor -> \|(id) in Boundary(id)\non [fact-name(id)]\n  --[default]--> [\n    event-name { id }\n  ]` |
| `policy` | `\|event-name { id }\n  -> worker-name -> nextCommand(id)` |

- [ ] **Step 1: Write the failing tests**

```js
test('two typed characters suggest matching names and snippets', () => {
  const r = suggest({ text: 'vi', caret: 2, names: [{ label: 'visit-logged', kind: 'event' }], forced: false });
  assert.deepEqual(r.items.map((i) => i.label), ['visit-logged', 'view']);
  assert.deepEqual([r.from, r.to], [0, 2]);
});
test('one character suggests nothing unless forced', () => {
  assert.equal(suggest({ text: 'v', caret: 1, names: [], forced: false }), null);
  assert.ok(suggest({ text: 'v', caret: 1, names: [], forced: true }).items.length);
});
test('hyphenated event names complete as one word', () => {
  const r = suggest({ text: 'on [item-ad', caret: 11, names: [{ label: 'item-added', kind: 'event' }], forced: false });
  assert.equal(r.from, 4); assert.equal(r.items[0].insert, 'item-added');
});
test('nothing is suggested inside a comment or a string', () => { /* '// vi' and '"vi' both return null */ });
test('a name already typed in full is not offered back', () => { /* text 'item-added' with that name returns null */ });
test('at most eight suggestions are returned', () => { /* twenty matching names, items.length === 8 */ });
test('snippets report where the caret goes', () => {
  const s = SNIPPETS.find((i) => i.label === 'actor');
  assert.equal(s.insert.slice(0, s.caretOffset), 'actor ');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app-complete.test.js`
Expected: FAIL, cannot find `site/app/complete.js`.

- [ ] **Step 3: Implement `site/app/complete.js`**

Order items: names starting with the prefix, then snippets, each alphabetical.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/app-complete.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/app/complete.js test/app-complete.test.js
git commit -m "Add autocomplete suggestions"
```

---

### Task 4: Export zip

**Files:**
- Create: `site/app/zip.js` (global `EventlineZip`)
- Test: `test/app-zip.test.js`

**Interfaces:**
- Produces:
  - `exportFiles(models: { name: string, text: string }[]) -> { name: string, text: string }[]`, safe and unique `.dsl` names
  - `zip(files: { name: string, text: string }[], date: Date) -> Uint8Array`, uncompressed zip with UTF-8 names

- [ ] **Step 1: Write the failing tests**

Add a small reader in the test that walks the central directory, and checks each CRC with `zlib.crc32`.

```js
test('the zip reads back with the exact text', () => {
  const files = [{ name: 'shop.dsl', text: 'system Shop {\n}\n// héllo ✓\n' }, { name: 'b.dsl', text: '' }];
  assert.deepEqual(readZip(zip(files, new Date(2026, 10, 18))), files);
});
test('colliding and unsafe names stay distinct and safe', () => {
  const names = exportFiles([{ name: 'Checkout', text: 'a' }, { name: 'checkout', text: 'b' }, { name: 'a/b:c', text: 'c' }, { name: '..', text: 'd' }, { name: '', text: 'e' }]).map((f) => f.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 5);
  for (const n of names) { assert.match(n, /\.dsl$/); assert.doesNotMatch(n, /[\\/:*?"<>|]|^\./); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app-zip.test.js`
Expected: FAIL, cannot find `site/app/zip.js`.

- [ ] **Step 3: Implement `site/app/zip.js`**

Write local headers, file data, central directory and end record, with general purpose flag bit 11 set and method 0. Empty sanitized names become `untitled.dsl`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/app-zip.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/app/zip.js test/app-zip.test.js
git commit -m "Add zip export"
```

---

### Task 5: Session logic

**Files:**
- Create: `site/app/session.js` (global `EventlineSession`)
- Test: `test/app-session.test.js`

**Interfaces:**
- Consumes: `createStore`, `modelName` from Task 2.
- Produces:
  - `parseAddress(hash: string, decode: (s: string) => string) -> { type: 'none' } | { type: 'play', text, view } | { type: 'model', id, view } | { type: 'invalid' }`, where `view` is `{ kind?, node?, links, profile }`
  - `acceptImport(name: string, bytes: Uint8Array) -> { ok: true, name, text } | { ok: false, reason: 'empty' | 'too-large' | 'binary' }`, limit 1,000,000 bytes
  - `createSession({ store, schedule: (fn, ms) => cancel, onChange: (state) => void }) -> session`
  - `state`: `{ id: string | null, name, text, status: 'draft' | 'saving' | 'saved' | 'failed' | 'conflict' | 'deleted', theirs: model | null, readOnly: boolean }`
  - `session.openDraft(text, name?)`, `session.openModel(id): boolean`, `session.openAddress(address): { notice?: string }`
  - `session.edit(text)`, `session.flush()`
  - `session.storageChanged()`, called when another tab writes
  - `session.keepMine()`, `session.loadTheirs()`, `session.saveAsNew()`
  - `session.needsLeaveWarning(): boolean`
  - `AUTOSAVE_MS = 500`

- [ ] **Step 1: Write the failing tests**

```js
test('a draft is not saved until the first edit', () => {
  s.openDraft('hello'); assert.equal(store.list().length, 0); assert.equal(s.state.status, 'draft');
  s.edit('hello!'); run500ms(); assert.equal(store.list().length, 1); assert.equal(s.state.status, 'saved');
});
test('a failed save stays failed and warns on leaving, then recovers', () => {
  /* failWrites: status 'failed', needsLeaveWarning() true; allow writes, next edit: 'saved', false */
});
test('a clean tab follows another tab silently', () => {
  s.openModel(m.id); other.save(m.id, 'theirs', m.rev); s.storageChanged();
  assert.equal(s.state.text, 'theirs'); assert.equal(s.state.status, 'saved');
});
test('unsaved edits plus an outside change is a conflict, and autosave stops', () => {
  s.openModel(m.id); s.edit('mine'); other.save(m.id, 'theirs', m.rev); s.storageChanged();
  assert.equal(s.state.status, 'conflict'); run500ms(); assert.equal(store.get(m.id).text, 'theirs');
  assert.equal(s.needsLeaveWarning(), true);
});
test('keep mine saves this text and keeps the other version as a copy', () => {
  s.keepMine();
  assert.equal(store.get(m.id).text, 'mine');
  assert.ok(store.list().some((x) => x.name === m.name + ' (other tab)'));
});
test('load theirs replaces this text', () => { /* state.text 'theirs', status 'saved' */ });
test('a model deleted elsewhere stops saving and can be saved as new', () => {
  /* storageChanged: status 'deleted'; edit + run500ms: get(id) null; saveAsNew(): new id with the text */
});
test('a link with text already saved opens that model', () => { /* openAddress play: state.id === m.id */ });
test('a link with new text opens a draft', () => { /* state.id null, list empty */ });
test('a malformed link and a missing model open a blank draft with a notice', () => {
  assert.ok(s.openAddress(parseAddress('#play=%%%', decode)).notice); assert.equal(s.state.status, 'draft');
  assert.ok(s.openAddress({ type: 'model', id: 'gone', view: {} }).notice); assert.equal(s.state.text, '');
});
test('parseAddress reads the view parts', () => { /* '#m=abc&d=context&links=1&p=workshop' */ });
test('acceptImport refuses empty, huge and binary files, and normalizes line endings', () => {
  assert.equal(acceptImport('a.dsl', new Uint8Array()).reason, 'empty');
  assert.equal(acceptImport('a.dsl', new Uint8Array(1000001).fill(97)).reason, 'too-large');
  assert.equal(acceptImport('a.dsl', Uint8Array.of(97, 0, 98)).reason, 'binary');
  assert.equal(acceptImport('Shop.dsl', Buffer.from('a\r\nb')).text, 'a\nb');
  assert.equal(acceptImport('Shop.dsl', Buffer.from('a')).name, 'Shop');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app-session.test.js`
Expected: FAIL, cannot find `site/app/session.js`.

- [ ] **Step 3: Implement `site/app/session.js`**

`decode` failures and invalid UTF-8 produce `{ type: 'invalid' }`. A finished practice attempt opens with `readOnly: true`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/app-session.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/app/session.js test/app-session.test.js
git commit -m "Add session logic for saving, conflicts and addresses"
```

---

### Task 6: The workspace page

**Files:**
- Create: `site/app/index.html`, `site/app/app.js`, `site/app/app.css`
- Modify: `test/playground.test.js`

**Interfaces:**
- Consumes: `EventlinePlayground.mount`, `createStore`, `createSession`, `parseAddress`, `acceptImport`, `exportFiles`, `zip`, `uuidv7`.
- Produces, on `window.EventlineApp` for Tasks 7 and 10: `{ store, session, playground, showNotice(text: string): void, setMode(mode: 'workspace' | 'practice'): void, setLocked(locked: boolean): void, topbarSlot: Element }`

- [ ] **Step 1: Write the failing tests in `test/playground.test.js`**

```js
test('the app has every element the playground needs and loads its modules', () => {
  const app = read('site/app/index.html');
  for (const id of requiredIds) assert.ok(app.includes(`id="${id}"`), `missing #${id}`);
  for (const src of ['../eventline.js', '../playground.js', 'store.js', 'session.js', 'zip.js', 'app.js']) assert.ok(app.includes(`src="${src}"`), src);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/playground.test.js`
Expected: FAIL, `site/app/index.html` does not exist.

- [ ] **Step 3: Build the page**

Follow the layout sketch in the spec. Mount with `{ base: '../', address: 'none', load: 'now' }`. Include:

- Layout switch for Editor, Split and Board, with Alt+1, Alt+2 and Alt+3, remembered in `sessionStorage` so two windows can differ. Below 900px, Split behaves as Editor.
- Board theme toggle, remembered in `localStorage`.
- Save status text driven by `session.state.status`, and persistent banners for `failed`, `conflict` and `deleted` with their actions.
- A `beforeunload` warning when `session.needsLeaveWarning()`.
- A `storage` listener that calls `session.storageChanged()` when `store.isModelKey(event.key)`.
- Startup: first visit opens a draft with the "Start small" text. A returning visit opens a blank draft. An address opens through `session.openAddress`. An active attempt takes priority once Task 10 exists.
- Updating the address to `#m=<id>` once a draft is saved, and keeping `&d=`, `&n=`, `&links=1` and `&p=` in sync through `onView`.
- Share button: copy `new URL(hash, location.href)` using `playground.shareHash()`, warning when the link is over 6,000 characters.
- Findings collapsed to their one-line summary, expandable.
- The Models menu: Continue with the last model, New, Open, the saved list, Rename, Duplicate, Delete with confirmation and 10-second Undo, Export all with the last export date. The list renders only when the menu opens.
- Opening `.dsl` files by file picker and by dropping on the window, through `acceptImport`, with a notice naming each refused file.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Check the workspace in a real browser**

Serve the site and confirm each of these:

1. First visit shows Start small, and nothing is saved until an edit.
2. An edit shows Saved and survives a reload through Continue.
3. A returning visit opens blank, with no model names visible until the menu opens.
4. Board layout fills the screen, the light theme applies to the board and the downloaded SVG.
5. Two windows on one model: typing in one redraws the other. Editing both shows the conflict banner, and both choices behave as specified.
6. Fill `localStorage` from the console until saves fail: the failure banner appears and Saved does not.
7. Delete and Undo work. Export all downloads a zip that `unzip -t` accepts.
8. Open and drop a `.dsl`, and a binary file.
9. At 800px wide, one pane shows at a time and the page has no horizontal scroll.

- [ ] **Step 6: Commit**

```bash
git add site/app test/playground.test.js
git commit -m "Add the modeling app workspace"
```

---

### Task 7: Autocomplete in the editor

**Files:**
- Create: `site/app/editor.js`
- Modify: `site/app/index.html`, `site/app/app.js`, `site/app/app.css`

**Interfaces:**
- Consumes: `suggest`, `namesFrom` from Task 3, `playground.textarea`, `playground.getModel()`.
- Produces: `EventlineEditor.attach(textarea: HTMLTextAreaElement, getModel: () => object | null): { destroy(): void }`

- [ ] **Step 1: Implement `attach` in `site/app/editor.js`**

Keep names from the last successful parse when the current text does not parse. Position the popup from a hidden measuring element that copies the textarea's font and padding. Insert with `document.execCommand('insertText', false, item.insert)` after selecting `from` to `to`, which keeps undo working. Use `role="combobox"` semantics on the textarea with `aria-expanded`, `aria-controls` and `aria-activedescendant`, and `role="listbox"` on the popup. Ctrl+Space forces it. Up, Down, Tab, Enter and Esc behave as the spec says, and pass through to the textarea when the popup is closed.

- [ ] **Step 2: Check it in a real browser**

Confirm: typing `vi` offers `view`; Tab inserts it with the caret at the blank; Ctrl+Z removes the insertion in one step; Enter adds a newline when the popup is closed; a name defined earlier in the model is offered; the popup stays inside the editor near the bottom and right edges; the popup does not appear in read-only mode.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add site/app
git commit -m "Add autocomplete to the app editor"
```

---

### Task 8: Connect the homepage and docs to the app

**Files:**
- Modify: `docs-site/src/code/eventline-source.mjs:33`, `docs-site/src/components/Header.astro:19`, `docs-site/src/components/Hub.astro:37`, `test/docs-site.test.js:90`, `site/index.html`, `site/playground.js`, `site/sitemap.xml`, `docs/ARCHITECTURE.md`, `README.md:62`
- Test: `test/docs-site.test.js`, `test/playground.test.js`

**Interfaces:**
- Consumes: `api.shareHash()` from Task 1.

- [ ] **Step 1: Update the failing test expectations**

```js
// test/docs-site.test.js
assert.match(href, /^\/eventline\/app\/#play=[A-Za-z0-9_-]+$/);
// test/playground.test.js
test('the homepage links to the app and the sitemap lists it', () => {
  assert.ok(html.includes('id="pg-open-app"'));
  assert.ok(read('site/sitemap.xml').includes('/eventline/app/'));
  for (const f of ['docs-site/src/components/Header.astro', 'docs-site/src/components/Hub.astro']) assert.ok(read(f).includes('/eventline/app/'), f);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/docs-site.test.js test/playground.test.js`
Expected: FAIL on the link format and the missing `pg-open-app`.

- [ ] **Step 3: Make the changes**

Point `playgroundHref`, the docs header and the docs hub at `/eventline/app/`. Add an "Open in the app" link with `id="pg-open-app"` to `.pg__out`, setting its address from `shareHash()` when clicked. Add the app to the sitemap. Describe the app's files in `docs/ARCHITECTURE.md`, and link it from `README.md`.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add site docs-site test docs/ARCHITECTURE.md README.md
git commit -m "Link the homepage and docs to the modeling app"
```

---

### Task 9: Practice rules and prompts

**Files:**
- Create: `site/app/practice.js` (global `EventlinePractice`), `site/app/prompts.json`
- Test: `test/app-practice.test.js`

**Interfaces:**
- Produces:
  - `startAttempt(promptId: string, now: number) -> Practice`
  - `Practice`: `{ promptId, status: 'running' | 'paused' | 'finished', startedAt, elapsedSeconds, lastTickAt: number | null, covered: string[], notes: string }`
  - `tick(p, now)`, `pause(p, now)`, `resume(p, now)`, `finish(p, now)`, `reopen(p)`, each returning a new `Practice`
  - `remaining(p, minutes): { seconds: number, overtime: boolean }`
  - `historyFor(summaries, promptId)`: finished attempts, newest first
  - `TICK_MS = 5000`, `MAX_GAP_MS = 15000`
- `prompts.json`: `[{ id, title, minutes, scenario, requirements: [{ id, text, covers: string[] }], reference }]`. `covers` lists command, event or view names from the reference model.

- [ ] **Step 1: Write the failing tests**

```js
test('running time accumulates across ticks', () => {
  let p = startAttempt('rate-limiter', 0); p = tick(p, 5000); p = tick(p, 10000);
  assert.equal(p.elapsedSeconds, 10);
});
test('a long gap, such as the computer sleeping, is not charged', () => {
  let p = startAttempt('rate-limiter', 0); p = tick(p, 5000); p = tick(p, 3600000); p = tick(p, 3605000);
  assert.equal(p.elapsedSeconds, 10);
});
test('paused time is not charged', () => { /* pause at 5s, resume at 60s, tick at 65s: 10 */ });
test('reopening after a reload is paused at the stored time', () => { /* reopen(running).status === 'paused' */ });
test('finished attempts stay finished', () => { /* resume(finish(p)).status === 'finished' */ });
test('time past the limit is overtime', () => { assert.deepEqual(remaining({ elapsedSeconds: 1860 }, 30), { seconds: 60, overtime: true }); });
test('the four prompts match the spec', () => {
  assert.deepEqual(prompts.map((p) => [p.reference, p.minutes]), [['rate-limiter.dsl', 30], ['payment-webhook.dsl', 30], ['billing.dsl', 45], ['twitter-pure.dsl', 45]]);
});
test('every requirement can be checked against its reference model', () => {
  for (const p of prompts) {
    const m = parse(read('site/examples/' + p.reference));
    const known = new Set([...m.commands.map((c) => c.name), ...m.events.keys(), ...m.views.map((v) => v.name)]);
    assert.ok(p.requirements.length >= 4, p.id);
    for (const r of p.requirements) { assert.ok(r.covers.length, r.id); for (const n of r.covers) assert.ok(known.has(n), `${p.id}: ${n}`); }
  }
});
```

Adjust the `known` lookup to the parser's actual shapes in `lib/model.js` if they differ.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app-practice.test.js`
Expected: FAIL, cannot find `site/app/practice.js`.

- [ ] **Step 3: Implement `site/app/practice.js` and write `site/app/prompts.json`**

Write each scenario as an interviewer's brief that does not reveal the model's event names. Write requirements from what each reference model actually covers.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/app-practice.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/app/practice.js site/app/prompts.json test/app-practice.test.js
git commit -m "Add practice rules and prompts"
```

---

### Task 10: The practice screens

**Files:**
- Create: `site/app/practice-ui.js`
- Modify: `site/app/index.html`, `site/app/app.js`, `site/app/app.css`

**Interfaces:**
- Consumes: `window.EventlineApp` from Task 6, the functions in Task 9, `EventlinePlayground.drawStatic` from Task 1, `store.activeAttempt()`.
- Produces: `EventlinePracticeUI.init(app): void`, and `EventlinePracticeUI.resumeActive(): boolean`, which `app.js` calls first at startup.

- [ ] **Step 1: Build the screens**

- **Pick:** prompts with minutes and past attempts (date, time used, requirements covered).
- **Brief:** scenario, requirements, Start.
- **Work:** the workspace with a timer in `topbarSlot`, a collapsible prompt panel, Pause, Finish and Abandon attempt. Call `tick` every `TICK_MS` and store it with `store.update`. Call `setLocked(true)` so the Models menu and new prompts are unavailable. A `#play=` address during an attempt is ignored with a notice. The reference is not fetched into the page until Finish.
- **Review:** frozen attempt, your board and the reference board side by side through `drawStatic` on a shared diagram tab, reference text read-only, findings from `eventline.check(model, { profile: 'eventmodeling' })`, the requirements checklist, notes that save as you type, and Continue in a copy.
- **Abandon:** confirm, then remove `practice` from the model so it becomes an ordinary saved model.
- Announce the timer to screen readers only at 5 minutes left, at zero, and on pause or resume.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Check a full attempt in a real browser**

Confirm:

1. Start a prompt, type, reload: the attempt reopens paused at the stored time.
2. Resume, let a short test timer reach zero by editing the attempt's minutes in dev tools: overtime counts and nothing interrupts.
3. The Models menu is locked during the attempt, and a `#play=` link shows the notice.
4. Finish: both boards draw, tabs switch both together, ticks and notes persist after a reload.
5. A finished attempt is read-only, and Continue in a copy creates an editable model.
6. Abandon leaves an ordinary model and no history entry.
7. No network request during the attempt fetches the reference file.

- [ ] **Step 4: Commit**

```bash
git add site/app
git commit -m "Add practice mode screens"
```

---

### Task 11: Editing help

**Files:**
- Create: `site/app/editing.js` (global `EventlineEditing`)
- Modify: `site/app/editor.js`, `site/app/index.html`, `site/app/app.css`, `site/playground.js` (parse error mark only)
- Test: `test/app-editing.test.js`

**Interfaces:**
- Consumes: `EventlineEditor.attach` from Task 7, which already owns the textarea's keydown handling and the suggestion popup.
- Produces:
  - `Edit`: `{ from: number, to: number, insert: string, selStart: number, selEnd: number } | null`, meaning replace `from..to` with `insert`, then select `selStart..selEnd`. `null` means let the browser handle the key.
  - `onEnter(text, selStart, selEnd) -> Edit`
  - `onTab(text, selStart, selEnd, shift: boolean) -> Edit`
  - `onType(text, selStart, selEnd, ch: string) -> Edit`, for `{ [ ( " } ] )`
  - `onBackspace(text, selStart, selEnd) -> Edit`
  - `matchBracket(text, caret) -> [number, number] | null`, the offsets of the bracket beside the caret and its partner
  - `INDENT = '  '`

- [ ] **Step 1: Write the failing tests**

```js
test('enter keeps indentation', () => { assert.equal(onEnter('  a', 3, 3).insert, '\n  '); });
test('enter adds a level after an opening brace or bracket', () => {
  assert.equal(onEnter('view V = [', 10, 10).insert, '\n  ');
  assert.equal(onEnter('system S {', 10, 10).insert, '\n  ');
});
test('enter between a pair puts the closer on its own line', () => {
  const e = onEnter('x {}', 3, 3);
  assert.equal(e.insert, '\n  \n'); assert.equal(e.selStart, 6);
});
test('a closer on a blank line removes one level', () => {
  const e = onType('a {\n    ', 8, 8, '}');
  assert.equal(e.from, 4); assert.equal(e.insert, '  }');
});
test('tab inserts two spaces, and indents or dedents a selection of lines', () => {
  assert.equal(onTab('a', 1, 1, false).insert, '  ');
  assert.equal(apply('a\nb', onTab('a\nb', 0, 3, false)), '  a\n  b');
  assert.equal(apply('  a\n  b', onTab('  a\n  b', 0, 7, true)), 'a\nb');
});
test('pairs close, step over and delete together', () => {
  assert.equal(onType('', 0, 0, '(').insert, '()');
  assert.equal(onType('()', 1, 1, ')').selStart, 2);
  assert.deepEqual([onBackspace('()', 1, 1).from, onBackspace('()', 1, 1).to], [0, 2]);
});
test('no pairing inside a comment or a string', () => {
  assert.equal(onType('// a', 4, 4, '('), null);
  assert.equal(onType('"a', 2, 2, '('), null);
});
test('typing over a selection wraps it in the pair', () => { assert.equal(apply('ab', onType('ab', 0, 2, '[')), '[ab]'); });
test('matchBracket finds partners across lines and ignores strings and comments', () => {
  assert.deepEqual(matchBracket('a { "}" // }\n}', 3), [2, 13]);
  assert.equal(matchBracket('a', 1), null);
});
```

`apply(text, edit)` is a test helper that returns the text after the edit.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app-editing.test.js`
Expected: FAIL, cannot find `site/app/editing.js`.

- [ ] **Step 3: Implement `site/app/editing.js`**

Comment and string detection uses the same rules as `site/app/complete.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/app-editing.test.js`
Expected: PASS

- [ ] **Step 5: Wire it into the editor**

In `site/app/editor.js`, when the suggestion popup is closed, route Enter, Tab, Shift+Tab, Backspace and the pair characters through these functions. Apply each `Edit` by selecting `from..to` and calling `document.execCommand('insertText', false, insert)`, then `setSelectionRange(selStart, selEnd)`, so undo keeps working. Esc followed by Tab within 1.5 seconds lets Tab move focus out of the editor. Add a sentence saying so to the textarea's description. Draw the bracket match as two outlined boxes positioned with the caret-measuring element from Task 7. In `site/playground.js`, give a `ParseError`'s `line` an error mark in `#pg-marks`, and clear it when the text parses.

- [ ] **Step 6: Check it in a real browser**

Confirm on the app page: Enter after `view V = [` indents; Enter between `{}` opens a block; Tab and Shift+Tab work on one line and on several; pairs close and step over; Ctrl+Z undoes each edit in one step; Esc then Tab leaves the editor; the bracket match shows on both sides of a pair; a syntax error marks its line on both the app page and the homepage, and the mark clears once fixed; autocomplete still accepts with Tab and Enter when its popup is open.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: all pass.

```bash
git add site test/app-editing.test.js
git commit -m "Add indentation, pairs, bracket matching and error marks to the editor"
```

---

### Task 12: Final verification

**Files:**
- Modify: only what the checks below reveal.

- [ ] **Step 1: Run the full suite and rebuild generated files**

Run: `node scripts/build-site.js && npm test && git status --short`
Expected: all tests pass, and no generated file changed.

- [ ] **Step 2: Build the docs**

Run: `npm ci && npm run build` in `docs-site/`
Expected: the build succeeds, and an "Open in playground" link in `dist/` starts with `/eventline/app/#play=`.

- [ ] **Step 3: Walk through the spec in a real browser**

Serve the site and go through the spec's "Checked in a real browser" list. Confirm no console errors on either page, and no network request carries model text.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A site test docs docs-site/src
git commit -m "Fix issues found in final verification"
```
