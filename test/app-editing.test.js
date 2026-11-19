'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { onEnter, onTab, onType, onBackspace, matchBracket, INDENT } = require('../site/app/editing.js');

const apply = (text, e) => text.slice(0, e.from) + e.insert + text.slice(e.to);

test('enter keeps indentation', () => { assert.equal(onEnter('  a', 3, 3).insert, '\n  '); });
test('enter adds a level after an opening brace or bracket', () => {
  assert.equal(onEnter('view V = [', 10, 10).insert, '\n  ');
  assert.equal(onEnter('system S {', 10, 10).insert, '\n  ');
});
test('enter between a pair puts the closer on its own line', () => {
  const e = onEnter('x {}', 3, 3);
  assert.equal(e.insert, '\n  \n'); assert.equal(e.selStart, 6);
});
test('a closer on a blank line removes one level', () => {
  const e = onType('a {\n    ', 8, 8, '}');
  assert.equal(e.from, 4); assert.equal(e.insert, '  }');
});
test('tab inserts two spaces, and indents or dedents a selection of lines', () => {
  assert.equal(onTab('a', 1, 1, false).insert, '  ');
  assert.equal(apply('a\nb', onTab('a\nb', 0, 3, false)), '  a\n  b');
  assert.equal(apply('  a\n  b', onTab('  a\n  b', 0, 7, true)), 'a\nb');
});
test('pairs close, step over and delete together', () => {
  assert.equal(onType('', 0, 0, '(').insert, '()');
  assert.equal(onType('()', 1, 1, ')').selStart, 2);
  assert.deepEqual([onBackspace('()', 1, 1).from, onBackspace('()', 1, 1).to], [0, 2]);
});
test('no pairing inside a comment or a string', () => {
  assert.equal(onType('// a', 4, 4, '('), null);
  assert.equal(onType('"a', 2, 2, '('), null);
});
test('typing over a selection wraps it in the pair', () => { assert.equal(apply('ab', onType('ab', 0, 2, '[')), '[ab]'); });
test('matchBracket finds partners across lines and ignores strings and comments', () => {
  assert.deepEqual(matchBracket('a { "}" // }\n}', 3), [2, 13]);
  assert.equal(matchBracket('a', 1), null);
});

// Beyond the brief: edges the editor relies on.
test('quotes pair, and the closing quote steps over', () => {
  assert.equal(onType('a ', 2, 2, '"').insert, '""');
  const e = onType('""', 1, 1, '"'); assert.equal(e.insert, ''); assert.equal(e.selStart, 2);
});
test('shift+tab on a caret dedents its line and keeps the caret on its text', () => {
  const e = onTab('    a', 5, 5, true);
  assert.equal(apply('    a', e), '  a'); assert.equal(e.selStart, 3);
});
test('a selection ending at the start of a line leaves that line alone', () => {
  assert.equal(apply('a\nb', onTab('a\nb', 0, 2, false)), '  a\nb');
});
test('backspace only removes a pair when the caret sits between it', () => {
  assert.equal(onBackspace('(a)', 2, 2), null);
  assert.equal(onBackspace('// ()', 4, 4), null);
});
test('matchBracket works from either side and from the closer', () => {
  assert.deepEqual(matchBracket('(a)', 0), [0, 2]);
  assert.deepEqual(matchBracket('(a)', 3), [2, 0]);
  assert.equal(matchBracket('// (a)', 4), null);
  assert.equal(INDENT, '  ');
});

test('the app loads the editing help before the editor and describes how to leave it', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../site/app/index.html'), 'utf8');
  assert.ok(html.indexOf('src="editing.js"') > -1 && html.indexOf('src="editing.js"') < html.indexOf('src="editor.js"'));
  assert.match(html, /aria-describedby="pg-status ap-ed-help"/);
  assert.match(html, /id="ap-ed-help"[^>]*>Press Esc, then Tab, to leave the editor\./);
});
