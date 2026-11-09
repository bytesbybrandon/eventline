'use strict';

const { RULES, BY_ID, CATEGORIES, PROFILES } = require('./catalogue');
const { coreIssues } = require('./core');
const { scheduleIssues, eventmodelingIssues, slicermIssues, sliceOf } = require('./profile');

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

/*
 * What is wrong with a model. profile is core (default), eventmodeling or slicerm; each includes the one before.
 * Every finding says what kind of problem it is, which statement it belongs to, and where that statement ends.
 */
function check(model, opts = {}) {
  const profile = opts.profile || 'core';
  if (!PROFILES.includes(profile)) throw new Error(`Unknown profile "${profile}". Choose one of: ${PROFILES.join(', ')}`);
  const found = [...coreIssues(model), ...scheduleIssues(model)];
  if (profile !== 'core') found.push(...eventmodelingIssues(model));
  if (profile === 'slicerm') found.push(...slicermIssues(model));
  const list = statements(model);
  return found.map((f) => enrich(f, list, profile));
}

module.exports = { check, RULES, CATEGORIES, PROFILES };
