'use strict';

module.exports = {
  run(model, opts, file) {
    const Formatter = require('../output');
    const { systemLines, countLines } = require('../summary');
    const fmt = new Formatter(opts.format);
    if (opts.format === 'json') {
      console.log(fmt.json(model.toJSON()));
      return;
    }
    const lines = [`file: ${file || '(none)'}`, ''];
    lines.push(...countLines(model), '');
    const sys = systemLines(model);
    if (sys.length) lines.push(...sys, '');
    const parts = [];
    if (model.actors.length) parts.push(fmt.toon('actors', model.actors.map((a) => ({ name: a.name, auth: a.attributes.auth || '', tier: a.attributes.tier || '' })), ['name', 'auth', 'tier']));
    if (model.commands.length) parts.push(fmt.toon('commands', model.commands.map((c) => ({ actor: c.actor, name: c.name, params: c.params.join(',') })), ['actor', 'name', 'params']));
    if (model.views.length) parts.push(fmt.toon('views', model.views.map((v) => ({ name: v.name, params: v.params.join(',') })), ['name', 'params']));
    if (model.boundaries.length) parts.push(fmt.toon('boundaries', model.boundaries.map((b) => ({ name: b.name, params: b.params.join(',') })), ['name', 'params']));
    if (model.policies.length) parts.push(fmt.toon('policies', model.policies.map((p) => ({ event: p.trigger.event, rules: p.rules.length })), ['event', 'rules']));
    console.log(lines.join('\n') + '\n' + parts.join('\n'));
  }
};
