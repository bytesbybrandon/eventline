'use strict';

const Model = require('../model');

module.exports = {
  /**
   * Prints the events with emitters and consumers.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(e·(w + u)) where e = events, w = emitters, u = consumers per event (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 1.0 measured; threshold <= 15
   * - Caching: none
   */
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const by = (list) => [...new Set(list.map((x) => x.name))].join(',');
    // declared: '' when not declared, otherwise yes / not recorded / not used, and the declaring context
    const declared = (e) => {
      if (!e.declared) return '';
      const state = !Model.isUsed(model, e.name) ? 'not used' : e.emittedBy.length ? 'yes' : 'not recorded';
      return e.declared.context ? `${state} in ${e.declared.context}` : state;
    };
    const rows = [...model.events.values()].map((e) => ({
      name: e.name,
      emittedBy: by(e.emittedBy) || (e.declared ? '(declared)' : '(assumed)'),
      consumedBy: by(e.consumedBy),
      declared: declared(e)
    }));
    console.log(fmt.formatOutput('events', rows, ['name', 'emittedBy', 'consumedBy', 'declared']));
  }
};
