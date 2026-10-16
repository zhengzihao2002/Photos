/**
 * settings.js (M8c.6) -- Photos > Settings: the Storage tab.
 * Sizes come from the main process (measured off the main thread); each Clear
 * is confirmed there in a native dialog and returns fresh sizes.
 */
(function () {
  'use strict';
  const { h, render } = window.preact;
  const { useState, useEffect } = window.preactHooks;

  const COLORS = {
    app: '#8e8e93', library: '#34c759', thumbnails: '#0a84ff', previews: '#bf5af2',
    faceCrops: '#ff375f', webCache: '#30b0c7', logs: '#ff9f0a', other: '#c7c7cc',
  };
  const fmt = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(1) + ' MB');

  function StorageIcon() {
    return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }),
      h('path', { d: 'M3 13h18 M7 16.5h3', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
  }

  function Settings() {
    const [sizes, setSizes] = useState(null);
    const [busy, setBusy] = useState(null); // kind being cleared, or 'measure'
    const [error, setError] = useState(null);

    const load = (force) => {
      setError(null);
      return window.api.getStorage({ force })
        .then((r) => setSizes(r))
        .catch((e) => setError('Could not measure storage: ' + (e && e.message ? e.message : e)));
    };
    useEffect(() => {
      setBusy('measure');
      load(true).finally(() => setBusy(null));
      const onFocus = () => { load(false); };
      window.addEventListener('focus', onFocus);
      return () => window.removeEventListener('focus', onFocus);
    }, []);

    async function clear(kind) {
      setBusy(kind);
      setError(null);
      try {
        const r = await window.api.clearStorage(kind);
        if (r && r.ok && r.sizes) setSizes(r.sizes);
        else if (r && r.reason === 'busy') setError('Another clear is still running.');
      } catch (e) {
        setError('Clear failed: ' + (e && e.message ? e.message : e));
      } finally {
        setBusy(null);
      }
    }

    const rows = sizes ? sizes.rows : [];
    const total = sizes ? sizes.total : 0;
    const anyClearable = rows.some((r) => r.clear && r.bytes > 0);
    const status = busy === 'measure' ? 'Calculating\u2026' : busy ? 'Clearing\u2026' : (error || '');

    return h('div', null,
      h('div', { class: 'st-tabs' },
        h('button', { class: 'st-tab is-selected', type: 'button', 'aria-pressed': 'true' }, h(StorageIcon), 'Storage')),
      h('div', { class: 'st-page' },
        sizes
          ? h('div', null,
              h('div', { class: 'st-total' }, fmt(total), h('small', null, 'used by Photos')),
              sizes.freeBytes != null && h('div', { class: 'st-free' }, fmt(sizes.freeBytes) + ' available on this disk'),
              h('div', { class: 'st-bar' },
                rows.filter((r) => r.bytes > 0).map((r) => h('span', {
                  key: r.key, title: r.label + ': ' + fmt(r.bytes),
                  style: { width: (total > 0 ? (r.bytes / total) * 100 : 0) + '%', background: COLORS[r.key] || '#999' },
                }))),
              h('div', { class: 'st-rows' },
                rows.map((r) => h('div', { key: r.key, class: 'st-row' },
                  h('span', { class: 'st-dot', style: { background: COLORS[r.key] || '#999' } }),
                  h('span', { class: 'st-label' }, r.label),
                  h('span', { class: 'st-size' }, fmt(r.bytes)),
                  r.clear
                    ? h('button', { class: 'st-btn', type: 'button', disabled: !!busy || r.bytes === 0, onClick: () => clear(r.clear) }, 'Clear')
                    : h('span', { class: 'st-btn-spacer' })))))
          : h('div', { class: 'st-total' }, '\u00a0'),
        h('div', { class: 'st-footer' },
          h('span', { class: 'st-status' }, status),
          h('button', { class: 'st-btn', type: 'button', disabled: !!busy || !anyClearable, onClick: () => clear('all') }, 'Clear All Caches'))));
  }

  render(h(Settings), document.getElementById('settings-root'));
})();
