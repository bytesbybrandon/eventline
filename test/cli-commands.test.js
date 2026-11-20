'use strict';

// The listing, tracing and diagram commands, run through the CLI on a fixture that uses every shape they print.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'eventline-axi');
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

const MODEL = `system Shop {
  external: stripe (payments), mailer
  slo: p99 < 200ms
  data-classification: pii
  constraint: carts expire after 30 days
}

actor Customer { auth: session, tier: pro, mfa: required, scope: carts }
actor Guest { scope: browse }

boundary Cart(cartId)

readmodel CartSummary(cartId: id) = [item-added*(cartId)] => { total: number }
  @trigger(type=ui, name="CartScreen", part="Cart summary", route="GET /carts/{id}")

readmodel OpenCarts(cartId: id) = [item-added*(cartId)] => { total: number }
  @trigger

Customer -> addItem(cartId: id) in Cart(cartId)
  @trigger(type=ui, name="CartScreen", part="Add button", route="POST /carts/{id}/items")
  --[default]--> [item-added { cartId }]

Guest -> checkout(cartId: id) in Cart(cartId)
  @trigger
  on [item-added(cartId)]
  from [CartSummary(cartId)]
  --[default]--> [order-placed { cartId }]

policy ShipOrder = order-placed { cartId } -> shipper -> ship(cartId)

order-placed { cartId } -> auditor -> [order-audited { cartId }]

every 1 hours
  from [OpenCarts(cartId)]
  -> reminder-sender -> remind(cartId)
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventline-cli-'));
const file = path.join(dir, 'shop.dsl');
fs.writeFileSync(file, MODEL);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const json = (...args) => {
  const r = run(...args, '-f', 'json');
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('actors lists every actor, with a blank for an attribute it does not set', () => {
  assert.deepEqual(json('actors', file), [
    { name: 'Customer', auth: 'session', tier: 'pro', mfa: 'required', scope: 'carts' },
    { name: 'Guest', auth: '', tier: '', mfa: '', scope: 'browse' },
  ]);
});

test('triggers lists command and read model triggers, with blanks for a bare @trigger', () => {
  assert.deepEqual(json('triggers', file), [
    { trigger: 'CartScreen', part: 'Add button', type: 'ui', route: 'POST /carts/{id}/items', actor: 'Customer', reaches: 'addItem()' },
    { trigger: '', part: '', type: '', route: '', actor: 'Guest', reaches: 'checkout()' },
    { trigger: 'CartScreen', part: 'Cart summary', type: 'ui', route: 'GET /carts/{id}', actor: '', reaches: 'read model CartSummary' },
    { trigger: '', part: '', type: '', route: '', actor: '', reaches: 'read model OpenCarts' },
  ]);
});

test('deps traces what an event, read model, command, worker or policy reads and what reads it', () => {
  const deps = (entity) => { const d = json('deps', file, entity); delete d.entity; return d; };
  assert.deepEqual(deps('item-added'), { kind: 'event', dependsOn: ['command:addItem'], dependedBy: ['command:checkout', 'view:CartSummary', 'view:OpenCarts'] });
  assert.deepEqual(deps('CartSummary'), { kind: 'view', dependsOn: ['event:item-added'], dependedBy: ['command:checkout'] });
  assert.deepEqual(deps('checkout'), { kind: 'command', dependsOn: ['event:item-added', 'view:CartSummary'], dependedBy: ['event:order-placed'] });
  assert.deepEqual(deps('ShipOrder'), { kind: 'policy', dependsOn: ['event:order-placed'], dependedBy: ['command:ship'] });
  assert.deepEqual(deps('auditor'), { kind: 'worker', dependsOn: ['event:order-placed'], dependedBy: ['event:order-audited'] });
  assert.deepEqual(deps('reminder-sender'), { kind: 'worker', dependsOn: ['schedule:every 1 hours', 'view:OpenCarts'], dependedBy: ['command:remind'] });
  assert.deepEqual(deps('nothing-here'), { kind: 'unknown', dependsOn: [], dependedBy: [] });
});

test('parse prints the system, counts and a table per kind of statement', () => {
  const r = run('parse', file);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^file: ${file.replace(/[\\.]/g, '\\$&')}\n`));
  for (const t of ['actors[2]{name,auth,tier}:', 'commands[2]{actor,name,params}:', 'views[2]{name,params}:', 'boundaries[1]{name,params}:', 'policies[3]{event,rules,name}:']) assert.ok(r.stdout.includes(t), t);
  assert.match(r.stdout, /system:\n  name: Shop\n  external: stripe \(payments\), mailer\n  slo: p99 < 200ms\n  data-classification: pii\n  constraint: carts expire after 30 days\n/);
  assert.match(r.stdout, /Guest,checkout,cartId/);
  const bare = path.join(dir, 'bare.dsl');
  fs.writeFileSync(bare, 'event thing-happened { id }\n');
  const b = run('parse', bare);
  assert.equal(b.status, 0, b.stderr);
  assert.doesNotMatch(b.stdout, /actors\[|commands\[|views\[|boundaries\[|policies\[/);
});

test('rules prints the catalogue, one profile of it, or an error for an unknown profile', () => {
  const all = json('rules');
  const em = json('rules', '--profile', 'eventmodeling');
  assert.ok(em.length > 0 && em.length < all.length);
  assert.ok(em.every((r) => r.profile === 'eventmodeling'));
  const text = run('rules');
  assert.match(text.stdout, /rules\[\d+\]\{id,profile,severity,category,title\}/);
  assert.match(text.stdout, /--profile eventmodeling/);
  const bad = run('rules', '--profile', 'nope');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown profile "nope"/);
});

test('diagrams writes every kind in every format, and skips a kind the model has nothing for', () => {
  const out = path.join(dir, 'diagrams');
  const r = run('diagrams', file, '-o', out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /skipped deployment/);
  const written = fs.readdirSync(out).sort();
  assert.ok(written.includes('eventmodel.svg') && written.includes('eventmodel.mmd') && written.includes('eventmodel.dot'), written.join(' '));
  assert.ok(!written.some((f) => f.startsWith('deployment.')));
  assert.match(r.stdout, new RegExp(`wrote ${written.length} files to `));
});
