'use strict';

/* Measures the budgets in PERFORMANCE-STANDARDS.md: parse, check and the board at 1x, 10x and 50x
 * the twitter example, plus the size of the browser bundle. Prints a table; never fails.
 * Run: node scripts/bench.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parse, check, render } = require('../lib');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'examples/twitter-pure.dsl'), 'utf8');
// Copies drop the system block (only one is allowed) and rename events and commands so they stay distinct.
const body = src.replace(/^system[\s\S]*?^}\n?/m, '');
const copy = (i) => body.replace(/\b([a-z]+(?:-[a-z]+)+)\b/g, `$1-x${i}`).replace(/\b([a-z][A-Za-z]+)\(/g, `$1X${i}(`);

function ms(fn, runs) {
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  return (Number(process.hrtime.bigint() - start) / 1e6 / runs).toFixed(2);
}

// check and board columns include their own parse; the loop column is one parse, then check and board on that model.
console.log('scale      bytes    parse ms  check ms  board ms  loop ms');
// The last row adds one @link to the deployment diagram, which makes check build that diagram.
const LINK = '\nuser -> linkProbe(id) @link(to="deployment")\n  -[default]-> [link-probed { id }]\n';
for (const [n, label, extra] of [[1, '1x', ''], [10, '10x', ''], [50, '50x', ''], [50, '50x+@link', LINK]]) {
  let text = src;
  for (let i = 1; i < n; i++) text += `\n${copy(i)}`;
  text += extra;
  const runs = n === 50 ? 1 : 5;
  const row = [label.padEnd(10), String(text.length).padEnd(8), ms(() => parse(text), runs).padEnd(9), ms(() => check(parse(text)), runs).padEnd(9), ms(() => render(parse(text), 'eventmodel'), runs).padEnd(9), ms(() => {
    const model = parse(text);
    check(model);
    render(model, 'eventmodel');
  }, runs)];
  console.log(row.join(' '));
}

const bundle = fs.readFileSync(path.join(root, 'site/eventline.js'));
console.log(`site/eventline.js: ${(bundle.length / 1000).toFixed(1)} kB raw, ${(zlib.gzipSync(bundle).length / 1000).toFixed(1)} kB gzip`);
