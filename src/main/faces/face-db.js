/**
 * face-db.js  (M10.3)
 *
 * Every statement the face worker runs. Writes only to this app's database
 * (faces, face_rejections, items.face_version / face_attempts); never touches
 * file_mtime / file_size_bytes (thumbnail reset trigger) or updated_at.
 *
 * Visibility matches the Library: not deleted, not a Live Photo component,
 * not a non-cover burst frame. Videos are included once their poster-frame
 * thumbnail exists (M10.7: analysed from that still, never the video file).
 */

const MAX_ATTEMPTS = 3;
const INHERIT_IOU = 0.5;
// Environment problems, not file problems: retried later, never counted.
const TRY_LATER = new Set(['source_missing', 'permission_denied', 'write_failed']);

const VISIBLE_IMAGE = `(i.media_type = 'image' OR (i.media_type = 'video' AND i.thumb_sm_status = 'done')) AND i.is_deleted = 0 AND i.is_live_photo_component = 0
  AND (i.burst_id IS NULL OR i.is_burst_cover = 1)`;

const blob = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

function createFaceDb(db, pipelineVersion) {
  const stmts = {
    reset: db.prepare('UPDATE items SET face_version = NULL, face_attempts = 0 WHERE face_version IS NOT NULL AND face_version < ?'),
    total: db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${VISIBLE_IMAGE}`),
    done: db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${VISIBLE_IMAGE} AND i.face_version = ?`),
    failed: db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${VISIBLE_IMAGE} AND i.face_version IS NULL AND i.face_attempts >= ${MAX_ATTEMPTS}`),
    oldFaces: db.prepare('SELECT id, box_x, box_y, box_w, box_h, person_id, assignment FROM faces WHERE item_id = ?'),
    oldRejections: db.prepare('SELECT r.face_id, r.person_id FROM face_rejections r JOIN faces f ON f.id = r.face_id WHERE f.item_id = ?'),
    deleteFaces: db.prepare('DELETE FROM faces WHERE item_id = ?'),
    insertFace: db.prepare(`INSERT INTO faces (item_id, box_x, box_y, box_w, box_h, landmarks, score, size_px,
      sharpness, can_seed, embedding, person_id, assignment, created_at)
      VALUES (@item_id, @x, @y, @w, @h, @landmarks, @score, @size_px, @sharpness, @can_seed, @embedding,
      @person_id, @assignment, @now)`),
    insertRejection: db.prepare('INSERT OR IGNORE INTO face_rejections (face_id, person_id) VALUES (?, ?)'),
    stamp: db.prepare(`UPDATE items SET face_version = ?, face_attempts = 0
      WHERE id = ? AND file_mtime = ? AND file_size_bytes = ? AND is_deleted = 0`),
    fail: db.prepare('UPDATE items SET face_attempts = face_attempts + 1 WHERE id = ?'),
  };

  function resetOldVersions() {
    return stmts.reset.run(pipelineVersion).changes;
  }

  /** Next photos after afterId, skipping unreachable folders. */
  function fetchBatch(afterId, limit, excludedFolderIds) {
    const excluded = (excludedFolderIds || []).filter(Number.isInteger);
    const notIn = excluded.length ? `AND i.source_folder_id NOT IN (${excluded.join(',')})` : '';
    return db.prepare(`
      SELECT i.id, i.source_folder_id, i.relative_path, i.extension, i.file_mtime, i.file_size_bytes,
             i.thumb_md_status, i.thumb_sm_status, i.media_type, s.root_path
      FROM items i JOIN source_folders s ON s.id = i.source_folder_id
      WHERE i.face_version IS NULL AND ${VISIBLE_IMAGE} AND i.face_attempts < ${MAX_ATTEMPTS}
        AND i.id > ? ${notIn}
      ORDER BY i.id LIMIT ?`).all(afterId, limit);
  }

  function getCounts() {
    return {
      total: stmts.total.get().n,
      done: stmts.done.get(pipelineVersion).n,
      failed: stmts.failed.get().n,
    };
  }

  /** Replaces an item's faces in one transaction. Returns false if the item changed meanwhile. */
  const writeTx = db.transaction((item, faces, now) => {
    const old = stmts.oldFaces.all(item.id).map((r) => ({ ...r, box: [r.box_x, r.box_y, r.box_w, r.box_h] }));
    const rejections = stmts.oldRejections.all(item.id);
    stmts.deleteFaces.run(item.id);
    const claimed = new Set();
    for (const f of faces) {
      let match = null, best = INHERIT_IOU;
      for (const o of old) {
        if (claimed.has(o.id)) continue;
        const v = iou(f.box, o.box);
        if (v >= best) { best = v; match = o; }
      }
      if (match) claimed.add(match.id);
      const info = stmts.insertFace.run({
        item_id: item.id, x: f.box[0], y: f.box[1], w: f.box[2], h: f.box[3],
        landmarks: blob(f.landmarks), score: f.score, size_px: f.sizePx, sharpness: f.sharpness,
        can_seed: f.canSeed ? 1 : 0, embedding: blob(f.embedding),
        person_id: match ? match.person_id : null, assignment: match ? match.assignment : null, now,
      });
      if (match) {
        for (const r of rejections) if (r.face_id === match.id) stmts.insertRejection.run(info.lastInsertRowid, r.person_id);
      }
    }
    const stamped = stmts.stamp.run(pipelineVersion, item.id, item.file_mtime, item.file_size_bytes).changes;
    if (stamped === 0) throw new Error('item changed during analysis');
  });

  function writeResult(item, faces) {
    try {
      writeTx(item, faces, Date.now());
      return true;
    } catch (err) {
      if (/item changed during analysis|FOREIGN KEY/.test(err.message)) return false;
      throw err;
    }
  }

  /** Returns true if the failure was counted (a file problem), false if it will simply be retried. */
  function recordFailure(itemId, code) {
    if (TRY_LATER.has(code)) return false;
    stmts.fail.run(itemId);
    return true;
  }

  return { resetOldVersions, fetchBatch, getCounts, writeResult, recordFailure, TRY_LATER };
}

module.exports = { createFaceDb, MAX_ATTEMPTS };
