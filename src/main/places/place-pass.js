/**
 * place-pass.js  (M7.3)
 *
 * Fills the items.place_* columns from stored GPS coordinates. Runs in the
 * scan worker after the directory walk; it never reads a source file.
 *
 * One path covers everything: a row needs work when place_version is NULL
 * (never computed, or just written by a full extraction) or older than the
 * loaded dataset. Resumable by construction: a processed row is stamped
 * with the dataset version and no longer matches. Rows without GPS, or with
 * no place in range, get NULL names and are stamped too, so they are not
 * revisited on every scan.
 *
 * Deliberately does not touch file_mtime / file_size_bytes (thumbnail reset
 * trigger) or updated_at (deletion sweep).
 */

function runPlacePass(db, geocoder) {
  const started = Date.now();
  const version = geocoder.datasetVersion;
  return applyPlacePass(db, geocoder, version, started);
}

function applyPlacePass(db, geocoder, version, started) {
  const rows = db.prepare(`
    SELECT id, has_gps, gps_latitude, gps_longitude
    FROM items
    WHERE place_version IS NULL OR place_version < ?
  `).all(version);

  const update = db.prepare(`
    UPDATE items
    SET place_locality_en = @locality_en,
        place_locality_zh = @locality_zh,
        place_region_en = @region_en,
        place_region_zh = @region_zh,
        place_country_code = @country_code,
        place_landmark_id = @landmark_id,
        place_landmark_en = @landmark_en,
        place_landmark_zh = @landmark_zh,
        place_version = @version
    WHERE id = @id
  `);

  const result = { processed: rows.length, named: 0, unnamed: 0, withoutGps: 0, landmarks: 0, ms: 0 };

  const apply = db.transaction(() => {
    for (const row of rows) {
      let place = null;
      if (row.has_gps === 1) {
        place = geocoder.lookup(row.gps_latitude, row.gps_longitude);
        if (place) result.named += 1; if (place.landmarkId) result.landmarks += 1; else result.unnamed += 1;
      } else {
        result.withoutGps += 1;
      }
      update.run({
        id: row.id,
        locality_en: place ? place.localityEn : null,
        locality_zh: place ? place.localityZh : null,
        region_en: place ? place.regionEn : null,
        region_zh: place ? place.regionZh : null,
        country_code: place ? place.countryCode : null,
        landmark_id: place ? place.landmarkId : null,
        landmark_en: place ? place.landmarkEn : null,
        landmark_zh: place ? place.landmarkZh : null,
        version,
      });
    }
  });
  apply();

  result.ms = Date.now() - started;
  return result;
}

/**
 * Lazy form for the scan worker: the datasets are loaded only when some row
 * is NULL or older than the current version.
 * @param {() => object} load  returns a resolver (place-resolver.js)
 * @param {number|null} version  from peekDatasetVersion
 */
function runPlacePassLazy(db, load, version) {
  const started = Date.now();
  if (version !== null) {
    const todo = db.prepare('SELECT 1 FROM items WHERE place_version IS NULL OR place_version < ? LIMIT 1').get(version);
    if (!todo) return { processed: 0, named: 0, unnamed: 0, withoutGps: 0, landmarks: 0, ms: 0 };
  }
  const resolver = load();
  return applyPlacePass(db, resolver, resolver.datasetVersion, started);
}

module.exports = { runPlacePass, runPlacePassLazy };
