'use strict';

/*
 * The parsed model plus the indexes every command and diagram needs.
 * The parser fills the arrays; finalize() derives the rest, so no command
 * has to re-walk the statements to answer "who emits this event?".
 */
class Model {
  constructor() {
    this.system = null;
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
      for (const fact of cmd.on) ev(fact.name).consumedBy.push({ kind: 'command', name: cmd.name });
      for (const br of cmd.branches) {
        for (const em of br.emits) emitted(em, { kind: 'command', name: cmd.name, branch: br.default ? 'default' : br.guard });
      }
    }
    for (const view of this.views) {
      for (const src of view.sources) ev(src.name).consumedBy.push({ kind: 'view', name: view.name });
    }
    for (const pol of this.policies) {
      const t = ev(pol.trigger.event);
      t.consumedBy.push({ kind: 'policy', name: pol.trigger.event });
      if (pol.trigger.fields.length > t.fields.length) t.fields = pol.trigger.fields;
      for (const rule of pol.rules) {
        for (const em of rule.emits) emitted(em, { kind: 'policy', name: pol.trigger.event, worker: rule.worker });
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
