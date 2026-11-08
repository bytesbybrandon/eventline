'use strict';

const { buildBoard, boardToGraph } = require('./board');
const { renderBoard, renderGraph } = require('./svg');
const { toMermaid, toDot } = require('./export');
const { BUILDERS } = require('./system');

const KINDS = ['eventmodel', 'context', 'containers', 'dataflow', 'deployment', 'contextmap'];
const FORMATS = { svg: 'svg', mermaid: 'mmd', dot: 'dot' };

/* Returns the diagram as text. Throws an Error with .code NO_REGIONS or NO_CONTEXTS when there is nothing to draw. */
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

module.exports = { KINDS, FORMATS, render };
