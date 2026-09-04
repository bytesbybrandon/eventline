'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.commands.map(c => ({
      actor: c.actor,
      name: c.name,
      params: c.params.join(',')
    }));
    console.log(fmt.formatOutput('commands', rows, ['actor', 'name', 'params']));
  }
};
