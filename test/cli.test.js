'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'eventline-axi');
const file = path.join(__dirname, '..', 'examples', 'twitter-pure.dsl');
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('-f after a subcommand is honored', () => {
  assert.match(run('diagram', 'containers', file, '-f', 'mermaid').stdout, /^flowchart LR/);
  assert.match(run('diagram', 'containers', file, '-f', 'dot').stdout, /^digraph/);
  assert.equal(JSON.parse(run('events', file, '-f', 'json').stdout).length, 16);
  assert.equal(JSON.parse(run('validate', file, '-f', 'json').stdout).some((i) => i.rule === 'assumed-events'), true);
  assert.equal(JSON.parse(run('parse', file, '-f', 'json').stdout).commands.length, 5);
});

test('a missing file or unknown diagram fails with a message and a non-zero exit', () => {
  const missing = run('events', 'nope.dsl');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /file not found/);
  const bad = run('diagram', 'nope', file);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Choose one of/);
});

test('validate exits non-zero only when there is an error', () => {
  assert.equal(run('validate', file).status, 0);
});

test('a policy that starts from a read model is listed, traced and checked without crashing', () => {
  const src = 'from [OrdersToShip] -> fulfilment-worker -> shipOrder(cartId)\n';
  const tmp = path.join(require('node:os').tmpdir(), `eventline-readmodel-${process.pid}.dsl`);
  require('node:fs').writeFileSync(tmp, src);
  try {
    for (const args of [['policies', tmp], ['deps', tmp, 'fulfilment-worker'], ['parse', tmp], [tmp], ['validate', tmp]]) {
      const r = run(...args);
      assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`);
    }
    assert.match(run('policies', tmp).stdout, /from \[OrdersToShip\]/);
    assert.match(run('parse', tmp).stdout, /from \[OrdersToShip\]/);
    assert.match(run('deps', tmp, 'fulfilment-worker').stdout, /view:OrdersToShip/);
    const { parse, check } = require('../lib');
    assert.doesNotThrow(() => check(parse(src), { profile: 'slicerm' }));
  } finally { require('node:fs').rmSync(tmp, { force: true }); }
});

test('readmodels lists read models, and views still works', () => {
  const a = run('readmodels', file);
  const b = run('views', file);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.ok(a.stdout.length > 0);
  assert.equal(a.stdout, b.stdout);
  assert.match(run('--help').stdout, /readmodels/);
});

test('policies shows a policy name and deps accepts it', () => {
  const fs = require('node:fs');
  const tmp = path.join(require('node:os').tmpdir(), `eventline-named-${process.pid}.dsl`);
  fs.writeFileSync(tmp, 'policy NotifyLiker = tweet-liked { userId } -> notifier -> notify(userId)\n');
  try {
    for (const args of [['policies', tmp], ['parse', tmp], ['deps', tmp, 'NotifyLiker']]) {
      const r = run(...args);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /NotifyLiker/);
    }
    assert.match(run('deps', tmp, 'NotifyLiker').stdout, /event:tweet-liked/);
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('events lists declared events, unused and unrecorded', () => {
  const fs = require('node:fs');
  const tmp = path.join(require('node:os').tmpdir(), `eventline-declared-${process.pid}.dsl`);
  fs.writeFileSync(tmp, 'event ghost-seen { id }\nevent cart-opened { id }\nevent x-done { id }\nuser -> go(id) on [cart-opened]\n  --[default]--> [x-done { id }]\n');
  try {
    const text = run('events', tmp, '-f', 'text');
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /name: ghost-seen.*declared: not used/);
    assert.match(text.stdout, /name: cart-opened.*declared: not recorded/);
    const rows = JSON.parse(run('events', tmp, '-f', 'json').stdout);
    for (const r of rows) for (const k of ['name', 'emittedBy', 'consumedBy', 'declared']) assert.ok(k in r, k);
    assert.equal(rows.find((r) => r.name === 'x-done').declared, 'yes');
    assert.equal(JSON.parse(run('events', file, '-f', 'json').stdout).every((r) => r.declared === ''), true);
    assert.match(run('events', tmp).stdout, /\{name,emittedBy,consumedBy,declared\}/);
  } finally { fs.rmSync(tmp, { force: true }); }
});
