'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const by = (list) => [...new Set(list.map((x) => x.name))].join(',');
    const rows = [...model.events.values()].map((e) => ({
      name: e.name,
      emittedBy: by(e.emittedBy) || '(assumed)',
      consumedBy: by(e.consumedBy)
    }));
    console.log(fmt.formatOutput('events', rows, ['name', 'emittedBy', 'consumedBy']));
  }
};
