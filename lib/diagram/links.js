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

const workersOf = (p) => [...new Set(p.rules.map((r) => r.worker).filter(Boolean))];

/**
 * What the default links of one model need, built once per linkMap: the board boxes each worker is drawn in
 * (its named policies', else its own), the workers of each named policy, the first command and read model of
 * each context, and the first region.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(p·r + c + v) where p = policies, r = rules per policy, c = commands, v = read models (derived by reading the code)
 * - Cyclomatic Complexity (CC): 8 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 8.0 measured; threshold <= 10
 * - Caching: none
 */
function linkIndex(model) {
  const named = new Map();
  const own = new Set();
  const policyWorkers = new Map();
  for (const p of model.policies) {
    const ws = workersOf(p);
    if (p.name) policyWorkers.set(p.name, ws);
    for (const w of ws) {
      if (!p.name) own.add(w);
      else named.set(w, [...(named.get(w) || []), `policy:${p.name}`]);
    }
  }
  const first = (list) => { const m = new Map(); for (const x of list) if (!m.has(x.context)) m.set(x.context, x.name); return m; };
  return {
    boxesOf: (w) => { const n = named.get(w) || []; return own.has(w) || !n.length ? [...n, `pol:${w}`] : n; },
    policyWorkers,
    firstCommand: first(model.commands),
    firstView: first(model.views),
    region: model.system && model.system.regions.length ? slug(model.system.regions[0]) : null,
  };
}

/* The board boxes a worker box leads to. */
const toBoard = (ix, id) => ix.boxesOf(id.slice('worker:'.length)).map((b) => ['eventmodel', b]);

/**
 * Default links of a containers box.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(1) plus the worker's board boxes (derived by reading the code)
 * - Cyclomatic Complexity (CC): 7 measured; target <= 8
 * - Branch Coverage: 92.3% measured; target >= 90%
 * - CRAP Score: 7.0 measured; threshold <= 10
 * - Caching: none
 */
function fromContainers(ix, inv, id) {
  if (id === 'sys' || /^(actor|ext):/.test(id)) return [['context', id]];
  if (id === 'api') return [['eventmodel']];
  if (id === 'store') return [['dataflow', 'log']];
  if (id.startsWith('view:')) return [['dataflow', id], ['eventmodel', id]];
  if (id.startsWith('worker:')) return [['dataflow', id], ...toBoard(ix, id)];
  return [];
}

/**
 * Default links of a data flow box.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(1) plus the worker's board boxes (derived by reading the code)
 * - Cyclomatic Complexity (CC): 6 measured; target <= 8
 * - Branch Coverage: 90.9% measured; target >= 90%
 * - CRAP Score: 6.0 measured; threshold <= 10
 * - Caching: none
 */
function fromDataflow(ix, inv, id) {
  if (id === 'log') return [['containers', 'store']];
  if (/^(actor|ext):/.test(id)) return [['context', id]];
  if (id.startsWith('cmd:')) return [['eventmodel', id]];
  if (id.startsWith('view:')) return [['eventmodel', id], ['containers', id]];
  if (id.startsWith('worker:')) return [...toBoard(ix, id), ['containers', id]];
  return [];
}

/**
 * Default links of a deployment box: a region opens the system, a shard its boundary, anything else its container.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(1) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 5 measured; target <= 8
 * - Branch Coverage: 88.9% measured; target >= 90%, below target
 * - CRAP Score: 5.0 measured; threshold <= 10
 * - Caching: none
 */
function fromDeployment(ix, inv, id) {
  if (id.startsWith('region:')) return [['containers', 'sys']];
  const m = /^[^:]+:(api|shard:.+|view:.+|worker:.+)$/.exec(id);
  if (!m) return [];
  if (m[1] === 'api') return [['containers', 'api']];
  if (m[1].startsWith('shard:')) return [['eventmodel', `bnd:${m[1].slice(6)}`]];
  return [['containers', m[1]]];
}

/* A context opens the board at its first command, else its first read model. */
const fromContextMap = (ix, inv, id) => {
  const name = id.slice(4);
  if (ix.firstCommand.has(name)) return [['eventmodel', `cmd:${ix.firstCommand.get(name)}`]];
  return ix.firstView.has(name) ? [['eventmodel', `view:${ix.firstView.get(name)}`]] : [];
};

/* Board boxes by id prefix. A board boundary opens its shard in the first region; with no regions it falls through to none. */
const BOARD_LINKS = new Map([
  ['cmd:', (ix, id) => [['dataflow', id]]],
  ['view:', (ix, id) => [['containers', id], ['dataflow', id]]],
  ['pol:', (ix, id) => [['containers', `worker:${id.slice(4)}`]]],
  ['policy:', (ix, id) => {
    const ws = ix.policyWorkers.get(id.slice(7)).map((w) => `worker:${w}`);
    return [...ws.map((w) => ['containers', w]), ...ws.map((w) => ['dataflow', w])];
  }],
  ['evt:', () => [['containers', 'store']]],
  ['bnd:', (ix, id) => (ix.region ? [['deployment', `${ix.region}:shard:${id.slice(4)}`]] : [])],
]);

/**
 * Default links of a board box: by id prefix, else an actor or external opens the system context.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(1) plus a named policy's workers (derived by reading the code)
 * - Cyclomatic Complexity (CC): 5 measured; target <= 8
 * - Branch Coverage: 87.5% measured; target >= 90%, below target
 * - CRAP Score: 5.0 measured; threshold <= 10
 * - Caching: none
 */
function fromEventModel(ix, inv, id) {
  const byPrefix = BOARD_LINKS.get(id.slice(0, id.indexOf(':') + 1));
  if (byPrefix) return byPrefix(ix, id);
  const kind = inv.eventmodel.kinds.get(id);
  const label = inv.eventmodel.labels.get(id) || '';
  if (kind === 'actor') return [['context', `actor:${slug(label)}`]];
  return kind === 'external' ? [['context', `ext:${slug(label)}`]] : [];
}

const DERIVE = {
  context: (ix, inv, id) => [['containers', id]],
  containers: fromContainers,
  dataflow: fromDataflow,
  deployment: fromDeployment,
  contextmap: fromContextMap,
  eventmodel: fromEventModel,
};

/* What each box leads to by default: [diagram, boxId?] pairs, most useful first. */
const derive = (ix, inv, kind, id) => DERIVE[kind](ix, inv, id);

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
 * - Complexity: O(I + ΣN + p·r + c + v + elements) where I = inventory cost, N = boxes per diagram, p·r = policy rules indexed once by linkIndex (derived by reading the code)
 * - Cyclomatic Complexity (CC): 10 measured; target <= 8, over budget
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 10.0 measured; threshold <= 10
 * - Largest nested function: CC 11 measured (branch cov 100%, CRAP 11.0), `const resolve = (from, fromId, t) =>`
 * - Caching: none
 */
function linkMap(model) {
  const inv = inventory(model);
  const ix = linkIndex(model);
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
      const targets = derive(ix, inv, kind, id).map(([diagram, node]) => resolve(kind, id, { diagram, node })).filter(Boolean);
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
