/**
 * edit-variant-pass.js
 *
 * Post-scan pass; the only writer of items.is_edit_variant. Database only: never
 * reads or writes a file. iOS saves an edited photo next to its original as
 * IMG_E1234.<ext> (original IMG_1234.<ext>); Apple Photos counts the two as one
 * item showing the edit. Here the ORIGINAL is the one shown, so the IMG_E copy
 * is hidden (same mechanism as a burst's non-cover members) whenever its original
 * exists in the same folder. A lone IMG_E file stays visible. Un-hiding is the
 * same code path: the desired state is recomputed and differences are written.
 */
const path = require('path');

const EDIT_STEM = /^IMG_E(\d+)$/i;

function stemAndDir(rel) {
  const base = path.posix.basename(rel);
  const ext = path.posix.extname(base);
  const dir = path.posix.dirname(rel);
  return { dir: dir === '.' ? '' : dir + '/', stem: ext ? base.slice(0, -ext.length) : base };
}

function runEditVariantPass(db, sourceFolderId = null) {
  const scope = sourceFolderId === null ? '' : ' AND source_folder_id = @src';
  const bind = sourceFolderId === null ? {} : { src: sourceFolderId };

  const candidates = db.prepare(
    "SELECT id, source_folder_id, relative_path FROM items WHERE is_deleted = 0 AND filename LIKE '%E%'" + scope
  ).all(bind);
  const findOriginal = db.prepare(
    'SELECT 1 FROM items WHERE source_folder_id = ? AND is_deleted = 0 AND relative_path >= ? AND relative_path < ? LIMIT 1'
  );

  const desired = new Set();
  for (const c of candidates) {
    const { dir, stem } = stemAndDir(c.relative_path);
    const m = EDIT_STEM.exec(stem);
    if (!m) continue;
    const prefix = dir + stem.slice(0, 4) + m[1]; // 'IMG_' + digits, in the edit's own letter case
    if (findOriginal.get(c.source_folder_id, prefix + '.', prefix + '/')) desired.add(c.id);
  }

  const current = db.prepare('SELECT id FROM items WHERE is_edit_variant = 1' + scope).all(bind).map((r) => r.id);
  const set = db.prepare('UPDATE items SET is_edit_variant = ? WHERE id = ?');
  let changed = 0;
  db.transaction(() => {
    const had = new Set(current);
    for (const id of desired) if (!had.has(id)) { set.run(1, id); changed += 1; }
    for (const id of current) if (!desired.has(id)) { set.run(0, id); changed += 1; }
  })();
  return { hidden: desired.size, changed };
}

module.exports = { runEditVariantPass };
