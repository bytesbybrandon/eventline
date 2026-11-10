'use strict';

/*
 * A model can be a file or a folder. A folder model is every *.dsl file directly in it (not dot files, not subfolders),
 * read as one model: references resolve across files, and moving a statement between files changes nothing.
 * Node only: the browser bundle never reads files.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('./parser');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.dsl') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/* Returns { model, text, files: [{ name, start, end }], locate(line) -> { file, line } }. Throws an Error naming the file on a parse error. */
function load(target) {
  if (!fs.statSync(target).isDirectory()) {
    const text = fs.readFileSync(target, 'utf8');
    const name = path.basename(target);
    const list = [{ name, start: 1, end: text.split('\n').length }];
    return { model: parse(text), text, files: list, locate: (line) => ({ file: name, line }) };
  }
  const names = files(target);
  if (!names.length) throw new Error(`No .dsl files in ${target}`);
  const parts = names.map((name) => ({ name, text: fs.readFileSync(path.join(target, name), 'utf8').replace(/\r\n/g, '\n').replace(/\n*$/, '\n') }));
  for (const p of parts) {
    try { parse(p.text); } catch (err) {
      const e = new Error(`${p.name}: ${err.message}`);
      e.file = p.name; e.line = err.line;
      throw e;
    }
  }
  const list = [];
  let at = 1;
  for (const p of parts) { const n = p.text.split('\n').length - 1; list.push({ name: p.name, start: at, end: at + n - 1 }); at += n; }
  const text = parts.map((p) => p.text).join('');
  return {
    model: parse(text), text, files: list,
    locate: (line) => { const f = list.find((x) => line >= x.start && line <= x.end); return f ? { file: f.name, line: line - f.start + 1 } : { file: null, line }; },
  };
}

module.exports = { load, files };
