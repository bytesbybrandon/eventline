'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.boundaries.map(b => ({
      name: b.name,
      params: b.params.join(','),
      annotations: Object.keys(b.annotations).join(',')
    }));
    console.log(fmt.formatOutput('boundaries', rows, ['name', 'params', 'annotations']));
  }
};
