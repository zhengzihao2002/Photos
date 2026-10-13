/**
 * metadata-helpers.js
 *
 * Pure, dependency-free helper functions used by the extraction pipeline.
 * No file I/O here — these only transform values already in memory
 * (filenames, EXIF orientation numbers, width/height pairs).
 */

const path = require('path');

const DATE_TIME_PATTERN = /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/;
const DATE_ONLY_PATTERN = /(\d{4})(\d{2})(\d{2})/;
const EPOCH_MILLIS_PATTERN = /^(\d{13})$/;
const EPOCH_SECONDS_PATTERN = /^(\d{10})$/;

function stripExtension(filename) {
  const ext = path.extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

function isPlausibleDateParts(year, month, day) {
  if (year < 1990 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}

// Capture-time plausibility (M1 patch A.2). A candidate that fails is
// rejected and the fallback chain moves to the next source. Lower bound:
// strictly after 1970-01-01 00:00:00, which catches EXIF "0000:00:00"
// (revived as 1899-11-30), the QuickTime/MP4 1904 epoch and Unix epoch 0.
// Upper bound: now + 1 day, since naive local time may lead UTC by <=14h.
const MIN_CAPTURE_EPOCH_MS = Date.UTC(1970, 0, 1, 0, 0, 0);
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function isPlausibleCaptureParts(parts) {
  if (!parts) return false;
  const { year, month, day, hour, minute, second } = parts;
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return ms > MIN_CAPTURE_EPOCH_MS && ms <= Date.now() + FUTURE_TOLERANCE_MS;
}

function dateToParts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

/**
 * Tries to pull a capture timestamp out of a filename alone. Order matters:
 * a full date+time pattern is tried first (most precise), then a date-only
 * pattern, then bare Unix epoch timestamps (common from messaging apps).
 * Returns null if nothing plausible is found.
 *
 * Caveat: bare epoch timestamps are converted to calendar fields using the
 * extraction machine's current timezone, since the value itself carries no
 * timezone information. This can be wrong if the photo was taken somewhere
 * with a different UTC offset than wherever/whenever the scan runs.
 */
function parseFilenameTimestamp(filename) {
  const base = stripExtension(filename);

  const dateTimeMatch = base.match(DATE_TIME_PATTERN);
  if (dateTimeMatch) {
    const year = Number(dateTimeMatch[1]);
    const month = Number(dateTimeMatch[2]);
    const day = Number(dateTimeMatch[3]);
    const hour = Number(dateTimeMatch[4]);
    const minute = Number(dateTimeMatch[5]);
    const second = Number(dateTimeMatch[6]);
    if (isPlausibleDateParts(year, month, day) && hour <= 23 && minute <= 59 && second <= 59) {
      const parts = { year, month, day, hour, minute, second };
      if (isPlausibleCaptureParts(parts)) return parts;
    }
  }

  const dateOnlyMatch = base.match(DATE_ONLY_PATTERN);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (isPlausibleDateParts(year, month, day)) {
      const parts = { year, month, day, hour: 0, minute: 0, second: 0 };
      if (isPlausibleCaptureParts(parts)) return parts;
    }
  }

  const millisMatch = base.match(EPOCH_MILLIS_PATTERN);
  if (millisMatch) {
    const date = new Date(Number(millisMatch[1]));
    if (!Number.isNaN(date.getTime())) {
      const parts = dateToParts(date);
      if (isPlausibleCaptureParts(parts)) return parts;
    }
  }

  const secondsMatch = base.match(EPOCH_SECONDS_PATTERN);
  if (secondsMatch) {
    const date = new Date(Number(secondsMatch[1]) * 1000);
    if (!Number.isNaN(date.getTime())) {
      const parts = dateToParts(date);
      if (isPlausibleCaptureParts(parts)) return parts;
    }
  }

  return null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatCaptureTimeLocal(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function formatCaptureDate(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function isPanoramaByAspectRatio(width, height) {
  if (!width || !height) return false;
  const longer = Math.max(width, height);
  const shorter = Math.min(width, height);
  return longer / shorter >= 3;
}

/**
 * EXIF orientation values 5-8 mean the stored pixel grid is rotated 90 or
 * 270 degrees relative to how it should display, so width and height need
 * to be swapped to reflect what a viewer actually sees.
 */
function applyOrientation(width, height, orientation) {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

module.exports = {
  parseFilenameTimestamp,
  formatCaptureTimeLocal,
  formatCaptureDate,
  isPanoramaByAspectRatio,
  applyOrientation,
  isPlausibleCaptureParts,
};
