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
  const fmt = (b) => (b >= 1e9 ? t('size.gb', { value: window.i18n.number(b / 1e9, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
    : t('size.mb', { value: window.i18n.number(b / 1e6, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
  document.title = t('window.settings');

  function StorageIcon() {
    return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }),
      h('path', { d: 'M3 13h18 M7 16.5h3', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
  }

  function UpdatesIcon() {
    return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      h('path', { d: 'M12 4v10 M7.5 10l4.5 4.5 4.5-4.5 M5 19h14', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }

  function AppearanceIcon() {
    return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      h('path', { d: 'M3 19L9 5l6 14 M5 14h8 M16 19l3-8 3 8 M17 16h4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }

  function Appearance() {
    const [size, setSize] = useState(window.api.getTextSize());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => window.api.onTextSizeChanged(setSize), []);
    async function choose(value) {
      setSaving(true); setError('');
      try { const config = await window.api.updateConfig({ patch: { textSize: value } }); setSize(config.textSize); }
      catch (err) { setError(t('settings.appearance.error')); }
      finally { setSaving(false); }
    }
    const labels = {
      small: t('settings.textSize.small'), default: t('settings.textSize.default'),
      large: t('settings.textSize.large'), 'extra-large': t('settings.textSize.extraLarge'),
    };
    return h('div', { class: 'st-page st-appearance' },
      h('h2', null, t('settings.textSize.title')),
      h('p', { class: 'st-appearance-note' }, t('settings.textSize.hint')),
      h('div', { class: 'st-text-sizes', role: 'group', 'aria-label': t('settings.textSize.title') },
        Object.entries(labels).map(([value, label]) => h('button', { key: value, type: 'button', class: 'st-text-size' + (size === value ? ' is-selected' : ''),
          'aria-pressed': size === value, disabled: saving, onClick: () => choose(value) },
          h('span', { class: 'st-text-size-sample', style: { fontSize: 20 * window.PhotosTextSize.factors[value] + 'px' }, 'aria-hidden': 'true' }, 'Aa'),
          h('span', null, label)))),
      h('div', { class: 'st-text-preview' }, h('strong', null, t('settings.textSize.previewTitle')), h('p', null, t('settings.textSize.previewBody'))),
      error && h('div', { role: 'alert', class: 'st-appearance-error' }, error));
  }

  // Updates tab: runs only when asked. Check -> Update and Restart (download, verify, swap, reopen).
  function Updates({ active }) {
    const [st, setSt] = useState({ phase: 'idle', current: '', latest: null, percent: 0, error: null });
    useEffect(() => {
      window.api.getUpdaterState().then(setSt, () => {});
      const off = window.api.onUpdaterState(setSt);
      return off;
    }, []);
    useEffect(() => {
      if (!active) return undefined;
      const off = window.api.onShowUpdates(() => { window.api.checkForUpdates(); });
      if (/[?&]tab=updates/.test(location.search)) window.api.checkForUpdates();
      return off;
    }, [active]);
    const busy = st.phase === 'checking' || st.phase === 'downloading' || st.phase === 'installing';
    let line = '';
    if (st.phase === 'checking') line = t('update.checking');
    else if (st.phase === 'uptodate') line = t('update.upToDate', { version: st.current });
    else if (st.phase === 'available') line = t('update.available', { latest: st.latest, current: st.current });
    else if (st.phase === 'downloading') line = t('update.downloading', { percent: st.percent });
    else if (st.phase === 'installing') line = t('update.installing');
    else if (st.phase === 'error') line = st.error === 'notPackaged' ? t('update.notPackaged') : t('update.error', { details: st.error });
    return h('div', { class: 'st-page up-page' },
      h('div', { class: 'st-total' }, t('update.version', { version: st.current })),
      h('div', { class: 'up-line', role: 'status' }, line),
      busy && st.phase === 'downloading' && h('div', { class: 'st-bar up-bar' }, h('span', { style: { width: st.percent + '%', background: '#0a84ff' } })),
      h('div', { class: 'up-actions' },
        st.phase === 'available'
          ? h('button', { class: 'st-btn up-primary', type: 'button', onClick: () => window.api.installUpdate() }, t('update.install'))
          : h('button', { class: 'st-btn', type: 'button', disabled: busy, onClick: () => window.api.checkForUpdates() }, t('update.check')),
        st.phase === 'available' && st.notesIncomplete && h('button', { class: 'st-btn', type: 'button', onClick: () => window.api.checkForUpdates() }, t('update.check'))),
      st.releases && st.releases.length > 0 && h('section', { class: 'up-releases', 'aria-labelledby': 'up-notes-title' },
        h('h2', { id: 'up-notes-title' }, t('update.whatsNew')),
        h('div', { class: 'up-release-list', tabIndex: 0, role: 'region', 'aria-label': t('update.whatsNew') },
          st.releases.map(release => h('article', { class: 'up-release', key: release.version },
            h('h3', null, release.version),
            h('p', null, release.notes[window.i18n.getLocale()] || release.notes.en || t('update.noNotes')))))),
      st.notesIncomplete && h('div', { class: 'up-notes-error', role: 'status' }, t('update.notesIncomplete')),
      h('div', { class: 'up-note' }, t('update.note')));
  }

  function Settings() {
    const [tab, setTab] = useState(/[?&]tab=updates/.test(location.search) ? 'updates' : 'storage');
    useEffect(() => window.api.onShowUpdates(() => setTab('updates')), []);
    const [sizes, setSizes] = useState(null);
    const [busy, setBusy] = useState(null); // kind being cleared, or 'measure'
    const [error, setError] = useState(null);

    const load = (force) => {
      setError(null);
      return window.api.getStorage({ force })
        .then((r) => setSizes(r))
        .catch((e) => setError(t('settings.err.measure', { details: e && e.message ? e.message : String(e) })));
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
        else if (r && r.reason === 'busy') setError(t('settings.err.busy'));
      } catch (e) {
        setError(t('settings.err.clear', { details: e && e.message ? e.message : String(e) }));
      } finally {
        setBusy(null);
      }
    }

    const rows = sizes ? sizes.rows : [];
    const total = sizes ? sizes.total : 0;
    const anyClearable = rows.some((r) => r.clear && r.bytes > 0);
    const status = busy === 'measure' ? t('settings.calculating') : busy ? t('settings.clearing') : (error || '');

    const tabs = h('div', { class: 'st-tabs' },
      h('button', { class: 'st-tab' + (tab === 'appearance' ? ' is-selected' : ''), type: 'button', 'aria-pressed': tab === 'appearance' ? 'true' : 'false', onClick: () => setTab('appearance') }, h(AppearanceIcon), t('settings.tab.appearance')),
      h('button', { class: 'st-tab' + (tab === 'storage' ? ' is-selected' : ''), type: 'button', 'aria-pressed': tab === 'storage' ? 'true' : 'false', onClick: () => setTab('storage') }, h(StorageIcon), t('settings.tab.storage')),
      h('button', { class: 'st-tab' + (tab === 'updates' ? ' is-selected' : ''), type: 'button', 'aria-pressed': tab === 'updates' ? 'true' : 'false', onClick: () => setTab('updates') }, h(UpdatesIcon), t('settings.tab.updates')));
    if (tab === 'updates') return h('div', { class: 'st-with-updates' }, tabs, h(Updates, { active: true }));
    if (tab === 'appearance') return h('div', null, tabs, h(Appearance));

    return h('div', null,
      tabs,
      h('div', { class: 'st-page' },
        sizes
          ? h('div', null,
              h('div', { class: 'st-total' }, fmt(total), h('small', null, t('settings.usedByPhotos'))),
              sizes.freeBytes != null && h('div', { class: 'st-free' }, t('settings.available', { size: fmt(sizes.freeBytes) })),
              h('div', { class: 'st-bar' },
                rows.filter((r) => r.bytes > 0).map((r) => h('span', {
                  key: r.key, title: t('storage.row.' + r.key) + ': ' + fmt(r.bytes),
                  style: { width: (total > 0 ? (r.bytes / total) * 100 : 0) + '%', background: COLORS[r.key] || '#999' },
                }))),
              h('div', { class: 'st-rows' },
                rows.map((r) => h('div', { key: r.key, class: 'st-row' },
                  h('span', { class: 'st-dot', style: { background: COLORS[r.key] || '#999' } }),
                  h('span', { class: 'st-label' }, t('storage.row.' + r.key)),
                  h('span', { class: 'st-size' }, fmt(r.bytes)),
                  r.clear
                    ? h('button', { class: 'st-btn', type: 'button', disabled: !!busy || r.bytes === 0, onClick: () => clear(r.clear) }, t('settings.clear'))
                    : h('span', { class: 'st-btn-spacer' })))))
          : h('div', { class: 'st-total' }, '\u00a0'),
        h('div', { class: 'st-footer' },
          h('span', { class: 'st-status' }, status),
          h('button', { class: 'st-btn', type: 'button', disabled: !!busy || !anyClearable, onClick: () => clear('all') }, t('settings.clearAll')))));
  }

  render(h(Settings), document.getElementById('settings-root'));
})();
