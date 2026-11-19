'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, ParseError } = require('../lib/parser');
const Model = require('../lib/model');

const load = (name) => parse(fs.readFileSync(path.join(__dirname, '..', 'examples', name), 'utf8'));
const emitted = (cmd, branch) => cmd.branches.find((b) => (branch === 'default' ? b.default : b.guard === branch)).emits.map((e) => e.event);

test('twitter-pure: every command keeps its default branch and the events it emits', () => {
  const m = load('twitter-pure.dsl');
  assert.equal(m.commands.length, 5);
  for (const c of m.commands) assert.ok(c.branches.some((b) => b.default && b.emits.length), `${c.name} lost its default branch`);
  const post = m.commands.find((c) => c.name === 'postTweet');
  assert.deepEqual(emitted(post, 'default'), ['tweet-created']);
  assert.deepEqual(emitted(post, 'content.length > 280'), ['tweet-rejected']);
  assert.deepEqual(post.boundary, { name: 'UserTimeline', args: 'userId' });
  assert.deepEqual(post.params, ['content', 'media?']);
});

test('twitter-pure: the event index counts emitted and assumed events', () => {
  const m = load('twitter-pure.dsl');
  assert.equal(m.events.size, 16);
  assert.deepEqual(m.assumedEvents().sort(), ['tweet-exists', 'user-authenticated', 'user-created', 'user-exists', 'user-updated']);
  assert.deepEqual(m.events.get('tweet-created').emittedBy.map((e) => e.name), ['postTweet']);
  assert.ok(m.events.get('tweet-created').consumedBy.some((c) => c.kind === 'view' && c.name === 'UserTimeline'));
  assert.ok(m.events.get('trend-detected').emittedBy.some((e) => e.kind === 'policy'));
});

test('twitter-pure: views, boundaries and policies parse with their details', () => {
  const m = load('twitter-pure.dsl');
  const timeline = m.views.find((v) => v.name === 'UserTimeline');
  assert.deepEqual(timeline.sources.map((s) => [s.name, s.wildcard]), [['user-followed', true], ['tweet-created', true], ['tweet-retweeted', true]]);
  assert.equal(timeline.annotations.bergcache.ttl, '5m');
  assert.equal(m.boundaries.find((b) => b.name === 'UserFollows').annotations.partition.shardKey, 'userId');

  const trending = m.policies.find((p) => p.trigger.event === 'tweet-created').rules[0];
  assert.equal(trending.worker, 'trending-analyzer');
  assert.match(trending.guard, /> 10000$/);
  assert.deepEqual(trending.emits.map((e) => e.event), ['trend-detected']);
  const notify = m.policies.find((p) => p.trigger.event === 'tweet-liked').rules[0];
  assert.deepEqual([notify.worker, notify.command.name, notify.guard], ['notification-worker', 'sendLikeNotification', null]);
});

test('system block: externals keep their roles, lists split, constraints collect', () => {
  const m = parse('system S {\n external: stripe (payments), sentry\n region: a, b\n constraint: x y\n}\n');
  assert.deepEqual(m.system.externals, [{ name: 'stripe', role: 'payments' }, { name: 'sentry', role: '' }]);
  assert.deepEqual(m.system.regions, ['a', 'b']);
  assert.deepEqual(m.system.constraints, ['x y']);
});

test('rate-limiter: multi-line on and from facts, freshness, aliases, confidence on a policy emission', () => {
  const m = load('rate-limiter.dsl');
  const req = m.commands.find((c) => c.name === 'makeRequest');
  assert.deepEqual(req.on.map((f) => [f.name, f.wildcard]), [['user-auth-succeeded', false], ['request-logged', true]]);
  assert.match(req.on[1].args, /window: currentMinute/);
  assert.deepEqual(req.from, [{ name: 'TierLimit', wildcard: false, args: 'tierId', freshness: '24h', alias: 'tierLimit' }]);
  assert.equal(req.branches.length, 3);
  const stale = m.policies.find((p) => p.trigger.event === 'unavailable-shard-request-received').rules[0];
  assert.equal(stale.worker, null);
  assert.equal(stale.emits[0].annotations.confidence.level, 'low');
  const waf = m.policies.find((p) => p.trigger.event === 'rate-limit-reached').rules[0];
  assert.deepEqual([waf.worker, waf.command.name, waf.guard], ['waf-bot', 'applyTemporaryBan', 'violationsLastHour > 50']);
});

test('payment-webhook: an outside actor issues commands, and a command can have variants', () => {
  const m = load('payment-webhook.dsl');
  const ingest = m.commands.filter((c) => c.name === 'ingestCharge');
  assert.equal(ingest.length, 2);
  assert.equal(ingest[1].from[0].freshness, 'eventual');
  assert.equal(ingest[1].branches[0].emits[0].annotations.confidence.reason, 'dedup_unavailable');
  assert.equal(m.boundaries[0].annotations.cost.regions, '2');
});

test('actorKind matches declared actors case-insensitively and externals by prefix', () => {
  const m = parse('system S { external: stripe (pay) }\nactor User { auth: session }\nuser -> a() on [x-y] --[default]--> [a-b]\nstripe-webhook -> b() on [x-y] --[default]--> [b-c]\nghost -> c() on [x-y] --[default]--> [c-d]\n');
  assert.deepEqual(['user', 'stripe-webhook', 'ghost'].map((n) => m.actorKind(n)), ['actor', 'external', 'unknown']);
});

test('comments and CRLF line endings do not change the result', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'examples', 'twitter-pure.dsl'), 'utf8').replace(/\r\n/g, '\n');
  const a = parse(src);
  const b = parse(src.replace(/\n/g, '\r\n').replace(/^/, '// leading comment\r\n'));
  assert.deepEqual(a.toJSON().commands.map((c) => c.name), b.toJSON().commands.map((c) => c.name));
  assert.equal(a.events.size, b.events.size);
});

test('errors say what was expected and on which line', () => {
  assert.throws(() => parse('system S {\n  slo: x\n'), (e) => e instanceof ParseError && e.line === 1 && /Unclosed/.test(e.message));
  assert.throws(() => parse('actor A { auth: none }\n\nbanana split\n'), (e) => e.line === 3 && /Unexpected "banana"/.test(e.message));
  assert.throws(() => parse('user -> go() on [a-b]\n'), (e) => /needs at least one/.test(e.message));
  assert.throws(() => parse('a-b { x } \n'), (e) => /needs a rule/.test(e.message));
});

test('commands, views and policies know where their block ends, without the comments after it', () => {
  const m = parse(['view A(id) = [a-done*(id)] => {', '  n', '}', '', '// next block', 'user -> go(id)', 'on [a-done(id)]', '  --[default]--> [', '    went { id }', '  ]', '', '// trailing note', ''].join('\n'));
  assert.deepEqual([m.views[0].line, m.views[0].endLine], [1, 3]);
  assert.deepEqual([m.commands[0].line, m.commands[0].endLine], [6, 10]);
});

test('readmodel is the keyword for a read model, and view still works', () => {
  const a = parse('readmodel Cart(cartId) = [item-added*(cartId)] => { items: count(item-added*(cartId)) }');
  const b = parse('view Cart(cartId) = [item-added*(cartId)] => { items: count(item-added*(cartId)) }');
  assert.deepEqual(a.views.map(({ line, endLine, ...v }) => v), b.views.map(({ line, endLine, ...v }) => v));
  const mixed = parse('view A(id) = [x-happened*(id)] => { n: count(x-happened*(id)) }\nreadmodel B(id) = [x-happened*(id)] => { n: count(x-happened*(id)) }');
  assert.deepEqual(mixed.views.map((v) => v.name), ['A', 'B']);
});
test('an actor called readmodel or from still issues commands', () => {
  assert.equal(parse('readmodel -> refresh(id)\n  --[default]--> [x-refreshed { id }]').commands[0].actor, 'readmodel');
  assert.equal(parse('from -> send(id)\n  --[default]--> [x-sent { id }]').commands[0].actor, 'from');
});
test('a policy can start from read models alone', () => {
  const m = parse('from [OrdersToShip] -> fulfilment-worker -> shipOrder(cartId)');
  assert.deepEqual(m.policies[0].trigger, { event: null, schedule: null, readModels: true, fields: [] });
  assert.deepEqual(m.policies[0].from.map((f) => f.name), ['OrdersToShip']);
  assert.equal(m.policies[0].rules[0].worker, 'fulfilment-worker');
  const g = parse('from [OrdersToShip] --[ready]--> fulfilment-worker -> shipOrder(cartId)');
  assert.equal(g.policies[0].rules[0].guard, 'ready');
});
test('event and timer triggers say they do not start from read models', () => {
  assert.equal(parse('x-happened { id } -> w -> go(id)').policies[0].trigger.readModels, false);
  assert.equal(parse('every 5 minutes -> w -> go()').policies[0].trigger.readModels, false);
});
test('from without a list is an error that shows both automation forms', () => {
  assert.throws(() => parse('from OrdersToShip -> w -> go()'), /from \[/);
  assert.throws(() => parse('nonsense'), /readmodel/);
});
test('an event called readmodel still starts a policy, as on main', () => {
  for (const src of ['readmodel from [X] -> w -> go(id)', 'readmodel { id } -> w -> go(id)', 'readmodel --[g]--> w -> go(id)', 'readmodel @note("x") -> w -> go(id)']) {
    const p = parse(src).policies[0];
    assert.equal(p.trigger.event, 'readmodel', src);
    assert.equal(p.rules[0].worker, 'w', src);
  }
  assert.deepEqual(parse('readmodel from [X] -> w -> go(id)').policies[0].from.map((f) => f.name), ['X']);
});
test('from with an empty list is an error', () => {
  assert.throws(() => parse('from [] -> w -> go(id)'), /at least one/);
});
test('an event called from still starts a policy, as on main', () => {
  for (const src of ['from { id } -> w -> go(id)', 'from --[g]--> w -> go(id)', 'from @note("x") -> w -> go(id)', 'from from [X] -> w -> go(id)']) {
    const p = parse(src).policies[0];
    assert.equal(p.trigger.event, 'from', src);
    assert.equal(p.trigger.readModels, false, src);
    assert.equal(p.rules[0].worker, 'w', src);
  }
});

test('short guard arrows mean the same as long ones', () => {
  const long = 'user -> go(id)\n  --[bad]--> [x-failed { id }]\n  --[default]--> [x-done { id }]\nx-done { id } --[ok]--> w -> next(id)';
  const short = long.replace(/--\[/g, '-[').replace(/\]-->/g, ']->');
  const strip = (m) => JSON.stringify(m, (k, v) => (k === 'line' || k === 'endLine' ? undefined : v));
  assert.equal(strip(parse(short)), strip(parse(long)));
});
test('a guard must open and close with the same form', () => {
  assert.throws(() => parse('user -> go(id)\n  --[default]-> [x-done { id }]'), /--\[guard\]-->.*-\[guard\]->/);
  assert.throws(() => parse('user -> go(id)\n  -[default]--> [x-done { id }]'), /-\[guard\]->/);
});
test('-[ inside a note or annotation is untouched', () => {
  const m = parse('user -> go(id) @note("a -[b]-> c")\n  --[default]--> [x-done { id }]');
  assert.equal(m.commands[0].notes[0], 'a -[b]-> c');
});

test('policy Name = names a policy with any trigger', () => {
  const m = parse('policy NotifyLiker = tweet-liked { userId } -> notifier -> notify(userId)\npolicy ShipOrders = from [OrdersToShip] -> shipper -> ship(id)\npolicy Nightly = every 1 days -> reporter -> report()');
  assert.deepEqual(m.policies.map((p) => p.name), ['NotifyLiker', 'ShipOrders', 'Nightly']);
  assert.equal(m.policies[0].trigger.event, 'tweet-liked'); assert.equal(m.policies[1].trigger.readModels, true); assert.equal(m.policies[2].trigger.schedule, 'every 1 days');
  assert.equal(Model.policyName(m.policies[0]), 'policy NotifyLiker');
  assert.equal(Model.policyLabel(m.policies[0]), 'tweet-liked');
  assert.equal(parse('x-happened { id } -> w -> go(id)').policies[0].name, null);
});
test('policy and event keep their old meanings', () => {
  assert.equal(parse('policy -> go(id)\n  --[default]--> [x-done { id }]').commands[0].actor, 'policy');
  assert.equal(parse('policy { id } -> w -> go(id)').policies[0].trigger.event, 'policy');
  assert.equal(parse('policy --[g]--> w -> go(id)').policies[0].trigger.event, 'policy');
  assert.equal(parse('policy -[g]-> w -> go(id)').policies[0].trigger.event, 'policy');
  assert.equal(parse('policy from [V] -> w -> go(id)').policies[0].trigger.event, 'policy');
});
test('policy names are unique and never clash with commands, read models or events', () => {
  const clash = (text, message) => assert.throws(() => parse(text), (e) => e.message === `${message} (line 3)`);
  assert.throws(() => parse('policy A = x-y { id } -> w -> go(id)\npolicy A = x-z { id } -> w -> go(id)'), /policy A/);
  clash('user -> Ship(id)\n  --[default]--> [x-done { id }]\npolicy Ship = x-done { id } -> w -> go(id)', 'Policy "Ship" has the same name as a command on line 1; give the policy another name');
  clash('readmodel Ship(id) = [x-done*(id)] => { id }\n\npolicy Ship = x-done { id } -> w -> go(id)', 'Policy "Ship" has the same name as a read model on line 1; give the policy another name');
  clash('user -> go(id)\n  --[default]--> [Ship { id }]\npolicy Ship = x-done { id } -> w -> go(id)', 'Policy "Ship" has the same name as an event; give the policy another name');
  clash('event Ship { id }\n\npolicy Ship = x-done { id } -> w -> go(id)', 'Policy "Ship" has the same name as an event declared on line 1; give the policy another name');
});

test('event declarations, with and without fields, inside contexts', () => {
  const m = parse('event item-added { cartId, sku, addedAt: clock.wall() }\nevent order-placed\ncontext Shop {\n  event cart-opened { cartId }\n}');
  assert.deepEqual(m.events.get('item-added').declared.fields, ['cartId', 'sku', 'addedAt']);
  assert.equal(m.events.get('order-placed').declared.fields, null);
  assert.equal(m.events.get('cart-opened').declared.context, 'Shop');
  assert.equal(m.events.get('item-added').declared.line, 1);
  assert.equal(m.events.get('item-added').emittedBy.length, 0);
});

test('a declaration with fields is the event known payload', () => {
  const m = parse('event item-added { cartId, sku }\nuser -> add(cartId)\n  --[default]--> [item-added { cartId }]');
  assert.deepEqual(m.events.get('item-added').fields.map((f) => f.name), ['cartId', 'sku']);
  const bare = parse('event item-added\nuser -> add(cartId)\n  --[default]--> [item-added { cartId }]');
  assert.deepEqual(bare.events.get('item-added').fields.map((f) => f.name), ['cartId']);
  assert.equal(parse('user -> add(cartId)\n  --[default]--> [item-added { cartId }]').events.get('item-added').declared, null);
});

test('event keeps its old meanings, and a second declaration is an error', () => {
  assert.equal(parse('event -> go(id)\n  --[default]--> [x-done { id }]').commands[0].actor, 'event');
  assert.equal(parse('event { id } -> w -> go(id)').policies[0].trigger.event, 'event');
  assert.equal(parse('event --[ok]--> w -> go(id)').policies[0].trigger.event, 'event');
  assert.equal(parse('event -[ok]-> w -> go(id)').policies[0].trigger.event, 'event');
  assert.equal(parse('event @note("x") -> w -> go(id)').policies[0].trigger.event, 'event');
  assert.equal(parse('event from [Todo] -> w -> go(id)').policies[0].trigger.event, 'event');
  assert.throws(() => parse('event x-done { id }\ncontext A {\n  event x-done { id }\n}'), /x-done/);
  assert.throws(() => parse('event x-done { id }\ncontext A {\n  event x-done { id }\n}'), ParseError);
});

test('every example parses with declared null on each event', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'examples')).filter((n) => n.endsWith('.dsl'))) {
    for (const e of load(f).events.values()) assert.equal(e.declared, null, `${f} ${e.name}`);
  }
});

test('isUsed: recorded, checked with on, folded, or starting an automation; not scenarios', () => {
  const m = parse([
    'event a-done', 'event b-done', 'event c-done', 'event d-done', 'event e-done', 'event f-done',
    'user -> go(id)\n  --[default]--> [a-done { id }]',
    'user -> check(id) on [b-done]\n  --[default]--> [a-done { id }]\n  scenario "s" {\n    given [f-done]\n    when check(id: 1)\n    then [a-done { id: 1 }]\n  }',
    'readmodel V(id) = [c-done*(id)] => { id }',
    'd-done { id } -> w -> go(id)',
  ].join('\n'));
  assert.deepEqual(['a-done', 'b-done', 'c-done', 'd-done', 'e-done', 'f-done'].map((n) => Model.isUsed(m, n)), [true, true, true, true, false, false]);
  assert.equal(Model.isUsed(m, 'nope'), false);
});

test('error messages mention the short guard, named policies and event declarations', () => {
  assert.throws(() => parse('user -> go() on [a-b]\n'), (e) => /-\[guard\]->/.test(e.message));
  assert.throws(() => parse('banana split\n'), (e) => /policy Name = \.\.\./.test(e.message) && /event name \{ fields \}/.test(e.message));
});
