/**
 * live-identifier-backfill.js (M15.6)
 *
 * Reads the Content Identifier once for rows that predate it. Resumable and
 * throttled. Writes only content_identifier and live_pairing_version; never
 * file_mtime, file_size_bytes, extraction_version or updated_at.
 */
const fs = require('fs');
const path = require('path');
const { readStillIdentifier } = require('./live-identifier');
const { readVideoIdentifier } = require('./extract-video');

const BATCH = 200;
const MAX_VIDEO_SECONDS = 10;
const STILL_EXT = "('heic','heif','jpg','jpeg')";
const VIDEO_EXT = "('mov','mp4','m4v')";
const CANDIDATE = "((media_type = 'image' AND lower(extension) IN " + STILL_EXT + ") OR (media_type = 'video' AND lower(extension) IN " + VIDEO_EXT
  + ' AND (duration_seconds IS NULL OR duration_seconds <= ' + MAX_VIDEO_SECONDS + ')))';

async function runIdentifierBackfill(db, sourceFolderId, rootPath) {
  const out = { stamped: 0, read: 0, found: 0, skipped: 0 };
  out.stamped += db.prepare('UPDATE items SET live_pairing_version = 1 WHERE source_folder_id = ? AND live_pairing_version IS NULL AND is_deleted = 0 AND NOT ' + CANDIDATE)
    .run(sourceFolderId).changes;

  const next = db.prepare('SELECT id, relative_path, media_type FROM items WHERE source_folder_id = ? AND live_pairing_version IS NULL AND is_deleted = 0 AND id > ? AND ' + CANDIDATE + ' ORDER BY id LIMIT ' + BATCH);
  const save = db.prepare('UPDATE items SET content_identifier = ?, live_pairing_version = 1 WHERE id = ? AND live_pairing_version IS NULL');

  let after = 0;
  for (;;) {
    const rows = next.all(sourceFolderId, after);
    if (rows.length === 0) break;
    const results = [];
    for (const r of rows) {
      after = r.id;
      const full = path.join(rootPath, r.relative_path);
      let id;
      try {
        const st = await fs.promises.stat(full);
        if (st.blocks === 0 && st.size > 0) { out.skipped += 1; continue; } // possibly iCloud-only: never read
        id = r.media_type === 'video' ? await readVideoIdentifier(full) : await readStillIdentifier(full);
      } catch (err) { out.skipped += 1; continue; }
      if (id === undefined) { out.skipped += 1; continue; }
      out.read += 1;
      if (id) out.found += 1;
      results.push([id || null, r.id]);
    }
    db.transaction(() => { for (const [id, rid] of results) { out.stamped += save.run(id, rid).changes; } })();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return out;
}

module.exports = { runIdentifierBackfill };
