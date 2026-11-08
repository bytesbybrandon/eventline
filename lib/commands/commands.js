'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.commands.map((c) => ({
      actor: c.actor,
      kind: model.actorKind(c.actor),
      name: c.name,
      params: c.params.join(','),
      reads: c.from.map((f) => f.name).join(','),
      emits: [...new Set(c.branches.flatMap((b) => b.emits.map((e) => e.event)))].join(',')
    }));
    console.log(fmt.formatOutput('commands', rows, ['actor', 'kind', 'name', 'params', 'reads', 'emits']));
  }
};
