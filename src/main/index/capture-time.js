/**
 * capture-time.js
 *
 * The two clocks of a capture time.
 *
 *  - Display time (items.capture_time_local, capture_date/year/month): the
 *    wall-clock digits the file itself carries (EXIF DateTimeOriginal, else
 *    CreateDate, else the file's modification time). Shown exactly as stored;
 *    never converted to the device's time zone.
 *  - Sort key (items.capture_sort): the same moment on one common scale (UTC,
 *    'YYYY-MM-DD HH:MM:SS'), so photos taken in different time zones compare
 *    correctly. Used for ordering and ranges only; never displayed.
 *
 * The UTC offset of a photo comes from, in order: EXIF OffsetTimeOriginal /
 * OffsetTimeDigitized / OffsetTime; the GPS UTC timestamp compared with the
 * wall clock; otherwise the device's own offset at that wall time.
 */

const GPS_OFFSET_TOLERANCE_MINUTES = 5;
const MAX_OFFSET_MINUTES = 14 * 60;

function pad2(n) { return String(n).padStart(2, '0'); }

/** '+08:00' / '-0500' / 'Z' / '+8' -> minutes east of UTC, or null. */
function parseOffsetMinutes(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^(z|utc|gmt)$/i.test(text)) return 0;
  const m = /^(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(text);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] || 0);
  if (minutes > MAX_OFFSET_MINUTES) return null;
  return (m[1] === '-' ? -1 : 1) * minutes;
}

function wallAsUtcMs(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** Offset implied by the GPS UTC timestamp, or null when absent/inconsistent. */
function offsetFromGps(parts, gpsDateStamp, gpsTimeStamp) {
  if (typeof gpsDateStamp !== 'string' || !Array.isArray(gpsTimeStamp) || gpsTimeStamp.length < 3) return null;
  const d = /^(\d{4})[:\-](\d{2})[:\-](\d{2})/.exec(gpsDateStamp.trim());
  if (!d) return null;
  const [h, mi, s] = gpsTimeStamp.map(Number);
  if (![h, mi, s].every(Number.isFinite)) return null;
  const gpsMs = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, mi, Math.floor(s));
  const diffMinutes = (wallAsUtcMs(parts) - gpsMs) / 60000;
  const rounded = Math.round(diffMinutes / 15) * 15;
  if (!Number.isFinite(rounded) || Math.abs(rounded) > MAX_OFFSET_MINUTES) return null;
  if (Math.abs(diffMinutes - rounded) > GPS_OFFSET_TOLERANCE_MINUTES) return null;
  return rounded;
}

/** The device's own offset (minutes east of UTC) at a wall-clock time. */
function deviceOffsetMinutes(parts) {
  const local = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return -local.getTimezoneOffset();
}

function formatUtcMs(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
    + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
}

/**
 * Sort key for wall-clock parts. offsetMinutes null/undefined = unknown, so the
 * device's offset at that wall time is assumed.
 */
function captureSortFromParts(parts, offsetMinutes) {
  const offset = Number.isFinite(offsetMinutes) ? offsetMinutes : deviceOffsetMinutes(parts);
  return formatUtcMs(wallAsUtcMs(parts) - offset * 60000);
}

/** Sort key for an absolute moment in ms (file modification time). */
function captureSortFromEpochMs(ms) {
  return formatUtcMs(ms);
}

module.exports = {
  parseOffsetMinutes,
  offsetFromGps,
  deviceOffsetMinutes,
  captureSortFromParts,
  captureSortFromEpochMs,
};
