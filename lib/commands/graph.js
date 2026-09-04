'use strict';

module.exports = {
  run(model, opts) {
    const lines = ['digraph eventline {'];
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box];');

    for (const cmd of model.commands) {
      lines.push(`  "${cmd.actor}->${cmd.name}" [label="command"];`);
      for (const g of cmd.guards) {
        for (const ev of g.events) {
          lines.push(`  "${cmd.actor}->${cmd.name}" -> "${ev}" [label="emits"];`);
        }
      }
    }

    for (const view of model.views) {
      lines.push(`  "${view.name}" [label="view"];`);
      for (const src of view.sources) {
        const name = typeof src === 'string' ? src : src.name;
        lines.push(`  "${name}" -> "${view.name}" [label="projects"];`);
      }
    }

    for (const policy of model.policies) {
      lines.push(`  "${policy.event}" [shape=ellipse];`);
      if (policy.target) {
        lines.push(`  "${policy.event}" -> "${policy.target.name}" [label="policy"];`);
      }
    }

    lines.push('}');
    console.log(lines.join('\n'));
  }
};
