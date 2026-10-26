const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const sizes = require('../src/shared/text-size');

test('text sizes preserve the original default and reject malformed preferences', () => {
  assert.equal(sizes.factors.default, 1);
  for (const value of ['small', 'default', 'large', 'extra-large']) assert.equal(sizes.normalize(value), value);
  for (const value of [undefined, null, true, 2, [], ['large'], {}, '__proto__', 'huge']) assert.equal(sizes.normalize(value), 'default');
});

test('text size persists through config updates without losing other preferences', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-text-size-'));
  const paths = { configPath: () => path.join(dir, 'config.json') };
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/config.js'), 'utf8'), {
    module, process: { pid: process.pid }, require: (id) => id === './paths' ? paths : id === '../shared/text-size' ? sizes : require(id),
  });
  const config = module.exports;
  assert.equal(config.load().textSize, 'default');
  config.save({ ...config.defaultConfig(), language: 'zh-Hans', textSize: 'large', grid: { zoomLevel: 180, libraryMode: 'months' } });
  config.update({ viewer: { infoX: 40 } });
  const saved = config.load();
  assert.equal(saved.textSize, 'large');
  assert.equal(saved.language, 'zh-Hans');
  assert.equal(saved.grid.zoomLevel, 180);
  assert.equal(config.update({ textSize: 'unexpected' }).textSize, 'default');
  fs.writeFileSync(paths.configPath(), JSON.stringify({ language: 'en' }));
  assert.equal(config.load().textSize, 'default');
});

test('renderer applies the saved size before rendering and responds to live changes', () => {
  const values = {};
  let listener;
  const window = {
    document: { documentElement: { dataset: {}, style: { setProperty: (key, value) => { values[key] = value; } } } },
    api: { getTextSize: () => 'extra-large', onTextSizeChanged: (fn) => { listener = fn; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/shared/text-size.js'), 'utf8'), { window });
  assert.equal(values['--text-scale'], 1.4);
  assert.equal(window.document.documentElement.dataset.textSize, 'extra-large');
  listener('small');
  assert.equal(values['--text-scale'], 0.9);
  listener('default');
  assert.equal(values['--text-scale'], 1);
});

test('text size config changes notify every open window after saving', async () => {
  const sent = [];
  let saved;
  const config = { load: () => saved || { textSize: 'default' }, update: (patch) => (saved = { textSize: 'default', ...patch }) };
  const windows = [1, 2, 3].map((id) => ({ isDestroyed: () => false, webContents: { send: (...args) => sent.push({ id, args, saved }) } }));
  windows.push({ isDestroyed: () => true });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/ipc/handlers/config.js'), 'utf8'), {
    module, require: (id) => id === '../../config' ? config : { BrowserWindow: { getAllWindows: () => windows } },
  });
  const update = module.exports.find((h) => h.channel === 'config:update');
  const result = await update.handle({}, { patch: { textSize: 'extra-large' } });
  assert.equal(result.textSize, 'extra-large');
  assert.equal(sent.length, 3);
  assert.ok(sent.every((event) => event.args[0] === 'appearance:text-size' && event.args[1] === 'extra-large' && event.saved === result));
  await update.handle({}, { patch: { grid: { zoomLevel: 180 } } });
  assert.equal(sent.length, 3, 'unrelated config updates do not reapply text sizes');
});
