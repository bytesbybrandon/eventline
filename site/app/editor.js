/* Autocomplete popup for the editor textarea. Suggestions come from EventlineComplete; this only shows and inserts them. */
(function (root) {
  'use strict';

  var COPY = ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom'];
  var uid = 0;

  function attach(textarea, getModel) {
    var complete = root.EventlineComplete;
    var host = textarea.parentNode; // .pg__code, position: relative
    var id = 'ed-pop-' + (++uid);
    var pop = document.createElement('ul');
    pop.id = id; pop.className = 'ap-pop'; pop.setAttribute('role', 'listbox'); pop.hidden = true;
    var probe = document.createElement('div');
    probe.className = 'ap-probe'; probe.setAttribute('aria-hidden', 'true');
    host.append(pop, probe);
    textarea.setAttribute('role', 'combobox');
    textarea.setAttribute('aria-autocomplete', 'list');
    textarea.setAttribute('aria-controls', id);
    textarea.setAttribute('aria-expanded', 'false');

    var names = [];   // from the last parse that worked
    var result = null, active = 0, inserting = false;

    function close() {
      result = null; pop.hidden = true;
      textarea.setAttribute('aria-expanded', 'false');
      textarea.removeAttribute('aria-activedescendant');
    }

    function place() {
      var cs = getComputedStyle(textarea);
      COPY.forEach(function (p) { probe.style[p] = cs[p]; });
      probe.style.width = textarea.clientWidth + 'px';
      probe.textContent = textarea.value.slice(0, result.from);
      var mark = document.createElement('span');
      mark.textContent = '​';
      probe.append(mark);
      var lh = parseFloat(cs.lineHeight) || 20;
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

    function onKey(ev) {
      if (ev.isComposing || ev.keyCode === 229) return; // an IME is using the keys
      if (ev.key === ' ' && ev.ctrlKey && !ev.altKey && !ev.metaKey) { ev.preventDefault(); return open(true); }
      if (!result) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
      else if ((ev.key === 'Tab' || ev.key === 'Enter') && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) { ev.preventDefault(); accept(active); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
    }
    function onInput(ev) { if (!inserting && !ev.isComposing) open(false); }
    function onScroll() { if (result) place(); } // typing near an edge scrolls the box; follow it
    function onMove(ev) { if (result && /^(Arrow(Left|Right)|Home|End|PageUp|PageDown)$/.test(ev.key)) close(); }

    textarea.addEventListener('keydown', onKey);
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keyup', onMove);
    textarea.addEventListener('blur', close);
    textarea.addEventListener('mousedown', close);
    textarea.addEventListener('scroll', onScroll);
    textarea.addEventListener('compositionstart', close);
    pop.addEventListener('mousedown', function (ev) { ev.preventDefault(); }); // a click on the popup's scrollbar keeps focus

    return {
      destroy: function () {
        close();
        ['keydown', 'input', 'keyup', 'blur', 'mousedown', 'scroll', 'compositionstart'].forEach(function (t, i) {
          textarea.removeEventListener(t, [onKey, onInput, onMove, close, close, onScroll, close][i]);
        });
        ['role', 'aria-autocomplete', 'aria-controls', 'aria-expanded'].forEach(function (a) { textarea.removeAttribute(a); });
        pop.remove(); probe.remove();
      },
    };
  }

  root.EventlineEditor = { attach: attach };
})(window);
