/**
 * info-keywords.js (M12.4) -- the Info window's keywords field.
 * Tokens, click to edit, autocomplete from existing keywords.
 * Exposes window.InfoKeywords({ keywords, onChange }), where onChange gets
 * { add: [names] } or { remove: [names] }.
 */
(function () {
  'use strict';
  const { h } = window.preact;
  const { useState, useEffect, useRef } = window.preactHooks;

  function KeywordsField({ keywords, onChange }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [active, setActive] = useState(-1);
    const inputRef = useRef(null);
    const doneRef = useRef(true);
    const list = keywords || [];

    useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

    useEffect(() => {
      if (!editing || !draft.trim()) { setSuggestions([]); setActive(-1); return undefined; }
      let live = true;
      const timer = setTimeout(() => {
        window.api.keywordSuggestions({ prefix: draft, limit: 6 })
          .then((r) => {
            if (!live) return;
            const have = new Set(list.map((k) => k.toLowerCase()));
            setSuggestions(((r && r.names) || []).filter((n) => !have.has(n.toLowerCase())));
            setActive(-1);
          })
          .catch(() => {});
      }, 80);
      return () => { live = false; clearTimeout(timer); };
    }, [draft, editing, list.join('\u0001')]);

    function start() {
      if (editing) return;
      doneRef.current = false;
      window.api.setInfoEditing(true).catch(() => {});
      setEditing(true);
    }
    function addWord(word) {
      const w = (word || '').trim();
      setDraft('');
      setSuggestions([]);
      setActive(-1);
      if (!w || list.some((k) => k.toLowerCase() === w.toLowerCase())) return;
      onChange({ add: [w] });
    }
    function finish(commitDraft) {
      if (doneRef.current) return;
      doneRef.current = true;
      if (commitDraft) addWord(draft);
      setDraft('');
      setSuggestions([]);
      setEditing(false);
      window.api.setInfoEditing(false).catch(() => {});
    }
    function onKeyDown(e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); return; }
      if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setActive((active + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setActive((active - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (active >= 0 && suggestions[active]) { addWord(suggestions[active]); return; }
        if (draft.trim()) { addWord(draft); return; }
        if (e.key === 'Enter') finish(false);
        return;
      }
      if (e.key === 'Backspace' && draft === '' && list.length) {
        e.preventDefault();
        onChange({ remove: [list[list.length - 1]] });
      }
    }

    if (!editing) {
      return h('div', { className: 'info-field info-kw' + (list.length ? ' has-value' : ''), onClick: start },
        list.length
          ? list.map((k) => h('span', { key: k, className: 'info-token' }, k))
          : 'Add Keywords');
    }
    return h('div', { className: 'info-field info-kw is-editing has-value' },
      list.map((k) => h('span', { key: k, className: 'info-token' }, k,
        h('button', { className: 'info-token-x', type: 'button', 'aria-label': 'Remove ' + k,
          onMouseDown: (e) => e.preventDefault(), onClick: () => onChange({ remove: [k] }) }, '\u00d7'))),
      h('input', { ref: inputRef, className: 'info-kw-input', type: 'text', value: draft, maxLength: 64,
        placeholder: list.length ? '' : 'Add Keywords',
        onInput: (e) => setDraft(e.currentTarget.value), onKeyDown, onBlur: () => finish(true) }),
      suggestions.length > 0 && h('div', { className: 'info-suggest' },
        suggestions.map((s, i) => h('div', { key: s, className: 'info-suggest-row' + (i === active ? ' is-active' : ''),
          onMouseDown: (e) => { e.preventDefault(); addWord(s); } }, s))));
  }

  window.InfoKeywords = KeywordsField;
})();
