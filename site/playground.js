/* The eventline playground: editor, highlighting, board, tracing, zoom, checks and diagram tabs.
   The homepage and the app mount this same code onto their own markup. */
(() => {
  'use strict';

  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const raf = requestAnimationFrame;

  const REQUIRED_IDS = ['pg', 'pg-text', 'pg-mirror', 'pg-board', 'pg-status', 'pg-trace', 'pg-issues', 'pg-hl', 'pg-marks', 'pg-links', 'pg-svg', 'pg-summary', 'pg-more', 'pg-fit', 'pg-zv', 'pg-zin', 'pg-zout', 'pg-share', 'pg-dsl'];
  const PROFILES = ['core', 'workshop', 'eventmodeling', 'slicerm'];

  async function copyText(text, field) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { if (field) field.select(); return false; }
  }

  const b64 = {
    enc(s) { let bin = ''; new TextEncoder().encode(s).forEach((x) => { bin += String.fromCharCode(x); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec(s) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))); },
  };

  /* The rule lib/diagram/links.js checks link-url by: http(s), a path or a fragment. A model can still carry
     javascript: and the library only warns, so the board drops any other address. Browsers skip leading spaces
     and control characters, so this does too. */
  const safeHref = (href) => /^[\u0000- ]*(https?:|\/|\.\.?\/|#)/i.test(href);

  /* ------------------------------------------------- inline boards and tracing -- */
  /* Boards come from eventline as SVG. Inline copies get unique ids so two boards can share a page. */
  let boardSeq = 0;
  function inlineSvg(text) {
    const id = 'b' + (++boardSeq);
    const doc = new DOMParser().parseFromString(text.replace(/id="arr"/g, `id="${id}-arr"`).replace(/url\(#arr\)/g, `url(#${id}-arr)`).replace(/id="t"/, `id="${id}-t"`).replace(/id="d"/, `id="${id}-d"`).replace('aria-labelledby="t d"', `aria-labelledby="${id}-t ${id}-d"`), 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    return document.importNode(doc.documentElement, true);
  }
  /* wires tracing onto a board svg; readout is the element that says what is lit */
  function traceBoard(svg, readout, idle, opts = {}) {
    const nodes = new Map($$('.nd', svg).map((n) => [n.dataset.id, n]));
    const edges = $$('.ed', svg).map((e) => ({ el: e, from: e.dataset.from, to: e.dataset.to }));
    const up = new Map(); const down = new Map();
    for (const e of edges) {
      (down.get(e.from) || down.set(e.from, []).get(e.from)).push(e);
      (up.get(e.to) || up.set(e.to, []).get(e.to)).push(e);
    }
    const label = (id) => (nodes.get(id) ? nodes.get(id).dataset.label : id);
    const walk = (start, next, key) => {
      const seen = new Set([start]); const used = new Set(); const q = [start];
      while (q.length) for (const e of next.get(q.shift()) || []) { used.add(e); if (!seen.has(e[key])) { seen.add(e[key]); q.push(e[key]); } }
      return { seen, used };
    };
    let base = null; // the selected box: it stays lit until something else is selected
    const paint = (id) => {
      if (id) show(id); else clear();
      for (const [nid, el] of nodes) el.classList.toggle('is-sel', nid === base);
    };
    const select = (id) => { base = id; paint(base); if (opts.onSelect) opts.onSelect(base, base ? nodes.get(base) : null); };
    function show(id) {
      const u = walk(id, up, 'from'); const d = walk(id, down, 'to');
      svg.classList.add('is-tracing');
      for (const [nid, el] of nodes) el.classList.toggle('is-on', u.seen.has(nid) || d.seen.has(nid));
      for (const e of edges) e.el.classList.toggle('is-on', u.used.has(e) || d.used.has(e));
      const names = (list, key) => [...new Set(list.map((e) => label(e[key])))];
      const by = names(up.get(id) || [], 'from'); const to = names(down.get(id) || [], 'to');
      const node = nodes.get(id);
      readout.replaceChildren();
      const strong = document.createElement('b'); strong.textContent = node.dataset.label;
      readout.append(strong, ` is ${/^[aeiou]/.test(node.dataset.kind) ? 'an' : 'a'} ${node.dataset.kind}.`);
      if (by.length) readout.append(` Fed by ${by.join(', ')}.`);
      if (to.length) readout.append(` Read by ${to.join(', ')}.`);
      if (!by.length && !to.length) readout.append(' Nothing links to it in this model.');
    }
    function clear() {
      svg.classList.remove('is-tracing');
      $$('.is-on', svg).forEach((el) => el.classList.remove('is-on'));
      readout.textContent = idle;
    }
    const nodeOf = (t) => t.closest && t.closest('.nd');
    svg.addEventListener('pointerover', (ev) => { const n = nodeOf(ev.target); if (n && ev.pointerType !== 'touch') show(n.dataset.id); });
    svg.addEventListener('pointerout', (ev) => { if (ev.pointerType !== 'touch' && nodeOf(ev.target)) paint(base); });
    svg.addEventListener('click', (ev) => {
      if (opts.suppressClick && opts.suppressClick()) return;
      const n = nodeOf(ev.target);
      if (!n) select(null);
      else select(base === n.dataset.id ? null : n.dataset.id);
    });
    if (opts.focusable) {
      for (const [nid, el] of nodes) {
        el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `${el.dataset.kind} ${el.dataset.label}. Press Enter to find its lines in the editor.`);
        el.addEventListener('focus', () => show(nid));
        el.addEventListener('blur', () => paint(base));
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(nid); }
        });
      }
    }
    return { nodes, setBase(id) { base = id && nodes.has(id) ? id : null; paint(base); }, get base() { return base; } };
  }

  /* One copy of the parser per page, however many boards ask for it. A failed load can be tried again. */
  let bundle = null;
  function loadEventline(base = '') {
    if (!bundle && window.eventline) bundle = Promise.resolve(window.eventline); // a page that loads it itself
    if (!bundle) bundle = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = base + 'eventline.js';
      s.onload = () => resolve(window.eventline);
      s.onerror = () => { bundle = null; resolve(null); };
      document.head.append(s);
    });
    return bundle;
  }

  /* A board to read, not edit. Resolves false when the model cannot be drawn. */
  async function drawStatic(host, text, kind, theme, base = '') {
    const lib = await loadEventline(base);
    if (!lib) return false;
    try {
      const svg = inlineSvg(lib.render(lib.parse(text), kind, 'svg', theme));
      if (!svg) return false;
      svg.removeAttribute('width'); svg.removeAttribute('height');
      const idle = 'Point at a box to trace its lineage.';
      const readout = document.createElement('p');
      readout.className = 'pg__trace';
      readout.textContent = idle;
      const box = document.createElement('div');
      box.className = 'pg__board is-fit'; // the tracing styles apply inside a board
      box.append(svg);
      host.replaceChildren(box, readout);
      traceBoard(svg, readout, idle);
      return true;
    } catch { return false; }
  }

  function mount(root, options = {}) {
    const { base = '', address = 'none', load = 'now', onChange, onView, dslName = () => 'model.dsl' } = options;
    let theme = options.theme || 'dark';
    const home = address === 'home';
    const $ = (s, r = root) => r.querySelector(s);
    const $$ = (s, r = root) => Array.from(r.querySelectorAll(s));
    const setAddress = (hash) => { if (home) history.replaceState(null, '', hash); };
    const getView = () => ({ kind: pgKind, node: pgSel, links: pgLinks, profile: pgProfile });
    let lastView = '';
    const viewChanged = () => {
      const now = JSON.stringify(getView());
      if (now === lastView) return;
      lastView = now;
      if (onView) onView(getView());
    };

    /* The page loads eventline's own parser and board renderer (site/eventline.js, bundled from lib/) and
       redraws the board from whatever is in the editor. */
    const START = [
      'system Shop {',
      '  slo: 99.9% uptime',
      '}',
      'actor Customer { auth: session }',
      'boundary Cart(cartId) @partition(shardKey="cartId")',
      '',
      '// A command asks. The guards on its edges decide which events are recorded.',
      'Customer -> addItem(cartId, sku) in Cart(cartId)',
      'on [cart-opened(cartId)]',
      '  --[outOfStock(sku)]--> [item-rejected { cartId, sku }]',
      '  --[default]--> [',
      '    item-added { cartId, sku, addedAt: clock.wall() }',
      '  ]',
      '',
      'Customer -> checkout(cartId) in Cart(cartId)',
      'on [item-added*(cartId)]',
      '  --[default]--> [',
      '    order-placed { cartId, placedAt: clock.wall() }',
      '  ]',
      '',
      '// A view is a fold over events. It answers questions without asking the commands.',
      'view CartSummary(cartId) = [item-added*(cartId)] => {',
      '  items: count(item-added*(cartId))',
      '}',
      '',
      '// A policy watches an event and issues the next command.',
      'order-placed { cartId }',
      '  -> fulfilment-worker -> shipOrder(cartId)',
      '',
    ].join('\n');
    const pgEl = {
      grid: $('#pg'), text: $('#pg-text'), mirror: $('#pg-mirror code'), mirrorBox: $('#pg-mirror'), board: $('#pg-board'),
      status: $('#pg-status'), trace: $('#pg-trace'), issues: $('#pg-issues'), hl: $('#pg-hl'),
    };
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const TOKEN = /(@[A-Za-z_]\w*)|("(?:[^"\\]|\\.)*")|(->\s*)([A-Za-z_]\w*)(?=\()|(\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\*?)|(\bon(?=\s*\[)|\bfrom(?=\s*\[)|\bin(?=\s+[A-Z])|\b(?:default|reject)\b)/g;
    const HEAD = /^(\s*)(system|actor|context|boundary|view|scenario)\b/;
    function hlLine(line) {
      let code = line; let cm = '';
      for (let i = 0, q = false; i < line.length; i++) {
        if (line[i] === '"') q = !q;
        else if (!q && line[i] === '/' && line[i + 1] === '/') { code = line.slice(0, i); cm = line.slice(i); break; }
      }
      let out = ''; let last = 0;
      const head = HEAD.exec(code);
      let from = 0;
      if (head) { out += esc(head[1]) + '<span class="t-kw">' + head[2] + '</span>'; from = head[0].length; last = from; }
      TOKEN.lastIndex = from;
      let m;
      while ((m = TOKEN.exec(code))) {
        out += esc(code.slice(last, m.index));
        if (m[1]) out += '<span class="t-an">' + esc(m[1]) + '</span>';
        else if (m[2]) out += '<span class="t-str">' + esc(m[2]) + '</span>';
        else if (m[4]) out += esc(m[3]) + '<span class="t-cmd">' + esc(m[4]) + '</span>';
        else if (m[5]) out += '<span class="t-ev">' + esc(m[5]) + '</span>';
        else out += '<span class="t-kw">' + esc(m[6]) + '</span>';
        last = m.index + m[0].length;
      }
      out += esc(code.slice(last));
      if (cm) out += '<span class="t-cm">' + esc(cm) + '</span>';
      return out;
    }
    const paintMirror = () => { pgEl.mirror.innerHTML = pgEl.text.value.split('\n').map(hlLine).join('\n') + '\n'; syncScroll(); };
    const syncScroll = () => {
      // Translate, never scroll, the mirror. A scrolled box clamps at its own limit, and the textarea's limit is
      // lower when a long line gives it a horizontal scrollbar, so the two drifted apart at the bottom of a long model.
      pgEl.mirror.style.transform = 'translate3d(' + (-pgEl.text.scrollLeft) + 'px,' + (-pgEl.text.scrollTop) + 'px,0)';
      pgEl.hl.style.transform = 'translate3d(0,' + (-pgEl.text.scrollTop) + 'px,0)';
      $('#pg-marks').style.transform = pgEl.hl.style.transform;
    };
    pgEl.text.addEventListener('scroll', syncScroll);
    // The box can change size (a window resize, a scrollbar appearing) without a scroll event, which moves the textarea's limits.
    new ResizeObserver(syncScroll).observe(pgEl.text);
    pgEl.text.addEventListener('keyup', syncScroll);
    pgEl.text.addEventListener('mouseup', syncScroll);

    let eventline = null;       // window.eventline once the bundle has loaded
    let lastSvg = '';
    let lastModel = null;       // the model on the board; null when the text does not parse
    let pgKind = 'eventmodel';  // which diagram of the model is on the board
    let pgLinks = false;        // whether boxes link to the same thing in another diagram
    let pgProfile = 'core';     // which checks run: core, eventmodeling or slicerm
    let pgDirty = false;        // the text was edited or came from a link, so the address must carry it
    const KIND_FILE = { eventmodel: 'event-model', context: 'context', containers: 'containers', dataflow: 'data-flow', deployment: 'deployment', contextmap: 'context-map' };
    /* A link inside the page: #d=<diagram>&n=<box>. Addresses outside the page stay as they are. */
    const hrefFor = (t) => t.url || ('#d=' + t.diagram + (t.node ? '&n=' + encodeURIComponent(t.node) : ''));
    const renderOpts = () => (pgLinks ? { links: true, href: hrefFor } : {});
    const kindTabs = $$('.pg__kind');
    const linksBtn = $('#pg-links');
    function paintKinds() {
      kindTabs.forEach((b) => {
        const on = b.dataset.kind === pgKind;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      linksBtn.setAttribute('aria-pressed', String(pgLinks));
      $$('.pg__check').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.profile === pgProfile)));
      $('#pg-svg').textContent = 'Download ' + KIND_FILE[pgKind] + '.svg';
    }
    /* The address says where you are: the text when it is not a preset, the diagram, and whether links are on. */
    function currentHash(forceText) {
      let h = (forceText || pgDirty || pgKind !== 'eventmodel' || pgLinks) ? '#play=' + b64.enc(pgEl.text.value) : '#play';
      if (pgKind !== 'eventmodel') h += '&d=' + pgKind;
      if (pgLinks) h += '&links=1';
      if (pgProfile !== 'core') h += '&p=' + pgProfile;
      return h;
    }
    function setKind(kind) { pgKind = kind; paintKinds(); }
    let timer = 0;
    const plural = (n, w) => n + ' ' + (n === 1 ? w : (w.endsWith('y') ? w.slice(0, -1) + 'ies' : w + 's'));
    function drawBoard() {
      if (!eventline) return;
      const text = pgEl.text.value;
      pgEl.issues.replaceChildren();
      let model;
      lastModel = null;
      try {
        model = eventline.parse(text);
        lastModel = model;
      } catch (err) {
        // Leave nothing of the last model on screen: it may be another client's.
        clearBoard();
        pgEl.grid.dataset.state = 'error';
        pgEl.status.classList.add('is-error');
        pgEl.status.textContent = err.message;
        if (Number.isInteger(err.line) && err.line > 0) paintMarks([{ line: err.line, severity: 'error' }]);
        return;
      }
      pgEl.status.classList.remove('is-error');
      const drawable = model.commands.length + model.events.size + model.views.length + model.policies.length;
      if (!drawable) {
        clearBoard();
        pgEl.grid.dataset.state = 'empty';
        pgEl.status.textContent = 'Nothing to draw yet. Add a command, an event, a view or a policy.';
        const p = document.createElement('p'); p.className = 'pg__empty'; p.textContent = 'Write a command and the board appears.';
        pgEl.board.replaceChildren(p);
        lastSvg = '';
        return;
      }
      const can = { deployment: !!(model.system && model.system.regions.length), contextmap: model.contexts.length > 0 };
      const why = { deployment: 'Add region: a, b to the system block to draw this', contextmap: 'Wrap statements in context Name { ... } to draw this' };
      kindTabs.forEach((b) => { const off = b.dataset.kind in can && !can[b.dataset.kind]; b.disabled = off; b.title = off ? why[b.dataset.kind] : ''; });
      if (pgKind in can && !can[pgKind]) setKind('eventmodel');
      let svgText;
      try { svgText = eventline.render(model, pgKind, 'svg', theme, renderOpts()); } catch (err) {
        clearBoard();
        pgEl.grid.dataset.state = 'error'; pgEl.status.classList.add('is-error'); pgEl.status.textContent = err.message; return;
      }
      lastSvg = svgText;
      const svg = inlineSvg(svgText);
      svg.removeAttribute('width'); svg.removeAttribute('height');
      for (const a of $$('a', svg)) {
        for (const at of ['href', 'xlink:href']) if (a.hasAttribute(at) && !safeHref(a.getAttribute(at))) a.removeAttribute(at);
        if (a.classList.contains('lnk')) a.setAttribute('tabindex', '-1');
        else a.setAttribute('aria-label', (a.querySelector('title') || {}).textContent || 'Open');
        if (!(a.getAttribute('href') || '').startsWith('#')) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
      }
      pgEl.board.replaceChildren(svg);
      pgEl.grid.dataset.state = 'ok';
      pgBoard = { svg, tracer: traceBoard(svg, pgEl.trace, IDLE, { focusable: true, onSelect: onBoardSelect, suppressClick: () => panMoved }) };
      applyZoom();
      const wanted = pgSel; // restoreSelection forgets a target that is a group, not a box
      restoreSelection();
      if (wanted && !pgBoard.tracer.nodes.has(wanted)) {
        const grp = $$('.gp', svg).find((g) => g.dataset.id === wanted);
        if (grp) { grp.classList.add('is-flash'); setTimeout(() => grp.classList.remove('is-flash'), 1400); }
      }
      pgEl.status.textContent = [plural(model.commands.length, 'command'), plural(model.events.size, 'event'), plural(model.views.length, 'view'), plural(model.policies.length, 'policy')].join(', ') + '. Parsed and drawn in your browser.';
      paintChecks(eventline.check(model, { profile: pgProfile }));
      viewChanged();
    }
    /* What the checks found: a mark beside each line, a badge on each box, and the list, worst first. */
    const SEV = { error: 0, warn: 1, info: 2 };
    const GLYPH = { error: '\u25CF', warn: '\u25B2', info: '\u00B7' };
    let allIssues = [];
    let showAll = false;
    const moreBtn = $('#pg-more');
    moreBtn.addEventListener('click', () => { showAll = !showAll; paintIssueList(); });
    function paintChecks(issues) {
      allIssues = [...issues].sort((x, y) => SEV[x.severity] - SEV[y.severity] || (Number(x.line) || 1e9) - (Number(y.line) || 1e9));
      showAll = false;
      const n = (sev) => allIssues.filter((i) => i.severity === sev).length;
      const parts = [[n('error'), 'error'], [n('warn'), 'warning'], [n('info'), 'hint']].filter(([c]) => c).map(([c, w]) => c + ' ' + w + (c === 1 ? '' : 's'));
      $('#pg-summary').textContent = parts.length ? parts.join(', ') : 'No findings.';
      paintIssueList();
      paintMarks();
      paintBadges();
    }
    function paintIssueList() {
      const limit = 8;
      const shown = showAll ? allIssues : allIssues.slice(0, limit);
      pgEl.issues.replaceChildren();
      for (const it of shown) {
        const li = document.createElement('li'); li.dataset.s = it.severity;
        const span = document.createElement('span');
        span.append(it.message);
        const cat = document.createElement('span'); cat.className = 'pg__cat'; cat.textContent = it.category; span.append(cat);
        if (Number.isInteger(it.line) && it.line > 0) {
          const go = document.createElement('button'); go.type = 'button'; go.className = 'pg__issue'; go.textContent = 'line ' + it.line;
          go.setAttribute('aria-label', 'Show line ' + it.line + ' in the editor');
          go.addEventListener('click', () => focusIssue(it));
          span.append(' ', go);
        }
        const why = document.createElement('a'); why.className = 'pg__why'; why.href = '/eventline/docs/rules/#' + it.rule; why.target = '_blank'; why.rel = 'noopener'; why.textContent = 'why';
        why.setAttribute('aria-label', 'Why ' + it.rule + ' is checked, in a new tab');
        span.append(why);
        li.append(span);
        pgEl.issues.append(li);
      }
      moreBtn.hidden = allIssues.length <= limit;
      moreBtn.textContent = showAll ? 'Show fewer' : 'Show all ' + allIssues.length;
    }
    /* A finding on the first line of a statement is about all of it. Its box, if the diagram has one, lights up too. */
    function focusIssue(it) {
      const ranges = [[it.line, it.endLine || it.line]];
      const subject = it.subject;
      let id = null;
      if (pgBoard && subject) {
        for (const [nid, el] of pgBoard.tracer.nodes) {
          if (el.dataset.lines && rangesOf(el).some(([from, to]) => subject.line >= from && subject.line <= to) && el.dataset.kind !== 'actor') { id = nid; break; }
        }
      }
      if (pgBoard) pgBoard.tracer.setBase(id);
      pgSel = id;
      showLines(ranges, true);
      viewChanged();
    }
    function clearBoard() {
      pgEl.board.replaceChildren();
      pgBoard = null;
      lastSvg = '';
      pgEl.trace.textContent = IDLE;
      showLines([]);
      paintChecks([]);
      $('#pg-summary').textContent = '';
    }
    function paintMarks(issues = allIssues) {
      const host = $('#pg-marks');
      host.replaceChildren();
      const { lh, pt } = lineMetrics();
      const worst = new Map();
      for (const it of issues) if (Number.isInteger(it.line) && it.line > 0 && !(worst.has(it.line) && SEV[worst.get(it.line)] <= SEV[it.severity])) worst.set(it.line, it.severity);
      for (const [line, sev] of worst) {
        const mark = document.createElement('b');
        mark.dataset.s = sev; mark.textContent = GLYPH[sev];
        mark.style.top = (pt + (line - 1) * lh) + 'px'; mark.style.height = lh + 'px';
        host.append(mark);
      }
    }
    function paintBadges() {
      if (!pgBoard) return;
      const ns = 'http://www.w3.org/2000/svg';
      for (const [, el] of pgBoard.tracer.nodes) {
        if (!el.dataset.lines) continue;
        const mine = allIssues.filter((it) => it.severity !== 'info' && Number.isInteger(it.line) && rangesOf(el).some(([from, to]) => it.line >= from && it.line <= to));
        if (!mine.length) continue;
        const box = el.firstElementChild && el.firstElementChild.getBBox ? el.firstElementChild.getBBox() : null;
        if (!box) continue;
        const g = document.createElementNS(ns, 'g'); g.setAttribute('class', 'issue-badge');
        const title = document.createElementNS(ns, 'title'); title.textContent = mine.map((m) => m.message).join('\n');
        const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', box.x + 2); c.setAttribute('cy', box.y + 2); c.setAttribute('r', 8); c.setAttribute('fill', '#0a0e1a'); c.setAttribute('stroke', '#ffd400'); c.setAttribute('stroke-width', 1.6);
        const t = document.createElementNS(ns, 'text'); t.setAttribute('x', box.x + 2); t.setAttribute('y', box.y + 5.5); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', 10); t.setAttribute('font-weight', 700); t.setAttribute('fill', '#ffd400'); t.textContent = mine.length > 9 ? '9+' : String(mine.length);
        g.append(title, c, t); el.append(g);
      }
    }
    function setText(text, fromUser) {
      pgEl.text.value = text;
      paintMirror();
      if (!fromUser) {
        // Text from outside is another model: forget this one's selected box, and tell the editor to forget its names.
        pgSel = null; lastModel = null;
        pgEl.text.dispatchEvent(new Event('eventline:replaced'));
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        drawBoard();
        if (!fromUser) viewChanged(); // a text that does not parse never reaches drawBoard's own call
        if (fromUser) { pgDirty = true; setAddress(currentHash(true)); }
        if (onChange) onChange(text, { fromUser: !!fromUser });
      }, fromUser ? 140 : 0);
    }
    pgEl.text.addEventListener('input', () => {
      $$('.pg__tab').forEach((t) => t.setAttribute('aria-pressed', 'false'));
      setText(pgEl.text.value, true);
    });

    const presetCache = {};
    async function loadPreset(name) {
      $$('.pg__tab').forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.preset === name)));
      pgDirty = false;
      if (name === 'start') { setText(START, false); setAddress(currentHash(false)); return; }
      try {
        if (!presetCache[name]) presetCache[name] = await (await fetch(base + 'examples/' + name + '.dsl')).text();
        setText(presetCache[name], false);
        setAddress(currentHash(false));
      } catch { pgEl.status.textContent = 'Could not load that example. Check your connection.'; }
    }
    $$('.pg__tab').forEach((t) => t.addEventListener('click', () => loadPreset(t.dataset.preset)));

    /* ------------------------------------------- the board and the text, linked -- */
    const IDLE = 'Point at a box to trace its lineage. Click it to find its lines.';
    let pgBoard = null;   // { svg, tracer } for the board on screen
    let pgSel = null;     // id of the selected box; survives redraws while the box still exists
    const lineMetrics = () => { const cs = getComputedStyle(pgEl.text); return { lh: parseFloat(cs.lineHeight), pt: parseFloat(cs.paddingTop) }; };

    function showLines(ranges, reveal) {
      pgEl.hl.replaceChildren();
      if (!ranges.length) return;
      const { lh, pt } = lineMetrics();
      for (const [from, to] of ranges) {
        const band = document.createElement('i');
        band.style.top = (pt + (from - 1) * lh) + 'px';
        band.style.height = ((to - from + 1) * lh) + 'px';
        pgEl.hl.append(band);
      }
      if (reveal) {
        const top = pt + (ranges[0][0] - 1) * lh;
        const bottom = pt + ranges[0][1] * lh;
        const view = pgEl.text.clientHeight;
        if (top < pgEl.text.scrollTop || bottom > pgEl.text.scrollTop + view) pgEl.text.scrollTop = Math.max(0, top - view * 0.25);
      }
      syncScroll();
    }
    /* A block node knows its lines from the parser. An event is wherever its name is written. */
    function rangesOf(el) {
      if (el.dataset.lines) return el.dataset.lines.split(',').map((s) => s.split('-').map(Number));
      if (el.dataset.kind !== 'event') return [];
      const name = el.dataset.label.replace(/[.*+?^|()[\]\\{}$]/g, '\\$&');
      const re = new RegExp('(^|[^\\w-])' + name + '\\*?(?![\\w-])');
      const out = [];
      pgEl.text.value.split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (!re.test(code)) return;
        const last = out[out.length - 1];
        if (last && last[1] === i) last[1] = i + 1; else out.push([i + 1, i + 1]);
      });
      return out;
    }
    function onBoardSelect(id, el) {
      pgSel = id;
      showLines(el ? rangesOf(el) : [], true);
      viewChanged();
    }
    /* The caret picks a box: an event name picks that event, anywhere else the block it sits in. */
    function nodeAtCaret() {
      if (!pgBoard) return null;
      const text = pgEl.text.value;
      const pos = pgEl.text.selectionStart;
      const line = text.slice(0, pos).split('\n').length;
      const start = text.lastIndexOf('\n', pos - 1) + 1;
      const stop = text.indexOf('\n', pos) < 0 ? text.length : text.indexOf('\n', pos);
      const ltxt = text.slice(start, stop);
      const col = pos - start;
      const word = /[A-Za-z_][\w-]*/g;
      let m;
      while ((m = word.exec(ltxt))) {
        if (col >= m.index && col <= m.index + m[0].length) {
          if (m[0].includes('-') && pgBoard.tracer.nodes.has('evt:' + m[0])) return 'evt:' + m[0];
          break;
        }
      }
      let best = null; let size = Infinity;
      for (const [id, el] of pgBoard.tracer.nodes) {
        if (!el.dataset.lines || el.dataset.kind === 'actor' || el.dataset.kind === 'external') continue;
        for (const [from, to] of rangesOf(el)) if (line >= from && line <= to && to - from < size || (to - from === size && el.dataset.kind === 'policy')) { best = id; size = to - from; }
      }
      return best;
    }
    let caretQueued = false;
    function followCaret() {
      if (caretQueued) return;
      caretQueued = true;
      raf(() => {
        caretQueued = false;
        if (!pgBoard) return;
        const id = nodeAtCaret();
        pgSel = id;
        pgBoard.tracer.setBase(id);
        showLines(id ? rangesOf(pgBoard.tracer.nodes.get(id)) : [], false);
        if (id) revealNode(pgBoard.tracer.nodes.get(id));
        viewChanged();
      });
    }
    /* after a redraw: keep the selection if the box still exists, and let the caret win while you are typing */
    function restoreSelection() {
      if (document.activeElement === pgEl.text) { followCaret(); return; }
      if (pgSel && pgBoard.tracer.nodes.has(pgSel)) {
        pgBoard.tracer.setBase(pgSel);
        showLines(rangesOf(pgBoard.tracer.nodes.get(pgSel)), false);
      } else { pgSel = null; showLines([], false); }
    }
    ['keyup', 'click', 'focus'].forEach((t) => pgEl.text.addEventListener(t, followCaret));

    /* zoom and pan: the board scrolls inside its panel; zoom resizes the svg around the pointer */
    const zoom = { mode: 'fit', scale: 1 };
    const fitBtn = $('#pg-fit');
    const zoomOut = $('#pg-zv');
    const natural = (svg) => { const vb = svg.viewBox.baseVal; return { w: vb.width, h: vb.height }; };
    const curScale = () => (zoom.mode === 'manual' ? zoom.scale : pgBoard.svg.getBoundingClientRect().width / natural(pgBoard.svg).w);
    function applyZoom() {
      if (!pgBoard) return;
      const svg = pgBoard.svg;
      const fit = zoom.mode === 'fit';
      pgEl.board.classList.toggle('is-fit', fit);
      fitBtn.setAttribute('aria-pressed', String(fit));
      if (fit) { svg.style.width = ''; svg.style.height = ''; zoomOut.textContent = Math.round(curScale() * 100) + '%'; return; }
      const n = natural(svg);
      svg.style.width = n.w * zoom.scale + 'px';
      svg.style.height = n.h * zoom.scale + 'px';
      zoomOut.textContent = Math.round(zoom.scale * 100) + '%';
    }
    function zoomTo(next, clientX, clientY) {
      if (!pgBoard) return;
      const svg = pgBoard.svg;
      const cur = curScale();
      const target = Math.min(Math.max(next, 0.2), 3);
      const r = svg.getBoundingClientRect();
      const nx = (clientX - r.left) / cur;
      const ny = (clientY - r.top) / cur;
      zoom.mode = 'manual'; zoom.scale = target;
      applyZoom();
      const r2 = svg.getBoundingClientRect();
      pgEl.board.scrollLeft += (r2.left + nx * target) - clientX;
      pgEl.board.scrollTop += (r2.top + ny * target) - clientY;
    }
    const boardCentre = () => { const r = pgEl.board.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    $('#pg-zin').addEventListener('click', () => { if (pgBoard) zoomTo(curScale() * 1.25, ...boardCentre()); });
    $('#pg-zout').addEventListener('click', () => { if (pgBoard) zoomTo(curScale() / 1.25, ...boardCentre()); });
    fitBtn.addEventListener('click', () => { zoom.mode = 'fit'; applyZoom(); });
    pgEl.board.addEventListener('wheel', (ev) => {
      if (!pgBoard || !(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      zoomTo(curScale() * Math.exp(-ev.deltaY * 0.0022), ev.clientX, ev.clientY);
    }, { passive: false });
    pgEl.board.setAttribute('tabindex', '0');
    pgEl.board.setAttribute('role', 'region');
    pgEl.board.setAttribute('aria-label', 'Diagram. Ctrl and scroll zoom, plus and minus zoom, zero fits, arrow keys scroll.');
    pgEl.board.title = 'Ctrl + scroll to zoom, drag to pan';
    pgEl.board.addEventListener('keydown', (ev) => {
      if (!pgBoard || ev.target.closest('.nd') || ev.ctrlKey || ev.metaKey) return;
      if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); zoomTo(curScale() * 1.25, ...boardCentre()); }
      else if (ev.key === '-') { ev.preventDefault(); zoomTo(curScale() / 1.25, ...boardCentre()); }
      else if (ev.key === '0') { ev.preventDefault(); zoom.mode = 'fit'; applyZoom(); }
    });
    /* a mouse drags the board; touch scrolls it natively. A drag must not count as a click on the background. */
    let pan = null;
    let panMoved = false;
    pgEl.board.addEventListener('pointerdown', (ev) => {
      panMoved = false;
      if (ev.pointerType !== 'mouse' || ev.button !== 0 || zoom.mode === 'fit' || ev.target.closest('.nd')) return;
      pan = { x: ev.clientX, y: ev.clientY, l: pgEl.board.scrollLeft, t: pgEl.board.scrollTop, id: ev.pointerId };
    });
    pgEl.board.addEventListener('pointermove', (ev) => {
      if (!pan) return;
      const dx = ev.clientX - pan.x; const dy = ev.clientY - pan.y;
      if (!panMoved && Math.hypot(dx, dy) > 3) { panMoved = true; pgEl.board.setPointerCapture(pan.id); pgEl.board.classList.add('is-drag'); }
      if (panMoved) { pgEl.board.scrollLeft = pan.l - dx; pgEl.board.scrollTop = pan.t - dy; }
    });
    const endPan = () => { pan = null; pgEl.board.classList.remove('is-drag'); setTimeout(() => { panMoved = false; }, 0); };
    pgEl.board.addEventListener('pointerup', endPan);
    pgEl.board.addEventListener('pointercancel', endPan);
    /* bring a box into view when the caret picks it and the board is zoomed in */
    function revealNode(el) {
      if (zoom.mode === 'fit') return;
      const r = el.getBoundingClientRect();
      const b = pgEl.board.getBoundingClientRect();
      if (r.left < b.left || r.right > b.right) pgEl.board.scrollLeft += r.left - b.left - (b.width - r.width) / 2;
      if (r.top < b.top || r.bottom > b.bottom) pgEl.board.scrollTop += r.top - b.top - (b.height - r.height) / 2;
    }
    const flash = (btn) => { btn.dataset.done = '1'; setTimeout(() => { delete btn.dataset.done; }, 1800); };
    $('#pg-share').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget; // the event forgets it once the handler awaits
      setAddress(currentHash(true));
      const ok = await copyText(home ? location.href : new URL(currentHash(true), location.href).href);
      if (ok) flash(btn); else pgEl.status.textContent = home ? 'Copy the address bar: it already holds this model.' : 'Could not copy the link.';
    });
    // A real link, so middle-click and open-in-new-tab work; its address is refreshed just before any of them.
    const openApp = $('#pg-open-app');
    if (openApp) for (const t of ['mousedown', 'focus', 'click']) openApp.addEventListener(t, () => { openApp.href = 'app/' + currentHash(true); });
    const download = (name, type, body) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#pg-dsl').addEventListener('click', (ev) => { download(dslName(), 'text/plain', pgEl.text.value); flash(ev.currentTarget); });
    /* The download is the diagram as the CLI writes it: with links on, they point at <diagram>.svg beside the file. */
    $('#pg-svg').addEventListener('click', (ev) => {
      if (!eventline) return;
      try {
        const svg = eventline.render(eventline.parse(pgEl.text.value), pgKind, 'svg', theme, pgLinks ? { links: true } : {});
        download(KIND_FILE[pgKind] + '.svg', 'image/svg+xml', svg); flash(ev.currentTarget);
      } catch (err) { pgEl.status.textContent = err.message; }
    });

    /* Addresses: #play (a preset), #play=<base64url of the model text>, then optional &d=<diagram>, &n=<box>, &links=1.
       The share button and the docs write them; the back button walks the links you followed. */
    const HASH = /^#play(?:=([A-Za-z0-9_-]+))?((?:&[a-z]+=[^&]*)*)$/;
    function parseHash() {
      const m = HASH.exec(location.hash);
      if (!m) return null;
      const p = new URLSearchParams((m[2] || '').replace(/^&/, ''));
      return { text: m[1] || null, kind: p.get('d'), node: p.get('n'), links: p.get('links') === '1', profile: ['workshop', 'eventmodeling', 'slicerm'].includes(p.get('p')) ? p.get('p') : 'core' };
    }
    function applyHash() {
      const h = parseHash();
      if (!h || (h.text === null && !h.kind && h.profile === 'core')) return false; // a bare #play is just the section
      try {
        if (h.kind && kindTabs.some((t) => t.dataset.kind === h.kind)) pgKind = h.kind; else if (!h.kind) pgKind = 'eventmodel';
        pgLinks = h.links;
        pgProfile = h.profile;
        paintKinds();
        if (h.text !== null) {
          const text = b64.dec(h.text);
          if (text !== pgEl.text.value) { $$('.pg__tab').forEach((t) => t.setAttribute('aria-pressed', 'false')); pgDirty = true; setText(text, false); pgSel = h.node; return true; }
        }
        pgSel = h.node;
        if (eventline) drawBoard();
        return true;
      } catch { return false; }
    }
    /* follow a link to another diagram, keeping the model; the previous diagram stays one back-button away */
    function goTo(kind, node) {
      setAddress(currentHash(true)); // so back returns here, text and all
      pgKind = kind; pgSel = node || null; pgDirty = true;
      paintKinds();
      drawBoard();
      if (home) history.pushState(null, '', currentHash(true) + (node ? '&n=' + encodeURIComponent(node) : ''));
      viewChanged();
    }
    pgEl.board.addEventListener('click', (ev) => {
      const a = ev.target.closest && ev.target.closest('a.lnk, a.lnk-badge');
      if (!a) return;
      ev.stopPropagation();
      const m = /^#d=([a-z]+)(?:&n=(.+))?$/.exec(a.getAttribute('href') || '');
      if (!m) return; // an address outside the page: the browser follows it
      ev.preventDefault();
      goTo(m[1], m[2] && decodeURIComponent(m[2]));
    }, true);
    kindTabs.forEach((b, i) => {
      b.addEventListener('click', () => { if (b.disabled) return; setKind(b.dataset.kind); pgSel = null; drawBoard(); setAddress(currentHash(false)); viewChanged(); });
      b.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        ev.preventDefault();
        const step = ev.key === 'ArrowRight' ? 1 : -1;
        for (let k = 1; k <= kindTabs.length; k++) {
          const next = kindTabs[(i + step * k + kindTabs.length * k) % kindTabs.length];
          if (!next.disabled) { next.focus(); next.click(); return; }
        }
      });
    });
    linksBtn.addEventListener('click', () => { pgLinks = !pgLinks; paintKinds(); drawBoard(); setAddress(currentHash(false)); viewChanged(); });

    $$('.pg__check').forEach((b) => b.addEventListener('click', () => { pgProfile = b.dataset.profile; paintKinds(); drawBoard(); setAddress(currentHash(false)); viewChanged(); }));

    const hashed = home && applyHash();
    if (options.text !== undefined) { pgEl.text.value = options.text; paintMirror(); }
    else if (!pgEl.text.value) { pgEl.text.value = START; paintMirror(); }
    if (home) window.addEventListener('hashchange', () => { if (applyHash()) root.scrollIntoView(); });

    let loading = false;
    let markReady;
    const ready = new Promise((resolve) => { markReady = resolve; });
    function loadBundle() {
      if (eventline || loading) return;
      loading = true;
      loadEventline(base).then((lib) => {
        if (lib) { eventline = lib; drawBoard(); }
        else pgEl.status.textContent = 'The parser did not load. Check your connection and reload.';
        markReady();
      });
    }
    if (load === 'visible') new IntersectionObserver((es) => { if (es[0].isIntersecting) loadBundle(); }, { rootMargin: '150% 0px' }).observe(root);
    else loadBundle();
    if (hashed) loadBundle();
    if (hashed) requestAnimationFrame(() => root.scrollIntoView());

    lastView = JSON.stringify(getView());
    return {
      getText: () => pgEl.text.value,
      setText,
      setReadOnly(on) {
        pgEl.text.readOnly = on;
        $$('.pg__tab').forEach((t) => { t.disabled = on; }); // a preset would replace the text
      },
      setTheme(next) { theme = next; drawBoard(); },
      getView,
      setView(view) {
        if (kindTabs.some((t) => t.dataset.kind === view.kind)) pgKind = view.kind;
        if ('links' in view) pgLinks = !!view.links;
        if (PROFILES.includes(view.profile)) pgProfile = view.profile;
        if ('node' in view) pgSel = view.node || null;
        paintKinds();
        lastView = JSON.stringify(getView()); // the host asked for this view, so it is not told about it
        drawBoard();
      },
      shareHash: () => currentHash(true),
      getModel: () => lastModel,
      textarea: pgEl.text,
      ready,
    };
  }

  window.EventlinePlayground = { mount, drawStatic, inlineSvg, traceBoard, copyText, b64, safeHref, REQUIRED_IDS };
})();
