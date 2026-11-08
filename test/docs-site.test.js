'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const load = () => import(pathToFileURL(path.join(root, 'docs-site', 'scripts', 'sync-docs.mjs')).href);

test('every doc in the repo has a page on the docs site, and every page is in the sidebar', async () => {
  const { PAGES, LABELS } = await load();
  const docs = fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`);
  for (const d of docs) assert.ok(PAGES[d], `${d} has no page: add it to PAGES in docs-site/scripts/sync-docs.mjs`);
  const config = fs.readFileSync(path.join(root, 'docs-site', 'astro.config.mjs'), 'utf8');
  const inSidebar = new Set([...config.slice(config.indexOf('sidebar:')).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  for (const slug of Object.values(PAGES)) {
    assert.ok(inSidebar.has(slug), `${slug} is missing from the sidebar in astro.config.mjs`);
    assert.ok(LABELS[slug], `${slug} has no sidebar label`);
  }
});

test('links between docs become site routes, and links to other repo files become GitHub links', async () => {
  const { rewriteLink } = await load();
  assert.equal(rewriteLink('./LANGUAGE.md', 'docs/README.md'), '/eventline/docs/language/');
  assert.equal(rewriteLink('../EVENTLINE-AXI.md#derived-diagrams', 'docs/README.md'), '/eventline/docs/eventline-axi/#derived-diagrams');
  assert.equal(rewriteLink('./docs/README.md', 'CONTRIBUTING.md'), '/eventline/docs/');
  assert.equal(rewriteLink('../examples/billing.dsl', 'docs/EXAMPLES.md'), 'https://github.com/bytesbybrandon/eventline/blob/main/examples/billing.dsl');
  assert.equal(rewriteLink('../examples', 'docs/EXAMPLES.md'), 'https://github.com/bytesbybrandon/eventline/tree/main/examples');
  for (const same of ['https://eventmodeling.org', '#section', 'mailto:a@b.c']) assert.equal(rewriteLink(same, 'docs/README.md'), null);
});

test('a page takes its title from the first heading, and a link written as a file name reads as the page name', async () => {
  const { convert } = await load();
  const titles = { 'docs/GLOSSARY.md': 'Glossary of terms' };
  const out = convert('# My page\r\n\r\nSee [GLOSSARY.md](./GLOSSARY.md) and [the guide](./LANGUAGE.md#x).\r\n', 'docs/README.md', titles);
  assert.match(out, /^---\ntitle: "My page"\ndescription: "[^"]+"\neditUrl: https:\/\/github.com\/bytesbybrandon\/eventline\/edit\/main\/docs\/README.md\nsidebar:\n {2}label: "Overview"\nhead:\n/);
  assert.match(out, /type: application\/ld\+json\n {4}content: "\{\\"@context\\":\\"https:\/\/schema.org\\",\\"@type\\":\\"TechArticle\\"/);
  assert.ok(!/^# /m.test(out), 'the heading becomes the title and leaves the body');
  assert.match(out, /\[Glossary of terms\]\(\/eventline\/docs\/glossary\/\)/);
  assert.match(out, /\[the guide\]\(\/eventline\/docs\/language\/#x\)/);
  assert.throws(() => convert('no heading here\n', 'docs/README.md'), /must start with/);
});

test('the landing page links to the docs', () => {
  const html = fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf8');
  assert.ok(html.includes('<a href="/eventline/docs/">Docs</a>'));
  assert.ok(html.includes('<a href="/eventline/docs/">Read the docs</a>'));
});

test('every docs page has its own search snippet of a usable length, and the key terms are covered', async () => {
  const { PAGES, DESCRIPTIONS } = await load();
  const seen = new Set();
  for (const slug of Object.values(PAGES)) {
    const d = DESCRIPTIONS[slug];
    assert.ok(d, `${slug} has no description`);
    assert.ok(d.length >= 70 && d.length <= 160, `${slug}: description is ${d.length} characters, want 70 to 160`);
    assert.ok(!seen.has(d), `${slug} repeats another page's description`);
    seen.add(d);
  }
  const all = Object.values(DESCRIPTIONS).join(' ').toLowerCase();
  for (const term of ['event modeling', 'event storming', 'dynamic consistency boundaries', 'dcb', 'system design']) assert.ok(all.includes(term), `no page description mentions "${term}"`);
  const html = fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf8');
  const landing = /<meta name="description" content="([^"]+)"/.exec(html)[1];
  assert.ok(landing.length >= 70 && landing.length <= 160, `landing description is ${landing.length} characters`);
  assert.ok(!Object.values(DESCRIPTIONS).includes(landing));
});

test('every docs page shares the social image', () => {
  const config = fs.readFileSync(path.join(root, 'docs-site', 'astro.config.mjs'), 'utf8');
  assert.ok(config.includes("property: 'og:image', content: 'https://bytesbybrandon.github.io/eventline/og.png'"));
  assert.ok(config.includes("name: 'twitter:image'"));
  assert.ok(fs.existsSync(path.join(root, 'site', 'og.png')));
});
