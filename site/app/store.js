(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventlineStore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var P = 'eventline.app.v1.';
  var INDEX = P + 'index';
  var META = P + 'meta';
  var MODEL = P + 'model.';
  var FAIL = { ok: false, reason: 'storage' };

  function uuidv7(nowMs, randomBytes) {
    var b = randomBytes(10);
    var ts = Math.floor(nowMs).toString(16).padStart(12, '0');
    var hex = function (i, n) {
      var s = '';
      for (var k = 0; k < n; k++) s += (b[i + k] & 255).toString(16).padStart(2, '0');
      return s;
    };
    var variant = ((b[2] & 0x3f) | 0x80).toString(16).padStart(2, '0');
    return ts.slice(0, 8) + '-' + ts.slice(8) + '-7' + hex(0, 2).slice(1) + '-' + variant + hex(3, 1) + '-' + hex(4, 6);
  }

  function modelName(text) {
    var m = /^\s*system\s+([A-Za-z_][\w-]*)/m.exec(String(text));
    return m ? m[1] : 'Untitled';
  }

  function createStore(storage, deps) {
    function readJson(key) {
      try {
        var raw = storage.getItem(key);
        return raw == null ? null : JSON.parse(raw);
      } catch (e) { return null; }
    }
    function write(key, value) {
      try { storage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }
    function get(id) {
      var m = readJson(MODEL + id);
      return m && typeof m === 'object' && m.id === id && typeof m.text === 'string' ? m : null;
    }
    function ids() {
      var idx = readJson(INDEX);
      if (Array.isArray(idx)) return idx;
      var found = [];
      try {
        for (var i = 0; i < storage.length; i++) {
          var k = storage.key(i);
          if (k && k.indexOf(MODEL) === 0) found.push(k.slice(MODEL.length));
        }
      } catch (e) { return []; }
      found.sort(); // UUIDv7 ids sort by creation time
      write(INDEX, found);
      return found;
    }
    // Model entry first, index second: an interrupted write leaves a model the rebuild can find.
    function insert(m) {
      if (!write(MODEL + m.id, m)) return FAIL;
      var list = ids();
      if (list.indexOf(m.id) < 0 && !write(INDEX, list.concat(m.id))) {
        try { storage.removeItem(MODEL + m.id); } catch (e) { /* rebuild will find it */ }
        return FAIL;
      }
      return { ok: true, model: m };
    }
    function put(id, change) {
      var m = get(id);
      if (!m) return { ok: false, reason: 'deleted' };
      var next = Object.assign({}, m, change, { updatedAt: deps.now() });
      return write(MODEL + id, next) ? { ok: true, model: next } : FAIL;
    }
    function textChange(m, text) {
      return { text: text, rev: m.rev + 1, name: m.name === modelName(m.text) ? modelName(text) : m.name };
    }
    function fresh(fields) {
      var t = deps.now();
      var m = { id: deps.uuid(), name: fields.name || modelName(fields.text), text: fields.text, rev: 1, createdAt: t, updatedAt: t };
      if (fields.practice) m.practice = fields.practice;
      return m;
    }
    function all() {
      return ids().map(get).filter(Boolean);
    }

    var store = {
      get: get,
      list: function () {
        return all().reverse().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).map(function (m) {
          var s = Object.assign({}, m);
          delete s.text;
          return s;
        });
      },
      findByText: function (text) {
        return all().find(function (m) { return m.text === text && !(m.practice && m.practice.status === 'finished'); }) || null;
      },
      activeAttempt: function () {
        return all().find(function (m) { return m.practice && (m.practice.status === 'running' || m.practice.status === 'paused'); }) || null;
      },
      create: function (fields) { return insert(fresh(fields)); },
      save: function (id, text, baseRev) {
        var m = get(id);
        if (!m) return { ok: false, reason: 'deleted' };
        if (m.rev !== baseRev) return { ok: false, reason: 'conflict', current: m };
        return put(id, textChange(m, text));
      },
      overwrite: function (id, text) {
        var m = get(id);
        return m ? put(id, textChange(m, text)) : { ok: false, reason: 'deleted' };
      },
      update: function (id, fields) {
        var change = {};
        if ('name' in fields) change.name = fields.name;
        if ('practice' in fields) change.practice = fields.practice;
        return put(id, change);
      },
      duplicate: function (id) {
        var m = get(id);
        return m ? insert(fresh({ name: m.name + ' copy', text: m.text })) : { ok: false, reason: 'deleted' };
      },
      remove: function (id) {
        var m = get(id);
        if (!m) return { ok: false, reason: 'deleted' };
        try {
          storage.removeItem(MODEL + id);
          write(INDEX, ids().filter(function (x) { return x !== id; }));
        } catch (e) { return FAIL; }
        return { ok: true, restore: function () { return insert(m); } };
      },
      meta: function () {
        var m = readJson(META);
        return m && typeof m === 'object' ? m : {};
      },
      setMeta: function (fields) {
        var next = Object.assign({}, store.meta(), fields);
        return write(META, next) ? { ok: true, meta: next } : FAIL;
      },
      isModelKey: function (key) { return typeof key === 'string' && key.indexOf(MODEL) === 0; }
    };
    return store;
  }

  return { uuidv7: uuidv7, modelName: modelName, createStore: createStore };
});
