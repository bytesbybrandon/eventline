# Eventline modeling app: design

Date: 2026-11-18
Status: awaiting owner approval

## Intent

The eventline playground works, but it is a section of the marketing page. Work is not saved, models cannot be opened from disk, and the tool never gets the whole screen.

Turn it into a small application at `/eventline/app/` for two uses:

1. **Practice.** The owner practices eventline and system design interviews, alone, against the clock.
2. **Client sessions.** The owner sketches diagrams live on a shared screen while taking in requirements.

Client use is a stopgap until SliceRM is live. Practice is the part that lasts. Build accordingly: the client side stays minimal, and nothing here should need retiring when SliceRM arrives.

## Goals

- Go from opening the app to a readable diagram with almost no setup.
- Never lose work silently.
- Keep every model portable as a plain `.dsl` file that the CLI can read.
- Give practice sessions a prompt, a timer, and a way to see what was missed.
- Keep the homepage playground working, running the same code as the app.

## Non-goals

- Accounts, a server, sync, or collaboration.
- Requirements capture, traceability, client projects, or reviews. These belong to SliceRM.
- Drag-and-drop editing on the board. The board stays a view of the text.
- Folder models (several `.dsl` files read as one) and saving back to the opened file on disk.
- Rename across a model, find and replace, multiple cursors.
- AI feedback or automatic grading of practice attempts.
- A service worker or installable app.
- PNG or PDF export.

## Anti-goals

The work has failed, even if every feature exists, if:

- a model can disappear without the owner being told;
- model text is ever sent off the machine;
- the homepage demo regresses;
- the tool is slower to start sketching in than the current playground.

## Constraints

- `site/` is static and deployed by copying it to GitHub Pages. No server code.
- No new runtime dependencies and no new build step. `scripts/build-site.js` remains the only generator.
- The parser, checks and renderer come from `site/eventline.js`, the existing browser bundle of `lib/`.
- `npm test` must pass, including the tests in `test/site.test.js` that guard the homepage.
- Generated IDs are UUIDv7, the workspace convention.
- Desktop browsers are the target. Below 900px wide the app must remain usable, showing one pane at a time.

## Approaches considered

1. **Shared playground code, used by the homepage and a new app page. Chosen by the owner.** One copy of the code, no new tooling. It costs a careful extraction from `site/site.js`, and autocomplete is hand-built on the existing text box.
2. **Copy the playground into a separate app page.** Quickest start and no risk to the homepage, but two copies drift apart with every fix.
3. **New React and CodeMirror app.** The best editor, but it adds a framework and build pipeline and rewrites working features, for a tool SliceRM partly replaces.

If the text box proves limiting, CodeMirror can later replace the editor alone.

## Design

### Structure

| File | Purpose |
|---|---|
| `site/playground.js` | The playground, moved out of `site/site.js`: editor, highlighting, board, tracing, zoom, checks, diagram tabs. Also exposes `inlineSvg` and `traceBoard`, which the homepage's Event Modeling board uses. |
| `site/playground.css` | The `.pg*` styles moved out of `site/site.css`, plus the tokens they need. |
| `site/app/index.html`, `app.js`, `app.css` | The application shell. |
| `site/app/store.js` | Saving and loading models. Pure logic over an injected storage object. |
| `site/app/complete.js` | Autocomplete suggestions. Pure logic. |
| `site/app/zip.js` | A small writer for uncompressed zip files, used by Export all. |
| `site/app/prompts.json` | The practice prompts. |

The playground becomes a function that mounts onto a root element and takes options: starting text, whether it is read-only, which address behaviour to use, and a change callback. The homepage calls it with today's behaviour.

### The workspace

```
+--------------------------------------------------------------------------+
| eventline   [Models v] Checkout flow  Saved      Editor|Split|Board  Practice |
+------------------------------------+-------------------------------------+
| model.dsl                          | Event model  Context  Containers ...|
|                                    |                                     |
|  (editor)                          |  (board)                            |
|                                    |                                     |
+------------------------------------+-------------------------------------+
| 2 warnings, 1 hint   [findings v]          Share  Download .dsl  Download .svg |
+--------------------------------------------------------------------------+
```

- **Models menu:** new, open `.dsl` files, the saved list sorted by last edit, rename, duplicate, delete, Export all.
- **Layout switch:** Editor, Split and Board, also on a keyboard shortcut so the owner can flip layouts mid-sentence. Board fills the screen for client sessions. The choice is remembered per window for the session, so two windows can hold different layouts.
- **Board theme:** dark or light, because a shared screen or projector often reads better in light. The downloaded SVG uses the chosen theme.
- **Findings:** the existing list, collapsed to a one-line summary so the board keeps its room.
- **First run:** opens an unsaved draft holding the existing "Start small" text.
- **Returning visits (owner's decision):** open a blank unsaved draft, so no earlier client's work appears on a shared screen. The Models menu offers Continue with the last model. The saved list stays closed until the owner opens that menu. An active practice attempt is the one exception, and reopens paused.

### Saving

- Each model is stored in `localStorage` under its own key, with an index of names and dates: `{ id, name, text, createdAt, updatedAt, practice? }`.
- Edits save automatically about half a second after typing stops. The top bar shows Saved, Saving, or a failure.
- **If a save fails** (storage full or blocked), the app says so in a banner that stays until a save succeeds, and offers Download .dsl. It never reports Saved when it did not save.
- **Drafts:** a model opened from a link, and the first-run model, stay unsaved drafts until the first edit. Trying docs examples does not fill the saved list.
- **Two windows on one model** are a supported setup for client sessions: type in one window and share the other in Board layout.
  - A tab with no unsaved edits follows the other tab silently, and its board redraws.
  - A conflict exists only when this tab has unsaved edits and the stored model changed. Autosave then stops, the status reads "Not saved: changed in another tab", and a banner offers two choices.
  - **Keep this one** saves this tab's text to the model and keeps the other version as a new model named "<name> (other tab)".
  - **Load that version** replaces this tab's text, discarding its unsaved edits by that explicit choice.
  - Closing a tab during a conflict or a failed save triggers the browser's leave-page warning.
  - If another tab deletes the open model, autosave stops and a banner offers "Save as a new model". A deleted model never comes back on its own.
- **Delete** asks for confirmation, then offers Undo for ten seconds.
- **Backup:** browser storage can be cleared, so Export all downloads a zip of every model as `.dsl`. The Models menu shows the date of the last export.
- A new model is named from its `system` block when it has one, otherwise "Untitled".

### Opening and sharing

- Open `.dsl` through a file picker or by dropping files on the window. Each file becomes a saved model named after the file. Files that do not parse still open, with the error shown as usual.
- Share copies a link in the existing `#play=<base64url>` form, so the model travels in the address and is never sent to a server. Links over 6,000 characters show a warning that some apps cut long links, and suggest Download .dsl.
- Opening an app link with `#play=` shows the saved model with identical text if there is one. Otherwise it opens an unsaved draft. On the first edit the draft is saved and the address becomes `#m=<id>`, so a reload does not create another copy.
- The address can also carry `&d=`, `&n=`, `&links=1` and `&p=`, as the playground does today.
- Existing links to `/eventline/#play=...` keep working on the homepage.
- The docs' "Open in playground" links, the docs header link and the docs hub button point at the app.
- The homepage playground gains an "Open in the app" link that carries the current model.

### Faster typing

Suggestions appear in the existing text box:

- **Names already in the model:** events, commands, views, boundaries and actors, drawn from the last successful parse.
- **Keywords and snippets:** `system`, `actor`, `boundary`, `view`, `context`, `scenario`, plus command and policy templates with the cursor placed at the first blank.
- Shown after two typed characters or on Ctrl+Space. Up and Down move, Tab or Enter accepts, Esc dismisses.
- Accepting a suggestion must keep the browser's undo history working.
- The list is announced to screen readers as a combobox popup.

### Practice mode

**Pick.** Practice opens a list of prompts, each with its suggested time and the owner's past attempts.

**Brief.** The prompt shows the scenario and the requirements. Start begins the timer and opens a blank model.

**Work.** The workspace, with a timer in the top bar and the prompt in a collapsible panel. The reference model is not reachable during an attempt.

- The timer counts accumulated running time, not wall-clock time. It stores progress every few seconds.
- It can be paused. Closing the tab, reloading, or the computer sleeping pauses it at the last stored progress, and the attempt reopens paused with a Resume button.
- At zero it does not interrupt. It turns into an overtime count, and the time is recorded.
- Finish is available at any time.
- Only one attempt can be active. While it is active, the Models menu and starting another prompt are unavailable, and opening the app returns to the attempt. A shared link opened during an attempt is ignored with a notice saying why.
- **Abandon attempt** asks for confirmation, then turns the attempt into an ordinary saved model. It does not appear in practice history.

**Review.** Finishing freezes the attempt and opens a review screen:

- Your board and the reference board side by side, on the same diagram tab.
- The reference text, read-only.
- Findings for your model under the `eventmodeling` profile.
- The requirements as a checklist that the owner ticks honestly. There is no automatic scoring.
- A free-text notes field.

**History.** Each attempt is a saved model with `practice: { promptId, status, startedAt, elapsedSeconds, covered, notes }`, where `status` is `running`, `paused` or `finished`. Overtime is `elapsedSeconds` beyond the prompt's time. History lists finished attempts only. Finished attempts stay read-only, and "Continue in a copy" makes an ordinary model from one. In Export all, an attempt is exported as its `.dsl` text only.

**Prompts.** `site/app/prompts.json` holds `{ id, title, minutes, scenario, requirements[], reference }`. `reference` names a file in `site/examples/`. The first four are built from the existing examples:

| Prompt | Reference | Minutes |
|---|---|---|
| Rate limiter | `rate-limiter.dsl` | 30 |
| Payment webhook | `payment-webhook.dsl` | 30 |
| Billing | `billing.dsl` | 45 |
| Twitter-style feed | `twitter-pure.dsl` | 45 |

Requirements are written from what each reference model actually covers, so a tick can be checked against it. The owner reviews the wording before release.

### Behaviour without a connection

The parser, examples and prompts are fetched when the app opens, so an open tab keeps working if the connection drops. Reloading while offline is not supported.

## Testing

Automated, with Node's test runner in the existing style:

- Store: save, load, delete and undo, failed saves, identical-text link imports, changes from another tab.
- Autocomplete: suggestions for names, keywords and snippets.
- Zip: output can be read back and holds the exact model text.
- Prompts: every reference exists and parses, and every prompt has requirements and a time.
- Site wiring: the homepage and the app both load the shared playground, and the docs links point at the app.

Checked in a real browser before release:

- The homepage playground, its board tracing and its existing links.
- A full practice attempt, including a reload mid-attempt.
- A full client flow: new model, Board layout, light theme, SVG download.
- A failed save, and two tabs editing one model.

## Decisions made by the designer

The owner chose the approach and the scope. These details were settled during design and can be changed on review:

- The address `/eventline/app/`.
- The time for each prompt.
- Self-ticked requirements instead of automatic comparison.
- Attempts being read-only after Finish.
- Export all as a zip of `.dsl` files, without practice history.
- A pausable timer, and overtime instead of a hard stop.
- Two windows on one model as the client-session setup, with a clean tab following silently.
- How two-tab conflicts resolve, including keeping the other version as a copy.
- Time away from an attempt not counting against the clock.
- One active attempt at a time, and abandoned attempts staying out of history.
- Models opened from links staying unsaved until the first edit.

## Left to the builder

- How to divide the extraction from `site/site.js` into safe steps.
- Exact visual treatment, within the existing eventline look.
- Internal module shapes, storage key names and keyboard shortcuts beyond those listed.
- Updating `docs/ARCHITECTURE.md`, `site/sitemap.xml` and the test that fixes the docs link format.
