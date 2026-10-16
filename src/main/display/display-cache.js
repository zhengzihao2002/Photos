/**
 * display-cache.js (M5)
 *
 * On-disk cache of full-quality display derivatives: JPEGs decoded from
 * formats Chromium can't render (HEIC/HEIF/RAW/TIFF). Storage only; the
 * decode happens in display-service.js.
 *
 *   <displayCacheDir>/<hh>/<id>_<stamp>.<jpg|mp4>
 *     (M6 B.7: .mp4 = playable copy of a video Chromium can't play as-is)
 *     hh    = (id mod 256) as two hex digits (mirrors thumbnail-paths.js)
 *     stamp = first 12 hex of sha1(source mtimeMs + ':' + source size)
 *
 * Invalidation: the caller stats the source at request time and passes the
 * stamp. A changed source produces a different stamp, so the old file never
 * matches; it is deleted on the next commit for that id, or ages out.
 *
 * Writes: commit() only accepts files inside <displayCacheDir>/.tmp/ and
 * renames them into place (atomic on one volume). .tmp/ is emptied at init.
 *
 * Budget: BUDGET_BYTES (2 GB). Over budget -> evict least-recently-used
 * down to 80%. A hit touches the file's mtime, so recency survives restarts.
 *
 * All I/O is async. Never touches source folders.
 */

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const paths = require('../paths');

const BUDGET_BYTES = 2 * 1024 ** 3;
const LOW_WATER_RATIO = 0.8;
const TMP_DIRNAME = '.tmp';
const NAME_RE = /^(\d+)_([0-9a-f]{12})\.(jpg|mp4)$/;

const byId = new Map(); // id -> { file, size, used }
let total = 0;
let ready = null;

function root() { return paths.displayCacheDir(); }
function tmpDir() { return path.join(root(), TMP_DIRNAME); }
function shardOf(id) { return (id % 256).toString(16).padStart(2, '0'); }
function fileFor(id, stamp, ext = 'jpg') { return path.join(root(), shardOf(id), id + '_' + stamp + '.' + ext); }

/** Stamp from an fs.Stats of the SOURCE file. */
function stampFor(stat) {
  return crypto.createHash('sha1').update(stat.mtimeMs + ':' + stat.size).digest('hex').slice(0, 12);
}

function forget(id) {
  const e = byId.get(id);
  if (e) { total -= e.size; byId.delete(id); }
}

async function scan() {
  await fsp.rm(tmpDir(), { recursive: true, force: true });
  await fsp.mkdir(tmpDir(), { recursive: true });
  let shards = [];
  try { shards = await fsp.readdir(root()); } catch (e) { /* empty cache */ }
  for (const shard of shards) {
    if (!/^[0-9a-f]{2}$/.test(shard)) continue;
    const dir = path.join(root(), shard);
    let names = [];
    try { names = await fsp.readdir(dir); } catch (e) { continue; }
    for (const name of names) {
      const m = NAME_RE.exec(name);
      if (!m) continue;
      const file = path.join(dir, name);
      let st;
      try { st = await fsp.stat(file); } catch (e) { continue; }
      const id = Number(m[1]);
      const prev = byId.get(id);
      if (prev && prev.used >= st.mtimeMs) { await fsp.unlink(file).catch(() => {}); continue; }
      if (prev) { await fsp.unlink(prev.file).catch(() => {}); forget(id); }
      byId.set(id, { file, size: st.size, used: st.mtimeMs });
      total += st.size;
    }
  }
  await evict(null);
}

/** Idempotent. Safe to call early; every other function awaits it. */
function init() {
  if (!ready) ready = scan().catch((err) => console.error('[display-cache] init failed:', err.message));
  return ready;
}

/** Folder decoders must write into before calling commit(). */
async function getTmpDir() { await init(); return tmpDir(); }

/** Cached path for (id, stamp), or null. Touches recency on hit. */
async function lookup(id, stamp, ext = 'jpg') {
  await init();
  const e = byId.get(id);
  if (!e || e.file !== fileFor(id, stamp, ext)) return null;
  try { await fsp.access(e.file); } catch (err) { forget(id); return null; }
  const now = Date.now();
  e.used = now;
  fsp.utimes(e.file, new Date(now), new Date(now)).catch(() => {});
  return e.file;
}

/** Move a finished temp file into place. Returns the final path. */
async function commit(id, stamp, tmpPath, ext = 'jpg') {
  await init();
  if (!path.resolve(tmpPath).startsWith(path.resolve(tmpDir()) + path.sep)) {
    throw new Error('display-cache: refusing to commit a file outside the cache .tmp folder');
  }
  const file = fileFor(id, stamp, ext);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.rename(tmpPath, file);
  const st = await fsp.stat(file);
  const prev = byId.get(id);
  if (prev && prev.file !== file) await fsp.unlink(prev.file).catch(() => {});
  forget(id);
  byId.set(id, { file, size: st.size, used: Date.now() });
  total += st.size;
  await evict(id);
  return file;
}

async function evict(keepId) {
  if (total <= BUDGET_BYTES) return;
  const target = BUDGET_BYTES * LOW_WATER_RATIO;
  const oldestFirst = [...byId.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [id, e] of oldestFirst) {
    if (total <= target) break;
    if (id === keepId) continue;
    await fsp.unlink(e.file).catch(() => {});
    forget(id);
  }
}

/**
 * M8c.6: the Storage view's Clear. Deletes every cached derivative (only the
 * two-hex-digit shard folders inside the cache folder) and empties the index.
 * .tmp/ is left alone, so a decode in progress still commits. Anything opened
 * later is decoded again (lookup() also self-heals on a missing file).
 */
async function clearAll() {
  await init();
  let shards = [];
  try { shards = await fsp.readdir(root()); } catch (e) { return; }
  for (const shard of shards) {
    if (!/^[0-9a-f]{2}$/.test(shard)) continue;
    await fsp.rm(path.join(root(), shard), { recursive: true, force: true });
  }
  byId.clear();
  total = 0;
}

function stats() { return { files: byId.size, bytes: total, budgetBytes: BUDGET_BYTES }; }

module.exports = { init, stampFor, getTmpDir, lookup, commit, stats, clearAll, BUDGET_BYTES };
