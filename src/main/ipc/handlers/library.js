/**
 * IPC channels for the read-only query API. See src/main/index/queries.js
 * for the underlying logic and exclusion rules — this file only wires it
 * to IPC.
 *
 * library:get-items-page
 *   Request:  { limit?: number, cursor?: { captureSort, id } | null,
 *               direction?: 'older' | 'newer', filter?: string | null }
 *   Response: { items: Array<row>, hasMore: boolean,
 *               nextCursor: cursor | null, prevCursor: cursor | null }
 *
 * library:get-total-count
 *   Request:  { filter?: string | null }
 *   Response: number
 *
 * library:get-counts-by-year-month
 *   Request:  { filter?: string | null }
 *   Response: Array<{ year, month, count }>
 *
 * library:get-counts-by-date
 *   Request:  { filter?: string | null }
 *   Response: Array<{ date, count }>
 *
 * library:get-item-by-id
 *   Request:  { id: number }
 *   Response: full item row (see queries.js getItemById) | null
 *
 * library:get-item-index   (M5 return-to-grid)
 *   Request:  { id: number, filter?: string | null }
 *   Response: number | null  -- the item's index in the grid's newest-first
 *             order (same exclusions/filter as get-items-page); null if the
 *             item is excluded from the grid.
 *
 * library:get-reextraction-counts   (M1 patch A.4, launch-time backfill)
 *   Request:  none
 *   Response: Array<{ sourceFolderId: number, count: number }> -- only
 *             sources with rows needing re-extraction; [] once backfilled.
 *
 * library:get-media-type-counts   (M6 sidebar; hides empty Media Types)
 *   Request:  none
 *   Response: { video, selfie, live, panorama, burst, gif, raw } -- integer
 *             counts using exactly the same conditions as each type's filter.
 *
 * library:get-photo-video-counts   (M6 B.6f, grid footer)
 *   Request:  { filter?: string | null }
 *   Response: { photos: number, videos: number } -- same filter semantics as
 *             get-items-page.
 */

const db = require('../../index/db');
const queries = require('../../index/queries');

async function getItemsPage(event, payload = {}) {
  return queries.getItemsPage(db.get(), payload);
}

async function getTotalCount(event, payload = {}) {
  return queries.getTotalCount(db.get(), payload);
}

async function getCountsByYearMonth(event, payload = {}) {
  return queries.getCountsByYearMonth(db.get(), payload);
}

async function getCountsByDate(event, payload = {}) {
  return queries.getCountsByDate(db.get(), payload);
}

async function getItemById(event, payload) {
  const id = payload && Number.isSafeInteger(payload.id) && payload.id > 0 ? payload.id : null;
  const row = id === null ? null : queries.getItemById(db.get(), id);
  if (!row) return null;
  // M11: page script never sees where a file lives on disk.
  const { absolute_path: _a, live_photo_video_absolute_path: _l, source_root_path: _s, ...safe } = row;
  return safe;
}

async function getPhotoVideoCounts(event, payload = {}) {
  return queries.getPhotoVideoCounts(db.get(), { filter: payload.filter || null });
}

async function getMediaTypeCounts() {
  return queries.getMediaTypeCounts(db.get());
}

async function getReextractionCounts() {
  return queries.getReextractionCounts(db.get());
}

async function getItemIndex(event, payload = {}) {
  return queries.getItemIndex(db.get(), { id: Number(payload.id), filter: payload.filter || null });
}

module.exports = [
  { channel: 'library:get-items-page', handle: getItemsPage },
  { channel: 'library:get-total-count', handle: getTotalCount },
  { channel: 'library:get-counts-by-year-month', handle: getCountsByYearMonth },
  { channel: 'library:get-counts-by-date', handle: getCountsByDate },
  { channel: 'library:get-item-by-id', handle: getItemById },
  { channel: 'library:get-item-index', handle: getItemIndex },
  { channel: 'library:get-reextraction-counts', handle: getReextractionCounts },
  { channel: 'library:get-media-type-counts', handle: getMediaTypeCounts },
  { channel: 'library:get-photo-video-counts', handle: getPhotoVideoCounts },
];
