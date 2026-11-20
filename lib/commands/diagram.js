'use strict';

const fs = require('fs');
const path = require('path');
const { KINDS, FORMATS, render } = require('../diagram');

module.exports = {
  /**
   * Writes or prints one diagram.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(render) for the chosen kind and format (derived by reading the code)
   * - Cyclomatic Complexity (CC): 3 measured; target <= 12
   * - Branch Coverage: 75% measured; target >= 80%
   * - CRAP Score: 3.1 measured; threshold <= 15
   * - Caching: none
   */
  run(model, opts, kind) {
    try {
      const text = render(model, kind, opts.format, opts.theme, { links: !!opts.links, linkBase: opts.linkBase });
      if (opts.out) { fs.writeFileSync(opts.out, text); console.error(`wrote ${opts.out}`); } else process.stdout.write(text);
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  },
  /**
   * Writes all six diagrams in every format.
   *
   * # Performance & Risk Budget
   * - Tier: P2 (< 2 s)
   * - Complexity: O(6·3·render): every kind in every format, each render rebuilding its diagram (derived by reading the code)
   * - Cyclomatic Complexity (CC): 8 measured; target <= 15
   * - Branch Coverage: 75% measured; target >= 70%
   * - CRAP Score: 9.0 measured; threshold <= 25
   * - Caching: none
   */
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
