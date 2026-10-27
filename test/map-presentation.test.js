const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scaleStyle, scaleTextSize } = require('../src/renderer/lib/map-presentation');

function styles() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/vendor/map-styles/styles.js'), 'utf8'), { window });
  return { window, data: JSON.parse(JSON.stringify(window.__PhotosMapStyles)) };
}

test('all map themes draw named points of interest with category colors and collision handling', () => {
  for (const style of Object.values(styles().data)) {
    const ids = style.layers.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length);
    const pois = style.layers.filter((l) => l.id.startsWith('photos-poi-'));
    assert.equal(pois.length, 4);
    assert.deepEqual(pois.map((l) => [l.minzoom, l.maxzoom]), [[12, 14], [14, 16], [16, 17], [17, 24]]);
    for (const layer of pois) {
      assert.equal(layer['source-layer'], 'poi');
      assert.equal(layer.layout['icon-allow-overlap'], undefined);
      assert.equal(layer.layout['text-allow-overlap'], undefined);
      assert.ok(layer.layout['text-variable-anchor'].length > 1);
      assert.ok(JSON.stringify(layer.paint['text-color']).includes('culture'));
      assert.ok(JSON.stringify(layer.paint['text-color']).includes('park'));
    }
    assert.equal(style.sources.openmaptiles.url, 'https://tiles.openfreemap.org/planet');
  }
});

test('water draws above park fills and both themes have distinct water and green spaces', () => {
  for (const style of Object.values(styles().data)) {
    const water = style.layers.findIndex((l) => l.id === 'water');
    const parks = style.layers.filter((l) => ['park', 'landuse_park', 'photos-parks', 'landcover_wood'].includes(l.id));
    assert.ok(parks.length > 0);
    for (const park of parks) {
      assert.ok(style.layers.indexOf(park) < water);
      assert.notEqual(park.paint['fill-color'], style.layers[water].paint['fill-color']);
    }
  }
});

test('new place labels follow the selected language and theme', () => {
  const { window, data } = styles();
  for (const [name, style] of Object.entries(data)) {
    const labels = style.layers.filter((l) => l.id.startsWith('photos-poi-') || l.id === 'photos-park-labels');
    for (const layer of labels) assert.equal(layer.layout['text-field'][1][1], name.endsWith('Zh') ? 'name:zh-Hans' : 'name:en');
  }
  window.i18n = { getLocale: () => 'zh-Hans' };
  assert.equal(window.__PhotosMapStyleFor(true), window.__PhotosMapStyles.darkZh);
  assert.equal(window.__PhotosMapStyleFor(false), window.__PhotosMapStyles.lightZh);
});

test('map text scaling preserves zoom stops, geometry and the shared original styles', () => {
  const base = styles().data.dark;
  const original = JSON.stringify(base);
  const result = scaleStyle(base, 1.4);
  const before = base.layers.find((l) => l.id === 'photos-poi-detail');
  const after = result.layers.find((l) => l.id === 'photos-poi-detail');
  assert.equal(after.layout['text-size'][4], before.layout['text-size'][4] * 1.4);
  assert.deepEqual(after.layout['text-size'].slice(0, 4), before.layout['text-size'].slice(0, 4));
  assert.deepEqual(after.layout['icon-size'], before.layout['icon-size']);
  assert.deepEqual(after.paint, before.paint);
  assert.equal(JSON.stringify(base), original);
  const step = scaleTextSize(['step', ['zoom'], 10, 12, 14, 16, 18], 1.2);
  assert.deepEqual(step.slice(0, 6), ['step', ['zoom'], 12, 12, 16.8, 16]);
  assert.ok(Math.abs(step[6] - 21.6) < 0.0001);
});
