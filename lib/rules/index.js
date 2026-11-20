'use strict';

const Model = require('../model');
const { RULES, BY_ID, CATEGORIES, PROFILES } = require('./catalogue');
const { coreIssues } = require('./core');
const { scheduleIssues, scenarioStepIssues, hotspotIssues, acceptIssues, eventmodelingIssues, slicermIssues, sliceOf } = require('./profile');

const DOCS = 'https://bytesbybrandon.github.io/eventline/docs/rules/#';

/* The statements of a model, with where each begins and ends, so a finding can say what it is about. */
/**
 * Statements with their line ranges, for attributing findings.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(S) where S = statements (derived by reading the code)
 * - Cyclomatic Complexity (CC): 7 measured; target <= 8
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 7.0 measured; threshold <= 10
 * - Caching: none
 */
function statements(model) {
  const list = [];
  const add = (kind, name, s, slice) => list.push({ kind, name, line: s.line, endLine: s.endLine || s.line, slice: slice || null });
  for (const c of model.commands) add('command', c.name, c, sliceOf(c.annotations));
  for (const v of model.views) add('view', v.name, v, sliceOf(v.annotations));
  for (const p of model.policies) add('policy', Model.policyName(p), p, sliceOf(p.annotations));
  for (const b of model.boundaries) add('boundary', b.name, b);
  for (const c of model.contexts) add('context', c.name, c);
  for (const a of model.actors) add('actor', a.name, a);
  return list.filter((s) => Number.isInteger(s.line));
}

/**
 * Adds catalogue metadata and the enclosing statement to one finding.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(S log S) per finding where S = statements (filters and sorts all statements); O(f·S log S) per check, f = findings; budget O(log S) per finding (derived by reading the code)
 * - Cyclomatic Complexity (CC): 11 measured; target <= 8, over budget
 * - Branch Coverage: 95% measured; target >= 90%
 * - CRAP Score: 11.0 measured; threshold <= 10, over budget
 * - Caching: none
 */
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
/**
 * Marks findings covered by @accept and reports unused accepts.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(S + f + u·S) where S = statements, f = findings, u = unused accepts (derived by reading the code)
 * - Cyclomatic Complexity (CC): 16 measured; target <= 8, over budget
 * - Branch Coverage: 83% measured; target >= 90%
 * - CRAP Score: 17.2 measured; threshold <= 10, over budget
 * - Caching: none
 */
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
/**
 * Runs every rule for a profile and returns the findings.
 *
 * # Performance & Risk Budget
 * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
 * - Complexity: O(c² + f·S log S + L) where c = commands, v = read models, p = policies, e = distinct events, f = findings, S = statements, L = linkIssues cost (it builds all six diagrams, dominated by deployment, see lib/diagram/system.js); budget O(model size) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 9 measured; target <= 8, over budget
 * - Branch Coverage: 100% measured; target >= 90%
 * - CRAP Score: 9.0 measured; threshold <= 10
 * - Caching: none
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
