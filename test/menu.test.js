const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Run src/main/menu.js against a fake 'electron' that records the template.
function loadMenu(locale) {
  const origLoad = Module._load;
  const fake = {
    app: { name: 'Photos', getVersion: () => '1.0.0', getLocale: () => 'en-US', getPreferredSystemLanguages: () => [locale], setAboutPanelOptions() {}, showAboutPanel() {} },
    Menu: { buildFromTemplate: (t) => t, setApplicationMenu() {} },
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fake;
    return origLoad.call(this, request, parent, isMain);
  };
  for (const k of Object.keys(require.cache)) if (/src[\\/]main[\\/](menu|i18n|config)\.js$/.test(k)) delete require.cache[k];
  try {
    const cfg = require('../src/main/config');
    cfg.load = () => ({ language: locale });
    const i18n = require('../src/main/i18n');
    i18n.init();
    return { template: require('../src/main/menu').buildMenu(), i18n };
  } finally { Module._load = origLoad; }
}

function labels(items, out = []) {
  for (const it of items) {
    if (it.label) out.push(it.label);
    if (it.submenu) labels(it.submenu, out);
  }
  return out;
}
const HAN = /[㐀-鿿]/;
const NATIVE = new Set(['English', '简体中文']);

test('every English menu item has an explicit catalog label', () => {
  const { template } = loadMenu('en');
  const all = [];
  (function walk(items) { for (const it of items) { if (it.type !== 'separator') all.push(it); if (it.submenu) walk(it.submenu); } })(template);
  for (const it of all) assert.ok(it.label, 'menu item without a label: ' + JSON.stringify(it.role || it));
});

test('Chinese menu bar has no English leftovers', () => {
  const { template } = loadMenu('zh-Hans');
  for (const l of labels(template)) assert.ok(HAN.test(l) || NATIVE.has(l), 'English label in Chinese menu: ' + l);
});

test('the Language submenu marks the active language and switches', () => {
  const { template, i18n } = loadMenu('zh-Hans');
  const view = template.find((m) => m.label === '显示');
  const lang = view.submenu.find((m) => m.label === '语言');
  assert.deepStrictEqual(lang.submenu.map((m) => [m.label, m.checked]), [['English', false], ['简体中文', true]]);
  assert.strictEqual(i18n.getLocale(), 'zh-Hans');
});
