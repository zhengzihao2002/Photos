#!/usr/bin/env node
/**
 * tools/verify-readonly.js  (M11) -- proves the app left your photo folders untouched.
 *
 *   ./dev verify-readonly record <name> <folder>... [--hash]   fingerprint the folders now
 *   ./dev verify-readonly compare <before> <after>             what changed between two fingerprints
 *   ./dev verify-readonly check <name> <folder>... [--hash]    record <name>; if it already existed, compare it with a fresh one
 *
 * A fingerprint (.cache/fingerprints/<name>.json) has, for every file and folder under the given
 * folders: path, size, modification time in nanoseconds, mode, the NAMES of extended attributes
 * and, with --hash, a SHA-256 of the content. Differences in files (set, size, mtime, mode,
 * attributes, content) fail the comparison; folder modification times and .DS_Store files that
 * macOS itself maintains are listed but do not.
 * Read-only: this tool never writes anywhere except .cache/fingerprints/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', '.cache', 'fingerprints');
const IGNORED_NAMES = new Set(['.DS_Store', '.localized']);

function xattrNames(p) {
  if (process.platform !== 'darwin') return [];
  try {
    return execFileSync('/usr/bin/xattr', [p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map((s) => s.trim()).filter(Boolean).sort();
  } catch (e) { return []; }
}

function sha256(file) {
  const h = crypto.createHash('sha256'); const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(1 << 20);
  try { for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break; h.update(buf.subarray(0, n)); } } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function walk(root, hash, out) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let st; try { st = fs.lstatSync(dir, { bigint: true }); } catch (e) { continue; }
    out[dir] = { kind: 'dir', mtimeNs: String(st.mtimeNs), mode: Number(st.mode), xattrs: xattrNames(dir) };
    let names; try { names = fs.readdirSync(dir); } catch (e) { out[dir].unreadable = e.code; continue; }
    for (const name of names) {
      const p = path.join(dir, name);
      let s; try { s = fs.lstatSync(p, { bigint: true }); } catch (e) { continue; }
      if (s.isDirectory()) { stack.push(p); continue; }
      const rec = { kind: s.isSymbolicLink() ? 'link' : 'file', size: Number(s.size), mtimeNs: String(s.mtimeNs), mode: Number(s.mode), xattrs: xattrNames(p) };
      if (hash && s.isFile()) { try { rec.sha256 = sha256(p); } catch (e) { rec.sha256 = 'unreadable:' + e.code; } }
      out[p] = rec;
    }
  }
}

function record(name, folders, hash) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('name may only use letters, digits, dot, dash and underscore');
  const entries = {};
  for (const f of folders) walk(path.resolve(f), hash, entries);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name + '.json');
  fs.writeFileSync(file, JSON.stringify({ taken: new Date().toISOString(), folders: folders.map((f) => path.resolve(f)), hash, entries }));
  const files = Object.values(entries).filter((e) => e.kind !== 'dir').length;
  console.log('recorded ' + files + ' files in ' + Object.keys(entries).length + ' places -> ' + path.relative(process.cwd(), file));
  return file;
}

function load(name) {
  const file = fs.existsSync(name) ? name : path.join(OUT_DIR, name + '.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function compare(a, b) {
  const A = a.entries; const B = b.entries; const diffs = []; const notes = [];
  const ignored = (p) => IGNORED_NAMES.has(path.basename(p));
  for (const p of Object.keys(A)) {
    if (ignored(p)) continue;
    if (!(p in B)) { diffs.push('MISSING   ' + p); continue; }
    const x = A[p]; const y = B[p];
    if (x.kind === 'dir') { if (x.mtimeNs !== y.mtimeNs) notes.push('folder time changed  ' + p); continue; }
    const why = [];
    if (x.kind !== y.kind) why.push('kind');
    if (x.size !== y.size) why.push('size ' + x.size + ' -> ' + y.size);
    if (x.mtimeNs !== y.mtimeNs) why.push('mtime ' + x.mtimeNs + ' -> ' + y.mtimeNs);
    if (x.mode !== y.mode) why.push('mode ' + x.mode.toString(8) + ' -> ' + y.mode.toString(8));
    if (JSON.stringify(x.xattrs) !== JSON.stringify(y.xattrs)) why.push('attributes ' + JSON.stringify(x.xattrs) + ' -> ' + JSON.stringify(y.xattrs));
    if (x.sha256 && y.sha256 && x.sha256 !== y.sha256) why.push('content hash');
    if (why.length) diffs.push('CHANGED   ' + p + '  (' + why.join('; ') + ')');
  }
  for (const p of Object.keys(B)) if (!(p in A) && !ignored(p)) diffs.push('NEW       ' + p);
  for (const n of notes.slice(0, 20)) console.log('  note: ' + n);
  if (notes.length > 20) console.log('  note: ... and ' + (notes.length - 20) + ' more folders with a new modification time (macOS updates these itself; not a failure)');
  if (diffs.length) { console.log(diffs.length + ' difference(s):'); for (const d of diffs.slice(0, 200)) console.log('  ' + d); return 1; }
  console.log('IDENTICAL: no file was added, removed or changed (' + Object.values(B).filter((e) => e.kind !== 'dir').length + ' files compared' + (a.hash && b.hash ? ', content hashes included' : '') + ').');
  return 0;
}

function main(argv) {
  const hash = argv.includes('--hash');
  const args = argv.filter((x) => x !== '--hash');
  const [cmd, ...rest] = args;
  if (cmd === 'record' && rest.length >= 2) { record(rest[0], rest.slice(1), hash); return 0; }
  if (cmd === 'compare' && rest.length === 2) return compare(load(rest[0]), load(rest[1]));
  if (cmd === 'check' && rest.length >= 2) {
    const existed = fs.existsSync(path.join(OUT_DIR, rest[0] + '.json'));
    if (!existed) { record(rest[0], rest.slice(1), hash); console.log('Now use the app, quit it, and run the same command again.'); return 0; }
    const before = load(rest[0]);
    const tmpName = rest[0] + '.after';
    record(tmpName, rest.slice(1), hash || before.hash);
    return compare(before, load(tmpName));
  }
  console.error('usage:\n  verify-readonly record <name> <folder>... [--hash]\n  verify-readonly compare <before> <after>\n  verify-readonly check <name> <folder>... [--hash]');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { record, compare, walk };
