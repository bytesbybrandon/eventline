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
    this.declarations = []; // event name { fields }, folded into events by finalize()
    this.events = new Map();
  }

  finalize() {
    this.events = new Map();
    const ev = (name) => {
      if (!this.events.has(name)) this.events.set(name, { name, emittedBy: [], consumedBy: [], fields: [], declared: null });
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
      const who = Model.policyLabel(pol);
      if (pol.trigger.event) {
        const t = ev(pol.trigger.event);
        t.consumedBy.push({ kind: 'policy', name: pol.trigger.event, context: pol.context });
        if (pol.trigger.fields.length > t.fields.length) t.fields = pol.trigger.fields;
      }
      for (const rule of pol.rules) {
        for (const em of rule.emits) emitted(em, { kind: 'policy', name: who, worker: rule.worker, context: pol.context });
      }
    }
    // A declaration with a field list is the event's known payload.
    for (const d of this.declarations) {
      const e = ev(d.name);
      e.declared = { fields: d.fields && d.fields.map((f) => f.name), line: d.line, context: d.context };
      if (d.fields) e.fields = d.fields;
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

  /* Events nobody emits and nobody declares: facts the model assumes (a session exists, a row exists). */
  assumedEvents() {
    return [...this.events.values()].filter((e) => e.emittedBy.length === 0 && !e.declared).map((e) => e.name);
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

/* How a policy's trigger reads: its event, its timer, or from [ReadModel, ...]. */
Model.policyLabel = (p) => p.trigger.event || p.trigger.schedule || `from [${p.from.map((f) => f.name).join(', ')}]`;

/* How messages and listings name a policy: policy <Name>, or its trigger when it has no name. */
Model.policyName = (p) => (p.name ? `policy ${p.name}` : Model.policyLabel(p));

/* Something records the event, checks it with on [...], folds it in a read model, or starts an automation from it. Scenarios and annotations don't count. */
Model.isUsed = (model, name) => {
  const e = model.events.get(name);
  return !!e && (e.emittedBy.length > 0 || e.consumedBy.length > 0);
};

module.exports = Model;
