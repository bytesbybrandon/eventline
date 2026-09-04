'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = Array.from(model.events).map(name => ({ name }));
    console.log(fmt.formatOutput('events', rows, ['name']));
  }
};
