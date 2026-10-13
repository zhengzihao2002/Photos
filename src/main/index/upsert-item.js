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
  'capture_time_local', 'capture_time_source', 'capture_date', 'capture_year', 'capture_month',
  'camera_make', 'camera_model', 'lens_model',
  'iso', 'f_number', 'exposure_time_seconds', 'focal_length_mm',
  'gps_latitude', 'gps_longitude', 'has_gps',
  'is_raw', 'is_gif', 'is_panorama',
  'is_live_photo', 'live_photo_video_item_id', 'is_live_photo_component',
  'burst_id', 'is_burst_cover',
  'extraction_error', 'extraction_version', 'place_version', 'is_deleted',
  'created_at', 'updated_at',
];

function createUpsertStatements(db) {
  const findExistingStmt = db.prepare(`
    SELECT id, file_size_bytes, file_mtime, filename, media_type, capture_time_local, capture_time_source,
           extension, width,
           gps_latitude, gps_longitude, has_gps, extraction_version
    FROM items
    WHERE source_folder_id = @sourceFolderId AND relative_path = @relativePath
  `);

  const insertStmt = db.prepare(`
    INSERT INTO items (${ITEM_COLUMNS.join(', ')})
    VALUES (${ITEM_COLUMNS.map((c) => '@' + c).join(', ')})
  `);

  const updateColumnsMinusCreatedAt = ITEM_COLUMNS.filter((c) => c !== 'created_at');
  const updateFullStmt = db.prepare(`
    UPDATE items
    SET ${updateColumnsMinusCreatedAt.map((c) => `${c} = @${c}`).join(', ')}
    WHERE id = @id
  `);

  const updateGroupingStmt = db.prepare(`
    UPDATE items
    SET is_live_photo = @is_live_photo,
        live_photo_video_item_id = @live_photo_video_item_id,
        is_live_photo_component = @is_live_photo_component,
        burst_id = @burst_id,
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

  function sweepDeletions(sourceFolderId, scanStartedAt, now) {
    const result = sweepDeletionsStmt.run({ sourceFolderId, scanStartedAt, now });
    return result.changes;
  }

  return {
    findExisting,
    insertItem,
    updateItemFull,
    updateItemGrouping,
    sweepDeletions,
  };
}

module.exports = { createUpsertStatements, ITEM_COLUMNS };
