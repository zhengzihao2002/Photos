/**
 * data-layer.js
 *
 * Bridges M1's cursor-based (keyset) get-items-page API to a virtualized
 * grid that needs to address items by absolute index (0 = newest item in
 * the current filter). No DOM. Depends on window.RangeSet (range-set.js)
 * and window.api (preload.js).
 *
 * INDEX -> CURSOR STRATEGY (confirmed empirically against the real API,
 * see M3 build log): get-items-page's cursor is a pure keyset boundary
 * comparison on (capture_time_local, id) — it does NOT require the cursor
 * values to belong to an existing row. This lets us build a "synthetic"
 * cursor at any date boundary (e.g. '2022-12-07 00:00:00', id: 0) and the
 * query correctly returns items older than that boundary, even though no
 * row has that exact timestamp/id pair. This is what makes arbitrary
 * index -> data resolution possible without a new IPC channel.
 *
 * CACHE EVICTION: bounded at MAX_CACHED_ITEMS. When exceeded, ranges
 * farthest (by index distance) from the most recent ensureRange() call
 * are evicted first, keeping memory near the user's current scroll
 * position regardless of library size.
 */
(function () {
  const DEFAULT_PAGE_LIMIT = 200;
  const MAX_CACHED_ITEMS = 3000;

  function createDataLayer({ api, initialFilter = null }) {
    let filter = initialFilter;
    let totalCount = null;
    let dateSections = []; // [{ date, count, startIndex }], newest-first
    let lastEnsureCenter = 0;
    let lastEnsure = null; // M8b.8: last range the grid asked for (visible + overscan)

    const itemCache = new Map();      // index -> item row
    const loadedRanges = new window.RangeSet();
    const inFlightRanges = new window.RangeSet();
    const listeners = new Set();      // callbacks for onRangeLoaded
    let destroyed = false;
    let refreshToken = 0; // bumped on setFilter/destroy; stale fetches check this and drop their results

    function notifyRangeLoaded(start, end, meta) {
      for (const cb of listeners) {
        try { cb(start, end, meta || {}); } catch (err) { console.error('[data-layer] onRangeLoaded callback threw:', err); }
      }
    }

    /** Rebuilds dateSections' cumulative startIndex from raw per-date counts. */
    function buildDateSections(rawCounts) {
      let cumulative = 0;
      const sections = [];
      for (const { date, count } of rawCounts) {
        sections.push({ date, count, startIndex: cumulative });
        cumulative += count;
      }
      return sections;
    }

    async function refreshTotals() {
      const myToken = refreshToken;
      const [count, rawCounts] = await Promise.all([
        api.getTotalCount({ filter }),
        api.getCountsByDate({ filter }),
      ]);
      if (destroyed || myToken !== refreshToken) return; // stale — a newer setFilter/destroy happened
      totalCount = count;
      dateSections = buildDateSections(rawCounts);
    }

    function getTotalCount() {
      return totalCount;
    }

    function getDateSections() {
      return dateSections;
    }

    function getItemAt(index) {
      const cached = itemCache.get(index);
      if (cached) return cached;
      return Object.freeze({ __placeholder: true, index });
    }

    /**
     * Finds which date section a given absolute index falls into, and the
     * offset within that section. Returns null if dateSections isn't
     * loaded yet or the index is out of range (both are legitimate
     * "not ready yet" states the caller must tolerate).
     */
    function locateSection(index) {
      if (!dateSections.length) return null;
      for (let i = 0; i < dateSections.length; i++) {
        const section = dateSections[i];
        const sectionEnd = section.startIndex + section.count - 1;
        if (index >= section.startIndex && index <= sectionEnd) {
          return { section, offsetInSection: index - section.startIndex, sectionIndex: i };
        }
      }
      return null;
    }

    const activeFetches = []; // [{start, end}] — currently in-flight fetches

    function rebuildInFlightRanges() {
      inFlightRanges.clear();
      for (const f of activeFetches) inFlightRanges.addRange(f.start, f.end);
    }

    function enforceCacheBound() {
      if (itemCache.size <= MAX_CACHED_ITEMS) return;
      const half = Math.floor(MAX_CACHED_ITEMS / 2);
      const keepStart = Math.max(0, lastEnsureCenter - half);
      const keepEnd = lastEnsureCenter + half;
      for (const index of itemCache.keys()) {
        if (index < keepStart || index > keepEnd) itemCache.delete(index);
      }
      loadedRanges.evictOutside(keepStart, keepEnd);
    }

    /**
     * Fetches items covering [start, end] and writes them into itemCache.
     * Resolves the starting cursor from dateSections (see file header),
     * then walks forward page by page using each response's nextCursor.
     * If the resolved starting section is approximate (offsetInSection > 0),
     * leading items are discarded until the true 'start' index is reached —
     * this is the "self-correcting" approximation noted in the design.
     */
    async function fetchRange(start, end) {
      if (destroyed) return;
      const myToken = refreshToken;

      const located = locateSection(start);
      if (!located) return; // dateSections not ready yet; a later ensureRange call will retry

      let cursor = null;
      if (located.sectionIndex > 0) {
        const newerNeighbor = dateSections[located.sectionIndex - 1];
        cursor = { captureTimeLocal: `${newerNeighbor.date} 00:00:00`, id: 0 };
      }

      let skip = located.offsetInSection;
      // Skipped items are discarded without advancing fetchedThrough, so the
      // first KEPT item is the one at 'start' (not start - skip). M3 bug fix.
      let fetchedThrough = start - 1;
      let safetyPages = 0;
      const MAX_SAFETY_PAGES = 200;

      while (fetchedThrough < end && safetyPages < MAX_SAFETY_PAGES) {
        safetyPages++;
        const page = await api.getItemsPage({ limit: DEFAULT_PAGE_LIMIT, cursor, direction: 'older', filter });
        if (destroyed || myToken !== refreshToken) return;

        for (const item of page.items) {
          if (skip > 0) { skip--; continue; }
          fetchedThrough++;
          itemCache.set(fetchedThrough, item);
        }

        if (!page.hasMore || !page.nextCursor) break;
        cursor = page.nextCursor;
      }

      if (fetchedThrough >= start) {
        loadedRanges.addRange(start, fetchedThrough);
        notifyRangeLoaded(start, fetchedThrough, {});
      }
      enforceCacheBound();
    }

    function ensureRange(start, end) {
      if (destroyed || totalCount == null) return;
      start = Math.max(0, start);
      end = Math.min(totalCount - 1, end);
      if (end < start) return;
      lastEnsureCenter = Math.floor((start + end) / 2);
      lastEnsure = { start, end };

      for (const [gapStart, gapEnd] of loadedRanges.findGaps(start, end)) {
        for (const [fStart, fEnd] of inFlightRanges.findGaps(gapStart, gapEnd)) {
          const descriptor = { start: fStart, end: fEnd };
          activeFetches.push(descriptor);
          rebuildInFlightRanges();
          fetchRange(fStart, fEnd).finally(() => {
            const i = activeFetches.indexOf(descriptor);
            if (i !== -1) activeFetches.splice(i, 1);
            rebuildInFlightRanges();
          });
        }
      }
    }

    function onRangeLoaded(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }

    /** Clears all cached state and reloads totals/sections for the current filter. */
    async function reload() {
      refreshToken++;
      totalCount = null;
      dateSections = [];
      itemCache.clear();
      loadedRanges.clear();
      inFlightRanges.clear();
      activeFetches.length = 0;
      notifyRangeLoaded(0, -1, { reset: true });
      await refreshTotals();
      if (!destroyed) notifyRangeLoaded(0, -1, { reset: true });
    }

    async function setFilter(newFilter) {
      filter = newFilter;
      await reload();
    }

    /** Reloads the library without changing the active filter (used on library-changed). */
    /**
     * M8b.8: soft refresh for library changes (the watcher can cause many).
     * The current items stay on screen while new totals, sections and the
     * range the grid last asked for are fetched into locals; then everything
     * is swapped in at once with a single reset, so the grid never renders an
     * empty frame. setFilter (a different section) keeps the hard reload().
     */
    async function fetchInto(target, sections, start, end, myToken) {
      let si = -1;
      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        if (start >= sec.startIndex && start < sec.startIndex + sec.count) { si = i; break; }
      }
      if (si === -1) return null;
      let cursor = null;
      if (si > 0) cursor = { captureTimeLocal: sections[si - 1].date + ' 00:00:00', id: 0 };
      let skip = start - sections[si].startIndex;
      let through = start - 1;
      let guard = 0;
      while (through < end && guard < 200) {
        guard++;
        const page = await api.getItemsPage({ limit: DEFAULT_PAGE_LIMIT, cursor, direction: 'older', filter });
        if (destroyed || myToken !== refreshToken) return null;
        for (const item of page.items) {
          if (skip > 0) { skip--; continue; }
          through++;
          target.set(through, item);
        }
        if (!page.hasMore || !page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return through >= start ? { start, end: through } : null;
    }

    async function softRefresh() {
      if (destroyed) return;
      refreshToken++;
      const myToken = refreshToken;
      const [count, rawCounts] = await Promise.all([
        api.getTotalCount({ filter }),
        api.getCountsByDate({ filter }),
      ]);
      if (destroyed || myToken !== refreshToken) return;
      const sections = buildDateSections(rawCounts);
      const fresh = new Map();
      let got = null;
      if (lastEnsure && count > 0) {
        const s0 = Math.max(0, lastEnsure.start);
        const e0 = Math.min(count - 1, lastEnsure.end);
        if (e0 >= s0) got = await fetchInto(fresh, sections, s0, e0, myToken);
        if (destroyed || myToken !== refreshToken) return;
      }
      totalCount = count;
      dateSections = sections;
      itemCache.clear();
      for (const [k, v] of fresh) itemCache.set(k, v);
      loadedRanges.clear();
      activeFetches.length = 0;
      inFlightRanges.clear();
      if (got) loadedRanges.addRange(got.start, got.end);
      notifyRangeLoaded(0, -1, { reset: true });
    }

    async function refresh() {
      await softRefresh();
    }

    function destroy() {
      destroyed = true;
      refreshToken++;
      listeners.clear();
      itemCache.clear();
      loadedRanges.clear();
      inFlightRanges.clear();
      activeFetches.length = 0;
    }

    (async () => {
      await refreshTotals();
      if (!destroyed) notifyRangeLoaded(0, -1, { reset: true });
    })();

    return { getTotalCount, getDateSections, getItemAt, ensureRange, onRangeLoaded, setFilter, refresh, destroy };
  }

  window.createDataLayer = createDataLayer;
})();
