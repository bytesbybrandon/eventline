'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = [];
    for (const p of model.policies) {
      for (const r of p.rules) {
        rows.push({
          event: p.trigger.event || p.trigger.schedule,
          guard: r.guard || '',
          worker: r.worker || '',
          reads: p.from.map((f) => f.name).join(','),
          then: r.command ? `${r.command.name}()` : r.emits.map((e) => e.event).join(',')
        });
      }
    }
    console.log(fmt.formatOutput('policies', rows, ['event', 'guard', 'worker', 'reads', 'then']));
  }
};
