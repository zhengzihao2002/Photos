/**
 * info-format.js (M8c.2b)
 *
 * Formatting helpers for the Info window (info.js), moved from viewer.js's
 * former Info panel. English UI (M8c.2 U13). Exposed as window.InfoFormat.
 */
(function () {
  'use strict';

  const DATE_SOURCE_NOTE = {
    file_mtime: "Date from the file's modification time",
    filename_pattern: 'Date from the filename',
  };
  const FORMAT_NAME = { jpg: 'JPEG', jpeg: 'JPEG', tif: 'TIFF', tiff: 'TIFF', heic: 'HEIF', heif: 'HEIF' };

  // capture_time_local is wall-clock 'YYYY-MM-DD HH:MM[:SS]'.
  function dateTime(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return d.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  }
  // M12.6: 'M/D/YYYY' from capture_time_local, for the summary's date range.
  function shortDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? (+m[2]) + '/' + (+m[3]) + '/' + m[1] : null;
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
    if (b < 1e3) return b + ' bytes';
    if (b < 1e6) return Math.round(b / 1e3) + ' KB';
    if (b < 1e9) return (b / 1e6).toFixed(1) + ' MB';
    return (b / 1e9).toFixed(2) + ' GB';
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
    const f = (v, pos, neg) => Math.abs(v).toFixed(4) + '\u00b0 ' + (v >= 0 ? pos : neg);
    return f(lat, 'N', 'S') + ', ' + f(lon, 'E', 'W');
  }
  function duration(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60), sec = Math.floor(t % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }
  // Keep in step with placeLine() in places.js (copied so the Info window
  // does not load the whole map module).
  function placeLine(item) {
    if (!item) return null;
    const locality = item.place_locality_en || null;
    const region = item.place_region_en || null;
    let country = null;
    if (item.place_country_code) {
      try { country = new Intl.DisplayNames(['en-US'], { type: 'region' }).of(item.place_country_code); }
      catch (err) { country = item.place_country_code; }
    }
    const parts = [locality, region !== locality ? region : null, country].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }

  window.InfoFormat = {
    dateTime, shortDate, cameraName, exposureCells, bytes, dims, formatBadge, coords, duration, placeLine,
    dateNote: (source) => DATE_SOURCE_NOTE[source] || null,
  };
})();
