/**
 * IPC channels for People (M10.6). Read-only here; corrections arrive in M10.7.
 * Nothing returns a source file path: covers are the app's own crop files.
 *
 * people:list         { scope?: 'named' | 'unnamed' }   (People page / Add People screen)
 *   -> { people: [{ id, name, photoCount, hidden }], analysis: { state, done, total } }
 *   Shown people only: 5+ visible photos, or named. Hidden ones only if asked.
 *   Most photos first (the renderer offers name order too).
 * people:get          { id } -> { id, name, hidden, photoCount } | null
 * people:get-for-item { itemId } -> [{ faceId, personId, name, box: [x, y, w, h], crop }]
 *   Recognised people in one photo (assigned faces only), left to right. crop is
 *   this face's crop from this photo, or null while it is being made (ask again).
 * people:get-covers   { ids: number[] } -> { [personId]: string | null }
 *   Crop path, or null while it is being made (ask again shortly).
 * people:get-clusters { id } -> [{ clusterId, faceCount, faces: [{ faceId, crop }] }]
 *   A person's groups of very alike faces, largest first, up to 8 samples each.
 *
 * M10.7 corrections (database only; each asks the face worker to regroup):
 * people:rename        { id, name, force? } -> { ok: true } | { ok: false, sameNameId }
 * people:merge         { targetId, sourceIds } -> { ok, targetId }
 * people:set-hidden    { id, hidden } -> { ok }
 * people:remove-item   { personId, itemId } -> { ok, removed }   ('not this person')
 * people:remove-cluster { personId, clusterId } -> { ok, newPersonId }
 * people:remove-face   { personId, faceId } -> { ok, removed }   (one face, Faces view)
 * people:add-cluster    { personId, clusterId } -> { ok }   (Review: Yes)
 * people:reject-cluster { personId, clusterId } -> { ok }   (Review: No)
 * people:set-key-photo  { personId, itemId } -> { ok, faceId }   (Make Key Photo)
 * people:get-cluster-faces { clusterId } -> [{ faceId, itemId }]   every face of one group, clearest first
 * people:get-enabled   {} -> { enabled }   (M10.8: View > People, from config.json)
 * people:list-groups   {} -> [{ ids, names, photoCount, coverItemId }]   (Groups / \u5408\u7167)
 *   2-4 named people together in >= 5 photos; bigger then more frequent first, max 20;
 *   cover = newest photo with everyone. Open one with the filter group:<ids ascending>.
 * people:get-suggestions { id } -> [{ clusterId, faceCount, similarity, faces: [{ faceId, crop }] }]
 *   Groups of unnamed, unlocked people (never a named person's) not rejected for
 *   this person: closest group >= 0.40 AND whole person >= 0.38; most similar first, max 30.
 *
 * M10.7 Faces view (read):
 * people:get-faces      { id } -> [{ faceId, itemId, clusterId, box: [x, y, w, h] }]   newest photo first
 * people:get-face-crops { faceIds } -> { [faceId]: string | null }   up to 100 per call
 */

const db = require('../../index/db');
const faceManager = require('../../faces/face-manager');
const { getCoverPaths, getFaceCropPaths } = require('../../people/face-crops');
const edits = require('../../people/people-edits');

const SHOW_MIN_PHOTOS = 5;
const ADD_MIN_PHOTOS = 2; // Add People lists unnamed people with at least this many photos
const VISIBLE = 'i.is_deleted = 0 AND i.is_live_photo_component = 0 AND i.is_edit_variant = 0 AND (i.burst_id IS NULL OR i.is_burst_cover = 1)';
const PHOTO_COUNTS = `SELECT f.person_id AS id, COUNT(DISTINCT f.item_id) AS n
  FROM faces f JOIN items i ON i.id = f.item_id WHERE f.person_id IS NOT NULL AND ${VISIBLE} GROUP BY f.person_id`;

const asId = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

async function list(event, payload = {}) {
  // M10.7 (Apple's model): 'named' = the People page (custom order, then most photos);
  // 'unnamed' = the Add People screen (ADD_MIN_PHOTOS+ photos, most photos first).
  const scope = payload && payload.scope === 'unnamed' ? 'unnamed' : 'named';
  const where = scope === 'named' ? 'p.name IS NOT NULL' : 'p.name IS NULL AND c.n >= ' + ADD_MIN_PHOTOS;
  const order = scope === 'named' ? 'p.sort_order IS NULL, p.sort_order, c.n DESC, p.id' : 'c.n DESC, p.id';
  const rows = db.get().prepare(`
    SELECT p.id, p.name, p.is_hidden AS hidden, c.n AS photoCount
    FROM people p JOIN (${PHOTO_COUNTS}) c ON c.id = p.id
    WHERE ${where}
    ORDER BY ${order}`).all();
  const s = faceManager.getStatus();
  return {
    people: rows.map((r) => ({ id: r.id, name: r.name, photoCount: r.photoCount, hidden: r.hidden === 1 })),
    analysis: { state: s.state, done: s.done + s.failed, total: s.total },
  };
}

async function get(event, payload = {}) {
  const id = asId(payload && payload.id);
  if (id == null) throw new Error('people:get requires a positive integer id');
  const r = db.get().prepare(`
    SELECT p.id, p.name, p.is_hidden AS hidden,
      (SELECT COUNT(DISTINCT f.item_id) FROM faces f JOIN items i ON i.id = f.item_id WHERE f.person_id = p.id AND ${VISIBLE}) AS photoCount
    FROM people p WHERE p.id = ?`).get(id);
  return r ? { id: r.id, name: r.name, hidden: r.hidden === 1, photoCount: r.photoCount } : null;
}

async function getForItem(event, payload = {}) {
  const itemId = asId(payload && payload.itemId);
  if (itemId == null) throw new Error('people:get-for-item requires a positive integer itemId');
  const rows = db.get().prepare(`
    SELECT f.id AS faceId, f.person_id AS personId, p.name, f.box_x, f.box_y, f.box_w, f.box_h
    FROM faces f JOIN people p ON p.id = f.person_id
    WHERE f.item_id = ? AND p.is_hidden = 0 ORDER BY f.box_x`).all(itemId)
    .map((r) => ({ faceId: r.faceId, personId: r.personId, name: r.name, box: [r.box_x, r.box_y, r.box_w, r.box_h] }));
  const crops = getFaceCropPaths(rows.map((r) => r.faceId));
  return rows.map((r) => Object.assign(r, { crop: crops[r.faceId] || null }));
}

async function getCovers(event, payload = {}) {
  const ids = Array.isArray(payload && payload.ids) ? payload.ids.filter((v) => asId(v) != null) : [];
  return getCoverPaths(ids);
}

async function getClusters(event, payload = {}) {
  const id = asId(payload && payload.id);
  if (id == null) throw new Error('people:get-clusters requires a positive integer id');
  const conn = db.get();
  const clusters = conn.prepare(`SELECT c.id, COUNT(f.id) AS n FROM face_clusters c
    JOIN faces f ON f.cluster_id = c.id JOIN items i ON i.id = f.item_id
    WHERE c.person_id = ? AND ${VISIBLE} GROUP BY c.id ORDER BY n DESC, c.id`).all(id);
  const sample = conn.prepare(`SELECT f.id, f.item_id, f.box_x, f.box_y, f.box_w, f.box_h FROM faces f JOIN items i ON i.id = f.item_id
    WHERE f.cluster_id = ? AND ${VISIBLE} ORDER BY f.can_seed DESC, f.score * f.size_px DESC LIMIT 8`);
  const out = clusters.map((c) => ({ clusterId: c.id, faceCount: c.n, faces: sample.all(c.id).map((r) => ({ faceId: r.id, itemId: r.item_id, box: [r.box_x, r.box_y, r.box_w, r.box_h] })) }));
  const crops = getFaceCropPaths(out.flatMap((c) => c.faces.map((x) => x.faceId)));
  for (const c of out) for (const x of c.faces) x.crop = crops[x.faceId] || null;
  return out;
}

async function getFaces(event, payload = {}) {
  const id = asId(payload && payload.id);
  if (id == null) throw new Error('people:get-faces requires a positive integer id');
  return db.get().prepare(`SELECT f.id AS faceId, f.item_id AS itemId, f.cluster_id AS clusterId,
      f.box_x, f.box_y, f.box_w, f.box_h
    FROM faces f JOIN items i ON i.id = f.item_id
    WHERE f.person_id = ? AND ${VISIBLE} ORDER BY i.capture_sort DESC, i.id DESC, f.box_x`).all(id)
    .map((r) => ({ faceId: r.faceId, itemId: r.itemId, clusterId: r.clusterId, box: [r.box_x, r.box_y, r.box_w, r.box_h] }));
}

async function getFaceCrops(event, payload = {}) {
  const ids = Array.isArray(payload && payload.faceIds) ? payload.faceIds.filter((v) => asId(v) != null) : [];
  return getFaceCropPaths(ids.slice(0, 100));
}

async function getClusterFaces(event, payload = {}) {
  const cid = asId(payload && payload.clusterId);
  if (cid == null) throw new Error('people:get-cluster-faces requires a positive integer clusterId');
  return db.get().prepare(`SELECT f.id AS faceId, f.item_id AS itemId, f.box_x, f.box_y, f.box_w, f.box_h
    FROM faces f JOIN items i ON i.id = f.item_id
    WHERE f.cluster_id = ? AND ${VISIBLE} ORDER BY f.can_seed DESC, f.score * f.size_px DESC`).all(cid)
    .map((r) => ({ faceId: r.faceId, itemId: r.itemId, box: [r.box_x, r.box_y, r.box_w, r.box_h] }));
}

const GROUP_MIN_PHOTOS = 5;
const GROUP_MAX = 20;
const GROUP_PEOPLE_PER_PHOTO = 8; // caps the combinations one crowded photo can add
async function listGroups() {
  const conn = db.get();
  const rows = conn.prepare(`SELECT f.item_id AS item, f.person_id AS pid FROM faces f
    JOIN items i ON i.id = f.item_id JOIN people p ON p.id = f.person_id
    WHERE p.name IS NOT NULL AND ${VISIBLE} ORDER BY i.capture_sort DESC, i.id DESC`).all();
  const byItem = new Map(); // insertion order = newest photo first
  for (const r of rows) { if (byItem.has(r.item) === false) byItem.set(r.item, new Set()); byItem.get(r.item).add(r.pid); }
  const combos = new Map(); // 'a,b,c' -> { ids, n, cover }
  for (const [item, set] of byItem) {
    const ids = [...set].sort((a, b) => a - b).slice(0, GROUP_PEOPLE_PER_PHOTO);
    if (ids.length < 2) continue;
    for (let mask = 1; mask < (1 << ids.length); mask++) {
      const pick = ids.filter((_, i) => (mask >> i) & 1);
      if (pick.length < 2 || pick.length > 4) continue;
      const key = pick.join(',');
      const c = combos.get(key) || { ids: pick, n: 0, cover: item };
      c.n += 1;
      combos.set(key, c);
    }
  }
  let kept = [...combos.values()].filter((c) => c.n >= GROUP_MIN_PHOTOS);
  // A smaller group with the same photos as a larger group containing it adds nothing.
  kept = kept.filter((c) => kept.some((o) => o.ids.length > c.ids.length && o.n === c.n && c.ids.every((id) => o.ids.includes(id))) === false);
  kept.sort((a, b) => b.ids.length - a.ids.length || b.n - a.n);
  const names = new Map(conn.prepare('SELECT id, name FROM people WHERE name IS NOT NULL').all().map((r) => [r.id, r.name]));
  return kept.slice(0, GROUP_MAX).map((c) => ({ ids: c.ids, names: c.ids.map((id) => names.get(id) || ''), photoCount: c.n, coverItemId: c.cover }));
}

// M10.9: only near-misses are suggested: close to one of the person's groups (the automatic
// bar) AND close to the person as a whole (just below the automatic 0.45).
const SUGGEST_LINK = 0.40;
const SUGGEST_WHOLE = 0.38;
const SUGGEST_MAX = 30;
async function getSuggestions(event, payload = {}) {
  const id = asId(payload && payload.id);
  if (id == null) throw new Error('people:get-suggestions requires a positive integer id');
  const conn = db.get();
  const vec = (b) => { const v = new Float32Array(128); Buffer.from(v.buffer).set(b.subarray(0, 512)); return v; };
  const dot = (a, b) => { let t = 0; for (let i = 0; i < 128; i++) t += a[i] * b[i]; return t; };
  const refs = conn.prepare('SELECT centroid AS v FROM face_clusters WHERE person_id = ? AND centroid IS NOT NULL').all(id)
    .concat(conn.prepare('SELECT vector AS v FROM person_refs WHERE person_id = ?').all(id))
    .concat(conn.prepare('SELECT centroid AS v FROM people WHERE id = ? AND centroid IS NOT NULL').all(id))
    .map((r) => vec(r.v));
  if (refs.length === 0) return [];
  const cands = conn.prepare(`SELECT c.id, c.centroid FROM face_clusters c LEFT JOIN people o ON o.id = c.person_id
    WHERE c.centroid IS NOT NULL AND (c.person_id IS NULL OR (c.person_id <> ? AND o.name IS NULL AND o.is_locked = 0))
      AND c.id NOT IN (SELECT cluster_id FROM cluster_rejections WHERE person_id = ?)`).all(id, id);
  const scored = [];
  const wholeRow = conn.prepare('SELECT centroid FROM people WHERE id = ? AND centroid IS NOT NULL').get(id);
  const whole = wholeRow ? vec(wholeRow.centroid) : null;
  for (const c of cands) {
    const v = vec(c.centroid);
    let link = -1;
    for (const r of refs) link = Math.max(link, dot(v, r));
    const w = whole ? dot(v, whole) : link;
    if (link >= SUGGEST_LINK && w >= SUGGEST_WHOLE) scored.push({ clusterId: c.id, similarity: w });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  const count = conn.prepare(`SELECT COUNT(*) AS n FROM faces f JOIN items i ON i.id = f.item_id WHERE f.cluster_id = ? AND ${VISIBLE}`);
  const sample = conn.prepare(`SELECT f.id, f.item_id, f.box_x, f.box_y, f.box_w, f.box_h FROM faces f JOIN items i ON i.id = f.item_id
    WHERE f.cluster_id = ? AND ${VISIBLE} ORDER BY f.can_seed DESC, f.score * f.size_px DESC LIMIT 6`);
  const out = [];
  for (const c of scored) {
    if (out.length >= SUGGEST_MAX) break;
    const n = count.get(c.clusterId).n;
    if (n === 0) continue;
    out.push({ clusterId: c.clusterId, faceCount: n, similarity: Math.round(c.similarity * 1000) / 1000,
      faces: sample.all(c.clusterId).map((r) => ({ faceId: r.id, itemId: r.item_id, box: [r.box_x, r.box_y, r.box_w, r.box_h] })) });
  }
  const crops = getFaceCropPaths(out.flatMap((c) => c.faces.map((x) => x.faceId)));
  for (const c of out) for (const x of c.faces) x.crop = crops[x.faceId] || null;
  return out;
}

/** Runs a correction, then asks the face worker to regroup around it. */
function write(fn) {
  return async (event, payload = {}) => {
    const result = fn(payload || {});
    faceManager.regroup();
    return result;
  };
}

module.exports = [
  { channel: 'people:get-clusters', handle: getClusters },
  { channel: 'people:get-faces', handle: getFaces },
  { channel: 'people:get-suggestions', handle: getSuggestions },
  { channel: 'people:get-cluster-faces', handle: getClusterFaces },
  { channel: 'people:list-groups', handle: listGroups },
  { channel: 'people:get-enabled', handle: async () => ({ enabled: require('../../people/people-privacy').isEnabled() }) },
  { channel: 'people:add-cluster', handle: write((p) => edits.addCluster(p.personId, p.clusterId)) },
  { channel: 'people:reject-cluster', handle: write((p) => edits.rejectCluster(p.personId, p.clusterId)) },
  // Grouping is unchanged by a key photo, so no regroup (which would reload open grids).
  { channel: 'people:set-key-photo', handle: async (event, p = {}) => edits.setKeyPhoto((p || {}).personId, (p || {}).itemId) },
  { channel: 'people:unname', handle: write((p) => edits.unname(p.id)) }, // Hide: back to Add People
  { channel: 'people:set-order', handle: async (event, p = {}) => edits.setOrder((p || {}).ids) }, // Custom Order; no regroup
  { channel: 'people:get-face-crops', handle: getFaceCrops },
  { channel: 'people:remove-face', handle: write((p) => edits.removeFaceById(p.personId, p.faceId)) },
  { channel: 'people:rename', handle: write((p) => edits.rename(p.id, p.name, p.force === true)) },
  { channel: 'people:merge', handle: write((p) => edits.merge(p.targetId, p.sourceIds)) },
  { channel: 'people:set-hidden', handle: write((p) => edits.setHidden(p.id, p.hidden === true)) },
  { channel: 'people:remove-item', handle: write((p) => edits.removeFace(p.personId, p.itemId)) },
  { channel: 'people:remove-cluster', handle: write((p) => edits.removeCluster(p.personId, p.clusterId)) },
  { channel: 'people:list', handle: list },
  { channel: 'people:get', handle: get },
  { channel: 'people:get-for-item', handle: getForItem },
  { channel: 'people:get-covers', handle: getCovers },
];
