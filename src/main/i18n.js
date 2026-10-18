/**
 * i18n.js  (M14) -- main-process side of localization.
 *
 * The language lives in the app config (config.language: 'en' | 'zh-Hans' |
 * null). null = never chosen: the Mac's preferred languages decide (Chinese
 * -> Simplified Chinese, anything else -> English). Once the user picks a
 * language in the Language menu, their choice wins.
 *
 * setLanguage() saves the choice, rebuilds the menu bar, retitles windows and
 * tells every window ('i18n:locale-changed') so each page reloads in the new
 * language.
 */
const { app } = require('electron');
const I18n = require('../shared/i18n/i18n');
const en = require('../shared/i18n/en');
const zhHans = require('../shared/i18n/zh-Hans');
const config = require('./config');

const i18n = I18n.create({ en, 'zh-Hans': zhHans }, 'en');
let started = false;

function systemLanguages() {
  try {
    if (typeof app.getPreferredSystemLanguages === 'function') return app.getPreferredSystemLanguages();
  } catch (e) { /* fall through */ }
  return [app.getLocale()];
}

function init() {
  const saved = config.load().language;
  const chosen = saved ? I18n.normalizeLocale(saved) : null;
  const debug = process.env.PHOTOS_PSEUDO_LOCALE === '1';
  i18n.setLocale(debug ? 'en-XA' : (chosen || I18n.localeFromSystem(systemLanguages())));
  started = true;
}

function getLocale() { if (!started) init(); return i18n.getLocale(); }
function t(key, params) { if (!started) init(); return i18n.t(key, params); }

function setLanguage(next) {
  const locale = I18n.normalizeLocale(next);
  if (!locale || locale === 'en-XA') return getLocale();
  if (!started) init();
  config.update({ language: locale });
  if (i18n.getLocale() === locale) return locale;
  i18n.setLocale(locale);
  const { Menu } = require('electron');
  Menu.setApplicationMenu(require('./menu').buildMenu());
  try { require('./settings-window').retitle(); } catch (e) { /* not open */ }
  try { require('./info-window').retitle(); } catch (e) { /* not open */ }
  require('./window-bus').send('i18n:locale-changed', { locale });
  return locale;
}

module.exports = { init, t, getLocale, setLanguage, intl: () => i18n.intlLocale(), i18n };
