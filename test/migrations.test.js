const test = require('node:test');
const assert = require('node:assert');
const { freshDb, runMigrations, LATEST, migrations } = require('./helpers');

test('migrations are numbered 1..N without gaps', () => {
  const versions = migrations.map((m) => m.version).sort((a, b) => a - b);
  versions.forEach((v, i) => assert.strictEqual(v, i + 1));
});

test('a fresh database reaches the latest version', () => {
  const db = freshDb();
  assert.strictEqual(db.pragma('user_version', { simple: true }), LATEST);
});

test('re-running migrations changes nothing', () => {
  const db = freshDb();
  const before = db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
  runMigrations(db);
  assert.deepStrictEqual(db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(), before);
});

test('migrations from 10 on are safe to apply a second time (guarded)', () => {
  for (const m of migrations.filter((x) => x.version >= 10)) {
    const db = freshDb(m.version);
    assert.doesNotThrow(() => m.up(db), 'migration ' + m.version);
  }
});

test('upgrading from version 16 keeps existing rows and edits', () => {
  const db = freshDb(16);
  db.prepare(`INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/x','x',0)`).run();
  db.prepare(`INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime,
    is_favorite, title_user, rotation, has_gps, gps_latitude, gps_longitude, created_at, updated_at)
    VALUES (1,'a.jpg','a.jpg','image','jpg',10,5,1,'My title',90,1,48.8584,2.2945,0,0)`).run();
  runMigrations(db);
  const row = db.prepare('SELECT is_favorite, title_user, rotation, file_size_bytes, file_mtime FROM items').get();
  assert.deepStrictEqual({ ...row }, { is_favorite: 1, title_user: 'My title', rotation: 90, file_size_bytes: 10, file_mtime: 5 });
  assert.strictEqual(db.pragma('user_version', { simple: true }), LATEST);
});
