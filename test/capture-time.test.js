const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { freshDb, runMigrations } = require('./helpers');
const CT = require('../src/main/index/capture-time');
const Q = require('../src/main/index/queries');
const { extractItemMetadata } = require('../src/main/index/extract');

const parts = (y, mo, d, h, mi, s) => ({ year: y, month: mo, day: d, hour: h, minute: mi, second: s });

test('offsets parse from EXIF OffsetTime text', () => {
  assert.strictEqual(CT.parseOffsetMinutes('+08:00'), 480);
  assert.strictEqual(CT.parseOffsetMinutes('-05:00'), -300);
  assert.strictEqual(CT.parseOffsetMinutes('-0430'), -270);
  assert.strictEqual(CT.parseOffsetMinutes('Z'), 0);
  assert.strictEqual(CT.parseOffsetMinutes('+25:00'), null);
  assert.strictEqual(CT.parseOffsetMinutes(undefined), null);
  assert.strictEqual(CT.parseOffsetMinutes('garbage'), null);
});

test('Beijing 08:00 and New York 20:00 the day before are the same moment', () => {
  const beijing = CT.captureSortFromParts(parts(2024, 10, 2, 8, 0, 0), 480);
  const eastern = CT.captureSortFromParts(parts(2024, 10, 1, 20, 0, 0), -240);
  assert.strictEqual(beijing, '2024-10-02 00:00:00');
  assert.strictEqual(eastern, '2024-10-02 00:00:00');
});

test('a later photo from the USA sorts as newer although its shown date is older', () => {
  const china = CT.captureSortFromParts(parts(2024, 10, 2, 8, 0, 0), 480);   // 00:00 UTC
  const usa = CT.captureSortFromParts(parts(2024, 10, 1, 21, 0, 0), -240);    // 01:00 UTC
  assert.ok(usa > china);
});

test('GPS timestamp supplies the offset when EXIF has none, and rejects stale fixes', () => {
  assert.strictEqual(CT.offsetFromGps(parts(2024, 10, 2, 8, 0, 5), '2024:10:02', [0, 0, 3]), 480);
  assert.strictEqual(CT.offsetFromGps(parts(2024, 10, 1, 20, 0, 0), '2024:10:02', [0, 0, 0]), -240);
  assert.strictEqual(CT.offsetFromGps(parts(2024, 10, 2, 8, 0, 0), '2024:10:02', [0, 7, 0]), null); // 7 min from the 15-min grid: a stale fix
  assert.strictEqual(CT.offsetFromGps(parts(2024, 10, 2, 8, 0, 0), undefined, undefined), null);
});

test('with no offset the device time zone is assumed (the wall clock is unchanged)', () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.strictEqual(CT.captureSortFromParts(parts(2024, 7, 4, 12, 0, 0), null), '2024-07-04 16:00:00');
    process.env.TZ = 'Asia/Shanghai';
    assert.strictEqual(CT.captureSortFromParts(parts(2024, 7, 4, 12, 0, 0), null), '2024-07-04 04:00:00');
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
});

test('file modification time is the last resort and keeps its exact moment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
  try {
    const f = path.join(dir, '2019-05-05 12.00.00.txt'); // a file name date must be ignored
    fs.writeFileSync(f, 'x');
    const mtime = new Date(Date.UTC(2021, 2, 4, 5, 6, 7));
    fs.utimesSync(f, mtime, mtime);
    const meta = await extractItemMetadata({ fullPath: f, filename: path.basename(f), extension: 'txt', mediaType: 'image' });
    assert.strictEqual(meta.capture_time_source, 'file_mtime');
    assert.strictEqual(meta.capture_sort, '2021-03-04 05:06:07');
    const d = new Date(mtime.getTime());
    const pad = (n) => String(n).padStart(2, '0');
    assert.strictEqual(meta.capture_time_local, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a JPEG shows its EXIF wall clock untouched and sorts by its own offset', async () => {
  const sharp = require('sharp');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
  try {
    const make = async (name, stamp, offset) => {
      const file = path.join(dir, name);
      const ifd2 = { DateTimeOriginal: stamp };
      if (offset) ifd2.OffsetTimeOriginal = offset;
      await sharp({ create: { width: 64, height: 48, channels: 3, background: '#888' } }).withExif({ IFD2: ifd2 }).jpeg().toFile(file);
      return extractItemMetadata({ fullPath: file, filename: name, extension: 'jpg', mediaType: 'image' });
    };
    const china = await make('a.jpg', '2024:10:02 08:00:00', '+08:00');
    const usa = await make('b.jpg', '2024:10:01 21:00:00', '-04:00');
    assert.strictEqual(china.capture_time_local, '2024-10-02 08:00:00');
    assert.strictEqual(usa.capture_time_local, '2024-10-01 21:00:00');
    assert.strictEqual(china.capture_time_source, 'exif_original');
    assert.strictEqual(china.capture_sort, '2024-10-02 00:00:00');
    assert.strictEqual(usa.capture_sort, '2024-10-02 01:00:00');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function seed(db, rows) {
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/a','a',0)").run();
  const ins = db.prepare("INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime, capture_time_local, capture_sort, capture_date, capture_year, capture_month, created_at, updated_at) VALUES (1,@p,@p,'image','jpg',1,1,@l,@s,@d,@y,@m,0,0)");
  for (const r of rows) ins.run({ p: r.p, l: r.local, s: r.sort, d: r.local.slice(0, 10), y: Number(r.local.slice(0, 4)), m: Number(r.local.slice(5, 7)) });
}

test('the grid orders on the sort key; sections are runs of the shown date, paged by exact cursors', () => {
  const db = freshDb();
  seed(db, [
    { p: 'china', local: '2024-10-02 08:00:00', sort: '2024-10-02 00:00:00' },
    { p: 'usa', local: '2024-10-01 21:00:00', sort: '2024-10-02 01:00:00' },
    { p: 'usa2', local: '2024-10-01 20:00:00', sort: '2024-10-02 00:00:30' },
    { p: 'old', local: '2024-09-30 09:00:00', sort: '2024-09-30 09:00:00' },
  ]);
  const page = Q.getItemsPage(db, { limit: 10 });
  assert.deepStrictEqual(page.items.map((i) => i.capture_time_local), [
    '2024-10-01 21:00:00', '2024-10-01 20:00:00', '2024-10-02 08:00:00', '2024-09-30 09:00:00']);
  const sections = Q.getCountsByDate(db, {});
  assert.deepStrictEqual(sections.map((s) => [s.date, s.count]), [
    ['2024-10-01', 2], ['2024-10-02', 1], ['2024-09-30', 1]]);
  // the cursor of a section is its last item: paging from it yields the next section first
  const next = Q.getItemsPage(db, { limit: 1, cursor: sections[0].cursor });
  assert.strictEqual(next.items[0].capture_time_local, '2024-10-02 08:00:00');
  // the item index agrees with the page order
  const id = page.items[2].id;
  assert.strictEqual(Q.getItemIndex(db, { id }), 2);
});

test('upgrading from version 18 adds capture_sort and moves every time index onto it', () => {
  const db = freshDb(18);
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/a','a',0)").run();
  db.prepare("INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime, capture_time_local, created_at, updated_at) VALUES (1,'x','x','image','jpg',123,456,'2020-01-02 03:04:05',0,0)").run();
  const before = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql LIKE '%capture_time_local%'").all().map((r) => r.name).sort();
  assert.ok(before.length > 5);
  runMigrations(db);
  const row = db.prepare('SELECT capture_time_local, capture_sort, file_mtime, file_size_bytes FROM items').get();
  assert.deepStrictEqual(row, { capture_time_local: '2020-01-02 03:04:05', capture_sort: '2020-01-02 03:04:05', file_mtime: 456, file_size_bytes: 123 });
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND sql LIKE '%capture_time_local%'").get().n, 0);
  const after = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql LIKE '%capture_sort%'").all().map((r) => r.name).sort();
  assert.deepStrictEqual(after, before);
});
