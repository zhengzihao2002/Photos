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

test('moving a turn preserves its angle, other points and the original media metadata', () => {
  const db = freshDb(); seed(db);
  T.setTurn(db, { id: 1, at: 2, turn: 90 });
  T.setTurn(db, { id: 1, at: 4, turn: 270 });
  const original = db.prepare('SELECT * FROM items WHERE id = 1').get();
  assert.deepStrictEqual(T.moveTurn(db, { id: 1, from: 2, to: 5.26 }), [{ at: 4, turn: 270 }, { at: 5.2, turn: 90 }]);
  assert.strictEqual(T.turnAt(T.listTurns(db, 1), 3), 0);
  assert.strictEqual(T.turnAt(T.listTurns(db, 1), 5.26), 90);
  assert.deepStrictEqual(T.moveTurn(db, { id: 1, from: 5.2, to: 0 }), [{ at: 0, turn: 90 }, { at: 4, turn: 270 }]);
  assert.deepStrictEqual(db.prepare('SELECT * FROM items WHERE id = 1').get(), original);
  db.close();
});

test('moving onto another turn is rejected without losing either point', () => {
  const db = freshDb(); seed(db);
  T.setTurn(db, { id: 1, at: 2, turn: 90 });
  T.setTurn(db, { id: 1, at: 4, turn: 0 });
  const before = T.listTurns(db, 1);
  assert.throws(() => T.moveTurn(db, { id: 1, from: 2, to: 4.06 }), /video-turn-collision/);
  assert.deepStrictEqual(T.listTurns(db, 1), before);
  assert.deepStrictEqual(T.moveTurn(db, { id: 1, from: 2, to: 2.06 }), before);
  assert.deepStrictEqual(T.moveTurn(db, { id: 1, from: 99, to: 3 }), before);
  db.close();
});

test('moving turns validates times and cannot edit photos or deleted videos', () => {
  const db = freshDb(); seed(db);
  T.setTurn(db, { id: 1, at: 2, turn: 90 });
  for (const value of [-1, NaN, Infinity, 86401]) {
    assert.throws(() => T.moveTurn(db, { id: 1, from: 2, to: value }), /Invalid time/);
    assert.throws(() => T.moveTurn(db, { id: 1, from: value, to: 3 }), /Invalid time/);
  }
  assert.throws(() => T.moveTurn(db, { id: 0, from: 2, to: 3 }), /Invalid item/);
  assert.deepStrictEqual(T.moveTurn(db, { id: 2, from: 2, to: 3 }), []);
  db.prepare('UPDATE items SET is_deleted = 1 WHERE id = 1').run();
  assert.deepStrictEqual(T.moveTurn(db, { id: 1, from: 2, to: 3 }), [{ at: 2, turn: 90 }]);
  db.close();
});
