'use strict';

/*
 * System diagrams inferred from a model. Nothing here is invented: every box and
 * arrow traces to a statement in the file. Where the model is silent (topology,
 * which service hosts which command) the diagram says so instead of guessing.
 *
 *   context     the system, who uses it, what it depends on
 *   containers  command API, event store, read models, workers, externals
 *   dataflow    commands and workers as processes, the event log and read models as stores
 *   deployment  regions, each running the stack, with shards per boundary
 */

const short = (list, n = 3) => {
  const u = [...new Set(list)];
  return u.length <= n ? u.join(', ') : `${u.slice(0, n).join(', ')} +${u.length - n}`;
};
const cacheOf = (view) => {
  const key = Object.keys(view.annotations).find((k) => /cache/i.test(k));
  return key ? view.annotations[key] : null;
};
/**
 * Events one command emits.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(β·m) where β = branches, m = emits per branch; called once per command per diagram (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 1.0 measured; threshold <= 10
 * - Caching: none
 */
const eventsOf = (cmd) => cmd.branches.flatMap((b) => b.emits.map((e) => e.event));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * The subtitle line from the system block.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(l + g + d) where l = SLOs, g = regions, d = data classifications (derived by reading the code)
 * - Cyclomatic Complexity (CC): 5 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 5.0 measured; threshold <= 10
 * - Caching: none
 */
function subtitle(model) {
  const s = model.system;
  if (!s) return '';
  return [s.slo.length ? `slo ${s.slo.join(', ')}` : '', s.regions.length ? `regions ${s.regions.join(', ')}` : '', s.dataClassification.length ? `data ${s.dataClassification.join(', ')}` : ''].filter(Boolean).join('   ·   ');
}

/* Declared actors, outside systems, and undeclared command issuers, each with the commands they use. */
/**
 * Declared actors, externals and undeclared issuers, each with its commands.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(a + x + c·x) where a = actors, x = system externals, c = commands (extFor and actorKind scan externals per command) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 9 measured; target <= 8, over budget
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 9.0 measured; threshold <= 10
 * - Caching: none
 */
function people(model) {
  const actors = new Map();
  const externals = new Map();
  const sysExternals = model.system ? model.system.externals : [];
  const extFor = (name) => sysExternals.find((e) => name.toLowerCase() === e.name.toLowerCase() || name.toLowerCase().startsWith(e.name.toLowerCase() + '-'));

  for (const a of model.actors) actors.set(a.name.toLowerCase(), { id: `actor:${slug(a.name)}`, label: a.name, sub: a.attributes.auth ? `auth ${a.attributes.auth}` : 'actor', kind: 'actor', commands: [] });
  for (const e of sysExternals) externals.set(e.name.toLowerCase(), { id: `ext:${slug(e.name)}`, label: e.name, sub: e.role || 'external system', kind: 'external', inbound: [] });

  for (const cmd of model.commands) {
    const kind = model.actorKind(cmd.actor);
    if (kind === 'external') {
      const e = extFor(cmd.actor);
      externals.get(e.name.toLowerCase()).inbound.push(cmd.name);
    } else {
      const k = cmd.actor.toLowerCase();
      if (!actors.has(k)) actors.set(k, { id: `actor:${slug(cmd.actor)}`, label: cmd.actor, sub: 'not declared', kind: 'actor', commands: [] });
      actors.get(k).commands.push(cmd.name);
    }
  }
  return { actors: [...actors.values()], externals: [...externals.values()] };
}

/**
 * Builds the system context diagram.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(a + x + c·(a + x)) where a = actors, x = externals, c = commands (derived by reading the code)
 * - Cyclomatic Complexity (CC): 6 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 6.0 measured; threshold <= 10
 * - Caching: none
 */
function context(model) {
  const sysName = model.system ? model.system.name : 'System';
  const { actors, externals } = people(model);
  const nodes = [{ id: 'sys', label: sysName, sub: 'software system', kind: 'system' }];
  const edges = [];
  for (const a of actors) {
    nodes.push({ id: a.id, label: a.label, sub: a.sub, kind: 'actor' });
    edges.push({ from: a.id, to: 'sys', label: a.commands.length ? short(a.commands, 3) : 'no commands' });
  }
  for (const e of externals) {
    nodes.push({ id: e.id, label: e.label, sub: e.sub, kind: 'external' });
    if (e.inbound.length) edges.push({ from: e.id, to: 'sys', label: short(e.inbound, 3) });
    else edges.push({ from: 'sys', to: e.id, label: 'depends on' });
  }
  return { title: `${sysName} · system context`, subtitle: subtitle(model), direction: 'LR', nodes, edges, groups: [] };
}

/* Shared by containers and dataflow: who talks to the system, and the workers. */
/**
 * Workers, with what triggers them and what they read, issue and emit.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(p·r·(f + m)) where p = policies, r = rules per policy, f = from reads, m = emits per rule; linear in policy size (derived by reading the code)
 * - Cyclomatic Complexity (CC): 8 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 8.0 measured; threshold <= 10
 * - Caching: none
 */
function workersOf(model) {
  const w = new Map();
  for (const p of model.policies) {
    for (const r of p.rules) {
      if (!r.worker) continue;
      if (!w.has(r.worker)) w.set(r.worker, { triggers: [], schedules: [], reads: [], commands: [], emits: [] });
      const x = w.get(r.worker);
      if (p.trigger.event) x.triggers.push(p.trigger.event);
      else if (p.trigger.schedule) x.schedules.push(p.trigger.schedule);
      x.reads.push(...p.from.map((f) => f.name));
      if (r.command) x.commands.push(r.command.name);
      x.emits.push(...r.emits.map((e) => e.event));
    }
  }
  return w;
}

/**
 * Builds the containers diagram.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c·(a + x) + c·m + v·c·f + p·r) where c = commands, v = read models, f = from reads per command, a = actors, x = externals, m = emits; the v·c·f term is a commands.some per read model; budget O(model size) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 20 measured; target <= 8, over budget
 * - Branch Coverage: 96% measured; target >= 90%
 * - CRAP Score: 20.0 measured; threshold <= 10, over budget
 * - Caching: none
 */
function containers(model) {
  const sysName = model.system ? model.system.name : 'System';
  const { actors, externals } = people(model);
  const nodes = [];
  const edges = [];
  const inside = [];
  const keys = model.boundaries.map((b) => b.annotations.partition && b.annotations.partition.shardKey).filter(Boolean);

  for (const a of actors) {
    nodes.push({ id: a.id, label: a.label, sub: a.sub, kind: 'actor' });
    if (a.commands.length) edges.push({ from: a.id, to: 'api', label: short(a.commands, 3) });
  }
  const nCmd = new Set(model.commands.map((c) => c.name)).size;
  nodes.push({ id: 'api', label: 'Command API', sub: `${nCmd} command${nCmd === 1 ? '' : 's'}`, kind: 'process' });
  nodes.push({ id: 'store', label: 'Event store', sub: keys.length ? `partitioned by ${short(keys, 3)}` : 'append only', kind: 'store' });
  inside.push('api', 'store');
  edges.push({ from: 'api', to: 'store', label: `append ${new Set(model.commands.flatMap(eventsOf)).size} event types` });

  for (const v of model.views) {
    const c = cacheOf(v);
    const id = `view:${v.name}`;
    nodes.push({ id, label: v.name, sub: c ? `read model, cache ttl ${c.ttl || '?'}` : 'read model', kind: 'cache' });
    inside.push(id);
    edges.push({ from: 'store', to: id, label: short(v.sources.map((s) => s.name), 2) });
    if (model.commands.some((cmd) => cmd.from.some((f) => f.name === v.name))) edges.push({ from: id, to: 'api', label: 'read', style: 'dashed', weak: true });
  }
  for (const [name, w] of workersOf(model)) {
    const id = `worker:${name}`;
    nodes.push({ id, label: name, sub: w.schedules.length ? `runs ${w.schedules[0]}` : 'async worker', kind: 'worker' });
    inside.push(id);
    if (w.triggers.length) edges.push({ from: 'store', to: id, label: short(w.triggers, 2) });
    for (const v of new Set(w.reads)) edges.push({ from: `view:${v}`, to: id, label: 'read', style: 'dashed', weak: true });
    if (w.commands.length) edges.push({ from: id, to: 'api', label: short(w.commands, 2), weak: true });
    if (w.emits.length) edges.push({ from: id, to: 'store', label: short(w.emits, 2), weak: true });
  }
  for (const e of externals) {
    // The model says the system depends on an outside service, not which container calls it,
    // so an outbound dependency is drawn beside the system with no arrow into a container.
    if (e.inbound.length) {
      nodes.push({ id: e.id, label: e.label, sub: e.sub, kind: 'external' });
      edges.push({ from: e.id, to: 'api', label: short(e.inbound, 2) });
    } else nodes.push({ id: e.id, label: e.label, sub: `${e.sub} · system dependency`, kind: 'external', side: 'right' });
  }
  const regions = model.system && model.system.regions.length ? ` (${model.system.regions.join(', ')})` : '';
  return { title: `${sysName} · containers`, subtitle: subtitle(model), direction: 'LR', nodes, edges, groups: [{ id: 'sys', label: `${sysName}${regions}`, members: inside }] };
}

/**
 * Builds the data flow diagram.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c·(a + x) + v + p·r + N + E) where c = commands, a = actors, x = externals, v = read models, N and E = boxes and arrows drawn (derived by reading the code)
 * - Cyclomatic Complexity (CC): 18 measured; target <= 8, over budget
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 18.0 measured; threshold <= 10, over budget
 * - Caching: none
 */
function dataflow(model) {
  const sysName = model.system ? model.system.name : 'System';
  const { actors, externals } = people(model);
  const nodes = [];
  const edges = [];
  for (const a of actors) nodes.push({ id: a.id, label: a.label, sub: a.sub, kind: 'actor' });
  for (const e of externals) nodes.push({ id: e.id, label: e.label, sub: e.sub, kind: 'external' });
  nodes.push({ id: 'log', label: 'Event log', sub: 'data store, append only', kind: 'store' });

  const seen = new Set();
  for (const cmd of model.commands) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      nodes.push({ id: `cmd:${cmd.name}`, label: `${cmd.name}()`, sub: 'command', kind: 'process' });
    }
    const kind = model.actorKind(cmd.actor);
    const who = kind === 'external' ? externals.find((e) => cmd.actor.toLowerCase().startsWith(e.label.toLowerCase())) : actors.find((a) => a.label.toLowerCase() === cmd.actor.toLowerCase());
    if (who) edges.push({ from: who.id, to: `cmd:${cmd.name}`, label: cmd.params.join(', ') });
    edges.push({ from: `cmd:${cmd.name}`, to: 'log', label: short(eventsOf(cmd), 2) });
    if (cmd.on.length) edges.push({ from: 'log', to: `cmd:${cmd.name}`, label: '', style: 'dashed', weak: true });
    for (const f of cmd.from) edges.push({ from: `view:${f.name}`, to: `cmd:${cmd.name}`, label: 'read', style: 'dashed', weak: true });
  }
  for (const v of model.views) {
    nodes.push({ id: `view:${v.name}`, label: v.name, sub: 'data store, read model', kind: 'view' });
    edges.push({ from: 'log', to: `view:${v.name}`, label: short(v.sources.map((s) => s.name), 2) });
  }
  for (const [name, w] of workersOf(model)) {
    nodes.push({ id: `worker:${name}`, label: name, sub: w.schedules.length ? `process, ${w.schedules[0]}` : 'process, async', kind: 'worker' });
    if (w.triggers.length) edges.push({ from: 'log', to: `worker:${name}`, label: short(w.triggers, 2) });
    for (const v of new Set(w.reads)) edges.push({ from: `view:${v}`, to: `worker:${name}`, label: 'read', style: 'dashed', weak: true });
    for (const c of [...new Set(w.commands)]) {
      if (!seen.has(c)) { seen.add(c); nodes.push({ id: `cmd:${c}`, label: `${c}()`, sub: 'command, not modeled', kind: 'process', declared: false }); }
      edges.push({ from: `worker:${name}`, to: `cmd:${c}`, label: 'issues', weak: true });
    }
    if (w.emits.length) edges.push({ from: `worker:${name}`, to: 'log', label: short(w.emits, 2), weak: true });
  }
  const known = new Set(nodes.map((n) => n.id));
  const flows = edges.filter((e) => known.has(e.from) && known.has(e.to));
  const connected = new Set(flows.flatMap((e) => [e.from, e.to]));
  return { title: `${sysName} · data flow`, subtitle: `${subtitle(model)}   ·   dashed = a command reads existing facts or a read model`, direction: 'LR', nodes: nodes.filter((n) => connected.has(n.id)), edges: flows, groups: [] };
}

/**
 * Which boundaries feed each event, and which commands each boundary holds: built once per deployment diagram.
 * feedersOf maps an event to the indices, in model.boundaries order, of every boundary whose commands emit it.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(b + c·β·m·k) where b = boundaries, c = commands, β = branches, m = emits per branch, k = boundaries sharing a name (1 in practice) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 8 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 8.0 measured; threshold <= 10
 * - Caching: none
 */
function boundaryIndex(model) {
  const byName = new Map();
  model.boundaries.forEach((b, i) => byName.set(b.name, [...(byName.get(b.name) || []), i]));
  const commandsOf = new Map();
  const feedersOf = new Map();
  for (const c of model.commands) {
    if (!c.boundary) continue;
    commandsOf.set(c.boundary.name, [...(commandsOf.get(c.boundary.name) || []), c.name]);
    for (const e of eventsOf(c)) {
      if (!feedersOf.has(e)) feedersOf.set(e, new Set());
      for (const i of byName.get(c.boundary.name) || []) feedersOf.get(e).add(i);
    }
  }
  return { commandsOf, feedersOf };
}

/**
 * The live boundaries that feed any of these events, in model.boundaries order (so edges keep today's order).
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(s·k + k log k) where s = events, k = boundaries feeding them (derived by reading the code)
 * - Cyclomatic Complexity (CC): 2 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 2.0 measured; threshold <= 10
 * - Caching: none
 */
function feeders(ctx, events) {
  if (!ctx.scoped) return [];
  const found = new Set(events.flatMap((e) => [...(ctx.index.feedersOf.get(e) || [])]));
  return [...found].sort((a, b) => a - b).filter((i) => ctx.isLive(i)).map((i) => ctx.model.boundaries[i]);
}

/* How many regions a boundary runs in: @cost(regions=n), at most all of them. */
const regionCountOf = (b, all) => {
  const n = parseInt(b.annotations.cost && b.annotations.cost.regions, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, all) : all;
};

/* "by userId · 100 shards · in 2 regions": what a shard box says about its boundary. */
const shardSub = (b, count) => {
  const cost = b.annotations.cost || {};
  const key = b.annotations.partition && b.annotations.partition.shardKey;
  return [key ? `by ${key}` : '', cost.shardFanout ? `${cost.shardFanout} shards` : '', count > 1 ? `in ${count} regions` : 'this region only'].filter(Boolean).join(' · ');
};

/**
 * One region's shard boxes, one per live boundary, each fed by the Command API.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(b) per region, plus the command names of each boundary (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 1.0 measured; threshold <= 10
 * - Caching: none
 */
function regionShards(ctx, r) {
  ctx.model.boundaries.forEach((b, i) => {
    if (!ctx.isLive(i)) return;
    ctx.add({ id: `shard:${b.name}`, label: `${b.name} shards`, sub: shardSub(b, regionCountOf(b, ctx.regions)), kind: 'store' });
    ctx.edges.push({ from: `${r}:api`, to: `${r}:shard:${b.name}`, label: ctx.scoped ? short(ctx.index.commandsOf.get(b.name) || [], 2) : '' });
  });
}

/* Edges into one box: from each shard that feeds it, or from the Command API when none does. */
const feedEdges = (ctx, r, id, from) => {
  if (from.length) for (const b of from) ctx.edges.push({ from: `${r}:shard:${b.name}`, to: `${r}:${id}`, label: '' });
  else ctx.edges.push({ from: `${r}:api`, to: `${r}:${id}`, label: '' });
};

/**
 * One region's read model and worker boxes and the edges that feed them.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(v·s·k + w·t·k) per region where v = read models, s = sources, w = workers, t = triggers, k = feeding boundaries (derived by reading the code)
 * - Cyclomatic Complexity (CC): 5 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 5.0 measured; threshold <= 10
 * - Caching: none
 */
function regionReaders(ctx, r) {
  for (const v of ctx.model.views) {
    const c = cacheOf(v);
    ctx.add({ id: `view:${v.name}`, label: v.name, sub: c ? `cache ttl ${c.ttl || '?'}` : 'read model', kind: 'cache' });
    feedEdges(ctx, r, `view:${v.name}`, feeders(ctx, v.sources.map((s) => s.name)));
  }
  for (const [name, w] of ctx.workers) {
    ctx.add({ id: `worker:${name}`, label: name, sub: 'async worker', kind: 'worker' });
    feedEdges(ctx, r, `worker:${name}`, feeders(ctx, w.triggers));
  }
}

/**
 * Builds the deployment diagram: one stack per region, shards per boundary.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c·β·m + g·(b + v·s·k + w·t·k)) where g = regions, b = boundaries, c = commands, β = branches, m = emits, v = read models, s = sources per read model, w = workers, t = triggers per worker, k = boundaries feeding one event; linear in the boxes drawn (derived by reading the code)
 * - Cyclomatic Complexity (CC): 4 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 4.0 measured; threshold <= 10
 * - Caching: boundaryIndex is built once per call
 */
function deployment(model) {
  const regions = model.system ? model.system.regions : [];
  if (!regions.length) {
    const err = new Error('No regions declared. Add "region: a, b" to the system block to get a deployment diagram.');
    err.code = 'NO_REGIONS';
    throw err;
  }
  const nodes = [];
  const groups = [];
  const counts = model.boundaries.map((b) => regionCountOf(b, regions.length));
  const ctx = { model, regions: regions.length, edges: [], index: boundaryIndex(model), scoped: model.commands.some((c) => c.boundary), workers: workersOf(model) };
  regions.forEach((region, ri) => {
    const r = slug(region);
    const members = [];
    ctx.add = (n) => { nodes.push({ ...n, id: `${r}:${n.id}` }); members.push(`${r}:${n.id}`); };
    ctx.isLive = (i) => ri < counts[i];
    ctx.add({ id: 'api', label: 'Command API', sub: 'stateless', kind: 'process' });
    regionShards(ctx, r);
    regionReaders(ctx, r);
    groups.push({ id: `region:${r}`, label: region, members });
  });
  const note = ctx.scoped
    ? 'Inferred: each region runs the full stack unless a boundary says @cost(regions=n).'
    : 'Inferred: each region runs the full stack. State "in Boundary(key)" on commands to see which shards feed which read models.';
  return { title: `${model.system.name} · deployment`, subtitle: `${subtitle(model)}   ·   ${note}`, direction: 'LR', stack: true, nodes, edges: ctx.edges, groups };
}

/* Contexts as boxes, and the events that cross between them. A dashed arrow is an event the sender does not list in publishes. */
/**
 * Builds the context map: contexts and the events that cross them.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(k·(c + v) + e·u·w + P) where k = contexts, c = commands, v = read models, e = events, u and w = consumer and emitter contexts per event, P = publishes list length; budget O(k + c + v + e·u·w) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 9 measured; target <= 8, over budget
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 9.0 measured; threshold <= 10
 * - Caching: none
 */
function contextMap(model) {
  if (!model.contexts.length) {
    const err = new Error('No contexts declared. Wrap statements in "context Name { ... }" to get a context map.');
    err.code = 'NO_CONTEXTS';
    throw err;
  }
  const byName = new Map(model.contexts.map((c) => [c.name, c]));
  const count = (list, c) => list.filter((x) => x.context === c.name).length;
  const nodes = model.contexts.map((c) => ({
    id: `ctx:${c.name}`,
    label: c.name,
    sub: `${c.role} · ${count(model.commands, c)} commands, ${count(model.views, c)} read models`,
    kind: c.role === 'adapter' ? 'external' : 'process',
  }));
  const flows = new Map();
  for (const ev of model.events.values()) {
    const from = new Set(ev.emittedBy.map((x) => x.context).filter(Boolean));
    const to = new Set(ev.consumedBy.map((x) => x.context).filter(Boolean));
    for (const a of from) {
      for (const b of to) {
        if (a === b) continue;
        const key = `${a}>${b}`;
        if (!flows.has(key)) flows.set(key, { from: a, to: b, events: [], open: false });
        const f = flows.get(key);
        f.events.push(ev.name);
        if (!byName.get(a).publishes.includes(ev.name)) f.open = true;
      }
    }
  }
  const edges = [...flows.values()].map((f) => ({ from: `ctx:${f.from}`, to: `ctx:${f.to}`, label: short(f.events, 3), style: f.open ? 'dashed' : 'solid' }));
  const sysName = model.system ? model.system.name : 'System';
  return { title: `${sysName} · context map`, subtitle: `${subtitle(model)}   ·   dashed = an event the sender does not publish`, direction: 'LR', nodes, edges, groups: [] };
}

const BUILDERS = { context, containers, dataflow, deployment, contextmap: contextMap };

module.exports = { BUILDERS, context, containers, dataflow, deployment, contextMap };
