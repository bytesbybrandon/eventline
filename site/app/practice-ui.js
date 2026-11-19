/* The practice screens: pick a prompt, read the brief, work against the timer, then review against the reference.
   The rules live in practice.js; this file only draws them and stores what they return. */
(() => {
  'use strict';

  const P = window.EventlinePractice;
  const NOTES_MS = 500;
  const FIVE_MINUTES = 300;
  const KINDS = [['eventmodel', 'Event model'], ['context', 'Context'], ['containers', 'Containers'], ['dataflow', 'Data flow'], ['deployment', 'Deployment'], ['contextmap', 'Context map']];
  const SEV = { error: 0, warn: 1, info: 2 };
  const SEV_LABEL = { error: 'Error', warn: 'Warning', info: 'Hint' };

  const $ = (s) => document.querySelector(s);
  // Every string from a prompt or a model goes in as text, never as HTML.
  const el = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const button = (text, onClick, className = 'btn btn--quiet') => {
    const b = el('button', { type: 'button', className }, text);
    b.addEventListener('click', onClick);
    return b;
  };
  const clockText = (sec) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
  const dateText = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  /* Prompts and every reference are read into memory when the app opens, so an attempt survives a dropped connection.
     A reference is only put on the page after Finish. */
  let prompts = [];
  let loadFailed = false;
  const refs = new Map();
  const loaded = fetch('prompts.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((list) => Promise.all(list.map((p) => fetch('../examples/' + p.reference)
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => { if (text !== null) refs.set(p.reference, text); }, () => {}))).then(() => { prompts = list; }))
    .catch(() => { loadFailed = true; });
  const promptFor = (id) => prompts.find((p) => p.id === id) || null;

  let app = null;
  let active = null;     // { id, practice } for the running or paused attempt; every change goes through save()
  let clock = 0;
  let lastLeft = null;   // seconds left at the last paint, to announce crossings only
  let warnedTick = false;
  let flushNotes = () => {};

  const say = (text) => { $('#ap-say').textContent = text; };

  function ask(title, text, ok) {
    const dialog = $('#ap-confirm');
    $('#ap-confirm-title').textContent = title;
    $('#ap-confirm-text').textContent = text;
    $('#ap-confirm-ok').textContent = ok;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
  }

  /* --------------------------------------------------------------- screens -- */
  function showScreen(...kids) {
    app.setMode('practice');
    const host = $('#ap-practice');
    host.replaceChildren(...kids);
    host.scrollTop = 0;
    const h = host.querySelector('h1');
    if (h) { h.tabIndex = -1; h.focus(); }
  }
  function toWorkspace() {
    flushNotes();
    $('#ap-practice').replaceChildren(); // nothing from a review stays in the page on a shared screen
    app.setMode('workspace');
    paintSlot();
    app.playground.textarea.focus();
  }

  async function showPick() {
    flushNotes();
    showScreen(el('p', { className: 'ap-pr__note', textContent: 'Loading the prompts.' }));
    await loaded;
    if (document.body.dataset.mode !== 'practice') return;
    const back = button('Back to the workspace', toWorkspace);
    if (loadFailed) {
      showScreen(el('div', { className: 'ap-pr__head' }, el('h1', { textContent: 'Practice' }), back),
        el('p', { className: 'ap-pr__note', textContent: 'The prompts could not be loaded. Check your connection and reload.' }));
      return;
    }
    const summaries = app.store.list();
    showScreen(
      el('div', { className: 'ap-pr__head' }, el('h1', { textContent: 'Practice' }), back),
      el('p', { className: 'ap-pr__note', textContent: 'Pick a prompt, model it against the clock, then compare with a reference model.' }),
      el('ul', { className: 'ap-pr__prompts' }, ...prompts.map((p) => {
        const past = P.historyFor(summaries, p.id);
        return el('li', { className: 'ap-pr__box' },
          el('h2', { textContent: p.title }),
          el('p', { className: 'ap-pr__meta', textContent: p.minutes + ' minutes, ' + p.requirements.length + ' requirements' }),
          button('Read the brief', () => showBrief(p)),
          past.length
            ? el('ul', { className: 'ap-pr__past', ariaLabel: 'Past attempts at ' + p.title }, ...past.map((m) => el('li', {},
              button(dateText(m.practice.startedAt) + ', ' + clockText(m.practice.elapsedSeconds) + ' used, '
                + m.practice.covered.length + ' of ' + p.requirements.length + ' covered', () => showReview(m.id), 'ap-pr__link'))))
            : el('p', { className: 'ap-pr__meta', textContent: 'No finished attempts yet.' }));
      })));
  }

  function showBrief(p) {
    showScreen(
      el('div', { className: 'ap-pr__head' }, el('h1', { textContent: p.title }), button('Back to prompts', showPick)),
      el('p', { className: 'ap-pr__meta', textContent: p.minutes + ' minutes. The timer starts when you press Start, and you can pause it.' }),
      el('h2', { textContent: 'Scenario' }),
      el('p', { className: 'ap-pr__text', textContent: p.scenario }),
      el('h2', { textContent: 'Requirements' }),
      el('ul', { className: 'ap-pr__reqs' }, ...p.requirements.map((r) => el('li', { textContent: r.text }))),
      el('div', { className: 'ap-pr__acts' }, button('Start', () => start(p), 'btn btn--go')));
  }

  /* ------------------------------------------------------------------ work -- */
  function start(p) {
    if (app.store.activeAttempt()) { app.showNotice('Another attempt is already active. Reload to return to it.'); return; }
    if (!app.canLeave()) return;
    const created = app.store.create({ name: p.title + ' practice', text: '', practice: P.startAttempt(p.id, Date.now()) });
    if (!created.ok) { app.showNotice('The attempt could not start: browser storage is full or blocked.'); return; }
    active = { id: created.model.id, practice: created.model.practice };
    app.openModel(active.id);
    startWork();
    app.playground.textarea.focus();
  }

  function save(practice, failText) {
    const result = app.store.update(active.id, { practice });
    if (result.ok) { active.practice = practice; warnedTick = false; return true; }
    if (result.reason === 'deleted') { endWork(); app.showNotice('The attempt was deleted in another tab.'); return false; }
    if (failText) app.showNotice(failText);
    else if (!warnedTick) { warnedTick = true; app.showNotice('Timer progress could not be saved. Browser storage is full or blocked.'); }
    return false;
  }

  function startWork() {
    app.setLocked(true);
    app.setMode('workspace');
    lastLeft = null;
    paintSlot();
    clearInterval(clock);
    clock = setInterval(onClock, 1000);
    loaded.then(() => { if (active) { paintPrompt(); onClock(); } });
  }
  function endWork() {
    active = null;
    clearInterval(clock);
    app.setLocked(false);
    $('#ap-prompt').hidden = true;
    $('#ap-prompt-body').replaceChildren();
    paintSlot();
  }

  function paintPrompt() {
    const p = promptFor(active.practice.promptId);
    if (!p) return;
    $('#ap-prompt-title').textContent = 'Prompt: ' + p.title;
    $('#ap-prompt-body').replaceChildren(
      el('p', { className: 'ap-pr__text', textContent: p.scenario }),
      el('ul', { className: 'ap-pr__reqs' }, ...p.requirements.map((r) => el('li', { textContent: r.text }))));
    $('#ap-prompt').hidden = false;
  }

  function paintSlot() {
    const slot = app.topbarSlot;
    if (!active) { slot.replaceChildren(button('Practice', showPick)); return; }
    const running = active.practice.status === 'running';
    slot.replaceChildren(
      el('span', { className: 'ap-timer', id: 'ap-timer' }),
      button(running ? 'Pause' : 'Resume', togglePause, running ? 'btn btn--quiet' : 'btn btn--go'),
      button('Finish', finishAttempt),
      button('Abandon attempt', abandonAttempt));
    paintTimer(Date.now());
  }

  function paintTimer(now) {
    const timer = $('#ap-timer');
    if (!timer || !active) return;
    const p = active.practice;
    const shown = P.tick(p, now); // what the clock reads now; it is stored only every TICK_MS
    const prompt = promptFor(p.promptId);
    const paused = p.status === 'paused' ? 'Paused, ' : '';
    if (!prompt) { timer.textContent = paused + clockText(shown.elapsedSeconds) + ' used'; return; }
    const left = P.remaining(shown, prompt.minutes);
    timer.textContent = paused + clockText(left.seconds) + (left.overtime ? ' over' : ' left');
    timer.toggleAttribute('data-over', left.overtime);
    const secs = left.overtime ? -left.seconds : left.seconds;
    if (lastLeft !== null && lastLeft > FIVE_MINUTES && secs <= FIVE_MINUTES && secs > 0) say('5 minutes left.');
    if (lastLeft !== null && lastLeft > 0 && secs <= 0) say('Time is up. The timer now counts overtime.');
    lastLeft = secs;
  }

  function onClock() {
    if (!active) return;
    const now = Date.now();
    const p = active.practice;
    // Hidden tabs do not tick: time away is not charged once the gap passes MAX_GAP_MS.
    if (p.status === 'running' && !document.hidden && now - p.lastTickAt >= P.TICK_MS) save(P.tick(p, now));
    paintTimer(now);
  }

  function togglePause() {
    const p = active.practice;
    const now = Date.now();
    const next = p.status === 'running' ? P.pause(p, now) : P.resume(p, now);
    if (!save(next, 'The timer could not be ' + (next.status === 'running' ? 'resumed' : 'paused') + ': browser storage is full or blocked.')) return;
    say(next.status === 'running' ? 'Timer resumed.' : 'Timer paused.');
    paintSlot();
    const again = app.topbarSlot.querySelector('button');
    if (again) again.focus();
  }

  async function finishAttempt() {
    if (!await ask('Finish this attempt?', 'The model becomes read-only and the reference model opens beside it.', 'Finish')) return;
    if (!active || !app.canLeave()) return; // canLeave also hands the last keystrokes to the store
    const id = active.id;
    if (!save(P.finish(active.practice, Date.now()), 'The attempt could not be finished: browser storage is full or blocked.')) return;
    endWork();
    app.session.storageChanged(); // store.update fires no storage event in this tab
    showReview(id);
  }

  async function abandonAttempt() {
    if (!await ask('Abandon this attempt?', 'The timer stops and the model is kept as an ordinary saved model. It will not appear in practice history.', 'Abandon')) return;
    if (!active || !app.canLeave()) return;
    const result = app.store.update(active.id, { practice: null });
    if (!result.ok && result.reason !== 'deleted') { app.showNotice('The attempt could not be abandoned: browser storage is full or blocked.'); return; }
    endWork();
    app.session.storageChanged();
    if (result.ok) app.showNotice('Attempt abandoned. ' + result.model.name + ' is now an ordinary saved model.');
  }

  /* ---------------------------------------------------------------- review -- */
  function findings(text) {
    const lib = window.eventline;
    try {
      const issues = [...lib.check(lib.parse(text), { profile: 'eventmodeling' })]
        .sort((x, y) => SEV[x.severity] - SEV[y.severity] || (Number(x.line) || 1e9) - (Number(y.line) || 1e9));
      return issues.map((i) => (SEV_LABEL[i.severity] || i.severity) + (Number(i.line) > 0 ? ', line ' + i.line : '') + ': ' + i.message);
    } catch (err) { return ['The model does not parse: ' + err.message]; }
  }

  async function showReview(id) {
    flushNotes();
    await loaded;
    const model = app.store.get(id);
    if (!model || !model.practice || model.practice.status !== 'finished') { app.showNotice('That attempt is no longer saved in this browser.'); showPick(); return; }
    let practice = model.practice;
    const prompt = promptFor(practice.promptId);
    const reference = prompt ? refs.get(prompt.reference) : undefined;
    const title = prompt ? prompt.title : model.name;

    const update = (change, failText) => {
      const next = { ...practice, ...change };
      const result = app.store.update(id, { practice: next });
      if (result.ok) practice = next; else app.showNotice(failText);
      return result.ok;
    };

    // Time used
    let used = 'Time used ' + clockText(practice.elapsedSeconds);
    if (prompt) {
      const left = P.remaining(practice, prompt.minutes);
      used += ' of ' + prompt.minutes + ' minutes' + (left.overtime ? ', ' + clockText(left.seconds) + ' over.' : '.');
    } else used += '.';

    // Boards
    const mine = el('div', { className: 'ap-pr__draw' });
    const theirs = el('div', { className: 'ap-pr__draw' });
    const theme = $('#pg').dataset.board === 'light' ? 'light' : 'dark';
    const boards = el('div', { className: 'ap-pr__boards' },
      el('section', { className: 'ap-pr__box ap-pr__board', ariaLabel: 'Your model' }, el('h2', { textContent: 'Your model' }), mine),
      el('section', { className: 'ap-pr__box ap-pr__board', ariaLabel: 'Reference model' }, el('h2', { textContent: 'Reference' }), theirs));
    boards.dataset.board = theme;
    const kinds = KINDS.map(([kind, label]) => button(label, () => draw(kind)));
    function draw(kind) {
      kinds.forEach((b, i) => b.setAttribute('aria-pressed', String(KINDS[i][0] === kind)));
      for (const [host, text, missing] of [[mine, model.text, ''], [theirs, reference, 'The reference model could not be loaded. Check your connection and reload.']]) {
        if (text == null) { host.replaceChildren(el('p', { className: 'ap-pr__note', textContent: missing })); continue; }
        window.EventlinePlayground.drawStatic(host, text, kind, theme, '../').then((ok) => {
          if (!ok) host.replaceChildren(el('p', { className: 'ap-pr__note', textContent: text.trim() ? 'This diagram cannot be drawn from this model.' : 'This model is empty.' }));
        });
      }
    }

    // Requirements
    const checklist = prompt
      ? el('ul', { className: 'ap-pr__checks' }, ...prompt.requirements.map((r) => {
        const box = el('input', { type: 'checkbox', checked: practice.covered.includes(r.id) });
        box.addEventListener('change', () => {
          const covered = box.checked ? [...practice.covered.filter((x) => x !== r.id), r.id] : practice.covered.filter((x) => x !== r.id);
          if (!update({ covered }, 'That tick could not be saved: browser storage is full or blocked.')) box.checked = !box.checked;
        });
        return el('li', {}, el('label', {}, box, el('span', { textContent: r.text })));
      }))
      : el('p', { className: 'ap-pr__note', textContent: 'The prompt for this attempt is no longer available.' });

    // Notes
    const notes = el('textarea', { className: 'ap-pr__notes', id: 'ap-pr-notes', value: practice.notes || '', rows: 6 });
    const noteState = el('span', { className: 'ap-pr__meta', ariaLive: 'polite' });
    let timer = 0;
    flushNotes = () => {
      if (!timer) return;
      clearTimeout(timer); timer = 0;
      noteState.textContent = update({ notes: notes.value }, 'Your notes could not be saved: browser storage is full or blocked.') ? 'Saved' : 'Not saved';
    };
    notes.addEventListener('input', () => {
      noteState.textContent = 'Saving';
      clearTimeout(timer);
      timer = setTimeout(flushNotes, NOTES_MS);
    });

    const open = () => { flushNotes(); if (!app.canLeave()) return; app.openModel(id); toWorkspace(); };
    const copy = () => {
      flushNotes();
      if (!app.canLeave()) return;
      const created = app.store.create({ text: model.text });
      if (!created.ok) { app.showNotice('The copy could not be made: browser storage is full or blocked.'); return; }
      app.openModel(created.model.id);
      toWorkspace();
    };

    const list = findings(model.text);
    showScreen(
      el('div', { className: 'ap-pr__head' }, el('h1', { textContent: 'Review: ' + title }),
        el('div', { className: 'ap-pr__acts' }, button('Continue in a copy', copy, 'btn btn--go'), button('Open read-only', open), button('Back to prompts', showPick))),
      el('p', { className: 'ap-pr__meta', textContent: used }),
      el('div', { className: 'ap-pr__kinds', role: 'group', ariaLabel: 'Diagram for both boards' }, ...kinds),
      boards,
      el('div', { className: 'ap-pr__cols' },
        el('section', { className: 'ap-pr__box' }, el('h2', { textContent: 'Requirements you covered' }), checklist),
        el('section', { className: 'ap-pr__box' }, el('h2', {}, el('label', { htmlFor: 'ap-pr-notes', textContent: 'Notes' })), notes, noteState),
        el('section', { className: 'ap-pr__box' }, el('h2', { textContent: 'Findings, Event Modeling checks' }),
          list.length ? el('ul', { className: 'ap-pr__findings' }, ...list.map((t) => el('li', { textContent: t }))) : el('p', { className: 'ap-pr__note', textContent: 'No findings.' })),
        el('section', { className: 'ap-pr__box' }, el('h2', { textContent: 'Reference text' }),
          reference == null ? el('p', { className: 'ap-pr__note', textContent: 'The reference model could not be loaded.' }) : el('pre', { className: 'ap-pr__ref', textContent: reference }))));
    draw('eventmodel');
  }

  /* ------------------------------------------------------------- lifecycle -- */
  function resumeActive() {
    const { store, session } = window.EventlineApp;
    const model = store.activeAttempt();
    if (!model) return false;
    const practice = P.reopen(model.practice); // time since the last stored tick is not charged
    store.update(model.id, { practice });
    active = { id: model.id, practice };
    session.openModel(model.id);
    return true;
  }

  function init(a) {
    app = a;
    app.setMode('workspace');
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      flushNotes();
      if (active && active.practice.status === 'running') save(P.tick(active.practice, Date.now())); // charge time up to hiding
    });
    window.addEventListener('pagehide', () => flushNotes());
    if (active) startWork(); else paintSlot();
  }

  window.EventlinePracticeUI = { init, resumeActive };
})();
