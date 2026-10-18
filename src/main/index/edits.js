/**
 * edits.js -- M12.3
 *
 * Database-only user edits (never any write to photo files). One function
 * per kind of edit, one transaction per user action.
 *
 * A target is { filter } (a grid filter, usually with a '::sel:' segment,
 * validated by buildFilterSql) or { ids } (at most 1000 positive integers).
 */

const { buildFilterSql } = require('./queries');

const MAX_IDS = 1000;

function targetWhere(target) {
  if (target && Array.isArray(target.ids)) {
    if (target.ids.length === 0 || target.ids.length > MAX_IDS) throw new Error('Invalid target: ids');
    for (const v of target.ids) {
      if (!Number.isInteger(v) || v <= 0 || v > 2147483647) throw new Error('Invalid target: ids');
    }
    return 'id IN (' + Array.from(new Set(target.ids)).join(',') + ')';
  }
  if (target && typeof target.filter === 'string') return buildFilterSql(target.filter);
  if (target && target.filter === null) return buildFilterSql(null);
  throw new Error('Invalid target');
}

/** Sets or clears the favorite flag on every target item. Returns { changed }. */
function setFavorite(db, { target, value }) {
  if (typeof value !== 'boolean') throw new Error('Invalid value');
  const where = targetWhere(target);
  const v = value ? 1 : 0;
  const run = db.transaction(() => db.prepare(
    'UPDATE items SET is_favorite = @v WHERE id IN (SELECT id FROM items WHERE ' + where + ') AND is_favorite != @v'
  ).run({ v }));
  return { changed: run().changes };
}

module.exports = { setFavorite, targetWhere };
