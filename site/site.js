/* eventline site behaviour.
   One append-only event log runs the page. Scrolling into a scene and firing a
   command both append to it. The nav highlight and the top-bar chip are views
   folded from that log. The demos run a small in-page decider that mirrors the
   commands in twitter-pure.dsl; it is sample data, not part of eventline. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const raf = requestAnimationFrame;

  /* ------------------------------------------------------------ event log -- */
  const log = [];
  const listeners = new Set();
  function append(stream, type, data = {}) {
    const e = { seq: log.length + 1, stream, type, data };
    log.push(e);
    for (const fn of listeners) fn(e);
    return e;
  }

  /* ---------------------------------------------------- the demo "system" -- */
  const states = {};
  const fresh = () => ({
    authed: new Set(), users: new Set(), tweets: new Map(), order: [],
    likes: new Set(), retweets: new Set(), follows: new Set(),
    likeCount: new Map(), rtCount: new Map(), created: 0,
  });
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  function apply(s, { type, data: d }) {
    switch (type) {
      case 'user-authenticated': s.authed.add(d.userId); break;
      case 'user-created': s.users.add(d.userId); break;
      case 'tweet-created': s.tweets.set(d.tweetId, d.userId); s.order.push(d.tweetId); s.created++; break;
      case 'tweet-deleted': s.tweets.delete(d.tweetId); break;
      case 'tweet-liked': s.likes.add(d.userId + ':' + d.tweetId); bump(s.likeCount, d.tweetId); break;
      case 'tweet-retweeted': s.retweets.add(d.userId + ':' + d.tweetId); bump(s.rtCount, d.tweetId); break;
      case 'user-followed': s.follows.add(d.userId + ':' + d.targetUserId); break;
    }
  }
  listeners.add((e) => {
    if (e.stream === 'page') return;
    apply(states[e.stream] || (states[e.stream] = fresh()), e);
  });

  const refuse = (what) => ({ refused: what });
  const emit = (branch, type, data) => ({ branch, events: [[type, data]] });
  /* Each decider mirrors its block in twitter-pure.dsl: facts in the `on` line,
     guards on the edges, `default` last. */
  const COMMANDS = {
    postTweet(s, a) {
      if (!s.authed.has(a.userId)) return refuse(`user-authenticated(${a.userId})`);
      if (a.content.length > 280) return emit('reject', 'tweet-rejected', { userId: a.userId, reason: 'too-long' });
      return emit('default', 'tweet-created', { tweetId: 't' + (s.created + 1), userId: a.userId, content: a.content });
    },
    followUser(s, a) {
      if (!s.authed.has(a.userId)) return refuse(`user-authenticated(${a.userId})`);
      if (!s.users.has(a.targetUserId)) return refuse(`user-exists(${a.targetUserId})`);
      if (s.follows.has(a.userId + ':' + a.targetUserId)) return emit('reject', 'follow-rejected', { userId: a.userId, targetUserId: a.targetUserId });
      return emit('default', 'user-followed', { userId: a.userId, targetUserId: a.targetUserId });
    },
    likeTweet(s, a) {
      if (!s.authed.has(a.userId)) return refuse(`user-authenticated(${a.userId})`);
      if (!s.tweets.has(a.tweetId)) return refuse(`tweet-exists(${a.tweetId ?? 'none'})`);
      if (s.likes.has(a.userId + ':' + a.tweetId)) return emit('reject', 'like-rejected', { userId: a.userId, tweetId: a.tweetId });
      return emit('default', 'tweet-liked', { userId: a.userId, tweetId: a.tweetId });
    },
    retweet(s, a) {
      if (!s.authed.has(a.userId)) return refuse(`user-authenticated(${a.userId})`);
      if (!s.tweets.has(a.tweetId)) return refuse(`tweet-exists(${a.tweetId ?? 'none'})`);
      if (s.retweets.has(a.userId + ':' + a.tweetId)) return emit('reject', 'retweet-rejected', { userId: a.userId, tweetId: a.tweetId });
      return emit('default', 'tweet-retweeted', { userId: a.userId, tweetId: a.tweetId });
    },
    deleteTweet(s, a) {
      if (!s.authed.has(a.userId)) return refuse(`user-authenticated(${a.userId})`);
      if (!s.tweets.has(a.tweetId)) return refuse(`tweet-created(${a.tweetId ?? 'none'})`);
      if (s.tweets.get(a.tweetId) !== a.userId) return emit('reject', 'delete-rejected', { userId: a.userId, tweetId: a.tweetId });
      return emit('default', 'tweet-deleted', { tweetId: a.tweetId });
    },
  };
  function run(stream, name, args) {
    const s = states[stream] || (states[stream] = fresh());
    const res = COMMANDS[name](s, args);
    if (res.events) for (const [type, data] of res.events) append(stream, type, data);
    return res;
  }
  const latest = (s) => { for (let i = s.order.length - 1; i >= 0; i--) if (s.tweets.has(s.order[i])) return s.order[i]; };

  /* ------------------------------------------------ signature: page state -- */
  const navLinks = $$('.bar__nav a');
  const railEv = $('#rail-ev');
  listeners.add((e) => {
    if (e.stream !== 'page' || e.type !== 'scene-entered') return;
    for (const a of navLinks) {
      if (a.getAttribute('href') === '#' + e.data.scene) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  });
  listeners.add((e) => {
    if (e.stream !== 'page') return;
    railEv.textContent = e.type === 'scene-entered' ? `${e.type} { scene: "${e.data.scene}" }` : e.type;
    if (!reduced.matches) {
      railEv.classList.remove('is-pulse');
      void railEv.offsetWidth;
      railEv.classList.add('is-pulse');
    }
  });

  let currentScene = null;
  const sceneIO = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const id = en.target.dataset.scene;
      if (en.isIntersecting && id !== currentScene) {
        currentScene = id;
        append('page', 'scene-entered', { scene: id });
      }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('[data-scene]').forEach((el) => sceneIO.observe(el));
  append('page', 'page-opened');

  /* the log dialog */
  const dlg = $('#log');
  const list = $('#log-list');
  let paintQueued = false;
  function paintLog() {
    paintQueued = false;
    const frag = document.createDocumentFragment();
    for (let i = log.length - 1, n = 0; i >= 0 && n < 150; i--, n++) {
      const e = log[i];
      const li = document.createElement('li');
      const seq = document.createElement('span'); seq.textContent = '#' + e.seq;
      const st = document.createElement('span'); st.textContent = e.stream;
      const ty = document.createElement('b'); ty.textContent = e.type;
      const da = document.createElement('code'); da.textContent = JSON.stringify(e.data);
      li.append(seq, st, ty, da);
      frag.append(li);
    }
    list.replaceChildren(frag);
  }
  const queuePaint = () => { if (!paintQueued) { paintQueued = true; raf(paintLog); } };
  listeners.add(() => { if (dlg.open) queuePaint(); });
  $('#log-open').addEventListener('click', () => { paintLog(); dlg.showModal(); });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });

  /* ------------------------------------------------------------------ hero -- */
  const H = 'hero';
  const heroStatus = $('#hero-status');
  const lane = { view: $('#lane-view'), track: $('#lane-track'), offset: 0, chips: [], speed: 130, vw: 0 };
  const CHIP_W = 200;
  const ROW_H = 46;
  const phrases = ['events all the way down', 'ship it', 'hello, timeline', 'state is a fold', 'small steps, big system'];
  let phrase = 0;
  let followTurn = 0;
  const targets = ['u2', 'u3', 'u4'];

  // Mark the branch lines of each hero code panel so a fired command can show
  // which edge it took (the marker is a glyph and a bar, never colour alone).
  for (const pre of $$('.pf-code')) {
    const lines = $$('.ln', pre);
    let inDefault = false;
    lines.forEach((ln) => {
      const t = ln.textContent;
      if (/--\[default\]-->/.test(t)) { ln.dataset.b = 'default'; inDefault = true; }
      else if (/^\s*--\[/.test(t)) { ln.dataset.b = 'reject'; inDefault = false; }
      else if (inDefault) ln.dataset.b = 'default';
    });
  }

  function showCommand(name) {
    for (const pre of $$('.pf-code')) {
      pre.hidden = pre.dataset.cmd !== name;
      $$('.ln.is-hit', pre).forEach((l) => l.classList.remove('is-hit'));
    }
  }
  function markBranch(name, branch) {
    const pre = $(`.pf-code[data-cmd="${name}"]`);
    if (!pre) return;
    $$('.ln', pre).forEach((l) => l.classList.toggle('is-hit', l.dataset.b === branch));
  }

  const views = { tweets: $('#v-tweets'), likes: $('#v-likes'), follows: $('#v-follows') };
  function paintViews() {
    const s = states[H]; if (!s) return;
    views.tweets.textContent = `${s.tweets.size} ${s.tweets.size === 1 ? 'tweet' : 'tweets'}`;
    views.likes.textContent = String(s.likes.size);
    views.follows.textContent = String(s.follows.size);
  }

  function addChip(e, x) {
    const el = document.createElement('div');
    el.className = 'chip' + (/rejected$/.test(e.type) ? ' chip--no' : '');
    const b = document.createElement('b'); b.textContent = e.type;
    const i = document.createElement('i'); i.textContent = e.data.userId === 'u1' ? 'you' : (e.data.userId || '');
    el.append(b, i);
    if (lane.static) {
      lane.track.append(el);
      lane.chips.push({ el, x: 0 });
      while (lane.chips.length > 6) lane.chips.shift().el.remove();
      return;
    }
    el.style.top = (e.seq % 3) * ROW_H + 8 + 'px';
    el.style.left = x + 'px';
    lane.track.append(el);
    lane.chips.push({ el, x });
  }
  listeners.add((e) => {
    if (e.stream !== H) return;
    addChip(e, e.seed != null ? e.seed : lane.offset + Math.max(lane.vw - CHIP_W - 24, 0));
    paintViews();
  });

  // boot: four users sign in, three of them exist as followable accounts
  function bootHero() {
    lane.vw = lane.view.clientWidth;
    lane.static = reduced.matches;
    lane.view.classList.toggle('is-static', lane.static);
    const seeded = [];
    for (const u of ['u1', 'u2', 'u3', 'u4']) seeded.push(['user-authenticated', { userId: u }]);
    for (const u of ['u2', 'u3', 'u4']) seeded.push(['user-created', { userId: u }]);
    seeded.forEach(([type, data], i) => {
      const e = { seq: log.length + 1, stream: H, type, data };
      e.seed = 24 + i * 150; // spread the opening events across the lane
      log.push(e);
      for (const fn of listeners) fn(e);
    });
  }

  const FIRE = {
    postTweet: () => run(H, 'postTweet', { userId: 'u1', content: phrases[phrase++ % phrases.length] }),
    likeTweet: () => run(H, 'likeTweet', { userId: 'u1', tweetId: latest(states[H]) }),
    followUser: () => run(H, 'followUser', { userId: 'u1', targetUserId: targets[followTurn++ % targets.length] }),
  };
  const STATUS = {
    refused: (n, what) => `${n} refused: the fact ${what} does not hold yet.`,
    reject: (n, t) => `${n} took the guard edge and emitted ${t}. Nothing else changed.`,
    default: (n, t) => `${n} took the default edge and emitted ${t}.`,
  };
  $$('[data-fire]').forEach((btn) => btn.addEventListener('click', () => {
    const name = btn.dataset.fire;
    showCommand(name);
    const res = FIRE[name]();
    if (res.refused) { heroStatus.textContent = STATUS.refused(name, res.refused); return; }
    markBranch(name, res.branch);
    heroStatus.textContent = STATUS[res.branch](name, res.events[0][0]);
  }));

  // ambient sample traffic: a few other users doing things, through the same deciders
  let paused = false;
  let heroVisible = true;
  let running = false;
  let last = 0;
  let nextIn = 700;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function ambient() {
    const s = states[H];
    const who = pick(['u2', 'u3', 'u4']);
    const roll = Math.random();
    if (roll < 0.4) run(H, 'postTweet', { userId: who, content: pick(phrases) });
    else if (roll < 0.75) { const t = s.order.length ? pick(s.order) : undefined; run(H, 'likeTweet', { userId: who, tweetId: t }); }
    else run(H, 'followUser', { userId: who, targetUserId: pick(['u1', 'u2', 'u3', 'u4'].filter((u) => u !== who)) });
  }
  function frame(t) {
    if (!running) { last = 0; return; }
    const dt = last ? Math.min(t - last, 64) : 0;
    last = t;
    lane.offset += (lane.speed * dt) / 1000;
    lane.track.style.transform = `translate3d(${-lane.offset}px,0,0)`;
    while (lane.chips.length && lane.chips[0].x + CHIP_W + 120 < lane.offset) lane.chips.shift().el.remove();
    nextIn -= dt;
    if (nextIn <= 0) { ambient(); nextIn = 1000 + Math.random() * 900; }
    raf(frame);
  }
  function sync() {
    const want = heroVisible && !document.hidden && !paused && !reduced.matches;
    if (want && !running) { running = true; raf(frame); }
    else if (!want) running = false;
  }
  new IntersectionObserver((es) => { heroVisible = es[0].isIntersecting; sync(); }).observe($('#spark'));
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', () => { location.reload(); });
  const pauseBtn = $('#lane-pause');
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    sync();
  });
  new ResizeObserver(() => { lane.vw = lane.view.clientWidth; }).observe(lane.view);

  bootHero();
  paintViews();
  if (reduced.matches) { pauseBtn.hidden = true; }
  sync();

  /* ----------------------------------------------------------------- proof -- */
  const P = 'proof';
  const proof = $('#proof');
  const pStage = $('#proof-stage');
  const codeBox = $('.pf-proof__code');
  const inner = $('#proof-code');
  const blocks = Object.fromEntries($$('.blk', inner).map((b) => [b.dataset.blk, b]));
  const stream = $('#proof-stream');
  const pStatus = $('#proof-status');
  const fireBtn = $('#proof-fire');
  const pv = { timeline: $('#pv-timeline'), tweet: $('#pv-tweet'), profile: $('#pv-profile') };

  // thresholds are act progress; each step highlights its blocks and, for a
  // command, runs it exactly once the first time the reader reaches it
  const STEPS = [
    { at: 0.03, blocks: ['sys', 'actors', 'bounds'], note: 'Declare the system: who acts, and the boundaries that scope decisions.' },
    { at: 0.12, blocks: ['v1', 'v2', 'v3'], note: 'Views are folds over events. They start empty.', run: () => {
      append(P, 'user-authenticated', { userId: 'u1' });
      append(P, 'user-created', { userId: 'u2' });
    } },
    { at: 0.22, blocks: ['postTweet'], cmd: 'postTweet' },
    { at: 0.32, blocks: ['followUser'], cmd: 'followUser' },
    { at: 0.42, blocks: ['likeTweet'], cmd: 'likeTweet' },
    { at: 0.52, blocks: ['retweet'], cmd: 'retweet' },
    { at: 0.62, blocks: ['deleteTweet'], cmd: 'deleteTweet' },
    { at: 0.72, blocks: ['pol1', 'pol2'], note: 'Policies watch events and issue the next command.', run: policies },
  ];
  const ARGS = {
    postTweet: () => ({ userId: 'u1', content: 'hello, events' }),
    followUser: () => ({ userId: 'u1', targetUserId: 'u2' }),
    likeTweet: () => ({ userId: 'u1', tweetId: latest(states[P]) ?? 't1' }),
    retweet: () => ({ userId: 'u1', tweetId: latest(states[P]) ?? 't1' }),
    deleteTweet: () => ({ userId: 'u1', tweetId: latest(states[P]) ?? 't1' }),
  };
  function policies() {
    const s = states[P];
    for (const k of s.likes) {
      const [userId, tweetId] = k.split(':');
      append(P, 'command-issued', { via: 'notification-worker', command: 'sendLikeNotification', tweetId, userId });
    }
    append(P, 'guard-not-met', { policy: 'trending-analyzer', guard: 'count(tweet-created*) > 10000', count: s.created });
  }

  const META = new Set(['command-issued', 'guard-not-met']);
  listeners.add((e) => {
    if (e.stream !== P) return;
    const li = document.createElement('li');
    if (/rejected$/.test(e.type)) li.className = 'is-no';
    else if (META.has(e.type)) li.className = 'is-meta';
    const b = document.createElement('b'); b.textContent = e.type;
    const c = document.createElement('code'); c.textContent = compact(e.data);
    li.append(b, c);
    stream.prepend(li);
    while (stream.children.length > 9) stream.lastChild.remove();
    paintProofViews();
  });
  const compact = (d) => '{ ' + Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'string' ? '"' + v + '"' : v}`).join(', ') + ' }';
  function paintProofViews() {
    const s = states[P]; if (!s) return;
    const alive = s.order.filter((t) => s.tweets.has(t));
    pv.timeline.textContent = alive.length ? alive.join(', ') : (s.created ? 'empty again' : 'empty');
    pv.tweet.textContent = !s.created ? 'not created'
      : !s.tweets.has('t1') ? 'deleted'
      : `${s.likeCount.get('t1') || 0} likes, ${s.rtCount.get('t1') || 0} retweets`;
    let followers = 0; for (const k of s.follows) if (k.endsWith(':u2')) followers++;
    pv.profile.textContent = `${followers} ${followers === 1 ? 'follower' : 'followers'}`;
  }

  let step = -1;
  let fired = -1;
  let metrics = { tops: {}, boxH: 0, innerH: 0 };
  function measure() {
    metrics.boxH = codeBox.clientHeight;
    metrics.innerH = inner.scrollHeight;
    for (const id in blocks) metrics.tops[id] = blocks[id].offsetTop;
  }
  function select(i) {
    step = i;
    const st = STEPS[i];
    for (const id in blocks) blocks[id].classList.toggle('is-active', !!st && st.blocks.includes(id));
    let y = 0;
    if (st) {
      const top = metrics.tops[st.blocks[0]];
      y = Math.min(Math.max(top - metrics.boxH * 0.28, 0), Math.max(metrics.innerH - metrics.boxH, 0));
    }
    inner.style.transform = `translate3d(0,${-y}px,0)`;
    if (st && st.cmd) { fireBtn.disabled = false; fireBtn.textContent = `Fire ${st.cmd}`; fireBtn.dataset.cmd = st.cmd; }
    else { fireBtn.disabled = true; fireBtn.textContent = 'Fire a command'; delete fireBtn.dataset.cmd; }
    if (st && st.note) pStatus.textContent = st.note;
    else if (st && st.cmd) pStatus.textContent = `Reading ${st.cmd}. It runs once when you reach it.`;
  }
  function advance(p) {
    let want = -1;
    for (let i = 0; i < STEPS.length; i++) if (p >= STEPS[i].at) want = i;
    while (fired < want) {
      fired++;
      const st = STEPS[fired];
      if (st.run) st.run();
      if (st.cmd) reportProof(st.cmd, run(P, st.cmd, ARGS[st.cmd]()));
    }
    if (want !== step) select(want);
    pStage.dataset.final = p >= 0.84 ? '1' : '0';
  }
  function reportProof(name, res) {
    pStatus.textContent = res.refused
      ? `${name} refused: the fact ${res.refused} does not hold.`
      : res.branch === 'reject'
        ? `${name} took the guard edge and emitted ${res.events[0][0]}.`
        : `${name} took the default edge and emitted ${res.events[0][0]}.`;
  }
  fireBtn.addEventListener('click', () => {
    const name = fireBtn.dataset.cmd;
    if (name) reportProof(name, run(P, name, ARGS[name]()));
  });

  let proofLive = false;
  let lastP = -1;
  function proofLoop() {
    if (!proofLive) return;
    const p = parseFloat(proof.style.getPropertyValue('--sc-p')) || 0;
    if (p !== lastP) { lastP = p; advance(p); }
    raf(proofLoop);
  }
  new IntersectionObserver((es) => {
    const on = es[0].isIntersecting;
    if (on && !proofLive) { proofLive = true; measure(); raf(proofLoop); }
    else if (!on) proofLive = false;
  }, { rootMargin: '60% 0px' }).observe(proof);
  new ResizeObserver(() => { measure(); if (step >= 0) select(step); }).observe(codeBox);
  document.fonts && document.fonts.ready.then(() => { measure(); if (step >= 0) select(step); });

  /* ----------------------------------------------------------------- close -- */
  const cmd = $('#cmd');
  const copyStatus = $('#copy-status');
  const hintHTML = copyStatus.innerHTML;
  $('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(cmd.value);
      copyStatus.textContent = 'Copied. Paste it in the folder that holds twitter-pure.dsl.';
    } catch {
      cmd.select();
      copyStatus.textContent = 'Selected. Press Ctrl+C or Cmd+C to copy.';
    }
    setTimeout(() => { copyStatus.innerHTML = hintHTML; }, 4000);
  });
  cmd.addEventListener('focus', () => cmd.select());

  /* The Event Modeling board pans only when it is wider than the screen. On a very
     wide screen it would pin and hold a still frame, so it lays out flat instead. */
  const model = $('#model');
  const rail = $('.pf-board__rail', model);
  if (rail.scrollWidth - innerWidth < innerWidth * 0.12) {
    model.removeAttribute('data-sc-act');
    model.removeAttribute('data-sc-span');
    rail.removeAttribute('data-sc-pan');
    $('.pf-board', model).classList.add('pf-board--flat');
  }

  if (window.Frontstage) window.Frontstage.mount(document.body);
})();
