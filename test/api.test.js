'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

test('the package entry parses, checks and draws a model', () => {
  const api = require('eventline-axi');
  const model = api.parse('user -> go()\n  --[bad]--> reject NOPE\n  --[default]--> [a-b]\n');
  assert.equal(model.commands[0].branches[0].reject, 'NOPE');
  assert.ok(Array.isArray(api.check(model)));
  assert.match(api.render(model, 'eventmodel'), /^<svg/);
  assert.deepEqual(api.KINDS.slice(0, 2), ['eventmodel', 'context']);
  assert.throws(() => api.parse('user -> go('), api.ParseError);
});

test('the package entry pulls in no Node built-ins or dependencies, so it bundles for a browser', () => {
  const lib = path.join(__dirname, '..', 'lib');
  for (const key of Object.keys(require.cache)) if (key.startsWith(lib)) delete require.cache[key];
  const external = [];
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (!request.startsWith('.')) external.push(request);
    return load.call(this, request, ...rest);
  };
  try { require('../lib/index.js'); } finally { Module._load = load; }
  assert.deepEqual(external, []);
});
