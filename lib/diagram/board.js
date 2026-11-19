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

function buildBoard(model) {
  const nodes = new Map();
  const edges = [];
  const slices = [];
  const occupied = new Map(); // `${lane}:${col}` -> rows used
  const colOf = new Map();

  const addEdge = (from, to, kind, label = '') => {
    if (!edges.some((e) => e.from === from && e.to === to && e.kind === kind && e.label === label)) edges.push({ from, to, kind, label });
  };
  const free = (lane, from) => { let c = Math.max(0, from); while (occupied.has(`${lane}:${c}`)) c++; return c; };
  const put = (id, lane, label, col, extra = {}) => {
    if (nodes.has(id)) return nodes.get(id);
    const row = occupied.get(`${lane}:${col}`) || 0;
    occupied.set(`${lane}:${col}`, row + 1);
    const n = { id, lane, label, col, row, ...extra };
    nodes.set(id, n);
    colOf.set(id, col);
    return n;
  };
  let end = 0; // first column past everything placed so far
  const bump = (c) => { end = Math.max(end, c + 1); };
  /* The column right after `col` in `lane`: used as is when free there, otherwise a new
     column is inserted at that point and every later column shifts right, so time still
     reads left to right. */
  const next = (lane, col) => {
    const at = col + 1;
    if (!occupied.has(`${lane}:${at}`)) return at;
    for (const n of nodes.values()) if (n.col >= at) { n.col++; colOf.set(n.id, n.col); }
    for (const k of [...occupied.keys()].filter((k) => +k.split(':')[1] >= at).sort((a, b) => b.split(':')[1] - a.split(':')[1])) {
      const [l, c] = k.split(':'); occupied.set(`${l}:${+c + 1}`, occupied.get(k)); occupied.delete(k);
    }
    if (at < end) end++;
    return at;
  };

  const assumed = (name) => !(model.events.get(name) || { emittedBy: [] }).emittedBy.length;
  const viewLabel = (name) => { const v = model.views.find((x) => x.name === name); return v ? `${name}(${v.params.join(', ')})` : name; };

  const cmds = orderCommands(model, commandGroups(model));

  // 1. commands: one column each, actor above, emitted events beneath
  cmds.forEach((cmd, col) => {
    const kind = model.actorKind(cmd.actor);
    const declared = model.actors.find((a) => a.name.toLowerCase() === cmd.actor.toLowerCase());
    const actor = put(`actor:${cmd.name}`, 'actor', declared ? declared.name : cmd.actor, col, { kind: kind === 'external' ? 'external' : 'actor', ranges: cmd.ranges.map(([from]) => [from, from]) });
    const checks = [...new Set(cmd.on.map((f) => `${f.name}${f.wildcard ? '*' : ''}${assumed(f.name) ? ' (assumed)' : ''}`))];
    const rejects = [...new Set(cmd.branches.map((b) => b.reject).filter(Boolean))];
    const planned = !!cmd.annotations.planned;
    const c = put(`cmd:${cmd.name}`, 'command', `${cmd.name}(${cmd.params.join(', ')})`, col, {
      kind: 'command', sub: planned ? 'planned' : kind === 'external' ? 'translation' : 'state change', slice: kind === 'external' ? 'translation' : 'state change',
      planned,
      ranges: cmd.ranges,
      notes: [
        ...(cmd.source && cmd.source.system ? [`translates from ${clip(`${cmd.source.system} ${cmd.source.version || ''}`.trim(), 30)}`] : []),
        ...(checks.length ? [`checks ${checks.join(', ')}`] : []),
        ...(rejects.length ? [`rejects ${clip(rejects.join(', '), 40)}`] : []),
      ],
      fullNotes: cmd.notes,
      checks,
    });
    addEdge(actor.id, c.id, 'triggers', cmd.triggers.length ? clip(`${triggerLabel(cmd.triggers[0])}${cmd.triggers.length > 1 ? ` +${cmd.triggers.length - 1}` : ''}`, 32) : '');
    bump(col);
  });

  cmds.forEach((cmd) => {
    const c = nodes.get(`cmd:${cmd.name}`);
    const members = [`actor:${cmd.name}`, c.id];
    for (const br of cmd.branches) {
      for (const em of br.emits) {
        const id = `evt:${em.event}`;
        if (!nodes.has(id)) put(id, 'event', em.event, c.col, { kind: 'event', indent: 26, sub: br.default ? '' : `if ${clip(br.guard, 30)}`, owner: c.id });
        addEdge(c.id, id, nodes.get(id).owner === c.id ? 'tree' : 'emits', nodes.get(id).owner === c.id ? '' : br.default ? '' : clip(br.guard, 24));
        members.push(id);
      }
    }
    cmd.__members = members;
  });

  // 2. read models: in the command row, right of the latest event that feeds them
  for (const view of model.views) {
    const srcCols = view.sources.map((s) => colOf.get(`evt:${s.name}`)).filter((c) => c !== undefined);
    const col = srcCols.length ? next('command', Math.max(...srcCols)) : free('command', end);
    const planned = !!view.annotations.planned;
    const v = put(`view:${view.name}`, 'command', viewLabel(view.name), col, { kind: 'view', sub: planned ? 'planned' : 'state view', slice: 'state view', planned, ranges: [[view.line, view.endLine]], fullNotes: view.notes, notes: [] });
    const unemitted = [...new Set(view.sources.map((s) => s.name).filter(assumed))];
    if (unemitted.length) v.notes.push(`from ${clip(unemitted.join(', '), 40)}`);
    if (view.triggers.length) v.notes.push(`read in ${clip(view.triggers.map(triggerLabel).join(', '), 36)}`);
    for (const s of view.sources) if (nodes.has(`evt:${s.name}`)) addEdge(`evt:${s.name}`, v.id, 'projects');
    bump(col);
    slices.push({ type: 'state view', name: view.name, nodes: [v.id, ...view.sources.map((s) => `evt:${s.name}`).filter((id) => nodes.has(id))] });
  }
  const readModel = (name) => {
    if (!nodes.has(`view:${name}`)) { const col = free('command', end); put(`view:${name}`, 'command', viewLabel(name), col, { kind: 'view', declared: false, sub: 'not declared' }); bump(col); }
    return nodes.get(`view:${name}`);
  };
  // reads: a command reads a read model (it may sit to its right: the arrow loops back)
  for (const cmd of cmds) {
    for (const f of cmd.from) addEdge(readModel(f.name).id, `cmd:${cmd.name}`, 'reads', [f.freshness ? `fresh ${f.freshness}` : '', f.optional ? 'may be empty' : ''].filter(Boolean).join(', '));
  }

  // 3. policies: the processor sits right of what it reads, results right of the processor;
  //    a later processor on the same trigger sits right of earlier ones, so siblings keep source order
  const siblings = new Map();
  for (const pol of model.policies) {
    const ranges = [[pol.line, pol.endLine]];
    const reads = pol.from.map((f) => ({ node: readModel(f.name), label: f.freshness ? `fresh ${f.freshness}` : '' }));
    let gate; // the node that wakes the processor: a timer, or the read model its trigger event feeds
    if (pol.trigger.schedule) {
      gate = nodes.get(`timer:${pol.trigger.schedule}`) || put(`timer:${pol.trigger.schedule}`, 'actor', pol.trigger.schedule, free('actor', end), { kind: 'timer' });
      bump(gate.col);
    } else if (pol.trigger.event) {
      const eid = `evt:${pol.trigger.event}`;
      if (!nodes.has(eid)) { const col = free('event', end); put(eid, 'event', pol.trigger.event, col, { kind: 'event', assumed: true, sub: 'assumed' }); bump(col); }
      const fed = reads.find((r, k) => !needsImpliedReadModel(model, { ...pol, from: [pol.from[k]] }));
      if (fed) gate = fed.node;
      else {
        gate = nodes.get(`implied:${pol.trigger.event}`) || put(`implied:${pol.trigger.event}`, 'command', pol.trigger.event, next('command', colOf.get(eid)), { kind: 'view', implied: true, sub: 'implied read model', ranges: [] });
        gate.ranges.push(...ranges);
        bump(gate.col);
      }
      addEdge(eid, gate.id, 'projects');
    }
    const planned = !!pol.annotations.planned;
    const sibKey = gate ? gate.id : reads.map((r) => r.node.id).join(',');
    if (!siblings.has(sibKey)) siblings.set(sibKey, []);
    const placed = siblings.get(sibKey); // earlier processors on this trigger and their results
    pol.rules.forEach((rule, i) => {
      const wid = pol.name ? `policy:${pol.name}` : rule.worker ? `pol:${rule.worker}` : `auto:${pol.line}:${i}`;
      const after = Math.max(-1, ...[gate, ...reads.map((r) => r.node), ...placed.map((id) => nodes.get(id))].filter(Boolean).map((n) => n.col)); // live: inserts shift columns
      if (!nodes.has(wid)) placed.push(wid);
      const sub = planned ? 'planned' : pol.name ? [...new Set(pol.rules.map((r) => r.worker || 'automation'))].join(', ') : rule.worker ? 'automation' : 'unnamed processor';
      const w = nodes.get(wid) || put(wid, 'actor', pol.name || rule.worker || 'automation', next('actor', after), { kind: 'policy', sub, slice: 'automation', planned, fullNotes: pol.notes, notes: [] });
      if (!pol.name || i === 0) (w.ranges = w.ranges || []).push(...ranges); // a named policy's box stands for its lines once
      bump(w.col);
      // one box for every rule of a named policy: each rule's guard labels its own result, and results keep source order
      const ruleGuard = clip(rule.guard || '', 24);
      const guard = pol.name ? '' : ruleGuard;
      const resultAfter = pol.name ? Math.max(w.col, ...placed.map((id) => nodes.get(id).col)) : w.col;
      for (const r of reads) addEdge(r.node.id, w.id, 'reads', [r.label, r.node === gate ? guard : ''].filter(Boolean).join(', '));
      if (gate && !reads.some((r) => r.node === gate)) addEdge(gate.id, w.id, gate.kind === 'timer' ? 'triggers' : 'reads', guard);
      const members = [...(pol.trigger.event ? [`evt:${pol.trigger.event}`] : []), ...(gate ? [gate.id] : []), w.id];
      if (rule.command) {
        const cid = `cmd:${rule.command.name}`;
        if (!nodes.has(cid)) { const col = next('command', resultAfter); put(cid, 'command', `${rule.command.name}()`, col, { kind: 'command', declared: false, sub: 'not modeled' }); bump(col); placed.push(cid); }
        addEdge(w.id, cid, 'invokes', pol.name ? ruleGuard : clip(rule.command.args, 24));
        members.push(cid);
      }
      for (const em of rule.emits) {
        const id = `evt:${em.event}`;
        if (!nodes.has(id)) { const col = next('event', resultAfter); put(id, 'event', em.event, col, { kind: 'event' }); bump(col); placed.push(id); }
        addEdge(w.id, id, 'emits', pol.name ? ruleGuard : '');
        members.push(id);
      }
      slices.push({ type: 'automation', name: pol.name || rule.worker || Model.policyLabel(pol), nodes: [...new Set(members)] });
    });
  }

  for (const cmd of cmds) {
    slices.push({ type: model.actorKind(cmd.actor) === 'external' ? 'translation' : 'state change', name: cmd.name, nodes: [...new Set(cmd.__members)] });
  }

  const groups = [];
  const byBoundary = new Map();
  for (const cmd of cmds) {
    if (!cmd.boundary) continue;
    const g = byBoundary.get(cmd.boundary.name) || { id: `bnd:${cmd.boundary.name}`, label: `${cmd.boundary.name}(${cmd.boundary.args})`, kind: 'boundary', members: new Set() };
    byBoundary.set(cmd.boundary.name, g);
    g.members.add(`cmd:${cmd.name}`);
    for (const id of cmd.__members) if (id.startsWith('evt:') && nodes.get(id).owner === `cmd:${cmd.name}`) g.members.add(id);
    const b = model.boundaries.find((x) => x.name === cmd.boundary.name);
    if (b && b.annotations.partition && b.annotations.partition.shardKey) g.sub = `shard by ${b.annotations.partition.shardKey}`;
  }
  for (const g of byBoundary.values()) groups.push({ ...g, members: [...g.members] });

  const list = [...nodes.values()];
  const cols = Math.max(...list.map((n) => n.col)) + 1;
  return { title: model.system ? model.system.name : 'eventline model', lanes: LANES, nodes: list, edges, slices, groups, cols };
}

/* The generic graph form, for the Mermaid and DOT exporters. */
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
