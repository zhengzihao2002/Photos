/**
 * timeline-data-layer.js
 *
 * Aggregate queries for the Years / Months / Days views. Group-level access
 * (not item-index addressing), so it's separate from data-layer.js. Every
 * result is newest-first. Each period gets a coverItemId: the newest item
 * in that period, found with a synthetic boundary cursor (id: 0) plus
 * limit 1. The cursor is a keyset comparison, so it doesn't need to match a
 * real row. Always unfiltered (no filter UI exists yet).
 */
(function () {
  function pad(n) { return String(n).padStart(2, '0'); }

  /** 'YYYY-MM-DD' for a date built from parts, using UTC math to avoid DST/timezone shifts. */
  function ymd(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  function createTimelineDataLayer({ api }) {
    let destroyed = false;

    /** Newest item strictly older than a boundary timestamp, or null. */
    async function coverBefore(boundaryDate) {
      const page = await api.getItemsPage({
        limit: 1,
        cursor: { captureTimeLocal: boundaryDate + ' 00:00:00', id: 0 },
        direction: 'older',
        filter: null,
      });
      return page.items.length ? page.items[0].id : null;
    }

    /** Resolves cover ids for many periods in parallel. */
    async function resolveCovers(boundaries) {
      return Promise.all(boundaries.map((b) => coverBefore(b)));
    }

    async function loadYears() {
      const rows = await api.getCountsByYearMonth({ filter: null });
      if (destroyed) return [];
      const byYear = new Map();
      for (const r of rows) byYear.set(r.year, (byYear.get(r.year) || 0) + r.count);
      const years = [...byYear.entries()].map(([year, count]) => ({ year, count }));
      years.sort((a, b) => b.year - a.year);
      const covers = await resolveCovers(years.map((y) => ymd(y.year + 1, 1, 1)));
      if (destroyed) return [];
      return years.map((y, i) => ({ ...y, coverItemId: covers[i] }));
    }

    async function loadMonths() {
      const rows = await api.getCountsByYearMonth({ filter: null });
      if (destroyed) return [];
      const months = rows
        .map((r) => ({ year: r.year, month: r.month, count: r.count }))
        .sort((a, b) => (b.year - a.year) || (b.month - a.month));
      const covers = await resolveCovers(months.map((m) => ymd(m.year, m.month + 1, 1)));
      if (destroyed) return [];
      return months.map((m, i) => ({ ...m, coverItemId: covers[i] }));
    }

    async function loadDays() {
      const rows = await api.getCountsByDate({ filter: null });
      if (destroyed) return [];
      const days = rows
        .map((r) => {
          const [y, m, d] = r.date.split('-').map(Number);
          return { date: r.date, count: r.count, y, m, d };
        })
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      const covers = await resolveCovers(days.map((x) => ymd(x.y, x.m, x.d + 1)));
      if (destroyed) return [];
      return days.map((x, i) => ({ date: x.date, count: x.count, coverItemId: covers[i] }));
    }

    function destroy() { destroyed = true; }

    return { loadYears, loadMonths, loadDays, destroy };
  }

  window.createTimelineDataLayer = createTimelineDataLayer;
})();
