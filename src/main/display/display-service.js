/**
 * display-service.js (M5)
 *
 * Decides how an item is shown in the viewer, decodes derivatives on demand,
 * and resolves ids to files for media-protocol.js. Runs in the main process:
 * the decode is a `sips` CHILD PROCESS (async execFile), so the event loop
 * never blocks. Separate from M2's thumbnail queue on purpose (that queue's
 * foreground list is replace-on-call and would fight the grid).
 *
 * Kinds:  image (native)       jpg jpeg png gif webp bmp -> /original
 *         image (decode)       heic heif tif tiff + RAW  -> /display (4096px JPEG)
 *         video                mp4 m4v mov webm, 1 audio -> /original
 *         video (convert)      other containers (AVI...) or 2+ audio
 *                              tracks (FaceTime) -> /display (MP4 copy,
 *                              M6 B.7, video-transcode.js)
 *         unknown still        -> decode via sips (it may fail: decode_failed)
 *
 * Queue: concurrency 1, ordered by the wanted list (current item first).
 * setWanted(ids) replaces the list; unwanted queued jobs resolve
 * 'cancelled', an unwanted running job is aborted (sips killed).
 */

const fsp = require('fs').promises;
const path = require('path');
const db = require('../index/db');
const queries = require('../index/queries');
const cache = require('./display-cache');
const { sipsToJpeg, RAW_EXTENSIONS } = require('../thumbnails/sips-decode');
const vt = require('./video-transcode');

const SCHEME = 'photos-media';
const MAX_EDGE = 4096;
const NATIVE_IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
const DECODE_IMAGE = new Set(['heic', 'heif', 'tif', 'tiff', ...RAW_EXTENSIONS]);
const PLAYABLE_VIDEO = new Set(['mp4', 'm4v', 'mov', 'webm']);

function extOf(item) {
  const raw = item.extension || path.extname(item.absolute_path || '');
  return String(raw).replace(/^\./, '').toLowerCase();
}

function classify(item) {
  const ext = extOf(item);
  if (NATIVE_IMAGE.has(ext)) return { kind: 'image', decode: false };
  if (DECODE_IMAGE.has(ext)) return { kind: 'image', decode: true };
  if (PLAYABLE_VIDEO.has(ext)) return { kind: 'video' };
  if (item.media_type === 'video') return { kind: 'unplayable-video' };
  return { kind: 'image', decode: true };
}

// M6 B.7: per-video conversion plan, probed once per (id, stamp) and kept
// in memory (ffprobe metadata read, ~30 ms).
const probeMemo = new Map(); // 'id:stamp' -> info | null
async function videoPlan(item, stamp, signal) {
  const key = item.id + ':' + stamp;
  let info = probeMemo.get(key);
  if (info === undefined) {
    info = await vt.probe(item.absolute_path, signal);
    if (probeMemo.size > 5000) probeMemo.clear();
    probeMemo.set(key, info);
  }
  return { info, convert: vt.needsTranscode(extOf(item), info) };
}

function urlFor(id, route, stamp) {
  return SCHEME + '://item/' + id + '/' + route + (stamp ? '?v=' + stamp : '');
}

function getItem(id) {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return queries.getItemById(db.get(), id) || null;
}

async function statSource(p) {
  if (!p) return null;
  try { const st = await fsp.stat(p); return st.isFile() ? st : null; } catch (e) { return null; }
}

/** Fast: never decodes. */
async function getDisplaySource(id) {
  const item = getItem(id);
  if (!item) return { ok: false, code: 'not_found' };
  const st = await statSource(item.absolute_path);
  if (!st) return { ok: false, code: 'source_missing' };
  const stamp = cache.stampFor(st);
  const c = classify(item);
  const res = { ok: true, kind: c.kind, needsDecode: false, url: null };
  if (item.media_type === 'video') {
    // M6 B.7: play the original when possible, else an MP4 copy.
    res.kind = 'video';
    const plan = await videoPlan(item, stamp);
    if (plan.convert) {
      const hit = await cache.lookup(id, stamp, 'mp4');
      res.needsDecode = !hit;
      if (hit) res.url = urlFor(id, 'display', stamp);
    } else {
      res.url = urlFor(id, 'original', stamp);
    }
  } else if (c.kind === 'image' && c.decode) {
    const hit = await cache.lookup(id, stamp);
    res.needsDecode = !hit;
    if (hit) res.url = urlFor(id, 'display', stamp);
  } else {
    res.url = urlFor(id, 'original', stamp);
  }
  if (item.live_photo_video_absolute_path) res.liveUrl = urlFor(id, 'live', stamp);
  return res;
}

/** For media-protocol.js only. Returns an absolute path or null. */
async function resolveFile(id, route) {
  const item = getItem(id);
  if (!item) return null;
  const c = classify(item);
  if (route === 'original') return (c.kind === 'image' && c.decode) ? null : item.absolute_path;
  if (route === 'live') return item.live_photo_video_absolute_path || null;
  if (route === 'display') {
    const st = await statSource(item.absolute_path);
    return st ? cache.lookup(id, cache.stampFor(st), item.media_type === 'video' ? 'mp4' : 'jpg') : null;
  }
  return null;
}

// ── decode queue ─────────────────────────────────────────────────────────
const jobs = new Map(); // id -> { promise, resolve, controller }
let wanted = [];
let running = false;

function ensureDisplay(id) {
  if (!Number.isSafeInteger(id) || id < 1) return Promise.resolve({ ok: false, code: 'not_found' });
  if (!wanted.includes(id)) wanted.push(id);
  let j = jobs.get(id);
  if (!j) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    j = { promise, resolve, controller: null };
    jobs.set(id, j);
    pump();
  }
  return j.promise;
}

function setWanted(ids) {
  wanted = (Array.isArray(ids) ? ids : []).filter((n) => Number.isSafeInteger(n) && n > 0);
  for (const [id, j] of jobs) {
    if (wanted.includes(id)) continue;
    jobs.delete(id);
    if (j.controller) j.controller.abort();
    j.resolve({ ok: false, code: 'cancelled' });
  }
  pump();
}

function pump() {
  if (running) return;
  const id = wanted.find((n) => jobs.has(n) && !jobs.get(n).controller);
  if (id === undefined) return;
  const j = jobs.get(id);
  j.controller = new AbortController();
  running = true;
  run(id, j.controller.signal)
    .catch((err) => ({ ok: false, code: 'decode_failed', message: String((err && err.message) || err) }))
    .then((result) => {
      if (jobs.get(id) === j) jobs.delete(id);
      running = false;
      j.resolve(result);
      pump();
    });
}

async function run(id, signal) {
  const item = getItem(id);
  if (!item) return { ok: false, code: 'not_found' };
  const st = await statSource(item.absolute_path);
  if (!st) return { ok: false, code: 'source_missing' };
  const stamp = cache.stampFor(st);
  const c = classify(item);
  if (item.media_type === 'video') {
    // M6 B.7: convert to a playable MP4 copy when needed.
    const plan = await videoPlan(item, stamp, signal);
    if (!plan.convert) return { ok: true, url: urlFor(id, 'original', stamp) };
    if (await cache.lookup(id, stamp, 'mp4')) return { ok: true, url: urlFor(id, 'display', stamp) };
    if (signal.aborted) return { ok: false, code: 'cancelled' };
    const v = await vt.transcode({
      sourcePath: item.absolute_path, tmpFolder: await cache.getTmpDir(), id, info: plan.info, signal,
    });
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
    if (signal.aborted) { await fsp.unlink(v.path).catch(() => {}); return { ok: false, code: 'cancelled' }; }
    await cache.commit(id, stamp, v.path, 'mp4');
    return { ok: true, url: urlFor(id, 'display', stamp) };
  }
  if (!(c.kind === 'image' && c.decode)) return { ok: true, url: urlFor(id, 'original', stamp) };
  if (await cache.lookup(id, stamp)) return { ok: true, url: urlFor(id, 'display', stamp) };
  if (signal.aborted) return { ok: false, code: 'cancelled' };
  const r = await sipsToJpeg({
    sourcePath: item.absolute_path, tmpFolder: await cache.getTmpDir(), id, maxEdge: MAX_EDGE, signal,
  });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  if (signal.aborted) { await fsp.unlink(r.path).catch(() => {}); return { ok: false, code: 'cancelled' }; }
  await cache.commit(id, stamp, r.path);
  return { ok: true, url: urlFor(id, 'display', stamp) };
}

module.exports = { init: cache.init, getDisplaySource, ensureDisplay, setWanted, resolveFile, SCHEME };
