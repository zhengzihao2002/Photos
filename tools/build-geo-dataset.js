/**
 * tools/build-geo-dataset.js  (M7.3, dev-time only; not shipped)
 *
 * Builds resources/geo/places.json from raw GeoNames dumps placed in
 * .dev-data/geo-build/ (cities500.zip, admin1CodesASCII.txt,
 * alternateNamesV2.zip). Run from the project root:
 *   node tools/build-geo-dataset.js
 * Bump DATASET_VERSION whenever the output changes, so stored place names
 * are recomputed (see items.place_version).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, execFileSync } = require('child_process');

const DATASET_VERSION = 1;
const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, '.dev-data', 'geo-build');
const OUT_DIR = path.join(ROOT, 'resources', 'geo');
const OUT = path.join(OUT_DIR, 'places.json');
const DROP_CODES = new Set(['PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
const ZH_RANK = { 'zh-Hans': 4, 'zh-CN': 4, 'zh-SG': 4, zh: 3, 'zh-Hant': 1, 'zh-TW': 1, 'zh-HK': 1 };
const HAN = /[\u3400-\u9fff]/;

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

function unzipLines(zipName, entry, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', path.join(RAW, zipName), entry]);
    child.on('error', reject);
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', onLine);
    rl.on('close', resolve);
  });
}

// GeoNames files many names under a generic "zh" tag without saying which
// script, so chosen names are normalised to Simplified with the converter
// built into macOS (dev-time only; the shipped app never calls this).
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
  const inFile = path.join(RAW, 'zh-in.tmp');
  const outFile = path.join(RAW, 'zh-out.tmp');
  fs.writeFileSync(inFile, names.join('\n'));
  try {
    execFileSync('osascript', ['-l', 'JavaScript', '-e', HANT_TO_HANS_JXA, inFile, outFile]);
    const out = fs.readFileSync(outFile, 'utf8').split('\n');
    if (out.length !== names.length) throw new Error('converter changed the number of names');
    return out;
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch (e) { /* not created */ } }
  }
}

async function main() {
  const started = Date.now();
  const wanted = new Map(); // geonameid -> ['p' | 'a', index]

  const admin1 = { keys: [], en: [], zh: [] };
  const admin1Index = new Map();
  for (const line of fs.readFileSync(path.join(RAW, 'admin1CodesASCII.txt'), 'utf8').split('\n')) {
    const c = line.split('\t');
    if (c.length < 4) continue;
    admin1Index.set(c[0], admin1.keys.length);
    wanted.set(c[3].trim(), ['a', admin1.keys.length]);
    admin1.keys.push(c[0]); admin1.en.push(c[1]); admin1.zh.push('');
  }

  const countries = [];
  const countryIndex = new Map();
  const P = { lat: [], lng: [], pop: [], cc: [], a1: [], sec: [], en: [], zh: [] };
  await unzipLines('cities500.zip', 'cities500.txt', (line) => {
    const c = line.split('\t');
    if (c.length < 15 || DROP_CODES.has(c[7]) || !c[8]) return;
    const lat = Number(c[4]);
    const lng = Number(c[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!countryIndex.has(c[8])) { countryIndex.set(c[8], countries.length); countries.push(c[8]); }
    const a1 = admin1Index.get(c[8] + '.' + c[10]);
    wanted.set(c[0], ['p', P.en.length]);
    P.lat.push(Math.round(lat * 1e4) / 1e4);
    P.lng.push(Math.round(lng * 1e4) / 1e4);
    P.pop.push(Number(c[14]) || 0);
    P.cc.push(countryIndex.get(c[8]));
    P.a1.push(a1 === undefined ? -1 : a1);
    P.sec.push(c[7] === 'PPLX' ? 1 : 0);
    P.en.push(c[1]);
    P.zh.push('');
  });
  console.log('places read:', P.en.length, '| regions:', admin1.keys.length);

  const bestScore = new Map();
  let scanned = 0;
  await unzipLines('alternateNamesV2.zip', 'alternateNamesV2.txt', (line) => {
    scanned += 1;
    if (scanned % 4000000 === 0) console.log('  alternate names scanned:', scanned);
    if (line.indexOf('\tzh') === -1) return;
    const c = line.split('\t');
    const rank = ZH_RANK[c[2]];
    const target = wanted.get(c[1]);
    if (!rank || !target) return;
    if (c[6] === '1' || c[7] === '1') return; // colloquial or historic
    const name = c[3];
    if (!name || !HAN.test(name)) return;
    const score = rank * 100 + (c[4] === '1' ? 10 : 0) + (c[5] === '1' ? 1 : 0);
    if ((bestScore.get(c[1]) || 0) >= score) return;
    bestScore.set(c[1], score);
    if (target[0] === 'p') P.zh[target[1]] = name; else admin1.zh[target[1]] = name;
  });

  const converted = toSimplified(['紐約市', ...P.zh, ...admin1.zh]);
  if (converted[0] !== '纽约市') throw new Error('Traditional-to-Simplified check failed, got: ' + converted[0]);
  let changedNames = 0;
  P.zh.forEach((z, i) => { const s = converted[1 + i]; if (s !== z) { changedNames += 1; P.zh[i] = s; } });
  admin1.zh.forEach((z, i) => {
    const s = converted[1 + P.zh.length + i];
    if (s !== z) { changedNames += 1; admin1.zh[i] = s; }
  });
  console.log('Chinese names converted to Simplified:', changedNames);

  const sourceFiles = {};
  for (const f of ['cities500.zip', 'admin1CodesASCII.txt', 'alternateNamesV2.zip']) {
    sourceFiles[f] = await sha256(path.join(RAW, f));
  }
  const out = {
    datasetVersion: DATASET_VERSION,
    generated: new Date().toISOString().slice(0, 10),
    attribution: 'Place names: GeoNames (geonames.org), CC BY 4.0',
    sourceFiles,
    countries,
    admin1,
    places: { count: P.en.length, ...P },
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(out));
  fs.renameSync(OUT + '.tmp', OUT);

  const pct = (arr) => (100 * arr.filter(Boolean).length / arr.length).toFixed(1) + '%';
  const cn = countryIndex.get('CN');
  const cnZh = P.zh.filter((z, i) => P.cc[i] === cn);
  console.log('alternate names scanned:', scanned);
  console.log('places with a Chinese name:', pct(P.zh), '| in China:', pct(cnZh), '| regions:', pct(admin1.zh));
  for (const name of ['Shanghai', 'Beijing', 'San Francisco', 'New York City', 'Tokyo', 'Paris']) {
    let best = -1;
    P.en.forEach((en, i) => { if (en === name && (best === -1 || P.pop[i] > P.pop[best])) best = i; });
    if (best === -1) { console.log('  sample', name, '=> NOT FOUND'); continue; }
    const a = P.a1[best];
    console.log('  sample', name, '=>', P.zh[best] || '(none)', '|', a === -1 ? '(no region)' : admin1.en[a] + ' / ' + (admin1.zh[a] || '(none)'), '|', countries[P.cc[best]]);
  }
  console.log('wrote', path.relative(ROOT, OUT), fs.statSync(OUT).size, 'bytes, sha256', await sha256(OUT));
  console.log('seconds:', ((Date.now() - started) / 1000).toFixed(1));
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
