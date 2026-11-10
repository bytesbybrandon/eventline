'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('../lib/folder');
const { check } = require('../lib');

const tmp = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'el-'));
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
  return dir;
};
const CMD = 'user -> addItem(cartId, sku)\n  --[default]--> [item-added { cartId, sku }]\n';
const VIEW = 'view Cart(cartId) = [item-added*(cartId)] => { cartId, sku }\n';

test('a folder is one model: references resolve across files and where a statement lives changes nothing', () => {
  const a = load(tmp({ 'a.dsl': CMD, 'b.dsl': VIEW }));
  const b = load(tmp({ 'a.dsl': VIEW, 'b.dsl': CMD }));
  assert.equal(a.model.views.length, 1);
  assert.equal(a.model.events.get('item-added').consumedBy[0].name, 'Cart');
  const sig = (m) => check(m, { profile: 'eventmodeling' }).map((i) => i.rule).sort().join();
  assert.equal(sig(a.model), sig(b.model));
  const c = load(tmp({ 'all.dsl': CMD + VIEW }));
  assert.equal(sig(a.model), sig(c.model), 'the same as one file');
});

test('findings and parse errors name the file and the line inside it; dot files, other extensions and subfolders are ignored', () => {
  const dir = tmp({ 'a.dsl': CMD, 'b.dsl': '\n' + VIEW.replace('sku }', 'sku, zz }'), 'notes.md': 'x', '.hidden.dsl': 'garbage ->' });
  fs.mkdirSync(path.join(dir, 'sub')); fs.writeFileSync(path.join(dir, 'sub', 'c.dsl'), 'garbage ->');
  const l = load(dir);
  assert.deepEqual(l.files.map((f) => f.name), ['a.dsl', 'b.dsl']);
  const issue = check(l.model, { profile: 'eventmodeling' }).find((i) => i.rule === 'unsourced-view-field');
  assert.deepEqual(l.locate(issue.line), { file: 'b.dsl', line: 2 });
  assert.throws(() => load(tmp({ 'a.dsl': CMD, 'z.dsl': 'user -> a(\n' })), (e) => e.file === 'z.dsl' && /^z\.dsl: /.test(e.message));
  assert.throws(() => load(tmp({ 'x.md': 'x' })), /No \.dsl files/);
});
