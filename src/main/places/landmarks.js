/**
 * landmarks.js  (M13)
 *
 * Offline landmark lookup: coordinates -> the nearest notable landmark whose
 * own radius contains the point (Eiffel Tower, Yosemite National Park, ...),
 * from resources/geo/landmarks.json (built by tools/build-landmarks-dataset.js
 * from GeoNames, CC BY 4.0). No Electron dependency, no network.
 *
 * Rule: among landmarks whose radius contains the point, the nearest wins;
 * landmarks within TIE_KM of each other in distance are ranked by notability
 * (rank), then by the smaller radius, then by id (stable). No street
 * addresses and no business names exist in the data.
 *
 * Index: 0.25-degree grid in CSR form, like reverse-geocode.js. Columns wrap
 * at the antimeridian; the column window widens with latitude. Near the
 * poles the cosine is clamped, so the window covers the whole ring.
 */
const fs = require('fs');

const CELL_DEG = 0.25;
const COLS = 1440;
const ROWS = 720;
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LNG = 111.32;
const TIE_KM = 0.05;

function haversineKm(la1, lo1, la2, lo2) {
  const r = Math.PI / 180;
  const dLat = (la2 - la1) * r;
  const dLng = (lo2 - lo1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function createLandmarkFinder(datasetPath) {
  const data = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  return createLandmarkFinderFromData(data);
}

function createLandmarkFinderFromData(data) {
  const L = data.landmarks;
  const n = L.count;
  const lat = Float64Array.from(L.lat);
  const lng = Float64Array.from(L.lng);
  const rad = Float64Array.from(L.rad, (m) => m / 1000); // km
  let maxRadKm = 0;
  for (let i = 0; i < n; i += 1) if (rad[i] > maxRadKm) maxRadKm = rad[i];

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
  const rowRadius = Math.max(1, Math.ceil(maxRadKm / (CELL_DEG * KM_PER_DEG_LAT)));

  function lookup(la, lo) {
    if (typeof la !== 'number' || typeof lo !== 'number' || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
    if (la < -90 || la > 90 || lo < -180 || lo > 360) return null;
    if (n === 0) return null;
    const cosLat = Math.max(1e-6, Math.cos((la * Math.PI) / 180));
    const row0 = rowOf(la);
    const col0 = colOf(lo);
    const colRadius = Math.min(COLS / 2, Math.ceil(rowRadius / cosLat));
    let best = -1; let bestKm = Infinity;
    for (let r = Math.max(0, row0 - rowRadius); r <= Math.min(ROWS - 1, row0 + rowRadius); r += 1) {
      for (let dc = -colRadius; dc <= colRadius; dc += 1) {
        const cell = r * COLS + ((((col0 + dc) % COLS) + COLS) % COLS);
        for (let k = cellStart[cell]; k < cellStart[cell + 1]; k += 1) {
          const i = order[k];
          const km = haversineKm(la, lo, lat[i], lng[i]);
          if (km > rad[i]) continue;
          if (best === -1) { best = i; bestKm = km; continue; }
          const closer = km < bestKm - TIE_KM;
          const tied = Math.abs(km - bestKm) <= TIE_KM;
          if (closer) { best = i; bestKm = km; continue; }
          if (tied) {
            if (L.rank[i] > L.rank[best] || (L.rank[i] === L.rank[best] && (rad[i] < rad[best] || (rad[i] === rad[best] && L.gid[i] < L.gid[best])))) {
              best = i; bestKm = km;
            }
          }
        }
      }
    }
    if (best === -1) return null;
    return {
      landmarkId: L.gid[best],
      landmarkEn: L.en[best],
      landmarkZh: L.zh[best] || null,
      countryCode: data.countries[L.cc[best]],
      distanceKm: Math.round(bestKm * 1000) / 1000,
    };
  }

  return { lookup, datasetVersion: data.datasetVersion, landmarkCount: n, attribution: data.attribution };
}

module.exports = { createLandmarkFinder, createLandmarkFinderFromData };
