'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const html = read('site/index.html');

test('the homepage loads the shared playground before its own script', () => {
  assert.ok(html.indexOf('src="playground.js"') > -1);
  assert.ok(html.indexOf('src="playground.js"') < html.indexOf('src="site.js"'));
  assert.ok(html.indexOf('href="playground.css"') < html.indexOf('href="site.css"'));
});
test('the playground code lives in one place', () => {
  assert.ok(!read('site/site.js').includes('function drawBoard'));
  assert.ok(read('site/playground.js').includes('function drawBoard'));
});
test('the homepage has every element the playground needs', () => {
  const ids = [...read('site/playground.js').match(/REQUIRED_IDS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 15);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});
