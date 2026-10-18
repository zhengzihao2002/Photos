/**
 * sidebar.js (M6) -- sidebar navigation.
 *
 * Own Preact root, rendered into #sidebar .sidebar-placeholder. Talks to the
 * rest of the app only through window.__PhotosStores and window.api.
 * Selection writes sectionStore (the single source of truth); filterStore is
 * a view over it. Disabled items follow the viewer.js convention:
 * aria-disabled + tooltip + no-op click (never the `disabled` attribute).
 * Media Types with 0 items are hidden. Folders section: added in B.5.
 */
(function () {
  const { h, render } = window.preact;
  const { useState, useEffect, useRef } = window.preactHooks;
  const S = window.__PhotosStores;

  // 16x16 stroke icons (SF Symbols style), drawn in currentColor.
  const ICON_PATHS = {
    library: 'M2.5 4.5h11v9h-11z M4 2.5h8 M4.5 11.5l2.5-3 2 2.2 1.5-1.7 1.5 2.5',
    video: 'M2 4.5h8v7h-8z M10 7l3.5-2v6L10 9',
    map: 'M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5z M6 2.5v9.5 M10 4v9.5',
    heart: 'M8 13.5s-5.5-3.2-5.5-7a2.8 2.8 0 0 1 5.5-.9 2.8 2.8 0 0 1 5.5.9c0 3.8-5.5 7-5.5 7z',
    trash: 'M3 4.5h10 M6.5 4.5v-2h3v2 M4.5 4.5l.7 9h5.6l.7-9 M7 7v4 M9 7v4',
    person: 'M8 2a6 6 0 1 1 0 12a6 6 0 1 1 0-12z M8 4.8a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6z M4.4 12.1a4.2 4.2 0 0 1 7.2 0', // M10
    selfie: 'M2.5 5.5v-3h3 M10.5 2.5h3v3 M13.5 10.5v3h-3 M5.5 13.5h-3v-3 M8 7.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z M5 11.5c.6-1.5 1.7-2.3 3-2.3s2.4.8 3 2.3',
    live: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z',
    panorama: 'M1.5 4.5q6.5 1.5 13 0v7q-6.5-1.5-13 0z',
    burst: 'M5 6h8.5v7.5H5z M3.25 4.25h8.5 M3.25 4.25v7.5 M1.5 2.5h8.5 M1.5 2.5v7.5',
    gif: 'M2.5 3.5h11v9h-11z M6.5 6v4l3.5-2z',
    raw: 'M2.5 3.5h11v9h-11z M5 10V6h1.5a1 1 0 0 1 0 2H5 M6.5 8l1 2 M9 6l1 4 1-4',
    duplicates: 'M5.5 5.5h8v8h-8z M2.5 10.5v-8h8',
    chevron: 'M6 4l4 4-4 4',
    album: 'M3 5.5h10a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5z M4.5 3.5h7',
    plus: 'M8 3.5v9 M3.5 8h9',
    albums: 'M2.5 6.5h11v7h-11z M3.5 4.5h9 M4.5 2.5h7',
    warning: 'M8 2.5l6 10.5H2z M8 6.5v3 M8 11.3v.2',
    sidebar: 'M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z M6 3.5v9',
  };
  function Icon({ name, className }) {
    return h('svg', { class: className || 'sb-icon', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
      h('path', { d: ICON_PATHS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }

  const NA = 'Not available: this library is read-only';
  const LIBRARY = { key: 'library', label: 'Library', icon: 'library', section: 'library' };
  // B.5: first row of Albums; opens the All Albums overview (albums.js).
  const ALL_ALBUMS_ITEM = { key: 'albums:all', label: 'All Albums', icon: 'albums', section: 'albums' };
  const PINNED = [
    { key: 'pinned:video', label: 'Videos', icon: 'video', section: 'video' },
    { key: 'pinned:map', label: 'Map', icon: 'map', section: 'map' },
    { key: 'pinned:favorites', label: 'Favorites', icon: 'heart', section: 'favorite' }, // M12.3
    { key: 'pinned:people', label: 'People', icon: 'person', section: 'people' }, // M10
    { key: 'pinned:deleted', label: 'Recently Deleted', icon: 'trash', disabled: NA },
  ];
  const MEDIA_TYPES = [
    { key: 'type:video', label: 'Videos', icon: 'video', section: 'video' },
    { key: 'type:selfie', label: 'Selfies', icon: 'selfie', section: 'selfie' },
    { key: 'type:live', label: 'Live Photos', icon: 'live', section: 'live' },
    { key: 'type:panorama', label: 'Panoramas', icon: 'panorama', section: 'panorama' },
    { key: 'type:burst', label: 'Bursts', icon: 'burst', section: 'burst' },
    { key: 'type:gif', label: 'Animated', icon: 'gif', section: 'gif' },
    { key: 'type:raw', label: 'RAW', icon: 'raw', section: 'raw' },
  ];
  // 'More' (Duplicates, disabled) was removed in B.3g: one never-clickable
  // item in its own section added clutter. Duplicates is future work.
  const ALL_ITEMS = [LIBRARY, ...PINNED, ...MEDIA_TYPES];

  function Row({ item, selected, onSelect }) {
    const disabled = Boolean(item.disabled);
    return h('div', {
      class: 'sb-row' + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : ''),
      role: 'button',
      tabIndex: disabled ? -1 : 0,
      'aria-disabled': disabled ? 'true' : undefined,
      'aria-current': selected ? 'page' : undefined,
      title: disabled ? item.disabled : undefined,
      onClick: () => onSelect(item),
      onContextMenu: item.onContextMenu,
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(item); }
      },
    }, h(Icon, { name: item.icon }), h('span', { class: 'sb-label' }, item.label), item.trailing || null);
  }

  function Section({ id, title, items, collapsed, onToggle, renderRow, action }) {
    // A section with a header action (Albums' +) shows even when empty.
    if (items.length === 0 && !action) return null;
    const isCollapsed = Boolean(collapsed[id]);
    return h('div', { class: 'sb-section' },
      h('div', { class: 'sb-header-row' },
        h('button', { class: 'sb-header', type: 'button', 'aria-expanded': String(!isCollapsed), onClick: () => onToggle(id) },
          h('span', { class: 'sb-header-title' }, title),
          h(Icon, { name: 'chevron', className: 'sb-chevron' + (isCollapsed ? '' : ' is-open') })),
        action && h('button', {
          class: 'sb-header-action', type: 'button', title: action.label, 'aria-label': action.label, onClick: action.onClick,
        }, h(Icon, { name: action.icon, className: 'sb-header-action-icon' }))),
      isCollapsed ? null : h('div', { class: 'sb-items' }, items.map(renderRow)));
  }

  function Sidebar() {
    const [section, setSection] = useState(S.sectionStore.get());
    const [activeKey, setActiveKey] = useState('library');
    const [counts, setCounts] = useState(null);
    const [collapsed, setCollapsed] = useState({});
    const [sources, setSources] = useState([]);
    const [scanningId, setScanningId] = useState(S.scanStatusStore.get());
    useEffect(() => S.scanStatusStore.subscribe(setScanningId), []);
    useEffect(() => {
      let alive = true;
      const load = () => window.api.listSources()
        .then((rows) => { if (alive) setSources(rows || []); })
        .catch((err) => console.error('Loading albums failed:', err));
      load();
      const unsubscribe = S.libraryChangeStore.subscribe(load);
      // M8b.7: a folder going missing or returning updates the warning
      // without a library bump (which would reload every grid).
      const unsubMissing = S.missingSourcesStore ? S.missingSourcesStore.subscribe(load) : () => {};
      return () => { alive = false; unsubscribe(); unsubMissing(); };
    }, []);

    useEffect(() => S.sectionStore.subscribe(setSection), []);
    // M10.8: View > People off hides the People row.
    const [peopleOn, setPeopleOn] = useState(S.peopleEnabledStore ? S.peopleEnabledStore.get() : true);
    useEffect(() => (S.peopleEnabledStore ? S.peopleEnabledStore.subscribe(setPeopleOn) : undefined), []);
    useEffect(() => {
      let alive = true;
      const load = () => window.api.getMediaTypeCounts()
        .then((c) => { if (alive) setCounts(c); })
        .catch((err) => console.error('Media type counts failed:', err));
      load();
      const unsubscribe = S.libraryChangeStore.subscribe(load);
      return () => { alive = false; unsubscribe(); };
    }, []);

    // B.3g: restore saved state once (config + counts + sources together, so
    // the saved section is validated against live data), then save on change.
    const restoredRef = useRef(false);
    useEffect(() => {
      let alive = true;
      Promise.all([window.api.getConfig(), window.api.getMediaTypeCounts(), window.api.listSources()])
        .then(([cfg, typeCounts, sources]) => {
          if (!alive) return;
          const saved = (cfg && cfg.sidebar) || {};
          setCollapsed(saved.collapsed && typeof saved.collapsed === 'object' ? saved.collapsed : {});
          restoredRef.current = true;
          const sec = saved.section;
          const sourceMatch = /^source:(\d+)$/.exec(sec || '');
          const valid = sec === 'library' || sec === 'albums' || sec === 'map' || sec === 'people' || sec === 'favorite'
            || (MEDIA_TYPES.some((t) => t.section === sec) && typeCounts && typeCounts[sec] > 0)
            || (sourceMatch && (sources || []).some((src) => src.id === Number(sourceMatch[1])));
          // Only if the user hasn't already picked something during startup.
          if (valid && S.sectionStore.get() === 'library' && sec !== 'library') S.sectionStore.set(sec);
          // B.6h: the section is settled; the viewer may now be restored.
          window.dispatchEvent(new CustomEvent('photos:section-restored'));
        })
        .catch((err) => {
          restoredRef.current = true;
          console.error('Sidebar restore failed:', err);
          window.dispatchEvent(new CustomEvent('photos:section-restored'));
        });
      const unsubscribe = S.sectionStore.subscribe((sec) => {
        window.api.updateConfig({ patch: { sidebar: { section: sec } } })
          .catch((err) => console.error('Saving sidebar section failed:', err));
      });
      return () => { alive = false; unsubscribe(); };
    }, []);
    useEffect(() => {
      if (!restoredRef.current) return; // never overwrite saved state with the initial {}
      window.api.updateConfig({ patch: { sidebar: { collapsed } } })
        .catch((err) => console.error('Saving collapsed sections failed:', err));
    }, [collapsed]);

    // A selected Media Type that became empty (e.g. its folder was removed)
    // falls back to Library. Runs only when counts refresh, so clicking the
    // always-visible Pinned 'Videos' with 0 videos shows the empty state
    // instead of bouncing back.
    useEffect(() => {
      if (!counts) return;
      const current = S.sectionStore.get();
      if (MEDIA_TYPES.some((t) => t.section === current) && !(counts[current] > 0)) {
        S.sectionStore.set('library');
      }
    }, [counts]);

    const onSelect = (item) => {
      if (item.disabled) return;
      if (S.viewerStore.get() !== null) S.viewerStore.close();
      setActiveKey(item.key);
      // M8c.5 (K1): clicking the current section's row returns to its top page
      // (Map: closes an open Places page; People: an open person or group).
      if (S.sectionStore.get() === item.section) {
        if (S.mapAreaStore && S.mapAreaStore.get() !== null) S.mapAreaStore.set(null);
        if (S.personStore && S.personStore.get() != null) S.personStore.set(null);
        if (S.groupStore && S.groupStore.get() != null) S.groupStore.set(null);
      }
      S.sectionStore.set(item.section);
    };
    // B.5: Albums = source folders.
    const albumItems = sources.map((src) => ({
      key: 'album:' + src.id,
      label: src.displayName,
      icon: 'album',
      section: 'source:' + src.id,
      source: src,
      // B.5f: same native menu as the All Albums cards (renderer.js).
      onContextMenu: (e) => {
        e.preventDefault();
        if (window.__PhotosAlbumContextMenu) window.__PhotosAlbumContextMenu(e, src);
      },
      trailing: src.status !== 'ok'
        ? h('span', { class: 'sb-trailing sb-missing', title: 'Folder not found. Right-click to relink.' },
            h(Icon, { name: 'warning', className: 'sb-trailing-icon' }))
        : (scanningId === src.id
          ? h('span', { class: 'sb-trailing sb-spinner', title: 'Scanning\u2026', 'aria-label': 'Scanning' })
          : null),
    }));
    const albumRows = [ALL_ALBUMS_ITEM, ...albumItems];
    const allItems = [...ALL_ITEMS, ...albumRows];

    // Highlight the clicked row; if the section changed from elsewhere, the
    // first row for that section.
    const isSelected = (item) => {
      if (item.section !== section) return false;
      const activeMatches = allItems.some((i) => i.key === activeKey && i.section === section);
      return activeMatches ? item.key === activeKey : allItems.find((i) => i.section === section) === item;
    };
    const renderRow = (item) => h(Row, { key: item.key, item, selected: isSelected(item), onSelect });
    const onToggle = (id) => setCollapsed((prev) => Object.assign({}, prev, { [id]: !prev[id] }));
    const visibleTypes = counts ? MEDIA_TYPES.filter((t) => counts[t.section] > 0) : [];
    const common = { collapsed, onToggle, renderRow };

    return h('nav', { class: 'sb-nav', 'aria-label': 'Sidebar' },
      // B.4: hide toggle at the panel's top-right (absolutely positioned
      // against #sidebar, so it is outside the list's flow).
      h('button', {
        class: 'sb-toggle',
        type: 'button',
        title: 'Hide Sidebar',
        'aria-label': 'Hide Sidebar',
        onClick: () => S.sidebarVisibleStore.toggle(),
      }, h(Icon, { name: 'sidebar', className: 'sb-toggle-icon' })),
      h('div', { class: 'sb-items sb-top' }, renderRow(LIBRARY)),
      h(Section, Object.assign({ id: 'pinned', title: 'Pinned', items: peopleOn ? PINNED : PINNED.filter((x) => x.section !== 'people') }, common)),
      h(Section, Object.assign({ id: 'types', title: 'Media Types', items: visibleTypes }, common)),
      h(Section, Object.assign({ id: 'albums', title: 'Albums', items: albumRows }, common)));
  }

  /**
   * B.5g: pinned status footer at the bottom of the sidebar panel -- scan
   * progress (which folder, n of total) and the current notice (e.g. why a
   * folder could not be added). Renders nothing when there is nothing to say.
   */
  function SidebarFooter() {
    const [notice, setNotice] = useState(S.noticeStore.get());
    const [progress, setProgress] = useState(S.progressStore.get());
    const [scanningId, setScanningId] = useState(S.scanStatusStore.get());
    const [scanName, setScanName] = useState('');
    // M10: face analysis progress (face manager, same progress channel).
    const [faces, setFaces] = useState(null);
    useEffect(() => window.api.onProgress((p) => {
      if (p == null || p.taskId !== 'face-analysis') return;
      const active = p.state === 'analyzing' && p.total > 0 && p.current < p.total;
      setFaces(active ? { current: p.current, total: p.total } : null);
    }), []);
    useEffect(() => S.noticeStore.subscribe(setNotice), []);
    useEffect(() => S.progressStore.subscribe(setProgress), []);
    useEffect(() => S.scanStatusStore.subscribe(setScanningId), []);
    useEffect(() => {
      if (scanningId == null) { setScanName(''); return undefined; }
      let alive = true;
      window.api.listSources()
        .then((rows) => {
          if (!alive) return;
          const src = (rows || []).find((r) => r.id === scanningId);
          setScanName(src ? src.displayName : '');
        })
        .catch(() => {});
      return () => { alive = false; };
    }, [scanningId]);

    const scanning = scanningId != null || progress != null;
    // Shown as soon as a scan starts; after it finishes, 'Scan complete' stays
    // for COMPLETE_HOLD so even a very fast rescan visibly confirms it ran.
    const COMPLETE_HOLD = 2500;
    const [showScan, setShowScan] = useState(false);
    useEffect(() => {
      if (scanning && !showScan) { setShowScan(true); return undefined; }
      if (!scanning && showScan) {
        const timer = setTimeout(() => setShowScan(false), COMPLETE_HOLD);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [scanning, showScan]);

    if (Boolean(notice || showScan || faces) === false) return null;
    const hasTotal = scanning && !!progress && progress.total > 0;
    const pct = !scanning ? 100 : (hasTotal ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : null);

    return h('div', { class: 'sb-footer' },
      showScan && h('div', { class: 'sb-footer-scan', role: 'status' },
        h('div', { class: 'sb-footer-line' },
          h('span', { class: 'sb-footer-label' }, scanning
            ? 'Scanning' + (scanName ? ' \u201C' + scanName + '\u201D' : '') + '\u2026'
            : 'Scan complete'),
          hasTotal && h('span', { class: 'sb-footer-count' },
            progress.current.toLocaleString('en-US') + ' of ' + progress.total.toLocaleString('en-US'))),
        h('div', { class: 'sb-progress' },
          h('div', {
            class: 'sb-progress-fill' + (pct === null ? ' is-indeterminate' : ''),
            style: pct === null ? undefined : { width: pct + '%' },
          }))),
      faces && showScan === false && h('div', { class: 'sb-footer-scan', role: 'status' },
        h('div', { class: 'sb-footer-line' },
          h('span', { class: 'sb-footer-label' }, 'Analyzing faces\u2026'),
          h('span', { class: 'sb-footer-count' },
            faces.current.toLocaleString('en-US') + ' of ' + faces.total.toLocaleString('en-US'))),
        h('div', { class: 'sb-progress' },
          h('div', { class: 'sb-progress-fill', style: { width: Math.min(100, Math.round((faces.current / faces.total) * 100)) + '%' } }))),
      notice && h('div', { class: 'sb-footer-notice', role: 'status' },
        h(Icon, { name: 'warning', className: 'sb-footer-icon' }),
        h('div', { class: 'sb-footer-text' }, notice),
        h('button', {
          class: 'sb-footer-dismiss', type: 'button', title: 'Dismiss', 'aria-label': 'Dismiss',
          onClick: () => S.noticeStore.set(null),
        }, '\u00D7')));
  }

  window.addEventListener('DOMContentLoaded', () => {
    // B.5g: footer root pinned below the scrolling nav.
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) {
      const footerHost = document.createElement('div');
      footerHost.className = 'sb-footer-host';
      sidebarEl.appendChild(footerHost);
      render(h(SidebarFooter), footerHost);
    }
    const host = document.querySelector('#sidebar .sidebar-placeholder');
    if (!host) { console.error('sidebar.js: #sidebar .sidebar-placeholder not found'); return; }
    render(h(Sidebar), host);
  });
})();
