'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../site/app/store.js');
const { createSession, parseAddress, acceptImport, AUTOSAVE_MS } = require('../site/app/session.js');

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

const decode = (s) => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(s, 'base64url'));
const encode = (s) => Buffer.from(s).toString('base64url');

let storage, store, other, s, timers, changes;

// Two stores over one storage are two tabs; they share a clock and ids so neither overwrites the other's keys.
function rig() {
  storage = fake(); timers = []; changes = [];
  let clock = 1000, n = 0;
  const deps = { now: () => clock++, uuid: () => 'id' + ++n };
  store = createStore(storage, deps);
  other = createStore(storage, deps);
  s = createSession({
    store,
    schedule(fn, ms) {
      assert.equal(ms, AUTOSAVE_MS);
      const t = { fn };
      timers.push(t);
      return () => { timers = timers.filter((x) => x !== t); };
    },
    onChange: (state) => changes.push(state),
  });
}
function run500ms() { const due = timers; timers = []; due.forEach((t) => t.fn()); }
function openSaved(text = 'base') { const m = store.create({ text }).model; s.openModel(m.id); return m; }
function conflicted() { const m = openSaved(); s.edit('mine'); other.save(m.id, 'theirs', m.rev); s.storageChanged(); return m; }
const copies = () => store.list().filter((x) => x.name.endsWith(' (other tab)'));

test.beforeEach(rig);

test('autosave waits half a second', () => { assert.equal(AUTOSAVE_MS, 500); });

test('a draft is not saved until the first edit', () => {
  s.openDraft('hello');
  assert.equal(store.list().length, 0); assert.equal(s.state.status, 'draft');
  s.edit('hello!');
  assert.equal(s.state.status, 'saving'); assert.equal(store.list().length, 0);
  run500ms();
  assert.equal(store.list().length, 1); assert.equal(s.state.status, 'saved');
  assert.equal(store.get(s.state.id).text, 'hello!');
});

test('a draft keeps the name it was opened with, and is otherwise named from its text', () => {
  s.openDraft('a', 'Imported'); s.edit('b'); run500ms();
  assert.equal(s.state.name, 'Imported');
  s.openDraft('a'); s.edit('system Shop {\n}'); run500ms();
  assert.equal(s.state.name, 'Shop');
});

test('later edits save to the same model and share one timer', () => {
  s.openDraft('a'); s.edit('b'); run500ms();
  const id = s.state.id;
  s.edit('c'); s.edit('d');
  assert.equal(timers.length, 1);
  run500ms();
  assert.equal(store.list().length, 1); assert.equal(store.get(id).text, 'd'); assert.equal(s.state.status, 'saved');
});

test('flush saves a waiting edit at once and leaves no timer', () => {
  const m = openSaved(); s.edit('now'); s.flush();
  assert.equal(store.get(m.id).text, 'now'); assert.equal(timers.length, 0); assert.equal(s.state.status, 'saved');
});

test('every state change reaches onChange as its own snapshot', () => {
  s.openDraft('a'); s.edit('b'); run500ms();
  assert.deepEqual(changes.slice(-2).map((x) => x.status), ['saving', 'saved']);
  assert.equal(changes.at(-1), s.state);
});

test('a failed save stays failed and warns on leaving, then recovers', () => {
  const m = openSaved(); storage.failWrites = true;
  s.edit('kept'); run500ms();
  assert.equal(s.state.status, 'failed'); assert.equal(s.state.text, 'kept'); assert.equal(s.needsLeaveWarning(), true);
  storage.failWrites = false;
  s.edit('kept!'); run500ms();
  assert.equal(s.state.status, 'saved'); assert.equal(s.needsLeaveWarning(), false);
  assert.equal(store.get(m.id).text, 'kept!');
});

test('the failure stays reported until a retry has actually succeeded', () => {
  openSaved(); storage.failWrites = true;
  s.edit('x'); run500ms();
  s.edit('y');
  assert.equal(s.state.status, 'failed'); assert.equal(s.needsLeaveWarning(), true);
  run500ms();
  assert.equal(s.state.status, 'failed');
});

test('a failed draft keeps its text and the next edit retries the create', () => {
  s.openDraft('a'); storage.failWrites = true;
  s.edit('b'); run500ms();
  assert.equal(s.state.status, 'failed'); assert.equal(s.state.id, null); assert.equal(s.state.text, 'b');
  storage.failWrites = false;
  s.edit('c'); run500ms();
  assert.equal(s.state.status, 'saved'); assert.equal(store.get(s.state.id).text, 'c'); assert.equal(store.list().length, 1);
});

test('retyping the same text after a failure still retries', () => {
  const m = openSaved(); storage.failWrites = true;
  s.edit('x'); run500ms();
  storage.failWrites = false;
  s.edit('x'); run500ms();
  assert.equal(s.state.status, 'saved'); assert.equal(store.get(m.id).text, 'x');
});

test('opening something else saves a waiting edit first', () => {
  const m = openSaved(); s.edit('typed');
  s.openDraft('');
  assert.equal(store.get(m.id).text, 'typed'); assert.equal(timers.length, 0);
  const next = store.create({ text: 'next' }).model;
  s.openModel(m.id); s.edit('typed again');
  s.openModel(next.id);
  assert.equal(store.get(m.id).text, 'typed again'); assert.equal(s.state.text, 'next'); assert.equal(timers.length, 0);
});

test('reopening the open model leaves unsaved work alone', () => {
  const m = conflicted();
  assert.equal(s.openModel(m.id), true);
  assert.equal(s.state.text, 'mine'); assert.equal(s.state.status, 'conflict');
});

test('opening a missing model reports false and changes nothing', () => {
  const m = openSaved();
  assert.equal(s.openModel('gone'), false);
  assert.equal(s.state.id, m.id);
});

test('a clean tab follows another tab silently', () => {
  const m = openSaved();
  other.save(m.id, 'theirs', m.rev); s.storageChanged();
  assert.equal(s.state.text, 'theirs'); assert.equal(s.state.status, 'saved'); assert.equal(s.needsLeaveWarning(), false);
  s.edit('next'); run500ms();
  assert.equal(s.state.status, 'saved'); assert.equal(store.get(m.id).text, 'next');
});

test('a clean tab follows a rename made elsewhere', () => {
  const m = openSaved();
  other.update(m.id, { name: 'Renamed' }); s.storageChanged();
  assert.equal(s.state.name, 'Renamed');
});

test('a storage event that changes nothing does not report a change', () => {
  openSaved(); const before = changes.length;
  s.storageChanged();
  assert.equal(changes.length, before);
});

test('unsaved edits plus an outside change is a conflict, and autosave stops', () => {
  const m = conflicted();
  assert.equal(s.state.status, 'conflict'); assert.equal(s.state.theirs.text, 'theirs'); assert.equal(s.state.text, 'mine');
  assert.equal(timers.length, 0);
  run500ms();
  assert.equal(store.get(m.id).text, 'theirs');
  assert.equal(s.needsLeaveWarning(), true);
});

test('a conflict found by autosave matches one found by a storage event', () => {
  conflicted();
  const viaEvent = s.state;
  rig();
  const m = openSaved(); s.edit('mine'); other.save(m.id, 'theirs', m.rev); run500ms();
  assert.deepEqual(s.state, viaEvent);
  assert.equal(store.get(m.id).text, 'theirs');
});

test('a failed save with an outside change becomes a conflict', () => {
  const m = openSaved(); storage.failWrites = true;
  s.edit('mine'); run500ms();
  storage.failWrites = false;
  other.save(m.id, 'theirs', m.rev); s.storageChanged();
  assert.equal(s.state.status, 'conflict'); assert.equal(s.state.text, 'mine');
});

test('two tabs arriving at the same text is not a conflict', () => {
  const m = openSaved(); s.edit('same');
  other.save(m.id, 'same', m.rev); s.storageChanged();
  assert.equal(s.state.status, 'saved'); assert.equal(s.state.theirs, null); assert.equal(timers.length, 0);
});

test('edits during a conflict stay in memory and never write', () => {
  const m = conflicted();
  s.edit('mine 2');
  assert.equal(s.state.text, 'mine 2'); assert.equal(s.state.status, 'conflict'); assert.equal(timers.length, 0);
  s.flush();
  assert.equal(store.get(m.id).text, 'theirs');
});

test('a conflict keeps tracking the newest outside version', () => {
  const m = conflicted();
  other.save(m.id, 'theirs 2', store.get(m.id).rev); s.storageChanged();
  assert.equal(s.state.theirs.text, 'theirs 2');
});

test('keep mine saves this text and keeps the other version as a copy', () => {
  const m = conflicted();
  s.keepMine();
  assert.equal(store.get(m.id).text, 'mine'); assert.equal(s.state.status, 'saved'); assert.equal(s.state.theirs, null);
  assert.equal(copies().length, 1); assert.equal(copies()[0].name, m.name + ' (other tab)');
  assert.equal(store.get(copies()[0].id).text, 'theirs');
  s.edit('after'); run500ms();
  assert.equal(s.state.status, 'saved'); assert.equal(store.get(m.id).text, 'after');
});

test('keep mine copies the stored version even when no storage event announced it', () => {
  const m = conflicted();
  other.save(m.id, 'newest', store.get(m.id).rev);
  s.keepMine();
  assert.equal(store.get(copies()[0].id).text, 'newest'); assert.equal(store.get(m.id).text, 'mine');
});

test('keep mine overwrites nothing when the copy cannot be made, and can be retried', () => {
  const m = conflicted(); storage.failWrites = true;
  s.keepMine();
  assert.equal(s.state.status, 'failed'); assert.equal(s.state.theirs.text, 'theirs'); assert.equal(s.state.text, 'mine');
  assert.equal(store.get(m.id).text, 'theirs'); assert.equal(copies().length, 0); assert.equal(s.needsLeaveWarning(), true);
  storage.failWrites = false;
  s.keepMine();
  assert.equal(s.state.status, 'saved'); assert.equal(store.get(m.id).text, 'mine'); assert.equal(copies().length, 1);
});

test('edits after a failed keep mine stay in memory until the owner chooses', () => {
  const m = conflicted(); storage.failWrites = true;
  s.keepMine();
  storage.failWrites = false;
  s.edit('mine 2');
  assert.equal(timers.length, 0); assert.equal(s.state.status, 'failed');
  assert.equal(store.get(m.id).text, 'theirs'); assert.equal(s.state.text, 'mine 2'); assert.ok(s.state.theirs);
});

test('keep mine makes one copy when the overwrite fails after the copy succeeded', () => {
  const m = conflicted();
  const overwrite = store.overwrite;
  store.overwrite = () => ({ ok: false, reason: 'storage' });
  s.keepMine();
  store.overwrite = overwrite;
  assert.equal(s.state.status, 'failed'); assert.equal(s.state.text, 'mine'); assert.equal(copies().length, 1);
  s.edit('mine'); run500ms();
  assert.equal(s.state.status, 'saved'); assert.equal(store.get(m.id).text, 'mine'); assert.equal(copies().length, 1);
});

test('keep mine after the model was deleted keeps this text and stops', () => {
  const m = conflicted(); other.remove(m.id);
  s.keepMine();
  assert.equal(s.state.status, 'deleted'); assert.equal(s.state.text, 'mine'); assert.equal(store.get(m.id), null);
});

test('load theirs replaces this text', () => {
  const m = conflicted();
  s.loadTheirs();
  assert.equal(s.state.text, 'theirs'); assert.equal(s.state.status, 'saved'); assert.equal(s.state.theirs, null);
  s.edit('next'); run500ms();
  assert.equal(s.state.status, 'saved'); assert.equal(store.get(m.id).text, 'next');
});

test('load theirs keeps this text when there is no stored version left', () => {
  const m = conflicted(); other.remove(m.id);
  s.loadTheirs();
  assert.equal(s.state.text, 'mine'); assert.equal(s.state.status, 'deleted');
});

test('a model deleted elsewhere stops saving and can be saved as new', () => {
  const m = openSaved(); s.edit('mine');
  other.remove(m.id); s.storageChanged();
  assert.equal(s.state.status, 'deleted'); assert.equal(timers.length, 0); assert.equal(s.needsLeaveWarning(), true);
  s.edit('mine 2'); run500ms();
  assert.equal(store.get(m.id), null); assert.equal(s.state.text, 'mine 2');
  s.saveAsNew();
  assert.notEqual(s.state.id, m.id); assert.equal(s.state.status, 'saved');
  assert.equal(store.get(s.state.id).text, 'mine 2'); assert.equal(store.get(m.id), null);
});

test('a delete found by autosave matches one found by a storage event', () => {
  const m = openSaved(); s.edit('mine'); other.remove(m.id); s.storageChanged();
  const viaEvent = s.state;
  rig();
  const n = openSaved(); s.edit('mine'); other.remove(n.id); run500ms();
  assert.deepEqual(s.state, viaEvent);
  assert.equal(store.get(n.id), null);
});

test('save as new that fails keeps the text and the next edit retries', () => {
  const m = openSaved(); other.remove(m.id); s.storageChanged();
  storage.failWrites = true;
  s.saveAsNew();
  assert.equal(s.state.status, 'failed'); assert.equal(s.state.text, 'base'); assert.equal(s.needsLeaveWarning(), true);
  storage.failWrites = false;
  s.edit('base 2'); run500ms();
  assert.equal(s.state.status, 'saved'); assert.equal(store.get(s.state.id).text, 'base 2'); assert.equal(store.get(m.id), null);
});

test('save as new during a conflict leaves the other version in place', () => {
  const m = conflicted();
  s.saveAsNew();
  assert.notEqual(s.state.id, m.id); assert.equal(s.state.status, 'saved'); assert.equal(s.state.theirs, null);
  assert.equal(store.get(s.state.id).text, 'mine'); assert.equal(store.get(m.id).text, 'theirs');
});

test('a model restored elsewhere with different text is a conflict, not an overwrite', () => {
  const m = openSaved();
  const removed = other.remove(m.id); s.storageChanged();
  s.edit('mine');
  removed.restore(); s.storageChanged();
  assert.equal(s.state.status, 'conflict'); assert.equal(s.state.theirs.text, 'base'); assert.equal(s.state.text, 'mine');
});

test('a finished practice attempt opens read-only and ignores edits', () => {
  const m = store.create({ text: 'done', practice: { status: 'finished' } }).model;
  s.openModel(m.id);
  assert.equal(s.state.readOnly, true);
  s.edit('changed');
  assert.equal(s.state.text, 'done'); assert.equal(timers.length, 0); assert.equal(s.state.status, 'saved');
});

test('a running practice attempt can be edited', () => {
  const m = store.create({ text: 'go', practice: { status: 'running' } }).model;
  s.openModel(m.id);
  assert.equal(s.state.readOnly, false);
});

test('a link with text already saved opens that model', () => {
  const m = store.create({ text: 'shared' }).model;
  assert.deepEqual(s.openAddress(parseAddress('#play=' + encode('shared'), decode)), {});
  assert.equal(s.state.id, m.id); assert.equal(s.state.status, 'saved');
});

test('a link with new text opens a draft', () => {
  assert.deepEqual(s.openAddress(parseAddress('#play=' + encode('fresh'), decode)), {});
  assert.equal(s.state.id, null); assert.equal(s.state.text, 'fresh'); assert.equal(s.state.status, 'draft');
  assert.equal(store.list().length, 0);
});

test('a model address opens the model', () => {
  const m = store.create({ text: 'x' }).model;
  assert.deepEqual(s.openAddress(parseAddress('#m=' + m.id, decode)), {});
  assert.equal(s.state.id, m.id);
});

test('an address with nothing to open leaves the open model alone', () => {
  const m = openSaved();
  assert.deepEqual(s.openAddress(parseAddress('', decode)), {});
  assert.equal(s.state.id, m.id);
});

test('a malformed link and a missing model open a blank draft with a notice', () => {
  assert.ok(s.openAddress(parseAddress('#play=%%%', decode)).notice); assert.equal(s.state.status, 'draft');
  s.openDraft('something');
  assert.ok(s.openAddress({ type: 'model', id: 'gone', view: {} }).notice);
  assert.equal(s.state.text, ''); assert.equal(s.state.id, null); assert.equal(s.state.status, 'draft');
});

test('parseAddress reads the view parts', () => {
  assert.deepEqual(parseAddress('#m=abc&d=context&n=Order%20box&links=1&p=workshop', decode), {
    type: 'model', id: 'abc', view: { kind: 'context', node: 'Order box', links: true, profile: 'workshop' },
  });
  assert.deepEqual(parseAddress('#play=' + encode('a') + '&p=slicerm', decode), {
    type: 'play', text: 'a', view: { links: false, profile: 'slicerm' },
  });
  assert.equal(parseAddress('#m=a&p=eventmodeling', decode).view.profile, 'eventmodeling');
  assert.equal(parseAddress('#m=a&p=nope', decode).view.profile, 'core');
  assert.equal(parseAddress('#m=a&links=0', decode).view.links, false);
});

test('parseAddress treats anything else as no address', () => {
  for (const hash of ['', '#', '#play', '#play&d=context', '#playground=abc', '#models', '#docs']) {
    assert.deepEqual(parseAddress(hash, decode), { type: 'none' }, hash);
  }
});

test('parseAddress reports unreadable links as invalid', () => {
  const boom = () => { throw new Error('bad'); };
  assert.deepEqual(parseAddress('#play=abc', boom), { type: 'invalid' });
  for (const hash of ['#play=', '#play=%%%', '#play=a+b', '#play=ab/c', '#play=ab==', '#play=YWJjY']) {
    assert.deepEqual(parseAddress(hash, decode), { type: 'invalid' }, hash);
  }
  assert.deepEqual(parseAddress('#play=' + Buffer.of(0xff, 0xfe).toString('base64url'), decode), { type: 'invalid' });
});

test('acceptImport refuses empty, huge and binary files, and normalizes line endings', () => {
  assert.equal(acceptImport('a.dsl', new Uint8Array()).reason, 'empty');
  assert.equal(acceptImport('a.dsl', new Uint8Array(1000001).fill(97)).reason, 'too-large');
  assert.equal(acceptImport('a.dsl', new Uint8Array(1000000).fill(97)).ok, true);
  assert.equal(acceptImport('a.dsl', Uint8Array.of(97, 0, 98)).reason, 'binary');
  assert.equal(acceptImport('a.dsl', Uint8Array.of(97, 0xff, 98)).reason, 'binary');
  assert.equal(acceptImport('Shop.dsl', Buffer.from('a\r\nb')).text, 'a\nb');
  assert.equal(acceptImport('Shop.dsl', Buffer.from('a\rb')).text, 'a\nb');
  assert.equal(acceptImport('Shop.dsl', Buffer.from('a')).name, 'Shop');
});

test('acceptImport strips a leading BOM and a .dsl ending in any case', () => {
  assert.deepEqual(acceptImport('Shop.DSL', Buffer.from('﻿a')), { ok: true, name: 'Shop', text: 'a' });
  assert.equal(acceptImport('a.dsl.txt', Buffer.from('a')).name, 'a.dsl.txt');
  assert.equal(acceptImport('a.dsl', Buffer.from('﻿')).reason, 'empty');
});
