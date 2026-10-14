/**
 * watch-events.js (M8b.5)
 *
 * Pure helpers for folder-watcher.js: decide what a changed path is, which
 * scoped-scan entries it maps to, and a size+mtime signature used to wait
 * until copies finish. FSEvents labels almost everything 'rename' and
 * repeats paths, so event types are ignored; the path is examined instead.
 * Read-only: lstat / stat / readdir only.
 */

const fs = require('fs');
const path = require('path');
const { isHidden, isBundleDirectory, getExtension, classifyMediaType } = require('./discover');

function isMediaName(name) {
  return !!classifyMediaType(getExtension(name));
}

/** True if any segment of a root-relative path is hidden or a bundle. */
function isIgnoredRelative(rel) {
  return rel.split(path.sep).some((s) => s && (isHidden(s) || isBundleDirectory(s)));
}

/** 'dir' | 'media' | 'gone' | 'other' | 'error' (unreadable, kept conservative). */
async function classify(absPath) {
  let st;
  try {
    st = await fs.promises.lstat(absPath);
    if (st.isSymbolicLink()) st = await fs.promises.stat(absPath);
  } catch (err) {
    return err.code === 'ENOENT' ? 'gone' : 'error';
  }
  if (st.isDirectory()) return 'dir';
  if (st.isFile() && isMediaName(path.basename(absPath))) return 'media';
  return 'other';
}

/** Scoped-scan entries ({ path, recursive }) for one classified path. */
function scopesFor(absPath, kind) {
  const parent = path.dirname(absPath);
  switch (kind) {
    case 'dir': return [{ path: absPath, recursive: true }];
    case 'media': return [{ path: parent, recursive: false }];
    case 'error': return [{ path: parent, recursive: false }];
    case 'gone':
      // A vanished folder needs its subtree swept; a vanished file only its
      // parent. Without an extension it may have been either: request both
      // (if it was a file, the recursive sweep matches nothing).
      return isMediaName(path.basename(absPath))
        ? [{ path: parent, recursive: false }]
        : [{ path: parent, recursive: false }, { path: absPath, recursive: true }];
    default: return [];
  }
}

/** Size+mtime signature; for a folder, over every media file beneath it. */
async function signature(absPath, kind) {
  if (kind === 'media') {
    try {
      const st = await fs.promises.stat(absPath);
      return st.size + ':' + st.mtimeMs;
    } catch (err) { return 'gone'; }
  }
  if (kind !== 'dir') return kind;
  let count = 0; let bytes = 0; let newest = 0;
  async function walk(dir) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (err) { return; }
    for (const e of entries) {
      if (isHidden(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!isBundleDirectory(e.name)) await walk(full); continue; }
      if (!e.isFile() || !isMediaName(e.name)) continue;
      try {
        const st = await fs.promises.stat(full);
        count += 1; bytes += st.size; if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch (err) { /* vanished mid-walk: the next check will differ */ }
    }
  }
  await walk(absPath);
  return count + ':' + bytes + ':' + newest;
}

module.exports = { isMediaName, isIgnoredRelative, classify, scopesFor, signature };
