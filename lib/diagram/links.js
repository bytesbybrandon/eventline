'use strict';

/*
 * Links between the diagrams of one model.
 *
 * Each diagram names its boxes its own way, but they share a vocabulary: cmd:Name, view:Name,
 * worker:Name (pol:Name on the board), actor:slug. So a box can lead to the same thing seen from
 * another level: the system context opens the containers, a container opens its data flow or its
 * place on the event model board, a shard opens the boundary it holds.
 *
 * Those links are derived, so they cannot drift. An @link annotation on a command, view, policy or
 * boundary replaces the derived links of that element:
 *
 *   @link(to="containers", node="view:Orders", label="Where Orders is stored")
 *   @link(url="https://wiki.example.com/runbooks/orders")
 *
 * linkMap() returns { diagram: { boxId: [ { diagram, node, label, url } ] } }. A target that does not
 * exist in this model (no regions, no contexts, a box that is not drawn) is dropped.
 */

const { KINDS, NAMES } = require('./kinds');
const { buildBoard } = require('./board');
const { BUILDERS } = require('./system');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const SKIPPED = new Set(['NO_REGIONS', 'NO_CONTEXTS']);

/* Every box and group id of every diagram that can be drawn for this model. */
function inventory(model) {
  const out = {};
  for (const kind of KINDS) {
    try {
      const g = kind === 'eventmodel' ? buildBoard(model) : BUILDERS[kind](model);
      out[kind] = { labels: new Map([...g.nodes, ...(g.groups || [])].map((n) => [n.id, n.label])), kinds: new Map(g.nodes.map((n) => [n.id, n.kind])) };
    } catch (err) {
      if (!SKIPPED.has(err.code)) throw err;
    }
  }
  return out;
}

/* What each box leads to by default: [diagram, boxId?] pairs, most useful first. */
function derive(model, inv, kind, id) {
  const r = [];
  const worker = (prefix) => id.slice(prefix.length);
  switch (kind) {
    case 'context':
      r.push(['containers', id]);
      break;
    case 'containers':
      if (id === 'sys' || /^(actor|ext):/.test(id)) r.push(['context', id]);
      else if (id === 'api') r.push(['eventmodel']);
      else if (id === 'store') r.push(['dataflow', 'log']);
      else if (id.startsWith('view:')) r.push(['dataflow', id], ['eventmodel', id]);
      else if (id.startsWith('worker:')) r.push(['dataflow', id], ['eventmodel', `pol:${worker('worker:')}`]);
      break;
    case 'dataflow':
      if (id === 'log') r.push(['containers', 'store']);
      else if (/^(actor|ext):/.test(id)) r.push(['context', id]);
      else if (id.startsWith('cmd:')) r.push(['eventmodel', id]);
      else if (id.startsWith('view:')) r.push(['eventmodel', id], ['containers', id]);
      else if (id.startsWith('worker:')) r.push(['eventmodel', `pol:${worker('worker:')}`], ['containers', id]);
      break;
    case 'deployment': {
      if (id.startsWith('region:')) { r.push(['containers', 'sys']); break; }
      const m = /^[^:]+:(api|shard:.+|view:.+|worker:.+)$/.exec(id);
      if (!m) break;
      if (m[1] === 'api') r.push(['containers', 'api']);
      else if (m[1].startsWith('shard:')) r.push(['eventmodel', `bnd:${m[1].slice(6)}`]);
      else r.push(['containers', m[1]]);
      break;
    }
    case 'contextmap': {
      const name = id.slice(4);
      const cmd = model.commands.find((c) => c.context === name);
      const view = model.views.find((v) => v.context === name);
      if (cmd) r.push(['eventmodel', `cmd:${cmd.name}`]);
      else if (view) r.push(['eventmodel', `view:${view.name}`]);
      break;
    }
    case 'eventmodel': {
      const nodeKind = inv.eventmodel.kinds.get(id);
      const label = inv.eventmodel.labels.get(id) || '';
      if (id.startsWith('cmd:')) r.push(['dataflow', id]);
      else if (id.startsWith('view:')) r.push(['containers', id], ['dataflow', id]);
      else if (id.startsWith('pol:')) r.push(['containers', `worker:${id.slice(4)}`]);
      else if (id.startsWith('evt:')) r.push(['containers', 'store']);
      else if (id.startsWith('bnd:') && model.system && model.system.regions.length) r.push(['deployment', `${slug(model.system.regions[0])}:shard:${id.slice(4)}`]);
      else if (nodeKind === 'actor') r.push(['context', `actor:${slug(label)}`]);
      else if (nodeKind === 'external') r.push(['context', `ext:${slug(label)}`]);
      break;
    }
    default:
  }
  return r;
}

/* The @link annotations of one element, as written. */
const linksOf = (annotations) => [].concat((annotations && annotations.link) || []).filter((l) => l && typeof l === 'object');

/* Every element that can carry @link, with the boxes it appears as in each diagram. */
function elements(model, inv) {
  const out = [];
  const ids = (kind, test) => (inv[kind] ? [...inv[kind].labels.keys()].filter(test) : []);
  for (const c of model.commands) out.push({ what: `command ${c.name}`, line: c.line, ranges: [[c.line, c.endLine]], links: linksOf(c.annotations), boxes: { eventmodel: [`cmd:${c.name}`], dataflow: [`cmd:${c.name}`] } });
  for (const v of model.views) {
    out.push({ what: `view ${v.name}`, line: v.line, ranges: [[v.line, v.endLine]], links: linksOf(v.annotations), boxes: { eventmodel: [`view:${v.name}`], containers: [`view:${v.name}`], dataflow: [`view:${v.name}`], deployment: ids('deployment', (id) => id.endsWith(`:view:${v.name}`)) } });
  }
  for (const p of model.policies) {
    const names = [...new Set(p.rules.map((r) => r.worker).filter(Boolean))];
    out.push({ what: `policy ${p.trigger.event || p.trigger.schedule}`, line: p.line, ranges: [[p.line, p.endLine]], links: linksOf(p.annotations), boxes: {
      eventmodel: names.map((w) => `pol:${w}`), containers: names.map((w) => `worker:${w}`), dataflow: names.map((w) => `worker:${w}`),
      deployment: names.flatMap((w) => ids('deployment', (id) => id.endsWith(`:worker:${w}`))),
    } });
  }
  for (const b of model.boundaries) out.push({ what: `boundary ${b.name}`, line: b.line, ranges: [[b.line, b.line]], links: linksOf(b.annotations), boxes: { eventmodel: [`bnd:${b.name}`], deployment: ids('deployment', (id) => id.endsWith(`:shard:${b.name}`)) } });
  return out;
}

const targetOf = (link) => ({ diagram: link.to || null, node: link.node || null, url: link.url || null, label: link.label || null });

function linkMap(model) {
  const inv = inventory(model);
  const map = {};
  const describe = (diagram, node) => {
    const name = NAMES[diagram];
    const label = node && inv[diagram].labels.get(node);
    return label ? `${name}: ${label}` : name;
  };
  const resolve = (from, fromId, t) => {
    if (t.url) return { diagram: null, node: null, label: t.label || t.url, url: t.url };
    if (!t.diagram || !inv[t.diagram]) return null;
    if (t.node && !inv[t.diagram].labels.has(t.node)) return null;
    if (t.diagram === from && t.node === fromId) return null;
    return { diagram: t.diagram, node: t.node || null, label: t.label || describe(t.diagram, t.node), url: null };
  };
  for (const kind of Object.keys(inv)) {
    map[kind] = {};
    for (const id of inv[kind].labels.keys()) {
      const targets = derive(model, inv, kind, id).map(([diagram, node]) => resolve(kind, id, { diagram, node })).filter(Boolean);
      if (targets.length) map[kind][id] = targets;
    }
  }
  for (const el of elements(model, inv)) {
    if (!el.links.length) continue;
    for (const [kind, ids] of Object.entries(el.boxes)) {
      if (!inv[kind]) continue;
      for (const id of ids) {
        const targets = el.links.map((l) => resolve(kind, id, targetOf(l))).filter(Boolean);
        if (targets.length) map[kind][id] = targets; else delete map[kind][id];
      }
    }
  }
  return map;
}

/* Which lines of the source each box of a diagram stands for: Map of boxId to [[from, to], ...]. The board knows its own. */
function sourceRanges(model, kind) {
  const inv = inventory(model);
  const out = new Map();
  if (!inv[kind]) return out;
  for (const el of elements(model, inv)) {
    for (const id of el.boxes[kind] || []) out.set(id, [...(out.get(id) || []), ...el.ranges]);
  }
  return out;
}

/* Problems with the @link annotations a model carries: what check() reports. */
function linkIssues(model) {
  const inv = inventory(model);
  const issues = [];
  for (const el of elements(model, inv)) {
    for (const l of el.links) {
      const t = targetOf(l);
      const where = `${el.what} has an @link`;
      if (t.url) {
        if (!/^(https?:|\/|\.\.?\/|#)/.test(t.url)) issues.push({ severity: 'warn', rule: 'link-url', message: `${where} with url "${t.url}". Use an http(s) address or a path.`, line: el.line });
      } else if (!t.diagram) issues.push({ severity: 'warn', rule: 'link-target', message: `${where} with neither to="..." nor url="...".`, line: el.line });
      else if (!KINDS.includes(t.diagram)) issues.push({ severity: 'warn', rule: 'link-target', message: `${where} to "${t.diagram}", which is not a diagram. Choose one of: ${KINDS.join(', ')}.`, line: el.line });
      else if (!inv[t.diagram]) issues.push({ severity: 'warn', rule: 'link-target', message: `${where} to the ${NAMES[t.diagram]}, which this model cannot draw yet.`, line: el.line });
      else if (t.node && !inv[t.diagram].labels.has(t.node)) issues.push({ severity: 'warn', rule: 'link-target', message: `${where} to "${t.node}", which is not a box on the ${NAMES[t.diagram]}.`, line: el.line });
    }
  }
  return issues;
}

module.exports = { linkMap, linkIssues, sourceRanges };
