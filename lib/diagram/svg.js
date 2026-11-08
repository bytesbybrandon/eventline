'use strict';

const { layering } = require('./layout');
const { LANES } = require('./board');

/*
 * Dependency-free SVG output. Two renderers:
 *   renderBoard  the Event Modeling swimlane board
 *   renderGraph  a layered left-to-right graph, for the system diagrams
 * Text is monospace so box widths can be computed without a browser.
 */

const THEMES = {
  light: { bg: '#ffffff', ink: '#0a0e1a', soft: '#465170', line: '#7d87a3', band: '#f4f6fb', accent: '#ffd400', accentInk: '#0a0e1a', surface: '#e9eef7' },
  dark: { bg: '#0a0e1a', ink: '#f3f5fa', soft: '#c2cadd', line: '#8892ad', band: '#0f1630', accent: '#ffd400', accentInk: '#0a0e1a', surface: '#17244a' },
};
const MONO = "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const CW = 7.3; // monospace advance at 12px

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (n) => Math.round(n * 10) / 10;
const textW = (s, size = 12) => s.length * CW * (size / 12);

function nodeSize(n, minW = 96) {
  const w = Math.max(minW, textW(n.label) + 28, n.sub ? textW(n.sub, 10) * 0.9 + 28 : 0);
  return { w: Math.ceil(w), h: n.sub ? 50 : 40 };
}

/* One shape per kind. Shape and outline carry the meaning, colour only reinforces it. */
function shape(n, g, t) {
  const { x, y, w, h } = g;
  const dashed = n.declared === false || n.assumed || n.planned ? ' stroke-dasharray="5 3"' : '';
  const onAccent = n.kind === 'system' || (n.kind === 'event' && !n.assumed);
  const label = `<text x="${n1(x + w / 2)}" y="${n1(y + (n.sub ? h / 2 - 4 : h / 2 + 4))}" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="${n.kind === 'event' ? 600 : 500}" fill="${onAccent ? t.accentInk : t.ink}">${esc(n.label)}</text>`;
  const sub = n.sub ? `<text x="${n1(x + w / 2)}" y="${n1(y + h / 2 + 12)}" text-anchor="middle" font-family="${SANS}" font-size="10" fill="${onAccent ? t.accentInk : t.soft}">${esc(n.sub)}</text>` : '';
  let body;
  switch (n.kind) {
    case 'event':
      body = n.assumed
        ? `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="6" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5" stroke-dasharray="5 3"/>`
        : `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="6" fill="${t.accent}" stroke="${t.ink}" stroke-width="1"/>`;
      break;
    case 'command':
    case 'process':
      body = `<rect x="${n1(x + 3)}" y="${n1(y + 3)}" width="${w}" height="${h}" rx="6" fill="none" stroke="${t.line}" stroke-width="1"/><rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="6" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5"${dashed}/>`;
      break;
    case 'view':
    case 'store':
    case 'cache':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="6" fill="${t.surface}" stroke="${t.ink}" stroke-width="1.5"${dashed}/><line x1="${n1(x + 4)}" y1="${n1(y + h - 5)}" x2="${n1(x + w - 4)}" y2="${n1(y + h - 5)}" stroke="${t.ink}" stroke-width="1"/>`;
      break;
    case 'policy':
    case 'worker':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5" stroke-dasharray="5 3"/>`;
      break;
    case 'timer':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5" stroke-dasharray="1 3"/>`;
      break;
    case 'external':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5" stroke-dasharray="2 3"/>`;
      break;
    case 'system':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="10" fill="${t.accent}" stroke="${t.ink}" stroke-width="2.5"/>`;
      break;
    default: // actor and anything else
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.surface}" stroke="${t.ink}" stroke-width="1.5"/>`;
  }
  return body + label + sub;
}

function defs(t) {
  return `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${t.line}"/></marker></defs>`;
}

function edgePath(a, b, back, bump = 0) {
  if (back) {
    const sx = a.x + a.w / 2;
    const tx = b.x + b.w / 2;
    const sy = a.y + a.h;
    const ty = b.y + b.h;
    const d = 44 + bump;
    return { d: `M${n1(sx)} ${n1(sy)} C${n1(sx)} ${n1(sy + d)} ${n1(tx)} ${n1(ty + d)} ${n1(tx)} ${n1(ty)}`, mx: (sx + tx) / 2, my: (sy + ty) / 2 + d * 0.75 };
  }
  if (b.x > a.x + a.w - 1) {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const dx = Math.max(24, (x2 - x1) / 2);
    return { d: `M${n1(x1)} ${n1(y1)} C${n1(x1 + dx)} ${n1(y1)} ${n1(x2 - dx)} ${n1(y2)} ${n1(x2)} ${n1(y2)}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  }
  // same column: connect top and bottom
  const down = b.y > a.y;
  const x1 = a.x + a.w / 2;
  const x2 = b.x + b.w / 2;
  const y1 = down ? a.y + a.h : a.y;
  const y2 = down ? b.y : b.y + b.h;
  return { d: `M${n1(x1)} ${n1(y1)} C${n1(x1)} ${n1((y1 + y2) / 2)} ${n1(x2)} ${n1((y1 + y2) / 2)} ${n1(x2)} ${n1(y2)}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

function edgeSvg(e, p, t) {
  const dash = e.style === 'dashed' ? ' stroke-dasharray="5 4"' : '';
  const path = `<path d="${p.d}" fill="none" stroke="${t.line}" stroke-width="1.4"${dash} marker-end="url(#arr)"/>`;
  const label = e.label
    ? `<text x="${n1(p.mx)}" y="${n1(p.my - 4)}" text-anchor="middle" font-family="${SANS}" font-size="10" fill="${t.soft}" stroke="${t.bg}" stroke-width="3" paint-order="stroke">${esc(e.label)}</text>`
    : '';
  return path + label;
}

function wrap(width, height, title, desc, t, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" width="${Math.ceil(width)}" height="${Math.ceil(height)}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<rect width="100%" height="100%" fill="${t.bg}"/>
${defs(t)}
${inner}
</svg>
`;
}

function renderBoard(board, opts = {}) {
  const t = THEMES[opts.theme] || THEMES.light;
  const M = 28;
  const LABEL_W = 84;
  const GAP = 48;
  const TOP = 56;
  const ROW_H = 78;

  const size = new Map(board.nodes.map((n) => [n.id, nodeSize(n)]));
  const colW = Array(board.cols).fill(0);
  for (const n of board.nodes) colW[n.col] = Math.max(colW[n.col], (n.indent || 0) + size.get(n.id).w, ...(n.notes || []).map((t) => textW(t, 9.5)));
  const colX = [];
  let x = M + LABEL_W + 16;
  for (let c = 0; c < board.cols; c++) { colX.push(x); x += colW[c] + GAP; }
  const width = x - GAP + M;
  const rowsIn = Object.fromEntries(LANES.map((l) => [l, 1]));
  for (const n of board.nodes) rowsIn[n.lane] = Math.max(rowsIn[n.lane], n.row + 1);
  const laneH = (l) => 30 + rowsIn[l] * ROW_H;
  const laneTop = {};
  let ty = TOP;
  for (const l of LANES) { laneTop[l] = ty; ty += laneH(l); }
  const lanesTop = (l) => laneTop[l];
  const height = ty + 52;

  const geo = new Map();
  for (const n of board.nodes) {
    const s = size.get(n.id);
    geo.set(n.id, { x: colX[n.col] + (n.indent || 0), y: lanesTop(n.lane) + 14 + n.row * ROW_H, w: s.w, h: s.h });
  }

  let inner = '';
  inner += `<text x="${M}" y="30" font-family="${SANS}" font-size="16" font-weight="700" fill="${t.ink}">${esc(board.title)} · event model</text>`;
  LANES.forEach((lane, i) => {
    const y = lanesTop(lane);
    if (i % 2 === 0) inner += `<rect x="${M}" y="${y}" width="${n1(width - 2 * M)}" height="${laneH(lane)}" fill="${t.band}"/>`;
    inner += `<text x="${M + 10}" y="${y + laneH(lane) / 2 + 4}" font-family="${MONO}" font-size="10" letter-spacing="1" fill="${t.soft}">${lane.toUpperCase()}</text>`;
  });

  board.groups.forEach((g, i) => {
    const boxes = g.members.map((id) => geo.get(id)).filter(Boolean);
    if (!boxes.length) return;
    const pad = 9 + i * 5;
    const x1 = Math.min(...boxes.map((b) => b.x)) - pad;
    const y1 = Math.min(...boxes.map((b) => b.y)) - pad;
    const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
    const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
    inner += `<rect x="${n1(x1)}" y="${n1(y1)}" width="${n1(x2 - x1)}" height="${n1(y2 - y1)}" rx="10" fill="${t.accent}" fill-opacity="0.12" stroke="${t.ink}" stroke-width="1.3" stroke-dasharray="7 4"/>`;
    inner += `<text x="${n1(x1 + 8)}" y="${n1(y1 - 5)}" font-family="${MONO}" font-size="10.5" font-weight="700" fill="${t.ink}" stroke="${t.bg}" stroke-width="3" paint-order="stroke">${esc(g.label)}${g.sub ? ` · ${esc(g.sub)}` : ''}</text>`;
  });

  let bump = 0;
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  for (const e of board.edges) {
    const a = geo.get(e.from);
    const b = geo.get(e.to);
    let seg;
    if (e.kind === 'tree') {
      const sx = a.x + 12;
      seg = `<path d="M${n1(sx)} ${n1(a.y + a.h)} V${n1(b.y + b.h / 2)} H${n1(b.x)}" fill="none" stroke="${t.line}" stroke-width="1.4" marker-end="url(#arr)"/>`;
    } else if (e.kind === 'reads') {
      const toLeft = a.x + a.w / 2 < b.x;
      const ex = toLeft ? b.x : b.x + b.w;
      const ey = b.y + b.h / 2;
      const vx = a.x + a.w / 2;
      seg = `<path d="M${n1(vx)} ${n1(a.y)} V${n1(ey)} H${n1(ex)}" fill="none" stroke="${t.line}" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#arr)"/>`;
      if (e.label) seg += `<text x="${n1(vx + 4)}" y="${n1(ey - 5)}" font-family="${SANS}" font-size="10" fill="${t.soft}" stroke="${t.bg}" stroke-width="3" paint-order="stroke">${esc(e.label)}</text>`;
    } else {
      const back = byId.get(e.to).col < byId.get(e.from).col;
      seg = edgeSvg({ label: e.label, style: e.kind === 'given' || e.kind === 'reads' ? 'dashed' : 'solid' }, edgePath(a, b, back, back ? (bump += 6) : 0), t);
    }
    inner += `<g class="ed" data-from="${esc(e.from)}" data-to="${esc(e.to)}">${seg}</g>`;
  }
  for (const n of board.nodes) {
    const g = geo.get(n.id);
    const tip = n.fullNotes && n.fullNotes.length ? `<title>${esc(n.fullNotes.join(' | '))}</title>` : '';
    inner += `<g class="nd" data-id="${esc(n.id)}" data-kind="${esc(n.kind)}" data-label="${esc(n.label)}">${tip}${shape(n, g, t)}</g>`;
    (n.notes || []).forEach((line, i) => { inner += `<text x="${n1(g.x)}" y="${n1(g.y + g.h + 12 + i * 11)}" font-family="${SANS}" font-size="9.5" fill="${t.soft}">${esc(line)}</text>`; });
  }

  const ly = ty + 26;
  const legend = [
    ['command', 'command'], ['event', 'event'], ['view', 'view'], ['policy', 'policy / worker'], ['assumed', 'assumed event (nobody emits it)'],
  ];
  let lx = M;
  for (const [kind, text] of legend) {
    const n = kind === 'assumed' ? { kind: 'event', assumed: true, label: '' } : { kind, label: '' };
    inner += shape(n, { x: lx, y: ly - 9, w: 26, h: 16 }, t);
    inner += `<text x="${lx + 34}" y="${ly + 3}" font-family="${SANS}" font-size="11" fill="${t.soft}">${esc(text)}</text>`;
    lx += 34 + textW(text, 11) * 0.88 + 26;
  }
  inner += `<text x="${lx}" y="${ly + 3}" font-family="${SANS}" font-size="11" fill="${t.soft}">dashed arrow = fact or view the command reads</text>`;

  const counts = ['command', 'event', 'view', 'policy'].map((k) => `${board.nodes.filter((n) => n.lane === k).length} ${k}`).join(', ');
  return wrap(Math.max(width, lx + 330), height, `${board.title} event model`, `Event Modeling board with lanes for actor, command, event, view and policy. ${counts} nodes, ${board.edges.length} links, ${board.groups.length} consistency boundaries.`, t, inner);
}

/* Places nodes in layers, left to right. Coordinates start at 0,0.
   A node outside every group but inside a group's layer span would be swallowed by the
   dashed box, so it moves past the group (if the group feeds it) or before it. */
function layoutLayered(nodes, edges, groups) {
  const LGAP = 150;
  const VGAP = 26;
  const GAP_GROUP = 44;
  const size = new Map(nodes.map((n) => [n.id, nodeSize(n, 110)]));
  const groupOf = new Map();
  groups.forEach((g, i) => g.members.forEach((id) => groupOf.set(id, i)));
  const gi = (id) => (groupOf.has(id) ? groupOf.get(id) : -1);

  const { col, back, preds, succs } = layering(nodes.map((n) => n.id), edges);
  groups.forEach((g) => {
    const cols = g.members.map((id) => col.get(id)).filter((c) => c !== undefined);
    if (!cols.length) return;
    const lo = Math.min(...cols);
    const hi = Math.max(...cols);
    const right = Math.max(...col.values()) + 1;
    let usedRight = false;
    for (const n of nodes) {
      const c = col.get(n.id);
      if (gi(n.id) !== -1 || c < lo || c > hi) continue;
      if (preds.get(n.id).some((p) => g.members.includes(p))) { col.set(n.id, right); usedRight = true; } else col.set(n.id, 0);
    }
    return usedRight;
  });

  const rightmost = (skipSide) => Math.max(0, ...nodes.filter((n) => !skipSide || n.side !== 'right').map((n) => col.get(n.id)));
  for (const n of nodes) if (n.side === 'right') col.set(n.id, rightmost(true) + 1);
  const layerCount = Math.max(...col.values()) + 1;
  const layers = Array.from({ length: layerCount }, () => []);
  nodes.forEach((n) => layers[col.get(n.id)].push(n.id));

  const pos = new Map();
  const reindex = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  reindex();
  const bary = (id, nbrs) => {
    const ps = nbrs.get(id).filter((p) => pos.has(p));
    return ps.length ? ps.reduce((s, p) => s + pos.get(p), 0) / ps.length : pos.get(id);
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let l = 1; l < layerCount; l++) { layers[l].sort((a, b) => gi(a) - gi(b) || bary(a, preds) - bary(b, preds)); reindex(); }
    for (let l = layerCount - 2; l >= 0; l--) { layers[l].sort((a, b) => gi(a) - gi(b) || bary(a, succs) - bary(b, succs)); reindex(); }
  }

  const layerW = layers.map((l) => Math.max(0, ...l.map((id) => size.get(id).w)));
  const layerH = layers.map((l) => l.reduce((s, id, i) => s + size.get(id).h + (i ? VGAP + (gi(l[i - 1]) !== gi(id) ? GAP_GROUP : 0) : 0), 0));
  const maxH = Math.max(0, ...layerH);
  const geo = new Map();
  let x = 0;
  layers.forEach((l, li) => {
    let y = (maxH - layerH[li]) / 2;
    l.forEach((id, i) => {
      const s = size.get(id);
      if (i) y += VGAP + (gi(l[i - 1]) !== gi(id) ? GAP_GROUP : 0);
      geo.set(id, { x: x + (layerW[li] - s.w) / 2, y, w: s.w, h: s.h });
      y += s.h;
    });
    x += layerW[li] + LGAP;
  });
  return { geo, back, width: x - LGAP, height: maxH };
}

/* Layered left-to-right graph. Groups are dashed boxes; with graph.stack each group is
   laid out on its own and the groups are stacked top to bottom (regions). */
function renderGraph(graph, opts = {}) {
  const t = THEMES[opts.theme] || THEMES.light;
  const M = 28;
  const nodes = graph.nodes;
  const groups = graph.groups || [];
  const GROUP_PAD_TOP = 34;
  const GROUP_PAD_BOTTOM = 18;
  const geo = new Map();
  const back = new Set();
  let width = 0;
  let height = 0;

  if (graph.stack) {
    let y = 0;
    for (const g of groups) {
      const set = new Set(g.members);
      const sub = layoutLayered(nodes.filter((n) => set.has(n.id)), graph.edges.filter((e) => set.has(e.from) && set.has(e.to)), []);
      for (const [id, r] of sub.geo) geo.set(id, { ...r, y: r.y + y + GROUP_PAD_TOP });
      sub.back.forEach((k) => back.add(k));
      width = Math.max(width, sub.width);
      y += GROUP_PAD_TOP + sub.height + GROUP_PAD_BOTTOM + 28;
    }
    height = y;
  } else {
    const l = layoutLayered(nodes, graph.edges, groups);
    l.geo.forEach((r, id) => geo.set(id, r));
    l.back.forEach((k) => back.add(k));
    width = l.width;
    height = l.height + GROUP_PAD_TOP;
  }
  const dx = M + 28;
  const dy = 96;
  for (const [id, r] of geo) geo.set(id, { ...r, x: r.x + dx, y: r.y + dy });

  let inner = `<text x="${M}" y="32" font-family="${SANS}" font-size="16" font-weight="700" fill="${t.ink}">${esc(graph.title)}</text>`;
  if (graph.subtitle) inner += `<text x="${M}" y="50" font-family="${SANS}" font-size="11" fill="${t.soft}">${esc(graph.subtitle)}</text>`;

  groups.forEach((g) => {
    const boxes = g.members.map((id) => geo.get(id)).filter(Boolean);
    if (!boxes.length) return;
    const x1 = Math.min(...boxes.map((b) => b.x)) - 20;
    const y1 = Math.min(...boxes.map((b) => b.y)) - GROUP_PAD_TOP;
    const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + 20;
    const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + GROUP_PAD_BOTTOM;
    inner += `<rect x="${n1(x1)}" y="${n1(y1)}" width="${n1(x2 - x1)}" height="${n1(y2 - y1)}" rx="12" fill="${t.band}" stroke="${t.line}" stroke-width="1.3" stroke-dasharray="7 4"/>`;
    inner += `<text x="${n1(x1 + 12)}" y="${n1(y1 + 20)}" font-family="${SANS}" font-size="12" font-weight="700" fill="${t.ink}">${esc(g.label)}</text>`;
  });

  let bump = 0;
  for (const e of graph.edges) {
    if (!geo.has(e.from) || !geo.has(e.to)) continue;
    const isBack = back.has(`${e.from}>${e.to}`);
    inner += edgeSvg(e, edgePath(geo.get(e.from), geo.get(e.to), isBack, isBack ? (bump += 6) : 0), t);
  }
  for (const n of nodes) inner += shape(n, geo.get(n.id), t);

  const w = Math.max(dx + width + M + 28, M + (graph.subtitle ? textW(graph.subtitle, 11) * 0.82 : 0) + M);
  const h = dy + height + 60;
  return wrap(w, h, graph.title, graph.desc || `${graph.title}: ${nodes.length} elements, ${graph.edges.length} flows.`, t, inner);
}

module.exports = { renderBoard, renderGraph, THEMES };
