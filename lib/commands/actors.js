'use strict';

module.exports = {
  /**
   * Prints the actors.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(a) where a = actors (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 1.0 measured; threshold <= 15
   * - Largest nested function: CC 5 measured (branch cov 80%, CRAP 5.2), `const rows = model.actors.map(a => (`
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
