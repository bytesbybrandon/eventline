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

test('the browser bundle the playground loads draws the same board as the library, so it is never stale', () => {
  const vm = require('node:vm');
  const sandbox = { window: {} };
  vm.runInNewContext(read('site/eventline.js'), sandbox);
  const { parse: bparse, render: brender, check } = sandbox.window.eventline;
  assert.equal(brender(bparse(dsl), 'eventmodel', 'svg', 'dark'), render(parse(dsl), 'eventmodel', 'svg', 'dark'), 'run: node scripts/build-site.js');
  assert.ok(Array.isArray(check(bparse(dsl))));
  for (const name of ['rate-limiter', 'payment-webhook', 'billing', 'twitter-pure']) assert.equal(read(`site/examples/${name}.dsl`), read(`examples/${name}.dsl`), `site/examples/${name}.dsl is stale: run node scripts/build-site.js`);
});

test('every board node and edge carries the ids the page uses to trace lineage', () => {
  const svg = render(parse(dsl), 'eventmodel', 'svg', 'dark');
  const nodes = [...svg.matchAll(/<g class="nd" data-id="([^"]+)"/g)].map((m) => m[1]);
  const edges = [...svg.matchAll(/<g class="ed" data-from="([^"]+)" data-to="([^"]+)"/g)];
  assert.ok(nodes.length > 10 && edges.length > 10);
  for (const [, from, to] of edges) assert.ok(nodes.includes(from) && nodes.includes(to), `edge ${from} -> ${to} points at a node that is not drawn`);
});
