/**
 * info-format.js (M8c.2b)
 *
 * Formatting helpers for the Info window (info.js), moved from viewer.js's
 * former Info panel. Texts come from the catalog (M14). Exposed as window.InfoFormat.
 */
(function () {
  'use strict';
  const t = window.t;

  const DATE_SOURCE_NOTE = {
    file_mtime: 'date.note.mtime',
    filename_pattern: 'date.note.filename',
  };
  const FORMAT_NAME = { jpg: 'JPEG', jpeg: 'JPEG', tif: 'TIFF', tiff: 'TIFF', heic: 'HEIF', heif: 'HEIF' };

  // capture_time_local is wall-clock 'YYYY-MM-DD HH:MM[:SS]'.
  function dateTime(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return window.i18n.date(d, { year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  }
  // M12.6: 'M/D/YYYY' from capture_time_local, for the summary's date range.
  function shortDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? t('date.short', { m: +m[2], d: +m[3], y: m[1] }) : null;
  }
  function cameraName(make, model) {
    make = (make || '').trim(); model = (model || '').trim();
    if (!make && !model) return null;
    if (!model) return make;
    if (!make || model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0])) return model;
    return make + ' ' + model;
  }
  function round(v, places) {
    const k = Math.pow(10, places);
    return String(Math.round(v * k) / k);
  }
  // Apple's five-cell row: ISO, focal length, exposure bias, aperture, shutter.
  function exposureCells(item) {
    const t = item.exposure_time_seconds;
    const shutter = t > 0 ? (t >= 1 ? round(t, 1) + ' s' : '1/' + Math.round(1 / t) + ' s') : null;
    const bias = typeof item.exposure_bias_ev === 'number' ? round(item.exposure_bias_ev, 1) + ' ev' : null;
    return [
      item.iso ? 'ISO ' + item.iso : null,
      item.focal_length_35mm ? round(item.focal_length_35mm, 0) + ' mm' : null, // M12.7: 35 mm equivalent, as Apple shows
      bias,
      item.f_number ? '\u0192' + round(item.f_number, 2) : null,
      shutter,
    ].map((x) => x || '-');
  }
  function bytes(b) { // decimal units, like Finder / Preview
    if (!(b > 0)) return null;
    const num = (v, digits) => window.i18n.number(v, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    if (b < 1e3) return t('size.bytes', { count: b });
    if (b < 1e6) return t('size.kb', { value: num(Math.round(b / 1e3), 0) });
    if (b < 1e9) return t('size.mb', { value: num(b / 1e6, 1) });
    return t('size.gb', { value: num(b / 1e9, 2) });
  }
  function dims(w, h) {
    return w && h ? w + ' \u00d7 ' + h : null;
  }
  function formatBadge(ext) {
    ext = String(ext || '').replace(/^\./, '').toLowerCase();
    return ext ? (FORMAT_NAME[ext] || ext.toUpperCase()) : null;
  }
  function coords(lat, lon) {
    if (lat == null || lon == null) return null;
    return t('coords.line', {
      lat: Math.abs(lat).toFixed(4), ns: t(lat >= 0 ? 'coords.n' : 'coords.s'),
      lon: Math.abs(lon).toFixed(4), ew: t(lon >= 0 ? 'coords.e' : 'coords.w'),
    });
  }
  function duration(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60), sec = Math.floor(t % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }
  // M13: one implementation for every window (lib/place-text.js).
  function placeLine(item) {
    return window.PlaceText ? window.PlaceText.placeLine(item, window.i18n.getLocale()) : null;
  }

  window.InfoFormat = {
    dateTime, shortDate, cameraName, exposureCells, bytes, dims, formatBadge, coords, duration, placeLine,
    dateNote: (source) => (DATE_SOURCE_NOTE[source] ? t(DATE_SOURCE_NOTE[source]) : null),
  };
})();
