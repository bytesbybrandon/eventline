'use strict';

module.exports = {
  /**
   * Prints the actors.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(a) where a = actors (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 0% measured (no test loads this file); target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.actors.map(a => ({
      name: a.name,
      auth: a.attributes.auth || '',
      tier: a.attributes.tier || '',
      mfa: a.attributes.mfa || '',
      scope: a.attributes.scope || ''
    }));
    console.log(fmt.formatOutput('actors', rows, ['name', 'auth', 'tier', 'mfa', 'scope']));
  }
};
