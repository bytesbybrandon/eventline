'use strict';

/* What each screen, endpoint, command line or agent exposes, and who uses it. */
/**
 * One row per trigger.
 *
 * # Performance & Risk Budget
 * - Tier: P1 (< 300 ms)
 * - Complexity: O(t) where t = triggers (derived by reading the code)
 * - Cyclomatic Complexity (CC): 13 measured; target <= 12, over budget
 * - Branch Coverage: 14% measured; target >= 80%
 * - CRAP Score: 119.4 measured; threshold <= 15, over the hard ceiling of 30
 * - Caching: none
 */
function rows(model) {
  const out = [];
  for (const c of model.commands) for (const t of c.triggers) out.push({ trigger: t.name || '', part: t.part || '', type: t.type || '', route: t.route || '', actor: c.actor, reaches: `${c.name}()` });
  for (const v of model.views) for (const t of v.triggers) out.push({ trigger: t.name || '', part: t.part || '', type: t.type || '', route: t.route || '', actor: '', reaches: `read model ${v.name}` });
  return out;
}

module.exports = {
  rows,
  /**
   * Prints the triggers.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(t) where t = triggers (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 0% measured; target >= 80%
   * - CRAP Score: 2.0 measured; threshold <= 15
   * - Caching: none
   */
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    console.log(fmt.formatOutput('triggers', rows(model), ['trigger', 'part', 'type', 'route', 'actor', 'reaches']));
  }
};
