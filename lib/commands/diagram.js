'use strict';

const fs = require('fs');
const path = require('path');
const { buildBoard, boardToGraph } = require('../diagram/board');
const { renderBoard, renderGraph } = require('../diagram/svg');
const { toMermaid, toDot } = require('../diagram/export');
const { BUILDERS } = require('../diagram/system');

const KINDS = ['eventmodel', 'context', 'containers', 'dataflow', 'deployment'];
const FORMATS = { svg: 'svg', mermaid: 'mmd', dot: 'dot' };

/* Returns the diagram as text. Throws an Error with .code NO_REGIONS when a deployment view has nothing to draw. */
function render(model, kind, format = 'svg', theme = 'light') {
  if (!KINDS.includes(kind)) throw new Error(`Unknown diagram "${kind}". Choose one of: ${KINDS.join(', ')}`);
  if (!FORMATS[format]) throw new Error(`Unknown format "${format}". Choose one of: ${Object.keys(FORMATS).join(', ')}`);
  if (kind === 'eventmodel') {
    const board = buildBoard(model);
    if (format === 'svg') return renderBoard(board, { theme });
    return (format === 'mermaid' ? toMermaid : toDot)(boardToGraph(board));
  }
  const graph = BUILDERS[kind](model);
  if (format === 'svg') return renderGraph(graph, { theme });
  return (format === 'mermaid' ? toMermaid : toDot)(graph);
}

module.exports = {
  KINDS,
  render,
  run(model, opts, kind) {
    try {
      const text = render(model, kind, opts.format, opts.theme);
      if (opts.out) { fs.writeFileSync(opts.out, text); console.error(`wrote ${opts.out}`); } else process.stdout.write(text);
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  },
  runAll(model, opts) {
    const dir = opts.out || 'diagrams';
    fs.mkdirSync(dir, { recursive: true });
    const written = [];
    for (const kind of KINDS) {
      for (const [format, ext] of Object.entries(FORMATS)) {
        try {
          const file = path.join(dir, `${kind}.${ext}`);
          fs.writeFileSync(file, render(model, kind, format, opts.theme));
          written.push(file);
        } catch (err) {
          if (err.code === 'NO_REGIONS') { console.error(`skipped ${kind}: ${err.message}`); break; }
          throw err;
        }
      }
    }
    console.log(`wrote ${written.length} files to ${dir}`);
    for (const f of written) console.log(`  ${f}`);
  }
};
