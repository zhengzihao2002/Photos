/**
 * video-turns.js
 *
 * Manual turn points for a video whose camera was rotated while recording. Database only: never a
 * write to the video. A point { at, turn } means "from `at` seconds on, show the video turned
 * `turn` degrees clockwise" (on top of the item's own rotation); the last point at or before the
 * playback time wins, and before the first point the turn is 0.
 */

const ALLOWED_TURNS = new Set([0, 90, 180, 270]);
const MAX_POINTS = 200;
const MAX_SECONDS = 24 * 3600;

function listTurns(db, itemId) {
  return db.prepare('SELECT at, turn FROM video_turns WHERE item_id = ? ORDER BY at').all(itemId);
}

/** turn === null removes the point at that time. */
function setTurn(db, { id, at, turn }) {
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid item');
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > MAX_SECONDS) throw new Error('Invalid time');
  if (turn !== null && !ALLOWED_TURNS.has(turn)) throw new Error('Invalid turn');
  // Snap backwards so the point already applies to the frame where the user paused.
  const when = Math.floor(at * 10) / 10;
  const run = db.transaction(() => {
    const item = db.prepare("SELECT media_type FROM items WHERE id = ? AND is_deleted = 0").get(id);
    if (!item || item.media_type !== 'video') return listTurns(db, id);
    if (turn === null) {
      db.prepare('DELETE FROM video_turns WHERE item_id = ? AND at = ?').run(id, when);
    } else {
      const n = db.prepare('SELECT COUNT(*) AS n FROM video_turns WHERE item_id = ?').get(id).n;
      const exists = db.prepare('SELECT 1 FROM video_turns WHERE item_id = ? AND at = ?').get(id, when);
      if (n >= MAX_POINTS && !exists) throw new Error('Too many turn points');
      db.prepare('INSERT INTO video_turns (item_id, at, turn) VALUES (?, ?, ?) ON CONFLICT(item_id, at) DO UPDATE SET turn = excluded.turn').run(id, when, turn);
    }
    return listTurns(db, id);
  });
  return run();
}

function clearTurns(db, id) {
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid item');
  db.prepare('DELETE FROM video_turns WHERE item_id = ?').run(id);
  return [];
}

/** The turn in force at `time` seconds, given points sorted by `at`. */
function turnAt(points, time) {
  let turn = 0;
  for (const p of points) { if (p.at <= time + 0.0001) turn = p.turn; else break; }
  return turn;
}

module.exports = { listTurns, setTurn, clearTurns, turnAt };
