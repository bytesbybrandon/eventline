'use strict';

/* The overview shown by the home view and by `parse`. One place, so the counts agree. */
function summarize(model) {
  return {
    system: model.system ? model.system.name : null,
    counts: {
      actors: model.actors.length,
      commands: model.commands.length,
      events: model.events.size,
      views: model.views.length,
      boundaries: model.boundaries.length,
      policies: model.policies.length
    }
  };
}

function systemLines(model) {
  const s = model.system;
  if (!s) return [];
  const lines = ['system:', `  name: ${s.name}`];
  if (s.externals.length) lines.push(`  external: ${s.externals.map((e) => (e.role ? `${e.name} (${e.role})` : e.name)).join(', ')}`);
  if (s.slo.length) lines.push(`  slo: ${s.slo.join(', ')}`);
  if (s.regions.length) lines.push(`  region: ${s.regions.join(', ')}`);
  if (s.dataClassification.length) lines.push(`  data-classification: ${s.dataClassification.join(', ')}`);
  for (const c of s.constraints) lines.push(`  constraint: ${c}`);
  return lines;
}

function countLines(model) {
  const { counts } = summarize(model);
  return [`counts[6]:`, ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`)];
}

module.exports = { summarize, systemLines, countLines };
