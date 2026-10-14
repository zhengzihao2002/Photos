/**
 * source-folders.js
 *
 * Operations on the source_folders table: add (with overlap rejection),
 * list (with live item counts and a cheap reachability refresh), remove
 * (deletes the source and its items together), relink (repoints a source
 * at a new path, e.g. after a rename or a drive remounting elsewhere), and
 * the scan-time status updates (markMissing/markScanned).
 */

const fs = require('fs');
const path = require('path');

function normalizePath(p) {
  return p.endsWith(path.sep) ? p.slice(0, -1) : p;
}

/** True if pathA and pathB are the same, or one is nested inside the other. */
function pathsOverlap(pathA, pathB) {
  const a = normalizePath(pathA);
  const b = normalizePath(pathB);
  if (a === b) return true;
  if (b.startsWith(a + path.sep)) return true;
  if (a.startsWith(b + path.sep)) return true;
  return false;
}

/**
 * M8b.6: a source must never contain, equal, or sit inside the app's own
 * folders (indexing its thumbnails, reacting to its own writes). Checked
 * against both the given and the real path. Returns a reason or null.
 */
function protectedConflict(rootPath, protectedRoots) {
  if (!Array.isArray(protectedRoots) || protectedRoots.length === 0) return null;
  const candidates = [path.resolve(rootPath)];
  try { candidates.push(fs.realpathSync(rootPath)); } catch (err) { /* checked by stat already */ }
  for (const p of protectedRoots) {
    for (const c of candidates) {
      if (!pathsOverlap(p, c)) continue;
      const contains = normalizePath(p).startsWith(normalizePath(c) + path.sep);
      return contains
        ? 'This folder contains the Photos app\u2019s own folder (' + p + '). Choose a folder that doesn\u2019t include it.'
        : 'This folder is part of the Photos app\u2019s own folder. Choose a different folder.';
    }
  }
  return null;
}

async function addSourceFolder(db, rootPath, opts = {}) {
  let stat;
  try {
    stat = await fs.promises.stat(rootPath);
  } catch (err) {
    return { added: false, reason: 'Folder not found or not accessible' };
  }
  if (!stat.isDirectory()) {
    return { added: false, reason: 'Not a folder' };
  }
  const protectedReason = protectedConflict(rootPath, opts.protectedRoots);
  if (protectedReason) return { added: false, reason: protectedReason };

  const existingRows = db.prepare('SELECT id, root_path FROM source_folders').all();
  const conflict = existingRows.find((row) => pathsOverlap(row.root_path, rootPath));
  if (conflict) {
    return {
      added: false,
      reason: `Overlaps with an existing source folder: ${conflict.root_path}`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const id = db.prepare(`
    INSERT INTO source_folders (root_path, display_name, status, added_at, last_checked_at)
    VALUES (?, ?, 'ok', ?, ?)
  `).run(rootPath, path.basename(rootPath), now, now).lastInsertRowid;

  return { added: true, id };
}

async function listSourceFolders(db) {
  const rows = db.prepare('SELECT * FROM source_folders ORDER BY added_at ASC').all();
  const now = Math.floor(Date.now() / 1000);

  const results = [];
  for (const row of rows) {
    let reachable = true;
    try {
      await fs.promises.access(row.root_path);
    } catch (err) {
      reachable = false;
    }

    const newStatus = reachable ? 'ok' : 'missing';
    if (newStatus !== row.status) {
      db.prepare('UPDATE source_folders SET status = ?, last_checked_at = ? WHERE id = ?')
        .run(newStatus, now, row.id);
    } else {
      db.prepare('UPDATE source_folders SET last_checked_at = ? WHERE id = ?').run(now, row.id);
    }

    const itemCount = db.prepare(
      'SELECT COUNT(*) AS c FROM items WHERE source_folder_id = ? AND is_deleted = 0'
    ).get(row.id).c;

    results.push({
      id: row.id,
      rootPath: row.root_path,
      displayName: row.display_name,
      status: newStatus,
      addedAt: row.added_at,
      lastScannedAt: row.last_scanned_at,
      lastCheckedAt: now,
      itemCount,
    });
  }

  return results;
}

function removeSourceFolder(db, id) {
  const existing = db.prepare('SELECT id FROM source_folders WHERE id = ?').get(id);
  if (!existing) {
    return { removed: false, reason: 'Source folder not found' };
  }

  const runTransaction = db.transaction(() => {
    const deletedCount = db.prepare('DELETE FROM items WHERE source_folder_id = ?').run(id).changes;
    db.prepare('DELETE FROM source_folders WHERE id = ?').run(id);
    return deletedCount;
  });

  const deletedItemCount = runTransaction();
  return { removed: true, deletedItemCount };
}

async function relinkSourceFolder(db, id, newRootPath, opts = {}) {
  const existing = db.prepare('SELECT id FROM source_folders WHERE id = ?').get(id);
  if (!existing) {
    return { relinked: false, reason: 'Source folder not found' };
  }

  let stat;
  try {
    stat = await fs.promises.stat(newRootPath);
  } catch (err) {
    return { relinked: false, reason: 'Folder not found or not accessible' };
  }
  if (!stat.isDirectory()) {
    return { relinked: false, reason: 'Not a folder' };
  }
  const protectedReason = protectedConflict(newRootPath, opts.protectedRoots);
  if (protectedReason) return { relinked: false, reason: protectedReason };

  const otherRows = db.prepare('SELECT id, root_path FROM source_folders WHERE id != ?').all(id);
  const conflict = otherRows.find((row) => pathsOverlap(row.root_path, newRootPath));
  if (conflict) {
    return {
      relinked: false,
      reason: `Overlaps with an existing source folder: ${conflict.root_path}`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE source_folders
    SET root_path = ?, display_name = ?, status = 'ok', last_checked_at = ?
    WHERE id = ?
  `).run(newRootPath, path.basename(newRootPath), now, id);

  return { relinked: true };
}

function markMissing(db, sourceFolderId, checkedAt) {
  db.prepare(`
    UPDATE source_folders SET status = 'missing', last_checked_at = ? WHERE id = ?
  `).run(checkedAt, sourceFolderId);
}

function markScanned(db, sourceFolderId, scannedAt) {
  db.prepare(`
    UPDATE source_folders SET status = 'ok', last_checked_at = ?, last_scanned_at = ? WHERE id = ?
  `).run(scannedAt, scannedAt, sourceFolderId);
}

module.exports = {
  pathsOverlap,
  protectedConflict,
  addSourceFolder,
  listSourceFolders,
  removeSourceFolder,
  relinkSourceFolder,
  markMissing,
  markScanned,
};
