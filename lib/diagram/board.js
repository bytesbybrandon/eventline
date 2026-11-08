'use strict';

/*
 * Event Modeling board, derived from a model.
 *
 * Lanes, top to bottom: actor, command, event, view, policy.
 * Time runs left to right. The model has no explicit timeline, so order comes from
 * causality: a command that reads events another command emits comes after it.
 *
 * Layout, as on a hand-drawn board:
 *   - each command owns a column; its actor sits above it
 *   - the events it emits hang beneath it as a small tree
 *   - a view sits right of the latest event that feeds it
 *   - a policy worker sits right of the event that wakes it, and the command or
 *     events it produces sit right of the worker
 *   - facts the model assumes (nobody emits them) are a note under the command
 *
 * Slices follow the four Event Modeling patterns the README maps one to one:
 *   state change, state view, automation, translation.
 */

const LANES = ['actor', 'command', 'event', 'view', 'policy'];
const clip = (s, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* "AuditScreen > Fail button": the thing someone uses, and the part of it. */
const triggerLabel = (t) => `${t.name || 'unnamed'}${t.part ? ` > ${t.part}` : ''}`;

/* One entry per actor+command name; a second block with the same name is a variant
   (for example a fallback path) and contributes more facts and branches. */
function commandGroups(model) {
  const groups = new Map();
  for (const cmd of model.commands) {
    const key = `${cmd.actor.toLowerCase()}>${cmd.name}`;
    if (!groups.has(key)) groups.set(key, { actor: cmd.actor, name: cmd.name, params: cmd.params, boundary: cmd.boundary, on: [], from: [], branches: [], notes: [], triggers: [], annotations: {}, line: cmd.line });
    const g = groups.get(key);
    g.on.push(...cmd.on);
    g.from.push(...cmd.from);
    g.branches.push(...cmd.branches);
    g.notes.push(...(cmd.notes || []));
    g.triggers.push(...(cmd.triggers || []));
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

  const assumed = (name) => !(model.events.get(name) || { emittedBy: [] }).emittedBy.length;
  const viewLabel = (name) => { const v = model.views.find((x) => x.name === name); return v ? `${name}(${v.params.join(', ')})` : name; };

  const cmds = orderCommands(model, commandGroups(model));

  // 1. commands: one column each, actor above, emitted events beneath
  cmds.forEach((cmd, col) => {
    const kind = model.actorKind(cmd.actor);
    const declared = model.actors.find((a) => a.name.toLowerCase() === cmd.actor.toLowerCase());
    const actor = put(`actor:${cmd.name}`, 'actor', declared ? declared.name : cmd.actor, col, { kind: kind === 'external' ? 'external' : 'actor' });
    const facts = [...new Set(cmd.on.map((f) => f.name).filter(assumed))];
    const rejects = [...new Set(cmd.branches.map((b) => b.reject).filter(Boolean))];
    const planned = !!cmd.annotations.planned;
    const c = put(`cmd:${cmd.name}`, 'command', `${cmd.name}(${cmd.params.join(', ')})`, col, {
      kind: 'command', sub: planned ? 'planned' : kind === 'external' ? 'translation' : 'state change', slice: kind === 'external' ? 'translation' : 'state change',
      planned,
      notes: [...(facts.length ? [`assumes ${clip(facts.join(', '), 40)}`] : []), ...(rejects.length ? [`rejects ${clip(rejects.join(', '), 40)}`] : [])],
      fullNotes: cmd.notes,
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

  // 2. views: right of the latest event that feeds them
  for (const view of model.views) {
    const srcCols = view.sources.map((s) => colOf.get(`evt:${s.name}`)).filter((c) => c !== undefined);
    const col = free('view', srcCols.length ? Math.max(...srcCols) + 1 : end);
    const planned = !!view.annotations.planned;
    const v = put(`view:${view.name}`, 'view', viewLabel(view.name), col, { kind: 'view', sub: planned ? 'planned' : 'state view', slice: 'state view', planned, fullNotes: view.notes, notes: [] });
    const unemitted = [...new Set(view.sources.map((s) => s.name).filter(assumed))];
    if (unemitted.length) v.notes.push(`from ${clip(unemitted.join(', '), 40)}`);
    if (view.triggers.length) v.notes.push(`read in ${clip(view.triggers.map(triggerLabel).join(', '), 36)}`);
    for (const s of view.sources) if (nodes.has(`evt:${s.name}`)) addEdge(`evt:${s.name}`, v.id, 'projects');
    bump(col);
    slices.push({ type: 'state view', name: view.name, nodes: [v.id, ...view.sources.map((s) => `evt:${s.name}`).filter((id) => nodes.has(id))] });
  }
  // reads: a command reads a view (the view may sit to its right: the arrow loops back)
  for (const cmd of cmds) {
    for (const f of cmd.from) {
      if (!nodes.has(`view:${f.name}`)) { const col = free('view', end); put(`view:${f.name}`, 'view', viewLabel(f.name), col, { kind: 'view', declared: false, sub: 'not declared' }); bump(col); }
      addEdge(`view:${f.name}`, `cmd:${cmd.name}`, 'reads', f.freshness ? `fresh ${f.freshness}` : '');
    }
    for (const f of cmd.on) if (nodes.has(`evt:${f.name}`) && nodes.get(`evt:${f.name}`).owner !== `cmd:${cmd.name}`) addEdge(`evt:${f.name}`, `cmd:${cmd.name}`, 'given');
  }

  // 3. policies: worker right of its trigger, results right of the worker
  for (const pol of model.policies) {
    const timer = !pol.trigger.event;
    const tid = timer ? `timer:${pol.trigger.schedule}` : `evt:${pol.trigger.event}`;
    if (!timer && !nodes.has(tid)) { const col = free('event', end); put(tid, 'event', pol.trigger.event, col, { kind: 'event', assumed: true, sub: 'assumed' }); bump(col); }
    const tcol = timer ? end : colOf.get(tid);
    if (timer) {
      const col = free('actor', end);
      put(tid, 'actor', pol.trigger.schedule, col, { kind: 'timer' });
      bump(col);
    }
    for (const rule of pol.rules) {
      const members = [tid];
      if (!rule.worker) {
        for (const em of rule.emits) {
          const id = `evt:${em.event}`;
          if (!nodes.has(id)) { const col = free('event', tcol + 1); put(id, 'event', em.event, col, { kind: 'event' }); bump(col); }
          addEdge(tid, id, 'emits', clip(rule.guard || '', 24));
          members.push(id);
        }
        slices.push({ type: 'automation', name: pol.trigger.event || pol.trigger.schedule, nodes: members });
        continue;
      }
      const wid = `pol:${rule.worker}`;
      const wcol = timer ? colOf.get(tid) : free('policy', tcol + 1);
      const planned = !!pol.annotations.planned;
      const w = nodes.get(wid) || put(wid, 'policy', rule.worker, wcol, { kind: 'policy', sub: planned ? 'planned' : 'automation', slice: 'automation', planned, fullNotes: pol.notes, notes: [] });
      bump(w.col);
      for (const f of pol.from) {
        if (!nodes.has(`view:${f.name}`)) { const vcol = free('view', end); put(`view:${f.name}`, 'view', viewLabel(f.name), vcol, { kind: 'view', declared: false, sub: 'not declared' }); bump(vcol); }
        addEdge(`view:${f.name}`, w.id, 'reads', f.freshness ? `fresh ${f.freshness}` : '');
      }
      addEdge(tid, w.id, 'triggers', clip(rule.guard || '', 24));
      members.push(w.id);
      if (rule.command) {
        const cid = `cmd:${rule.command.name}`;
        if (!nodes.has(cid)) { const col = free('command', w.col + 1); put(cid, 'command', `${rule.command.name}()`, col, { kind: 'command', declared: false, sub: 'not modeled' }); bump(col); }
        addEdge(w.id, cid, 'invokes', clip(rule.command.args, 24));
        members.push(cid);
      }
      for (const em of rule.emits) {
        const id = `evt:${em.event}`;
        if (!nodes.has(id)) { const col = free('event', w.col + 1); put(id, 'event', em.event, col, { kind: 'event' }); bump(col); }
        addEdge(w.id, id, 'emits');
        members.push(id);
      }
      slices.push({ type: 'automation', name: rule.worker, nodes: members });
    }
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
    edges: board.edges.map((e) => ({ from: e.from, to: e.to, label: e.label || '', style: e.kind === 'given' || e.kind === 'reads' ? 'dashed' : 'solid' })),
    groups: board.groups.map((g) => ({ id: g.id, label: g.label, members: g.members })),
  };
}

module.exports = { buildBoard, boardToGraph, LANES };
