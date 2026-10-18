/**
 * selection-summary.js -- M12.6
 *
 * Aggregates for the Info window when several items are selected. Computed
 * in the main process from a grid filter (usually with '::sel:'), never from
 * a list of ids sent by the renderer.
 */

const { buildFilterSql } = require('./queries');

const MAX_POINTS = 500;
const SHOWN_TITLE = 'COALESCE(title_user, title_file)';
const SHOWN_CAPTION = 'COALESCE(caption_user, caption_file)';

function sharedValue(db, where, expr, total) {
  const r = db.prepare(
    'SELECT COUNT(DISTINCT NULLIF(' + expr + ", '')) AS d, MIN(NULLIF(" + expr + ", '')) AS v, "
    + 'SUM(NULLIF(' + expr + ", '') IS NOT NULL) AS filled FROM items WHERE " + where
  ).get();
  if (!r.filled) return null;
  if (r.d === 1 && r.filled === total) return r.v;
  return 'mixed';
}

function getSelectionSummary(db, { filter }) {
  const where = buildFilterSql(filter);
  const a = db.prepare(
    "SELECT COUNT(*) AS count, SUM(media_type = 'image') AS photos, SUM(media_type = 'video') AS videos, "
    + 'MIN(capture_time_local) AS firstTime, MAX(capture_time_local) AS lastTime, '
    + 'COALESCE(SUM(file_size_bytes), 0) AS totalBytes, SUM(is_favorite) AS favs FROM items WHERE ' + where
  ).get();
  const count = a.count || 0;
  if (count === 0) {
    return { count: 0, photos: 0, videos: 0, firstTime: null, lastTime: null, totalBytes: 0,
      favorite: 'none', title: null, caption: null, keywords: [], points: { ids: [], lats: [], lngs: [] } };
  }
  const favorite = a.favs === 0 ? 'none' : (a.favs === count ? 'all' : 'mixed');
  const title = sharedValue(db, where, SHOWN_TITLE, count);
  const caption = sharedValue(db, where, SHOWN_CAPTION, count);
  // Apple shows every keyword of any selected item (union), most common first.
  const keywords = db.prepare(
    'SELECT k.name AS name FROM item_keywords ik JOIN keywords k ON k.id = ik.keyword_id '
    + 'JOIN items ON items.id = ik.item_id AND ik.origin = items.keywords_user_owned '
    + 'WHERE items.id IN (SELECT id FROM items WHERE ' + where + ') '
    + 'GROUP BY k.id ORDER BY COUNT(*) DESC, k.name COLLATE NOCASE LIMIT 100'
  ).all().map((r) => r.name);
  const pts = db.prepare(
    'SELECT id, gps_latitude, gps_longitude FROM items WHERE has_gps = 1 AND ' + where + ' LIMIT ' + MAX_POINTS
  ).raw().all();
  return {
    count, photos: a.photos || 0, videos: a.videos || 0, firstTime: a.firstTime, lastTime: a.lastTime,
    totalBytes: a.totalBytes, favorite, title, caption, keywords,
    points: { ids: pts.map((r) => r[0]), lats: pts.map((r) => r[1]), lngs: pts.map((r) => r[2]) },
  };
}

module.exports = { getSelectionSummary };
