'use strict';

/*
 * The rules that come with a profile, plus the one core rule that needs real parsing (timers).
 * Each rule is a function from a model to [{ severity, rule, message, line }]. The catalogue says
 * what each one means; a test checks the two agree.
 */

const { BY_ID } = require('./catalogue');

const issue = (rule, message, line) => ({ severity: BY_ID.get(rule).severity, rule, message, line: line || '' });
const bare = (n) => String(n).replace(/\?$/, '');
/* The names bound in an argument list: "userId, window: 60s" gives userId and window. */
const names = (text) => String(text || '').split(',').map((p) => /^\s*([A-Za-z_]\w*)/.exec(p)).filter(Boolean).map((m) => m[1]);
/* @slice("Name") */
const sliceOf = (annotations) => {
  const s = [].concat((annotations && annotations.slice) || [])[0];
  if (s && typeof s === 'object') return (s._ && s._[0]) || s.name || null;
  return typeof s === 'string' ? s : null;
};
/* @dedupe(eventId) and @correlate(orderRef) name fields of the outside facts a statement consumes that its own payload does not carry:
   the key that tells a repeat delivery from a new one, and the key that ties the fact to something here. They count as supplied. */
const keys = (annotations) => ['dedupe', 'correlate'].flatMap((n) => [].concat((annotations && annotations[n]) || []).flatMap((a) => (a && typeof a === 'object' && a._ ? a._ : typeof a === 'string' ? [a] : [])));

/* A field written `name: type` is carried, not computed: the type sits where an expression would. */
const TYPE = /^(text|string|number|int|integer|float|id|uuid|datetime|date|time|yesno|bool|boolean)$|^list\[.+\]$|^[A-Z][A-Za-z0-9_]*$/;
const carried = (f) => !f.expr || TYPE.test(f.expr.trim());
const quote = (list) => list.map((x) => `"${x}"`).join(', ');

/* Every field name an event is recorded with, over all the places that record it. */
function eventFields(model) {
  const out = new Map();
  const add = (event, fields) => {
    if (!out.has(event)) out.set(event, new Set());
    for (const f of fields) out.get(event).add(f.name);
  };
  for (const c of model.commands) for (const b of c.branches) for (const e of b.emits) add(e.event, e.fields);
  for (const p of model.policies) {
    if (p.trigger.event) add(p.trigger.event, p.trigger.fields || []);
    for (const r of p.rules) for (const e of r.emits) add(e.event, e.fields);
  }
  return out;
}

/* ------------------------------------------------------------------ core */

const FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const FIELD_NAMES = ['minute', 'hour', 'day of month', 'month', 'day of week'];
function cronField(field, [low, high]) {
  return field.split(',').every((part) => {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) return false;
    const inRange = (n) => Number(n) >= low && Number(n) <= high;
    if (m[1] !== '*' && !inRange(m[1])) return false;
    if (m[2] && !inRange(m[2])) return false;
    return !m[3] || Number(m[3]) > 0;
  });
}

function scheduleIssues(model) {
  const out = [];
  for (const p of model.policies) {
    const s = p.trigger.schedule;
    if (!s) continue;
    const interval = /^every (\d+) /.exec(s);
    if (interval) {
      if (Number(interval[1]) < 1) out.push(issue('schedule-invalid', `Timer "${s}" never fires: an interval needs a whole number above zero`, p.line));
      continue;
    }
    const cron = /^cron "(.*)"$/.exec(s);
    if (!cron) continue;
    const fields = cron[1].trim().split(/\s+/);
    if (fields.length !== 5) { out.push(issue('schedule-invalid', `Timer ${s} needs five parts: minute, hour, day of month, month and day of week`, p.line)); continue; }
    const bad = fields.findIndex((f, i) => !cronField(f, FIELD_RANGES[i]));
    if (bad >= 0) out.push(issue('schedule-invalid', `Timer ${s} has "${fields[bad]}" where a ${FIELD_NAMES[bad]} belongs, and that is not valid`, p.line));
  }
  return out;
}

/* Scenarios written as steps are checked against the command they sit under. */
function scenarioStepIssues(model) {
  const out = [];
  const check = (owner, kind) => {
    for (const sc of owner.scenarios) {
      const st = sc.steps;
      if (!st) continue;
      if (kind === 'view') { out.push(issue('scenario-steps', `Scenario "${sc.name}" on view "${owner.name}" is written as steps, which a view does not take yet. Write it as prose`, sc.line)); continue; }
      if (!st.when) out.push(issue('scenario-steps', `Scenario "${sc.name}" has no when step`, sc.line));
      else if (st.when.name !== owner.name) out.push(issue('scenario-steps', `Scenario "${sc.name}" sits under "${owner.name}" but its when step runs "${st.when.name}"`, st.when.line));
      if (!st.then) out.push(issue('scenario-steps', `Scenario "${sc.name}" has no then step`, sc.line));
      const known = (e) => model.events.has(e);
      for (const g of st.given) if (!known(g.event)) out.push(issue('scenario-unknown-event', `Scenario "${sc.name}" gives "${g.event}", which no command or policy records or reads`, g.line));
      if (st.then && st.when && st.when.name === owner.name) {
        const same = model.commands.filter((c) => c.name === owner.name && c.actor === owner.actor);
        const emits = new Set(same.flatMap((c) => c.branches.flatMap((b) => b.emits.map((e) => e.event))));
        const rejects = new Set(same.flatMap((c) => c.branches.map((b) => b.reject).filter(Boolean)));
        if (st.then.reject) { if (!rejects.has(st.then.reject)) out.push(issue('scenario-then-mismatch', `Scenario "${sc.name}" expects rejection ${st.then.reject}, which "${owner.name}" does not have`, st.then.line)); }
        else for (const e of st.then.events) {
          if (!known(e.event)) out.push(issue('scenario-unknown-event', `Scenario "${sc.name}" expects "${e.event}", which no command or policy records or reads`, st.then.line));
          else if (!emits.has(e.event)) out.push(issue('scenario-then-mismatch', `Scenario "${sc.name}" expects "${e.event}", which "${owner.name}" never records`, st.then.line));
        }
      }
    }
  };
  for (const c of model.commands) check(c, 'command');
  for (const v of model.views) check(v, 'view');
  return out;
}

/* ---------------------------------------------------------- eventmodeling */

function unsourcedEventFields(model) {
  const out = [];
  const fieldsOf = eventFields(model);
  const shape = new Map(model.views.map((v) => [v.name, v.shape.map((f) => f.name)]));
  const known = (event) => [...(fieldsOf.get(event) || [])];

  /* A fact nothing records, or a view nobody declares, may supply anything, so what it supplies is unknown. */
  const unknownSource = (facts) => facts.some((f) => (model.events.has(f.name) ? model.events.get(f.name).emittedBy.length === 0 : !shape.has(f.name)));

  for (const cmd of model.commands) {
    if (unknownSource([...cmd.on, ...cmd.from])) continue;
    const supplied = new Set([...cmd.params.map(bare), ...names(cmd.boundary && cmd.boundary.args), ...keys(cmd.annotations)]);
    for (const f of cmd.on) { names(f.args).forEach((n) => supplied.add(n)); if (f.alias) supplied.add(f.alias); known(f.name).forEach((n) => supplied.add(n)); }
    for (const f of cmd.from) { names(f.args).forEach((n) => supplied.add(n)); if (f.alias) supplied.add(f.alias); (shape.get(f.name) || []).forEach((n) => supplied.add(n)); }
    for (const b of cmd.branches) {
      for (const e of b.emits) {
        const missing = e.fields.filter((f) => carried(f) && !supplied.has(f.name)).map((f) => f.name);
        if (missing.length) out.push(issue('unsourced-event-field', `Event "${e.event}" carries ${quote(missing)}, which command "${cmd.name}" does not supply. Add ${missing.length === 1 ? 'it' : 'them'} to the command or a fact it needs, or compute ${missing.length === 1 ? 'it' : 'them'} (name: expression)`, b.line));
      }
    }
  }
  for (const pol of model.policies) {
    const who = pol.trigger.event ? `on "${pol.trigger.event}"` : `on "${pol.trigger.schedule}"`;
    if (unknownSource(pol.from)) continue;
    const supplied = new Set([...(pol.trigger.fields || []).map((f) => f.name), ...keys(pol.annotations)]);
    for (const f of pol.from) { names(f.args).forEach((n) => supplied.add(n)); if (f.alias) supplied.add(f.alias); (shape.get(f.name) || []).forEach((n) => supplied.add(n)); }
    for (const r of pol.rules) {
      if (r.worker) continue; // what a worker records is the worker's own business, not something the trigger must carry
      for (const e of r.emits) {
        const missing = e.fields.filter((f) => carried(f) && !supplied.has(f.name)).map((f) => f.name);
        if (missing.length) out.push(issue('unsourced-event-field', `Event "${e.event}" carries ${quote(missing)}, which policy ${who} does not supply. Add ${missing.length === 1 ? 'it' : 'them'} to what the trigger carries, or compute ${missing.length === 1 ? 'it' : 'them'} (name: expression)`, r.line));
      }
    }
  }
  return out;
}

function unsourcedViewFields(model) {
  const out = [];
  const fieldsOf = eventFields(model);
  for (const view of model.views) {
    if (!view.sources.length) continue;
    const events = view.sources.map((s) => model.events.get(s.name));
    // A source nothing records is an assumed fact: its payload is unknown, so there is nothing to check against.
    if (events.some((e) => !e || e.emittedBy.length === 0)) continue;
    const have = new Set([...view.params.map(bare), ...view.sources.flatMap((s) => names(s.args)), ...keys(view.annotations)]);
    for (const s of view.sources) (fieldsOf.get(s.name) || []).forEach((n) => have.add(n));
    const missing = view.shape.filter((f) => carried(f) && !have.has(f.name)).map((f) => f.name);
    if (missing.length) out.push(issue('unsourced-view-field', `View "${view.name}" shows ${quote(missing)}, which no event it projects from carries. Add ${missing.length === 1 ? 'it' : 'them'} to an event, or compute ${missing.length === 1 ? 'it' : 'them'} (name: expression)`, view.line));
  }
  return out;
}

/* Strongly connected components, so a loop is found wherever it runs. */
function loops(edges) {
  let index = 0;
  const stack = [];
  const meta = new Map();
  const found = [];
  const visit = (v) => {
    meta.set(v, { index, low: index, on: true });
    index++;
    stack.push(v);
    for (const w of edges.get(v) || []) {
      if (!meta.has(w)) { visit(w); meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).low); }
      else if (meta.get(w).on) meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).index);
    }
    if (meta.get(v).low === meta.get(v).index) {
      const group = [];
      let w;
      do { w = stack.pop(); meta.get(w).on = false; group.push(w); } while (w !== v);
      if (group.length > 1) found.push(group);
    }
  };
  for (const v of edges.keys()) if (!meta.has(v)) visit(v);
  return found;
}

function dependencyCycles(model) {
  const out = [];
  const nodes = new Map();
  const edges = new Map();
  const node = (key, label, line) => { if (!nodes.has(key)) { nodes.set(key, { label, line }); edges.set(key, new Set()); } };
  const edge = (from, to) => { if (edges.has(from) && edges.has(to) && from !== to) edges.get(from).add(to); };
  for (const c of model.commands) node(`c:${c.name}`, `command "${c.name}"`, c.line);
  model.policies.forEach((p, i) => node(`p:${i}`, `policy on "${p.trigger.event || p.trigger.schedule}"`, p.line));
  const emitters = (event) => ((model.events.get(event) || {}).emittedBy || []).flatMap((e) => {
    if (e.kind === 'command') return [`c:${e.name}`];
    return model.policies.flatMap((p, i) => ((p.trigger.event || p.trigger.schedule) === e.name ? [`p:${i}`] : []));
  });
  for (const c of model.commands) for (const f of c.on) for (const from of emitters(f.name)) edge(from, `c:${c.name}`);
  model.policies.forEach((p, i) => {
    if (p.trigger.event) for (const from of emitters(p.trigger.event)) edge(from, `p:${i}`);
    for (const r of p.rules) if (r.command) edge(`p:${i}`, `c:${r.command.name}`);
  });
  for (const group of loops(edges)) {
    const ordered = group.sort((a, b) => nodes.get(a).line - nodes.get(b).line);
    out.push(issue('dependency-cycle', `${ordered.map((k) => nodes.get(k).label).join(', ')} wait on each other in a loop, so no order of work can start. Break it with an event that does not depend on the others`, nodes.get(ordered[0]).line));
  }
  return out;
}

function sliceShapes(model) {
  const out = [];
  const group = (items, nameOf, ruleId, what) => {
    const by = new Map();
    for (const item of items) {
      const slice = sliceOf(item.annotations);
      if (!slice) continue;
      if (!by.has(slice)) by.set(slice, new Map());
      if (!by.get(slice).has(nameOf(item))) by.get(slice).set(nameOf(item), item.line);
    }
    for (const [slice, members] of by) {
      if (members.size < 2) continue;
      const list = [...members.entries()].sort((a, b) => a[1] - b[1]);
      out.push(issue(ruleId, `Slice "${slice}" holds ${list.length} ${what}: ${quote(list.map(([n]) => n))}. ${ruleId === 'slice-multiple-views' ? 'A slice owns one query, so fold them into one view shaped for how it is read. Reading views other slices define is fine' : 'A write slice has one command, so give each its own slice'}`, list[1][1]));
    }
  };
  group(model.commands, (c) => c.name, 'slice-multiple-commands', 'commands');
  group(model.views, (v) => v.name, 'slice-multiple-views', 'read models');
  return out;
}

function scenarioCoverage(model) {
  const all = [...model.commands, ...model.views];
  if (!all.length) return [];
  const without = [];
  const seen = new Set();
  for (const x of all) {
    const key = `${x.actor ? 'c' : 'v'}:${x.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const has = all.some((y) => y.name === x.name && !!y.actor === !!x.actor && y.scenarios.length);
    if (!has) without.push(x);
  }
  if (!without.length) return [];
  return [issue('slice-no-scenario', `${without.length} of ${seen.size} commands and views have no scenario, starting with "${without[0].name}"`, without[0].line)];
}

/* A command an outside system issues is a fact that can arrive twice. Say which field tells the copies apart. */
function dedupeCoverage(model) {
  const out = [];
  for (const c of model.commands) {
    if (model.actorKind(c.actor) !== 'external' || keys(c.annotations).length) continue;
    if (c.annotations.dedupe || c.annotations.correlate) continue;
    out.push(issue('translation-no-dedupe', `Command "${c.name}" comes from outside system "${c.actor}", which can deliver the same fact twice. Say which field tells a repeat from a new one: @dedupe(eventId)`, c.line));
  }
  return out;
}

function hints(model) {
  const out = [];
  for (const c of model.commands) {
    for (const b of c.branches) {
      const events = [...new Set(b.emits.map((e) => e.event))];
      if (b.default && events.length > 1) out.push(issue('many-events', `Command "${c.name}" records ${events.length} events on its happy path: ${quote(events)}. Right if they are one fact told in parts; if they are two steps, a policy can take the second`, b.line));
    }
  }
  for (const v of model.views) {
    if (v.sources.length >= 4) out.push(issue('view-many-sources', `${v.sources.length} events feed view "${v.name}". Combining streams is fine, but each event ties the view to the command that records it`, v.line));
  }
  return out;
}

const KINDS = ['question', 'assumption', 'request'];
const CATEGORIES = ['action', 'data', 'next', 'rule', 'example', 'view', 'who', 'time'];
const asList = (x) => [].concat(x || []).filter((v) => v !== undefined);
const text = (h) => (h && typeof h === 'object' ? (h._ && h._[0]) || '' : typeof h === 'string' ? h : '');
/* Everything that can carry @hotspot or @accept: [{ item, line }]. */
function carriers(model) {
  return [...model.commands, ...model.views, ...model.policies, ...model.boundaries].filter((x) => x.annotations);
}
function hotspotIssues(model, open) {
  const out = [];
  for (const c of carriers(model)) {
    for (const h of asList(c.annotations.hotspot)) {
      const q = text(h).trim();
      const o = h && typeof h === 'object' ? h : {};
      const bad = !q ? 'has no question' : o.kind && !KINDS.includes(o.kind) ? `has kind "${o.kind}", which is not one of ${KINDS.join(', ')}` : o.category && !CATEGORIES.includes(o.category) ? `has category "${o.category}", which is not one of ${CATEGORIES.join(', ')}` : o.status && !['open', 'resolved'].includes(o.status) ? `has status "${o.status}", which is not open or resolved` : o.kind === 'request' && !o.concerns ? 'is a request, which says what must change with concerns="..."' : o.kind !== 'request' && o.concerns ? 'has concerns, which only a request has' : null;
      if (bad) out.push(issue('hotspot-invalid', `A @hotspot on "${c.name || c.trigger.event || c.trigger.schedule}" ${bad}`, c.line));
      else if (open && (o.status || 'open') === 'open') out.push(issue('hotspot-open', `Open ${o.kind || 'question'}: ${q}`, c.line));
    }
  }
  return out;
}
function acceptIssues(model, known) {
  const out = [];
  for (const c of carriers(model)) {
    for (const a of asList(c.annotations.accept)) {
      const o = a && typeof a === 'object' ? a : {};
      const who = c.name || c.trigger.event || c.trigger.schedule;
      if (!o.rule || !known.has(o.rule)) out.push(issue('accept-invalid', `An @accept on "${who}" needs rule="..." naming a rule in the catalogue${o.rule ? `, and "${o.rule}" is not one` : ''}`, c.line));
      else if (!String(o.reason || '').trim()) out.push(issue('accept-invalid', `The @accept of ${o.rule} on "${who}" needs a reason="..."`, c.line));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- slicerm */

function rejectionCoverage(model) {
  const scenarios = [...model.commands, ...model.views].some((x) => x.scenarios.length);
  if (!scenarios) return []; // scenarios are kept elsewhere, so there is nothing to compare against
  const out = [];
  for (const c of model.commands) {
    const own = model.commands.filter((o) => o.name === c.name).flatMap((o) => o.scenarios);
    const text = own.map((s) => `${s.name}\n${s.text}`).join('\n');
    const typed = new Set(own.map((s) => s.steps && s.steps.then && s.steps.then.reject).filter(Boolean));
    for (const b of c.branches) {
      if (b.reject && !typed.has(b.reject) && !new RegExp(`\\b${b.reject}\\b`).test(text)) out.push(issue('rejection-uncovered', `Command "${c.name}" can refuse with ${b.reject}, and no scenario names it`, b.line));
    }
  }
  return out;
}

function routeDuplicates(model) {
  const seen = new Map();
  const add = (kind, item, context) => {
    for (const t of item.triggers) {
      if (!t.route) continue;
      const key = `${context || ''} ${t.route}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push({ target: `${kind} "${item.name}"`, route: t.route, line: item.line });
    }
  };
  for (const c of model.commands) add('command', c, c.context);
  for (const v of model.views) add('view', v, v.context);
  const out = [];
  for (const list of seen.values()) {
    const targets = [...new Set(list.map((x) => x.target))];
    if (targets.length < 2) continue;
    const first = list[0].target;
    for (const x of list) if (x.target !== first) out.push(issue('route-duplicate', `${x.route} is also used by ${targets.filter((t) => t !== x.target).join(', ')}`, x.line));
  }
  return out;
}

module.exports = {
  scheduleIssues, scenarioStepIssues, hotspotIssues, acceptIssues,
  eventmodelingIssues: (model) => [...unsourcedEventFields(model), ...unsourcedViewFields(model), ...dependencyCycles(model), ...sliceShapes(model), ...scenarioCoverage(model), ...dedupeCoverage(model), ...hints(model)],
  slicermIssues: (model) => [...rejectionCoverage(model), ...routeDuplicates(model)],
  sliceOf,
};
