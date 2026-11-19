'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const html = read('site/index.html');
const requiredIds = [...read('site/playground.js').match(/REQUIRED_IDS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

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
  assert.ok(requiredIds.length > 15);
  for (const id of requiredIds) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});
test('the app has every element the playground needs and loads its modules', () => {
  const app = read('site/app/index.html');
  for (const id of requiredIds) assert.ok(app.includes(`id="${id}"`), `missing #${id}`);
  for (const src of ['../eventline.js', '../playground.js', 'store.js', 'session.js', 'zip.js', 'app.js']) assert.ok(app.includes(`src="${src}"`), src);
});

test('the homepage links to the app and the sitemap lists it', () => {
  assert.ok(html.includes('id="pg-open-app"'));
  assert.ok(read('site/sitemap.xml').includes('/eventline/app/'));
  for (const f of ['docs-site/src/components/Header.astro', 'docs-site/src/components/Hub.astro']) assert.ok(read(f).includes('/eventline/app/'), f);
});

test('board links keep only the addresses the link-url check allows', () => {
  const sandbox = { window: {}, requestAnimationFrame() {} };
  require('node:vm').runInNewContext(read('site/playground.js'), sandbox);
  const { safeHref } = sandbox.window.EventlinePlayground;
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', '\u0001\tjavascript:x', 'data:text/html,x', 'vbscript:x', '']) assert.equal(safeHref(bad), false, bad);
  for (const ok of ['https://x', 'http://x', ' HTTPS://x', '/eventline/', './a.svg', '../a.svg', '#d=context', '#d=context&n=Cart']) assert.equal(safeHref(ok), true, ok);
});
test('click-to-source prefers the processor when it shares lines with an implied read model', () => {
  const js = read('site/playground.js');
  assert.match(js, /len === size && el\.dataset\.kind === 'policy'/);
  assert.equal(js.split('closer(el,').length - 1, 2); // one helper, used by the caret and by a finding
});

test('the highlighter knows readmodel', () => {
  assert.match(read('site/playground.js'), /\|readmodel\|/);
});

test('the homepage explains read models and screens, and never mentions a policy lane', () => {
  assert.match(html, /Is a read model a screen\?/);
  assert.doesNotMatch(html, /lane below|policy lane/i);
  assert.doesNotMatch(read('examples/twitter-pure.dsl'), /^view /m);
});

test('the board marks a short -[default]-> line as the default branch', () => {
  assert.match(read('site/site.js'), /--\?\\\[default\\\]--\?>/);
});

test('the highlighter treats policy as a keyword only before a name and =', () => {
  const HEAD = new Function(`return ${read('site/playground.js').match(/const HEAD = (\/.*\/);/)[1]}`)();
  assert.equal(HEAD.exec('policy Fan = x-done { id }')[2], 'policy');
  assert.equal(HEAD.exec('policy -> go(id)'), null);
  assert.equal(HEAD.exec('policy { id } -> w -> go(id)'), null);
});
