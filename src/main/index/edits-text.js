/**
 * edits-text.js -- M12.4
 *
 * Database-only edits of title, caption and keywords (never any write to a
 * photo file). One transaction per user action. Targets are the same as in
 * edits.js: { filter } or { ids }.
 */

const { targetWhere } = require('./edits');

const TITLE_MAX = 255;
const CAPTION_MAX = 2000;
const KEYWORD_MAX = 64;
const KEYWORDS_PER_CALL = 100;
const KEYWORDS_PER_ITEM = 100;

function cleanUserText(value, max) {
  if (typeof value !== 'string') throw new Error('Invalid value');
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('');
}

function setUserText(db, column, { target, value }, max) {
  const text = cleanUserText(value, max);
  const where = targetWhere(target);
  const run = db.transaction(() => db.prepare(
    'UPDATE items SET ' + column + ' = @v WHERE id IN (SELECT id FROM items WHERE ' + where + ') AND ' + column + ' IS NOT @v'
  ).run({ v: text }));
  return { changed: run().changes };
}

/** The user's value always wins over the file's; '' = cleared on purpose. */
function setTitle(db, args) { return setUserText(db, 'title_user', args, TITLE_MAX); }
function setCaption(db, args) { return setUserText(db, 'caption_user', args, CAPTION_MAX); }

function cleanKeywordList(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > KEYWORDS_PER_CALL) throw new Error('Invalid keywords');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') throw new Error('Invalid keywords');
    const k = Array.from(raw.replace(/\s+/g, ' ').trim()).slice(0, KEYWORD_MAX).join('');
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

/** Adds and removes keywords on every target item. The first edit of an item copies its file keywords. */
function updateKeywords(db, { target, add, remove }) {
  const toAdd = cleanKeywordList(add);
  const toRemove = cleanKeywordList(remove);
  if (toAdd.length === 0 && toRemove.length === 0) return { changed: 0 };
  const where = targetWhere(target);
  const run = db.transaction(() => {
    const ids = db.prepare('SELECT id FROM items WHERE ' + where).all().map((r) => r.id);
    const adopt = db.prepare('INSERT OR IGNORE INTO item_keywords (item_id, keyword_id, origin) SELECT item_id, keyword_id, 1 FROM item_keywords WHERE item_id = ? AND origin = 0');
    const markOwned = db.prepare('UPDATE items SET keywords_user_owned = 1 WHERE id = ? AND keywords_user_owned = 0');
    const insKeyword = db.prepare('INSERT OR IGNORE INTO keywords (name) VALUES (?)');
    const getKeyword = db.prepare('SELECT id FROM keywords WHERE name = ?');
    const insLink = db.prepare('INSERT OR IGNORE INTO item_keywords (item_id, keyword_id, origin) VALUES (?, ?, 1)');
    const delLink = db.prepare('DELETE FROM item_keywords WHERE item_id = ? AND origin = 1 AND keyword_id = ?');
    const countFor = db.prepare('SELECT COUNT(*) AS n FROM item_keywords WHERE item_id = ? AND origin = 1');
    const addIds = toAdd.map((name) => { insKeyword.run(name); return getKeyword.get(name).id; });
    const removeIds = toRemove.map((name) => { const r = getKeyword.get(name); return r ? r.id : null; }).filter((x) => x !== null);
    let changed = 0;
    for (const id of ids) {
      let touched = 0;
      const owned = markOwned.run(id).changes;
      if (owned) adopt.run(id);
      for (const kid of removeIds) touched += delLink.run(id, kid).changes;
      for (const kid of addIds) {
        if (countFor.get(id).n >= KEYWORDS_PER_ITEM) break;
        touched += insLink.run(id, kid).changes;
      }
      if (touched > 0 || owned) changed += 1;
    }
    db.prepare('DELETE FROM keywords WHERE id NOT IN (SELECT DISTINCT keyword_id FROM item_keywords)').run();
    return changed;
  });
  return { changed: run() };
}

/** Autocomplete: keywords starting with prefix (case-insensitive), most used first. */
function keywordSuggestions(db, { prefix, limit }) {
  const p = typeof prefix === 'string' ? Array.from(prefix.trim()).slice(0, KEYWORD_MAX).join('') : '';
  const n = Math.min(Math.max(Math.floor(Number(limit)) || 10, 1), 20);
  const like = p.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
  const rows = db.prepare(
    'SELECT k.name AS name, COUNT(*) AS n FROM keywords k JOIN item_keywords ik ON ik.keyword_id = k.id '
    + 'JOIN items i ON i.id = ik.item_id AND i.is_deleted = 0 AND ik.origin = i.keywords_user_owned '
    + "WHERE k.name LIKE @like ESCAPE '\\' GROUP BY k.id ORDER BY n DESC, k.name COLLATE NOCASE LIMIT @n"
  ).all({ like, n });
  return { names: rows.map((r) => r.name) };
}

module.exports = { setTitle, setCaption, updateKeywords, keywordSuggestions };
