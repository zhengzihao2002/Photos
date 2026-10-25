/**
 * viewer.js (M5) — single-item viewer overlay.
 *
 * Own Preact root, appended inside #content (covers toolbar + grid; the
 * sidebar stays visible, as in Apple Photos). Reads the shared stores from
 * window.__PhotosStores (exposed by renderer.js).
 *
 * Open/close: viewerStore.open(id) (Grid double-click / Enter, or Space
 * here) opens on every new requestId; viewerStore.close() closes.
 * While open, Grid's key handler returns early (guard in renderer.js).
 *
 * Keyboard while open: Esc / Space = close (Space becomes play/pause for
 * videos in M5.7); Cmd+I = info; Left/Right = previous/next (M5.5),
 * Up/Down swallowed.
 * While closed: Space opens the selected item.
 *
 * Write actions are present and DISABLED: aria-disabled + no-op click
 * (not the `disabled` attribute, which suppresses tooltips in Chromium).
 */
(function () {
  const { h, render } = window.preact;
  const { useState, useEffect, useRef, useLayoutEffect } = window.preactHooks;
  const S = window.__PhotosStores;
  const CLOSE_ANIM_MS = 160;
  const FULL_DELAY_MS = 150;   // settle time before the full-quality load (keeps rapid flipping cheap)
  const MD_POLL_MS = 250;
  const MD_MAX_TRIES = 60;     // ~15 s
  const NEIGHBOR_PRELOAD_MS = 600; // warm neighbors only once the user settles
  const MAX_ZOOM = 3;              // max scale vs full-resolution pixels (300%)
  const tr = window.t; // 't' is a variable name in this file (video time), so the translator is 'tr' here
  const READ_ONLY_TIP = tr('readOnly.long');

  // ── icons (stroke SVG, currentColor) ───────────────────────────────────
  const ICONS = {
    back: ['M15 5L8 12L15 19'],
    fwd: ['M9 5L16 12L9 19'],
    play: ['M8 5v14l11-7z'],
    pause: ['M9 5v14', 'M15 5v14'],
    sound: ['M4 9h4l5-4v14l-5-4H4z', 'M17 9a4 4 0 0 1 0 6'],
    mute: ['M4 9h4l5-4v14l-5-4H4z', 'M17 9l4 6', 'M21 9l-4 6'],
    live: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z'],
    info: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 11v6', 'M12 7.5v.5'],
    heart: ['M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'],
    rotate: ['M4 12a8 8 0 1 0 2.3-5.6', 'M4 4v4h4'],
    share: ['M12 3v12', 'M8 7l4-4 4 4', 'M6 11v9h12v-9'],
    trash: ['M5 7h14', 'M10 7V4h4v3', 'M7 7l1 13h8l1-13'],
  };
  function Icon({ name, size }) {
    return h('svg', { viewBox: '0 0 24 24', width: size || 19, height: size || 19, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      ICONS[name].map((d, i) => h('path', { key: i, d })));
  }

  // ── date title: capture_time_local is wall-clock 'YYYY-MM-DD HH:MM:SS' ─
  // U10: open / close zoom, as in Apple Photos. The photo starts over its grid
  // tile (cropped square like the tile) and grows to its viewer size; on close
  // it shrinks back into the tile. Only transform and clip-path animate.
  const ZOOM_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  function canZoom() {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  // The item's tile (main grid or a Places page, incl. a trail page), if it is
  // visible inside its scroll area (below the toolbar for the main area).
  function findTileRect(id) {
    const sel = '.tile-slot[data-id="' + Number(id) + '"], .pa-tile[data-id="' + Number(id) + '"]';
    for (const t of document.querySelectorAll(sel)) {
      const sc = t.closest('#grid-scroll, .places-overlay-scroll');
      if (!sc) continue;
      const r = t.getBoundingClientRect(), b = sc.getBoundingClientRect();
      const topLimit = b.top + (sc.id === 'grid-scroll' ? 56 : 0);
      if (r.width >= 4 && r.bottom > topLimit && r.top < b.bottom) return r;
    }
    return null;
  }
  // dir 'in': tile -> viewer; 'out': viewer -> tile (held at the end).
  // F0 (optional): the visible picture inside el -- a video's fitted frame
  // (object-fit: contain, centred); defaults to el's own box (photos).
  function runZoom(el, T, dir, done, F0) {
    const E = el.getBoundingClientRect();
    const F = F0 || E;
    if (!F.width || !F.height || !E.width || !E.height) { if (done) done(); return null; }
    const k = Math.max(T.width / F.width, T.height / F.height); // cover the tile
    const dx = (T.left + T.width / 2) - (F.left + F.width / 2);
    const dy = (T.top + T.height / 2) - (F.top + F.height / 2);
    const base = el.style.transform || '';
    let ix = Math.max(0, (E.width - T.width / k) / 2), iy = Math.max(0, (E.height - T.height / k) / 2); // in el's own box
    // M12.11: the clip is applied in the element's unturned box, so a quarter turn swaps the axes.
    const rm = /rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(base);
    if (rm && Math.abs(Number(rm[1])) % 180 === 90) { const t0 = ix; ix = iy; iy = t0; }
    const small = { transform: 'translate(' + dx + 'px,' + dy + 'px) ' + base + ' scale(' + k + ')',
      clipPath: 'inset(' + iy + 'px ' + ix + 'px round ' + (4 / k) + 'px)' };
    const big = { transform: base || 'none', clipPath: 'inset(0px 0px round 0px)' };
    const anim = el.animate(dir === 'in' ? [small, big] : [big, small],
      { duration: dir === 'in' ? 300 : 260, easing: ZOOM_EASE, fill: dir === 'out' ? 'forwards' : 'none' });
    anim.onfinish = () => { if (done) done(); };
    return anim;
  }
  // U10: what to zoom -- the sized photo, or the video with its fitted frame
  // (from the video's own size, or the item's before it has loaded).
  function zoomTarget(imgEl, stageEl, item) {
    // A video item is shown first as its thumbnail (a photo), then replaced by
    // the <video> about 0.2 s later: the thumbnail starts the zoom at once and
    // the video continues it from the same point (hand-off, see the layout effect).
    const isVideo = !!item && item.media_type === 'video';
    const sizedImg = imgEl && imgEl.isConnected && imgEl.classList.contains('is-sized') ? imgEl : null;
    if (!isVideo) return sizedImg ? { el: sizedImg, F: null } : null;
    const v = stageEl && stageEl.querySelector('video.viewer-video');
    if (!v) return sizedImg ? { el: sizedImg, F: null, standIn: true } : null;
    const E = v.getBoundingClientRect();
    let vw = v.videoWidth || (item && item.width) || 0, vh = v.videoHeight || (item && item.height) || 0;
    if (item && (item.rotation === 90 || item.rotation === 270)) { const t0 = vw; vw = vh; vh = t0; } // M12.11
    if (!E.width || !E.height || !vw || !vh) return null;
    const s = Math.min(E.width / vw, E.height / vh), w = vw * s, hh = vh * s;
    return { el: v, F: { left: E.left + (E.width - w) / 2, top: E.top + (E.height - hh) / 2, width: w, height: hh } };
  }

  // M8c.1 (U7): one line, date and time with seconds, in the system language
  // and 12-hour form, as Apple's viewer title (e.g. 2026年5月9日 上午11:22:15).
  function formatTitle(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    if (!m) return { date: '' };
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return {
      date: window.i18n.date(d, { year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }),
    };
  }

  // Navigation filter. M6 adds window.__PhotosStores.filterStore ({ get() });
  // until then this is null (unfiltered), matching the grid.
  let sessionScope = null; // M12.2f: selection-scoped navigation for the current viewing session
  function currentFilter() {
    // M7.7 trail: a photo opened from a layered Places page navigates within
    // that page's filter (set and cleared by places.js).
    if (typeof window.__PhotosViewerFilter === 'string') return window.__PhotosViewerFilter;
    // M12.2f: opened with several items selected -> navigate only those (Apple: 1/3).
    if (typeof sessionScope === 'string') return sessionScope;
    return (S.filterStore && typeof S.filterStore.get === 'function' && S.filterStore.get()) || null;
  }

  // Adjacent item via a synthetic keyset cursor: same query, order and
  // exclusions as the grid. 'older' = next, 'newer' = previous.
  async function neighborOf(cursor, direction) {
    const r = await window.api.getItemsPage({ limit: 1, cursor, direction, filter: currentFilter() });
    return (r && r.items && r.items[0]) || null;
  }

  // Zoom geometry (M5.6). The view is a displayed width + pan offset, so
  // swapping sm -> md -> full (same aspect) never moves the image.
  // fullW = width of the full-quality source: the loaded full image when
  // rank 3, else the DB width if its aspect matches, else the shown image.
  function computeGeom(dims, item, stage, view, rot) {
    if (!dims || !dims.nw || !dims.nh || !stage.w || !stage.h) return null;
    // M12.11: a quarter-turn rotation swaps the photo's visible width and height.
    const turned = rot === 90 || rot === 270;
    const vw = turned ? dims.nh : dims.nw;
    const vh = turned ? dims.nw : dims.nh;
    const aspect = vh / vw;
    let fullW = vw;
    const iw = item ? (turned ? item.height : item.width) : 0;
    const ih = item ? (turned ? item.width : item.height) : 0;
    if (dims.rank < 3 && iw > 0 && ih > 0 &&
        Math.abs(ih / iw - aspect) < 0.02 * aspect + 0.01) fullW = iw;
    const fitW = Math.min(stage.w, stage.h / aspect);
    const maxW = Math.max(fitW, fullW * MAX_ZOOM);
    const dw = view.fit ? fitW : Math.min(Math.max(view.dw, fitW), maxW);
    const dh = dw * aspect;
    const mx = Math.max(0, (dw - stage.w) / 2);
    const my = Math.max(0, (dh - stage.h) / 2);
    const px = view.fit ? 0 : Math.min(mx, Math.max(-mx, view.px));
    const py = view.fit ? 0 : Math.min(my, Math.max(-my, view.py));
    return { aspect, fullW, fitW, maxW, dw, dh, px, py, mx, my, sw: stage.w, sh: stage.h,
             zoomed: dw > fitW + 0.5, scale: dw / fullW, turned, rot: rot || 0 };
  }

  // Slider position: log scale between fit (0) and max (100).
  function sliderValue(g) {
    if (!g || g.maxW <= g.fitW + 1) return 0;
    return Math.round(100 * Math.log(g.dw / g.fitW) / Math.log(g.maxW / g.fitW));
  }

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60), sec = Math.floor(t % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }
  const noFocus = (e) => e.preventDefault(); // buttons never take focus, so Space can't "click" them

  // Video (M5.7): paused on open (no autoplay), custom control bar.
  // apiRef.current = { toggle } while mounted; released on unmount/url change.
  function VideoPlayer({ url, poster, onError, apiRef, rotation, stageBox }) {
    const vref = useRef(null);
    // M12.11: a turned video is drawn in a box with swapped sides, then rotated about its centre.
    const wrapRef = useRef(null);
    const [box, setBox] = useState(null);
    (window.preactHooks.useLayoutEffect || useEffect)(() => { // before the first paint: no unturned flash
      const el = wrapRef.current;
      if (!el) return undefined;
      const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    const turned = rotation === 90 || rotation === 270;
    const eff = stageBox && stageBox.w && stageBox.h ? stageBox : box; // M12.11: known on the first render, so the turn is in place before any zoom animation reads it
    const videoStyle = rotation && eff ? {
      width: (turned ? eff.h : eff.w) + 'px', height: (turned ? eff.w : eff.h) + 'px', flex: 'none',
      transform: 'rotate(' + rotation + 'deg)',
    } : (rotation ? { visibility: 'hidden' } : undefined);
    const [playing, setPlaying] = useState(false);
    const [t, setT] = useState(0);
    const [dur, setDur] = useState(0);
    const [muted, setMuted] = useState(false);
    const [vol, setVol] = useState(1);
    const scrubRef = useRef(null); // { wasPlaying } during a scrub drag
    // M8c.2 (U6): controls fade out 3 s after the mouse stops, as in Apple
    // Photos (also when paused). Never while the pointer is on the bar or
    // during a scrub. The pointer itself is never hidden.
    const [idle, setIdle] = useState(false);
    const idleTimerRef = useRef(null);
    const overBarRef = useRef(false);
    const wakeRef = useRef(() => {});
    wakeRef.current = () => {
      clearTimeout(idleTimerRef.current);
      setIdle(false);
      idleTimerRef.current = setTimeout(() => {
        if (!overBarRef.current && !scrubRef.current) setIdle(true);
      }, 3000);
    };
    useEffect(() => {
      wakeRef.current();
      return () => clearTimeout(idleTimerRef.current);
    }, [url]);
    useEffect(() => {
      const v = vref.current;
      apiRef.current = { toggle: () => { wakeRef.current(); if (v) (v.paused ? v.play().catch(() => {}) : v.pause()); } };
      return () => {
        apiRef.current = null;
        if (v) { v.pause(); v.removeAttribute('src'); v.load(); } // free decoder + buffers
      };
    }, [url]);
    const toggle = () => apiRef.current && apiRef.current.toggle();
    const endScrub = (el) => {
      const v = vref.current, st = scrubRef.current;
      scrubRef.current = null;
      wakeRef.current();
      if (v && st && st.wasPlaying) v.play().catch(() => {});
      if (el) el.blur();
    };
    return h('div', { ref: wrapRef, className: 'viewer-video-wrap' + (idle ? ' is-idle' : ''), onMouseMove: () => wakeRef.current() },
      h('video', {
        ref: vref, className: 'viewer-video', style: videoStyle, src: url, poster: poster || undefined, preload: 'metadata', playsInline: true,
        onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onEnded: () => setPlaying(false),
        onTimeUpdate: (e) => setT(e.currentTarget.currentTime),
        onLoadedMetadata: (e) => setDur(e.currentTarget.duration),
        onVolumeChange: (e) => { setMuted(e.currentTarget.muted); setVol(e.currentTarget.volume); },
        onError: () => onError && onError(),
        onClick: toggle,
      }),
      h('div', { className: 'viewer-vbar',
          onMouseEnter: () => { overBarRef.current = true; wakeRef.current(); },
          onMouseLeave: () => { overBarRef.current = false; wakeRef.current(); } },
        h('button', { className: 'viewer-vbtn', 'aria-label': playing ? tr('viewer.pause') : tr('viewer.play'), onMouseDown: noFocus, onClick: toggle },
          h(Icon, { name: playing ? 'pause' : 'play', size: 18 })),
        h('span', { className: 'viewer-vtime' }, fmtTime(t)),
        h('input', { className: 'viewer-vscrub', type: 'range', min: 0, max: dur || 0, step: 0.01, value: t, 'aria-label': tr('viewer.seek'),
          onInput: (e) => { const v = vref.current; if (v) { v.currentTime = Number(e.currentTarget.value); setT(v.currentTime); } },
          // Silence while scrubbing (no sped-up audio fragments); resume after if it was playing.
          onPointerDown: () => { const v = vref.current; if (v) { scrubRef.current = { wasPlaying: !v.paused }; v.pause(); } },
          onPointerUp: (e) => endScrub(e.currentTarget),
          onPointerCancel: (e) => endScrub(e.currentTarget) }),
        h('span', { className: 'viewer-vtime' }, '-' + fmtTime(Math.max(0, dur - t))),
        h('button', { className: 'viewer-vbtn', 'aria-label': muted ? tr('viewer.unmute') : tr('viewer.mute'), onMouseDown: noFocus,
          onClick: () => { const v = vref.current; if (v) v.muted = !v.muted; } },
          h(Icon, { name: muted || vol === 0 ? 'mute' : 'sound', size: 18 })),
        h('input', { className: 'viewer-vvol', type: 'range', min: 0, max: 1, step: 0.05, value: muted ? 0 : vol, 'aria-label': tr('viewer.volume'),
          onInput: (e) => { const v = vref.current; if (v) { v.volume = Number(e.currentTarget.value); v.muted = v.volume === 0; } },
          onPointerUp: (e) => e.currentTarget.blur() })));
  }

  // Live Photo motion (M5.7): plays once over the still, then onDone.
  // M6: sound=true (LIVE pressed) plays with audio; hover previews stay muted.
  // Pressing during a muted preview unmutes it in place.
  function LiveOverlay({ url, className, style, onDone, sound }) {
    const vref = useRef(null);
    useEffect(() => {
      const v = vref.current;
      if (v) {
        v.muted = !sound;
        v.play().catch(() => {
          // If unmuted playback is refused, fall back to muted instead of failing.
          v.muted = true;
          v.play().catch(() => onDone());
        });
      }
      return () => { if (v) { v.pause(); v.removeAttribute('src'); v.load(); } };
    }, [url]);
    useEffect(() => { const v = vref.current; if (v) v.muted = !sound; }, [sound]);
    return h('video', { ref: vref, className, style, src: url, muted: !sound, playsInline: true,
      onEnded: onDone, onError: onDone });
  }

  // ── Info panel (M5.8) ───────────────────────────────────────────────

  // Return to grid (M5.9): select the last viewed item; if the user moved
  // away from the item they opened, scroll the grid to it by exact index
  // (same exclusions/filter as the grid). Fails safe if it isn't in the grid.
  async function returnToGrid(openedId, lastId, keepSelection) {
    if (lastId == null) return;
    if (lastId === openedId) { if (!keepSelection) S.selectionStore.set(lastId); return; } // grid never moved
    let index = null;
    try { index = await window.api.getItemIndex({ id: lastId, filter: currentFilter() }); } catch (e) { index = null; }
    if (typeof index !== 'number') { if (!keepSelection) S.selectionStore.set(null); return; }
    S.navigationStore.goTo({ itemIndex: index });
    if (!keepSelection) S.selectionStore.set(lastId); // M12.2f: scoped sessions keep the selection
  }

  function ToolButton({ icon, label, onClick, disabled, active }) {
    return h('button', {
      className: 'viewer-btn' + (disabled ? ' is-disabled' : '') + (active ? ' is-active' : ''),
      'aria-label': label, 'aria-disabled': disabled ? 'true' : 'false',
      title: disabled ? label + ' — ' + READ_ONLY_TIP : label,
      onMouseDown: noFocus,
      onClick: disabled ? (e) => e.preventDefault() : onClick,
    }, icon === 'edit' ? h('span', { className: 'viewer-btn-text' }, tr('viewer.edit')) : h(Icon, { name: icon }));
  }

  function Viewer() {
    const [state, setState] = useState(null);          // { itemId, requestId } | null
    const [closing, setClosing] = useState(false); // false | true (fade) | 'zoom' (U10)
    const closingRef = useRef(false);
    closingRef.current = closing;
    const [zoomOpen, setZoomOpen] = useState(false); // U10: opening by zooming from the tile
    const imgElRef = useRef(null);
    const zoomFromRef = useRef(null);  // { id, rect } until the open zoom has started
    const zoomHandoffRef = useRef(null); // { id, rect, anim } while a video's thumbnail is zooming
    const zoomTokenRef = useRef(0);    // invalidates pending close-zoom frames
    const zoomOpenTimer = useRef(null);
    const [item, setItem] = useState(null);
    const [img, setImg] = useState(null);        // { url, rank } rank: 1 sm, 2 md, 3 full
    const [notice, setNotice] = useState(null);  // string | null
    const [infoOpen, setInfoOpen] = useState(false); // M8c.2b: mirrors the Info window
    // M7.7: Places section below the photo (places.js), slid into view by
    // scrolling at fit size. sheet = how far the stage is shifted up, in px.
    const [sheet, setSheet] = useState(0);
    // M10.6: recognised people in the current photo (people.js); null until loaded.
    const [peopleList, setPeopleList] = useState(null);
    const sheetRef = useRef(0);
    const sheetMaxRef = useRef(0);
    const sheetWheelRef = useRef(() => false);
    const [toolbarH, setToolbarH] = useState(52);
    const [nbrs, setNbrs] = useState({ prev: null, next: null, ready: false });
    const nbrsRef = useRef({ prev: null, next: null, ready: false });
    const nbrIdsRef = useRef([]);          // [next, prev] ids for the current item
    const pendingNavRef = useRef(null);    // 'next' | 'prev' pressed before neighbors resolved
    const cursorsRef = useRef(new Map());  // id -> { captureSort, id }
    const goRef = useRef(null);
    const stageRef = useRef(null);
    const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
    const [dims, setDims] = useState(null);   // natural size of the shown <img>: { nw, nh, rank }
    const [view, setView] = useState({ fit: true, dw: 0, px: 0, py: 0 });
    const geomRef = useRef(null);             // last rendered geometry, for event handlers
    const zoomRef = useRef(null);             // { applyZoom, panBy } for handlers bound once
    const itemRef = useRef(null);
    const [panning, setPanning] = useState(false);
    const [media, setMedia] = useState(null);  // { kind, url, liveUrl } from getDisplaySource
    const videoApiRef = useRef(null);          // { toggle } while a video is mounted
    const [livePlaying, setLivePlaying] = useState(false);
    const [liveSound, setLiveSound] = useState(false); // M6: true when LIVE was pressed
    const closeTimer = useRef(null);
    const stateRef = useRef(null);
    const sessionRef = useRef({ openedId: null, lastId: null }); // one open->close session
    stateRef.current = state;

    // Open/close from the store.
    useEffect(() => S.viewerStore.subscribe((v) => {
      clearTimeout(closeTimer.current);
      zoomTokenRef.current += 1;
      zoomHandoffRef.current = null;
      const imgEl = imgElRef.current;
      const vidEl = stageRef.current ? stageRef.current.querySelector('video.viewer-video') : null;
      for (const el of [imgEl, vidEl]) if (el && el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
      const sess = sessionRef.current;
      if (v) {
        if (sess.openedId == null) {                          // first open of a session
          sess.openedId = v.itemId;
          // K11: remember the page this session came from; zoom back only to it.
          sess.openSection = S.sectionStore ? S.sectionStore.get() : null;
          sess.openFilter = S.filterStore && S.filterStore.get ? S.filterStore.get() : null;
          sessionScope = typeof v.scope === 'string' ? v.scope : null; // M12.2f
          const rect = canZoom() ? findTileRect(v.itemId) : null; // U10: zoom from the tile
          zoomFromRef.current = rect ? { id: v.itemId, rect } : null;
          setZoomOpen(rect ? 'zooming' : false); // false | 'zooming' | 'done'
          clearTimeout(zoomOpenTimer.current);
          if (rect) zoomOpenTimer.current = setTimeout(() => { zoomFromRef.current = null; setZoomOpen('done'); }, 1200);
        }
        sess.lastId = v.itemId;                              // arrows also arrive as open()
        setClosing(false); setState(v); return;
      }
      const closingId = sess.lastId;
      const openCtx = { section: sess.openSection, filter: sess.openFilter };
      // K11: leaving for another page (People, another section, another grid):
      // fade, never zoom into a tile of a page that is going away.
      const leftPage = () => (S.sectionStore ? S.sectionStore.get() : null) !== openCtx.section
        || (S.filterStore && S.filterStore.get ? S.filterStore.get() : null) !== openCtx.filter;
      const wasScoped = sessionScope !== null; // M12.2f: a scoped session keeps the multi-selection
      sessionScope = null;
      returnToGrid(sess.openedId, sess.lastId, wasScoped);
      sessionRef.current = { openedId: null, lastId: null };
      const finish = () => { setState(null); setClosing(false); };
      const fade = () => { setClosing(true); closeTimer.current = setTimeout(finish, CLOSE_ANIM_MS); };
      // U10: shrink back into the tile once the grid has scrolled it into view.
      const target = zoomTarget(imgEl, stageRef.current, itemRef.current); // U10: photo or video
      if (!target || !canZoom() || leftPage()) { fade(); return; }
      setClosing('zoom');
      const token = zoomTokenRef.current;
      let tries = 0;
      const step = () => {
        if (token !== zoomTokenRef.current) return;
        if (leftPage()) { fade(); return; }
        const rect = findTileRect(closingId);
        if (rect) {
          const t = zoomTarget(imgEl, stageRef.current, itemRef.current) || target;
          runZoom(t.el, rect, 'out', () => { if (token === zoomTokenRef.current) finish(); }, t.F);
          return;
        }
        if (++tries < 10) requestAnimationFrame(step); else fade();
      };
      requestAnimationFrame(step);
    }), []);

    // Progressive load: sm (instant) -> md (1536px) -> full quality.
    // A stage is shown only if it outranks what's on screen, and only after
    // it has fully decoded, so there is no flash and no layout jump
    // (one <img>, object-fit: contain, same aspect ratio at every stage).
    const itemId = state ? state.itemId : null;
    useEffect(() => {
      setItem(null); setImg(null); setNotice(null); setMedia(null); setLivePlaying(false);
      // Only this item's decode may continue: everything else queued/running
      // is cancelled, but a decode already running for THIS item is kept.
      window.api.setDisplayWanted({ ids: itemId == null ? [] : [itemId] });
      if (itemId == null) return;
      let live = true;
      let shownRank = 0;
      const timers = [];
      const preloaders = new Set();

      function show(url, rank) {
        if (!live || !url || rank <= shownRank) return;
        const pre = new Image();
        preloaders.add(pre);
        pre.src = url;
        pre.decode().then(() => {
          preloaders.delete(pre);
          if (!live || rank <= shownRank) return;
          shownRank = rank;
          setImg({ url, rank });
        }).catch(() => {
          preloaders.delete(pre);
          if (live && rank === 3) setNotice(tr('viewer.err.fullQuality'));
        });
      }

      window.api.getItemById({ id: itemId }).then((row) => { if (live) setItem(row); });

      // 1. sm: already cached for nearly every item.
      window.api.getThumbnailPaths({ ids: [itemId], size: 'sm' }).then((r) => {
        const p = r && r[itemId];
        if (p) show(p, 1);
      });

      // 2. md: on demand. Re-assert priority every 4th poll, because the
      //    M2 foreground list is replace-on-call (the grid may call it too).
      let mdTries = 0;
      function pollMd() {
        if (!live || shownRank >= 2) return;
        if (mdTries % 4 === 0) window.api.requestThumbnailPriority({ ids: [itemId, ...nbrIdsRef.current], size: 'md' });
        mdTries++;
        window.api.getThumbnailPaths({ ids: [itemId], size: 'md' }).then((r) => {
          if (!live) return;
          const p = r && r[itemId];
          if (p) show(p, 2);
          else if (mdTries < MD_MAX_TRIES) timers.push(setTimeout(pollMd, MD_POLL_MS));
          else if (shownRank === 0) setNotice(tr('viewer.err.noPreview'));
        });
      }
      pollMd();

      // 3. Full quality, after a short settle delay.
      timers.push(setTimeout(async () => {
        if (!live) return;
        const src = await window.api.getDisplaySource({ id: itemId });
        if (!live) return;
        if (!src.ok) {
          setNotice(src.code === 'source_missing' ? tr('viewer.err.origPreview')
                                                  : tr('viewer.err.gone'));
          return;
        }
        if (src.kind === 'video' && src.needsDecode) {
          // M6 B.7: AVI or multi-audio-track video -> wait for the MP4 copy.
          // 'video-preparing' keeps the player unmounted (thumbnail shows).
          setMedia({ kind: 'video-preparing', url: null, liveUrl: src.liveUrl || null });
          setNotice(tr('viewer.preparingVideo'));
          const res = await window.api.ensureDisplay({ id: itemId });
          if (!live) return;
          if (!res.ok) {
            if (res.code !== 'cancelled') {
              setNotice(res.code === 'source_missing' ? tr('info.originalUnavailable') : tr('viewer.err.videoCantPlay'));
            }
            return;
          }
          setNotice(null);
          setMedia({ kind: 'video', url: res.url, liveUrl: src.liveUrl || null });
          return;
        }
        setMedia({ kind: src.kind, url: src.url, liveUrl: src.liveUrl || null });
        if (src.kind === 'unplayable-video') { setNotice(tr('viewer.err.videoFormat')); return; }
        if (src.kind !== 'image') return; // playable video: VideoPlayer takes over
        let url = src.url;
        if (src.needsDecode) {
          const res = await window.api.ensureDisplay({ id: itemId });
          if (!live) return;
          if (!res.ok) {
            if (res.code === 'source_missing') setNotice(tr('viewer.err.origPreview'));
            else if (res.code !== 'cancelled') setNotice(tr('viewer.err.fullQuality'));
            return;
          }
          url = res.url;
        }
        show(url, 3);
      }, FULL_DELAY_MS));

      return () => {
        live = false;
        timers.forEach(clearTimeout);
        preloaders.forEach((pre) => { pre.src = ''; });   // abort in-flight loads
        preloaders.clear();
      };
    }, [itemId]);

    // M6 (B.6g): 'Get Info' from the photo right-click menu asks for the
    // Info panel to be shown.
    useEffect(() => {
      const showInfo = () => { window.api.setInfoOpen(true).catch(() => {}); };
      window.addEventListener('photos:show-info', showInfo);
      return () => window.removeEventListener('photos:show-info', showInfo);
    }, []);

    // M8c.2b: the Info window's open state lives in the main process (session
    // only); the i button mirrors it, also when Info is closed with its own button.
    useEffect(() => {
      window.api.getInfoState().then((st) => setInfoOpen(!!(st && st.open))).catch(() => {});
      return window.api.onInfoVisibility((p) => setInfoOpen(!!(p && p.open)));
    }, []);

    // Match the grid toolbar's real height so switching views doesn't shift.
    const requestId = state ? state.requestId : null;
    useEffect(() => {
      if (requestId == null) return;
      const tb = document.getElementById('toolbar');
      if (tb && tb.offsetHeight) setToolbarH(tb.offsetHeight);
    }, [requestId]);

    // Zoom resets on navigation (M5.6).
    useEffect(() => { setDims(null); setView({ fit: true, dw: 0, px: 0, py: 0 }); }, [itemId]);
    // M12.11: a new rotation changes the photo's shape, so return to fit.
    const rotationNow = item && item.rotation ? item.rotation : 0;
    useEffect(() => { setView({ fit: true, dw: 0, px: 0, py: 0 }); }, [rotationNow]);

    // Track the stage size (window resizes, info panel later).
    const isOpen = state !== null;
    useEffect(() => {
      const el = stageRef.current;
      if (!isOpen || !el) return;
      const measure = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [isOpen]);

    // Zoom toward an anchor point (stage-centre-relative px), clamped.
    // M8c.2 (U9): discrete zoom steps (Cmd +/-/0, the - / + buttons) glide;
    // pinch and slider dragging stay immediate. FLIP: remember the photo's
    // rect here; after the re-render a transform-only animation eases it from
    // there (see the layout effect below). Animating width/height instead made
    // the photo shake (whole-pixel layout vs fractional position).
    const zoomFlipRef = useRef(null);
    function applyZoom(targetFn, ax = 0, ay = 0, animate = false) {
      const g = geomRef.current;
      if (!g) return;
      if (animate && imgElRef.current && canZoom()) zoomFlipRef.current = imgElRef.current.getBoundingClientRect();
      setView((v) => {
        const curW = v.fit ? g.fitW : Math.min(Math.max(v.dw, g.fitW), g.maxW);
        const curPx = v.fit ? 0 : v.px, curPy = v.fit ? 0 : v.py;
        const nw = Math.min(Math.max(targetFn(curW, g), g.fitW), g.maxW);
        if (nw <= g.fitW + 0.5) return { fit: true, dw: g.fitW, px: 0, py: 0 };
        const k = nw / curW;
        const mx = Math.max(0, (nw - g.sw) / 2), my = Math.max(0, (nw * g.aspect - g.sh) / 2);
        const clamp = (x, m) => Math.min(m, Math.max(-m, x));
        return { fit: false, dw: nw, px: clamp(ax - (ax - curPx) * k, mx), py: clamp(ay - (ay - curPy) * k, my) };
      });
    }
    function panBy(dx, dy) {
      const g = geomRef.current;
      if (!g) return;
      setView((v) => v.fit ? v : {
        ...v,
        px: Math.min(g.mx, Math.max(-g.mx, v.px + dx)),
        py: Math.min(g.my, Math.max(-g.my, v.py + dy)),
      });
    }
    zoomRef.current = { applyZoom, panBy };
    itemRef.current = item;
    // U10: start the open zoom on the first commit where the photo is sized.
    useLayoutEffect(() => {
      const item0 = itemRef.current;
      // Hand-off: the video arrived while its thumbnail was zooming -> the video
      // continues the same zoom from the same elapsed time (same picture, same rect).
      const hf = zoomHandoffRef.current;
      if (hf && item0 && item0.id === hf.id) {
        const t = zoomTarget(imgElRef.current, stageRef.current, item0);
        if (t && !t.standIn) {
          zoomHandoffRef.current = null;
          t.el.classList.add('is-zoom-run');
          const elapsed = hf.anim && typeof hf.anim.currentTime === 'number' ? hf.anim.currentTime : 300;
          if (elapsed < 300) { const a2 = runZoom(t.el, hf.rect, 'in', () => setZoomOpen('done'), t.F); if (a2) a2.currentTime = elapsed; }
        }
        return;
      }
      const z = zoomFromRef.current;
      if (!z || !item0 || item0.id !== z.id) return;
      const t = zoomTarget(imgElRef.current, stageRef.current, item0); // photo, video, or a video's thumbnail
      if (!t) return;
      zoomFromRef.current = null;
      clearTimeout(zoomOpenTimer.current);
      t.el.classList.add('is-zoom-run'); // a video stays hidden until its zoom starts (no flash)
      setZoomOpen('running'); // backdrop and bar fades start together with the zoom, not before
      const anim = runZoom(t.el, z.rect, 'in', () => setZoomOpen('done'), t.F); // 'done': no animation left to replay
      if (t.standIn) zoomHandoffRef.current = { id: z.id, rect: z.rect, anim };
    });
    // U9: play a pending zoom step as a transform-only animation (FLIP).
    useLayoutEffect(() => {
      const old = zoomFlipRef.current, el = imgElRef.current;
      if (!old) return;
      zoomFlipRef.current = null;
      if (!el) return;
      const neu = el.getBoundingClientRect();
      if (!neu.width || !old.width) return;
      const k = old.width / neu.width;
      const dx = (old.left + old.width / 2) - (neu.left + neu.width / 2);
      const dy = (old.top + old.height / 2) - (neu.top + neu.height / 2);
      if (Math.abs(k - 1) < 0.001 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const base = el.style.transform || '';
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) ' + base + ' scale(' + k + ')' },
        { transform: base || 'none' }], { duration: 250, easing: ZOOM_EASE });
    });
    const zoomable = () => !!geomRef.current && !(itemRef.current && itemRef.current.media_type === 'video');

    // M7.7: scroll rule shared by the stage and the Places panel. Returns true
    // when it consumed the event. Never active while zoomed or pinching.
    const PLACES_H = 440;
    window.__PhotosViewerSheetValue = () => sheetRef.current; // read by the trail (places.js)
    // M10.6: People (when this photo has recognised people) sits above Places.
    const PEOPLE_H = 230;
    const peopleH = peopleList && peopleList.length > 0 && window.__PhotosViewerPeople ? PEOPLE_H : 0;
    const placesH = item && item.has_gps && window.__PhotosViewerPlaces ? PLACES_H : 0;
    if (item) sheetMaxRef.current = peopleH + placesH;
    sheetWheelRef.current = (e) => {
      if (e.ctrlKey || sheetMaxRef.current <= 0) return false;
      if (geomRef.current && geomRef.current.zoomed) return false;
      const cur = sheetRef.current;
      const next = Math.max(0, Math.min(sheetMaxRef.current, cur + e.deltaY));
      if (next === cur && cur === 0) return false;
      e.preventDefault();
      if (next !== cur) { sheetRef.current = next; setSheet(next); }
      return true;
    };
    useEffect(() => {
      // M7.7 trail: places.js may request a scroll position for a specific
      // item ({ itemId, value }); applied once, when that item has loaded.
      const pending = window.__PhotosViewerSheetPending;
      if (state && item && pending && pending.itemId === item.id) {
        window.__PhotosViewerSheetPending = null;
        const v = sheetMaxRef.current > 0 ? Math.max(0, Math.min(Number(pending.value) || 0, sheetMaxRef.current)) : 0;
        sheetRef.current = v; setSheet(v);
        return;
      }
      if (!state || (item && !item.has_gps)) { sheetRef.current = 0; setSheet(0); }
    }, [state, item]);

    // M10.6: load the people in this photo; reload when people are regrouped.
    useEffect(() => {
      setPeopleList(null);
      if (item == null || window.__PhotosPeopleForItem == null) return undefined; // videos too (poster-frame faces)
      let alive = true;
      const id = item.id;
      const load = () => window.__PhotosPeopleForItem(id).then((rows) => { if (alive) setPeopleList(Array.isArray(rows) ? rows : []); });
      load();
      const st = window.__PhotosStores;
      const off = st && st.peopleChangeStore ? st.peopleChangeStore.subscribe(load) : null;
      return () => { alive = false; if (off) off(); };
    }, [item ? item.id : null]);
    // Keep the sheet within range when the space below shrinks.
    useEffect(() => {
      if (sheetRef.current > sheetMaxRef.current) { sheetRef.current = sheetMaxRef.current; setSheet(sheetMaxRef.current); }
    }, [peopleList, item]);

    // Inputs (M5.6): pinch / scroll-pan / drag-pan / double-click on the stage.
    useEffect(() => {
      const el = stageRef.current;
      if (!isOpen || !el) return;
      const rel = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
      function onWheel(e) {
        if (sheetWheelRef.current(e)) return; // M7.7: slide the Places section
        if (!zoomable()) return;
        if (e.ctrlKey) {                       // trackpad pinch arrives as ctrl+wheel
          e.preventDefault();
          const [ax, ay] = rel(e);
          const f = Math.exp(-e.deltaY * 0.01);
          zoomRef.current.applyZoom((w) => w * f, ax, ay);
        } else if (geomRef.current.zoomed) {  // two-finger scroll pans when zoomed
          e.preventDefault();
          zoomRef.current.panBy(-e.deltaX, -e.deltaY);
        }
      }
      let drag = null;
      function onDown(e) {
        if (e.button !== 0 || !zoomable() || !geomRef.current.zoomed || e.target.closest('.viewer-chev')) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        setPanning(true);
      }
      function onMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        zoomRef.current.panBy(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX; drag.y = e.clientY;
      }
      function onUp(e) {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null; setPanning(false);
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      }
      // M8c.2 (U9): as in Apple Photos, double-click closes a photo; zoom is
      // via the slider, - / + and Cmd +/-/0. Videos and the arrows are unaffected.
      function onDbl(e) {
        if (!zoomable() || e.target.closest('.viewer-chev')) return;
        S.viewerStore.close();
      }
      el.addEventListener('wheel', onWheel, { passive: false });
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('dblclick', onDbl);
      return () => {
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('dblclick', onDbl);
      };
    }, [isOpen]);

    // M8b.8: the library can change while the viewer is open (watcher).
    // Every bump drops cached cursors and re-resolves the neighbors; if the
    // current item is gone, move to the next item (then previous), else
    // close. Runs before the neighbor effect, so it still sees the old ones.
    const [libVersion, setLibVersion] = useState(0);
    useEffect(() => S.libraryChangeStore.subscribe((v) => {
      cursorsRef.current.clear();
      setLibVersion(v);
    }), []);
    useEffect(() => {
      if (libVersion === 0 || itemId == null) return;
      let live = true;
      const before = nbrsRef.current;
      const candidates = [before.next, before.prev].filter((x) => x != null);
      (async () => {
        const f = currentFilter();
        const exists = async (id) => {
          try { return (await window.api.getItemIndex({ id, filter: f })) != null; } catch (e) { return true; }
        };
        if (await exists(itemId)) return;
        for (const id of candidates) {
          if (!live) return;
          if (await exists(id)) { if (live) S.viewerStore.open(id); return; }
        }
        if (live) S.viewerStore.close();
      })();
      return () => { live = false; };
    }, [libVersion]);

    // M8c.1 (U7): position line under the title ("998/998"), as in Apple Photos.
    // getItemIndex is 0-based from the newest item, so position = n - index:
    // the newest reads n/n and the oldest 1/n (verified against the library).
    // Uses the same filter the viewer navigates by (trail override included).
    const [pos, setPos] = useState(null);
    useEffect(() => {
      if (itemId == null) { setPos(null); return; }
      let live = true;
      const f = currentFilter();
      Promise.all([
        window.api.getItemIndex({ id: itemId, filter: f }),
        window.api.getTotalCount({ filter: f }),
      ]).then(([i, t]) => {
        const n = typeof t === 'number' ? t : (t && typeof t.count === 'number' ? t.count : null);
        if (live) setPos(typeof i === 'number' && n > 0 ? { i: n - i, n } : null);
      }).catch(() => { if (live) setPos(null); });
      return () => { live = false; };
    }, [itemId, libVersion]);

    // Neighbors (M5.5): resolved on every item change.
    useEffect(() => {
      const empty = { prev: null, next: null, ready: false };
      nbrsRef.current = empty; setNbrs(empty); nbrIdsRef.current = [];
      if (itemId == null) { pendingNavRef.current = null; return; }
      let live = true;
      let timer = null;
      (async () => {
        let cursor = cursorsRef.current.get(itemId);
        if (!cursor) {
          const row = await window.api.getItemById({ id: itemId });
          if (!live || !row) return;
          cursor = { captureSort: row.capture_sort, id: row.id };
        }
        const [next, prev] = await Promise.all([neighborOf(cursor, 'older'), neighborOf(cursor, 'newer')]);
        if (!live) return;
        const cache = cursorsRef.current;
        if (cache.size > 1000) cache.clear();
        for (const n of [next, prev]) if (n) cache.set(n.id, { captureSort: n.capture_sort, id: n.id });
        const v = { prev: prev ? prev.id : null, next: next ? next.id : null, ready: true };
        nbrsRef.current = v; setNbrs(v);
        nbrIdsRef.current = [v.next, v.prev].filter(Boolean);
        const pending = pendingNavRef.current;
        pendingNavRef.current = null;
        if (pending && v[pending]) { S.viewerStore.open(v[pending]); return; }
        timer = setTimeout(() => {
          if (!live) return;
          const ids = nbrIdsRef.current;
          window.api.requestThumbnailPriority({ ids: [itemId, ...ids], size: 'md' });
          window.api.setDisplayWanted({ ids: [itemId, ...ids] });
          ids.forEach((id) => window.api.ensureDisplay({ id }));
        }, NEIGHBOR_PRELOAD_MS);
      })();
      return () => { live = false; clearTimeout(timer); };
    }, [itemId, libVersion]); // M8b.8: also after library changes

    function go(dir) {
      const v = nbrsRef.current;
      if (!v.ready) { pendingNavRef.current = dir; return; }
      if (v[dir]) S.viewerStore.open(v[dir]);
    }
    goRef.current = go;

    // M12.3: favorite the shown photo (by id), and keep the heart current after any edit.
    async function toggleShownFavorite() {
      const it = itemRef.current;
      if (!it) return;
      try {
        await window.api.setFavorite({ target: { ids: [it.id] }, value: it.is_favorite !== 1 });
        const row = await window.api.getItemById({ id: it.id });
        if (row && itemRef.current && itemRef.current.id === row.id) setItem(row);
      } catch (err) { /* the grid's notice path covers failures */ }
    }
    window.__PhotosViewerToggleFavorite = toggleShownFavorite;
    // M12.11: rotate the shown photo by id; the item is re-read on library:edited.
    window.__PhotosViewerRotate = async (delta) => { const it = itemRef.current; if (it) await window.api.rotateItems({ target: { ids: [it.id] }, delta }); };
    useEffect(() => (window.api.onLibraryEdited ? window.api.onLibraryEdited(() => {
      const it = itemRef.current;
      if (!it) return;
      window.api.getItemById({ id: it.id }).then((row) => { if (row && itemRef.current && itemRef.current.id === row.id) setItem(row); }).catch(() => {});
    }) : undefined), []);

    // Keyboard (window-level; Grid's handler is suspended while open).
    useEffect(() => {
      function onKey(e) {
        // While closing (shrinking back or fading) the viewer takes no keys, so
        // arrows go to the grid instead of reopening the viewer on the next item.
        const open = stateRef.current !== null && !closingRef.current;
        const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
        if (!open) {
          if (e.key === ' ' && !typing && S.selectionStore.get() != null) {
            e.preventDefault(); S.viewerStore.open(S.selectionStore.get(), { scope: S.selectionStore.isMulti() ? S.selectionStore.withSelection(S.filterStore.get()) : null }); // M12.2f
          }
          return;
        }
        if (e.key === ' ' && videoApiRef.current) { e.preventDefault(); videoApiRef.current.toggle(); return; } // Space = play/pause on videos
        if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); S.viewerStore.close(); return; }
        if (e.metaKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); if (zoomable()) zoomRef.current.applyZoom((w) => w * 1.25, 0, 0, true); return; }
        if (e.metaKey && (e.key === '-' || e.key === '_')) { e.preventDefault(); if (zoomable()) zoomRef.current.applyZoom((w) => w / 1.25, 0, 0, true); return; }
        if (e.metaKey && e.key === '0') { e.preventDefault(); if (zoomable()) zoomRef.current.applyZoom(() => 0, 0, 0, true); return; }
        if (e.metaKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); window.api.toggleInfo().catch(() => {}); return; }
        if (e.key === '.' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) { e.preventDefault(); toggleShownFavorite(); return; } // M12.3
        // M6: grid is oldest (left) -> newest (right); data 'prev' is the NEWER photo.
        if (e.key === 'ArrowRight') { e.preventDefault(); goRef.current('prev'); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); goRef.current('next'); return; }
        if (e.key.startsWith('Arrow')) { e.preventDefault(); }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);

    if (!state) return null;
    const title = formatTitle(item && item.capture_time_local);
    // M8c.2 (U12): a located item's title shows the place on line 1 and
    // 'date · position' on line 2, as in Apple Photos (scrolled or not).
    const posText = pos ? window.i18n.number(pos.i) + '/' + window.i18n.number(pos.n) : '';
    const viewerLocale = window.i18n.getLocale();
    const hasUserTitle = !!(item && item.title);
    const titlePlace = item ? (window.PlaceText.placeTitle(item, viewerLocale) || '') : '';
    const placeParts = item ? window.PlaceText.viewerPlaceParts(item, viewerLocale, hasUserTitle) : []; // M13: landmark first, city and country on line 2
    const geom = item ? computeGeom(dims, item, stageSize, view, item.rotation ? item.rotation : 0) : null; // M12.11: never size before the rotation is known
    geomRef.current = geom;
    const isVideo = !!media && media.kind === 'video';
    const hasLive = !!media && !!media.liveUrl && !isVideo;
    // U16: the Live badge sits 12 px inside the PHOTO's top-left corner (stage
    // coordinates: the photo's top-left = stage centre + (px - dw/2, py - dh/2)),
    // never closer than 14 px to the stage edge when zoomed past the corner.
    const liveBadgeStyle = geom && stageSize ? {
      left: Math.max(14, stageSize.w / 2 + geom.px - geom.dw / 2 + 12) + 'px',
      top: Math.max(14, stageSize.h / 2 + geom.py - geom.dh / 2 + 12) + 'px',
    } : undefined;
    // M12.11: the <img> keeps its unturned layout box; the turn is a rotate about its centre.
    const boxW = geom ? (geom.turned ? geom.dh : geom.dw) : 0;
    const boxH = geom ? (geom.turned ? geom.dw : geom.dh) : 0;
    const imgStyle = geom ? {
      width: boxW + 'px', height: boxH + 'px',
      transform: 'translate(' + (geom.px - boxW / 2) + 'px,' + (geom.py - boxH / 2) + 'px)' + (geom.rot ? ' rotate(' + geom.rot + 'deg)' : ''),
    } : null;
    const sliderEnabled = !!geom && geom.maxW > geom.fitW + 1 && !(item && item.media_type === 'video');

    return h('div', { className: 'viewer' + (closing === 'zoom' ? ' is-zoom-close' : closing ? ' is-closing' : '') + (zoomOpen === 'zooming' ? ' is-zoom-open is-zoom-wait' : zoomOpen === 'running' ? ' is-zoom-open' : zoomOpen === 'done' ? ' is-zoom-done' : '') + (item && item.media_type === 'video' ? ' is-video-item' : '') },
      h('div', { className: 'viewer-toolbar', style: { height: toolbarH + 'px' } },
        // M6 (B.4): same sidebar toggle as the grid toolbar (renders only while
        // the sidebar is hidden).
        window.__PhotosSidebarToggleButton && h(window.__PhotosSidebarToggleButton),
        h('div', { className: 'viewer-group is-round' },
          h(ToolButton, { icon: 'back', label: tr('viewer.back'), onClick: () => S.viewerStore.close() })),
        // Zoom slider (M5.6): log scale between fit and max.
        // M8c.1 (U7): slider in a capsule with - / + steps, as in Apple Photos.
        h('div', { className: 'viewer-group is-zoom' },
          h('button', { className: 'viewer-zoom-step', 'aria-label': tr('viewer.zoomOut'), title: tr('viewer.zoomOut'), disabled: !sliderEnabled, onMouseDown: (e) => e.preventDefault(), onClick: () => { const g = geomRef.current; if (!g) return; const t = Math.max(0, Math.min(100, sliderValue(g) + (-20))) / 100; zoomRef.current.applyZoom(() => g.fitW * Math.pow(g.maxW / g.fitW, t), 0, 0, true); } }, '−'),
        h('input', { className: 'viewer-zoom', type: 'range', min: 0, max: 100, step: 1,
          value: sliderValue(geom), disabled: !sliderEnabled, 'aria-label': tr('viewer.zoom'), title: tr('viewer.zoom'),
          onInput: (e) => {
            const g = geomRef.current;
            if (!g) return;
            const t = Number(e.currentTarget.value) / 100;
            zoomRef.current.applyZoom(() => g.fitW * Math.pow(g.maxW / g.fitW, t));
          } }),
          h('button', { className: 'viewer-zoom-step', 'aria-label': tr('viewer.zoomIn'), title: tr('viewer.zoomIn'), disabled: !sliderEnabled, onMouseDown: (e) => e.preventDefault(), onClick: () => { const g = geomRef.current; if (!g) return; const t = Math.max(0, Math.min(100, sliderValue(g) + (20))) / 100; zoomRef.current.applyZoom(() => g.fitW * Math.pow(g.maxW / g.fitW, t), 0, 0, true); } }, '+')),
        h('div', { className: 'viewer-title' },
          h('div', { className: 'viewer-title-date' }, (item && item.title) || titlePlace || title.date), // M12.4: a title replaces the place/date line
          h('div', { className: 'viewer-title-time' },
            [...placeParts, (hasUserTitle || titlePlace) ? title.date : null, posText].filter(Boolean).join(' \u00b7 ') || '\u00a0')),
        h('div', { className: 'viewer-toolbar-spacer' }),
        // M8c.1 (U7): Apple's order. Trash stays visible and disabled (write feature).
        h('div', { className: 'viewer-group' },
          h(ToolButton, { icon: 'info', label: tr('viewer.info'), active: infoOpen, onClick: () => window.api.toggleInfo().catch(() => {}) }),
          h(ToolButton, { icon: 'share', label: tr('viewer.share'), disabled: true }),
          h(ToolButton, { icon: 'heart', label: item && item.is_favorite === 1 ? tr('unfavorite') : tr('favorite'), disabled: !item, active: !!(item && item.is_favorite === 1), onClick: toggleShownFavorite }), // M12.3
          h(ToolButton, { icon: 'rotate', label: tr('viewer.rotateLeft'), disabled: !item, onClick: (e) => window.__PhotosViewerRotate(e && e.altKey ? 90 : -90) }), // M12.11
          h(ToolButton, { icon: 'trash', label: tr('viewer.delete'), disabled: true })),
        h('div', { className: 'viewer-group' },
          h(ToolButton, { icon: 'edit', label: tr('viewer.edit'), disabled: true }))),
      h('div', { className: 'viewer-stage' + (geom && geom.zoomed ? ' is-zoomed' : '') + (panning ? ' is-panning' : ''), ref: stageRef,
        style: sheet > 0 ? { transform: 'translateY(' + (-sheet) + 'px)' } : undefined },
        isVideo && h(VideoPlayer, {
          key: media.url, url: media.url, poster: img ? img.url : null, apiRef: videoApiRef, rotation: item && item.rotation ? item.rotation : 0, stageBox: stageSize, // M12.11
          onError: () => { setMedia((m) => (m ? { ...m, kind: 'unplayable-video' } : m)); setNotice(tr('viewer.err.videoFormat')); },
        }),
        img && !isVideo && h('img', {
          ref: imgElRef,
          className: 'viewer-img' + (geom ? ' is-sized' : ''),
          src: img.url, 'data-rank': img.rank, 'data-scale': geom ? geom.scale.toFixed(3) : '',
          draggable: false, alt: '',
          onLoad: (e) => { const t = e.currentTarget; setDims({ nw: t.naturalWidth, nh: t.naturalHeight, rank: img.rank }); },
          style: imgStyle || (!item ? { visibility: 'hidden' } : undefined), // M12.11: no unturned flash
        }),
        img && hasLive && livePlaying && h(LiveOverlay, {
          key: 'live-' + media.liveUrl, url: media.liveUrl, style: imgStyle,
          className: 'viewer-img viewer-live-video' + (geom ? ' is-sized' : ''),
          onDone: () => setLivePlaying(false),
          sound: liveSound,
        }),
        hasLive && h('div', {
          className: 'viewer-live-badge' + (livePlaying ? ' is-playing' : ''),
          style: liveBadgeStyle,
          title: tr('viewer.livePlay'),
          onPointerEnter: () => { setLiveSound(true); setLivePlaying(true); }, // M6: Live Photos always play with sound
          onPointerLeave: () => setLivePlaying(false),
          onPointerDown: (e) => { e.stopPropagation(); setLiveSound(true); setLivePlaying(true); },
          onDblClick: (e) => e.stopPropagation(),
        }, h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('circle', { cx: 8, cy: 8, r: 2, fill: 'currentColor' }), h('circle', { cx: 8, cy: 8, r: 4.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }), h('circle', { cx: 8, cy: 8, r: 6.8, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.1, 'stroke-dasharray': '0.9 1.5', 'stroke-linecap': 'round' })), h('span', null, 'LIVE')), // U16: Apple's Live symbol (dotted outer ring)
        !img && notice && h('div', { className: 'viewer-empty' }, notice),
        img && notice && h('div', { className: 'viewer-notice' }, notice),
        // M8b.9 fix: '<' goes older (next), '>' goes newer (prev), as the
        // arrow keys do; each is shown only when that neighbor exists.
        nbrs.next && h('button', { className: 'viewer-chev viewer-chev-prev', 'aria-label': tr('viewer.previous'),
          onClick: () => goRef.current('next'), onDblClick: (e) => e.stopPropagation() }, h(Icon, { name: 'back', size: 26 })),
        nbrs.prev && h('button', { className: 'viewer-chev viewer-chev-next', 'aria-label': tr('viewer.next'),
          onClick: () => goRef.current('prev'), onDblClick: (e) => e.stopPropagation() }, h(Icon, { name: 'fwd', size: 26 }))),
      window.__PhotosViewerPeople && peopleH > 0 && h(window.__PhotosViewerPeople, {
        item, sheet, height: PEOPLE_H, list: peopleList,
        onWheel: (e) => sheetWheelRef.current(e),
      }),
      window.__PhotosViewerPlaces && h(window.__PhotosViewerPlaces, {
        item, sheet: sheet - peopleH, height: PLACES_H, pinUrl: img ? img.url : null,
        onWheel: (e) => sheetWheelRef.current(e),
      }),
      null); // M8c.2b: Info is its own window (info-window.js / info.js)
  }

  window.addEventListener('DOMContentLoaded', () => {
    const root = document.createElement('div');
    root.id = 'viewer-root';
    document.getElementById('content').appendChild(root);
    render(h(Viewer), root);
  });
})();
