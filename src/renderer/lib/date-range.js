/**
 * date-range.js  (M14)
 *
 * 'Nov 10 - Dec 25, 2025' / '2025年11月10日至12月25日': one whole catalog sentence per
 * case (same day, same month, same year, different years), so the order of the
 * parts and the joining word belong to the language. No Intl.formatRange: its
 * Chinese output differs between ICU versions.
 */
(function (root) {
  const shortMonth = (m) => new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, 1)));

  /** start, end: 'YYYY-MM-DD'; tr: the translate function. */
  function formatDateRange(start, end, tr) {
    const a = String(start).split('-').map(Number);
    const b = String(end).split('-').map(Number);
    const p = (i, y, m, d) => ({ [`y${i}`]: y, [`m${i}`]: m, [`d${i}`]: d, [`s${i}`]: shortMonth(m) });
    const base = Object.assign({}, p(1, a[0], a[1], a[2]), p(2, b[0], b[1], b[2]));
    if (start === end) return tr('date.range.single', base);
    if (a[0] !== b[0]) return tr('date.range.differentYears', base);
    if (a[1] === b[1]) return tr('date.range.sameMonth', base);
    return tr('date.range.sameYear', base);
  }

  const api = { formatDateRange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DateRange = api;
})(typeof window !== 'undefined' ? window : globalThis);
