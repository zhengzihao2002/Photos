/**
 * upsert-item.js
 *
 * Prepared statements for reading and writing item rows. No grouping logic
 * here — this only knows how to check whether a row exists, insert a new
 * one, fully update a changed one, lightly refresh just the Live
 * Photo/burst fields on an unchanged one, and sweep deletions after a
 * completed scan.
 *
 * createUpsertStatements(db) must be called once per database connection
 * (main-thread and worker-thread connections are separate Database
 * instances) and the returned object reused for every row in that
 * connection's lifetime, rather than re-preparing per row.
 */

const ITEM_COLUMNS = [
  'source_folder_id', 'relative_path', 'filename', 'media_type', 'extension',
  'file_size_bytes', 'file_mtime',
  'width', 'height', 'orientation_applied', 'duration_seconds',
  'capture_time_local', 'capture_sort', 'capture_time_source', 'capture_date', 'capture_year', 'capture_month',
  'camera_make', 'camera_model', 'lens_model',
  'iso', 'f_number', 'exposure_time_seconds', 'focal_length_mm',
  'gps_latitude', 'gps_longitude', 'has_gps',
  'is_raw', 'is_gif', 'is_panorama',
  'is_live_photo', 'live_photo_video_item_id', 'is_live_photo_component',
  'burst_id', 'is_burst_cover',
  'extraction_error', 'extraction_version', 'place_version', 'is_deleted',
  'title_file', 'caption_file', 'exposure_bias_ev', 'focal_length_35mm', // M12.4 / M12.7: extractor-owned only
  'content_identifier', 'live_pairing_version', // M15: extractor-owned only
  'created_at', 'updated_at',
];

function createUpsertStatements(db) {
  const findExistingStmt = db.prepare(`
    SELECT id, file_size_bytes, file_mtime, filename, media_type, capture_time_local, capture_sort, capture_time_source,
           extension, width,
           gps_latitude, gps_longitude, has_gps, extraction_version, content_identifier
    FROM items
    WHERE source_folder_id = @sourceFolderId AND relative_path = @relativePath
  `);

  const insertStmt = db.prepare(`
    INSERT INTO items (${ITEM_COLUMNS.join(', ')})
    VALUES (${ITEM_COLUMNS.map((c) => '@' + c).join(', ')})
  `);

  // M15: live-pairing-pass.js is the only writer of the three Live Photo columns.
  const LIVE_COLUMNS = ['is_live_photo', 'live_photo_video_item_id', 'is_live_photo_component'];
  const updateColumnsMinusCreatedAt = ITEM_COLUMNS.filter((c) => c !== 'created_at' && !LIVE_COLUMNS.includes(c));
  const updateFullStmt = db.prepare(`
    UPDATE items
    SET ${updateColumnsMinusCreatedAt.map((c) => `${c} = @${c}`).join(', ')}
    WHERE id = @id
  `);

  const updateGroupingStmt = db.prepare(`
    UPDATE items
    SET burst_id = @burst_id,
        is_burst_cover = @is_burst_cover,
        is_deleted = 0,
        updated_at = @updated_at
    WHERE id = @id
  `);

  const sweepDeletionsStmt = db.prepare(`
    UPDATE items
    SET is_deleted = 1, updated_at = @now
    WHERE source_folder_id = @sourceFolderId AND is_deleted = 0 AND updated_at < @scanStartedAt
  `);

  // M8b.4: deletion sweep limited to one directory of a source. relative_path
  // is '/'-separated and includes the filename; rows of folder D are the range
  // [D + '/', D + '0') on the (source_folder_id, relative_path) index ('0' is
  // the character after '/'). Non-recursive = no further '/' after the prefix.
  // The root folder ('') has no range.
  const sweepScopedStmt = db.prepare(`
    UPDATE items
    SET is_deleted = 1, updated_at = @now
    WHERE source_folder_id = @sourceFolderId AND is_deleted = 0 AND updated_at < @scanStartedAt
      AND relative_path >= @lo AND relative_path < @hi
      AND (@recursive = 1 OR instr(substr(relative_path, @plen + 1), '/') = 0)
  `);
  const sweepScopedRootStmt = db.prepare(`
    UPDATE items
    SET is_deleted = 1, updated_at = @now
    WHERE source_folder_id = @sourceFolderId AND is_deleted = 0 AND updated_at < @scanStartedAt
      AND (@recursive = 1 OR instr(relative_path, '/') = 0)
  `);

  function sweepDeletionsScoped(sourceFolderId, dirRel, recursive, scanStartedAt, now) {
    const r = recursive ? 1 : 0;
    if (!dirRel) {
      return sweepScopedRootStmt.run({ sourceFolderId, scanStartedAt, now, recursive: r }).changes;
    }
    const prefix = dirRel.replace(/\/+$/, '') + '/';
    return sweepScopedStmt.run({
      sourceFolderId, scanStartedAt, now, recursive: r,
      lo: prefix, hi: prefix.slice(0, -1) + '0', plen: prefix.length,
    }).changes;
  }

  function findExisting(sourceFolderId, relativePath) {
    return findExistingStmt.get({ sourceFolderId, relativePath });
  }

  function insertItem(fields) {
    const result = insertStmt.run(fields);
    return result.lastInsertRowid;
  }

  function updateItemFull(id, fields) {
    updateFullStmt.run({ ...fields, id });
  }

  function updateItemGrouping(id, groupingFields, updatedAt) {
    updateGroupingStmt.run({ ...groupingFields, id, updated_at: updatedAt });
  }

  // M12.4: keywords read from the file (origin 0). Replaces only this item's
  // origin-0 rows; user keywords (origin 1) are never touched.
  const delFileKeywordsStmt = db.prepare('DELETE FROM item_keywords WHERE item_id = ? AND origin = 0');
  const insKeywordStmt = db.prepare('INSERT OR IGNORE INTO keywords (name) VALUES (?)');
  const getKeywordStmt = db.prepare('SELECT id FROM keywords WHERE name = ?');
  const insItemKeywordStmt = db.prepare('INSERT OR IGNORE INTO item_keywords (item_id, keyword_id, origin) VALUES (?, ?, 0)');
  const pruneKeywordsStmt = db.prepare('DELETE FROM keywords WHERE id NOT IN (SELECT DISTINCT keyword_id FROM item_keywords)');
  function setFileKeywords(itemId, names) {
    delFileKeywordsStmt.run(itemId);
    for (const name of names || []) {
      insKeywordStmt.run(name);
      const row = getKeywordStmt.get(name);
      if (row) insItemKeywordStmt.run(itemId, row.id);
    }
  }
  function pruneKeywords() { return pruneKeywordsStmt.run().changes; }

  function sweepDeletions(sourceFolderId, scanStartedAt, now) {
    const result = sweepDeletionsStmt.run({ sourceFolderId, scanStartedAt, now });
    return result.changes;
  }

  return {
    findExisting,
    insertItem,
    updateItemFull,
    updateItemGrouping,
    setFileKeywords,
    pruneKeywords,
    sweepDeletions,
    sweepDeletionsScoped,
  };
}

module.exports = { createUpsertStatements, ITEM_COLUMNS };
