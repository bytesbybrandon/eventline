/* Editing help for the model editor: indentation, Tab, bracket pairs and bracket matching.
   Each function returns an Edit { from, to, insert, selStart, selEnd } for the editor to apply, or null to let the browser act. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventlineEditing = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var INDENT = '  ';
  var CLOSE = { '{': '}', '[': ']', '(': ')', '"': '"' };
  var OPEN = { '}': '{', ']': '[', ')': '(' };

  function lineStart(text, p) { return text.lastIndexOf('\n', p - 1) + 1; }
  function lineEnd(text, p) { var i = text.indexOf('\n', p); return i < 0 ? text.length : i; }
  // Same rule as suggest() in complete.js: after `//` on the line is a comment, after an odd number of `"` is a string.
  function plain(prefix) { return prefix.indexOf('//') < 0 && (prefix.split('"').length - 1) % 2 === 0; }
  function isCode(text, p) { return plain(text.slice(lineStart(text, p), p)); }
  function edit(from, to, insert, selStart, selEnd) {
    return { from: from, to: to, insert: insert, selStart: selStart, selEnd: selEnd === undefined ? selStart : selEnd };
  }

  /**
   * The edit for Enter: keep indent, open a block.
   *
   * # Performance & Risk Budget
   * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
   * - Complexity: O(L) where L = length of the caret line (derived by reading the code)
   * - Cyclomatic Complexity (CC): 5 measured; target <= 8
   * - Branch Coverage: 100% measured; target >= 90%
   * - CRAP Score: 5.0 measured; threshold <= 10
   * - Caching: none
   */
  function onEnter(text, s, e) {
    var ls = lineStart(text, s);
    var before = text.slice(ls, s);
    var indent = /^[ \t]*/.exec(before)[0];
    var trimmed = before.replace(/\s+$/, '');
    var last = trimmed[trimmed.length - 1];
    var opens = (last === '{' || last === '[') && isCode(text, ls + trimmed.length - 1);
    if (!opens) return edit(s, e, '\n' + indent, s + 1 + indent.length);
    var inner = '\n' + indent + INDENT;
    if (text[e] === CLOSE[last]) return edit(s, e, inner + '\n' + indent, s + inner.length);
    return edit(s, e, inner, s + inner.length);
  }

  /**
   * The edit for Tab and Shift+Tab over the selected lines.
   *
   * # Performance & Risk Budget
   * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
   * - Complexity: O(z) where z = characters in the selected lines (derived by reading the code)
   * - Cyclomatic Complexity (CC): 6 measured; target <= 8
   * - Branch Coverage: 100% measured; target >= 90%
   * - CRAP Score: 6.0 measured; threshold <= 10
   * - Caching: none
   */
  function onTab(text, s, e, shift) {
    if (s === e && !shift) return edit(s, e, INDENT, s + INDENT.length);
    var from = lineStart(text, s);
    var lastLine = e > s && text[e - 1] === '\n' ? e - 1 : e; // a selection ending at a line start leaves that line alone
    var to = lineEnd(text, lastLine);
    var deltas = [];
    var insert = text.slice(from, to).split('\n').map(function (line) {
      if (!shift) { deltas.push(INDENT.length); return INDENT + line; }
      var cut = /^ {0,2}/.exec(line)[0].length;
      deltas.push(-cut);
      return line.slice(cut);
    }).join('\n');
    var total = deltas.reduce(function (a, b) { return a + b; }, 0);
    var selStart = Math.max(from, s + deltas[0]);
    return edit(from, to, insert, selStart, s === e ? selStart : Math.max(selStart, e + total));
  }

  /**
   * The edit for a typed bracket or quote.
   *
   * # Performance & Risk Budget
   * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
   * - Complexity: O(L + z) where L = length of the caret line, z = selection length (derived by reading the code)
   * - Cyclomatic Complexity (CC): 16 measured; target <= 8, over budget
   * - Branch Coverage: 86% measured; target >= 90%
   * - CRAP Score: 16.6 measured; threshold <= 10, over budget
   * - Caching: none
   */
  function onType(text, s, e, ch) {
    var ls = lineStart(text, s);
    var prefix = text.slice(ls, s);
    if (ch === '"' && s === e && text[s] === '"' && prefix.indexOf('//') < 0 && !plain(prefix)) return edit(s, s, '', s + 1); // step over the closing quote
    if (!plain(prefix)) return null;
    if (OPEN[ch]) {
      if (s === e && text[s] === ch) return edit(s, s, '', s + 1);
      if (ch !== ')' && s === e && /^[ \t]*$/.test(prefix)) {
        var indent = prefix.length >= INDENT.length ? prefix.slice(0, prefix.length - INDENT.length) : '';
        return edit(ls, s, indent + ch, ls + indent.length + 1);
      }
      return null;
    }
    if (!CLOSE[ch]) return null;
    if (s !== e) return edit(s, e, ch + text.slice(s, e) + CLOSE[ch], s + 1, e + 1);
    return edit(s, e, ch + CLOSE[ch], s + 1);
  }

  /**
   * The edit for Backspace between a bracket pair.
   *
   * # Performance & Risk Budget
   * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
   * - Complexity: O(L) where L = length of the caret line (derived by reading the code)
   * - Cyclomatic Complexity (CC): 6 measured; target <= 8
   * - Branch Coverage: 83% measured; target >= 90%
   * - CRAP Score: 6.2 measured; threshold <= 10
   * - Caching: none
   */
  function onBackspace(text, s, e) {
    if (s !== e || s === 0) return null;
    var ch = text[s - 1];
    if (!CLOSE[ch] || text[s] !== CLOSE[ch] || !isCode(text, s - 1)) return null;
    return edit(s - 1, s + 1, '', s - 1);
  }

  /**
   * The bracket matching the one at the caret.
   *
   * # Performance & Risk Budget
   * - Tier: P0 (edit loop: parse + check + board < 50 ms at 30 kB)
   * - Complexity: O(n·L) where n = characters scanned to the partner, L = line length (isCode slices the line per bracket); budget O(n) (derived by reading the code)
   * - Cyclomatic Complexity (CC): 11 measured; target <= 8, over budget
   * - Branch Coverage: 94% measured; target >= 90%
   * - CRAP Score: 11.0 measured; threshold <= 10, over budget
   * - Caching: none
   */
  function matchBracket(text, caret) {
    var at = [caret - 1, caret].filter(function (p) {
      return p >= 0 && p < text.length && (CLOSE[text[p]] || OPEN[text[p]]) && text[p] !== '"' && isCode(text, p);
    })[0];
    if (at === undefined) return null;
    var ch = text[at];
    var forward = !!CLOSE[ch];
    var partner = forward ? CLOSE[ch] : OPEN[ch];
    var step = forward ? 1 : -1;
    var depth = 0;
    for (var p = at; p >= 0 && p < text.length; p += step) {
      if (text[p] !== ch && text[p] !== partner) continue;
      if (!isCode(text, p)) continue;
      depth += text[p] === ch ? 1 : -1;
      if (depth === 0) return [at, p];
    }
    return null;
  }

  return { INDENT: INDENT, onEnter: onEnter, onTab: onTab, onType: onType, onBackspace: onBackspace, matchBracket: matchBracket };
});
