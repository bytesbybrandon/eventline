'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tierOf, crap, joinMessages, attribute, parseArgs, fileOf, rowsOf, table, listFiles, report } = require('../scripts/measure');

test('measure: each file is held to its tier, and CRAP follows the formula', () => {
  assert.equal(tierOf('lib/parser.js'), 'P0');
  assert.equal(tierOf('lib/commands/deps.js'), 'P1');
  assert.equal(tierOf('lib/folder.js'), 'P2');
  assert.equal(tierOf('scripts/bench.js'), 'P2');
  assert.equal(crap(8, 1), 8);
  assert.equal(crap(10, 0.5), 22.5);
});

test('measure: a function gets the complexity reported at its head, and a missing one is an error', () => {
  const range = { ruleId: 'measure/functions', line: 3, column: 1, message: JSON.stringify({ range: [10, 50], name: 'f' }) };
  const cc = { ruleId: 'complexity', line: 3, column: 1, message: "Function 'f' has a complexity of 4. Maximum allowed is 0." };
  assert.deepEqual(joinMessages('lib/x.js', [range, cc]), [{ file: 'lib/x.js', line: 3, name: 'f', start: 10, end: 50, cc: 4 }]);
  assert.throws(() => joinMessages('lib/x.js', [range]), /no complexity reported for f/);
});

test('measure: branch coverage counts the function and its own blocks, merged across processes', () => {
  const outer = { file: 'lib/x.js', start: 10, end: 100 };
  const inner = { file: 'lib/x.js', start: 40, end: 60 };
  const never = { file: 'lib/x.js', start: 110, end: 150 };
  const fn = (start, end, count, blocks = []) => ({ ranges: [{ startOffset: start, endOffset: end, count }, ...blocks] });
  const url = 'file:///x.js';
  // V8 starts a function before ESLint does; blocks with the parent's count are left out.
  const a = [{ url, functions: [fn(5, 100, 1, [{ startOffset: 20, endOffset: 30, count: 0 }, { startOffset: 70, endOffset: 80, count: 0 }]), fn(38, 60, 0), fn(105, 150, 0)] }];
  const b = [{ url, functions: [fn(5, 100, 1, [{ startOffset: 70, endOffset: 80, count: 0 }])] }];
  const cov = attribute([outer, inner, never], [a, b], (u) => (u === url ? 'lib/x.js' : null));
  assert.equal(cov.get(outer), 2 / 3); // its own range ran; 20..30 ran in b, where it was left out; 70..80 never ran
  assert.equal(cov.get(inner), 0);
  assert.equal(cov.get(never), 0);
});

test('measure: the command line, the rows and the table', () => {
  assert.deepEqual(parseArgs([]), { paths: ['lib', 'scripts'], all: false, json: false, coverage: true, maxCc: null });
  assert.deepEqual(parseArgs(['lib/parser.js', '--max-cc', '30', '--all', '--json', '--no-coverage']), { paths: ['lib/parser.js'], all: true, json: true, coverage: false, maxCc: 30 });
  assert.equal(fileOf('node:fs'), null);
  assert.equal(fileOf(require('node:url').pathToFileURL(require('node:path').join(__dirname, '..', 'lib', 'parser.js')).href), 'lib/parser.js');
  assert.equal(fileOf('file:///elsewhere/x.js'), null);
  const a = { file: 'lib/parser.js', line: 1, name: 'a', cc: 10 };
  const b = { file: 'scripts/x.js', line: 2, name: 'b', cc: 2 };
  const rows = rowsOf([a, b], new Map([[a, 0.5]]));
  assert.deepEqual(rows.map((r) => [r.name, r.cov, r.crap, r.over]), [['a', 50, 22.5, true], ['b', null, 2, false]]);
  const out = table(rows, rows.filter((r) => r.over));
  assert.match(out, /\| `a` \| `lib\/parser\.js:1` \| P0 \| 10 \| 50% \| 22\.5 \|/);
  assert.match(out, /2 functions, 1 over their tier's limits, highest CC 10\./);
  assert.ok(listFiles(['scripts']).includes('scripts/measure.js'));
  const quiet = report(rows, parseArgs([]));
  assert.deepEqual([quiet.errors, quiet.code], [[], 0]);
  assert.match(quiet.out, /`a`/);
  assert.doesNotMatch(quiet.out, /`b`/);
  const strict = report(rows, parseArgs(['--max-cc', '8', '--json', '--all']));
  assert.deepEqual(JSON.parse(strict.out).map((r) => r.name), ['a', 'b']);
  assert.deepEqual([strict.errors, strict.code], [['lib/parser.js:1 a has CC 10, over 8'], 1]);
});
