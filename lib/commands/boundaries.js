'use strict';

module.exports = {
  /**
   * Prints the boundaries.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(b·n) where b = boundaries, n = annotations per boundary (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 0% measured (no test loads this file); target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.boundaries.map((b) => ({
      name: b.name,
      params: b.params.join(','),
      shardKey: (b.annotations.partition && b.annotations.partition.shardKey) || '',
      annotations: Object.keys(b.annotations).join(',')
    }));
    console.log(fmt.formatOutput('boundaries', rows, ['name', 'params', 'shardKey', 'annotations']));
  }
};
