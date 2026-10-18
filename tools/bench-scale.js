/**
 * tools/bench-scale.js  (M8d)
 *
 * Benchmarks the hot database paths against a database at the latest schema.
 *   node tools/bench-scale.js                       build a synthetic 100,000-row library and run everything
 *   node tools/bench-scale.js --db FILE             run against a copy of FILE (read the copy only; the original is never opened for writing)
 *   node tools/bench-scale.js --rows N --check      exit 1 if a regression threshold is exceeded (CI alarm)
 *   node tools/bench-scale.js --no-edits            skip the bulk-edit timings (used by ./dev bench on a real library)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const Q = require('../src/main/index/queries');
const { migrations } = require('../src/main/index/migrations');
const { getSelectionSummary } = require('../src/main/index/selection-summary');
const { setFavorite } = require('../src/main/index/edits');
const { setTitle, updateKeywords, keywordSuggestions } = require('../src/main/index/edits-text');
const { rotateItems } = require('../src/main/index/edits-rotate');
const { build } = require('./make-synthetic-db');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i === -1 ? d : process.argv[i + 1]; };
const flag = (k) => process.argv.includes(k);
const ROWS = Number(arg('--rows', 100000));
const CHECK = flag('--check');
const EDITS = !flag('--no-edits');
// Generous (CI runners are slow and noisy): the aim is to catch a table scan or an accidental O(n^2), not to measure the machine.
const LIMIT_INTERACTIVE_MS = Number(arg('--limit-ms', 400));
const LIMIT_BULK_MS = Number(arg('--limit-bulk-ms', 6000));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-bench-'));
const file = path.join(tmp, 'lib.db');
let db;
async function open() {
  if (arg('--db')) {
    // Copy first: the original library file is never opened by this tool (not even read-only, which can touch the -shm file).
    const from = path.resolve(arg('--db'));
    fs.copyFileSync(from, file);
    for (const ext of ['-wal']) if (fs.existsSync(from + ext)) fs.copyFileSync(from + ext, file + ext);
    db = new Database(file);
    const cur = db.pragma('user_version', { simple: true });
    for (const m of migrations.filter((x) => x.version > cur)) { m.up(db); db.pragma('user_version = ' + m.version); }
  } else {
    db = new Database(file);
    db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL');
    for (const m of migrations) { m.up(db); db.pragma('user_version = ' + m.version); }
    const t = Date.now();
    build(db, { rows: ROWS });
    console.log('synthetic library:', ROWS, 'rows built in', Date.now() - t, 'ms');
  }
  db.pragma('cache_size = -20000'); db.pragma('temp_store = MEMORY');
}

const results = [];
function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]; }
function measure(group, name, fn, { runs = 15, limit = LIMIT_INTERACTIVE_MS } = {}) {
  fn(); // warm
  const times = [];
  for (let i = 0; i < runs; i += 1) { const t = process.hrtime.bigint(); fn(i); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
  times.sort((a, b) => a - b);
  results.push({ group, name, p50: pct(times, 0.5), p95: pct(times, 0.95), limit });
}
function once(group, name, fn, limit = LIMIT_BULK_MS) {
  const t = process.hrtime.bigint(); const out = fn(); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  results.push({ group, name, p50: ms, p95: ms, limit, note: out });
}

const FILTERS = [null, 'video', 'raw', 'gif', 'panorama', 'gps', 'selfie', 'live', 'burst', 'favorite', 'source:2', 'geo:48,2,49,3', 'person:7', 'group:3,9', '::kind:photos', 'favorite::kind:videos', '::search:beach', '::fav:1'];

function scans(sql) { // does the plan walk the whole items table?
  return db.prepare('EXPLAIN QUERY PLAN ' + sql).all().filter((r) => /SCAN items(?! USING)/.test(r.detail) || /^SCAN items$/.test(r.detail));
}

async function main() {
  await open();
  const total = Q.getTotalCount(db);
  const mid = db.prepare('SELECT id, capture_time_local t FROM items WHERE is_deleted = 0 ORDER BY capture_time_local DESC LIMIT 1 OFFSET ?').get(Math.floor((typeof total === 'number' ? total : total.count) / 2));

  for (const f of FILTERS) {
    const label = String(f);
    measure('page', 'first page ' + label, () => Q.getItemsPage(db, { limit: 100, filter: f }));
    measure('page', 'deep page ' + label, () => Q.getItemsPage(db, { limit: 100, filter: f, cursor: { captureTimeLocal: mid.t, id: mid.id } }));
    measure('page', 'last page ' + label, () => Q.getItemsPage(db, { limit: 100, filter: f, direction: 'newer' }));
    measure('count', 'photo/video counts ' + label, () => Q.getPhotoVideoCounts(db, { filter: f }));
  }
  measure('timeline', 'counts by year/month', () => Q.getCountsByYearMonth(db, {}));
  measure('timeline', 'counts by date', () => Q.getCountsByDate(db, {}));
  measure('viewer', 'item index (deep, newest-first)', () => Q.getItemIndex(db, { id: mid.id, filter: null }));
  measure('viewer', 'item by id', () => Q.getItemById(db, mid.id));
  measure('sidebar', 'media type counts', () => Q.getMediaTypeCounts(db));
  measure('map', 'map points', () => Q.getMapPoints(db), { runs: 5 });
  measure('map', 'area sections (geo box)', () => Q.getAreaSections(db, { filter: 'geo:48,2,49,3' }), { runs: 5 });
  const tok = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const all = tok({ a: 1 });
  const ids50k = tok({ i: Array.from({ length: 50000 }, (_, i) => i + 1) });
  measure('selection', 'count of Cmd+A', () => Q.getPhotoVideoCounts(db, { filter: '::sel:' + all }));
  measure('selection', 'count of 50,000 individual ids', () => Q.getPhotoVideoCounts(db, { filter: '::sel:' + ids50k }), { runs: 5 });
  measure('selection', 'summary of Cmd+A', () => getSelectionSummary(db, { filter: '::sel:' + all }), { runs: 3, limit: LIMIT_BULK_MS });
  measure('search', 'LIKE search "beach" (name/title/caption/keyword)', () => Q.getItemsPage(db, { limit: 100, filter: '::search:beach' }));
  measure('search', 'LIKE search with no hit', () => Q.getItemsPage(db, { limit: 100, filter: '::search:zzzzqq' }), { runs: 5, limit: 1000 });
  measure('search', 'keyword autocomplete', () => keywordSuggestions(db, { prefix: 'bea' }));
  if (EDITS) {
    const target = { filter: '::sel:' + all };
    once('bulk edit', 'Cmd+A favorite', () => setFavorite(db, { target, value: true }).changed);
    once('bulk edit', 'Cmd+A title', () => setTitle(db, { target, value: 'Bulk title' }).changed);
    once('bulk edit', 'Cmd+A add keyword', () => updateKeywords(db, { target, add: ['bulk-kw'] }).changed);
    once('bulk edit', 'Cmd+A rotate', () => rotateItems(db, { target, delta: 90 }).changed);
  }
  // Hot paths must not scan the whole table.
  const scanned = [];
  for (const f of [null, 'video', 'favorite', 'source:2', 'gps']) {
    const sql = 'SELECT id FROM items WHERE ' + Q.buildFilterSql(f) + ' ORDER BY capture_time_local DESC, id DESC LIMIT 100';
    if (scans(sql).length) scanned.push(String(f));
  }
  if (scanned.length) results.push({ group: 'plan', name: 'full table scan on hot path: ' + scanned.join(', '), p50: 0, p95: 0, limit: 0, fail: true });

  const rows = results.map((r) => `${r.group.padEnd(10)} ${r.name.padEnd(54)} p50 ${r.p50.toFixed(2).padStart(9)} ms  p95 ${r.p95.toFixed(2).padStart(9)} ms  (limit ${r.limit})${r.note !== undefined ? '  changed=' + r.note : ''}`);
  console.log(rows.join('\n'));
  const bad = results.filter((r) => r.fail || r.p95 > r.limit);
  console.log('\n' + results.length + ' measurements, ' + bad.length + ' over their limit');
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad.length) { for (const b of bad) console.log('  OVER:', b.group, b.name, b.p95.toFixed(1) + ' ms'); if (CHECK) process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
