/**
 * extract-image.js
 *
 * Per-file metadata extraction for images (including RAW, HEIC, GIF, BMP).
 * Single-file-in-isolation scope only — Live Photo pairing and burst
 * grouping need sibling files and are handled by the M1.6 orchestrator.
 *
 * Read-only: exifr and the container dimension readers only ever open files
 * for reading.
 */

const exifr = require('exifr');
const { cleanTitle, cleanCaption, cleanKeywords, parseExposureBias, parseFocal35 } = require('./embedded-text'); // M12.4
const { readContainerDimensions } = require('./image-dimensions');
const { readStillIdentifier } = require('./live-identifier'); // M15
const { parseOffsetMinutes, offsetFromGps } = require('./capture-time');
const {
  isPanoramaByAspectRatio,
  applyOrientation,
  isPlausibleCaptureParts,
} = require('./metadata-helpers');

const EXIFR_OPTIONS = {
  translateKeys: true,
  translateValues: false,
  reviveValues: true,
  mergeOutput: true,
  xmp: true,  // M12.4: XMP title / description / subject
  iptc: true, // M12.4: IPTC object name / caption / keywords
};

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

function nullIfUndefined(value) {
  return value === undefined ? null : value;
}

async function readExif(fullPath) {
  try {
    const result = await exifr.parse(fullPath, EXIFR_OPTIONS);
    return result || {};
  } catch (err) {
    return {};
  }
}

async function resolveRawDimensions(fullPath, extension, exif) {
  const containerResult = await readContainerDimensions(fullPath, extension);
  if (containerResult) return containerResult;

  if (typeof exif.ImageWidth === 'number' && typeof exif.ImageHeight === 'number') {
    return { width: exif.ImageWidth, height: exif.ImageHeight };
  }
  if (typeof exif.ExifImageWidth === 'number' && typeof exif.ExifImageHeight === 'number') {
    return { width: exif.ExifImageWidth, height: exif.ExifImageHeight };
  }
  return null;
}

function exifDateToPlausibleParts(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const parts = dateToParts(value);
  return isPlausibleCaptureParts(parts) ? parts : null;
}

// Display time = EXIF DateTimeOriginal, else CreateDate. exifr revives the naive
// "YYYY:MM:DD HH:MM:SS" text as a local Date, so the local getters give back the
// exact digits the file carries. No file name guessing: no EXIF date means the
// caller falls back to the file's modification time.
function resolveCaptureTimeFromExif(exif) {
  // Each rung must pass the plausibility rule (M1 patch A.2); a sentinel such
  // as "0000:00:00 00:00:00" (revived by exifr as 1899-11-30) falls through.
  const originalParts = exifDateToPlausibleParts(exif.DateTimeOriginal);
  if (originalParts) {
    return { parts: originalParts, source: 'exif_original', offsetText: exif.OffsetTimeOriginal || exif.OffsetTime };
  }
  const createParts = exifDateToPlausibleParts(exif.CreateDate);
  if (createParts) {
    return { parts: createParts, source: 'exif_create', offsetText: exif.OffsetTimeDigitized || exif.OffsetTime };
  }
  return null;
}

async function extractImageMetadata(fullPath, filename, extension) {
  const exif = await readExif(fullPath);
  // M15: Live Photo Content Identifier (bounded 512 KB read, HEIC/HEIF/JPEG only)
  const contentIdentifier = /^(heic|heif|jpe?g)$/i.test(extension || '') ? await readStillIdentifier(fullPath) : null;

  const rawDimensions = await resolveRawDimensions(fullPath, extension, exif);
  // HEIF: the container's 'irot' is authoritative when present (HEIF spec);
  // EXIF Orientation is the fallback (e.g. files written without 'irot').
  const hasIrot = rawDimensions !== null && typeof rawDimensions.irotDegrees === 'number';
  const orientation = hasIrot
    ? (rawDimensions.irotDegrees % 180 === 90 ? 6 : 1)
    : (typeof exif.Orientation === 'number' ? exif.Orientation : 1);

  let width = null;
  let height = null;
  let orientationApplied = 0;

  if (rawDimensions) {
    const oriented = applyOrientation(rawDimensions.width, rawDimensions.height, orientation);
    width = oriented.width;
    height = oriented.height;
    orientationApplied = 1;
  }

  const captureTime = resolveCaptureTimeFromExif(exif);
  let captureOffsetMinutes = null;
  if (captureTime) {
    captureOffsetMinutes = parseOffsetMinutes(captureTime.offsetText);
    if (captureOffsetMinutes === null) {
      captureOffsetMinutes = offsetFromGps(captureTime.parts, exif.GPSDateStamp, exif.GPSTimeStamp);
    }
  }
  const isPanorama = isPanoramaByAspectRatio(width, height);

  const latitude = typeof exif.latitude === 'number' ? exif.latitude : null;
  const longitude = typeof exif.longitude === 'number' ? exif.longitude : null;

  return {
    width,
    height,
    orientationApplied,
    captureTimeParts: captureTime ? captureTime.parts : null,
    captureTimeSource: captureTime ? captureTime.source : null,
    captureOffsetMinutes,
    cameraMake: nullIfUndefined(exif.Make),
    cameraModel: nullIfUndefined(exif.Model),
    lensModel: nullIfUndefined(exif.LensModel),
    iso: typeof exif.ISO === 'number' && exif.ISO > 0 ? exif.ISO : null,
    fNumber: typeof exif.FNumber === 'number' ? exif.FNumber : null,
    exposureTimeSeconds: typeof exif.ExposureTime === 'number' ? exif.ExposureTime : null,
    focalLengthMm: typeof exif.FocalLength === 'number' ? exif.FocalLength : null,
    // M12.4 / M12.7: read-only imports; cleaned, junk dropped.
    titleFile: cleanTitle(exif.title, filename) || cleanTitle(exif.ObjectName, filename),
    captionFile: cleanCaption(exif.description) || cleanCaption(exif.Caption) || cleanCaption(exif.ImageDescription),
    keywordsFile: cleanKeywords(exif.subject, exif.Keywords),
    exposureBiasEv: parseExposureBias(exif.ExposureCompensation) ?? parseExposureBias(exif.ExposureBiasValue),
    focalLength35mm: parseFocal35(exif.FocalLengthIn35mmFormat),
    gpsLatitude: latitude,
    gpsLongitude: longitude,
    isPanorama,
    contentIdentifier,
    extractionError: width === null || height === null ? 'dimensions_unavailable' : null,
  };
}

module.exports = { extractImageMetadata };
