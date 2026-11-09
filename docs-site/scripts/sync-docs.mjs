// Builds the content Starlight reads from the Markdown that lives in the repo.
// The files in docs/ stay the source (the home page is the exception: it is drawn by src/components/Hub.astro). Nothing generated here is committed.
//   - the first "# Heading" becomes the page title and is removed from the body
//   - fenced blocks that hold eventline source are tagged eventline, so they get highlighted
//   - links between docs become site routes; links to other repo files become GitHub links
//   - the diagrams derived from examples/billing.dsl are added to the examples page
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { looksLikeEventline } from '../src/code/eventline-source.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..');
const root = path.join(site, '..');
const out = path.join(site, 'src', 'content', 'docs');

const BASE = '/eventline/docs';
const REPO = 'https://github.com/bytesbybrandon/eventline';

/* repo path -> page slug. The order here is not the sidebar order; astro.config.mjs owns that. */
export const PAGES = {
  'docs/README.md': 'index',
  'docs/LANGUAGE.md': 'language',
  'docs/EVENT-MODELING.md': 'event-modeling',
  'docs/EXAMPLES.md': 'examples',
  'docs/THINKING-GUIDE.md': 'thinking-guide',
  'docs/GLOSSARY.md': 'glossary',
  'docs/ACTORS.md': 'actors',
  'docs/SYSTEM-CONTEXT.md': 'system-context',
  'docs/TWITTER-TRANSLATION.md': 'twitter-translation',
  'docs/INTERVIEW_SIMULATION.md': 'interview-simulation',
  'docs/ARCHITECTURE.md': 'architecture',
  'docs/RULES.md': 'rules',
  'EVENTLINE-AXI.md': 'eventline-axi',
  'CONTRIBUTING.md': 'contributing',
};

const route = (slug) => (slug === 'index' ? `${BASE}/` : `${BASE}/${slug}/`);

/* A link inside file `from` (repo-relative). Returns the link to write, or null to leave it alone. */
export function rewriteLink(target, from) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#|mailto:)/i.test(target)) return null;
  const [file, hash = ''] = target.split('#');
  if (!file) return null;
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(from), file)).replace(/\/$/, '');
  const suffix = hash ? `#${hash}` : '';
  if (PAGES[repoPath]) return route(PAGES[repoPath]) + suffix;
  const full = path.join(root, repoPath);
  const kind = fs.existsSync(full) && fs.statSync(full).isDirectory() ? 'tree' : 'blob';
  return `${REPO}/${kind}/main/${repoPath}`;
}

/* Fenced blocks with no language, or "text", that hold eventline source get the eventline language. Others stay as written. */
export function tagEventline(body) {
  return body.replace(/^(```)(text)?\n([\s\S]*?)^```$/gm, (m, fence, lang, code) => (looksLikeEventline(code) ? `${fence}eventline\n${code}${fence}` : m));
}

/* The short name each page has in the sidebar. */
export const LABELS = {
  index: 'Overview',
  language: 'Language reference',
  'event-modeling': 'Event Modeling and DCB',
  examples: 'Worked examples',
  'thinking-guide': 'Thinking guide',
  glossary: 'Glossary',
  actors: 'Actors',
  'system-context': 'System context',
  'twitter-translation': 'Twitter translation',
  'eventline-axi': 'The CLI',
  rules: 'Validation rules',
  'interview-simulation': 'Interview simulation',
  architecture: 'Architecture',
  contributing: 'Contributing',
};

/* The search snippet for each page: 70 to 160 characters, unique, in plain words. A test enforces it. */
export const DESCRIPTIONS = {
  index: 'Guides to eventline, a text notation for Event Modeling and DCB: learn the language, model a system and use the CLI.',
  language: 'The eventline language reference: commands, events, views, policies and Dynamic Consistency Boundaries, with the full grammar.',
  'event-modeling': 'How event storming, Event Modeling and Dynamic Consistency Boundaries (DCB) fit together, and where eventline writes the design as text.',
  examples: 'Worked eventline models for system design, a rate limiter and a payment webhook, with the commands, events and boundaries explained.',
  'thinking-guide': 'A guide to thinking in events for system design: how to find the commands, events, boundaries and views before drawing boxes.',
  glossary: 'Definitions for every eventline term: facts, events, views, commands, boundaries (DCB), policies, guards and freshness.',
  actors: 'Declare the people, services and systems that act in an eventline model, together with how each one authenticates.',
  'system-context': 'Describe a system\u2019s context in eventline: its external dependencies, SLOs, regions and constraints, and how diagrams show them.',
  'twitter-translation': 'Design Twitter with an event model: how an eventline description of tweets, likes and timelines translates into an architecture.',
  rules: 'Every eventline validation rule: what it checks, why it matters and how to fix it, in the core, Event Modeling and stricter profiles.',
  'eventline-axi': 'The eventline-axi command line tool: parse, validate and trace a model, and draw Event Modeling boards and system diagrams.',
  'interview-simulation': 'A system design interview walkthrough for a rate limiter, using an event model with Dynamic Consistency Boundaries.',
  architecture: 'How eventline is built: the parser, the model, the diagram builders and the public library API for parsing, checking and drawing.',
  contributing: 'How to contribute to eventline: the workflow, the standards for examples and docs, and where everything lives in the repo.',
};

export const titleOf = (source, from) => {
  const h1 = /^# +(.+)\r?\n/.exec(source);
  if (!h1) throw new Error(`${from} must start with a "# Title" line`);
  return h1[1].trim();
};

/* titles maps a repo path to its page title, so a link written as [GLOSSARY.md](./GLOSSARY.md) reads as the page's name. */
export function convert(source, from, titles = {}) {
  const text = source.replace(/\r\n?/g, '\n');
  const title = titleOf(text, from);
  let body = text.slice(text.indexOf('\n') + 1).replace(/^\n+/, '');
  body = body.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, label, target) => {
    const next = rewriteLink(target, from);
    if (!next) return m;
    const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(from), target.split('#')[0]));
    const text = /\.md$/.test(label) && titles[repoPath] ? titles[repoPath] : label;
    return `[${text}](${next})`;
  });
  body = tagEventline(body);
  const slug = PAGES[from];
  const description = DESCRIPTIONS[slug];
  if (!description) throw new Error(`${from} has no entry in DESCRIPTIONS`);
  const url = `https://bytesbybrandon.github.io${route(slug)}`;
  const ld = { '@context': 'https://schema.org', '@type': 'TechArticle', headline: title, description, url, inLanguage: 'en', isPartOf: { '@type': 'WebSite', name: 'eventline', url: 'https://bytesbybrandon.github.io/eventline/docs/' }, author: { '@type': 'Person', name: 'Brandon D. Phillips' } };
  const lines = ['---', `title: ${JSON.stringify(title)}`, `description: ${JSON.stringify(description)}`, `editUrl: ${REPO}/edit/main/${from}`];
  if (LABELS[slug]) lines.push('sidebar:', `  label: ${JSON.stringify(LABELS[slug])}`);
  lines.push('head:', '  - tag: script', '    attrs:', '      type: application/ld+json', `    content: ${JSON.stringify(JSON.stringify(ld))}`, '---', '');
  return `${lines.join('\n')}\n${body}`;
}

function diagrams() {
  const { parse, render } = require(path.join(root, 'lib', 'index.js'));
  const model = parse(fs.readFileSync(path.join(root, 'examples', 'billing.dsl'), 'utf8'));
  const dir = path.join(site, 'public', 'diagrams');
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const kind of ['eventmodel', 'contextmap']) {
    for (const theme of ['light', 'dark']) {
      const name = `billing-${kind}-${theme}.svg`;
      fs.writeFileSync(path.join(dir, name), render(model, kind, 'svg', theme));
      written.push(name);
    }
  }
  return written;
}

const pair = (kind, alt) =>
  `<img class="only-light" src="${BASE}/diagrams/billing-${kind}-light.svg" alt="${alt}" />\n<img class="only-dark" src="${BASE}/diagrams/billing-${kind}-dark.svg" alt="${alt}" />`;

const HERO_MODEL = `user -> postTweet(content, media?) in UserTimeline(userId)
on [user-authenticated(userId)]
  --[content.length > 280]--> [tweet-rejected]
  --[default]--> [
    tweet-created { userId, content, media, createdAt: clock.wall() }
  ]
`;

const DERIVED = `

## Derived diagrams

These two are generated from \`examples/billing.dsl\` when this site is built.
Nothing in them is drawn by hand.

### The event model board

${pair('eventmodel', 'The event model board for the billing example')}

### The context map

${pair('contextmap', 'The context map for the billing example')}
`;

export function sync() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const titles = Object.fromEntries(Object.keys(PAGES).map((p) => [p, titleOf(fs.readFileSync(path.join(root, p), 'utf8'), p)]));
  for (const [from, slug] of Object.entries(PAGES)) {
    let page = convert(fs.readFileSync(path.join(root, from), 'utf8'), from, titles);
    if (slug === 'examples') page += DERIVED;
    if (slug === 'index') {
      // The web home is a designed hub (src/components/Hub.astro) that links to every page the README table does.
      const end = page.indexOf('\n---\n', 4) + 5;
      page = `---\ntemplate: splash\n${page.slice(4, end)}\nimport Hub from '../../components/Hub.astro';\n\n<Hub>\n\n\`\`\`eventline\n${HERO_MODEL}\`\`\`\n\n</Hub>\n`;
      fs.writeFileSync(path.join(out, 'index.mdx'), page);
      continue;
    }
    fs.writeFileSync(path.join(out, `${slug}.md`), page);
  }
  fs.writeFileSync(path.join(out, '404.md'), `---\ntitle: Page not found\n---\n\nThat page is not here.\nTry the [documentation index](${route('index')}) or the search box.\n`);
  fs.mkdirSync(path.join(site, 'public', 'fonts'), { recursive: true });
  for (const f of fs.readdirSync(path.join(root, 'site', 'assets', 'fonts'))) {
    fs.copyFileSync(path.join(root, 'site', 'assets', 'fonts', f), path.join(site, 'public', 'fonts', f));
  }
  diagrams();
  console.log(`docs-site: ${Object.keys(PAGES).length} pages and 4 diagrams synced`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) sync();
