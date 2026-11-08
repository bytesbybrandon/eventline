'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../lib/parser');
const { summarize } = require('../lib/summary');
const { render } = require('../lib/diagram');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const dsl = read('examples/twitter-pure.dsl');
const html = read('site/index.html');

test('the site ships the same example file it tells visitors to download', () => {
  assert.equal(read('site/twitter-pure.dsl'), dsl);
});

test('the CLI output shown on the page is what the CLI prints for that file', () => {
  const { counts } = summarize(parse(dsl));
  const shown = Object.fromEntries([...html.matchAll(/(\w+): <span data-sc-count="0 (\d+)">\d+<\/span>/g)].map((m) => [m[1], +m[2]]));
  assert.deepEqual(shown, counts);
});

test('the DSL listing on the page matches the file line for line', () => {
  const inner = [...html.matchAll(/<div class="blk"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  const lines = inner.flatMap((b) => [...b.matchAll(/<span class="ln">([\s\S]*?)<\/span>(?=<span class="ln">|$)/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trimEnd()));
  const want = dsl.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  assert.deepEqual(lines.filter((l) => l.trim()), want);
});

test('the event model board on the page is the one eventline derives today', () => {
  assert.equal(read('site/assets/eventmodel.svg'), render(parse(dsl), 'eventmodel', 'svg', 'dark'), 'run: node scripts/build-site.js');
});
