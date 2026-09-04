'use strict';

module.exports = {
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const lines = [];
    lines.push(`file: loaded`);
    lines.push(`system: ${model.system ? model.system.name : '(none)'}`);
    lines.push('');
    lines.push(`counts[6]:`);
    lines.push(`  actors: ${model.actors.length}`);
    lines.push(`  commands: ${model.commands.length}`);
    lines.push(`  events: ${model.events.size}`);
    lines.push(`  views: ${model.views.length}`);
    lines.push(`  boundaries: ${model.boundaries.length}`);
    lines.push(`  policies: ${model.policies.length}`);
    lines.push('');
    if (model.system) {
      lines.push(`system:`);
      lines.push(`  name: ${model.system.name}`);
      if (model.system.externals.length) lines.push(`  external: ${model.system.externals.join(', ')}`);
      if (model.system.slo) lines.push(`  slo: ${model.system.slo}`);
      if (model.system.region) lines.push(`  region: ${model.system.region}`);
      if (model.system.dataClassification) lines.push(`  data-classification: ${model.system.dataClassification}`);
      lines.push('');
    }
    if (model.actors.length) {
      lines.push(fmt.toon('actors', model.actors.map(a => ({ name: a.name, auth: a.attributes.auth || '', tier: a.attributes.tier || '' })), ['name', 'auth', 'tier']));
    }
    if (model.commands.length) {
      lines.push(fmt.toon('commands', model.commands.map(c => ({ actor: c.actor, name: c.name, params: c.params.join(',') })), ['actor', 'name', 'params']));
    }
    if (model.views.length) {
      lines.push(fmt.toon('views', model.views.map(v => ({ name: v.name, params: v.params.join(',') })), ['name', 'params']));
    }
    if (model.boundaries.length) {
      lines.push(fmt.toon('boundaries', model.boundaries.map(b => ({ name: b.name, params: b.params.join(',') })), ['name', 'params']));
    }
    if (model.policies.length) {
      lines.push(fmt.toon('policies', model.policies.map(p => ({ event: p.event, worker: p.worker || '', target: p.target ? p.target.name : '' })), ['event', 'worker', 'target']));
    }
    console.log(lines.join(''));
  }
};
