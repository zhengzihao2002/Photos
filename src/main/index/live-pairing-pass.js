/**
 * live-pairing-pass.js (M15.5)
 *
 * Post-scan pass; the only writer of is_live_photo, live_photo_video_item_id
 * and is_live_photo_component. Database only: never reads or writes a file.
 * Primary rule: same content_identifier within one source. Fallback: same
 * folder + same stem + short video, only when neither file has an identifier.
 * Ambiguity leaves files unpaired and visible. Un-pairing and pairing are the
 * same code path: the desired state is recomputed and differences are written.
 */
const path = require('path');

const FALLBACK_MAX_SECONDS = 5;
const NEAREST_MAX_GAP_SECONDS = 3;

const dirOf = (rel) => path.posix.dirname(rel);
function stemOf(rel) {
  const b = path.posix.basename(rel);
  const e = path.posix.extname(b);
  return (e ? b.slice(0, -e.length) : b);
}
const stemKey = (rel) => stemOf(rel).toLowerCase();
function epoch(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? null : t / 1000;
}

function nearestUnique(x, list) {
  const tx = epoch(x.capture_time_local);
  if (tx === null) return null;
  let best = null; let bestGap = Infinity; let tie = false;
  for (const y of list) {
    const ty = epoch(y.capture_time_local);
    if (ty === null) continue;
    const gap = Math.abs(tx - ty);
    if (gap < bestGap) { best = y; bestGap = gap; tie = false; } else if (gap === bestGap) tie = true;
  }
  return best && !tie && bestGap <= NEAREST_MAX_GAP_SECONDS ? best : null;
}

// stills and videos share one identifier. Returns [[still, video], ...].
function matchGroup(stills, videos) {
  const pairs = [];
  let S = stills.slice();
  let V = videos.slice();
  const take = (s, v) => { pairs.push([s, v]); S = S.filter((x) => x !== s); V = V.filter((x) => x !== v); };
  if (S.length === 1 && V.length === 1) { take(S[0], V[0]); return pairs; }

  for (const s of S.slice()) {
    const sameV = V.filter((v) => dirOf(v.relative_path) === dirOf(s.relative_path) && stemKey(v.relative_path) === stemKey(s.relative_path));
    const sameS = S.filter((x) => dirOf(x.relative_path) === dirOf(s.relative_path) && stemKey(x.relative_path) === stemKey(s.relative_path));
    if (sameV.length === 1 && sameS.length === 1) take(s, sameV[0]);
  }
  for (const d of new Set(S.map((s) => dirOf(s.relative_path)))) {
    const ss = S.filter((s) => dirOf(s.relative_path) === d);
    const vv = V.filter((v) => dirOf(v.relative_path) === d);
    if (ss.length === 1 && vv.length === 1) take(ss[0], vv[0]);
  }
  for (const s of S.slice()) {
    const v = nearestUnique(s, V);
    if (v && nearestUnique(v, S) === s) take(s, v);
  }
  return pairs;
}

const COLS = 'id, relative_path, media_type, capture_time_local, content_identifier, duration_seconds, is_live_photo, live_photo_video_item_id, is_live_photo_component, burst_id, is_burst_cover';

function runLivePairingPass(db, sourceFolderId) {
  const desired = new Map(); // still id -> video id

  // 1. identifier pairs
  const withId = db.prepare('SELECT ' + COLS + ' FROM items WHERE source_folder_id = ? AND is_deleted = 0 AND content_identifier IS NOT NULL').all(sourceFolderId);
  const groups = new Map();
  for (const r of withId) {
    let g = groups.get(r.content_identifier);
    if (!g) { g = { stills: [], videos: [] }; groups.set(r.content_identifier, g); }
    if (r.media_type === 'video') g.videos.push(r);
    else if (r.media_type === 'image' && (r.burst_id === null || r.is_burst_cover === 1)) g.stills.push(r);
  }
  for (const g of groups.values()) {
    if (g.stills.length === 0 || g.videos.length === 0) continue;
    for (const [s, v] of matchGroup(g.stills, g.videos)) desired.set(s.id, v.id);
  }

  // 2. stem fallback: neither file has an identifier
  const shortVideos = db.prepare(
    "SELECT id, relative_path FROM items WHERE source_folder_id = ? AND media_type = 'video' AND is_deleted = 0 "
    + 'AND content_identifier IS NULL AND duration_seconds IS NOT NULL AND duration_seconds <= ?'
  ).all(sourceFolderId, FALLBACK_MAX_SECONDS);
  const findStills = db.prepare(
    "SELECT id, burst_id, is_burst_cover FROM items WHERE source_folder_id = ? AND media_type = 'image' AND is_deleted = 0 "
    + 'AND content_identifier IS NULL AND relative_path >= ? AND relative_path < ?'
  );
  const claims = new Map();
  for (const v of shortVideos) {
    const dir = dirOf(v.relative_path);
    const prefix = (dir === '.' ? '' : dir + '/') + stemOf(v.relative_path);
    const cands = findStills.all(sourceFolderId, prefix + '.', prefix + '/')
      .filter((s) => s.burst_id === null || s.is_burst_cover === 1);
    if (cands.length !== 1) continue;
    claims.set(cands[0].id, (claims.get(cands[0].id) || []).concat(v.id));
  }
  for (const [stillId, vids] of claims) {
    if (vids.length === 1 && !desired.has(stillId)) desired.set(stillId, vids[0]);
  }

  // 3. write differences
  const desiredVideos = new Set(desired.values());
  const current = new Map(db.prepare(
    'SELECT id, is_live_photo, live_photo_video_item_id, is_live_photo_component FROM items '
    + 'WHERE source_folder_id = ? AND is_deleted = 0 AND (is_live_photo = 1 OR is_live_photo_component = 1 OR live_photo_video_item_id IS NOT NULL)'
  ).all(sourceFolderId).map((r) => [r.id, r]));
  const setStill = db.prepare('UPDATE items SET is_live_photo = ?, live_photo_video_item_id = ? WHERE id = ?');
  const setComp = db.prepare('UPDATE items SET is_live_photo_component = ? WHERE id = ?');
  const stateOf = db.prepare('SELECT id, is_live_photo, live_photo_video_item_id, is_live_photo_component FROM items WHERE id = ?');

  let changed = 0;
  db.transaction(() => {
    for (const [sid, vid] of desired) {
      const s = current.get(sid) || stateOf.get(sid);
      if (!s || s.is_live_photo !== 1 || s.live_photo_video_item_id !== vid) { setStill.run(1, vid, sid); changed += 1; }
      const v = current.get(vid) || stateOf.get(vid);
      if (!v || v.is_live_photo_component !== 1) { setComp.run(1, vid); changed += 1; }
    }
    for (const [id, r] of current) {
      if ((r.is_live_photo === 1 || r.live_photo_video_item_id !== null) && !desired.has(id)) { setStill.run(0, null, id); changed += 1; }
      if (r.is_live_photo_component === 1 && !desiredVideos.has(id)) { setComp.run(0, id); changed += 1; }
    }
  })();
  return { paired: desired.size, changed };
}

module.exports = { runLivePairingPass, matchGroup, FALLBACK_MAX_SECONDS };
