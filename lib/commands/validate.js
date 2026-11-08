'use strict';

const NAMING = {
  kebab: { re: /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/, hint: '{aggregate}-{verb}' },
  pascal: { re: /^[A-Z][A-Za-z0-9]*$/, hint: 'PascalCase, like AccountCreated' },
};

const TRIGGER_TYPES = ['ui', 'endpoint', 'cli', 'agent'];
const ROUTE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/\S*$/;

/* Returns the issues found. Kept separate from run() so it can be tested and reused. */
function check(model) {
  const issues = [];
  const add = (severity, rule, message, line) => issues.push({ severity, rule, message, line: line || '' });
  const viewNames = new Set(model.views.map((v) => v.name));
  const anyTrigger = model.commands.some((c) => c.triggers.length) || model.views.some((v) => v.triggers.length);
  const invoked = new Set(model.policies.flatMap((p) => p.rules.map((r) => r.command && r.command.name).filter(Boolean)));
  const checkTrigger = (t, who, line) => {
    if (!t.name) add('warn', 'trigger-name', `${who} has a @trigger with no name`, line);
    if (!TRIGGER_TYPES.includes(t.type)) add('warn', 'trigger-type', `${who} has a @trigger of type "${t.type || ''}". Use ${TRIGGER_TYPES.join(', ')}.`, line);
    if (t.route && (t.type === 'cli' || t.type === 'agent')) add('warn', 'trigger-route', `${who} gives a route for a ${t.type} trigger; only ui and endpoint triggers have one`, line);
    else if (t.route && !ROUTE.test(t.route)) add('warn', 'trigger-route', `${who} has route "${t.route}". Write METHOD /path, like POST /audits/{id}/fail.`, line);
  };

  const style = (model.system && model.system.attrs['event-naming']) || 'kebab';
  if (style !== 'none' && !NAMING[style]) add('warn', 'event-naming', `Unknown event-naming "${style}". Use kebab, pascal or none.`, model.system && model.system.line);
  else if (style !== 'none') {
    for (const ev of model.events.keys()) {
      if (!NAMING[style].re.test(ev)) add('warn', 'event-naming', `Event "${ev}" does not match ${NAMING[style].hint}`);
    }
  }

  for (const cmd of model.commands) {
    const id = `${cmd.actor} -> ${cmd.name}`;
    if (!cmd.on.length && !cmd.from.length) add('info', 'command-inputs', `Command "${id}" lists no facts it needs (fine for a command that creates something)`, cmd.line);
    if (!cmd.branches.some((b) => b.emits.length)) add('warn', 'no-events', `Command "${id}" never records an event; every command records at least one on its happy path`, cmd.line);
    for (const b of cmd.branches) {
      if (b.default && b.reject) add('warn', 'default-rejects', `Command "${id}" refuses on its --[default]--> branch with ${b.reject}; the default branch should record events`, b.line);
      for (const e of b.emits) {
        if (/(-rejected|Rejected)$/.test(e.event)) add('info', 'rejection-as-event', `Command "${id}" emits "${e.event}". If nothing is recorded, write --[...]--> reject CODE instead`, b.line);
      }
    }
    const hasDefault = model.commands.some((c) => c.actor === cmd.actor && c.name === cmd.name && c.branches.some((b) => b.default));
    if (!hasDefault) add('warn', 'missing-default', `Command "${id}" has no --[default]--> branch`, cmd.line);
    for (const f of cmd.on) {
      if (viewNames.has(f.name)) add('error', 'on-facts', `Command "${id}" lists view "${f.name}" in on [...]; on takes events, from takes views`, cmd.line);
    }
    for (const f of cmd.from) {
      if (!viewNames.has(f.name)) add('warn', 'from-facts', `Command "${id}" reads "${f.name}" in from [...], but no such view is declared`, cmd.line);
      else if (!f.freshness) add('info', 'freshness', `Command "${id}" reads view "${f.name}" without @fresh<>, @eventual or @strong`, cmd.line);
    }
    if (model.actorKind(cmd.actor) === 'unknown') add('info', 'unknown-actor', `"${cmd.actor}" in "${cmd.name}" is neither a declared actor nor a system external`, cmd.line);
    if (cmd.boundary) {
      if (!model.boundaries.some((b) => b.name === cmd.boundary.name)) add('error', 'unknown-boundary', `Command "${id}" is in boundary "${cmd.boundary.name}", which is not declared`, cmd.line);
    } else if (model.boundaries.length) add('info', 'command-boundary', `Command "${id}" does not say which boundary it is in (add: in BoundaryName(key))`, cmd.line);
    for (const t of cmd.triggers) checkTrigger(t, `Command "${id}"`, cmd.line);
    if (cmd.source && !cmd.source.system) add('warn', 'source-system', `Command "${id}" has a @source with no system`, cmd.line);
    if (cmd.on.some((f) => f.optional)) add('warn', 'optional-on', `Command "${id}" marks an on [...] fact @optional; only from [...] reads can be empty`, cmd.line);
    if (anyTrigger && !cmd.triggers.length && !invoked.has(cmd.name)) add('info', 'command-trigger', `Command "${id}" does not say what is used to reach it (add: @trigger(type=ui, name="..."))`, cmd.line);
  }

  for (const view of model.views) {
    if (!view.sources.length) add('warn', 'view-sources', `View "${view.name}" has no source events`, view.line);
    for (const t of view.triggers) checkTrigger(t, `View "${view.name}"`, view.line);
    if (view.query && !['one', 'list', 'page'].includes(view.query.returns)) add('warn', 'query-returns', `View "${view.name}" has @query returns "${view.query.returns || ''}". Use one, list or page.`, view.line);
    if (view.annotations.projection && view.triggers.length) add('warn', 'projection-trigger', `View "${view.name}" is a @projection, which is never shown, but has a @trigger`, view.line);
    for (const s of view.sources) {
      if (viewNames.has(s.name)) add('error', 'view-from-view', `View "${view.name}" projects from view "${s.name}"; views project from events`, view.line);
    }
  }

  for (const pol of model.policies) {
    const who = pol.trigger.event ? `on "${pol.trigger.event}"` : `on "${pol.trigger.schedule}"`;
    for (const f of pol.from) {
      if (!viewNames.has(f.name)) add('warn', 'from-facts', `Policy ${who} reads "${f.name}" in from [...], but no such view is declared`, pol.line);
    }
    for (const r of pol.rules) {
      if (!r.guard && pol.trigger.event) add('info', 'policy-guard', `Policy ${who} has an unguarded rule`, r.line);
    }
  }

  const ctxByName = new Map(model.contexts.map((c) => [c.name, c]));
  for (const ev of model.events.values()) {
    const emitters = new Set(ev.emittedBy.map((x) => x.context).filter(Boolean));
    for (const use of ev.consumedBy) {
      if (!use.context || emitters.size === 0 || emitters.has(use.context)) continue;
      for (const from of emitters) {
        if (!ctxByName.get(from).publishes.includes(ev.name)) add('warn', 'unpublished-event', `Context ${use.context} reads "${ev.name}" from ${from}, which does not list it in publishes`);
      }
    }
  }

  const assumed = model.assumedEvents();
  if (assumed.length) add('info', 'assumed-events', `No command or policy emits: ${assumed.join(', ')}. The model assumes these facts.`);

  if (model.boundaries.length === 0 && model.commands.length) add('info', 'boundaries', 'No boundary declared; commands have no stated consistency scope');
  return issues;
}

module.exports = {
  check,
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const issues = check(model);
    if (opts.format === 'json') { console.log(fmt.json(issues)); return; }
    if (issues.length === 0) { console.log('validate: 0 issues found\n'); return; }
    console.log(`validate: ${issues.length} issue(s)\n`);
    console.log(fmt.formatOutput('issues', issues, ['severity', 'rule', 'message', 'line']));
    if (issues.some((i) => i.severity === 'error')) process.exitCode = 1;
  }
};
