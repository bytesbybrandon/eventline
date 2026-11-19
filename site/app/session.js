(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventlineSession = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var AUTOSAVE_MS = 500;
  var MAX_IMPORT_BYTES = 1000000;
  var PROFILES = ['workshop', 'eventmodeling', 'slicerm'];

  function parseAddress(hash, decode) {
    var parts = String(hash).slice(1).split('&');
    var head = parts[0];
    var isPlay = head.indexOf('play=') === 0;
    if (!isPlay && head.indexOf('m=') !== 0) return { type: 'none' };

    var params = new URLSearchParams(parts.slice(1).join('&'));
    var view = {
      links: params.get('links') === '1',
      profile: PROFILES.indexOf(params.get('p')) >= 0 ? params.get('p') : 'core'
    };
    if (params.get('d')) view.kind = params.get('d');
    if (params.get('n')) view.node = params.get('n');
    if (!isPlay) return { type: 'model', id: head.slice(2), view: view };

    var value = head.slice(5);
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return { type: 'invalid' };
    try {
      return { type: 'play', text: decode(value), view: view };
    } catch (e) { return { type: 'invalid' }; }
  }

  function acceptImport(name, bytes) {
    if (bytes.length === 0) return { ok: false, reason: 'empty' };
    if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, reason: 'too-large' };
    if (bytes.includes(0)) return { ok: false, reason: 'binary' };
    var text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); // also drops a leading BOM
    } catch (e) { return { ok: false, reason: 'binary' }; }
    if (!text) return { ok: false, reason: 'empty' };
    return { ok: true, name: name.replace(/\.dsl$/i, ''), text: text.replace(/\r\n?/g, '\n') };
  }

  function isReadOnly(model) {
    return !!(model.practice && model.practice.status === 'finished');
  }

  function createSession(deps) {
    var store = deps.store;
    var state = { id: null, name: deps.modelName(''), text: '', status: 'draft', theirs: null, readOnly: false };
    var rev = null; // the stored revision this tab's text is based on
    var baseText = ''; // the stored text at that revision, which shows whether the name came from the text
    var draftName = null; // only a name the owner chose; otherwise the store names the model from its text
    var cancelAutosave = null;

    function set(change) {
      var changed = Object.keys(change).some(function (k) { return state[k] !== change[k]; });
      if (!changed) return;
      state = Object.assign({}, state, change);
      deps.onChange(state);
    }
    function stopAutosave() {
      if (cancelAutosave) cancelAutosave();
      cancelAutosave = null;
    }
    function adopt(model) {
      stopAutosave();
      rev = model.rev;
      baseText = model.text;
      set({ id: model.id, name: model.name, text: model.text, status: 'saved', theirs: null, readOnly: isReadOnly(model) });
    }
    function markDeleted() {
      stopAutosave();
      set({ status: 'deleted', theirs: null });
    }
    function markConflict(current) {
      if (current.text === state.text) return adopt(current);
      stopAutosave();
      var known = state.theirs && state.theirs.rev === current.rev && state.theirs.text === current.text;
      set({ status: 'conflict', theirs: known ? state.theirs : current });
    }
    function settle(result) {
      if (result.ok) adopt(result.model);
      else if (result.reason === 'conflict') markConflict(result.current);
      else if (result.reason === 'deleted') markDeleted();
      else set({ status: 'failed', theirs: null });
    }
    function autosave() {
      cancelAutosave = null;
      settle(state.id === null
        ? store.create({ name: draftName, text: state.text })
        : store.save(state.id, state.text, rev));
    }
    function flush() {
      if (!cancelAutosave) return;
      stopAutosave();
      autosave();
    }

    function openDraft(text, name) {
      flush();
      rev = null;
      draftName = name || null;
      set({ id: null, name: name || deps.modelName(text || ''), text: text || '', status: 'draft', theirs: null, readOnly: false });
    }
    function openModel(id) {
      if (id !== null && id === state.id) return true; // the page rewrites the address after a save; unsaved work must survive that
      flush();
      var model = store.get(id);
      if (!model) return false;
      adopt(model);
      return true;
    }
    function openAddress(address) {
      if (address.type === 'play') {
        var saved = store.findByText(address.text);
        if (saved) openModel(saved.id); else openDraft(address.text);
      } else if (address.type === 'invalid') {
        openDraft('');
        return { notice: 'This link could not be read, so a blank model was opened.' };
      } else if (address.type === 'model' && !openModel(address.id)) {
        openDraft('');
        return { notice: 'That model is not saved in this browser, so a blank model was opened.' };
      }
      return {};
    }

    function edit(text) {
      if (state.readOnly) return;
      var failed = state.status === 'failed';
      if (text === state.text && !(failed && !state.theirs)) return;
      if (state.theirs || state.status === 'deleted') return set({ text: text });
      // A retry stays 'failed' so the banner and leave warning hold until a write succeeds.
      var name = state.id === null && !draftName ? deps.modelName(text) : state.name;
      set({ name: name, text: text, status: failed ? 'failed' : 'saving' });
      stopAutosave();
      cancelAutosave = deps.schedule(autosave, AUTOSAVE_MS);
    }

    function storageChanged() {
      if (state.id === null) return;
      var current = store.get(state.id);
      if (!current) return markDeleted();
      if (current.rev === rev && state.status !== 'deleted') {
        return set({ name: current.name, readOnly: isReadOnly(current) });
      }
      if (state.status === 'saved') adopt(current); else markConflict(current);
    }

    function keepMine() {
      if (!state.theirs) return;
      var current = store.get(state.id); // newer than state.theirs if the storage event has not arrived yet
      if (!current) return markDeleted();
      var copy = store.create({ name: current.name + ' (other tab)', text: current.text });
      if (!copy.ok) return set({ status: 'failed', theirs: current });
      rev = current.rev; // the other version is safe now, so a failed overwrite retries as an ordinary save
      settle(store.overwrite(state.id, state.text));
    }
    function loadTheirs() {
      if (!state.theirs) return;
      var current = store.get(state.id);
      if (current) adopt(current); else markDeleted();
    }
    function saveAsNew() {
      stopAutosave();
      // A name taken from the text is left out, so the store names the new model and it keeps following its text.
      var chosen = state.name === deps.modelName(baseText) ? null : state.name;
      var name = state.id === null ? draftName : chosen;
      var result = store.create({ name: name, text: state.text });
      if (result.ok) return adopt(result.model);
      if (state.theirs) return set({ status: 'failed' });
      draftName = name; // no stored model is left to save to, so the next edit retries as a draft
      set({ id: null, name: name || deps.modelName(state.text), status: 'failed' });
    }

    return {
      get state() { return state; },
      openDraft: openDraft,
      openModel: openModel,
      openAddress: openAddress,
      edit: edit,
      flush: flush,
      storageChanged: storageChanged,
      keepMine: keepMine,
      loadTheirs: loadTheirs,
      saveAsNew: saveAsNew,
      needsLeaveWarning: function () {
        return state.status === 'failed' || state.status === 'conflict' || state.status === 'deleted';
      }
    };
  }

  return { AUTOSAVE_MS: AUTOSAVE_MS, parseAddress: parseAddress, acceptImport: acceptImport, createSession: createSession };
});
