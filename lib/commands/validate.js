'use strict';

const { check, PROFILES } = require('../rules');

module.exports = {
  check,
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    let issues;
    try {
      issues = check(model, { profile: opts.profile });
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (opts.format === 'json') { console.log(fmt.json(issues)); return; }
    if (issues.length === 0) { console.log('validate: 0 issues found\n'); return; }
    console.log(`validate: ${issues.length} issue(s)\n`);
    console.log(fmt.formatOutput('issues', issues.map(({ severity, rule, message, line }) => ({ severity, rule, message, line })), ['severity', 'rule', 'message', 'line']));
    if (issues.some((i) => i.severity === 'error')) process.exitCode = 1;
  },
  PROFILES,
};
