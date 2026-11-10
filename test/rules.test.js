'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, check, RULES } = require('../lib');
const { CATEGORIES, PROFILES } = require('../lib/rules');

const found = (text, profile = 'slicerm') => check(parse(text), { profile });
const ids = (text, profile) => found(text, profile).map((i) => i.rule);
const example = (name) => fs.readFileSync(path.join(__dirname, '..', 'examples', `${name}.dsl`), 'utf8');

const SHOP = `boundary Cart(cartId)
user -> addItem(cartId, sku) in Cart(cartId)
  --[default]--> [item-added { cartId, sku }]
view Cart(cartId) = [item-added*(cartId)] => { cartId, items: count(item-added*(cartId)) }
`;

test('the default profile is core, and each profile includes the one before it', () => {
  const text = SHOP.replace('{ cartId, sku }', '{ cartId, sku, note }');
  assert.ok(!check(parse(text)).some((i) => i.rule === 'unsourced-event-field'), 'no profile means core');
  assert.ok(!ids(text, 'core').includes('unsourced-event-field'));
  assert.ok(ids(text, 'eventmodeling').includes('unsourced-event-field'));
  assert.ok(ids(text, 'slicerm').includes('unsourced-event-field'));
  assert.throws(() => check(parse(SHOP), { profile: 'nope' }), /Unknown profile "nope"/);
});

test('every rule that can report is in the catalogue, with its own text, and reports the severity the catalogue gives it', () => {
  const seen = new Set();
  const texts = [...['twitter-pure', 'billing', 'rate-limiter', 'payment-webhook'].map(example), SHOP.replace('sku }', 'sku, x }')];
  for (const text of texts) for (const profile of PROFILES) for (const i of found(text, profile)) seen.add(`${i.rule}:${i.severity}`);
  const byId = new Map(RULES.map((r) => [r.id, r]));
  for (const key of seen) {
    const [id, severity] = key.split(':');
    assert.ok(byId.has(id), `${id} reports but is not in lib/rules/catalogue.js`);
    assert.ok(severity === byId.get(id).severity || severity === byId.get(id).slicerm, `${id} reports ${severity}, the catalogue says ${byId.get(id).severity}`);
  }
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length, 'rule ids are unique');
  for (const r of RULES) {
    assert.ok(PROFILES.includes(r.profile) && r.title && r.why && r.fix, `${r.id} needs a profile, title, why and fix`);
    assert.ok(r.category in CATEGORIES, `${r.id} has an unknown category ${r.category}`);
  }
});

test('a finding says what kind of problem it is, which statement it is about, and where that statement ends', () => {
  const [i] = found(SHOP.replace('sku }', 'sku, x }'), 'eventmodeling').filter((x) => x.rule === 'unsourced-event-field');
  assert.equal(i.category, 'fields');
  assert.deepEqual([i.subject.kind, i.subject.name, i.subject.line, i.subject.endLine], ['command', 'addItem', 2, 3]);
  assert.equal(i.line, 3);
  assert.equal(i.endLine, 3);
  assert.match(i.docs, /rules\/#unsourced-event-field$/);
  const [v] = found('view V(id) = [e-done*(id)] => { zzz }\nuser -> go(id)\n  --[default]--> [e-done { id }]\n', 'eventmodeling').filter((x) => x.rule === 'unsourced-view-field');
  assert.equal(v.endLine, v.subject.endLine, 'a finding on the first line of a statement covers the whole statement');
  const named = found('user -> go(id) @slice("Go")\n  --[default]--> [e-done { id, extra }]\n', 'eventmodeling').find((x) => x.rule === 'unsourced-event-field');
  assert.equal(named.slice, 'Go', 'the slice name comes with the finding, so a tool does not need to map lines to slices');
});

test('unsourced fields: an event holds only what its command was given, and computed or assumed things are exempt', () => {
  assert.deepEqual(ids(SHOP, 'eventmodeling').filter((r) => r.startsWith('unsourced')), []);
  assert.ok(ids(SHOP.replace('{ cartId, sku }', '{ cartId, sku, price }'), 'eventmodeling').includes('unsourced-event-field'));
  assert.ok(!ids(SHOP.replace('{ cartId, sku }', '{ cartId, sku, price: lookup(sku) }'), 'eventmodeling').includes('unsourced-event-field'), 'a computed field is exempt');
  const fromFact = 'user -> go(id)\non [signed-in(userId)]\n  --[default]--> [e-done { id, userId }]\n';
  assert.ok(!ids(fromFact, 'eventmodeling').includes('unsourced-event-field'), 'a name bound by a fact the command needs counts');
  const assumed = 'user -> go(id)\non [signed-in(email)]\n  --[default]--> [e-done { id, userId, tierId }]\n';
  assert.ok(!ids(assumed, 'eventmodeling').includes('unsourced-event-field'), 'a fact nothing records may supply anything');
  assert.ok(ids(SHOP.replace('items: count(item-added*(cartId))', 'items'), 'eventmodeling').includes('unsourced-view-field'));
  assert.ok(!ids(SHOP.replace('items: count(item-added*(cartId))', 'sku'), 'eventmodeling').includes('unsourced-view-field'), 'a view may show what its events carry');
});

test('dependency-cycle finds commands that wait on each other in a loop', () => {
  const loop = 'user -> a(id)\non [b-done(id)]\n  --[default]--> [a-done { id }]\nuser -> b(id)\non [a-done(id)]\n  --[default]--> [b-done { id }]\n';
  const [i] = found(loop, 'eventmodeling').filter((x) => x.rule === 'dependency-cycle');
  assert.match(i.message, /command "a", command "b" wait on each other/);
  const chain = 'user -> a(id)\n  --[default]--> [a-done { id }]\nuser -> b(id)\non [a-done(id)]\n  --[default]--> [b-done { id }]\n';
  assert.ok(!ids(chain, 'eventmodeling').includes('dependency-cycle'));
  for (const name of ['twitter-pure', 'billing', 'rate-limiter', 'payment-webhook']) assert.ok(!ids(example(name), 'slicerm').includes('dependency-cycle'), name);
});

test('slices: one command each, and one query each, but reading other slices views is never flagged', () => {
  const two = 'user -> a(id) @slice("Do")\n  --[default]--> [a-done { id }]\nuser -> b(id) @slice("Do")\n  --[default]--> [b-done { id }]\n';
  assert.ok(ids(two, 'eventmodeling').includes('slice-multiple-commands'));
  const variants = 'user -> a(id) @slice("Do")\n  --[default]--> [a-done { id }]\nuser -> a(id) @slice("Do")\n  --[x]--> [a-failed { id }]\n';
  assert.ok(!ids(variants, 'eventmodeling').includes('slice-multiple-commands'), 'a command written twice is still one command');
  const views = 'view A(id) = [e*(id)] => { id } @slice("Read")\nview B(id) = [e*(id)] => { id } @slice("Read")\nuser -> c(id)\n  --[default]--> [e { id }]\n';
  const sev = (p) => found(views, p).find((x) => x.rule === 'slice-multiple-views').severity;
  assert.equal(sev('eventmodeling'), 'info');
  assert.equal(sev('slicerm'), 'warn', 'slicerm raises it');
  const reads = 'view A(id) = [e*(id)] => { id }\nview B(id) = [e*(id)] => { id }\nuser -> c(id)\nfrom [A(id), B(id)]\n  --[default]--> [e { id }]\n';
  assert.ok(!ids(reads, 'slicerm').includes('slice-multiple-views'));
});

test('scenarios: rejection codes need a scenario, but only in models that use scenarios at all', () => {
  const model = (extra) => `user -> pay(id)\n  --[too poor]--> reject NO_FUNDS\n  --[default]--> [paid { id }]\n${extra}`;
  assert.ok(!ids(model(''), 'slicerm').includes('rejection-uncovered'), 'no scenarios anywhere: they are kept elsewhere');
  const unrelated = model('scenario "happy path" {\n  Given funds\n  When pay\n  Then paid\n}\n');
  assert.ok(ids(unrelated, 'slicerm').includes('rejection-uncovered'));
  const covered = model('scenario "refused" {\n  Given no funds\n  When pay\n  Then rejected with NO_FUNDS\n}\n');
  assert.ok(!ids(covered, 'slicerm').includes('rejection-uncovered'));
  assert.ok(!ids(unrelated, 'eventmodeling').includes('rejection-uncovered'), 'a slicerm rule');
});

test('timers that cannot fire are reported in every profile', () => {
  const timer = (when) => `${when}\n  -> worker -> run()\n`;
  assert.ok(ids(timer('every 0 minutes'), 'core').includes('schedule-invalid'));
  assert.ok(ids(timer('cron "61 * * * *"'), 'core').includes('schedule-invalid'));
  assert.ok(ids(timer('cron "* * *"'), 'core').includes('schedule-invalid'));
  for (const ok of ['every 5 minutes', 'cron "0 9 * * 1"', 'cron "*/15 0-6 * * *"']) assert.ok(!ids(timer(ok), 'core').includes('schedule-invalid'), ok);
});

test('routes: two things on one route in one context are reported, two triggers on one command are not', () => {
  const t = (name, route, ctx = '') => `user -> ${name}(id) @trigger(type=endpoint, name="n", route="${route}")\n  --[default]--> [${name}-done { id }]\n`;
  assert.ok(ids(t('a', 'POST /x') + t('b', 'POST /x'), 'slicerm').includes('route-duplicate'));
  assert.ok(!ids(t('a', 'POST /x') + t('b', 'POST /y'), 'slicerm').includes('route-duplicate'));
  assert.ok(!ids(t('a', 'POST /x') + t('a', 'POST /x'), 'slicerm').includes('route-duplicate'));
  assert.ok(!ids(t('a', 'POST /x') + t('b', 'POST /x'), 'eventmodeling').includes('route-duplicate'), 'a slicerm rule');
});

test('hints stay quiet unless something is unusual, and the examples do not trip any rule above info beyond known gaps', () => {
  const many = 'user -> go(id)\n  --[default]--> [a-done { id }, b-done { id }]\n';
  assert.ok(ids(many, 'eventmodeling').includes('many-events'));
  assert.ok(!ids(SHOP, 'eventmodeling').includes('many-events'));
  assert.ok(ids('view V(id) = [a*(id), b*(id), c*(id), d*(id)] => { id }', 'eventmodeling').includes('view-many-sources'));
});

test('the rules reference is the one the catalogue produces', () => {
  const { render } = require('../scripts/build-rules-doc');
  const onDisk = fs.readFileSync(path.join(__dirname, '..', 'docs', 'RULES.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(onDisk, render(), 'run: node scripts/build-rules-doc.js');
  for (const r of RULES) assert.ok(onDisk.includes(`### ${r.id}\n`), `${r.id} is missing from docs/RULES.md`);
});

test('every example in the catalogue behaves as it says: the bad one is reported and the good one is not', () => {
  for (const r of RULES.filter((x) => x.example)) {
    assert.ok(ids(r.example.bad, 'slicerm').includes(r.id), `${r.id}: the bad example is not reported`);
    assert.ok(!ids(r.example.good, 'slicerm').includes(r.id), `${r.id}: the good example is reported`);
  }
});

test('a command may read events it records itself: that is how a decision checks what already happened', () => {
  for (const text of [
    'user -> refund(id)\non [refunded(id)]\n  --[done]--> reject DONE\n  --[default]--> [refunded { id }]\n',
    'user -> addItem(id)\non [item-added*(id)]\n  --[default]--> [item-added { id }]\n',
  ]) assert.ok(!ids(text, 'slicerm').includes('dependency-cycle'));
});
