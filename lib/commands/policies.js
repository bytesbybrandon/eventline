'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.policies.map(p => ({
      event: p.event,
      guard: p.guard || '',
      worker: p.worker || '',
      target: p.target ? p.target.name : ''
    }));
    console.log(fmt.formatOutput('policies', rows, ['event', 'guard', 'worker', 'target']));
  }
};
