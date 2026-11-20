'use strict';

const { RULES, PROFILES } = require('../rules');

module.exports = {
  /**
   * Prints the rule catalogue.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(R) where R = rules in the catalogue (derived by reading the code)
   * - Cyclomatic Complexity (CC): 4 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 4.0 measured; threshold <= 15
   * - Caching: none
   */
  run(opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    if (opts.profile && !PROFILES.includes(opts.profile)) {
      console.error(`error: Unknown profile "${opts.profile}". Choose one of: ${PROFILES.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const rules = RULES.filter((r) => !opts.profile || r.profile === opts.profile);
    if (opts.format === 'json') { console.log(fmt.json(rules)); return; }
    console.log(fmt.formatOutput('rules', rules, ['id', 'profile', 'severity', 'category', 'title']));
    console.log('help[1]:\n  Run `eventline-axi validate <file> --profile eventmodeling` to apply the guidelines\n');
  },
};
