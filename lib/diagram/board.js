'use strict';

/*
 * Event Modeling board, derived from a model.
 *
 * Three rows, top to bottom, as on a classic Event Modeling board:
 *   ACTOR                 actors, timers, and processors (workers, named policies and unnamed automations)
 *   COMMAND · READ MODEL  commands and read models, sharing the timeline
 *   EVENT                 events
 * Time runs left to right. The model has no explicit timeline, so order comes from
 * causality: a command that reads events another command emits comes after it.
 *
 * Layout, as on a hand-drawn board:
 *   - each command owns a column; its actor sits above it
 *   - the events it emits hang beneath it as a small tree
 *   - a read model sits right of the latest event that feeds it
 *   - an event never wakes a processor directly: it feeds a read model the processor
 *     reads, either one the policy reads with from [...] or an implied one
 *   - a processor sits right of what it reads, and the command or events it
 *     produces sit right of the processor
 *   - a command's decision model (its on [...] facts) is a note, not arrows
 *
 * Slices follow the four Event Modeling patterns the README maps one to one:
 *   state change, state view, automation, translation.
 */

const Model = require('../model');

const LANES = ['actor', 'command', 'event'];
const LANE_LABELS = { actor: 'ACTOR', command: 'COMMAND · READ MODEL', event: 'EVENT' };
const clip = (s, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* "AuditScreen > Fail button": the thing someone uses, and the part of it. */
const triggerLabel = (t) => `${t.name || 'unnamed'}${t.part ? ` > ${t.part}` : ''}`;

/* An event-triggered policy needs an implied read model unless it already reads, with
   from [...], a read model fed by its trigger event. The automation-reads-event rule agrees. */
/**
 * Whether a policy needs an implied read model.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(f·(v + s)) where f = from reads, v = read models, s = sources per read model (derived by reading the code)
 * - Cyclomatic Complexity (CC): 2 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 2.0 measured; threshold <= 10
 * - Caching: none
 */
const needsImpliedReadModel = (model, pol) => !!pol.trigger.event && !pol.from.some((f) => {
  const v = model.views.find((x) => x.name === f.name);
  return v && v.sources.some((s) => s.name === pol.trigger.event);
});

/* One entry per actor+command name; a second block with the same name is a variant
   (for example a fallback path) and contributes more facts and branches. */
function commandGroups(model) {
  const groups = new Map();
  for (const cmd of model.commands) {
    const key = `${cmd.actor.toLowerCase()}>${cmd.name}`;
    if (!groups.has(key)) groups.set(key, { ranges: [], actor: cmd.actor, name: cmd.name, params: cmd.params, boundary: cmd.boundary, on: [], from: [], branches: [], notes: [], triggers: [], annotations: {}, line: cmd.line });
    const g = groups.get(key);
    g.ranges.push([cmd.line, cmd.endLine]);
    g.on.push(...cmd.on);
    g.from.push(...cmd.from);
    g.branches.push(...cmd.branches);
    g.notes.push(...(cmd.notes || []));
    g.triggers.push(...(cmd.triggers || []));
    if (!g.source && cmd.source) g.source = cmd.source;
    g.annotations = { ...g.annotations, ...(cmd.annotations || {}) };
    if (!g.boundary && cmd.boundary) g.boundary = cmd.boundary;
  }
  return [...groups.values()];
}

/* Dependency order: a command comes after the commands whose events or views it reads.
   Ties keep source order, with commands of one boundary kept together. */
function orderCommands(model, cmds) {
  const emittedBy = new Map();
  cmds.forEach((c, i) => c.branches.forEach((b) => b.emits.forEach((e) => { if (!emittedBy.has(e.event)) emittedBy.set(e.event, new Set()); emittedBy.get(e.event).add(i); })));
  const viewFeeders = new Map(model.views.map((v) => [v.name, new Set(v.sources.flatMap((s) => [...(emittedBy.get(s.name) || [])]))]));
  const deps = cmds.map((c, i) => {
    const d = new Set();
    for (const f of c.on) (emittedBy.get(f.name) || []).forEach((j) => j !== i && d.add(j));
    for (const f of c.from) (viewFeeders.get(f.name) || []).forEach((j) => j !== i && d.add(j));
    return d;
  });
  const depth = new Array(cmds.length).fill(-1);
  const walk = (i, stack) => {
    if (depth[i] >= 0) return depth[i];
    if (stack.has(i)) return 0; // a loop: ignore the edge that closes it
    stack.add(i);
    depth[i] = 1 + Math.max(-1, ...[...deps[i]].map((j) => walk(j, stack)));
    stack.delete(i);
    return depth[i];
  };
  cmds.forEach((_, i) => walk(i, new Set()));
  const bFirst = new Map();
  cmds.forEach((c, i) => { if (c.boundary && !bFirst.has(c.boundary.name)) bFirst.set(c.boundary.name, i); });
  return cmds.map((c, i) => ({ c, i })).sort((a, b) => depth[a.i] - depth[b.i] || (bFirst.get(a.c.boundary && a.c.boundary.name) ?? a.i) - (bFirst.get(b.c.boundary && b.c.boundary.name) ?? b.i) || a.i - b.i).map((x) => x.c);
}

/**
 * The board's grid: boxes by id, arrows, slices, and which lane and column cells are taken.
 * Columns are live: next() inserts a column and shifts every later box right, so callers read n.col after placing, never before.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: put, free, bump and addEdge O(1) amortized (addEdge keeps a key set); next O(N + K log K) when it inserts, where N = boxes, K = taken cells (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 1.0 measured; threshold <= 10
 * - Caching: none
 */
function grid() {
  const g = { nodes: new Map(), edges: [], slices: [], occupied: new Map(), colOf: new Map(), end: 0 }; // occupied: `${lane}:${col}` -> rows used; end: first column past everything placed
  const edgeKeys = new Set();
  g.addEdge = (from, to, kind, label = '') => {
    const key = `${from}\u0000${to}\u0000${kind}\u0000${label}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    g.edges.push({ from, to, kind, label });
  };
  g.free = (lane, from) => { let c = Math.max(0, from); while (g.occupied.has(`${lane}:${c}`)) c++; return c; };
  g.put = (id, lane, label, col, extra = {}) => {
    if (g.nodes.has(id)) return g.nodes.get(id);
    const row = g.occupied.get(`${lane}:${col}`) || 0;
    g.occupied.set(`${lane}:${col}`, row + 1);
    const n = { id, lane, label, col, row, ...extra };
    g.nodes.set(id, n);
    g.colOf.set(id, col);
    return n;
  };
  g.bump = (c) => { g.end = Math.max(g.end, c + 1); };
  /* The column right after `col` in `lane`: used as is when free there, otherwise a new
     column is inserted at that point and every later column shifts right, so time still
     reads left to right. */
  g.next = (lane, col) => {
    const at = col + 1;
    if (!g.occupied.has(`${lane}:${at}`)) return at;
    for (const n of g.nodes.values()) if (n.col >= at) { n.col++; g.colOf.set(n.id, n.col); }
    for (const k of [...g.occupied.keys()].filter((k) => +k.split(':')[1] >= at).sort((x, y) => y.split(':')[1] - x.split(':')[1])) {
      const [l, c] = k.split(':'); g.occupied.set(`${l}:${+c + 1}`, g.occupied.get(k)); g.occupied.delete(k);
    }
    if (at < g.end) g.end++;
    return at;
  };
  return g;
}

/* What the phases look up about events, read models, actors and boundaries, built once. */
function lookups(model) {
  const views = new Map();
  for (const v of model.views) if (!views.has(v.name)) views.set(v.name, v);
  const actors = new Map();
  for (const a of model.actors) if (!actors.has(a.name.toLowerCase())) actors.set(a.name.toLowerCase(), a);
  const boundaries = new Map();
  for (const b of model.boundaries) if (!boundaries.has(b.name)) boundaries.set(b.name, b);
  const assumed = (name) => !(model.events.get(name) || { emittedBy: [] }).emittedBy.length;
  return {
    views, actors, boundaries, assumed,
    declaredEv: (name) => assumed(name) && !!(model.events.get(name) || {}).declared, // used, declared, nothing records it
    declaredSub: (name) => { const ctx = model.events.get(name).declared.context; return ctx ? `declared · ${ctx}` : 'declared'; },
    viewLabel: (name) => { const v = views.get(name); return v ? `${name}(${v.params.join(', ')})` : name; },
  };
}

/* A command box's notes: where it translates from, the facts it checks, the codes it rejects. */
const commandNotes = (cmd, checks, rejects) => [
  ...(cmd.source && cmd.source.system ? [`translates from ${clip(`${cmd.source.system} ${cmd.source.version || ''}`.trim(), 30)}`] : []),
  ...(checks.length ? [`checks ${checks.join(', ')}`] : []),
  ...(rejects.length ? [`rejects ${clip(rejects.join(', '), 40)}`] : []),
];

/* A checked fact as the note shows it: wildcard, and whether it is assumed or only declared. */
const checkLabel = (h, f) => `${f.name}${f.wildcard ? '*' : ''}${h.assumed(f.name) ? (h.declaredEv(f.name) ? ' (declared)' : ' (assumed)') : ''}`;

/* The arrow label from an actor to its command: the first trigger, and how many more. */
const triggerArrow = (cmd) => (cmd.triggers.length ? clip(`${triggerLabel(cmd.triggers[0])}${cmd.triggers.length > 1 ? ` +${cmd.triggers.length - 1}` : ''}`, 32) : '');

/**
 * Phase 1: each command owns a column, with its actor above it.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c·(o + β)) where c = commands, o = on facts, β = branches (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 1.0 measured; threshold <= 10
 * - Caching: none
 */
function placeCommands(model, g, h, cmds) {
  cmds.forEach((cmd, col) => {
    const kind = model.actorKind(cmd.actor);
    const declared = h.actors.get(cmd.actor.toLowerCase());
    const actor = g.put(`actor:${cmd.name}`, 'actor', declared ? declared.name : cmd.actor, col, { kind: kind === 'external' ? 'external' : 'actor', ranges: cmd.ranges.map(([from]) => [from, from]) });
    const checks = [...new Set(cmd.on.map((f) => checkLabel(h, f)))];
    const rejects = [...new Set(cmd.branches.map((b) => b.reject).filter(Boolean))];
    const planned = !!cmd.annotations.planned;
    const slice = kind === 'external' ? 'translation' : 'state change';
    const c = g.put(`cmd:${cmd.name}`, 'command', `${cmd.name}(${cmd.params.join(', ')})`, col, { kind: 'command', sub: planned ? 'planned' : slice, slice, planned, ranges: cmd.ranges, notes: commandNotes(cmd, checks, rejects), fullNotes: cmd.notes, checks });
    g.addEdge(actor.id, c.id, 'triggers', triggerArrow(cmd));
    g.bump(col);
  });
}

/**
 * The events each command emits hang beneath it; returns each command's boxes, for its slice.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c·β·m) where β = branches, m = emits per branch (derived by reading the code)
 * - Cyclomatic Complexity (CC): 3 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 3.0 measured; threshold <= 10
 * - Caching: none
 */
function hangEvents(g, cmds) {
  const membersOf = new Map();
  for (const cmd of cmds) {
    const c = g.nodes.get(`cmd:${cmd.name}`);
    const members = [`actor:${cmd.name}`, c.id];
    for (const br of cmd.branches) members.push(...hangBranch(g, c, br));
    membersOf.set(cmd, members);
  }
  return membersOf;
}

/* One branch's events: placed under the command that first records them, and an arrow from this command either way. */
function hangBranch(g, c, br) {
  return br.emits.map((em) => {
    const id = `evt:${em.event}`;
    if (!g.nodes.has(id)) g.put(id, 'event', em.event, c.col, { kind: 'event', indent: 26, sub: br.default ? '' : `if ${clip(br.guard, 30)}`, owner: c.id });
    const own = g.nodes.get(id).owner === c.id;
    g.addEdge(c.id, id, own ? 'tree' : 'emits', own || br.default ? '' : clip(br.guard, 24));
    return id;
  });
}

/* Notes on a read model box: facts nothing records, and where it is read. */
function viewNotes(h, view) {
  const notes = [];
  const unemitted = [...new Set(view.sources.map((s) => s.name).filter(h.assumed))].map((n) => (h.declaredEv(n) ? `${n} (declared)` : n));
  if (unemitted.length) notes.push(`from ${clip(unemitted.join(', '), 40)}`);
  if (view.triggers.length) notes.push(`read in ${clip(view.triggers.map(triggerLabel).join(', '), 36)}`);
  return notes;
}

/**
 * Phase 2: read models sit in the command row, right of the latest event that feeds them.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(v·s) plus the column inserts of next() (derived by reading the code)
 * - Cyclomatic Complexity (CC): 6 measured; target <= 8
 * - Branch Coverage: 85.7% measured; target >= 90%, below target
 * - CRAP Score: 6.1 measured; threshold <= 10
 * - Caching: none
 */
function placeViews(model, g, h) {
  for (const view of model.views) {
    const srcCols = view.sources.map((s) => g.colOf.get(`evt:${s.name}`)).filter((c) => c !== undefined);
    const col = srcCols.length ? g.next('command', Math.max(...srcCols)) : g.free('command', g.end);
    const planned = !!view.annotations.planned;
    const v = g.put(`view:${view.name}`, 'command', h.viewLabel(view.name), col, { kind: 'view', sub: planned ? 'planned' : 'state view', slice: 'state view', planned, ranges: [[view.line, view.endLine]], fullNotes: view.notes, notes: [] });
    v.notes.push(...viewNotes(h, view));
    for (const s of view.sources) if (g.nodes.has(`evt:${s.name}`)) g.addEdge(`evt:${s.name}`, v.id, 'projects');
    g.bump(col);
    g.slices.push({ type: 'state view', name: view.name, nodes: [v.id, ...view.sources.map((s) => `evt:${s.name}`).filter((id) => g.nodes.has(id))] });
  }
}

/* The box of a read model, drawn as not declared when the model never declares it. */
const readModel = (g, h, name) => {
  if (!g.nodes.has(`view:${name}`)) { const col = g.free('command', g.end); g.put(`view:${name}`, 'command', h.viewLabel(name), col, { kind: 'view', declared: false, sub: 'not declared' }); g.bump(col); }
  return g.nodes.get(`view:${name}`);
};

/* A read is the label of a from [...] fact: its freshness, and whether it may be empty. */
const readLabel = (f) => [f.freshness ? `fresh ${f.freshness}` : '', f.optional ? 'may be empty' : ''].filter(Boolean).join(', ');

/* A command reads a read model (it may sit to its right: the arrow loops back). */
function placeReads(g, h, cmds) {
  for (const cmd of cmds) for (const f of cmd.from) g.addEdge(readModel(g, h, f.name).id, `cmd:${cmd.name}`, 'reads', readLabel(f));
}

/* The event box a policy starts on, drawn as declared or assumed when no command records it. */
function triggerEvent(g, h, name) {
  const eid = `evt:${name}`;
  if (g.nodes.has(eid)) return eid;
  const col = g.free('event', g.end);
  g.put(eid, 'event', name, col, h.declaredEv(name) ? { kind: 'event', declared: true, sub: h.declaredSub(name) } : { kind: 'event', assumed: true, sub: 'assumed' });
  g.bump(col);
  return eid;
}

/**
 * The node that wakes a processor: its timer, or the read model its trigger event feeds (one it reads, else an implied one).
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(f·(s)) where f = from reads, s = sources per read model (derived by reading the code)
 * - Cyclomatic Complexity (CC): 7 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 7.0 measured; threshold <= 10
 * - Caching: none
 */
function gateOf(model, g, h, pol, reads, ranges) {
  if (pol.trigger.schedule) {
    const id = `timer:${pol.trigger.schedule}`;
    const timer = g.nodes.get(id) || g.put(id, 'actor', pol.trigger.schedule, g.free('actor', g.end), { kind: 'timer' });
    g.bump(timer.col);
    return timer;
  }
  if (!pol.trigger.event) return undefined;
  const eid = triggerEvent(g, h, pol.trigger.event);
  const fed = reads.find((r, k) => !needsImpliedReadModel(model, { ...pol, from: [pol.from[k]] }));
  let gate = fed && fed.node;
  if (!gate) {
    const id = `implied:${pol.trigger.event}`;
    gate = g.nodes.get(id) || g.put(id, 'command', pol.trigger.event, g.next('command', g.colOf.get(eid)), { kind: 'view', implied: true, sub: 'implied read model', ranges: [] });
    gate.ranges.push(...ranges);
    g.bump(gate.col);
  }
  g.addEdge(eid, gate.id, 'projects');
  return gate;
}

/* One box for every rule of a named policy; an unnamed rule gets its worker's box, or its own. */
const ruleBoxId = (pol, rule, i) => (pol.name ? `policy:${pol.name}` : rule.worker ? `pol:${rule.worker}` : `auto:${pol.line}:${i}`);

/* What a processor box says under its name. */
function processorSub(pol, rule) {
  if (pol.annotations.planned) return 'planned';
  if (pol.name) return [...new Set(pol.rules.map((r) => r.worker || 'automation'))].join(', ');
  return rule.worker ? 'automation' : 'unnamed processor';
}

/* Who a rule's slice and box are named after. */
const processorName = (pol, rule) => pol.name || rule.worker || 'automation';

/**
 * The processor box of one rule, right of what it reads and of earlier processors on the same trigger.
 * `after` is read now, because earlier inserts may have shifted those columns.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(f + q) where q = processors already placed on this trigger, plus the insert of next() (derived by reading the code)
 * - Cyclomatic Complexity (CC): 6 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 6.0 measured; threshold <= 10
 * - Caching: none
 */
function placeProcessor(g, r) {
  const { pol, rule, i, gate, reads, placed, ranges } = r;
  const wid = ruleBoxId(pol, rule, i);
  const after = Math.max(-1, ...[gate, ...reads.map((x) => x.node), ...placed.map((id) => g.nodes.get(id))].filter(Boolean).map((n) => n.col)); // live: inserts shift columns
  if (!g.nodes.has(wid)) placed.push(wid);
  const sub = processorSub(pol, rule);
  const w = g.nodes.get(wid) || g.put(wid, 'actor', processorName(pol, rule), g.next('actor', after), { kind: 'policy', sub, slice: 'automation', planned: !!pol.annotations.planned, fullNotes: pol.notes, notes: [] });
  if (!pol.name || i === 0) (w.ranges = w.ranges || []).push(...ranges); // a named policy's box stands for its lines once
  g.bump(w.col);
  return w;
}

/* The arrows into a processor: from each read model it reads, and from its gate when it does not read that. */
function wireInputs(g, w, reads, gate, guard) {
  for (const x of reads) g.addEdge(x.node.id, w.id, 'reads', [x.label, x.node === gate ? guard : ''].filter(Boolean).join(', '));
  if (gate && !reads.some((x) => x.node === gate)) g.addEdge(gate.id, w.id, gate.kind === 'timer' ? 'triggers' : 'reads', guard);
}

/* The command a rule invokes, right of the processor; drawn as not modeled when nothing declares it. A named policy labels it with the rule's guard, else with its arguments. */
function placeRuleCommand(g, r, w, at, ruleGuard) {
  const { pol, rule, placed, members } = r;
  if (!rule.command) return;
  const label = pol.name ? ruleGuard : clip(rule.command.args, 24);
  const cid = `cmd:${rule.command.name}`;
  if (!g.nodes.has(cid)) { const col = g.next('command', at); g.put(cid, 'command', `${rule.command.name}()`, col, { kind: 'command', declared: false, sub: 'not modeled' }); g.bump(col); placed.push(cid); }
  g.addEdge(w.id, cid, 'invokes', label);
  members.push(cid);
}

/* The events a rule records itself, right of the processor. */
function placeRuleEvents(g, r, w, at, label) {
  const { rule, placed, members } = r;
  for (const em of rule.emits) {
    const id = `evt:${em.event}`;
    if (!g.nodes.has(id)) { const col = g.next('event', at); g.put(id, 'event', em.event, col, { kind: 'event' }); g.bump(col); placed.push(id); }
    g.addEdge(w.id, id, 'emits', label);
    members.push(id);
  }
}

/* A rule's slice starts at its trigger event and gate. */
const ruleMembers = (pol, gate, w) => [...(pol.trigger.event ? [`evt:${pol.trigger.event}`] : []), ...(gate ? [gate.id] : []), w.id];

/* An automation slice is named after its policy, else its worker, else its trigger. */
const sliceName = (pol, rule) => pol.name || rule.worker || Model.policyLabel(pol);

/**
 * One policy rule: its processor, the arrows in, and the command or events it produces, as an automation slice.
 * A named policy's results sit right of all its earlier results, each labelled by its own guard.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(f + q + m) where q = processors and results placed on this trigger, m = emits, plus the inserts of next() (derived by reading the code)
 * - Cyclomatic Complexity (CC): 5 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 5.0 measured; threshold <= 10
 * - Caching: none
 */
function placeRule(model, g, r) {
  const { pol, rule, gate, reads, placed } = r;
  const w = placeProcessor(g, r);
  const ruleGuard = clip(rule.guard || '', 24);
  const at = pol.name ? Math.max(w.col, ...placed.map((id) => g.nodes.get(id).col)) : w.col;
  wireInputs(g, w, reads, gate, pol.name ? '' : ruleGuard);
  r.members = ruleMembers(pol, gate, w);
  placeRuleCommand(g, r, w, at, ruleGuard);
  placeRuleEvents(g, r, w, at, pol.name ? ruleGuard : '');
  g.slices.push({ type: 'automation', name: sliceName(pol, rule), nodes: [...new Set(r.members)] });
}

/**
 * Phase 3: policies. The processor sits right of what it reads, results right of the processor;
 * a later processor on the same trigger sits right of earlier ones, so siblings keep source order.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(p·r·(f + q + m)) plus the inserts of next() (derived by reading the code)
 * - Cyclomatic Complexity (CC): 4 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 4.0 measured; threshold <= 10
 * - Caching: none
 */
function placePolicies(model, g, h) {
  const siblings = new Map();
  for (const pol of model.policies) {
    const ranges = [[pol.line, pol.endLine]];
    const reads = pol.from.map((f) => ({ node: readModel(g, h, f.name), label: f.freshness ? `fresh ${f.freshness}` : '' }));
    const gate = gateOf(model, g, h, pol, reads, ranges);
    const sibKey = gate ? gate.id : reads.map((x) => x.node.id).join(',');
    if (!siblings.has(sibKey)) siblings.set(sibKey, []);
    const placed = siblings.get(sibKey); // earlier processors on this trigger and their results
    pol.rules.forEach((rule, i) => placeRule(model, g, { pol, rule, i, gate, reads, placed, ranges }));
  }
}

/* "shard by userId" when the boundary declares a shard key. */
const shardNote = (h, name) => {
  const b = h.boundaries.get(name);
  const key = b && b.annotations.partition && b.annotations.partition.shardKey;
  return key ? `shard by ${key}` : null;
};

/* Boundaries as groups: each command in one, with the events it owns. */
function boundaryGroups(g, h, cmds, membersOf) {
  const byBoundary = new Map();
  for (const cmd of cmds) {
    if (!cmd.boundary) continue;
    const name = cmd.boundary.name;
    if (!byBoundary.has(name)) byBoundary.set(name, { id: `bnd:${name}`, label: `${name}(${cmd.boundary.args})`, kind: 'boundary', members: new Set() });
    const grp = byBoundary.get(name);
    grp.members.add(`cmd:${cmd.name}`);
    for (const id of membersOf.get(cmd)) if (g.nodes.get(id).owner === `cmd:${cmd.name}`) grp.members.add(id);
    const sub = shardNote(h, name);
    if (sub) grp.sub = sub;
  }
  return [...byBoundary.values()].map((grp) => ({ ...grp, members: [...grp.members] }));
}

/**
 * Lays out the Event Modeling board (uncached; buildBoard is the entry point).
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(N + E + c·b + p·r·q) plus the column inserts of next(), which may shift every box (O(N) each; the layout may be superlinear in the boxes of one diagram) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 4 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 4.0 measured; threshold <= 10
 * - Caching: none
 */
function layoutBoard(model) {
  const g = grid();
  const h = lookups(model);
  const cmds = orderCommands(model, commandGroups(model));
  placeCommands(model, g, h, cmds);
  const membersOf = hangEvents(g, cmds);
  placeViews(model, g, h);
  placeReads(g, h, cmds);
  placePolicies(model, g, h);
  for (const cmd of cmds) g.slices.push({ type: model.actorKind(cmd.actor) === 'external' ? 'translation' : 'state change', name: cmd.name, nodes: [...new Set(membersOf.get(cmd))] });
  const list = [...g.nodes.values()];
  const cols = Math.max(...list.map((n) => n.col)) + 1;
  return { title: model.system ? model.system.name : 'eventline model', lanes: LANES, nodes: list, edges: g.edges, slices: g.slices, groups: boundaryGroups(g, h, cmds, membersOf), cols };
}

/* One board per parsed model. A model is not changed after parse, and nothing changes a board, so check and render can share it. */
const boards = new WeakMap();

/**
 * The Event Modeling board of a model, built once per model object.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(1) after the first call for a model; the first call costs layoutBoard (derived by reading the code)
 * - Cyclomatic Complexity (CC): 2 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 2.0 measured; threshold <= 10
 * - Caching: WeakMap keyed by the model, so a board is dropped with its model
 */
function buildBoard(model) {
  if (!boards.has(model)) boards.set(model, layoutBoard(model));
  return boards.get(model);
}

/* The generic graph form, for the Mermaid and DOT exporters. */
/**
 * The board as a generic graph for the Mermaid and DOT exporters.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(N + E + G) where N = boxes, E = arrows, G = groups (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 1.0 measured; threshold <= 10
 * - Largest nested function: CC 3 measured (branch cov 100%, CRAP 3.0), `edges: board.edges.map((e) => ({ from: e.from, to: e.to, lab`
 * - Caching: none
 */
function boardToGraph(board) {
  return {
    title: `${board.title} event model`,
    direction: 'LR',
    nodes: board.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, sub: n.sub || '' })),
    edges: board.edges.map((e) => ({ from: e.from, to: e.to, label: e.label || '', style: e.kind === 'reads' ? 'dashed' : 'solid' })),
    groups: board.groups.map((g) => ({ id: g.id, label: g.label, members: g.members })),
  };
}

module.exports = { buildBoard, boardToGraph, needsImpliedReadModel, LANES, LANE_LABELS };
