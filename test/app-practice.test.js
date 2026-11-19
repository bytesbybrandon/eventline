'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../lib/parser');
const P = require('../site/app/practice.js');
const { startAttempt, tick, pause, resume, finish, reopen, remaining, historyFor } = P;

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const prompts = JSON.parse(read('site/app/prompts.json'));

test('starting an attempt', () => {
  assert.deepEqual(startAttempt('billing', 7), {
    promptId: 'billing', status: 'running', startedAt: 7, elapsedSeconds: 0,
    lastTickAt: 7, covered: [], notes: '',
  });
  assert.equal(P.TICK_MS, 5000);
  assert.equal(P.MAX_GAP_MS, 15000);
});

test('running time accumulates across ticks', () => {
  let p = startAttempt('rate-limiter', 0); p = tick(p, 5000); p = tick(p, 10000);
  assert.equal(p.elapsedSeconds, 10);
  assert.equal(p.lastTickAt, 10000);
});

test('functions return new objects and do not mutate their input', () => {
  const p = startAttempt('rate-limiter', 0);
  const copy = JSON.parse(JSON.stringify(p));
  for (const q of [tick(p, 5000), pause(p, 5000), finish(p, 5000), reopen(p), resume(p, 5000)]) assert.notEqual(q, p);
  assert.deepEqual(p, copy);
});

test('a long gap, such as the computer sleeping, is not charged', () => {
  let p = startAttempt('rate-limiter', 0); p = tick(p, 5000); p = tick(p, 3600000); p = tick(p, 3605000);
  assert.equal(p.elapsedSeconds, 10);
});

test('a gap of exactly the maximum is charged', () => {
  assert.equal(tick(startAttempt('x', 0), 15000).elapsedSeconds, 15);
});

test('paused time is not charged', () => {
  let p = startAttempt('rate-limiter', 0);
  p = pause(p, 5000);
  assert.equal(p.status, 'paused');
  assert.equal(p.lastTickAt, null);
  assert.equal(p.elapsedSeconds, 5);
  p = tick(p, 30000);
  assert.equal(p.elapsedSeconds, 5);
  p = resume(p, 60000);
  assert.equal(p.status, 'running');
  assert.equal(p.lastTickAt, 60000);
  p = tick(p, 65000);
  assert.equal(p.elapsedSeconds, 10);
});

test('resume only works from paused', () => {
  const p = tick(startAttempt('x', 0), 5000);
  assert.deepEqual(resume(p, 9000), p);
});

test('reopening after a reload is paused at the stored time', () => {
  const p = reopen(tick(startAttempt('x', 0), 5000));
  assert.equal(p.status, 'paused');
  assert.equal(p.lastTickAt, null);
  assert.equal(p.elapsedSeconds, 5);
  assert.equal(reopen(p).status, 'paused');
});

test('finishing adds the last stretch and clears the tick time', () => {
  const p = finish(startAttempt('x', 0), 4000);
  assert.equal(p.status, 'finished');
  assert.equal(p.elapsedSeconds, 4);
  assert.equal(p.lastTickAt, null);
  assert.equal(finish(pause(startAttempt('x', 0), 3000), 9000).elapsedSeconds, 3);
});

test('finished attempts stay finished', () => {
  const f = finish(startAttempt('x', 0), 5000);
  for (const q of [resume(f, 6000), tick(f, 7000), pause(f, 7000), reopen(f), finish(f, 8000)]) {
    assert.equal(q.status, 'finished');
    assert.equal(q.elapsedSeconds, 5);
  }
});

test('time before the limit counts down, whole seconds rounded down', () => {
  assert.deepEqual(remaining({ elapsedSeconds: 10.5 }, 30), { seconds: 1789, overtime: false });
  assert.deepEqual(remaining({ elapsedSeconds: 1800 }, 30), { seconds: 0, overtime: false });
});

test('time past the limit is overtime', () => {
  assert.deepEqual(remaining({ elapsedSeconds: 1860 }, 30), { seconds: 60, overtime: true });
  assert.deepEqual(remaining({ elapsedSeconds: 1860.9 }, 30), { seconds: 60, overtime: true });
});

test('history lists finished attempts for the prompt, newest first', () => {
  const s = (id, promptId, status, startedAt) => ({ id, updatedAt: 0, practice: { promptId, status, startedAt } });
  const list = [
    s('a', 'billing', 'finished', 100), s('b', 'billing', 'running', 400),
    s('c', 'rate-limiter', 'finished', 500), s('d', 'billing', 'finished', 300),
    { id: 'e', updatedAt: 9 },
  ];
  assert.deepEqual(historyFor(list, 'billing').map((x) => x.id), ['d', 'a']);
  assert.deepEqual(historyFor(list, 'nope'), []);
});

test('the four prompts match the spec', () => {
  assert.deepEqual(prompts.map((p) => [p.id, p.title, p.reference, p.minutes]), [
    ['rate-limiter', 'Rate limiter', 'rate-limiter.dsl', 30],
    ['payment-webhook', 'Payment webhook', 'payment-webhook.dsl', 30],
    ['billing', 'Billing', 'billing.dsl', 45],
    ['twitter-pure', 'Twitter-style feed', 'twitter-pure.dsl', 45],
  ]);
});

test('every requirement can be checked against its reference model', () => {
  for (const p of prompts) {
    const m = parse(read('site/examples/' + p.reference));
    const known = new Set([...m.commands.map((c) => c.name), ...m.events.keys(), ...m.views.map((v) => v.name)]);
    assert.ok(p.requirements.length >= 4, p.id);
    assert.equal(new Set(p.requirements.map((r) => r.id)).size, p.requirements.length, p.id + ' ids unique');
    for (const r of p.requirements) {
      assert.match(r.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(r.text && r.covers.length, r.id);
      for (const n of r.covers) assert.ok(known.has(n), `${p.id}: ${n}`);
    }
  }
});

test('scenarios do not reveal reference names', () => {
  for (const p of prompts) {
    const m = parse(read('site/examples/' + p.reference));
    const names = [...m.commands.map((c) => c.name), ...m.events.keys(), ...m.views.map((v) => v.name)];
    for (const n of names) assert.ok(!p.scenario.includes(n), `${p.id} reveals ${n}`);
  }
});
