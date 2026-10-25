/**
 * extract-video.js
 *
 * Per-file metadata extraction for videos, via ffprobe (read-only inspection
 * only — never ffmpeg, never a write/transcode mode).
 *
 * Timezone note: ffprobe's creation_time is a UTC-stamped string
 * ("2023-05-14T14:30:22.000000Z"), unlike EXIF's naive-local timestamps.
 * Converting it through the scanning machine's current timezone would often
 * land on the wrong calendar day. Instead we take the digits at face value,
 * the same treatment as EXIF's naive-local values, and accept that this can
 * be off by a few hours around a day boundary for videos shot in a
 * different timezone than the one used to interpret them — a documented
 * limitation, not a silent wrong answer dressed up as a precise one.
 */

const { safeExecFile: execFile } = require('../safe-exec'); // M11
const ffprobePath = require('ffprobe-static').path;
const { cleanTitle, cleanCaption, cleanKeywords } = require('./embedded-text'); // M12.4
const { isPlausibleCaptureParts } = require('./metadata-helpers');
const { parseOffsetMinutes, parseDateText } = require('./capture-time');
const { videoIdentifierFromProbe } = require('./live-identifier'); // M15


function runFfprobe(fullPath) {
  return new Promise((resolve) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', fullPath],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          resolve(null);
        }
      }
    );
  });
}

function findVideoStream(probeResult) {
  if (!probeResult || !Array.isArray(probeResult.streams)) return null;
  return probeResult.streams.find((s) => s.codec_type === 'video') || null;
}

function extractRotationDegrees(stream) {
  if (!stream) return 0;
  if (Array.isArray(stream.side_data_list)) {
    for (const sideData of stream.side_data_list) {
      if (typeof sideData.rotation === 'number') {
        return sideData.rotation;
      }
    }
  }
  if (stream.tags && typeof stream.tags.rotate === 'string') {
    const parsed = Number(stream.tags.rotate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function normalizeRotation(deg) {
  let normalized = deg % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

// Display time: Apple's com.apple.quicktime.creationdate (local wall clock with
// its UTC offset) when present, else a container creation date (UTC when it
// carries a Z, shown as written). Tags are looked up case-insensitively on the
// container and on every stream, since cameras, phones and editors put them in
// different places. Nothing usable means the caller falls back to the file's
// modification time.
const LOCAL_DATE_TAGS = ['com.apple.quicktime.creationdate'];
const UTC_DATE_TAGS = ['creation_time', 'date', 'date_recorded', 'date_encoded', 'encoded_date', 'tagged_date', 'creationdate'];

function tagSources(probeResult, videoStream) {
  const out = [];
  if (videoStream && videoStream.tags) out.push(videoStream.tags);
  if (probeResult && probeResult.format && probeResult.format.tags) out.push(probeResult.format.tags);
  for (const st of (probeResult && probeResult.streams) || []) if (st !== videoStream && st.tags) out.push(st.tags);
  return out;
}

function parseDateTag(text) {
  const parsed = parseDateText(text);
  return parsed && isPlausibleCaptureParts(parsed.parts) ? parsed : null;
}

function resolveCaptureTimeFromContainer(probeResult, videoStream) {
  const sources = tagSources(probeResult, videoStream);
  const find = (names) => {
    for (const tags of sources) {
      for (const key of Object.keys(tags)) {
        if (!names.includes(key.toLowerCase())) continue;
        const parsed = parseDateTag(tags[key]);
        if (parsed) return parsed;
      }
    }
    return null;
  };
  // Local wall clock with its own offset: shown as written, offset kept for sorting.
  const local = find(LOCAL_DATE_TAGS);
  if (local) return { parts: local.parts, source: 'exif_create', offsetMinutes: parseOffsetMinutes(local.zone) };
  // Container dates: a Z (or no zone) is UTC. Each tag must pass plausibility on its own, so a
  // sentinel (the 1904 QuickTime epoch) in one never hides a valid date in another.
  for (const names of [['creation_time'], UTC_DATE_TAGS]) {
    const found = find(names);
    if (found) return { parts: found.parts, source: 'exif_create', offsetMinutes: found.zone ? parseOffsetMinutes(found.zone) : 0 };
  }
  return null;
}

const ISO6709_PATTERN = /^([+-])(\d+(?:\.\d+)?)([+-])(\d+(?:\.\d+)?)/;

// One ISO 6709 component. degDigits is 2 for latitude, 3 for longitude.
// Accepts degrees (DD.DDD), degrees+minutes (DDMM.MMM) and
// degrees+minutes+seconds (DDMMSS.SSS), told apart by integer digit count.
function iso6709ComponentToDegrees(sign, body, degDigits) {
  const intLength = body.split('.')[0].length;
  let value;
  if (intLength === degDigits) {
    value = Number(body);
  } else if (intLength === degDigits + 2) {
    value = Number(body.slice(0, degDigits)) + Number(body.slice(degDigits)) / 60;
  } else if (intLength === degDigits + 4) {
    value = Number(body.slice(0, degDigits))
      + Number(body.slice(degDigits, degDigits + 2)) / 60
      + Number(body.slice(degDigits + 2)) / 3600;
  } else {
    return null;
  }
  if (!Number.isFinite(value)) return null;
  return sign === '-' ? -value : value;
}

function parseIso6709(str) {
  if (typeof str !== 'string') return null;
  const match = str.trim().match(ISO6709_PATTERN);
  if (!match) return null;
  const latitude = iso6709ComponentToDegrees(match[1], match[2], 2);
  const longitude = iso6709ComponentToDegrees(match[3], match[4], 3);
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

// Location lives in container-level tags. Prefer Apple's QuickTime key, then
// the generic "location" key (Android/MP4), then language variants such as
// "location-zho".
function extractGpsFromFormatTags(probeResult) {
  const tags = probeResult && probeResult.format && probeResult.format.tags;
  if (!tags) return null;
  const keys = Object.keys(tags);
  const lower = (k) => k.toLowerCase();
  const ordered = [
    ...keys.filter((k) => lower(k) === 'com.apple.quicktime.location.iso6709'),
    ...keys.filter((k) => lower(k) === 'location'),
    ...keys.filter((k) => lower(k).startsWith('location-')),
  ];
  for (const key of ordered) {
    const parsed = parseIso6709(tags[key]);
    if (parsed) return parsed;
  }
  return null;
}

// M12.4: container tag lookup, case-insensitive, first non-empty match wins.
function tagText(probeResult, names) {
  const tags = (probeResult && probeResult.format && probeResult.format.tags) || {};
  const byLower = {};
  for (const k of Object.keys(tags)) byLower[k.toLowerCase()] = tags[k];
  for (const n of names) if (typeof byLower[n] === 'string' && byLower[n].trim()) return byLower[n];
  return null;
}

async function extractVideoMetadata(fullPath, filename) {
  const probeResult = await runFfprobe(fullPath);

  if (!probeResult) {
    return {
      width: null,
      height: null,
      orientationApplied: 0,
      durationSeconds: null,
      captureTimeParts: null,
      captureTimeSource: null,
      cameraMake: null,
      cameraModel: null,
      lensModel: null,
      iso: null,
      fNumber: null,
      exposureTimeSeconds: null,
      focalLengthMm: null,
      gpsLatitude: null,
      gpsLongitude: null,
      isPanorama: false,
      contentIdentifier: null,
      extractionError: 'ffprobe_failed',
    };
  }

  const videoStream = findVideoStream(probeResult);
  const rotation = normalizeRotation(extractRotationDegrees(videoStream));
  const rotated = rotation === 90 || rotation === 270;

  let width = null;
  let height = null;
  let orientationApplied = 0;

  if (videoStream && typeof videoStream.width === 'number' && typeof videoStream.height === 'number') {
    width = rotated ? videoStream.height : videoStream.width;
    height = rotated ? videoStream.width : videoStream.height;
    orientationApplied = 1;
  }

  const durationRaw = (videoStream && videoStream.duration) || (probeResult.format && probeResult.format.duration);
  const durationSeconds = durationRaw ? Number(durationRaw) : null;

  const captureTime = resolveCaptureTimeFromContainer(probeResult, videoStream);
  const gps = extractGpsFromFormatTags(probeResult);

  return {
    width,
    height,
    orientationApplied,
    durationSeconds: Number.isNaN(durationSeconds) ? null : durationSeconds,
    captureTimeParts: captureTime ? captureTime.parts : null,
    captureTimeSource: captureTime ? captureTime.source : null,
    captureOffsetMinutes: captureTime ? captureTime.offsetMinutes : null,
    cameraMake: null,
    cameraModel: null,
    lensModel: null,
    iso: null,
    fNumber: null,
    exposureTimeSeconds: null,
    focalLengthMm: null,
    gpsLatitude: gps ? gps.latitude : null,
    gpsLongitude: gps ? gps.longitude : null,
    isPanorama: false,
    titleFile: cleanTitle(tagText(probeResult, ['title', 'com.apple.quicktime.title']), filename),
    captionFile: cleanCaption(tagText(probeResult, ['description', 'com.apple.quicktime.description'])),
    keywordsFile: cleanKeywords(tagText(probeResult, ['keywords'])) /* not Apple's system tag (FaceTime): nobody wrote it */,
    contentIdentifier: videoIdentifierFromProbe(probeResult), // M15
    extractionError: !videoStream ? 'no_video_stream' : (width === null || height === null ? 'dimensions_unavailable' : null),
  };
}

// M15.6: identifier only (backfill). undefined = ffprobe failed, so the caller must not stamp the row.
async function readVideoIdentifier(fullPath) {
  const probeResult = await runFfprobe(fullPath);
  return probeResult ? videoIdentifierFromProbe(probeResult) : undefined;
}

module.exports = { resolveCaptureTimeFromContainer, readVideoIdentifier, extractVideoMetadata, extractRotationDegrees, normalizeRotation, parseIso6709 };
