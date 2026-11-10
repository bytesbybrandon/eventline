/* eventline, bundled from lib/ by scripts/build-site.js. Do not edit. */
(function () {
'use strict';
var defs = [
function (module, exports, __r) {
'use strict';

/* Public API: parse a model, check it, draw it. Pure functions, no I/O, safe to bundle for a browser. */
const { parse, ParseError } = __r(1);
const { check, RULES } = __r(3);
const { render, KINDS } = __r(11);
const { linkMap } = __r(6);

module.exports = { parse, ParseError, check, RULES, render, linkMap, KINDS };

},
function (module, exports, __r) {
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

const Model = __r(2);

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
  if (!target) throw new ParseError('A scenario goes right after the command or view it checks', line);
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

},
function (module, exports, __r) {
'use strict';

/*
 * The parsed model plus the indexes every command and diagram needs.
 * The parser fills the arrays; finalize() derives the rest, so no command
 * has to re-walk the statements to answer "who emits this event?".
 */
class Model {
  constructor() {
    this.system = null;
    this.contexts = [];
    this.actors = [];
    this.boundaries = [];
    this.views = [];
    this.commands = [];
    this.policies = [];
    this.events = new Map();
  }

  finalize() {
    this.events = new Map();
    const ev = (name) => {
      if (!this.events.has(name)) this.events.set(name, { name, emittedBy: [], consumedBy: [], fields: [] });
      return this.events.get(name);
    };
    const emitted = (em, by) => {
      const e = ev(em.event);
      e.emittedBy.push(by);
      if (em.fields.length > e.fields.length) e.fields = em.fields;
    };

    for (const cmd of this.commands) {
      for (const fact of cmd.on) ev(fact.name).consumedBy.push({ kind: 'command', name: cmd.name, context: cmd.context });
      for (const br of cmd.branches) {
        for (const em of br.emits) emitted(em, { kind: 'command', name: cmd.name, branch: br.default ? 'default' : br.guard, context: cmd.context });
      }
    }
    for (const view of this.views) {
      for (const src of view.sources) ev(src.name).consumedBy.push({ kind: 'view', name: view.name, context: view.context });
    }
    for (const pol of this.policies) {
      const who = pol.trigger.event || pol.trigger.schedule;
      if (pol.trigger.event) {
        const t = ev(pol.trigger.event);
        t.consumedBy.push({ kind: 'policy', name: pol.trigger.event, context: pol.context });
        if (pol.trigger.fields.length > t.fields.length) t.fields = pol.trigger.fields;
      }
      for (const rule of pol.rules) {
        for (const em of rule.emits) emitted(em, { kind: 'policy', name: who, worker: rule.worker, context: pol.context });
      }
    }
  }

  /* 'actor' (declared), 'external' (a system.external, or a name such as
     stripe-webhook that starts with one), or 'unknown'. Case-insensitive,
     because commands write `user` for `actor User`. */
  actorKind(name) {
    const n = name.toLowerCase();
    if (this.actors.some((a) => a.name.toLowerCase() === n)) return 'actor';
    const ext = (this.system ? this.system.externals : []).map((e) => e.name.toLowerCase());
    if (ext.some((e) => n === e || n.startsWith(e + '-'))) return 'external';
    return 'unknown';
  }

  /* Events nobody emits: facts the model assumes (a session exists, a row exists). */
  assumedEvents() {
    return [...this.events.values()].filter((e) => e.emittedBy.length === 0).map((e) => e.name);
  }

  toJSON() {
    return {
      system: this.system,
      contexts: this.contexts,
      actors: this.actors,
      boundaries: this.boundaries,
      views: this.views,
      commands: this.commands,
      policies: this.policies,
      events: [...this.events.values()],
    };
  }
}

module.exports = Model;

},
function (module, exports, __r) {
'use strict';

const { RULES, BY_ID, CATEGORIES, PROFILES } = __r(4);
const { coreIssues } = __r(5);
const { scheduleIssues, scenarioStepIssues, hotspotIssues, acceptIssues, eventmodelingIssues, slicermIssues, sliceOf } = __r(10);

const DOCS = 'https://bytesbybrandon.github.io/eventline/docs/rules/#';

/* The statements of a model, with where each begins and ends, so a finding can say what it is about. */
function statements(model) {
  const list = [];
  const add = (kind, name, s, slice) => list.push({ kind, name, line: s.line, endLine: s.endLine || s.line, slice: slice || null });
  for (const c of model.commands) add('command', c.name, c, sliceOf(c.annotations));
  for (const v of model.views) add('view', v.name, v, sliceOf(v.annotations));
  for (const p of model.policies) add('policy', p.trigger.event || p.trigger.schedule, p, sliceOf(p.annotations));
  for (const b of model.boundaries) add('boundary', b.name, b);
  for (const c of model.contexts) add('context', c.name, c);
  for (const a of model.actors) add('actor', a.name, a);
  return list.filter((s) => Number.isInteger(s.line));
}

function enrich(found, list, profile) {
  const meta = BY_ID.get(found.rule);
  if (!meta) throw new Error(`Rule "${found.rule}" is not in the catalogue (lib/rules/catalogue.js)`);
  const line = Number.isInteger(found.line) ? found.line : null;
  const inside = line === null ? [] : list.filter((s) => line >= s.line && line <= s.endLine).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line));
  const subject = inside[0] || null;
  return {
    severity: profile === 'slicerm' && meta.slicerm ? meta.slicerm : found.severity,
    rule: found.rule,
    category: meta.category,
    profile: meta.profile,
    message: found.message,
    line: found.line,
    endLine: subject && line === subject.line ? subject.endLine : line,
    subject: subject ? { kind: subject.kind, name: subject.name, line: subject.line, endLine: subject.endLine } : null,
    slice: subject ? subject.slice : null,
    docs: DOCS + found.rule,
  };
}

/* A finding on a statement that carries @accept for its rule stays in the list, marked with the reason. Severity does not change. */
function accepted(model, issues, list) {
  const marks = new Map();
  for (const x of [...model.commands, ...model.views, ...model.policies, ...model.boundaries]) {
    const rules = [].concat((x.annotations && x.annotations.accept) || []).filter((a) => a && typeof a === 'object' && a.rule && BY_ID.has(a.rule) && String(a.reason || '').trim());
    if (rules.length) marks.set(x.line, rules);
  }
  const used = new Set();
  for (const i of issues) {
    const hit = i.subject && (marks.get(i.subject.line) || []).find((a) => a.rule === i.rule);
    if (hit) { i.accepted = { reason: hit.reason }; used.add(`${i.subject.line}:${i.rule}`); }
  }
  for (const [line, rules] of marks) for (const a of rules) {
    if (used.has(`${line}:${a.rule}`)) continue;
    const s = list.find((x) => x.line === line);
    const meta = BY_ID.get('accept-unused');
    issues.push({ severity: meta.severity, rule: 'accept-unused', category: meta.category, profile: meta.profile, message: `The @accept of ${a.rule} on "${s ? s.name : 'this statement'}" accepts nothing: that rule reports nothing there`, line, endLine: s ? s.endLine : line, subject: s ? { kind: s.kind, name: s.name, line: s.line, endLine: s.endLine } : null, slice: s ? s.slice : null, docs: DOCS + 'accept-unused' });
  }
  return issues;
}

/*
 * What is wrong with a model. profile is core (default), workshop, eventmodeling or slicerm; workshop is eventmodeling with everything reported as info, and slicerm includes eventmodeling.
 * Every finding says what kind of problem it is, which statement it belongs to, and where that statement ends.
 */
function check(model, opts = {}) {
  const profile = opts.profile || 'core';
  if (!PROFILES.includes(profile)) throw new Error(`Unknown profile "${profile}". Choose one of: ${PROFILES.join(', ')}`);
  const guidelines = profile !== 'core';
  const found = [...coreIssues(model), ...scheduleIssues(model), ...scenarioStepIssues(model), ...hotspotIssues(model, guidelines), ...acceptIssues(model, BY_ID)];
  if (guidelines) found.push(...eventmodelingIssues(model));
  if (profile === 'slicerm') found.push(...slicermIssues(model));
  const list = statements(model);
  const issues = found.map((f) => enrich(f, list, profile));
  if (profile === 'workshop') for (const i of issues) if (i.profile !== 'core') i.severity = 'info';
  return accepted(model, issues, list);
}

module.exports = { check, RULES, CATEGORIES, PROFILES };

},
function (module, exports, __r) {
'use strict';

/*
 * Every rule `check` can report, in one place. The reference page (docs/RULES.md) is generated from this
 * list, `eventline-axi rules` prints it, and a test fails if a rule reports an id that is not here.
 *
 *   profile   core: the language is wrong or inconsistent. Always on.
 *             workshop: the eventmodeling rules, every one reported as info. For exploring a model before it is meant to be right.
 *             eventmodeling: Event Modeling guidelines. Opt in with --profile eventmodeling.
 *             slicerm: stricter, for tools that treat a slice as one unit of delivery. Includes eventmodeling.
 *   severity  error: the model cannot mean what it says. warn: a gap that is almost always a mistake.
 *             info: worth a second look. `slicerm` may raise a rule's severity (see `slicerm`).
 *   category  the kind of thing that is wrong, so a tool can group findings.
 */

const CATEGORIES = {
  structure: 'A statement is missing something it needs',
  order: 'Things depend on each other in a way no order can satisfy',
  boundary: 'Consistency scopes and the edges between contexts',
  fields: 'Information that appears from nowhere',
  references: 'A name points at something that is not there',
  naming: 'Names that break the project convention',
  routes: 'How triggers reach commands and views',
  schedule: 'When timers fire',
  scenarios: 'Given, when, then examples',
  triggers: 'What a person or system uses to reach a command or view',
  links: 'Links between diagrams',
  slices: 'What belongs together in one unit of delivery',
  hints: 'Allowed, but often worth a second look',
};

const R = (id, profile, severity, category, title, why, fix, extra = {}) => ({ id, profile, severity, category, title, why, fix, ...extra });

const RULES = [
  // ---- core: the language itself ----
  R('on-facts', 'core', 'error', 'references', 'A view listed in on [...]', 'on [...] lists the events a command needs. A view is read with from [...], not on.', 'Move the view to from [...], or list the event the view is built from.'),
  R('from-facts', 'core', 'warn', 'references', 'Reads a view that is not declared', 'from [...] names a view that no view statement defines, so nothing says what it holds.', 'Declare the view, or fix the name.'),
  R('unknown-boundary', 'core', 'error', 'boundary', 'Command is in a boundary that is not declared', 'in Name(key) scopes a command to a boundary, and no boundary statement defines it.', 'Add boundary Name(key), or fix the name.'),
  R('view-from-view', 'core', 'error', 'references', 'A view projects from a view', 'Views are folds over events. A view cannot be built from another view.', 'List the events the second view needs, not the view.'),
  R('view-sources', 'core', 'warn', 'structure', 'A view has no source events', 'A view with no events folds nothing.', 'List the events it projects from between the brackets.'),
  R('no-events', 'core', 'warn', 'structure', 'A command never records an event', 'Every command records at least one event on its happy path, or nothing happened.', 'Add events to the --[default]--> branch.'),
  R('missing-default', 'core', 'warn', 'structure', 'A command has no default branch', 'The default branch is the happy path. Without it a reader cannot tell what success looks like.', 'Add --[default]--> [ ... ] as the last branch.'),
  R('default-rejects', 'core', 'warn', 'structure', 'The default branch refuses', 'The default branch should record events. A refusal belongs on a guarded branch.', 'Put the refusal on a --[guard]--> reject CODE branch.'),
  R('rejection-as-event', 'core', 'info', 'structure', 'A rejection written as an event', 'An event named ...-rejected usually means nothing was recorded, and then it is a refusal, not an event.', 'Write --[guard]--> reject CODE when nothing is recorded.'),
  R('optional-on', 'core', 'warn', 'references', 'An on fact marked optional', 'Only from [...] reads can come back empty. A fact in on [...] must have happened.', 'Move it to from [...] or drop @optional.'),
  R('command-inputs', 'core', 'info', 'structure', 'A command lists no facts it needs', 'Fine for a command that starts something. Worth a look for one that should depend on what happened before.', 'Add on [...] or from [...], or leave it if the command creates something.'),
  R('command-boundary', 'core', 'info', 'boundary', 'A command does not say which boundary it is in', 'When the model has boundaries, each command should say which one its decision is scoped to.', 'Add in BoundaryName(key).'),
  R('boundaries', 'core', 'info', 'boundary', 'No boundary declared', 'Commands have no stated consistency scope.', 'Add boundary Name(key) and put commands in it.'),
  R('unknown-actor', 'core', 'info', 'references', 'A command actor is not declared', 'The actor is neither a declared actor nor a system external.', 'Declare it with actor Name { ... } or list it under external in the system block.'),
  R('freshness', 'core', 'info', 'references', 'A view is read without a freshness stance', 'A command that reads a view decides on something that may be stale.', 'Add @fresh<10s>, @eventual or @strong to the fact.'),
  R('policy-guard', 'core', 'info', 'structure', 'A policy rule has no guard', 'An event-triggered rule with no guard runs on every occurrence.', 'Add --[condition]--> or leave it if that is intended.'),
  R('unpublished-event', 'core', 'warn', 'boundary', 'An event crosses a context without being published', 'A context reads an event another context records but does not list in publishes.', 'Add the event to publishes of the context that records it, or stop reading it.'),
  R('assumed-events', 'core', 'info', 'references', 'Events nothing records', 'No command or policy records these, so the model assumes the facts exist.', 'Fine for facts from outside. Otherwise add the command that records them.'),
  R('event-naming', 'core', 'warn', 'naming', 'An event name breaks the convention', 'The system block sets event-naming (kebab or pascal) and this event does not follow it.', 'Rename the event, or set event-naming: none.'),
  R('query-returns', 'core', 'warn', 'structure', '@query returns is not one, list or page', 'The cardinality of a query has three values.', 'Use returns=one, list or page.'),
  R('projection-trigger', 'core', 'warn', 'triggers', 'A projection with a trigger', 'A @projection is never shown, so nothing reaches it through a screen or endpoint.', 'Remove @trigger or @projection.'),
  R('source-system', 'core', 'warn', 'structure', '@source has no system', 'A translation says where it comes from.', 'Add system="Name" to @source.'),
  R('command-trigger', 'core', 'info', 'triggers', 'A command does not say what is used to reach it', 'Other commands in the model say. This one does not, and no policy calls it.', 'Add @trigger(type=ui, name="...").'),
  R('trigger-name', 'core', 'warn', 'triggers', 'A trigger has no name', 'A @trigger names the screen, endpoint, command or agent.', 'Add name="..."'),
  R('trigger-type', 'core', 'warn', 'triggers', 'A trigger has an unknown type', 'Types are ui, endpoint, cli and agent.', 'Use one of them.'),
  R('trigger-route', 'core', 'warn', 'routes', 'A trigger route is not METHOD /path', 'Only ui and endpoint triggers have a route, written as METHOD /path.', 'Write route="POST /audits/{id}/fail", or drop it.'),
  R('scenario-name', 'core', 'warn', 'scenarios', 'A scenario has no name', 'Names make scenarios findable.', 'Name it: scenario "name" {'),
  R('scenario-empty', 'core', 'warn', 'scenarios', 'A scenario has no lines', 'An empty scenario checks nothing.', 'Add its Given, When and Then lines.'),
  R('scenario-duplicate', 'core', 'warn', 'scenarios', 'Two scenarios share a name under one command or view', 'Names must tell scenarios apart.', 'Rename one.'),
  R('link-target', 'core', 'warn', 'links', 'An @link cannot work', 'It names a diagram or box that is not there, or none at all, or a diagram this model cannot draw yet.', 'Check to= and node= against the diagram.'),
  R('link-url', 'core', 'warn', 'links', 'An @link url is not an address', 'A url is an http(s) address or a path.', 'Write https://... or a path.'),
  R('scenario-steps', 'core', 'warn', 'scenarios', 'A scenario with steps is not complete', 'A scenario written as steps has any number of given steps, exactly one when naming the command it sits under, and one then. Views and policies take prose scenarios for now.', 'Add the missing step, or point when at the command above.'),
  R('scenario-unknown-event', 'core', 'warn', 'scenarios', 'A scenario names an event the model does not have', 'A given or then step lists an event that no command or policy records or reads.', 'Fix the name, or add the command that records the event.'),
  R('scenario-then-mismatch', 'core', 'warn', 'scenarios', 'A scenario expects something the command cannot do', 'then lists an event the command never records, or rejects with a code the command does not have.', 'Fix the then step, or add the branch to the command.',
    { example: { bad: 'user -> other(id)\n  --[default]--> [other { id }]\nuser -> go(id)\n  --[default]--> [went { id }]\n  scenario "x" {\n    when go(id: 1)\n    then [other { id: 1 }]\n  }', good: 'user -> other(id)\n  --[default]--> [other { id }]\nuser -> go(id)\n  --[default]--> [went { id }]\n  scenario "x" {\n    when go(id: 1)\n    then [went { id: 1 }]\n  }' } }),
  R('schedule-invalid', 'core', 'warn', 'schedule', 'A timer cannot fire', 'An interval needs a whole number above zero. A cron expression has five fields, each in range.', 'Write every 5 minutes, or cron "0 9 * * 1" (minute hour day-of-month month day-of-week).',
    { example: { bad: 'every 0 minutes\n  -> reminder -> sendReminder()', good: 'every 5 minutes\n  -> reminder -> sendReminder()' } }),

  R('accept-invalid', 'core', 'warn', 'structure', 'An @accept that cannot work', 'An @accept says the team knowingly keeps something a rule reports, and why. It needs rule="..." naming a rule in the catalogue, and a reason.', 'Write @accept(rule="many-events", reason="One fact told in two parts").'),
  R('accept-unused', 'core', 'info', 'hints', 'An @accept that accepts nothing', 'The rule it names reports nothing on this statement, so the acceptance is out of date or on the wrong statement.', 'Remove it, or move it to the statement the rule reports on.'),
  R('hotspot-invalid', 'core', 'warn', 'structure', 'A @hotspot that cannot work', 'A hotspot is an open question: @hotspot("text") with an optional kind (question, assumption, request), category (action, data, next, rule, example, view, who, time) and status (open, resolved). A request says what must change with concerns="...".', 'Write @hotspot("Does the guest lose the deposit?", kind=assumption, category=rule).'),
  R('hotspot-open', 'eventmodeling', 'info', 'hints', 'A hotspot is still open', 'Someone wrote down something the model does not answer yet.', 'Answer it in the model, then set status=resolved, or keep it as a known gap.'),

  // ---- eventmodeling: the guidelines ----
  R('unsourced-event-field', 'eventmodeling', 'warn', 'fields', 'An event carries a field nothing supplies', 'Information flows one way. An event can only hold what its command was given: its parameters, the boundary key, the facts it needs, or a value it computes.', 'Add the field to the command, to a fact it needs, or compute it with name: expression.',
    { example: { bad: 'user -> addItem(cartId) in Cart(cartId)\n  --[default]--> [item-added { cartId, sku }]', good: 'user -> addItem(cartId, sku) in Cart(cartId)\n  --[default]--> [item-added { cartId, sku }]' } }),
  R('unsourced-view-field', 'eventmodeling', 'warn', 'fields', 'A view shows a field no event carries', 'A view is a fold over events, so every plain field must be in the payload of an event it projects from. Computed fields are exempt.', 'Add the field to an event it reads, or compute it, as in total: count(order-placed*(id)).',
    { example: { bad: 'user -> addItem(cartId, sku)\n  --[default]--> [item-added { cartId, sku }]\nview Cart(cartId) = [item-added*(cartId)] => { cartId, total }', good: 'user -> addItem(cartId, sku)\n  --[default]--> [item-added { cartId, sku }]\nview Cart(cartId) = [item-added*(cartId)] => { cartId, items: count(item-added*(cartId)) }' } }),
  R('dependency-cycle', 'eventmodeling', 'warn', 'order', 'Commands depend on each other in a loop', 'Commands wait for events that others record. If they wait on each other in a loop, no order of work can start. A command that reads events it records itself is fine: that is how a decision checks what already happened.', 'Break the loop with an event that does not depend on the others, or mark one fact as coming from outside.'),
  R('slice-multiple-commands', 'eventmodeling', 'warn', 'slices', 'One slice holds several commands', 'A write slice has one command. A command can record several events. Two commands are two slices.', 'Give each command its own @slice name.'),
  R('slice-multiple-views', 'eventmodeling', 'info', 'slices', 'One slice defines several read models', 'A slice owns one query. Several read models in one slice invite several queries where one shaped for the reader would do. Reading views that other slices define is always fine.', 'Fold them into one view shaped for how it is read, or give each its own @slice.', { slicerm: 'warn' }),
  R('slice-no-scenario', 'eventmodeling', 'info', 'scenarios', 'Commands and views have no scenario', 'A slice is specified with a given, when, then example. This counts the commands and views that have none. Models that keep scenarios elsewhere can ignore it.', 'Add scenario "name" { ... } under the command or view.'),
  R('translation-no-dedupe', 'eventmodeling', 'info', 'fields', 'An outside fact has no deduplication key', 'A command issued by an outside system is a fact someone else recorded. It can be delivered twice, so the model says which field tells a repeat from a new one. @dedupe names it, and @correlate names the field that ties the fact to something here. Both count as supplying that field to the events and views that carry it.', 'Add @dedupe(eventId) to the command, view or policy that consumes the fact.',
    { example: { bad: 'system S { external: carrier (translator) }\ncarrier -> scanReceived(parcelId)\n  --[default]--> [parcel-scanned { parcelId }]', good: 'system S { external: carrier (translator) }\ncarrier -> scanReceived(parcelId) @dedupe(scanId)\n  --[default]--> [parcel-scanned { parcelId, scanId }]' } }),
  R('many-events', 'eventmodeling', 'info', 'hints', 'A happy path records several events', 'Right when they are one fact told in parts. If they are two steps, a policy can take the second.', 'Keep them if they are one fact, otherwise split the second into a policy.'),
  R('view-many-sources', 'eventmodeling', 'info', 'hints', 'Four or more events feed one view', 'Combining streams is fine, but each event ties the view to the command that records it, so fewer is easier to change.', 'Check that every source is needed.'),

  // ---- slicerm: stricter, for tools where a slice is a unit of delivery ----
  R('rejection-uncovered', 'slicerm', 'warn', 'scenarios', 'A rejection code has no scenario', 'Each way a command can refuse is a behaviour to specify. Only checked when the model has scenarios at all.', 'Add a scenario whose text names the code.'),
  R('route-duplicate', 'slicerm', 'warn', 'routes', 'Two commands or views share a method and route', 'One route in one context should reach one thing. Two triggers reaching the same command are fine.', 'Give one of them its own route.'),
];

const BY_ID = new Map(RULES.map((r) => [r.id, r]));
const PROFILES = ['core', 'workshop', 'eventmodeling', 'slicerm'];

module.exports = { RULES, BY_ID, CATEGORIES, PROFILES };

},
function (module, exports, __r) {
'use strict';

const { linkIssues } = __r(6);

const NAMING = {
  kebab: { re: /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/, hint: '{aggregate}-{verb}' },
  pascal: { re: /^[A-Z][A-Za-z0-9]*$/, hint: 'PascalCase, like AccountCreated' },
};

const TRIGGER_TYPES = ['ui', 'endpoint', 'cli', 'agent'];
const ROUTE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/\S*$/;

/* Returns the issues found. Kept separate from run() so it can be tested and reused. */
function check(model) {
  const issues = [];
  const add = (severity, rule, message, line) => issues.push({ severity, rule, message, line: line || '' });
  const viewNames = new Set(model.views.map((v) => v.name));
  const anyTrigger = model.commands.some((c) => c.triggers.length) || model.views.some((v) => v.triggers.length);
  const invoked = new Set(model.policies.flatMap((p) => p.rules.map((r) => r.command && r.command.name).filter(Boolean)));
  const checkTrigger = (t, who, line) => {
    if (!t.name) add('warn', 'trigger-name', `${who} has a @trigger with no name`, line);
    if (!TRIGGER_TYPES.includes(t.type)) add('warn', 'trigger-type', `${who} has a @trigger of type "${t.type || ''}". Use ${TRIGGER_TYPES.join(', ')}.`, line);
    if (t.route && (t.type === 'cli' || t.type === 'agent')) add('warn', 'trigger-route', `${who} gives a route for a ${t.type} trigger; only ui and endpoint triggers have one`, line);
    else if (t.route && !ROUTE.test(t.route)) add('warn', 'trigger-route', `${who} has route "${t.route}". Write METHOD /path, like POST /audits/{id}/fail.`, line);
  };
  const checkScenarios = (list, who) => {
    const seen = new Set();
    for (const s of list) {
      if (!s.name.trim()) add('warn', 'scenario-name', `${who} has a scenario with no name`, s.line);
      if (!s.text.trim()) add('warn', 'scenario-empty', `${who} has an empty scenario "${s.name}"`, s.line);
      if (seen.has(s.name)) add('warn', 'scenario-duplicate', `${who} has two scenarios named "${s.name}"`, s.line);
      seen.add(s.name);
    }
  };

  const style = (model.system && model.system.attrs['event-naming']) || 'kebab';
  if (style !== 'none' && !NAMING[style]) add('warn', 'event-naming', `Unknown event-naming "${style}". Use kebab, pascal or none.`, model.system && model.system.line);
  else if (style !== 'none') {
    for (const ev of model.events.keys()) {
      if (!NAMING[style].re.test(ev)) add('warn', 'event-naming', `Event "${ev}" does not match ${NAMING[style].hint}`);
    }
  }

  for (const cmd of model.commands) {
    const id = `${cmd.actor} -> ${cmd.name}`;
    if (!cmd.on.length && !cmd.from.length) add('info', 'command-inputs', `Command "${id}" lists no facts it needs (fine for a command that creates something)`, cmd.line);
    if (!cmd.branches.some((b) => b.emits.length)) add('warn', 'no-events', `Command "${id}" never records an event; every command records at least one on its happy path`, cmd.line);
    for (const b of cmd.branches) {
      if (b.default && b.reject) add('warn', 'default-rejects', `Command "${id}" refuses on its --[default]--> branch with ${b.reject}; the default branch should record events`, b.line);
      for (const e of b.emits) {
        if (/(-rejected|Rejected)$/.test(e.event)) add('info', 'rejection-as-event', `Command "${id}" emits "${e.event}". If nothing is recorded, write --[...]--> reject CODE instead`, b.line);
      }
    }
    const hasDefault = model.commands.some((c) => c.actor === cmd.actor && c.name === cmd.name && c.branches.some((b) => b.default));
    if (!hasDefault) add('warn', 'missing-default', `Command "${id}" has no --[default]--> branch`, cmd.line);
    for (const f of cmd.on) {
      if (viewNames.has(f.name)) add('error', 'on-facts', `Command "${id}" lists view "${f.name}" in on [...]; on takes events, from takes views`, cmd.line);
    }
    for (const f of cmd.from) {
      if (!viewNames.has(f.name)) add('warn', 'from-facts', `Command "${id}" reads "${f.name}" in from [...], but no such view is declared`, cmd.line);
      else if (!f.freshness) add('info', 'freshness', `Command "${id}" reads view "${f.name}" without @fresh<>, @eventual or @strong`, cmd.line);
    }
    if (model.actorKind(cmd.actor) === 'unknown') add('info', 'unknown-actor', `"${cmd.actor}" in "${cmd.name}" is neither a declared actor nor a system external`, cmd.line);
    if (cmd.boundary) {
      if (!model.boundaries.some((b) => b.name === cmd.boundary.name)) add('error', 'unknown-boundary', `Command "${id}" is in boundary "${cmd.boundary.name}", which is not declared`, cmd.line);
    } else if (model.boundaries.length) add('info', 'command-boundary', `Command "${id}" does not say which boundary it is in (add: in BoundaryName(key))`, cmd.line);
    for (const t of cmd.triggers) checkTrigger(t, `Command "${id}"`, cmd.line);
    if (cmd.source && !cmd.source.system) add('warn', 'source-system', `Command "${id}" has a @source with no system`, cmd.line);
    if (cmd.on.some((f) => f.optional)) add('warn', 'optional-on', `Command "${id}" marks an on [...] fact @optional; only from [...] reads can be empty`, cmd.line);
    checkScenarios(cmd.scenarios, `Command "${id}"`);
    if (anyTrigger && !cmd.triggers.length && !invoked.has(cmd.name)) add('info', 'command-trigger', `Command "${id}" does not say what is used to reach it (add: @trigger(type=ui, name="..."))`, cmd.line);
  }

  for (const view of model.views) {
    if (!view.sources.length) add('warn', 'view-sources', `View "${view.name}" has no source events`, view.line);
    for (const t of view.triggers) checkTrigger(t, `View "${view.name}"`, view.line);
    if (view.query && !['one', 'list', 'page'].includes(view.query.returns)) add('warn', 'query-returns', `View "${view.name}" has @query returns "${view.query.returns || ''}". Use one, list or page.`, view.line);
    if (view.annotations.projection && view.triggers.length) add('warn', 'projection-trigger', `View "${view.name}" is a @projection, which is never shown, but has a @trigger`, view.line);
    checkScenarios(view.scenarios, `View "${view.name}"`);
    for (const s of view.sources) {
      if (viewNames.has(s.name)) add('error', 'view-from-view', `View "${view.name}" projects from view "${s.name}"; views project from events`, view.line);
    }
  }

  for (const pol of model.policies) {
    const who = pol.trigger.event ? `on "${pol.trigger.event}"` : `on "${pol.trigger.schedule}"`;
    for (const f of pol.from) {
      if (!viewNames.has(f.name)) add('warn', 'from-facts', `Policy ${who} reads "${f.name}" in from [...], but no such view is declared`, pol.line);
    }
    for (const r of pol.rules) {
      if (!r.guard && pol.trigger.event) add('info', 'policy-guard', `Policy ${who} has an unguarded rule`, r.line);
    }
  }

  const ctxByName = new Map(model.contexts.map((c) => [c.name, c]));
  for (const ev of model.events.values()) {
    const emitters = new Set(ev.emittedBy.map((x) => x.context).filter(Boolean));
    for (const use of ev.consumedBy) {
      if (!use.context || emitters.size === 0 || emitters.has(use.context)) continue;
      for (const from of emitters) {
        if (!ctxByName.get(from).publishes.includes(ev.name)) add('warn', 'unpublished-event', `Context ${use.context} reads "${ev.name}" from ${from}, which does not list it in publishes`);
      }
    }
  }

  const assumed = model.assumedEvents();
  if (assumed.length) add('info', 'assumed-events', `No command or policy emits: ${assumed.join(', ')}. The model assumes these facts.`);

  if (model.boundaries.length === 0 && model.commands.length) add('info', 'boundaries', 'No boundary declared; commands have no stated consistency scope');
  for (const i of linkIssues(model)) add(i.severity, i.rule, i.message, i.line);
  return issues;
}

module.exports = { coreIssues: check };

},
function (module, exports, __r) {
'use strict';

/*
 * Links between the diagrams of one model.
 *
 * Each diagram names its boxes its own way, but they share a vocabulary: cmd:Name, view:Name,
 * worker:Name (pol:Name on the board), actor:slug. So a box can lead to the same thing seen from
 * another level: the system context opens the containers, a container opens its data flow or its
 * place on the event model board, a shard opens the boundary it holds.
 *
 * Those links are derived, so they cannot drift. An @link annotation on a command, view, policy or
 * boundary replaces the derived links of that element:
 *
 *   @link(to="containers", node="view:Orders", label="Where Orders is stored")
 *   @link(url="https://wiki.example.com/runbooks/orders")
 *
 * linkMap() returns { diagram: { boxId: [ { diagram, node, label, url } ] } }. A target that does not
 * exist in this model (no regions, no contexts, a box that is not drawn) is dropped.
 */

const { KINDS, NAMES } = __r(7);
const { buildBoard } = __r(8);
const { BUILDERS } = __r(9);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const SKIPPED = new Set(['NO_REGIONS', 'NO_CONTEXTS']);

/* Every box and group id of every diagram that can be drawn for this model. */
function inventory(model) {
  const out = {};
  for (const kind of KINDS) {
    try {
      const g = kind === 'eventmodel' ? buildBoard(model) : BUILDERS[kind](model);
      out[kind] = { labels: new Map([...g.nodes, ...(g.groups || [])].map((n) => [n.id, n.label])), kinds: new Map(g.nodes.map((n) => [n.id, n.kind])) };
    } catch (err) {
      if (!SKIPPED.has(err.code)) throw err;
    }
  }
  return out;
}

/* What each box leads to by default: [diagram, boxId?] pairs, most useful first. */
function derive(model, inv, kind, id) {
  const r = [];
  const worker = (prefix) => id.slice(prefix.length);
  switch (kind) {
    case 'context':
      r.push(['containers', id]);
      break;
    case 'containers':
      if (id === 'sys' || /^(actor|ext):/.test(id)) r.push(['context', id]);
      else if (id === 'api') r.push(['eventmodel']);
      else if (id === 'store') r.push(['dataflow', 'log']);
      else if (id.startsWith('view:')) r.push(['dataflow', id], ['eventmodel', id]);
      else if (id.startsWith('worker:')) r.push(['dataflow', id], ['eventmodel', `pol:${worker('worker:')}`]);
      break;
    case 'dataflow':
      if (id === 'log') r.push(['containers', 'store']);
      else if (/^(actor|ext):/.test(id)) r.push(['context', id]);
      else if (id.startsWith('cmd:')) r.push(['eventmodel', id]);
      else if (id.startsWith('view:')) r.push(['eventmodel', id], ['containers', id]);
      else if (id.startsWith('worker:')) r.push(['eventmodel', `pol:${worker('worker:')}`], ['containers', id]);
      break;
    case 'deployment': {
      if (id.startsWith('region:')) { r.push(['containers', 'sys']); break; }
      const m = /^[^:]+:(api|shard:.+|view:.+|worker:.+)$/.exec(id);
      if (!m) break;
      if (m[1] === 'api') r.push(['containers', 'api']);
      else if (m[1].startsWith('shard:')) r.push(['eventmodel', `bnd:${m[1].slice(6)}`]);
      else r.push(['containers', m[1]]);
      break;
    }
    case 'contextmap': {
      const name = id.slice(4);
      const cmd = model.commands.find((c) => c.context === name);
      const view = model.views.find((v) => v.context === name);
      if (cmd) r.push(['eventmodel', `cmd:${cmd.name}`]);
      else if (view) r.push(['eventmodel', `view:${view.name}`]);
      break;
    }
    case 'eventmodel': {
      const nodeKind = inv.eventmodel.kinds.get(id);
      const label = inv.eventmodel.labels.get(id) || '';
      if (id.startsWith('cmd:')) r.push(['dataflow', id]);
      else if (id.startsWith('view:')) r.push(['containers', id], ['dataflow', id]);
      else if (id.startsWith('pol:')) r.push(['containers', `worker:${id.slice(4)}`]);
      else if (id.startsWith('evt:')) r.push(['containers', 'store']);
      else if (id.startsWith('bnd:') && model.system && model.system.regions.length) r.push(['deployment', `${slug(model.system.regions[0])}:shard:${id.slice(4)}`]);
      else if (nodeKind === 'actor') r.push(['context', `actor:${slug(label)}`]);
      else if (nodeKind === 'external') r.push(['context', `ext:${slug(label)}`]);
      break;
    }
    default:
  }
  return r;
}

/* The @link annotations of one element, as written. */
const linksOf = (annotations) => [].concat((annotations && annotations.link) || []).filter((l) => l && typeof l === 'object');

/* Every element that can carry @link, with the boxes it appears as in each diagram. */
function elements(model, inv) {
  const out = [];
  const ids = (kind, test) => (inv[kind] ? [...inv[kind].labels.keys()].filter(test) : []);
  for (const c of model.commands) out.push({ what: `command ${c.name}`, line: c.line, ranges: [[c.line, c.endLine]], links: linksOf(c.annotations), boxes: { eventmodel: [`cmd:${c.name}`], dataflow: [`cmd:${c.name}`] } });
  for (const v of model.views) {
    out.push({ what: `view ${v.name}`, line: v.line, ranges: [[v.line, v.endLine]], links: linksOf(v.annotations), boxes: { eventmodel: [`view:${v.name}`], containers: [`view:${v.name}`], dataflow: [`view:${v.name}`], deployment: ids('deployment', (id) => id.endsWith(`:view:${v.name}`)) } });
  }
  for (const p of model.policies) {
    const names = [...new Set(p.rules.map((r) => r.worker).filter(Boolean))];
    out.push({ what: `policy ${p.trigger.event || p.trigger.schedule}`, line: p.line, ranges: [[p.line, p.endLine]], links: linksOf(p.annotations), boxes: {
      eventmodel: names.map((w) => `pol:${w}`), containers: names.map((w) => `worker:${w}`), dataflow: names.map((w) => `worker:${w}`),
      deployment: names.flatMap((w) => ids('deployment', (id) => id.endsWith(`:worker:${w}`))),
    } });
  }
  for (const b of model.boundaries) out.push({ what: `boundary ${b.name}`, line: b.line, ranges: [[b.line, b.line]], links: linksOf(b.annotations), boxes: { eventmodel: [`bnd:${b.name}`], deployment: ids('deployment', (id) => id.endsWith(`:shard:${b.name}`)) } });
  return out;
}

const targetOf = (link) => ({ diagram: link.to || null, node: link.node || null, url: link.url || null, label: link.label || null });

function linkMap(model) {
  const inv = inventory(model);
  const map = {};
  const describe = (diagram, node) => {
    const name = NAMES[diagram];
    const label = node && inv[diagram].labels.get(node);
    return label ? `${name}: ${label}` : name;
  };
  const resolve = (from, fromId, t) => {
    if (t.url) return { diagram: null, node: null, label: t.label || t.url, url: t.url };
    if (!t.diagram || !inv[t.diagram]) return null;
    if (t.node && !inv[t.diagram].labels.has(t.node)) return null;
    if (t.diagram === from && t.node === fromId) return null;
    return { diagram: t.diagram, node: t.node || null, label: t.label || describe(t.diagram, t.node), url: null };
  };
  for (const kind of Object.keys(inv)) {
    map[kind] = {};
    for (const id of inv[kind].labels.keys()) {
      const targets = derive(model, inv, kind, id).map(([diagram, node]) => resolve(kind, id, { diagram, node })).filter(Boolean);
      if (targets.length) map[kind][id] = targets;
    }
  }
  for (const el of elements(model, inv)) {
    if (!el.links.length) continue;
    for (const [kind, ids] of Object.entries(el.boxes)) {
      if (!inv[kind]) continue;
      for (const id of ids) {
        const targets = el.links.map((l) => resolve(kind, id, targetOf(l))).filter(Boolean);
        if (targets.length) map[kind][id] = targets; else delete map[kind][id];
      }
    }
  }
  return map;
}

/* Which lines of the source each box of a diagram stands for: Map of boxId to [[from, to], ...]. The board knows its own. */
function sourceRanges(model, kind) {
  const inv = inventory(model);
  const out = new Map();
  if (!inv[kind]) return out;
  for (const el of elements(model, inv)) {
    for (const id of el.boxes[kind] || []) out.set(id, [...(out.get(id) || []), ...el.ranges]);
  }
  return out;
}

/* Problems with the @link annotations a model carries: what check() reports. */
function linkIssues(model) {
  const inv = inventory(model);
  const issues = [];
  for (const el of elements(model, inv)) {
    for (const l of el.links) {
      const t = targetOf(l);
      const where = `${el.what} has an @link`;
      if (t.url) {
        if (!/^(https?:|\/|\.\.?\/|#)/.test(t.url)) issues.push({ severity: 'warn', rule: 'link-url', message: `${where} with url "${t.url}". Use an http(s) address or a path.`, line: el.line });
      } else if (!t.diagram) issues.push({ severity: 'warn', rule: 'link-target', message: `${where} with neither to="..." nor url="...".`, line: el.line });
      else if (!KINDS.includes(t.diagram)) issues.push({ severity: 'warn', rule: 'link-target', message: `${where} to "${t.diagram}", which is not a diagram. Choose one of: ${KINDS.join(', ')}.`, line: el.line });
      else if (!inv[t.diagram]) issues.push({ severity: 'warn', rule: 'link-target', message: `${where} to the ${NAMES[t.diagram]}, which this model cannot draw yet.`, line: el.line });
      else if (t.node && !inv[t.diagram].labels.has(t.node)) issues.push({ severity: 'warn', rule: 'link-target', message: `${where} to "${t.node}", which is not a box on the ${NAMES[t.diagram]}.`, line: el.line });
    }
  }
  return issues;
}

module.exports = { linkMap, linkIssues, sourceRanges };

},
function (module, exports, __r) {
'use strict';

const KINDS = ['eventmodel', 'context', 'containers', 'dataflow', 'deployment', 'contextmap'];
const FORMATS = { svg: 'svg', mermaid: 'mmd', dot: 'dot' };
/* How a diagram is named to a person, in a link's tooltip. */
const NAMES = { eventmodel: 'event model', context: 'system context', containers: 'containers', dataflow: 'data flow', deployment: 'deployment', contextmap: 'context map' };

module.exports = { KINDS, FORMATS, NAMES };

},
function (module, exports, __r) {
'use strict';

/*
 * Event Modeling board, derived from a model.
 *
 * Lanes, top to bottom: actor, command, event, view, policy.
 * Time runs left to right. The model has no explicit timeline, so order comes from
 * causality: a command that reads events another command emits comes after it.
 *
 * Layout, as on a hand-drawn board:
 *   - each command owns a column; its actor sits above it
 *   - the events it emits hang beneath it as a small tree
 *   - a view sits right of the latest event that feeds it
 *   - a policy worker sits right of the event that wakes it, and the command or
 *     events it produces sit right of the worker
 *   - facts the model assumes (nobody emits them) are a note under the command
 *
 * Slices follow the four Event Modeling patterns the README maps one to one:
 *   state change, state view, automation, translation.
 */

const LANES = ['actor', 'command', 'event', 'view', 'policy'];
const clip = (s, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* "AuditScreen > Fail button": the thing someone uses, and the part of it. */
const triggerLabel = (t) => `${t.name || 'unnamed'}${t.part ? ` > ${t.part}` : ''}`;

/* One entry per actor+command name; a second block with the same name is a variant
   (for example a fallback path) and contributes more facts and branches. */
function commandGroups(model) {
  const groups = new Map();
  for (const cmd of model.commands) {
    const key = `${cmd.actor.toLowerCase()}>${cmd.name}`;
    if (!groups.has(key)) groups.set(key, { ranges: [], actor: cmd.actor, name: cmd.name, params: cmd.params, boundary: cmd.boundary, on: [], from: [], branches: [], notes: [], triggers: [], annotations: {}, line: cmd.line });
    const g = groups.get(key);
    g.ranges.push([cmd.line, cmd.endLine]);
    g.on.push(...cmd.on);
    g.from.push(...cmd.from);
    g.branches.push(...cmd.branches);
    g.notes.push(...(cmd.notes || []));
    g.triggers.push(...(cmd.triggers || []));
    if (!g.source && cmd.source) g.source = cmd.source;
    g.annotations = { ...g.annotations, ...(cmd.annotations || {}) };
    if (!g.boundary && cmd.boundary) g.boundary = cmd.boundary;
  }
  return [...groups.values()];
}

/* Dependency order: a command comes after the commands whose events or views it reads.
   Ties keep source order, with commands of one boundary kept together. */
function orderCommands(model, cmds) {
  const emittedBy = new Map();
  cmds.forEach((c, i) => c.branches.forEach((b) => b.emits.forEach((e) => { if (!emittedBy.has(e.event)) emittedBy.set(e.event, new Set()); emittedBy.get(e.event).add(i); })));
  const viewFeeders = new Map(model.views.map((v) => [v.name, new Set(v.sources.flatMap((s) => [...(emittedBy.get(s.name) || [])]))]));
  const deps = cmds.map((c, i) => {
    const d = new Set();
    for (const f of c.on) (emittedBy.get(f.name) || []).forEach((j) => j !== i && d.add(j));
    for (const f of c.from) (viewFeeders.get(f.name) || []).forEach((j) => j !== i && d.add(j));
    return d;
  });
  const depth = new Array(cmds.length).fill(-1);
  const walk = (i, stack) => {
    if (depth[i] >= 0) return depth[i];
    if (stack.has(i)) return 0; // a loop: ignore the edge that closes it
    stack.add(i);
    depth[i] = 1 + Math.max(-1, ...[...deps[i]].map((j) => walk(j, stack)));
    stack.delete(i);
    return depth[i];
  };
  cmds.forEach((_, i) => walk(i, new Set()));
  const bFirst = new Map();
  cmds.forEach((c, i) => { if (c.boundary && !bFirst.has(c.boundary.name)) bFirst.set(c.boundary.name, i); });
  return cmds.map((c, i) => ({ c, i })).sort((a, b) => depth[a.i] - depth[b.i] || (bFirst.get(a.c.boundary && a.c.boundary.name) ?? a.i) - (bFirst.get(b.c.boundary && b.c.boundary.name) ?? b.i) || a.i - b.i).map((x) => x.c);
}

function buildBoard(model) {
  const nodes = new Map();
  const edges = [];
  const slices = [];
  const occupied = new Map(); // `${lane}:${col}` -> rows used
  const colOf = new Map();

  const addEdge = (from, to, kind, label = '') => {
    if (!edges.some((e) => e.from === from && e.to === to && e.kind === kind && e.label === label)) edges.push({ from, to, kind, label });
  };
  const free = (lane, from) => { let c = Math.max(0, from); while (occupied.has(`${lane}:${c}`)) c++; return c; };
  const put = (id, lane, label, col, extra = {}) => {
    if (nodes.has(id)) return nodes.get(id);
    const row = occupied.get(`${lane}:${col}`) || 0;
    occupied.set(`${lane}:${col}`, row + 1);
    const n = { id, lane, label, col, row, ...extra };
    nodes.set(id, n);
    colOf.set(id, col);
    return n;
  };
  let end = 0; // first column past everything placed so far
  const bump = (c) => { end = Math.max(end, c + 1); };

  const assumed = (name) => !(model.events.get(name) || { emittedBy: [] }).emittedBy.length;
  const viewLabel = (name) => { const v = model.views.find((x) => x.name === name); return v ? `${name}(${v.params.join(', ')})` : name; };

  const cmds = orderCommands(model, commandGroups(model));

  // 1. commands: one column each, actor above, emitted events beneath
  cmds.forEach((cmd, col) => {
    const kind = model.actorKind(cmd.actor);
    const declared = model.actors.find((a) => a.name.toLowerCase() === cmd.actor.toLowerCase());
    const actor = put(`actor:${cmd.name}`, 'actor', declared ? declared.name : cmd.actor, col, { kind: kind === 'external' ? 'external' : 'actor', ranges: cmd.ranges.map(([from]) => [from, from]) });
    const facts = [...new Set(cmd.on.map((f) => f.name).filter(assumed))];
    const rejects = [...new Set(cmd.branches.map((b) => b.reject).filter(Boolean))];
    const planned = !!cmd.annotations.planned;
    const c = put(`cmd:${cmd.name}`, 'command', `${cmd.name}(${cmd.params.join(', ')})`, col, {
      kind: 'command', sub: planned ? 'planned' : kind === 'external' ? 'translation' : 'state change', slice: kind === 'external' ? 'translation' : 'state change',
      planned,
      ranges: cmd.ranges,
      notes: [
        ...(cmd.source && cmd.source.system ? [`translates from ${clip(`${cmd.source.system} ${cmd.source.version || ''}`.trim(), 30)}`] : []),
        ...(facts.length ? [`assumes ${clip(facts.join(', '), 40)}`] : []),
        ...(rejects.length ? [`rejects ${clip(rejects.join(', '), 40)}`] : []),
      ],
      fullNotes: cmd.notes,
    });
    addEdge(actor.id, c.id, 'triggers', cmd.triggers.length ? clip(`${triggerLabel(cmd.triggers[0])}${cmd.triggers.length > 1 ? ` +${cmd.triggers.length - 1}` : ''}`, 32) : '');
    bump(col);
  });

  cmds.forEach((cmd) => {
    const c = nodes.get(`cmd:${cmd.name}`);
    const members = [`actor:${cmd.name}`, c.id];
    for (const br of cmd.branches) {
      for (const em of br.emits) {
        const id = `evt:${em.event}`;
        if (!nodes.has(id)) put(id, 'event', em.event, c.col, { kind: 'event', indent: 26, sub: br.default ? '' : `if ${clip(br.guard, 30)}`, owner: c.id });
        addEdge(c.id, id, nodes.get(id).owner === c.id ? 'tree' : 'emits', nodes.get(id).owner === c.id ? '' : br.default ? '' : clip(br.guard, 24));
        members.push(id);
      }
    }
    cmd.__members = members;
  });

  // 2. views: right of the latest event that feeds them
  for (const view of model.views) {
    const srcCols = view.sources.map((s) => colOf.get(`evt:${s.name}`)).filter((c) => c !== undefined);
    const col = free('view', srcCols.length ? Math.max(...srcCols) + 1 : end);
    const planned = !!view.annotations.planned;
    const v = put(`view:${view.name}`, 'view', viewLabel(view.name), col, { kind: 'view', sub: planned ? 'planned' : 'state view', slice: 'state view', planned, ranges: [[view.line, view.endLine]], fullNotes: view.notes, notes: [] });
    const unemitted = [...new Set(view.sources.map((s) => s.name).filter(assumed))];
    if (unemitted.length) v.notes.push(`from ${clip(unemitted.join(', '), 40)}`);
    if (view.triggers.length) v.notes.push(`read in ${clip(view.triggers.map(triggerLabel).join(', '), 36)}`);
    for (const s of view.sources) if (nodes.has(`evt:${s.name}`)) addEdge(`evt:${s.name}`, v.id, 'projects');
    bump(col);
    slices.push({ type: 'state view', name: view.name, nodes: [v.id, ...view.sources.map((s) => `evt:${s.name}`).filter((id) => nodes.has(id))] });
  }
  // reads: a command reads a view (the view may sit to its right: the arrow loops back)
  for (const cmd of cmds) {
    for (const f of cmd.from) {
      if (!nodes.has(`view:${f.name}`)) { const col = free('view', end); put(`view:${f.name}`, 'view', viewLabel(f.name), col, { kind: 'view', declared: false, sub: 'not declared' }); bump(col); }
      addEdge(`view:${f.name}`, `cmd:${cmd.name}`, 'reads', [f.freshness ? `fresh ${f.freshness}` : '', f.optional ? 'may be empty' : ''].filter(Boolean).join(', '));
    }
    for (const f of cmd.on) if (nodes.has(`evt:${f.name}`) && nodes.get(`evt:${f.name}`).owner !== `cmd:${cmd.name}`) addEdge(`evt:${f.name}`, `cmd:${cmd.name}`, 'given');
  }

  // 3. policies: worker right of its trigger, results right of the worker
  for (const pol of model.policies) {
    const timer = !pol.trigger.event;
    const tid = timer ? `timer:${pol.trigger.schedule}` : `evt:${pol.trigger.event}`;
    if (!timer && !nodes.has(tid)) { const col = free('event', end); put(tid, 'event', pol.trigger.event, col, { kind: 'event', assumed: true, sub: 'assumed' }); bump(col); }
    const tcol = timer ? end : colOf.get(tid);
    if (timer) {
      const col = free('actor', end);
      put(tid, 'actor', pol.trigger.schedule, col, { kind: 'timer' });
      bump(col);
    }
    for (const rule of pol.rules) {
      const members = [tid];
      if (!rule.worker) {
        for (const em of rule.emits) {
          const id = `evt:${em.event}`;
          if (!nodes.has(id)) { const col = free('event', tcol + 1); put(id, 'event', em.event, col, { kind: 'event' }); bump(col); }
          addEdge(tid, id, 'emits', clip(rule.guard || '', 24));
          members.push(id);
        }
        slices.push({ type: 'automation', name: pol.trigger.event || pol.trigger.schedule, nodes: members });
        continue;
      }
      const wid = `pol:${rule.worker}`;
      const wcol = timer ? colOf.get(tid) : free('policy', tcol + 1);
      const planned = !!pol.annotations.planned;
      const w = nodes.get(wid) || put(wid, 'policy', rule.worker, wcol, { kind: 'policy', sub: planned ? 'planned' : 'automation', slice: 'automation', planned, fullNotes: pol.notes, notes: [] });
      (w.ranges = w.ranges || []).push([pol.line, pol.endLine]);
      bump(w.col);
      for (const f of pol.from) {
        if (!nodes.has(`view:${f.name}`)) { const vcol = free('view', end); put(`view:${f.name}`, 'view', viewLabel(f.name), vcol, { kind: 'view', declared: false, sub: 'not declared' }); bump(vcol); }
        addEdge(`view:${f.name}`, w.id, 'reads', f.freshness ? `fresh ${f.freshness}` : '');
      }
      addEdge(tid, w.id, 'triggers', clip(rule.guard || '', 24));
      members.push(w.id);
      if (rule.command) {
        const cid = `cmd:${rule.command.name}`;
        if (!nodes.has(cid)) { const col = free('command', w.col + 1); put(cid, 'command', `${rule.command.name}()`, col, { kind: 'command', declared: false, sub: 'not modeled' }); bump(col); }
        addEdge(w.id, cid, 'invokes', clip(rule.command.args, 24));
        members.push(cid);
      }
      for (const em of rule.emits) {
        const id = `evt:${em.event}`;
        if (!nodes.has(id)) { const col = free('event', w.col + 1); put(id, 'event', em.event, col, { kind: 'event' }); bump(col); }
        addEdge(w.id, id, 'emits');
        members.push(id);
      }
      slices.push({ type: 'automation', name: rule.worker, nodes: members });
    }
  }

  for (const cmd of cmds) {
    slices.push({ type: model.actorKind(cmd.actor) === 'external' ? 'translation' : 'state change', name: cmd.name, nodes: [...new Set(cmd.__members)] });
  }

  const groups = [];
  const byBoundary = new Map();
  for (const cmd of cmds) {
    if (!cmd.boundary) continue;
    const g = byBoundary.get(cmd.boundary.name) || { id: `bnd:${cmd.boundary.name}`, label: `${cmd.boundary.name}(${cmd.boundary.args})`, kind: 'boundary', members: new Set() };
    byBoundary.set(cmd.boundary.name, g);
    g.members.add(`cmd:${cmd.name}`);
    for (const id of cmd.__members) if (id.startsWith('evt:') && nodes.get(id).owner === `cmd:${cmd.name}`) g.members.add(id);
    const b = model.boundaries.find((x) => x.name === cmd.boundary.name);
    if (b && b.annotations.partition && b.annotations.partition.shardKey) g.sub = `shard by ${b.annotations.partition.shardKey}`;
  }
  for (const g of byBoundary.values()) groups.push({ ...g, members: [...g.members] });

  const list = [...nodes.values()];
  const cols = Math.max(...list.map((n) => n.col)) + 1;
  return { title: model.system ? model.system.name : 'eventline model', lanes: LANES, nodes: list, edges, slices, groups, cols };
}

/* The generic graph form, for the Mermaid and DOT exporters. */
function boardToGraph(board) {
  return {
    title: `${board.title} event model`,
    direction: 'LR',
    nodes: board.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, sub: n.sub || '' })),
    edges: board.edges.map((e) => ({ from: e.from, to: e.to, label: e.label || '', style: e.kind === 'given' || e.kind === 'reads' ? 'dashed' : 'solid' })),
    groups: board.groups.map((g) => ({ id: g.id, label: g.label, members: g.members })),
  };
}

module.exports = { buildBoard, boardToGraph, LANES };

},
function (module, exports, __r) {
'use strict';

/*
 * System diagrams inferred from a model. Nothing here is invented: every box and
 * arrow traces to a statement in the file. Where the model is silent (topology,
 * which service hosts which command) the diagram says so instead of guessing.
 *
 *   context     the system, who uses it, what it depends on
 *   containers  command API, event store, read models, workers, externals
 *   dataflow    commands and workers as processes, the event log and views as stores
 *   deployment  regions, each running the stack, with shards per boundary
 */

const short = (list, n = 3) => {
  const u = [...new Set(list)];
  return u.length <= n ? u.join(', ') : `${u.slice(0, n).join(', ')} +${u.length - n}`;
};
const cacheOf = (view) => {
  const key = Object.keys(view.annotations).find((k) => /cache/i.test(k));
  return key ? view.annotations[key] : null;
};
const eventsOf = (cmd) => cmd.branches.flatMap((b) => b.emits.map((e) => e.event));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function subtitle(model) {
  const s = model.system;
  if (!s) return '';
  return [s.slo.length ? `slo ${s.slo.join(', ')}` : '', s.regions.length ? `regions ${s.regions.join(', ')}` : '', s.dataClassification.length ? `data ${s.dataClassification.join(', ')}` : ''].filter(Boolean).join('   ·   ');
}

/* Declared actors, outside systems, and undeclared command issuers, each with the commands they use. */
function people(model) {
  const actors = new Map();
  const externals = new Map();
  const sysExternals = model.system ? model.system.externals : [];
  const extFor = (name) => sysExternals.find((e) => name.toLowerCase() === e.name.toLowerCase() || name.toLowerCase().startsWith(e.name.toLowerCase() + '-'));

  for (const a of model.actors) actors.set(a.name.toLowerCase(), { id: `actor:${slug(a.name)}`, label: a.name, sub: a.attributes.auth ? `auth ${a.attributes.auth}` : 'actor', kind: 'actor', commands: [] });
  for (const e of sysExternals) externals.set(e.name.toLowerCase(), { id: `ext:${slug(e.name)}`, label: e.name, sub: e.role || 'external system', kind: 'external', inbound: [] });

  for (const cmd of model.commands) {
    const kind = model.actorKind(cmd.actor);
    if (kind === 'external') {
      const e = extFor(cmd.actor);
      externals.get(e.name.toLowerCase()).inbound.push(cmd.name);
    } else {
      const k = cmd.actor.toLowerCase();
      if (!actors.has(k)) actors.set(k, { id: `actor:${slug(cmd.actor)}`, label: cmd.actor, sub: 'not declared', kind: 'actor', commands: [] });
      actors.get(k).commands.push(cmd.name);
    }
  }
  return { actors: [...actors.values()], externals: [...externals.values()] };
}

function context(model) {
  const sysName = model.system ? model.system.name : 'System';
  const { actors, externals } = people(model);
  const nodes = [{ id: 'sys', label: sysName, sub: 'software system', kind: 'system' }];
  const edges = [];
  for (const a of actors) {
    nodes.push({ id: a.id, label: a.label, sub: a.sub, kind: 'actor' });
    edges.push({ from: a.id, to: 'sys', label: a.commands.length ? short(a.commands, 3) : 'no commands' });
  }
  for (const e of externals) {
    nodes.push({ id: e.id, label: e.label, sub: e.sub, kind: 'external' });
    if (e.inbound.length) edges.push({ from: e.id, to: 'sys', label: short(e.inbound, 3) });
    else edges.push({ from: 'sys', to: e.id, label: 'depends on' });
  }
  return { title: `${sysName} · system context`, subtitle: subtitle(model), direction: 'LR', nodes, edges, groups: [] };
}

/* Shared by containers and dataflow: who talks to the system, and the workers. */
function workersOf(model) {
  const w = new Map();
  for (const p of model.policies) {
    for (const r of p.rules) {
      if (!r.worker) continue;
      if (!w.has(r.worker)) w.set(r.worker, { triggers: [], schedules: [], reads: [], commands: [], emits: [] });
      const x = w.get(r.worker);
      if (p.trigger.event) x.triggers.push(p.trigger.event);
      else x.schedules.push(p.trigger.schedule);
      x.reads.push(...p.from.map((f) => f.name));
      if (r.command) x.commands.push(r.command.name);
      x.emits.push(...r.emits.map((e) => e.event));
    }
  }
  return w;
}

function containers(model) {
  const sysName = model.system ? model.system.name : 'System';
  const { actors, externals } = people(model);
  const nodes = [];
  const edges = [];
  const inside = [];
  const keys = model.boundaries.map((b) => b.annotations.partition && b.annotations.partition.shardKey).filter(Boolean);

  for (const a of actors) {
    nodes.push({ id: a.id, label: a.label, sub: a.sub, kind: 'actor' });
    if (a.commands.length) edges.push({ from: a.id, to: 'api', label: short(a.commands, 3) });
  }
  const nCmd = new Set(model.commands.map((c) => c.name)).size;
  nodes.push({ id: 'api', label: 'Command API', sub: `${nCmd} command${nCmd === 1 ? '' : 's'}`, kind: 'process' });
  nodes.push({ id: 'store', label: 'Event store', sub: keys.length ? `partitioned by ${short(keys, 3)}` : 'append only', kind: 'store' });
  inside.push('api', 'store');
  edges.push({ from: 'api', to: 'store', label: `append ${new Set(model.commands.flatMap(eventsOf)).size} event types` });

  for (const v of model.views) {
    const c = cacheOf(v);
    const id = `view:${v.name}`;
    nodes.push({ id, label: v.name, sub: c ? `read model, cache ttl ${c.ttl || '?'}` : 'read model', kind: 'cache' });
    inside.push(id);
    edges.push({ from: 'store', to: id, label: short(v.sources.map((s) => s.name), 2) });
    if (model.commands.some((cmd) => cmd.from.some((f) => f.name === v.name))) edges.push({ from: id, to: 'api', label: 'read', style: 'dashed', weak: true });
  }
  for (const [name, w] of workersOf(model)) {
    const id = `worker:${name}`;
    nodes.push({ id, label: name, sub: w.schedules.length ? `runs ${w.schedules[0]}` : 'async worker', kind: 'worker' });
    inside.push(id);
    if (w.triggers.length) edges.push({ from: 'store', to: id, label: short(w.triggers, 2) });
    for (const v of new Set(w.reads)) edges.push({ from: `view:${v}`, to: id, label: 'read', style: 'dashed', weak: true });
    if (w.commands.length) edges.push({ from: id, to: 'api', label: short(w.commands, 2), weak: true });
    if (w.emits.length) edges.push({ from: id, to: 'store', label: short(w.emits, 2), weak: true });
  }
  for (const e of externals) {
    // The model says the system depends on an outside service, not which container calls it,
    // so an outbound dependency is drawn beside the system with no arrow into a container.
    if (e.inbound.length) {
      nodes.push({ id: e.id, label: e.label, sub: e.sub, kind: 'external' });
      edges.push({ from: e.id, to: 'api', label: short(e.inbound, 2) });
    } else nodes.push({ id: e.id, label: e.label, sub: `${e.sub} · system dependency`, kind: 'external', side: 'right' });
  }
  const regions = model.system && model.system.regions.length ? ` (${model.system.regions.join(', ')})` : '';
  return { title: `${sysName} · containers`, subtitle: subtitle(model), direction: 'LR', nodes, edges, groups: [{ id: 'sys', label: `${sysName}${regions}`, members: inside }] };
}

function dataflow(model) {
  const sysName = model.system ? model.system.name : 'System';
  const { actors, externals } = people(model);
  const nodes = [];
  const edges = [];
  for (const a of actors) nodes.push({ id: a.id, label: a.label, sub: a.sub, kind: 'actor' });
  for (const e of externals) nodes.push({ id: e.id, label: e.label, sub: e.sub, kind: 'external' });
  nodes.push({ id: 'log', label: 'Event log', sub: 'data store, append only', kind: 'store' });

  const seen = new Set();
  for (const cmd of model.commands) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      nodes.push({ id: `cmd:${cmd.name}`, label: `${cmd.name}()`, sub: 'command', kind: 'process' });
    }
    const kind = model.actorKind(cmd.actor);
    const who = kind === 'external' ? externals.find((e) => cmd.actor.toLowerCase().startsWith(e.label.toLowerCase())) : actors.find((a) => a.label.toLowerCase() === cmd.actor.toLowerCase());
    if (who) edges.push({ from: who.id, to: `cmd:${cmd.name}`, label: cmd.params.join(', ') });
    edges.push({ from: `cmd:${cmd.name}`, to: 'log', label: short(eventsOf(cmd), 2) });
    if (cmd.on.length) edges.push({ from: 'log', to: `cmd:${cmd.name}`, label: '', style: 'dashed', weak: true });
    for (const f of cmd.from) edges.push({ from: `view:${f.name}`, to: `cmd:${cmd.name}`, label: 'read', style: 'dashed', weak: true });
  }
  for (const v of model.views) {
    nodes.push({ id: `view:${v.name}`, label: v.name, sub: 'data store, read model', kind: 'view' });
    edges.push({ from: 'log', to: `view:${v.name}`, label: short(v.sources.map((s) => s.name), 2) });
  }
  for (const [name, w] of workersOf(model)) {
    nodes.push({ id: `worker:${name}`, label: name, sub: w.schedules.length ? `process, ${w.schedules[0]}` : 'process, async', kind: 'worker' });
    if (w.triggers.length) edges.push({ from: 'log', to: `worker:${name}`, label: short(w.triggers, 2) });
    for (const v of new Set(w.reads)) edges.push({ from: `view:${v}`, to: `worker:${name}`, label: 'read', style: 'dashed', weak: true });
    for (const c of [...new Set(w.commands)]) {
      if (!seen.has(c)) { seen.add(c); nodes.push({ id: `cmd:${c}`, label: `${c}()`, sub: 'command, not modeled', kind: 'process', declared: false }); }
      edges.push({ from: `worker:${name}`, to: `cmd:${c}`, label: 'issues', weak: true });
    }
    if (w.emits.length) edges.push({ from: `worker:${name}`, to: 'log', label: short(w.emits, 2), weak: true });
  }
  const known = new Set(nodes.map((n) => n.id));
  const flows = edges.filter((e) => known.has(e.from) && known.has(e.to));
  const connected = new Set(flows.flatMap((e) => [e.from, e.to]));
  return { title: `${sysName} · data flow`, subtitle: `${subtitle(model)}   ·   dashed = a command reads existing facts or a view`, direction: 'LR', nodes: nodes.filter((n) => connected.has(n.id)), edges: flows, groups: [] };
}

function deployment(model) {
  const regions = model.system ? model.system.regions : [];
  if (!regions.length) {
    const err = new Error('No regions declared. Add "region: a, b" to the system block to get a deployment view.');
    err.code = 'NO_REGIONS';
    throw err;
  }
  const sysName = model.system.name;
  const nodes = [];
  const edges = [];
  const groups = [];
  const emitsOf = (b) => new Set(model.commands.filter((c) => c.boundary && c.boundary.name === b.name).flatMap(eventsOf));
  const scoped = model.commands.some((c) => c.boundary);
  const workers = workersOf(model);

  const regionCount = (b) => {
    const n = parseInt(b.annotations.cost && b.annotations.cost.regions, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, regions.length) : regions.length;
  };

  regions.forEach((region, ri) => {
    const r = slug(region);
    const members = [];
    const add = (n) => { nodes.push({ ...n, id: `${r}:${n.id}` }); members.push(`${r}:${n.id}`); };
    add({ id: 'api', label: 'Command API', sub: 'stateless', kind: 'process' });
    const live = model.boundaries.filter((b) => ri < regionCount(b));
    for (const b of live) {
      const cost = b.annotations.cost || {};
      const key = b.annotations.partition && b.annotations.partition.shardKey;
      add({ id: `shard:${b.name}`, label: `${b.name} shards`, sub: [key ? `by ${key}` : '', cost.shardFanout ? `${cost.shardFanout} shards` : '', regionCount(b) > 1 ? `in ${regionCount(b)} regions` : 'this region only'].filter(Boolean).join(' · '), kind: 'store' });
      edges.push({ from: `${r}:api`, to: `${r}:shard:${b.name}`, label: scoped ? short(model.commands.filter((c) => c.boundary && c.boundary.name === b.name).map((c) => c.name), 2) : '' });
    }
    for (const v of model.views) {
      const c = cacheOf(v);
      add({ id: `view:${v.name}`, label: v.name, sub: c ? `cache ttl ${c.ttl || '?'}` : 'read model', kind: 'cache' });
      const feeders = scoped ? live.filter((b) => v.sources.some((s) => emitsOf(b).has(s.name))) : [];
      if (feeders.length) for (const b of feeders) edges.push({ from: `${r}:shard:${b.name}`, to: `${r}:view:${v.name}`, label: '' });
      else edges.push({ from: `${r}:api`, to: `${r}:view:${v.name}`, label: '' });
    }
    for (const [name, w] of workers) {
      add({ id: `worker:${name}`, label: name, sub: 'async worker', kind: 'worker' });
      const feeders = scoped ? live.filter((b) => w.triggers.some((t) => emitsOf(b).has(t))) : [];
      if (feeders.length) for (const b of feeders) edges.push({ from: `${r}:shard:${b.name}`, to: `${r}:worker:${name}`, label: '' });
      else edges.push({ from: `${r}:api`, to: `${r}:worker:${name}`, label: '' });
    }
    groups.push({ id: `region:${r}`, label: region, members });
  });
  const note = scoped
    ? 'Inferred: each region runs the full stack unless a boundary says @cost(regions=n).'
    : 'Inferred: each region runs the full stack. State "in Boundary(key)" on commands to see which shards feed which read models.';
  return { title: `${sysName} · deployment`, subtitle: `${subtitle(model)}   ·   ${note}`, direction: 'LR', stack: true, nodes, edges, groups };
}

/* Contexts as boxes, and the events that cross between them. A dashed arrow is an event the sender does not list in publishes. */
function contextMap(model) {
  if (!model.contexts.length) {
    const err = new Error('No contexts declared. Wrap statements in "context Name { ... }" to get a context map.');
    err.code = 'NO_CONTEXTS';
    throw err;
  }
  const byName = new Map(model.contexts.map((c) => [c.name, c]));
  const count = (list, c) => list.filter((x) => x.context === c.name).length;
  const nodes = model.contexts.map((c) => ({
    id: `ctx:${c.name}`,
    label: c.name,
    sub: `${c.role} · ${count(model.commands, c)} commands, ${count(model.views, c)} views`,
    kind: c.role === 'adapter' ? 'external' : 'process',
  }));
  const flows = new Map();
  for (const ev of model.events.values()) {
    const from = new Set(ev.emittedBy.map((x) => x.context).filter(Boolean));
    const to = new Set(ev.consumedBy.map((x) => x.context).filter(Boolean));
    for (const a of from) {
      for (const b of to) {
        if (a === b) continue;
        const key = `${a}>${b}`;
        if (!flows.has(key)) flows.set(key, { from: a, to: b, events: [], open: false });
        const f = flows.get(key);
        f.events.push(ev.name);
        if (!byName.get(a).publishes.includes(ev.name)) f.open = true;
      }
    }
  }
  const edges = [...flows.values()].map((f) => ({ from: `ctx:${f.from}`, to: `ctx:${f.to}`, label: short(f.events, 3), style: f.open ? 'dashed' : 'solid' }));
  const sysName = model.system ? model.system.name : 'System';
  return { title: `${sysName} · context map`, subtitle: `${subtitle(model)}   ·   dashed = an event the sender does not publish`, direction: 'LR', nodes, edges, groups: [] };
}

const BUILDERS = { context, containers, dataflow, deployment, contextmap: contextMap };

module.exports = { BUILDERS, context, containers, dataflow, deployment, contextMap };

},
function (module, exports, __r) {
'use strict';

/*
 * The rules that come with a profile, plus the one core rule that needs real parsing (timers).
 * Each rule is a function from a model to [{ severity, rule, message, line }]. The catalogue says
 * what each one means; a test checks the two agree.
 */

const { BY_ID } = __r(4);

const issue = (rule, message, line) => ({ severity: BY_ID.get(rule).severity, rule, message, line: line || '' });
const bare = (n) => String(n).replace(/\?$/, '');
/* The names bound in an argument list: "userId, window: 60s" gives userId and window. */
const names = (text) => String(text || '').split(',').map((p) => /^\s*([A-Za-z_]\w*)/.exec(p)).filter(Boolean).map((m) => m[1]);
/* @slice("Name") */
const sliceOf = (annotations) => {
  const s = [].concat((annotations && annotations.slice) || [])[0];
  if (s && typeof s === 'object') return (s._ && s._[0]) || s.name || null;
  return typeof s === 'string' ? s : null;
};
/* @dedupe(eventId) and @correlate(orderRef) name fields of the outside facts a statement consumes that its own payload does not carry:
   the key that tells a repeat delivery from a new one, and the key that ties the fact to something here. They count as supplied. */
const keys = (annotations) => ['dedupe', 'correlate'].flatMap((n) => [].concat((annotations && annotations[n]) || []).flatMap((a) => (a && typeof a === 'object' && a._ ? a._ : typeof a === 'string' ? [a] : [])));

/* A field written `name: type` is carried, not computed: the type sits where an expression would. */
const TYPE = /^(text|string|number|int|integer|float|id|uuid|datetime|date|time|yesno|bool|boolean)$|^list\[.+\]$|^[A-Z][A-Za-z0-9_]*$/;
const carried = (f) => !f.expr || TYPE.test(f.expr.trim());
const quote = (list) => list.map((x) => `"${x}"`).join(', ');

/* Every field name an event is recorded with, over all the places that record it. */
function eventFields(model) {
  const out = new Map();
  const add = (event, fields) => {
    if (!out.has(event)) out.set(event, new Set());
    for (const f of fields) out.get(event).add(f.name);
  };
  for (const c of model.commands) for (const b of c.branches) for (const e of b.emits) add(e.event, e.fields);
  for (const p of model.policies) {
    if (p.trigger.event) add(p.trigger.event, p.trigger.fields || []);
    for (const r of p.rules) for (const e of r.emits) add(e.event, e.fields);
  }
  return out;
}

/* ------------------------------------------------------------------ core */

const FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const FIELD_NAMES = ['minute', 'hour', 'day of month', 'month', 'day of week'];
function cronField(field, [low, high]) {
  return field.split(',').every((part) => {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) return false;
    const inRange = (n) => Number(n) >= low && Number(n) <= high;
    if (m[1] !== '*' && !inRange(m[1])) return false;
    if (m[2] && !inRange(m[2])) return false;
    return !m[3] || Number(m[3]) > 0;
  });
}

function scheduleIssues(model) {
  const out = [];
  for (const p of model.policies) {
    const s = p.trigger.schedule;
    if (!s) continue;
    const interval = /^every (\d+) /.exec(s);
    if (interval) {
      if (Number(interval[1]) < 1) out.push(issue('schedule-invalid', `Timer "${s}" never fires: an interval needs a whole number above zero`, p.line));
      continue;
    }
    const cron = /^cron "(.*)"$/.exec(s);
    if (!cron) continue;
    const fields = cron[1].trim().split(/\s+/);
    if (fields.length !== 5) { out.push(issue('schedule-invalid', `Timer ${s} needs five parts: minute, hour, day of month, month and day of week`, p.line)); continue; }
    const bad = fields.findIndex((f, i) => !cronField(f, FIELD_RANGES[i]));
    if (bad >= 0) out.push(issue('schedule-invalid', `Timer ${s} has "${fields[bad]}" where a ${FIELD_NAMES[bad]} belongs, and that is not valid`, p.line));
  }
  return out;
}

/* Scenarios written as steps are checked against the command they sit under. */
function scenarioStepIssues(model) {
  const out = [];
  const check = (owner, kind) => {
    for (const sc of owner.scenarios) {
      const st = sc.steps;
      if (!st) continue;
      if (kind === 'view') { out.push(issue('scenario-steps', `Scenario "${sc.name}" on view "${owner.name}" is written as steps, which a view does not take yet. Write it as prose`, sc.line)); continue; }
      if (!st.when) out.push(issue('scenario-steps', `Scenario "${sc.name}" has no when step`, sc.line));
      else if (st.when.name !== owner.name) out.push(issue('scenario-steps', `Scenario "${sc.name}" sits under "${owner.name}" but its when step runs "${st.when.name}"`, st.when.line));
      if (!st.then) out.push(issue('scenario-steps', `Scenario "${sc.name}" has no then step`, sc.line));
      const known = (e) => model.events.has(e);
      for (const g of st.given) if (!known(g.event)) out.push(issue('scenario-unknown-event', `Scenario "${sc.name}" gives "${g.event}", which no command or policy records or reads`, g.line));
      if (st.then && st.when && st.when.name === owner.name) {
        const same = model.commands.filter((c) => c.name === owner.name && c.actor === owner.actor);
        const emits = new Set(same.flatMap((c) => c.branches.flatMap((b) => b.emits.map((e) => e.event))));
        const rejects = new Set(same.flatMap((c) => c.branches.map((b) => b.reject).filter(Boolean)));
        if (st.then.reject) { if (!rejects.has(st.then.reject)) out.push(issue('scenario-then-mismatch', `Scenario "${sc.name}" expects rejection ${st.then.reject}, which "${owner.name}" does not have`, st.then.line)); }
        else for (const e of st.then.events) {
          if (!known(e.event)) out.push(issue('scenario-unknown-event', `Scenario "${sc.name}" expects "${e.event}", which no command or policy records or reads`, st.then.line));
          else if (!emits.has(e.event)) out.push(issue('scenario-then-mismatch', `Scenario "${sc.name}" expects "${e.event}", which "${owner.name}" never records`, st.then.line));
        }
      }
    }
  };
  for (const c of model.commands) check(c, 'command');
  for (const v of model.views) check(v, 'view');
  return out;
}

/* ---------------------------------------------------------- eventmodeling */

function unsourcedEventFields(model) {
  const out = [];
  const fieldsOf = eventFields(model);
  const shape = new Map(model.views.map((v) => [v.name, v.shape.map((f) => f.name)]));
  const known = (event) => [...(fieldsOf.get(event) || [])];

  /* A fact nothing records, or a view nobody declares, may supply anything, so what it supplies is unknown. */
  const unknownSource = (facts) => facts.some((f) => (model.events.has(f.name) ? model.events.get(f.name).emittedBy.length === 0 : !shape.has(f.name)));

  for (const cmd of model.commands) {
    if (unknownSource([...cmd.on, ...cmd.from])) continue;
    const supplied = new Set([...cmd.params.map(bare), ...names(cmd.boundary && cmd.boundary.args), ...keys(cmd.annotations)]);
    for (const f of cmd.on) { names(f.args).forEach((n) => supplied.add(n)); if (f.alias) supplied.add(f.alias); known(f.name).forEach((n) => supplied.add(n)); }
    for (const f of cmd.from) { names(f.args).forEach((n) => supplied.add(n)); if (f.alias) supplied.add(f.alias); (shape.get(f.name) || []).forEach((n) => supplied.add(n)); }
    for (const b of cmd.branches) {
      for (const e of b.emits) {
        const missing = e.fields.filter((f) => carried(f) && !supplied.has(f.name)).map((f) => f.name);
        if (missing.length) out.push(issue('unsourced-event-field', `Event "${e.event}" carries ${quote(missing)}, which command "${cmd.name}" does not supply. Add ${missing.length === 1 ? 'it' : 'them'} to the command or a fact it needs, or compute ${missing.length === 1 ? 'it' : 'them'} (name: expression)`, b.line));
      }
    }
  }
  for (const pol of model.policies) {
    const who = pol.trigger.event ? `on "${pol.trigger.event}"` : `on "${pol.trigger.schedule}"`;
    if (unknownSource(pol.from)) continue;
    const supplied = new Set([...(pol.trigger.fields || []).map((f) => f.name), ...keys(pol.annotations)]);
    for (const f of pol.from) { names(f.args).forEach((n) => supplied.add(n)); if (f.alias) supplied.add(f.alias); (shape.get(f.name) || []).forEach((n) => supplied.add(n)); }
    for (const r of pol.rules) {
      if (r.worker) continue; // what a worker records is the worker's own business, not something the trigger must carry
      for (const e of r.emits) {
        const missing = e.fields.filter((f) => carried(f) && !supplied.has(f.name)).map((f) => f.name);
        if (missing.length) out.push(issue('unsourced-event-field', `Event "${e.event}" carries ${quote(missing)}, which policy ${who} does not supply. Add ${missing.length === 1 ? 'it' : 'them'} to what the trigger carries, or compute ${missing.length === 1 ? 'it' : 'them'} (name: expression)`, r.line));
      }
    }
  }
  return out;
}

function unsourcedViewFields(model) {
  const out = [];
  const fieldsOf = eventFields(model);
  for (const view of model.views) {
    if (!view.sources.length) continue;
    const events = view.sources.map((s) => model.events.get(s.name));
    // A source nothing records is an assumed fact: its payload is unknown, so there is nothing to check against.
    if (events.some((e) => !e || e.emittedBy.length === 0)) continue;
    const have = new Set([...view.params.map(bare), ...view.sources.flatMap((s) => names(s.args)), ...keys(view.annotations)]);
    for (const s of view.sources) (fieldsOf.get(s.name) || []).forEach((n) => have.add(n));
    const missing = view.shape.filter((f) => carried(f) && !have.has(f.name)).map((f) => f.name);
    if (missing.length) out.push(issue('unsourced-view-field', `View "${view.name}" shows ${quote(missing)}, which no event it projects from carries. Add ${missing.length === 1 ? 'it' : 'them'} to an event, or compute ${missing.length === 1 ? 'it' : 'them'} (name: expression)`, view.line));
  }
  return out;
}

/* Strongly connected components, so a loop is found wherever it runs. */
function loops(edges) {
  let index = 0;
  const stack = [];
  const meta = new Map();
  const found = [];
  const visit = (v) => {
    meta.set(v, { index, low: index, on: true });
    index++;
    stack.push(v);
    for (const w of edges.get(v) || []) {
      if (!meta.has(w)) { visit(w); meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).low); }
      else if (meta.get(w).on) meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).index);
    }
    if (meta.get(v).low === meta.get(v).index) {
      const group = [];
      let w;
      do { w = stack.pop(); meta.get(w).on = false; group.push(w); } while (w !== v);
      if (group.length > 1) found.push(group);
    }
  };
  for (const v of edges.keys()) if (!meta.has(v)) visit(v);
  return found;
}

function dependencyCycles(model) {
  const out = [];
  const nodes = new Map();
  const edges = new Map();
  const node = (key, label, line) => { if (!nodes.has(key)) { nodes.set(key, { label, line }); edges.set(key, new Set()); } };
  const edge = (from, to) => { if (edges.has(from) && edges.has(to) && from !== to) edges.get(from).add(to); };
  for (const c of model.commands) node(`c:${c.name}`, `command "${c.name}"`, c.line);
  model.policies.forEach((p, i) => node(`p:${i}`, `policy on "${p.trigger.event || p.trigger.schedule}"`, p.line));
  const emitters = (event) => ((model.events.get(event) || {}).emittedBy || []).flatMap((e) => {
    if (e.kind === 'command') return [`c:${e.name}`];
    return model.policies.flatMap((p, i) => ((p.trigger.event || p.trigger.schedule) === e.name ? [`p:${i}`] : []));
  });
  for (const c of model.commands) for (const f of c.on) for (const from of emitters(f.name)) edge(from, `c:${c.name}`);
  model.policies.forEach((p, i) => {
    if (p.trigger.event) for (const from of emitters(p.trigger.event)) edge(from, `p:${i}`);
    for (const r of p.rules) if (r.command) edge(`p:${i}`, `c:${r.command.name}`);
  });
  for (const group of loops(edges)) {
    const ordered = group.sort((a, b) => nodes.get(a).line - nodes.get(b).line);
    out.push(issue('dependency-cycle', `${ordered.map((k) => nodes.get(k).label).join(', ')} wait on each other in a loop, so no order of work can start. Break it with an event that does not depend on the others`, nodes.get(ordered[0]).line));
  }
  return out;
}

function sliceShapes(model) {
  const out = [];
  const group = (items, nameOf, ruleId, what) => {
    const by = new Map();
    for (const item of items) {
      const slice = sliceOf(item.annotations);
      if (!slice) continue;
      if (!by.has(slice)) by.set(slice, new Map());
      if (!by.get(slice).has(nameOf(item))) by.get(slice).set(nameOf(item), item.line);
    }
    for (const [slice, members] of by) {
      if (members.size < 2) continue;
      const list = [...members.entries()].sort((a, b) => a[1] - b[1]);
      out.push(issue(ruleId, `Slice "${slice}" holds ${list.length} ${what}: ${quote(list.map(([n]) => n))}. ${ruleId === 'slice-multiple-views' ? 'A slice owns one query, so fold them into one view shaped for how it is read. Reading views other slices define is fine' : 'A write slice has one command, so give each its own slice'}`, list[1][1]));
    }
  };
  group(model.commands, (c) => c.name, 'slice-multiple-commands', 'commands');
  group(model.views, (v) => v.name, 'slice-multiple-views', 'read models');
  return out;
}

function scenarioCoverage(model) {
  const all = [...model.commands, ...model.views];
  if (!all.length) return [];
  const without = [];
  const seen = new Set();
  for (const x of all) {
    const key = `${x.actor ? 'c' : 'v'}:${x.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const has = all.some((y) => y.name === x.name && !!y.actor === !!x.actor && y.scenarios.length);
    if (!has) without.push(x);
  }
  if (!without.length) return [];
  return [issue('slice-no-scenario', `${without.length} of ${seen.size} commands and views have no scenario, starting with "${without[0].name}"`, without[0].line)];
}

/* A command an outside system issues is a fact that can arrive twice. Say which field tells the copies apart. */
function dedupeCoverage(model) {
  const out = [];
  for (const c of model.commands) {
    if (model.actorKind(c.actor) !== 'external' || keys(c.annotations).length) continue;
    if (c.annotations.dedupe || c.annotations.correlate) continue;
    out.push(issue('translation-no-dedupe', `Command "${c.name}" comes from outside system "${c.actor}", which can deliver the same fact twice. Say which field tells a repeat from a new one: @dedupe(eventId)`, c.line));
  }
  return out;
}

function hints(model) {
  const out = [];
  for (const c of model.commands) {
    for (const b of c.branches) {
      const events = [...new Set(b.emits.map((e) => e.event))];
      if (b.default && events.length > 1) out.push(issue('many-events', `Command "${c.name}" records ${events.length} events on its happy path: ${quote(events)}. Right if they are one fact told in parts; if they are two steps, a policy can take the second`, b.line));
    }
  }
  for (const v of model.views) {
    if (v.sources.length >= 4) out.push(issue('view-many-sources', `${v.sources.length} events feed view "${v.name}". Combining streams is fine, but each event ties the view to the command that records it`, v.line));
  }
  return out;
}

const KINDS = ['question', 'assumption', 'request'];
const CATEGORIES = ['action', 'data', 'next', 'rule', 'example', 'view', 'who', 'time'];
const asList = (x) => [].concat(x || []).filter((v) => v !== undefined);
const text = (h) => (h && typeof h === 'object' ? (h._ && h._[0]) || '' : typeof h === 'string' ? h : '');
/* Everything that can carry @hotspot or @accept: [{ item, line }]. */
function carriers(model) {
  return [...model.commands, ...model.views, ...model.policies, ...model.boundaries].filter((x) => x.annotations);
}
function hotspotIssues(model, open) {
  const out = [];
  for (const c of carriers(model)) {
    for (const h of asList(c.annotations.hotspot)) {
      const q = text(h).trim();
      const o = h && typeof h === 'object' ? h : {};
      const bad = !q ? 'has no question' : o.kind && !KINDS.includes(o.kind) ? `has kind "${o.kind}", which is not one of ${KINDS.join(', ')}` : o.category && !CATEGORIES.includes(o.category) ? `has category "${o.category}", which is not one of ${CATEGORIES.join(', ')}` : o.status && !['open', 'resolved'].includes(o.status) ? `has status "${o.status}", which is not open or resolved` : o.kind === 'request' && !o.concerns ? 'is a request, which says what must change with concerns="..."' : o.kind !== 'request' && o.concerns ? 'has concerns, which only a request has' : null;
      if (bad) out.push(issue('hotspot-invalid', `A @hotspot on "${c.name || c.trigger.event || c.trigger.schedule}" ${bad}`, c.line));
      else if (open && (o.status || 'open') === 'open') out.push(issue('hotspot-open', `Open ${o.kind || 'question'}: ${q}`, c.line));
    }
  }
  return out;
}
function acceptIssues(model, known) {
  const out = [];
  for (const c of carriers(model)) {
    for (const a of asList(c.annotations.accept)) {
      const o = a && typeof a === 'object' ? a : {};
      const who = c.name || c.trigger.event || c.trigger.schedule;
      if (!o.rule || !known.has(o.rule)) out.push(issue('accept-invalid', `An @accept on "${who}" needs rule="..." naming a rule in the catalogue${o.rule ? `, and "${o.rule}" is not one` : ''}`, c.line));
      else if (!String(o.reason || '').trim()) out.push(issue('accept-invalid', `The @accept of ${o.rule} on "${who}" needs a reason="..."`, c.line));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- slicerm */

function rejectionCoverage(model) {
  const scenarios = [...model.commands, ...model.views].some((x) => x.scenarios.length);
  if (!scenarios) return []; // scenarios are kept elsewhere, so there is nothing to compare against
  const out = [];
  for (const c of model.commands) {
    const own = model.commands.filter((o) => o.name === c.name).flatMap((o) => o.scenarios);
    const text = own.map((s) => `${s.name}\n${s.text}`).join('\n');
    const typed = new Set(own.map((s) => s.steps && s.steps.then && s.steps.then.reject).filter(Boolean));
    for (const b of c.branches) {
      if (b.reject && !typed.has(b.reject) && !new RegExp(`\\b${b.reject}\\b`).test(text)) out.push(issue('rejection-uncovered', `Command "${c.name}" can refuse with ${b.reject}, and no scenario names it`, b.line));
    }
  }
  return out;
}

function routeDuplicates(model) {
  const seen = new Map();
  const add = (kind, item, context) => {
    for (const t of item.triggers) {
      if (!t.route) continue;
      const key = `${context || ''} ${t.route}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push({ target: `${kind} "${item.name}"`, route: t.route, line: item.line });
    }
  };
  for (const c of model.commands) add('command', c, c.context);
  for (const v of model.views) add('view', v, v.context);
  const out = [];
  for (const list of seen.values()) {
    const targets = [...new Set(list.map((x) => x.target))];
    if (targets.length < 2) continue;
    const first = list[0].target;
    for (const x of list) if (x.target !== first) out.push(issue('route-duplicate', `${x.route} is also used by ${targets.filter((t) => t !== x.target).join(', ')}`, x.line));
  }
  return out;
}

module.exports = {
  scheduleIssues, scenarioStepIssues, hotspotIssues, acceptIssues,
  eventmodelingIssues: (model) => [...unsourcedEventFields(model), ...unsourcedViewFields(model), ...dependencyCycles(model), ...sliceShapes(model), ...scenarioCoverage(model), ...dedupeCoverage(model), ...hints(model)],
  slicermIssues: (model) => [...rejectionCoverage(model), ...routeDuplicates(model)],
  sliceOf,
};

},
function (module, exports, __r) {
'use strict';

const { buildBoard, boardToGraph } = __r(8);
const { renderBoard, renderGraph } = __r(12);
const { toMermaid, toDot } = __r(14);
const { BUILDERS } = __r(9);
const { KINDS, FORMATS } = __r(7);
const { linkMap, sourceRanges } = __r(6);

/* The boxes of this diagram that lead somewhere: { boxId: [ { href, title } ] }. */
function resolveLinks(model, kind, format, opts) {
  const base = opts.linkBase || '';
  const href = opts.href || ((t) => t.url || `${base}${t.diagram}.${FORMATS[format]}${t.node ? `#${encodeURIComponent(t.node).replace(/%3A/g, ':')}` : ''}`);
  const out = new Map();
  for (const [id, targets] of Object.entries(linkMap(model)[kind] || {})) out.set(id, targets.map((t) => ({ href: href(t), title: `Open ${t.label}`, target: t })));
  return out;
}

/* Returns the diagram as text. Throws an Error with .code NO_REGIONS or NO_CONTEXTS when there is nothing to draw.
   opts.links turns on links between diagrams: each box that leads somewhere becomes a link, to <diagram>.<ext>#<box>
   beside the file (opts.linkBase prefixes that, opts.href replaces how a target becomes an address). */
function render(model, kind, format = 'svg', theme = 'light', opts = {}) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown diagram "${kind}". Choose one of: ${KINDS.join(', ')}`);
  if (!FORMATS[format]) throw new Error(`Unknown format "${format}". Choose one of: ${Object.keys(FORMATS).join(', ')}`);
  const diagram = kind === 'eventmodel' ? buildBoard(model) : BUILDERS[kind](model);
  const links = opts.links ? resolveLinks(model, kind, format, opts) : null;
  if (format === 'svg') return (kind === 'eventmodel' ? renderBoard : renderGraph)(diagram, { theme, links, ranges: kind === 'eventmodel' ? null : sourceRanges(model, kind) });
  const graph = kind === 'eventmodel' ? boardToGraph(diagram) : diagram;
  return (format === 'mermaid' ? toMermaid : toDot)(graph, links);
}

module.exports = { KINDS, FORMATS, render };

},
function (module, exports, __r) {
'use strict';

const { layering } = __r(13);
const { LANES } = __r(8);

/*
 * Dependency-free SVG output. Two renderers:
 *   renderBoard  the Event Modeling swimlane board
 *   renderGraph  a layered left-to-right graph, for the system diagrams
 * Text is monospace so box widths can be computed without a browser.
 */

const THEMES = {
  light: { bg: '#ffffff', ink: '#0a0e1a', soft: '#465170', line: '#7d87a3', band: '#f4f6fb', accent: '#ffd400', accentInk: '#0a0e1a', surface: '#e9eef7' },
  dark: { bg: '#0a0e1a', ink: '#f3f5fa', soft: '#c2cadd', line: '#8892ad', band: '#0f1630', accent: '#ffd400', accentInk: '#0a0e1a', surface: '#17244a' },
};
const MONO = "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const CW = 7.3; // monospace advance at 12px

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (n) => Math.round(n * 10) / 10;
const textW = (s, size = 12) => s.length * CW * (size / 12);

function nodeSize(n, minW = 96) {
  const w = Math.max(minW, textW(n.label) + 28, n.sub ? textW(n.sub, 10) * 0.9 + 28 : 0);
  return { w: Math.ceil(w), h: n.sub ? 50 : 40 };
}

/* One shape per kind. Shape and outline carry the meaning, colour only reinforces it. */
function shape(n, g, t) {
  const { x, y, w, h } = g;
  const dashed = n.declared === false || n.assumed || n.planned ? ' stroke-dasharray="5 3"' : '';
  const onAccent = n.kind === 'system' || (n.kind === 'event' && !n.assumed);
  const label = `<text x="${n1(x + w / 2)}" y="${n1(y + (n.sub ? h / 2 - 4 : h / 2 + 4))}" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="${n.kind === 'event' ? 600 : 500}" fill="${onAccent ? t.accentInk : t.ink}">${esc(n.label)}</text>`;
  const sub = n.sub ? `<text x="${n1(x + w / 2)}" y="${n1(y + h / 2 + 12)}" text-anchor="middle" font-family="${SANS}" font-size="10" fill="${onAccent ? t.accentInk : t.soft}">${esc(n.sub)}</text>` : '';
  let body;
  switch (n.kind) {
    case 'event':
      body = n.assumed
        ? `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="6" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5" stroke-dasharray="5 3"/>`
        : `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="6" fill="${t.accent}" stroke="${t.ink}" stroke-width="1"/>`;
      break;
    case 'command':
    case 'process':
      body = `<rect x="${n1(x + 3)}" y="${n1(y + 3)}" width="${w}" height="${h}" rx="6" fill="none" stroke="${t.line}" stroke-width="1"/><rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="6" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5"${dashed}/>`;
      break;
    case 'view':
    case 'store':
    case 'cache':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="6" fill="${t.surface}" stroke="${t.ink}" stroke-width="1.5"${dashed}/><line x1="${n1(x + 4)}" y1="${n1(y + h - 5)}" x2="${n1(x + w - 4)}" y2="${n1(y + h - 5)}" stroke="${t.ink}" stroke-width="1"/>`;
      break;
    case 'policy':
    case 'worker':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5" stroke-dasharray="5 3"/>`;
      break;
    case 'timer':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5" stroke-dasharray="1 3"/>`;
      break;
    case 'external':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.bg}" stroke="${t.ink}" stroke-width="1.5" stroke-dasharray="2 3"/>`;
      break;
    case 'system':
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="10" fill="${t.accent}" stroke="${t.ink}" stroke-width="2.5"/>`;
      break;
    default: // actor and anything else
      body = `<rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.surface}" stroke="${t.ink}" stroke-width="1.5"/>`;
  }
  return body + label + sub;
}

/* Links between diagrams (see links.js). A box that leads somewhere is wrapped in a link to its first target,
   and carries one small arrow badge per target, each with its own tooltip. */
const idAttr = (opts, id) => (opts.links ? ` id="${esc(id)}"` : '');
const rangesAttr = (r) => (r && r.length ? ` data-lines="${r.map(([a, b]) => `${a}-${b}`).join(',')}"` : '');
function anchored(body, targets) {
  if (!targets || !targets.length) return body;
  return `<a class="lnk" href="${esc(targets[0].href)}"><title>${esc(targets[0].title)}</title>${body}</a>`;
}
function badges(targets, g, t) {
  if (!targets || !targets.length) return '';
  return targets.slice(0, 3).map((k, i) => {
    const x = n1(g.x + g.w - 8 - i * 20);
    const y = n1(g.y - 9);
    return `<a class="lnk-badge" href="${esc(k.href)}"><title>${esc(k.title)}</title><rect x="${x}" y="${y}" width="17" height="15" rx="4" fill="${t.accent}" stroke="${t.ink}" stroke-width="1"/><path d="M${n1(x + 4.5)} ${n1(y + 10.5)}L${n1(x + 12)} ${n1(y + 4)}M${n1(x + 7)} ${n1(y + 4)}H${n1(x + 12)}V${n1(y + 9)}" fill="none" stroke="${t.ink}" stroke-width="1.5" stroke-linecap="round"/></a>`;
  }).join('');
}

function defs(t) {
  return `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${t.line}"/></marker></defs>`;
}

function edgePath(a, b, back, bump = 0) {
  if (back) {
    const sx = a.x + a.w / 2;
    const tx = b.x + b.w / 2;
    const sy = a.y + a.h;
    const ty = b.y + b.h;
    const d = 44 + bump;
    return { d: `M${n1(sx)} ${n1(sy)} C${n1(sx)} ${n1(sy + d)} ${n1(tx)} ${n1(ty + d)} ${n1(tx)} ${n1(ty)}`, mx: (sx + tx) / 2, my: (sy + ty) / 2 + d * 0.75 };
  }
  if (b.x > a.x + a.w - 1) {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const dx = Math.max(24, (x2 - x1) / 2);
    return { d: `M${n1(x1)} ${n1(y1)} C${n1(x1 + dx)} ${n1(y1)} ${n1(x2 - dx)} ${n1(y2)} ${n1(x2)} ${n1(y2)}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  }
  // same column: connect top and bottom
  const down = b.y > a.y;
  const x1 = a.x + a.w / 2;
  const x2 = b.x + b.w / 2;
  const y1 = down ? a.y + a.h : a.y;
  const y2 = down ? b.y : b.y + b.h;
  return { d: `M${n1(x1)} ${n1(y1)} C${n1(x1)} ${n1((y1 + y2) / 2)} ${n1(x2)} ${n1((y1 + y2) / 2)} ${n1(x2)} ${n1(y2)}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

function edgeSvg(e, p, t) {
  const dash = e.style === 'dashed' ? ' stroke-dasharray="5 4"' : '';
  const path = `<path d="${p.d}" fill="none" stroke="${t.line}" stroke-width="1.4"${dash} marker-end="url(#arr)"/>`;
  const label = e.label
    ? `<text x="${n1(p.mx)}" y="${n1(p.my - 4)}" text-anchor="middle" font-family="${SANS}" font-size="10" fill="${t.soft}" stroke="${t.bg}" stroke-width="3" paint-order="stroke">${esc(e.label)}</text>`
    : '';
  return path + label;
}

function wrap(width, height, title, desc, t, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" width="${Math.ceil(width)}" height="${Math.ceil(height)}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<rect width="100%" height="100%" fill="${t.bg}"/>
${defs(t)}
${inner}
</svg>
`;
}

function renderBoard(board, opts = {}) {
  const t = THEMES[opts.theme] || THEMES.light;
  const M = 28;
  const LABEL_W = 84;
  const GAP = 48;
  const TOP = 56;
  const ROW_H = 78;

  const size = new Map(board.nodes.map((n) => [n.id, nodeSize(n)]));
  const colW = Array(board.cols).fill(0);
  for (const n of board.nodes) colW[n.col] = Math.max(colW[n.col], (n.indent || 0) + size.get(n.id).w, ...(n.notes || []).map((t) => textW(t, 9.5)));
  const colX = [];
  let x = M + LABEL_W + 16;
  for (let c = 0; c < board.cols; c++) { colX.push(x); x += colW[c] + GAP; }
  const width = x - GAP + M;
  const rowsIn = Object.fromEntries(LANES.map((l) => [l, 1]));
  for (const n of board.nodes) rowsIn[n.lane] = Math.max(rowsIn[n.lane], n.row + 1);
  const laneH = (l) => 30 + rowsIn[l] * ROW_H;
  const laneTop = {};
  let ty = TOP;
  for (const l of LANES) { laneTop[l] = ty; ty += laneH(l); }
  const lanesTop = (l) => laneTop[l];
  const height = ty + 52;

  const geo = new Map();
  for (const n of board.nodes) {
    const s = size.get(n.id);
    geo.set(n.id, { x: colX[n.col] + (n.indent || 0), y: lanesTop(n.lane) + 14 + n.row * ROW_H, w: s.w, h: s.h });
  }

  let inner = '';
  inner += `<text x="${M}" y="30" font-family="${SANS}" font-size="16" font-weight="700" fill="${t.ink}">${esc(board.title)} · event model</text>`;
  LANES.forEach((lane, i) => {
    const y = lanesTop(lane);
    if (i % 2 === 0) inner += `<rect x="${M}" y="${y}" width="${n1(width - 2 * M)}" height="${laneH(lane)}" fill="${t.band}"/>`;
    inner += `<text x="${M + 10}" y="${y + laneH(lane) / 2 + 4}" font-family="${MONO}" font-size="10" letter-spacing="1" fill="${t.soft}">${lane.toUpperCase()}</text>`;
  });

  board.groups.forEach((g, i) => {
    const boxes = g.members.map((id) => geo.get(id)).filter(Boolean);
    if (!boxes.length) return;
    const pad = 9 + i * 5;
    const x1 = Math.min(...boxes.map((b) => b.x)) - pad;
    const y1 = Math.min(...boxes.map((b) => b.y)) - pad;
    const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
    const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
    const gt = opts.links && opts.links.get(g.id);
    let gs = `<rect x="${n1(x1)}" y="${n1(y1)}" width="${n1(x2 - x1)}" height="${n1(y2 - y1)}" rx="10" fill="${t.accent}" fill-opacity="0.12" stroke="${t.ink}" stroke-width="1.3" stroke-dasharray="7 4"/>`;
    gs += `<text x="${n1(x1 + 8)}" y="${n1(y1 - 5)}" font-family="${MONO}" font-size="10.5" font-weight="700" fill="${t.ink}" stroke="${t.bg}" stroke-width="3" paint-order="stroke">${esc(g.label)}${g.sub ? ` · ${esc(g.sub)}` : ''}</text>`;
    inner += `<g class="gp"${idAttr(opts, g.id)} data-id="${esc(g.id)}">${gs}${badges(gt, { x: x1, y: y1 + 9, w: x2 - x1 }, t)}</g>`;
  });

  let bump = 0;
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  for (const e of board.edges) {
    const a = geo.get(e.from);
    const b = geo.get(e.to);
    let seg;
    if (e.kind === 'tree') {
      const sx = a.x + 12;
      seg = `<path d="M${n1(sx)} ${n1(a.y + a.h)} V${n1(b.y + b.h / 2)} H${n1(b.x)}" fill="none" stroke="${t.line}" stroke-width="1.4" marker-end="url(#arr)"/>`;
    } else if (e.kind === 'reads') {
      const toLeft = a.x + a.w / 2 < b.x;
      const ex = toLeft ? b.x : b.x + b.w;
      const ey = b.y + b.h / 2;
      const vx = a.x + a.w / 2;
      seg = `<path d="M${n1(vx)} ${n1(a.y)} V${n1(ey)} H${n1(ex)}" fill="none" stroke="${t.line}" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#arr)"/>`;
      if (e.label) seg += `<text x="${n1(vx + 4)}" y="${n1(ey - 5)}" font-family="${SANS}" font-size="10" fill="${t.soft}" stroke="${t.bg}" stroke-width="3" paint-order="stroke">${esc(e.label)}</text>`;
    } else {
      const back = byId.get(e.to).col < byId.get(e.from).col;
      seg = edgeSvg({ label: e.label, style: e.kind === 'given' || e.kind === 'reads' ? 'dashed' : 'solid' }, edgePath(a, b, back, back ? (bump += 6) : 0), t);
    }
    inner += `<g class="ed" data-from="${esc(e.from)}" data-to="${esc(e.to)}">${seg}</g>`;
  }
  for (const n of board.nodes) {
    const g = geo.get(n.id);
    const tip = n.fullNotes && n.fullNotes.length ? `<title>${esc(n.fullNotes.join(' | '))}</title>` : '';
    const nt = opts.links && opts.links.get(n.id);
    inner += `<g class="nd"${idAttr(opts, n.id)} data-id="${esc(n.id)}" data-kind="${esc(n.kind)}" data-label="${esc(n.label)}"${n.ranges && n.ranges.length ? ` data-lines="${n.ranges.map(([a, b]) => `${a}-${b}`).join(',')}"` : ''}>${tip}${anchored(shape(n, g, t), nt)}${badges(nt, g, t)}</g>`;
    (n.notes || []).forEach((line, i) => { inner += `<text x="${n1(g.x)}" y="${n1(g.y + g.h + 12 + i * 11)}" font-family="${SANS}" font-size="9.5" fill="${t.soft}">${esc(line)}</text>`; });
  }

  const ly = ty + 26;
  const legend = [
    ['command', 'command'], ['event', 'event'], ['view', 'view'], ['policy', 'policy / worker'], ['assumed', 'assumed event (nobody emits it)'],
  ];
  let lx = M;
  for (const [kind, text] of legend) {
    const n = kind === 'assumed' ? { kind: 'event', assumed: true, label: '' } : { kind, label: '' };
    inner += shape(n, { x: lx, y: ly - 9, w: 26, h: 16 }, t);
    inner += `<text x="${lx + 34}" y="${ly + 3}" font-family="${SANS}" font-size="11" fill="${t.soft}">${esc(text)}</text>`;
    lx += 34 + textW(text, 11) * 0.88 + 26;
  }
  inner += `<text x="${lx}" y="${ly + 3}" font-family="${SANS}" font-size="11" fill="${t.soft}">dashed arrow = fact or view the command reads</text>`;

  const counts = ['command', 'event', 'view', 'policy'].map((k) => `${board.nodes.filter((n) => n.lane === k).length} ${k}`).join(', ');
  return wrap(Math.max(width, lx + 330), height, `${board.title} event model`, `Event Modeling board with lanes for actor, command, event, view and policy. ${counts} nodes, ${board.edges.length} links, ${board.groups.length} consistency boundaries.`, t, inner);
}

/* Places nodes in layers, left to right. Coordinates start at 0,0.
   A node outside every group but inside a group's layer span would be swallowed by the
   dashed box, so it moves past the group (if the group feeds it) or before it. */
function layoutLayered(nodes, edges, groups) {
  const LGAP = 150;
  const VGAP = 26;
  const GAP_GROUP = 44;
  const size = new Map(nodes.map((n) => [n.id, nodeSize(n, 110)]));
  const groupOf = new Map();
  groups.forEach((g, i) => g.members.forEach((id) => groupOf.set(id, i)));
  const gi = (id) => (groupOf.has(id) ? groupOf.get(id) : -1);

  const { col, back, preds, succs } = layering(nodes.map((n) => n.id), edges);
  groups.forEach((g) => {
    const cols = g.members.map((id) => col.get(id)).filter((c) => c !== undefined);
    if (!cols.length) return;
    const lo = Math.min(...cols);
    const hi = Math.max(...cols);
    const right = Math.max(...col.values()) + 1;
    let usedRight = false;
    for (const n of nodes) {
      const c = col.get(n.id);
      if (gi(n.id) !== -1 || c < lo || c > hi) continue;
      if (preds.get(n.id).some((p) => g.members.includes(p))) { col.set(n.id, right); usedRight = true; } else col.set(n.id, 0);
    }
    return usedRight;
  });

  const rightmost = (skipSide) => Math.max(0, ...nodes.filter((n) => !skipSide || n.side !== 'right').map((n) => col.get(n.id)));
  for (const n of nodes) if (n.side === 'right') col.set(n.id, rightmost(true) + 1);
  const layerCount = Math.max(...col.values()) + 1;
  const layers = Array.from({ length: layerCount }, () => []);
  nodes.forEach((n) => layers[col.get(n.id)].push(n.id));

  const pos = new Map();
  const reindex = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  reindex();
  const bary = (id, nbrs) => {
    const ps = nbrs.get(id).filter((p) => pos.has(p));
    return ps.length ? ps.reduce((s, p) => s + pos.get(p), 0) / ps.length : pos.get(id);
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let l = 1; l < layerCount; l++) { layers[l].sort((a, b) => gi(a) - gi(b) || bary(a, preds) - bary(b, preds)); reindex(); }
    for (let l = layerCount - 2; l >= 0; l--) { layers[l].sort((a, b) => gi(a) - gi(b) || bary(a, succs) - bary(b, succs)); reindex(); }
  }

  const layerW = layers.map((l) => Math.max(0, ...l.map((id) => size.get(id).w)));
  const layerH = layers.map((l) => l.reduce((s, id, i) => s + size.get(id).h + (i ? VGAP + (gi(l[i - 1]) !== gi(id) ? GAP_GROUP : 0) : 0), 0));
  const maxH = Math.max(0, ...layerH);
  const geo = new Map();
  let x = 0;
  layers.forEach((l, li) => {
    let y = (maxH - layerH[li]) / 2;
    l.forEach((id, i) => {
      const s = size.get(id);
      if (i) y += VGAP + (gi(l[i - 1]) !== gi(id) ? GAP_GROUP : 0);
      geo.set(id, { x: x + (layerW[li] - s.w) / 2, y, w: s.w, h: s.h });
      y += s.h;
    });
    x += layerW[li] + LGAP;
  });
  return { geo, back, width: x - LGAP, height: maxH };
}

/* Layered left-to-right graph. Groups are dashed boxes; with graph.stack each group is
   laid out on its own and the groups are stacked top to bottom (regions). */
function renderGraph(graph, opts = {}) {
  const t = THEMES[opts.theme] || THEMES.light;
  const M = 28;
  const nodes = graph.nodes;
  const groups = graph.groups || [];
  const GROUP_PAD_TOP = 34;
  const GROUP_PAD_BOTTOM = 18;
  const geo = new Map();
  const back = new Set();
  let width = 0;
  let height = 0;

  if (graph.stack) {
    let y = 0;
    for (const g of groups) {
      const set = new Set(g.members);
      const sub = layoutLayered(nodes.filter((n) => set.has(n.id)), graph.edges.filter((e) => set.has(e.from) && set.has(e.to)), []);
      for (const [id, r] of sub.geo) geo.set(id, { ...r, y: r.y + y + GROUP_PAD_TOP });
      sub.back.forEach((k) => back.add(k));
      width = Math.max(width, sub.width);
      y += GROUP_PAD_TOP + sub.height + GROUP_PAD_BOTTOM + 28;
    }
    height = y;
  } else {
    const l = layoutLayered(nodes, graph.edges, groups);
    l.geo.forEach((r, id) => geo.set(id, r));
    l.back.forEach((k) => back.add(k));
    width = l.width;
    height = l.height + GROUP_PAD_TOP;
  }
  const dx = M + 28;
  const dy = 96;
  for (const [id, r] of geo) geo.set(id, { ...r, x: r.x + dx, y: r.y + dy });

  let inner = `<text x="${M}" y="32" font-family="${SANS}" font-size="16" font-weight="700" fill="${t.ink}">${esc(graph.title)}</text>`;
  if (graph.subtitle) inner += `<text x="${M}" y="50" font-family="${SANS}" font-size="11" fill="${t.soft}">${esc(graph.subtitle)}</text>`;

  groups.forEach((g) => {
    const boxes = g.members.map((id) => geo.get(id)).filter(Boolean);
    if (!boxes.length) return;
    const x1 = Math.min(...boxes.map((b) => b.x)) - 20;
    const y1 = Math.min(...boxes.map((b) => b.y)) - GROUP_PAD_TOP;
    const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + 20;
    const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + GROUP_PAD_BOTTOM;
    const gt = opts.links && opts.links.get(g.id);
    let gs = `<rect x="${n1(x1)}" y="${n1(y1)}" width="${n1(x2 - x1)}" height="${n1(y2 - y1)}" rx="12" fill="${t.band}" stroke="${t.line}" stroke-width="1.3" stroke-dasharray="7 4"/>`;
    gs += `<text x="${n1(x1 + 12)}" y="${n1(y1 + 20)}" font-family="${SANS}" font-size="12" font-weight="700" fill="${t.ink}">${esc(g.label)}</text>`;
    inner += `<g class="gp"${idAttr(opts, g.id)} data-id="${esc(g.id)}">${gs}${badges(gt, { x: x1, y: y1 + 9, w: x2 - x1 }, t)}</g>`;
  });

  let bump = 0;
  for (const e of graph.edges) {
    if (!geo.has(e.from) || !geo.has(e.to)) continue;
    const isBack = back.has(`${e.from}>${e.to}`);
    inner += `<g class="ed" data-from="${esc(e.from)}" data-to="${esc(e.to)}">${edgeSvg(e, edgePath(geo.get(e.from), geo.get(e.to), isBack, isBack ? (bump += 6) : 0), t)}</g>`;
  }
  for (const n of nodes) {
    const g = geo.get(n.id);
    const nt = opts.links && opts.links.get(n.id);
    inner += `<g class="nd"${idAttr(opts, n.id)} data-id="${esc(n.id)}" data-kind="${esc(n.kind)}" data-label="${esc(n.label)}"${rangesAttr(opts.ranges && opts.ranges.get(n.id))}>${anchored(shape(n, g, t), nt)}${badges(nt, g, t)}</g>`;
  }

  const w = Math.max(dx + width + M + 28, M + (graph.subtitle ? textW(graph.subtitle, 11) * 0.82 : 0) + M);
  const h = dy + height + 60;
  return wrap(w, h, graph.title, graph.desc || `${graph.title}: ${nodes.length} elements, ${graph.edges.length} flows.`, t, inner);
}

module.exports = { renderBoard, renderGraph, THEMES };

},
function (module, exports, __r) {
'use strict';

/*
 * Layering shared by every diagram.
 *
 * Models contain real loops (a command reads a view fed by its own events, a
 * policy calls the command that triggered it). Layering needs a DAG, so edges
 * that close a loop are set aside as "back" edges: still drawn, never used to
 * place nodes. The choice is deterministic: roots are tried in the given order.
 */
function layering(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const back = new Set();
  for (const e of edges) {
    if (!out.has(e.from) || !out.has(e.to) || e.from === e.to) continue;
    // A weak edge is known feedback (a worker calling back into the API). It never places nodes.
    if (e.weak) { back.add(`${e.from}>${e.to}`); continue; }
    out.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }

  const state = new Map();
  // (back is filled above for weak edges and below for cycle-closing edges)
  const post = [];
  const visit = (id) => {
    state.set(id, 1);
    for (const next of [...out.get(id)].reverse()) {
      if (state.get(next) === 1) back.add(`${id}>${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
    post.push(id);
  };
  // Roots and children are walked in reverse so that reversing the post-order restores source order.
  for (const id of [...ids.filter((i) => indeg.get(i) === 0), ...ids].reverse()) if (!state.has(id)) visit(id);

  const topo = post.reverse();
  const forward = edges.filter((e) => e.from !== e.to && out.has(e.from) && out.has(e.to) && !back.has(`${e.from}>${e.to}`));
  const preds = new Map(ids.map((id) => [id, []]));
  const succs = new Map(ids.map((id) => [id, []]));
  for (const e of forward) { preds.get(e.to).push(e.from); succs.get(e.from).push(e.to); }

  const col = new Map();
  for (const id of topo) col.set(id, preds.get(id).reduce((m, p) => Math.max(m, col.get(p) + 1), 0));
  return { col, back, topo, preds, succs };
}

module.exports = { layering };

},
function (module, exports, __r) {
'use strict';

/* Mermaid and Graphviz DOT from the generic graph form. */

const SHAPES = {
  actor: { dot: 'ellipse', fill: '#e9eef7' },
  external: { dot: 'ellipse', fill: '#ffffff', style: 'dashed' },
  command: { dot: 'box', fill: '#ffffff' },
  process: { dot: 'box', fill: '#ffffff' },
  event: { dot: 'box', fill: '#ffd400' },
  view: { dot: 'box', fill: '#e9eef7' },
  store: { dot: 'cylinder', fill: '#e9eef7' },
  cache: { dot: 'box', fill: '#e9eef7' },
  policy: { dot: 'box', fill: '#ffffff', style: 'dashed,rounded' },
  worker: { dot: 'box', fill: '#ffffff', style: 'dashed,rounded' },
  system: { dot: 'box', fill: '#ffd400' },
};

const ids = (graph) => new Map(graph.nodes.map((n, i) => [n.id, `n${i}`]));
const q = (s) => String(s).replace(/"/g, '#quot;');

/* links: the Map from diagram/index.js, boxId -> [{ href, title }]. Mermaid and DOT can link a box once, so the first target is used. */
function toMermaid(graph, links) {
  const id = ids(graph);
  const lines = [`flowchart ${graph.direction || 'LR'}`];
  const inGroup = new Set((graph.groups || []).flatMap((g) => g.members));
  const decl = (n, pad) => `${pad}${id.get(n.id)}["${q(n.label)}${n.sub ? `<br/><i>${q(n.sub)}</i>` : ''}"]`;
  for (const n of graph.nodes) if (!inGroup.has(n.id)) lines.push(decl(n, '  '));
  (graph.groups || []).forEach((g, i) => {
    lines.push(`  subgraph g${i}["${q(g.label)}"]`);
    for (const m of g.members) { const n = graph.nodes.find((x) => x.id === m); if (n) lines.push(decl(n, '    ')); }
    lines.push('  end');
  });
  for (const e of graph.edges) {
    if (!id.has(e.from) || !id.has(e.to)) continue;
    const arrow = e.style === 'dashed' ? '-.->' : '-->';
    lines.push(`  ${id.get(e.from)} ${arrow}${e.label ? `|"${q(e.label)}"|` : ''} ${id.get(e.to)}`);
  }
  if (links) for (const n of graph.nodes) { const t = links.get(n.id); if (t && t.length) lines.push(`  click ${id.get(n.id)} href "${q(t[0].href)}" "${q(t[0].title)}"`); }
  const kinds = [...new Set(graph.nodes.map((n) => n.kind))];
  for (const k of kinds) {
    const s = SHAPES[k] || SHAPES.actor;
    lines.push(`  classDef ${k} fill:${s.fill},stroke:#0a0e1a,color:#0a0e1a${s.style && s.style.includes('dashed') ? ',stroke-dasharray:5 3' : ''}`);
    lines.push(`  class ${graph.nodes.filter((n) => n.kind === k).map((n) => id.get(n.id)).join(',')} ${k}`);
  }
  return lines.join('\n') + '\n';
}

function toDot(graph, links) {
  const id = ids(graph);
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = ['digraph eventline {', `  label="${esc(graph.title)}"; labelloc=t; fontname="Helvetica";`, `  rankdir=${graph.direction || 'LR'};`, '  node [fontname="Courier" fontsize=11];', '  edge [fontname="Helvetica" fontsize=9];'];
  const inGroup = new Set((graph.groups || []).flatMap((g) => g.members));
  const decl = (n, pad) => {
    const s = SHAPES[n.kind] || SHAPES.actor;
    const style = `filled${s.style ? ',' + s.style : ''}`;
    const t = links && links.get(n.id);
    const url = t && t.length ? ` URL="${esc(t[0].href)}" tooltip="${esc(t[0].title)}"` : '';
    return `${pad}${id.get(n.id)} [label="${esc(n.label)}${n.sub ? `\\n${esc(n.sub)}` : ''}" shape=${s.dot} style="${style}" fillcolor="${s.fill}"${url}];`;
  };
  for (const n of graph.nodes) if (!inGroup.has(n.id)) lines.push(decl(n, '  '));
  (graph.groups || []).forEach((g, i) => {
    lines.push(`  subgraph cluster_${i} { label="${esc(g.label)}"; style=dashed;`);
    for (const m of g.members) { const n = graph.nodes.find((x) => x.id === m); if (n) lines.push(decl(n, '    ')); }
    lines.push('  }');
  });
  for (const e of graph.edges) {
    if (!id.has(e.from) || !id.has(e.to)) continue;
    const attrs = [e.label ? `label="${esc(e.label)}"` : '', e.style === 'dashed' ? 'style=dashed' : ''].filter(Boolean).join(' ');
    lines.push(`  ${id.get(e.from)} -> ${id.get(e.to)}${attrs ? ` [${attrs}]` : ''};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

module.exports = { toMermaid, toDot };

}
];
var cache = [];
function __r(i) {
  if (cache[i]) return cache[i].exports;
  var m = cache[i] = { exports: {} };
  defs[i].call(m.exports, m, m.exports, __r);
  return m.exports;
}
window.eventline = __r(0);
})();
