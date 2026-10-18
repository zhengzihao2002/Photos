/**
 * edit-history.js -- M12.9
 *
 * Session-only undo / redo for the database-only edits (favorite, title,
 * caption, keywords). Each action is wrapped: the affected rows' user state
 * is captured before and after, and undo/redo restores one side.
 * Actions touching more than MAX_ITEMS rows are not recorded.
 */

const { targetWhere } = require('./edits');

const MAX_STEPS = 20;
const MAX_ITEMS = 5000;
const undoStack = [];
let redoStack = [];

function capture(db, where) {
  const rows = db.prepare(
    'SELECT id, is_favorite, title_user, caption_user, keywords_user_owned FROM items WHERE id IN (SELECT id FROM items WHERE ' + where + ') LIMIT ' + (MAX_ITEMS + 1)
  ).all();
  if (rows.length > MAX_ITEMS) return null;
  const kw = db.prepare('SELECT k.name AS name FROM item_keywords ik JOIN keywords k ON k.id = ik.keyword_id WHERE ik.item_id = ? AND ik.origin = 1');
  return rows.map((r) => Object.assign({}, r, { keywords: kw.all(r.id).map((x) => x.name) }));
}

function restore(db, snapshot) {
  const upd = db.prepare('UPDATE items SET is_favorite = @is_favorite, title_user = @title_user, caption_user = @caption_user, keywords_user_owned = @keywords_user_owned WHERE id = @id');
  const del = db.prepare('DELETE FROM item_keywords WHERE item_id = ? AND origin = 1');
  const insK = db.prepare('INSERT OR IGNORE INTO keywords (name) VALUES (?)');
  const getK = db.prepare('SELECT id FROM keywords WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO item_keywords (item_id, keyword_id, origin) VALUES (?, ?, 1)');
  db.transaction(() => {
    for (const r of snapshot) {
      upd.run(r);
      del.run(r.id);
      for (const name of r.keywords) { insK.run(name); link.run(r.id, getK.get(name).id); }
    }
    db.prepare('DELETE FROM keywords WHERE id NOT IN (SELECT DISTINCT keyword_id FROM item_keywords)').run();
  })();
}

/** Runs fn (an edit function returning { changed }) and records it for undo. */
function recorded(db, target, fn) {
  let before = null;
  try { before = capture(db, targetWhere(target)); } catch (err) { before = null; }
  const result = fn();
  if (before && result && result.changed > 0) {
    const ids = before.map((r) => r.id);
    const after = capture(db, 'id IN (' + ids.join(',') + ')');
    if (after) {
      undoStack.push({ before, after });
      if (undoStack.length > MAX_STEPS) undoStack.shift();
      redoStack = [];
    }
  }
  return result;
}

function undo(db) {
  const e = undoStack.pop();
  if (!e) return { applied: false };
  restore(db, e.before);
  redoStack.push(e);
  return { applied: true };
}

function redo(db) {
  const e = redoStack.pop();
  if (!e) return { applied: false };
  restore(db, e.after);
  undoStack.push(e);
  return { applied: true };
}

function clear() { undoStack.length = 0; redoStack = []; }

module.exports = { recorded, undo, redo, clear };
