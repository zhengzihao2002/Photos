/**
 * renderer.js
 *
 * M3 real grid UI. Replaces the M1/M2 scaffolding entirely. A Preact
 * component (window.preact / window.preactHooks — see vendor/preact-bundle.js)
 * mounted into #grid-root, virtualized over lib/layout-engine.js's row
 * structure, backed by lib/data-layer.js for index-addressed item access.
 *
 * VIRTUALIZATION STRATEGY: scroll listener + binary search (layout.
 * findRowContainingOffset), not IntersectionObserver — the layout engine
 * already gives an O(log n) exact row lookup for any scrollTop, which is
 * a direct fit for absolutely-positioned, precomputed-height rows.
 *
 * RESIZE ANCHOR: before a resize-triggered re-layout, remember which ITEM
 * INDEX sits at the current scroll top (not a pixel offset) — then after
 * layout recomputes, scroll back to that same item's new top. Anchoring on
 * content identity (not pixel position) avoids a visual jump when row
 * heights shift from a resize.
 */
(function () {
  const { h, render, Fragment } = window.preact;
  const { useState, useEffect, useRef, useCallback } = window.preactHooks;

  const TARGET_ROW_HEIGHT_DEFAULT = 160;
  const GAP_SIZE = 4;
  // M6 (B.6): square grid column count (zoom changes it).
  const GRID_COLUMNS_DEFAULT = 7;
  const GRID_FOOTER_HEIGHT = 72; // M6 (B.6f): gap + photo/video counts below the last row
  // Must match .row-items horizontal padding in styles.css (0 4px).
  const ROW_PADDING_X = 4;
  const HEADER_ROW_HEIGHT = 36;
  const BUFFER_ROWS = 5;
  const THUMB_POLL_INTERVAL_MS = 1500;
  const THUMB_STUCK_POLL_THRESHOLD = 3;

  function formatDateHeader(dateStr) {
    // dateStr is 'YYYY-MM-DD'. Parsed as UTC-noon to avoid local-timezone
    // date-shifting when the string is fed to the Date constructor.
    const d = new Date(dateStr + 'T12:00:00');
    const now = new Date();
    const daysAgo = Math.floor((now - d) / 86400000);
    const opts = daysAgo < 6
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'long', year: 'numeric' };
    return d.toLocaleDateString(undefined, opts);
  }

  function formatDuration(seconds) {
    if (seconds == null) return '';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function Tile({ item, widthPx, heightPx, thumbPath, isSelected }) {
    // M10.7: Show Faces zooms this tile to the person's face, smoothly both ways.
    const [faceZoom, setFaceZoom] = useState(faceZoomStore.get());
    useEffect(() => faceZoomStore.subscribe(setFaceZoom), []);
    const faceBox = faceZoom.on && item && item.__placeholder !== true ? faceZoom.boxes.get(item.id) : null;
    const isPlaceholderItem = item.__placeholder;
    const resolved = typeof thumbPath === 'string';
    const isError = thumbPath === 'error';
    const className = 'tile' + (isSelected ? ' tile-selected' : '');

    function handleClick() {
      if (isPlaceholderItem) return;
      selectionStore.set(item.id);
    }

    function handleDblClick() {
      if (isPlaceholderItem) return;
      viewerStore.open(item.id);
    }

    return h('div', {
      className,
      style: { width: widthPx + 'px', height: heightPx + 'px' },
      onClick: handleClick,
      onDblClick: handleDblClick,
    },
      resolved && h('img', {
        className: 'tile-img', src: 'file://' + thumbPath,
        style: { 'object-view-box': faceBox ? faceInset(faceBox) : 'inset(0% 0% 0% 0%)', transition: 'object-view-box 0.35s ease' },
      }),
      isError && h('div', { className: 'tile-error' }, '\u26A0'),
      !isPlaceholderItem && item.media_type === 'video' && h('div', { className: 'tile-video-badge' },
        h('span', { className: 'tile-play-icon' }, '\u25B6'),
        item.duration_seconds != null ? h('span', null, formatDuration(item.duration_seconds)) : null
      ),
      !isPlaceholderItem && item.is_live_photo === 1 && h('div', { className: 'tile-live-badge' }, 'LIVE')
    );
  }

  function Row({ row, dataLayer, thumbCache }) {
    if (row.type === 'header') {
      return h('div', {
        className: 'row-header',
        style: { top: row.top + 'px', height: row.height + 'px' },
      }, formatDateHeader(row.date));
    }
    return h('div', {
      className: 'row-items',
      style: {
        top: row.top + 'px',
        height: row.height + 'px',
        paddingLeft: (ROW_PADDING_X + (row.leadingOffset || 0)) + 'px',
      },
    }, row.itemIndices.map((itemIndex, i) => {
      const item = dataLayer.getItemAt(itemIndex);
      return h(Tile, {
        key: itemIndex,
        item,
        widthPx: row.itemWidths[i],
        heightPx: row.height,
        thumbPath: item.__placeholder ? null : thumbCache.get(item.id),
        isSelected: !item.__placeholder && selectionStore.get() === item.id,
      });
    }));
  }

  /**
   * Tiny external store bridging Toolbar's slider (mounted into #toolbar,
   * a separate Preact root from Grid's #grid-root) to Grid's layout engine.
   * Same get/set/subscribe shape as data-layer.js's onRangeLoaded pattern.
   */
  /**
   * M6 (B.6e): square-grid column count (zoom). Clamped 3..15; saves
   * grid.columns to config.json (debounced) unless persist:false.
   */
  const GRID_COLUMNS_MIN = 3;
  const GRID_COLUMNS_MAX = 15;
  const columnsStore = (function () {
    let value = GRID_COLUMNS_DEFAULT;
    let timer = null;
    const listeners = new Set();
    const clamp = (v) => Math.max(GRID_COLUMNS_MIN, Math.min(GRID_COLUMNS_MAX, Math.round(Number(v)) || GRID_COLUMNS_DEFAULT));
    return {
      get: () => value,
      set(v, { persist = true } = {}) {
        const next = clamp(v);
        if (next === value) return;
        value = next;
        listeners.forEach((fn) => fn(next));
        if (persist) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            window.api.updateConfig({ patch: { grid: { columns: next } } })
              .catch((err) => console.error('Saving column count failed:', err));
          }, 400);
        }
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  const zoomStore = (function () {
    let value = TARGET_ROW_HEIGHT_DEFAULT;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) { value = v; listeners.forEach((fn) => fn(v)); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * Active toolbar view mode: 'years' | 'months' | 'days' | 'all'.
   * Same get/set/subscribe shape as the other stores.
   */
  const modeStore = (function () {
    let value = 'all';
    const listeners = new Set();
    return {
      get: () => value,
      set(v) { value = v; listeners.forEach((fn) => fn(v)); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * M6: the selected sidebar section -- the single source of truth for what
   * the content area shows. Value: 'library' | a Media Type key (same strings
   * as the query filters) | 'source:<id>'. Disabled sidebar items are never
   * valid values. Notifies only on change.
   */
  const SECTION_MEDIA_TYPES = ['video', 'selfie', 'live', 'panorama', 'burst', 'gif', 'raw'];
  const SECTION_SOURCE_PATTERN = /^source:[1-9]\d{0,9}$/;
  function isValidSection(v) {
    return v === 'library' || v === 'albums' || v === 'map' || v === 'people' || SECTION_MEDIA_TYPES.includes(v)
      || (typeof v === 'string' && SECTION_SOURCE_PATTERN.test(v));
  }
  const sectionStore = (function () {
    let value = 'library';
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        if (!isValidSection(v)) { console.warn('sectionStore: ignoring invalid section', v); return; }
        if (v === value) return;
        value = v;
        listeners.forEach((fn) => fn(v));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * M6: view filter for Library (All Photos) and albums: 'all' | 'photos' |
   * 'videos'. Composed into filterStore as '::kind:<value>'; ignored in
   * other sections. Resets to 'all' on every section change.
   */
  const kindStore = (function () {
    let value = 'all';
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const next = v === 'photos' || v === 'videos' ? v : 'all';
        if (next === value) return;
        value = next;
        listeners.forEach((fn) => fn(next));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * M6 (B.8): file-name search text ('' = none). Combined into filterStore,
   * so the grid, the viewer and every count respect it. Trimmed, capped.
   */
  const searchStore = (function () {
    let value = '';
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const next = String(v || '').trim().slice(0, 100);
        if (next === value) return;
        value = next;
        listeners.forEach((fn) => fn(next));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * M7.6: sub-state of the 'map' section. null = the map itself; otherwise
   * { filter: 'geo:...', title } = the photo grid of one map area. Not
   * persisted; cleared on every section change.
   */
  const mapAreaStore = (function () {
    let value = null;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const next = v && typeof v.filter === 'string' && v.filter.startsWith('geo:')
          ? { filter: v.filter, title: String(v.title || 'Map') } : null;
        if (next === null && value === null) return;
        value = next;
        listeners.forEach((fn) => fn(next));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * M10.6: sub-state of the 'people' section. null = the People page;
   * otherwise { id } = that person's photo grid. Not persisted; cleared on
   * every section change. The name is fetched where shown, so a rename never
   * remounts the grid.
   */
  const personStore = (function () {
    let value = null;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const id = v && Number.isSafeInteger(v.id) && v.id > 0 ? v.id : null;
        if ((id === null && value === null) || (id !== null && value !== null && value.id === id)) return;
        value = id === null ? null : { id };
        listeners.forEach((fn) => fn(value));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /** M10.6: bumped when people change (regrouped by the face worker, or corrected). */
  const peopleChangeStore = (function () {
    let n = 0;
    const listeners = new Set();
    const bump = () => { n += 1; listeners.forEach((fn) => fn(n)); };
    if (window.api && window.api.onProgress) {
      window.api.onProgress((p) => { if (p && p.taskId === 'face-analysis' && p.state === 'people') bump(); });
    }
    return { get: () => n, bump, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  })();

  /** M10.7: what a person's page shows: 'photos' (grid), 'faces' (face crops) or 'review' (groups). */
  const personViewStore = (function () {
    let value = 'photos';
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const next = v === 'faces' || v === 'review' ? v : 'photos';
        if (next === value) return;
        value = next;
        listeners.forEach((fn) => fn(next));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /** M10.7: an open group (Groups / 合照): { ids (ascending), names } or null. */
  const groupStore = (function () {
    let value = null;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const ids = v && Array.isArray(v.ids) ? v.ids.filter((x) => Number.isSafeInteger(x) && x > 0).sort((a, b) => a - b) : [];
        const next = ids.length >= 2 && ids.length <= 4 ? { ids, names: Array.isArray(v.names) ? v.names.map(String) : [] } : null;
        if ((next === null && value === null) || (next && value && next.ids.join(',') === value.ids.join(','))) return;
        value = next;
        listeners.forEach((fn) => fn(next));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /** M10.8: View > People. Off: no People row, no People section, no viewer section. */
  const peopleEnabledStore = (function () {
    let value = true;
    const listeners = new Set();
    const set = (v) => {
      const next = v !== false;
      if (next === value) return;
      value = next;
      listeners.forEach((fn) => fn(next));
    };
    const leavePeople = () => { if (sectionStore.get() === 'people') sectionStore.set('library'); };
    if (window.api && window.api.getPeopleEnabled) {
      window.api.getPeopleEnabled().then((r) => { set(r && r.enabled); if (value === false) leavePeople(); }).catch(() => {});
    }
    if (window.api && window.api.onPeoplePrivacy) {
      window.api.onPeoplePrivacy((p) => {
        set(p && p.enabled);
        if (value === false || (p && p.deleted)) leavePeople();
        if (p && p.deleted) {
          personStore.set(null);
          groupStore.set(null);
          addPeopleStore.set(false);
          peopleChangeStore.bump();
          libraryChangeStore.bump();
        }
      });
    }
    return { get: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  })();

  /** M10.7: the Add People screen (unnamed people) inside the People section. */
  const addPeopleStore = (function () {
    let value = false;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const next = v === true;
        if (next === value) return;
        value = next;
        listeners.forEach((fn) => fn(next));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /** M10.7: the ... menu's Show setting, 'photos' or 'faces'; applies to the grid and to Review. */
  const faceDisplayStore = (function () {
    let value = 'photos';
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const next = v === 'faces' ? 'faces' : 'photos';
        if (next === value) return;
        value = next;
        listeners.forEach((fn) => fn(next));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * M10.7: Show Faces. When on, every tile of the person's grid crops smoothly
   * to that person's face (the larger one if they appear twice in a photo).
   */
  const faceZoomStore = (function () {
    let value = { on: false, boxes: new Map() };
    const listeners = new Set();
    let seq = 0;
    const emit = () => listeners.forEach((fn) => fn(value));
    async function refresh() {
      const p = personStore.get();
      const on = sectionStore.get() === 'people' && p != null && faceDisplayStore.get() === 'faces';
      const mine = ++seq;
      if (on === false) { if (value.on) { value = { on: false, boxes: value.boxes }; emit(); } return; }
      try {
        const rows = await window.api.getPersonFaces(p.id);
        if (mine !== seq) return;
        const boxes = new Map();
        for (const r of rows) {
          const b = boxes.get(r.itemId);
          if (b == null || r.box[2] * r.box[3] > b[2] * b[3]) boxes.set(r.itemId, r.box);
        }
        value = { on: true, boxes };
        emit();
      } catch (err) { console.error('Face zoom failed:', err); }
    }
    personStore.subscribe(refresh);
    personViewStore.subscribe(refresh);
    faceDisplayStore.subscribe(refresh);
    sectionStore.subscribe(refresh);
    peopleChangeStore.subscribe(refresh);
    return { get: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  })();

  /** M10.7: CSS object-view-box region around a face box (fractions of the image). */
  function faceInset(b) {
    const k = 1.8;
    const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
    const w = Math.min(1, b[2] * k), hh = Math.min(1, b[3] * k);
    const l = Math.min(Math.max(0, cx - w / 2), 1 - w), t = Math.min(Math.max(0, cy - hh / 2), 1 - hh);
    const pct = (v) => (Math.max(0, v) * 100).toFixed(2) + '%';
    return 'inset(' + pct(t) + ' ' + pct(1 - l - w) + ' ' + pct(1 - t - hh) + ' ' + pct(l) + ')';
  }

  /**
   * M6: the query filter for the current section, as a thin view over
   * sectionStore so the two can never disagree. get() is null in Library,
   * else the section string. Read by Grid and (M5 contract) the viewer.
   */
  const filterStore = {
    // 'albums' (the All Albums overview) is a page of cards, not a filtered
    // photo list, so it has no filter.
    get: () => {
      const sec = sectionStore.get();
      // M7.5: the map page itself is not a filtered photo list either.
      if (sec === 'albums') return null;
      if (sec === 'map') {
        // M7.6: a map-area grid uses the area's geo filter (plus search).
        const area = mapAreaStore.get();
        if (!area) return null;
        const mapKind = kindStore.get();
        const mapSearch = searchStore.get();
        return area.filter + (mapKind !== 'all' ? '::kind:' + mapKind : '')
          + (mapSearch ? '::search:' + encodeURIComponent(mapSearch) : '');
      }
      if (sec === 'people') {
        // M10.6: a person's grid uses person:<id> (plus view filter and search).
        const group = groupStore.get();
        if (group) {
          const gk = kindStore.get();
          const gs = searchStore.get();
          return 'group:' + group.ids.join(',') + (gk !== 'all' ? '::kind:' + gk : '')
            + (gs ? '::search:' + encodeURIComponent(gs) : '');
        }
        const person = personStore.get();
        if (!person) return null;
        const pk = kindStore.get();
        const ps = searchStore.get();
        return 'person:' + person.id + (pk !== 'all' ? '::kind:' + pk : '')
          + (ps ? '::search:' + encodeURIComponent(ps) : '');
      }
      const base = sec === 'library' ? null : sec;
      const kind = kindStore.get();
      const kindApplies = kind !== 'all' && (sec === 'library' || /^source:\d+$/.test(sec));
      let f = base || '';
      if (kindApplies) f += '::kind:' + kind;
      const q = searchStore.get();
      if (q) f += '::search:' + encodeURIComponent(q);
      return f || null;
    },
    set: (f) => sectionStore.set(f === null ? 'library' : f),
    subscribe: (fn) => {
      const offSection = sectionStore.subscribe(() => fn(filterStore.get()));
      const offSearch = searchStore.subscribe(() => fn(filterStore.get()));
      const offKind = kindStore.subscribe(() => fn(filterStore.get()));
      const offArea = mapAreaStore.subscribe(() => fn(filterStore.get()));
      const offPerson = personStore.subscribe(() => fn(filterStore.get()));
      const offGroup = groupStore.subscribe(() => fn(filterStore.get()));
      return () => { offSection(); offSearch(); offKind(); offArea(); offPerson(); offGroup(); };
    },
  };

  /**
   * M6 (B.4): sidebar visibility. Applies body.sidebar-hidden (styles.css),
   * persists sidebar.visible to config.json. toggle() is used by the View
   * menu item and the toolbar buttons (grid + viewer).
   */
  const sidebarVisibleStore = (function () {
    let value = true;
    const listeners = new Set();
    const store = {
      get: () => value,
      set(v, { persist = true } = {}) {
        const next = Boolean(v);
        if (next === value) return;
        value = next;
        document.body.classList.toggle('sidebar-hidden', !next);
        listeners.forEach((fn) => fn(next));
        if (persist) {
          window.api.updateConfig({ patch: { sidebar: { visible: next } } })
            .catch((err) => console.error('Saving sidebar visibility failed:', err));
        }
      },
      toggle: () => store.set(!value),
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
    return store;
  })();

  /**
   * M6 (B.6d): oldest/newest capture date of the items actually on screen in
   * the grid, { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } or null. Shown under
   * the 'Library' title in All Photos. Notifies only when it changes.
   */
  const dateRangeStore = (function () {
    let value = null;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) {
        const same = (v === null && value === null)
          || (v && value && v.start === value.start && v.end === value.end);
        if (same) return;
        value = v;
        listeners.forEach((fn) => fn(v));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * Jump-to-period signal for Years/Months/Days tile clicks. target is
   * { year } | { year, month } | { date } | { itemIndex } (M5 viewer
   * return-to-grid: an exact grid index). Grid resolves it against its own
   * dateSections + layout once ready, then scrolls there. requestId lets a
   * repeat click on the same period re-trigger.
   */
  const navigationStore = (function () {
    let value = null;
    let nextRequestId = 1;
    const listeners = new Set();
    return {
      get: () => value,
      goTo(target) {
        value = Object.assign({}, target, { requestId: nextRequestId++ });
        listeners.forEach((fn) => fn(value));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();
  // Module-scope (not per-Grid-instance) so remounting Grid without a new
  // click never re-triggers an already-handled navigation request.
  let consumedNavRequestId = null;

  function navigateToPeriod(target) {
    navigationStore.goTo(target);
    modeStore.set('all');
  }

  /**
   * M6 (B.6c): pill-shaped segmented control. Years / Months / All Photos
   * (Days removed, as in macOS 26 Photos); one raised pill slides under the
   * active option. A saved 'days' mode falls back to 'months'.
   */
  function SegmentedControl() {
    const [mode, setMode] = useState(modeStore.get());
    useEffect(() => modeStore.subscribe(setMode), []);
    useEffect(() => { if (modeStore.get() === 'days') modeStore.set('months'); }, []);
    const options = [
      { key: 'years', label: 'Years' },
      { key: 'months', label: 'Months' },
      { key: 'all', label: 'All Photos' },
    ];
    const effective = mode === 'days' ? 'months' : mode;
    const activeIndex = Math.max(0, options.findIndex((o) => o.key === effective));
    return h('div', { className: 'seg', role: 'tablist', 'aria-label': 'View' },
      h('span', {
        className: 'seg-indicator',
        'aria-hidden': 'true',
        style: {
          width: 'calc((100% - 6px) / ' + options.length + ')',
          transform: 'translateX(' + (activeIndex * 100) + '%)',
        },
      }),
      options.map((opt, i) => h('button', {
        key: opt.key,
        type: 'button',
        role: 'tab',
        'aria-selected': String(i === activeIndex),
        className: 'seg-btn' + (i === activeIndex ? ' is-active' : ''),
        onClick: () => modeStore.set(opt.key),
      }, opt.label)));
  }

  /**
   * Selection + viewer-open signal, for M5 to consume later. Same
   * get/set/subscribe shape as zoomStore. M5 should:
   *   selectionStore.subscribe(cb) -- cb(itemId | null) on every selection change
   *   viewerStore.subscribe(cb)    -- cb({ itemId, requestId }) on every double-click
   *                                   or Enter-key (M3.9) 'open viewer' request, even
   *                                   repeated requests for the same already-open item
   *                                   (requestId increments monotonically so repeats
   *                                   are distinguishable from the first request).
   *   M5: viewerStore.close() sets the value to null and notifies cb(null).
   *       viewerStore.get() !== null  <=>  the viewer is open.
   */
  const selectionStore = (function () {
    let value = null;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) { value = v; listeners.forEach((fn) => fn(v)); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  const viewerStore = (function () {
    let value = null;
    let nextRequestId = 1;
    const listeners = new Set();
    return {
      get: () => value,
      open(itemId) {
        value = { itemId, requestId: nextRequestId++ };
        listeners.forEach((fn) => fn(value));
      },
      close() {
        if (value === null) return;
        value = null;
        listeners.forEach((fn) => fn(null));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * Library-changed signal. Anything that changes the library's contents
   * (add folder, remove folder, scan completing) calls bump(); Grid
   * subscribes and calls dataLayer.refresh(). Same get/set/subscribe shape
   * as the other stores; get() returns a monotonically increasing version.
   */
  const libraryChangeStore = (function () {
    let version = 0;
    const listeners = new Set();
    return {
      get: () => version,
      bump() { version++; listeners.forEach((fn) => fn(version)); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * Scan progress for the current scan, or null when idle. Only task IDs
   * starting with 'scan-' (see scan-manager.js) are tracked here.
   */
  const progressStore = (function () {
    let value = null;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) { value = v; listeners.forEach((fn) => fn(v)); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * M6 (B.5): id of the source folder scanQueue is currently scanning, or
   * null. Drives the sidebar's per-album scanning indicator.
   */
  const scanStatusStore = (function () {
    let value = null;
    const listeners = new Set();
    return {
      get: () => value,
      set(v) { if (v === value) return; value = v; listeners.forEach((fn) => fn(v)); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  })();

  /**
   * M6 (B.5): one short user-facing notice (e.g. why a folder was not added);
   * null = none. Auto-clears after 8 s. Shown at the bottom of the sidebar.
   */
  const noticeStore = (function () {
    let value = null;
    let timer = null;
    const listeners = new Set();
    const store = {
      get: () => value,
      set(msg) {
        clearTimeout(timer);
        value = msg || null;
        listeners.forEach((fn) => fn(value));
        if (value) timer = setTimeout(() => store.set(null), 8000);
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
    return store;
  })();

  /**
   * Serializes scans, since scan-manager accepts only one at a time. A
   * finished scan bumps libraryChangeStore and starts the next queued one.
   */
  const scanQueue = (function () {
    // M8b.2: thin client. Ordering, coalescing and retry live in the main
    // process (scan-queue.js), which never rejects a request as busy and
    // keeps working with no window open. Same enqueue() API as before.
    function isTerminal(msg) {
      return msg === 'Scan complete' ||
        msg === 'Source folder not found' ||
        (typeof msg === 'string' && msg.startsWith('Scan failed'));
    }

    function applyState(st) {
      const running = st && st.running != null ? st.running : null;
      scanStatusStore.set(running);
      if (running == null) progressStore.set(null);
    }

    function onProgress(payload) {
      if (!payload || typeof payload.taskId !== 'string' || !payload.taskId.startsWith('scan-')) return;
      if (isTerminal(payload.message)) {
        progressStore.set(null);
        libraryChangeStore.bump(); // once per finished scan
      } else {
        progressStore.set({ current: payload.current, total: payload.total });
      }
    }

    window.api.onProgress(onProgress);
    window.api.onScanQueueState(applyState);
    window.api.getScanQueueState().then(applyState, () => {});

    return {
      enqueue(job) {
        window.api.enqueueScan({ sourceFolderId: job.sourceFolderId, kind: 'full' })
          .then((res) => { if (!res || !res.queued) console.warn('Scan not queued:', res && res.reason); })
          .catch((err) => noticeStore.set('Could not start a scan: ' + err.message));
      },
    };
  })();

  /**
   * M6 (B.5): the one implementation of folder (album) operations, shared by
   * the sidebar (+ button, context menu), File > Add Folder and drag-and-drop.
   * Never touches photo files: add/relink register a path, remove deletes
   * only index rows. Confirmation for remove is the caller's job (native
   * dialog). Problems are reported through noticeStore.
   */
  const folderName = (p) => String(p).split('/').filter(Boolean).pop() || String(p);
  // B.5: native alert sheet when an add attempt added nothing.
  function showAddProblems(title, lines) {
    window.api.showMessage({ type: 'warning', message: title, detail: lines.join('\n'), buttons: ['OK'] })
      .catch((err) => console.error('Alert failed:', err));
  }
  const folderActions = {
    async addPaths(paths, extraProblems = []) {
      const problems = [];
      let addedAny = false;
      for (const rootPath of paths) {
        try {
          const res = await window.api.addSource({ rootPath });
          if (!res || !res.added) {
            problems.push('\u201C' + folderName(rootPath) + '\u201D: ' + ((res && res.reason) || 'could not be added'));
            continue;
          }
          addedAny = true;
          scanQueue.enqueue({ sourceFolderId: res.id, sourceRootPath: rootPath });
        } catch (err) {
          problems.push('\u201C' + folderName(rootPath) + '\u201D: ' + err.message);
        }
      }
      const allProblems = problems.concat(extraProblems);
      if (!addedAny && allProblems.length) {
        noticeStore.set(null);
        showAddProblems(paths.length > 1 ? 'Couldn\u2019t Add Folders' : 'Couldn\u2019t Add Folder', allProblems);
      } else {
        noticeStore.set(allProblems.length ? allProblems.join('\n') : null);
      }
      if (addedAny) libraryChangeStore.bump();
      return { addedAny, problems: allProblems };
    },
    async pickAndAdd() {
      const picked = await window.api.pickFolders();
      if (!picked || picked.canceled || picked.paths.length === 0) return { addedAny: false, problems: [] };
      return folderActions.addPaths(picked.paths);
    },
    rescan(source) {
      if (source.status !== 'ok') {
        noticeStore.set('\u201C' + source.displayName + '\u201D cannot be found. Use Relink\u2026 to locate it.');
        return;
      }
      scanQueue.enqueue({ sourceFolderId: source.id, sourceRootPath: source.rootPath });
    },
    async remove(source) {
      const res = await window.api.removeSource({ sourceFolderId: source.id });
      if (!res || !res.removed) {
        noticeStore.set('Could not remove \u201C' + source.displayName + '\u201D: ' + ((res && res.reason) || 'unknown error'));
        return res;
      }
      if (sectionStore.get() === 'source:' + source.id) sectionStore.set('library');
      libraryChangeStore.bump();
      return res;
    },
    async rescanAll() {
      const sources = (await window.api.listSources()) || []; // also refreshes found/missing
      if (sources.length === 0) {
        noticeStore.set('There are no folders to rescan. Add one with File \u2192 Add Folder\u2026');
        return;
      }
      const skipped = [];
      sources.forEach((src) => {
        if (src.status === 'ok') scanQueue.enqueue({ sourceFolderId: src.id, sourceRootPath: src.rootPath });
        else skipped.push('\u201C' + src.displayName + '\u201D');
      });
      if (skipped.length) {
        noticeStore.set('Skipped (not found): ' + skipped.join(', ') + '. Use Relink\u2026 to locate '
          + (skipped.length === 1 ? 'it.' : 'them.'));
      }
    },
    async relinkViaPicker(source) {
      const picked = await window.api.pickFolders();
      if (!picked || picked.canceled || picked.paths.length === 0) return null;
      return folderActions.relink(source, picked.paths[0]);
    },
    async relink(source, newRootPath) {
      const res = await window.api.relinkSource({ sourceFolderId: source.id, newRootPath });
      if (!res || !res.relinked) {
        noticeStore.set('Could not relink \u201C' + source.displayName + '\u201D: ' + ((res && res.reason) || 'unknown error'));
        return res;
      }
      scanQueue.enqueue({ sourceFolderId: source.id, sourceRootPath: newRootPath });
      libraryChangeStore.bump();
      return res;
    },
  };
  window.__PhotosFolderActions = folderActions;

  /**
   * M6 (B.5): right-click menu for an album (sidebar row or All Albums
   * card). Main shows the native menu, handles Show in Finder and the
   * Relink picker; the chosen action runs through folderActions here.
   * Remove asks for confirmation first (native sheet, Cancel is default).
   */
  async function openAlbumContextMenu(e, source) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    let res;
    try {
      res = await window.api.showAlbumContextMenu(source.id);
    } catch (err) {
      noticeStore.set('Could not open the menu: ' + err.message);
      return;
    }
    if (!res || !res.action) return;
    if (res.action === 'rescan') { folderActions.rescan(source); return; }
    if (res.action === 'rescan-all') { folderActions.rescanAll(); return; }
    if (res.action === 'relink') { await folderActions.relink(source, res.newRootPath); return; }
    if (res.action === 'remove') {
      if (scanStatusStore.get() === source.id) {
        window.api.showMessage({
          type: 'info',
          message: '\u201C' + source.displayName + '\u201D is being scanned',
          detail: 'Please wait until scanning finishes, then try again.',
        }).catch(() => {});
        return;
      }
      const { response } = await window.api.showMessage({
        type: 'warning',
        message: 'Remove \u201C' + source.displayName + '\u201D from Photos?',
        detail: 'Its photos and videos will no longer appear in Photos. The folder and every file in it stay exactly where they are on your Mac \u2014 nothing is deleted, moved, or changed.\n\nYou can add the folder again at any time.',
        buttons: ['Cancel', 'Remove'],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 1) await folderActions.remove(source);
    }
  }
  window.__PhotosAlbumContextMenu = openAlbumContextMenu;

  /**
   * M6 (B.6g): right-click menu for a photo/video tile. Selects the item,
   * shows the native menu (main handles Show in Finder), then runs the
   * chosen action. Get Info opens the viewer and asks it (window event
   * 'photos:show-info') to show the Info panel.
   */
  async function openPhotoContextMenu(e, item) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    selectionStore.set(item.id);
    // M10.7: on a person's page the menu offers Not <name> / Remove This Group.
    const onPerson = sectionStore.get() === 'people' ? personStore.get() : null;
    let res;
    try {
      res = await window.api.showPhotoContextMenu(item.id, onPerson ? onPerson.id : null);
    } catch (err) {
      noticeStore.set('Could not open the menu: ' + err.message);
      return;
    }
    if (!res || !res.action) return;
    if (res.action === 'info') {
      viewerStore.open(item.id);
      window.dispatchEvent(new CustomEvent('photos:show-info'));
      return;
    }
    if (res.action === 'rescan-all') {
      folderActions.rescanAll().catch((err) => noticeStore.set('Could not rescan: ' + err.message));
    }
    if (onPerson && (res.action === 'not-person' || res.action === 'remove-group' || res.action === 'key-photo')) {
      try {
        if (res.action === 'key-photo') {
          await window.api.setPersonKeyPhoto(onPerson.id, item.id);
          return; // covers only: the grid's photos are unchanged, so no reload (avoids a flash)
        } else if (res.action === 'not-person') {
          await window.api.removePhotoFromPerson(onPerson.id, item.id);
        } else {
          const info = await window.api.getPerson(onPerson.id);
          const who = (info && info.name) || 'this person';
          if (window.confirm('These faces are not ' + who + '? They will become a separate person.') === false) return;
          await window.api.removeClusterFromPerson(onPerson.id, res.clusterId);
        }
      } catch (err) { noticeStore.set('Could not change this person: ' + err.message); }
      peopleChangeStore.bump();
    }
  }

  // M6 (B.6d): 'Nov 10 - Dec 25, 2025' style date ranges.
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function formatDateRange(start, end) {
    const a = start.split('-').map(Number);
    const b = end.split('-').map(Number);
    const md = (p) => MONTHS_SHORT[p[1] - 1] + ' ' + p[2];
    const dash = ' \u2013 ';
    if (start === end) return md(a) + ', ' + a[0];
    if (a[0] !== b[0]) return md(a) + ', ' + a[0] + dash + md(b) + ', ' + b[0];
    if (a[1] === b[1]) return MONTHS_SHORT[a[1] - 1] + ' ' + a[2] + dash + b[2] + ', ' + a[0];
    return md(a) + dash + md(b) + ', ' + a[0];
  }

  /** M6 (B.6d): 'Library' + visible date range, shown in All Photos only. */
  function LibraryTitle() {
    const [range, setRange] = useState(dateRangeStore.get());
    useEffect(() => dateRangeStore.subscribe(setRange), []);
    return h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.2, minWidth: 0 } },
      h('div', { style: { fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' } }, 'Library'),
      h('div', { style: { fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', opacity: 0.8, whiteSpace: 'nowrap' } },
        range ? formatDateRange(range.start, range.end) : '\u00A0'));
  }

  // M6: toolbar titles for collection sections (labels mirror sidebar.js).
  const SECTION_TITLES = {
    video: 'Videos', selfie: 'Selfies', live: 'Live Photos', panorama: 'Panoramas',
    burst: 'Bursts', gif: 'Animated', raw: 'RAW', albums: 'Albums', map: 'Map',
  };

  /**
   * Toolbar title for collection sections. M6 (B.6h follow-up): in an album
   * (source folder) a second line shows its photo/video counts and its
   * oldest-to-newest capture date range.
   */
  function SectionTitle({ section, sourceNames }) {
    const sourceMatch = /^source:(\d+)$/.exec(section);
    const [area, setArea] = useState(mapAreaStore.get());
    useEffect(() => mapAreaStore.subscribe(setArea), []);
    // M10.6: a person page shows the name (or Add Name) with photo count and dates.
    const [person, setPerson] = useState(personStore.get());
    useEffect(() => personStore.subscribe(setPerson), []);
    const [personInfo, setPersonInfo] = useState(null);
    const [addPeopleOpen, setAddPeopleOpen] = useState(addPeopleStore.get()); // M10.7
    useEffect(() => addPeopleStore.subscribe(setAddPeopleOpen), []);
    const [group, setGroup] = useState(groupStore.get());
    useEffect(() => groupStore.subscribe(setGroup), []);
    const groupTitle = group ? (group.names.length === 2 ? group.names.join(' & ')
      : group.names.slice(0, -1).join(', ') + ' & ' + group.names[group.names.length - 1]) : '';
    // M10.7: click the person's title to name them (Apple: name from the person's page).
    const [editingName, setEditingName] = useState(false);
    useEffect(() => setEditingName(false), [person]);
    useEffect(() => {
      const open = () => setEditingName(true);
      window.addEventListener('photos:name-person', open);
      return () => window.removeEventListener('photos:name-person', open);
    }, []);
    // Return closes the field, which also fires blur: save only once per editing session.
    const nameCommitting = useRef(false);
    useEffect(() => { if (editingName) nameCommitting.current = false; }, [editingName]);
    async function commitPersonName(value) {
      if (nameCommitting.current) return;
      nameCommitting.current = true;
      setEditingName(false);
      const name = String(value || '').trim();
      if (person == null || name === ((personInfo && personInfo.name) || '')) return;
      try {
        const r = await window.api.renamePerson(person.id, name);
        if (r && r.ok === false && r.sameNameId) {
          if (window.confirm('A person named \u201C' + name + '\u201D already exists. Merge these people?')) {
            await window.api.mergePeople(r.sameNameId, [person.id]);
            personStore.set({ id: r.sameNameId });
          }
        }
      } catch (err) { noticeStore.set('Could not name this person: ' + err.message); }
      peopleChangeStore.bump();
    }
    useEffect(() => {
      setPersonInfo(null);
      if (section !== 'people' || !person) return undefined;
      let alive = true;
      const load = () => window.api.getPerson(person.id).then((p) => { if (alive) setPersonInfo(p); }).catch(() => {});
      load();
      const off = peopleChangeStore.subscribe(load);
      return () => { alive = false; off(); };
    }, [section, person]);
    const title = section === 'people'
      ? (person ? ((personInfo && personInfo.name) || 'Add Name') : (group ? groupTitle : (addPeopleOpen ? 'Add People' : 'People')))
      : sourceMatch
      ? (sourceNames[Number(sourceMatch[1])] || 'Folder')
      : (section === 'map' && area
        ? (/^zh/i.test(navigator.language || '') ? '\u5730\u70B9' : 'Places')
        : (SECTION_TITLES[section] || ''));
    const [summary, setSummary] = useState(null);
    useEffect(() => {
      setSummary(null);
      // M7.5: the Map section shows counts too (all GPS items), no date range.
      const isMap = section === 'map';
      const isPerson = section === 'people' && person != null;
      const isGroup = section === 'people' && person == null && group != null;
      if (!isMap && !isPerson && !isGroup && !/^source:\d+$/.test(section)) return undefined;
      const summaryFilter = isPerson ? 'person:' + person.id : (isGroup ? 'group:' + group.ids.join(',')
        : (isMap ? (area ? area.filter : 'gps') : section));
      let alive = true;
      const load = () => Promise.all([
        window.api.getPhotoVideoCounts({ filter: summaryFilter }),
        isMap ? [] : window.api.getCountsByDate({ filter: summaryFilter }),
      ]).then(([counts, dates]) => {
        if (!alive) return;
        const list = (Array.isArray(dates) ? dates : []).map((d) => d && d.date).filter(Boolean);
        let start = null;
        let end = null;
        list.forEach((d) => {
          if (start === null || d < start) start = d;
          if (end === null || d > end) end = d;
        });
        setSummary({ photos: counts.photos, videos: counts.videos, start, end });
      }).catch((err) => console.error('Album summary failed:', err));
      load();
      const unsubscribe = libraryChangeStore.subscribe(load);
      const unsubscribePeople = peopleChangeStore.subscribe(load);
      return () => { alive = false; unsubscribe(); unsubscribePeople(); };
    }, [section, area, person, group]);

    const titleEl = h('div', {
      style: {
        fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '40vw',
      },
    }, title);
    if (section === 'people' && !person && !group && addPeopleOpen) {
      // M10.7: back from Add People to the People page.
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } },
        h('button', {
          type: 'button', title: 'Back to People', onClick: () => addPeopleStore.set(false),
          style: {
            WebkitAppRegion: 'no-drag', border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--text-primary)', fontSize: '24px', fontWeight: 400, lineHeight: 1, padding: '0 8px 4px', borderRadius: '6px', whiteSpace: 'nowrap',
          },
        }, '\u2039'),
        titleEl);
    }
    if (!sourceMatch && section !== 'map' && !(section === 'people' && (person || group))) return titleEl;

    const count = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many);
    const parts = [];
    if (summary) {
      if (summary.photos > 0) parts.push(count(summary.photos, 'Photo', 'Photos'));
      if (summary.videos > 0) parts.push(count(summary.videos, 'Video', 'Videos'));
      if (summary.start && summary.end) parts.push(formatDateRange(summary.start, summary.end));
    }
    const nameEl = section === 'people' && person
      ? (editingName
        ? h('input', {
          type: 'text', defaultValue: (personInfo && personInfo.name) || '', placeholder: 'Add Name', maxLength: 100,
          ref: (el) => { if (el && el.dataset.focused !== '1') { el.dataset.focused = '1'; el.focus(); el.select(); } },
          onKeyDown: (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitPersonName(e.currentTarget.value);
            else if (e.key === 'Escape') setEditingName(false);
          },
          onBlur: (e) => { if (editingName) commitPersonName(e.currentTarget.value); },
          style: {
            WebkitAppRegion: 'no-drag', width: '240px', fontSize: '15px', fontWeight: 700, padding: '1px 6px', borderRadius: '5px',
            border: '1px solid var(--accent, #2f7ff7)', background: 'transparent', color: 'var(--text-primary)', outline: 'none',
          },
        })
        : h('button', {
          type: 'button', title: (personInfo && personInfo.name) ? 'Rename' : 'Name this person', onClick: () => setEditingName(true),
          style: { WebkitAppRegion: 'no-drag', border: 'none', background: 'transparent', padding: 0, cursor: 'text', textAlign: 'left', minWidth: 0 },
        }, titleEl))
      : titleEl;
    const titleBlock = h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.2, minWidth: 0 } },
      nameEl,
      h('div', { style: { fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', opacity: 0.8, whiteSpace: 'nowrap' } },
        parts.length ? parts.join(' \u00B7 ') : '\u00A0'));
    if (section === 'people' && !person && group) {
      // M10.7: back from a group's grid to the People page.
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } },
        h('button', {
          type: 'button', title: 'Back to People', onClick: () => groupStore.set(null),
          style: {
            WebkitAppRegion: 'no-drag', border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--text-primary)', fontSize: '24px', fontWeight: 400, lineHeight: 1, padding: '0 8px 4px', borderRadius: '6px', whiteSpace: 'nowrap',
          },
        }, '\u2039'),
        titleBlock);
    }
    if (section === 'people' && person) {
      // M10.6: back from a person's grid to the People page.
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } },
        h('button', {
          type: 'button', title: 'Back to People', onClick: () => personStore.set(null),
          style: {
            WebkitAppRegion: 'no-drag', border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--text-primary)', fontSize: '24px', fontWeight: 400, lineHeight: 1, padding: '0 8px 4px', borderRadius: '6px', whiteSpace: 'nowrap',
          },
        }, '\u2039'),
        titleBlock);
    }
    if (!(section === 'map' && area)) return titleBlock;
    // M7.6: back from a map-area grid to the map (same position).
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } },
      h('button', {
        type: 'button', title: 'Back to Map', onClick: () => mapAreaStore.set(null),
        style: {
          WebkitAppRegion: 'no-drag', border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--text-primary)', fontSize: '24px', fontWeight: 400, lineHeight: 1, padding: '0 8px 4px', borderRadius: '6px', whiteSpace: 'nowrap',
        },
      }, '\u2039'),
      titleEl);
  }

  /**
   * M6 (B.4): sidebar toggle for toolbars, shown only while the sidebar is
   * hidden (when visible, the toggle lives in the sidebar panel itself, as
   * in Apple Photos). Exposed as window.__PhotosSidebarToggleButton so the
   * viewer toolbar reuses the identical control.
   */
  function SidebarToggleButton() {
    const [visible, setVisible] = useState(sidebarVisibleStore.get());
    useEffect(() => sidebarVisibleStore.subscribe(setVisible), []);
    if (visible) return null;
    return h('button', {
      className: 'toolbar-sidebar-toggle',
      type: 'button',
      title: 'Show Sidebar',
      'aria-label': 'Show Sidebar',
      onClick: () => sidebarVisibleStore.toggle(),
    }, h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      h('path', {
        d: 'M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z M6 3.5v9',
        fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      })));
  }
  window.__PhotosSidebarToggleButton = SidebarToggleButton;

  /**
   * M6 (B.5g): in an album whose folder can't be found, a 'Folder not found'
   * notice with Relink... beside the title. The album still shows its indexed
   * photos; Relink repoints it (same id and photos) and rescans.
   */
  function MissingFolderBar({ section, sourceRows }) {
    const match = /^source:(\d+)$/.exec(section);
    const src = match ? sourceRows[Number(match[1])] : null;
    if (!src || src.status === 'ok') return null;
    return h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '14px',
        fontSize: '12px', color: 'var(--text-secondary)', WebkitAppRegion: 'no-drag', whiteSpace: 'nowrap',
      },
    },
      h('span', { style: { color: '#ff9f0a', fontSize: '13px' } }, '\u26A0'),
      h('span', null, 'Folder not found'),
      h('button', {
        type: 'button',
        onClick: () => folderActions.relinkViaPicker(src),
        style: {
          WebkitAppRegion: 'no-drag', background: 'none', border: '1px solid var(--divider)', borderRadius: '6px',
          color: 'var(--text-primary)', padding: '3px 10px', fontSize: '12px', cursor: 'default',
        },
      }, 'Relink\u2026'));
  }

  /**
   * M6 (B.6e): zoom as a -/+ pill (as in macOS 26 Photos). - adds a column
   * (smaller tiles); + removes one (bigger tiles). Disabled at the limits.
   */
  /**
   * M6: view-filter button (albums and All Photos). Opens the native
   * All Items / Photos / Videos menu just below itself; highlighted while a
   * filter other than All Items is active.
   */
  function ViewFilterButton() {
    const [kind, setKind] = useState(kindStore.get());
    const btnRef = useRef(null);
    useEffect(() => kindStore.subscribe(setKind), []);
    const openMenu = async () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      try {
        const res = await window.api.showViewFilterMenu(kindStore.get(), r.left, r.bottom + 6);
        if (res && res.choice) kindStore.set(res.choice);
      } catch (err) {
        console.error('View filter menu failed:', err);
      }
    };
    const label = kind === 'photos' ? 'View: Photos' : kind === 'videos' ? 'View: Videos' : 'View: All Items';
    return h('div', { className: 'filter-pill' + (kind !== 'all' ? ' is-active' : '') },
      h('button', { ref: btnRef, type: 'button', className: 'filter-btn', title: label, 'aria-label': label, onClick: openMenu },
        h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
          h('path', { d: 'M3 5h10 M5 8h6 M7 11h2', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }))));
  }

  /**
   * M6 (B.8): file-name search field. Commits to searchStore 250 ms after
   * typing stops; x or Esc clears. Keys typed here never reach the grid.
   */
  function SearchField() {
    const [text, setText] = useState(searchStore.get());
    const timerRef = useRef(null);
    useEffect(() => searchStore.subscribe((q) => { setText((t) => (t.trim() === q ? t : q)); }), []);
    useEffect(() => () => clearTimeout(timerRef.current), []);
    const commitSoon = (v) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => searchStore.set(v), 250);
    };
    const clear = () => { clearTimeout(timerRef.current); setText(''); searchStore.set(''); };
    return h('div', { className: 'search-pill' + (text ? ' has-text' : '') },
      h('svg', { className: 'search-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', { d: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z M11 11l3.5 3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' })),
      h('input', {
        className: 'search-input',
        type: 'text',
        placeholder: 'Search',
        spellcheck: false,
        'aria-label': 'Search by file name',
        value: text,
        onInput: (e) => { setText(e.target.value); commitSoon(e.target.value); },
        onKeyDown: (e) => {
          e.stopPropagation(); // keep arrows/Enter/Space away from the grid
          if (e.key === 'Escape') { clear(); e.target.blur(); }
        },
      }),
      text && h('button', {
        className: 'search-clear', type: 'button', title: 'Clear', 'aria-label': 'Clear search', onClick: clear,
      }, '\u00D7'));
  }

  // M6 (B.6e): Apple-style discrete zoom levels (columns across). Each step is
  // a big, visible magnification instead of a one-column reshuffle.
  const ZOOM_LEVELS = [3, 5, 7, 9, 12, 15];
  /** Next level in a direction: +1 = more columns (zoom out), -1 = fewer (zoom in). */
  function nextZoomLevel(current, dir) {
    if (dir > 0) {
      const up = ZOOM_LEVELS.find((l) => l > current);
      return up !== undefined ? up : current;
    }
    for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
      if (ZOOM_LEVELS[i] < current) return ZOOM_LEVELS[i];
    }
    return current;
  }

  function ZoomPill({ cols }) {
    const icon = (d) => h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      h('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
    return h('div', { className: 'zoom-pill' },
      h('button', {
        type: 'button', className: 'zoom-btn', title: 'Zoom Out', 'aria-label': 'Zoom Out',
        disabled: cols >= GRID_COLUMNS_MAX,
        onClick: () => columnsStore.set(nextZoomLevel(columnsStore.get(), +1)),
      }, icon('M4 8h8')),
      h('span', { className: 'zoom-divider', 'aria-hidden': 'true' }),
      h('button', {
        type: 'button', className: 'zoom-btn', title: 'Zoom In', 'aria-label': 'Zoom In',
        disabled: cols <= GRID_COLUMNS_MIN,
        onClick: () => columnsStore.set(nextZoomLevel(columnsStore.get(), -1)),
      }, icon('M4 8h8 M8 4v8')));
  }

  function Toolbar() {
    const [value, setValue] = useState(TARGET_ROW_HEIGHT_DEFAULT);
    const [mode, setMode] = useState(modeStore.get());
    useEffect(() => modeStore.subscribe(setMode), []);
    const [section, setSection] = useState(sectionStore.get());
    useEffect(() => sectionStore.subscribe(setSection), []);
    const [cols, setCols] = useState(columnsStore.get());
    // Re-read on subscribe: the saved value may have loaded before this ran.
    useEffect(() => { setCols(columnsStore.get()); return columnsStore.subscribe(setCols); }, []);
    // M7.6g: the Map section's toolbar differs between the map and an area page.
    const [mapArea, setMapArea] = useState(mapAreaStore.get());
    useEffect(() => mapAreaStore.subscribe(setMapArea), []);
    const [personSel, setPersonSel] = useState(personStore.get()); // M10.6
    useEffect(() => personStore.subscribe(setPersonSel), []);
    const [personViewSel, setPersonViewSel] = useState(personViewStore.get());
    useEffect(() => personViewStore.subscribe(setPersonViewSel), []);
    const [faceDisplaySel, setFaceDisplaySel] = useState(faceDisplayStore.get());
    useEffect(() => faceDisplayStore.subscribe(setFaceDisplaySel), []);
    const [addSel, setAddSel] = useState(addPeopleStore.get());
    useEffect(() => addPeopleStore.subscribe(setAddSel), []);
    const [groupOpen, setGroupOpen] = useState(groupStore.get());
    useEffect(() => groupStore.subscribe(setGroupOpen), []);
    // M10.7: the person page's ... menu (native), opened under the button.
    async function openPersonPageMenu(e) {
      const p = personStore.get();
      if (p == null) return;
      const r = e.currentTarget.getBoundingClientRect();
      try {
        const info = await window.api.getPerson(p.id);
        const res = await window.api.showPersonPageMenu({
          named: Boolean(info && info.name), hidden: Boolean(info && info.hidden),
          view: faceDisplayStore.get(), x: r.left, y: r.bottom + 4,
        });
        const action = res && res.action;
        if (action === 'review') personViewStore.set('review');
        else if (action === 'show-photos') faceDisplayStore.set('photos');
        else if (action === 'show-faces') faceDisplayStore.set('faces');
        else if (action === 'name') window.dispatchEvent(new CustomEvent('photos:name-person'));
        else if (action === 'hide' || action === 'unhide') {
          await window.api.setPersonHidden(p.id, action === 'hide');
          peopleChangeStore.bump();
          if (action === 'hide') personStore.set(null);
        }
      } catch (err) { noticeStore.set('Could not open the menu: ' + err.message); }
    }
    const [sourceNames, setSourceNames] = useState({});
    const [sourceRows, setSourceRows] = useState({});
    useEffect(() => {
      let alive = true;
      const load = () => window.api.listSources()
        .then((rows) => {
          if (!alive) return;
          const names = {};
          const byId = {};
          (rows || []).forEach((r) => { names[r.id] = r.displayName; byId[r.id] = r; });
          setSourceNames(names);
          setSourceRows(byId);
        })
        .catch((err) => console.error('listSources failed:', err));
      load();
      const unsubscribe = libraryChangeStore.subscribe(load);
      return () => { alive = false; unsubscribe(); };
    }, []);

    useEffect(() => {
      let cancelled = false;
      window.api.getConfig().then((cfg) => {
        if (cancelled) return;
        const saved = cfg && cfg.grid && typeof cfg.grid.zoomLevel === 'number'
          ? cfg.grid.zoomLevel
          : TARGET_ROW_HEIGHT_DEFAULT;
        setValue(saved);
        zoomStore.set(saved);
      });
      const unsubscribe = zoomStore.subscribe((v) => setValue(v));
      return () => { cancelled = true; unsubscribe(); };
    }, []);

    // M6 (B.6e): the slider sets the column count; right = fewer, bigger tiles.
    function handleInput(e) {
      columnsStore.set(GRID_COLUMNS_MIN + GRID_COLUMNS_MAX - Number(e.target.value));
    }

    return h(Fragment, null,
      h(SidebarToggleButton),
      section === 'library' && mode === 'all' && h(LibraryTitle),
      section === 'library' ? h(SegmentedControl) : h(SectionTitle, { section, sourceNames }),
      h(MissingFolderBar, { section, sourceRows }),
      section !== 'albums' && section !== 'map' && !(section === 'people' && !personSel) && h(SearchField),
      section === 'map' && mapArea && h('div', { style: { flex: '1 1 auto' } }),
      ((section === 'library' && mode === 'all') || /^source:\d+$/.test(section) || (section === 'map' && mapArea) || (section === 'people' && personSel && personViewSel !== 'review') || (section === 'people' && groupOpen)) && h(ViewFilterButton),
      section === 'people' && !personSel && !addSel && !groupOpen && h('div', { style: { flex: '1 1 auto' } }),
      section === 'people' && !personSel && !addSel && !groupOpen && h('button', {
        type: 'button', title: 'Add People', onClick: () => addPeopleStore.set(true),
        style: {
          WebkitAppRegion: 'no-drag', height: '28px', padding: '0 12px', border: 'none', borderRadius: '14px', cursor: 'pointer',
          background: 'var(--control-bg, rgba(128,128,128,0.18))', color: 'var(--text-primary)', fontSize: '13px',
        },
      }, '+ Add People'),
      section === 'people' && personSel && h('button', {
        type: 'button', title: 'More', 'aria-label': 'More', onClick: openPersonPageMenu,
        style: {
          WebkitAppRegion: 'no-drag', width: '34px', height: '28px', border: 'none', borderRadius: '14px', cursor: 'pointer',
          background: (personViewSel === 'photos' && faceDisplaySel === 'photos') ? 'var(--control-bg, rgba(128,128,128,0.18))' : 'var(--accent, #2f7ff7)',
          color: (personViewSel === 'photos' && faceDisplaySel === 'photos') ? 'var(--text-primary)' : '#fff', fontSize: '16px', lineHeight: 1,
        },
      }, '\u2026'),
      mode === 'all' && !(section === 'map' && !mapArea) && h(ZoomPill, { cols })
    );
  }

  function computeVisibleRange(layout, scrollTop, viewportHeight) {
    const rowCount = layout.getRowCount();
    if (rowCount === 0) return { startRow: 0, endRow: -1 };
    const firstVisible = layout.findRowContainingOffset(scrollTop);
    const lastVisible = layout.findRowContainingOffset(scrollTop + viewportHeight);
    const startRow = Math.max(0, firstVisible - BUFFER_ROWS);
    const endRow = Math.min(rowCount - 1, lastVisible + BUFFER_ROWS);
    return { startRow, endRow };
  }

  /** Finds the min/max item index spanned by 'items' rows within [startRow, endRow]. Null if none (e.g. header-only range). */
  function itemIndexRangeForRows(layout, startRow, endRow) {
    let minIdx = null, maxIdx = null;
    for (let r = startRow; r <= endRow; r++) {
      const row = layout.getRowAt(r);
      if (!row || row.type !== 'items') continue;
      // M6: rows may list indices in any order (the square grid runs
      // oldest -> newest, i.e. descending), so scan every index.
      for (const idx of row.itemIndices) {
        if (minIdx === null || idx < minIdx) minIdx = idx;
        if (maxIdx === null || idx > maxIdx) maxIdx = idx;
      }
    }
    return minIdx === null ? null : { start: minIdx, end: maxIdx };
  }

  /** Bounded linear scan (not O(N)) — the selected item is always within or near visibleRange. */
  function findIndexOfItemId(dataLayer, itemId, searchStart, searchEnd) {
    for (let i = searchStart; i <= searchEnd; i++) {
      const item = dataLayer.getItemAt(i);
      if (!item.__placeholder && item.id === itemId) return i;
    }
    return -1;
  }

  /** Horizontal center (px) of the item at itemIndices[position] within its row, for Up/Down column-matching. */
  function computeItemCenterX(row, position) {
    let x = row.leadingOffset || 0; // M6: partial first row is right-aligned
    for (let i = 0; i < position; i++) x += row.itemWidths[i] + GAP_SIZE;
    return x + row.itemWidths[position] / 2;
  }

  /** The item in an 'items' row whose horizontal center is closest to targetX. */
  function findClosestItemInRow(row, targetX) {
    let bestPosition = 0;
    let bestDist = Infinity;
    for (let p = 0; p < row.itemWidths.length; p++) {
      const dist = Math.abs(computeItemCenterX(row, p) - targetX);
      if (dist < bestDist) { bestDist = dist; bestPosition = p; }
    }
    return row.itemIndices[bestPosition];
  }

  function YearTile({ year, thumbPath }) {
    const resolved = typeof thumbPath === 'string';
    return h('div', { className: 'timeline-tile', onClick: () => navigateToPeriod({ year: year.year }) },
      h('div', { className: 'timeline-tile-thumb' },
        resolved && h('img', { src: 'file://' + thumbPath })),
      h('div', { className: 'timeline-tile-label' }, String(year.year)),
      h('div', { className: 'timeline-tile-count' }, year.count + (year.count === 1 ? ' item' : ' items'))
    );
  }

  function YearsView() {
    const [years, setYears] = useState(null);
    const [thumbs, setThumbs] = useState({});

    useEffect(() => {
      let cancelled = false;
      const tl = window.createTimelineDataLayer({ api: window.api });
      tl.loadYears().then(async (rows) => {
        if (cancelled) return;
        setYears(rows);
        const ids = rows.map((r) => r.coverItemId).filter((id) => id != null);
        if (ids.length === 0) return;
        const result = await window.api.getThumbnailPaths({ ids, size: 'sm' });
        if (!cancelled) setThumbs(result);
      });
      return () => { cancelled = true; tl.destroy(); };
    }, []);

    if (years === null) return h('div', { className: 'timeline-loading' }, 'Loading years\u2026');
    if (years.length === 0) return h('div', { className: 'timeline-loading' }, 'No photos yet.');

    return h('div', { className: 'timeline-scroll' },
      h('div', { className: 'timeline-grid is-years' }, // M6 (B.6c): bigger Year tiles
        years.map((y) => h(YearTile, { key: y.year, year: y, thumbPath: thumbs[y.coverItemId] }))
      )
    );
  }

  function MonthTile({ month, thumbPath }) {
    const resolved = typeof thumbPath === 'string';
    const label = new Date(Date.UTC(month.year, month.month - 1, 1))
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return h('div', { className: 'timeline-tile', onClick: () => navigateToPeriod({ year: month.year, month: month.month }) },
      h('div', { className: 'timeline-tile-thumb' },
        resolved && h('img', { src: 'file://' + thumbPath })),
      h('div', { className: 'timeline-tile-label' }, label),
      h('div', { className: 'timeline-tile-count' }, month.count + (month.count === 1 ? ' item' : ' items'))
    );
  }

  function MonthsView() {
    const [months, setMonths] = useState(null);
    const [thumbs, setThumbs] = useState({});

    useEffect(() => {
      let cancelled = false;
      const tl = window.createTimelineDataLayer({ api: window.api });
      tl.loadMonths().then(async (rows) => {
        if (cancelled) return;
        setMonths(rows);
        const ids = rows.map((r) => r.coverItemId).filter((id) => id != null);
        if (ids.length === 0) return;
        const result = await window.api.getThumbnailPaths({ ids, size: 'sm' });
        if (!cancelled) setThumbs(result);
      });
      return () => { cancelled = true; tl.destroy(); };
    }, []);

    if (months === null) return h('div', { className: 'timeline-loading' }, 'Loading months\u2026');
    if (months.length === 0) return h('div', { className: 'timeline-loading' }, 'No photos yet.');

    const groups = [];
    for (const m of months) {
      const last = groups[groups.length - 1];
      if (last && last.year === m.year) last.months.push(m);
      else groups.push({ year: m.year, months: [m] });
    }

    return h('div', { className: 'timeline-scroll' },
      groups.map((g) => h('div', { key: g.year, className: 'timeline-year-group' },
        h('div', { className: 'timeline-year-header' }, String(g.year)),
        h('div', { className: 'timeline-grid' },
          g.months.map((m) => h(MonthTile, {
            key: m.year + '-' + m.month,
            month: m,
            thumbPath: thumbs[m.coverItemId],
          }))
        )
      ))
    );
  }

  function formatFullDate(dateStr) {
    // dateStr is 'YYYY-MM-DD'; parsed at UTC noon to avoid local-timezone shifting.
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function DayTile({ day, thumbPath }) {
    const resolved = typeof thumbPath === 'string';
    return h('div', { className: 'timeline-tile', onClick: () => navigateToPeriod({ date: day.date }) },
      h('div', { className: 'timeline-tile-thumb' },
        resolved && h('img', { src: 'file://' + thumbPath })),
      h('div', { className: 'timeline-tile-label' }, formatFullDate(day.date)),
      h('div', { className: 'timeline-tile-count' }, day.count + (day.count === 1 ? ' item' : ' items'))
    );
  }

  /**
   * Grouped by month (not year) -- keeps each scrollable section to a
   * browsable size even for months with many distinct days. Not
   * virtualized: confirmed acceptable at this library's real scale
   * (a few hundred distinct days at most). Revisit with basic
   * scroll-position virtualization if a much larger library proves slow.
   */
  function DaysView() {
    const [days, setDays] = useState(null);
    const [thumbs, setThumbs] = useState({});

    useEffect(() => {
      let cancelled = false;
      const tl = window.createTimelineDataLayer({ api: window.api });
      tl.loadDays().then(async (rows) => {
        if (cancelled) return;
        setDays(rows);
        const ids = rows.map((r) => r.coverItemId).filter((id) => id != null);
        if (ids.length === 0) return;
        const result = await window.api.getThumbnailPaths({ ids, size: 'sm' });
        if (!cancelled) setThumbs(result);
      });
      return () => { cancelled = true; tl.destroy(); };
    }, []);

    if (days === null) return h('div', { className: 'timeline-loading' }, 'Loading days\u2026');
    if (days.length === 0) return h('div', { className: 'timeline-loading' }, 'No photos yet.');

    const groups = [];
    for (const d of days) {
      const monthKey = d.date.slice(0, 7); // 'YYYY-MM'
      const last = groups[groups.length - 1];
      if (last && last.monthKey === monthKey) last.days.push(d);
      else groups.push({ monthKey, days: [d] });
    }

    function monthLabel(monthKey) {
      const [y, m] = monthKey.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, 1))
        .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }

    return h('div', { className: 'timeline-scroll' },
      groups.map((g) => h('div', { key: g.monthKey, className: 'timeline-year-group' },
        h('div', { className: 'timeline-year-header' }, monthLabel(g.monthKey)),
        h('div', { className: 'timeline-grid' },
          g.days.map((d) => h(DayTile, { key: d.date, day: d, thumbPath: thumbs[d.coverItemId] }))
        )
      ))
    );
  }

  function TimelineView({ mode }) {
    if (mode === 'years') return h(YearsView);
    if (mode === 'months') return h(MonthsView);
    if (mode === 'days') return h(DaysView);
    return null;
  }

  /**
   * Switches between the All Photos grid and a Timeline placeholder based on
   * modeStore. Grid is unmounted (not just hidden) when leaving All Photos so
   * its thumbnail-poll interval (see Grid's mount effect) actually stops.
   */
  /**
   * M6: section changes. Runs synchronously when sectionStore changes, before
   * any re-render: closes the viewer; records the outgoing section's top item
   * index (session-only memory) and Library's mode; resets the shared scroll
   * element (a fresh Grid anchors to whatever is at its scrollTop); queues
   * the incoming section's remembered item as a pending anchor, consumed by
   * the NEW Grid after the old one unmounts; and sets the mode -- collections
   * are grid-only ('all'), Library restores its last mode.
   */
  /**
   * M6 (B.6h): reopen the viewer on the same photo after a restart. Saving:
   * viewerStore always holds the photo currently shown (arrows also go
   * through open()), so its id is saved as viewer.openItemId (debounced).
   * Restoring: once the saved id is known, the sidebar has restored the
   * section ('photos:section-restored'), and that section's grid is ready --
   * check the photo is still in the section, scroll to it, open the viewer.
   */
  // M6 (B.8): a new search closes the viewer, starts the results at the top
  // of the scroll area, and in Library switches to All Photos.
  searchStore.subscribe((q) => {
    if (viewerStore.get() !== null) viewerStore.close();
    const scrollEl = document.getElementById(SCROLL_EL_ID);
    if (scrollEl) scrollEl.scrollTop = 0;
    if (q && sectionStore.get() === 'library' && modeStore.get() !== 'all') modeStore.set('all');
  });

  // M6: a view-filter change closes the viewer, starts at the top of the
  // scroll area, and in Library switches to All Photos.
  kindStore.subscribe((kind) => {
    if (viewerStore.get() !== null) viewerStore.close();
    const scrollEl = document.getElementById(SCROLL_EL_ID);
    if (scrollEl) scrollEl.scrollTop = 0;
    if (kind !== 'all' && sectionStore.get() === 'library' && modeStore.get() !== 'all') modeStore.set('all');
  });

  let viewerSaveTimer = null;
  viewerStore.subscribe((v) => {
    clearTimeout(viewerSaveTimer);
    const id = v ? v.itemId : null;
    viewerSaveTimer = setTimeout(() => {
      window.api.updateConfig({ patch: { viewer: { openItemId: id } } })
        .catch((err) => console.error('Saving the open photo failed:', err));
    }, 300);
  });
  let pendingViewerRestore = null; // saved item id to reopen, or null
  let sectionRestoreDone = false;
  let gridReadyForRestore = false;
  async function tryRestoreViewer() {
    if (pendingViewerRestore == null || !sectionRestoreDone || !gridReadyForRestore) return;
    const id = pendingViewerRestore;
    pendingViewerRestore = null; // one attempt only
    if (modeStore.get() !== 'all') return;
    try {
      const idx = await window.api.getItemIndex({ id, filter: filterStore.get() });
      if (idx == null) return; // no longer in this section
      navigationStore.goTo({ itemIndex: idx });
      viewerStore.open(id);
    } catch (err) {
      console.error('Restoring the open photo failed:', err);
    }
  }
  window.addEventListener('photos:section-restored', () => { sectionRestoreDone = true; tryRestoreViewer(); });

  const sectionMemory = { libraryMode: 'all', topItemIndex: new Map() };
  let gridTopItemIndexGetter = null; // registered by the mounted Grid
  let pendingSectionAnchor = null;   // item index for the next Grid to mount
  let previousSection = sectionStore.get();
  sectionStore.subscribe((next) => {
    const prev = previousSection;
    previousSection = next;
    gridReadyForRestore = false; // B.6h: wait for the new section's grid
    if (searchStore.get()) searchStore.set(''); // B.8: a new section starts unsearched
    if (kindStore.get() !== 'all') kindStore.set('all'); // view filter resets per section
    if (viewerStore.get() !== null) viewerStore.close();
    if (gridTopItemIndexGetter) {
      const idx = gridTopItemIndexGetter();
      if (idx != null) sectionMemory.topItemIndex.set(prev, idx);
    }
    if (prev === 'library') sectionMemory.libraryMode = modeStore.get();
    // M7.6: any section change starts Map at the map itself, and a map-area
    // grid never restores a remembered scroll position.
    sectionMemory.topItemIndex.delete('map');
    if (mapAreaStore.get() !== null) mapAreaStore.set(null);
    if (personStore.get() !== null) personStore.set(null); // M10.6
    addPeopleStore.set(false); // M10.7
    groupStore.set(null);
    const scrollEl = document.getElementById(SCROLL_EL_ID);
    if (scrollEl) scrollEl.scrollTop = 0;
    const nextMode = next === 'library' ? sectionMemory.libraryMode : 'all';
    const remembered = sectionMemory.topItemIndex.get(next);
    pendingSectionAnchor = nextMode === 'all' && remembered != null ? remembered : null;
    modeStore.set(nextMode);
  });

  // M7.6: switching between the map and a map-area grid (same section).
  mapAreaStore.subscribe(() => {
    if (searchStore.get()) searchStore.set('');
    if (kindStore.get() !== 'all') kindStore.set('all');
    if (viewerStore.get() !== null) viewerStore.close();
    pendingSectionAnchor = null;
    const scrollEl = document.getElementById(SCROLL_EL_ID);
    if (scrollEl) scrollEl.scrollTop = 0;
  });

  // M10.7: while a person's grid is open, any change to people reloads it.
  peopleChangeStore.subscribe(() => {
    if (sectionStore.get() === 'people' && personStore.get() != null) libraryChangeStore.bump();
  });

  // M10.7: a person's grid fades in after it replaces another screen.
  // The grid starts the fade itself once its first page is loaded (see Grid), so the
  // fade plays over content rather than an empty screen.
  let gridFadePending = false;
  function fadeGridSoon() { gridFadePending = true; }
  personViewStore.subscribe((v) => { if (v === 'photos') fadeGridSoon(); });

  // M10.7: opening or closing a group (same section).
  groupStore.subscribe((g) => {
    if (searchStore.get()) searchStore.set('');
    if (kindStore.get() !== 'all') kindStore.set('all');
    if (viewerStore.get() !== null) viewerStore.close();
    pendingSectionAnchor = null;
    const scrollEl = document.getElementById(SCROLL_EL_ID);
    if (scrollEl) scrollEl.scrollTop = 0;
    if (g) fadeGridSoon();
  });
  personStore.subscribe((p) => { if (p) groupStore.set(null); });

  // M10.6: switching between the People page and a person's grid (same section).
  personStore.subscribe(() => {
    personViewStore.set('photos'); // M10.7: every person opens on their photos
    if (personStore.get() != null) fadeGridSoon();
    faceDisplayStore.set('photos');
    if (searchStore.get()) searchStore.set('');
    if (kindStore.get() !== 'all') kindStore.set('all');
    if (viewerStore.get() !== null) viewerStore.close();
    pendingSectionAnchor = null;
    const scrollEl = document.getElementById(SCROLL_EL_ID);
    if (scrollEl) scrollEl.scrollTop = 0;
  });

  function AppGrid() {
    const [mode, setMode] = useState(modeStore.get());
    const [section, setSection] = useState(sectionStore.get());
    const [search, setSearch] = useState(searchStore.get());
    useEffect(() => modeStore.subscribe(setMode), []);
    useEffect(() => sectionStore.subscribe(setSection), []);
    useEffect(() => searchStore.subscribe(setSearch), []);
    const [kind, setKind] = useState(kindStore.get());
    useEffect(() => kindStore.subscribe(setKind), []);
    const [area, setArea] = useState(mapAreaStore.get());
    useEffect(() => mapAreaStore.subscribe(setArea), []);
    const [person, setPerson] = useState(personStore.get());
    useEffect(() => personStore.subscribe(setPerson), []);
    const [personView, setPersonView] = useState(personViewStore.get());
    useEffect(() => personViewStore.subscribe(setPersonView), []);
    const [addPeople, setAddPeople] = useState(addPeopleStore.get());
    useEffect(() => addPeopleStore.subscribe(setAddPeople), []);
    const [group, setGroup] = useState(groupStore.get());
    useEffect(() => groupStore.subscribe(setGroup), []);
    // Keyed by section: switching sections mounts a fresh Grid whose data
    // layer is created with that section's filter.
    // B.5: All Albums overview (albums.js); renders nothing until loaded.
    if (section === 'albums') return window.__PhotosAlbumsView ? h(window.__PhotosAlbumsView) : null;
    // M7.5: Map page (places.js); renders nothing until loaded.
    // M7.6: with an area chosen, the Map section shows that area's Grid.
    if (section === 'map' && !area) return window.__PhotosPlacesView ? h(window.__PhotosPlacesView) : null;
    // M7.6g: Apple-style grouped page for the chosen area (places.js).
    if (section === 'map' && area && window.__PhotosPlacesAreaView) {
      return h(window.__PhotosPlacesAreaView, { key: area.filter + '|' + kind, filter: filterStore.get() || area.filter });
    }
    // M10.6: People page (people.js); with a person chosen, the normal Grid with person:<id>.
    if (section === 'people' && !person && group) {
      return h(Grid, { key: 'group|' + group.ids.join(',') + '|' + search + '|' + kind });
    }
    if (section === 'people' && !person) {
      const scope = addPeople ? 'unnamed' : 'named';
      return window.__PhotosPeopleView ? h(window.__PhotosPeopleView, { key: scope, scope }) : null;
    }
    // M10.7: a person's faces or groups (people.js).
    if (section === 'people' && person && personView === 'review') {
      return window.__PhotosPersonFacesView ? h(window.__PhotosPersonFacesView, { key: person.id + '|' + personView, personId: person.id, mode: personView }) : null;
    }
    if (mode === 'all') return h(Grid, { key: section + '|' + (area ? area.filter : '') + '|' + (person ? person.id : '') + '|' + search + '|' + kind });
    return h(TimelineView, { mode });
  }

  const SCROLL_EL_ID = 'grid-scroll';

  function Grid() {
    const [ready, setReady] = useState(false);
    const [visibleRange, setVisibleRange] = useState({ startRow: 0, endRow: -1 });
    const [renderVersion, setRenderVersion] = useState(0);

    const dataLayerRef = useRef(null);
    const layoutRef = useRef(null);
    const targetRowHeightRef = useRef(TARGET_ROW_HEIGHT_DEFAULT);
    const thumbCacheRef = useRef(new Map());       // itemId -> path | null | 'error'
    const thumbPollCountRef = useRef(new Map());    // itemId -> consecutive stalled polls
    const visibleRangeRef = useRef(visibleRange);
    // Item index we're currently anchored to (nav jump or plain remount).
    // Re-applied after every layout cascade (placeholder items resolving to
    // real dimensions) until a user scroll gesture releases it; an 8-second
    // expiry is only a safety net. See reanchorIfNeeded().
    const navAnchorRef = useRef(null);
    // Timestamp of the last genuine user scroll gesture (wheel/touch), used
    // to tell "the user scrolled away" (clears the anchor) apart from a
    // programmatic scrollTop assignment we made ourselves (doesn't clear
    // it) -- based on real input events, not scroll-event timing.
    const lastUserGestureAtRef = useRef(0);
    const [thumbVersion, setThumbVersion] = useState(0);
    const bumpThumb = useCallback(() => setThumbVersion((v) => v + 1), []);

    const bump = useCallback(() => setRenderVersion((v) => v + 1), []);
    const zoomWriteDebounceRef = useRef(null);

    // M6: lets the section handler record this Grid's position on leave.
    useEffect(() => {
      const getter = () => {
        const scrollEl = document.getElementById(SCROLL_EL_ID);
        const layout = layoutRef.current;
        if (!layout || !scrollEl) return null;
        const row = layout.getRowAt(layout.findRowContainingOffset(scrollEl.scrollTop));
        return row && row.type === 'items' ? row.itemIndices[0] : null;
      };
      gridTopItemIndexGetter = getter;
      return () => { if (gridTopItemIndexGetter === getter) gridTopItemIndexGetter = null; };
    }, []);

    useEffect(() => {
      const scrollEl = document.getElementById(SCROLL_EL_ID);
      const dataLayer = window.createDataLayer({ api: window.api, initialFilter: filterStore.get() });
      dataLayerRef.current = dataLayer;
      // M6: restore this section's remembered position (set by the section
      // handler); consumed via the same navigation path as M5 return-to-grid.
      if (pendingSectionAnchor != null) {
        navigationStore.goTo({ itemIndex: pendingSectionAnchor });
        pendingSectionAnchor = null;
      } else {
        // M6 (B.6): no remembered position and no unconsumed jump -> open at
        // the newest item (index 0), i.e. scrolled to the bottom.
        const pendingNav = navigationStore.get();
        if (!pendingNav || pendingNav.requestId === consumedNavRequestId) {
          navigationStore.goTo({ itemIndex: 0 });
        }
      }

      // Load the saved zoom level. If it resolves after the first layout
      // already ran at the default, correct it once here (a brief, rare
      // one-time re-layout on startup only when the saved value differs).
      window.api.getConfig().then((cfg) => {
        const saved = cfg && cfg.grid && typeof cfg.grid.zoomLevel === 'number'
          ? cfg.grid.zoomLevel
          : TARGET_ROW_HEIGHT_DEFAULT;
        targetRowHeightRef.current = saved;
        zoomStore.set(saved);
        if (layoutRef.current && saved !== TARGET_ROW_HEIGHT_DEFAULT) {
          layoutRef.current.setTargetRowHeight(saved);
          refreshVisibleRange();
          bump();
        }
      });

      function computeAndSetLayout(scrollWidth) {
        // Tiles must fit INSIDE .row-items' horizontal padding; packing to the
        // full scroll width made every full row overflow by 8px, which showed
        // up as a horizontal scrollbar. Floored so sub-pixel rounding can't
        // push a row over the edge either.
        const containerWidth = Math.max(0, Math.floor(scrollWidth) - ROW_PADDING_X * 2);
        if (!layoutRef.current) {
          // M6 (B.6): Apple-style square grid, oldest at top, newest at bottom.
          layoutRef.current = window.createSquareLayout({
            dataLayer,
            containerWidth,
            columns: columnsStore.get(),
            // Filtered views (view filter or search) read from the top-left.
            alignTop: /::(kind|search):|^geo:/.test(filterStore.get() || ''), // M7.6: map-area grids start top-left
            gapSize: GAP_SIZE,
          });
        } else {
          layoutRef.current.setContainerWidth(containerWidth);
        }
      }

      function refreshVisibleRange() {
        if (!layoutRef.current || !scrollEl) return;
        setVisibleRange(computeVisibleRange(layoutRef.current, scrollEl.scrollTop, scrollEl.clientHeight));
      }

      function matchesNavTarget(dateStr, target) {
        if (target.date) return dateStr === target.date;
        if (target.month != null) {
          return dateStr.slice(0, 7) === target.year + '-' + String(target.month).padStart(2, '0');
        }
        return dateStr.slice(0, 4) === String(target.year);
      }

      function scrollToItemIndex(itemIndex) {
        if (!layoutRef.current || !scrollEl) return false;
        const rowIdx = layoutRef.current.getRowIndexForItem(itemIndex);
        if (rowIdx === -1) return false;
        const itemsRow = layoutRef.current.getRowAt(rowIdx);
        const headerRow = rowIdx > 0 ? layoutRef.current.getRowAt(rowIdx - 1) : null;
        const targetRow = (headerRow && headerRow.type === 'header') ? headerRow : itemsRow;
        if (!targetRow) return false;
        scrollEl.scrollTop = targetRow.top;
        return true;
      }

      /**
       * Re-applies the anchored scroll position after a re-layout. Needed
       * because a fresh Grid mount lays out the whole library using 4:3
       * placeholder aspect ratios (nothing has been fetched yet); as soon
       * as nearby items resolve to real dimensions, layout-engine.js
       * cascades a re-layout downward from that row, shifting every row
       * below it -- including wherever we just scrolled to. A raw
       * scrollTop pixel value doesn't track that; re-deriving from the
       * anchor's item index does. Stays active (re-applied on every
       * cascade) until a genuine user scroll gesture is detected (see
       * markUserGesture/handleScroll below); a long expiry is kept only
       * as a safety net.
       */
      function reanchorIfNeeded() {
        const anchor = navAnchorRef.current;
        if (!anchor) return;
        if (Date.now() > anchor.expiresAt) { navAnchorRef.current = null; return; }
        scrollToItemIndex(anchor.itemIndex);
      }

      function tryConsumeNavigation() {
        const target = navigationStore.get();
        if (!target || target.requestId === consumedNavRequestId) return;
        if (!dataLayerRef.current || !layoutRef.current || !scrollEl) return;
        const sections = dataLayerRef.current.getDateSections();
        if (!sections.length) return; // not loaded yet; the reset callback will retry
        consumedNavRequestId = target.requestId;
        // M5: { itemIndex } targets (viewer return-to-grid) land on an exact item.
        const totalForNav = dataLayerRef.current.getTotalCount();
        const match = typeof target.itemIndex === 'number'
          ? { startIndex: Math.max(0, Math.min(target.itemIndex, totalForNav != null ? totalForNav - 1 : target.itemIndex)) }
          : sections.find((s) => matchesNavTarget(s.date, target));
        if (!match) return; // no items in that period

        // Cast a wide prefetch net before the target, not just the narrow
        // visible+buffer window the normal scroll-driven fetch would use.
        // The full layout is computed eagerly with a 4:3 fallback ratio for
        // every unfetched item, so a deep jump's landing row inherits a
        // cumulative guess-error from everything above it that the normal
        // pipeline never revisits. This closes most of that gap immediately
        // via the same resolve -> notifyItemsResolved -> reanchorIfNeeded
        // path already in place. Known limitation: an extremely large
        // library could still show a small residual drift -- see the M4
        // return handoff.
        const total = dataLayerRef.current.getTotalCount();
        const prefetchStart = Math.max(0, match.startIndex - 500);
        const prefetchEnd = total != null ? Math.min(total - 1, match.startIndex + 150) : match.startIndex + 150;
        dataLayerRef.current.ensureRange(prefetchStart, prefetchEnd);

        if (scrollToItemIndex(match.startIndex)) {
          navAnchorRef.current = { itemIndex: match.startIndex, expiresAt: Date.now() + 8000 };
        }
      }

      const unsubscribe = dataLayer.onRangeLoaded((start, end, meta) => {
        if (meta && meta.reset) {
          if (scrollEl) computeAndSetLayout(scrollEl.clientWidth);
          setReady(true);
          // Deferred: setReady(true) hasn't committed to the DOM yet at this
          // point, so the scroll wrapper's real height doesn't exist yet and
          // scrollTop would get clamped near 0. Wait for the next frame,
          // after Preact renders the ready=true content.
          requestAnimationFrame(() => {
            tryConsumeNavigation();
            gridReadyForRestore = true; // B.6h
            tryRestoreViewer();
            // No explicit nav target: anchor to whatever's currently at the
            // top of the viewport (e.g. a plain re-entry to All Photos), so
            // it self-corrects against the same cascade-drift effect.
            if (!navAnchorRef.current && layoutRef.current && scrollEl) {
              const rowIdx = layoutRef.current.findRowContainingOffset(scrollEl.scrollTop);
              const row = layoutRef.current.getRowAt(rowIdx);
              const anchorIdx = row && row.type === 'items' ? row.itemIndices[0] : null;
              if (anchorIdx != null) navAnchorRef.current = { itemIndex: anchorIdx, expiresAt: Date.now() + 8000 };
            }
          });
        } else if (layoutRef.current) {
          const indices = [];
          for (let i = start; i <= end; i++) indices.push(i);
          // Scroll anchoring: remember the item at the top of the viewport
          // before re-layout, so rows resizing ABOVE the viewport (placeholder
          // 4:3 ratios resolving to real ones) don't shove visible content.
          let keep = null;
          if (!navAnchorRef.current && scrollEl && scrollEl.scrollTop > 0) {
            let rIdx = layoutRef.current.findRowContainingOffset(scrollEl.scrollTop);
            while (rIdx >= 0 && rIdx < layoutRef.current.getRowCount() && layoutRef.current.getRowAt(rIdx).type !== 'items') rIdx++;
            const topRow = layoutRef.current.getRowAt(rIdx);
            if (topRow && topRow.type === 'items') {
              keep = { itemIndex: topRow.itemIndices[0], offset: scrollEl.scrollTop - topRow.top };
            }
          }
          layoutRef.current.notifyItemsResolved(indices);
          if (navAnchorRef.current) {
            reanchorIfNeeded();
          } else if (keep) {
            const newIdx = layoutRef.current.getRowIndexForItem(keep.itemIndex);
            const newRow = newIdx !== -1 ? layoutRef.current.getRowAt(newIdx) : null;
            if (newRow) {
              const target = newRow.top + Math.min(keep.offset, newRow.height);
              if (Math.abs(target - scrollEl.scrollTop) >= 1) scrollEl.scrollTop = target;
            }
          }
        }
        refreshVisibleRange();
        bump();
      });

      function markUserGesture() { lastUserGestureAtRef.current = Date.now(); }

      const USER_GESTURE_WINDOW_MS = 400;
      function handleScroll() {
        if (Date.now() - lastUserGestureAtRef.current < USER_GESTURE_WINDOW_MS) {
          // A real user gesture (wheel/touch) just happened -- this scroll
          // is the user's, not our own reanchor. Release the anchor.
          navAnchorRef.current = null;
        }
        refreshVisibleRange();
      }

      const resizeObserver = new ResizeObserver(() => {
        if (!scrollEl || !layoutRef.current) return;
        const currentRowIdx = layoutRef.current.findRowContainingOffset(scrollEl.scrollTop);
        const rowAtTop = layoutRef.current.getRowAt(currentRowIdx);
        const anchorItemIndex = rowAtTop && rowAtTop.type === 'items' ? rowAtTop.itemIndices[0] : null;

        computeAndSetLayout(scrollEl.clientWidth);

        if (anchorItemIndex != null) {
          const newRowIdx = layoutRef.current.getRowIndexForItem(anchorItemIndex);
          const newRow = newRowIdx !== -1 ? layoutRef.current.getRowAt(newRowIdx) : null;
          if (newRow) scrollEl.scrollTop = newRow.top;
        }
        refreshVisibleRange();
        bump();
      });
      if (scrollEl) resizeObserver.observe(scrollEl);
      if (scrollEl) scrollEl.addEventListener('scroll', handleScroll, { passive: true });
      if (scrollEl) {
        scrollEl.addEventListener('wheel', markUserGesture, { passive: true });
        scrollEl.addEventListener('touchstart', markUserGesture, { passive: true });
        scrollEl.addEventListener('touchmove', markUserGesture, { passive: true });
      }

      const unsubscribeZoom = zoomStore.subscribe((newHeight) => {
        targetRowHeightRef.current = newHeight;
        if (!layoutRef.current || !scrollEl) return;

        const viewportH = scrollEl.clientHeight;
        const centerRowIdx = layoutRef.current.findRowContainingOffset(scrollEl.scrollTop + viewportH / 2);
        const centerRow = layoutRef.current.getRowAt(centerRowIdx);
        const anchorItemIndex = centerRow && centerRow.type === 'items' ? centerRow.itemIndices[0] : null;

        layoutRef.current.setTargetRowHeight(newHeight);

        if (anchorItemIndex != null) {
          const newRowIdx = layoutRef.current.getRowIndexForItem(anchorItemIndex);
          const newRow = newRowIdx !== -1 ? layoutRef.current.getRowAt(newRowIdx) : null;
          if (newRow) scrollEl.scrollTop = Math.max(0, newRow.top - viewportH / 2);
        }
        refreshVisibleRange();
        bump();

        clearTimeout(zoomWriteDebounceRef.current);
        zoomWriteDebounceRef.current = setTimeout(() => {
          window.api.updateConfig({ patch: { grid: { zoomLevel: newHeight } } });
        }, 400);
      });

      // M6 (B.6e): zoom = column count; keep the photo at screen center in view.
      const unsubscribeColumns = columnsStore.subscribe((cols) => {
        const layout = layoutRef.current;
        if (!layout || !layout.setColumns || !scrollEl) return;
        const viewportH = scrollEl.clientHeight;
        const centerRow = layout.getRowAt(layout.findRowContainingOffset(scrollEl.scrollTop + viewportH / 2));
        const anchorItemIndex = centerRow && centerRow.type === 'items'
          ? centerRow.itemIndices[Math.floor(centerRow.itemIndices.length / 2)]
          : null;
        // A deliberate zoom releases any earlier anchor (e.g. the open-at-
        // bottom target), so re-anchoring can't snap the view back afterward.
        navAnchorRef.current = null;
        const oldTile = layout.getTileSize ? layout.getTileSize() : 0;
        layout.setColumns(cols);
        const newTile = layout.getTileSize ? layout.getTileSize() : 0;
        // Apply the new height, scroll position and visible rows synchronously,
        // so the very next paint already shows the correct rows (no blank frame).
        const gridContent = document.getElementById('grid-root')
          ? document.getElementById('grid-root').firstElementChild : null;
        if (gridContent) gridContent.style.height = (layout.getTotalHeight() + GRID_FOOTER_HEIGHT) + 'px';
        if (anchorItemIndex != null) {
          const newRow = layout.getRowAt(layout.getRowIndexForItem(anchorItemIndex));
          if (newRow) scrollEl.scrollTop = Math.max(0, newRow.top + newRow.height / 2 - viewportH / 2);
        }
        refreshVisibleRange();
        bump();
      });

      const unsubscribeSelection = selectionStore.subscribe(() => { bump(); });

      const unsubscribeLibrary = libraryChangeStore.subscribe(async () => {
        const dl = dataLayerRef.current;
        if (!dl) return;
        // reload() briefly collapses the scroll area, which clamps scrollTop
        // to 0. Remember the position and restore it once data is back.
        const savedScrollTop = scrollEl ? scrollEl.scrollTop : 0;
        await dl.refresh();
        if (scrollEl) scrollEl.scrollTop = savedScrollTop;
      });

      const unsubscribeNavigation = navigationStore.subscribe(() => { tryConsumeNavigation(); });

      function handleGridScrollClick(e) {
        if (!e.target.closest('.tile')) selectionStore.set(null);
      }
      if (scrollEl) scrollEl.addEventListener('click', handleGridScrollClick);

      function scrollRowIntoView(row) {
        if (!row || !scrollEl) return;
        const viewportH = scrollEl.clientHeight;
        if (row.top < scrollEl.scrollTop) scrollEl.scrollTop = row.top;
        else if (row.top + row.height > scrollEl.scrollTop + viewportH) {
          scrollEl.scrollTop = row.top + row.height - viewportH;
        }
      }

      function handleKeyDown(e) {
        if (viewerStore.get() !== null) return; // M5: the viewer owns the keyboard while open
        if (e.key === 'Escape') { selectionStore.set(null); return; }

        const isNavKey = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
        const isEnter = e.key === 'Enter';
        if (!isNavKey && !isEnter) return;

        const layout = layoutRef.current;
        const dataLayer = dataLayerRef.current;
        if (!layout || !dataLayer) return;

        const currentSelected = selectionStore.get();

        if (isEnter) {
          if (currentSelected != null) {
            viewerStore.open(currentSelected);
          }
          return;
        }

        e.preventDefault();

        const range = visibleRangeRef.current;
        const searchRange = itemIndexRangeForRows(
          layout,
          Math.max(0, range.startRow - 3),
          Math.min(layout.getRowCount() - 1, range.endRow + 3)
        );

        let currentIndex = -1;
        if (currentSelected != null && searchRange) {
          currentIndex = findIndexOfItemId(dataLayer, currentSelected, searchRange.start, searchRange.end);
        }

        if (currentIndex === -1) {
          // No active (or currently findable) selection: select the first item
          // ACTUALLY ON SCREEN -- scrollEl.scrollTop directly, NOT visibleRangeRef,
          // since visibleRange includes the +/-BUFFER_ROWS virtualization buffer
          // (off-screen rows kept mounted for smooth scrolling), which would pick
          // an item several rows above what the user can actually see.
          if (!scrollEl) return;
          const onScreenRowIdx = layout.findRowContainingOffset(scrollEl.scrollTop);
          let searchIdx = onScreenRowIdx;
          let firstOnScreenRow = null;
          while (searchIdx >= 0 && searchIdx < layout.getRowCount()) {
            const candidate = layout.getRowAt(searchIdx);
            if (candidate.type === 'items') { firstOnScreenRow = candidate; break; }
            searchIdx++;
          }
          if (!firstOnScreenRow) return;
          const first = dataLayer.getItemAt(firstOnScreenRow.itemIndices[0]);
          if (!first.__placeholder) selectionStore.set(first.id);
          return;
        }

        const total = dataLayer.getTotalCount();
        let newIndex = currentIndex;

        // M6: grid runs oldest -> newest left-to-right, and data indices are
        // newest-first, so Left (older) is index + 1 and Right (newer) is - 1.
        if (e.key === 'ArrowLeft') {
          newIndex = Math.min(total - 1, currentIndex + 1);
        } else if (e.key === 'ArrowRight') {
          newIndex = Math.max(0, currentIndex - 1);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const rowIdx = layout.getRowIndexForItem(currentIndex);
          if (rowIdx === -1) return;
          const row = layout.getRowAt(rowIdx);
          const position = row.itemIndices.indexOf(currentIndex);
          const targetX = computeItemCenterX(row, position);

          const dir = e.key === 'ArrowUp' ? -1 : 1;
          let searchRowIdx = rowIdx + dir;
          while (searchRowIdx >= 0 && searchRowIdx < layout.getRowCount()) {
            const candidateRow = layout.getRowAt(searchRowIdx);
            if (candidateRow.type === 'items') {
              newIndex = findClosestItemInRow(candidateRow, targetX);
              break;
            }
            searchRowIdx += dir;
          }
        }

        if (newIndex === currentIndex) return;

        const newItem = dataLayer.getItemAt(newIndex);
        if (newItem.__placeholder) return;

        selectionStore.set(newItem.id);

        const newRowIdx = layout.getRowIndexForItem(newIndex);
        scrollRowIntoView(newRowIdx !== -1 ? layout.getRowAt(newRowIdx) : null);
      }
      window.addEventListener('keydown', handleKeyDown);

      if (dataLayer.getTotalCount() != null && scrollEl) {
        computeAndSetLayout(scrollEl.clientWidth);
        setReady(true);
        refreshVisibleRange();
      }

      return () => {
        unsubscribe();
        unsubscribeZoom();
        unsubscribeColumns();
        unsubscribeSelection();
        unsubscribeLibrary();
        unsubscribeNavigation();
        clearTimeout(zoomWriteDebounceRef.current);
        if (scrollEl) scrollEl.removeEventListener('scroll', handleScroll);
        if (scrollEl) scrollEl.removeEventListener('wheel', markUserGesture);
        if (scrollEl) scrollEl.removeEventListener('touchstart', markUserGesture);
        if (scrollEl) scrollEl.removeEventListener('touchmove', markUserGesture);
        if (scrollEl) scrollEl.removeEventListener('click', handleGridScrollClick);
        window.removeEventListener('keydown', handleKeyDown);
        resizeObserver.disconnect();
        dataLayer.destroy();
      };
    }, []);

    useEffect(() => {
      visibleRangeRef.current = visibleRange;
    }, [visibleRange]);

    /** Collects the item ids currently spanned by [startRow, endRow], skipping unloaded placeholders. */
    function visibleItemIds(layout, dataLayer, startRow, endRow) {
      const range = itemIndexRangeForRows(layout, startRow, endRow);
      if (!range) return [];
      const ids = [];
      for (let i = range.start; i <= range.end; i++) {
        const item = dataLayer.getItemAt(i);
        if (!item.__placeholder) ids.push(item.id);
      }
      return ids;
    }

    // Batch-fetch thumbnails for newly visible items not yet in the cache.
    useEffect(() => {
      if (!ready) return;
      const layout = layoutRef.current;
      const dataLayer = dataLayerRef.current;
      if (!layout || !dataLayer) return;
      const ids = visibleItemIds(layout, dataLayer, visibleRange.startRow, visibleRange.endRow);
      const idsToFetch = ids.filter((id) => !thumbCacheRef.current.has(id));
      if (idsToFetch.length === 0) return;

      let cancelled = false;
      window.api.getThumbnailPaths({ ids: idsToFetch, size: 'sm' }).then((result) => {
        if (cancelled) return;
        const stillPending = [];
        for (const id of idsToFetch) {
          const p = result[id] ?? null;
          thumbCacheRef.current.set(id, p);
          if (p === null) stillPending.push(id);
        }
        if (stillPending.length) window.api.requestThumbnailPriority({ ids: stillPending, size: 'sm' });
        bumpThumb();
      });
      return () => { cancelled = true; };
    }, [visibleRange, ready]);

    // Poll for visible items still pending. Mount-once interval; reads the
    // LATEST visible range via visibleRangeRef to avoid a stale closure.
    useEffect(() => {
      const intervalId = setInterval(async () => {
        const layout = layoutRef.current;
        const dataLayer = dataLayerRef.current;
        if (!layout || !dataLayer) return;
        const range = visibleRangeRef.current;
        const ids = visibleItemIds(layout, dataLayer, range.startRow, range.endRow);
        const pendingIds = ids.filter((id) => thumbCacheRef.current.get(id) === null);
        if (pendingIds.length === 0) return;

        const result = await window.api.getThumbnailPaths({ ids: pendingIds, size: 'sm' });
        let changed = false;
        const stuckIds = [];
        for (const id of pendingIds) {
          const p = result[id] ?? null;
          if (p !== null) {
            thumbCacheRef.current.set(id, p);
            thumbPollCountRef.current.delete(id);
            changed = true;
          } else {
            const count = (thumbPollCountRef.current.get(id) || 0) + 1;
            thumbPollCountRef.current.set(id, count);
            if (count >= THUMB_STUCK_POLL_THRESHOLD) stuckIds.push(id);
          }
        }

        if (stuckIds.length) {
          const statuses = await Promise.all(stuckIds.map((id) => window.api.getThumbnailStatus({ id })));
          stuckIds.forEach((id, i) => {
            if (statuses[i] && statuses[i].sm === 'error') {
              thumbCacheRef.current.set(id, 'error');
              thumbPollCountRef.current.delete(id);
              changed = true;
            }
          });
        }

        if (changed) bumpThumb();
      }, THUMB_POLL_INTERVAL_MS);
      return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
      if (!ready) return;
      const layout = layoutRef.current;
      const dataLayer = dataLayerRef.current;
      if (!layout || !dataLayer) return;
      const range = itemIndexRangeForRows(layout, visibleRange.startRow, visibleRange.endRow);
      if (range) dataLayer.ensureRange(range.start, range.end);
    }, [visibleRange, ready]);

    // M6 (B.6f): photo/video counts for the footer, with this Grid's filter
    // (Grid is re-created per section); refreshed on library changes.
    const [footerCounts, setFooterCounts] = useState(null);
    useEffect(() => {
      let alive = true;
      const load = () => window.api.getPhotoVideoCounts({ filter: filterStore.get() })
        .then((c) => { if (alive) setFooterCounts(c); })
        .catch((err) => console.error('Footer counts failed:', err));
      load();
      const unsubscribe = libraryChangeStore.subscribe(load);
      return () => { alive = false; unsubscribe(); };
    }, []);

    // M6 (B.6d): publish the date range of the rows actually on screen.
    useEffect(() => {
      if (!ready) return;
      const layout = layoutRef.current;
      const dl = dataLayerRef.current;
      const scrollEl = document.getElementById(SCROLL_EL_ID);
      if (!layout || !dl || !scrollEl) return;
      const topRow = layout.findRowContainingOffset(scrollEl.scrollTop);
      const bottomRow = layout.findRowContainingOffset(scrollEl.scrollTop + scrollEl.clientHeight - 1);
      if (topRow < 0) { dateRangeStore.set(null); return; }
      let maxIdx = -1;      // oldest (data indices are newest-first)
      let minIdx = Infinity; // newest
      for (let r = topRow; r <= bottomRow; r++) {
        const row = layout.getRowAt(r);
        if (!row || row.type !== 'items') continue;
        for (const i of row.itemIndices) {
          if (i > maxIdx) maxIdx = i;
          if (i < minIdx) minIdx = i;
        }
      }
      const dateOf = (i) => {
        const it = dl.getItemAt(i);
        return it && !it.__placeholder && it.capture_time_local ? it.capture_time_local.slice(0, 10) : null;
      };
      let oldest = null;
      for (let i = maxIdx; i >= minIdx && !oldest; i--) oldest = dateOf(i);
      let newest = null;
      for (let i = minIdx; i <= maxIdx && !newest; i++) newest = dateOf(i);
      dateRangeStore.set(oldest && newest ? { start: oldest, end: newest } : null);
    }, [visibleRange, renderVersion, ready]);
    useEffect(() => () => dateRangeStore.set(null), []);
    // M10.7: fade in once this grid has content, after a People screen switch.
    useEffect(() => {
      if (!ready || gridFadePending === false) return;
      gridFadePending = false;
      requestAnimationFrame(() => {
        const el = document.getElementById(SCROLL_EL_ID);
        if (el && el.animate) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
      });
    }, [ready]);

    if (!ready) return null;

    const dataLayer = dataLayerRef.current;
    const layout = layoutRef.current;
    const total = dataLayer.getTotalCount();

    if (total === 0) {
      // M6: section-aware empty state (Grid is keyed by section).
      const section = sectionStore.get();
      const EMPTY_TITLES = {
        video: 'No Videos', selfie: 'No Selfies', live: 'No Live Photos', panorama: 'No Panoramas',
        burst: 'No Bursts', gif: 'No Animated Images', raw: 'No RAW Photos',
      };
      let title = 'No Photos';
      if (searchStore.get()) {
        return h('div', { className: 'empty-state' },
          h('div', { style: { fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' } },
            'No Results for \u201C' + searchStore.get() + '\u201D'),
          h('div', { style: { marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' } }, 'Try a different name.'));
      }
      if ((filterStore.get() || '').includes('::kind:')) {
        return h('div', { className: 'empty-state' },
          h('div', { style: { fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' } },
            kindStore.get() === 'videos' ? 'No Videos' : 'No Photos'),
          h('div', { style: { marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' } },
            'Choose All Items to see everything here.'));
      }
      let hint = 'Add a folder with File \u2192 Add Folder\u2026, or drag a folder onto this window.';
      if (section.startsWith('source:')) {
        title = 'No Photos in This Album';
        hint = 'It may still be scanning, or contain no supported files.';
      } else if (EMPTY_TITLES[section]) {
        title = EMPTY_TITLES[section];
        hint = null;
      }
      return h('div', { className: 'empty-state' },
        h('div', { style: { fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' } }, title),
        hint && h('div', { style: { marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' } }, hint));
    }

    // M6 (B.6e): tiles are rendered FLAT, keyed by item index and absolutely
    // positioned, so a tile keeps its DOM node and decoded image when a zoom
    // moves it to another row -- no reload flash. Header rows (dates, used
    // only by the Aspect Ratio Grid) still render through Row.
    const children = [];
    const thumbCache = thumbCacheRef.current;
    const selectedId = selectionStore.get();
    for (let r = visibleRange.startRow; r <= visibleRange.endRow; r++) {
      const row = layout.getRowAt(r);
      if (!row) continue;
      if (row.type !== 'items') {
        children.push(h(Row, { key: 'header-' + r, row, dataLayer, thumbCache }));
        continue;
      }
      let x = ROW_PADDING_X + (row.leadingOffset || 0);
      for (let i = 0; i < row.itemIndices.length; i++) {
        const itemIndex = row.itemIndices[i];
        const item = dataLayer.getItemAt(itemIndex);
        const w = row.itemWidths[i];
        children.push(h('div', {
          key: itemIndex,
          className: 'tile-slot',
          'data-idx': itemIndex,
          onContextMenu: item.__placeholder ? undefined : (e) => openPhotoContextMenu(e, item),
          style: { position: 'absolute', top: row.top + 'px', left: x + 'px', width: w + 'px', height: row.height + 'px' },
        }, h(Tile, {
          item,
          widthPx: w,
          heightPx: row.height,
          thumbPath: item.__placeholder ? null : thumbCache.get(item.id),
          isSelected: !item.__placeholder && selectedId === item.id,
        })));
        x += w + GAP_SIZE;
      }
    }

    // M6 (B.6f): centered counts in a gap below the last row.
    if (footerCounts) {
      const count = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many);
      const parts = [];
      if (footerCounts.photos > 0) parts.push(count(footerCounts.photos, 'Photo', 'Photos'));
      if (footerCounts.videos > 0) parts.push(count(footerCounts.videos, 'Video', 'Videos'));
      if (parts.length) {
        children.push(h('div', {
          key: 'grid-footer',
          className: 'grid-footer',
          style: {
            position: 'absolute', left: 0, right: 0,
            top: layout.getTotalHeight() + 'px',
            height: GRID_FOOTER_HEIGHT + 'px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', userSelect: 'none',
          },
        }, parts.join(', ')));
      }
    }

    return h('div', { style: { height: (layout.getTotalHeight() + GRID_FOOTER_HEIGHT) + 'px', position: 'relative' } }, children);
  }

  window.__PhotosGrid = Grid;
  // M5: viewer.js (a separate script loaded after this one) uses the shared stores.
  window.__PhotosStores = { selectionStore, viewerStore, navigationStore, modeStore, libraryChangeStore, sectionStore, filterStore, sidebarVisibleStore, scanStatusStore, noticeStore, progressStore, columnsStore, searchStore, kindStore, mapAreaStore, personStore, peopleChangeStore, personViewStore, faceDisplayStore, addPeopleStore, groupStore, peopleEnabledStore };
  /**
   * M6 (B.5): drop folders from Finder onto the window to add them as
   * albums. Only paths are registered -- nothing is copied or moved. The
   * browser's default drop (navigating the window to the dropped file) is
   * always blocked. body.drop-active drives the drop highlight.
   */
  function installFolderDrop() {
    let depth = 0;
    const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const clear = () => { depth = 0; document.body.classList.remove('drop-active'); };

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (!hasFiles(e)) return;
      depth += 1;
      document.body.classList.add('drop-active');
    });
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (hasFiles(e)) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) document.body.classList.remove('drop-active');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      clear();
      if (!hasFiles(e)) return;
      // Read synchronously: Chromium empties dataTransfer after this event.
      const folders = [];
      let ignored = 0;
      Array.from(e.dataTransfer.items || []).forEach((item) => {
        if (item.kind !== 'file') return;
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        const file = item.getAsFile();
        const filePath = file ? window.api.getPathForFile(file) : '';
        if (entry && entry.isDirectory && filePath) folders.push(filePath);
        else ignored += 1;
      });
      if (folders.length === 0) {
        if (ignored) showAddProblems('Couldn\u2019t Add Items', ['Only folders can be added. Drag a folder from Finder onto the window.']);
        return;
      }
      const extra = ignored
        ? [ignored + (ignored === 1 ? ' item was' : ' items were') + ' ignored \u2014 only folders can be added.']
        : [];
      folderActions.addPaths(folders, extra)
        .catch((err) => noticeStore.set('Could not add folder: ' + err.message));
    });
  }

  // M1 patch (A.4): one-time metadata backfill. If any rows predate the
  // A.1/A.2 fixes, enqueue a rescan of each affected, reachable source; the
  // scan re-extracts only those rows (needsReextraction in
  // scan-directory-batch.js). Returns [] afterwards, so normal launches are a
  // no-op. Permanent -- NOT part of the M3.5 interim UI.
  async function enqueueBackfillScans() {
    try {
      const counts = await window.api.getReextractionCounts();
      if (!Array.isArray(counts) || counts.length === 0) return;
      const affected = new Set(counts.map((c) => c.sourceFolderId));
      const sources = await window.api.listSources();
      for (const source of sources) {
        if (affected.has(source.id) && source.status === 'ok') {
          scanQueue.enqueue({ sourceFolderId: source.id, sourceRootPath: source.rootPath });
        }
      }
    } catch (err) {
      console.error('Backfill check failed:', err);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    render(h(AppGrid), document.getElementById('grid-root'));
    render(h(Toolbar), document.getElementById('toolbar'));
    enqueueBackfillScans();
    // B.4: View > Hide/Show Sidebar (Alt+Cmd+S) toggles the store; every
    // change (including the restore below) keeps the menu label in sync.
    window.api.onToggleSidebar(() => sidebarVisibleStore.toggle());
    installFolderDrop();
    // B.5: File > Rescan All Folders.
    window.api.onRescanAll(() => {
      folderActions.rescanAll().catch((err) => noticeStore.set('Could not rescan: ' + err.message));
    });
    // B.5: File > Add Folder... (Shift+Cmd+I) -> the shared add flow.
    window.api.onAddFolder(() => {
      folderActions.pickAndAdd()
        .catch((err) => noticeStore.set('Could not add folder: ' + err.message));
    });
    sidebarVisibleStore.subscribe((visible) => {
      window.api.setSidebarMenuState(visible)
        .catch((err) => console.error('Updating sidebar menu label failed:', err));
    });
    // B.4: restore saved sidebar visibility without re-saving it.
    window.api.getConfig()
      .then((cfg) => {
        if (cfg && cfg.sidebar && cfg.sidebar.visible === false) sidebarVisibleStore.set(false, { persist: false });
        if (cfg && cfg.grid && typeof cfg.grid.columns === 'number') columnsStore.set(cfg.grid.columns, { persist: false });
        if (cfg && cfg.viewer && Number.isInteger(cfg.viewer.openItemId)) {
          pendingViewerRestore = cfg.viewer.openItemId; // B.6h
          tryRestoreViewer();
        }
      })
      .catch((err) => console.error('Restoring sidebar visibility failed:', err))
      // Enable the hide/show animation only after the restored state has
      // painted, so a sidebar saved as hidden does not collapse on launch.
      .finally(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        document.body.classList.add('sidebar-animate');
      })));
  });
})();
