/**
 * i18n.js  (M14)
 *
 * Tiny key-based translation core shared by the main process (require) and
 * every renderer window (<script>, exposes window.I18n). No dependencies.
 *
 *   const i18n = I18n.create({ en: {...}, 'zh-Hans': {...} });
 *   i18n.setLocale('zh-Hans');
 *   i18n.t('count.photos', { count: 3 })
 *
 * A catalog value is a whole sentence. Placeholders are {name}. A plural is an
 * object with the CLDR categories the language needs ({ one, other } for
 * English, { other } for Chinese); the category is chosen with Intl.PluralRules
 * from params.count. Sentences are never glued together from translated
 * fragments.
 *
 * 'en-XA' is a hidden pseudo-locale (accented, bracketed English) used to spot
 * strings that bypass t(). A key missing from the active catalog falls back to
 * English, and a key missing everywhere is returned as the key itself.
 */
(function (root) {
  const SUPPORTED = ['en', 'zh-Hans'];

  /** Map any BCP-47 tag or macOS language code to a supported locale, or null. */
  function normalizeLocale(tag) {
    if (typeof tag !== 'string') return null;
    const t = tag.trim().toLowerCase().replace(/_/g, '-');
    if (t === 'en-xa') return 'en-XA';
    if (t.startsWith('en')) return 'en';
    // Traditional Chinese is out of scope: a Traditional-Chinese Mac gets Simplified, not English.
    if (t.startsWith('zh')) return 'zh-Hans';
    return null;
  }

  /** First-run default from the Mac's preferred languages (in order); English if none match. */
  function localeFromSystem(languages) {
    for (const lang of languages || []) {
      const l = normalizeLocale(lang);
      if (l && l !== 'en-XA') return l;
    }
    return 'en';
  }

  const ACCENTS = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', A: 'Å', E: 'É', I: 'Î', O: 'Ø', U: 'Ü', c: 'ç', n: 'ñ', y: 'ý' };
  function pseudo(text) {
    // Leave {placeholders} alone.
    return '[!! ' + text.replace(/\{[A-Za-z0-9_]+\}|[A-Za-z]/g, (m) => (m.length > 1 ? m : (ACCENTS[m] || m))) + ' !!]';
  }

  function create(catalogs, initial) {
    let locale = normalizeLocale(initial) || 'en';
    const rulesCache = {};
    const listeners = new Set();
    const warned = new Set();

    function rules() {
      const lang = locale === 'zh-Hans' ? 'zh-Hans' : 'en';
      if (!rulesCache[lang]) rulesCache[lang] = new Intl.PluralRules(lang);
      return rulesCache[lang];
    }

    function raw(key) {
      const active = locale === 'en-XA' ? catalogs.en : catalogs[locale];
      let v = active ? active[key] : undefined;
      if (v === undefined) v = catalogs.en ? catalogs.en[key] : undefined;
      return v;
    }

    function fill(text, params) {
      return text.replace(/\{([A-Za-z0-9_]+)\}/g, (m, name) => (params && params[name] !== undefined ? String(params[name]) : m));
    }

    function t(key, params) {
      let v = raw(key);
      if (v === undefined) {
        if (!warned.has(key)) { warned.add(key); if (typeof console !== 'undefined') console.warn('[i18n] missing key:', key); }
        return key;
      }
      if (v !== null && typeof v === 'object') {
        const n = params && typeof params.count === 'number' ? params.count : 0;
        v = v[rules().select(n)] !== undefined ? v[rules().select(n)] : (v.other !== undefined ? v.other : v.one);
      }
      const out = fill(String(v), params);
      return locale === 'en-XA' ? pseudo(out) : out;
    }

    function setLocale(next) {
      const n = normalizeLocale(next);
      if (!n || n === locale) return locale;
      locale = n;
      listeners.forEach((fn) => { try { fn(locale); } catch (e) { /* listener errors never block a language change */ } });
      return locale;
    }

    const intlTag = () => (locale === 'zh-Hans' ? 'zh-Hans-CN' : 'en-US');
    return {
      t,
      has: (key) => raw(key) !== undefined,
      getLocale: () => locale,
      setLocale,
      onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      intlLocale: intlTag,
      number: (n, opts) => new Intl.NumberFormat(intlTag(), opts).format(n),
      date: (d, opts) => new Intl.DateTimeFormat(intlTag(), opts).format(d),
      keys: (loc) => Object.keys(catalogs[loc] || {}),
    };
  }

  const api = { create, normalizeLocale, localeFromSystem, SUPPORTED, pseudo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
