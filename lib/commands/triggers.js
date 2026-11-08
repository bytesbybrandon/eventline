'use strict';

/* What each screen, endpoint, command line or agent exposes, and who uses it. */
function rows(model) {
  const out = [];
  for (const c of model.commands) for (const t of c.triggers) out.push({ trigger: t.name || '', part: t.part || '', type: t.type || '', route: t.route || '', actor: c.actor, reaches: `${c.name}()` });
  for (const v of model.views) for (const t of v.triggers) out.push({ trigger: t.name || '', part: t.part || '', type: t.type || '', route: t.route || '', actor: '', reaches: `view ${v.name}` });
  return out;
}

module.exports = {
  rows,
  run(model, opts) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    console.log(fmt.formatOutput('triggers', rows(model), ['trigger', 'part', 'type', 'route', 'actor', 'reaches']));
  }
};
