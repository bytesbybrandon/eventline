'use strict';

const EVENT_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

/* Returns the issues found. Kept separate from run() so it can be tested and reused. */
function check(model) {
  const issues = [];
  const add = (severity, rule, message, line) => issues.push({ severity, rule, message, line: line || '' });
  const viewNames = new Set(model.views.map((v) => v.name));

  for (const ev of model.events.keys()) {
    if (!EVENT_NAME.test(ev)) add('warn', 'event-naming', `Event "${ev}" does not match {aggregate}-{verb}`);
  }

  for (const cmd of model.commands) {
    const id = `${cmd.actor} -> ${cmd.name}`;
    if (!cmd.on.length && !cmd.from.length) add('warn', 'command-inputs', `Command "${id}" has no on/from clauses`, cmd.line);
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
  }

  for (const view of model.views) {
    if (!view.sources.length) add('warn', 'view-sources', `View "${view.name}" has no source events`, view.line);
    for (const s of view.sources) {
      if (viewNames.has(s.name)) add('error', 'view-from-view', `View "${view.name}" projects from view "${s.name}"; views project from events`, view.line);
    }
  }

  for (const pol of model.policies) {
    for (const r of pol.rules) {
      if (!r.guard) add('info', 'policy-guard', `Policy on "${pol.trigger.event}" has an unguarded rule`, r.line);
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
