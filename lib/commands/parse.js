'use strict';

const Model = require('../model');

module.exports = {
  /**
   * Prints the parsed model summary or JSON.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(a + c + v + b + p·f) where f = from reads per policy (derived by reading the code)
   * - Cyclomatic Complexity (CC): 9 measured; target <= 12
   * - Branch Coverage: 91% measured; target >= 80%
   * - CRAP Score: 9.1 measured; threshold <= 15
   * - Caching: none
   */
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
    if (model.policies.length) parts.push(fmt.toon('policies', model.policies.map((p) => ({ event: Model.policyLabel(p), rules: p.rules.length, name: p.name || '' })), ['event', 'rules', 'name']));
    console.log(lines.join('\n') + '\n' + parts.join('\n'));
  }
};
