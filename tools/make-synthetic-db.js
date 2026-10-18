/**
 * tools/make-synthetic-db.js  (M8d.1)
 *
 * Builds a reproducible synthetic library at the latest schema: 100,000+ rows
 * spread over ~20 years with bursts and gaps, photos and videos, favourites,
 * titles, thousands of distinct keywords, GPS for a share of rows, a few
 * hundred people with faces, Live Photos, bursts, RAW, tombstones.
 *
 *   node tools/make-synthetic-db.js --out /path/lib.db [--rows 100000] [--seed 1]
 * Also used as a module by tools/bench-scale.js.
 */
const fs = require('fs');
const path = require('path');

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const CITIES = [[48.8566, 2.3522], [40.7128, -74.006], [35.6762, 139.6503], [37.7749, -122.4194], [51.5074, -0.1278], [-33.8688, 151.2093], [31.2304, 121.4737], [39.9042, 116.4074], [19.4326, -99.1332], [-22.9068, -43.1729]];
const WORDS = ['beach', 'family', 'birthday', 'hike', 'sunset', 'dog', 'cat', 'wedding', 'road', 'trip', 'snow', 'party', 'kids', 'garden', 'city', 'mountain', 'lake', 'museum', 'food', 'night'];

function build(db, { rows = 100000, seed = 1 } = {}) {
  const rand = rng(seed);
  const now = 1700000000;
  db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/synthetic/a','A',0),('/synthetic/b','B',0),('/synthetic/c','C',0)").run();
  const insert = db.prepare(`INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime, width, height,
    duration_seconds, capture_time_local, capture_date, capture_year, capture_month, lens_model, gps_latitude, gps_longitude, has_gps, is_raw, is_gif,
    is_panorama, is_live_photo, is_live_photo_component, burst_id, is_burst_cover, is_deleted, is_favorite, title_user, rotation, created_at, updated_at,
    place_locality_en, place_country_code, place_version, thumb_sm_status, face_version)
    VALUES (@s,@p,@f,@m,@e,@size,@mtime,4000,3000,@dur,@t,@d,@y,@mo,@lens,@lat,@lng,@gps,@raw,@gif,@pano,@live,@comp,@burst,@cover,@del,@fav,@title,@rot,@c,@c,@city,'XX',101,'done',1)`);
  const t0 = Date.UTC(2006, 0, 1) / 1000;
  const span = (Date.UTC(2026, 0, 1) / 1000) - t0;
  let n = 0; let cursor = t0; let burstSeq = 0;
  const tx = db.transaction(() => {
    while (n < rows) {
      // sessions of activity separated by gaps: realistic clustering
      cursor += Math.floor(rand() * (span / (rows / 6)) * 4);
      if (cursor > t0 + span) cursor = t0 + Math.floor(rand() * span);
      const perSession = 1 + Math.floor(rand() * 12);
      const city = CITIES[Math.floor(rand() * CITIES.length)];
      const located = rand() < 0.45;
      for (let k = 0; k < perSession && n < rows; k += 1) {
        const ts = cursor + k * (5 + Math.floor(rand() * 90));
        const dt = new Date(ts * 1000);
        const iso = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
        const isVideo = rand() < 0.07;
        const burst = !isVideo && rand() < 0.03;
        const members = burst ? 3 : 1;
        const burstId = burst ? 'B' + (burstSeq += 1) : null;
        for (let m = 0; m < members && n < rows; m += 1) {
          const live = !isVideo && !burst && rand() < 0.05;
          insert.run({
            s: 1 + Math.floor(rand() * 3), p: 'd' + (n % 400) + '/IMG_' + n + (isVideo ? '.mov' : '.jpg'), f: 'IMG_' + n + (isVideo ? '.mov' : '.jpg'),
            m: isVideo ? 'video' : 'image', e: isVideo ? 'mov' : 'jpg', size: 100000 + Math.floor(rand() * 9e6), mtime: now + n,
            dur: isVideo ? 3 + rand() * 120 : null, t: `${iso} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`,
            d: iso, y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, lens: rand() < 0.1 ? 'front camera' : 'back camera',
            lat: located ? city[0] + (rand() - 0.5) * 0.4 : null, lng: located ? city[1] + (rand() - 0.5) * 0.4 : null, gps: located ? 1 : 0,
            raw: rand() < 0.02 ? 1 : 0, gif: rand() < 0.005 ? 1 : 0, pano: rand() < 0.01 ? 1 : 0, live: live ? 1 : 0, comp: 0,
            burst: burstId, cover: burst && m === 0 ? 1 : 0, del: rand() < 0.01 ? 1 : 0, fav: rand() < 0.04 ? 1 : 0,
            title: rand() < 0.05 ? 'Title ' + WORDS[Math.floor(rand() * WORDS.length)] + ' ' + n : null, rot: rand() < 0.02 ? 90 : 0, c: now,
            city: located ? 'City' + CITIES.indexOf(city) : null,
          });
          n += 1;
        }
      }
    }
  });
  tx();

  // keywords: thousands of distinct, a few per item for 30% of items
  const addK = db.prepare('INSERT OR IGNORE INTO keywords (name) VALUES (?)');
  const kwTx = db.transaction(() => {
    for (let i = 0; i < 4000; i += 1) addK.run(WORDS[i % WORDS.length] + '-' + Math.floor(i / WORDS.length));
    const link = db.prepare('INSERT OR IGNORE INTO item_keywords (item_id, keyword_id, origin) VALUES (?,?,0)');
    for (let id = 1; id <= n; id += 1) if (rand() < 0.3) for (let j = 0; j < 3; j += 1) link.run(id, 1 + Math.floor(rand() * 4000));
  });
  kwTx();

  // people and faces
  const people = db.prepare('INSERT INTO people (name, created_at, updated_at) VALUES (?,?,?)');
  const face = db.prepare(`INSERT INTO faces (item_id, box_x, box_y, box_w, box_h, landmarks, score, size_px, embedding, person_id, assignment, created_at)
    VALUES (?,0.1,0.1,0.2,0.2,zeroblob(40),0.9,120,zeroblob(512),?, 'auto', ?)`);
  const pTx = db.transaction(() => {
    for (let i = 1; i <= 300; i += 1) people.run('Person ' + i, now, now);
    for (let id = 1; id <= n; id += 1) if (rand() < 0.12) face.run(id, 1 + Math.floor(rand() * 300), now);
  });
  pTx();
  db.exec('ANALYZE');
  return { rows: n };
}

module.exports = { build };

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i === -1 ? d : process.argv[i + 1]; };
  const out = arg('--out');
  if (!out) { console.error('usage: node tools/make-synthetic-db.js --out FILE [--rows N] [--seed N]'); process.exit(2); }
  const Database = require('better-sqlite3');
  const { migrations } = require('../src/main/index/migrations');
  fs.rmSync(out, { force: true });
  const db = new Database(out);
  db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL');
  for (const m of migrations) { m.up(db); db.pragma('user_version = ' + m.version); }
  const t = Date.now();
  const r = build(db, { rows: Number(arg('--rows', 100000)), seed: Number(arg('--seed', 1)) });
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('built', r.rows, 'rows in', Date.now() - t, 'ms ->', path.resolve(out));
}
