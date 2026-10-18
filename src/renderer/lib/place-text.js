/**
 * place-text.js  (M13)
 *
 * The one place that turns an item's stored place columns into text, for the
 * viewer title, the Info window and Places. Pure functions: no DOM, no state.
 * The locale is passed in ('en' or 'zh-Hans'); Chinese falls back to English
 * per field when the dataset has no Chinese name.
 *
 * Priority for a title line: user title (handled by the caller, it always
 * wins) > landmark name > city/place > region.
 */
(function (root) {
  const isZh = (locale) => typeof locale === 'string' && locale.toLowerCase().indexOf('zh') === 0;
  const pick = (zh, en, locale) => (isZh(locale) && zh) || en || null;

  const countryNames = {};
  function countryName(code, locale) {
    if (!code) return null;
    const lang = isZh(locale) ? 'zh-Hans' : 'en-US';
    try {
      const key = lang;
      if (!countryNames[key]) countryNames[key] = new Intl.DisplayNames([lang], { type: 'region' });
      return countryNames[key].of(code) || code;
    } catch (err) { return code; }
  }

  function parts(item, locale) {
    if (!item) return { landmark: null, locality: null, region: null, country: null };
    return {
      landmark: pick(item.place_landmark_zh, item.place_landmark_en, locale),
      locality: pick(item.place_locality_zh, item.place_locality_en, locale),
      region: pick(item.place_region_zh, item.place_region_en, locale),
      country: countryName(item.place_country_code, locale),
    };
  }

  /** Short name for a title or section header: landmark, else city, else region. */
  function placeTitle(item, locale) {
    const p = parts(item, locale);
    return p.landmark || p.locality || p.region || null;
  }

  /** Full location row (Info window, map titles): "Landmark, City, Region, Country". */
  function placeLine(item, locale) {
    const p = parts(item, locale);
    const list = [p.landmark, p.locality, p.region !== p.locality ? p.region : null, p.country].filter(Boolean);
    const out = list.filter((v, i) => list.indexOf(v) === i);
    return out.length ? out.join(isZh(locale) ? '，' : ', ') : null;
  }

  /**
   * The parts a viewer title line 2 adds because of the place. With a landmark
   * the city and country move down here ("Paris, France"); with a user title
   * the place name itself also moves down.
   */
  function viewerPlaceParts(item, locale, hasUserTitle) {
    const p = parts(item, locale);
    const sep = isZh(locale) ? '，' : ', ';
    const out = [];
    if (hasUserTitle) {
      const name = p.landmark || p.locality || p.region;
      if (name) out.push(name);
    }
    if (p.landmark) {
      const where = [p.locality || p.region, p.country].filter(Boolean);
      const text = where.filter((v, i) => where.indexOf(v) === i && v !== (hasUserTitle ? p.landmark : null)).join(sep);
      if (text) out.push(text);
    }
    return out;
  }

  const api = { parts, placeTitle, placeLine, viewerPlaceParts, countryName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlaceText = api;
})(typeof window !== 'undefined' ? window : globalThis);
