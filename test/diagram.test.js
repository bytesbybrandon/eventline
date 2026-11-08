'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../lib/parser');
const { buildBoard, boardToGraph } = require('../lib/diagram/board');
const { BUILDERS } = require('../lib/diagram/system');
const { render, KINDS } = require('../lib/commands/diagram');
const { check } = require('../lib/commands/validate');

const load = (name) => parse(fs.readFileSync(path.join(__dirname, '..', 'examples', name), 'utf8'));
const byId = (board, id) => board.nodes.find((n) => n.id === id);

test('board: each command owns a column, its actor above it and its events beneath it', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  const post = byId(b, 'cmd:postTweet');
  assert.equal(byId(b, 'actor:postTweet').col, post.col);
  for (const ev of ['tweet-created', 'tweet-rejected']) {
    const n = byId(b, `evt:${ev}`);
    assert.equal(n.col, post.col, `${ev} should sit under postTweet`);
    assert.equal(n.lane, 'event');
  }
  const cols = b.nodes.filter((n) => n.lane === 'command' && n.kind === 'command' && n.declared !== false).map((n) => n.col);
  assert.equal(new Set(cols).size, cols.length, 'two commands share a column');
});

test('board: no two nodes occupy the same lane, column and row', () => {
  for (const f of ['twitter-pure.dsl', 'rate-limiter.dsl', 'payment-webhook.dsl']) {
    const b = buildBoard(load(f));
    const seen = new Set();
    for (const n of b.nodes) {
      const k = `${n.lane}:${n.col}:${n.row}`;
      assert.ok(!seen.has(k), `${f}: ${k} used twice`);
      seen.add(k);
    }
  }
});

test('board: order follows causality, so a command comes after the command whose event it needs', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  assert.ok(byId(b, 'cmd:deleteTweet').col > byId(b, 'cmd:postTweet').col);
  const rl = buildBoard(load('rate-limiter.dsl'));
  assert.ok(byId(rl, 'cmd:makeRequest').col > byId(rl, 'cmd:authenticate').col);
});

test('board: a view sits right of the events that feed it; a worker right of its trigger', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  const details = byId(b, 'view:TweetDetails');
  assert.ok(details.col > byId(b, 'evt:tweet-created').col);
  assert.ok(byId(b, 'pol:trending-analyzer').col > byId(b, 'evt:tweet-created').col);
  const ev = (from, to, kind) => b.edges.some((e) => e.from === from && e.to === to && e.kind === kind);
  assert.ok(ev('evt:tweet-created', 'view:TweetDetails', 'projects'));
  assert.ok(ev('pol:notification-worker', 'cmd:sendLikeNotification', 'invokes'));
});

test('board: facts nobody emits become a note, and a command nobody declared is marked as not modeled', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  assert.match(byId(b, 'cmd:likeTweet').note, /tweet-exists/);
  assert.equal(b.nodes.some((n) => n.id.startsWith('evt:tweet-exists')), false);
  assert.equal(byId(b, 'cmd:sendLikeNotification').declared, false);
});

test('board: slices follow the four Event Modeling patterns', () => {
  const types = (f) => new Set(buildBoard(load(f)).slices.map((s) => s.type));
  assert.deepEqual([...types('twitter-pure.dsl')].sort(), ['automation', 'state change', 'state view']);
  assert.ok(types('payment-webhook.dsl').has('translation'));
});

test('board: boundaries bracket the commands that state them, and only those', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  const feed = b.groups.find((g) => g.id === 'bnd:TweetFeed');
  assert.deepEqual(feed.members.filter((m) => m.startsWith('cmd:')).sort(), ['cmd:deleteTweet', 'cmd:likeTweet', 'cmd:retweet']);
  const noBoundary = parse('user -> a() on [x-y] --[default]--> [a-b]\n');
  assert.equal(buildBoard(noBoundary).groups.length, 0);
});

test('command variants merge into one column', () => {
  const b = buildBoard(load('payment-webhook.dsl'));
  assert.equal(b.nodes.filter((n) => n.id === 'cmd:ingestCharge').length, 1);
  assert.ok(byId(b, 'evt:payment-captured'));
});

test('every kind and format renders, with every edge landing on a drawn node', () => {
  for (const f of ['twitter-pure.dsl', 'rate-limiter.dsl']) {
    const m = load(f);
    for (const kind of KINDS) {
      const svg = render(m, kind, 'svg');
      assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
      assert.ok(!/NaN|undefined/.test(svg), `${f} ${kind}: bad number or label in svg`);
      const mmd = render(m, kind, 'mermaid');
      assert.match(mmd, /^flowchart LR/);
      const dot = render(m, kind, 'dot');
      assert.equal((dot.match(/{/g) || []).length, (dot.match(/}/g) || []).length);
      const declared = new Set([...mmd.matchAll(/^\s+(n\d+)\[/gm)].map((x) => x[1]));
      for (const [, a, b] of mmd.matchAll(/^\s+(n\d+) [-.]+>(?:\|"[^"]*"\|)? (n\d+)$/gm)) {
        assert.ok(declared.has(a) && declared.has(b), `${f} ${kind}: edge ${a}->${b} has an undeclared end`);
      }
    }
  }
});

test('context: an outside actor that issues commands points into the system, a dependency points out', () => {
  const m = parse('system S { external: stripe (payments), sentry (monitoring) }\nactor User { auth: session }\nstripe-webhook -> pay() on [a-b] --[default]--> [c-d]\nuser -> go() on [a-b] --[default]--> [e-f]\n');
  const g = BUILDERS.context(m);
  const edge = (from, to) => g.edges.find((e) => e.from === from && e.to === to);
  assert.ok(edge('ext:stripe', 'sys'), 'stripe should call in');
  assert.ok(edge('sys', 'ext:sentry'), 'sentry is a dependency');
  assert.equal(edge('actor:user', 'sys').label, 'go');
});

test('containers: the model never says which container calls an outside service, so no arrow is invented', () => {
  const g = BUILDERS.containers(load('twitter-pure.dsl'));
  const ext = g.nodes.filter((n) => n.kind === 'external').map((n) => n.id);
  assert.ok(ext.length === 3);
  assert.equal(g.edges.some((e) => ext.includes(e.to) || ext.includes(e.from)), false);
  assert.ok(g.groups[0].members.includes('store'));
});

test('deployment: needs regions, and says so instead of guessing', () => {
  assert.throws(() => BUILDERS.deployment(parse('user -> a() on [x-y] --[default]--> [a-b]\n')), (e) => e.code === 'NO_REGIONS');
  const g = BUILDERS.deployment(load('twitter-pure.dsl'));
  assert.equal(g.groups.length, 3);
  assert.ok(g.groups.every((r) => r.members.some((id) => id.endsWith(':api'))));
});

test('deployment: a boundary that states @cost(regions=n) only appears in the first n regions', () => {
  const m = parse('system S { region: a, b, c }\nboundary Local(k) @cost(regions=1)\nboundary Wide(k)\nuser -> x() in Local(k) on [a-b] --[default]--> [c-d]\n');
  const g = BUILDERS.deployment(m);
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.ok(ids.has('a:shard:Local') && !ids.has('b:shard:Local') && !ids.has('c:shard:Local'));
  assert.ok(ids.has('c:shard:Wide'));
});

test('validate: boundary and fact mistakes are reported', () => {
  const m = parse('boundary B(k)\nview V(k) = [a-b(k)] => { k }\nuser -> go() in Nope(k) on [V(k)] from [Ghost(k)] --[x]--> [c-d]\n');
  const rules = check(m).map((i) => `${i.severity}:${i.rule}`);
  assert.ok(rules.includes('error:unknown-boundary'));
  assert.ok(rules.includes('error:on-facts'));
  assert.ok(rules.includes('warn:from-facts'));
  assert.ok(rules.includes('warn:missing-default'));
});

test('validate: the shipped examples have no errors', () => {
  for (const f of ['twitter-pure.dsl', 'rate-limiter.dsl', 'payment-webhook.dsl']) {
    assert.deepEqual(check(load(f)).filter((i) => i.severity === 'error'), [], f);
  }
});

test('boardToGraph keeps every node and edge for the exporters', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  const g = boardToGraph(b);
  assert.equal(g.nodes.length, b.nodes.length);
  assert.equal(g.edges.length, b.edges.length);
});
