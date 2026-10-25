// End-to-end on Linux (no Electron): generated fixtures -> the real scan worker thread -> database,
// with the write guard active in the worker and a before/after fingerprint of the source folder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { runMigrations } = require('./helpers');
const { record, compare } = require('../tools/verify-readonly');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
const SRC = path.join(base, 'Library'); const DATA = path.join(base, 'PhotosData');
fs.mkdirSync(DATA, { recursive: true });
execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'make-fixtures.js'), SRC, '--count', '30', '--no-video'], { stdio: 'ignore' });
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, '.fixture-manifest.json'), 'utf8'));
const dbPath = path.join(DATA, 'library.db');

function scan() {
  return new Promise((resolve, reject) => {
    const guard = { allowedRoots: [fs.realpathSync(DATA).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()].map((p) => p.normalize('NFC')), sourceRoots: [fs.realpathSync(SRC).toLowerCase()] };
    const w = new Worker(path.join(__dirname, '..', 'src', 'main', 'index', 'worker-scan.js'), {
      workerData: { dbPath, sourceFolderId: 1, sourceRootPath: SRC, taskId: 't', dirs: null, protectedRoots: [DATA],
        geoDatasetPath: path.join(__dirname, '..', 'resources', 'geo', 'places.json'), guard },
    });
    const violations = [];
    w.on('message', (m) => { if (m.type === 'guard:violation') violations.push(m.violation); if (m.type === 'done') resolve({ m, violations }); if (m.type === 'fatal') reject(new Error(m.message)); });
    w.on('error', reject);
  });
}

test('scan the fixtures: counts, landmarks, dates, GPS, nothing written to the source', async () => {
  const db = new Database(dbPath); db.pragma('journal_mode = WAL'); runMigrations(db);
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES (?, 'Library', 0)").run(SRC);
  db.close();

  record('scan-before', [SRC], true);
  const { m, violations } = await scan();
  assert.strictEqual(violations.length, 0, JSON.stringify(violations));
  assert.strictEqual(m.summary.errors, 0, JSON.stringify(m.errors));

  const d = new Database(dbPath, { readonly: true });
  const rows = d.prepare('SELECT filename, media_type, capture_time_local, has_gps, place_landmark_en, place_landmark_zh, place_locality_en FROM items WHERE is_deleted = 0').all();
  assert.strictEqual(rows.filter((r) => r.media_type === 'image').length, manifest.photos);
  assert.ok(rows.every((r) => !r.filename.startsWith('.')), 'hidden files are not indexed');
  const byName = Object.fromEntries(rows.map((r) => [r.filename, r]));
  for (const [file, name] of Object.entries(manifest.landmarks)) {
    assert.strictEqual(byName[file].has_gps, 1, file);
    assert.strictEqual(byName[file].place_landmark_en, name, file + ' -> ' + byName[file].place_landmark_en);
  }
  assert.match(byName['IMG_0000.jpg'].capture_time_local, /^2015-01-01 10:00:00/);
  assert.strictEqual(byName['IMG_0000.jpg'].place_landmark_en, null);
  d.close();

  record('scan-after', [SRC], true);
  const prev = console.log; let text = ''; console.log = (s) => { text += s + '\n'; };
  const code = compare(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.cache', 'fingerprints', 'scan-before.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.cache', 'fingerprints', 'scan-after.json'), 'utf8')));
  console.log = prev;
  assert.strictEqual(code, 0, text);
});

test('a second scan changes nothing (skip-if-unchanged) and keeps the user title', async () => {
  const db = new Database(dbPath);
  db.prepare("UPDATE items SET title_user = 'Mine', is_favorite = 1 WHERE filename = 'IMG_0000.jpg'").run();
  db.close();
  const { m } = await scan();
  assert.strictEqual(m.summary.inserted, 0);
  assert.strictEqual(m.summary.unchanged, manifest.photos);
  const d = new Database(dbPath, { readonly: true });
  const row = d.prepare("SELECT title_user, is_favorite FROM items WHERE filename = 'IMG_0000.jpg'").get();
  assert.deepStrictEqual({ ...row }, { title_user: 'Mine', is_favorite: 1 });
  d.close();
});

test('counts are consistent: per-source counts add up to the library total', () => {
  const Q = require('../src/main/index/queries');
  const d = new Database(dbPath, { readonly: true });
  const total = Q.getPhotoVideoCounts(d, { filter: null });
  const src = Q.getPhotoVideoCounts(d, { filter: 'source:1' });
  assert.deepStrictEqual(src, total);
  d.close();
  fs.rmSync(path.join(__dirname, '..', '.cache', 'fingerprints'), { recursive: true, force: true });
});
