'use strict';

class Model {
  constructor() {
    this.system = null;
    this.actors = [];
    this.boundaries = [];
    this.views = [];
    this.commands = [];
    this.policies = [];
    this.events = new Set();
    this.errors = [];
  }

  addEvent(name) {
    if (name && !this.events.has(name)) {
      this.events.add(name);
    }
  }

  collectEvents(arr) {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (typeof item === 'string') {
        this.addEvent(item);
      } else if (item && typeof item === 'object') {
        this.addEvent(item.name);
      }
    }
  }
}

module.exports = Model;
