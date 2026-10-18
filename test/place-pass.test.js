const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { freshDb } = require('./helpers');
const { createPlaceResolver, peekDatasetVersion } = require('../src/main/places/place-resolver');
const { runPlacePassLazy } = require('../src/main/places/place-pass');

const PLACES = path.join(__dirname, '..', 'resources', 'geo', 'places.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-'));
const LM = path.join(tmp, 'landmarks.json');
fs.writeFileSync(LM, JSON.stringify({ datasetVersion: 1, countries: ['FR'],
  landmarks: { count: 1, gid: [2988507], lat: [48.8584], lng: [2.2945], rad: [200], rank: [90], cc: [0], en: ['Eiffel Tower'], zh: ['埃菲尔铁塔'] } }));

function setup() {
  const db = freshDb();
  db.prepare(`INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/x','x',0)`).run();
  const ins = db.prepare(`INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime,
    has_gps, gps_latitude, gps_longitude, title_user, created_at, updated_at) VALUES (1,@p,@p,'image','jpg',10,7,@g,@la,@lo,@t,0,0)`);
  ins.run({ p: 'a', g: 1, la: 48.8584, lo: 2.2945, t: 'Mine' });
  ins.run({ p: 'b', g: 1, la: 48.9, lo: 2.5, t: null });
  ins.run({ p: 'c', g: 0, la: null, lo: null, t: null });
  return db;
}

test('place pass stores the landmark, keeps user titles and file stamps, and is a no-op the second time', () => {
  const db = setup();
  const version = peekDatasetVersion(PLACES, LM);
  const r1 = runPlacePassLazy(db, () => createPlaceResolver(PLACES, LM), version);
  assert.strictEqual(r1.processed, 3);
  assert.strictEqual(r1.landmarks, 1);
  const a = db.prepare("SELECT * FROM items WHERE filename = 'a'").get();
  assert.strictEqual(a.place_landmark_en, 'Eiffel Tower');
  assert.strictEqual(a.place_landmark_zh, '埃菲尔铁塔');
  assert.strictEqual(a.place_landmark_id, 2988507);
  assert.strictEqual(a.place_locality_en, 'Paris');
  assert.strictEqual(a.title_user, 'Mine');
  assert.strictEqual(a.file_mtime, 7);
  assert.strictEqual(a.file_size_bytes, 10);
  assert.strictEqual(db.prepare("SELECT place_landmark_en FROM items WHERE filename = 'b'").get().place_landmark_en, null);
  assert.strictEqual(db.prepare("SELECT place_landmark_en FROM items WHERE filename = 'c'").get().place_landmark_en, null);
  const r2 = runPlacePassLazy(db, () => { throw new Error('dataset must not load'); }, version);
  assert.strictEqual(r2.processed, 0);
});

test('a version-16 database upgrades and its rows are recomputed once', () => {
  const db = freshDb(16);
  db.prepare(`INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/x','x',0)`).run();
  db.prepare(`INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime,
    has_gps, gps_latitude, gps_longitude, place_version, created_at, updated_at) VALUES (1,'a','a','image','jpg',10,7,1,48.8584,2.2945,1,0,0)`).run();
  require('./helpers').runMigrations(db);
  const version = peekDatasetVersion(PLACES, LM);
  assert.ok(version > 1);
  assert.strictEqual(runPlacePassLazy(db, () => createPlaceResolver(PLACES, LM), version).processed, 1);
});

test('missing landmarks file means no landmarks, not an error', () => {
  const r = createPlaceResolver(PLACES, path.join(tmp, 'nope.json'));
  assert.strictEqual(r.hasLandmarks, false);
  assert.strictEqual(r.lookup(48.8584, 2.2945).landmarkEn, null);
});
