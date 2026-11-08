'use strict';

/* What does this thing read, and what reads it? Works for an event, view, command, or worker. */
module.exports = {
  run(model, opts, entity) {
    const Formatter = require('../output');
    const fmt = new Formatter(opts.format);
    const dependsOn = new Set();
    const dependedBy = new Set();
    const label = (kind, name) => `${kind}:${name}`;
    let kind = null;

    const ev = model.events.get(entity);
    if (ev) {
      kind = 'event';
      ev.emittedBy.forEach((x) => dependsOn.add(label(x.kind, x.name)));
      ev.consumedBy.forEach((x) => dependedBy.add(label(x.kind, x.name)));
    }
    const view = model.views.find((v) => v.name === entity);
    if (view) {
      kind = 'view';
      view.sources.forEach((s) => dependsOn.add(label('event', s.name)));
      for (const c of model.commands) if (c.from.some((f) => f.name === entity)) dependedBy.add(label('command', c.name));
    }
    for (const c of model.commands.filter((x) => x.name === entity)) {
      kind = 'command';
      c.on.forEach((f) => dependsOn.add(label('event', f.name)));
      c.from.forEach((f) => dependsOn.add(label('view', f.name)));
      c.branches.forEach((b) => b.emits.forEach((e) => dependedBy.add(label('event', e.event))));
    }
    for (const p of model.policies) {
      for (const r of p.rules) {
        if (r.worker !== entity) continue;
        kind = 'worker';
        if (p.trigger.event) dependsOn.add(label('event', p.trigger.event));
        else dependsOn.add(label('schedule', p.trigger.schedule));
        p.from.forEach((f) => dependsOn.add(label('view', f.name)));
        if (r.command) dependedBy.add(label('command', r.command.name));
        r.emits.forEach((e) => dependedBy.add(label('event', e.event)));
      }
    }

    console.log(fmt.formatObject('deps', {
      entity,
      kind: kind || 'unknown',
      dependsOn: [...dependsOn],
      dependedBy: [...dependedBy]
    }));
  }
};
