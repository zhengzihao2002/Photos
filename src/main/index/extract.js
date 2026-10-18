/**
 * extract.js
 *
 * Ties together file stats and the image/video extractors into one object
 * shaped like a row in the `items` table.
 *
 * Scope boundary: this handles everything determinable from a single file
 * in isolation. Live Photo pairing and burst grouping need sibling files in
 * the same folder and are handled by the M1.6 scan orchestrator, which also
 * fills in source_folder_id and relative_path — neither of which this
 * module knows about.
 *
 * Fail-soft contract: a single bad file never throws out of this module.
 * If fs.stat itself fails (the file vanished or became unreadable between
 * discovery and extraction), the caller gets { skip: true } and should not
 * insert a row this scan — there is no legitimate value to put in the
 * NOT NULL file_size_bytes/file_mtime columns in that case, and the file
 * will be picked up again on the next scan if it's still there. Every other
 * failure produces a full row with extraction_error set, never an
 * exception.
 */

const fs = require('fs');
const { extractImageMetadata } = require('./extract-image');
const { extractVideoMetadata } = require('./extract-video');
const { formatCaptureTimeLocal, formatCaptureDate } = require('./metadata-helpers');
const { RAW_EXTENSIONS } = require('./discover');

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

// GPS plausibility (M7.2), applied to images and videos alike. The pair is
// accepted or rejected as a whole: both must be finite numbers in range, and
// "null island" (0,0, written by devices with no fix) is rejected. A single
// zero is legitimate (equator / Greenwich meridian) and is kept.
const NULL_ISLAND_EPSILON_DEGREES = 0.0001;

function normalizeGpsPair(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (Math.abs(latitude) < NULL_ISLAND_EPSILON_DEGREES
    && Math.abs(longitude) < NULL_ISLAND_EPSILON_DEGREES) return null;
  return { latitude, longitude };
}

async function extractItemMetadata({ fullPath, filename, extension, mediaType }) {
  let stat;
  try {
    stat = await fs.promises.stat(fullPath);
  } catch (err) {
    return { skip: true, reason: err.message };
  }

  const fileSizeBytes = stat.size;
  const fileMtime = Math.floor(stat.mtimeMs / 1000);

  const perTypeResult = mediaType === 'video'
    ? await extractVideoMetadata(fullPath, filename)
    : await extractImageMetadata(fullPath, filename, extension);

  const gps = normalizeGpsPair(perTypeResult.gpsLatitude, perTypeResult.gpsLongitude);

  let captureTimeParts = perTypeResult.captureTimeParts;
  let captureTimeSource = perTypeResult.captureTimeSource;

  if (!captureTimeParts) {
    captureTimeParts = dateToParts(new Date(stat.mtimeMs));
    captureTimeSource = 'file_mtime';
  }

  const captureTimeLocal = formatCaptureTimeLocal(captureTimeParts);
  const captureDate = formatCaptureDate(captureTimeParts);

  return {
    skip: false,
    filename,
    media_type: mediaType,
    extension,
    file_size_bytes: fileSizeBytes,
    file_mtime: fileMtime,
    width: perTypeResult.width,
    height: perTypeResult.height,
    orientation_applied: perTypeResult.orientationApplied,
    duration_seconds: mediaType === 'video' ? perTypeResult.durationSeconds : null,
    capture_time_local: captureTimeLocal,
    capture_time_source: captureTimeSource,
    capture_date: captureDate,
    capture_year: captureTimeParts.year,
    capture_month: captureTimeParts.month,
    camera_make: perTypeResult.cameraMake,
    camera_model: perTypeResult.cameraModel,
    lens_model: perTypeResult.lensModel,
    iso: perTypeResult.iso,
    f_number: perTypeResult.fNumber,
    exposure_time_seconds: perTypeResult.exposureTimeSeconds,
    focal_length_mm: perTypeResult.focalLengthMm,
    gps_latitude: gps ? gps.latitude : null,
    gps_longitude: gps ? gps.longitude : null,
    has_gps: gps ? 1 : 0,
    is_raw: RAW_EXTENSIONS.has(extension) ? 1 : 0,
    is_gif: extension === 'gif' ? 1 : 0,
    is_panorama: perTypeResult.isPanorama ? 1 : 0,
    extraction_error: perTypeResult.extractionError,
    // M12.4 / M12.7 (extractor-owned; keywords_file is a list, stored in item_keywords)
    title_file: perTypeResult.titleFile ?? null,
    caption_file: perTypeResult.captionFile ?? null,
    keywords_file: perTypeResult.keywordsFile || [],
    exposure_bias_ev: perTypeResult.exposureBiasEv ?? null,
    focal_length_35mm: perTypeResult.focalLength35mm ?? null,
  };
}

module.exports = { extractItemMetadata, normalizeGpsPair };
