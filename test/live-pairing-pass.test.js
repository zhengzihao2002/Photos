const test = require('node:test');
const assert = require('node:assert');
const { freshDb } = require('./helpers');
const { runLivePairingPass } = require('../src/main/index/live-pairing-pass');

function setup() {
  const db = freshDb();
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/a','a',0)").run();
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/b','b',0)").run();
  return db;
}
let n = 0;
function add(db, o) {
  const video = o.type === 'video';
  const ext = o.ext || (video ? 'mov' : 'heic');
  const r = db.prepare(`INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime,
    capture_time_local, capture_sort, duration_seconds, content_identifier, burst_id, is_burst_cover, is_deleted, created_at, updated_at)
    VALUES (@src,@rel,@fn,@mt,@ext,10,7,@t,@t,@dur,@id,@burst,@cover,@del,0,0)`).run({
    src: o.src || 1, rel: o.rel, fn: o.rel.split('/').pop(), mt: video ? 'video' : 'image', ext,
    t: o.t === undefined ? '2025-03-07 10:00:00' : o.t, dur: video ? (o.dur === undefined ? 3 : o.dur) : null,
    id: o.id || null, burst: o.burst || null, cover: o.cover ? 1 : 0, del: o.del ? 1 : 0 });
  n += 1;
  return Number(r.lastInsertRowid);
}
const row = (db, id) => db.prepare('SELECT is_live_photo lp, live_photo_video_item_id v, is_live_photo_component c FROM items WHERE id = ?').get(id);
const ID1 = '2369D8CA-95C1-419D-9502-14758AC0C946';
const ID2 = '83B7249E-E662-452F-9C8E-34C18A2E04FA';

test('pairs differently named files by identifier', () => {
  const db = setup();
  const s = add(db, { rel: 'PAZRE1247.HEIC', id: ID1 });
  const v = add(db, { type: 'video', rel: 'CKAOE9105.MOV', id: ID1 });
  assert.strictEqual(runLivePairingPass(db, 1).paired, 1);
  assert.deepStrictEqual(row(db, s), { lp: 1, v, c: 0 });
  assert.deepStrictEqual(row(db, v), { lp: 0, v: null, c: 1 });
});

test('pairs across folders and is idempotent', () => {
  const db = setup();
  const s = add(db, { rel: 'x/a.HEIC', id: ID1 });
  const v = add(db, { type: 'video', rel: 'y/b.MOV', id: ID1 });
  runLivePairingPass(db, 1);
  assert.strictEqual(row(db, s).v, v);
  assert.strictEqual(runLivePairingPass(db, 1).changed, 0);
});

test('never pairs across sources or different identifiers', () => {
  const db = setup();
  const s = add(db, { rel: 'a.HEIC', id: ID1 });
  add(db, { type: 'video', rel: 'a.MOV', id: ID1, src: 2 });
  const v2 = add(db, { type: 'video', rel: 'b.MOV', id: ID2 });
  runLivePairingPass(db, 1);
  assert.strictEqual(row(db, s).lp, 0);
  assert.strictEqual(row(db, v2).c, 0);
});

test('2 stills and 2 videos with one identifier resolve by stem', () => {
  const db = setup();
  const s1 = add(db, { rel: 'IMG_0073.HEIC', id: ID1 }); const s2 = add(db, { rel: 'IMG_0085.JPG', ext: 'jpg', id: ID1 });
  const v1 = add(db, { type: 'video', rel: 'IMG_0073.MOV', id: ID1 }); const v2 = add(db, { type: 'video', rel: 'IMG_0085.MOV', id: ID1 });
  runLivePairingPass(db, 1);
  assert.strictEqual(row(db, s1).v, v1);
  assert.strictEqual(row(db, s2).v, v2);
});

test('unresolvable copies stay unpaired and visible', () => {
  const db = setup();
  const s1 = add(db, { rel: 'WYIZ9228.HEIC', id: ID1 }); const s2 = add(db, { rel: 'WYIZ9228 1.HEIC', id: ID1 });
  const v1 = add(db, { type: 'video', rel: 'RKAP1055.MOV', id: ID1 }); const v2 = add(db, { type: 'video', rel: 'RKAP1055 1.MOV', id: ID1 });
  assert.strictEqual(runLivePairingPass(db, 1).paired, 0);
  for (const id of [s1, s2]) assert.strictEqual(row(db, id).lp, 0);
  for (const id of [v1, v2]) assert.strictEqual(row(db, id).c, 0);
});

test('two videos with no still stay visible', () => {
  const db = setup();
  const a = add(db, { type: 'video', rel: 'a.MOV', id: ID1 }); const b = add(db, { type: 'video', rel: 'b.MOV', id: ID1 });
  assert.strictEqual(runLivePairingPass(db, 1).paired, 0);
  assert.strictEqual(row(db, a).c + row(db, b).c, 0);
});

test('stem fallback pairs short videos without identifiers only', () => {
  const db = setup();
  const s = add(db, { rel: 'd/IMG_1.HEIC' }); const v = add(db, { type: 'video', rel: 'd/IMG_1.MOV', dur: 2.5 });
  const s2 = add(db, { rel: 'd/IMG_2.HEIC' }); const v2 = add(db, { type: 'video', rel: 'd/IMG_2.MOV', dur: 60 });
  const s3 = add(db, { rel: 'd/IMG_3.HEIC', id: ID1 }); const v3 = add(db, { type: 'video', rel: 'd/IMG_3.MOV', dur: 2 });
  runLivePairingPass(db, 1);
  assert.strictEqual(row(db, s).v, v); assert.strictEqual(row(db, v).c, 1);
  assert.strictEqual(row(db, s2).lp, 0); assert.strictEqual(row(db, v2).c, 0);
  assert.strictEqual(row(db, s3).lp, 0); assert.strictEqual(row(db, v3).c, 0);
});

test('stem fallback never overrides an identifier pair', () => {
  const db = setup();
  const s = add(db, { rel: 'IMG_1.HEIC', id: ID1 }); const vId = add(db, { type: 'video', rel: 'OTHER.MOV', id: ID1 });
  const vStem = add(db, { type: 'video', rel: 'IMG_1.MOV' });
  runLivePairingPass(db, 1);
  assert.strictEqual(row(db, s).v, vId);
  assert.strictEqual(row(db, vStem).c, 0);
});

test('un-pairs when a half disappears, re-pairs when it returns', () => {
  const db = setup();
  const s = add(db, { rel: 'a.HEIC', id: ID1 }); const v = add(db, { type: 'video', rel: 'b.MOV', id: ID1 });
  runLivePairingPass(db, 1);
  db.prepare('UPDATE items SET is_deleted = 1 WHERE id = ?').run(s);
  runLivePairingPass(db, 1);
  assert.strictEqual(row(db, v).c, 0);
  db.prepare('UPDATE items SET is_deleted = 0 WHERE id = ?').run(s);
  runLivePairingPass(db, 1);
  assert.deepStrictEqual(row(db, v), { lp: 0, v: null, c: 1 });
  db.prepare('UPDATE items SET is_deleted = 1 WHERE id = ?').run(v);
  runLivePairingPass(db, 1);
  assert.deepStrictEqual(row(db, s), { lp: 0, v: null, c: 0 });
});

test('a non-cover burst still is never paired', () => {
  const db = setup();
  const s = add(db, { rel: 'a.HEIC', id: ID1, burst: 'x', cover: false });
  const v = add(db, { type: 'video', rel: 'b.MOV', id: ID1 });
  assert.strictEqual(runLivePairingPass(db, 1).paired, 0);
  assert.strictEqual(row(db, v).c, 0);
  assert.strictEqual(row(db, s).lp, 0);
});
