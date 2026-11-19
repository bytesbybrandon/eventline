'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { suggest, namesFrom, SNIPPETS } = require('../site/app/complete.js');

test('two typed characters suggest matching names and snippets', () => {
  const r = suggest({ text: 'vi', caret: 2, names: [{ label: 'visit-logged', kind: 'event' }], forced: false });
  assert.deepEqual(r.items.map((i) => i.label), ['visit-logged', 'view']);
  assert.deepEqual([r.from, r.to], [0, 2]);
});
test('one character suggests nothing unless forced', () => {
  assert.equal(suggest({ text: 'v', caret: 1, names: [], forced: false }), null);
  assert.ok(suggest({ text: 'v', caret: 1, names: [], forced: true }).items.length);
});
test('hyphenated event names complete as one word', () => {
  const r = suggest({ text: 'on [item-ad', caret: 11, names: [{ label: 'item-added', kind: 'event' }], forced: false });
  assert.equal(r.from, 4); assert.equal(r.items[0].insert, 'item-added');
  assert.equal(r.items[0].caretOffset, 10);
});
test('nothing is suggested inside a comment or a string', () => {
  const names = [{ label: 'visit-logged', kind: 'event' }];
  assert.equal(suggest({ text: '// vi', caret: 5, names, forced: false }), null);
  assert.equal(suggest({ text: '"vi', caret: 3, names, forced: false }), null);
  assert.ok(suggest({ text: '// x\nvi', caret: 7, names, forced: false }));
});
test('a name already typed in full is not offered back', () => {
  const names = [{ label: 'item-added', kind: 'event' }];
  assert.equal(suggest({ text: 'item-added', caret: 10, names, forced: false }), null);
});
test('at most eight suggestions are returned', () => {
  const names = Array.from({ length: 20 }, (_, i) => ({ label: 'item-' + String.fromCharCode(97 + i), kind: 'event' }));
  assert.equal(suggest({ text: 'item', caret: 4, names, forced: false }).items.length, 8);
});
test('snippets report where the caret goes', () => {
  const s = SNIPPETS.find((i) => i.label === 'actor');
  assert.equal(s.insert.slice(0, s.caretOffset), 'actor ');
  const sys = SNIPPETS.find((i) => i.label === 'system');
  assert.equal(sys.insert, 'system  {\n  slo: 99.9% uptime\n}');
});
test('namesFrom lists each model name once', () => {
  assert.deepEqual(namesFrom(null), []);
  const model = {
    events: new Map([['a-b', {}]]),
    commands: [{ name: 'go' }, { name: 'go' }],
    views: [{ name: 'v' }], boundaries: [{ name: 'B' }], actors: [{ name: 'a-b' }],
  };
  assert.deepEqual(namesFrom(model).map((n) => n.kind + ':' + n.label), ['event:a-b', 'command:go', 'read model:v', 'boundary:B']);
});
test('readmodel has a snippet', () => {
  assert.ok(SNIPPETS.some((s) => s.label === 'readmodel'));
  assert.ok(SNIPPETS.some((s) => s.label === 'view'));
});
test('policy snippet writes a named policy', () => {
  const s = SNIPPETS.find((i) => i.label === 'policy');
  assert.equal(s.insert, 'policy Name = event-name { id }\n  -> worker-name -> nextCommand(id)');
  assert.equal(s.caretOffset, 7);
});
