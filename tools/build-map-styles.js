/**
 * tools/build-map-styles.js  (M7, dev-time only; not shipped)
 *
 * Rebuilds src/renderer/vendor/map-styles/styles.js from positron.json
 * and dark.json, with richer palettes and named places for both themes.
 * The .json files are the pinned
 * OpenFreeMap originals and are never modified. Run from the project root:
 *   node tools/build-map-styles.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'src', 'renderer', 'vendor', 'map-styles');
const LAND = '#2d4255';
const ROAD = '#65798e';
const ROAD_MAJOR = '#8c9fb2';
const CASING = '#263a4d';
const RAIL = '#48657e';
const LABEL = '#e0eaf3';
const LABEL_HALO = '#273d52';
const place = { 'text-color': LABEL, 'text-halo-color': LABEL_HALO };

// layer id -> paint overrides
const DARK = {
  background: { 'background-color': LAND },
  water: { 'fill-color': '#173d78' },
  waterway: { 'line-color': '#245991' },
  water_name: { 'text-color': '#75afe9', 'text-halo-color': '#173d78', 'text-halo-width': 1.2 },
  landcover_ice_shelf: { 'fill-color': 'rgb(72,78,104)' },
  landcover_glacier: { 'fill-color': 'rgb(72,78,104)' },
  landuse_residential: { 'fill-color': '#33495d' },
  landcover_wood: { 'fill-color': '#174f49' },
  landuse_park: { 'fill-color': '#18584d' },
  building: { 'fill-color': '#384f64', 'fill-outline-color': '#466078' },
  'aeroway-taxiway': { 'line-color': RAIL },
  'aeroway-runway-casing': { 'line-color': CASING },
  'aeroway-area': { 'fill-color': 'rgb(52,56,77)' },
  'aeroway-runway': { 'line-color': 'rgb(82,87,114)' },
  road_area_pier: { 'fill-color': LAND },
  road_pier: { 'line-color': LAND },
  highway_path: { 'line-color': '#66918b' },
  highway_minor: { 'line-color': ROAD },
  highway_major_casing: { 'line-color': CASING },
  highway_major_inner: { 'line-color': ROAD_MAJOR },
  highway_major_subtle: { 'line-color': ROAD },
  highway_motorway_casing: { 'line-color': CASING },
  highway_motorway_inner: { 'line-color': '#adb9c5' },
  highway_motorway_subtle: { 'line-color': ROAD_MAJOR },
  railway_transit: { 'line-color': RAIL },
  railway_transit_dashline: { 'line-color': LAND },
  railway_minor: { 'line-color': RAIL },
  railway_minor_dashline: { 'line-color': LAND },
  railway: { 'line-color': RAIL },
  railway_dashline: { 'line-color': LAND },
  highway_name_other: { 'text-color': '#dce6ef', 'text-halo-color': '#30485e', 'text-halo-width': 1.3 },
  highway_name_motorway: { 'text-color': '#edf1f5', 'text-halo-color': '#30485e', 'text-halo-width': 1.3 },
  boundary_state: { 'line-color': 'rgb(104,110,140)' },
  'boundary_country_z0-4': { 'line-color': 'rgb(120,126,158)' },
  'boundary_country_z5-': { 'line-color': 'rgb(120,126,158)' },
  place_other: place, place_suburb: place, place_village: place, place_town: place,
  place_city: place, place_city_large: place, place_state: place,
  place_country_other: place, place_country_minor: place, place_country_major: place,
};

const LIGHT = {
  background: { 'background-color': '#f5f2ec' },
  park: { 'fill-color': '#cce6bc' },
  water: { 'fill-color': '#b1d9f3' },
  waterway: { 'line-color': '#8bc5e9' },
  landuse_residential: { 'fill-color': '#eeeae4' },
  landcover_wood: { 'fill-color': '#bdddad' },
  building: { 'fill-color': '#e2e4df', 'fill-outline-color': '#cdd3ce' },
  highway_path: { 'line-color': '#b5b997' },
  highway_minor: { 'line-color': '#ffffff' },
  highway_major_casing: { 'line-color': '#d5d9d5' },
  highway_major_inner: { 'line-color': '#ffffff' },
  highway_major_subtle: { 'line-color': '#ffffff' },
  highway_motorway_casing: { 'line-color': '#dbbd94' },
  highway_motorway_inner: { 'line-color': '#ffe0aa' },
  highway_motorway_bridge_casing: { 'line-color': '#dbbd94' },
  highway_motorway_bridge_inner: { 'line-color': '#ffe0aa' },
};

// Category names are shared with the locally drawn icons in map-presentation.js.
const CATEGORY = ['match', ['get', 'class'],
  ['food', 'restaurant', 'fast_food', 'bar', 'pub', 'beer', 'ice_cream'], 'food',
  ['cafe', 'bakery'], 'cafe',
  ['shop', 'grocery', 'supermarket', 'mall', 'clothing', 'convenience'], 'shopping',
  ['museum', 'art_gallery', 'theatre', 'cinema', 'music', 'monument'], 'culture',
  ['park', 'garden', 'nature_reserve', 'playground', 'zoo'], 'park',
  ['railway', 'rail', 'bus', 'bus_station', 'bus_stop', 'subway', 'airport', 'aerialway'], 'transit',
  ['lodging', 'hotel', 'motel', 'hostel', 'alpine_hut'], 'lodging',
  ['hospital', 'doctor', 'dentist', 'pharmacy'], 'health',
  ['school', 'college', 'university', 'library'], 'education',
  ['harbor', 'ferry_terminal', 'marina', 'swimming'], 'water',
  ['attraction', 'viewpoint', 'castle', 'historic'], 'attraction', 'general'];
const POI_COLORS = {
  dark: { food: '#ffb36e', cafe: '#d7ad8a', shopping: '#f6d56c', culture: '#f38cce', park: '#86d883', transit: '#78b9ff', lodging: '#bc9eea', health: '#fa9baf', education: '#c9ab8d', water: '#7bd4e5', attraction: '#b8b1f1', general: '#bdcbd9' },
  light: { food: '#ae591d', cafe: '#91633e', shopping: '#886c12', culture: '#b3448c', park: '#387a3a', transit: '#246db8', lodging: '#8059a6', health: '#b84c67', education: '#866746', water: '#237b91', attraction: '#7561a7', general: '#5d7386' },
};

function enhance(style, darkMode) {
  const palette = darkMode ? DARK : LIGHT;
  for (const layer of style.layers) {
    if (palette[layer.id]) layer.paint = { ...layer.paint, ...palette[layer.id] };
    if (layer.type === 'symbol' && layer['source-layer'] === 'water_name' && !darkMode) {
      layer.paint = { ...layer.paint, 'text-color': '#467fa5', 'text-halo-color': '#d5eafa' };
    }
    if (layer.type === 'symbol' && layer['source-layer'] === 'transportation_name' && layer.layout['text-field'] === ENGLISH_LABEL) {
      layer.paint = { ...layer.paint, 'text-color': darkMode ? '#dce6ef' : '#5b6b75', 'text-halo-color': darkMode ? '#30485e' : '#ffffff', 'text-halo-width': 1.2 };
      if (darkMode) layer.layout['text-size'] = ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 11.5, 18, 12.5];
    }
  }
  const landLayers = [{ id: 'photos-landuse-zones', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', minzoom: 10,
    paint: { 'fill-color': ['match', ['get', 'class'], ['commercial', 'retail'], darkMode ? '#45435c' : '#eee4e7',
      'industrial', darkMode ? '#354854' : '#e0e7e6', ['school', 'university'], darkMode ? '#47495c' : '#e9e4ef',
      'hospital', darkMode ? '#514452' : '#f1e1e4', 'rgba(0,0,0,0)'], 'fill-opacity': 0.65 } }];
  if (darkMode) landLayers.push({ id: 'photos-parks', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
    paint: { 'fill-color': '#18584d' } });
  // Park and woodland polygons belong below lakes and rivers.
  const greenery = style.layers.filter((l) => ['park', 'landuse_park', 'landcover_wood'].includes(l.id));
  style.layers = style.layers.filter((l) => !greenery.includes(l));
  style.layers.splice(style.layers.findIndex((l) => l.id === 'water'), 0, ...landLayers, ...greenery);
  const colors = POI_COLORS[darkMode ? 'dark' : 'light'];
  const textColor = ['match', CATEGORY, ...Object.entries(colors).filter(([k]) => k !== 'general').flat(), colors.general];
  if (darkMode) style.layers.push({ id: 'photos-water-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name',
    filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ENGLISH_LABEL, 'text-font': ['Noto Sans Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 12], 'text-max-width': 7, 'text-letter-spacing': 0.08 },
    paint: { 'text-color': '#75afe9', 'text-halo-color': '#173d78', 'text-halo-width': 1.3 } });
  style.layers.push({ id: 'photos-park-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'park', minzoom: 12,
    filter: ['has', 'name'], layout: { 'text-field': ENGLISH_LABEL, 'text-font': ['Noto Sans Bold'], 'text-size': 12,
      'text-max-width': 9, 'text-padding': 4 }, paint: { 'text-color': colors.park, 'text-halo-color': darkMode ? '#17483f' : '#e0f0d5', 'text-halo-width': 1.5 } });
  for (const [suffix, minzoom, maxzoom, rank] of [['major', 12, 14, 10], ['neighborhood', 14, 16, 30], ['detail', 16, 24, 10000]]) {
    style.layers.push({ id: 'photos-poi-' + suffix, type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom, maxzoom,
      filter: ['all', ['has', 'name'], ['<=', ['coalesce', ['get', 'rank'], 999], rank]],
      layout: { 'icon-image': ['concat', 'photos-poi-', CATEGORY], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 0.9, 18, 1],
        'icon-padding': 3, 'text-field': ENGLISH_LABEL, 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 12, 18, 13],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9,
        'text-max-width': 8, 'text-padding': 3, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 999] },
      paint: { 'text-color': textColor, 'text-halo-color': darkMode ? '#263c51' : '#fcfaf5', 'text-halo-width': 1.6, 'text-halo-blur': 0.3 } });
  }
}

const light = JSON.parse(fs.readFileSync(path.join(DIR, 'positron.json'), 'utf8'));
const dark = JSON.parse(fs.readFileSync(path.join(DIR, 'dark.json'), 'utf8'));
// M8c.5: one label per place, in English (app UI is English; never mixed).
// The originals draw 'Latin name + local-script name' (e.g. China / 中国)
// wherever a non-Latin name exists; replace every such rule. Road shields
// (ref numbers) are left alone. Later localisation changes this one place.
const ENGLISH_LABEL = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
let labelsRewritten = 0;
for (const style of [light, dark]) {
  for (const layer of style.layers) {
    const tf = layer.layout && layer.layout['text-field'];
    if (tf && JSON.stringify(tf).includes('name:nonlatin')) { layer.layout['text-field'] = ENGLISH_LABEL; labelsRewritten++; }
  }
}
console.log('labels rewritten to one English name:', labelsRewritten);

// M14: second pair of styles with Chinese labels. Fallback order (first one the tile has):
// name:zh-Hans, name:zh, then the local name, then the English name. Where a tile carries no
// Chinese name, the local-language name is therefore shown (accepted limit, see README).
const CHINESE_LABEL = ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name'], ['get', 'name_en'], ['get', 'name:latin']];
function withLabels(style, expr) {
  const copy = JSON.parse(JSON.stringify(style));
  for (const layer of copy.layers) {
    if (layer.layout && JSON.stringify(layer.layout['text-field']) === JSON.stringify(ENGLISH_LABEL)) layer.layout['text-field'] = expr;
  }
  return copy;
}

const known = new Set(dark.layers.map((l) => l.id));
const unknown = Object.keys(DARK).filter((id) => !known.has(id));
let applied = 0;
applied = dark.layers.filter((layer) => DARK[layer.id]).length;
enhance(light, false);
enhance(dark, true);

const out = '/**\n'
  + ' * styles.js (M7.5) -- GENERATED by tools/build-map-styles.js from\n'
  + ' * positron.json and dark.json in this folder (OpenFreeMap styles; see\n'
  + ' * VERSION.txt). Palettes and place labels are customized there. Do not edit by hand.\n'
  + ' * Exposes window.__PhotosMapStyles = { light, dark, lightZh, darkZh } (MapLibre styles).\n'
  + ' */\n'
  + 'window.__PhotosMapStyles = {\n'
  + '  light: ' + JSON.stringify(light) + ',\n'
  + '  dark: ' + JSON.stringify(dark) + ',\n'
  + '  lightZh: ' + JSON.stringify(withLabels(light, CHINESE_LABEL)) + ',\n'
  + '  darkZh: ' + JSON.stringify(withLabels(dark, CHINESE_LABEL)) + ',\n'
  + '};\n'
  + '// M14: the style for the active language and colour scheme.\n'
  + 'window.__PhotosMapStyleFor = function (dark) {\n'
  + "  const zh = !!(window.i18n && window.i18n.getLocale() === 'zh-Hans');\n"
  + '  const S = window.__PhotosMapStyles;\n'
  + '  const base = dark ? (zh ? S.darkZh : S.dark) : (zh ? S.lightZh : S.light);\n'
  + '  return window.PhotosMapPresentation ? window.PhotosMapPresentation.style(base) : base;\n'
  + '};\n';
const file = path.join(DIR, 'styles.js');
fs.writeFileSync(file + '.tmp', out);
fs.renameSync(file + '.tmp', file);

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
const built = sandbox.window.__PhotosMapStyles;
console.log('wrote styles.js', fs.statSync(file).size, 'bytes | light layers:', built.light.layers.length, '| dark layers:', built.dark.layers.length);
console.log('dark layers recoloured:', applied, 'of', dark.layers.length, '| unknown ids in table:', unknown.length ? unknown.join(', ') : 'none');
console.log('Chinese labels: light', built.lightZh.layers.filter((l) => l.layout && JSON.stringify(l.layout['text-field']) === JSON.stringify(CHINESE_LABEL)).length, 'layers');
console.log('dark land colour is now:', built.dark.layers[0].paint['background-color']);
