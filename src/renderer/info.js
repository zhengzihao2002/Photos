/**
 * info.js (M8c.2b) -- the Info window's page (info.html).
 *
 * Shows the item the main window reports (open photo, else grid selection),
 * laid out after Apple Photos' Info window. Asks for the current item at
 * load (bus events sent before this page existed are not replayed), then
 * follows 'info:item'. Reports its content height so the window fits it.
 * Write features (title, favourite, caption, keywords, faces, location) are
 * shown and disabled, as everywhere in this app.
 */
(function () {
  'use strict';
  const { h, render } = window.preact;
  const { useState, useEffect, useRef } = window.preactHooks;
  const F = window.InfoFormat;
  const noFocus = (e) => e.preventDefault();

  // Location map, as in Apple's Info: interactive, red pin, Legal credits.
  // One map per Info page; it recentres as the item changes.
  const WORKER_URL = 'vendor/maplibre/maplibre-gl-csp-worker.js';
  const LEGAL_FULL = '\u00A9 OpenStreetMap contributors \u00B7 \u00A9 OpenMapTiles \u00B7 OpenFreeMap \u00B7 Place names: GeoNames';
  let workerUrlSet = false;
  function addLegal(container) { // keep in step with addLegal() in places.js
    const el = document.createElement('div');
    el.className = 'info-legal';
    el.textContent = 'Legal';
    el.addEventListener('click', (ev) => { ev.stopPropagation(); el.textContent = el.textContent === 'Legal' ? LEGAL_FULL : 'Legal'; });
    container.appendChild(el);
  }
  function InfoMap({ lat, lng }) {
    const elRef = useRef(null);
    const mapRef = useRef(null);
    const pinRef = useRef(null);
    const [online, setOnline] = useState(navigator.onLine);
    useEffect(() => {
      const on = () => setOnline(true), off = () => setOnline(false);
      window.addEventListener('online', on); window.addEventListener('offline', off);
      return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    }, []);
    useEffect(() => {
      const gl = window.maplibregl, styles = window.__PhotosMapStyles;
      if (!gl || !styles || !elRef.current) return;
      if (!workerUrlSet) { gl.setWorkerUrl(WORKER_URL); workerUrlSet = true; }
      const theme = window.matchMedia('(prefers-color-scheme: dark)');
      const map = new gl.Map({ container: elRef.current, style: theme.matches ? styles.dark : styles.light,
        center: [lng, lat], zoom: 13, dragRotate: false, pitchWithRotate: false, attributionControl: false });
      map.touchZoomRotate.disableRotation();
      map.addControl(new gl.NavigationControl({ showCompass: false }), 'bottom-right');
      addLegal(elRef.current);
      elRef.current.addEventListener('click', (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest('a')) ev.preventDefault();
      }, true);
      pinRef.current = new gl.Marker({ color: '#ff3b30' }).setLngLat([lng, lat]).addTo(map);
      const onTheme = () => map.setStyle(theme.matches ? styles.dark : styles.light);
      theme.addEventListener('change', onTheme);
      map.on('error', (e) => console.warn('[info map]', e && e.error ? e.error.message : e));
      mapRef.current = map;
      return () => { theme.removeEventListener('change', onTheme); map.remove(); mapRef.current = null; };
    }, []);
    useEffect(() => {
      if (mapRef.current) mapRef.current.jumpTo({ center: [lng, lat], zoom: 13 });
      if (pinRef.current) pinRef.current.setLngLat([lng, lat]);
    }, [lat, lng]);
    return h('div', { className: 'info-map' },
      h('div', { ref: elRef, className: 'info-map-canvas' }),
      !online && h('div', { className: 'info-map-offline' }, 'Map unavailable offline'));
  }

  // M12.4: click-to-edit text. Return commits (Shift+Return = new line when multiline),
  // Esc cancels, blur commits; an unchanged value sends nothing.
  function EditableField({ className, value, placeholder, multiline, onCommit }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const doneRef = useRef(false);
    const inputRef = useRef(null);
    useEffect(() => { setEditing(false); }, [value]);
    useEffect(() => {
      const el = inputRef.current;
      if (!editing || !el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, [editing]);
    useEffect(() => {
      const el = inputRef.current;
      if (editing && multiline && el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
    }, [editing, draft, multiline]);
    function start() { doneRef.current = false; setDraft(value || ''); window.api.setInfoEditing(true).catch(() => {}); setEditing(true); }
    function finish(save) {
      if (doneRef.current) return;
      doneRef.current = true;
      window.api.setInfoEditing(false).catch(() => {});
      setEditing(false);
      if (save && draft.trim() !== (value || '')) onCommit(draft);
    }
    const has = !!value;
    if (!editing) {
      return h('div', { className: className + (has ? ' has-value' : ''), onClick: start }, has ? value : placeholder);
    }
    const common = {
      ref: inputRef, className: 'info-edit', value: draft, placeholder, onBlur: () => finish(true),
      onInput: (e) => setDraft(e.currentTarget.value),
      onKeyDown: (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); finish(true); }
      },
    };
    return h('div', { className }, multiline ? h('textarea', Object.assign({ rows: 1 }, common)) : h('input', Object.assign({ type: 'text' }, common)));
  }

  // M12.6: Info for two or more selected items (Apple's summary).
  function SummaryView({ s }) {
    const n = s.count.toLocaleString('en-US');
    const heading = s.videos === 0 ? n + ' Photos' : (s.photos === 0 ? n + ' Videos' : n + ' Items');
    const a = F.shortDate(s.firstTime), b = F.shortDate(s.lastTime);
    const range = a && b ? (a === b ? a : a + ' \u2013 ' + b) : '';
    return h('div', null,
      h('div', { className: 'info-head' },
        h('div', { className: 'info-head-text' },
          h('div', { className: 'info-name' }, heading),
          range && h('div', { className: 'info-date' }, range),
          h('div', { className: 'info-date' }, F.bytes(s.totalBytes) || '-'))),
      h('div', { className: 'info-field' + (s.title ? ' has-value' : '') },
        s.title === 'mixed' ? 'Multiple Titles' : (s.title || 'Add a Title')),
      h('div', { className: 'info-field' + (s.caption && s.caption !== 'mixed' ? ' has-value' : '') },
        s.caption === 'mixed' ? 'Multiple Captions' : (s.caption || 'Add a Caption')),
      h('div', { className: 'info-field info-kw' + (s.keywords.length ? ' has-value' : '') },
        s.keywords.length ? s.keywords.map((k) => h('span', { key: k, className: 'info-token' }, k)) : 'Add Keywords'),
      h('div', { className: 'info-place' + (s.points.ids.length ? '' : ' is-empty') }, s.points.ids.length ? (s.points.ids.length === s.count ? 'Locations' : 'Multiple Locations') : 'Assign Location'));
  }

  function Info() {
    const [selection, setSelection] = useState(null);
    const [summary, setSummary] = useState(null);
    useEffect(() => {
      window.api.getInfoState().then((st) => setSelection(st && st.selection ? st.selection : null)).catch(() => {});
      return window.api.onInfoSelection((p) => setSelection(p && p.filter ? p.filter : null));
    }, []);
    useEffect(() => {
      if (!selection) { setSummary(null); return undefined; }
      let live = true;
      const load = () => window.api.getSelectionSummary(selection).then((r) => { if (live) setSummary(r); }).catch(() => { if (live) setSummary(null); });
      load();
      const off = window.api.onLibraryEdited ? window.api.onLibraryEdited(load) : null;
      return () => { live = false; if (typeof off === 'function') off(); };
    }, [selection]);
    const [itemId, setItemId] = useState(null);
    const [item, setItem] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [finderMsg, setFinderMsg] = useState(null);
    const [faces, setFaces] = useState([]);
    const [cropGen, setCropGen] = useState(0); // M8c.6: bumped when face crops are cleared
    useEffect(() => (window.api.onStorageCleared
      ? window.api.onStorageCleared((p) => { if (p && (p.kind === 'faceCrops' || p.kind === 'all')) setCropGen((g) => g + 1); })
      : undefined), []);

    // Which item: ask once at load, then follow the main window.
    useEffect(() => {
      window.api.getInfoState()
        .then((s) => setItemId(s && Number.isInteger(s.itemId) ? s.itemId : null))
        .catch(() => setLoaded(true));
      return window.api.onInfoItem((p) => setItemId(p && Number.isInteger(p.id) ? p.id : null));
    }, []);

    // Load its details.
    useEffect(() => {
      setFinderMsg(null);
      if (itemId == null) { setItem(null); setLoaded(true); return; }
      let live = true;
      window.api.getItemById({ id: itemId })
        .then((row) => { if (live) { setItem(row || null); setLoaded(true); } })
        .catch(() => { if (live) { setItem(null); setLoaded(true); } });
      return () => { live = false; };
    }, [itemId]);

    // M12.3: follow edits made anywhere (toolbar, viewer, period key, menu).
    useEffect(() => (window.api.onLibraryEdited ? window.api.onLibraryEdited(() => {
      if (itemId == null) return;
      window.api.getItemById({ id: itemId }).then((row) => { if (row) setItem(row); }).catch(() => {});
    }) : undefined), [itemId]);

    // People recognised in this item, left to right, each shown by their KEY
    // PHOTO (as on their People tile), as in Apple's Info. A key photo still
    // being made is null: ask again shortly (a few times). None when People is off.
    useEffect(() => {
      setFaces([]);
      if (itemId == null) return;
      let live = true;
      let timer = null;
      const load = async (tries) => {
        const on = await window.api.getConfig()
          .then((c) => !(c && c.people && c.people.enabled === false)).catch(() => true);
        if (!on || !live) return;
        const rows = await window.api.getPeopleForItem(itemId).catch(() => []);
        if (!live) return;
        const people = [];
        for (const r of (Array.isArray(rows) ? rows : [])) {
          if (!people.some((p) => p.personId === r.personId)) people.push(r);
        }
        const covers = people.length
          ? await window.api.getPeopleCovers(people.map((p) => p.personId)).catch(() => ({}))
          : {};
        if (!live) return;
        const list = people.map((p) => ({ faceId: p.faceId, personId: p.personId, name: p.name,
          crop: (covers && covers[p.personId]) || null }));
        list.sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0)); // named first; stable, so left-to-right within each group
        setFaces(list);
        if (tries > 0 && list.some((r) => !r.crop)) timer = setTimeout(() => load(tries - 1), 1500);
      };
      load(4);
      return () => { live = false; clearTimeout(timer); };
    }, [itemId, cropGen]);

    // Fit the window to the content.
    useEffect(() => {
      const el = document.getElementById('info-root');
      if (!el) return;
      const report = () => window.api.setInfoHeight(el.scrollHeight);
      report();
      const ro = new ResizeObserver(report);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    if (selection && summary && summary.count > 1) return h(SummaryView, { s: summary }); // M12.6
    if (!loaded) return h('div', { className: 'info-empty' }, '\u00a0');
    if (!item) return h('div', { className: 'info-empty' }, 'No Selection');

    const isVideo = item.media_type === 'video';
    const camera = F.cameraName(item.camera_make, item.camera_model);
    const badges = [F.formatBadge(item.extension), item.is_live_photo && 'LIVE', item.is_raw && 'RAW',
      item.is_panorama && 'PANO'].filter(Boolean);
    const place = item.has_gps ? F.placeLine(item) : null;
    const coords = item.has_gps ? F.coords(item.gps_latitude, item.gps_longitude) : null;
    const note = F.dateNote(item.capture_time_source);

    async function saveText(fn, value) {
      try {
        await window.api[fn]({ target: { ids: [item.id] }, value });
        const row = await window.api.getItemById({ id: item.id });
        if (row) setItem(row);
      } catch (err) { /* the field simply shows the stored value again */ }
    }

    async function saveKeywords(change) {
      try {
        await window.api.updateKeywords({ target: { ids: [item.id] }, add: change.add, remove: change.remove });
        const row = await window.api.getItemById({ id: item.id });
        if (row) setItem(row);
      } catch (err) { /* the field shows the stored keywords again */ }
    }

    async function toggleFavorite() {
      try {
        await window.api.setFavorite({ target: { ids: [item.id] }, value: item.is_favorite !== 1 });
        const row = await window.api.getItemById({ id: item.id });
        if (row) setItem(row);
      } catch (err) { /* ignored: the heart simply stays as it was */ }
    }

    async function reveal() {
      const r = await window.api.showInFinder({ id: item.id });
      if (!r || !r.ok) setFinderMsg(r && r.code === 'source_missing' ? 'Original unavailable' : 'Not found');
    }

    return h('div', null,
      h('div', { className: 'info-head' },
        h('div', { className: 'info-head-text' },
          h(EditableField, { className: 'info-title-field', value: item.title, placeholder: 'Add a Title',
            onCommit: (v) => saveText('setTitle', v) }), // M12.4
          h('div', { className: 'info-name', title: item.filename }, item.filename),
          h('div', { className: 'info-date' }, F.dateTime(item.capture_time_local) || 'No Date'),
          note && h('div', { className: 'info-note' }, note)),
        h('button', { className: 'info-heart' + (item.is_favorite === 1 ? ' is-on' : ''), 'aria-label': item.is_favorite === 1 ? 'Unfavorite' : 'Favorite',
          onMouseDown: noFocus, onClick: toggleFavorite }, item.is_favorite === 1 ? '\u2665' : '\u2661')), // M12.3
      h('div', { className: 'info-card' },
        h('div', { className: 'info-camera' }, camera || 'No Camera Information'),
        h('div', null, item.lens_model || 'No Lens Information'),
        h('div', { className: 'info-file-row' },
          h('span', null, F.dims(item.width, item.height) || '-'),
          h('span', { className: 'info-size' },
            [F.bytes(item.file_size_bytes), isVideo && item.duration_seconds > 0 ? F.duration(item.duration_seconds) : null]
              .filter(Boolean).join('  \u00b7  ') || '-'),
          badges.map((b) => h('span', { key: b, className: 'info-badge' }, b))),
        !isVideo && h('div', { className: 'info-exposure' },
          F.exposureCells(item).map((c, i) => h('span', { key: i }, c)))),
      h(EditableField, { className: 'info-field', value: item.caption, placeholder: 'Add a Caption', multiline: true,
        onCommit: (v) => saveText('setCaption', v) }), // M12.4
      h(window.InfoKeywords, { keywords: item.keywords || [], onChange: (c) => saveKeywords(c) }), // M12.4
      faces.length > 0 && h('div', { className: 'info-faces' },
        faces.map((p) => p.crop
          ? h('img', { key: p.faceId, className: 'info-face', src: 'file://' + p.crop, alt: '',
              draggable: false, title: p.name || 'Unnamed Person' })
          : h('span', { key: p.faceId, className: 'info-face', title: p.name || 'Unnamed Person' }))),
      item.has_gps
        ? h('div', { className: 'info-place' },
            h('div', null, place || 'Unknown Place'),
            coords && h('div', { className: 'info-coords' }, coords))
        : h('div', { className: 'info-place is-empty' }, 'Assign Location'),
      !!item.has_gps && h(InfoMap, { lat: item.gps_latitude, lng: item.gps_longitude }), // has_gps is 0/1: never render a bare 0
      h('div', { className: 'info-footer' },
        h('button', { className: 'info-finder', onMouseDown: noFocus, onClick: reveal }, finderMsg || 'Show in Finder')));
  }

  render(h(Info), document.getElementById('info-root'));
})();
