'use strict';

/* Rebuilds the parts of site/ that come from the model, so the page never drifts from the DSL:
 *   site/twitter-pure.dsl          the file the page tells visitors to download
 *   site/assets/eventmodel.svg     the Event Modeling board, derived by eventline itself
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('../lib/parser');
const { render } = require('../lib/commands/diagram');

const root = path.join(__dirname, '..');
const src = path.join(root, 'examples', 'twitter-pure.dsl');
const text = fs.readFileSync(src, 'utf8');
const model = parse(text);

fs.copyFileSync(src, path.join(root, 'site', 'twitter-pure.dsl'));
fs.mkdirSync(path.join(root, 'site', 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'site', 'assets', 'eventmodel.svg'), render(model, 'eventmodel', 'svg', 'dark'));
console.log('site: twitter-pure.dsl and assets/eventmodel.svg rebuilt');
