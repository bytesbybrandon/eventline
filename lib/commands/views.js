'use strict';

/* `readmodels` and `views` both run this. The output key stays "views". */
module.exports = {
  /**
   * Prints the read models.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(v·(s + n)) where v = read models, s = sources, n = annotations (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 1.0 measured; threshold <= 15
   * - Caching: none
   */
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const rows = model.views.map((v) => ({
      name: v.name,
      params: v.params.join(','),
      sources: [...new Set(v.sources.map((s) => s.name))].join(','),
      annotations: Object.keys(v.annotations).join(',')
    }));
    console.log(fmt.formatOutput('views', rows, ['name', 'params', 'sources', 'annotations']));
  }
};
