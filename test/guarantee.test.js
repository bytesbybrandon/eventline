'use strict';

/* Guarantee tests: what parse, check and every diagram return today, pinned so a refactor can prove it changed nothing.
 * Regenerate only on purpose, and say why in the PR: UPDATE_GOLDENS=1 node --test test/guarantee.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, check, linkMap, KINDS } = require('../lib');
const { buildBoard } = require('../lib/diagram/board');
const { BUILDERS } = require('../lib/diagram/system');
const { sourceRanges } = require('../lib/diagram/links');
const { PROFILES } = require('../lib/rules');

const root = path.join(__dirname, '..');
const dir = path.join(__dirname, 'fixtures', 'guarantee');
const plain = (x) => JSON.parse(JSON.stringify(x));

/* Compares with the stored golden, or writes it when UPDATE_GOLDENS is set. */
function golden(name, actual) {
  const file = path.join(dir, `${name}.json`);
  const value = plain(actual);
  if (process.env.UPDATE_GOLDENS) fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
  assert.deepEqual(value, JSON.parse(fs.readFileSync(file, 'utf8')), `${name} differs from its golden`);
}

const attempt = (fn) => { try { return fn(); } catch (err) { if (!err.code) throw err; return { error: err.code }; } };

/* Everything a model gives: the parsed model, check under every profile, every diagram, the links and the source ranges. */
function snapshot(text) {
  const model = parse(text);
  return {
    model: { ...model.toJSON(), declarations: model.declarations },
    check: Object.fromEntries(PROFILES.map((profile) => [profile, check(model, { profile })])),
    diagrams: Object.fromEntries(KINDS.map((kind) => [kind, attempt(() => (kind === 'eventmodel' ? buildBoard(model) : BUILDERS[kind](model)))])),
    links: linkMap(model),
    ranges: Object.fromEntries(KINDS.map((kind) => [kind, Object.fromEntries(sourceRanges(model, kind))])),
  };
}

const MODELS = {
  ...Object.fromEntries(fs.readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.dsl')).map((f) => [`example-${f.slice(0, -4)}`, fs.readFileSync(path.join(root, 'examples', f), 'utf8')])),
  forms: fs.readFileSync(path.join(dir, 'forms.dsl'), 'utf8'),
  unscoped: 'system Plain {\n  region: a, b\n}\nuser -> go(id)\n  -[default]-> [x-done { id }]\nview V(id) = [x-done(id)] => { id }\nx-done { id } -> w -> other(id)\n',
  undrawable: 'user -> go(id) @link(to="deployment") @link(to="contextmap")\n  -[default]-> [x-done { id }]\n',
};

for (const [name, text] of Object.entries(MODELS)) {
  test(`guarantee: ${name} parses, checks, draws and links as it did`, () => golden(name, snapshot(text)));
}

/* Every way a statement can fail to parse, with its message and line. */
const BROKEN = [
  'context A {\n  context B {\n  }\n}',
  'context A {\n  system S {\n  }\n}',
  'policy P = user -> go(id)\n  -[default]-> [x-done { id }]',
  'policy P = x-done { id } -> w -> go(id)\npolicy P = y-done { id } -> w -> go(id)',
  'policy P = x-done { id } -> w -> go(id)\nuser -> P(id)\n  -[default]-> [y-done { id }]',
  'event a-b\nevent a-b',
  'scenario "alone" {\n  Given nothing\n}',
  'foo bar',
  'from x',
  'x-done --[a]-> w -> go()',
  'every 5 fortnights -> w -> go()',
  'user -> go(id\n',
];

test('guarantee: every parse error keeps its message and line', () => {
  golden('parse-errors', BROKEN.map((text) => {
    try { parse(text); return { text, error: null }; } catch (err) { return { text, error: err.message, line: err.line }; }
  }));
});
