'use strict';

/* Rebuilds the parts of site/ that come from the model, so the page never drifts from the DSL:
 *   site/twitter-pure.dsl          the file the page tells visitors to download
 *   site/assets/eventmodel.svg     the Event Modeling board, derived by eventline itself
 *   site/examples/*.dsl            the models the playground starts from
 *   site/eventline.js              lib/index.js bundled for the browser, so the playground runs the real parser
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('../lib/parser');
const { render } = require('../lib/diagram');

const root = path.join(__dirname, '..');

/* A dependency-free CommonJS bundler. lib/ is pure (no I/O), so a module table and a require shim are enough. */
function bundle(entry) {
  const ids = new Map();
  const bodies = [];
  const resolve = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec);
    for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    throw new Error(`cannot resolve ${spec} from ${from}`);
  };
  const visit = (file) => {
    if (ids.has(file)) return ids.get(file);
    const id = ids.size;
    ids.set(file, id);
    bodies[id] = null;
    const src = fs.readFileSync(file, 'utf8').replace(/require\((['"])(\.[^'"]+)\1\)/g, (_, _q, spec) => `__r(${visit(resolve(file, spec))})`);
    bodies[id] = `function (module, exports, __r) {\n${src}\n}`;
    return id;
  };
  visit(entry);
  return `/* eventline, bundled from lib/ by scripts/build-site.js. Do not edit. */\n(function () {\n'use strict';\nvar defs = [\n${bodies.join(',\n')}\n];\nvar cache = [];\nfunction __r(i) {\n  if (cache[i]) return cache[i].exports;\n  var m = cache[i] = { exports: {} };\n  defs[i].call(m.exports, m, m.exports, __r);\n  return m.exports;\n}\nwindow.eventline = __r(0);\n})();\n`;
}

const src = path.join(root, 'examples', 'twitter-pure.dsl');
const text = fs.readFileSync(src, 'utf8');
const model = parse(text);

fs.copyFileSync(src, path.join(root, 'site', 'twitter-pure.dsl'));
fs.mkdirSync(path.join(root, 'site', 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'site', 'assets', 'eventmodel.svg'), render(model, 'eventmodel', 'svg', 'dark'));
fs.mkdirSync(path.join(root, 'site', 'examples'), { recursive: true });
for (const f of ['rate-limiter', 'payment-webhook', 'billing', 'twitter-pure']) fs.copyFileSync(path.join(root, 'examples', `${f}.dsl`), path.join(root, 'site', 'examples', `${f}.dsl`));
fs.writeFileSync(path.join(root, 'site', 'eventline.js'), bundle(path.join(root, 'lib', 'index.js')));
console.log('site: twitter-pure.dsl, assets/eventmodel.svg and eventline.js rebuilt');
