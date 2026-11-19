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
  assert.equal(autos[0].sub, 'unnamed processor');
});

test('board: processors on the same trigger keep source order', () => {
  const b = buildBoard(parse('x-happened { id } -> w1 -> a(id)\nx-happened { id } -> w2 -> b(id)'));
  assert.ok(byId(b, 'pol:w1').col < byId(b, 'pol:w2').col);
  const u = buildBoard(parse('x-happened { id }\n  --[a]--> [y-happened { id }]\n  --[b]--> [z-happened { id }]'));
  assert.ok(byId(u, 'auto:1:0').col < byId(u, 'auto:1:1').col);
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

test('board: a read model sits between the command that feeds it and the next command (Start small)', () => {
  const b = buildBoard(parse([
    'Customer -> addItem(cartId, sku) in Cart(cartId)', 'on [cart-opened(cartId)]', '  --[outOfStock(sku)]--> [item-rejected { cartId, sku }]', '  --[default]--> [item-added { cartId, sku }]',
    'Customer -> checkout(cartId) in Cart(cartId)', 'on [item-added*(cartId)]', '  --[default]--> [order-placed { cartId }]',
    'readmodel CartSummary(cartId) = [item-added*(cartId)] => { items: count(item-added*(cartId)) }',
    'order-placed { cartId }', '  -> fulfilment-worker -> shipOrder(cartId)',
  ].join('\n')));
  const col = (id) => byId(b, id).col;
  assert.ok(col('cmd:addItem') < col('view:CartSummary') && col('view:CartSummary') < col('cmd:checkout'));
  assert.ok(col('evt:order-placed') < col('implied:order-placed') && col('implied:order-placed') < col('pol:fulfilment-worker') && col('pol:fulfilment-worker') < col('cmd:shipOrder'));
});

test('board: in twitter-pure each read model sits right of its latest feeding event and left of later commands', () => {
  const m = load('twitter-pure.dsl');
  const b = buildBoard(m);
  const cmds = b.nodes.filter((n) => n.kind === 'command' && n.declared !== false);
  for (const v of m.views) {
    const node = byId(b, `view:${v.name}`);
    const feeds = v.sources.map((s) => byId(b, `evt:${s.name}`)).filter(Boolean).map((n) => n.col);
    if (!feeds.length) continue;
    const latest = Math.max(...feeds);
    assert.ok(node.col > latest, `${v.name} right of its events`);
    for (const c of cmds) if (c.col > latest) assert.ok(node.col < c.col, `${v.name} left of ${c.id}`);
  }
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

test('board svg: row labels, implied read models drawn dashed, and source lines on new nodes', () => {
  const svg = render(load('twitter-pure.dsl'), 'eventmodel', 'svg', 'dark');
  for (const l of ['ACTOR', 'COMMAND · READ MODEL', 'EVENT']) assert.ok(svg.includes(`>${l}<`), l);
  assert.ok(!/>POLICY<|>VIEW</.test(svg));
  const imp = svg.slice(svg.indexOf('data-id="implied:tweet-liked"'), svg.indexOf('data-id="implied:tweet-liked"') + 400);
  assert.match(imp, /data-lines="\d+-\d+"/); assert.match(imp, /stroke-dasharray/);
  assert.match(svg, /implied read model/); assert.match(svg, /read model/);
  assert.ok(!/fact or view the command reads/.test(svg));
});
test('board links: a processor still links to its worker in the containers diagram', () => {
  const svg = render(load('twitter-pure.dsl'), 'eventmodel', 'svg', 'dark', { links: true });
  assert.match(svg.slice(svg.indexOf('data-id="pol:notification-worker"'), svg.indexOf('data-id="pol:notification-worker"') + 1500), /containers/);
});
test('board svg: a long checks note wraps and keeps (assumed) with its fact', () => {
  const svg = render(load('twitter-pure.dsl'), 'eventmodel', 'svg', 'dark');
  const notes = [...svg.matchAll(/font-size="9.5"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.ok(notes.every((s) => s.length <= 44), 'note lines stay narrow');
  const board = buildBoard(load('twitter-pure.dsl'));
  assert.ok(board.nodes.some((n) => n.checks && n.checks.length > 1));
});
test('board svg: the description pluralises its counts', () => {
  const desc = (t) => render(parse(t), 'eventmodel', 'svg', 'dark').match(/<desc[^>]*>([^<]*)/)[1];
  assert.match(desc('A -> go(id)\n--[default]--> [done]'), /1 command, 1 event, 0 read models, 0 processors; 2 links, 0 consistency boundaries/);
  assert.match(desc(fs.readFileSync(path.join(__dirname, '..', 'examples', 'twitter-pure.dsl'), 'utf8')), /2 processors/);
});

const FAN = 'user -> go(id)\n  --[default]--> [x-done { id }]\npolicy Fan = x-done { id }\n  --[a]--> w1 -> one(id)\n  --[b]--> w2 -> two(id)';
test('board: a named policy is one processor box listing its workers', () => {
  const b = buildBoard(parse(FAN));
  const p = b.nodes.find((n) => n.id === 'policy:Fan');
  assert.equal(p.lane, 'actor'); assert.equal(p.kind, 'policy'); assert.equal(p.label, 'Fan'); assert.equal(p.sub, 'w1, w2');
  assert.equal(b.nodes.some((n) => n.id === 'pol:w1' || n.id === 'pol:w2'), false);
  assert.ok(b.edges.some((e) => e.from === 'policy:Fan' && e.to === 'cmd:one'));
  assert.ok(b.edges.some((e) => e.from === 'policy:Fan' && e.to === 'cmd:two'));
  assert.ok(b.edges.some((e) => e.from === 'implied:x-done' && e.to === 'policy:Fan'));
  assert.deepEqual(p.ranges, [[3, 5]]);
});
test('board: a named policy rule without a worker is listed as automation; unnamed policies are unchanged', () => {
  const b = buildBoard(parse('user -> go(id)\n  --[default]--> [x-done { id }]\npolicy Mix = x-done { id }\n  --[a]--> [y-done { id }]\n  --[b]--> w2 -> two(id)\nx-done { id } -> w3 -> three(id)'));
  assert.equal(byId(b, 'policy:Mix').sub, 'automation, w2');
  assert.ok(byId(b, 'pol:w3'));
  assert.equal(b.nodes.some((n) => n.id.startsWith('auto:')), false);
});
test('board: a named policy keeps its results in source order and labels each with its guard', () => {
  const b = buildBoard(parse(FAN));
  assert.ok(byId(b, 'cmd:one').col < byId(b, 'cmd:two').col);
  const edge = (from, to) => b.edges.find((e) => e.from === from && e.to === to);
  assert.equal(edge('policy:Fan', 'cmd:one').label, 'a');
  assert.equal(edge('policy:Fan', 'cmd:two').label, 'b');
  assert.equal(b.edges.filter((e) => e.to === 'policy:Fan').every((e) => e.label === ''), true);
  const em = buildBoard(parse('user -> go(id)\n  --[default]--> [x-done { id }]\npolicy Rec = x-done { id }\n  --[ok]--> [y-done { id }]\n  --[default]--> [z-done { id }]'));
  assert.equal(em.edges.find((e) => e.from === 'policy:Rec' && e.to === 'evt:y-done').label, 'ok');
  assert.equal(em.edges.find((e) => e.from === 'policy:Rec' && e.to === 'evt:z-done').label, '');
});

test('board: a used declared event is styled declared; an unused one is absent', () => {
  const b = buildBoard(parse('event cart-opened { cartId }\nevent ghost-seen { id }\nuser -> add(cartId)\non [cart-opened(cartId)]\n  --[default]--> [item-added { cartId }]\ncart-opened { cartId } -> w -> go(cartId)'));
  const ev = b.nodes.find((n) => n.id === 'evt:cart-opened');
  assert.equal(ev.sub, 'declared'); assert.ok(!ev.assumed);
  assert.equal(b.nodes.some((n) => n.id === 'evt:ghost-seen'), false);
  assert.match(b.nodes.find((n) => n.id === 'cmd:add').notes.join(' '), /checks cart-opened \(declared\)/);
});
test('board: a declared event shows its declaring context, and a read model notes a declared source', () => {
  const b = buildBoard(parse('context Shop {\n  event cart-opened { cartId }\n}\ncart-opened { cartId } -> w -> go(cartId)\nreadmodel Carts(cartId) = [cart-opened*(cartId)] => { cartId }'));
  assert.equal(b.nodes.find((n) => n.id === 'evt:cart-opened').sub, 'declared · Shop');
  assert.deepEqual(b.nodes.find((n) => n.id === 'view:Carts').notes, ['from cart-opened (declared)']);
});
test('board: an undeclared event nothing records is still assumed', () => {
  const b = buildBoard(parse('user -> add(cartId)\non [cart-opened(cartId)]\n  --[default]--> [item-added { cartId }]'));
  assert.match(b.nodes.find((n) => n.id === 'cmd:add').notes.join(' '), /checks cart-opened \(assumed\)/);
});
test('svg: a declared event nothing records is filled, with a dashed outline', () => {
  const svg = render(parse('event cart-opened { cartId }\ncart-opened { cartId } -> w -> go(cartId)\nuser -> add(cartId)\n  --[default]--> [item-added { cartId }]'), 'eventmodel');
  const node = svg.slice(svg.indexOf('data-id="evt:cart-opened"'));
  assert.match(node.slice(0, node.indexOf('</g>')), /<rect [^>]*fill="#ffd400"[^>]*stroke-dasharray="5 3"/);
  const recorded = svg.slice(svg.indexOf('data-id="evt:item-added"'));
  assert.doesNotMatch(recorded.slice(0, recorded.indexOf('</g>')), /stroke-dasharray/);
});
