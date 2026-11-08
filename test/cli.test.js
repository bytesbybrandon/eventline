'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'eventline-axi');
const file = path.join(__dirname, '..', 'examples', 'twitter-pure.dsl');
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('-f after a subcommand is honored', () => {
  assert.match(run('diagram', 'containers', file, '-f', 'mermaid').stdout, /^flowchart LR/);
  assert.match(run('diagram', 'containers', file, '-f', 'dot').stdout, /^digraph/);
  assert.equal(JSON.parse(run('events', file, '-f', 'json').stdout).length, 16);
  assert.equal(JSON.parse(run('validate', file, '-f', 'json').stdout).some((i) => i.rule === 'assumed-events'), true);
  assert.equal(JSON.parse(run('parse', file, '-f', 'json').stdout).commands.length, 5);
});

test('a missing file or unknown diagram fails with a message and a non-zero exit', () => {
  const missing = run('events', 'nope.dsl');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /file not found/);
  const bad = run('diagram', 'nope', file);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Choose one of/);
});

test('validate exits non-zero only when there is an error', () => {
  assert.equal(run('validate', file).status, 0);
});
