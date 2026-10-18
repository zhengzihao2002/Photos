/**
 * embedded-text.js -- M12.4 / M12.7
 *
 * Pure helpers that clean values read from files (XMP / IPTC / EXIF /
 * QuickTime tags) before they are stored as the "from file" title, caption
 * and keywords. Nothing here touches a file.
 */

const TITLE_MAX = 255;
const CAPTION_MAX = 2000;
const KEYWORD_MAX = 64;
const KEYWORDS_PER_ITEM = 100;

// Camera and app defaults that are not something a person wrote.
const JUNK_EXACT = new Set(['screenshot', 'untitled', 'image', 'photo', 'unknown', 'null', 'undefined', 'none', 'n/a']);
const JUNK_PATTERNS = [
  /^olympus digital camera$/i, /^sony dsc$/i, /^nikon digital camera$/i, /^canon digital camera$/i,
  /^dsc[ _-]?\d*$/i, /^img[ _-]?\d+$/i, /^digital camera$/i, /^fujifilm digital camera$/i,
  /^kodak .*camera$/i, /^pentax .*camera$/i, /^samsung .*camera$/i, /^[-_. ]+$/,
];

function unwrap(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(unwrap).filter(Boolean)[0] || '';
  if (typeof value === 'object') {
    if (typeof value.value === 'string') return value.value;   // XMP lang-alt: { lang, value }
    if (Array.isArray(value)) return '';
    return '';
  }
  return '';
}

function cleanText(value, max) {
  let s = unwrap(value);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (JUNK_EXACT.has(s.toLowerCase())) return null;
  if (JUNK_PATTERNS.some((re) => re.test(s))) return null;
  return Array.from(s).slice(0, max || CAPTION_MAX).join('');
}

function cleanTitle(value, filename) {
  const t = cleanText(value, TITLE_MAX);
  if (!t) return null;
  if (typeof filename === 'string') {
    const base = filename.replace(/\.[^.]+$/, '');
    if (t.toLowerCase() === filename.toLowerCase() || t.toLowerCase() === base.toLowerCase()) return null;
  }
  return t;
}

function cleanCaption(value) { return cleanText(value, CAPTION_MAX); }

function flattenKeywords(v, out) {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) { v.forEach((x) => flattenKeywords(x, out)); return; }
  if (typeof v === 'object') { flattenKeywords(v.value, out); return; }
  String(v).split(/[,;\n]/).forEach((part) => out.push(part));
}

/** Any number of inputs (strings, arrays, XMP bags). Returns unique (case-insensitive) cleaned keywords. */
function cleanKeywords(...lists) {
  const raw = [];
  lists.forEach((l) => flattenKeywords(l, raw));
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const k = cleanText(r, KEYWORD_MAX);
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= KEYWORDS_PER_ITEM) break;
  }
  return out;
}

/** EV from a number or an 'a/b' fraction; null when absent or implausible (beyond +-10 EV). */
function parseExposureBias(value) {
  let n = null;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
    if (m && Number(m[2]) !== 0) n = Number(m[1]) / Number(m[2]);
    else if (/^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) n = Number(value);
  }
  if (n === null || !Number.isFinite(n) || Math.abs(n) > 10) return null;
  return Math.round(n * 100) / 100;
}

/** 35 mm-equivalent focal length; null unless a plausible positive number. */
function parseFocal35(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 2000 ? value : null;
}

module.exports = { cleanText, cleanTitle, cleanCaption, cleanKeywords, parseExposureBias, parseFocal35,
  TITLE_MAX, CAPTION_MAX, KEYWORD_MAX, KEYWORDS_PER_ITEM };
