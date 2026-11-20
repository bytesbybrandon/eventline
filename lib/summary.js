'use strict';

/* The overview shown by the home page and by `parse`. One place, so the counts agree. */
/**
 * Counts per statement kind.
 *
 * # Performance & Risk Budget
 * - Tier: P1 (< 300 ms)
 * - Complexity: O(1) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 2 measured; target <= 12
 * - Branch Coverage: 100% measured; target >= 80%
 * - CRAP Score: 2.0 measured; threshold <= 15
 * - Caching: none
 */
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

/**
 * The system block as text lines.
 *
 * # Performance & Risk Budget
 * - Tier: P1 (< 300 ms)
 * - Complexity: O(x + l + g + k) where x = externals, l = SLOs, g = regions, k = constraints (derived by reading the code)
 * - Cyclomatic Complexity (CC): 7 measured; target <= 12
 * - Branch Coverage: 50% measured; target >= 80%
 * - CRAP Score: 13.1 measured; threshold <= 15
 * - Caching: none
 */
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

/**
 * The counts as text lines.
 *
 * # Performance & Risk Budget
 * - Tier: P1 (< 300 ms)
 * - Complexity: O(1) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 12
 * - Branch Coverage: 100% measured; target >= 80%
 * - CRAP Score: 1.0 measured; threshold <= 15
 * - Caching: none
 */
function countLines(model) {
  const { counts } = summarize(model);
  return [`counts[6]:`, ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`)];
}

module.exports = { summarize, systemLines, countLines };
