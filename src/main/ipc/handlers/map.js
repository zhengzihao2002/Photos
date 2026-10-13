/**
 * IPC channels for the Map section (M7). See src/main/index/queries.js for
 * the underlying logic and exclusion rules -- this file only wires it to
 * IPC. Nothing here ever returns a source file path.
 *
 * map:get-points   (M7.4)
 *   Request:  none
 *   Response: { count: number,
 *               ids: Int32Array, lats: Float64Array, lngs: Float64Array,
 *               times: Float64Array, queryMs: number }
 *             Every visible GPS item (same exclusions as the grid's 'gps'
 *             filter), as parallel arrays sorted newest first, so a lower
 *             array position is always a newer item. times is the capture
 *             time read at face value, in seconds (ordering/ranges only).
 *             queryMs is the main-process time spent building the response.
 *
 * map:get-area-sections   (M7.6g, Apple-style grouped area page)
 *   Request:  { filter: string }  -- must be a map-area filter
 *             'geo:<minLat>,<minLng>,<maxLat>,<maxLng>', optionally with
 *             '::search:' / '::kind:' segments (same string the viewer uses).
 *   Response: { count: number, ids: Int32Array,
 *               sections: Array<{ localityEn: string|null,
 *                 localityZh: string|null, startDate: 'YYYY-MM-DD',
 *                 endDate: 'YYYY-MM-DD', start: number, count: number }> }
 *             Items oldest first; a section is a run of one place with no
 *             gap longer than a day. start is the section's offset in ids.
 */

const db = require('../../index/db');
const queries = require('../../index/queries');

async function getPoints() {
  const started = Date.now();
  const points = queries.getMapPoints(db.get());
  return { ...points, queryMs: Date.now() - started };
}

async function getAreaSections(event, payload = {}) {
  const filter = payload && typeof payload.filter === 'string' ? payload.filter : '';
  if (!filter.startsWith('geo:')) throw new Error('map:get-area-sections requires a geo filter');
  return queries.getAreaSections(db.get(), { filter });
}

module.exports = [
  { channel: 'map:get-points', handle: getPoints },
  { channel: 'map:get-area-sections', handle: getAreaSections },
];
