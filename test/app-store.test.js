'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, modelName, uuidv7 } = require('../site/app/store.js');

function fake() {
  const data = new Map();
  const s = {
    failWrites: false,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) { if (s.failWrites) throw new Error('quota'); data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
  return s;
}

let storage, store, clock, n;
const K = 'eventline.app.v1.';
test.beforeEach(() => {
  storage = fake(); clock = 1000; n = 0;
  store = createStore(storage, { now: () => clock++, uuid: () => 'id' + ++n });
});

test('a save with the current revision succeeds and bumps the revision', () => {
  const m = store.create({ text: 'a' }).model;
  const r = store.save(m.id, 'b', m.rev);
  assert.equal(r.ok, true); assert.equal(r.model.rev, m.rev + 1); assert.equal(store.get(m.id).text, 'b');
});

test('a save from a stale revision reports a conflict and changes nothing', () => {
  const m = store.create({ text: 'a' }).model;
  store.save(m.id, 'theirs', m.rev);
  const r = store.save(m.id, 'mine', m.rev);
  assert.equal(r.reason, 'conflict'); assert.equal(r.current.text, 'theirs'); assert.equal(store.get(m.id).text, 'theirs');
});

test('a save to a deleted model reports deleted and does not bring it back', () => {
  const m = store.create({ text: 'a' }).model;
  store.remove(m.id);
  assert.equal(store.save(m.id, 'b', m.rev).reason, 'deleted');
  assert.equal(store.overwrite(m.id, 'b').reason, 'deleted');
  assert.equal(store.get(m.id), null);
  assert.deepEqual(store.list(), []);
});

test('a failed write reports storage and keeps the previous text', () => {
  const m = store.create({ text: 'a' }).model;
  storage.failWrites = true;
  assert.equal(store.save(m.id, 'b', m.rev).reason, 'storage');
  assert.equal(store.overwrite(m.id, 'b').reason, 'storage');
  assert.equal(store.create({ text: 'c' }).reason, 'storage');
  assert.equal(store.setMeta({ lastOpenedId: m.id }).reason, 'storage');
  storage.failWrites = false;
  assert.equal(store.get(m.id).text, 'a');
  assert.equal(store.list().length, 1);
});

test('overwrite writes over a newer revision and bumps it', () => {
  const m = store.create({ text: 'a' }).model;
  store.save(m.id, 'theirs', m.rev);
  const r = store.overwrite(m.id, 'mine');
  assert.equal(r.ok, true); assert.equal(r.model.rev, m.rev + 2); assert.equal(store.get(m.id).text, 'mine');
});

test('remove can be undone', () => {
  const m = store.create({ text: 'a' }).model;
  store.save(m.id, 'b', m.rev);
  const before = store.get(m.id);
  const r = store.remove(m.id);
  assert.equal(store.get(m.id), null);
  assert.equal(r.restore().ok, true);
  assert.deepEqual(store.get(m.id), before);
  assert.deepEqual(store.list().map((x) => x.id), [m.id]);
  assert.deepEqual(store.remove('nope'), { ok: false, reason: 'deleted' });
});

test('list omits text and puts the newest edit first', () => {
  const a = store.create({ text: 'a' }).model; const b = store.create({ text: 'b' }).model;
  store.save(a.id, 'a2', a.rev);
  const l = store.list();
  assert.deepEqual(l.map((m) => m.id), [a.id, b.id]);
  assert.equal('text' in l[0], false);
});

test('findByText skips finished attempts and activeAttempt finds a running one', () => {
  const a = store.create({ text: 'x', practice: { status: 'finished' } }).model;
  assert.equal(store.findByText('x'), null);
  const b = store.create({ text: 'x', practice: { status: 'paused' } }).model;
  assert.equal(store.findByText('x').id, b.id);
  assert.equal(store.activeAttempt().id, b.id);
  store.update(b.id, { practice: { status: 'finished' } });
  assert.equal(store.activeAttempt(), null);
  assert.notEqual(a.id, b.id);
});

test('update changes name and practice without bumping the revision, and save keeps a custom name', () => {
  const m = store.create({ text: 'system A {\n}' }).model;
  assert.equal(m.name, 'A');
  const u = store.update(m.id, { name: 'Mine', practice: { status: 'running' } });
  assert.equal(u.model.rev, m.rev); assert.equal(u.model.practice.status, 'running');
  assert.equal(store.save(m.id, 'system B {\n}', m.rev).model.name, 'Mine');
});

test('update with practice null removes the field, making an ordinary model', () => {
  const m = store.create({ text: 'a', practice: { status: 'running' } }).model;
  const u = store.update(m.id, { practice: null });
  assert.ok(u.ok); assert.equal('practice' in u.model, false); assert.equal('practice' in store.get(m.id), false);
});

test('duplicate makes a separate model with the same text', () => {
  const m = store.create({ text: 'a', practice: { status: 'running' } }).model;
  const d = store.duplicate(m.id).model;
  assert.notEqual(d.id, m.id); assert.equal(d.text, 'a'); assert.equal(d.practice, undefined);
  assert.equal(store.duplicate('nope').reason, 'deleted');
});

test('meta round-trips and isModelKey recognises model keys only', () => {
  assert.deepEqual(store.meta(), {});
  store.setMeta({ lastExportAt: 5 }); store.setMeta({ lastOpenedId: 'x' });
  assert.deepEqual(store.meta(), { lastExportAt: 5, lastOpenedId: 'x' });
  assert.equal(store.isModelKey(K + 'model.abc'), true);
  assert.equal(store.isModelKey(K + 'meta'), false);
});

test('modelName uses the system block', () => {
  assert.equal(modelName('system Shop {\n}'), 'Shop'); assert.equal(modelName('// system Nope'), 'Untitled');
});

test('uuidv7 is version 7 and sorts by time', () => {
  const rnd = (len) => Uint8Array.from({ length: len }, (_, i) => 255 - i);
  const a = uuidv7(1700000000000, rnd); const b = uuidv7(1700000000001, rnd);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b);
});

test('corrupt entries are skipped and the rest still list', () => {
  const a = store.create({ text: 'a' }).model; const b = store.create({ text: 'b' }).model;
  storage.setItem(K + 'model.' + a.id, '{not json');
  assert.deepEqual(store.list().map((m) => m.id), [b.id]);
});

test('an unreadable index is rebuilt from the model entries', () => {
  const a = store.create({ text: 'a' }).model;
  storage.setItem(K + 'index', 'nope');
  assert.deepEqual(store.list().map((m) => m.id), [a.id]);
  assert.deepEqual(JSON.parse(storage.getItem(K + 'index')), [a.id]);
});

test('a model missing from a valid index is recovered, and removed models stay removed', () => {
  const a = store.create({ text: 'a' }).model; const b = store.create({ text: 'b' }).model;
  storage.setItem(K + 'index', JSON.stringify([a.id]));
  assert.deepEqual(store.list().map((m) => m.id).sort(), [a.id, b.id].sort());
  assert.deepEqual(JSON.parse(storage.getItem(K + 'index')), [a.id, b.id]);
  storage.setItem(K + 'index', '[]');
  assert.equal(store.list().length, 2);
  const r = store.remove(a.id);
  assert.deepEqual(store.list().map((m) => m.id), [b.id]);
  assert.equal(r.restore().ok, true);
  assert.equal(store.list().length, 2);
});
