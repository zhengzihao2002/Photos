/**
 * face-crops.js  (M10.6)
 *
 * Portrait crops of people's cover faces for the People page, cached in
 * paths.faceCropsDir() as <faceId>.jpg. Main process; image work runs in
 * libvips threads and the sips child process, so the event loop is not held.
 *
 * READ-ONLY: originals are only read (sips writes only into paths.tempDir()).
 * Source: the ready 'md' thumbnail when present, else the original.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const db = require('../index/db');
const paths = require('../paths');
const thumbPaths = require('../thumbnails/thumbnail-paths');
const { sipsToJpeg, SIPS_EXTENSIONS } = require('../thumbnails/sips-decode');

const OUT_W = 360, OUT_H = 480;      // 3:4 portrait card
const WIDTH_FACES = 2.4;             // crop width in face widths
const ABOVE_FACES = 0.8;             // headroom above the face box, in face heights
const CONCURRENCY = 2;

const queue = [];
const queued = new Set();
const failed = new Set();
let active = 0;

/** photos-media URL of a crop (the renderer never gets a file path). ?v= busts the cache when a crop is remade. */
function cropUrl(faceId, p) {
  let v = 0;
  try { v = Math.floor(fs.statSync(p).mtimeMs); } catch (e) { /* caller checked existence */ }
  return 'photos-media://crop/' + faceId + '?v=' + v;
}

function cropPath(faceId) {
  return path.join(paths.faceCropsDir(), faceId + '.jpg');
}

function lookup(faceIds) {
  if (faceIds.length === 0) return [];
  return db.get().prepare(`
    SELECT f.id AS faceId, f.item_id AS itemId, f.box_x, f.box_y, f.box_w, f.box_h,
           i.relative_path, i.extension, i.thumb_md_status, i.media_type, s.root_path
    FROM faces f JOIN items i ON i.id = f.item_id JOIN source_folders s ON s.id = i.source_folder_id
    WHERE f.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(faceIds));
}

async function makeCrop(row) {
  let input = path.join(row.root_path, row.relative_path), temp = null;
  if (row.thumb_md_status === 'done') {
    input = thumbPaths.absolutePath(paths.thumbnailsDir(), row.itemId, 'md');
  } else if (row.media_type === 'video') {
    // M10.7: a video's face was found in its poster-frame thumbnail; crop from that, never the video file.
    input = thumbPaths.absolutePath(paths.thumbnailsDir(), row.itemId, 'sm');
  } else if (SIPS_EXTENSIONS.has(String(row.extension).toLowerCase())) {
    const d = await sipsToJpeg({ sourcePath: input, tmpFolder: path.join(paths.tempDir(), 'crops'), id: row.itemId, maxEdge: 1536 });
    if (d.ok === false) throw new Error(d.code + ': ' + d.message);
    input = d.path; temp = d.path;
  }
  try {
    const { data, info } = await sharp(input).rotate()
      .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const fw = row.box_w * W, fh = row.box_h * H, cx = (row.box_x + row.box_w / 2) * W;
    let w = Math.min(W, fw * WIDTH_FACES), h = Math.min(H, w * OUT_H / OUT_W);
    w = Math.min(w, h * OUT_W / OUT_H);
    const left = Math.round(Math.min(Math.max(0, cx - w / 2), W - w));
    const top = Math.round(Math.min(Math.max(0, row.box_y * H - fh * ABOVE_FACES), H - h));
    const tmpOut = path.join(paths.faceCropsDir(), '.' + row.faceId + '.' + crypto.randomBytes(4).toString('hex') + '.jpg');
    await sharp(data, { raw: { width: W, height: H, channels: 3 } })
      .extract({ left, top, width: Math.max(1, Math.floor(w)), height: Math.max(1, Math.floor(h)) })
      .resize(OUT_W, OUT_H, { fit: 'cover' }).jpeg({ quality: 85 }).toFile(tmpOut);
    await fs.promises.rename(tmpOut, cropPath(row.faceId));
  } finally {
    if (temp) await fs.promises.unlink(temp).catch(() => {});
  }
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const faceId = queue.shift();
    const row = lookup([faceId])[0];
    if (row == null) { queued.delete(faceId); continue; }
    active++;
    makeCrop(row)
      .catch((err) => { failed.add(faceId); console.warn('face crop failed', faceId, err.message); })
      .finally(() => { active--; queued.delete(faceId); pump(); });
  }
}

/** { [personId]: photos-media crop URL | null }. null = not ready yet (queued) or no cover. */
function getCoverPaths(personIds) {
  const ids = [...new Set(personIds.filter(Number.isSafeInteger))].slice(0, 500);
  if (ids.length === 0) return {};
  const rows = db.get().prepare('SELECT id, cover_face_id FROM people WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids));
  const result = {};
  for (const r of rows) {
    result[r.id] = null;
    if (r.cover_face_id == null) continue;
    const p = cropPath(r.cover_face_id);
    if (fs.existsSync(p)) { result[r.id] = cropUrl(r.cover_face_id, p); continue; }
    if (queued.has(r.cover_face_id) === false && failed.has(r.cover_face_id) === false) {
      queued.add(r.cover_face_id);
      queue.push(r.cover_face_id);
    }
  }
  pump();
  return result;
}

/** { [faceId]: photos-media crop URL | null } for specific faces (the viewer's People section). */
function getFaceCropPaths(faceIds) {
  const ids = [...new Set(faceIds.filter(Number.isSafeInteger))].slice(0, 100);
  const result = {};
  for (const id of ids) {
    const p = cropPath(id);
    if (fs.existsSync(p)) { result[id] = cropUrl(id, p); continue; }
    result[id] = null;
    if (queued.has(id) === false && failed.has(id) === false) { queued.add(id); queue.push(id); }
  }
  pump();
  return result;
}

/**
 * M10.9: removes crops of faces that no longer exist (re-analysed photos, removed
 * folders, replaced covers) and half-written temp files (named with a leading dot).
 * Unrecognised files are left alone. Returns { kept, removed, temps }.
 */
function sweepOrphans() {
  const dir = paths.faceCropsDir();
  const result = { kept: 0, removed: 0, temps: 0 };
  let names = [];
  try { names = fs.readdirSync(dir); } catch (err) { return result; }
  const byId = new Map();
  for (const name of names) {
    if (name.startsWith('.')) {
      if (queued.size === 0 && active === 0) { try { fs.rmSync(path.join(dir, name), { force: true }); result.temps++; } catch (e) { /* ignore */ } }
      continue;
    }
    const m = /^(\d+)\.jpg$/.exec(name);
    if (m) byId.set(Number(m[1]), name);
  }
  const ids = [...byId.keys()];
  const exists = new Set();
  const q = db.get().prepare('SELECT id FROM faces WHERE id IN (SELECT value FROM json_each(?))');
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of q.all(JSON.stringify(ids.slice(i, i + 500)))) exists.add(r.id);
  }
  for (const [id, name] of byId) {
    if (exists.has(id)) { result.kept++; continue; }
    try { fs.rmSync(path.join(dir, name), { force: true }); result.removed++; } catch (e) { /* ignore */ }
  }
  return result;
}

module.exports = { getCoverPaths, getFaceCropPaths, cropPath, sweepOrphans };
