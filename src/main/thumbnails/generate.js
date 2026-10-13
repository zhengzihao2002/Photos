/**
 * generate.js
 *
 * Produces thumbnail files for ONE item. Files only: this module never
 * touches the database. The queue (M2.6) maps the result to status
 * columns, because "should this be 'error' or retried?" depends on
 * source-folder state that only the queue can see.
 *
 * Source files are opened read-only. The only place written to is the
 * thumbnail root passed in as thumbRoot. Every write goes to <root>/.tmp/
 * first and is renamed into place, so no partial file ever appears at a
 * final path.
 *
 * Decode routes:
 *   jpg jpeg png webp gif tif tiff  -> sharp reads the source directly
 *   heic heif bmp                   -> macOS sips converts once to a temp
 *                                      JPEG (sips-decode.js), sharp resizes
 *                                      that; the temp file is always deleted
 *   RAW (cr2 cr3 nef arw dng orf rw2 raf) -> same sips route as HEIC, with a
 *                                      longer timeout (about 1-4 s for one DNG)
 *   mov mp4 m4v avi                 -> bundled ffmpeg extracts one poster frame
 *                                      to a temp JPEG (video-frame.js), sharp
 *                                      resizes that; the temp file is always
 *                                      deleted. Optional durationSeconds input
 *                                      sets the seek time (10% or 1 s).
 *
 * Result: { ok: true, sizes: { sm: { path, width, height, bytes } } }
 *     or: { ok: false, code, message, sizes }   (sizes = any finished ones)
 * Codes: source_missing, permission_denied, read_failed, decode_failed,
 *        write_failed, unsupported_format.
 * source_missing / permission_denied / write_failed describe the
 * environment, not the file, so the queue should not record them as a
 * permanent 'error'.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const thumbPaths = require('./thumbnail-paths');
const { sipsToJpeg, SIPS_EXTENSIONS } = require('./sips-decode');
const { extractFrame } = require('./video-frame');

// Every file is decoded once, so libvips' operation cache only holds memory.
sharp.cache(false);

const SHARP_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'm4v', 'avi']);

function fail(code, message, sizes) {
  return { ok: false, code, message: String(message), sizes: sizes || {} };
}

async function checkReadable(sourcePath) {
  try {
    await fs.promises.access(sourcePath, fs.constants.R_OK);
    return null;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return fail('source_missing', err.message);
    if (err.code === 'EACCES' || err.code === 'EPERM') return fail('permission_denied', err.message);
    return fail('read_failed', err.message);
  }
}

async function writeOneSize({ thumbRoot, inputPath, id, sizeName }) {
  const spec = thumbPaths.SIZES[sizeName];
  const finalPath = thumbPaths.absolutePath(thumbRoot, id, sizeName);
  const tmpFolder = thumbPaths.tmpDir(thumbRoot);
  const tmpName = id + '_' + sizeName + '.' + crypto.randomBytes(4).toString('hex') + '.jpg';
  const tmpPath = path.join(tmpFolder, tmpName);

  try {
    await fs.promises.mkdir(tmpFolder, { recursive: true });
    await fs.promises.mkdir(thumbPaths.shardDir(thumbRoot, id), { recursive: true });
  } catch (err) {
    return fail('write_failed', err.message);
  }

  let info;
  try {
    info = await sharp(inputPath, { failOn: 'error' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: spec.maxEdge, height: spec.maxEdge, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .jpeg({ quality: spec.quality })
      .toFile(tmpPath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    const isWriteProblem = /ENOSPC|no space|unable to write|EACCES|EROFS/i.test(err.message);
    return fail(isWriteProblem ? 'write_failed' : 'decode_failed', err.message);
  }

  try {
    await fs.promises.rename(tmpPath, finalPath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    return fail('write_failed', err.message);
  }

  return { ok: true, path: finalPath, width: info.width, height: info.height, bytes: info.size };
}

async function generateThumbnails({ thumbRoot, sourcePath, id, extension, sizes, durationSeconds }) {
  const ext = String(extension || '').toLowerCase();
  const wanted = sizes && sizes.length ? sizes : ['sm'];
  for (const sizeName of wanted) {
    if (!Object.prototype.hasOwnProperty.call(thumbPaths.SIZES, sizeName)) {
      throw new RangeError('Invalid thumbnail size: ' + sizeName);
    }
  }
  const viaSips = SIPS_EXTENSIONS.has(ext);
  const isVideo = VIDEO_EXTENSIONS.has(ext);
  if (!viaSips && !isVideo && !SHARP_EXTENSIONS.has(ext)) {
    return fail('unsupported_format', 'No decode route yet for .' + ext);
  }

  const unreadable = await checkReadable(sourcePath);
  if (unreadable) return unreadable;

  let inputPath = sourcePath;
  let tempPath = null;
  if (viaSips) {
    const maxEdge = Math.max(...wanted.map((s) => thumbPaths.SIZES[s].maxEdge));
    const decoded = await sipsToJpeg({
      sourcePath,
      tmpFolder: thumbPaths.tmpDir(thumbRoot),
      id,
      maxEdge,
    });
    if (!decoded.ok) return fail(decoded.code, decoded.message);
    inputPath = decoded.path;
    tempPath = decoded.path;
  } else if (isVideo) {
    const decoded = await extractFrame({
      sourcePath,
      tmpFolder: thumbPaths.tmpDir(thumbRoot),
      id,
      durationSeconds,
    });
    if (!decoded.ok) return fail(decoded.code, decoded.message);
    inputPath = decoded.path;
    tempPath = decoded.path;
  }

  const done = {};
  try {
    for (const sizeName of wanted) {
      const result = await writeOneSize({ thumbRoot, inputPath, id, sizeName });
      if (!result.ok) return fail(result.code, result.message, done);
      done[sizeName] = { path: result.path, width: result.width, height: result.height, bytes: result.bytes };
    }
  } finally {
    if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
  }
  return { ok: true, sizes: done };
}

module.exports = { generateThumbnails, SHARP_EXTENSIONS, SIPS_EXTENSIONS, VIDEO_EXTENSIONS };
