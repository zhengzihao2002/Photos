/**
 * place-resolver.js  (M13)
 *
 * One lookup for everything the place pass stores: the city/region/country
 * from reverse-geocode.js plus the landmark from landmarks.js. A missing or
 * unreadable landmarks file means "no landmarks", never a failed scan.
 *
 * datasetVersion is places*100 + landmarks, so raising either dataset's
 * version makes the place pass recompute every row exactly once (rows are
 * stamped with it in items.place_version).
 */
const fs = require('fs');
const path = require('path');
const { createReverseGeocoder } = require('./reverse-geocode');
const { createLandmarkFinder } = require('./landmarks');

function createPlaceResolver(placesPath, landmarksPath) {
  const geocoder = createReverseGeocoder(placesPath);
  let finder = null;
  const file = landmarksPath || path.join(path.dirname(placesPath), 'landmarks.json');
  try {
    if (fs.existsSync(file)) finder = createLandmarkFinder(file);
  } catch (err) {
    finder = null;
  }
  return {
    datasetVersion: geocoder.datasetVersion * 100 + (finder ? finder.datasetVersion : 0),
    hasLandmarks: !!finder,
    lookup(lat, lng) {
      const place = geocoder.lookup(lat, lng);
      const lm = finder ? finder.lookup(lat, lng) : null;
      if (!place && !lm) return null;
      return {
        localityEn: place ? place.localityEn : null,
        localityZh: place ? place.localityZh : null,
        regionEn: place ? place.regionEn : null,
        regionZh: place ? place.regionZh : null,
        countryCode: place ? place.countryCode : lm.countryCode,
        distanceKm: place ? place.distanceKm : null,
        landmarkId: lm ? lm.landmarkId : null,
        landmarkEn: lm ? lm.landmarkEn : null,
        landmarkZh: lm ? lm.landmarkZh : null,
      };
    },
  };
}

/**
 * The version createPlaceResolver would report, read from the first bytes of
 * each file (both datasets start with {"datasetVersion":N,...}), so the place
 * pass can skip loading ~12 MB of JSON when no row needs work.
 */
function peekDatasetVersion(placesPath, landmarksPath) {
  const peek = (file) => {
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(64);
        const len = fs.readSync(fd, buf, 0, 64, 0);
        const m = /"datasetVersion"\s*:\s*(\d+)/.exec(buf.toString('utf8', 0, len));
        return m ? Number(m[1]) : null;
      } finally { fs.closeSync(fd); }
    } catch (err) { return null; }
  };
  const file = landmarksPath || path.join(path.dirname(placesPath), 'landmarks.json');
  const places = peek(placesPath);
  if (places === null) return null;
  return places * 100 + (peek(file) || 0);
}

module.exports = { createPlaceResolver, peekDatasetVersion };
