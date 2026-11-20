'use strict';

/* Checks every built page against WCAG 2.2 AA with axe and fails on serious or critical violations.
 * Usage: node scripts/a11y.js <dir>, where <dir> holds what GitHub Pages serves (the landing page and app, the docs under docs/).
 * The tree is served under /eventline/, like on GitHub Pages, so root-relative links resolve.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const BASE = '/eventline/';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FAIL = new Set(['serious', 'critical']);
// Known findings in third-party markup, waived node by node and still printed. Keep each reason to one line.
const WAIVED = [
  // Starlight's search button: name "Search", but its visible text sits in an aria-hidden span and a Ctrl K hint. Same in Starlight 0.43.1.
  { rule: 'label-content-name-mismatch', target: 'button[data-open-modal=""]' },
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

const root = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(root, 'index.html'))) {
  console.error('usage: node scripts/a11y.js <dir with index.html>');
  process.exit(2);
}

const pages = fs.readdirSync(root, { recursive: true })
  .filter((f) => f.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(path.basename(f)))
  .map((f) => BASE + f.split(path.sep).join('/').replace(/(^|\/)index\.html$/, '$1'))
  .sort();

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = url.startsWith(BASE) ? path.join(root, url.slice(BASE.length)) : '';
  if (file && !file.startsWith(root)) file = '';
  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failures = 0;
  try {
    for (const page of pages) {
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(origin + page, { waitUntil: 'networkidle' });
      // Scripts finish in idle time, e.g. the docs make wide code blocks focusable after a resize observer fires.
      await tab.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestIdleCallback(r, { timeout: 1000 })))));
      const { violations } = await new AxeBuilder({ page: tab }).withTags(TAGS).analyze();
      await context.close();
      const waived = (v, n) => WAIVED.some((w) => w.rule === v.id && w.target === n.target.join(' '));
      const blocking = violations.filter((v) => FAIL.has(v.impact) && v.nodes.some((n) => !waived(v, n)));
      failures += blocking.length;
      console.log(`${blocking.length ? 'FAIL' : 'ok  '} ${page}`);
      for (const v of violations) {
        console.log(`  ${v.impact} ${v.id}: ${v.help} (${v.nodes.length})`);
        for (const n of v.nodes.slice(0, 5)) console.log(`    ${waived(v, n) ? 'waived ' : ''}${n.target.join(' ')}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`${pages.length} pages, ${failures} serious or critical violations`);
  process.exit(failures ? 1 : 0);
})();
