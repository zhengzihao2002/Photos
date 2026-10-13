/**
 * thumbnail-db.js  (read side)
 *
 * SQL helpers for the thumbnail worker: what still needs a thumbnail, what
 * the renderer asked for, startup reset and progress counts. Claiming a job
 * and recording results live in thumbnail-writes.js.
 *
 * Takes an already-open better-sqlite3 connection (the worker's own, from
 * worker-db.js). Excluded folder ids and requested item ids are passed as
 * JSON arrays through json_each, so every query is one prepared statement.
 *
 * Grid-eligible = not deleted, not a Live Photo video half, and not a
 * non-cover burst member (the same rule the grid's queries use). Background
 * generation covers only grid-eligible items and only the 'sm' size.
 * Foreground lookups (jobsForIds) also include Live Photo halves and burst
 * members, since the viewer may ask for them on demand.
 *
 * Job: { id, folderId, sizes, sourcePath, extension, mediaType, durationSeconds }
 */

const path = require('path');

const ELIGIBLE_SQL =
  'i.is_deleted = 0 AND i.is_live_photo_component = 0 AND (i.burst_id IS NULL OR i.is_burst_cover = 1)';
const JOB_COLUMNS =
  'i.id, i.source_folder_id, i.relative_path, i.extension, i.media_type, i.duration_seconds, s.root_path';
const FROM_SQL = 'FROM items i JOIN source_folders s ON s.id = i.source_folder_id';

const FETCH_SQL =
  `SELECT ${JOB_COLUMNS} ${FROM_SQL} WHERE i.id > ? AND ${ELIGIBLE_SQL} ` +
  'AND i.thumb_sm_status IS NULL ' +
  'AND i.source_folder_id NOT IN (SELECT value FROM json_each(?)) ORDER BY i.id LIMIT ?';

const BY_IDS_SQL =
  `SELECT ${JOB_COLUMNS}, i.thumb_sm_status AS sm_status, i.thumb_md_status AS md_status ${FROM_SQL} ` +
  'WHERE i.is_deleted = 0 AND i.id IN (SELECT value FROM json_each(?))';

const COUNTS_SQL =
  "SELECT COUNT(*) AS total, SUM(i.thumb_sm_status = 'done') AS done, " +
  "SUM(i.thumb_sm_status = 'error') AS errors, SUM(i.thumb_sm_status = 'pending') AS pending " +
  `FROM items i WHERE ${ELIGIBLE_SQL} AND i.source_folder_id NOT IN (SELECT value FROM json_each(?))`;

const RESET_SQL =
  "UPDATE items SET " +
  "thumb_sm_status = CASE WHEN thumb_sm_status = 'pending' THEN NULL ELSE thumb_sm_status END, " +
  "thumb_md_status = CASE WHEN thumb_md_status = 'pending' THEN NULL ELSE thumb_md_status END " +
  "WHERE thumb_sm_status = 'pending' OR thumb_md_status = 'pending'";

function toJob(row, sizes) {
  return {
    id: row.id,
    folderId: row.source_folder_id,
    sizes,
    sourcePath: path.join(row.root_path, row.relative_path),
    extension: row.extension,
    mediaType: row.media_type,
    durationSeconds: row.duration_seconds,
  };
}

function createThumbnailReads(db) {
  const fetchStmt = db.prepare(FETCH_SQL);
  const byIdsStmt = db.prepare(BY_IDS_SQL);
  const countsStmt = db.prepare(COUNTS_SQL);
  const resetStmt = db.prepare(RESET_SQL);

  /** Next page of background jobs (sm only), ascending id, after a cursor. */
  function fetchBackground(afterId, limit, excludedFolderIds = []) {
    return fetchStmt
      .all(afterId, JSON.stringify(excludedFolderIds), limit)
      .map((row) => toJob(row, ['sm']));
  }

  /** Jobs for ids the renderer asked for. Skips anything already done, failed or in flight. */
  function jobsForIds(ids, size) {
    if (size !== 'sm' && size !== 'md') throw new RangeError('Invalid thumbnail size: ' + size);
    const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id)))];
    if (unique.length === 0) return [];
    const rows = new Map(byIdsStmt.all(JSON.stringify(unique)).map((row) => [row.id, row]));
    const jobs = [];
    for (const id of unique) {
      const row = rows.get(id);
      if (!row) continue;
      if (size === 'sm') {
        if (row.sm_status === null) jobs.push(toJob(row, ['sm']));
      } else if (row.md_status === null) {
        jobs.push(toJob(row, row.sm_status === null ? ['sm', 'md'] : ['md']));
      }
    }
    return jobs;
  }

  /** Startup rule: anything left 'pending' was in flight when the app quit. Returns rows changed. */
  function resetPending() {
    return resetStmt.run().changes;
  }

  /** Progress counts over grid-eligible items in folders not excluded. */
  function getCounts(excludedFolderIds = []) {
    const row = countsStmt.get(JSON.stringify(excludedFolderIds));
    return {
      total: row.total || 0,
      done: row.done || 0,
      errors: row.errors || 0,
      pending: row.pending || 0,
    };
  }

  return { fetchBackground, jobsForIds, resetPending, getCounts };
}

module.exports = { createThumbnailReads, toJob, FETCH_SQL, ELIGIBLE_SQL };
