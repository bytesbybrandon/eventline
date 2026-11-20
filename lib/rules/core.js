'use strict';

const Model = require('../model');
const { linkIssues } = require('../diagram/links');

const NAMING = {
  kebab: { re: /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/, hint: '{aggregate}-{verb}' },
  pascal: { re: /^[A-Z][A-Za-z0-9]*$/, hint: 'PascalCase, like AccountCreated' },
};

const TRIGGER_TYPES = ['ui', 'endpoint', 'cli', 'agent'];
const ROUTE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/\S*$/;

const finding = (severity, rule, message, line) => ({ severity, rule, message, line: line || '' });

/* What every rule may look up: read model names, whether any trigger is stated, the commands a policy invokes, and which commands have a default branch. */
function facts(model) {
  return {
    viewNames: new Set(model.views.map((v) => v.name)),
    anyTrigger: model.commands.some((c) => c.triggers.length) || model.views.some((v) => v.triggers.length),
    invoked: new Set(model.policies.flatMap((p) => p.rules.map((r) => r.command && r.command.name).filter(Boolean))),
    withDefault: new Set(model.commands.filter((c) => c.branches.some((b) => b.default)).map((c) => `${c.actor}>${c.name}`)),
  };
}

/* A @trigger route is checked only when it has one: cli and agent triggers take none, and the rest must read METHOD /path. */
const routeIssue = (t, who, line) => {
  if (!t.route) return [];
  if (t.type === 'cli' || t.type === 'agent') return [finding('warn', 'trigger-route', `${who} gives a route for a ${t.type} trigger; only ui and endpoint triggers have one`, line)];
  return ROUTE.test(t.route) ? [] : [finding('warn', 'trigger-route', `${who} has route "${t.route}". Write METHOD /path, like POST /audits/{id}/fail.`, line)];
};

/* The @trigger annotations of a command or read model. */
const triggerIssues = (triggers, who, line) => triggers.flatMap((t) => [
  ...(t.name ? [] : [finding('warn', 'trigger-name', `${who} has a @trigger with no name`, line)]),
  ...(TRIGGER_TYPES.includes(t.type) ? [] : [finding('warn', 'trigger-type', `${who} has a @trigger of type "${t.type || ''}". Use ${TRIGGER_TYPES.join(', ')}.`, line)]),
  ...routeIssue(t, who, line),
]);

/* Scenarios need a name and a body, and two of one statement need different names. */
function scenarioIssues(list, who) {
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (!s.name.trim()) out.push(finding('warn', 'scenario-name', `${who} has a scenario with no name`, s.line));
    if (!s.text.trim()) out.push(finding('warn', 'scenario-empty', `${who} has an empty scenario "${s.name}"`, s.line));
    if (seen.has(s.name)) out.push(finding('warn', 'scenario-duplicate', `${who} has two scenarios named "${s.name}"`, s.line));
    seen.add(s.name);
  }
  return out;
}

/* The event-naming style the system block asks for, kebab by default. */
const eventStyle = (model) => (model.system && model.system.attrs['event-naming']) || 'kebab';

/* Every event name matches the naming style, and the style is one we know. */
function namingIssues(model) {
  const style = eventStyle(model);
  if (style === 'none') return [];
  if (!NAMING[style]) return [finding('warn', 'event-naming', `Unknown event-naming "${style}". Use kebab, pascal or none.`, model.system && model.system.line)];
  return [...model.events.keys()].filter((ev) => !NAMING[style].re.test(ev)).map((ev) => finding('warn', 'event-naming', `Event "${ev}" does not match ${NAMING[style].hint}`));
}

/* command-inputs and no-events. */
function inputIssues(cmd, id) {
  const out = [];
  if (!cmd.on.length && !cmd.from.length) out.push(finding('info', 'command-inputs', `Command "${id}" lists no facts it needs (fine for a command that creates something)`, cmd.line));
  if (!cmd.branches.some((b) => b.emits.length)) out.push(finding('warn', 'no-events', `Command "${id}" never records an event; every command records at least one on its happy path`, cmd.line));
  return out;
}

/* default-rejects, rejection-as-event and missing-default. */
function branchIssues(cmd, id, f) {
  const out = [];
  for (const b of cmd.branches) {
    if (b.default && b.reject) out.push(finding('warn', 'default-rejects', `Command "${id}" refuses on its --[default]--> branch with ${b.reject}; the default branch should record events`, b.line));
    for (const e of b.emits) {
      if (/(-rejected|Rejected)$/.test(e.event)) out.push(finding('info', 'rejection-as-event', `Command "${id}" emits "${e.event}". If nothing is recorded, write --[...]--> reject CODE instead`, b.line));
    }
  }
  if (!f.withDefault.has(`${cmd.actor}>${cmd.name}`)) out.push(finding('warn', 'missing-default', `Command "${id}" has no --[default]--> branch`, cmd.line));
  return out;
}

/* on-facts, from-facts and freshness. */
function factIssues(cmd, id, f) {
  const out = [];
  for (const x of cmd.on) {
    if (f.viewNames.has(x.name)) out.push(finding('error', 'on-facts', `Command "${id}" lists read model "${x.name}" in on [...]; on takes events, from takes read models`, cmd.line));
  }
  for (const x of cmd.from) {
    if (!f.viewNames.has(x.name)) out.push(finding('warn', 'from-facts', `Command "${id}" reads "${x.name}" in from [...], but no such read model is declared`, cmd.line));
    else if (!x.freshness) out.push(finding('info', 'freshness', `Command "${id}" reads read model "${x.name}" without @fresh<>, @eventual or @strong`, cmd.line));
  }
  return out;
}

/* unknown-actor, unknown-boundary and command-boundary. */
function placementIssues(model, cmd, id) {
  const out = [];
  if (model.actorKind(cmd.actor) === 'unknown') out.push(finding('info', 'unknown-actor', `"${cmd.actor}" in "${cmd.name}" is neither a declared actor nor a system external`, cmd.line));
  if (cmd.boundary) {
    if (!model.boundaries.some((b) => b.name === cmd.boundary.name)) out.push(finding('error', 'unknown-boundary', `Command "${id}" is in boundary "${cmd.boundary.name}", which is not declared`, cmd.line));
  } else if (model.boundaries.length) out.push(finding('info', 'command-boundary', `Command "${id}" does not say which boundary it is in (add: in BoundaryName(key))`, cmd.line));
  return out;
}

/* source-system and optional-on. */
function sourceIssues(cmd, id) {
  const out = [];
  if (cmd.source && !cmd.source.system) out.push(finding('warn', 'source-system', `Command "${id}" has a @source with no system`, cmd.line));
  if (cmd.on.some((x) => x.optional)) out.push(finding('warn', 'optional-on', `Command "${id}" marks an on [...] fact @optional; only from [...] reads can be empty`, cmd.line));
  return out;
}

/* command-trigger: once any statement says how it is reached, every command should, unless a policy invokes it. */
const triggerHint = (cmd, id, f) => (f.anyTrigger && !cmd.triggers.length && !f.invoked.has(cmd.name)
  ? [finding('info', 'command-trigger', `Command "${id}" does not say what is used to reach it (add: @trigger(type=ui, name="..."))`, cmd.line)]
  : []);

/* Every command rule, in the order a command's findings have always come in. */
const commandIssues = (model, f) => model.commands.flatMap((cmd) => {
  const id = `${cmd.actor} -> ${cmd.name}`;
  return [
    ...inputIssues(cmd, id), ...branchIssues(cmd, id, f), ...factIssues(cmd, id, f), ...placementIssues(model, cmd, id),
    ...triggerIssues(cmd.triggers, `Command "${id}"`, cmd.line), ...sourceIssues(cmd, id), ...scenarioIssues(cmd.scenarios, `Command "${id}"`), ...triggerHint(cmd, id, f),
  ];
});

/* query-returns and projection-trigger. */
function queryIssues(view) {
  const out = [];
  if (view.query && !['one', 'list', 'page'].includes(view.query.returns)) out.push(finding('warn', 'query-returns', `Read model "${view.name}" has @query returns "${view.query.returns || ''}". Use one, list or page.`, view.line));
  if (view.annotations.projection && view.triggers.length) out.push(finding('warn', 'projection-trigger', `Read model "${view.name}" is a @projection, which is never shown, but has a @trigger`, view.line));
  return out;
}

/* Every read model rule, in order. */
function viewIssues(model, f) {
  return model.views.flatMap((view) => [
    ...(view.sources.length ? [] : [finding('warn', 'view-sources', `Read model "${view.name}" has no source events`, view.line)]),
    ...triggerIssues(view.triggers, `Read model "${view.name}"`, view.line),
    ...queryIssues(view),
    ...scenarioIssues(view.scenarios, `Read model "${view.name}"`),
    ...view.sources.filter((s) => f.viewNames.has(s.name)).map((s) => finding('error', 'view-from-view', `Read model "${view.name}" projects from read model "${s.name}"; read models project from events`, view.line)),
  ]);
}

/* How a policy's findings name it. */
const policyWho = (pol) => (pol.name ? pol.name : pol.trigger.readModels ? Model.policyLabel(pol) : `on "${Model.policyLabel(pol)}"`);

/* from-facts and policy-guard for every policy. */
function policyIssues(model, f) {
  return model.policies.flatMap((pol) => {
    const who = policyWho(pol);
    return [
      ...pol.from.filter((x) => !f.viewNames.has(x.name)).map((x) => finding('warn', 'from-facts', `Policy ${who} reads "${x.name}" in from [...], but no such read model is declared`, pol.line)),
      ...(pol.trigger.event ? pol.rules.filter((r) => !r.guard).map((r) => finding('info', 'policy-guard', `Policy ${who} has an unguarded rule`, r.line)) : []),
    ];
  });
}

/* unpublished-event: a context reads an event another context emits but does not publish. */
function contextIssues(model) {
  const out = [];
  const ctxByName = new Map(model.contexts.map((c) => [c.name, c]));
  for (const ev of model.events.values()) {
    const emitters = new Set(ev.emittedBy.map((x) => x.context).filter(Boolean));
    for (const use of ev.consumedBy) {
      if (!use.context || emitters.size === 0 || emitters.has(use.context)) continue;
      for (const from of emitters) {
        if (!ctxByName.get(from).publishes.includes(ev.name)) out.push(finding('warn', 'unpublished-event', `Context ${use.context} reads "${ev.name}" from ${from}, which does not list it in publishes`));
      }
    }
  }
  return out;
}

/* assumed-events, boundaries and the @link rules. */
function modelIssues(model) {
  const assumed = model.assumedEvents();
  return [
    ...(assumed.length ? [finding('info', 'assumed-events', `No command or policy emits: ${assumed.join(', ')}. The model assumes these facts.`)] : []),
    ...(model.boundaries.length === 0 && model.commands.length ? [finding('info', 'boundaries', 'No boundary declared; commands have no stated consistency scope')] : []),
    ...linkIssues(model).map((i) => finding(i.severity, i.rule, i.message, i.line)),
  ];
}

/**
 * Core rules: naming, inputs, branches, boundaries, triggers, contexts and links.
 * Each group is a pure function from the model to its findings; they are concatenated in the order findings have always come in.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c·(β·m + o + f + t + s) + v·(s + t) + p·(f + r) + e·u·k + L) where c = commands, β = branches, m = emits, o and f = on and from facts, t = triggers, s = scenarios or sources, v = read models, p = policies, r = rules per policy, e = distinct events, u = consumers per event, k = contexts, L = linkIssues cost; linear in model size (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 1.0 measured; threshold <= 10
 * - Caching: facts() builds the lookups once per call
 */
function check(model) {
  const f = facts(model);
  return [...namingIssues(model), ...commandIssues(model, f), ...viewIssues(model, f), ...policyIssues(model, f), ...contextIssues(model), ...modelIssues(model)];
}

module.exports = { coreIssues: check };
