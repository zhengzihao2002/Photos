const test = require('node:test');
const assert = require('node:assert');
const { createLandmarkFinderFromData } = require('../src/main/places/landmarks');
const PT = require('../src/renderer/lib/place-text');

function dataset(list) {
  const L = { count: list.length, gid: [], lat: [], lng: [], rad: [], rank: [], cc: [], en: [], zh: [] };
  list.forEach((x, i) => { L.gid.push(x.gid || i + 1); L.lat.push(x.lat); L.lng.push(x.lng); L.rad.push(x.rad); L.rank.push(x.rank || 10); L.cc.push(0); L.en.push(x.en); L.zh.push(x.zh || ''); });
  return { datasetVersion: 1, countries: ['XX'], landmarks: L };
}
const EIFFEL = { en: 'Eiffel Tower', zh: '埃菲尔铁塔', lat: 48.8584, lng: 2.2945, rad: 200 };

test('inside radius matches; outside does not', () => {
  const f = createLandmarkFinderFromData(dataset([EIFFEL]));
  assert.strictEqual(f.lookup(48.8584, 2.2945).landmarkEn, 'Eiffel Tower');
  assert.strictEqual(f.lookup(48.8590, 2.2950).landmarkZh, '埃菲尔铁塔');
  assert.strictEqual(f.lookup(48.8700, 2.2945), null); // ~1.3 km away
});

test('radius edge: 199 m in, 210 m out', () => {
  const f = createLandmarkFinderFromData(dataset([EIFFEL]));
  const dLat = (m) => m / 1000 / 111.19;
  assert.ok(f.lookup(EIFFEL.lat + dLat(199), EIFFEL.lng));
  assert.strictEqual(f.lookup(EIFFEL.lat + dLat(210), EIFFEL.lng), null);
});

test('nearest wins; a big park does not hide a small monument inside it', () => {
  const f = createLandmarkFinderFromData(dataset([
    { en: 'Big Park', lat: 10, lng: 10, rad: 4000, rank: 200 },
    { en: 'Small Statue', lat: 10.01, lng: 10, rad: 150, rank: 5 },
  ]));
  assert.strictEqual(f.lookup(10.0101, 10).landmarkEn, 'Small Statue');
  assert.strictEqual(f.lookup(10.02, 10).landmarkEn, 'Big Park');
});

test('tie within 50 m: higher notability, then smaller radius, then lower id', () => {
  const same = { lat: 20, lng: 20 };
  let f = createLandmarkFinderFromData(dataset([{ en: 'A', rad: 500, rank: 5, ...same }, { en: 'B', rad: 500, rank: 50, ...same }]));
  assert.strictEqual(f.lookup(20, 20).landmarkEn, 'B');
  f = createLandmarkFinderFromData(dataset([{ en: 'A', rad: 900, rank: 5, ...same }, { en: 'B', rad: 500, rank: 5, ...same }]));
  assert.strictEqual(f.lookup(20, 20).landmarkEn, 'B');
  f = createLandmarkFinderFromData(dataset([{ gid: 9, en: 'A', rad: 500, rank: 5, ...same }, { gid: 3, en: 'B', rad: 500, rank: 5, ...same }]));
  assert.strictEqual(f.lookup(20, 20).landmarkEn, 'B');
});

test('antimeridian and poles', () => {
  const f = createLandmarkFinderFromData(dataset([
    { en: 'East Side', lat: 0, lng: 179.999, rad: 2000 },
    { en: 'Pole Station', lat: -89.99, lng: 10, rad: 3000 },
  ]));
  assert.strictEqual(f.lookup(0, -179.999).landmarkEn, 'East Side');
  assert.strictEqual(f.lookup(0, 180.001).landmarkEn, 'East Side');
  assert.strictEqual(f.lookup(-89.99, -170).landmarkEn, 'Pole Station'); // same point, other side of the pole ring
});

test('bad input and empty dataset', () => {
  const f = createLandmarkFinderFromData(dataset([EIFFEL]));
  for (const [a, b] of [[NaN, 1], [null, null], [91, 0], ['1', '2'], [0, Infinity]]) assert.strictEqual(f.lookup(a, b), null);
  assert.strictEqual(createLandmarkFinderFromData(dataset([])).lookup(1, 1), null);
});

test('title priority and line parts', () => {
  const item = { place_landmark_en: 'Eiffel Tower', place_landmark_zh: '埃菲尔铁塔', place_locality_en: 'Paris', place_locality_zh: '巴黎',
    place_region_en: 'Île-de-France', place_country_code: 'FR' };
  assert.strictEqual(PT.placeTitle(item, 'en'), 'Eiffel Tower');
  assert.strictEqual(PT.placeTitle(item, 'zh-Hans'), '埃菲尔铁塔');
  assert.deepStrictEqual(PT.viewerPlaceParts(item, 'en', false), ['Paris, France']);
  assert.deepStrictEqual(PT.viewerPlaceParts(item, 'en', true), ['Eiffel Tower', 'Paris, France']);
  assert.strictEqual(PT.placeLine(item, 'en'), 'Eiffel Tower, Paris, Île-de-France, France');
  assert.strictEqual(PT.placeLine(item, 'zh-Hans'), '埃菲尔铁塔，巴黎，Île-de-France，法国');
  const noLm = { place_locality_en: 'Paris', place_country_code: 'FR' };
  assert.strictEqual(PT.placeTitle(noLm, 'en'), 'Paris');
  assert.deepStrictEqual(PT.viewerPlaceParts(noLm, 'en', false), []);
  assert.strictEqual(PT.placeTitle({}, 'en'), null);
  assert.strictEqual(PT.placeLine(null, 'en'), null);
});
