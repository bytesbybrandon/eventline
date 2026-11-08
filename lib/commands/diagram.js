'use strict';

const fs = require('fs');
const path = require('path');
const { KINDS, FORMATS, render } = require('../diagram');

module.exports = {
  run(model, opts, kind) {
    try {
      const text = render(model, kind, opts.format, opts.theme, { links: !!opts.links, linkBase: opts.linkBase });
      if (opts.out) { fs.writeFileSync(opts.out, text); console.error(`wrote ${opts.out}`); } else process.stdout.write(text);
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  },
  runAll(model, opts) {
    const dir = opts.out || 'diagrams';
    fs.mkdirSync(dir, { recursive: true });
    const written = [];
    for (const kind of KINDS) {
      for (const [format, ext] of Object.entries(FORMATS)) {
        try {
          const file = path.join(dir, `${kind}.${ext}`);
          fs.writeFileSync(file, render(model, kind, format, opts.theme, { links: !!opts.links, linkBase: opts.linkBase }));
          written.push(file);
        } catch (err) {
          if (err.code === 'NO_REGIONS' || err.code === 'NO_CONTEXTS') { console.error(`skipped ${kind}: ${err.message}`); break; }
          throw err;
        }
      }
    }
    console.log(`wrote ${written.length} files to ${dir}`);
    for (const f of written) console.log(`  ${f}`);
  }
};
