'use strict';

const { buildBoard, boardToGraph } = require('./board');
const { renderBoard, renderGraph } = require('./svg');
const { toMermaid, toDot } = require('./export');
const { BUILDERS } = require('./system');
const { KINDS, FORMATS } = require('./kinds');
const { linkMap, sourceRanges } = require('./links');

/* The boxes of this diagram that lead somewhere: { boxId: [ { href, title } ] }. */
function resolveLinks(model, kind, format, opts) {
  const base = opts.linkBase || '';
  const href = opts.href || ((t) => t.url || `${base}${t.diagram}.${FORMATS[format]}${t.node ? `#${encodeURIComponent(t.node).replace(/%3A/g, ':')}` : ''}`);
  const out = new Map();
  for (const [id, targets] of Object.entries(linkMap(model)[kind] || {})) out.set(id, targets.map((t) => ({ href: href(t), title: `Open ${t.label}`, target: t })));
  return out;
}

/* Returns the diagram as text. Throws an Error with .code NO_REGIONS or NO_CONTEXTS when there is nothing to draw.
   opts.links turns on links between diagrams: each box that leads somewhere becomes a link, to <diagram>.<ext>#<box>
   beside the file (opts.linkBase prefixes that, opts.href replaces how a target becomes an address). */
/**
 * Renders one diagram in one format.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(Build + Draw) for the chosen kind; with opts.links add a linkMap (all six diagrams); a system diagram SVG adds a sourceRanges (all six diagrams again) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 13 measured; target <= 8, over budget
 * - Branch Coverage: 95% measured; target >= 90%
 * - CRAP Score: 13.0 measured; threshold <= 10, over budget
 * - Caching: none; the links and ranges inventories are rebuilt per call
 */
function render(model, kind, format = 'svg', theme = 'light', opts = {}) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown diagram "${kind}". Choose one of: ${KINDS.join(', ')}`);
  if (!FORMATS[format]) throw new Error(`Unknown format "${format}". Choose one of: ${Object.keys(FORMATS).join(', ')}`);
  const diagram = kind === 'eventmodel' ? buildBoard(model) : BUILDERS[kind](model);
  const links = opts.links ? resolveLinks(model, kind, format, opts) : null;
  if (format === 'svg') return (kind === 'eventmodel' ? renderBoard : renderGraph)(diagram, { theme, links, ranges: kind === 'eventmodel' ? null : sourceRanges(model, kind) });
  const graph = kind === 'eventmodel' ? boardToGraph(diagram) : diagram;
  return (format === 'mermaid' ? toMermaid : toDot)(graph, links);
}

module.exports = { KINDS, FORMATS, render };
