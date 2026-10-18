#!/usr/bin/env node
/**
 * tools/check-i18n.js  (M14)
 *
 * Fails (exit 1) when:
 *   1. the English and Simplified Chinese catalogs do not have the same keys;
 *   2. a key's {placeholders} differ between the two languages;
 *   3. code calls t('key') / i18n.t('key') with a key that is not in the catalog;
 *   4. a catalog key is never referenced by any string literal in src/ (unused);
 *   5. a Chinese catalog value contains no Chinese character while the English one has words
 *      (untranslated), except keys on the CJK_OPTIONAL list;
 *   6. a string literal in renderer or main code looks like user-visible text and is not
 *      in tools/i18n-allowlist.json (heuristic scan; every allowlist entry has a reason).
 *
 * Usage: node tools/check-i18n.js [--list]   (--list prints every flagged literal)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const en = require('../src/shared/i18n/en');
const zh = require('../src/shared/i18n/zh-Hans');
const allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-allowlist.json'), 'utf8'));
const LIST = process.argv.includes('--list');

// Keys whose Chinese text is legitimately the same as English (product names, formats).
const SAME_AS_ENGLISH = new Set(allow.sameAsEnglish || []);

const problems = [];
const fail = (msg) => problems.push(msg);

function forms(v) { return typeof v === 'object' && v !== null ? Object.values(v) : [v]; }
function placeholders(v) {
  const set = new Set();
  for (const text of forms(v)) for (const m of String(text).matchAll(/\{([A-Za-z0-9_]+)\}/g)) set.add(m[1]);
  return [...set].sort().join(',');
}

// 1 + 2
const enKeys = Object.keys(en); const zhKeys = Object.keys(zh);
for (const k of enKeys) if (!(k in zh)) fail('missing in zh-Hans: ' + k);
for (const k of zhKeys) if (!(k in en)) fail('missing in en: ' + k);
for (const k of enKeys) {
  if (!(k in zh)) continue;
  if (!(allow.placeholderExempt || []).includes(k) && placeholders(en[k]) !== placeholders(zh[k])) fail('placeholders differ: ' + k + ' (' + placeholders(en[k]) + ' vs ' + placeholders(zh[k]) + ')');
  if (typeof zh[k] === 'object' && zh[k] !== null) {
    for (const cat of Object.keys(zh[k])) if (cat !== 'other') fail('zh-Hans plural for ' + k + ' may only use "other", found "' + cat + '"');
  }
  if (typeof en[k] === 'object' && en[k] !== null && !('other' in en[k])) fail('en plural for ' + k + ' needs "other"');
}
// 5
const HAN = /[㐀-鿿]/;
for (const k of enKeys) {
  if (!(k in zh) || SAME_AS_ENGLISH.has(k)) continue;
  const e = forms(en[k]).join(' ');
  const z = forms(zh[k]).join(' ');
  if (/[A-Za-z]{3,}/.test(e.replace(/\{[A-Za-z0-9_]+\}/g, '')) && !HAN.test(z)) fail('zh-Hans value has no Chinese: ' + k + ' = ' + z);
}

// source files
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (name === 'vendor' || name === 'node_modules') continue; walk(p, out); }
    else if (name.endsWith('.js') || name.endsWith('.html')) out.push(p);
  }
  return out;
}
// Main-process files that can put text in front of the user. Other main modules only produce
// technical diagnostics (log lines, internal error text), which stay English by design.
const MAIN_UI = [/^src\/main\/(main|menu|settings-window|info-window)\.js$/, /^src\/main\/ipc\/handlers\//, /^src\/main\/people\/people-privacy\.js$/, /^src\/main\/storage\/storage\.js$/];
const files = walk(SRC, []).filter((f) => !f.includes(path.join('shared', 'i18n'))).filter((f) => {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  return !rel.startsWith('src/main/') || MAIN_UI.some((re) => re.test(rel));
});

/** Extract string literals (static text) with line numbers; skips comments and regex literals. */
function literals(code) {
  const out = [];
  let i = 0; let line = 1;
  const n = code.length;
  let prevSig = ''; // last significant char, to tell a regex from a division
  while (i < n) {
    const c = code[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') { i += 2; while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { if (code[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; let s = ''; const startLine = line;
      while (j < n && code[j] !== c && code[j] !== '\n') {
        if (code[j] === '\\') {
          const nx = code[j + 1];
          if (nx === 'u') { s += String.fromCharCode(parseInt(code.substr(j + 2, 4), 16) || 63); j += 6; continue; }
          if (nx === 'n') s += '\n'; else if (nx === 't') s += '\t'; else s += nx;
          j += 2; continue;
        }
        s += code[j]; j++;
      }
      out.push({ text: s, line: startLine, kind: 'str' });
      i = j + 1; prevSig = c; continue;
    }
    if (c === '`') {
      let j = i + 1; let s = ''; const startLine = line; let depth = 0;
      while (j < n) {
        if (code[j] === '\\') { s += code[j + 1]; j += 2; continue; }
        if (depth === 0 && code[j] === '`') break;
        if (code[j] === '$' && code[j + 1] === '{') { depth++; s += '\u0000'; j += 2; continue; }
        if (depth > 0) { if (code[j] === '{') depth++; else if (code[j] === '}') depth--; if (code[j] === '\n') line++; j++; continue; }
        if (code[j] === '\n') line++;
        s += code[j]; j++;
      }
      out.push({ text: s, line: startLine, kind: 'tpl' });
      i = j + 1; prevSig = '`'; continue;
    }
    if (c === '/' && '(,=:[!&|?{};+-*%<>~^'.includes(prevSig || '(')) { // regex literal
      let j = i + 1; let inClass = false;
      while (j < n && code[j] !== '\n') { if (code[j] === '\\') { j += 2; continue; } if (code[j] === '[') inClass = true; else if (code[j] === ']') inClass = false; else if (code[j] === '/' && !inClass) break; j++; }
      i = j + 1; prevSig = ')'; continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out;
}

const SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|PRAGMA|WITH|DROP|BEGIN|COMMIT|REPLACE)\b/i;
const SVGPATH = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,\-]+$/;
function looksLikeUiText(text, lineText) {
  const t = text.replace(/\u0000/g, '').trim();
  if (t.length < 3) return false;
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (/^[a-z][a-zA-Z0-9_.:\/\-]*$/.test(t)) return false;          // identifier, event name, key, file name
  if (/^[A-Z0-9_]+$/.test(t)) return false;                          // CONSTANT
  if (SQL.test(t) || /\b(FROM|WHERE|ORDER BY|GROUP BY|LIMIT)\b/.test(t) && /[A-Z]{4,}/.test(t)) return false;
  if (SVGPATH.test(t)) return false;
  if (/^(Escape|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Backspace|Delete|Tab|Shift|Alt|Control|Meta|Space|Home|End|PageUp|PageDown|Files|Return)$/.test(t)) return false; // key names, drag types
  if (t === 'use strict' || /^(Shift|Alt|Cmd|Command|CmdOrCtrl|Ctrl|Control)\+/.test(t)) return false; // directive, accelerator
  if (/\b(AND|OR|IS NULL|IS NOT NULL|DESC|ASC|BETWEEN)\b/.test(t) && /[=<>.]|\bIS\b/.test(t)) return false; // SQL fragment
  if (/^(::|-?\d)/.test(t) || /^[a-z-]+\(/.test(t) || /\)$/.test(t) && !/\s\(/.test(t) || /^(var|calc|inset|rotate|translate)/.test(t)) return false; // filter segments, CSS values
  if (/ease|cubic-bezier|px\b|rgba?\(|#[0-9a-f]{3,8}\b/.test(t) && !/[.!?]$/.test(t) && t.split(' ').length < 6) return false;
  if (/^(https?:|file:|photos-media:|data:|blob:|\.|#|--|\/|~)/.test(t)) return false;
  if (/[{};]/.test(t) && /[:;]\s/.test(t)) return false;            // CSS text
  if (/^[a-z-]+\s*:\s*[^ ]/.test(t) && !/[A-Z]/.test(t[0])) return false;
  if (/^(application|image|video|audio|text)\/[\w.+-]+$/.test(t)) return false;
  if (/console\.(log|warn|error|info|debug)\(/.test(lineText)) return false;
  if (/throw new (Error|TypeError|RangeError)\(/.test(lineText)) return false;
  if (/\brequire\(/.test(lineText)) return false;
  if (/^[a-z]+(-[a-z0-9]+)+( [a-z]+(-[a-z0-9]+)*)*$/.test(t)) return false; // class lists
  if (/^[a-z][\w-]*( [a-z][\w-]*)+$/.test(t) && !/[A-Z]/.test(t) && !/[.,!?]/.test(t) && lineText.includes('class')) return false;
  return true;
}

const allKeys = new Set(enKeys);
const referenced = new Set();
const missingRefs = [];
const flagged = [];
const allowSet = (allow.literals || []).map((e) => ({ file: e.file, text: e.text, re: e.regex ? new RegExp(e.regex) : null }));
const allowUsed = new Set();

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const code = fs.readFileSync(file, 'utf8');
  const lines = code.split('\n');
  const lits = literals(file.endsWith('.html') ? (code.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n') : code);
  for (const l of lits) {
    if (allKeys.has(l.text)) referenced.add(l.text);
    const lineText = lines[l.line - 1] || '';
    // t('some.key') with an unknown key
    const callRe = /\b(?:t|tr|i18n\.t|I18n\.t|window\.t)\(\s*(['"])([^'"]+)\1/g;
    let m;
    while ((m = callRe.exec(lineText))) if (!allKeys.has(m[2]) && /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/.test(m[2])) missingRefs.push(rel + ':' + l.line + ' ' + m[2]);
    if (!looksLikeUiText(l.text, lineText)) continue;
    const idx = allowSet.findIndex((a) => a.file === rel && (a.re ? a.re.test(l.text) : a.text === l.text));
    if (idx !== -1) { allowUsed.add(idx); continue; }
    flagged.push(rel + ':' + l.line + '  ' + JSON.stringify(l.text.length > 90 ? l.text.slice(0, 90) + '…' : l.text));
  }
}

for (const k of enKeys) if (!referenced.has(k) && !(allow.dynamicKeyPrefixes || []).some((p) => k.startsWith(p))) fail('unused key: ' + k);
for (const r of [...new Set(missingRefs)]) fail('t() with unknown key: ' + r);
allowSet.forEach((a, i) => { if (!allowUsed.has(i) && !LIST) fail('allowlist entry never matched (remove it): ' + a.file + ' ' + (a.text || a.re)); });
for (const f of flagged) fail('possibly hardcoded UI text: ' + f);

if (problems.length) {
  console.error(problems.length + ' i18n problem(s):');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('i18n OK: ' + enKeys.length + ' keys in both languages, ' + files.length + ' source files scanned, ' + allowSet.length + ' allowlisted literals.');
