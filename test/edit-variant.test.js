const test = require('node:test');
const assert = require('node:assert');
const { freshDb, runMigrations } = require('./helpers');
const { runEditVariantPass } = require('../src/main/index/edit-variant-pass');
const Q = require('../src/main/index/queries');

function seed(db, paths) {
  db.prepare("INSERT OR IGNORE INTO source_folders (root_path, display_name, added_at) VALUES ('/a','a',0),('/b','b',0)").run();
  const ins = db.prepare("INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime, capture_time_local, capture_sort, capture_date, capture_year, capture_month, created_at, updated_at) VALUES (@s,@p,@f,@m,@e,1,1,@t,@t,'2024-01-01',2024,1,0,0)");
  paths.forEach(([s, p], i) => {
    const f = p.split('/').pop(); const e = f.split('.').pop().toLowerCase();
    ins.run({ s, p, f, e, m: /mov|mp4/.test(e) ? 'video' : 'image', t: '2024-01-01 10:00:' + String(i).padStart(2, '0') });
  });
}
const visible = (db) => Q.getItemsPage(db, { limit: 100 }).items.length;
const names = (db) => db.prepare('SELECT filename FROM items WHERE is_edit_variant = 1 ORDER BY filename').all().map((r) => r.filename);

test('IMG_E copies hide behind their original in the same folder, whatever the extensions', () => {
  const db = freshDb();
  seed(db, [[1, 'f1/IMG_2239.HEIC'], [1, 'f1/IMG_E2239.JPG'], [1, 'f2/IMG_0001.jpg'], [1, 'f2/IMG_E0001.jpg'],
    [1, 'f3/IMG_E5555.jpg'],            // edit without an original: stays visible
    [1, 'f4/IMG_7777.jpg'], [2, 'f4/IMG_E7777.jpg'], // original is in another source: stays visible
    [1, 'f5/IMG_9.mov'], [1, 'f5/IMG_E9.mov']]);
  const r = runEditVariantPass(db, 1);
  assert.strictEqual(r.hidden, 3);
  assert.deepStrictEqual(names(db), ['IMG_E0001.jpg', 'IMG_E2239.JPG', 'IMG_E9.mov']);
  assert.strictEqual(visible(db), 9 - 3);
});

test('the pass is recomputed: deleting the original shows the edit again', () => {
  const db = freshDb();
  seed(db, [[1, 'f/IMG_1.jpg'], [1, 'f/IMG_E1.jpg']]);
  runEditVariantPass(db, 1);
  assert.strictEqual(visible(db), 1);
  db.prepare("UPDATE items SET is_deleted = 1 WHERE filename = 'IMG_1.jpg'").run();
  runEditVariantPass(db, 1);
  assert.strictEqual(visible(db), 1);
  assert.deepStrictEqual(names(db), []);
});

test('upgrading from version 19 hides existing edit copies and keeps the time indexes', () => {
  const db = freshDb(19);
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/a','a',0)").run();
  for (const f of ['IMG_3.HEIC', 'IMG_E3.JPG']) {
    db.prepare("INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime, capture_time_local, capture_sort, created_at, updated_at) VALUES (1,@p,@p,'image','jpg',5,6,'2020-01-01 00:00:00','2020-01-01 00:00:00',0,0)").run({ p: 'd/' + f });
  }
  const before = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql LIKE '%is_live_photo_component = 0%'").all().map((r) => r.name).sort();
  runMigrations(db);
  assert.deepStrictEqual(names(db), ['d/IMG_E3.JPG']); // this seed stores the path as the file name
  const after = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql LIKE '%is_edit_variant = 0%'").all().map((r) => r.name).sort();
  assert.deepStrictEqual(after, before);
  assert.strictEqual(db.prepare('SELECT file_mtime m, file_size_bytes s FROM items LIMIT 1').get().m, 6);
});
