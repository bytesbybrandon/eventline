'use strict';

const Model = require('../model');

module.exports = {
  /**
   * Prints one row per policy rule.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(p·r·(f + m)) where p = policies, r = rules, f = from reads, m = emits (derived by reading the code)
   * - Cyclomatic Complexity (CC): 7 measured; target <= 12
   * - Branch Coverage: 60% measured; target >= 80%
   * - CRAP Score: 10.1 measured; threshold <= 15
   * - Caching: none
   */
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = [];
    for (const p of model.policies) {
      for (const r of p.rules) {
        rows.push({
          event: Model.policyLabel(p),
          guard: r.guard || '',
          worker: r.worker || '',
          reads: p.from.map((f) => f.name).join(','),
          then: r.command ? `${r.command.name}()` : r.emits.map((e) => e.event).join(','),
          name: p.name || ''
        });
      }
    }
    console.log(fmt.formatOutput('policies', rows, ['event', 'guard', 'worker', 'reads', 'then', 'name']));
  }
};
