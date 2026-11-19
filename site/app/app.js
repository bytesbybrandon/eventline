/* The workspace page: wires the playground, the store, the session and the zip writer together. */
(() => {
  'use strict';

  const { createStore, uuidv7, modelName } = window.EventlineStore;
  const { createSession, parseAddress, decodePlayText, acceptImport } = window.EventlineSession;
  const { exportFiles, zip } = window.EventlineZip;

  const UNDO_MS = 10000;
  const NOTICE_MS = 10000;
  const LONG_LINK = 6000;
  const LAYOUT_KEY = 'eventline.app.layout';
  const THEME_KEY = 'eventline.app.theme';
  const LAYOUTS = ['editor', 'split', 'board'];

  const $ = (s) => document.querySelector(s);
  const el = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const button = (text, onClick, props) => {
    const b = el('button', { type: 'button', className: 'btn btn--quiet', ...props }, text);
    b.addEventListener('click', onClick);
    return b;
  };

  /* ------------------------------------------------------------- storage -- */
  function memoryStorage() {
    const items = new Map();
    return {
      get length() { return items.size; },
      key: (i) => [...items.keys()][i] ?? null,
      getItem: (k) => (items.has(k) ? items.get(k) : null),
      setItem: (k, v) => { items.set(k, String(v)); },
      removeItem: (k) => { items.delete(k); },
    };
  }
  let storage;
  let persistent = true; // false when models only live in this tab's memory, so nothing may read as Saved
  try { storage = window.localStorage; storage.getItem(THEME_KEY); } catch { storage = memoryStorage(); persistent = false; }

  const pref = (area, key) => { try { return window[area].getItem(key); } catch { return null; } };
  const setPref = (area, key, value) => { try { window[area].setItem(key, value); } catch { /* a preference is not worth a warning */ } };

  const store = createStore(storage, {
    now: Date.now,
    uuid: () => uuidv7(Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n))),
  });

  /* ------------------------------------------------------------- notices -- */
  function showNotice(text, opts = {}) {
    const box = el('div', { className: 'ap-notice' }, el('span', { textContent: text }));
    let timer = 0;
    const close = () => { clearTimeout(timer); box.remove(); };
    if (opts.action) box.append(button(opts.action, () => { close(); opts.onAction(); }));
    box.append(button('Dismiss', close));
    $('#ap-notices').append(box);
    timer = setTimeout(close, opts.ms || NOTICE_MS);
  }

  /* ------------------------------------------------------------- session -- */
  let playground = null;
  let shown = null;      // the session state last painted
  let playDraft = null;  // the #play link an unsaved draft came from, so a reload finds it again
  let locked = false;
  let writtenHash = location.hash;

  const session = createSession({
    store,
    modelName,
    schedule: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    onChange: (state) => { if (shown) paint(state); },
  });

  /* The playground tells the session about typing 140ms late, so anything leaving the model asks the editor directly. */
  function sync() {
    const text = playground.getText();
    if (text !== session.state.text) session.edit(text);
    session.flush();
  }
  function canLeave() {
    sync();
    if (!session.needsLeaveWarning()) return true;
    showNotice('This model has unsaved work. Resolve the banner at the top before opening another model.');
    return false;
  }

  /* ------------------------------------------------------------- address -- */
  function addressHash() {
    const state = session.state;
    const head = state.id ? 'm=' + state.id : (playDraft && playDraft.text === state.text ? playDraft.head : '');
    if (!head) return '';
    const view = playground.getView();
    let hash = '#' + head;
    if (view.kind !== 'eventmodel') hash += '&d=' + view.kind;
    if (view.node) hash += '&n=' + encodeURIComponent(view.node);
    if (view.links) hash += '&links=1';
    if (view.profile !== 'core') hash += '&p=' + view.profile;
    return hash;
  }
  function syncAddress() {
    const hash = addressHash();
    writtenHash = hash;
    if (hash !== location.hash) history.replaceState(null, '', hash || location.pathname + location.search);
  }
  function openAddress(address) {
    playDraft = address.type === 'play' ? { head: location.hash.slice(1).split('&')[0], text: address.text } : null;
    return session.openAddress(address).notice;
  }

  /* --------------------------------------------------------------- paint -- */
  const LABELS = {
    draft: 'Draft', saving: 'Saving', saved: 'Saved', failed: 'Not saved',
    conflict: 'Not saved: changed in another tab', deleted: 'Not saved: deleted in another tab',
  };
  function statusLabel(state) {
    if (!persistent && state.status !== 'conflict' && state.status !== 'deleted') return 'Not saved: storage unavailable';
    return LABELS[state.status];
  }
  function bannerFor(state) {
    const download = ['Download .dsl', () => $('#pg-dsl').click()];
    if (state.theirs) {
      return {
        text: state.status === 'failed' ? 'This model could not be saved, and it also changed in another tab.' : 'This model changed in another tab.',
        actions: [['Keep this one', () => session.keepMine()], ['Load that version', () => session.loadTheirs()], download],
      };
    }
    if (state.status === 'deleted') return { text: 'This model was deleted in another tab.', actions: [['Save as a new model', () => session.saveAsNew()], download] };
    if (state.status === 'failed') {
      const retry = () => {
        session.edit(session.state.text);
        session.flush();
        if (session.state.status === 'failed') showNotice('Still could not save. Free some browser storage or download the model.');
      };
      return { text: 'This model is not saved. Browser storage is full or blocked.', actions: [['Try again', retry], download] };
    }
    if (!persistent) return { text: 'Browser storage is unavailable, so nothing here survives closing this tab.', actions: [download] };
    return null;
  }
  let bannerText = null;
  function paintBanner(state) {
    const banner = bannerFor(state);
    const text = banner ? banner.text : null;
    if (text === bannerText) return;
    bannerText = text;
    const host = $('#ap-banners');
    const hadFocus = host.contains(document.activeElement);
    host.replaceChildren();
    if (banner) {
      host.append(el('div', { className: 'ap-banner', role: 'alert' }, el('p', { textContent: banner.text }),
        ...banner.actions.map(([label, act]) => button(label, act))));
    }
    if (hadFocus) playground.textarea.focus();
  }
  function paint(state) {
    // Only a change of the session's own text may touch the editor: a save landing mid-typing must not rewind it.
    if (state.text !== shown.text && state.text !== playground.getText()) playground.setText(state.text, false);
    if (state.readOnly !== shown.readOnly) playground.setReadOnly(state.readOnly);
    if (state.id && state.id !== shown.id) store.setMeta({ lastOpenedId: state.id });
    shown = state;
    $('#ap-name').textContent = state.name;
    document.title = state.name + ' - eventline';
    const save = $('#ap-save');
    save.textContent = statusLabel(state);
    save.toggleAttribute('data-bad', !persistent || ['failed', 'conflict', 'deleted'].includes(state.status));
    paintBanner(state);
    syncAddress();
  }

  /* -------------------------------------------------------------- layout -- */
  const grid = $('#pg');
  const narrow = matchMedia('(max-width: 899.98px)');
  let layout = LAYOUTS.includes(pref('sessionStorage', LAYOUT_KEY)) ? pref('sessionStorage', LAYOUT_KEY) : 'split';
  function paintLayout() {
    const effective = layout === 'split' && narrow.matches ? 'editor' : layout;
    grid.dataset.layout = effective;
    document.querySelectorAll('.ap-layout [data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === effective)));
    if (playground) playground.setView({}); // fit-to-width depends on the pane's new size
  }
  function setLayout(next) { layout = next; setPref('sessionStorage', LAYOUT_KEY, next); paintLayout(); }
  document.querySelectorAll('.ap-layout [data-layout]').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));
  narrow.addEventListener('change', paintLayout);
  window.addEventListener('keydown', (ev) => {
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(ev.code); // Option+digit types a character on macOS, so match the key
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || i < 0) return;
    ev.preventDefault();
    setLayout(LAYOUTS[i]);
  });

  let theme = pref('localStorage', THEME_KEY) === 'light' ? 'light' : 'dark';
  function paintTheme() {
    grid.dataset.board = theme;
    $('#ap-theme').setAttribute('aria-pressed', String(theme === 'light'));
  }
  $('#ap-theme').addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    setPref('localStorage', THEME_KEY, theme);
    paintTheme();
    playground.setTheme(theme);
  });

  /* ------------------------------------------------------- models actions -- */
  const menu = $('#ap-menu');
  const closeMenu = () => { if (menu.matches(':popover-open')) menu.hidePopover(); };
  const reopenMenu = () => { if (menu.matches(':popover-open')) renderMenu(); else menu.showPopover(); }; // a modal dialog closes the menu
  // Opening a model from a practice screen returns to the workspace, saving any review notes on the way.
  const showWorkspace = () => { if (document.body.dataset.mode === 'practice') window.EventlinePracticeUI.leave(); };
  const toEditor = () => { closeMenu(); showWorkspace(); playground.textarea.focus(); };
  const dateText = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  function ask(dialog) {
    dialog.returnValue = ''; // a dialog keeps its last answer, and Esc would otherwise repeat it
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  }
  function openSaved(id) {
    if (!canLeave()) return;
    playDraft = null;
    if (!session.openModel(id)) { showNotice('That model is no longer saved in this browser.'); return; }
    toEditor();
  }
  function newModel() {
    if (!canLeave()) return;
    playDraft = null;
    session.openDraft('');
    toEditor();
  }
  // Not a submit button: Enter in the name field presses the form's first submit button.
  $('#ap-rename-cancel').addEventListener('click', () => $('#ap-rename').close('cancel'));
  async function renameModel(item) {
    const input = $('#ap-rename-input');
    input.value = item.name;
    const answer = await ask($('#ap-rename'));
    const name = input.value.trim();
    if (answer === 'rename' && name) {
      const result = store.update(item.id, { name });
      if (result.ok) session.storageChanged(); // storage events skip the tab that wrote
      else showNotice('Could not rename ' + item.name + '.');
    }
    reopenMenu();
  }
  function duplicateModel(item) {
    sync();
    if (!store.duplicate(item.id).ok) showNotice('Could not duplicate ' + item.name + '.');
    renderMenu();
  }
  async function deleteModel(item) {
    $('#ap-delete-name').textContent = item.name;
    const answer = await ask($('#ap-delete'));
    if (answer !== 'delete') { reopenMenu(); return; }
    const wasOpen = session.state.id === item.id;
    if (wasOpen && !canLeave()) return;
    const result = store.remove(item.id);
    if (!result.ok) { showNotice('Could not delete ' + item.name + '.'); return; }
    if (wasOpen) { playDraft = null; session.openDraft(''); }
    showNotice('Deleted ' + item.name + '.', {
      action: 'Undo',
      ms: UNDO_MS,
      onAction() {
        if (!result.restore().ok) { showNotice('Could not restore ' + item.name + '. Browser storage is full or blocked.'); return; }
        if (wasOpen && session.state.id === null && !session.state.text) session.openModel(item.id);
      },
    });
    reopenMenu();
  }
  function exportAll() {
    sync();
    try {
      const models = store.list().map((m) => store.get(m.id)).filter(Boolean);
      if (!models.length) { showNotice('There are no saved models to export yet.'); return; }
      const bytes = zip(exportFiles(models));
      const a = el('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })), download: 'eventline-models.zip' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      store.setMeta({ lastExportAt: Date.now() });
      renderMenu();
    } catch (err) {
      showNotice('Export failed, so nothing was downloaded: ' + err.message);
    }
  }

  /* The list exists only while the menu is open, so no model name sits in the page on a shared screen. */
  function renderMenu() {
    const meta = store.meta();
    const last = meta.lastOpenedId ? store.get(meta.lastOpenedId) : null;
    const items = store.list();
    const acts = el('div', { className: 'ap-menu__acts' },
      button(last ? 'Continue with ' + last.name : 'Continue', () => openSaved(last.id), { disabled: !last }),
      button('New', newModel),
      button('Open', () => { if (canLeave()) $('#ap-file').click(); }),
      button('Export all', exportAll));
    const note = el('p', { className: 'ap-menu__note', textContent: meta.lastExportAt ? 'Last export: ' + dateText(meta.lastExportAt) : 'Not exported yet' });
    const list = el('ul', { className: 'ap-list', ariaLabel: 'Saved models' }, ...items.map((item) => el('li', { className: 'ap-row' },
      (() => {
        const open = el('button', { type: 'button', className: 'ap-row__open' },
          el('span', { className: 'ap-row__name', textContent: item.name }),
          el('span', { className: 'ap-row__date', textContent: dateText(item.updatedAt) }));
        open.addEventListener('click', () => openSaved(item.id));
        return open;
      })(),
      button('Rename', () => renameModel(item), { ariaLabel: 'Rename ' + item.name }),
      button('Duplicate', () => duplicateModel(item), { ariaLabel: 'Duplicate ' + item.name }),
      button('Delete', () => deleteModel(item), { ariaLabel: 'Delete ' + item.name }))));
    menu.replaceChildren(acts, note, ...(items.length ? [list] : []));
  }
  menu.addEventListener('beforetoggle', (ev) => {
    if (ev.newState !== 'open') return;
    renderMenu();
    const r = $('#ap-models').getBoundingClientRect();
    menu.style.top = r.bottom + 6 + 'px';
    menu.style.left = Math.min(r.left, Math.max(16, innerWidth - 16 - Math.min(480, innerWidth - 32))) + 'px';
  });
  menu.addEventListener('toggle', (ev) => {
    if (ev.newState === 'closed') { menu.replaceChildren(); return; }
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  });

  /* --------------------------------------------------------- opening files -- */
  const REFUSED = {
    empty: 'it is empty',
    'too-large': 'it is larger than 1 MB',
    binary: 'it is not a text file',
  };
  async function importFiles(files) {
    if (!files.length) return;
    if (locked) { showNotice('Files cannot be opened during a practice attempt.'); return; }
    const read = await Promise.all(files.map(async (file) => {
      try { return { file, result: acceptImport(file.name, new Uint8Array(await file.arrayBuffer())) }; }
      catch { return { file, result: { ok: false, reason: 'unreadable' } }; }
    }));
    if (!canLeave()) return;
    let opened = null;
    for (const { file, result } of read) {
      if (!result.ok) { showNotice(file.name + ' was not opened: ' + (REFUSED[result.reason] || 'it could not be read') + '.'); continue; }
      const created = store.create({ name: result.name, text: result.text });
      if (created.ok) opened = created.model;
      else showNotice(file.name + ' was not opened: browser storage is full or blocked.');
    }
    if (!opened) return;
    playDraft = null;
    session.openModel(opened.id);
    toEditor();
  }
  $('#ap-file').addEventListener('change', (ev) => {
    const files = [...ev.target.files];
    ev.target.value = ''; // so the same file can be picked again
    importFiles(files);
  });
  const carriesFiles = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
  window.addEventListener('dragover', (ev) => { if (carriesFiles(ev)) ev.preventDefault(); });
  window.addEventListener('drop', (ev) => {
    if (!carriesFiles(ev)) return;
    ev.preventDefault();
    importFiles([...ev.dataTransfer.files]);
  });

  /* ------------------------------------------------------- page lifecycle -- */
  $('#pg-share').addEventListener('click', () => {
    const link = new URL(playground.shareHash(), location.href).href; // the playground's own handler copies this same link
    if (link.length > LONG_LINK) showNotice('This link is ' + link.length + ' characters long and some apps cut long links. Download .dsl is safer.');
  });
  window.addEventListener('beforeunload', (ev) => {
    sync();
    if (session.needsLeaveWarning() || (!persistent && session.state.text)) { ev.preventDefault(); ev.returnValue = ''; }
  });
  window.addEventListener('storage', (ev) => {
    if (ev.key !== null && !store.isModelKey(ev.key)) return; // a null key means storage was cleared
    const text = playground.getText();
    if (text !== session.state.text) session.edit(text); // typing not yet reported counts as unsaved work
    session.storageChanged();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === writtenHash) return;
    const address = parseAddress(location.hash, decodePlayText);
    if (address.type === 'none') { syncAddress(); return; }
    if (locked) { showNotice('Links cannot be opened during a practice attempt.'); syncAddress(); return; }
    if (!canLeave()) { syncAddress(); return; }
    const notice = openAddress(address);
    showWorkspace();
    if (address.view) playground.setView(address.view);
    syncAddress();
    if (notice) showNotice(notice);
  });

  /* ------------------------------------------------------------ app hooks -- */
  const app = window.EventlineApp = {
    store,
    session,
    get playground() { return playground; }, // null until startup mounts it
    showNotice,
    sync,
    canLeave,
    openModel(id) { playDraft = null; return session.openModel(id); },
    setMode(mode) {
      document.body.dataset.mode = mode;
      if (playground && mode === 'workspace') playground.setView({}); // the board refits once it shows again
    },
    setLocked(on) {
      locked = !!on;
      closeMenu();
      $('#ap-models').disabled = locked;
    },
    topbarSlot: $('#ap-slot'),
  };

  /* -------------------------------------------------------------- startup -- */
  const address = parseAddress(location.hash, decodePlayText);
  const firstVisit = !store.meta().visited;
  store.setMeta({ visited: true });
  const resumed = window.EventlinePracticeUI.resumeActive(); // an active attempt overrides the blank draft and any link
  const ignored = resumed && address.type !== 'none' && !(address.type === 'model' && address.id === session.state.id);
  const startNotice = ignored ? 'Links cannot be opened during a practice attempt.'
    : resumed || address.type === 'none' ? undefined : openAddress(address);
  const startSmall = !resumed && address.type === 'none' && firstVisit;

  playground = window.EventlinePlayground.mount(document.body, {
    base: '../',
    address: 'none',
    load: 'now',
    theme,
    text: startSmall ? undefined : session.state.text, // left out, the playground starts with its Start small model
    onChange: (text, meta) => { if (meta.fromUser) session.edit(text); },
    onView: syncAddress,
    dslName: () => exportFiles([session.state])[0].name,
  });
  window.EventlineEditor.attach(playground.textarea, playground.getModel);
  if (startSmall) session.openDraft(playground.getText());
  shown = session.state;
  playground.setReadOnly(shown.readOnly);
  if (address.view && !ignored) playground.setView(address.view);
  if (shown.id) store.setMeta({ lastOpenedId: shown.id });
  paintTheme();
  paintLayout();
  paint(session.state);
  if (startNotice) showNotice(startNotice);
  window.EventlinePracticeUI.init(app);
})();
