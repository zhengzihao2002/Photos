/* Timeline for database-only video rotations. The player owns playback and saves. */
(function () {
  const { h } = window.preact;
  const { useState, useRef, useEffect } = window.preactHooks;
  const tr = window.t;
  const snap = (n) => Math.floor(n * 10 + 0.000001) / 10;
  function timecode(n) {
    n = Math.max(0, n || 0);
    return Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0') + '.' + Math.floor(n * 10 + 0.000001) % 10;
  }

  function VideoTurnEditor({ turns, time, duration, playing, saving, error, panelRef, Icon,
    onSeek, onToggle, onAdd, onMove, onSet, onRemove, onClear, onPreview, onClose }) {
    const [selectedAt, setSelectedAt] = useState(null);
    const [dragAt, setDragAt] = useState(null);
    const [zoom, setZoom] = useState(1);
    const dragRef = useRef(null);
    const trackRef = useRef(null);
    const scrollRef = useRef(null);
    const focusMarkerRef = useRef(false);
    const limit = Math.min(86400, snap(duration));
    const clamp = (n) => snap(Math.max(0, Math.min(limit, n)));
    const selected = turns.find((p) => p.at === selectedAt);
    const points = turns.map((p) => ({ ...p, key: p.at, at: p.at === selectedAt && dragAt != null ? dragAt : p.at })).sort((a, b) => a.at - b.at);
    const pct = (at) => (duration > 0 ? Math.max(0, Math.min(100, at / duration * 100)) : 0) + '%';
    function atPointer(e) {
      const rect = trackRef.current.getBoundingClientRect();
      return clamp((e.clientX - rect.left) / Math.max(1, rect.width) * duration);
    }
    useEffect(() => () => onPreview(null), []);
    useEffect(() => {
      if (!focusMarkerRef.current) return;
      const marker = trackRef.current && trackRef.current.querySelector('.vte-marker.is-selected');
      if (marker) { marker.focus(); focusMarkerRef.current = false; }
    }, [turns, selectedAt]);
    useEffect(() => {
      const el = scrollRef.current;
      if (!playing || !el || dragRef.current || !duration) return;
      const x = time / duration * trackRef.current.clientWidth;
      if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 30) el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    }, [time, playing]);

    function startDrag(e, point) {
      if (e.button !== 0 || saving) return;
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.focus();
      setSelectedAt(point.key);
      onSeek(point.at);
      dragRef.current = { from: point.key, at: point.at, startX: e.clientX, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    function drag(e) {
      const st = dragRef.current;
      if (!st) return;
      e.stopPropagation();
      if (!st.moved && Math.abs(e.clientX - st.startX) < 3) return;
      st.moved = true;
      st.at = atPointer(e);
      setDragAt(st.at);
      onPreview(turns.map((p) => p.at === st.from ? { ...p, at: st.at } : p).sort((a, b) => a.at - b.at));
      onSeek(st.at);
    }
    async function endDrag(e, cancel) {
      const st = dragRef.current;
      if (!st) return;
      e.stopPropagation();
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (!cancel && st.moved && st.at !== st.from) {
        const ok = await onMove(st.from, st.at);
        focusMarkerRef.current = ok;
        setSelectedAt(ok ? st.at : st.from);
        if (!ok) onSeek(st.from);
      } else if (cancel) onSeek(st.from);
      setDragAt(null); onPreview(null);
    }
    async function moveSelected(to) {
      if (!selected || !Number.isFinite(to)) return;
      const at = clamp(to);
      if (await onMove(selected.at, at)) { setSelectedAt(at); onSeek(at); }
    }
    async function add(delta) {
      const at = clamp(time);
      onSeek(at);
      if (await onAdd(delta)) setSelectedAt(at);
    }
    async function remove(at) {
      if (await onRemove(at)) { setSelectedAt(null); trackRef.current.focus(); }
    }
    const segments = [{ at: 0, turn: 0 }, ...points];
    const ticks = Array.from({ length: 9 }, (_, i) => duration * i / 8);
    return h('section', { className: 'vte', ref: panelRef, 'aria-label': tr('viewer.turnEditor.title'),
      onKeyDown: (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        if (e.key === ' ' && !/^(INPUT|SELECT|BUTTON)$/.test(e.target.tagName)) { e.preventDefault(); onToggle(); }
      } },
      h('div', { className: 'vte-heading' },
        h('strong', null, tr('viewer.turnEditor.title')),
        h('span', { className: 'vte-help' }, tr('viewer.turnEditor.help')),
        h('span', { className: 'vte-save', role: 'status' }, saving ? tr('viewer.turnEditor.saving') : error ? '' : tr('viewer.turnEditor.saved'))),
      h('div', { className: 'vte-tools' },
        h('button', { className: 'vte-btn vte-play', type: 'button', onClick: onToggle, 'aria-label': tr(playing ? 'viewer.pause' : 'viewer.play') }, h(Icon, { name: playing ? 'pause' : 'play', size: 16 })),
        h('span', { className: 'vte-time' }, timecode(time), h('span', null, ' / ' + timecode(duration))),
        h('button', { className: 'vte-btn', type: 'button', disabled: !duration || saving, onClick: () => add(-90) }, h(Icon, { name: 'turnLeft', size: 17 }), tr('viewer.turnEditor.addLeft')),
        h('button', { className: 'vte-btn', type: 'button', disabled: !duration || saving, onClick: () => add(90) }, h(Icon, { name: 'turnRight', size: 17 }), tr('viewer.turnEditor.addRight')),
        h('label', { className: 'vte-zoom' }, tr('viewer.turnEditor.zoom'),
          h('input', { type: 'range', min: 1, max: 8, step: 0.5, value: zoom, 'aria-label': tr('viewer.turnEditor.zoom'), onInput: (e) => setZoom(Number(e.currentTarget.value)) }))),
      h('div', { className: 'vte-scroll', ref: scrollRef },
        h('div', { className: 'vte-track', ref: trackRef, style: { width: zoom * 100 + '%' }, role: 'group', tabIndex: 0,
          'aria-label': tr('viewer.turnEditor.timeline'),
          onKeyDown: (e) => {
            if (e.target !== e.currentTarget) return;
            const delta = e.shiftKey ? 1 : 0.1;
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
              e.preventDefault(); onSeek(e.key === 'Home' ? 0 : e.key === 'End' ? limit : clamp(time + (e.key === 'ArrowRight' ? delta : -delta)));
            }
          },
          onPointerDown: (e) => {
            if (e.button !== 0 || !duration || dragRef.current) return;
            e.preventDefault(); e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId); onSeek(atPointer(e));
          },
          onPointerMove: (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId) && !dragRef.current) onSeek(atPointer(e)); },
          onPointerUp: (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); } },
          h('div', { className: 'vte-ruler', 'aria-hidden': 'true' }, ticks.map((at, i) => h('span', { key: i, style: { left: pct(at) } }, timecode(at)))),
          h('div', { className: 'vte-lane', 'aria-hidden': 'true' }, segments.map((p, i) => {
            const end = i + 1 < segments.length ? segments[i + 1].at : duration;
            if (end <= p.at) return null;
            return h('div', { key: i, className: 'vte-segment' + (p.turn ? ' is-turned' : ''), style: { left: pct(p.at), width: pct(end - p.at) } },
              h('span', null, p.turn ? p.turn + '°' : tr('viewer.turnEditor.original')));
          })),
          points.map((p) => h('button', { key: p.key, type: 'button', className: 'vte-marker' + (selectedAt === p.key ? ' is-selected' : ''), style: { left: pct(p.at) }, disabled: !!saving,
            'aria-label': tr('viewer.turnEditor.marker', { angle: p.turn, time: timecode(p.at) }), 'aria-pressed': selectedAt === p.key, title: tr('viewer.turnEditor.marker', { angle: p.turn, time: timecode(p.at) }),
            onPointerDown: (e) => startDrag(e, p), onPointerMove: drag,
            onPointerUp: (e) => endDrag(e, false), onPointerCancel: (e) => endDrag(e, true), onLostPointerCapture: (e) => endDrag(e, true),
            onClick: (e) => { e.stopPropagation(); if (!dragRef.current) { setSelectedAt(p.key); onSeek(p.at); } },
            onKeyDown: (e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault(); e.stopPropagation();
                const to = clamp(p.at + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
                onMove(p.key, to).then((ok) => { if (ok) { focusMarkerRef.current = true; setSelectedAt(to); onSeek(to); } });
              } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(p.key); }
            } }, h('span', { className: 'vte-diamond' }), h('span', { className: 'vte-marker-line' }))),
          h('div', { className: 'vte-playhead', 'aria-hidden': 'true', style: { left: pct(time) } }, h('span')))),
      h('div', { className: 'vte-inspector' },
        h('span', { className: 'vte-selection' }, selected ? tr('viewer.turnEditor.selected') : tr('viewer.turnEditor.select')),
        h('label', null, tr('viewer.turnEditor.time'), h('input', { type: 'number', min: 0, max: limit, step: 0.1, disabled: !selected || saving,
          value: selected ? (dragAt != null ? dragAt : selected.at).toFixed(1) : '', 'aria-label': tr('viewer.turnEditor.time'),
          onChange: (e) => { if (e.currentTarget.value !== '') moveSelected(Number(e.currentTarget.value)); },
          onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); } })),
        h('label', null, tr('viewer.turnEditor.angle'), h('select', { disabled: !selected || saving, value: selected ? selected.turn : 0, 'aria-label': tr('viewer.turnEditor.angle'),
          onChange: (e) => { if (selected) onSet(selected.at, Number(e.currentTarget.value)); } }, [0, 90, 180, 270].map((angle) => h('option', { key: angle, value: angle }, angle + '°')))),
        h('button', { className: 'vte-btn', type: 'button', disabled: !selected || saving, onClick: () => selected && remove(selected.at) }, tr('viewer.turnEditor.remove')),
        h('span', { className: 'vte-count' }, tr('viewer.turnEditor.count', { count: turns.length })),
        h('button', { className: 'vte-btn vte-reset', type: 'button', disabled: !turns.length || saving, onClick: async () => { if (await onClear()) setSelectedAt(null); } }, tr('viewer.turnEditor.clear'))),
      error && h('div', { className: 'vte-error', role: 'alert' }, error));
  }
  window.PhotosVideoTurnEditor = VideoTurnEditor;
})();
