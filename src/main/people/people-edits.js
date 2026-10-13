/**
 * people-edits.js  (M10.7)
 *
 * User corrections. Each is ONE transaction on this app's database only (no
 * photo file is ever touched) and bumps _meta.people_edit_seq, so a people
 * pass running at the same moment discards its stale result. Corrections
 * survive later passes: named / merged / corrected people are locked,
 * user-placed clusters never move, rejections are never crossed.
 */

const db = require('../index/db');

const MAX_NAME = 100;
const asId = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

function need(v, what) {
  const id = asId(v);
  if (id == null) throw new Error(what + ' must be a positive integer');
  return id;
}

function bump(conn) {
  conn.prepare(`INSERT INTO _meta (key, value) VALUES ('people_edit_seq', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`).run();
}

function personExists(conn, id) {
  return conn.prepare('SELECT 1 FROM people WHERE id = ?').get(id) != null;
}

/** Sets or clears a name. Returns { ok: false, sameNameId } if another person has it (unless force). */
function rename(id, name, force) {
  const pid = need(id, 'id');
  const clean = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  const conn = db.get();
  return conn.transaction(() => {
    if (personExists(conn, pid) === false) throw new Error('No such person');
    if (clean && force !== true) {
      const other = conn.prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE AND id <> ?').get(clean, pid);
      if (other) return { ok: false, sameNameId: other.id };
    }
    conn.prepare('UPDATE people SET name = ?, is_locked = CASE WHEN ? IS NULL THEN is_locked ELSE 1 END, updated_at = ? WHERE id = ?')
      .run(clean || null, clean || null, Date.now(), pid);
    bump(conn);
    return { ok: true };
  })();
}

/** Moves everything from sourceIds into targetId and deletes the sources. */
function merge(targetId, sourceIds) {
  const target = need(targetId, 'targetId');
  const sources = [...new Set((Array.isArray(sourceIds) ? sourceIds : []).map(asId).filter((v) => v != null && v !== target))];
  if (sources.length === 0) throw new Error('Nothing to merge');
  const conn = db.get();
  return conn.transaction(() => {
    if (personExists(conn, target) === false) throw new Error('No such person');
    const now = Date.now();
    let named = conn.prepare('SELECT name FROM people WHERE id = ?').get(target).name;
    for (const src of sources) {
      const row = conn.prepare('SELECT name FROM people WHERE id = ?').get(src);
      if (row == null) continue;
      if (named == null && row.name) named = row.name;
      conn.prepare('UPDATE face_clusters SET person_id = ?, updated_at = ? WHERE person_id = ?').run(target, now, src);
      conn.prepare('UPDATE faces SET person_id = ? WHERE person_id = ?').run(target, src);
      conn.prepare('UPDATE person_refs SET person_id = ? WHERE person_id = ?').run(target, src);
      conn.prepare('DELETE FROM people WHERE id = ?').run(src);
    }
    // Rejections against the target that now contradict its own clusters are dropped.
    conn.prepare('DELETE FROM cluster_rejections WHERE person_id = ? AND cluster_id IN (SELECT id FROM face_clusters WHERE person_id = ?)').run(target, target);
    // An explicit merge wins over an earlier 'not this person' for the faces it brings back.
    conn.prepare('DELETE FROM face_rejections WHERE person_id = ? AND face_id IN (SELECT id FROM faces WHERE person_id = ?)').run(target, target);
    conn.prepare('UPDATE people SET name = ?, is_locked = 1, updated_at = ? WHERE id = ?').run(named, now, target);
    bump(conn);
    return { ok: true, targetId: target };
  })();
}

function setHidden(id, hidden) {
  const pid = need(id, 'id');
  const conn = db.get();
  return conn.transaction(() => {
    if (personExists(conn, pid) === false) throw new Error('No such person');
    conn.prepare('UPDATE people SET is_hidden = ?, updated_at = ? WHERE id = ?').run(hidden ? 1 : 0, Date.now(), pid);
    bump(conn);
    return { ok: true };
  })();
}

/** "Not this person" for one photo: unassigns that person's faces in it and remembers the rejection. */
function removeFace(personId, itemId) {
  const pid = need(personId, 'personId');
  const iid = need(itemId, 'itemId');
  const conn = db.get();
  return conn.transaction(() => {
    const faces = conn.prepare('SELECT id FROM faces WHERE item_id = ? AND person_id = ?').all(iid, pid);
    if (faces.length === 0) return { ok: true, removed: 0 };
    const rej = conn.prepare('INSERT OR IGNORE INTO face_rejections (face_id, person_id) VALUES (?, ?)');
    const clear = conn.prepare('UPDATE faces SET person_id = NULL, cluster_id = NULL, assignment = NULL WHERE id = ?');
    for (const f of faces) { rej.run(f.id, pid); clear.run(f.id); }
    conn.prepare('UPDATE people SET is_locked = 1, updated_at = ? WHERE id = ?').run(Date.now(), pid);
    bump(conn);
    return { ok: true, removed: faces.length };
  })();
}

/** M10.7 Faces view: rejects ONE face (more precise than removeFace, which takes the whole photo). */
function removeFaceById(personId, faceId) {
  const pid = need(personId, 'personId');
  const fid = need(faceId, 'faceId');
  const conn = db.get();
  return conn.transaction(() => {
    const f = conn.prepare('SELECT person_id FROM faces WHERE id = ?').get(fid);
    if (f == null || f.person_id !== pid) throw new Error('That face does not belong to this person');
    conn.prepare('INSERT OR IGNORE INTO face_rejections (face_id, person_id) VALUES (?, ?)').run(fid, pid);
    conn.prepare('UPDATE faces SET person_id = NULL, cluster_id = NULL, assignment = NULL WHERE id = ?').run(fid);
    conn.prepare('UPDATE people SET is_locked = 1, updated_at = ? WHERE id = ?').run(Date.now(), pid);
    bump(conn);
    return { ok: true, removed: 1 };
  })();
}

/** M10.7 Hide (Apple's model): back to the unnamed people on Add People. Groups and corrections are kept. */
function unname(id) {
  const pid = need(id, 'id');
  const conn = db.get();
  return conn.transaction(() => {
    if (personExists(conn, pid) === false) throw new Error('No such person');
    conn.prepare('UPDATE people SET name = NULL, sort_order = NULL, is_hidden = 0, is_locked = 1, updated_at = ? WHERE id = ?').run(Date.now(), pid);
    bump(conn);
    return { ok: true };
  })();
}

/** M10.7 Custom Order: named people in the given order get positions 1, 2, 3... */
function setOrder(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(asId).filter((v) => v != null))];
  const conn = db.get();
  return conn.transaction(() => {
    const up = conn.prepare('UPDATE people SET sort_order = ?, updated_at = ? WHERE id = ? AND name IS NOT NULL');
    const now = Date.now();
    list.forEach((pid, i) => up.run(i + 1, now, pid));
    bump(conn);
    return { ok: true, count: list.length };
  })();
}

/** M10.7 Make Key Photo: this person's face in that photo becomes their cover, chosen by the user. */
function setKeyPhoto(personId, itemId) {
  const pid = need(personId, 'personId');
  const iid = need(itemId, 'itemId');
  const conn = db.get();
  return conn.transaction(() => {
    const face = conn.prepare('SELECT id FROM faces WHERE item_id = ? AND person_id = ? ORDER BY box_w * box_h DESC LIMIT 1').get(iid, pid);
    if (face == null) throw new Error('This person is not in that photo');
    conn.prepare('UPDATE people SET cover_face_id = ?, cover_is_user = 1, is_locked = 1, updated_at = ? WHERE id = ?').run(face.id, Date.now(), pid);
    bump(conn);
    return { ok: true, faceId: face.id };
  })();
}

/** M10.7 Review (Yes): adds a suggested group to a person, placed by the user. */
function addCluster(personId, clusterId) {
  const pid = need(personId, 'personId');
  const cid = need(clusterId, 'clusterId');
  const conn = db.get();
  return conn.transaction(() => {
    if (personExists(conn, pid) === false) throw new Error('No such person');
    const c = conn.prepare('SELECT person_id FROM face_clusters WHERE id = ?').get(cid);
    if (c == null) throw new Error('No such group');
    const from = c.person_id;
    if (from === pid) return { ok: true };
    if (from != null) {
      const owner = conn.prepare('SELECT name, is_locked FROM people WHERE id = ?').get(from);
      if (owner && (owner.name != null || owner.is_locked === 1)) throw new Error('That group belongs to another named person');
    }
    const now = Date.now();
    conn.prepare('UPDATE face_clusters SET person_id = ?, is_user = 1, updated_at = ? WHERE id = ?').run(pid, now, cid);
    conn.prepare('UPDATE faces SET person_id = ? WHERE cluster_id = ?').run(pid, cid);
    conn.prepare('DELETE FROM cluster_rejections WHERE cluster_id = ? AND person_id = ?').run(cid, pid);
    conn.prepare('DELETE FROM face_rejections WHERE person_id = ? AND face_id IN (SELECT id FROM faces WHERE cluster_id = ?)').run(pid, cid);
    conn.prepare('UPDATE people SET is_locked = 1, updated_at = ? WHERE id = ?').run(now, pid);
    if (from != null) {
      const left = conn.prepare('SELECT COUNT(*) AS n FROM face_clusters WHERE person_id = ?').get(from).n;
      if (left === 0) conn.prepare('DELETE FROM people WHERE id = ? AND name IS NULL AND is_locked = 0').run(from);
    }
    bump(conn);
    return { ok: true };
  })();
}

/** M10.7 Review (No): this group is not this person; never suggest or add it again. */
function rejectCluster(personId, clusterId) {
  const pid = need(personId, 'personId');
  const cid = need(clusterId, 'clusterId');
  const conn = db.get();
  return conn.transaction(() => {
    if (personExists(conn, pid) === false) throw new Error('No such person');
    if (conn.prepare('SELECT 1 FROM face_clusters WHERE id = ?').get(cid) == null) throw new Error('No such group');
    conn.prepare('INSERT OR IGNORE INTO cluster_rejections (cluster_id, person_id) VALUES (?, ?)').run(cid, pid);
    bump(conn);
    return { ok: true };
  })();
}

/** Moves one cluster out of a person into a new person of its own, and remembers the rejection. */
function removeCluster(personId, clusterId) {
  const pid = need(personId, 'personId');
  const cid = need(clusterId, 'clusterId');
  const conn = db.get();
  return conn.transaction(() => {
    const c = conn.prepare('SELECT person_id FROM face_clusters WHERE id = ?').get(cid);
    if (c == null || c.person_id !== pid) throw new Error('That group does not belong to this person');
    const now = Date.now();
    const newId = Number(conn.prepare('INSERT INTO people (created_at, updated_at) VALUES (?, ?)').run(now, now).lastInsertRowid);
    conn.prepare('UPDATE face_clusters SET person_id = ?, is_user = 1, updated_at = ? WHERE id = ?').run(newId, now, cid);
    conn.prepare('UPDATE faces SET person_id = ? WHERE cluster_id = ?').run(newId, cid);
    conn.prepare('INSERT OR IGNORE INTO cluster_rejections (cluster_id, person_id) VALUES (?, ?)').run(cid, pid);
    conn.prepare('UPDATE people SET is_locked = 1, updated_at = ? WHERE id = ?').run(now, pid);
    bump(conn);
    return { ok: true, newPersonId: newId };
  })();
}

module.exports = { rename, merge, setHidden, removeFace, removeFaceById, removeCluster, addCluster, rejectCluster, setKeyPhoto, unname, setOrder };
