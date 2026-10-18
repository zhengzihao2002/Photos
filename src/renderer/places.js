/**
 * places.js (M7.5) -- the Map page ('map' section). Exposed as
 * window.__PhotosPlacesView and rendered by renderer.js's AppGrid.
 *
 * Data: window.api.getMapPoints() -> parallel typed arrays, newest first
 * (ids and coordinates only; never file paths). Clustering: Supercluster in
 * the page, rebuilt per data load; each cluster carries `top`, the smallest
 * array position among its members = its newest item (the cover).
 * Markers are HTML elements, only for clusters in view, capped and reused.
 * Map imagery: MapLibre GL JS + OpenFreeMap tiles (network); styles are
 * vendored (window.__PhotosMapStyles). Nothing here touches photo files.
 */
(function () {
  const { h } = window.preact;
  const { useEffect, useRef, useState } = window.preactHooks;
  const S = window.__PhotosStores;

  const WORKER_URL = 'vendor/maplibre/maplibre-gl-csp-worker.js';
  const MAX_MARKERS = 150;
  const CLUSTER_RADIUS_PX = 92;
  const MAP_MAX_ZOOM = 18;
  // Session memory (not persisted): cached points and the last map position.
  const session = { points: null, view: null, thumbs: new Map() }; // thumbs: item id -> path
  const THUMB_DELAY_MS = 120;
  const THUMB_RETRY_MS = 1500;
  const THUMB_RETRY_MAX = 10;
  let workerUrlSet = false;

  const css = document.createElement('style');
  css.textContent = [
    '.places-page { position: relative; width: 100%; overflow: hidden; }',
    '.places-map { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }',
    '.places-marker { width: 52px; height: 52px; border-radius: 10px; box-sizing: border-box;',
    '  border: 2px solid #fff; background: #8e8e93 center / cover no-repeat;',
    '  box-shadow: 0 1px 5px rgba(0,0,0,.35); cursor: pointer; }',
    '.places-marker img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }',
    '.places-badge { position: absolute; top: -7px; right: -7px; min-width: 20px; height: 20px;',
    '  padding: 0 6px; box-sizing: border-box; border-radius: 10px; background: #fff; color: #1d1d1f;',
    '  font: 600 11px/20px -apple-system, system-ui, sans-serif; text-align: center;',
    '  box-shadow: 0 1px 3px rgba(0,0,0,.3); }',
  ].join('\n');
  document.head.appendChild(css);

  // Apple-style markers and the "Legal" credit label (appended so these win
  // over the first rules above).
  const css2 = document.createElement('style');
  css2.textContent = [
    '.places-marker { width: 84px; height: 84px; border: 3px solid #fff; border-radius: 12px; }',
    '.places-marker img { border-radius: 9px; }',
    '.places-marker::after { content: ""; position: absolute; left: 50%; bottom: -12px; margin-left: -9px;',
    '  border: 9px solid transparent; border-bottom-width: 0; border-top-color: #fff; }',
    '.places-badge { top: auto; right: auto; left: 7px; bottom: 5px; min-width: 0; height: auto; padding: 0;',
    '  border-radius: 0; background: transparent; box-shadow: none; color: #fff;',
    '  font: 700 13px/1 -apple-system, system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0,0,0,.95); }',
    '.places-legal { position: absolute; left: 10px; bottom: 7px; z-index: 3; max-width: 80%; font-size: 10px;',
    '  color: var(--text-primary); opacity: .65; text-decoration: underline; cursor: pointer; }',
    '.places-overlay { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 60; background: var(--content-bg); }',
    '.places-back { position: absolute; top: 10px; left: 12px; z-index: 5; width: 32px; height: 32px; padding: 0 2px 4px 0;',
    '  border: none; border-radius: 16px; background: rgba(50,50,50,.78); color: #fff; font-size: 24px; line-height: 1;',
    '  cursor: pointer; -webkit-app-region: no-drag; }',
    '.places-back.is-inline { position: static; flex-shrink: 0; }',
    '@keyframes places-fade { from { opacity: 0; } to { opacity: 1; } }',
    '@keyframes places-fade-out { from { opacity: 1; } to { opacity: 0; } }',
    '.places-page, .pa-root { animation: places-fade 200ms ease-out; }',
    '.places-overlay { animation: places-fade 200ms ease-out; }',
    '.places-overlay.is-closing, .places-overlay-area.is-closing { animation: places-fade-out 170ms ease-in forwards; }',
    '.places-overlay-inner { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }',
    '.places-overlay-area { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 8; display: flex; flex-direction: column;',
    '  background: var(--content-bg); animation: places-fade 200ms ease-out; }',
    '.places-overlay-bar { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 14px 0 12px; flex-shrink: 0; }',
    '.places-overlay-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }',
    '.places-overlay-scroll { flex: 1; min-height: 0; overflow-y: auto; }',
    '.places-zoom { width: 32px; height: 28px; border: none; border-radius: 8px; background: rgba(128,128,128,.25);',
    '  color: var(--text-primary); font-size: 17px; line-height: 1; cursor: pointer; -webkit-app-region: no-drag; }',
    '.places-note { position: absolute; z-index: 4; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: 10px;',
    '  background: rgba(40,40,44,.82); color: #fff; font-size: 12px; text-align: center; pointer-events: none; }',
    '.places-note.is-top { top: 68px; }',
    '.places-note.is-center { top: 44%; padding: 16px 22px; max-width: 320px; }',
    '.places-note strong { display: block; font-size: 15px; margin-bottom: 4px; }',
  ].join('\n');
  document.head.appendChild(css2);

  // Map credits (required by the data licences), shown the way Apple does:
  // a small "Legal" label that expands when clicked.
  function addLegal(container) {
    const el = document.createElement('div');
    el.className = 'places-legal';
    const label = false /* M8c.2 (U13): English UI */ ? '\u6CD5\u5F8B\u4FE1\u606F' : 'Legal';
    const full = '\u00A9 OpenStreetMap contributors \u00B7 \u00A9 OpenMapTiles \u00B7 OpenFreeMap \u00B7 Place names: GeoNames';
    el.textContent = label;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); el.textContent = el.textContent === label ? full : label; });
    container.appendChild(el);
  }
  window.__PhotosMapLegal = addLegal;

  function buildIndex(points) {
    const features = new Array(points.count);
    for (let i = 0; i < points.count; i += 1) {
      features[i] = { type: 'Feature', properties: { i },
        geometry: { type: 'Point', coordinates: [points.lngs[i], points.lats[i]] } };
    }
    const index = new window.Supercluster({
      radius: CLUSTER_RADIUS_PX, maxZoom: 20,
      map: (p) => ({ top: p.i }),
      reduce: (acc, p) => { if (p.top < acc.top) acc.top = p.top; },
    });
    index.load(features);
    return index;
  }

  function measureHeight() {
    const el = document.getElementById('grid-scroll');
    if (!el) return window.innerHeight;
    // M8c.5 (K10): clientHeight includes the top padding that keeps content
    // clear of the toolbar; the map starts below it, so subtract it, or the
    // map runs past the window's bottom edge (zoom buttons cut off).
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
    return Math.max(0, el.clientHeight - pad);
  }

  // props.focus (M7.7, full map opened from the viewer): { lat, lng, zoom,
  // single: { id } | null }. single = show only that item's pin, no clusters.
  function PlacesView(props) {
    const focus = props && props.focus ? props.focus : null;
    const elRef = useRef(null);
    const [height, setHeight] = useState(measureHeight());
    // M7.9: empty-library and offline notices.
    const [count, setCount] = useState(null);
    const [online, setOnline] = useState(navigator.onLine !== false);
    useEffect(() => {
      const on = () => setOnline(true); const off = () => setOnline(false);
      window.addEventListener('online', on); window.addEventListener('offline', off);
      return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    }, []);

    useEffect(() => {
      const onResize = () => setHeight(measureHeight());
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
      const gl = window.maplibregl;
      const styles = window.__PhotosMapStyles;
      if (!workerUrlSet) { gl.setWorkerUrl(WORKER_URL); workerUrlSet = true; }
      const theme = window.matchMedia('(prefers-color-scheme: dark)');
      const map = new gl.Map({
        container: elRef.current,
        style: theme.matches ? styles.dark : styles.light,
        center: focus ? [focus.lng, focus.lat] : (session.view ? session.view.center : [0, 20]),
        zoom: focus ? focus.zoom : (session.view ? session.view.zoom : 1),
        maxZoom: MAP_MAX_ZOOM, dragRotate: false, pitchWithRotate: false,
        // Tile-source credits come from the source itself; GeoNames (place
        // names, CC BY 4.0) is added here. Always visible, bottom right.
        attributionControl: false, // credits live behind the "Legal" label (addLegal)
      });
      map.touchZoomRotate.disableRotation();
      addLegal(elRef.current);
      // Credit links are web links; following one would navigate the app
      // window away, so clicks on links inside the map are swallowed.
      elRef.current.addEventListener('click', (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest('a')) ev.preventDefault();
      }, true);
      map.addControl(new gl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('error', (e) => console.warn('[map]', e && e.error ? e.error.message : e));
      const onTheme = () => map.setStyle(theme.matches ? styles.dark : styles.light);
      theme.addEventListener('change', onTheme);

      let alive = true;
      let index = null;
      let frame = 0;
      const markers = new Map(); // key -> maplibregl.Marker

      function placeTitle(item) {
        if (!item) return null;
        const zh = false /* M8c.2 (U13): English UI */;
        return (zh && item.place_locality_zh) || item.place_locality_en
          || (zh && item.place_region_zh) || item.place_region_en || null;
      }

      // M7.6: open the photo grid of one marker's area. The box is the
      // bounding box of the marker's members plus ~1 m, expressed as the
      // shared 'geo:' filter string (west > east = crosses the antimeridian).
      async function openArea(feature, coverId) {
        const p = feature.properties;
        const members = p.cluster ? index.getLeaves(p.cluster_id, Infinity) : [feature];
        let s = 90; let n = -90; let w = 180; let e = -180;
        for (const m of members) {
          const c = m.geometry.coordinates;
          w = Math.min(w, c[0]); e = Math.max(e, c[0]);
          s = Math.min(s, c[1]); n = Math.max(n, c[1]);
        }
        if (e - w > 180) {
          w = 180; e = -180;
          for (const m of members) {
            const x = m.geometry.coordinates[0];
            if (x >= 0) w = Math.min(w, x); else e = Math.max(e, x);
          }
        }
        const lo = (v, limit) => Math.max(-limit, Math.floor(v * 1e6) / 1e6 - 0.00001).toFixed(6);
        const hi = (v, limit) => Math.min(limit, Math.ceil(v * 1e6) / 1e6 + 0.00001).toFixed(6);
        const filter = 'geo:' + [lo(s, 90), lo(w, 180), hi(n, 90), hi(e, 180)].join(',');
        const title = 'Places'; // the page title is fixed, so no lookup is needed
        if (!alive) return;
        if (focus) { // opened over the viewer: show the area as a layer above this map
          if (props.onOpenArea) props.onOpenArea({ filter, title });
          return;
        }
        S.mapAreaStore.set({ filter, title });
      }

      function makeMarker(feature, key) {
        const p = feature.properties;
        const el = document.createElement('div');
        el.className = 'places-marker';
        // Cover = the newest member (smallest array position).
        const coverId = session.points.ids[p.cluster ? p.top : p.i];
        el.dataset.cover = String(coverId);
        if (session.thumbs.has(coverId)) setImage(el, session.thumbs.get(coverId));
        if (p.cluster) {
          const badge = document.createElement('div');
          badge.className = 'places-badge';
          badge.textContent = p.point_count_abbreviated;
          el.appendChild(badge);
        }
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (!index) return;
          // Any marker opens its photos directly, as in Apple Photos; zooming
          // is by scroll, pinch, double-click, or the +/- buttons.
          openArea(feature, coverId);
        });
        const marker = new gl.Marker({ element: el, anchor: 'bottom', offset: [0, -11] }).setLngLat(feature.geometry.coordinates).addTo(map);
        markers.set(key, marker);
      }

      function refresh() {
        frame = 0;
        if (!alive || !index) return;
        const b = map.getBounds();
        let list = index.getClusters([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], Math.floor(map.getZoom()));
        if (list.length > MAX_MARKERS) {
          list = list.slice().sort((x, y) => (y.properties.point_count || 1) - (x.properties.point_count || 1)).slice(0, MAX_MARKERS);
        }
        const seen = new Set();
        for (const feature of list) {
          const p = feature.properties;
          const key = p.cluster ? 'c' + p.cluster_id : 'p' + p.i;
          seen.add(key);
          if (!markers.has(key)) makeMarker(feature, key);
        }
        for (const [key, marker] of markers) {
          if (!seen.has(key)) { marker.remove(); markers.delete(key); }
        }
        clearTimeout(thumbTimer);
        thumbTimer = setTimeout(() => resolveThumbs(0), THUMB_DELAY_MS);
      }

      function setImage(el, path) {
        if (el.querySelector('img')) return;
        const img = document.createElement('img');
        const q = session.points && session.points.rots ? session.points.rots[session.points.ids.indexOf(Number(el.dataset.cover))] : 0;
        if (q) img.style.transform = 'rotate(' + (q * 90) + 'deg)'; // M12.11
        img.src = 'file://' + path;
        img.alt = '';
        img.draggable = false;
        el.insertBefore(img, el.firstChild);
      }

      // Batched cover lookup for the markers on screen (thumbnail:get-path).
      // Not-ready thumbnails are prioritised and rechecked a few times.
      let thumbTimer = null;
      async function resolveThumbs(attempt) {
        if (!alive) return;
        const wanted = [];
        for (const marker of markers.values()) {
          const el = marker.getElement();
          const id = Number(el.dataset.cover);
          if (!el.querySelector('img') && !session.thumbs.has(id)) wanted.push(id);
        }
        if (wanted.length === 0) return;
        const result = await window.api.getThumbnailPaths({ ids: wanted, size: 'sm' });
        if (!alive) return;
        const pending = [];
        for (const id of wanted) {
          if (result && result[id]) session.thumbs.set(id, result[id]); else pending.push(id);
        }
        for (const marker of markers.values()) {
          const el = marker.getElement();
          const path = session.thumbs.get(Number(el.dataset.cover));
          if (path) setImage(el, path);
        }
        if (pending.length > 0 && attempt < THUMB_RETRY_MAX) {
          if (attempt === 0) window.api.requestThumbnailPriority({ ids: pending, size: 'sm' });
          clearTimeout(thumbTimer);
          thumbTimer = setTimeout(() => resolveThumbs(attempt + 1), THUMB_RETRY_MS);
        }
      }
      const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
      map.on('move', schedule);

      function usePoints(points, fit) {
        for (const marker of markers.values()) marker.remove();
        markers.clear();
        index = buildIndex(points);
        setCount(points.count);
        if (fit && points.count > 0) {
          let w = 180; let s = 90; let e = -180; let n = -90;
          for (let i = 0; i < points.count; i += 1) {
            w = Math.min(w, points.lngs[i]); e = Math.max(e, points.lngs[i]);
            s = Math.min(s, points.lats[i]); n = Math.max(n, points.lats[i]);
          }
          map.fitBounds([[w, s], [e, n]], { padding: { top: 100, bottom: 60, left: 60, right: 60 }, maxZoom: 14, animate: false });
        }
        schedule();
      }

      async function load(force) {
        if (focus && focus.single) return; // single-pin map: no clusters
        if (force || !session.points) session.points = await window.api.getMapPoints();
        if (alive) usePoints(session.points, !session.view && !focus);
      }
      load(false);
      if (focus && focus.single) {
        const pin = document.createElement('div');
        pin.className = 'places-marker';
        new gl.Marker({ element: pin, anchor: 'bottom', offset: [0, -11] }).setLngLat([focus.lng, focus.lat]).addTo(map);
        window.api.getThumbnailPaths({ ids: [focus.single.id], size: 'sm' })
          .then((r) => { if (alive && r && r[focus.single.id]) setImage(pin, r[focus.single.id]); });
      }
      const store = S && S.libraryChangeStore;
      const unsubscribe = store && store.subscribe ? store.subscribe(() => load(true)) : null;

      return () => {
        alive = false;
        if (frame) cancelAnimationFrame(frame);
        clearTimeout(thumbTimer);
        if (typeof unsubscribe === 'function') unsubscribe();
        theme.removeEventListener('change', onTheme);
        const c = map.getCenter();
        if (!focus) session.view = { center: [c.lng, c.lat], zoom: map.getZoom() };
        map.remove();
      };
    }, []);

    return h('div', { class: 'places-page', style: { height: focus ? '100%' : height + 'px' } },
      h('div', { class: 'places-map', ref: elRef }),
      !online && h('div', { class: 'places-note is-top' },
        false /* M8c.2 (U13): English UI */ ? '\u79BB\u7EBF\u65F6\u65E0\u6CD5\u663E\u793A\u5730\u56FE' : 'Map unavailable offline'),
      !focus && count === 0 && h('div', { class: 'places-note is-center' },
        h('strong', null, 'No Places'),
        h('span', null, 'Photos and videos with location information will appear here.')),
      focus && h('button', { class: 'places-back', type: 'button', title: 'Back', 'aria-label': 'Back',
        onClick: () => window.__PhotosMapOverlay.back() }, '\u2039'));
  }

  // M7.7: a full map laid over the viewer (which stays open underneath), so
  // Back returns to exactly the item being viewed. Escape also closes it;
  // keys are swallowed while it is open so the viewer does not react.
  // Layers above the open viewer: the full map, and (after a cluster click)
  // that area's Places page above the map. Back peels one layer at a time, so
  // the map keeps its position and the viewer its item and scroll state.
  function OverlayHost({ focus, api }) {
    const [area, setArea] = useState(null);
    const [leaving, setLeaving] = useState(false);
    const [kind, setKind] = useState('all'); // M8c.5 (K2): this trail page's own view filter
    const scrollRef = useRef(null);
    api.back = () => {
      if (!area) { api.close(); return; }
      setLeaving(true);
      setTimeout(() => { setArea(null); setLeaving(false); }, 170);
    };
    const zh = false /* M8c.2 (U13): English UI */;
    const AreaView = window.__PhotosPlacesAreaView;
    const step = (d) => S.columnsStore.set(S.columnsStore.get() + d);
    // K2: the page and the viewer use the same filter, so arrows stay within it.
    const FilterBtn = window.__PhotosViewFilterButton;
    const effArea = area ? Object.assign({}, area, { filter: area.filter + (kind !== 'all' ? '::kind:' + kind : '') }) : null;
    return h('div', { class: 'places-overlay-inner' },
      h(PlacesView, { focus, onOpenArea: (a) => { setKind('all'); setArea(a); } }),
      area && AreaView && h('div', { class: 'places-overlay-area' + (leaving ? ' is-closing' : ''), key: area.filter },
        h('div', { class: 'places-overlay-bar' },
          h('button', { class: 'places-back is-inline', type: 'button', title: 'Back', onClick: () => api.back() }, '\u2039'),
          h('span', { class: 'places-overlay-title' }, zh ? '\u5730\u70B9' : 'Places'),
          h('span', { style: { flex: '1 1 auto' } }),
          FilterBtn && h(FilterBtn, { value: kind, onChange: setKind }),
          h('button', { class: 'places-zoom', type: 'button', title: 'Zoom Out', onClick: () => step(1) }, '\u2212'),
          h('button', { class: 'places-zoom', type: 'button', title: 'Zoom In', onClick: () => step(-1) }, '+')),
        h('div', { class: 'places-overlay-scroll', ref: scrollRef },
          h(AreaView, { filter: effArea.filter, scroller: () => scrollRef.current, onOpenItem: (id) => api.leaveToItem(effArea, id) }))));
  }

  // The trail: a stack of layers above the single viewer. Each layer (a full
  // map, optionally with a Places page over it) remembers the photo that was
  // beneath it. Opening a photo from a layered Places page hides that layer
  // (kept alive) and points the viewer at the new photo; closing the viewer
  // then brings the layer back and restores the earlier photo, so Back
  // retraces every step. A section change or a real viewer close clears it.
  const overlay = (function () {
    const stack = []; // { el, api, hidden, below: { itemId, sheet, filter } }
    let base = null;  // { section, area } when the first layer opened
    let offs = [];
    const top = () => stack[stack.length - 1] || null;

    function destroy(entry, fade) {
      const el = entry.el;
      const remove = () => { window.preact.render(null, el); el.remove(); };
      if (fade) { el.classList.add('is-closing'); setTimeout(remove, 170); } else remove();
    }
    function onKey(ev) {
      const t = top();
      if (!t || t.hidden) return; // the viewer handles its own keys
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); t.api.back(); }
    }
    function teardown() {
      offs.forEach((off) => { if (typeof off === 'function') off(); });
      offs = [];
      window.removeEventListener('keydown', onKey, true);
      base = null;
    }
    function clearAll() {
      while (stack.length) destroy(stack.pop(), false);
      window.__PhotosViewerFilter = undefined;
      window.__PhotosViewerSheetPending = null;
      teardown();
    }
    function closeTop() {
      const entry = stack.pop();
      if (!entry) return;
      destroy(entry, true);
      if (!stack.length) teardown();
    }
    function open(focus) {
      const openItem = S.viewerStore.get();
      if (!openItem) return;
      if (!stack.length) {
        base = { section: S.sectionStore.get(), area: S.mapAreaStore.get() };
        window.addEventListener('keydown', onKey, true);
        offs = [S.sectionStore.subscribe(clearAll), S.viewerStore.subscribe((v) => { if (!v) clearAll(); })];
      }
      const el = document.createElement('div');
      el.className = 'places-overlay';
      document.getElementById('content').appendChild(el);
      const entry = { el, hidden: false, below: { itemId: openItem.itemId, sheet: 0, filter: window.__PhotosViewerFilter } };
      entry.api = { back: closeTop, close: closeTop, leaveToItem: (area, id) => leaveToItem(entry, area, id) };
      stack.push(entry);
      window.preact.render(h(OverlayHost, { focus, api: entry.api }), el);
    }
    // A photo opened from this layer's Places page.
    function leaveToItem(entry, area, id) {
      entry.below.sheet = window.__PhotosViewerSheetValue ? window.__PhotosViewerSheetValue() : 0;
      entry.hidden = true;
      window.__PhotosViewerFilter = area.filter;
      window.__PhotosViewerSheetPending = { itemId: id, value: 0 };
      S.viewerStore.open(id);
      entry.el.classList.add('is-closing');
      setTimeout(() => { if (entry.hidden) entry.el.style.display = 'none'; entry.el.classList.remove('is-closing'); }, 170);
    }
    // Back from that photo: show the layer again, restore the photo beneath.
    function returnToLayer(entry) {
      entry.hidden = false;
      entry.el.classList.remove('is-closing');
      entry.el.style.display = '';
      // The layer fades in over the current photo first; the viewer beneath
      // is switched back only once the layer is opaque, so the earlier photo
      // never shows through mid-fade.
      const RESTORE_DELAY_MS = 230;
      setTimeout(() => {
        if (stack.indexOf(entry) === -1) return; // trail was cleared meanwhile
        window.__PhotosViewerFilter = entry.below.filter;
        window.__PhotosViewerSheetPending = { itemId: entry.below.itemId, value: entry.below.sheet || 0 };
        S.viewerStore.open(entry.below.itemId);
      }, RESTORE_DELAY_MS);
    }
    // M8c.8 (C8): through viewerStore's explicit hook (was: replacing close()).
    // A photo opened from a layered Places page: closing goes back one step.
    S.viewerStore.setCloseInterceptor(() => {
      const t = top();
      if (t && t.hidden) {
        if (base && S.sectionStore.get() === base.section && S.mapAreaStore.get() === base.area) { returnToLayer(t); return true; }
        clearAll();
      }
      return false;
    });
    const visibleTop = () => { const t = top(); return t && !t.hidden ? t : null; };
    return {
      open,
      back: () => { const t = visibleTop(); if (t) t.api.back(); },
      close: () => { const t = visibleTop(); if (t) closeTop(); },
    };
  })();
  window.__PhotosMapOverlay = overlay;

  window.__PhotosPlacesView = PlacesView;
})();

/**
 * M7.6g -- Apple-style grouped page for one map area. Exposed as
 * window.__PhotosPlacesAreaView ({ filter: 'geo:...' }). Data:
 * window.api.getMapAreaSections(filter) -> oldest-first ids + place/date
 * sections. Virtualised by hand: only headers and tile rows near the
 * viewport exist in the DOM. Double-click opens the viewer, whose
 * older/newer navigation follows this page's order under the same filter.
 */
(function () {
  const { h } = window.preact;
  const { useEffect, useRef, useState } = window.preactHooks;
  const S = window.__PhotosStores;
  const GAP = 2; const HEADER = 44; const FOOT = 14; const OVERSCAN = 700; const MD_MIN_TILE = 220;

  const css = document.createElement('style');
  css.textContent = [
    '.pa-root { position: relative; width: 100%; }',
    '.pa-header { position: absolute; left: 0; right: 0; height: 44px; box-sizing: border-box; padding: 16px 6px 0;',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary); font-size: 13px; }',
    '.pa-header.has-rule { border-top: 1px solid rgba(128,128,128,.28); }',
    '.pa-place { font-weight: 700; margin-right: 6px; }',
    '.pa-quiet { opacity: .6; }',
    '.pa-tile { position: absolute; overflow: hidden; background: rgba(128,128,128,.18); cursor: default; }',
    '.pa-tile img { display: block; width: 100%; height: 100%; object-fit: cover; }',
    '.pa-tile.is-selected { outline: 3px solid #0a84ff; outline-offset: -3px; }',
    '.pa-empty { padding: 120px 0; text-align: center; color: var(--text-primary); opacity: .6; font-size: 14px; }',
  ].join('\n');
  document.head.appendChild(css);

  const isZh = () => false /* M8c.2 (U13): English UI */;
  const placeName = (s) => (isZh() && s.localityZh) || s.localityEn || '';
  function parseDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dateText(s) {
    const a = parseDay(s.startDate); const b = parseDay(s.endDate);
    if (!a) return '';
    const fmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    try { return b && s.endDate !== s.startDate ? fmt.formatRange(a, b) : fmt.format(a); } catch (err) { return fmt.format(a); }
  }
  // Same format as the grid's badge (renderer.js formatDuration): m:ss.
  function formatDuration(seconds) {
    const total = Math.round(seconds);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }
  function columnCount() {
    const c = S.columnsStore && S.columnsStore.get ? Number(S.columnsStore.get()) : NaN;
    return Number.isFinite(c) && c >= 1 ? Math.round(c) : 4;
  }

  function PlacesAreaView({ filter, scroller, onOpenItem }) {
    const getScroll = () => (scroller ? scroller() : document.getElementById('grid-scroll'));
    const rootRef = useRef(null);
    const thumbs = useRef({ sm: new Map(), md: new Map() }).current;
    const [data, setData] = useState(null);
    const [box, setBox] = useState({ width: 0, top: 0, height: 800, pad: 0 });
    const [cols, setCols] = useState(columnCount());
    const [selected, setSelected] = useState(null);
    const [, bump] = useState(0);
    // M12.2g: the normal Places page shares selectionStore with the main grid.
    // Layered trail pages (onOpenItem set) keep their own single selection.
    const shared = !onOpenItem;
    const collapseTimer = useRef(null);
    function itemAt(i) {
      const secs = data && data.times ? data.times[i] : NaN;
      const text = Number.isFinite(secs) ? new Date(secs * 1000).toISOString().replace('T', ' ').slice(0, 19) : null;
      return { id: data.ids[i], capture_time_local: text };
    }
    function sharedScope(item) {
      const st = S.selectionStore;
      if (!st.isMulti() || (item && !st.contains(item))) return null;
      return st.withSelection(S.filterStore.get());
    }
    useEffect(() => (shared ? S.selectionStore.subscribe(() => bump((v) => v + 1)) : undefined), [shared]);
    useEffect(() => {
      if (!shared) return undefined;
      const selectAll = () => S.selectionStore.selectAll();
      window.__PhotosGridSelectAll = selectAll;
      return () => { if (window.__PhotosGridSelectAll === selectAll) window.__PhotosGridSelectAll = null; };
    }, [shared]);
    // M8c.5 (K3): folders currently unavailable (same store as the main grid).
    const [missing, setMissing] = useState(S.missingSourcesStore ? S.missingSourcesStore.get() : new Set());
    useEffect(() => (S.missingSourcesStore ? S.missingSourcesStore.subscribe(setMissing) : undefined), []);

    // M8c.5 (K4): Space / Enter open the selected tile, like the main grid
    // (same path as a double-click, so a trail page opens through the trail);
    // Escape clears the selection. Ignored while typing, and while the viewer
    // is open over a normal Places page.
    useEffect(() => {
      const onKey = (e) => {
        const cur = shared ? S.selectionStore.get() : selected;
        if (cur == null) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (!onOpenItem && S.viewerStore.get() !== null) return;
        if (e.key === 'Escape') { if (shared) S.selectionStore.set(null); else setSelected(null); return; }
        if ((e.key !== 'Enter' && e.key !== ' ') || e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (onOpenItem) onOpenItem(cur); else S.viewerStore.open(cur, { scope: sharedScope(null) });
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [selected, onOpenItem]);

    useEffect(() => {
      let alive = true;
      const load = () => window.api.getMapAreaSections(filter)
        .then((r) => { if (alive) setData(r); })
        .catch((err) => console.error('[map] area load failed:', err));
      load();
      const off = S.libraryChangeStore && S.libraryChangeStore.subscribe ? S.libraryChangeStore.subscribe(load) : null;
      return () => { alive = false; if (typeof off === 'function') off(); };
    }, [filter]);

    useEffect(() => {
      const scrollEl = getScroll();
      const toolbar = document.getElementById('toolbar');
      let frame = 0;
      const measure = () => {
        frame = 0;
        if (!scrollEl || !rootRef.current) return;
        const pad = toolbar ? Math.max(0, toolbar.getBoundingClientRect().bottom - scrollEl.getBoundingClientRect().top) : 0;
        setBox({ width: rootRef.current.clientWidth, top: scrollEl.scrollTop, height: scrollEl.clientHeight, pad });
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
      measure();
      scrollEl.addEventListener('scroll', schedule, { passive: true });
      const observer = new ResizeObserver(schedule);
      observer.observe(scrollEl);
      const offCols = S.columnsStore && S.columnsStore.subscribe ? S.columnsStore.subscribe(() => setCols(columnCount())) : null;
      return () => {
        if (frame) cancelAnimationFrame(frame);
        scrollEl.removeEventListener('scroll', schedule);
        observer.disconnect();
        if (typeof offCols === 'function') offCols();
      };
    }, []);

    const sections = data ? data.sections : [];
    const tile = box.width > 0 ? Math.floor((box.width - GAP * (cols - 1)) / cols) : 0;
    const pitch = tile + GAP;
    const children = [];
    const visibleIds = [];
    let y = 0; // the scroll area already clears the toolbar
    const lo = box.top - OVERSCAN; const hi = box.top + box.height + OVERSCAN;
    for (let i = 0; i < sections.length && tile > 0; i += 1) {
      const s = sections[i];
      const rows = Math.ceil(s.count / cols);
      const top = y; const bodyTop = top + HEADER;
      y = bodyTop + rows * pitch + FOOT;
      if (y < lo || top > hi) continue;
      const name = placeName(s);
      children.push(h('div', { key: 'h' + i, class: 'pa-header' + (i > 0 ? ' has-rule' : ''), style: { top: top + 'px' } },
        h('span', { class: 'pa-place' }, name),
        h('span', { class: 'pa-quiet' }, dateText(s) + (name ? '  \u00B7  ' + name + ' \u203A' : ''))));
      const r0 = Math.max(0, Math.floor((lo - bodyTop) / pitch));
      const r1 = Math.min(rows - 1, Math.floor((hi - bodyTop) / pitch));
      for (let r = r0; r <= r1; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const k = r * cols + c;
          if (k >= s.count) break;
          const id = data.ids[s.start + k];
          const duration = data.durations ? data.durations[s.start + k] : -1;
          const unavailable = !!(data.sourceIds && missing && missing.has(data.sourceIds[s.start + k]));
          visibleIds.push(id);
          const path = thumbs.md.get(id) || thumbs.sm.get(id);
          children.push(h('div', {
            key: id, 'data-id': id, class: 'pa-tile' + ((shared ? S.selectionStore.contains(itemAt(s.start + k)) : selected === id) ? ' is-selected' : ''), // data-id: U10 zoom
            style: { left: c * pitch + 'px', top: bodyTop + r * pitch + 'px', width: tile + 'px', height: tile + 'px' },
            onClick: (e) => {
              if (!shared) { setSelected(id); return; }
              const it = itemAt(s.start + k); const st = S.selectionStore;
              clearTimeout(collapseTimer.current);
              if (e.metaKey) st.toggle(it);
              else if (e.shiftKey) { if (window.getSelection) window.getSelection().removeAllRanges(); st.extendTo(it); }
              else if (st.isMulti() && st.contains(it)) collapseTimer.current = setTimeout(() => st.set(id, it), 300);
              else st.set(id, it);
            },
            onDblClick: () => {
              if (onOpenItem) { onOpenItem(id); return; }
              clearTimeout(collapseTimer.current);
              S.viewerStore.open(id, { scope: sharedScope(itemAt(s.start + k)) });
            },
          }, path ? h('img', { src: 'file://' + path, alt: '', draggable: false, style: data.rot && data.rot[s.start + k] ? { transform: 'rotate(' + (data.rot[s.start + k] * 90) + 'deg)' } : undefined }) : null,
            duration >= 0 ? h('span', { class: 'pa-duration' }, formatDuration(duration))
              : duration === -2 ? h('span', { class: 'pa-duration', title: 'Video' }, '\u25B6') : null, // K3: unknown length
            data.live && data.live[s.start + k] ? h('div', { class: 'tile-live-badge' }, h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('circle', { cx: 8, cy: 8, r: 2, fill: 'currentColor' }), h('circle', { cx: 8, cy: 8, r: 4.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }), h('circle', { cx: 8, cy: 8, r: 6.8, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.1, 'stroke-dasharray': '0.9 1.5', 'stroke-linecap': 'round' })), 'LIVE') /* U16 */ : null,
            data.fav && data.fav[s.start + k] ? h('div', { class: 'tile-fav-badge', 'aria-label': 'Favorite' }, h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('path', { fill: 'currentColor', d: 'M8 14.2 2.3 8.6C.6 6.9.6 4.2 2.3 2.8c1.5-1.3 3.7-1 5 .5l.7.8.7-.8c1.3-1.5 3.5-1.8 5-.5 1.7 1.4 1.7 4.1 0 5.8z' }))) : null, // M12.3
            unavailable ? h('div', { class: 'tile-unavailable-badge', title: 'Original unavailable' }, '!')
              : h('div', { class: 'tile-gps-badge', title: 'Has location' }, h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('circle', { cx: 8, cy: 4.6, r: 2.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }), h('path', { d: 'M8 7v6', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }), h('ellipse', { cx: 8, cy: 13, rx: 4.6, ry: 1.7, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }))))); // U14: every Places item is located
        }
      }
    }
    const total = y;
    const wantMd = tile >= MD_MIN_TILE;
    const visibleKey = visibleIds.length ? visibleIds[0] + ':' + visibleIds[visibleIds.length - 1] + ':' + visibleIds.length : '';

    // Open at the newest photos (the bottom), as Apple Photos does. Once per
    // area, as soon as the layout height is known.
    const scrolledRef = useRef(false);
    useEffect(() => {
      if (scrolledRef.current || !data || tile <= 0) return;
      scrolledRef.current = true;
      const scrollEl = getScroll();
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    }, [data, tile]);

    // Thumbnails for what is on screen: small first, then medium for large
    // tiles (prioritised and rechecked until generated).
    useEffect(() => {
      if (!visibleKey) return undefined;
      let alive = true; let timer = null;
      const ids = visibleIds.slice();
      async function run(attempt) {
        const needSm = ids.filter((id) => !thumbs.sm.has(id) && !thumbs.md.has(id));
        const needMd = wantMd ? ids.filter((id) => !thumbs.md.has(id)) : [];
        if (!needSm.length && !needMd.length) return;
        const [sm, md] = await Promise.all([
          needSm.length ? window.api.getThumbnailPaths({ ids: needSm, size: 'sm' }) : {},
          needMd.length ? window.api.getThumbnailPaths({ ids: needMd, size: 'md' }) : {},
        ]);
        if (!alive) return;
        let waitingSm = 0; const waitingMd = [];
        needSm.forEach((id) => { if (sm && sm[id]) thumbs.sm.set(id, sm[id]); else waitingSm += 1; });
        needMd.forEach((id) => { if (md && md[id]) thumbs.md.set(id, md[id]); else waitingMd.push(id); });
        bump((v) => v + 1);
        if ((waitingSm || waitingMd.length) && attempt < 8) {
          if (attempt === 0 && waitingMd.length) window.api.requestThumbnailPriority({ ids: waitingMd, size: 'md' });
          timer = setTimeout(() => run(attempt + 1), 1500);
        }
      }
      const delay = setTimeout(() => run(0), 60);
      return () => { alive = false; clearTimeout(delay); clearTimeout(timer); };
    }, [visibleKey, wantMd]);

    if (data && data.count === 0) return h('div', { class: 'pa-empty', ref: rootRef },
      /::kind:videos/.test(filter || '') ? 'No Videos' : 'No Photos'); // M8c.5: matches the view filter
    return h('div', { class: 'pa-root', ref: rootRef, style: { height: total + 'px' },
      onClick: (e) => { if (shared && !e.target.closest('.pa-tile')) S.selectionStore.set(null); } }, children);
  }

  window.__PhotosPlacesAreaView = PlacesAreaView;
})();

/**
 * M7.7 -- the viewer's Places section (below the photo, slid into view by
 * viewer.js). Exposes window.__PhotosViewerPlaces ({ item, sheet, height,
 * pinUrl, onWheel }) and window.__PhotosPlaceLine(item) -> "Town, Region,
 * Country" from the item's stored offline place columns. One non-interactive
 * map per viewer session, recentred as the item changes.
 */
(function () {
  const { h } = window.preact;
  const { useEffect, useRef, useState } = window.preactHooks;
  const S = window.__PhotosStores;
  const WORKER_URL = 'vendor/maplibre/maplibre-gl-csp-worker.js';
  const NEARBY_DEGREES = 0.005; // about 550 m of latitude
  const isZh = () => false /* M8c.2 (U13): English UI */;

  function placeLine(item) {
    if (!item) return null;
    const zh = isZh();
    const locality = (zh && item.place_locality_zh) || item.place_locality_en || null;
    const region = (zh && item.place_region_zh) || item.place_region_en || null;
    let country = null;
    if (item.place_country_code) {
      try { country = new Intl.DisplayNames(['en-US'], { type: 'region' }).of(item.place_country_code); }
      catch (err) { country = item.place_country_code; }
    }
    const parts = [locality, region !== locality ? region : null, country].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  window.__PhotosPlaceLine = placeLine;

  const css = document.createElement('style');
  css.textContent = [
    '.viewer-toolbar { position: relative; z-index: 4; }',
    '.vp-panel { position: absolute; left: 0; right: 0; top: 100%; z-index: 2; box-sizing: border-box; padding: 0 28px;',
    '  background: var(--content-bg); color: var(--text-primary); }',
    '.vp-inner { max-width: 1000px; margin: 0 auto; height: 100%; display: flex; flex-direction: column; }',
    '.vp-head { display: flex; align-items: baseline; gap: 14px; height: 52px; padding-top: 18px; box-sizing: border-box; flex-shrink: 0; }',
    '.vp-title { font-size: 17px; font-weight: 600; opacity: .7; white-space: nowrap; }',
    '.vp-line { font-size: 14px; color: #4a9eff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }',
    '.vp-nearby { border: none; background: transparent; color: #4a9eff; font-size: 14px; cursor: pointer; padding: 0; white-space: nowrap; }',
    '.vp-nearby:hover { text-decoration: underline; }',
    '.vp-mapwrap { position: relative; flex: 1; min-height: 0; margin-bottom: 26px; border-radius: 10px; overflow: hidden; background: rgba(128,128,128,.18); }',
    '.vp-map { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }',
    '.vp-offline { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; opacity: .65; }',
    '.vp-pin { position: relative; width: 84px; height: 84px; box-sizing: border-box; border: 3px solid #fff; border-radius: 12px;',
    '  background: #8e8e93; box-shadow: 0 2px 8px rgba(0,0,0,.45); }',
    '.vp-pin img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 9px; }',
    '.vp-pin::after { content: ""; position: absolute; left: 50%; bottom: -12px; margin-left: -9px;',
    '  border: 9px solid transparent; border-bottom-width: 0; border-top-color: #fff; }',
  ].join('\n');
  document.head.appendChild(css);

  function ViewerPlaces({ item, sheet, height, pinUrl, onWheel }) {
    const boxRef = useRef(null);
    const mapRef = useRef(null);  // { map, marker, img, theme, onTheme }
    const lastRef = useRef(null); // last located item, kept while the next one loads
    const [online, setOnline] = useState(navigator.onLine !== false);
    if (item && item.has_gps) lastRef.current = item;
    if (item && !item.has_gps) lastRef.current = null;
    const shown = lastRef.current;
    const active = sheet > 0 && !!shown;
    const lat = shown ? shown.gps_latitude : null;
    const lng = shown ? shown.gps_longitude : null;

    useEffect(() => {
      const on = () => setOnline(true); const off = () => setOnline(false);
      window.addEventListener('online', on); window.addEventListener('offline', off);
      return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    }, []);

    // Create the map the first time the section is revealed; afterwards only
    // recentre it and move the pin.
    useEffect(() => {
      if (!active || !online || !boxRef.current) return;
      const gl = window.maplibregl;
      const styles = window.__PhotosMapStyles;
      let m = mapRef.current;
      if (!m) {
        gl.setWorkerUrl(WORKER_URL);
        const theme = window.matchMedia('(prefers-color-scheme: dark)');
        const map = new gl.Map({
          container: boxRef.current, style: theme.matches ? styles.dark : styles.light,
          center: [lng, lat], zoom: 14.5, interactive: false,
          attributionControl: false,
        });
        map.on('error', (e) => console.warn('[map]', e && e.error ? e.error.message : e));
        const onTheme = () => map.setStyle(theme.matches ? styles.dark : styles.light);
        theme.addEventListener('change', onTheme);
        boxRef.current.addEventListener('click', (ev) => {
          if (ev.target && ev.target.closest && ev.target.closest('a')) ev.preventDefault();
        }, true);
        const el = document.createElement('div');
        el.className = 'vp-pin';
        const img = document.createElement('img');
        img.alt = ''; img.draggable = false;
        el.appendChild(img);
        const marker = new gl.Marker({ element: el, anchor: 'bottom', offset: [0, -12] }).setLngLat([lng, lat]).addTo(map);
        window.__PhotosMapLegal(boxRef.current);
        m = { map, marker, img, theme, onTheme };
        mapRef.current = m;
      } else {
        m.map.jumpTo({ center: [lng, lat] });
        m.marker.setLngLat([lng, lat]);
      }
      if (pinUrl && m.img.getAttribute('src') !== pinUrl) m.img.src = pinUrl;
    }, [active, online, lat, lng, pinUrl]);

    useEffect(() => () => {
      const m = mapRef.current;
      if (!m) return;
      m.theme.removeEventListener('change', m.onTheme);
      m.map.remove();
      mapRef.current = null;
    }, []);

    // Clicking the small map: full map with only this item's pin.
    function openSingle() {
      if (shown) window.__PhotosMapOverlay.open({ lat, lng, zoom: 15.5, single: { id: shown.id } });
    }
    // Nearby Photos: full map around this item, with the surrounding clusters.
    function openNearby() {
      if (!shown) return;
      if (window.__PhotosMapOverlay) { window.__PhotosMapOverlay.open({ lat, lng, zoom: 15, single: null }); return; }
      const dLng = NEARBY_DEGREES / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v)).toFixed(6);
      const filter = 'geo:' + [clamp(lat - NEARBY_DEGREES, 90), clamp(lng - dLng, 180),
        clamp(lat + NEARBY_DEGREES, 90), clamp(lng + dLng, 180)].join(',');
      S.viewerStore.close();
      S.sectionStore.set('map');
      S.mapAreaStore.set({ filter, title: placeLine(shown) || 'Map' });
    }

    const zh = isZh();
    return h('div', {
      class: 'vp-panel', onWheel,
      style: { height: height + 'px', transform: 'translateY(' + (-sheet) + 'px)', visibility: active ? 'visible' : 'hidden' },
    },
      h('div', { class: 'vp-inner' },
        h('div', { class: 'vp-head' },
          h('span', { class: 'vp-title' }, zh ? '\u5730\u70B9' : 'Places'),
          h('span', { class: 'vp-line' }, (shown && placeLine(shown)) || ''),
          h('button', { class: 'vp-nearby', type: 'button', onClick: openNearby }, zh ? '\u9644\u8FD1\u7167\u7247' : 'Nearby Photos')),
        h('div', { class: 'vp-mapwrap', style: { cursor: 'pointer' }, onClick: openSingle },
          h('div', { class: 'vp-map', ref: boxRef }),
          !online && h('div', { class: 'vp-offline' }, zh ? '\u79BB\u7EBF\u65F6\u65E0\u6CD5\u663E\u793A\u5730\u56FE' : 'Map unavailable offline'))));
  }

  window.__PhotosViewerPlaces = ViewerPlaces;
})();
