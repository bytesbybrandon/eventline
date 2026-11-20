'use strict';

/* The scenarios written under commands and read models: what each one checks, and how long it is. */
/**
 * One row per scenario.
 *
 * # Performance & Risk Budget
 * - Tier: P1 (< 300 ms)
 * - Complexity: O(q·z) where q = scenarios, z = lines per scenario (derived by reading the code)
 * - Cyclomatic Complexity (CC): 7 measured; target <= 12
 * - Branch Coverage: 50% measured; target >= 80%
 * - CRAP Score: 13.1 measured; threshold <= 15
 * - Caching: none
 */
function rows(model) {
  const out = [];
  for (const c of model.commands) for (const s of c.scenarios) out.push({ checks: `${c.name}()`, scenario: s.name, lines: s.text ? s.text.split('\n').length : 0 });
  for (const v of model.views) for (const s of v.scenarios) out.push({ checks: `read model ${v.name}`, scenario: s.name, lines: s.text ? s.text.split('\n').length : 0 });
  return out;
}

module.exports = {
  rows,
  /**
   * Prints the scenarios.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(q·z) where q = scenarios, z = lines per scenario (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 0% measured; target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    console.log(fmt.formatOutput('scenarios', rows(model), ['checks', 'scenario', 'lines']));
  }
};
