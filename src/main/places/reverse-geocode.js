/**
 * reverse-geocode.js  (M7.3)
 *
 * Offline reverse geocoding: coordinates -> nearest meaningful populated
 * place, from resources/geo/places.json (built by tools/build-geo-dataset.js
 * from GeoNames, CC BY 4.0). No Electron dependency: the caller passes the
 * dataset path, so this runs in the scan worker and in plain Node tests.
 *
 * Structure: a fixed 0.25-degree grid in CSR form (cellStart + order typed
 * arrays). A lookup scans the cells around the point; columns wrap, so the
 * antimeridian needs no special case, and the column radius widens with
 * latitude because cells get narrower toward the poles.
 *
 * Choice rule: (1) if the point lies in the core of a city of 1M+ people
 * (coreRadiusKm), that city wins, the most populous if several qualify, so
 * "Shanghai" beats its own districts; (2) otherwise the nearest
 * non-neighbourhood place; (3) otherwise the nearest entry of any kind;
 * (2) and (3) only within MAX_NEAREST_KM. Otherwise null (no place name).
 * Without boundary data a separate city inside a megacity's core takes the
 * megacity's name (documented limitation).
 */

const fs = require('fs');

const CELL_DEG = 0.25;
const COLS = 1440;
const ROWS = 720;
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LNG = 111.32;
const MAX_NEAREST_KM = 100;

function coreRadiusKm(population) {
  if (population >= 8000000) return 20;
  if (population >= 2000000) return 12;
  if (population >= 1000000) return 8;
  return 0;
}

function createReverseGeocoder(datasetPath) {
  const data = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const P = data.places;
  const n = P.count;
  const lat = Float64Array.from(P.lat);
  const lng = Float64Array.from(P.lng);

  const rowOf = (la) => Math.min(ROWS - 1, Math.max(0, Math.floor((la + 90) / CELL_DEG)));
  const colOf = (lo) => ((Math.floor((lo + 180) / CELL_DEG) % COLS) + COLS) % COLS;

  const cellStart = new Int32Array(ROWS * COLS + 1);
  for (let i = 0; i < n; i += 1) cellStart[rowOf(lat[i]) * COLS + colOf(lng[i]) + 1] += 1;
  for (let c = 0; c < ROWS * COLS; c += 1) cellStart[c + 1] += cellStart[c];
  const fill = cellStart.slice(0, ROWS * COLS);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const cell = rowOf(lat[i]) * COLS + colOf(lng[i]);
    order[fill[cell]] = i;
    fill[cell] += 1;
  }

  function lookup(la, lo) {
    if (typeof la !== 'number' || typeof lo !== 'number' || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
    const cosLat = Math.max(0.01, Math.cos((la * Math.PI) / 180));
    const row0 = rowOf(la);
    const col0 = colOf(lo);
    let cover = -1; let coverPop = 0; let coverKm = Infinity;
    let main = -1; let mainKm = Infinity;
    let any = -1; let anyKm = Infinity;

    // Inner window (2 rows = 55 km) always contains every covering place
    // (largest core radius is 20 km); the outer window only runs when the inner
    // one is completely empty.
    for (const rowRadius of [2, 4]) {
      const colRadius = Math.min(COLS / 2, Math.ceil(rowRadius / cosLat));
      for (let r = Math.max(0, row0 - rowRadius); r <= Math.min(ROWS - 1, row0 + rowRadius); r += 1) {
        for (let dc = -colRadius; dc <= colRadius; dc += 1) {
          const cell = r * COLS + ((((col0 + dc) % COLS) + COLS) % COLS);
          for (let k = cellStart[cell]; k < cellStart[cell + 1]; k += 1) {
            const i = order[k];
            let dLng = lng[i] - lo;
            if (dLng > 180) dLng -= 360; else if (dLng < -180) dLng += 360;
            const dx = dLng * cosLat * KM_PER_DEG_LNG;
            const dy = (lat[i] - la) * KM_PER_DEG_LAT;
            const km = Math.sqrt(dx * dx + dy * dy);
            if (km < anyKm) { anyKm = km; any = i; }
            if (P.sec[i] === 1) continue;
            if (km < mainKm) { mainKm = km; main = i; }
            if (P.pop[i] > coverPop && km <= coreRadiusKm(P.pop[i])) {
              coverPop = P.pop[i]; cover = i; coverKm = km;
            }
          }
        }
      }
      if (any !== -1) break;
    }

    let chosen = -1; let chosenKm = Infinity;
    if (cover !== -1) { chosen = cover; chosenKm = coverKm; }
    else if (main !== -1 && mainKm <= MAX_NEAREST_KM) { chosen = main; chosenKm = mainKm; }
    else if (any !== -1 && anyKm <= MAX_NEAREST_KM) { chosen = any; chosenKm = anyKm; }
    if (chosen === -1) return null;

    const a1 = P.a1[chosen];
    return {
      localityEn: P.en[chosen],
      localityZh: P.zh[chosen] || null,
      regionEn: a1 === -1 ? null : data.admin1.en[a1],
      regionZh: a1 === -1 ? null : (data.admin1.zh[a1] || null),
      countryCode: data.countries[P.cc[chosen]],
      distanceKm: Math.round(chosenKm * 10) / 10,
    };
  }

  return { lookup, datasetVersion: data.datasetVersion, placeCount: n, attribution: data.attribution };
}

module.exports = { createReverseGeocoder };
