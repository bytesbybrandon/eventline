'use strict';

/*
 * Links between the diagrams of one model.
 *
 * Each diagram names its boxes its own way, but they share a vocabulary: cmd:Name, view:Name,
 * worker:Name (pol:Name on the board, or policy:Name for a named policy), actor:slug. So a box can lead to the same thing seen from
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
const Model = require('../model');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const SKIPPED = new Set(['NO_REGIONS', 'NO_CONTEXTS']);

/**
 * The box and group ids of one diagram, or null when the model cannot draw it yet (no regions, no contexts).
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: the cost of building that one diagram (derived by reading the code)
 * - Cyclomatic Complexity (CC): 5 measured; target <= 8
 * - Branch Coverage: 85.7% measured; target >= 90%, below target (the rethrow is reached only by a builder bug)
 * - CRAP Score: 5.1 measured; threshold <= 10
 * - Caching: none
 */
function entryOf(model, kind) {
  try {
    const g = kind === 'eventmodel' ? buildBoard(model) : BUILDERS[kind](model);
    return { labels: new Map([...g.nodes, ...(g.groups || [])].map((n) => [n.id, n.label])), kinds: new Map(g.nodes.map((n) => [n.id, n.kind])) };
  } catch (err) {
    if (!SKIPPED.has(err.code)) throw err;
    return null;
  }
}

/**
 * Every box and group id of every diagram the model can draw.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(B + C + D + X + Y + K) where B = buildBoard, C = context, D = containers, X = dataflow, Y = deployment, K = contextMap costs; dominated by deployment (derived by reading the code)
 * - Cyclomatic Complexity (CC): 3 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 3.0 measured; threshold <= 10
 * - Caching: none; linkMap and sourceRanges each rebuild it (twice in one system diagram SVG render with links)
 */
function inventory(model) {
  const out = {};
  for (const kind of KINDS) {
    const entry = entryOf(model, kind);
    if (entry) out[kind] = entry;
  }
  return out;
}

/* The board box a worker is drawn in: its named policy's, else its own. */
const boardBoxes = (model, w) => {
  const named = model.policies.filter((p) => p.name && p.rules.some((r) => r.worker === w)).map((p) => `policy:${p.name}`);
  const own = model.policies.some((p) => !p.name && p.rules.some((r) => r.worker === w));
  return own || !named.length ? [...named, `pol:${w}`] : named;
};
const workersOf = (p) => [...new Set(p.rules.map((r) => r.worker).filter(Boolean))];

/* What each box leads to by default: [diagram, boxId?] pairs, most useful first. */
/**
 * The default links of one box.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(p·r) for worker and policy boxes, O(c + v) for context-map boxes, O(1) otherwise, where p = policies, r = rules per policy, c = commands, v = read models (derived by reading the code)
 * - Cyclomatic Complexity (CC): 35 measured; target <= 8, over the hard ceiling of 30
 * - Branch Coverage: 93% measured; target >= 90%
 * - CRAP Score: 35.5 measured; threshold <= 10, over the hard ceiling of 30
 * - Caching: none
 */
function derive(model, inv, kind, id) {
  const r = [];
  const worker = (prefix) => id.slice(prefix.length);
  const onBoard = () => boardBoxes(model, worker('worker:')).map((b) => ['eventmodel', b]);
  switch (kind) {
    case 'context':
      r.push(['containers', id]);
      break;
    case 'containers':
      if (id === 'sys' || /^(actor|ext):/.test(id)) r.push(['context', id]);
      else if (id === 'api') r.push(['eventmodel']);
      else if (id === 'store') r.push(['dataflow', 'log']);
      else if (id.startsWith('view:')) r.push(['dataflow', id], ['eventmodel', id]);
      else if (id.startsWith('worker:')) r.push(['dataflow', id], ...onBoard());
      break;
    case 'dataflow':
      if (id === 'log') r.push(['containers', 'store']);
      else if (/^(actor|ext):/.test(id)) r.push(['context', id]);
      else if (id.startsWith('cmd:')) r.push(['eventmodel', id]);
      else if (id.startsWith('view:')) r.push(['eventmodel', id], ['containers', id]);
      else if (id.startsWith('worker:')) r.push(...onBoard(), ['containers', id]);
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
      else if (id.startsWith('policy:')) {
        const ws = workersOf(model.policies.find((p) => p.name === id.slice(7))).map((w) => `worker:${w}`);
        r.push(...ws.map((w) => ['containers', w]), ...ws.map((w) => ['dataflow', w]));
      }
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
/**
 * Every element that can carry @link, with its boxes per diagram.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c + v·Nd + p·w·Nd + b·Nd) where Nd = deployment boxes (each view, worker and boundary filters them all), w = workers per policy; budget O(c + v + p + b + Nd) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 7 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 7.0 measured; threshold <= 10
 * - Caching: none
 */
function elements(model, inv) {
  const out = [];
  const ids = (kind, test) => (inv[kind] ? [...inv[kind].labels.keys()].filter(test) : []);
  for (const c of model.commands) out.push({ what: `command ${c.name}`, line: c.line, ranges: [[c.line, c.endLine]], links: linksOf(c.annotations), boxes: { eventmodel: [`cmd:${c.name}`], dataflow: [`cmd:${c.name}`] } });
  for (const v of model.views) {
    out.push({ what: `read model ${v.name}`, line: v.line, ranges: [[v.line, v.endLine]], links: linksOf(v.annotations), boxes: { eventmodel: [`view:${v.name}`], containers: [`view:${v.name}`], dataflow: [`view:${v.name}`], deployment: ids('deployment', (id) => id.endsWith(`:view:${v.name}`)) } });
  }
  for (const p of model.policies) {
    const names = workersOf(p);
    out.push({ what: `policy ${p.name || Model.policyLabel(p)}`, line: p.line, ranges: [[p.line, p.endLine]], links: linksOf(p.annotations), boxes: {
      eventmodel: p.name ? [`policy:${p.name}`] : names.map((w) => `pol:${w}`), containers: names.map((w) => `worker:${w}`), dataflow: names.map((w) => `worker:${w}`),
      deployment: names.flatMap((w) => ids('deployment', (id) => id.endsWith(`:worker:${w}`))),
    } });
  }
  for (const b of model.boundaries) out.push({ what: `boundary ${b.name}`, line: b.line, ranges: [[b.line, b.line]], links: linksOf(b.annotations), boxes: { eventmodel: [`bnd:${b.name}`], deployment: ids('deployment', (id) => id.endsWith(`:shard:${b.name}`)) } });
  return out;
}

const targetOf = (link) => ({ diagram: link.to || null, node: link.node || null, url: link.url || null, label: link.label || null });

/**
 * The links every box of every diagram leads to.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(I + ΣN·(p·r) + elements) where I = inventory cost, N = boxes per diagram, p·r = policy rules scanned per worker box (derived by reading the code)
 * - Cyclomatic Complexity (CC): 10 measured; target <= 8, over budget
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 10.0 measured; threshold <= 10
 * - Largest nested function: CC 11 measured (branch cov 100%, CRAP 11.0), `const resolve = (from, fromId, t) =>`
 * - Caching: none
 */
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
/**
 * Which source lines each box of a diagram stands for.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(I + elements) where I = inventory cost; each box appends with a spread, O(r²) for a box with r ranges (derived by reading the code)
 * - Cyclomatic Complexity (CC): 6 measured; target <= 8
 * - Branch Coverage: 83% measured; target >= 90%
 * - CRAP Score: 6.2 measured; threshold <= 10
 * - Caching: none
 */
function sourceRanges(model, kind) {
  const inv = inventory(model);
  const out = new Map();
  if (!inv[kind]) return out;
  for (const el of elements(model, inv)) {
    for (const id of el.boxes[kind] || []) out.set(id, [...(out.get(id) || []), ...el.ranges]);
  }
  return out;
}

/* Every element that carries @link, as check() names it; no diagram is built. */
const linkables = (model) => [
  ...model.commands.map((c) => ({ what: `command ${c.name}`, line: c.line, links: linksOf(c.annotations) })),
  ...model.views.map((v) => ({ what: `read model ${v.name}`, line: v.line, links: linksOf(v.annotations) })),
  ...model.policies.map((p) => ({ what: `policy ${p.name || Model.policyLabel(p)}`, line: p.line, links: linksOf(p.annotations) })),
  ...model.boundaries.map((b) => ({ what: `boundary ${b.name}`, line: b.line, links: linksOf(b.annotations) })),
].filter((el) => el.links.length);

const urlProblem = (url) => (/^(https?:|\/|\.\.?\/|#)/.test(url) ? null : ['link-url', ` with url "${url}". Use an http(s) address or a path.`]);

/**
 * What is wrong with one @link target, as [rule, rest of the message], or null. entry(kind) gives a diagram's boxes on demand.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(1) plus the first entry(kind) for a diagram (derived by reading the code)
 * - Cyclomatic Complexity (CC): 7 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 7.0 measured; threshold <= 10
 * - Caching: none
 */
function linkProblem(t, entry) {
  if (t.url) return urlProblem(t.url);
  if (!t.diagram) return ['link-target', ' with neither to="..." nor url="...".'];
  if (!KINDS.includes(t.diagram)) return ['link-target', ` to "${t.diagram}", which is not a diagram. Choose one of: ${KINDS.join(', ')}.`];
  const e = entry(t.diagram);
  if (!e) return ['link-target', ` to the ${NAMES[t.diagram]}, which this model cannot draw yet.`];
  if (t.node && !e.labels.has(t.node)) return ['link-target', ` to "${t.node}", which is not a box on the ${NAMES[t.diagram]}.`];
  return null;
}

/**
 * Problems with the @link annotations: what check() reports.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c + v + p + b + l) with no @link to a diagram, where l = @link annotations; plus one build of each diagram an @link names (derived by reading the code)
 * - Cyclomatic Complexity (CC): 4 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 4.0 measured; threshold <= 10
 * - Caching: each named diagram is built at most once per call
 */
function linkIssues(model) {
  const entries = new Map();
  const entry = (kind) => {
    if (!entries.has(kind)) entries.set(kind, entryOf(model, kind));
    return entries.get(kind);
  };
  const issues = [];
  for (const el of linkables(model)) {
    for (const l of el.links) {
      const problem = linkProblem(targetOf(l), entry);
      if (problem) issues.push({ severity: 'warn', rule: problem[0], message: `${el.what} has an @link${problem[1]}`, line: el.line });
    }
  }
  return issues;
}

module.exports = { linkMap, linkIssues, sourceRanges };
