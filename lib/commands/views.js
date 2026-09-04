'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.views.map(v => ({
      name: v.name,
      params: v.params.join(','),
      sources: v.sources.length
    }));
    console.log(fmt.formatOutput('views', rows, ['name', 'params', 'sources']));
  }
};
