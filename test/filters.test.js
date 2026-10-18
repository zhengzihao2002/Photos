const test = require('node:test');
const assert = require('node:assert');
const { freshDb } = require('./helpers');
const Q = require('../src/main/index/queries');

function seed(db) {
  db.prepare(`INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/a','a',0),('/b','b',0)`).run();
  const ins = db.prepare(`INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime,
    capture_time_local, capture_date, capture_year, capture_month, has_gps, gps_latitude, gps_longitude, is_favorite, is_raw, is_gif,
    is_panorama, is_live_photo, is_burst_cover, burst_id, title_user, created_at, updated_at)
    VALUES (@s,@p,@f,@m,'jpg',100,1,@t,@d,2020,@mo,@gps,@lat,@lng,@fav,@raw,0,0,0,0,NULL,@title,0,0)`);
  for (let i = 0; i < 40; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    ins.run({ s: 1 + (i % 2), p: 'p' + i + '.jpg', f: 'IMG_' + i + '.jpg', m: i % 5 === 0 ? 'video' : 'image',
      t: `2020-03-${day} 10:00:${String(i).padStart(2, '0')}`, d: `2020-03-${day}`, mo: 3,
      gps: i % 3 === 0 ? 1 : 0, lat: 48.8 + i / 1000, lng: 2.3, fav: i % 4 === 0 ? 1 : 0, raw: i % 7 === 0 ? 1 : 0,
      title: i === 3 ? 'Eiffel trip' : null });
  }
}

const FILTERS = [null, 'video', 'raw', 'gif', 'panorama', 'gps', 'selfie', 'live', 'burst', 'favorite', 'source:1',
  'geo:48,2,49,3', 'geo:48,170,49,-170', '::kind:photos', 'video::kind:videos', '::search:IMG', 'favorite::search:Eiffel',
  '::fav:1', 'source:2::kind:photos::fav:1'];

test('every documented filter string builds SQL that runs', () => {
  const db = freshDb(); seed(db);
  for (const f of FILTERS) {
    const sql = Q.buildFilterSql(f);
    assert.doesNotThrow(() => db.prepare('SELECT COUNT(*) FROM items WHERE ' + sql).get(), String(f));
  }
});

test('hostile filter strings are rejected, never inlined', () => {
  const bad = ["source:1; DROP TABLE items", 'source:0', 'source:-1', 'geo:1,2,3', 'geo:91,0,92,1', "::search:%27", '::bogus:1',
    '::kind:x', 'person:abc', 'group:2,1', 'group:1', '::sel:!!!', "x' OR '1'='1"];
  const db = freshDb(); seed(db);
  for (const f of bad) {
    let ok = false;
    try { const sql = Q.buildFilterSql(f); db.prepare('SELECT 1 FROM items WHERE ' + sql).all(); ok = f === "::search:%27"; } catch (e) { ok = true; }
    assert.ok(ok, 'should reject ' + f);
  }
});

test('search matches file name and title, and treats % and _ literally', () => {
  const db = freshDb(); seed(db);
  const count = (f) => db.prepare('SELECT COUNT(*) c FROM items WHERE ' + Q.buildFilterSql(f)).get().c;
  assert.strictEqual(count('::search:Eiffel'), 1);
  assert.strictEqual(count('::search:' + encodeURIComponent('%')), 0);
  assert.strictEqual(count('::search:' + encodeURIComponent('IMG_1')), 11);
});

test('antimeridian geo box matches both sides', () => {
  const db = freshDb(); seed(db);
  db.prepare("UPDATE items SET gps_longitude = 179.9 WHERE id = 1").run();
  db.prepare("UPDATE items SET gps_longitude = -179.9, has_gps = 1 WHERE id = 2").run();
  const c = db.prepare('SELECT COUNT(*) c FROM items WHERE ' + Q.buildFilterSql('geo:-90,170,90,-170')).get().c;
  assert.strictEqual(c, 2);
});

test('counts: sum of per-source counts equals the library total', () => {
  const db = freshDb(); seed(db);
  const total = Q.getTotalCount(db);
  const a = db.prepare('SELECT COUNT(*) c FROM items WHERE ' + Q.buildFilterSql('source:1')).get().c;
  const b = db.prepare('SELECT COUNT(*) c FROM items WHERE ' + Q.buildFilterSql('source:2')).get().c;
  assert.strictEqual(a + b, typeof total === 'number' ? total : total.count);
});
