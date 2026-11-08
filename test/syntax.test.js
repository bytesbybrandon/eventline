'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, ParseError } = require('../lib/parser');
const { check } = require('../lib/commands/validate');
const { buildBoard } = require('../lib/diagram/board');
const { BUILDERS } = require('../lib/diagram/system');
const { render } = require('../lib/diagram');

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

const T = '@trigger(type=ui, name="AuditingScreen", part="Fail button", route="POST /audits/{id}/fail")';

test('triggers: a command or view says what is used to reach it; several are allowed', () => {
  const m = parse(`auditor -> failAudit() ${T} @trigger(type=cli, name="audit-cli")\n  --[default]--> [audit-failed]\nview V(id) = [audit-failed] => { x } @trigger(type=ui, name="AuditingScreen")\n`);
  assert.deepEqual(m.commands[0].triggers, [
    { type: 'ui', name: 'AuditingScreen', part: 'Fail button', route: 'POST /audits/{id}/fail' },
    { type: 'cli', name: 'audit-cli', part: null, route: null },
  ]);
  assert.deepEqual(m.views[0].triggers, [{ type: 'ui', name: 'AuditingScreen', part: null, route: null }]);
  assert.deepEqual(parse('user -> go()\n  --[default]--> [a-b]\n').commands[0].triggers, []);
});

test('triggers: validate rejects an unknown type, a missing name, and a route that is not METHOD /path', () => {
  const r = (t) => rules(`user -> go() ${t}\n  --[default]--> [a-b]\n`);
  assert.ok(!r(T).some((x) => x.startsWith('warn:trigger')));
  assert.ok(r('@trigger(type=widget, name="X")').includes('warn:trigger-type'));
  assert.ok(r('@trigger(type=ui)').includes('warn:trigger-name'));
  assert.ok(r('@trigger(type=ui, name="X", route="fetch")').includes('warn:trigger-route'));
  assert.ok(r('@trigger(type=cli, name="X", route="GET /x")').includes('warn:trigger-route'));
  assert.ok(!r('@trigger(type=endpoint, name="X", route="PUT /x/{id}")').includes('warn:trigger-route'));
});

test('triggers: once some are declared, a command with none gets an info, unless a policy runs it', () => {
  const src = `user -> a() ${T}\n  --[default]--> [a-b]\nuser -> b()\n  --[default]--> [b-c]\nuser -> c()\n  --[default]--> [c-d]\nevery 1 hours\n  -> job -> c()\n`;
  const found = check(parse(src)).filter((i) => i.rule === 'command-trigger').map((i) => i.message);
  assert.equal(found.length, 1);
  assert.match(found[0], /user -> b/);
  assert.ok(!rules('user -> a()\n  --[default]--> [a-b]\n').includes('info:command-trigger'));
});

test('triggers: the board names what the actor uses on the arrow to the command, and where a view is read', () => {
  const m = parse(`auditor -> failAudit() ${T}\n  --[default]--> [audit-failed]\nview V(id) = [audit-failed] => { x } @trigger(type=ui, name="AuditingScreen")\n`);
  const b = buildBoard(m);
  assert.equal(b.edges.find((e) => e.from === 'actor:failAudit' && e.to === 'cmd:failAudit').label, 'AuditingScreen > Fail button');
  assert.ok(b.nodes.find((n) => n.id === 'view:V').notes.includes('read in AuditingScreen'));
});

test('triggers command lists each screen, endpoint or other trigger with who uses it', () => {
  const { rows } = require('../lib/commands/triggers');
  const out = rows(parse(`auditor -> failAudit() ${T}\n  --[default]--> [audit-failed]\nview V(id) = [audit-failed] => { x } @trigger(type=ui, name="AuditingScreen")\n`));
  assert.deepEqual(out.map((r) => [r.trigger, r.part, r.actor, r.reaches]), [
    ['AuditingScreen', 'Fail button', 'auditor', 'failAudit()'],
    ['AuditingScreen', '', '', 'view V'],
  ]);
});

test('strings: \\" \\\\ and \\n are unescaped, and a quote or comma inside a string does not end the value', () => {
  const m = parse('user -> go() @note("say \\"hi, there\\" and \\\\ back\\nnext") @story("a \\"b\\"")\n  --[default]--> [a-b]\n');
  assert.deepEqual(m.commands[0].notes, ['say "hi, there" and \\ back\nnext']);
  assert.equal(m.commands[0].annotations.story._[0], 'a "b"');
});

test('comments: // starts one after a space or at a line start, never inside a URL', () => {
  const m = parse('context A {\n  description: See https://x.dev/y for more // a comment\n  infrastructure: db://host\n  user -> go() @note("http://x") // trailing\n    --[default]--> [a-b]\n}\n');
  assert.equal(m.contexts[0].description, 'See https://x.dev/y for more');
  assert.equal(m.contexts[0].attrs.infrastructure, 'db://host');
  assert.deepEqual(m.commands[0].notes, ['http://x']);
});

test('@source names where a translation comes from, and validate wants a system', () => {
  const src = (a) => `system S { external: carrier (translator) }\ncarrier -> accept() ${a}\n  --[default]--> [a-b]\n`;
  assert.deepEqual(parse(src('@source(system="Carrier", version="v2")')).commands[0].source, { system: 'Carrier', version: 'v2' });
  assert.equal(parse(src('')).commands[0].source, null);
  assert.ok(rules(src('@source(version="v2")')).includes('warn:source-system'));
  assert.ok(!rules(src('@source(system="Carrier", version="v2")')).includes('warn:source-system'));
  const b = buildBoard(parse(src('@source(system="Carrier", version="v2")')));
  assert.ok(b.nodes.find((n) => n.id === 'cmd:accept').notes.includes('translates from Carrier v2'));
});

test('@query says how a view is read, and validate wants one, list or page', () => {
  const v = (q) => `view V(id) = [a-b] => { x } ${q}\n`;
  assert.deepEqual(parse(v('@query(returns=list, spec="the open ones")')).views[0].query, { returns: 'list', spec: 'the open ones' });
  assert.equal(parse(v('')).views[0].query, null);
  assert.ok(rules(v('@query(returns=many)')).includes('warn:query-returns'));
  assert.ok(!rules(v('@query(returns=page)')).includes('warn:query-returns'));
});

test('@projection with a @trigger is contradictory', () => {
  const v = (a) => `view V(id) = [a-b] => { x } ${a}\n`;
  assert.ok(rules(v('@projection @trigger(type=ui, name="X")')).includes('warn:projection-trigger'));
  assert.ok(!rules(v('@projection')).includes('warn:projection-trigger'));
  assert.equal(parse(v('@projection')).views[0].annotations.projection, true);
});

test('from [...] can mark a read @optional, shown on the board; on [...] cannot', () => {
  const m = parse('user -> go()\n  from [V(id) @optional @fresh<5s>]\n  --[default]--> [a-b]\nuser -> two()\n  on [x-y @optional]\n  --[default]--> [c-d]\n');
  assert.deepEqual([m.commands[0].from[0].optional, m.commands[0].from[0].freshness], [true, '5s']);
  assert.equal(m.commands[0].from[0].name, 'V');
  assert.ok(check(m).some((i) => i.rule === 'optional-on' && /two/.test(i.message)));
  assert.equal(buildBoard(m).edges.find((e) => e.kind === 'reads').label, 'fresh 5s, may be empty');
});

const SC = 'auditor -> fail()\n  --[default]--> [audit-failed]\n  scenario "Fail an audit" {\n    Given an audit is in progress # {not} [parsed]\n    When the auditor presses "Fail"\n      And more: detail\n    Then it is failed\n  }\n  scenario "Second" {\n    Given x\n  }\nview V(id) = [audit-failed] => { x }\nscenario "Shown" {\n  Then shown\n}\n';

test('scenarios: a block under a command or view keeps its lines as written, dedented', () => {
  const m = parse(SC);
  assert.deepEqual(m.commands[0].scenarios.map((s) => s.name), ['Fail an audit', 'Second']);
  assert.equal(m.commands[0].scenarios[0].text, 'Given an audit is in progress # {not} [parsed]\nWhen the auditor presses "Fail"\n  And more: detail\nThen it is failed');
  assert.deepEqual(m.views[0].scenarios.map((s) => [s.name, s.text]), [['Shown', 'Then shown']]);
  assert.deepEqual(parse('u -> a()\n  --[default]--> [a-b]\n').commands[0].scenarios, []);
});

test('scenarios: inside a context they stay with their own command, and cannot float free', () => {
  const m = parse('context A {\n  u -> a()\n    --[default]--> [a-b]\n  scenario "in" {\n    Given x\n  }\n}\nu -> b()\n  --[default]--> [b-c]\n');
  assert.equal(m.commands[0].scenarios.length, 1);
  assert.equal(m.commands[1].scenarios.length, 0);
  const bad = (s, re) => assert.throws(() => parse(s), (e) => e instanceof ParseError && re.test(e.message));
  bad('scenario "x" {\n a\n}\n', /right after the command or view/);
  bad('context A {\n  u -> a()\n    --[default]--> [a-b]\n}\nscenario "x" {\n a\n}\n', /right after the command or view/);
  bad('u -> a()\n  --[default]--> [a-b]\nscenario "x" {\n a\n', /Unclosed/);
  bad('u -> a()\n  --[default]--> [a-b]\nscenario "x" { a }\n', /scenario "name" \{/);
});

test('scenarios: an event can still be called scenario', () => {
  assert.equal(parse('scenario { x }\n  -> w -> go()\n').policies[0].trigger.event, 'scenario');
});

test('scenarios: validate flags an empty body and a repeated name', () => {
  const r = (b) => rules(`u -> a()\n  --[default]--> [a-b]\n${b}`);
  assert.ok(r('scenario "e" {\n}\n').includes('warn:scenario-empty'));
  assert.ok(r('scenario "d" {\n x\n}\nscenario "d" {\n y\n}\n').includes('warn:scenario-duplicate'));
  assert.ok(!r('scenario "ok" {\n x\n}\n').some((x) => x.includes('scenario')));
});

test('scenarios command lists what each command or view checks', () => {
  const { rows } = require('../lib/commands/scenarios');
  assert.deepEqual(rows(parse(SC)).map((r) => [r.checks, r.scenario, r.lines]), [['fail()', 'Fail an audit', 4], ['fail()', 'Second', 1], ['view V', 'Shown', 1]]);
});
