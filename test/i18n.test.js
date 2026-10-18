const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const I18n = require('../src/shared/i18n/i18n');
const en = require('../src/shared/i18n/en');
const zh = require('../src/shared/i18n/zh-Hans');
const SRC = path.join(__dirname, '..', 'src');

/** Load the renderer-side scripts the way a page does, in a sandbox with a fake window. */
function page(locale, scripts) {
  const window = { api: { getLocale: () => locale, onLocaleChanged() {} } };
  window.window = window;
  window.document = { documentElement: {} };
  window.console = console;
  vm.createContext(window);
  for (const rel of ['shared/i18n/i18n.js', 'shared/i18n/en.js', 'shared/i18n/zh-Hans.js', 'shared/i18n/init.js'].concat(scripts || [])) {
    vm.runInContext(fs.readFileSync(path.join(SRC, rel), 'utf8'), window, { filename: rel });
  }
  return window;
}

test('locale normalisation and first-run default', () => {
  assert.strictEqual(I18n.normalizeLocale('zh-Hans-CN'), 'zh-Hans');
  assert.strictEqual(I18n.normalizeLocale('zh-Hant-TW'), 'zh-Hans'); // Traditional is out of scope: Simplified, not English
  assert.strictEqual(I18n.normalizeLocale('en-GB'), 'en');
  assert.strictEqual(I18n.normalizeLocale('fr-FR'), null);
  assert.strictEqual(I18n.localeFromSystem(['fr-FR', 'zh-Hans-CN', 'en-US']), 'zh-Hans');
  assert.strictEqual(I18n.localeFromSystem(['de-DE']), 'en');
  assert.strictEqual(I18n.localeFromSystem([]), 'en');
});

test('plurals: English has one/other, Chinese has one form', () => {
  const e = I18n.create({ en, 'zh-Hans': zh }, 'en');
  assert.strictEqual(e.t('count.photos', { count: 1 }), '1 Photo');
  assert.strictEqual(e.t('count.photos', { count: 2 }), '2 Photos');
  assert.strictEqual(e.t('count.photosSelected', { count: 3 }), '3 Photos Selected');
  assert.strictEqual(e.t('count.itemsSelected', { count: 12 }), '12 Items Selected');
  e.setLocale('zh-Hans');
  assert.strictEqual(e.t('count.photos', { count: 1 }), '1 张照片');
  assert.strictEqual(e.t('count.photos', { count: 5 }), '5 张照片');
  assert.strictEqual(e.t('count.videosSelected', { count: 2 }), '已选择 2 个视频');
});

test('missing key falls back to English, then to the key', () => {
  const c = I18n.create({ en: { a: 'A' }, 'zh-Hans': {} }, 'zh-Hans');
  const warn = console.warn; console.warn = () => {};
  assert.strictEqual(c.t('a'), 'A');
  assert.strictEqual(c.t('nope'), 'nope');
  console.warn = warn;
});

test('pseudo-locale marks every string and keeps placeholders', () => {
  const c = I18n.create({ en }, 'en-XA');
  const out = c.t('folder.cantBeFound', { name: 'X' });
  assert.ok(out.startsWith('[!! ') && out.endsWith(' !!]'));
  assert.ok(out.includes('X'));
});

test('main-process menu strings exist in both languages and differ', () => {
  for (const k of Object.keys(en).filter((x) => x.startsWith('menu.'))) assert.ok(k in zh, k);
  assert.notStrictEqual(en['menu.file'], zh['menu.file']);
});

test('info formatting follows the language: dates, sizes, coordinates, short dates', () => {
  const E = page('en', ['renderer/lib/place-text.js', 'renderer/lib/info-format.js']).InfoFormat;
  const Z = page('zh-Hans', ['renderer/lib/place-text.js', 'renderer/lib/info-format.js']).InfoFormat;
  assert.strictEqual(E.shortDate('2026-10-18 10:00:00'), '10/18/2026');
  assert.strictEqual(Z.shortDate('2026-10-18 10:00:00'), '2026/10/18');
  assert.match(E.dateTime('2026-10-18 15:04:05'), /October 18, 2026/);
  assert.match(Z.dateTime('2026-10-18 15:04:05'), /2026年10月18日/);
  assert.strictEqual(E.bytes(500), '500 bytes');
  assert.strictEqual(Z.bytes(500), '500 字节');
  assert.strictEqual(E.bytes(2500000), '2.5 MB');
  assert.strictEqual(E.coords(48.8584, 2.2945), '48.8584° N, 2.2945° E');
  assert.strictEqual(Z.coords(-33.8, 151.2), '南纬 33.8000°，东经 151.2000°');
  assert.strictEqual(Z.dateNote('file_mtime'), '日期来自文件的修改时间');
});

test('the date-range label formats in both languages (toolbar)', () => {
  for (const [loc, re] of [['en', /Nov 10\s*[–-]\s*Dec 25,\s*2025/], ['zh-Hans', /2025年11月10日.*12月25日/]]) {
    const intl = new Intl.DateTimeFormat(loc === 'en' ? 'en-US' : 'zh-Hans-CN', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const txt = intl.formatRange(new Date(Date.UTC(2025, 10, 10)), new Date(Date.UTC(2025, 11, 25)));
    assert.match(txt, re);
  }
});
