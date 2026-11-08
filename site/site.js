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
  /* The world keeps appending events. The river is a window onto it, and the
     playhead is a place in it. Views are a fold of every event left of the playhead,
     so dragging the timeline back rewinds state without touching the log. */
  const H = 'hero';
  const heroStatus = $('#hero-status');
  const PH = 0.66;      // where "now" sits across the river
  const CHIP_W = 208;
  const ROW_H = 54;
  const ROW_TOP = 40;
  const KEEP = 90;      // chips kept in the DOM; every event stays in heroEv
  const lane = { view: $('#lane-view'), track: $('#lane-track'), live: 0, at: 0, vw: 0, speed: 120, scrub: false, static: false };
  const heroEv = [];    // { e, x, el } in log order, x is the chip's left edge in track coordinates
  const playhead = $('#playhead');
  const playTag = $('#play-tag');
  const asof = $('#asof');
  const nowBtn = $('#lane-now');
  const cue = $('#lane-cue');
  const phX = () => lane.vw * PH;
  const headX = () => lane.at + phX();
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
  function paintViews(s = states[H]) {
    if (!s) return;
    views.tweets.textContent = `${s.tweets.size} ${s.tweets.size === 1 ? 'tweet' : 'tweets'}`;
    views.likes.textContent = String(s.likes.size);
    views.follows.textContent = String(s.follows.size);
  }

  function addChip(e, x) {
    const rec = { e, x, el: document.createElement('div') };
    heroEv.push(rec);
    const el = rec.el;
    el.className = 'chip' + (/rejected$/.test(e.type) ? ' chip--no' : '');
    const b = document.createElement('b'); b.textContent = e.type;
    const i = document.createElement('i'); i.textContent = e.data.userId === 'u1' ? 'you' : (e.data.userId || '');
    el.append(b, i);
    if (lane.static) {
      lane.track.append(el);
      while (lane.track.children.length > 6) lane.track.firstChild.remove();
      return;
    }
    el.style.top = ROW_TOP + (heroEv.length % 3) * ROW_H + 'px';
    el.style.left = x + 'px';
    lane.track.append(el);
    if (heroEv.length > KEEP) { const old = heroEv[heroEv.length - 1 - KEEP]; if (old.el) { old.el.remove(); old.el = null; } }
  }
  listeners.add((e) => {
    if (e.stream !== H) return;
    addChip(e, e.seed != null ? e.seed : lane.live + phX() - CHIP_W);
    if (lane.scrub) paintScrub(); else paintViews();
  });

  /* time travel */
  function paintLane() {
    lane.track.style.transform = `translate3d(${-lane.at}px,0,0)`;
    lane.view.style.setProperty('--off', lane.at.toFixed(1));
  }
  function paintScrub() {
    const X = headX();
    const s = fresh();
    let n = 0;
    for (const r of heroEv) {
      const past = !lane.scrub || r.x + CHIP_W <= X + 0.5;
      if (past) { apply(s, r.e); n++; }
      if (r.el) r.el.classList.toggle('is-future', !past);
    }
    paintViews(lane.scrub ? s : states[H]);
    const total = heroEv.length;
    asof.textContent = lane.scrub ? `event ${n} of ${total}` : 'live';
    asof.classList.toggle('is-live', !lane.scrub);
    playTag.textContent = lane.scrub ? `#${n}` : 'now';
    lane.view.classList.toggle('is-scrub', lane.scrub);
    nowBtn.hidden = !lane.scrub;
    playhead.setAttribute('aria-valuemax', String(total));
    playhead.setAttribute('aria-valuenow', String(lane.scrub ? n : total));
    playhead.setAttribute('aria-valuetext', lane.scrub ? `as of event ${n} of ${total}` : 'live');
    if (lane.scrub) {
      heroStatus.textContent = `Replaying the first ${n} of ${total} events. The views are folded from just those. Newer events are still arriving, dimmed on the right.`;
    } else if (heroStatus.textContent.startsWith('Replaying')) {
      heroStatus.textContent = 'Back at now. The views are folded from every event.';
    }
  }
  const minAt = () => {
    const first = heroEv.find((r) => r.el);
    return first ? first.x + CHIP_W - phX() - 160 : 0;
  };
  function seekAt(at) {
    lane.at = Math.min(Math.max(at, minAt()), lane.live);
    const was = lane.scrub;
    lane.scrub = lane.at < lane.live - 1;
    paintLane();
    if (lane.scrub || was) paintScrub();
    if (lane.scrub) cue.hidden = true;
  }
  function goLive(instant) {
    if (!lane.scrub) return;
    if (instant || reduced.matches) { seekAt(lane.live); return; }
    tweenAt(() => lane.live);
  }
  let tweening = false;
  function tweenAt(to) {
    const from = lane.at;
    const t0 = performance.now();
    tweening = true;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 420);
      const k = 1 - Math.pow(1 - p, 3);
      const end = typeof to === 'function' ? to() : to;
      seekAt(from + (end - from) * k);
      if (p < 1) raf(step); else tweening = false;
    };
    raf(step);
  }

  let drag = null;
  lane.view.addEventListener('pointerdown', (ev) => {
    if (lane.static || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    drag = { x: ev.clientX, at: lane.at };
    lane.view.setPointerCapture(ev.pointerId);
    lane.view.classList.add('is-drag');
  });
  lane.view.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    seekAt(drag.at - (ev.clientX - drag.x));
  });
  const endDrag = () => { drag = null; lane.view.classList.remove('is-drag'); };
  lane.view.addEventListener('pointerup', endDrag);
  lane.view.addEventListener('pointercancel', endDrag);
  playhead.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    const X = headX();
    const edges = heroEv.filter((r) => r.el).map((r) => r.x + CHIP_W);
    let to;
    if (ev.key === 'ArrowLeft') to = [...edges].reverse().find((b) => b < X - 24);
    else if (ev.key === 'Home') to = edges[0];
    else if (ev.key === 'ArrowRight') to = edges.find((b) => b > X + 1);
    if (ev.key === 'End' || (ev.key === 'ArrowRight' && (to === undefined || to >= lane.live + phX() - 1))) { goLive(); return; }
    if (to === undefined) return;
    cue.hidden = true;
    if (reduced.matches) seekAt(to - phX()); else tweenAt(to - phX());
  });
  nowBtn.addEventListener('click', () => goLive());

  /* Once, a few seconds in: the playhead slides back and returns, so the page shows the gesture before it asks for it. */
  let touched = false;
  const touch = () => { touched = true; };
  lane.view.addEventListener('pointerdown', touch);
  playhead.addEventListener('keydown', touch);
  $$('[data-fire]').forEach((b) => b.addEventListener('click', touch));
  function peek() {
    if (touched || lane.scrub || reduced.matches || !heroVisible || paused) return;
    const back = Math.min(lane.vw * 0.3, 420);
    tweenAt(lane.at - back);
    setTimeout(() => { if (!touched && lane.scrub) goLive(); }, 1700);
  }
  setTimeout(peek, 3600);

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
      e.seed = phX() - CHIP_W - (seeded.length - 1 - i) * 132; // the opening events already sit left of "now"
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
    goLive(true);
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
  let nextIn = 300;
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
    lane.live += (lane.speed * dt) / 1000;
    if (!lane.scrub && !tweening) { lane.at = lane.live; paintLane(); }
    nextIn -= dt;
    if (nextIn <= 0) { ambient(); nextIn = 650 + Math.random() * 750; }
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
  new ResizeObserver(() => { lane.vw = lane.view.clientWidth; if (lane.scrub) paintScrub(); }).observe(lane.view);

  bootHero();
  paintViews();
  if (reduced.matches) {
    pauseBtn.hidden = true; playhead.hidden = true; cue.hidden = true;
    $('.pf-lane__future').hidden = true;
  }
  sync();

  /* copying a command, used by the hero chip and the close */
  async function copyText(text, field) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { if (field) field.select(); return false; }
  }
  const heroCopy = $('#hero-copy');
  heroCopy.addEventListener('click', async () => {
    const ok = await copyText('npx -y eventline-axi');
    const s = $('#hero-copy-s');
    s.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    setTimeout(() => { s.textContent = 'Copy'; }, 1800);
  });

  /* --------------------------------------------------------------- premise -- */
  /* The engine clips the events lens; the yellow edge rides the clip boundary. */
  const lensB = $('#lens-b');
  const lensEdge = $('#lens-edge');
  let lensLive = false;
  function lensLoop() {
    if (!lensLive) return;
    const m = /inset\(\S+\s+([\d.]+)%/.exec(lensB.style.clipPath || '');
    const pct = m ? parseFloat(m[1]) : 0;
    const w = lensEdge.parentElement.clientWidth;
    lensEdge.style.opacity = pct > 99.5 || pct < 0.5 ? '0' : '1';
    lensEdge.style.transform = `translate3d(${((100 - pct) / 100) * w - 1.5}px,0,0)`;
    raf(lensLoop);
  }
  new IntersectionObserver((es) => {
    const on = es[0].isIntersecting;
    if (on && !lensLive) { lensLive = true; raf(lensLoop); } else if (!on) lensLive = false;
  }, { rootMargin: '30% 0px' }).observe($('#premise'));

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
    const ok = await copyText(cmd.textContent);
    if (!ok) { const r = document.createRange(); r.selectNodeContents(cmd); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    copyStatus.textContent = ok ? 'Copied. Paste it in any folder.' : 'Selected. Press Ctrl+C or Cmd+C to copy.';
    setTimeout(() => { copyStatus.innerHTML = hintHTML; }, 4000);
  });

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

  const boardFig = $('.pf-board__fig');
  const boardImg = $('img', boardFig);
  fetch(boardImg.getAttribute('src')).then((r) => r.text()).then((text) => {
    const svg = inlineSvg(text);
    if (!svg) return;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    boardImg.replaceWith(svg);
    traceBoard(svg, $('#trace'), $('#trace').textContent);
    window.dispatchEvent(new Event('resize'));
  }).catch(() => {});

  /* ------------------------------------------------------------ playground -- */
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
  const paintMirror = () => { pgEl.mirror.innerHTML = pgEl.text.value.split('\n').map(hlLine).join('\n') + '\n'; };
  const syncScroll = () => {
    pgEl.mirrorBox.scrollTop = pgEl.text.scrollTop; pgEl.mirrorBox.scrollLeft = pgEl.text.scrollLeft;
    pgEl.hl.style.transform = 'translate3d(0,' + (-pgEl.text.scrollTop) + 'px,0)';
  };
  pgEl.text.addEventListener('scroll', syncScroll);

  const b64 = {
    enc(s) { let bin = ''; new TextEncoder().encode(s).forEach((x) => { bin += String.fromCharCode(x); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec(s) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))); },
  };

  let eventline = null;       // window.eventline once the bundle has loaded
  let lastSvg = '';
  let pgKind = 'eventmodel';  // which diagram of the model is on the board
  let pgLinks = false;        // whether boxes link to the same thing in another diagram
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
    $('#pg-svg').textContent = 'Download ' + KIND_FILE[pgKind] + '.svg';
  }
  /* The address says where you are: the text when it is not a preset, the diagram, and whether links are on. */
  function currentHash(forceText) {
    let h = (forceText || pgDirty || pgKind !== 'eventmodel' || pgLinks) ? '#play=' + b64.enc(pgEl.text.value) : '#play';
    if (pgKind !== 'eventmodel') h += '&d=' + pgKind;
    if (pgLinks) h += '&links=1';
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
    try {
      model = eventline.parse(text);
    } catch (err) {
      pgEl.grid.dataset.state = 'error';
      pgEl.status.classList.add('is-error');
      pgEl.status.textContent = err.message;
      return;
    }
    pgEl.status.classList.remove('is-error');
    const drawable = model.commands.length + model.events.size + model.views.length + model.policies.length;
    if (!drawable) {
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
    try { svgText = eventline.render(model, pgKind, 'svg', 'dark', renderOpts()); } catch (err) {
      pgEl.grid.dataset.state = 'error'; pgEl.status.classList.add('is-error'); pgEl.status.textContent = err.message; return;
    }
    lastSvg = svgText;
    const svg = inlineSvg(svgText);
    svg.removeAttribute('width'); svg.removeAttribute('height');
    for (const a of $$('a', svg)) {
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
    const issues = eventline.check(model).slice(0, 5);
    for (const it of issues) {
      const li = document.createElement('li'); li.dataset.s = it.severity;
      const span = document.createElement('span'); span.textContent = it.message;
      li.append(span);
      if (Number.isInteger(it.line) && it.line > 0) {
        const go = document.createElement('button'); go.type = 'button'; go.className = 'pg__issue'; go.textContent = 'line ' + it.line;
        go.setAttribute('aria-label', 'Show line ' + it.line + ' in the editor');
        go.addEventListener('click', () => { if (pgBoard) pgBoard.tracer.setBase(null); pgSel = null; showLines([[it.line, it.line]], true); });
        span.append(go);
      }
      pgEl.issues.append(li);
    }
  }
  function setText(text, fromUser) {
    pgEl.text.value = text;
    paintMirror();
    clearTimeout(timer);
    timer = setTimeout(() => {
      drawBoard();
      if (fromUser) { pgDirty = true; history.replaceState(null, '', currentHash(true)); }
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
    if (name === 'start') { setText(START, false); history.replaceState(null, '', currentHash(false)); return; }
    try {
      if (!presetCache[name]) presetCache[name] = await (await fetch('examples/' + name + '.dsl')).text();
      setText(presetCache[name], false);
      history.replaceState(null, '', currentHash(false));
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
      for (const [from, to] of rangesOf(el)) if (line >= from && line <= to && to - from < size) { best = id; size = to - from; }
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
    history.replaceState(null, '', currentHash(true));
    const ok = await copyText(location.href);
    if (ok) flash(ev.currentTarget); else pgEl.status.textContent = 'Copy the address bar: it already holds this model.';
  });
  const download = (name, type, body) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#pg-dsl').addEventListener('click', (ev) => { download('model.dsl', 'text/plain', pgEl.text.value); flash(ev.currentTarget); });
  /* The download is the diagram as the CLI writes it: with links on, they point at <diagram>.svg beside the file. */
  $('#pg-svg').addEventListener('click', (ev) => {
    if (!eventline) return;
    try {
      const svg = eventline.render(eventline.parse(pgEl.text.value), pgKind, 'svg', 'dark', pgLinks ? { links: true } : {});
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
    return { text: m[1] || null, kind: p.get('d'), node: p.get('n'), links: p.get('links') === '1' };
  }
  function applyHash() {
    const h = parseHash();
    if (!h || (h.text === null && !h.kind)) return false; // a bare #play is just the section
    try {
      if (h.kind && kindTabs.some((t) => t.dataset.kind === h.kind)) pgKind = h.kind; else if (!h.kind) pgKind = 'eventmodel';
      pgLinks = h.links;
      pgSel = h.node;
      paintKinds();
      if (h.text !== null) {
        const text = b64.dec(h.text);
        if (text !== pgEl.text.value) { $$('.pg__tab').forEach((t) => t.setAttribute('aria-pressed', 'false')); pgDirty = true; setText(text, false); return true; }
      }
      if (eventline) drawBoard();
      return true;
    } catch { return false; }
  }
  /* follow a link to another diagram, keeping the model; the previous diagram stays one back-button away */
  function goTo(kind, node) {
    history.replaceState(null, '', currentHash(true)); // so back returns here, text and all
    pgKind = kind; pgSel = node || null; pgDirty = true;
    paintKinds();
    drawBoard();
    history.pushState(null, '', currentHash(true) + (node ? '&n=' + encodeURIComponent(node) : ''));
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
    b.addEventListener('click', () => { if (b.disabled) return; setKind(b.dataset.kind); pgSel = null; drawBoard(); history.replaceState(null, '', currentHash(false)); });
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
  linksBtn.addEventListener('click', () => { pgLinks = !pgLinks; paintKinds(); drawBoard(); history.replaceState(null, '', currentHash(false)); });

  const hashed = applyHash();
  if (!pgEl.text.value) { pgEl.text.value = START; paintMirror(); }
  window.addEventListener('hashchange', () => { if (applyHash()) $('#play').scrollIntoView(); });

  let loading = false;
  function loadBundle() {
    if (eventline || loading) return;
    loading = true;
    const s = document.createElement('script');
    s.src = 'eventline.js';
    s.onload = () => { eventline = window.eventline; drawBoard(); };
    s.onerror = () => { pgEl.status.textContent = 'The parser did not load. Check your connection and reload.'; };
    document.head.append(s);
  }
  new IntersectionObserver((es) => { if (es[0].isIntersecting) loadBundle(); }, { rootMargin: '150% 0px' }).observe($('#play'));
  if (hashed) loadBundle();
  if (hashed) requestAnimationFrame(() => $('#play').scrollIntoView());

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
