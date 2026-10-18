/**
 * scan-directory-batch.js
 *
 * Processes one directory's worth of discovered files into database rows,
 * inside a single transaction. A directory is never split across a
 * transaction boundary: Live Photo pairing and burst detection are only
 * ever valid within one directory's siblings, so either the whole
 * directory lands or none of it does — if interrupted, the same directory
 * is simply redone whole on the next scan.
 *
 * Skip-if-unchanged: a file whose size+mtime match its existing row skips
 * re-running exifr/ffprobe entirely. It is NOT skipped from grouping
 * recomputation, though — a new sibling discovered this scan can change an
 * unchanged file's correct Live Photo/burst assignment, even though the
 * file itself never changed.
 *
 * No move detection: a file at a path with no existing row is always
 * treated as new, even if it's identical content that used to live at a
 * different path (in this source or another). The same real-world photo
 * appearing in two different source folders is a legitimate, intended case
 * (per design decision), not something to collapse into one row — so there
 * is deliberately no cross-file identity matching at all. A file that
 * disappears from one path and reappears at another becomes, simply: one
 * row tombstoned by the deletion sweep, and one unrelated new row inserted.
 *
 * Burst eligibility: only rows whose capture_time_source is exif_original
 * or exif_create are considered for burst grouping. filename_pattern and
 * file_mtime timestamps reflect when a file was named or saved to disk, not
 * when a shutter fired — clustering on those produces false "bursts" out of
 * unrelated files that merely landed on disk within the same second or two
 * (confirmed in practice: a folder of downloaded wallpapers with no EXIF
 * produced several such false bursts before this exclusion was added).
 *
 * Write order: every video row in the directory is written first (whether
 * or not it turns out to be a Live Photo component), so any database id an
 * image might need to reference is already assigned before images are
 * written.
 */

const fs = require('fs');
const path = require('path');
const { extractItemMetadata, normalizeGpsPair } = require('./extract');
const { findLivePhotoPairs, findBursts } = require('./group-siblings');
const { isPlausibleCaptureParts } = require('./metadata-helpers');

const BURST_ELIGIBLE_SOURCES = new Set(['exif_original', 'exif_create']);

// M7.2: stamped on every row the extractor writes (items.extraction_version,
// migration 9). History: 1 = before video GPS; 2 = video GPS from container
// location tags + GPS plausibility. Bump this and add a rule to
// needsReextraction when an extractor change must reach existing rows.
const CURRENT_EXTRACTION_VERSION = 3; // M12.4: 3 = embedded title/caption/keywords, exposure bias, 35 mm focal length
const EMBEDDED_TEXT_EXTRACTION_VERSION = 3;
const VIDEO_GPS_EXTRACTION_VERSION = 2;

// M1 patch (A.4): an unchanged file is still re-extracted when its stored
// row predates the A.1/A.2 fixes. Resumable by construction: once fixed, a
// row no longer matches. Re-extraction goes through the normal full-update
// path, which rewrites file_mtime/file_size_bytes with identical values, so
// the M2 thumbnail-reset trigger does not fire. Rows whose time already came
// from file_mtime (the unconditional last resort) are never flagged for
// time, so an implausible mtime cannot cause an endless retry.
const HEIF_EXTENSIONS = new Set(['heic', 'heif']);
const CAPTURE_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

function needsReextraction(row) {
  // M12.4: rows extracted before embedded text / exposure fields existed. Resumable: the re-extract stamps version 3.
  if ((row.extraction_version || 0) < EMBEDDED_TEXT_EXTRACTION_VERSION) return true;
  // M7.2: videos extracted before video GPS existed. Resumable: the
  // re-extract stamps the current version whether or not GPS is found.
  if (row.media_type === 'video' && (row.extraction_version || 0) < VIDEO_GPS_EXTRACTION_VERSION) return true;
  // M7.2: stored coordinates that fail plausibility (e.g. 0,0). Resumable:
  // the re-extract clears has_gps.
  if (row.has_gps === 1 && !normalizeGpsPair(row.gps_latitude, row.gps_longitude)) return true;
  if (HEIF_EXTENSIONS.has(row.extension) && row.width === null) return true;
  if (row.capture_time_source === 'file_mtime') return false;
  const m = CAPTURE_LOCAL_PATTERN.exec(row.capture_time_local || '');
  if (!m) return false;
  return !isPlausibleCaptureParts({
    year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
    hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6]),
  });
}

// M8b.6: iCloud "optimized storage" leaves dataless files whose contents are
// downloaded on first read. Cheap pre-filter (no blocks but non-empty), then
// the macOS SF_DATALESS flag (0x40000000) via /usr/bin/stat, which reads
// metadata only. Never throws; any doubt means "not dataless".
const SF_DATALESS = 0x40000000;
function isDataless(fullPath, stat) {
  if (!(stat.blocks === 0 && stat.size > 0)) return Promise.resolve(false);
  return new Promise((resolve) => {
    require('child_process').execFile('/usr/bin/stat', ['-f', '%Xf', fullPath], { timeout: 5000 }, (err, out) => {
      if (err) { resolve(false); return; }
      const flags = parseInt(String(out).trim(), 16);
      resolve(Number.isFinite(flags) && (flags & SF_DATALESS) !== 0);
    });
  });
}

function unchangedResult(existing, relativePath) {
  return {
    valid: true,
    mode: 'unchanged',
    id: existing.id,
    relativePath,
    filename: existing.filename,
    media_type: existing.media_type,
    capture_time_local: existing.capture_time_local,
    capture_time_source: existing.capture_time_source,
  };
}

async function classifyFile(file, sourceFolderId, relativePath, stmts) {
  let stat;
  try {
    stat = await fs.promises.stat(file.fullPath);
  } catch (err) {
    return { valid: false, error: { path: file.fullPath, message: err.message } };
  }

  const mtimeSeconds = Math.floor(stat.mtimeMs / 1000);
  const existing = stmts.findExisting(sourceFolderId, relativePath);

  // M8b.6: an iCloud-only file is never read (that would download it).
  // Indexed already: keep the row as is. New: skip until downloaded.
  if (await isDataless(file.fullPath, stat)) {
    if (existing) return unchangedResult(existing, relativePath);
    return { valid: false, error: { path: file.fullPath, message: 'iCloud file not downloaded; skipped until it is' } };
  }

  if (existing && existing.file_size_bytes === stat.size && existing.file_mtime === mtimeSeconds
      && !needsReextraction(existing)) {
    return {
      valid: true,
      mode: 'unchanged',
      id: existing.id,
      relativePath,
      filename: existing.filename,
      media_type: existing.media_type,
      capture_time_local: existing.capture_time_local,
      capture_time_source: existing.capture_time_source,
    };
  }

  const result = await extractItemMetadata(file);
  if (result.skip) {
    return { valid: false, error: { path: file.fullPath, message: result.reason } };
  }

  return {
    valid: true,
    mode: existing ? 'changed' : 'new',
    id: existing ? existing.id : null,
    relativePath,
    ...result,
  };
}

function buildFullFields(entry, sourceFolderId, groupingFields, now) {
  return {
    source_folder_id: sourceFolderId,
    relative_path: entry.relativePath,
    filename: entry.filename,
    media_type: entry.media_type,
    extension: entry.extension,
    file_size_bytes: entry.file_size_bytes,
    file_mtime: entry.file_mtime,
    width: entry.width,
    height: entry.height,
    orientation_applied: entry.orientation_applied,
    duration_seconds: entry.duration_seconds,
    capture_time_local: entry.capture_time_local,
    capture_time_source: entry.capture_time_source,
    capture_date: entry.capture_date,
    capture_year: entry.capture_year,
    capture_month: entry.capture_month,
    camera_make: entry.camera_make,
    camera_model: entry.camera_model,
    lens_model: entry.lens_model,
    iso: entry.iso,
    f_number: entry.f_number,
    exposure_time_seconds: entry.exposure_time_seconds,
    focal_length_mm: entry.focal_length_mm,
    gps_latitude: entry.gps_latitude,
    gps_longitude: entry.gps_longitude,
    has_gps: entry.has_gps,
    is_raw: entry.is_raw,
    is_gif: entry.is_gif,
    is_panorama: entry.is_panorama,
    is_live_photo: groupingFields.is_live_photo,
    live_photo_video_item_id: groupingFields.live_photo_video_item_id,
    is_live_photo_component: groupingFields.is_live_photo_component,
    burst_id: groupingFields.burst_id,
    is_burst_cover: groupingFields.is_burst_cover,
    extraction_error: entry.extraction_error,
    title_file: entry.title_file, caption_file: entry.caption_file, // M12.4 (extractor-owned)
    exposure_bias_ev: entry.exposure_bias_ev, focal_length_35mm: entry.focal_length_35mm, // M12.7
    extraction_version: CURRENT_EXTRACTION_VERSION,
    // M7.3: NULL marks the row for the place pass (src/main/places/place-pass.js),
    // which recomputes or clears the place columns after the directory walk.
    place_version: null,
    is_deleted: 0,
    updated_at: now,
  };
}

async function processDirectoryBatch({ db, stmts, sourceFolderId, sourceRootPath, files }) {
  const now = Math.floor(Date.now() / 1000);
  const errors = [];
  const validEntries = [];

  for (const file of files) {
    const relativePath = path.relative(sourceRootPath, file.fullPath);
    const classified = await classifyFile(file, sourceFolderId, relativePath, stmts);
    if (!classified.valid) {
      errors.push(classified.error);
      continue;
    }
    validEntries.push(classified);
  }

  const groupingRows = validEntries.map((e) => ({
    filename: e.filename,
    media_type: e.media_type,
    capture_time_local: e.capture_time_local,
  }));

  const pairs = findLivePhotoPairs(groupingRows);
  const livePhotoImageIndices = new Set(pairs.keys());
  const videoComponentIndices = new Set(pairs.values());

  const burstExcludedIndices = new Set(livePhotoImageIndices);
  validEntries.forEach((entry, idx) => {
    if (!BURST_ELIGIBLE_SOURCES.has(entry.capture_time_source)) {
      burstExcludedIndices.add(idx);
    }
  });

  const bursts = findBursts(groupingRows, sourceFolderId, burstExcludedIndices);

  const summary = { inserted: 0, updated: 0, unchanged: 0, errors: errors.length };

  const runTransaction = db.transaction(() => {
    const dbIdByIndex = new Map();

    validEntries.forEach((entry, idx) => {
      if (entry.media_type !== 'video') return;
      const groupingFields = {
        is_live_photo: 0,
        live_photo_video_item_id: null,
        is_live_photo_component: videoComponentIndices.has(idx) ? 1 : 0,
        burst_id: null,
        is_burst_cover: 0,
      };
      const id = writeRow(entry, idx, groupingFields);
      dbIdByIndex.set(idx, id);
    });

    validEntries.forEach((entry, idx) => {
      if (entry.media_type !== 'image') return;
      const isLivePhoto = livePhotoImageIndices.has(idx);
      const pairedVideoIdx = pairs.get(idx);
      const burstInfo = bursts.get(idx);
      const groupingFields = {
        is_live_photo: isLivePhoto ? 1 : 0,
        live_photo_video_item_id: isLivePhoto ? dbIdByIndex.get(pairedVideoIdx) : null,
        is_live_photo_component: 0,
        burst_id: burstInfo ? burstInfo.burstId : null,
        is_burst_cover: burstInfo && burstInfo.isCover ? 1 : 0,
      };
      const id = writeRow(entry, idx, groupingFields);
      dbIdByIndex.set(idx, id);
    });

    function writeRow(entry, idx, groupingFields) {
      if (entry.mode === 'unchanged') {
        stmts.updateItemGrouping(entry.id, groupingFields, now);
        summary.unchanged += 1;
        return entry.id;
      }

      const fullFields = buildFullFields(entry, sourceFolderId, groupingFields, now);

      if (entry.mode === 'new') {
        const id = stmts.insertItem({ ...fullFields, created_at: now });
        stmts.setFileKeywords(id, entry.keywords_file); // M12.4
        summary.inserted += 1;
        return id;
      }

      stmts.updateItemFull(entry.id, fullFields);
      stmts.setFileKeywords(entry.id, entry.keywords_file); // M12.4
      summary.updated += 1;
      return entry.id;
    }
  });

  runTransaction();
  try { stmts.pruneKeywords(); } catch (err) { /* housekeeping only */ } // M12.4

  return { summary, errors };
}

module.exports = { processDirectoryBatch };

// Exported for verification only.
module.exports.needsReextraction = needsReextraction;
