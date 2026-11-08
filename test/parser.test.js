'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, ParseError } = require('../lib/parser');

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
