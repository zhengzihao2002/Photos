/**
 * init.js  (M14) -- renderer side. Loaded after i18n.js, en.js and zh-Hans.js.
 * Defines window.t / window.i18n for the active language, which the main
 * process tells us synchronously at startup (window.api.getLocale). When the
 * user changes language in the menu bar, the page reloads (main sends
 * 'i18n:locale-changed'), so every string is rebuilt in the new language and
 * no module can keep a stale translated constant.
 */
(function () {
  const catalogs = window.__I18nCatalogs || {};
  let initial = 'en';
  try { initial = (window.api && window.api.getLocale && window.api.getLocale()) || 'en'; } catch (e) { initial = 'en'; }
  const i18n = window.I18n.create(catalogs, initial);
  window.i18n = i18n;
  window.t = i18n.t;
  document.documentElement.lang = i18n.getLocale() === 'zh-Hans' ? 'zh-Hans' : 'en';
  if (window.api && window.api.onLocaleChanged) {
    window.api.onLocaleChanged(() => { window.location.reload(); });
  }
})();
