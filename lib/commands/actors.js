'use strict';

module.exports = {
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
