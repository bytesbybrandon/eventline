'use strict';

// Keyboard and data-state tests for the editor's autocomplete popup and editing help (site/app/editor.js).
// A small fake DOM stands in for the browser: just what editor.js touches, with execCommand editing the textarea's value.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../lib');

class El {
  constructor(tag) { Object.assign(this, { tag, attrs: {}, style: {}, children: [], listeners: {}, hidden: false, textContent: '' }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...xs) { this.children.push(...xs); }
  replaceChildren() { this.children = []; }
  remove() {}
  scrollIntoView() {}
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((g) => g !== f); }
  dispatch(t, ev = {}) { for (const f of [...(this.listeners[t] || [])]) f(ev); }
}

global.window = global;
global.getComputedStyle = () => ({ lineHeight: '20px' });
global.document = {
  activeElement: null,
  createElement: (tag) => new El(tag),
  execCommand(cmd, ui, text) {
    const ta = document.activeElement;
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const ins = cmd === 'insertText' ? text : '';
    ta.value = v.slice(0, s) + ins + v.slice(e);
    ta.setSelectionRange(s + ins.length, s + ins.length);
    ta.dispatch('input', {});
  },
};
window.EventlineComplete = require('../site/app/complete.js');
window.EventlineEditing = require('../site/app/editing.js');
require('../site/app/editor.js');

const MODEL = 'user -> addItem(cartId) in Cart(cartId)\n  --[default]--> [item-added { cartId }]\nuser -> removeItem(cartId) in Cart(cartId)\n  --[default]--> [item-removed { cartId }]\n';

function setup(value = '', caret = value.length, model = parse(MODEL)) {
  const host = new El('div');
  const ta = new El('textarea');
  Object.assign(ta, { parentNode: host, value, readOnly: false, selectionStart: caret, selectionEnd: caret });
  ta.setSelectionRange = (s, e) => { ta.selectionStart = s; ta.selectionEnd = e; };
  ta.focus = () => { document.activeElement = ta; };
  ta.focus();
  const ed = window.EventlineEditor.attach(ta, () => model);
  const pop = host.children[0];
  const key = (k, mods = {}) => {
    const ev = { key: k, keyCode: 0, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...mods };
    ta.dispatch('keydown', ev);
    return ev;
  };
  return { ta, pop, ed, key, open: () => ta.attrs['aria-expanded'] === 'true' };
}

test('ctrl+space opens the popup and arrows move the active option', () => {
  const { ta, pop, key, open } = setup('item');
  assert.equal(open(), false);
  assert.equal(key(' ', { ctrlKey: true }).prevented, true);
  assert.equal(open(), true);
  assert.equal(pop.hidden, false);
  const n = pop.children.length;
  assert.ok(n > 1);
  assert.equal(ta.attrs['aria-activedescendant'], `${pop.id}-0`);
  assert.equal(key('ArrowDown').prevented, true);
  assert.equal(ta.attrs['aria-activedescendant'], `${pop.id}-1`);
  assert.equal(pop.children[1].attrs['aria-selected'], 'true');
  key('ArrowUp'); key('ArrowUp');
  assert.equal(ta.attrs['aria-activedescendant'], `${pop.id}-${n - 1}`, 'up from the first option wraps to the last');
});

test('tab or enter accepts the active option, and escape closes without editing', () => {
  for (const k of ['Tab', 'Enter']) {
    const { ta, pop, key, open } = setup('item-a');
    key(' ', { ctrlKey: true });
    const first = pop.children[0].children[0];
    assert.equal(key(k).prevented, true);
    assert.equal(open(), false);
    assert.equal(ta.value, first);
    assert.equal(ta.attrs['aria-activedescendant'], undefined);
  }
  const { ta, key, open } = setup('item');
  key(' ', { ctrlKey: true });
  const esc = key('Escape');
  assert.deepEqual([esc.prevented, esc.stopped, open(), ta.value], [true, true, false, 'item']);
});

test('with the popup open, modified enter and other keys pass through to the textarea', () => {
  const { ta, key, open } = setup('item');
  key(' ', { ctrlKey: true });
  assert.equal(key('Enter', { shiftKey: true }).prevented, false);
  assert.equal(key('Tab', { ctrlKey: true }).prevented, false);
  assert.equal(key('x').prevented, false);
  assert.equal(open(), true);
  assert.equal(ta.value, 'item');
});

test('keys an input method is composing are left alone', () => {
  const { ta, key } = setup('a {', 3);
  assert.equal(key('Enter', { isComposing: true }).prevented, false);
  assert.equal(key('Enter', { keyCode: 229 }).prevented, false);
  assert.equal(ta.value, 'a {');
});

test('enter, tab, backspace and brackets edit the text in one undo step each', () => {
  let s = setup('a {', 3);
  assert.equal(s.key('Enter').prevented, true);
  assert.equal(s.ta.value, 'a {\n  ');
  s = setup('a', 1);
  s.key('Tab');
  assert.equal(s.ta.value, 'a  ');
  s = setup('()', 1);
  s.key('Backspace');
  assert.equal(s.ta.value, '');
  s = setup('', 0);
  s.key('(');
  assert.deepEqual([s.ta.value, s.ta.selectionStart], ['()', 1]);
  s.key(')');
  assert.deepEqual([s.ta.value, s.ta.selectionStart], ['()', 2], 'typing the closer steps over it');
});

test('editing help stays out of the way of shortcuts, read-only text and plain keys', () => {
  let s = setup('a {', 3);
  for (const mods of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) assert.equal(s.key('Enter', mods).prevented, false);
  assert.equal(s.key('Backspace', { shiftKey: true }).prevented, false);
  assert.equal(s.key('x').prevented, false);
  assert.equal(s.key('Shift').prevented, false);
  assert.equal(s.ta.value, 'a {');
  s = setup('a {', 3);
  s.ta.readOnly = true;
  assert.equal(s.key('Enter').prevented, false);
  assert.equal(s.key(' ', { ctrlKey: true }).prevented, true);
  assert.equal(s.open(), false, 'read-only text never opens the popup');
});

test('escape then tab lets focus leave the editor, but a later tab indents', (t) => {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  const { ta, key } = setup('a', 1);
  key('Escape');
  now += 1000;
  assert.equal(key('Tab').prevented, false);
  assert.equal(ta.value, 'a');
  key('Escape');
  now += 2000;
  assert.equal(key('Tab').prevented, true);
  assert.equal(ta.value, 'a  ');
});

test('destroy removes the key handler and the combobox attributes', () => {
  const { ta, ed, key } = setup('a {', 3);
  ed.destroy();
  assert.equal(key('Enter').prevented, false);
  assert.equal(ta.attrs.role, undefined);
});

test('the popup closes on caret moves, blur and a model swap, and follows the text when it scrolls', () => {
  const { ta, pop, key, open } = setup('item');
  key(' ', { ctrlKey: true });
  ta.dispatch('scroll');
  assert.equal(open(), true);
  assert.match(pop.style.top, /px$/);
  ta.dispatch('keyup', { key: 'x' });
  assert.equal(open(), true);
  ta.dispatch('keyup', { key: 'ArrowLeft' });
  assert.equal(open(), false);
  for (const t of ['blur', 'eventline:replaced']) {
    key(' ', { ctrlKey: true });
    ta.dispatch(t);
    assert.equal(open(), false, t);
  }
  ta.dispatch('scroll');
  assert.equal(open(), false);
});

test('typing opens the popup unless an input method is composing', () => {
  const { ta, open } = setup('item');
  ta.dispatch('input', { isComposing: true });
  assert.equal(open(), false);
  ta.dispatch('input', {});
  assert.equal(open(), true);
});
