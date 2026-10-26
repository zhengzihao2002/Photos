const test = require('node:test');
const assert = require('node:assert');
const { freshDb } = require('./helpers');
const T = require('../src/main/index/video-turns');

function seed(db) {
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/a','a',0)").run();
  const ins = db.prepare("INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime, capture_time_local, capture_sort, created_at, updated_at) VALUES (1,@p,@p,@m,'x',1,1,'2024-01-01 00:00:00','2024-01-01 00:00:00',0,0)");
  ins.run({ p: 'v.mov', m: 'video' }); ins.run({ p: 'i.jpg', m: 'image' });
}

test('turn points: set, replace, remove, clear; the last point at or before a time wins', () => {
  const db = freshDb(); seed(db);
  assert.deepStrictEqual(T.setTurn(db, { id: 1, at: 12.34, turn: 90 }), [{ at: 12.3, turn: 90 }]);
  T.setTurn(db, { id: 1, at: 30, turn: 0 });
  T.setTurn(db, { id: 1, at: 12.3, turn: 270 }); // replaces the point at that time
  const pts = T.listTurns(db, 1);
  assert.deepStrictEqual(pts, [{ at: 12.3, turn: 270 }, { at: 30, turn: 0 }]);
  assert.strictEqual(T.turnAt(pts, 5), 0);
  assert.strictEqual(T.turnAt(pts, 12.3), 270);
  assert.strictEqual(T.turnAt(pts, 29.9), 270);
  assert.strictEqual(T.turnAt(pts, 40), 0);
  assert.deepStrictEqual(T.setTurn(db, { id: 1, at: 30, turn: null }), [{ at: 12.3, turn: 270 }]);
  assert.deepStrictEqual(T.clearTurns(db, 1), []);
  assert.deepStrictEqual(T.listTurns(db, 1), []);
});

test('turn points are validated and only apply to videos', () => {
  const db = freshDb(); seed(db);
  assert.throws(() => T.setTurn(db, { id: 1, at: 1, turn: 45 }), /Invalid turn/);
  assert.throws(() => T.setTurn(db, { id: 1, at: -1, turn: 90 }), /Invalid time/);
  assert.throws(() => T.setTurn(db, { id: 1, at: NaN, turn: 90 }), /Invalid time/);
  assert.deepStrictEqual(T.setTurn(db, { id: 2, at: 1, turn: 90 }), []); // a photo
  assert.deepStrictEqual(T.setTurn(db, { id: 99, at: 1, turn: 90 }), []);
});

test('a turn applies at the paused time, including repeated turns in either direction', () => {
  const db = freshDb(); seed(db);
  const at = 12.36; // rounding to the nearest tenth used to defer the turn until 12.4
  for (const delta of [90, 90, -90, -90, -90, 90]) {
    const expected = (T.turnAt(T.listTurns(db, 1), at) + delta + 360) % 360;
    const points = T.setTurn(db, { id: 1, at, turn: expected });
    assert.strictEqual(T.turnAt(points, at), expected);
    assert.strictEqual(T.turnAt(points, 12.29), 0);
    assert.strictEqual(points.length, 1);
  }
  db.close();
});

test('turn points go away with their item', () => {
  const db = freshDb(); seed(db);
  T.setTurn(db, { id: 1, at: 1, turn: 90 });
  db.prepare('DELETE FROM items WHERE id = 1').run();
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM video_turns').get().n, 0);
});
