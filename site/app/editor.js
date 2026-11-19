/* Autocomplete popup and editing help for the editor textarea. Suggestions come from EventlineComplete and edits from
   EventlineEditing; this only shows and applies them. */
(function (root) {
  'use strict';

  var COPY = ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom'];
  var uid = 0;

  function attach(textarea, getModel) {
    var complete = root.EventlineComplete;
    var editing = root.EventlineEditing;
    var host = textarea.parentNode; // .pg__code, position: relative
    var id = 'ed-pop-' + (++uid);
    var pop = document.createElement('ul');
    pop.id = id; pop.className = 'ap-pop'; pop.setAttribute('role', 'listbox'); pop.hidden = true;
    var probe = document.createElement('div');
    probe.className = 'ap-probe'; probe.setAttribute('aria-hidden', 'true');
    var boxes = [0, 1].map(function () {
      var b = document.createElement('div');
      b.className = 'ap-match'; b.setAttribute('aria-hidden', 'true'); b.hidden = true;
      return b;
    });
    host.append(pop, probe, boxes[0], boxes[1]);
    textarea.setAttribute('role', 'combobox');
    textarea.setAttribute('aria-autocomplete', 'list');
    textarea.setAttribute('aria-controls', id);
    textarea.setAttribute('aria-expanded', 'false');

    var names = [];   // from the last parse that worked
    var result = null, active = 0, inserting = false;
    var escAt = 0;    // when Esc was pressed with the popup closed; a Tab soon after leaves the editor

    function close() {
      result = null; pop.hidden = true; pop.replaceChildren();
      textarea.setAttribute('aria-expanded', 'false');
      textarea.removeAttribute('aria-activedescendant');
    }

    // Lays out the text up to `at` in the hidden probe and returns where `ch` lands there. The probe is emptied after.
    function measure(at, ch) {
      var cs = getComputedStyle(textarea);
      COPY.forEach(function (p) { probe.style[p] = cs[p]; });
      probe.style.width = textarea.clientWidth + 'px';
      probe.textContent = textarea.value.slice(0, at);
      var mark = document.createElement('span');
      mark.textContent = ch;
      probe.append(mark);
      var box = { offsetLeft: mark.offsetLeft, offsetTop: mark.offsetTop, offsetWidth: mark.offsetWidth, offsetHeight: mark.offsetHeight };
      probe.textContent = '';
      return box;
    }

    function place() {
      var mark = measure(result.from, '​');
      var lh = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
      var x = mark.offsetLeft - textarea.scrollLeft;
      var y = mark.offsetTop - textarea.scrollTop + lh;
      var w = pop.offsetWidth, h = pop.offsetHeight;
      var maxX = host.clientWidth - w - 4, maxY = host.clientHeight - h - 4;
      if (y > maxY) y = mark.offsetTop - textarea.scrollTop - h; // no room below: open above the line
      pop.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
      pop.style.top = Math.max(4, Math.min(y, maxY)) + 'px';
    }

    function paint() {
      pop.replaceChildren();
      result.items.forEach(function (it, i) {
        var li = document.createElement('li');
        li.id = id + '-' + i; li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        var kind = document.createElement('span');
        kind.className = 'ap-pop__kind'; kind.textContent = it.kind;
        li.append(it.label, kind);
        li.addEventListener('mousedown', function (ev) { ev.preventDefault(); accept(i); });
        pop.append(li);
      });
      pop.hidden = false;
      textarea.setAttribute('aria-expanded', 'true');
      textarea.setAttribute('aria-activedescendant', id + '-' + active);
      place();
    }

    function open(forced) {
      if (textarea.readOnly || textarea.selectionStart !== textarea.selectionEnd) return close();
      var model = getModel();
      if (model) names = complete.namesFrom(model);
      var r = complete.suggest({ text: textarea.value, caret: textarea.selectionStart, names: names, forced: forced });
      if (!r) return close();
      result = r; active = 0; paint();
    }

    function accept(i) {
      var it = result.items[i], from = result.from, to = result.to;
      close();
      inserting = true;
      textarea.focus();
      textarea.setSelectionRange(from, to);
      document.execCommand('insertText', false, it.insert); // keeps the browser's undo stack, and fires input for the app to save
      textarea.setSelectionRange(from + it.caretOffset, from + it.caretOffset);
      inserting = false;
    }

    function move(d) {
      active = (active + d + result.items.length) % result.items.length;
      Array.prototype.forEach.call(pop.children, function (li, i) { li.setAttribute('aria-selected', String(i === active)); });
      textarea.setAttribute('aria-activedescendant', id + '-' + active);
      pop.children[active].scrollIntoView({ block: 'nearest' });
    }

    // Applies an Edit through execCommand so each one is a single step in the browser's undo history.
    function applyEdit(e) {
      inserting = true;
      textarea.setSelectionRange(e.from, e.to);
      if (e.insert !== textarea.value.slice(e.from, e.to)) {
        if (e.insert) document.execCommand('insertText', false, e.insert);
        else document.execCommand('delete');
      }
      textarea.setSelectionRange(e.selStart, e.selEnd);
      inserting = false;
      open(false); // as if the key had been typed: the popup opens if the text now calls for it
    }

    function help(ev) {
      if (textarea.readOnly || ev.ctrlKey || ev.altKey || ev.metaKey) return null;
      var t = textarea.value, s = textarea.selectionStart, e = textarea.selectionEnd;
      if (ev.key === 'Tab') return editing.onTab(t, s, e, ev.shiftKey);
      if (ev.shiftKey && (ev.key === 'Enter' || ev.key === 'Backspace')) return null;
      if (ev.key === 'Enter') return editing.onEnter(t, s, e);
      if (ev.key === 'Backspace') return editing.onBackspace(t, s, e);
      if (ev.key.length === 1 && '{[("}])'.indexOf(ev.key) >= 0) return editing.onType(t, s, e, ev.key);
      return null;
    }

    function onKey(ev) {
      if (ev.isComposing || ev.keyCode === 229) return; // an IME is using the keys
      if (ev.key === ' ' && ev.ctrlKey && !ev.altKey && !ev.metaKey) { ev.preventDefault(); return open(true); }
      if (result) {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
        else if ((ev.key === 'Tab' || ev.key === 'Enter') && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) { ev.preventDefault(); accept(active); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
        return;
      }
      if (ev.key === 'Shift') return; // Shift+Tab presses Shift first
      var escaped = Date.now() - escAt < 1500;
      escAt = ev.key === 'Escape' ? Date.now() : 0;
      if (ev.key === 'Tab' && escaped) return; // Esc then Tab: let focus leave the editor
      var e = help(ev);
      if (e) { ev.preventDefault(); applyEdit(e); }
    }

    // Outlines the bracket beside the caret and its partner. Decoration only, so screen readers skip it.
    function paintMatch() {
      var s = textarea.selectionStart;
      var m = document.activeElement === textarea && s === textarea.selectionEnd ? editing.matchBracket(textarea.value, s) : null;
      boxes.forEach(function (b, i) {
        if (!m) { b.hidden = true; return; }
        var mark = measure(m[i], textarea.value[m[i]]);
        var x = mark.offsetLeft - textarea.scrollLeft, y = mark.offsetTop - textarea.scrollTop;
        b.hidden = x < 0 || y < 0 || x + mark.offsetWidth > textarea.clientWidth || y + mark.offsetHeight > textarea.clientHeight;
        b.style.left = x + 'px'; b.style.top = y + 'px';
        b.style.width = mark.offsetWidth + 'px'; b.style.height = mark.offsetHeight + 'px';
      });
    }
    function hideMatch() { boxes.forEach(function (b) { b.hidden = true; }); }
    function onInput(ev) { if (!inserting && !ev.isComposing) open(false); }
    function onScroll() { if (result) place(); paintMatch(); } // typing near an edge scrolls the box; follow it
    function onMove(ev) { if (result && /^(Arrow(Left|Right)|Home|End|PageUp|PageDown)$/.test(ev.key)) close(); }

    textarea.addEventListener('keydown', onKey);
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keyup', onMove);
    textarea.addEventListener('blur', close);
    textarea.addEventListener('mousedown', close);
    textarea.addEventListener('scroll', onScroll);
    textarea.addEventListener('compositionstart', close);
    var MATCH_ON = ['keyup', 'mouseup', 'input', 'focus', 'select'];
    MATCH_ON.forEach(function (t) { textarea.addEventListener(t, paintMatch); });
    textarea.addEventListener('blur', hideMatch);
    pop.addEventListener('mousedown', function (ev) { ev.preventDefault(); }); // a click on the popup's scrollbar keeps focus

    return {
      destroy: function () {
        close();
        ['keydown', 'input', 'keyup', 'blur', 'mousedown', 'scroll', 'compositionstart'].forEach(function (t, i) {
          textarea.removeEventListener(t, [onKey, onInput, onMove, close, close, onScroll, close][i]);
        });
        MATCH_ON.forEach(function (t) { textarea.removeEventListener(t, paintMatch); });
        textarea.removeEventListener('blur', hideMatch);
        ['role', 'aria-autocomplete', 'aria-controls', 'aria-expanded'].forEach(function (a) { textarea.removeAttribute(a); });
        pop.remove(); probe.remove(); boxes.forEach(function (b) { b.remove(); });
      },
    };
  }

  root.EventlineEditor = { attach: attach };
})(window);
