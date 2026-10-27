const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const labels = require('../src/renderer/lib/map-labels');
const OpenCC = require('../src/renderer/vendor/opencc/t2cn');

const bytes = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
function vint(value) {
  let n = BigInt(value); const out = [];
  do { out.push(Number(n & 127n) | (n > 127n ? 128 : 0)); n >>= 7n; } while (n);
  return Buffer.from(out);
}
const field = (id, data) => bytes(vint(id * 8 + 2), vint(data.length), data);
function tile(text) {
  const feature = bytes(vint(8), vint(9007199254740997n), field(2, bytes(vint(0), vint(0))), vint(24), vint(1), field(4, bytes(vint(9), vint(64), vint(64))));
  const value = field(1, Buffer.from(text));
  const integer = bytes(vint(40), vint(42));
  const float = Buffer.alloc(4); float.writeFloatLE(12.5);
  const double = Buffer.alloc(8); double.writeDoubleLE(-73.984);
  const layer = bytes(field(1, Buffer.from('poi')), field(2, feature), field(3, Buffer.from('name:zh')), field(4, value), field(4, integer),
    field(4, bytes(vint(21), float)), field(4, bytes(vint(25), double)), field(4, bytes(vint(56), vint(1))), vint(40), vint(4096), vint(120), vint(2));
  return field(3, layer);
}
test('Traditional Chinese fallback labels become Simplified Chinese locally', () => {
  assert.equal(labels.simplify('臺灣國立圖書館與藝術博物館'), '台湾国立图书馆与艺术博物馆');
  assert.equal(labels.simplify('聖派翠克大教堂 / Central Park'), '圣派翠克大教堂 / Central Park');
  assert.equal(labels.simplify('中央公园 / W 59th St'), '中央公园 / W 59th St');
});
test('vector tile conversion changes text only, preserving ids, tags, geometry and numeric values', () => {
  const source = tile('國立圖書館'.repeat(40));
  const original = Buffer.from(source);
  const result = labels.simplifyTile(source);
  assert.deepEqual(Buffer.from(result), tile('国立图书馆'.repeat(40)));
  assert.deepEqual(source, original);
  assert.deepEqual(Buffer.from(labels.simplifyTile(tile('Central Park'))), tile('Central Park'));
  assert.throws(() => labels.simplifyTile(Uint8Array.from([26, 100, 1])), /invalid-vector-tile/);
});
test('only Chinese vector tiles use the converter; fonts, raster tiles and English stay unchanged', async () => {
  const window = { OpenCC, i18n: { getLocale: () => 'zh-Hans' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/lib/map-labels.js'), 'utf8'), { window, TextEncoder, TextDecoder, Uint8Array });
  const api = window.PhotosMapLabels;
  const url = 'https://tiles.openfreemap.org/planet/20261026/14/4823/6157.pbf';
  assert.equal(api.transformRequest(url, 'Tile').url, url.replace('https://', 'photos-map://'));
  assert.equal(api.transformRequest(url, 'Glyphs').url, url);
  const raster = 'https://tiles.openfreemap.org/earth/0/0/0.png';
  assert.equal(api.transformRequest(raster, 'Tile').url, raster);
  window.i18n.getLocale = () => 'en';
  assert.equal(api.transformRequest(url, 'Tile').url, url);
  let count = 0, handler;
  const gl = { addProtocol: (_name, fn) => { count++; handler = fn; } };
  api.install(gl); api.install(gl);
  assert.equal(count, 1);
  const controller = new AbortController();
  let request;
  window.fetch = async (uri, opts) => { request = { uri, opts }; return { ok: true, headers: { get: () => null }, arrayBuffer: async () => tile('藝術館') }; };
  const result = await handler({ url: url.replace('https://', 'photos-map://') }, controller);
  assert.deepEqual(Buffer.from(result.data), tile('艺术馆'));
  assert.equal(request.uri, url);
  assert.equal(request.opts.signal, controller.signal);
  await assert.rejects(handler({ url: 'photos-map://other.example/tile.pbf' }, controller), /invalid-map-host/);
});
