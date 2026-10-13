/**
 * orphan-sweep.js
 *
 * Finds thumbnail files whose item id no longer exists in the database at
 * all (not merely is_deleted=1 — a tombstoned row can revive and reuse its
 * thumbnail) and deletes them. This is how cache files left behind by
 * source:remove (a hard delete, see source-folders.js) get cleaned up.
 *
 * Lists every file on disk first, checks all their ids against the
 * database, and only then deletes — so an item inserted mid-sweep can
 * never be caught mid-check and wrongly removed. Intended to run once per
 * session, after the queue reaches idle.
 */

const fs = require('fs');
const path = require('path');

const FILENAME_RE = /^(\d+)_(sm|md)\.jpg$/;

function listThumbnailFiles(thumbRoot) {
  const found = [];
  let shards;
  try {
    shards = fs.readdirSync(thumbRoot, { withFileTypes: true });
  } catch (err) {
    return found;
  }
  for (const shard of shards) {
    if (!shard.isDirectory() || shard.name === '.tmp') continue;
    const shardPath = path.join(thumbRoot, shard.name);
    let files;
    try {
      files = fs.readdirSync(shardPath);
    } catch (err) {
      continue;
    }
    for (const name of files) {
      const match = FILENAME_RE.exec(name);
      if (match) found.push({ id: Number(match[1]), path: path.join(shardPath, name) });
    }
  }
  return found;
}

function existingIds(db, ids) {
  if (ids.length === 0) return new Set();
  const rows = db.prepare(
    'SELECT id FROM items WHERE id IN (SELECT value FROM json_each(?))'
  ).all(JSON.stringify([...ids]));
  return new Set(rows.map((r) => r.id));
}

/** Deletes thumbnail files whose id has no row at all. Returns { checked, deleted, failed }. */
function sweepOrphans(db, thumbRoot, log = () => {}) {
  const files = listThumbnailFiles(thumbRoot);
  const uniqueIds = new Set(files.map((f) => f.id));
  const present = existingIds(db, [...uniqueIds]);

  let deleted = 0;
  let failed = 0;
  for (const file of files) {
    if (present.has(file.id)) continue;
    try {
      fs.unlinkSync(file.path);
      deleted++;
    } catch (err) {
      failed++;
      log('WARN', 'orphan sweep could not delete ' + file.path + ': ' + err.message);
    }
  }

  log('INFO', 'orphan sweep: checked ' + files.length + ' files, deleted ' + deleted +
    (failed ? ', failed to delete ' + failed : ''));
  return { checked: files.length, deleted, failed };
}

module.exports = { sweepOrphans, listThumbnailFiles };
