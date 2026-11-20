'use strict';

module.exports = {
  /**
   * Prints the commands.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(c·(a + x + β·m)) where c = commands, a = actors, x = externals, β = branches, m = emits (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 0% measured (no test loads this file); target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
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
