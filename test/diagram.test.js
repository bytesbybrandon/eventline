'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../lib/parser');
const { buildBoard, boardToGraph, LANES, LANE_LABELS, needsImpliedReadModel } = require('../lib/diagram/board');
const { BUILDERS } = require('../lib/diagram/system');
const { render, KINDS } = require('../lib/diagram');
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

test('board: a read model sits right of the events that feed it; a worker right of the implied read model', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  const details = byId(b, 'view:TweetDetails');
  assert.ok(details.col > byId(b, 'evt:tweet-created').col);
  assert.ok(byId(b, 'implied:tweet-created').col > byId(b, 'evt:tweet-created').col);
  assert.ok(byId(b, 'pol:trending-analyzer').col > byId(b, 'implied:tweet-created').col);
  const ev = (from, to, kind) => b.edges.some((e) => e.from === from && e.to === to && e.kind === kind);
  assert.ok(ev('evt:tweet-created', 'view:TweetDetails', 'projects'));
  assert.ok(ev('pol:notification-worker', 'cmd:sendLikeNotification', 'invokes'));
});

test('board: facts nobody emits become a note, and a command nobody declared is marked as not modeled', () => {
  const b = buildBoard(load('twitter-pure.dsl'));
  assert.match(byId(b, 'cmd:likeTweet').notes[0], /^checks .*tweet-exists \(assumed\)/);
  assert.equal(b.nodes.some((n) => n.id.startsWith('evt:tweet-exists')), false);
  assert.equal(byId(b, 'cmd:sendLikeNotification').declared, false);
});

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

test('needsImpliedReadModel: only an event trigger with no from read model fed by that event', () => {
  const m = parse('readmodel Todo(id) = [x-happened*(id)] => { id }\nx-happened from [Todo] -> w -> go(id)\nx-happened -> v -> go(id)\nfrom [Todo] -> u -> go(id)\nevery 1 hours -> s -> go()');
  assert.deepEqual(m.policies.map((p) => needsImpliedReadModel(m, p)), [false, true, false, false]);
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
    for (const kind of KINDS.filter((k) => k !== 'contextmap')) {
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
