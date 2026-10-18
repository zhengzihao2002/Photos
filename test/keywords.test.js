const test = require('node:test');
const assert = require('node:assert');
const { freshDb } = require('./helpers');
const { updateKeywords } = require('../src/main/index/edits-text');

function lib(n) {
  const db = freshDb();
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/x','x',0)").run();
  const ins = db.prepare("INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime, capture_time_local, created_at, updated_at) VALUES (1,@p,@p,'image','jpg',1,1,@t,0,0)");
  db.transaction(() => { for (let i = 0; i < n; i++) ins.run({ p: 'f' + i, t: '2020-01-01 00:00:' + String(i % 60).padStart(2, '0') }); })();
  const k = db.prepare("INSERT INTO keywords (name) VALUES ('fromfile')").run().lastInsertRowid;
  db.prepare('INSERT INTO item_keywords (item_id, keyword_id, origin) SELECT id, ?, 0 FROM items').run(k);
  return db;
}
const names = (db, id) => db.prepare('SELECT k.name FROM item_keywords ik JOIN keywords k ON k.id = ik.keyword_id JOIN items i ON i.id = ik.item_id WHERE ik.item_id = ? AND ik.origin = i.keywords_user_owned ORDER BY k.name').all(id).map((r) => r.name);

for (const n of [10, 700]) { // per-item path and set-based path must behave the same
  test(`keywords on ${n} items: adopt file keywords, add, remove, count`, () => {
    const db = lib(n);
    const target = { filter: '' };
    assert.ok(updateKeywords(db, { target, add: ['beach', 'Sun'] }).changed > 0);
    assert.deepStrictEqual(names(db, 1), ['beach', 'fromfile', 'Sun'].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM items WHERE keywords_user_owned = 1').get().c, n);
    assert.ok(updateKeywords(db, { target, remove: ['fromfile'] }).changed > 0);
    assert.ok(!names(db, n).includes('fromfile'));
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM item_keywords WHERE origin = 0").get().c, n); // the file's own keywords are untouched
    assert.strictEqual(updateKeywords(db, { target, add: ['beach'] }).changed, 0); // nothing new
  });
}
