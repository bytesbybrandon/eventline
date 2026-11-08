'use strict';

/* The scenarios written under commands and views: what each one checks, and how long it is. */
function rows(model) {
  const out = [];
  for (const c of model.commands) for (const s of c.scenarios) out.push({ checks: `${c.name}()`, scenario: s.name, lines: s.text ? s.text.split('\n').length : 0 });
  for (const v of model.views) for (const s of v.scenarios) out.push({ checks: `view ${v.name}`, scenario: s.name, lines: s.text ? s.text.split('\n').length : 0 });
  return out;
}

module.exports = {
  rows,
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    console.log(fmt.formatOutput('scenarios', rows(model), ['checks', 'scenario', 'lines']));
  }
};
