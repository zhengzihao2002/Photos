/**
 * thumbnail-paths.js
 *
 * The single definition of where thumbnails live on disk and how big they
 * are. Pure module: no Electron, no database, no I/O. The caller passes in
 * the thumbnail root (from paths.js thumbnailsDir()), so this file is safe
 * to use from the main process and from worker threads.
 *
 * ── THUMBNAIL SCHEME (approved in M2.2) ─────────────────────────────────
 *
 * A path is derived from the item id alone, with no database lookup:
 *
 *   <thumbnails root>/<hh>/<id>_<size>.jpg
 *
 *   hh    = (id mod 256) as two lowercase hex digits (256 shard folders)
 *   id    = items.id, a positive integer (AUTOINCREMENT, never reused)
 *   size  = 'sm' (grid) or 'md' (quick-look)
 *
 *   Examples (relative to the root):
 *     id 1       sm  ->  01/1_sm.jpg
 *     id 300     sm  ->  2c/300_sm.jpg
 *     id 100000  md  ->  a0/100000_md.jpg
 *
 * Sizes are the LONGEST EDGE in pixels. Aspect ratio is preserved and
 * images are never upscaled:
 *   sm = 512 px, JPEG quality 80    (background-generated for every item)
 *   md = 1536 px, JPEG quality 85   (generated on demand, then cached)
 *
 * Format: JPEG for everything, including video poster frames. Metadata is
 * stripped and colour is converted to sRGB. EXIF orientation is applied at
 * generation time, so thumbnail pixels always match the display-oriented
 * width/height stored in the items table. Transparency is flattened onto
 * white. Animated GIFs use the first frame only.
 *
 * Temp area: <root>/.tmp/ holds in-progress files. Every write goes to
 * .tmp first and is renamed into place, so no partial thumbnail ever
 * appears at a final path.
 *
 * A file at a final path is only trustworthy when the item's status column
 * (items.thumb_sm_status / thumb_md_status) is 'done'. Consumers must check
 * the status; a file's existence alone is not proof.
 */

const path = require('path');

const SIZES = Object.freeze({
  sm: Object.freeze({ maxEdge: 512, quality: 80 }),
  md: Object.freeze({ maxEdge: 1536, quality: 85 }),
});

const SIZE_NAMES = Object.freeze(Object.keys(SIZES));
const TMP_DIRNAME = '.tmp';
const SHARD_COUNT = 256;

function assertId(id) {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError('Invalid item id: ' + id);
  }
}

function assertSize(size) {
  if (!Object.prototype.hasOwnProperty.call(SIZES, size)) {
    throw new RangeError('Invalid thumbnail size: ' + size);
  }
}

function assertRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('thumbnail root must be a non-empty string');
  }
}

/** Two lowercase hex digits: the shard folder name for an item id. */
function shardOf(id) {
  assertId(id);
  return (id % SHARD_COUNT).toString(16).padStart(2, '0');
}

/** Path relative to the thumbnails root, always with forward slashes. */
function relativePath(id, size) {
  assertSize(size);
  return shardOf(id) + '/' + id + '_' + size + '.jpg';
}

/** Absolute path of a thumbnail file, given the thumbnails root. */
function absolutePath(root, id, size) {
  assertRoot(root);
  assertSize(size);
  return path.join(root, shardOf(id), id + '_' + size + '.jpg');
}

/** Absolute path of the shard folder that holds an item's thumbnails. */
function shardDir(root, id) {
  assertRoot(root);
  return path.join(root, shardOf(id));
}

/** Absolute path of the temp folder used for atomic writes. */
function tmpDir(root) {
  assertRoot(root);
  return path.join(root, TMP_DIRNAME);
}

module.exports = {
  SIZES,
  SIZE_NAMES,
  TMP_DIRNAME,
  SHARD_COUNT,
  shardOf,
  relativePath,
  absolutePath,
  shardDir,
  tmpDir,
};
