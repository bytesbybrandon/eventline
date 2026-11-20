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
  for (const text of texts) for (const profile of PROFILES.filter((p) => p !== 'workshop')) for (const i of found(text, profile)) seen.add(`${i.rule}:${i.severity}`);
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
  assert.ok(ids(two.replace(/@slice\("Do"\)/g, '@slice(name="Do")'), 'eventmodeling').includes('slice-multiple-commands'), 'name= names the slice too');
  assert.ok(!ids(two.replace(/@slice\("Do"\)/g, '@slice(owner="x")'), 'eventmodeling').includes('slice-multiple-commands'), 'a slice with no name groups nothing');
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

const CMD2 = 'user -> go(id) %A%\n  --[default]--> [a-done { id }, b-done { id }]\n';
const withAnn = (a) => CMD2.replace('%A%', a);

test('@accept keeps a finding in the list, marked with its reason, and does not change its severity', () => {
  const plain = found(withAnn(''), 'eventmodeling').find((i) => i.rule === 'many-events');
  const acc = found(withAnn('@accept(rule="many-events", reason="One fact told in two parts")'), 'eventmodeling').find((i) => i.rule === 'many-events');
  assert.equal(acc.severity, plain.severity);
  assert.equal(acc.accepted.reason, 'One fact told in two parts');
  assert.equal(plain.accepted, undefined);
});

test('@accept needs a real rule and a reason, and one that accepts nothing is reported', () => {
  const r = (a) => ids(withAnn(a), 'eventmodeling').filter((x) => x.startsWith('accept'));
  assert.deepEqual(r('@accept(rule="many-events", reason="x")'), []);
  assert.deepEqual(r('@accept(rule="many-events")'), ['accept-invalid']);
  assert.deepEqual(r('@accept(rule="nonsense", reason="x")'), ['accept-invalid']);
  assert.deepEqual(r('@accept(reason="x")'), ['accept-invalid']);
  assert.match(found(withAnn('@accept'), 'eventmodeling').find((x) => x.rule === 'accept-invalid').message, /needs rule="\.\.\." naming a rule in the catalogue$/);
  assert.deepEqual(r('@accept(rule="view-many-sources", reason="x")'), ['accept-unused']);
});

test('@hotspot is an open question: reported while open, quiet when resolved, and checked for its kind, category and status', () => {
  const r = (a, p = 'eventmodeling') => ids(withAnn(a), p).filter((x) => x.startsWith('hotspot'));
  assert.deepEqual(r('@hotspot("Does the guest lose the deposit?")'), ['hotspot-open']);
  assert.deepEqual(r('@hotspot("Q", kind=assumption, category=rule, status=resolved)'), []);
  assert.deepEqual(r('@hotspot("Q", kind=nope)'), ['hotspot-invalid']);
  assert.deepEqual(r('@hotspot("Q", category=nope)'), ['hotspot-invalid']);
  assert.deepEqual(r('@hotspot("Q", kind=request)'), ['hotspot-invalid']);
  assert.deepEqual(r('@hotspot("Q", kind=request, concerns="scenario")'), ['hotspot-open']);
  assert.deepEqual(r('@hotspot("Q")', 'core'), [], 'core checks only that it is well formed');
  assert.ok(r('@hotspot').includes('hotspot-invalid'), 'a bare @hotspot has no question');
});

test('workshop runs the guidelines and reports every one of them as info', () => {
  const list = found(SHOP.replace('sku }', 'sku, x }'), 'workshop');
  assert.ok(list.some((i) => i.rule === 'unsourced-event-field'));
  assert.ok(list.filter((i) => i.profile !== 'core').every((i) => i.severity === 'info'));
  assert.equal(found(SHOP.replace('sku }', 'sku, x }'), 'eventmodeling').find((i) => i.rule === 'unsourced-event-field').severity, 'warn');
});

test('@dedupe and @correlate name keys of outside facts: they count as supplied, and an outside command without one is hinted', () => {
  const ext = (a) => `system S { external: carrier (translator) }\ncarrier -> scanReceived(parcelId) ${a}\n  --[default]--> [parcel-scanned { parcelId, scanId }]\n`;
  assert.ok(ids(ext(''), 'eventmodeling').includes('unsourced-event-field'));
  assert.ok(!ids(ext('@dedupe(scanId)'), 'eventmodeling').includes('unsourced-event-field'));
  assert.ok(!ids(ext('@correlate(scanId)'), 'eventmodeling').includes('unsourced-event-field'));
  assert.ok(ids(ext(''), 'eventmodeling').includes('translation-no-dedupe'));
  assert.ok(!ids(ext('@dedupe(scanId)'), 'eventmodeling').includes('translation-no-dedupe'));
  const inbox = 'view Inbox(id) = [parcel-scanned*(id)] => { id, scanId }\n' + ext('@dedupe(scanId)');
  assert.ok(!ids(inbox, 'eventmodeling').includes('unsourced-view-field'));
  const view = 'view Inbox(id) = [parcel-scanned*(id)] => { id, deliveryId } @dedupe(deliveryId)\n' + ext('@dedupe(scanId)');
  assert.ok(!ids(view, 'eventmodeling').includes('unsourced-view-field'), 'on a view, a key of the delivery counts for it');
  assert.ok(!ids('user -> a(id)\n  --[default]--> [a-done { id }]\n', 'eventmodeling').includes('translation-no-dedupe'), 'only outside commands');
});

const STEPPED = (body) => `user -> pay(id)\n  --[too poor]--> reject NO_FUNDS\n  --[default]--> [paid { id }]\n  scenario "s" {\n${body}\n  }\n`;

test('a scenario written as steps is read as steps, and Gherkin stays prose', () => {
  const m = parse(STEPPED('    given [funded { id }, signed-in]\n    when pay(id: 1)\n    then [paid { id: 1 }]'));
  const st = m.commands[0].scenarios[0].steps;
  assert.deepEqual(st.given.map((g) => g.event), ['funded', 'signed-in']);
  assert.equal(st.when.name, 'pay');
  assert.deepEqual(st.then.events.map((e) => e.event), ['paid']);
  assert.equal(st.when.line, 6, 'steps know their own line');
  const rej = parse(STEPPED('    when pay(id: 1)\n    then reject NO_FUNDS')).commands[0].scenarios[0].steps;
  assert.equal(rej.then.reject, 'NO_FUNDS');
  assert.equal(parse(STEPPED('    Given a user\n    When they pay\n    Then it is paid')).commands[0].scenarios[0].steps, null);
  assert.equal(parse(STEPPED('    Given a user\n    When they pay\n    Then it is paid')).commands[0].scenarios[0].text.split('\n').length, 3, 'the text is kept as written either way');
  assert.throws(() => parse(STEPPED('    when pay(id: 1)\n    when pay(id: 2)\n    then [paid]')), /two when steps/);
  assert.throws(() => parse(STEPPED('    when pay(id: 1)\n    and something else\n    then [paid]')), /mixes steps with other text/);
});

test('step scenarios are checked against the command: complete, known events, and only what the command can do', () => {
  const r = (body) => found(STEPPED(body), 'core').filter((i) => i.rule.startsWith('scenario')).map((i) => i.rule);
  assert.deepEqual(r('    when pay(id: 1)\n    then [paid { id: 1 }]'), []);
  assert.deepEqual(r('    when pay(id: 1)\n    then reject NO_FUNDS'), []);
  assert.deepEqual(r('    then [paid]'), ['scenario-steps']);
  assert.deepEqual(r('    when pay(id: 1)'), ['scenario-steps']);
  assert.deepEqual(r('    when refund(id: 1)\n    then [paid]'), ['scenario-steps']);
  assert.deepEqual(r('    given [ghost]\n    when pay(id: 1)\n    then [paid]'), ['scenario-unknown-event']);
  assert.deepEqual(r('    when pay(id: 1)\n    then reject NOPE'), ['scenario-then-mismatch']);
  assert.deepEqual(r('    when pay(id: 1)\n    then [ghost]'), ['scenario-unknown-event']);
});

test('a rejection is covered by a step scenario that expects it, no word match needed', () => {
  assert.ok(!ids(STEPPED('    when pay(id: 1)\n    then reject NO_FUNDS'), 'slicerm').includes('rejection-uncovered'));
  assert.ok(ids(STEPPED('    when pay(id: 1)\n    then [paid { id: 1 }]'), 'slicerm').includes('rejection-uncovered'));
});

test('automation-reads-event: an event-started automation should read a read model fed by that event', () => {
  const bad = 'user -> start(id)\n  --[default]--> [x-happened { id }]\nx-happened { id } -> w -> go(id)';
  const good = 'user -> start(id)\n  --[default]--> [x-happened { id }]\nreadmodel Todo(id) = [x-happened*(id)] => { id }\nx-happened from [Todo] -> w -> go(id)';
  const alone = 'user -> start(id)\n  --[default]--> [x-happened { id }]\nreadmodel Todo(id) = [x-happened*(id)] => { id }\nfrom [Todo] -> w -> go(id)';
  assert.ok(!ids(bad, 'core').includes('automation-reads-event'));
  const em = found(bad, 'eventmodeling').filter((i) => i.rule === 'automation-reads-event');
  assert.equal(em.length, 1); assert.equal(em[0].severity, 'info'); assert.match(em[0].message, /from \[/);
  assert.equal(found(bad, 'slicerm').find((i) => i.rule === 'automation-reads-event').severity, 'warn');
  for (const text of [good, alone]) assert.ok(!ids(text, 'slicerm').includes('automation-reads-event'));
});

test('no rule text people read says view where it means a read model', () => {
  for (const r of RULES) for (const k of ['title', 'why', 'fix']) assert.doesNotMatch(r[k].replace(/state view/gi, '').replace(/`[^`]*`/g, ''), /\bviews?\b(?! model)/i, `${r.id}.${k}`);
});

test('event-declared-unused hints at a declaration nothing uses', () => {
  const t = 'event ghost-seen { id }\nevent x-done { id }\nuser -> go(id)\n  --[default]--> [x-done { id }]';
  const hits = found(t, 'eventmodeling').filter((i) => i.rule === 'event-declared-unused');
  assert.equal(hits.length, 1); assert.match(hits[0].message, /ghost-seen/); assert.equal(hits[0].severity, 'info'); assert.equal(hits[0].line, 1);
  assert.ok(ids(t, 'workshop').includes('event-declared-unused'));
  assert.ok(!ids(t, 'core').includes('event-declared-unused'));
});

test('a declared event is not assumed, and its declared fields feed unsourced-view-field', () => {
  assert.ok(!ids('event ghost-seen { id }', 'core').includes('assumed-events'));
  const view = (fields) => `event item-added { ${fields} }\nreadmodel Cart(cartId) = [item-added*(cartId)] => { cartId, sku }`;
  assert.ok(!ids(view('cartId, sku'), 'eventmodeling').includes('unsourced-view-field'));
  assert.ok(ids(view('cartId'), 'eventmodeling').includes('unsourced-view-field'));
  assert.ok(!ids('event item-added\nreadmodel Cart(cartId) = [item-added*(cartId)] => { cartId, sku }', 'eventmodeling').includes('unsourced-view-field'));
});

test('event-contract-mismatch checks each recording against the declaration', () => {
  const base = 'event item-added { cartId, sku, addedAt }\n';
  const good = base + 'user -> add(cartId, sku)\n  --[default]--> [item-added { cartId, sku, addedAt: clock.wall(), note: "x" }]';
  const bad = base + 'user -> add(cartId, sku)\n  --[default]--> [item-added { cartId, sku, addedAt: clock.wall() }]\nuser -> add2(cartId, colour)\n  --[default]--> [item-added { cartId, colour }]';
  assert.ok(!ids(good, 'slicerm').includes('event-contract-mismatch'));
  const hits = found(bad, 'eventmodeling').filter((i) => i.rule === 'event-contract-mismatch');
  assert.equal(hits.length, 1); assert.equal(hits[0].line, 5); assert.equal(hits[0].severity, 'warn');
  assert.match(hits[0].message, /colour/); assert.match(hits[0].message, /sku/); assert.match(hits[0].message, /addedAt/);
  assert.ok(!ids(bad, 'core').includes('event-contract-mismatch'));
  const noList = 'event item-added\nuser -> add(cartId)\n  --[default]--> [item-added { cartId }]';
  const noPayload = base + 'user -> add(cartId)\n  --[default]--> [item-added]';
  for (const t of [noList, noPayload]) assert.ok(!ids(t, 'slicerm').includes('event-contract-mismatch'));
  const policyRecords = base + 'x-done { id } -> w -> [item-added { cartId }]';
  assert.ok(ids(policyRecords, 'eventmodeling').includes('event-contract-mismatch'));
});
test('a read model reading an undeclared field is reported by unsourced-view-field', () => {
  const t = 'event item-added { cartId }\nuser -> add(cartId)\n  --[default]--> [item-added { cartId }]\nreadmodel Cart(cartId) = [item-added*(cartId)] => { cartId, sku }';
  assert.ok(ids(t, 'eventmodeling').includes('unsourced-view-field'));
});
test('a declared field list is the known payload of a fact a command checks with on', () => {
  const cmd = 'user -> ship(orderId)\n  on [order-paid]\n  --[default]--> [shipped { orderId, carrier }]';
  assert.ok(ids('event order-paid { orderId, carrier }\n' + cmd, 'eventmodeling').every((r) => r !== 'unsourced-event-field'));
  assert.ok(ids('event order-paid { orderId }\n' + cmd, 'eventmodeling').includes('unsourced-event-field'));
  assert.ok(ids('event order-paid\n' + cmd, 'eventmodeling').every((r) => r !== 'unsourced-event-field'));
});
test('a field a recording computes, beyond the declaration, is still carried downstream', () => {
  const rec = 'event item-added { cartId, sku }\nuser -> add(cartId, sku)\n  --[default]--> [item-added { cartId, sku, addedAt: clock.now() }]\n';
  const view = rec + 'readmodel Cart(cartId) = [item-added*(cartId)] => { cartId, addedAt }';
  const cmd = rec + 'user -> stamp(cartId)\n  on [item-added]\n  --[default]--> [stamped { cartId, addedAt }]';
  assert.ok(!ids(view, 'eventmodeling').includes('unsourced-view-field'));
  assert.ok(!ids(cmd, 'eventmodeling').includes('unsourced-event-field'));
  assert.ok(ids(view.replace('addedAt }', 'colour }'), 'eventmodeling').includes('unsourced-view-field'));
  assert.ok(ids(cmd.replace('addedAt }]', 'colour }]'), 'eventmodeling').includes('unsourced-event-field'));
});
test('event-contract-mismatch separates the extra and the missing fields with a semicolon', () => {
  const t = 'event item-added { cartId, sku }\nuser -> add(cartId, colour)\n  --[default]--> [item-added { cartId, colour }]';
  const hit = found(t, 'eventmodeling').find((i) => i.rule === 'event-contract-mismatch');
  assert.match(hit.message, /which the declaration lacks; does not carry "sku"/);
});
test('messages about a named policy call it policy Name', () => {
  const msgs = (t, p = 'eventmodeling') => found(t, p).map((i) => i.message).join('\n');
  const named = 'policy NotifyLiker = tweet-liked { tweetId } -> w -> notify(tweetId)\n';
  const all = [
    msgs('policy ShipOrders = from [Missing] -> w -> ship(id)\n', 'core'),
    msgs(named, 'core'),
    msgs('policy NotifyLiker = tweet-liked { tweetId } -> [noted { userId }]\n'),
    msgs(named.replace('} ->', '} @hotspot("Q", kind=nope) ->')),
    msgs(named.replace('} ->', '} @accept(rule="many-events") ->')),
  ];
  for (const m of all) { assert.match(m, /[Pp]olicy (ShipOrders|NotifyLiker)\b/); assert.doesNotMatch(m, /"(ShipOrders|NotifyLiker)"/); }
  const guard = found(named, 'core').find((i) => i.rule === 'policy-guard');
  assert.equal(guard.message, 'Policy NotifyLiker has an unguarded rule');
});
test('automation-reads-event keeps a named policy in its message and suggested rewrite', () => {
  const rec = 'user -> like(tweetId)\n  --[default]--> [tweet-liked { tweetId }]\n';
  const msg = (t) => found(rec + t, 'eventmodeling').find((i) => i.rule === 'automation-reads-event').message;
  assert.equal(msg('policy NotifyLiker = tweet-liked { tweetId } -> notifier -> notify(tweetId)'),
    'Automation policy NotifyLiker on "tweet-liked" starts straight from the event. Write a read model such as PendingNotifyLiker(...) fed by tweet-liked, and start from it: "policy NotifyLiker = tweet-liked from [PendingNotifyLiker] -> ..." or "policy NotifyLiker = from [PendingNotifyLiker] -> ..."');
  assert.equal(msg('tweet-liked { tweetId } -> notifier -> notify(tweetId)'),
    'Automation on "tweet-liked" starts straight from the event. Write a read model such as PendingNotifier(...) fed by tweet-liked, and start from it: "tweet-liked from [PendingNotifier] -> ..." or "from [PendingNotifier] -> ..."');
});

test('triggers, scenarios and read model rules each report once, on the statement they belong to', () => {
  const text = `user -> go(id) @trigger(type=ui) @trigger(name="X", type=cli, route="GET /x") @trigger(name="Y")
  -[default]-> [x-done { id }]
  scenario "" {
    Given x
  }
  scenario "a" {
  }
  scenario "a" {
    Given y
  }
view V(id) = [x-done(id)] => { id } @query(returns="all") @projection @trigger(type=ui, name="S")
view W(id) = [V(id)] => { id }
view Z(id) = [] => { id }
view Q(id) = [x-done(id)] => { id } @query(key=id)
`;
  const rules = ['trigger-name', 'trigger-type', 'trigger-route', 'scenario-name', 'scenario-empty', 'scenario-duplicate', 'query-returns', 'projection-trigger', 'view-from-view', 'view-sources'];
  const found = check(parse(text)).filter((i) => rules.includes(i.rule)).map((i) => `${i.rule} ${i.line}`);
  assert.deepEqual(found, ['trigger-name 1', 'trigger-route 1', 'trigger-type 1', 'scenario-name 3', 'scenario-empty 6', 'scenario-duplicate 8', 'query-returns 11', 'projection-trigger 11', 'view-from-view 12', 'view-sources 13', 'query-returns 14']);
});
