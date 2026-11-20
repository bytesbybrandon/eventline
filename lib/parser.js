'use strict';

/*
 * eventline parser.
 *
 * A small recursive-descent parser over the raw text. Statements are order-free:
 *
 *   system Name { key: value ... }
 *   actor Name { key: value, ... }
 *   boundary Name(params) @annotation(...) ...
 *   view Name(params) = [ event facts ] => { shape } @annotation(...) ...
 *   actor -> command(params) [on [ event facts ]] [from [ view facts ]] branch+
 *   event { payload } rule+                      (a policy)
 *   event event-name { fields }                  (a declaration; the field list is optional)
 *
 * Comments run from // to the end of the line.
 * Errors carry a line number and the text that confused the parser.
 */

const Model = require('./model');

class ParseError extends Error {
  constructor(msg, line) {
    super(`${msg} (line ${line})`);
    this.line = line;
  }
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/y;

class Scanner {
  constructor(src, lineOffset = 0) {
    this.s = src;
    this.i = 0;
    this.lineOffset = lineOffset;
    this.starts = [0];
    for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) this.starts.push(k + 1);
  }

  lineAt(at = this.i) {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= at) lo = mid; else hi = mid - 1;
    }
    return lo + 1 + this.lineOffset;
  }

  /* The last line the parser has consumed: trailing blank lines and comments that ws() skipped do not count. */
  endLine() {
    const text = (k) => this.s.slice(this.starts[k], k + 1 < this.starts.length ? this.starts[k + 1] - 1 : this.s.length).trim();
    let k = this.lineAt() - 1 - this.lineOffset;
    if (this.s.slice(this.starts[k], this.i).trim() === '') k--;
    while (k > 0 && (text(k) === '' || text(k).startsWith('//'))) k--;
    return k + 1 + this.lineOffset;
  }

  fail(msg, at = this.i) {
    const rest = this.s.slice(at).split('\n')[0].trim().slice(0, 40);
    throw new ParseError(rest ? `${msg}, found "${rest}"` : `${msg}, found end of input`, this.lineAt(at));
  }

  ws() {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
      if (this.s.startsWith('//', this.i)) {
        while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++;
      } else {
        return;
      }
    }
  }

  get eof() { this.ws(); return this.i >= this.s.length; }

  peek(str) { this.ws(); return this.s.startsWith(str, this.i); }

  /* True when the next word is `word` followed by "[" (the on/from clauses). */
  keywordBracket(word) {
    this.ws();
    if (!this.s.startsWith(word, this.i) || /[\w-]/.test(this.s[this.i + word.length] || '')) return false;
    let j = this.i + word.length;
    while (/\s/.test(this.s[j] || '')) j++;
    return this.s[j] === '[';
  }

  eat(str) {
    if (this.peek(str)) { this.i += str.length; return true; }
    return false;
  }

  expect(str, what) {
    if (!this.eat(str)) this.fail(`Expected ${what || `"${str}"`}`);
  }

  tryIdent() {
    this.ws();
    IDENT.lastIndex = this.i;
    const m = IDENT.exec(this.s);
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }

  ident(what = 'a name') {
    const id = this.tryIdent();
    if (id === null) this.fail(`Expected ${what}`);
    return id;
  }

  /* Reads a balanced region. The cursor must be on the opener. Returns the inner
     text with comments removed. Quotes are respected, so brackets inside strings
     never count. */
  balanced() {
    this.ws();
    const open = this.s[this.i];
    const close = { '(': ')', '{': '}', '[': ']' }[open];
    if (!close) this.fail('Expected "(", "{" or "["');
    const start = this.i;
    this.i++;
    let depth = 1;
    let out = '';
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === '"') {
        let j = this.i + 1;
        while (j < this.s.length && this.s[j] !== '"') j += this.s[j] === '\\' ? 2 : 1;
        out += this.s.slice(this.i, j + 1);
        this.i = j + 1;
        continue;
      }
      if (this.s.startsWith('//', this.i) && (this.i === 0 || /[\s({[,]/.test(this.s[this.i - 1]))) {
        while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++;
        continue;
      }
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) { this.i++; return out; }
      }
      out += ch;
      this.i++;
    }
    this.fail(`Unclosed "${open}"`, start);
  }
}

/* Splits on a separator at nesting depth zero, outside strings. */
/**
 * Splits on a separator at depth zero, outside strings.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(t) where t = characters in text (derived by reading the code)
 * - Cyclomatic Complexity (CC): 18 measured; target <= 8, over budget
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 18.0 measured; threshold <= 10, over budget
 * - Caching: none
 */
function splitTop(text, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (inStr && esc) { esc = false; cur += ch; continue; }
    if (inStr && ch === '\\') { esc = true; cur += ch; continue; }
    if (ch === '"') inStr = !inStr;
    if (!inStr) {
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      else if (ch === sep && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const unquote = (s) => {
  const t = s.trim();
  if (!(t.length > 1 && t.startsWith('"') && t.endsWith('"'))) return t;
  return t.slice(1, -1).replace(/\\(["\\n])/g, (_, c) => (c === 'n' ? '\n' : c));
};

function parseKeyValues(text) {
  const out = {};
  const positional = [];
  for (const part of splitTop(text)) {
    const eq = part.indexOf('=');
    if (eq > 0 && /^[A-Za-z_][\w-]*$/.test(part.slice(0, eq).trim())) out[part.slice(0, eq).trim()] = unquote(part.slice(eq + 1));
    else positional.push(unquote(part));
  }
  if (positional.length) out._ = positional;
  return out;
}

/* @name  |  @name(k=v, ...)  |  @fresh<10s>   A name that repeats becomes a list (several @note lines). */
function parseAnnotations(sc) {
  const out = {};
  const put = (name, value) => { out[name] = name in out ? [].concat(out[name], value) : value; };
  while (sc.peek('@')) {
    sc.i++;
    const name = sc.ident('an annotation name');
    if (sc.s[sc.i] === '(') put(name, parseKeyValues(sc.balanced()));
    else if (sc.s[sc.i] === '<') {
      const end = sc.s.indexOf('>', sc.i);
      if (end < 0) sc.fail('Unclosed "<"');
      put(name, sc.s.slice(sc.i + 1, end).trim());
      sc.i = end + 1;
    } else put(name, true);
  }
  return out;
}

/* Free-text notes: @note("actor reaches this through the Tweets API"). */
function notesFrom(ann) {
  return [].concat(ann.note || []).map((n) => (n && n._ ? n._[0] : '')).filter(Boolean);
}

/* Where a translation comes from: @source(system="Carrier", version="v2"). */
function sourceFrom(ann) {
  const s = [].concat(ann.source || [])[0];
  return s && typeof s === 'object' ? { system: s.system || null, version: s.version || null } : null;
}

/* How a read model is read: @query(returns=list, spec="the open invoices of an account"). */
function queryFrom(ann) {
  const q = [].concat(ann.query || [])[0];
  return q && typeof q === 'object' ? { returns: q.returns || null, spec: q.spec || null } : null;
}

/* How someone or something reaches a command or read model: @trigger(type=ui, name="AuditScreen", part="Fail button", route="POST /audits/{id}/fail").
   Parsed as written; validate checks the values. A bare @trigger or a missing key reads as null. */
function triggersFrom(ann) {
  return [].concat(ann.trigger || []).map((t) => {
    const v = t && typeof t === 'object' ? t : {};
    return { type: v.type || null, name: v.name || (v._ && v._[0]) || null, part: v.part || null, route: v.route || null };
  });
}

/* name | name? | name: type | name?: type */
function parseParams(text) {
  return splitTop(text).map((p) => {
    const m = p.match(/^([A-Za-z_][\w-]*)(\?)?\s*(?::\s*(.+))?$/);
    return m ? { name: m[1], optional: !!m[2], type: m[3] ? squash(m[3]) : null } : { name: p, optional: false, type: null };
  });
}
const paramNames = (defs) => defs.map((d) => d.name + (d.optional ? '?' : ''));

function parseFields(inner) {
  return splitTop(inner).map((p) => {
    const colon = p.indexOf(':');
    return colon > 0 ? { name: p.slice(0, colon).trim(), expr: squash(p.slice(colon + 1)) } : { name: p };
  });
}

/* name  name*  name(args)  name*(args)  [@fresh<10s> | @eventual | @strong]  [as alias] */
function parseFact(text, line) {
  const sc = new Scanner(text, line - 1);
  const name = sc.ident('an event or read model name');
  const wildcard = sc.s[sc.i] === '*';
  if (wildcard) sc.i++;
  const args = sc.s[sc.i] === '(' ? squash(sc.balanced()) : '';
  const ann = parseAnnotations(sc);
  const fact = { name, wildcard, args };
  const fresh = ann.fresh || (ann.eventual && 'eventual') || (ann.strong && 'strong') || null;
  if (fresh) fact.freshness = fresh === true ? null : fresh;
  if (ann.optional) fact.optional = true;
  if (sc.eat('as')) fact.alias = sc.ident('an alias');
  if (!sc.eof) sc.fail('Unexpected text in fact');
  return fact;
}

function parseFactList(inner, line) {
  return splitTop(inner).map((p) => parseFact(p, line));
}

/* [ event { payload } @annotations , ... ] -- cursor sits on the opening bracket */
function parseEmissions(sc) {
  sc.expect('[', '"["');
  const emits = [];
  while (!sc.peek(']')) {
    const event = sc.ident('an event name');
    const em = { event, fields: [] };
    if (sc.peek('{')) {
      em.payload = squash(sc.balanced());
      em.fields = parseFields(em.payload);
    }
    const ann = parseAnnotations(sc);
    if (Object.keys(ann).length) em.annotations = ann;
    emits.push(em);
    if (!sc.eat(',')) break;
  }
  sc.expect(']', '"]" to close the event list');
  return emits;
}

const atGuard = (sc) => sc.peek('--[') || sc.peek('-[');

function parseGuard(sc) {
  const long = sc.peek('--[');
  sc.expect(long ? '--[' : '-[', '"--[" or "-["');
  sc.i--; // reuse balanced() on the "["
  const guard = squash(sc.balanced());
  if (!sc.eat(long ? '-->' : '->')) throw new ParseError(`A guard opens and closes with the same arrow: --[guard]--> or -[guard]-> (this one opened with "${long ? '--[' : '-['}")`, sc.lineAt());
  return guard;
}

function parseSystem(sc, model) {
  const line = sc.lineAt();
  const name = sc.ident('a system name');
  const body = sc.balanced();
  const sys = { name, externals: [], slo: [], regions: [], dataClassification: [], constraints: [], attrs: {}, line };
  for (const raw of body.split('\n')) {
    const m = raw.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'external') {
      sys.externals = splitTop(val).map((p) => {
        const e = p.match(/^([\w-]+)\s*(?:\((.*)\))?$/);
        return e ? { name: e[1], role: e[2] ? e[2].trim() : '' } : { name: p, role: '' };
      });
    } else if (key === 'slo') sys.slo = splitTop(val);
    else if (key === 'region') sys.regions = splitTop(val);
    else if (key === 'data-classification') sys.dataClassification = splitTop(val);
    else if (key === 'constraint') sys.constraints.push(val);
    else sys.attrs[key] = val;
  }
  if (model.system) throw new ParseError('Only one system block is allowed', line);
  model.system = sys;
}

function parseActor(sc, model) {
  const line = sc.lineAt();
  const name = sc.ident('an actor name');
  const attributes = {};
  for (const part of splitTop(sc.balanced())) {
    const colon = part.indexOf(':');
    if (colon > 0) attributes[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
    else attributes[part] = true;
  }
  model.actors.push({ name, attributes, line });
}

function parseBoundary(sc, model) {
  const line = sc.lineAt();
  const name = sc.ident('a boundary name');
  const params = splitTop(sc.balanced());
  model.boundaries.push({ name, params, annotations: parseAnnotations(sc), line });
}

function parseView(sc, model) {
  const line = sc.lineAt();
  const name = sc.ident('a read model name');
  const paramDefs = parseParams(sc.balanced());
  sc.expect('=', '"=" after the read model name');
  const sources = parseFactList(sc.balanced(), line);
  sc.expect('=>', '"=>" before the read model shape');
  const shape = parseFields(sc.balanced());
  const annotations = parseAnnotations(sc);
  const view = { name, params: paramNames(paramDefs), paramDefs, sources, shape, annotations, notes: notesFrom(annotations), triggers: triggersFrom(annotations), query: queryFrom(annotations), scenarios: [], line, endLine: 0 };
  view.endLine = sc.endLine();
  model.views.push(view);
  sc.last = view;
}

function parseCommand(sc, model, actor, line) {
  const name = sc.ident('a command name');
  const paramDefs = parseParams(sc.balanced());
  const cmd = { actor, name, params: paramNames(paramDefs), paramDefs, boundary: null, on: [], from: [], branches: [], annotations: {}, notes: [], scenarios: [], line, endLine: 0 };
  sc.ws();
  const inClause = /^in\s+([A-Za-z_][\w-]*)\s*\(/.exec(sc.s.slice(sc.i, sc.i + 120));
  if (inClause) {
    sc.i += inClause[0].length - 1;
    cmd.boundary = { name: inClause[1], args: squash(sc.balanced()) };
  }
  cmd.annotations = parseAnnotations(sc);
  cmd.notes = notesFrom(cmd.annotations);
  cmd.triggers = triggersFrom(cmd.annotations);
  cmd.source = sourceFrom(cmd.annotations);
  for (;;) {
    if (sc.keywordBracket('on')) {
      sc.i += 2;
      cmd.on.push(...parseFactList(sc.balanced(), line));
    } else if (sc.keywordBracket('from')) {
      sc.i += 4;
      cmd.from.push(...parseFactList(sc.balanced(), line));
    } else break;
  }
  while (atGuard(sc)) {
    const bline = sc.lineAt();
    const guard = parseGuard(sc);
    let emits = [];
    let reject = null;
    sc.ws();
    const rej = /^reject\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(sc.s.slice(sc.i, sc.i + 80));
    if (rej) { sc.i += rej[0].length; reject = rej[1]; } else emits = parseEmissions(sc);
    cmd.branches.push({ guard: guard === 'default' ? null : guard, default: guard === 'default', emits, reject, line: bline });
  }
  if (!cmd.branches.length) throw new ParseError(`Command "${name}" needs at least one --[guard]--> [events] or --[guard]--> reject CODE branch (or the short form -[guard]->)`, line);
  cmd.endLine = sc.endLine();
  model.commands.push(cmd);
  sc.last = cmd;
}

/* A policy starts from an event or a schedule. Then, optionally, from [views] it reads, then rules:
 *   --[guard]--> worker -> command(args)
 *   --[guard]--> worker -> [ events ]
 *   --[guard]--> [ events ]
 *   -> worker -> command(args)                                        */
function parsePolicy(sc, model, trigger, line) {
  if (trigger.event && sc.peek('{')) { trigger.payload = squash(sc.balanced()); trigger.fields = parseFields(trigger.payload); }
  const annotations = parseAnnotations(sc);
  const policy = { name: null, trigger, annotations, notes: notesFrom(annotations), from: [], rules: [], line, endLine: 0 };
  if (sc.keywordBracket('from')) { sc.i += 4; policy.from = parseFactList(sc.balanced(), line); }
  if (trigger.readModels && !policy.from.length) throw new ParseError('An automation that starts from read models names at least one: from [ReadModel] -> worker -> command()', line);
  while (atGuard(sc) || sc.peek('->')) {
    const rline = sc.lineAt();
    const rule = { guard: null, worker: null, command: null, emits: [], line: rline };
    if (atGuard(sc)) rule.guard = parseGuard(sc);
    else sc.expect('->');
    if (rule.guard === 'default') rule.guard = null;
    if (sc.peek('[')) {
      rule.emits = parseEmissions(sc);
    } else {
      rule.worker = sc.ident('a worker name, or "[" to list events');
      sc.expect('->', '"->" after the worker');
      if (sc.peek('[')) rule.emits = parseEmissions(sc);
      else {
        const cname = sc.ident('a command name');
        rule.command = { name: cname, args: squash(sc.balanced()) };
      }
    }
    policy.rules.push(rule);
  }
  const what = trigger.event ? `on "${trigger.event}"` : trigger.readModels ? 'from read models' : `on "${trigger.schedule}"`;
  if (!policy.rules.length) throw new ParseError(`Policy ${what} needs a rule such as -> worker -> command()`, line);
  policy.endLine = sc.endLine();
  model.policies.push(policy);
}

/* context Name { key: value ...  then statements }  Members belong to the context; other contexts see only what it publishes. */
function parseContext(sc, model) {
  const line = sc.lineAt();
  const name = sc.ident('a context name');
  sc.expect('{', '"{" after the context name');
  const ctx = { name, description: '', role: 'core', publishes: [], attrs: {}, line };
  model.contexts.push(ctx);
  for (;;) {
    sc.ws();
    if (sc.i >= sc.s.length) throw new ParseError(`Unclosed "{" for context ${name}`, line);
    if (sc.eat('}')) { sc.last = null; return; }
    const attr = /^([a-z][a-z-]*)[ \t]*:[ \t]*([^\n]*)/.exec(sc.s.slice(sc.i));
    if (attr) {
      sc.i += attr[0].length;
      const val = attr[2].replace(/(^|\s)\/\/.*$/, '').trim();
      if (attr[1] === 'description') ctx.description = val;
      else if (attr[1] === 'role') ctx.role = val;
      else if (attr[1] === 'publishes') ctx.publishes = splitTop(val);
      else ctx.attrs[attr[1]] = val;
      continue;
    }
    parseStatement(sc, model, name);
  }
}

/* scenario "name" { ...lines as written... }  Checks the command or view just above it.
   The body is kept as written, so Gherkin can hold any characters, and ends at a line holding only "}". */
/* A scenario written as steps instead of prose. Lowercase keywords, one step to a line:
     given [a-done { id: 1 }, b-done]     (zero or more)
     when go(id: 1)                       (exactly one)
     then [c-done { id: 1 }]  |  then reject CODE
   A scenario is typed when a line has that shape; Gherkin ("Given a user ...") stays prose. Returns null for prose. */
const STEP_START = /^\s*(given\s*\[|when\s+[A-Za-z_][\w-]*\s*\(|then\s*\[|then\s+reject\s)/;
function parseSteps(raw, firstLine, name) {
  if (!raw.some((l) => STEP_START.test(l))) return null;
  const steps = { given: [], when: null, then: null };
  raw.forEach((text, i) => {
    const at = firstLine + i;
    const t = text.trim();
    if (!t) return;
    const word = /^(given|when|then)\b/.exec(t);
    if (!word) throw new ParseError(`Scenario "${name}" mixes steps with other text. A step is given [...], when command(...), or then [...] / then reject CODE`, at);
    const rest = t.slice(word[1].length);
    const sub = new Scanner(rest.trim(), at - 1);
    if (word[1] === 'when') {
      if (steps.when) throw new ParseError(`Scenario "${name}" has two when steps; a scenario checks one command`, at);
      const cname = sub.ident('a command name');
      const args = sub.peek('(') ? squash(sub.balanced()) : '';
      steps.when = { name: cname, args, fields: parseFields(args), line: at };
    } else if (word[1] === 'given') {
      for (const e of parseEmissions(sub)) steps.given.push({ event: e.event, fields: e.fields, payload: e.payload || '', line: at });
    } else {
      if (steps.then) throw new ParseError(`Scenario "${name}" has two then steps`, at);
      const rej = /^reject\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(rest.trim());
      steps.then = rej ? { reject: rej[1], events: [], line: at } : { reject: null, events: parseEmissions(sub).map((e) => ({ event: e.event, fields: e.fields, payload: e.payload || '' })), line: at };
    }
  });
  return steps;
}

function parseScenario(sc, target, line) {
  const head = /^\s*"((?:[^"\\]|\\.)*)"[ \t]*\{[ \t]*\n/.exec(sc.s.slice(sc.i));
  if (!head) throw new ParseError('A scenario is: scenario "name" {, then its lines, then } on a line of its own', line);
  if (!target) throw new ParseError('A scenario goes right after the command or read model it checks', line);
  const name = unquote(`"${head[1]}"`);
  sc.i += head[0].length;
  const lines = [];
  const raw = [];
  for (;;) {
    if (sc.i >= sc.s.length) throw new ParseError(`Unclosed "{" for scenario "${name}"`, line);
    let end = sc.s.indexOf('\n', sc.i);
    if (end < 0) end = sc.s.length;
    const text = sc.s.slice(sc.i, end);
    sc.i = Math.min(end + 1, sc.s.length);
    if (text.trim() === '}') break;
    raw.push(text);
    lines.push(text);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length), Infinity);
  const steps = parseSteps(raw, line + 1, name);
  target.scenarios.push({ name, text: lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).replace(/\s+$/, '')).join('\n'), line, steps });
  sc.last = target;
}

function parseStatement(sc, model, ctx) {
  const before = { actors: model.actors.length, boundaries: model.boundaries.length, views: model.views.length, commands: model.commands.length, policies: model.policies.length };
  sc.prev = sc.last;
  sc.last = null;
  parseOne(sc, model, ctx);
  if (ctx) for (const k of Object.keys(before)) for (let i = before[k]; i < model[k].length; i++) model[k][i].context = ctx;
}

/**
 * Parses one statement at the cursor (hot path of parse).
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(z + d) per statement where z = characters of the statement, d = event declarations so far (declarations.find on each declaration); O(n + d²) per parse (derived by reading the code)
 * - Cyclomatic Complexity (CC): 41 measured; target <= 8, over the hard ceiling of 30
 * - Branch Coverage: 99% measured; target >= 90%
 * - CRAP Score: 41.0 measured; threshold <= 10, over the hard ceiling of 30
 * - Caching: none
 */
function parseOne(sc, model, ctx) {
  const line = sc.lineAt();
  const word = sc.ident('a statement');
  const rest = sc.s.slice(sc.i);

  if (word === 'context' && /^\s*[A-Za-z_]/.test(rest)) {
    if (ctx) throw new ParseError('A context cannot contain another context', line);
    return parseContext(sc, model);
  }
  if (word === 'system' && /^\s*[A-Za-z_]/.test(rest)) {
    if (ctx) throw new ParseError('The system block goes at the top level, outside any context', line);
    return parseSystem(sc, model);
  }
  // policy Name = <any policy statement>; "policy" followed by anything else keeps its old meaning
  if (word === 'policy' && /^\s*[A-Za-z_][\w-]*\s*=(?![=>])/.test(rest)) {
    const name = sc.ident('a policy name');
    sc.expect('=');
    const n = model.policies.length;
    parseOne(sc, model, ctx);
    const p = model.policies[n];
    if (model.policies.length !== n + 1 || p.name) throw new ParseError(`policy ${name} = needs an event, timer or from [ReadModel] trigger with a rule`, line);
    p.name = name;
    return;
  }
  // event item-added { fields } declares an event; "event" followed by anything else keeps its old meaning
  const decl = word === 'event' && /^[ \t]+([A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*)[ \t]*(?=\{|\/\/|\n|$)/.exec(rest);
  if (decl && decl[1] !== 'from') {
    const name = decl[1];
    sc.i += decl[0].length;
    const fields = sc.peek('{') ? parseFields(sc.balanced()) : null;
    const twice = model.declarations.find((d) => d.name === name);
    if (twice) throw new ParseError(`event ${name} is declared twice (first on line ${twice.line}); an event is declared once across the model`, line);
    model.declarations.push({ name, fields, line, context: ctx || null });
    return;
  }
  if (word === 'scenario' && /^\s*"/.test(rest)) return parseScenario(sc, sc.prev, line);
  if (word === 'actor' && /^\s*[A-Za-z_][\w-]*\s*\{/.test(rest)) return parseActor(sc, model);
  if (word === 'boundary' && /^\s*[A-Za-z_]/.test(rest)) return parseBoundary(sc, model);
  // readmodel from [...] is a policy on an event called readmodel, as it was before readmodel became a keyword
  if ((word === 'view' || word === 'readmodel') && /^\s*[A-Za-z_]/.test(rest) && !(word === 'readmodel' && /^\s*from\s*\[/.test(rest))) return parseView(sc, model);

  // a timer starts a policy: every 5 minutes, or cron "0 * * * *"
  const every = word === 'every' && /^\s*(\d+)\s+(seconds?|minutes?|hours?|days?)\b/.exec(rest);
  if (every) {
    sc.i += every[0].length;
    return parsePolicy(sc, model, { event: null, schedule: `every ${every[1]} ${every[2]}`, readModels: false, fields: [] }, line);
  }
  const cron = word === 'cron' && /^\s*"([^"]*)"/.exec(rest);
  if (cron) {
    sc.i += cron[0].length;
    return parsePolicy(sc, model, { event: null, schedule: `cron "${cron[1]}"`, readModels: false, fields: [] }, line);
  }

  // actor -> command(...)   or   event -> worker -> ...
  if (sc.peek('->')) {
    const save = sc.i;
    sc.i += 2;
    sc.ident('a command or worker name');
    const isCommand = sc.s[sc.i] === '(' || /^\s*\(/.test(sc.s.slice(sc.i));
    sc.i = save;
    if (isCommand) { sc.i += 2; return parseCommand(sc, model, word, line); }
    return parsePolicy(sc, model, { event: word, readModels: false, fields: [] }, line);
  }
  if (sc.peek('{') || atGuard(sc) || sc.peek('@') || sc.keywordBracket('from')) return parsePolicy(sc, model, { event: word, readModels: false, fields: [] }, line);
  if (word === 'from') {
    // an automation that starts from read models; the cursor goes back onto "from" so parsePolicy reads the list
    if (!/^\s*\[/.test(rest)) throw new ParseError('An automation reads read models: write from [ReadModel] -> worker -> command(), or event from [ReadModel] -> worker -> command()', line);
    sc.i = sc.s.lastIndexOf('from', sc.i);
    return parsePolicy(sc, model, { event: null, schedule: null, readModels: true, fields: [] }, line);
  }

  throw new ParseError(`Unexpected "${word}". A statement starts with system, context, actor, boundary, view or readmodel, "actor -> command(...)", "event { ... }", "from [ReadModel] -> worker -> command()", "every 5 minutes", "policy Name = ...", or "event name { fields }"`, line);
}

/* The first line that records or reads an event that nothing declares. */
const eventLine = (model, name) => [
  ...model.commands.flatMap((c) => c.branches.filter((b) => b.emits.some((e) => e.event === name)).map((b) => b.line)),
  ...model.policies.flatMap((p) => p.rules.filter((r) => r.emits.some((e) => e.event === name)).map((r) => r.line)),
  ...model.commands.filter((c) => c.on.some((f) => f.name === name)).map((c) => c.line),
  ...model.views.filter((v) => v.sources.some((s) => s.name === name)).map((v) => v.line),
  ...model.policies.filter((p) => p.trigger.event === name).map((p) => p.line),
][0];

/**
 * Parses DSL text into a finalized Model.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(n + d²) where n = characters, d = event declarations (parseOne checks each declaration against all earlier ones); budget O(n) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 9 measured; target <= 8, over budget
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 9.0 measured; threshold <= 10
 * - Caching: none; Model.finalize builds the event index once
 */
function parse(content) {
  const model = new Model();
  const sc = new Scanner(content.replace(/\r\n?/g, '\n'));
  while (!sc.eof) parseStatement(sc, model, null);
  model.finalize();
  const taken = new Map([...model.commands.map((x) => [x.name, `a command on line ${x.line}`]), ...model.views.map((x) => [x.name, `a read model on line ${x.line}`])].reverse());
  const seen = new Set();
  for (const p of model.policies) {
    if (!p.name) continue;
    if (seen.has(p.name)) throw new ParseError(`policy ${p.name} is named twice; policy names are unique across the model`, p.line);
    const e = model.events.get(p.name);
    const clash = taken.get(p.name) || (e && (e.declared ? `an event declared on line ${e.declared.line}` : `an event on line ${eventLine(model, p.name)}`));
    if (clash) throw new ParseError(`Policy "${p.name}" has the same name as ${clash}; give the policy another name`, p.line);
    seen.add(p.name);
  }
  return model;
}

module.exports = { parse, ParseError, splitTop };
