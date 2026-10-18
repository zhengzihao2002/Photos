/**
 * reconcile-moves.js -- M12.8
 *
 * Keeps a user's edits (favorite, title, caption, keywords) when a file is
 * renamed or moved inside the same source. Database only; never reads or
 * writes a photo file.
 *
 * A donor is a tombstoned row that disappeared within WINDOW_SECONDS and
 * holds user data. A recipient is a live row created within the window with
 * no user data. They match when media type, byte size, capture time, width
 * and height are equal AND the filename or file modification time is equal.
 * Only strictly one-to-one matches move data. Two rows that both still
 * exist are never touched, so the same photo in two folders stays two items.
 */

const WINDOW_SECONDS = 3600;

const HAS_USER_DATA = '(is_favorite = 1 OR title_user IS NOT NULL OR caption_user IS NOT NULL OR keywords_user_owned = 1 OR rotation != 0)';
const NO_USER_DATA = '(is_favorite = 0 AND title_user IS NULL AND caption_user IS NULL AND keywords_user_owned = 0 AND rotation = 0)';
const COLS = 'id, filename, media_type, file_size_bytes, file_mtime, capture_time_local, width, height';

function sameFile(a, b) {
  return a.media_type === b.media_type
    && a.file_size_bytes === b.file_size_bytes
    && a.capture_time_local === b.capture_time_local
    && a.width === b.width && a.height === b.height
    && (a.filename === b.filename || a.file_mtime === b.file_mtime);
}

function reconcileMoves(db, sourceFolderId, now) {
  const since = now - WINDOW_SECONDS;
  const run = db.transaction(() => {
    const donors = db.prepare(
      'SELECT ' + COLS + ' FROM items WHERE source_folder_id = ? AND is_deleted = 1 AND updated_at >= ? AND ' + HAS_USER_DATA
    ).all(sourceFolderId, since);
    if (donors.length === 0) return 0;
    const recipients = db.prepare(
      'SELECT ' + COLS + ' FROM items WHERE source_folder_id = ? AND is_deleted = 0 AND created_at >= ? AND ' + NO_USER_DATA
    ).all(sourceFolderId, since);
    if (recipients.length === 0) return 0;

    const donorMatches = new Map();
    const recipientMatches = new Map();
    for (const d of donors) {
      for (const r of recipients) {
        if (!sameFile(d, r)) continue;
        donorMatches.set(d.id, (donorMatches.get(d.id) || []).concat(r.id));
        recipientMatches.set(r.id, (recipientMatches.get(r.id) || []).concat(d.id));
      }
    }

    const moveRow = db.prepare(
      'UPDATE items SET is_favorite = (SELECT is_favorite FROM items WHERE id = @d), '
      + 'title_user = (SELECT title_user FROM items WHERE id = @d), '
      + 'caption_user = (SELECT caption_user FROM items WHERE id = @d), '
      + 'keywords_user_owned = (SELECT keywords_user_owned FROM items WHERE id = @d), '
      + 'rotation = (SELECT rotation FROM items WHERE id = @d) WHERE id = @r'
    );
    const moveKeywords = db.prepare(
      'INSERT OR IGNORE INTO item_keywords (item_id, keyword_id, origin) SELECT @r, keyword_id, 1 FROM item_keywords WHERE item_id = @d AND origin = 1'
    );
    const clearDonor = db.prepare(
      'UPDATE items SET is_favorite = 0, title_user = NULL, caption_user = NULL, keywords_user_owned = 0, rotation = 0 WHERE id = ?'
    );
    const dropDonorKeywords = db.prepare('DELETE FROM item_keywords WHERE item_id = ? AND origin = 1');

    let moved = 0;
    for (const [donorId, rids] of donorMatches) {
      if (rids.length !== 1) continue;
      const recipientId = rids[0];
      if ((recipientMatches.get(recipientId) || []).length !== 1) continue;
      moveRow.run({ d: donorId, r: recipientId });
      moveKeywords.run({ d: donorId, r: recipientId });
      clearDonor.run(donorId);
      dropDonorKeywords.run(donorId);
      moved += 1;
    }
    return moved;
  });
  return { moved: run() };
}

module.exports = { reconcileMoves, WINDOW_SECONDS };
