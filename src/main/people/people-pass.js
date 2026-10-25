/**
 * people-pass.js  (M10.5)  Two-level clustering, database only.
 *
 * Level 1: faces -> clusters of very alike faces (centroid similarity).
 * Level 2: clusters -> people (closest-cluster similarity, with a margin),
 *          then one consolidation sweep over people.
 * User corrections always win: user-placed clusters (is_user) and user faces
 * (assignment 'user') never move, locked people only gain clusters, and
 * cluster/face rejections are never crossed. faces.person_id mirrors its
 * cluster's person. Raising CLUSTER_VERSION re-clusters everything automatic once.
 */

// 3 = adds the whole-person check (M10.6), which stops one person chaining into a crowd.
const CLUSTER_VERSION = 3;
const PARAMS = { cluster: 0.55, clusterWeak: 0.60, assign: 0.40, margin: 0.05, merge: 0.50, whole: 0.45 };
const DIM = 128;
const VISIBLE = 'i.is_deleted = 0 AND i.is_live_photo_component = 0 AND i.is_edit_variant = 0 AND (i.burst_id IS NULL OR i.is_burst_cover = 1)';

function toVec(buf) { const v = new Float32Array(DIM); Buffer.from(v.buffer).set(buf.subarray(0, DIM * 4)); return v; }
function dot(a, b) { let s = 0; for (let i = 0; i < DIM; i++) s += a[i] * b[i]; return s; }
function unit(sum) { let n = 0; for (let i = 0; i < DIM; i++) n += sum[i] * sum[i]; n = Math.sqrt(n) || 1; const u = new Float32Array(DIM); for (let i = 0; i < DIM; i++) u[i] = sum[i] / n; return u; }
const blob = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength);
const quality = (f) => f.can_seed * 1e6 + f.score * f.size_px;
const setMap = (rows, k, v) => { const m = new Map(); for (const r of rows) { if (m.has(r[k]) === false) m.set(r[k], new Set()); m.get(r[k]).add(r[v]); } return m; };

function runPeoplePass(db, opts = {}) {
  const t0 = Date.now();
  const meta = db.prepare("SELECT value FROM _meta WHERE key = 'people_cluster_version'").get();
  const recluster = opts.recluster === true || Number(meta ? meta.value : 0) !== CLUSTER_VERSION;
  // User corrections bump people_edit_seq; if it moves while we work, our snapshot is stale and nothing is written.
  const editSeq = () => { const r = db.prepare("SELECT value FROM _meta WHERE key = 'people_edit_seq'").get(); return r ? r.value : '0'; };
  const seqAtStart = editSeq();
  const faces = db.prepare(`SELECT f.id, f.embedding, f.can_seed, f.score, f.size_px, f.person_id, f.assignment, f.cluster_id
    FROM faces f JOIN items i ON i.id = f.item_id WHERE ${VISIBLE}`).all();
  const faceRej = setMap(db.prepare('SELECT face_id, person_id FROM face_rejections').all(), 'face_id', 'person_id');
  const clusterRej = setMap(db.prepare('SELECT cluster_id, person_id FROM cluster_rejections').all(), 'cluster_id', 'person_id');
  const people = new Map(), clusters = new Map();
  let temp = 0;
  const mkPerson = (r) => { const p = { id: r.id, name: r.name, locked: r.is_locked === 1, coverUser: r.cover_is_user === 1, cover: r.cover_face_id, clusters: new Set(), refs: [] }; people.set(p.id, p); return p; };
  const mkCluster = (r) => { const c = { id: r.id, person: r.person_id, user: r.is_user === 1, sum: new Float64Array(DIM), members: new Set(), cent: null }; clusters.set(c.id, c); return c; };
  for (const r of db.prepare('SELECT id, name, is_locked, cover_is_user, cover_face_id FROM people').all()) mkPerson(r);
  for (const r of db.prepare('SELECT id, person_id, is_user FROM face_clusters').all()) mkCluster(r);
  // Named people remember their looks (person_refs), so they can be matched again after their photos return.
  for (const r of db.prepare('SELECT person_id, vector FROM person_refs').all()) { const p = people.get(r.person_id); if (p) p.refs.push(toVec(r.vector)); }
  const join = (c, f) => { c.members.add(f.id); for (let i = 0; i < DIM; i++) c.sum[i] += f.vec[i]; c.cent = null; f.cluster = c.id; };
  const cent = (c) => (c.cent || (c.cent = unit(c.sum)));
  const byId = new Map();

  for (const f of faces) {
    f.vec = toVec(f.embedding); f.embedding = null; f.orig = [f.cluster_id, f.person_id, f.assignment]; byId.set(f.id, f);
    const c = f.cluster_id == null ? null : clusters.get(f.cluster_id);
    const keep = c && (recluster === false || c.user || f.assignment === 'user');
    if (keep) join(c, f); else f.cluster = null;
  }
  for (const c of clusters.values()) {
    const p = c.person == null ? null : people.get(c.person);
    if (p == null || (recluster && c.user === false && p.locked === false)) c.person = null; else p.clusters.add(c.id);
  }

  // Level 1: faces -> clusters
  for (const f of faces.filter((x) => x.cluster == null).sort((a, b) => quality(b) - quality(a))) {
    let best = null, bestS = -1;
    for (const c of clusters.values()) {
      if (c.members.size === 0) continue;
      if (c.person != null && faceRej.has(f.id) && faceRej.get(f.id).has(c.person)) continue;
      const s = dot(f.vec, cent(c)); if (s > bestS) { bestS = s; best = c; }
    }
    if (best && bestS >= (f.can_seed ? PARAMS.cluster : PARAMS.clusterWeak)) join(best, f);
    else if (f.can_seed) join(mkCluster({ id: 'c' + (temp++), person_id: null, is_user: 0 }), f);
  }

  // Similarity of a cluster to a person as a whole (all their faces), or to their stored references.
  const personSum = (p) => { const t = new Float64Array(DIM); for (const id of p.clusters) { const o = clusters.get(id); if (o.members.size) for (let i = 0; i < DIM; i++) t[i] += o.sum[i]; } return t; };
  const empty = (t) => { for (let i = 0; i < DIM; i++) if (t[i] !== 0) return false; return true; };
  const whole = (c, p) => { const t = personSum(p); if (empty(t) === false) return dot(cent(c), unit(t)); let b = -1; for (const r of p.refs) b = Math.max(b, dot(cent(c), r)); return b; };

  // People that gained a cluster this pass; consolidation only needs to look at them (M10.9).
  const touched = new Set();

  // Level 2: clusters -> people (closest cluster of each person)
  const link = (c, p) => { let s = -1; for (const id of p.clusters) { const o = clusters.get(id); if (o.members.size) s = Math.max(s, dot(cent(c), cent(o))); } for (const r of p.refs) s = Math.max(s, dot(cent(c), r)); return s; };
  for (const c of [...clusters.values()].filter((x) => x.person == null && x.members.size).sort((a, b) => b.members.size - a.members.size)) {
    let best = null, bestS = -1, second = -1;
    for (const p of people.values()) {
      if ((p.clusters.size === 0 && p.refs.length === 0) || (clusterRej.has(c.id) && clusterRej.get(c.id).has(p.id))) continue;
      const s = link(c, p); if (s > bestS) { second = bestS; bestS = s; best = p; } else if (s > second) second = s;
    }
    const p = (best && bestS >= PARAMS.assign && bestS - second >= PARAMS.margin && whole(c, best) >= PARAMS.whole) ? best : mkPerson({ id: 'p' + (temp++), name: null, is_locked: 0 });
    p.clusters.add(c.id); c.person = p.id;
    touched.add(p);
  }

  // Consolidation: one sweep, strongest pairs first, via union-find
  // M10.9 scaling: outside a full re-cluster only pairs with a touched person can be new
  // candidates; the cheap whole-person test runs before the cluster-by-cluster comparison.
  const live = [...people.values()].filter((p) => p.clusters.size);
  const wholeUnit = new Map(live.map((p) => [p.id, unit(personSum(p))]));
  const pairs = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a0 = live[i], b0 = live[j];
    if (recluster === false && touched.has(a0) === false && touched.has(b0) === false) continue;
    if (dot(wholeUnit.get(a0.id), wholeUnit.get(b0.id)) < PARAMS.whole) continue;
    let s = -1;
    for (const a of a0.clusters) for (const b of b0.clusters) s = Math.max(s, dot(cent(clusters.get(a)), cent(clusters.get(b))));
    if (s >= PARAMS.merge) pairs.push([s, a0, b0]);
  }
  const root = new Map(live.map((p) => [p.id, p]));
  const find = (p) => { let r = p; while (root.get(r.id) !== r) r = root.get(r.id); return r; };
  const rejects = (a, b) => { for (const id of a.clusters) { const r = clusterRej.get(id); if (r && r.has(b.id)) return true; } return false; };
  let merges = 0;
  for (const [, x, y] of pairs.sort((a, b) => b[0] - a[0])) {
    const a = find(x), b = find(y);
    if (a === b || (a.locked && b.locked) || rejects(a, b) || rejects(b, a)) continue;
    const [keep, gone] = (b.locked || (a.locked === false && b.clusters.size > a.clusters.size)) ? [b, a] : [a, b];
    for (const id of gone.clusters) { keep.clusters.add(id); clusters.get(id).person = keep.id; }
    gone.clusters.clear(); root.set(gone.id, keep); merges++;
  }

  // Face rejections win over cluster membership
  for (const f of faces) {
    const c = f.cluster == null ? null : clusters.get(f.cluster);
    if (c && c.person != null && faceRej.has(f.id) && faceRej.get(f.id).has(c.person)) { c.members.delete(f.id); f.cluster = null; }
  }

  const stats = { recluster, faces: faces.length, clusters: 0, people: 0, merges, unclustered: 0, ms: 0 };
  const now = Date.now();
  let stale = false;
  db.transaction(() => {
    if (editSeq() !== seqAtStart) { stale = true; return; }
    const insP = db.prepare('INSERT INTO people (created_at, updated_at) VALUES (?, ?)');
    for (const p of people.values()) if (typeof p.id === 'string' && p.clusters.size) {
      const id = Number(insP.run(now, now).lastInsertRowid);
      for (const cid of p.clusters) clusters.get(cid).person = id;
      p.id = id;
    }
    const insC = db.prepare('INSERT INTO face_clusters (person_id, centroid, created_at, updated_at) VALUES (?, ?, ?, ?)');
    const upC = db.prepare('UPDATE face_clusters SET person_id = ?, centroid = ?, updated_at = ? WHERE id = ?');
    const delC = db.prepare('DELETE FROM face_clusters WHERE id = ?');
    const finalC = new Map(); // final database id -> cluster (new clusters change id while saving)
    for (const c of clusters.values()) {
      if (c.members.size === 0) { if (typeof c.id === 'number') delC.run(c.id); continue; }
      stats.clusters++;
      if (typeof c.id === 'string') { const id = Number(insC.run(c.person, blob(cent(c)), now, now).lastInsertRowid); for (const fid of c.members) byId.get(fid).cluster = id; c.id = id; }
      else upC.run(c.person, blob(cent(c)), now, c.id);
      finalC.set(c.id, c);
    }
    const upF = db.prepare('UPDATE faces SET cluster_id = ?, person_id = ?, assignment = ? WHERE id = ?');
    for (const f of faces) {
      const c = f.cluster == null ? null : finalC.get(f.cluster);
      const person = c ? c.person : null;
      const assignment = person == null ? null : (f.assignment === 'user' ? 'user' : 'auto');
      if (person == null) stats.unclustered++;
      if (f.orig[0] !== f.cluster || f.orig[1] !== person || f.orig[2] !== assignment) upF.run(f.cluster, person, assignment, f.id);
    }
    const upP = db.prepare('UPDATE people SET centroid = ?, cover_face_id = ?, updated_at = ? WHERE id = ?');
    const delP = db.prepare('DELETE FROM people WHERE id = ?');
    for (const p of people.values()) {
      if (typeof p.id === 'string') continue;
      const members = [];
      for (const cid of p.clusters) for (const fid of clusters.get(cid).members) members.push(byId.get(fid));
      if (members.length === 0) { if (p.name == null && p.locked === false) delP.run(p.id); continue; }
      stats.people++;
      const sum = new Float64Array(DIM); for (const f of members) for (let i = 0; i < DIM; i++) sum[i] += f.vec[i];
      const cover = (p.coverUser && members.some((f) => f.id === p.cover)) ? p.cover : members.sort((a, b) => quality(b) - quality(a))[0].id;
      upP.run(blob(unit(sum)), cover, now, p.id);
    }
    // Refresh the memory of named or locked people from their largest clusters (keep it if they have none now).
    const delR = db.prepare('DELETE FROM person_refs WHERE person_id = ?');
    const insR = db.prepare('INSERT INTO person_refs (person_id, vector) VALUES (?, ?)');
    for (const p of people.values()) {
      if (typeof p.id === 'string' || (p.name == null && p.locked === false)) continue;
      const cs = [...p.clusters].map((id) => clusters.get(id)).filter((c) => c.members.size > 0)
        .sort((a, b) => b.members.size - a.members.size).slice(0, 20);
      if (cs.length === 0) continue;
      delR.run(p.id);
      for (const c of cs) insR.run(p.id, blob(cent(c)));
    }
    db.prepare('DELETE FROM person_refs WHERE person_id IN (SELECT id FROM people WHERE name IS NULL AND is_locked = 0)').run();
    db.prepare("INSERT INTO _meta (key, value) VALUES ('people_cluster_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(CLUSTER_VERSION));
  })();
  stats.ms = Date.now() - t0;
  if (stale) return { retry: true, ms: stats.ms };
  return stats;
}

module.exports = { runPeoplePass, PARAMS, CLUSTER_VERSION };
