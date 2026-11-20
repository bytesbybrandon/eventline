'use strict';

/* Measures cyclomatic complexity, branch coverage and CRAP for every function, so the budget blocks
 * in PERFORMANCE-STANDARDS.md come from one tool. CC is ESLint 9's complexity rule, run through npx
 * (no dependency); branch coverage is V8 block coverage over npm test, attributed to the innermost
 * function by source range.
 *
 * Run: node scripts/measure.js [paths...] [--all] [--json] [--max-cc N] [--no-coverage]
 *   paths         files or folders to measure (default: lib scripts)
 *   --all         list every function, not only those over their tier's limits
 *   --json        print JSON instead of a table
 *   --max-cc N    exit 1 when any function has a CC above N
 *   --no-coverage skip the test run; CRAP is then reported as if uncovered code were covered
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const ESLINT = 'eslint@9';

/* Tier limits, from the "Change risk (CRAP)" table. */
const LIMITS = {
  P0: { cc: 8, cov: 0.9, crap: 10 },
  P1: { cc: 12, cov: 0.8, crap: 15 },
  P2: { cc: 15, cov: 0.7, crap: 25 },
};

/**
 * The tier a source file is held to.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s)
 * - Complexity: O(1)
 * - Cyclomatic Complexity (CC): 6 measured; target <= 15
 * - Branch Coverage: 85.7% measured; target >= 70%
 * - CRAP Score: 6.1 measured; threshold <= 25
 * - Caching: none
 */
function tierOf(file) {
  if (file.startsWith('scripts/') || file === 'lib/folder.js') return 'P2';
  if (file.startsWith('lib/commands/') || file.startsWith('bin/')) return 'P1';
  if (file.startsWith('lib/')) return 'P0';
  return 'P2';
}

const crap = (cc, cov) => cc * cc * (1 - cov) ** 3 + cc;

/* The ESLint flat config: the complexity rule, plus a rule that reports each function's range and
   name at the same place the complexity rule reports it (the function head), so the two can be joined. */
const CONFIG = `
const head = (node, sc) => {
  const p = node.parent;
  if (p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') return p.loc.start;
  if (node.type === 'ArrowFunctionExpression') return sc.getTokenBefore(node.body, (t) => t.value === '=>').loc.start;
  return node.loc.start;
};
const nameOf = (node) => {
  const p = node.parent;
  if (node.id) return node.id.name;
  if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  if ((p.type === 'Property' || p.type === 'MethodDefinition') && p.key.type === 'Identifier') return p.key.name;
  if (p.type === 'AssignmentExpression' && p.left.type === 'MemberExpression' && p.left.property.type === 'Identifier') return p.left.property.name;
  return '';
};
const fn = (ctx) => (node) => {
  const at = head(node, ctx.sourceCode);
  ctx.report({ loc: { start: at, end: at }, message: JSON.stringify({ range: node.range, name: nameOf(node) }) });
};
module.exports = [{
  files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' },
  plugins: { measure: { rules: { functions: { create: (ctx) => ({ FunctionDeclaration: fn(ctx), FunctionExpression: fn(ctx), ArrowFunctionExpression: fn(ctx) }) } } } },
  rules: { complexity: ['warn', 0], 'measure/functions': 'warn' },
}];
`;

/**
 * Every function in the files, with its range, name and CC, from ESLint.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s, plus the npx download on a cold cache)
 * - Complexity: O(F) where F = functions, after one ESLint run
 * - Cyclomatic Complexity (CC): 2 measured; target <= 15
 * - Branch Coverage: 0% measured; target >= 70%, below target (it spawns ESLint or the tests, which npm test does not)
 * - CRAP Score: 6.0 measured; threshold <= 25
 * - Caching: none
 */
function functions(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventline-measure-'));
  try {
    const config = path.join(dir, 'eslint.config.cjs');
    fs.writeFileSync(config, CONFIG);
    const run = spawnSync('npx', ['-y', ESLINT, '-c', config, '--format', 'json', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (!run.stdout) throw new Error(`ESLint did not run: ${run.stderr}`);
    return JSON.parse(run.stdout).flatMap((result) => joinMessages(path.relative(root, result.filePath).split(path.sep).join('/'), result.messages));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Joins the range messages and the complexity messages of one file by where they are reported.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s)
 * - Complexity: O(m) where m = messages
 * - Cyclomatic Complexity (CC): 5 measured; target <= 15
 * - Branch Coverage: 80% measured; target >= 70%
 * - CRAP Score: 5.2 measured; threshold <= 25
 * - Caching: none
 */
function joinMessages(file, messages) {
  const cc = new Map();
  for (const m of messages) {
    if (m.fatal) throw new Error(`${file}:${m.line}: ${m.message}`);
    if (m.ruleId === 'complexity') cc.set(`${m.line}:${m.column}`, +/complexity of (\d+)/.exec(m.message)[1]);
  }
  const out = messages.filter((m) => m.ruleId === 'measure/functions').map((m) => {
    const { range, name } = JSON.parse(m.message);
    return { file, line: m.line, name: name || `(anonymous, line ${m.line})`, start: range[0], end: range[1], cc: cc.get(`${m.line}:${m.column}`) };
  });
  const lost = out.find((f) => f.cc === undefined);
  if (lost) throw new Error(`${file}:${lost.line}: no complexity reported for ${lost.name}; the head locations no longer match ESLint's`);
  return out;
}

/**
 * Runs npm test's files with V8 coverage on and returns the raw coverage results of every process.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (the length of npm test)
 * - Complexity: O(processes · scripts)
 * - Cyclomatic Complexity (CC): 2 measured; target <= 15
 * - Branch Coverage: 0% measured; target >= 70%, below target (it spawns ESLint or the tests, which npm test does not)
 * - CRAP Score: 6.0 measured; threshold <= 25
 * - Caching: none
 */
function coverageRuns() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventline-coverage-'));
  try {
    const run = spawnSync(process.execPath, ['--test', 'test/**/*.test.js'], { cwd: root, env: { ...process.env, NODE_V8_COVERAGE: dir }, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (run.status !== 0) throw new Error(`npm test failed, so coverage would be wrong:\n${run.stdout.slice(-2000)}`);
    return fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).result);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Branch coverage of each function: of its own V8 range and the V8 blocks whose innermost function it is, the share that ran (as c8 counts them).
 * A block's count in one process is the count of the innermost range around it there, because V8 leaves
 * out a block that ran as often as its parent; across processes the highest count wins.
 * A function that never ran is 0%; one that ran and has no blocks is 100%.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s)
 * - Complexity: O(P · R · log R + B · (P · R + F)) per file, where P = processes, R = ranges, B = blocks, F = functions
 * - Cyclomatic Complexity (CC): 15 measured; target <= 15
 * - Branch Coverage: 78.6% measured; target >= 70%
 * - CRAP Score: 17.2 measured; threshold <= 25
 * - Caching: none
 */
function attribute(fns, runs, fileOf) {
  const byFile = new Map();
  for (const result of runs) {
    for (const script of result) {
      const file = fileOf(script.url);
      if (!file) continue;
      const ranges = script.functions.flatMap((f) => f.ranges.map((r, i) => ({ ...r, fn: i === 0 })));
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(ranges);
    }
  }
  const out = new Map();
  for (const [file, processes] of byFile) {
    const mine = fns.filter((f) => f.file === file);
    const blocks = new Map();
    for (const ranges of processes) for (const r of ranges) if (!r.fn) blocks.set(`${r.startOffset}:${r.endOffset}`, r);
    const countIn = (ranges, start, end) => {
      let best = null;
      for (const r of ranges) if (r.startOffset <= start && r.endOffset >= end && (!best || r.endOffset - r.startOffset < best.endOffset - best.startOffset)) best = r;
      return best ? best.count : 0;
    };
    const innermost = (start, end) => mine.reduce((best, f) => (f.start <= start && f.end >= end && (!best || f.end - f.start < best.end - best.start) ? f : best), null);
    /* V8 starts a function at its name or keyword and ESLint at its parameters, so they are joined by end offset, nearest start. */
    const ownRange = (rs, f) => rs.filter((r) => r.fn && r.endOffset === f.end).sort((a, b) => Math.abs(a.startOffset - f.start) - Math.abs(b.startOffset - f.start))[0];
    /* A function V8 lists ran if any listing counts a call; one V8 never lists ran if the code around it did. */
    const ran = (f) => {
      const owns = processes.map((rs) => ownRange(rs, f)).filter(Boolean);
      return owns.length ? owns.some((r) => r.count > 0) : processes.some((rs) => countIn(rs, f.start, f.end) > 0);
    };
    /* As in c8, the function's own range is one branch and each block inside it another. */
    const tally = new Map(mine.map((f) => {
      const did = ran(f);
      const own = processes.some((rs) => ownRange(rs, f)) ? 1 : 0;
      return [f, { ran: did, total: own, covered: did ? own : 0 }];
    }));
    for (const b of blocks.values()) {
      const f = innermost(b.startOffset, b.endOffset);
      if (!f) continue;
      const t = tally.get(f);
      t.total++;
      if (processes.some((rs) => countIn(rs, b.startOffset, b.endOffset) > 0)) t.covered++;
    }
    for (const [f, t] of tally) out.set(f, !t.ran ? 0 : t.total ? t.covered / t.total : 1);
  }
  return out;
}

/* The .js files under the given paths, relative to the repo root. */
function listFiles(paths) {
  const walk = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((f) => walk(path.join(p, f))) : /\.(c|m)?js$/.test(p) ? [p] : []);
  return paths.flatMap((p) => walk(path.resolve(root, p))).map((f) => path.relative(root, f).split(path.sep).join('/'));
}

/* The command line: paths, flags and --max-cc N. */
function parseArgs(argv) {
  const maxAt = argv.indexOf('--max-cc');
  const paths = argv.filter((a, i) => !a.startsWith('--') && (maxAt < 0 || i !== maxAt + 1));
  return { paths: paths.length ? paths : ['lib', 'scripts'], all: argv.includes('--all'), json: argv.includes('--json'), coverage: !argv.includes('--no-coverage'), maxCc: maxAt >= 0 ? +argv[maxAt + 1] : null };
}

/* A repo-relative path for a coverage URL, or null for a script outside the repo. */
function fileOf(url) {
  if (!url.startsWith('file://')) return null;
  const rel = path.relative(root, require('url').fileURLToPath(url)).split(path.sep).join('/');
  return rel.startsWith('..') ? null : rel;
}

/**
 * One row per function with its tier, CC, branch coverage and CRAP, worst CRAP first.
 * A function with no coverage measured is scored as covered and shows "not measured".
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s)
 * - Complexity: O(F log F) where F = functions
 * - Cyclomatic Complexity (CC): 1 measured; target <= 15
 * - Branch Coverage: 100% measured; target >= 70%
 * - CRAP Score: 1.0 measured; threshold <= 25
 * - Caching: none
 */
function rowsOf(fns, cov) {
  return fns.map((f) => {
    const measured = cov.has(f);
    const c = measured ? cov.get(f) : 1;
    const tier = tierOf(f.file);
    const limit = LIMITS[tier];
    const score = crap(f.cc, c);
    return { file: f.file, line: f.line, name: f.name, tier, cc: f.cc, cov: measured ? Math.round(c * 1000) / 10 : null, crap: Math.round(score * 10) / 10, over: f.cc > limit.cc || score > limit.crap || c < limit.cov };
  }).sort((a, b) => b.crap - a.crap || b.cc - a.cc);
}

/* The rows as a Markdown table with a one-line summary. */
function table(rows, shown) {
  const cell = (r) => `| \`${r.name}\` | \`${r.file}:${r.line}\` | ${r.tier} | ${r.cc} | ${r.cov === null ? 'not measured' : `${r.cov}%`} | ${r.crap} |`;
  return ['| Function | File | Tier | CC | Branch cov | CRAP |', '|---|---|---|---|---|---|', ...shown.map(cell), '', `${rows.length} functions, ${rows.filter((r) => r.over).length} over their tier's limits, highest CC ${Math.max(0, ...rows.map((r) => r.cc))}.`].join('\n');
}

/* What to print and the exit code, for rows already measured. */
function report(rows, args) {
  const shown = args.all ? rows : rows.filter((r) => r.over);
  const tooComplex = args.maxCc === null ? [] : rows.filter((r) => r.cc > args.maxCc);
  return { out: args.json ? JSON.stringify(shown, null, 2) : table(rows, shown), errors: tooComplex.map((r) => `${r.file}:${r.line} ${r.name} has CC ${r.cc}, over ${args.maxCc}`), code: tooComplex.length ? 1 : 0 };
}

/* Runs ESLint and, unless told not to, the tests. */
function measure(args) {
  const fns = functions(listFiles(args.paths));
  return rowsOf(fns, args.coverage ? attribute(fns, coverageRuns(), fileOf) : new Map());
}

function main(argv) {
  const args = parseArgs(argv);
  const r = report(measure(args), args);
  console.log(r.out);
  for (const e of r.errors) console.error(e);
  return r.code;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { tierOf, crap, joinMessages, attribute, parseArgs, fileOf, rowsOf, table, listFiles, report, LIMITS };
