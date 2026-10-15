/**
 * queries.js
 *
 * The read API for the items table. Every later module (M3 grid, M4
 * timeline, M5 viewer, M6 filters, M7 map) should go through this rather
 * than writing its own SQL against the items table directly, so the
 * exclusion rules (deleted rows, Live Photo video components, non-cover
 * burst members) can never drift out of sync with what the schema's
 * partial indexes actually enforce.
 *
 * Paging is cursor-based (keyset pagination on capture_time_local + id),
 * not OFFSET-based — an OFFSET deep into a 100k-row library forces SQLite
 * to walk and discard everything before it; a cursor comparison hits the
 * index directly regardless of how deep into the library you are.
 */

const path = require('path');

const BASE_CLAUSE = 'is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1)';

const FILTER_CLAUSES = {
  video: "media_type = 'video'",
  raw: 'is_raw = 1',
  gif: 'is_gif = 1',
  panorama: 'is_panorama = 1',
  gps: 'has_gps = 1',
  // M6. Each clause must stay textually identical to its migration-7 partial
  // index term so SQLite can use the index.
  selfie: "media_type = 'image' AND lens_model LIKE '%front%'",
  live: 'is_live_photo = 1',
  // Equality (not 'burst_id IS NOT NULL') so idx_items_burst_cover (migration
  // 8) is used; same rows under BASE_CLAUSE: burst covers only.
  burst: 'is_burst_cover = 1',
};

// M6 Folders: 'source:<id>' filters to one source folder. The id is
// validated as a positive integer before being inlined, so no arbitrary
// text can reach the SQL. Served by idx_items_source.
const SOURCE_FILTER_PATTERN = /^source:([1-9]\d{0,9})$/;

// M10.6 People: 'person:<id>' filters to photos with a face assigned to that
// person. Same id rule as source:. The sub-query is answered from
// idx_faces_person (person_id, item_id); IN keeps each photo once.
const PERSON_FILTER_PATTERN = /^person:([1-9]\d{0,9})$/;

// M10.7 Groups: 'group:<id>,<id>[,<id>[,<id>]]' = photos with ALL of 2-4 people.
// Ids strictly increasing (one spelling per group); one idx_faces_person sub-query each.
const GROUP_FILTER_PATTERN = /^group:([1-9]\d{0,9}(?:,[1-9]\d{0,9}){1,3})$/;

function buildGroupClause(match) {
  const ids = match[1].split(',').map(Number);
  for (let i = 1; i < ids.length; i++) if (ids[i] <= ids[i - 1]) throw new Error('Invalid group filter');
  return ids.map((id) => 'id IN (SELECT item_id FROM faces WHERE person_id = ' + id + ')').join(' AND ');
}

// M6 (B.8): file-name search appended to any filter as
// '<section filter>::search:<encodeURIComponent(text)>' (section part may be
// empty = Library). The text is capped and escaped for LIKE and for SQL
// quoting, so any input is matched literally.
const SEARCH_MARKER = '::search:';
const SEARCH_MAX_LENGTH = 100;

function buildSearchClause(encoded) {
  let text;
  try { text = decodeURIComponent(encoded); } catch (err) { text = ''; }
  text = text.slice(0, SEARCH_MAX_LENGTH);
  if (!text) return null;
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
  return "filename LIKE '%" + escaped + "%' ESCAPE '\\'";
}

// M6: refinements appended to any filter as '::name:value' segments --
//   ::kind:photos | ::kind:videos   (album / All Photos view menu)
//   ::search:<encodeURIComponent>   (B.8 file-name search)
// encodeURIComponent encodes ':', so search text can never fake a segment.
const KIND_CLAUSES = { photos: "media_type = 'image'", videos: "media_type = 'video'" };

// M7.6 Map: 'geo:<minLat>,<minLng>,<maxLat>,<maxLng>' filters to a map area.
// Strictly validated (plain decimals, max 6 places, in range) before being
// inlined as fixed-point numbers, so no arbitrary text can reach the SQL.
// minLng > maxLng means the box crosses the antimeridian. Includes
// 'has_gps = 1' so the WHERE text matches idx_items_gps.
const GEO_NUMBER = '(-?\\d{1,3}(?:\\.\\d{1,6})?)';
const GEO_FILTER_PATTERN = new RegExp('^geo:' + [GEO_NUMBER, GEO_NUMBER, GEO_NUMBER, GEO_NUMBER].join(',') + '$');

function buildGeoClause(match) {
  const minLat = Number(match[1]);
  const minLng = Number(match[2]);
  const maxLat = Number(match[3]);
  const maxLng = Number(match[4]);
  if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90 || minLat > maxLat
    || Math.abs(minLng) > 180 || Math.abs(maxLng) > 180) {
    throw new Error('Invalid geo filter');
  }
  const f = (n) => n.toFixed(6);
  const lat = 'gps_latitude BETWEEN ' + f(minLat) + ' AND ' + f(maxLat);
  const lng = minLng <= maxLng
    ? 'gps_longitude BETWEEN ' + f(minLng) + ' AND ' + f(maxLng)
    : '(gps_longitude >= ' + f(minLng) + ' OR gps_longitude <= ' + f(maxLng) + ')';
  return 'has_gps = 1 AND ' + lat + ' AND ' + lng;
}

function buildFilterSql(filter) {
  if (typeof filter === 'string' && filter.includes('::')) {
    const segments = filter.split('::');
    let sql = buildFilterSql(segments[0] || null);
    for (const seg of segments.slice(1)) {
      if (seg.startsWith('search:')) {
        const clause = buildSearchClause(seg.slice('search:'.length));
        if (clause) sql += ' AND ' + clause;
      } else if (seg.startsWith('kind:')) {
        const kind = seg.slice('kind:'.length);
        if (!Object.prototype.hasOwnProperty.call(KIND_CLAUSES, kind)) throw new Error(`Unknown kind: ${kind}`);
        sql += ' AND ' + KIND_CLAUSES[kind];
      } else {
        throw new Error(`Unknown filter segment: ${seg}`);
      }
    }
    return sql;
  }
  if (!filter) return BASE_CLAUSE;
  const sourceMatch = typeof filter === 'string' ? SOURCE_FILTER_PATTERN.exec(filter) : null;
  if (sourceMatch) return `${BASE_CLAUSE} AND source_folder_id = ${Number(sourceMatch[1])}`;
  const geoMatch = typeof filter === 'string' ? GEO_FILTER_PATTERN.exec(filter) : null;
  if (geoMatch) return BASE_CLAUSE + ' AND ' + buildGeoClause(geoMatch);
  const personMatch = typeof filter === 'string' ? PERSON_FILTER_PATTERN.exec(filter) : null;
  if (personMatch) return `${BASE_CLAUSE} AND id IN (SELECT item_id FROM faces WHERE person_id = ${Number(personMatch[1])})`;
  const groupMatch = typeof filter === 'string' ? GROUP_FILTER_PATTERN.exec(filter) : null;
  if (groupMatch) return BASE_CLAUSE + ' AND ' + buildGroupClause(groupMatch);
  if (!Object.prototype.hasOwnProperty.call(FILTER_CLAUSES, filter)) {
    throw new Error(`Unknown filter: ${filter}`);
  }
  return `${BASE_CLAUSE} AND ${FILTER_CLAUSES[filter]}`;
}

/**
 * Returns a page of items, always newest-first in the response regardless
 * of fetch direction. cursor is { captureTimeLocal, id } from a previous
 * page's nextCursor/prevCursor, or null for the first page.
 */
function getItemsPage(db, { limit = 100, cursor = null, direction = 'older', filter = null } = {}) {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
  const whereFilter = buildFilterSql(filter);

  let orderBy;
  let cursorClause = '';
  const params = {};

  if (direction === 'newer') {
    orderBy = 'capture_time_local ASC, id ASC';
    if (cursor) {
      cursorClause = 'AND (capture_time_local, id) > (@cursorTime, @cursorId)';
      params.cursorTime = cursor.captureTimeLocal;
      params.cursorId = cursor.id;
    }
  } else {
    orderBy = 'capture_time_local DESC, id DESC';
    if (cursor) {
      cursorClause = 'AND (capture_time_local, id) < (@cursorTime, @cursorId)';
      params.cursorTime = cursor.captureTimeLocal;
      params.cursorId = cursor.id;
    }
  }

  const sql = `
    SELECT id, source_folder_id, media_type, width, height, capture_time_local, duration_seconds, -- M8b.7: source id for the unavailable badge
           is_live_photo, burst_id, is_burst_cover
    FROM items
    WHERE ${whereFilter} ${cursorClause}
    ORDER BY ${orderBy}
    LIMIT @limit
  `;

  const rows = db.prepare(sql).all({ ...params, limit: safeLimit + 1 });
  const hasMore = rows.length > safeLimit;
  const page = rows.slice(0, safeLimit);

  if (direction === 'newer') {
    page.reverse();
  }

  const nextCursor = page.length > 0
    ? { captureTimeLocal: page[page.length - 1].capture_time_local, id: page[page.length - 1].id }
    : null;
  const prevCursor = page.length > 0
    ? { captureTimeLocal: page[0].capture_time_local, id: page[0].id }
    : null;

  return { items: page, hasMore, nextCursor, prevCursor };
}

function getCountsByYearMonth(db, { filter = null } = {}) {
  const whereFilter = buildFilterSql(filter);
  return db.prepare(`
    SELECT capture_year AS year, capture_month AS month, COUNT(*) AS count
    FROM items
    WHERE ${whereFilter}
    GROUP BY capture_year, capture_month
    ORDER BY capture_year DESC, capture_month DESC
  `).all();
}

function getCountsByDate(db, { filter = null } = {}) {
  const whereFilter = buildFilterSql(filter);
  return db.prepare(`
    SELECT capture_date AS date, COUNT(*) AS count
    FROM items
    WHERE ${whereFilter}
    GROUP BY capture_date
    ORDER BY capture_date DESC
  `).all();
}

function getTotalCount(db, { filter = null } = {}) {
  const whereFilter = buildFilterSql(filter);
  const row = db.prepare(`SELECT COUNT(*) AS count FROM items WHERE ${whereFilter}`).get();
  return row.count;
}

/**
 * Full detail for one item, for the Info panel (M5). Resolves the real
 * absolute path on disk (paths are stored relative to their source folder
 * root — see M1.3), and, for a Live Photo, also resolves its paired
 * video's absolute path.
 */
function getItemById(db, id) {
  const row = db.prepare(`
    SELECT items.*, source_folders.root_path AS source_root_path
    FROM items
    JOIN source_folders ON source_folders.id = items.source_folder_id
    WHERE items.id = ?
  `).get(id);

  if (!row) return null;

  const absolutePath = path.join(row.source_root_path, row.relative_path);

  let livePhotoVideoAbsolutePath = null;
  if (row.live_photo_video_item_id) {
    const videoRow = db.prepare(`
      SELECT items.relative_path, source_folders.root_path AS source_root_path
      FROM items JOIN source_folders ON source_folders.id = items.source_folder_id
      WHERE items.id = ?
    `).get(row.live_photo_video_item_id);
    if (videoRow) {
      livePhotoVideoAbsolutePath = path.join(videoRow.source_root_path, videoRow.relative_path);
    }
  }

  return {
    ...row,
    absolute_path: absolutePath,
    live_photo_video_absolute_path: livePhotoVideoAbsolutePath,
  };
}

/**
 * Grid index of one item (M5 return-to-grid): the number of items that sort
 * before it in the grid's newest-first order, under the SAME exclusions and
 * filter as getItemsPage. Returns null if the item itself is excluded
 * (deleted, Live Photo video component, non-cover burst member) or doesn't
 * match the filter, so callers can fail safe.
 */
function getItemIndex(db, { id, filter = null } = {}) {
  const whereFilter = buildFilterSql(filter);
  const row = db.prepare(
    `SELECT id, capture_time_local FROM items WHERE id = @id AND ${whereFilter}`
  ).get({ id });
  if (!row) return null;
  const { n } = db.prepare(
    `SELECT COUNT(*) AS n FROM items WHERE ${whereFilter} AND (capture_time_local, id) > (@t, @id)`
  ).get({ t: row.capture_time_local, id: row.id });
  return n;
}

/**
 * M1 patch (A.4): per-source counts of rows whose stored metadata predates
 * the A.1/A.2 fixes (HEIC/HEIF without dimensions; implausible capture time
 * not sourced from file_mtime). MUST stay in sync with needsReextraction()
 * in scan-directory-batch.js, the worker-side twin that does the work.
 * Used at launch to enqueue a one-time backfill scan of affected sources.
 */
function getReextractionCounts(db) {
  return db.prepare(`
    SELECT source_folder_id AS sourceFolderId, COUNT(*) AS count
    FROM items
    WHERE is_deleted = 0 AND (
      (extension IN ('heic', 'heif') AND width IS NULL)
      OR (capture_time_source IS NOT 'file_mtime' AND capture_time_local IS NOT NULL AND (
            capture_time_local <= '1970-01-01 00:00:00'
            OR capture_time_local > datetime('now', '+1 day')))
    )
    GROUP BY source_folder_id
  `).all();
}

/**
 * M6: per-Media-Type counts for the sidebar (types with 0 are hidden). Built
 * from FILTER_CLAUSES + BASE_CLAUSE, so every count uses exactly the same
 * condition as the grid that opens for that type. One pass over visible rows.
 * Response: { video, selfie, live, panorama, burst, gif, raw } -- integers.
 */
const MEDIA_TYPE_FILTERS = ['video', 'selfie', 'live', 'panorama', 'burst', 'gif', 'raw'];

function getMediaTypeCounts(db) {
  const columns = MEDIA_TYPE_FILTERS
    .map((key) => `COALESCE(SUM(CASE WHEN ${FILTER_CLAUSES[key]} THEN 1 ELSE 0 END), 0) AS ${key}`)
    .join(',\n      ');
  return db.prepare(`
    SELECT
      ${columns}
    FROM items
    WHERE ${BASE_CLAUSE}
  `).get();
}

/**
 * M6 (B.6f): photo and video counts for the grid's footer, under exactly the
 * same filter semantics as the grid (buildFilterSql). Response:
 * { photos: number, videos: number }.
 */
function getPhotoVideoCounts(db, { filter = null } = {}) {
  const whereFilter = buildFilterSql(filter);
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END), 0) AS photos,
      COALESCE(SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END), 0) AS videos
    FROM items
    WHERE ${whereFilter}
  `).get();
  return { photos: row.photos, videos: row.videos };
}

/**
 * M7.4: every visible GPS item for the map, as parallel typed arrays (compact
 * binary over IPC -- never 100k row objects, never file paths). Uses the
 * 'gps' filter so the WHERE text matches idx_items_gps. Sorted newest first
 * (the grid's order), so a lower array position always means a newer item:
 * a cluster's representative is simply its smallest position.
 * times: capture_time_local read at face value as seconds (UTC arithmetic
 * on the stored digits; for ordering/ranges only, not a real instant).
 * Response: { count, ids: Int32Array, lats: Float64Array,
 *             lngs: Float64Array, times: Float64Array }
 */
function captureLocalToSeconds(text) {
  if (typeof text !== 'string' || text.length < 19) return 0;
  const ms = Date.UTC(
    Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)),
    Number(text.slice(11, 13)), Number(text.slice(14, 16)), Number(text.slice(17, 19))
  );
  return Number.isFinite(ms) ? ms / 1000 : 0;
}

function getMapPoints(db) {
  const rows = db.prepare(`
    SELECT id, gps_latitude, gps_longitude, capture_time_local
    FROM items
    WHERE ${buildFilterSql('gps')}
    ORDER BY capture_time_local DESC, id DESC
  `).raw().all();

  const count = rows.length;
  const ids = new Int32Array(count);
  const lats = new Float64Array(count);
  const lngs = new Float64Array(count);
  const times = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const row = rows[i];
    ids[i] = row[0];
    lats[i] = row[1];
    lngs[i] = row[2];
    times[i] = captureLocalToSeconds(row[3]);
  }
  return { count, ids, lats, lngs, times };
}

/**
 * M7.6g: one map area for the Apple-style grouped page. Items are listed
 * oldest first (the exact reverse of the grid's newest-first order, so the
 * viewer's older/newer neighbours follow the page), split into sections: a
 * new section starts when the place name changes or when more than one day
 * passes without items. Ids only -- never file paths.
 * Response: { count, ids: Int32Array,
 *   durations: Float32Array (seconds; -1 = not a video or unknown),
 *   sections: Array<{ localityEn, localityZh, startDate, endDate,
 *                     start, count }> }   (start = offset into ids)
 */
function daysBetween(a, b) {
  const gap = (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
  return Number.isFinite(gap) ? gap : 0;
}

function getAreaSections(db, { filter = null } = {}) {
  const rows = db.prepare(
    'SELECT id, capture_date, place_locality_en, place_locality_zh, media_type, duration_seconds FROM items WHERE '
    + buildFilterSql(filter) + ' ORDER BY capture_time_local ASC, id ASC'
  ).raw().all();

  const ids = new Int32Array(rows.length);
  const durations = new Float32Array(rows.length);
  const sections = [];
  let current = null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    ids[i] = row[0];
    durations[i] = row[4] === 'video' && typeof row[5] === 'number' ? row[5] : -1;
    if (!current || current.localityEn !== row[2] || daysBetween(current.endDate, row[1]) > 1) {
      current = { localityEn: row[2], localityZh: row[3], startDate: row[1], endDate: row[1], start: i, count: 0 };
      sections.push(current);
    }
    current.endDate = row[1];
    current.count += 1;
  }
  return { count: rows.length, ids, durations, sections };
}

module.exports = {
  getAreaSections,
  getMapPoints,
  getItemIndex,
  getPhotoVideoCounts,
  getMediaTypeCounts,
  MEDIA_TYPE_FILTERS,
  getReextractionCounts,
  getItemsPage,
  getCountsByYearMonth,
  getCountsByDate,
  getTotalCount,
  getItemById,
};
