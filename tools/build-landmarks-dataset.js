/**
 * tools/build-landmarks-dataset.js  (M13, dev/CI-time only; not shipped)
 *
 * Builds resources/geo/landmarks.json (+ landmarks.json.sha256) from the
 * GeoNames dumps allCountries.zip and alternateNamesV2.zip (CC BY 4.0).
 *
 *   node tools/build-landmarks-dataset.js            # downloads into .cache/geo-build if missing
 *   node tools/build-landmarks-dataset.js --raw DIR  # use files already in DIR
 *
 * Which records count as landmarks
 *   1. Feature code is in LANDMARK_CODES below (parks, reserves, mountains,
 *      peaks, volcanoes, lakes, islands, beaches, waterfalls, bridges, dams,
 *      monuments, castles, temples, churches, mosques, museums, stadiums, zoos,
 *      airports, towers, historic sites, ...). Each code has a match radius in
 *      metres (small for buildings, large for parks, lakes, mountains).
 *   2. Notability (GeoNames has no popularity score): the record has an English
 *      Wikipedia/Wikidata-style "link" in the alternate names file, OR it has
 *      names in at least MIN_LANGUAGES languages. Airports and churches need the
 *      Wikipedia link (their raw counts are huge).
 *   Rank (0-255) = 10 if linked + number of name languages, capped. It breaks ties.
 *
 * Chinese names: only Simplified. Tags zh-Hans / zh-CN / zh-SG are taken as is;
 * the generic "zh" tag and traditional tags are converted to Simplified with the
 * macOS text transform (this tool is run on a macOS CI runner for that reason;
 * on other systems records with only a traditional/generic name keep English).
 *
 * Bump DATASET_VERSION whenever the output changes: stored landmark names are
 * recomputed (see src/main/places/place-resolver.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, execFileSync } = require('child_process');

const DATASET_VERSION = 1;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'resources', 'geo');
const OUT = path.join(OUT_DIR, 'landmarks.json');
const MIN_LANGUAGES = 6;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

// feature code -> [radius metres, needsWikipediaLink]
const LANDMARK_CODES = {
  // parks and reserves
  PRK: [2500, false], RES: [4000, false], RESN: [4000, false], RESV: [4000, false], RESW: [4000, false], RESF: [3000, true],
  GDN: [300, true], ZOO: [500, false], PRKN: [4000, false],
  // mountains and natural features
  MT: [3000, false], MTS: [6000, false], PK: [800, false], PKS: [1500, false], VLC: [3000, false], CNYN: [5000, false],
  GLCR: [3000, false], FLLS: [400, false], CAVE: [250, true], CLF: [500, true], ARCH: [200, false],
  // water and coast
  LK: [3000, false], LKS: [5000, false], RSV: [2500, true], ISL: [5000, false], ISLS: [8000, false], BCH: [800, false],
  BAY: [4000, true], CAPE: [1000, true], FJD: [6000, true], STRT: [3000, true],
  // built landmarks
  BDG: [400, false], DAM: [500, false], MNMT: [200, false], CSTL: [350, false], FT: [300, false], PAL: [300, false],
  TMPL: [250, false], SHRN: [200, false], MSQE: [200, false], CH: [150, true], CTHDRL: [200, false], MSTY: [250, true],
  MUS: [150, true], STDM: [350, false], AIRP: [1500, true], TOWR: [150, false], LTHSE: [150, false], OPRA: [150, false],
  THTR: [120, true], PYR: [250, false], PYRS: [400, false], HSTS: [400, false], RUIN: [400, false], AMTH: [250, false],
  SQR: [250, true], MALL: [250, true], UNIV: [500, true], HSP: [300, true], LIBR: [120, true], TRIN: [200, true],
  OBPT: [300, true],
};

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

function arg(name) { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; }
const RAW = arg('--raw') || path.join(ROOT, '.cache', 'geo-build');

function download(name) {
  const file = path.join(RAW, name);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(RAW, { recursive: true });
  console.log('downloading', name);
  execFileSync('curl', ['-fL', '--retry', '3', '-o', file, 'https://download.geonames.org/export/dump/' + name], { stdio: 'inherit' });
  return file;
}

function unzipLines(zipFile, entry, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', zipFile, entry]);
    child.on('error', reject);
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', onLine);
    rl.on('close', resolve);
  });
}

const ZH_RANK = { 'zh-Hans': 4, 'zh-CN': 4, 'zh-SG': 4, zh: 3, 'zh-Hant': 1, 'zh-TW': 1, 'zh-HK': 1 };
const HAN = /[㐀-鿿]/;
const HANT_TO_HANS_JXA = [
  'ObjC.import("Foundation");',
  'function run(argv) {',
  '  var s = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);',
  '  var t = s.stringByApplyingTransformReverse("Hant-Hans", false);',
  '  t.writeToFileAtomicallyEncodingError(argv[1], true, $.NSUTF8StringEncoding, null);',
  '  return "ok";',
  '}',
].join('\n');

function toSimplified(names) {
  if (process.platform !== 'darwin') return null;
  const inFile = path.join(RAW, 'zh-in.tmp');
  const outFile = path.join(RAW, 'zh-out.tmp');
  fs.writeFileSync(inFile, names.join('\n'));
  try {
    execFileSync('osascript', ['-l', 'JavaScript', '-e', HANT_TO_HANS_JXA, inFile, outFile]);
    const out = fs.readFileSync(outFile, 'utf8').split('\n');
    return out.length === names.length ? out : null;
  } catch (e) {
    return null;
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch (e) { /* not created */ } }
  }
}

async function main() {
  const started = Date.now();
  const allCountries = download('allCountries.zip');
  const altNames = download('alternateNamesV2.zip');

  // Pass 1: candidates by feature code.
  const cand = new Map(); // geonameid -> record
  let scanned = 0;
  await unzipLines(allCountries, 'allCountries.txt', (line) => {
    scanned += 1;
    const c = line.split('\t');
    if (c.length < 15 || c[6] === 'P' || c[6] === 'A') return;
    const spec = LANDMARK_CODES[c[7]];
    if (!spec) return;
    const lat = Number(c[4]); const lng = Number(c[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !c[1]) return;
    cand.set(c[0], { id: Number(c[0]), name: c[1], lat, lng, code: c[7], cc: c[8], radius: spec[0], needsLink: spec[1],
      langs: '', nLangs: 0, linked: false, enPref: null, zh: '', zhScore: 0 });
  });
  console.log('rows scanned:', scanned, '| candidates:', cand.size);

  // Pass 2: alternate names -> notability and Chinese names.
  let altScanned = 0;
  await unzipLines(altNames, 'alternateNamesV2.txt', (line) => {
    altScanned += 1;
    if (altScanned % 5000000 === 0) console.log('  alternate names scanned:', altScanned);
    const c = line.split('\t');
    const r = cand.get(c[1]);
    if (!r) return;
    const lang = c[2];
    if (lang === 'link') { if (c[3] && c[3].indexOf('wikipedia.org') !== -1) r.linked = true; return; }
    if (!lang || lang.length > 7 || lang === 'post' || lang === 'iata' || lang === 'icao' || lang === 'faac' || lang === 'abbr'
      || lang === 'wkdt' || lang === 'unlc' || lang === 'tcid' || lang === 'phon' || lang === 'fr_1793' || lang === 'lang') return;
    const base = ' ' + lang.split('-')[0] + ' ';
    if (r.langs.indexOf(base) === -1) { r.langs += base; r.nLangs += 1; } // string, not a Set: millions of records
    if (lang === 'en' && c[4] === '1' && c[6] !== '1' && c[7] !== '1') r.enPref = c[3];
    const zr = ZH_RANK[lang];
    if (zr && HAN.test(c[3] || '') && c[6] !== '1' && c[7] !== '1') {
      const score = zr * 100 + (c[4] === '1' ? 10 : 0) + (c[5] === '1' ? 1 : 0);
      if (score > r.zhScore) { r.zhScore = score; r.zh = c[3]; }
    }
  });

  // Filter on notability, dedupe.
  const kept = [];
  for (const r of cand.values()) {
    const notable = r.linked || (!r.needsLink && r.nLangs >= MIN_LANGUAGES);
    if (!notable) continue;
    r.rank = Math.min(255, (r.linked ? 10 : 0) + r.nLangs);
    kept.push(r);
  }
  kept.sort((a, b) => b.rank - a.rank || a.id - b.id);
  const seen = new Set();
  const finalList = [];
  for (const r of kept) {
    const en = r.enPref || r.name;
    const key = en.toLowerCase() + '|' + Math.round(r.lat * 200) + '|' + Math.round(r.lng * 200);
    if (seen.has(key)) continue;
    seen.add(key);
    r.en = en;
    finalList.push(r);
  }
  finalList.sort((a, b) => a.id - b.id);

  // Large protected areas are recorded by one centre point: widen their match radius by name.
  const PARK_CODES = new Set(['PRK', 'RES', 'RESN', 'RESV', 'RESW', 'RESF', 'PRKN']);
  for (const r of finalList) {
    if (!PARK_CODES.has(r.code)) continue;
    if (/national park|nationalpark|parc national|parque nacional|国家公园/i.test(r.en)) r.radius = 20000;
    else if (/national (forest|monument|recreation area|seashore|lakeshore|preserve|grassland|wildlife refuge|reserve)|wilderness/i.test(r.en)) r.radius = 8000;
    else if (/(state|provincial|regional|county) park|nature reserve|wildlife (reserve|sanctuary|refuge|area)/i.test(r.en)) r.radius = 6000;
  }

  // Chinese: tags zh-Hans/zh-CN/zh-SG kept; others converted with the macOS transform.
  const needConv = finalList.filter((r) => r.zh && r.zhScore < 400);
  if (needConv.length) {
    const conv = toSimplified(needConv.map((r) => r.zh));
    if (conv) needConv.forEach((r, i) => { r.zh = conv[i]; });
    else { console.log('no Hant->Hans converter here; dropping', needConv.length, 'generic/traditional Chinese names'); needConv.forEach((r) => { r.zh = ''; }); }
  }

  const countries = []; const cIndex = new Map();
  const L = { gid: [], lat: [], lng: [], rad: [], rank: [], cc: [], en: [], zh: [] };
  for (const r of finalList) {
    if (!cIndex.has(r.cc)) { cIndex.set(r.cc, countries.length); countries.push(r.cc); }
    L.gid.push(r.id);
    L.lat.push(Math.round(r.lat * 1e4) / 1e4);
    L.lng.push(Math.round(r.lng * 1e4) / 1e4);
    L.rad.push(r.radius);
    L.rank.push(r.rank);
    L.cc.push(cIndex.get(r.cc));
    L.en.push(r.en);
    L.zh.push(r.zh || '');
  }

  const sourceFiles = {};
  for (const f of ['allCountries.zip', 'alternateNamesV2.zip']) sourceFiles[f] = await sha256(path.join(RAW, f));
  const out = {
    datasetVersion: DATASET_VERSION,
    generated: new Date().toISOString().slice(0, 10),
    attribution: 'Landmark names: GeoNames (geonames.org), CC BY 4.0',
    sourceFiles,
    countries,
    landmarks: { count: L.gid.length, ...L },
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const text = JSON.stringify(out);
  if (text.length > MAX_OUTPUT_BYTES) throw new Error('landmark dataset too large: ' + text.length + ' bytes (limit ' + MAX_OUTPUT_BYTES + ')');
  fs.writeFileSync(OUT + '.tmp', text);
  fs.renameSync(OUT + '.tmp', OUT);
  const digest = await sha256(OUT);
  fs.writeFileSync(OUT + '.sha256', digest + '  landmarks.json\n');
  const zhCount = L.zh.filter(Boolean).length;
  console.log('landmarks:', L.gid.length, '| with Chinese name:', zhCount, '(' + (100 * zhCount / L.gid.length).toFixed(1) + '%)');
  console.log('wrote', path.relative(ROOT, OUT), fs.statSync(OUT).size, 'bytes, sha256', digest);
  for (const name of ['Eiffel Tower', 'Golden Gate Bridge', 'Yosemite National Park', 'Lake Tahoe', 'Mount Fuji']) {
    const i = L.en.findIndex((n) => n.indexOf(name) !== -1);
    console.log('  sample', name, '=>', i === -1 ? 'NOT FOUND' : L.en[i] + ' / ' + (L.zh[i] || '(no zh)') + ' @' + L.lat[i] + ',' + L.lng[i]);
  }
  console.log('seconds:', ((Date.now() - started) / 1000).toFixed(1));
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
