'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const issues = [];

    const eventNameRe = /^[a-z]+(-[a-z]+)*$/;
    for (const ev of model.events) {
      if (!eventNameRe.test(ev)) {
        issues.push({ severity: 'warn', rule: 'event-naming', message: `Event "${ev}" does not match {aggregate}-{verb} pattern` });
      }
    }

    for (const cmd of model.commands) {
      if (!cmd.on.length && !cmd.from.length) {
        issues.push({ severity: 'warn', rule: 'command-inputs', message: `Command "${cmd.actor}->${cmd.name}" has no on/from clauses` });
      }
      if (!cmd.guards.length) {
        issues.push({ severity: 'info', rule: 'command-guards', message: `Command "${cmd.actor}->${cmd.name}" has no guards` });
      }
    }

    for (const view of model.views) {
      if (!view.sources.length) {
        issues.push({ severity: 'warn', rule: 'view-sources', message: `View "${view.name}" has no source events` });
      }
    }

    for (const policy of model.policies) {
      if (!policy.guard) {
        issues.push({ severity: 'info', rule: 'policy-guard', message: `Policy "${policy.event}" has no guard` });
      }
    }

    if (issues.length === 0) {
      console.log('validate: 0 issues found\n');
      return;
    }

    console.log(`validate: ${issues.length} issue(s)\n`);
    const rows = issues.map(i => ({ severity: i.severity, rule: i.rule, message: i.message }));
    console.log(fmt.formatOutput('issues', rows, ['severity', 'rule', 'message']));
  }
};
