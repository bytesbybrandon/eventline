(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventlineComplete = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX = 8;

  function snip(label, insert, caret) {
    return { label: label, kind: 'snippet', insert: insert, caretOffset: caret };
  }
  // caret is the index of the "|" marker in the brief's table
  var SNIPPETS = [
    snip('system', 'system  {\n  slo: 99.9% uptime\n}', 7),
    snip('actor', 'actor  { auth: session }', 6),
    snip('boundary', 'boundary (id) @partition(shardKey="id")', 9),
    snip('readmodel', 'readmodel (id) = [event-name*(id)] => {\n  total: count(event-name*(id))\n}', 10),
    snip('view', 'view (id) = [event-name*(id)] => {\n  total: count(event-name*(id))\n}', 5),
    snip('context', 'context  {\n}', 8),
    snip('scenario', 'scenario "" {\n}', 10),
    snip('command', 'Actor -> (id) in Boundary(id)\non [fact-name(id)]\n  --[default]--> [\n    event-name { id }\n  ]', 9),
    snip('policy', 'policy Name = event-name { id }\n  -> worker-name -> nextCommand(id)', 7),
  ];

  function namesFrom(model) {
    if (!model) return [];
    var seen = {};
    var out = [];
    function add(label, kind) {
      if (seen[label]) return;
      seen[label] = true;
      out.push({ label: label, kind: kind });
    }
    if (model.events) model.events.forEach(function (_, name) { add(name, 'event'); });
    [['commands', 'command'], ['views', 'read model'], ['boundaries', 'boundary'], ['actors', 'actor']].forEach(function (p) {
      (model[p[0]] || []).forEach(function (x) { add(x.name, p[1]); });
    });
    return out;
  }

  function byLabel(a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; }

  function suggest(o) {
    var text = o.text, caret = o.caret;
    var lineStart = text.lastIndexOf('\n', caret - 1) + 1;
    var line = text.slice(lineStart, caret);
    // shortcut: comments are only `//`, strings only `"`; extend if the grammar grows
    if (line.indexOf('//') >= 0 || (line.split('"').length - 1) % 2) return null;
    var from = caret;
    while (from > 0 && /[A-Za-z0-9_-]/.test(text[from - 1])) from--;
    var word = text.slice(from, caret);
    if (word.length < 2 && !o.forced) return null;
    var w = word.toLowerCase();
    var starts = function (i) { return i.label.toLowerCase().indexOf(w) === 0; };
    var names = (o.names || []).filter(function (n) { return starts(n) && n.label !== word; })
      .sort(byLabel).map(function (n) {
        return { label: n.label, kind: n.kind, insert: n.label, caretOffset: n.label.length };
      });
    var items = names.concat(SNIPPETS.filter(starts).sort(byLabel)).slice(0, MAX);
    return items.length ? { from: from, to: caret, items: items } : null;
  }

  return { namesFrom: namesFrom, suggest: suggest, SNIPPETS: SNIPPETS };
});
