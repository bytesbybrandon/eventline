'use strict';

/* Mermaid and Graphviz DOT from the generic graph form. */

const SHAPES = {
  actor: { dot: 'ellipse', fill: '#e9eef7' },
  external: { dot: 'ellipse', fill: '#ffffff', style: 'dashed' },
  command: { dot: 'box', fill: '#ffffff' },
  process: { dot: 'box', fill: '#ffffff' },
  event: { dot: 'box', fill: '#ffd400' },
  view: { dot: 'box', fill: '#e9eef7' },
  store: { dot: 'cylinder', fill: '#e9eef7' },
  cache: { dot: 'box', fill: '#e9eef7' },
  policy: { dot: 'box', fill: '#ffffff', style: 'dashed,rounded' },
  worker: { dot: 'box', fill: '#ffffff', style: 'dashed,rounded' },
  system: { dot: 'box', fill: '#ffd400' },
};

const ids = (graph) => new Map(graph.nodes.map((n, i) => [n.id, `n${i}`]));
const q = (s) => String(s).replace(/"/g, '#quot;');

function toMermaid(graph) {
  const id = ids(graph);
  const lines = [`flowchart ${graph.direction || 'LR'}`];
  const inGroup = new Set((graph.groups || []).flatMap((g) => g.members));
  const decl = (n, pad) => `${pad}${id.get(n.id)}["${q(n.label)}${n.sub ? `<br/><i>${q(n.sub)}</i>` : ''}"]`;
  for (const n of graph.nodes) if (!inGroup.has(n.id)) lines.push(decl(n, '  '));
  (graph.groups || []).forEach((g, i) => {
    lines.push(`  subgraph g${i}["${q(g.label)}"]`);
    for (const m of g.members) { const n = graph.nodes.find((x) => x.id === m); if (n) lines.push(decl(n, '    ')); }
    lines.push('  end');
  });
  for (const e of graph.edges) {
    if (!id.has(e.from) || !id.has(e.to)) continue;
    const arrow = e.style === 'dashed' ? '-.->' : '-->';
    lines.push(`  ${id.get(e.from)} ${arrow}${e.label ? `|"${q(e.label)}"|` : ''} ${id.get(e.to)}`);
  }
  const kinds = [...new Set(graph.nodes.map((n) => n.kind))];
  for (const k of kinds) {
    const s = SHAPES[k] || SHAPES.actor;
    lines.push(`  classDef ${k} fill:${s.fill},stroke:#0a0e1a,color:#0a0e1a${s.style && s.style.includes('dashed') ? ',stroke-dasharray:5 3' : ''}`);
    lines.push(`  class ${graph.nodes.filter((n) => n.kind === k).map((n) => id.get(n.id)).join(',')} ${k}`);
  }
  return lines.join('\n') + '\n';
}

function toDot(graph) {
  const id = ids(graph);
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = ['digraph eventline {', `  label="${esc(graph.title)}"; labelloc=t; fontname="Helvetica";`, `  rankdir=${graph.direction || 'LR'};`, '  node [fontname="Courier" fontsize=11];', '  edge [fontname="Helvetica" fontsize=9];'];
  const inGroup = new Set((graph.groups || []).flatMap((g) => g.members));
  const decl = (n, pad) => {
    const s = SHAPES[n.kind] || SHAPES.actor;
    const style = `filled${s.style ? ',' + s.style : ''}`;
    return `${pad}${id.get(n.id)} [label="${esc(n.label)}${n.sub ? `\\n${esc(n.sub)}` : ''}" shape=${s.dot} style="${style}" fillcolor="${s.fill}"];`;
  };
  for (const n of graph.nodes) if (!inGroup.has(n.id)) lines.push(decl(n, '  '));
  (graph.groups || []).forEach((g, i) => {
    lines.push(`  subgraph cluster_${i} { label="${esc(g.label)}"; style=dashed;`);
    for (const m of g.members) { const n = graph.nodes.find((x) => x.id === m); if (n) lines.push(decl(n, '    ')); }
    lines.push('  }');
  });
  for (const e of graph.edges) {
    if (!id.has(e.from) || !id.has(e.to)) continue;
    const attrs = [e.label ? `label="${esc(e.label)}"` : '', e.style === 'dashed' ? 'style=dashed' : ''].filter(Boolean).join(' ');
    lines.push(`  ${id.get(e.from)} -> ${id.get(e.to)}${attrs ? ` [${attrs}]` : ''};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

module.exports = { toMermaid, toDot };
