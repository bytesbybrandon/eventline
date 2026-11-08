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

/* How a view is read: @query(returns=list, spec="the open invoices of an account"). */
function queryFrom(ann) {
  const q = [].concat(ann.query || [])[0];
  return q && typeof q === 'object' ? { returns: q.returns || null, spec: q.spec || null } : null;
}

/* How someone or something reaches a command or view: @trigger(type=ui, name="AuditScreen", part="Fail button", route="POST /audits/{id}/fail").
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
  const name = sc.ident('an event or view name');
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

function parseGuard(sc) {
  sc.expect('--[', '"--["');
  sc.i--; // reuse balanced() on the "["
  const guard = squash(sc.balanced());
  sc.expect('-->', '"-->" after the guard');
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
  const name = sc.ident('a view name');
  const paramDefs = parseParams(sc.balanced());
  sc.expect('=', '"=" after the view name');
  const sources = parseFactList(sc.balanced(), line);
  sc.expect('=>', '"=>" before the view shape');
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
  while (sc.peek('--[')) {
    const bline = sc.lineAt();
    const guard = parseGuard(sc);
    let emits = [];
    let reject = null;
    sc.ws();
    const rej = /^reject\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(sc.s.slice(sc.i, sc.i + 80));
    if (rej) { sc.i += rej[0].length; reject = rej[1]; } else emits = parseEmissions(sc);
    cmd.branches.push({ guard: guard === 'default' ? null : guard, default: guard === 'default', emits, reject, line: bline });
  }
  if (!cmd.branches.length) throw new ParseError(`Command "${name}" needs at least one --[guard]--> [events] or --[guard]--> reject CODE branch`, line);
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
  const policy = { trigger, annotations, notes: notesFrom(annotations), from: [], rules: [], line, endLine: 0 };
  if (sc.keywordBracket('from')) { sc.i += 4; policy.from = parseFactList(sc.balanced(), line); }
  while (sc.peek('--[') || sc.peek('->')) {
    const rline = sc.lineAt();
    const rule = { guard: null, worker: null, command: null, emits: [], line: rline };
    if (sc.peek('--[')) rule.guard = parseGuard(sc);
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
  const what = trigger.event ? `on "${trigger.event}"` : `on "${trigger.schedule}"`;
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
function parseScenario(sc, target, line) {
  const head = /^\s*"((?:[^"\\]|\\.)*)"[ \t]*\{[ \t]*\n/.exec(sc.s.slice(sc.i));
  if (!head) throw new ParseError('A scenario is: scenario "name" {, then its lines, then } on a line of its own', line);
  if (!target) throw new ParseError('A scenario goes right after the command or view it checks', line);
  const name = unquote(`"${head[1]}"`);
  sc.i += head[0].length;
  const lines = [];
  for (;;) {
    if (sc.i >= sc.s.length) throw new ParseError(`Unclosed "{" for scenario "${name}"`, line);
    let end = sc.s.indexOf('\n', sc.i);
    if (end < 0) end = sc.s.length;
    const text = sc.s.slice(sc.i, end);
    sc.i = Math.min(end + 1, sc.s.length);
    if (text.trim() === '}') break;
    lines.push(text);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length), Infinity);
  target.scenarios.push({ name, text: lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).replace(/\s+$/, '')).join('\n'), line });
  sc.last = target;
}

function parseStatement(sc, model, ctx) {
  const before = { actors: model.actors.length, boundaries: model.boundaries.length, views: model.views.length, commands: model.commands.length, policies: model.policies.length };
  sc.prev = sc.last;
  sc.last = null;
  parseOne(sc, model, ctx);
  if (ctx) for (const k of Object.keys(before)) for (let i = before[k]; i < model[k].length; i++) model[k][i].context = ctx;
}

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
  if (word === 'scenario' && /^\s*"/.test(rest)) return parseScenario(sc, sc.prev, line);
  if (word === 'actor' && /^\s*[A-Za-z_][\w-]*\s*\{/.test(rest)) return parseActor(sc, model);
  if (word === 'boundary' && /^\s*[A-Za-z_]/.test(rest)) return parseBoundary(sc, model);
  if (word === 'view' && /^\s*[A-Za-z_]/.test(rest)) return parseView(sc, model);

  // a timer starts a policy: every 5 minutes, or cron "0 * * * *"
  const every = word === 'every' && /^\s*(\d+)\s+(seconds?|minutes?|hours?|days?)\b/.exec(rest);
  if (every) {
    sc.i += every[0].length;
    return parsePolicy(sc, model, { event: null, schedule: `every ${every[1]} ${every[2]}`, fields: [] }, line);
  }
  const cron = word === 'cron' && /^\s*"([^"]*)"/.exec(rest);
  if (cron) {
    sc.i += cron[0].length;
    return parsePolicy(sc, model, { event: null, schedule: `cron "${cron[1]}"`, fields: [] }, line);
  }

  // actor -> command(...)   or   event -> worker -> ...
  if (sc.peek('->')) {
    const save = sc.i;
    sc.i += 2;
    sc.ident('a command or worker name');
    const isCommand = sc.s[sc.i] === '(' || /^\s*\(/.test(sc.s.slice(sc.i));
    sc.i = save;
    if (isCommand) { sc.i += 2; return parseCommand(sc, model, word, line); }
    return parsePolicy(sc, model, { event: word, fields: [] }, line);
  }
  if (sc.peek('{') || sc.peek('--[') || sc.peek('@') || sc.keywordBracket('from')) return parsePolicy(sc, model, { event: word, fields: [] }, line);

  throw new ParseError(`Unexpected "${word}". A statement starts with system, context, actor, boundary, view, "actor -> command(...)", "event { ... }", or "every 5 minutes"`, line);
}

function parse(content) {
  const model = new Model();
  const sc = new Scanner(content.replace(/\r\n?/g, '\n'));
  while (!sc.eof) parseStatement(sc, model, null);
  model.finalize();
  return model;
}

module.exports = { parse, ParseError, splitTop };
