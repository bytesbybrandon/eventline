'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, ParseError } = require('../lib/parser');
const { check } = require('../lib/commands/validate');
const { buildBoard } = require('../lib/diagram/board');
const { BUILDERS } = require('../lib/diagram/system');
const { render } = require('../lib/commands/diagram');

const rules = (src) => check(parse(src)).map((i) => `${i.severity}:${i.rule}`);

test('reject: a branch can refuse with a code and record no event', () => {
  const m = parse('user -> signUp(email: text)\n  --[the email is taken]--> reject EMAIL_TAKEN\n  --[default]--> [account-created { email }]\n');
  const [refuse, ok] = m.commands[0].branches;
  assert.deepEqual([refuse.reject, refuse.emits, refuse.guard], ['EMAIL_TAKEN', [], 'the email is taken']);
  assert.deepEqual([ok.reject, ok.emits.map((e) => e.event)], [null, ['account-created']]);
  assert.deepEqual([...m.events.keys()], ['account-created'], 'a rejection must not become an event');
});

test('reject: validate steers pseudo-events to reject and flags commands that record nothing', () => {
  assert.ok(rules('user -> a()\n  --[x]--> [email-taken-rejected]\n  --[default]--> [a-b]\n').includes('info:rejection-as-event'));
  assert.ok(rules('user -> a()\n  --[default]--> reject NOPE\n').includes('warn:default-rejects'));
  assert.ok(rules('user -> a()\n  --[x]--> reject NOPE\n  --[default]--> reject ALSO\n').includes('warn:no-events'));
});

test('typed parameters keep their name, type and optional mark', () => {
  const m = parse('user -> post(content: text, media?: id, tags: list[text])\n  --[default]--> [a-b]\nview V(userId: id) = [a-b] => { n: number }\n');
  assert.deepEqual(m.commands[0].paramDefs, [
    { name: 'content', optional: false, type: 'text' },
    { name: 'media', optional: true, type: 'id' },
    { name: 'tags', optional: false, type: 'list[text]' },
  ]);
  assert.deepEqual(m.commands[0].params, ['content', 'media?', 'tags']);
  assert.deepEqual(m.views[0].paramDefs, [{ name: 'userId', optional: false, type: 'id' }]);
});

test('notes and annotations on a command header; repeated notes collect', () => {
  const m = parse('user -> go() @note("uses the Tweets API") @planned @note("second") @slice("Go")\n  --[default]--> [a-b]\n');
  const c = m.commands[0];
  assert.deepEqual(c.notes, ['uses the Tweets API', 'second']);
  assert.equal(c.annotations.planned, true);
  assert.equal(c.annotations.slice._[0], 'Go');
});

test('timers: every and cron start a policy that can read a view first', () => {
  const m = parse('every 5 minutes\nfrom [Stale(id) @fresh<1m>]\n  -> sweeper -> sweep(id)\ncron "0 * * * *"\n  -> hourly -> tick()\n');
  assert.deepEqual(m.policies.map((p) => [p.trigger.event, p.trigger.schedule]), [[null, 'every 5 minutes'], [null, 'cron "0 * * * *"']]);
  assert.equal(m.policies[0].from[0].name, 'Stale');
  assert.equal(m.policies[0].from[0].freshness, '1m');
  assert.equal(m.policies[0].rules[0].command.name, 'sweep');
  assert.equal(m.events.size, 0, 'a timer is not an event');
});

test('an event policy can read a view too', () => {
  const m = parse('a-b { x }\nfrom [V(x)]\n  --[ok]--> w -> do(x)\n');
  assert.equal(m.policies[0].trigger.event, 'a-b');
  assert.equal(m.policies[0].from[0].name, 'V');
});

test('contexts: members belong to the block, attributes are read, publishes is a list', () => {
  const m = parse('context Billing {\n  description: Invoices\n  role: core\n  publishes: invoice-opened, invoice-paid\n  infrastructure: none\n  user -> open()\n    --[default]--> [invoice-opened]\n  view V(id) = [invoice-opened] => { x }\n}\nuser -> outside()\n  --[default]--> [x-y]\n');
  assert.deepEqual(m.contexts.map((c) => [c.name, c.description, c.role, c.publishes, c.attrs]), [['Billing', 'Invoices', 'core', ['invoice-opened', 'invoice-paid'], { infrastructure: 'none' }]]);
  assert.deepEqual(m.commands.map((c) => c.context), ['Billing', undefined]);
  assert.equal(m.views[0].context, 'Billing');
  assert.equal(m.events.get('invoice-opened').emittedBy[0].context, 'Billing');
});

test('contexts: nesting and a system block inside one are refused with a line number', () => {
  assert.throws(() => parse('context A {\n context B { }\n}\n'), (e) => e instanceof ParseError && e.line === 2 && /another context/.test(e.message));
  assert.throws(() => parse('context A {\n system S { }\n}\n'), (e) => e.line === 2 && /top level/.test(e.message));
  assert.throws(() => parse('context A {\n user -> x()\n'), (e) => /needs at least one|Unclosed/.test(e.message));
});

test('contexts: reading another context\'s event it does not publish is flagged', () => {
  const src = (pub) => `context A {\n  publishes: ${pub}\n  user -> go()\n    --[default]--> [thing-made]\n}\ncontext B {\n  view V(id) = [thing-made] => { x }\n}\n`;
  assert.ok(rules(src('other-thing')).includes('warn:unpublished-event'));
  assert.ok(!rules(src('thing-made')).includes('warn:unpublished-event'));
});

test('event-naming: kebab by default, pascal and none by choice', () => {
  const body = 'user -> go()\n  --[default]--> [AccountCreated]\n';
  assert.ok(rules(body).includes('warn:event-naming'));
  assert.ok(!rules('system S { event-naming: pascal }\n' + body).includes('warn:event-naming'));
  assert.ok(!rules('system S { event-naming: none }\n' + body).includes('warn:event-naming'));
  assert.ok(rules('system S { event-naming: shouty }\n' + body).includes('warn:event-naming'));
});

test('a command with no facts is only an info note', () => {
  const r = rules('user -> create()\n  --[default]--> [a-b]\n');
  assert.ok(r.includes('info:command-inputs'));
  assert.ok(!r.some((x) => x.startsWith('warn:command-inputs')));
});

test('board: a timer is drawn as its own node, rejections and planned work show on the command', () => {
  const m = parse('every 1 hours\n  -> sweeper -> sweep()\nuser -> go() @planned @note("hi")\n  --[bad]--> reject NOPE\n  --[default]--> [a-b]\n');
  const b = buildBoard(m);
  const timer = b.nodes.find((n) => n.kind === 'timer');
  assert.deepEqual([timer.lane, timer.label], ['actor', 'every 1 hours']);
  const cmd = b.nodes.find((n) => n.id === 'cmd:go');
  assert.ok(cmd.planned && cmd.sub === 'planned');
  assert.deepEqual(cmd.notes, ['rejects NOPE']);
  assert.deepEqual(cmd.fullNotes, ['hi']);
  assert.equal(b.nodes.some((n) => /NOPE/.test(n.label)), false, 'a rejection is a note, not a node');
});

test('context map: events crossing contexts become arrows, unpublished ones dashed', () => {
  const m = parse('context A {\n  publishes: shown\n  user -> go()\n    --[default]--> [shown, hidden]\n}\ncontext B {\n  view V(id) = [shown, hidden] => { x }\n}\n');
  const g = BUILDERS.contextmap(m);
  assert.equal(g.edges.length, 1);
  assert.deepEqual([g.edges[0].from, g.edges[0].to, g.edges[0].style], ['ctx:A', 'ctx:B', 'dashed']);
  assert.throws(() => BUILDERS.contextmap(parse('user -> a()\n  --[default]--> [a-b]\n')), (e) => e.code === 'NO_CONTEXTS');
});

test('examples/billing.dsl uses every new construct, validates clean of errors, and renders everywhere', () => {
  const m = parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'billing.dsl'), 'utf8'));
  assert.deepEqual(check(m).filter((i) => i.severity === 'error'), []);
  assert.equal(m.contexts.length, 2);
  assert.ok(m.policies.some((p) => p.trigger.schedule) && m.commands.some((c) => c.branches.some((b) => b.reject)));
  for (const kind of ['eventmodel', 'context', 'containers', 'dataflow', 'deployment', 'contextmap']) {
    for (const f of ['svg', 'mermaid', 'dot']) assert.ok(render(m, kind, f).length > 50, `${kind} ${f}`);
  }
});
