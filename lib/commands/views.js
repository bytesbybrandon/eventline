'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.views.map((v) => ({
      name: v.name,
      params: v.params.join(','),
      sources: [...new Set(v.sources.map((s) => s.name))].join(','),
      annotations: Object.keys(v.annotations).join(',')
    }));
    console.log(fmt.formatOutput('views', rows, ['name', 'params', 'sources', 'annotations']));
  }
};
