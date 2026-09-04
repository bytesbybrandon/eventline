'use strict';

module.exports = {
  run(model, opts, entity) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);

    const deps = { dependsOn: [], dependedBy: [] };

    for (const cmd of model.commands) {
      if (cmd.name === entity || cmd.actor === entity) {
        deps.dependsOn.push(...cmd.on.map(e => typeof e === 'string' ? e : e.name));
        deps.dependsOn.push(...cmd.from.map(f => typeof f === 'string' ? f : f.name));
      }
    }
    for (const view of model.views) {
      if (view.name === entity) {
        deps.dependsOn.push(...view.sources);
      }
    }
    for (const policy of model.policies) {
      if (policy.event === entity && policy.target?.name) {
        deps.dependsOn.push(policy.target.name);
      }
    }

    for (const cmd of model.commands) {
      for (const fact of [...cmd.on, ...cmd.from]) {
        const name = typeof fact === 'string' ? fact : fact.name;
        if (name === entity) {
          deps.dependedBy.push(cmd.name);
          break;
        }
      }
    }
    for (const view of model.views) {
      if (view.sources.some(s => s === entity || (typeof s === 'object' && s.name === entity))) {
        deps.dependedBy.push(view.name);
      }
    }
    for (const policy of model.policies) {
      if (policy.event === entity || (policy.target && policy.target.name === entity)) {
        deps.dependedBy.push(policy.event);
      }
    }

    deps.dependsOn = [...new Set(deps.dependsOn)].filter(Boolean);
    deps.dependedBy = [...new Set(deps.dependedBy)].filter(Boolean);

    const out = {
      entity,
      dependsOn: deps.dependsOn,
      dependedBy: deps.dependedBy
    };

    console.log(fmt.formatObject('deps', out));
  }
};
