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

test('fenced blocks that hold eventline source are tagged for highlighting, and nothing else is', async () => {
  const { tagEventline } = await load();
  const model = 'user -> postTweet(content) in UserTimeline(userId)\non [user-authenticated(userId)]\n  --[default]--> [tweet-created { userId }]\n';
  const out = tagEventline(`Intro\n\n\`\`\`text\n${model}\`\`\`\n\n\`\`\`\n${model}\`\`\`\n\n\`\`\`bash\nnpx -y eventline-axi model.dsl\n\`\`\`\n\n\`\`\`text\nclient  ->  gateway  ->  store\n\`\`\`\n`);
  assert.equal(out.match(/^```eventline$/gm).length, 2);
  assert.match(out, /```bash\nnpx -y eventline-axi model\.dsl\n```/);
  assert.match(out, /```text\nclient {2}-> {2}gateway/);
});

test('the playground link carries the model as base64url that decodes back to the exact text', async () => {
  const { playgroundHref, isDrawable } = await import(pathToFileURL(path.join(root, 'docs-site', 'src', 'code', 'eventline-source.mjs')).href);
  const text = 'user -> postTweet(content) in UserTimeline(userId)\non [user-authenticated(userId)]\n  --[default]--> [tweet-created { userId, note: "h\u00e9llo" }]\n';
  const href = playgroundHref(text);
  assert.match(href, /^\/eventline\/app\/#play=[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(href.split('#play=')[1], 'base64url').toString('utf8'), text);
  assert.ok(isDrawable(text));
  assert.ok(!isDrawable('user -> postTweet(content)'), 'a one-line fragment is not worth drawing');
});

test('docs grammar and code-shape check know readmodel and from [', async () => {
  const { looksLikeEventline } = await import(pathToFileURL(path.join(root, 'docs-site', 'src', 'code', 'eventline-source.mjs')).href);
  assert.ok(looksLikeEventline('readmodel A(id) = [x-y*(id)] => { id }'));
  assert.ok(looksLikeEventline('from [A] -> worker -> go()'));
  assert.match(fs.readFileSync(path.join(root, 'docs-site', 'src', 'code', 'eventline.tmLanguage.json'), 'utf8'), /readmodel/);
});

test('the docs explain read models, screens and both automation forms', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const lang = read('docs/LANGUAGE.md');
  assert.match(lang, /## Read models and screens/); assert.match(lang, /^readmodel /m);
  assert.match(lang, /from \[[A-Za-z]+\] -> /); assert.match(lang, /[a-z]+-[a-z]+ from \[/);
  assert.match(read('docs/GLOSSARY.md'), /### Read model[\s\S]*### Screen/);
  assert.match(read('docs/EVENT-MODELING.md'), /\| *SliceRM *\|/);
});

test('the code-shape check knows the short guard', async () => {
  const { looksLikeEventline } = await import(pathToFileURL(path.join(root, 'docs-site', 'src', 'code', 'eventline-source.mjs')).href);
  assert.ok(looksLikeEventline('x\n  -[default]-> [x-done { id }]'));
});

test('docs grammar and code-shape check know a named policy', async () => {
  const { looksLikeEventline } = await import(pathToFileURL(path.join(root, 'docs-site', 'src', 'code', 'eventline-source.mjs')).href);
  assert.ok(looksLikeEventline('policy Fan = x-done -> w -> go()'));
  const grammar = JSON.parse(fs.readFileSync(path.join(root, 'docs-site', 'src', 'code', 'eventline.tmLanguage.json'), 'utf8'));
  const decl = new RegExp(grammar.repository.declaration.match);
  assert.deepEqual([...decl.exec('policy Fan = x-done -> w -> go()')].slice(2), ['policy', 'Fan']);
  assert.equal(decl.exec('policy -> go(id)'), null);
});

test('docs grammar and code-shape check know an event declaration', async () => {
  const { looksLikeEventline } = await import(pathToFileURL(path.join(root, 'docs-site', 'src', 'code', 'eventline-source.mjs')).href);
  assert.ok(looksLikeEventline('event item-added { cartId }'));
  assert.ok(looksLikeEventline('event order-placed'));
  const grammar = JSON.parse(fs.readFileSync(path.join(root, 'docs-site', 'src', 'code', 'eventline.tmLanguage.json'), 'utf8'));
  const decl = new RegExp(grammar.repository.eventDeclaration.match);
  assert.equal(decl.exec('event item-added { cartId }')[2], 'event');
  assert.equal(decl.exec('event -> go(id)'), null);
  assert.equal(decl.exec('event { id } -> w -> go(id)'), null);
});

test('the docs cover short guards, named policies and declared events', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const lang = read('docs/LANGUAGE.md');
  assert.match(lang, /-\[[^\]]+\]->/); assert.match(lang, /^policy [A-Z]\w* = /m); assert.match(lang, /^event [a-z]+-[a-z-]+ \{/m);
  assert.match(lang, /## Named policies/); assert.match(lang, /## Predefined events/);
  const g = read('docs/GLOSSARY.md'); assert.match(g, /### Named policy/); assert.match(g, /### Declared event/);
});
