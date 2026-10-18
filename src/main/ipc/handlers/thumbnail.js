/**
 * IPC channels for thumbnail access. See src/main/thumbnails/ for the
 * generation pipeline; this file only wires read-only lookups and the
 * priority/regenerate requests to IPC.
 *
 * thumbnail:get-path
 *   Request:  { ids: number[], size: 'sm' | 'md' }
 *   Response: { [id]: photos-media URL string | null }   (object keys become strings over
 *              IPC; result[id] with a numeric id still works via JS's
 *              automatic coercion)
 *   Batch, not per-item: M3's grid should call this once per visible-range
 *   change. null means "not ready yet" OR "was marked done but the file
 *   was missing on disk" -- the latter case is self-healed here: the
 *   status is reset and the worker is asked to regenerate it soon, with
 *   no special handling required by the caller.
 *
 * thumbnail:get-status
 *   Request:  { id: number }
 *   Response: { sm: string|null, md: string|null, error: string|null }
 *   (sm/md are the raw column values: null | 'pending' | 'done' | 'error')
 *
 * thumbnail:request-priority
 *   Request:  { ids: number[], size?: 'sm' | 'md' }
 *   Response: { accepted: true }
 *   Fire-and-forget: moves these ids to the front of the queue.
 *
 * thumbnail:regenerate
 *   Request:  { id: number, size?: 'sm' | 'md' }
 *   Response: { accepted: true }
 *   Forces regeneration even if the current status is 'done' or 'error'.
 */

const fs = require('fs');
const db = require('../../index/db');
const paths = require('../../paths');
const thumbPaths = require('../../thumbnails/thumbnail-paths');
const manager = require('../../thumbnails/thumbnail-manager');

const MAX_BATCH_IDS = 2000;

/** mtime of the file in ms, or null when it is not readable. Used as the cache-busting version. */
async function fileVersion(p) {
  try {
    await fs.promises.access(p, fs.constants.R_OK);
    return Math.floor((await fs.promises.stat(p)).mtimeMs);
  } catch (err) {
    return null;
  }
}

async function thumbnailGetPath(event, payload = {}) {
  const size = payload.size === 'md' ? 'md' : 'sm';
  const ids = [...new Set((payload.ids || []).filter((id) => Number.isSafeInteger(id)))].slice(0, MAX_BATCH_IDS);
  if (ids.length === 0) return {};

  const col = size === 'sm' ? 'thumb_sm_status' : 'thumb_md_status';
  const rows = db.get().prepare(
    `SELECT id, ${col} AS status FROM items WHERE is_deleted = 0 AND id IN (SELECT value FROM json_each(?))`
  ).all(JSON.stringify(ids));
  const statusById = new Map(rows.map((r) => [r.id, r.status]));

  const thumbRoot = paths.thumbnailsDir();
  const result = {};
  const missing = [];

  await Promise.all(ids.map(async (id) => {
    if (statusById.get(id) !== 'done') { result[id] = null; return; }
    const p = thumbPaths.absolutePath(thumbRoot, id, size);
    const v = await fileVersion(p);
    // M11: a photos-media URL, never a file path.
    if (v !== null) result[id] = 'photos-media://thumb/' + id + '/' + size + '?v=' + v;
    else { result[id] = null; missing.push(id); }
  }));

  if (missing.length) {
    const resetStmt = db.get().prepare(`UPDATE items SET ${col} = NULL WHERE id = ?`);
    db.get().transaction((idsToReset) => { for (const id of idsToReset) resetStmt.run(id); })(missing);
    manager.prioritize(missing, size);
  }

  return result;
}

async function thumbnailGetStatus(event, payload) {
  const row = db.get().prepare(
    'SELECT thumb_sm_status AS sm, thumb_md_status AS md, thumb_error AS error FROM items WHERE id = ?'
  ).get(payload.id);
  return row || { sm: null, md: null, error: null };
}

async function thumbnailRequestPriority(event, payload = {}) {
  manager.prioritize(payload.ids || [], payload.size === 'md' ? 'md' : 'sm');
  return { accepted: true };
}

async function thumbnailRegenerate(event, payload) {
  manager.regenerate(payload.id, payload.size === 'md' ? 'md' : 'sm');
  return { accepted: true };
}

module.exports = [
  { channel: 'thumbnail:get-path', handle: thumbnailGetPath },
  { channel: 'thumbnail:get-status', handle: thumbnailGetStatus },
  { channel: 'thumbnail:request-priority', handle: thumbnailRequestPriority },
  { channel: 'thumbnail:regenerate', handle: thumbnailRegenerate },
];
