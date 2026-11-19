'use strict';

const Model = require('../model');

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const by = (list) => [...new Set(list.map((x) => x.name))].join(',');
    // declared: '' when not declared, otherwise yes / not recorded / not used, and the declaring context
    const declared = (e) => {
      if (!e.declared) return '';
      const state = !Model.isUsed(model, e.name) ? 'not used' : e.emittedBy.length ? 'yes' : 'not recorded';
      return e.declared.context ? `${state} in ${e.declared.context}` : state;
    };
    const rows = [...model.events.values()].map((e) => ({
      name: e.name,
      emittedBy: by(e.emittedBy) || (e.declared ? '(declared)' : '(assumed)'),
      consumedBy: by(e.consumedBy),
      declared: declared(e)
    }));
    console.log(fmt.formatOutput('events', rows, ['name', 'emittedBy', 'consumedBy', 'declared']));
  }
};
